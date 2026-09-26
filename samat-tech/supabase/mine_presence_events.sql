-- ═══════════════════════════════════════════════════════════════════════════
-- ثبت ورود/خروج مسئول فنی/ایمنی/بهداشت از محدوده‌ی معدن (geofence) — ✅ این
-- migration مستقیماً روی پروژه‌ی Supabase واقعی (khhurfxqxkuphksglgqi /
-- «معادن قروه») اجرا و تایید شده است؛ این فایل فقط برای مرجع/تاریخچه نگه
-- داشته شده، نیازی به اجرای دستی دوباره نیست.
--
-- سیاست‌های RLS پایین دقیقاً هم‌الگو با safety_checkins (که قبلاً روی همین
-- پروژه تایید و اجرا شده) نوشته شده‌اند.
--
-- استفاده در کد: samat-tech/src/lib/mineGeofence.js (ثبت رویداد از سمت اپ
-- مسئول فنی) و اکشن mineBoundaryEvent در Edge Function «notify-relay»
-- (اطلاع فوری به ادمین‌ها — کد این Edge Function مستقیماً روی Supabase
-- مدیریت می‌شود، مثل بقیه‌ی Edge Functionهای این پروژه، و در این ریپو ذخیره
-- نشده).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.mine_presence_events (
  id bigint generated always as identity primary key,
  email text not null,
  mine_name text not null,
  department text not null,
  event_type text not null check (event_type in ('enter', 'exit')),
  lat double precision,
  lon double precision,
  accuracy double precision,
  device_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists mine_presence_events_email_mine_idx on public.mine_presence_events (email, mine_name, occurred_at);
create index if not exists mine_presence_events_dept_idx on public.mine_presence_events (department, occurred_at);

alter table public.mine_presence_events enable row level security;

create policy mine_presence_events_insert_own_mine on public.mine_presence_events
  for insert
  with check (
    email = ((select auth.jwt()) ->> 'email'::text)
    and exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = any (array['tech_officer'::text, 'safety_officer'::text, 'health_officer'::text])
        and ur.assigned_mines @> to_jsonb(mine_presence_events.mine_name)
    )
  );

create policy mine_presence_events_select_scoped on public.mine_presence_events
  for select
  using (
    email = ((select auth.jwt()) ->> 'email'::text)
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = any (array['admin'::text, 'superadmin'::text])
        and (ur.department = mine_presence_events.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'inspector'::text
        and (ur.department = mine_presence_events.department or ur.department = 'all'::text)
    )
  );

-- جفت‌کردن هر enter با اولین exit بعدی همان فرد/معدن → یک «نوبت حضور» با مدت‌زمان به ساعت.
-- توجه: این یک تخمین ساده‌ی زوج‌سازی متوالی است — اگر رویدادی به‌خاطر قطعی طولانی اینترنت/آفلاین
-- خیلی دیر برسد و ترتیب واقعی زمانی به‌هم بریزد، ممکن است یک نوبت اشتباه محاسبه شود؛ برای گزارش
-- دقیق‌تر باید occurred_at (زمان واقعی رویداد روی گوشی) را مبنا قرار داد، نه زمان ثبت در دیتابیس —
-- که همین‌جا هم occurred_at مبنا قرار گرفته، نه created_at.
-- security_invoker یعنی این View هم از همان RLS جدول پایه پیروی می‌کند (نه دسترسی owner).
create or replace view public.mine_presence_sessions
with (security_invoker = true) as
with paired as (
  select
    email, mine_name, department, event_type, occurred_at,
    lead(occurred_at) over (partition by email, mine_name order by occurred_at) as next_at,
    lead(event_type) over (partition by email, mine_name order by occurred_at) as next_type
  from public.mine_presence_events
)
select
  email, mine_name, department,
  occurred_at as enter_at,
  next_at as exit_at,
  extract(epoch from (next_at - occurred_at)) / 3600.0 as hours
from paired
where event_type = 'enter' and next_type = 'exit';

grant select on public.mine_presence_sessions to authenticated;

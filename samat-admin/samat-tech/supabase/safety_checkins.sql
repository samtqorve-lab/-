-- ═══════════════════════════════════════════════════════════════════════════
-- جدول «چک‌این ایمنی کارگر تنها» — ✅ این migration مستقیماً روی پروژه‌ی
-- Supabase واقعی (khhurfxqxkuphksglgqi / «معادن قروه») اجرا و تایید شده است؛
-- این فایل فقط برای مرجع/تاریخچه نگه داشته شده، نیازی به اجرای دستی دوباره نیست.
--
-- سیاست‌های RLS پایین را نه حدسی، بلکه با خواندن مستقیم pg_policies جدول‌های
-- واقعی مشابه (safety_checklists، incident_reports، corrective_actions) و
-- تابع‌های کمکی schema به نام private (is_admin_or_super و...) نوشتم — یعنی
-- دقیقاً هم‌الگو با بقیه‌ی این پروژه‌اند، نه یک الگوی حدسی جدا.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.safety_checkins (
  id bigint generated always as identity primary key,
  email text not null,
  mine_name text not null,
  department text not null,
  status text not null default 'active' check (status in ('active', 'ended', 'overdue')),
  next_due_at timestamptz not null,
  last_ping_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists safety_checkins_email_idx on public.safety_checkins (email, status);
create index if not exists safety_checkins_status_idx on public.safety_checkins (status) where status = 'overdue';

alter table public.safety_checkins enable row level security;

create policy safety_checkins_insert_own_mine on public.safety_checkins
  for insert
  with check (
    email = ((select auth.jwt()) ->> 'email'::text)
    and (
      private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
      or exists (
        select 1 from user_roles ur
        where ur.email = ((select auth.jwt()) ->> 'email'::text)
          and ur.role = any (array['tech_officer'::text, 'safety_officer'::text, 'health_officer'::text])
          and ur.assigned_mines @> to_jsonb(safety_checkins.mine_name)
      )
    )
  );

create policy safety_checkins_select_scoped on public.safety_checkins
  for select
  using (
    email = ((select auth.jwt()) ->> 'email'::text)
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = any (array['admin'::text, 'superadmin'::text])
        and (ur.department = safety_checkins.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'inspector'::text
        and (ur.department = safety_checkins.department or ur.department = 'all'::text)
    )
  );

create policy safety_checkins_update on public.safety_checkins
  for update
  using (
    email = ((select auth.jwt()) ->> 'email'::text)
    or private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
  )
  with check (
    email = ((select auth.jwt()) ->> 'email'::text)
    or private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
  );

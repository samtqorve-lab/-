-- ═══════════════════════════════════════════════════════════════════════════
-- جدول «عکس روزانه‌ی محل گمانه/محدوده اکتشافی» — ✅ این migration مستقیماً روی
-- پروژه‌ی Supabase واقعی (khhurfxqxkuphksglgqi / «معادن قروه») اجرا و تایید شده
-- است؛ این فایل فقط برای مرجع/تاریخچه نگه داشته شده، نیازی به اجرای دستی دوباره نیست.
--
-- سیاست‌های RLS پایین دقیقاً هم‌الگو با mine_equipment (عکس ماشین‌آلات) هستند —
-- insert فقط برای مسئول فنی با معدن اختصاص‌یافته (assigned_mines)، select برای
-- ادمین/بازرس هم‌بخش یا خودِ مسئول فنی همان معدن.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.exploration_site_photos (
  id bigint generated always as identity primary key,
  mine_name text not null,
  borehole_no text,
  photo_date date not null default current_date,
  photo_url text not null,
  lat double precision,
  lon double precision,
  inside_boundary boolean,
  submitted_by text not null,
  department text not null default 'اکتشاف',
  created_at timestamptz not null default now()
);

create index if not exists exploration_site_photos_lookup_idx
  on public.exploration_site_photos (mine_name, borehole_no, photo_date);

alter table public.exploration_site_photos enable row level security;

create policy exploration_site_photos_insert_own_mine on public.exploration_site_photos
  for insert
  with check (
    submitted_by = ((select auth.jwt()) ->> 'email'::text)
    and (
      private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
      or exists (
        select 1 from user_roles ur
        where ur.email = ((select auth.jwt()) ->> 'email'::text)
          and ur.role = 'tech_officer'::text
          and ur.assigned_mines @> to_jsonb(exploration_site_photos.mine_name)
      )
    )
  );

create policy exploration_site_photos_select_scoped on public.exploration_site_photos
  for select
  using (
    exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = any (array['admin'::text, 'superadmin'::text])
        and (ur.department = exploration_site_photos.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'inspector'::text
        and (ur.department = exploration_site_photos.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'tech_officer'::text
        and ur.assigned_mines @> to_jsonb(exploration_site_photos.mine_name)
    )
  );

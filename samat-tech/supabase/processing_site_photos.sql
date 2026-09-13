-- ═══════════════════════════════════════════════════════════════════════════
-- جدول «عکس روزانه‌ی محل کارخانه/دپو محصول/دپو مواد اولیه» — ✅ این migration
-- مستقیماً روی پروژه‌ی Supabase واقعی (khhurfxqxkuphksglgqi / «معادن قروه») اجرا
-- و تایید شده است؛ این فایل فقط برای مرجع/تاریخچه نگه داشته شده.
--
-- سیاست‌های RLS دقیقاً هم‌الگو با mine_equipment / exploration_site_photos هستند.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.processing_site_photos (
  id bigint generated always as identity primary key,
  mine_name text not null,
  location_type text not null check (location_type in ('کارخانه', 'دپو محصول', 'دپو مواد اولیه')),
  photo_date date not null default current_date,
  photo_url text not null,
  lat double precision,
  lon double precision,
  inside_boundary boolean,
  submitted_by text not null,
  department text not null default 'فرآوری',
  created_at timestamptz not null default now()
);

create index if not exists processing_site_photos_lookup_idx
  on public.processing_site_photos (mine_name, location_type, photo_date);

alter table public.processing_site_photos enable row level security;

create policy processing_site_photos_insert_own_mine on public.processing_site_photos
  for insert
  with check (
    submitted_by = ((select auth.jwt()) ->> 'email'::text)
    and (
      private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
      or exists (
        select 1 from user_roles ur
        where ur.email = ((select auth.jwt()) ->> 'email'::text)
          and ur.role = 'tech_officer'::text
          and ur.assigned_mines @> to_jsonb(processing_site_photos.mine_name)
      )
    )
  );

create policy processing_site_photos_select_scoped on public.processing_site_photos
  for select
  using (
    exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = any (array['admin'::text, 'superadmin'::text])
        and (ur.department = processing_site_photos.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'inspector'::text
        and (ur.department = processing_site_photos.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'tech_officer'::text
        and ur.assigned_mines @> to_jsonb(processing_site_photos.mine_name)
    )
  );

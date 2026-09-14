-- ═══════════════════════════════════════════════════════════════════════════
-- جدول «مدیریت باطله (سد باطله) فرآوری» — ✅ این migration مستقیماً روی پروژه‌ی
-- Supabase واقعی (khhurfxqxkuphksglgqi / «معادن قروه») اجرا و تایید شده است؛
-- این فایل فقط برای مرجع/تاریخچه نگه داشته شده.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.processing_tailings_dam (
  id bigint generated always as identity primary key,
  mine_name text not null,
  department text not null default 'فرآوری',
  submitted_by text not null,
  period text not null,
  deposited_tonnage numeric,
  remaining_capacity_percent numeric,
  lat double precision,
  lon double precision,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.processing_tailings_dam enable row level security;

create policy processing_tailings_dam_insert_own_mine on public.processing_tailings_dam
  for insert
  with check (
    submitted_by = ((select auth.jwt()) ->> 'email'::text)
    and (
      private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
      or exists (
        select 1 from user_roles ur
        where ur.email = ((select auth.jwt()) ->> 'email'::text)
          and ur.role = 'tech_officer'::text
          and ur.assigned_mines @> to_jsonb(processing_tailings_dam.mine_name)
      )
    )
  );

create policy processing_tailings_dam_select_scoped on public.processing_tailings_dam
  for select
  using (
    exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = any (array['admin'::text, 'superadmin'::text])
        and (ur.department = processing_tailings_dam.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'inspector'::text
        and (ur.department = processing_tailings_dam.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'tech_officer'::text
        and ur.assigned_mines @> to_jsonb(processing_tailings_dam.mine_name)
    )
  );

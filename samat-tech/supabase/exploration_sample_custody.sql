-- ═══════════════════════════════════════════════════════════════════════════
-- جدول «زنجیره نگهداری نمونه اکتشاف» — ✅ این migration مستقیماً روی پروژه‌ی
-- Supabase واقعی (khhurfxqxkuphksglgqi / «معادن قروه») اجرا و تایید شده است؛
-- این فایل فقط برای مرجع/تاریخچه نگه داشته شده.
--
-- برخلاف بقیه‌ی جداول append-only این پروژه، این یکی UPDATE هم دارد (وضعیت نمونه
-- در طول زمان عوض می‌شود) — سیاست UPDATE هم‌الگو با mine_personnel/safety_checkins است.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.exploration_sample_custody (
  id bigint generated always as identity primary key,
  mine_name text not null,
  borehole_no text,
  sample_code text not null,
  status text not null default 'برداشت شده'
    check (status in ('برداشت شده', 'در حال انتقال', 'تحویل آزمایشگاه', 'نتیجه دریافت شد')),
  lab_name text,
  collected_by text not null,
  collected_at timestamptz not null default now(),
  status_note text,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists exploration_sample_custody_lookup_idx
  on public.exploration_sample_custody (mine_name, sample_code);

alter table public.exploration_sample_custody enable row level security;

create policy exploration_sample_custody_insert_own_mine on public.exploration_sample_custody
  for insert
  with check (
    collected_by = ((select auth.jwt()) ->> 'email'::text)
    and (
      private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
      or exists (
        select 1 from user_roles ur
        where ur.email = ((select auth.jwt()) ->> 'email'::text)
          and ur.role = 'tech_officer'::text
          and ur.assigned_mines @> to_jsonb(exploration_sample_custody.mine_name)
      )
    )
  );

create policy exploration_sample_custody_select_scoped on public.exploration_sample_custody
  for select
  using (
    exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = any (array['admin'::text, 'superadmin'::text])
        and (ur.department = 'اکتشاف'::text or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'inspector'::text
        and (ur.department = 'اکتشاف'::text or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'tech_officer'::text
        and ur.assigned_mines @> to_jsonb(exploration_sample_custody.mine_name)
    )
  );

create policy exploration_sample_custody_update on public.exploration_sample_custody
  for update
  using (
    collected_by = ((select auth.jwt()) ->> 'email'::text)
    or private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text) and ur.role = 'inspector'::text
    )
  )
  with check (
    collected_by = ((select auth.jwt()) ->> 'email'::text)
    or private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text) and ur.role = 'inspector'::text
    )
  );

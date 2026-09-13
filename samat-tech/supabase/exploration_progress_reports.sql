-- ═══════════════════════════════════════════════════════════════════════════
-- جدول «گزارش پیشرفت دوره‌ای اکتشاف» — ✅ این migration مستقیماً روی پروژه‌ی
-- Supabase واقعی (khhurfxqxkuphksglgqi / «معادن قروه») اجرا و تایید شده است؛
-- این فایل فقط برای مرجع/تاریخچه نگه داشته شده.
--
-- سیاست‌های RLS دقیقاً هم‌الگو با processing_reports هستند (فقط نام جدول/فیلدها فرق دارد).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.exploration_progress_reports (
  id bigint generated always as identity primary key,
  mine_name text not null,
  department text not null default 'اکتشاف',
  submitted_by text not null,
  period text not null,
  boreholes_count integer,
  total_meterage numeric,
  progress_percent numeric,
  obstacles text,
  next_plan text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.exploration_progress_reports enable row level security;

create policy exploration_progress_reports_insert_own_mine on public.exploration_progress_reports
  for insert
  with check (
    submitted_by = ((select auth.jwt()) ->> 'email'::text)
    and (
      private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
      or exists (
        select 1 from user_roles ur
        where ur.email = ((select auth.jwt()) ->> 'email'::text)
          and ur.role = 'tech_officer'::text
          and ur.assigned_mines @> to_jsonb(exploration_progress_reports.mine_name)
      )
    )
  );

create policy exploration_progress_reports_select_scoped on public.exploration_progress_reports
  for select
  using (
    exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = any (array['admin'::text, 'superadmin'::text])
        and (ur.department = exploration_progress_reports.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'inspector'::text
        and (ur.department = exploration_progress_reports.department or ur.department = 'all'::text)
    )
    or exists (
      select 1 from user_roles ur
      where ur.email = ((select auth.jwt()) ->> 'email'::text)
        and ur.role = 'tech_officer'::text
        and ur.assigned_mines @> to_jsonb(exploration_progress_reports.mine_name)
    )
  );

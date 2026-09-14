-- ═══════════════════════════════════════════════════════════════════════════
-- جدول «مسیر تراورس اکتشافی» — ✅ این migration مستقیماً روی پروژه‌ی Supabase واقعی
-- (khhurfxqxkuphksglgqi / «معادن قروه») اجرا و تایید شده است؛ این فایل فقط برای
-- مرجع/تاریخچه نگه داشته شده.
--
-- points یک آرایه‌ی jsonb از نقاط است (نه یک ردیف به‌ازای هر نقطه)، چون یک تراورس
-- یک واحد منطقی واحد است: [{"lat":..,"lon":..,"t":"..."}, ...]
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.exploration_traverses (
  id bigint generated always as identity primary key,
  mine_name text not null,
  traverse_name text,
  points jsonb not null,
  total_distance_m numeric,
  started_by text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.exploration_traverses enable row level security;

create policy exploration_traverses_insert_own_mine on public.exploration_traverses
  for insert
  with check (
    started_by = ((select auth.jwt()) ->> 'email'::text)
    and (
      private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
      or exists (
        select 1 from user_roles ur
        where ur.email = ((select auth.jwt()) ->> 'email'::text)
          and ur.role = 'tech_officer'::text
          and ur.assigned_mines @> to_jsonb(exploration_traverses.mine_name)
      )
    )
  );

create policy exploration_traverses_select_scoped on public.exploration_traverses
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
        and ur.assigned_mines @> to_jsonb(exploration_traverses.mine_name)
    )
  );

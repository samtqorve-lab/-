-- ═══════════════════════════════════════════════════════════════════════════
-- جدول «شیب/امتداد اکتشاف» — ✅ این migration مستقیماً روی پروژه‌ی Supabase واقعی
-- (khhurfxqxkuphksglgqi / «معادن قروه») اجرا و تایید شده است؛ این فایل فقط برای
-- مرجع/تاریخچه نگه داشته شده.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.exploration_strike_dip (
  id bigint generated always as identity primary key,
  mine_name text not null,
  borehole_no text,
  strike_deg numeric not null,
  dip_deg numeric not null,
  lat double precision,
  lon double precision,
  measured_by text not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.exploration_strike_dip enable row level security;

create policy exploration_strike_dip_insert_own_mine on public.exploration_strike_dip
  for insert
  with check (
    measured_by = ((select auth.jwt()) ->> 'email'::text)
    and (
      private.is_admin_or_super(((select auth.jwt()) ->> 'email'::text))
      or exists (
        select 1 from user_roles ur
        where ur.email = ((select auth.jwt()) ->> 'email'::text)
          and ur.role = 'tech_officer'::text
          and ur.assigned_mines @> to_jsonb(exploration_strike_dip.mine_name)
      )
    )
  );

create policy exploration_strike_dip_select_scoped on public.exploration_strike_dip
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
        and ur.assigned_mines @> to_jsonb(exploration_strike_dip.mine_name)
    )
  );

-- این فایل را یک‌بار در Supabase SQL Editor پروژه اجرا کن (برای امکان «دوره‌ی تمدید احراز هویت
-- قابل‌تنظیم» و «معافیت مسئول فنی خاص از محدوده‌ی جغرافیایی احراز هویت»). اگر بخشی از این‌ها
-- (مثلاً جدول public_settings) از قبل دارید، همان بخش را حذف/رد کنید — بقیه بدون مشکل روی هم
-- اجرا می‌شوند (idempotent).

-- ۱) ستون معافیت از محدوده‌ی جغرافیایی برای عکس احراز هویت — فقط سوپرادمین از پنل ادمین آن را
--    برای یک مسئول فنی/ایمنی/بهداشت خاص روشن می‌کند.
alter table public.user_roles
  add column if not exists identity_boundary_exempt boolean not null default false;

-- ۲) جدول تنظیمات عمومی سیستم (اگر از قبل ندارید) — دوره‌ی تمدید و یادآوری احراز هویت این‌جا
--    ذخیره می‌شود (کلید/مقدار ساده).
create table if not exists public.public_settings (
  key text primary key,
  value text
);

alter table public.public_settings enable row level security;

-- خواندن: هر کاربر واردشده (اپ مسئول فنی موقع بوت همین را می‌خواند)
drop policy if exists "public_settings_select_authenticated" on public.public_settings;
create policy "public_settings_select_authenticated"
  on public.public_settings for select
  to authenticated
  using (true);

-- نوشتن: فقط ادمین/سوپرادمین (پنل ادمین از همین‌جا مقدار را عوض می‌کند)
drop policy if exists "public_settings_write_admin" on public.public_settings;
create policy "public_settings_write_admin"
  on public.public_settings for all
  to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.email = auth.jwt() ->> 'email' and ur.role in ('admin', 'superadmin')
    )
  )
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.email = auth.jwt() ->> 'email' and ur.role in ('admin', 'superadmin')
    )
  );

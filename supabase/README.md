# دیتابیس (Supabase)

⚠️ **وضعیت فعلی:** ساختار کامل دیتابیس (جدول‌ها، سیاست‌های RLS، توابع، تریگرها، باکت‌ها) هنوز به‌صورت کامل داخل این مخزن نیست و فقط روی Supabase وجود دارد. فایل‌های `migrations/` این‌جا فقط تغییراتی را ثبت می‌کنند که در بازبینی‌ی ۱۳ مهر ۱۴۰۵ اعمال شد؛ **برای بازسازی کل دیتابیس کافی نیستند**.

## قدم بعدی (ده دقیقه کار، یک‌بار)
با Supabase CLI یک عکس کامل از وضعیت فعلی بگیرید و کنار این README commit کنید:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db dump --schema public,private,storage -f supabase/schema.sql
supabase db dump --data-only --table public.safety_checklist_items -f supabase/seed_checklist_items.sql   # اختیاری
```

از آن به بعد هر تغییر دیتابیس باید فقط به‌صورت یک فایل جدید در `migrations/` (با پیشوند تاریخ) اعمال شود، نه دستی از داشبورد.

## ترتیب migrationهای ثبت‌شده
1. `20261003000100_identity_submit.sql` — ثبت احراز هویت مسئول فنی (معافیت از محدوده، پاک‌کردن عکس یتیم، آپلود عکس حادثه برای ایمنی/بهداشت، بستن دسترسی anon)
2. `20261003000200_user_roles_self_update_whitelist.sql` — محافظت از `user_roles` با فهرست سفید
3. `20261003000300_identity_archive_and_client_errors.sql` — بایگانی سابقه‌ی احراز هویت + جدول `client_errors`

## تست‌ها
تست‌های دسترسی (RLS) با نقش واقعی کاربر، داخل تراکنشی که آخرش برگردانده می‌شود، پس به داده‌ی واقعی دست نمی‌زنند:

```bash
psql "$DB_URL" -v officer=<ایمیل یک مسئول فنی واقعی> -v mine=<نام یکی از معدن‌های اختصاص‌یافته‌اش> -f supabase/tests/rls_tech_officer.sql
psql "$DB_URL" -v officer=<همان ایمیل> -f supabase/tests/rls_user_roles.sql
```

هر دو در صورت هر شکست با خطا تمام می‌شوند (می‌شود در CI هم اجرا کرد: فقط یک secret به نام `DB_URL` لازم است). بعد از هر تغییر در سیاست‌های دسترسی یا تریگرها این دو را اجرا کنید — دقیقاً همین مدل تست بود که باگ «عکس احراز هویت به ادمین نمی‌رسد» را پیدا کرد.

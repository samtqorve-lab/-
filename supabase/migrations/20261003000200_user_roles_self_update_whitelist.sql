-- محافظت از user_roles بر پایه «فهرست سفید»: کاربر عادی فقط ستون‌های مجاز را برای خودش تغییر می‌دهد.
-- هر ستون جدیدی که در آینده اضافه شود، به‌طور پیش‌فرض برای خود کاربر بسته است (قبلاً فهرست سیاه بود و
-- ستون‌های جدید خودبه‌خود باز می‌ماندند؛ مثلاً identity_boundary_exempt).
CREATE OR REPLACE FUNCTION private.prevent_self_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  acting_email text := (auth.jwt() ->> 'email');
  in_submit boolean := coalesce(current_setting('app.identity_submit_in_progress', true), '') = '1';
  -- مشخصات و تنظیمات شخصی که کاربر همیشه می‌تواند تغییر دهد
  always_ok text[] := array[
    'full_name','phone','membership_no','national_code','license_no','contract_no','requested_mine_name',
    'preferred_messenger','messenger_chat_id','messenger_verify_code','telegram_chat_id','rubika_chat_id',
    'push_fcm_token','push_login_enabled','push_app',
    'trusted_credential_id','trusted_public_key','trusted_credential_counter'
  ];
  -- فیلدهای ثبت‌نام: فقط تا وقتی حساب هنوز «pending» است (قبل از تایید مدیر)
  pending_ok text[] := array['department','tech_officer_specialty','membership_verified'];
  k text;
BEGIN
  IF acting_email IS NOT NULL AND acting_email = OLD.email AND NOT private.is_admin_or_super(acting_email) THEN
    FOR k IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) n
      JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF k = ANY (always_ok) THEN CONTINUE; END IF;
      IF OLD.role = 'pending' AND k = ANY (pending_ok) THEN CONTINUE; END IF;
      -- تنها تغییر مجاز وضعیت احراز هویت توسط خود کاربر: «pending» از داخل تابع submit_identity_verification
      IF k = 'identity_status' AND in_submit AND NEW.identity_status = 'pending' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'تغییر نقش/معادن‌اختصاصی/وضعیت احراز هویت توسط خود کاربر مجاز نیست';
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

import { sb } from './supabase.js';

/**
 * ورود با تایید Push (اختیاری، هر ادمین خودش از تنظیمات روشن می‌کند): بعد از ورود موفق با
 * ایمیل/رمز، اگر push_login_enabled=true باشد، به‌جای دسترسی فوری، یک درخواست تایید ثبت می‌شود،
 * یک Push به دستگاه اندرویدی که قبلاً این قابلیت را در آن روشن کرده‌اید فرستاده می‌شود، و تا زمان
 * تایید/رد (یا انقضای ۲ دقیقه‌ای) روی همین صفحه منتظر می‌مانیم.
 *
 * نکته‌ی امنیتی صادقانه: چون Supabase Auth یک مرحله‌ای است (signInWithPassword بلافاصله یک session
 * معتبر می‌سازد)، این قابلیت را به‌صورت «gate کردن رابط‌کاربری تا تایید» پیاده کرده‌ایم، نه یک
 * پیش‌احراز هویت واقعی در سطح سرور. برای تهدیدهای معمول (رمز لو رفته، ورود از دستگاه ناشناس) کافی
 * است، ولی در برابر کسی که مستقیماً به توکن session دسترسی پیدا کند محافظت اضافه نمی‌کند.
 */

/** آیا این ایمیل قابلیت ورود با تایید Push را روشن کرده؟ */
export async function isPushLoginEnabled(email) {
  const { data } = await sb.from('user_roles').select('push_login_enabled').eq('email', email).maybeSingle();
  return !!data?.push_login_enabled;
}

/**
 * یک درخواست تایید می‌سازد، به Edge Function می‌گوید Push بفرستد، و روی تغییر status گوش می‌دهد.
 * @param {string} email
 * @param {(status: 'approved'|'denied'|'timeout'|'error', detail?: any) => void} onResolve
 * @returns {Promise<() => void>} تابع لغو/پاک‌سازی (برای وقتی کاربر صفحه را ترک می‌کند)
 */
export async function requestPushApproval(email, onResolve) {
  const { data: approval, error: insertErr } = await sb
    .from('login_approvals')
    .insert({ email })
    .select()
    .single();
  if (insertErr || !approval) { onResolve('error', insertErr?.message); return () => {}; }

  const { data: sessionData } = await sb.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  // به Edge Function می‌گوییم Push بفرستد (اگر FIREBASE_SERVICE_ACCOUNT_JSON تنظیم نشده باشد یا
  // این ادمین push_login_enabled نداشته باشد، پاسخ ok:false با reason مشخص برمی‌گردد)
  let notifyResult = null;
  try {
    const res = await fetch(`${sb.supabaseUrl}/functions/v1/push-login-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ approvalId: approval.id }),
    });
    notifyResult = await res.json();
  } catch (err) {
    onResolve('error', err.message);
    return () => {};
  }

  if (notifyResult && notifyResult.ok === false) {
    onResolve('error', notifyResult.reason || 'push-send-failed');
    return () => {};
  }

  let settled = false;
  const timeoutMs = new Date(approval.expires_at).getTime() - Date.now();
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    channel.unsubscribe();
    onResolve('timeout');
  }, Math.max(timeoutMs, 1000));

  const channel = sb
    .channel(`login-approval-${approval.id}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'login_approvals', filter: `id=eq.${approval.id}`,
    }, (payload) => {
      if (settled) return;
      const status = payload.new.status;
      if (status === 'pending') return;
      settled = true;
      clearTimeout(timer);
      channel.unsubscribe();
      onResolve(status);
    })
    .subscribe();

  return () => { settled = true; clearTimeout(timer); channel.unsubscribe(); };
}

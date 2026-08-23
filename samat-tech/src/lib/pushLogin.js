import { sb } from './supabase.js';

/**
 * ورود با تایید Push (اختیاری، هر کاربر خودش از تنظیمات روشن می‌کند). دقیقاً همان زیرساخت پنل
 * ادمین (جدول login_approvals و Edge Functionهای push-login-notify/push-login-fallback مشترک
 * است — چون user_roles بین این اپ و پنل ادمین مشترک است، هیچ تغییری سمت سرور لازم نبود).
 *
 * فال‌بک خودکار Push→تلگرام: چون Push (Firebase) ممکن است در ایران به‌خاطر تحریم‌ها به دستگاه
 * نرسد، اگر ۲۰ ثانیه پاسخی نیاید یا ارسال Push از همان ابتدا شکست بخورد، به‌صورت خودکار یک کد ۶
 * رقمی از طریق تلگرام (مقاوم‌تر) فرستاده می‌شود.
 *
 * نکته‌ی امنیتی صادقانه: چون Supabase Auth یک‌مرحله‌ای است، این «gate کردن رابط‌کاربری تا تایید»
 * است، نه پیش‌احراز هویت واقعی سمت سرور — برای تهدیدهای معمول (رمز لورفته) کافی است.
 */

export async function isPushLoginEnabled(email) {
  const { data } = await sb.from('user_roles').select('push_login_enabled').eq('email', email).maybeSingle();
  return !!data?.push_login_enabled;
}

async function callFn(name, body) {
  const { data: sessionData } = await sb.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  const res = await fetch(`${sb.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * @param {string} email
 * @param {(status: 'approved'|'denied'|'timeout'|'error', detail?: any) => void} onResolve
 * @param {(approvalId: string) => void} onAwaitingCode - وقتی کد تلگرام ارسال شد، صدا زده می‌شود
 * @returns {Promise<() => void>}
 */
export async function requestPushApproval(email, onResolve, onAwaitingCode) {
  const { data: approval, error: insertErr } = await sb
    .from('login_approvals')
    .insert({ email })
    .select()
    .single();
  if (insertErr || !approval) { onResolve('error', insertErr?.message); return () => {}; }

  let settled = false;
  let fallbackTried = false;
  let timer = null;
  let channel = null;

  function finish(status, detail) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (channel) channel.unsubscribe();
    onResolve(status, detail);
  }

  async function tryTelegramFallback() {
    if (fallbackTried || settled) return;
    fallbackTried = true;
    try {
      const data = await callFn('push-login-fallback', { action: 'send', approvalId: approval.id });
      if (data.ok) {
        onAwaitingCode && onAwaitingCode(approval.id);
        timer = setTimeout(() => finish('timeout'), 3 * 60 * 1000);
      } else {
        finish('error', data.reason || 'fallback-send-failed');
      }
    } catch (err) {
      finish('error', err.message);
    }
  }

  let notifyResult = null;
  try {
    notifyResult = await callFn('push-login-notify', { approvalId: approval.id });
  } catch (err) {
    await tryTelegramFallback();
    return () => finish('denied');
  }

  if (notifyResult && notifyResult.ok === false) {
    await tryTelegramFallback();
  } else {
    timer = setTimeout(tryTelegramFallback, 20000);
  }

  channel = sb
    .channel(`login-approval-${approval.id}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'login_approvals', filter: `id=eq.${approval.id}`,
    }, (payload) => {
      const status = payload.new.status;
      if (status === 'pending') return;
      finish(status);
    })
    .subscribe();

  return () => finish('denied');
}

/** کد ۶ رقمی وارد‌شده توسط کاربر را با سرور تایید می‌کند */
export async function verifyFallbackCode(approvalId, code) {
  return callFn('push-login-fallback', { action: 'verify', approvalId, code });
}

import { sb } from './supabase.js';

/**
 * ورود با تایید Push (اختیاری، هر کاربر خودش از تنظیمات روشن می‌کند). دقیقاً همان زیرساخت پنل
 * ادمین (جدول login_approvals و Edge Functionهای push-login-notify/push-login-respond مشترک است
 * — چون user_roles بین این اپ و پنل ادمین مشترک است، هیچ تغییری سمت سرور لازم نبود).
 *
 * نکته‌ی امنیتی صادقانه: چون Supabase Auth یک‌مرحله‌ای است، این «gate کردن رابط‌کاربری تا تایید»
 * است، نه پیش‌احراز هویت واقعی سمت سرور — برای تهدیدهای معمول (رمز لورفته) کافی است.
 */

export async function isPushLoginEnabled(email) {
  const { data } = await sb.from('user_roles').select('push_login_enabled').eq('email', email).maybeSingle();
  return !!data?.push_login_enabled;
}

/**
 * @param {string} email
 * @param {(status: 'approved'|'denied'|'timeout'|'error', detail?: any) => void} onResolve
 * @returns {Promise<() => void>}
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

import { sb } from './supabase.js';

/**
 * ثبت این دستگاه به‌عنوان دستگاه تاییدکننده‌ی ورود. عیناً معادل نسخه‌ی پنل ادمین — نگاه کنید به
 * samat-admin/src/lib/pushNative.js برای توضیح کامل.
 */
export async function registerForPushLogin(email) {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') {
    const req = await PushNotifications.requestPermissions();
    if (req.receive !== 'granted') throw new Error('مجوز اعلان داده نشد');
  }

  const token = await new Promise((resolve, reject) => {
    const successHandle = PushNotifications.addListener('registration', (t) => {
      successHandle.remove();
      errorHandle.remove();
      resolve(t.value);
    });
    const errorHandle = PushNotifications.addListener('registrationError', (err) => {
      successHandle.remove();
      errorHandle.remove();
      reject(new Error(err.error || 'ثبت اعلان ناموفق بود'));
    });
    PushNotifications.register();
  });

  const { error } = await sb.from('user_roles').update({ push_fcm_token: token, push_login_enabled: true, push_app: 'samat-tech' }).eq('email', email);
  if (error) throw error;

  await attachLoginApprovalHandler();
}

let handlerAttached = false;
/** فقط یک‌بار در طول عمر اپ لازم است سوار شود (هم موقع فعال‌سازی، هم هر بار اپ باز می‌شود اگر
 * قبلاً فعال شده باشد — نگاه کنید به main.js). */
export async function attachLoginApprovalHandler() {
  if (handlerAttached) return;
  handlerAttached = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { PushNotifications } = await import('@capacitor/push-notifications');

    async function respond(approvalId, decision) {
      const { data: sessionData } = await sb.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) return;
      await fetch(`${sb.supabaseUrl}/functions/v1/push-login-respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ approvalId, decision }),
      }).catch(() => {});
    }

    // دکمه‌های اکشن روی نوتیفیکیشن (نسخه‌ی قبلی این تابع) فقط وقتی کار می‌کردند که pushNotificationReceived
    // فایر شود — که طبق مستندات Capacitor فقط وقتی اپ در پیش‌زمینه/در حافظه باز است اتفاق می‌افتد.
    // چون دستگاه تاییدکننده معمولاً دقیقاً برعکس این حالت است (بسته یا پس‌زمینه، چون کاربر روی
    // دستگاه دیگری وارد می‌شود)، اندروید فقط یک اعلان ساده‌ی سیستمی (بدون دکمه) نشان می‌داد و لمس
    // آن فقط اپ را باز می‌کرد — بدون تایید/رد واقعی؛ برای همین همه‌ی درخواست‌ها در login_approvals
    // برای همیشه pending می‌ماندند. حالا هم pushNotificationReceived (پیش‌زمینه) و هم
    // pushNotificationActionPerformed (لمس اعلان وقتی اپ بسته/پس‌زمینه بوده) هندل می‌شوند و در هر
    // دو حالت یک دیالوگ تایید/رد درون‌اپی نشان داده می‌شود.
    function handleLoginApprovalData(data) {
      if (!data || data.type !== 'login-approval' || !data.approvalId) return;
      const ok = window.confirm(`🔐 درخواست ورود\nآیا شما (${data.email || ''}) در حال ورود هستید؟\n\nOK = تایید می‌کنم\nCancel = رد می‌کنم`);
      respond(data.approvalId, ok ? 'approved' : 'denied');
    }

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      handleLoginApprovalData(notification.data);
    });
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      handleLoginApprovalData(action.notification?.data);
    });
  } catch {
    handlerAttached = false;
  }
}

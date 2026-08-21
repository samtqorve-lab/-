import { sb } from './supabase.js';

/**
 * ثبت این دستگاه به‌عنوان دستگاه تاییدکننده‌ی ورود. عیناً معادل نسخه‌ی پنل ادمین — نگاه کنید به
 * samat-admin/src/lib/pushNative.js برای توضیح کامل. تا google-services.json واقعی (با package
 * name ir.novinproduct.samattech) در پروژه‌ی اندروید این اپ قرار نگیرد، PushNotifications.register()
 * با خطا مواجه می‌شود — طبیعی و منتظر است.
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
export async function attachLoginApprovalHandler() {
  if (handlerAttached) return;
  handlerAttached = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    await LocalNotifications.registerActionTypes({
      types: [{
        id: 'LOGIN_APPROVAL',
        actions: [
          { id: 'approve', title: '✅ تایید می‌کنم' },
          { id: 'deny', title: '❌ رد می‌کنم' },
        ],
      }],
    });

    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      const data = notification.data || {};
      if (data.type !== 'login-approval') return;
      await LocalNotifications.schedule({
        notifications: [{
          id: Date.now() % 2147483647,
          title: '🔐 درخواست ورود',
          body: `آیا شما (${data.email || ''}) در حال ورود هستید؟`,
          actionTypeId: 'LOGIN_APPROVAL',
          extra: { approvalId: data.approvalId },
        }],
      });
    });

    LocalNotifications.addListener('localNotificationActionPerformed', async (action) => {
      const approvalId = action.notification?.extra?.approvalId;
      if (!approvalId) return;
      const decision = action.actionId === 'approve' ? 'approved' : action.actionId === 'deny' ? 'denied' : null;
      if (!decision) return;
      const { data: sessionData } = await sb.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      await fetch(`${sb.supabaseUrl}/functions/v1/push-login-respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ approvalId, decision }),
      }).catch(() => {});
    });
  } catch {
    handlerAttached = false;
  }
}

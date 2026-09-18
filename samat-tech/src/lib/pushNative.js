import { sb } from './supabase.js';

/**
 * ثبت این دستگاه برای دریافت اعلان‌های عمومی سامانه (گزارش رد شد، ...) — بدون فعال کردن «ورود با
 * تایید Push». آن یک ویژگی جدا و اختیاریِ ۲مرحله‌ای برای ورود است (پایین‌تر: registerForPushLogin)
 * و نباید صرفِ باز کردن اپ فعال شود.
 */
export async function registerDeviceToken(email) {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') {
    const req = await PushNotifications.requestPermissions();
    if (req.receive !== 'granted') return false;
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

  const { error } = await sb.from('user_roles').update({ push_fcm_token: token, push_app: 'samat-tech' }).eq('email', email);
  if (error) throw error;
  return true;
}

/** «ورود با تایید Push» (۲مرحله‌ای، از تنظیمات فعال می‌شود) — علاوه بر ثبت توکن، پرچم را هم روشن می‌کند. */
export async function registerForPushLogin(email) {
  await registerDeviceToken(email);
  const { error } = await sb.from('user_roles').update({ push_login_enabled: true }).eq('email', email);
  if (error) throw error;
  await attachLoginApprovalHandler();
}

async function showNativeLocal(title, body, data) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') return;
    }
    await LocalNotifications.schedule({
      notifications: [{ id: Math.floor(Math.random() * 2147483647), title, body, extra: data || {} }],
    });
  } catch { /* اگر پلاگین در دسترس نبود، بی‌صدا رد می‌شود — بدتر از این نیست که اصلاً چیزی نشان داده نشود */ }
}

async function showBrowserNotification(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body });
  } catch { /* بی‌اثر */ }
}

let handlerAttached = false;
/**
 * شنونده‌ی Pushهای اعلان عمومی سامانه (گزارش رد شد، ...). فقط یک‌بار در طول عمر اپ لازم است سوار
 * شود — نگاه کنید به main.js.
 *
 * توجه: پیام‌های «تایید ورود» (type === 'login-approval') دیگر اینجا مدیریت نمی‌شوند — از این پس
 * کاملاً در سطح بومی توسط PushLoginMessagingService + LoginApprovalActionReceiver (اندروید،
 * android/app/src/main/java/.../PushLoginMessagingService.java) با دو دکمه‌ی واقعی «تایید»/«رد»
 * روی خودِ نوتیفیکیشن پاسخ داده می‌شوند — بدون باز شدن اپ. سرور هم دیگر این پیام‌ها را با فیلد
 * notification نمی‌فرستد (فقط data)، دقیقاً برای اینکه کنترلش کامل دست همان سرویس بومی بماند.
 * تغییر وضعیتِ درخواست (approved/denied) از طریق همان Realtime channel که pushLogin.js از قبل
 * روی login_approvals سوار کرده به خودکار به این صفحه می‌رسد — نیازی به شنیدن جداگانه‌ی Push در
 * جاوااسکریپت برای این مورد نیست.
 */
export async function attachLoginApprovalHandler() {
  if (handlerAttached) return;
  handlerAttached = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // pushNotificationReceived فقط در پیش‌زمینه فایر می‌شود (طبق مستندات Capacitor)، و در این
    // حالت اندروید خودش اعلان سیستمی نشان نمی‌دهد — برای رویدادهای عمومی سامانه (غیر از تایید
    // ورود، که دیگر بومی مدیریت می‌شود) این‌جا دستی با LocalNotifications همان اعلان را نشان می‌دهیم.
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      const data = notification.data || {};
      if (data.type === 'login-approval') return;
      showNativeLocal(notification.title || 'اعلان جدید', notification.body || '', data);
    });
  } catch {
    handlerAttached = false;
  }
}

let realtimeAttached = false;
function attachRealtimeNotifications(email) {
  if (realtimeAttached) return;
  realtimeAttached = true;
  sb.channel(`notif-${email}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_email=eq.${email}` }, (payload) => {
      showBrowserNotification(payload.new.title, payload.new.body);
    })
    .subscribe();
}

/**
 * نقطه‌ی ورود واحد که باید بعد از مشخص شدن ایمیل کاربر (داخل boot) صدا زده شود — main.js. روی
 * اندروید: توکن دستگاه را (اگر قبلاً ثبت نشده) ثبت می‌کند تا اعلان سامانه به این حساب برسد
 * (شنونده‌اش از قبل، در بالای main.js، سوار شده). روی وب (اگر این بیلد به‌صورت وب‌ساب‌پث باز شود،
 * که FCM ندارد): به‌جایش مستقیم روی جدول notifications عضو Realtime می‌شود و با رسیدن هر ردیف
 * جدید، اعلان مرورگر نشان می‌دهد.
 */
export async function initNotifications(email) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      await registerDeviceToken(email).catch(() => {});
    } else {
      attachRealtimeNotifications(email);
    }
  } catch { /* بی‌اثر */ }
}

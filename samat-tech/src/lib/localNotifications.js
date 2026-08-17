// اعلان‌های محلی مرورگر — صادقانه: این Push واقعی نیست (که سمت سرور، حتی وقتی اپ کاملاً بسته
// است، پیام بفرستد و به زیرساخت VAPID + یک Edge Function جدا برای ارسال نیاز دارد). این نسخه
// شرایطی که خود اپ از قبل و به‌صورت محلی محاسبه می‌کند (یادآوری ماهانه‌ی احراز هویت، انقضای
// پروانه) را — به‌جای فقط یک بنر داخل صفحه — به‌عنوان یک اعلان واقعی سطح سیستم‌عامل نشان می‌دهد؛
// یعنی وقتی اپ باز (حتی در پس‌زمینه‌ی مرورگر) است، متوجه می‌شوید، بدون این‌که لازم باشد حتماً روی
// همان تب باشید. اگر اپ کاملاً بسته باشد، مثل هر اعلان محلی دیگری، نمایش داده نمی‌شود.

const STORAGE_KEY = 'localNotifShown';

function alreadyShownToday(key) {
  try {
    const shown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const todayKey = new Date().toISOString().slice(0, 10);
    return shown[key] === todayKey;
  } catch {
    return false;
  }
}
function markShownToday(key) {
  try {
    const shown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    shown[key] = new Date().toISOString().slice(0, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shown));
  } catch { /* اگر ذخیره نشد، فقط یک بار بیشتر همان روز نمایش داده می‌شود — مشکلی نیست */ }
}

export function notificationsSupported() {
  return 'Notification' in window;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}

/** یک اعلان محلی نشان می‌دهد — حداکثر یک‌بار در روز برای هر key (تا با هر رفرش صفحه، اسپم نشود) */
export async function showLocalNotification(key, title, body) {
  if (Notification.permission !== 'granted') return;
  if (alreadyShownToday(key)) return;
  markShownToday(key);
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: key });
      return;
    }
  } catch { /* اگر از طریق service worker نشد، پایین با روش ساده‌تر امتحان می‌شود */ }
  // eslint-disable-next-line no-new
  new Notification(title, { body, tag: key });
}

/** بر اساس همان شرایطی که بنرهای داخل‌برنامه‌ای از قبل محاسبه می‌کنند، اعلان محلی مرتبط را نشان می‌دهد */
export function checkAndNotify({ monthly, license }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if (monthly) {
    showLocalNotification('monthly-identity', '⏰ یادآوری تمدید احراز هویت', `${monthly.daysLeft} روز تا سررسید تمدید ماهانه مانده — داخل محدوده معدن عکس بگیرید.`);
  }
  if (license) {
    if (license.kind === 'expired') showLocalNotification('license-expired', '⏰ پروانه اشتغال منقضی شده', 'پروانه اشتغال به کار شما منقضی شده است.');
    else if (license.kind === 'soon') showLocalNotification('license-soon', '⚠️ نزدیک شدن انقضای پروانه', `${license.daysLeft} روز تا انقضای پروانه اشتغال به کار شما مانده.`);
  }
}

// ردیابی موقعیت مکانی در پس‌زمینه‌ی واقعی (حتی وقتی اپ کامل بسته/از پردازه‌های اخیر پاک شده)، با
// استفاده از پلاگین @capacitor-community/background-geolocation. برخلاف ناظر معمولی GPS این پروژه
// (lib/geo.js — فقط تا وقتی پردازه‌ی اپ زنده است)، این پلاگین یک سرویس foreground اندروید با یک
// نوتیفیکیشن دائمی («در حال ردیابی») روشن می‌کند تا اندروید اجازه‌ی دریافت مکان در پس‌زمینه را
// بدهد — طبق مستندات خودِ گوگل، سرویس foreground نوع location یکی از دو راه رسمی دسترسی مداوم به
// موقعیت مکانی است و *نیازی به مجوز جداگانه‌ی «دسترسی همیشگی به موقعیت مکانی»
// (ACCESS_BACKGROUND_LOCATION) ندارد* — یعنی این راه، سخت‌گیری بازبینی گوگل‌پلی مخصوص آن مجوز را
// هم ندارد. نوتیفیکیشن دائمی (که اندروید برای این نوع سرویس اجباری می‌کند) هم به‌نفع شفافیت با
// کاربر است: مسئول فنی همیشه می‌بیند که ردیابی موقعیت مکانی فعال است.
//
// محدودیت‌های شناخته‌شده (به‌صراحت در مستندات خودِ پلاگین آمده):
// - بعد از ۵ دقیقه در پس‌زمینه، اندروید درخواست‌های HTTP از خودِ WebView (fetch معمولی — همان
//   چیزی که supabase-js زیرِ پوست استفاده می‌کند) را کند/محدود می‌کند. صف آفلاین موجود
//   (lib/offlineQueue.js) اینجا یک شبکه‌ی ایمنی است: اگر ارسال زنده‌ی یک رویداد در پس‌زمینه به
//   مشکل بخورد، با اولین بار که کاربر اپ را دوباره باز می‌کند (رویداد resume/online)، ارسال
//   می‌شود — ولی ممکن است اعلان فوری به ادمین (notify-relay) با تاخیر چند دقیقه‌ای برسد.
// - این پلاگین رسماً تا Capacitor v7 تست/پشتیبانی شده؛ این پروژه روی Capacitor 8 است — قبل از
//   انتشار عمومی حتماً باید روی یک گوشی واقعی تست شود (این تغییر در محیطی نوشته شده که امکان
//   build/اجرای پروژه‌ی اندروید در آن نیست، پس هرگز روی دستگاه واقعی اجرا/تایید نشده).
// - فقط اندروید در نظر گرفته شده (این اپ فقط برای اندروید منتشر می‌شود)؛ iOS پیکربندی نشده.

let watcherId = null;
let BackgroundGeolocationPlugin = null;

async function loadPlugin() {
  if (BackgroundGeolocationPlugin) return BackgroundGeolocationPlugin;
  const { registerPlugin } = await import('@capacitor/core');
  BackgroundGeolocationPlugin = registerPlugin('BackgroundGeolocation');
  return BackgroundGeolocationPlugin;
}

/**
 * @param {(coords: { latitude: number, longitude: number, accuracy: number }) => void} onCoords
 *   همان قالب coords که lib/geo.js به شنونده‌های onGpsUpdate می‌دهد — تا بتوان مستقیم به
 *   handleCoords داخلی lib/mineGeofence.js پاس داد.
 */
export async function startBackgroundGeofenceWatcher(onCoords) {
  if (watcherId !== null) return;
  let Capacitor;
  try {
    ({ Capacitor } = await import('@capacitor/core'));
  } catch {
    return;
  }
  if (!Capacitor.isNativePlatform()) return; // فقط اندروید/iOS — در وب اثری ندارد

  try {
    const plugin = await loadPlugin();
    watcherId = await plugin.addWatcher(
      {
        backgroundTitle: 'ثبت حضور در محدوده معدن',
        backgroundMessage: 'برای ثبت خودکار ورود/خروج از محدوده معدن، موقعیت مکانی در پس‌زمینه بررسی می‌شود.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 30,
      },
      (location, error) => {
        // خطای مجوز/GPS بی‌صدا رد می‌شود — ناظر پیش‌زمینه‌ی معمولی (geo.js، وقتی اپ باز است)
        // همچنان کار می‌کند؛ این فقط پوشش اضافه‌ی پس‌زمینه است، نه تنها منبع.
        if (error || !location) return;
        onCoords({ latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy });
      },
    );
  } catch {
    watcherId = null; // پلاگین نصب/sync نشده (هنوز npm install/cap sync اجرا نشده) یا خطای دیگر
  }
}

export async function stopBackgroundGeofenceWatcher() {
  if (watcherId === null) return;
  try {
    const plugin = await loadPlugin();
    await plugin.removeWatcher({ id: watcherId });
  } catch { /* بی‌اثر */ }
  watcherId = null;
}

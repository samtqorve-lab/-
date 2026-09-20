import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';

// پلاگین بومی کوچک (InstallSourcePlugin.java) که فقط نام پکیج نصب‌کننده‌ی این اپ را برمی‌گرداند
const InstallSource = registerPlugin('InstallSource');
const BAZAAR_INSTALLER_PACKAGE = 'com.farsitel.bazaar';

/**
 * بررسی نسخه‌ی جدید اپ اندروید (سایدلود — نه از طریق گوگل‌پلی).
 *
 * چون اندروید اجازه‌ی نصب خاموش (silent) یک APK را بدون Play Store نمی‌دهد، این «آپدیت خودکار»
 * یعنی: خودمان بی‌سروصدا چک می‌کنیم نسخه‌ی جدیدتری منتشر شده یا نه، و اگر بله یک بنر کوچک نشان
 * می‌دهیم که با یک لمس صفحه‌ی توضیحات آپدیت را باز می‌کند (لینک دانلود مستقیم + مایکت + گوگل‌پلی).
 *
 * نکته‌ی مهم (طبق ایمیل رد درخواست انتشار کافه‌بازار): طبق قوانین بازار، اپ‌هایی که از خودِ بازار
 * نصب شده‌اند فقط باید از طریق بازار به‌روزرسانی شوند — نمایش این بنر برای آن‌ها تخلف محسوب
 * می‌شود. پس قبل از هر چیز نصب‌کننده‌ی اپ را استعلام می‌گیریم و اگر کافه‌بازار بود، این تابع
 * همیشه null برمی‌گرداند (یعنی هیچ‌وقت بنر آپدیت نشان داده نمی‌شود) — آپدیت این کاربران را کامل
 * به مکانیزم خودِ بازار می‌سپاریم.
 *
 * منبع اطلاعات نسخه: یک فایل JSON ثابت که روی سایت پنل ادمین (novinproduct.ir) میزبانی می‌شود
 * و هر بار که این اپ در GitHub Actions build می‌شود، خودکار بازنویسی می‌شود.
 *
 * نکته‌ی دیگر (رفع‌شده): خودِ فایل APK هم قبلاً روی یک مسیر ثابت در Supabase Storage با
 * x-upsert بازنویسی می‌شد؛ این باعث می‌شد گاهی CDN ذخیره‌سازی بایت‌های نسخه‌ی قبلی را سرو کند
 * حتی با وجود شماره‌ی نسخه‌ی جدید در همین manifest — یعنی این‌جا (سمت مقایسه‌ی عدد) کاملاً درست
 * کار می‌کرد، ولی فایل واقعی دانلودشده گاهی قدیمی بود. الان هر بیلد مسیر مجزای خودش را در
 * Storage دارد (هرگز بازنویسی نمی‌شود)، پس این مشکل دیگر رخ نمی‌دهد.
 */
const MANIFEST_URL = 'https://novinproduct.ir/updates/tech.json';
export const UPDATE_PAGE_URL = 'https://novinproduct.ir/update.html';

// در زمان build با Vite (vite.config.js → define) از شماره‌ی اجرای GitHub Actions پر می‌شود؛
// در حالت dev محلی همیشه ۰ است، یعنی هیچ‌وقت پیشنهاد آپدیت نمی‌دهد (طبیعی، چون build رسمی نیست).
// توجه: این عدد داخل باندل جاوااسکریپت «پخته» شده؛ اگر باندل قدیمی (مثلاً از کش service worker)
// اجرا شود، عدد قدیمی می‌ماند — برای همین، شماره‌ی نسخه‌ی واقعیِ نصب‌شده را از خود اندروید هم
// می‌خوانیم (getInstalledBuild پایین).
export const CURRENT_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 0;

/**
 * شماره‌ی build واقعیِ نصب‌شده.
 *
 * هر دو منبع به‌تنهایی ممکن است غلط باشند: عدد پخته‌شده در باندل می‌تواند قدیمی باشد (کش service
 * worker داخل WebView بعد از نصب APK جدید، یا داده‌ی برگردانده‌شده از بکاپ)، و versionCode بومی در
 * APK دیباگ (که CI بدون ANDROID_VERSION_CODE می‌سازد) همیشه ۱ است. بزرگ‌ترین مقدار از بین این دو
 * در هر دو حالت درست است.
 */
export async function getInstalledBuild() {
  let native = 0;
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo();
      native = parseInt(info && info.build, 10) || 0;
    } catch {
      // اگر استعلام بومی شکست خورد، به همان عدد داخل باندل برمی‌گردیم
    }
  }
  return Math.max(CURRENT_BUILD, native);
}

/**
 * داخل اپ اندروید، assetهای وب مستقیم از داخل خودِ APK لود می‌شوند و هیچ نیازی به service worker
 * نیست — ولی نسخه‌های قبلی این اپ یک service worker (vite-plugin-pwa) ثبت کرده بودند که باندل
 * قدیمی را در کش نگه می‌داشت و بعد از نصب APK جدید هم همان را سرو می‌کرد. اینجا ثبت‌های باقی‌مانده
 * و کش‌های workbox پاک می‌شوند (فقط داخل اپ بومی؛ روی PWA وب دست نمی‌زنیم).
 */
export async function purgeStaleWebCachesInNative() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => /workbox|precache/i.test(k)).map((k) => caches.delete(k)));
    }
  } catch {
    // بی‌سروصدا — پاکسازی کش نباید هیچ‌وقت جلوی بالا آمدن اپ را بگیرد
  }
}

export async function checkForAppUpdate() {
  if (!Capacitor.isNativePlatform()) return null; // فقط برای APK نصب‌شده معنا دارد، نه PWA وب
  try {
    const { installer } = await InstallSource.getInstaller();
    if (installer === BAZAAR_INSTALLER_PACKAGE) return null;
  } catch {
    // اگر استعلام نصب‌کننده به هر دلیلی شکست خورد (مثلاً پلاگین هنوز در APK نصب‌شده‌ی کاربر
    // موجود نیست چون از نسخه‌ای قدیمی‌تر از این تغییر می‌آید)، محتاطانه ادامه می‌دهیم — بهتر
    // است یک‌بار بنر آپدیت اضافی ببینند تا این‌که کاربران غیر-بازاری هیچ‌وقت آپدیت نبینند.
  }
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const manifest = await res.json();
    const installed = await getInstalledBuild();
    if (!manifest?.versionCode || manifest.versionCode <= installed) return null;
    return { ...manifest, installedBuild: installed }; // { versionCode, versionName, url, notes, installedBuild }
  } catch {
    return null; // بی‌اینترنتی یا خطای شبکه — بی‌سروصدا نادیده گرفته می‌شود
  }
}

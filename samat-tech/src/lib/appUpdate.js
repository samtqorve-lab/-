import { Capacitor, registerPlugin } from '@capacitor/core';

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
 */
const MANIFEST_URL = 'https://novinproduct.ir/updates/tech.json';
export const UPDATE_PAGE_URL = 'https://novinproduct.ir/update.html';

// در زمان build با Vite (vite.config.js → define) از شماره‌ی اجرای GitHub Actions پر می‌شود؛
// در حالت dev محلی همیشه ۰ است، یعنی هیچ‌وقت پیشنهاد آپدیت نمی‌دهد (طبیعی، چون build رسمی نیست).
export const CURRENT_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 0;

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
    if (!manifest?.versionCode || manifest.versionCode <= CURRENT_BUILD) return null;
    return manifest; // { versionCode, versionName, url, notes }
  } catch {
    return null; // بی‌اینترنتی یا خطای شبکه — بی‌سروصدا نادیده گرفته می‌شود
  }
}

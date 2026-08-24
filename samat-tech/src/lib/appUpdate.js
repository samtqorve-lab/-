import { Capacitor } from '@capacitor/core';

/**
 * بررسی نسخه‌ی جدید اپ اندروید (سایدلود — نه از طریق گوگل‌پلی).
 *
 * چون اندروید اجازه‌ی نصب خاموش (silent) یک APK را بدون Play Store نمی‌دهد، این «آپدیت خودکار»
 * یعنی: خودمان بی‌سروصدا چک می‌کنیم نسخه‌ی جدیدتری منتشر شده یا نه، و اگر بله یک بنر کوچک نشان
 * می‌دهیم که با یک لمس مرورگر سیستم را برای دانلود/نصب باز می‌کند — کاربر فقط باید تایید «نصب»
 * را بزند (این تاییدیه‌ی امنیتی اندروید است و قابل دورزدن نیست).
 *
 * منبع اطلاعات نسخه: یک فایل JSON ثابت که وردی سایت پنل ادمین (novinproduct.ir) میزبانی می‌شود
 * و هر بار که این اپ در GitHub Actions build می‌شود، خودکار بازنویسی می‌شود.
 */
const MANIFEST_URL = 'https://novinproduct.ir/updates/tech.json';

// در زمان build با Vite (vite.config.js → define) از شماره‌ی اجرای GitHub Actions پر می‌شود؛
// در حالت dev محلی همیشه ۰ است، یعنی هیچ‌وقت پیشنهاد آپدیت نمی‌دهد (طبیعی، چون build رسمی نیست).
const CURRENT_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 0;

export async function checkForAppUpdate() {
  if (!Capacitor.isNativePlatform()) return null; // فقط برای APK نصب‌شده معنا دارد، نه PWA وب
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

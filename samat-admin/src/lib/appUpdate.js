import { Capacitor } from '@capacitor/core';

/**
 * بررسی نسخه‌ی جدید اپ اندروید پنل ادمین (سایدلود — نه از طریق گوگل‌پلی).
 *
 * چون اندروید اجازه‌ی نصب خاموش (silent) یک APK را بدون Play Store نمی‌دهد، این «آپدیت خودکار»
 * یعنی: خودمان بی‌سروصدا چک می‌کنیم نسخه‌ی جدیدتری منتشر شده یا نه، و اگر بله یک بنر کوچک نشان
 * می‌دهیم که با یک لمس صفحه‌ی توضیحات آپدیت را باز می‌کند (لینک دانلود مستقیم + مایکت + گوگل‌پلی).
 * نسخه‌ی وب (novinproduct.ir در مرورگر) نیازی به این چک ندارد — هر بار خودکار تازه‌ترین کد را می‌گیرد.
 */
const MANIFEST_URL = 'https://novinproduct.ir/updates/admin.json';
export const UPDATE_PAGE_URL = 'https://novinproduct.ir/update.html';

// در زمان build با Vite (vite.config.js → define) از شماره‌ی اجرای GitHub Actions پر می‌شود؛
// در حالت dev محلی همیشه ۰ است، یعنی هیچ‌وقت پیشنهاد آپدیت نمی‌دهد.
export const CURRENT_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 0;

export async function checkForAppUpdate() {
  if (!Capacitor.isNativePlatform()) return null; // فقط برای APK نصب‌شده معنا دارد، نه وب
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

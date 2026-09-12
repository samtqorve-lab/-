// ورود سریع‌تر با اثر انگشت/Face ID — این یک قفل محلیِ روی همان نشست ذخیره‌شده‌ی Supabase است
// (نه یک مکانیزم امنیتی سمت سرور جدا): وقتی روی این گوشی فعال شود، دفعات بعد قبل از نمایش
// داشبورد، سیستم‌عامل اثر انگشت/Face ID کاربر را می‌خواهد؛ در صورت تایید، از همان نشست موجود
// استفاده می‌شود. اگر گوشی/محیط این قابلیت را نداشته باشد، اصلاً نمایش داده نمی‌شود.
//
// نکته‌ی مهم: طبق مستندات رسمی اندروید (passkeys.dev)، WebAuthn/navigator.credentials داخل
// WebView جاسازی‌شده‌ی اپ‌های Capacitor پشتیبانی نمی‌شود — به همین دلیل به‌جای WebAuthn، از یک
// پلاگین بومی استفاده می‌شود که مستقیم BiometricPrompt واقعی اندروید/iOS را صدا می‌زند.
//
// تعویض شد از @capgo/capacitor-native-biometric به @aparajita/capacitor-biometric-auth: پلاگین
// قبلی برای هر بار تایید هویت یک کلید رمزنگاری در Keystore گوشی می‌ساخت (چون اصلش برای ذخیره‌ی
// امن نام‌کاربری/رمز طراحی شده بود) — روی گوشی‌های شیائومی/اوپو همین ساخت کلید با خطای تراشه‌ی
// امنیتی (Keymaster/TEE) گیر می‌کرد و برای همیشه معلق می‌ماند (حتی timeout جاوااسکریپت هم کمکی
// نمی‌کرد، چون در آن حالت WebView مکث می‌شود و تایمرهایش هم متوقف می‌شوند). چون این‌جا فقط یک
// قفل محلی ساده لازم داریم (نه ذخیره‌ی رمزنگاری‌شده)، پلاگین جدید هیچ کلیدی در Keystore نمی‌سازد
// و فقط از BiometricPrompt.authenticate() استاندارد استفاده می‌کند.

import { Capacitor } from '@capacitor/core';

async function getPlugin() {
  if (!Capacitor.isNativePlatform()) return null; // روی وب/PWA این پلاگین اصلاً کار نمی‌کند
  const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
  return BiometricAuth;
}

// روی بعضی گوشی‌ها پل ارتباطی بین جاوااسکریپت و دیالوگ نیتیو اثر انگشت می‌تواند گیر کند. این
// timeout برای همین حالت‌های نادر باقی می‌ماند، هرچند با پلاگین جدید علت اصلیِ قبلی (ساخت کلید
// در Keystore) دیگر وجود ندارد.
function withTimeout(promise, ms, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function bioSupported() {
  return Capacitor.isNativePlatform();
}

export async function biometricHardwareAvailable() {
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    const result = await withTimeout(plugin.checkBiometry(), 6000, 'بررسی سخت‌افزار اثر انگشت پاسخ نداد (timeout)');
    return !!result.isAvailable;
  } catch {
    return false;
  }
}

/**
 * بعد از یک ورود موفق با رمز عبور صدا زده می‌شود — اگر گوشی سنسور اثر انگشت/Face ID فعال داشته
 * باشد و قبلاً برای این ایمیل فعال نشده باشد، خودش یک‌بار پرامپت تایید هویت را نشان می‌دهد و در
 * صورت تایید، آن را فعال می‌کند؛ دیگر نیازی نیست کاربر برای فعال‌سازی به تنظیمات برود.
 * چون این یک تلاش پس‌زمینه‌ای/راحتی است، هر خطا یا لغو کاربر بی‌صدا نادیده گرفته می‌شود — نباید
 * روند ورود را متوقف کند یا خطا نشان دهد.
 * @returns {Promise<boolean>} true فقط اگر همین‌جا با موفقیت فعال شد
 */
export async function autoEnableBiometricAfterLogin(email) {
  if (hasBiometricCred(email)) return false;
  try {
    if (!(await biometricHardwareAvailable())) return false;
    await enableBiometric(email);
    return true;
  } catch {
    return false;
  }
}

function storageKey(email) {
  return `bio_enabled_${btoa(unescape(encodeURIComponent(email.toLowerCase())))}`;
}

export function hasBiometricCred(email) {
  try {
    return localStorage.getItem(storageKey(email)) === '1';
  } catch {
    return false;
  }
}
export function removeBiometricCred(email) {
  try {
    localStorage.removeItem(storageKey(email));
  } catch {
    // نادیده گرفتن خطا عمدی است
  }
}

/** بعد از یک تاییدیه‌ی موفق اثر انگشت/Face ID، این گوشی را برای این ایمیل «فعال» علامت می‌زند */
export async function enableBiometric(email) {
  const plugin = await getPlugin();
  if (!plugin || !(await biometricHardwareAvailable())) {
    throw new Error('روی این دستگاه سنسور اثر انگشت/Face ID فعال یافت نشد');
  }
  await withTimeout(
    plugin.authenticate({
      reason: 'برای فعال‌سازی ورود سریع با اثر انگشت/Face ID',
      androidTitle: 'تایید هویت',
      androidSubtitle: 'سامانه سامت',
      allowDeviceCredential: true,
    }),
    15000,
    'دیالوگ اثر انگشت پاسخ نداد — لطفاً دوباره امتحان کنید',
  );
  localStorage.setItem(storageKey(email), '1');
}

/** پیش از نمایش داشبورد صدا زده می‌شود؛ اگر برای این ایمیل فعال نشده، true برمی‌گرداند (نیازی به قفل نیست) */
export async function verifyBiometricGate(email) {
  if (!hasBiometricCred(email)) return true;
  const plugin = await getPlugin();
  if (!plugin) return true; // پلتفرم عوض شده (مثلاً نسخه‌ی وب) — به رمز عادی برنگردیم، فقط رد شویم
  try {
    await withTimeout(
      plugin.authenticate({
        reason: 'برای ورود به سامت',
        androidTitle: 'تایید هویت',
        androidSubtitle: 'اثر انگشت یا Face ID خود را نشان دهید',
        allowDeviceCredential: true,
      }),
      15000,
      'دیالوگ اثر انگشت پاسخ نداد',
    );
    return true;
  } catch {
    return false;
  }
}

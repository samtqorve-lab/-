// ورود سریع‌تر با اثر انگشت/Face ID — این یک قفل محلیِ روی همان نشست ذخیره‌شده‌ی Supabase است
// (نه یک مکانیزم امنیتی سمت سرور جدا): وقتی روی این گوشی فعال شود، دفعات بعد قبل از نمایش
// داشبورد، سیستم‌عامل اثر انگشت/Face ID کاربر را می‌خواهد؛ در صورت تایید، از همان نشست موجود
// استفاده می‌شود. اگر گوشی/محیط این قابلیت را نداشته باشد، اصلاً نمایش داده نمی‌شود.
//
// نکته‌ی مهم: طبق مستندات رسمی اندروید (passkeys.dev)، WebAuthn/navigator.credentials داخل
// WebView جاسازی‌شده‌ی اپ‌های Capacitor پشتیبانی نمی‌شود — به همین دلیل نسخه‌ی قبلی این فایل
// (که مستقیم از navigator.credentials.create/get استفاده می‌کرد) روی هیچ گوشی‌ای واقعاً کار
// نمی‌کرد. این نسخه به‌جای WebAuthn، از پلاگین بومی @capgo/capacitor-native-biometric استفاده
// می‌کند که مستقیم BiometricPrompt واقعی اندروید/iOS را صدا می‌زند — چون این‌جا فقط یک قفل محلی
// لازم داریم (نه گواهی رمزنگاری‌شده‌ی سمت سرور)، نیازی به پیچیدگی WebAuthn هم نبود.

import { Capacitor } from '@capacitor/core';

async function getPlugin() {
  if (!Capacitor.isNativePlatform()) return null; // روی وب/PWA این پلاگین اصلاً کار نمی‌کند
  const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
  return NativeBiometric;
}

// روی بعضی گوشی‌ها (مخصوصاً بعضی نسخه‌های MIUI شیائومی که BiometricPrompt استاندارد اندروید را
// با UI اختصاصی خودشان جایگزین می‌کنند) پل ارتباطی بین جاوااسکریپت و دیالوگ نیتیو اثر انگشت
// می‌تواند برای همیشه گیر کند — نه موفق می‌شود، نه خطا می‌دهد، فقط ساکت می‌ماند. بدون این
// timeout، کاربر برای همیشه با دکمه‌ای مواجه می‌شود که «هیچ واکنشی نشان نمی‌دهد» و هیچ سرنخی هم
// از دلیلش نمی‌بیند.
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
    const result = await withTimeout(plugin.isAvailable({ useFallback: false }), 6000, 'بررسی سخت‌افزار اثر انگشت پاسخ نداد (timeout)');
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
    plugin.verifyIdentity({
      reason: 'برای فعال‌سازی ورود سریع با اثر انگشت/Face ID',
      title: 'تایید هویت',
      subtitle: 'سامانه سامت',
    }),
    15000,
    'دیالوگ اثر انگشت پاسخ نداد (احتمالاً به‌خاطر تنظیمات این گوشی) — لطفاً دوباره امتحان کنید',
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
      plugin.verifyIdentity({
        reason: 'برای ورود به سامت',
        title: 'تایید هویت',
        subtitle: 'اثر انگشت یا Face ID خود را نشان دهید',
      }),
      15000,
      'دیالوگ اثر انگشت پاسخ نداد',
    );
    return true;
  } catch {
    return false;
  }
}

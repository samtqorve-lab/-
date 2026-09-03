// ورود سریع‌تر با اثر انگشت/Face ID — این یک قفل محلیِ روی همان نشست ذخیره‌شده‌ی Supabase است
// (نه یک مکانیزم امنیتی سمت سرور جدا): وقتی روی این گوشی فعال شود، دفعات بعد قبل از نمایش
// پنل، سیستم‌عامل اثر انگشت/Face ID کاربر را می‌خواهد؛ در صورت تایید، از همان نشست موجود
// استفاده می‌شود. اگر گوشی/محیط این قابلیت را نداشته باشد، اصلاً نمایش داده نمی‌شود.
//
// طبق مستندات رسمی اندروید (passkeys.dev)، WebAuthn/navigator.credentials داخل WebView
// جاسازی‌شده‌ی اپ‌های Capacitor پشتیبانی نمی‌شود — به همین دلیل به‌جای WebAuthn، از پلاگین بومی
// @capgo/capacitor-native-biometric استفاده می‌شود که مستقیم BiometricPrompt واقعی
// اندروید/iOS را صدا می‌زند — چون این‌جا فقط یک قفل محلی لازم داریم، نه گواهی رمزنگاری‌شده‌ی
// سمت سرور، نیازی به پیچیدگی WebAuthn نبود (این فایل عیناً هم‌ساختار با نسخه‌ی اپ مسئول فنی است).

import { Capacitor } from '@capacitor/core';

async function getPlugin() {
  if (!Capacitor.isNativePlatform()) return null; // روی وب/PWA این پلاگین اصلاً کار نمی‌کند
  const { NativeBiometric } = await import('@capgo/capacitor-native-biometric');
  return NativeBiometric;
}

export function bioSupported() {
  return Capacitor.isNativePlatform();
}

export async function biometricHardwareAvailable() {
  const plugin = await getPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.isAvailable({ useFallback: false });
    return !!result.isAvailable;
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
  await plugin.verifyIdentity({
    reason: 'برای فعال‌سازی ورود سریع با اثر انگشت/Face ID',
    title: 'تایید هویت',
    subtitle: 'پنل ادمین سامات',
  });
  localStorage.setItem(storageKey(email), '1');
}

/** پیش از نمایش پنل صدا زده می‌شود؛ اگر برای این ایمیل فعال نشده، true برمی‌گرداند (نیازی به قفل نیست) */
export async function verifyBiometricGate(email) {
  if (!hasBiometricCred(email)) return true;
  const plugin = await getPlugin();
  if (!plugin) return true; // پلتفرم عوض شده (مثلاً نسخه‌ی وب) — به رمز عادی برنگردیم، فقط رد شویم
  try {
    await plugin.verifyIdentity({
      reason: 'برای ورود به پنل ادمین سامات',
      title: 'تایید هویت',
      subtitle: 'اثر انگشت یا Face ID خود را نشان دهید',
    });
    return true;
  } catch {
    return false;
  }
}

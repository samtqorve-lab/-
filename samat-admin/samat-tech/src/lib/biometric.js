// ورود سریع‌تر با اثر انگشت/Face ID — این یک قفل محلیِ روی همان نشست ذخیره‌شده‌ی Supabase است
// (نه یک مکانیزم امنیتی سمت سرور جدا): وقتی روی این گوشی فعال شود، دفعات بعد قبل از نمایش
// داشبورد، مرورگر اثر انگشت/Face ID کاربر را می‌خواهد؛ در صورت تایید، از همان نشست موجود
// استفاده می‌شود. اگر مرورگر/گوشی این قابلیت را نداشته باشد، اصلاً نمایش داده نمی‌شود و
// ورود همیشه با ایمیل/رمز عادی کار می‌کند.

export function bioSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

export async function biometricHardwareAvailable() {
  if (!bioSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function b64encode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}
function storageKey(email) {
  return `bio_cred_${btoa(unescape(encodeURIComponent(email.toLowerCase())))}`;
}

export function getBiometricCred(email) {
  try {
    const raw = localStorage.getItem(storageKey(email));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function hasBiometricCred(email) {
  return !!getBiometricCred(email);
}
function setBiometricCred(email, credIdB64) {
  localStorage.setItem(storageKey(email), JSON.stringify({ credId: credIdB64 }));
}
export function removeBiometricCred(email) {
  localStorage.removeItem(storageKey(email));
}

/** یک اعتبارنامه‌ی WebAuthn جدید روی همین دستگاه ثبت می‌کند و به این ایمیل گره می‌زند */
export async function enableBiometric(email) {
  if (!(await biometricHardwareAvailable())) throw new Error('روی این دستگاه سنسور اثر انگشت/Face ID فعال یافت نشد');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'سامات — مسئول فنی/ایمنی', id: window.location.hostname },
      user: { id: userId, name: email, displayName: email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('ثبت اثر انگشت لغو شد');
  setBiometricCred(email, b64encode(cred.rawId));
}

/** پیش از نمایش داشبورد صدا زده می‌شود؛ اگر اعتبارنامه‌ای برای این ایمیل ثبت نشده، true برمی‌گرداند (نیازی به قفل نیست) */
export async function verifyBiometricGate(email) {
  const cred = getBiometricCred(email);
  if (!cred) return true;
  if (!bioSupported()) return true; // مرورگر عوض شده/پشتیبانی نمی‌کند — به رمز عادی برنگردیم، فقط رد شویم
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: b64decode(cred.credId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return !!assertion;
}

import { sb } from './supabase.js';

/** @typedef {{ email: string, role: string, full_name?: string, department?: string, personnel_code?: string }} UserRoleRow */

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data?.session ?? null;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * ورود با کد پرسنلی: ابتدا ایمیل نظیر کد پرسنلی را (از طریق تابع امن سمت سرور) پیدا می‌کند،
 * سپس با همان ایمیل + رمز عبور وارد می‌شود. جدول user_roles مستقیماً برای کاربر ناشناس
 * قابل خواندن نیست؛ این تابع (RPC) فقط همان یک ایمیل را برمی‌گرداند.
 */
export async function signInWithPersonnelCode(personnelCode, password) {
  const email = await emailForPersonnelCode(personnelCode);
  if (!email) {
    const err = new Error('کد پرسنلی یافت نشد');
    err.codeNotFound = true;
    throw err;
  }
  return signIn(email, password);
}

export async function emailForPersonnelCode(personnelCode) {
  const code = (personnelCode || '').trim();
  if (!code) return null;
  const { data, error } = await sb.rpc('get_email_by_personnel_code', { p_code: code });
  if (error) throw error;
  return data || null;
}

/** برای بررسی در فرم ثبت‌نام که کد پرسنلی قبلاً توسط کاربر دیگری گرفته نشده باشد */
export async function isPersonnelCodeTaken(personnelCode) {
  return !!(await emailForPersonnelCode(personnelCode));
}

export async function signOut() {
  await sb.auth.signOut();
}

/** آدرس بازگشت بعد از ورود با گوگل: همان صفحه‌ی فعلی بدون کوئری/هش قبلی (چه در وب، چه در
 *  پنجره‌ی محلی الکترون روی ویندوز که همیشه http://127.0.0.1:PORT است). */
function currentUrlNoParams() {
  return window.location.origin + window.location.pathname;
}

// اسکیم اختصاصی اپ اندروید ادمین (باید دقیقاً با appId در capacitor.config.json و
// intent-filter داخل AndroidManifest.xml یکی باشد).
const NATIVE_REDIRECT = 'ir.novinproduct.samatadmin://auth-callback';

/**
 * ورود سریع با گوگل.
 * - وب و دسکتاپ (اپ الکترون ویندوز، که فقط همین build وب را در یک پنجره نشان می‌دهد): همین
 *   پنجره به صفحه‌ی ورود گوگل ریدایرکت می‌شود و بعد از تایید، دوباره به همین آدرس برمی‌گردد.
 * - اندروید (Capacitor): گوگل اجازه‌ی ورود از داخل یک WebView جاسازی‌شده را نمی‌دهد، پس باید در
 *   مرورگر سیستم (Custom Tabs) باز شود؛ بازگشت به اپ از طریق یک custom URL scheme انجام می‌شود.
 */
export async function signInWithGoogle() {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) return signInWithGoogleNative();

  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: currentUrlNoParams() },
  });
  if (error) throw error;
  // در حالت وب/دسکتاپ، همین پنجره به گوگل ریدایرکت می‌شود — بعد از این خط کدی اجرا نمی‌شود.
}

async function signInWithGoogleNative() {
  const { Browser } = await import('@capacitor/browser');
  const { App } = await import('@capacitor/app');

  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;

  return new Promise((resolve, reject) => {
    let settled = false;
    let urlSub = null;
    let closeSub = null;
    const cleanup = () => { if (urlSub) urlSub.remove(); if (closeSub) closeSub.remove(); };
    const succeed = async (sessionData) => {
      if (settled) return;
      settled = true;
      cleanup();
      await Browser.close().catch(() => {});
      resolve(sessionData);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(NATIVE_REDIRECT)) return;
      try {
        const { data: sessionData, error: exErr } = await sb.auth.exchangeCodeForSession(url);
        if (exErr) throw exErr;
        succeed(sessionData);
      } catch (e) {
        fail(e);
      }
    }).then((s) => { urlSub = s; });

    // کاربر مرورگر را بدون تکمیل ورود بست — نباید برای همیشه در حال «بارگذاری» بماند
    Browser.addListener('browserFinished', () => {
      fail(Object.assign(new Error('ورود لغو شد'), { userCancelled: true }));
    }).then((s) => { closeSub = s; });

    Browser.open({ url: data.url });
  });
}

/**
 * درخواست ثبت‌نام برای دسترسی به پنل ادمین. نقش نهایی (ادمین/بازرس/مشاهده‌گر) و بخش سازمانی
 * (صنعت‌و‌معدن/اصناف) را سوپرادمین موقع تایید مشخص می‌کند. ایمیل واقعی و تایید آن (کد ۶ رقمی)
 * برای ثبت‌نام همچنان الزامی است — کد پرسنلی فقط برای ورود روزمره استفاده می‌شود.
 */
export async function signUp({
  email, password, full_name, phone, personnel_code,
}) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name, phone, personnel_code } },
  });
  if (error) throw error;
  if (!data.session) return { needsEmailConfirm: true };
  await ensureMyRoleRow(data.user);
  await sb.auth.signOut();
  return { needsEmailConfirm: false };
}

export async function confirmSignupCode(email, code) {
  const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: 'signup' });
  if (error) throw new Error('کد نادرست یا منقضی‌شده است — دوباره تلاش کنید یا کد جدید بگیرید');
  const { data: { user } } = await sb.auth.getUser();
  if (user) await ensureMyRoleRow(user);
  await sb.auth.signOut();
}

export async function resendSignupCode(email) {
  const { error } = await sb.auth.resend({ type: 'signup', email });
  if (error) throw error;
}

/** ردیف user_roles با نقش pending را (اگر قبلاً نبوده) می‌سازد — هم برای ثبت‌نام با رمز، هم برای
 *  اولین ورود با گوگل (که signUp جداگانه‌ای ندارد) صدا زده می‌شود. */
export async function ensureMyRoleRow(user) {
  const email = (user.email || '').toLowerCase();
  if (!email) return;
  const meta = user.user_metadata || {};
  try {
    await sb.from('user_roles').upsert(
      [{
        email,
        role: 'pending',
        full_name: meta.full_name || meta.name || email,
        phone: meta.phone || '',
        personnel_code: meta.personnel_code || null,
      }],
      { onConflict: 'email', ignoreDuplicates: true },
    );
  } catch {
    // خطای این مرحله نباید مانع کامل‌شدن ثبت‌نام/ورود کاربر شود
    // (مثلاً کد پرسنلی تکراری بود — این حالت باید قبل از signUp با isPersonnelCodeTaken گرفته شود)
  }
}

/** نقش/دپارتمان کاربر لاگین‌شده را از جدول user_roles می‌گیرد */
export async function fetchMyRole(email) {
  const { data, error } = await sb.from('user_roles').select('*').eq('email', email).single();
  if (error) throw error;
  return /** @type {UserRoleRow} */ (data);
}

export function isStaffRole(role) {
  return ['superadmin', 'admin', 'inspector', 'viewer'].includes(role);
}

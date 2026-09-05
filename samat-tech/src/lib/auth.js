import { sb } from './supabase.js';
import { toEnDigits } from './utils.js';

export function deptForSpecialty(spec) {
  return spec === 'اکتشاف' ? 'اکتشاف' : (spec === 'فرآوری' ? 'فرآوری' : 'معدن');
}

/** ورود می‌تواند یا با ایمیل باشد یا شماره عضویت نظام مهندسی (که سرور از طریق RPC ترجمه می‌کند) */
export async function resolveLoginIdentifier(identifier) {
  if (identifier.includes('@')) return identifier;
  const { data } = await sb.rpc('resolve_login_email', { identifier });
  return data || null;
}

export async function signIn(identifier, password) {
  const cleanId = toEnDigits(identifier.trim());
  const email = await resolveLoginIdentifier(cleanId);
  if (!email) throw new Error('ایمیل یا رمز اشتباه است');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error('ایمیل یا رمز اشتباه است');
  return email;
}

export async function signOut() {
  await sb.auth.signOut();
}

/** آدرس بازگشت بعد از ورود با گوگل: همان صفحه‌ی فعلی بدون کوئری/هش قبلی (کار می‌کند چه در
 *  ریشه‌ی سایت باشد چه در novinproduct.ir/tech-officer/). */
function currentUrlNoParams() {
  return window.location.origin + window.location.pathname;
}

// اسکیم اختصاصی اپ اندروید مسئول فنی (باید دقیقاً با appId در capacitor.config.ts و
// intent-filter داخل AndroidManifest.xml یکی باشد).
const NATIVE_REDIRECT = 'ir.novinproduct.samattech://auth-callback';

/**
 * ورود سریع با گوگل.
 * - وب (PWA): همین پنجره به صفحه‌ی ورود گوگل ریدایرکت می‌شود و بعد از تایید، دوباره به همین
 *   آدرس برمی‌گردد.
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
  // در حالت وب، همین پنجره به گوگل ریدایرکت می‌شود — بعد از این خط کدی اجرا نمی‌شود.
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
 * ثبت‌نام مسئول فنی/ایمنی/بهداشت. اگر تایید ایمیل فعال باشد، یک کد ۶ رقمی ارسال می‌شود که باید
 * با confirmSignupCode تایید شود — این با needsEmailConfirm مشخص می‌کنیم.
 */
export async function signUp(fields) {
  const { email, password, ...meta } = fields;
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: meta },
  });
  if (error) throw error;
  if (!data.session) {
    return { needsEmailConfirm: true };
  }
  await ensureMyRoleRow(data.user);
  await sb.auth.signOut();
  return { needsEmailConfirm: false };
}

export async function confirmSignupCode(email, code) {
  const { error } = await sb.auth.verifyOtp({ email, token: toEnDigits(code.trim()), type: 'signup' });
  if (error) throw new Error('کد نادرست یا منقضی‌شده است — دوباره تلاش کنید یا کد جدید بگیرید');
  const { data: { user } } = await sb.auth.getUser();
  if (user) await ensureMyRoleRow(user);
  await sb.auth.signOut();
}

export async function resendSignupCode(email) {
  const { error } = await sb.auth.resend({ type: 'signup', email });
  if (error) throw error;
}

/** ردیف user_roles با نقش pending را (اگر قبلاً نبوده) می‌سازد و به ادمین‌ها اطلاع می‌دهد — هم
 *  برای ثبت‌نام با رمز، هم برای اولین ورود با گوگل (که signUp جداگانه‌ای ندارد) صدا زده می‌شود. */
export async function ensureMyRoleRow(user) {
  const email = (user.email || '').toLowerCase();
  if (!email) return;
  const meta = user.user_metadata || {};
  try {
    const { data: inserted } = await sb.from('user_roles').upsert(
      [{
        email, role: 'pending', department: deptForSpecialty(meta.tech_officer_specialty),
        full_name: meta.full_name || meta.name || email, phone: meta.phone || '',
        national_code: meta.national_code || null, membership_no: meta.membership_no || null,
        license_no: meta.license_no || null, requested_mine_name: meta.requested_mine_name || null,
        contract_no: meta.contract_no || null, tech_officer_specialty: meta.tech_officer_specialty || null,
        preferred_messenger: meta.preferred_messenger || null, messenger_chat_id: meta.messenger_chat_id || null,
      }],
      { onConflict: 'email', ignoreDuplicates: true },
    ).select();
    if (inserted && inserted.length) await notifyNewRegistration({ fullName: meta.full_name || '', email, phone: meta.phone || '', requestedMineName: meta.requested_mine_name || '', membershipNo: meta.membership_no || '', licenseNo: meta.license_no || '' });
  } catch {
    // خطای این مرحله نباید مانع کامل‌شدن ثبت‌نام/ورود کاربر شود
  }
}

async function notifyNewRegistration(payloadFields) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'newRegistration', ...payloadFields }),
    });
  } catch {
    // اطلاع‌رسانی best-effort است؛ شکستش نباید ثبت‌نام را متوقف کند
  }
}

export async function sendPasswordResetCode(identifier) {
  const cleanId = toEnDigits(identifier.trim());
  const email = await resolveLoginIdentifier(cleanId);
  if (!email) throw new Error('حسابی با این ایمیل/شماره عضویت پیدا نشد');
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) throw error;
  return email;
}

export async function resetPasswordWithCode(email, code, newPassword, recoverySessionActive) {
  if (!recoverySessionActive) {
    const { error } = await sb.auth.verifyOtp({ email, token: toEnDigits(code.trim()), type: 'recovery' });
    if (error) throw new Error('کد نادرست یا منقضی‌شده است — دوباره تلاش کنید یا کد جدید بگیرید');
  }
  const { error: updErr } = await sb.auth.updateUser({ password: newPassword });
  if (updErr) throw updErr;
  await sb.auth.signOut();
}

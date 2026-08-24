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

/**
 * درخواست ثبت‌نام برای دسترسی به پنل ادمین. نقش نهایی (ادمین/بازرس/مشاهده‌گر) و بخش سازمانی
 * (صنعت‌و‌معدن/اصناف) را سوپرادمین موقع تایید در تب «کاربران» مشخص می‌کند — همان جریانی که برای
 * ثبت‌نام مسئولین فنی در اپ مسئول فنی هم استفاده می‌شود.
 * ایمیل واقعی و تایید آن (کد ۶ رقمی) برای ثبت‌نام همچنان الزامی است — کد پرسنلی فقط برای ورود
 * روزمره جایگزین ایمیل می‌شود.
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

/** ردیف user_roles با نقش pending را (اگر قبلاً نبوده) می‌سازد */
async function ensureMyRoleRow(user) {
  const email = (user.email || '').toLowerCase();
  if (!email) return;
  const meta = user.user_metadata || {};
  try {
    await sb.from('user_roles').upsert(
      [{
        email,
        role: 'pending',
        full_name: meta.full_name || email,
        phone: meta.phone || '',
        personnel_code: meta.personnel_code || null,
      }],
      { onConflict: 'email', ignoreDuplicates: true },
    );
  } catch {
    // خطای این مرحله نباید مانع کامل‌شدن ثبت‌نام کاربر شود
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

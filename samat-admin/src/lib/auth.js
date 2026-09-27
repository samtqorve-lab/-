import { sb } from './supabase.js';
import { toEnDigits } from './utils.js';

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

/**
 * این RPC قبلاً مستقیماً از anon قابل صدا زدن بود و با یک کد پرسنلی کوچک/حدس‌زدنی ایمیل کاربر
 * را برمی‌گرداند — یعنی از بیرون قابل enumerate کردن بود. حالا دسترسی مستقیم بسته شده و فقط از
 * طریق Edge Function «public-lookup» (که خودش محدودیت نرخ روی IP اعمال می‌کند) در دسترس است.
 */
async function callPublicLookup(action, params) {
  const res = await fetch(`${sb.supabaseUrl}/functions/v1/public-lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: sb.supabaseKey, Authorization: `Bearer ${sb.supabaseKey}` },
    body: JSON.stringify({ action, ...params }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'خطا در ارتباط با سرور');
  return json.data;
}

export async function emailForPersonnelCode(personnelCode) {
  // کیبورد پیش‌فرض روی اکثر گوشی‌ها فارسی است و کدهای پرسنلی معمولاً عددی‌اند؛ اگر با ارقام
  // فارسی/عربی (۰-۹ / ٠-٩) تایپ شود، مقایسه‌ی متنی دقیق در RPC هیچ‌وقت با کد ذخیره‌شده (که با
  // ارقام انگلیسی ثبت شده) تطبیق پیدا نمی‌کند — بدون خطا، فقط بی‌صدا «یافت نشد» برمی‌گرداند. قبل
  // از جست‌وجو و ثبت، همیشه به ارقام انگلیسی نرمال می‌کنیم (دقیقاً مثل شماره عضویت در samat-tech).
  const code = toEnDigits((personnelCode || '').trim());
  if (!code) return null;
  return (await callPublicLookup('getEmailByPersonnelCode', { code })) || null;
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

// اگر یک تلاش قبلی هنوز settle نشده، اجازه‌ی شروع تلاش تازه را نمی‌دهیم — دقیقاً همان رفعی که در
// samat-tech انجام شد: بدون این قفل، هر تلاش تازه یک App.addListener('appUrlOpen', ...) مستقل
// ثبت می‌کرد که اگر تلاش قبلی هرگز settle نشده بود، هیچ‌وقت remove نمی‌شد و وقتی ریدایرکت واقعی
// گوگل بالاخره می‌رسید، همه‌ی listenerهای انباشته‌شده مستقل exchangeCodeForSession را با همان
// code یک‌بارمصرف صدا می‌زدند — اولی موفق می‌شد، بقیه دقیقاً با «invalid flow state» شکست
// می‌خوردند.
let googleNativeSignInInFlight = false;

async function signInWithGoogleNative() {
  if (googleNativeSignInInFlight) {
    throw new Error('یک تلاش ورود با گوگل از قبل در حال انجام است — چند لحظه صبر کنید یا اپ را ببندید و دوباره باز کنید');
  }
  googleNativeSignInInFlight = true;
  try {
    return await runGoogleNativeFlow();
  } finally {
    googleNativeSignInInFlight = false;
  }
}

async function runGoogleNativeFlow() {
  const { Browser } = await import('@capacitor/browser');
  const { App } = await import('@capacitor/app');

  // قبل از باز کردن تب تازه، هر تب مرورگری که از یک تلاش قبلی (که فکر می‌کردیم با «browserFinished»
  // کنسل‌شده، ولی این تشخیص طبق کامنت پایین‌تر قابل‌اعتماد نیست) شاید هنوز واقعاً باز مانده باشد
  // را می‌بندیم — تا کاربر هیچ‌وقت نتواند به یک تب قدیمی و رهاشده برگردد و آن را تکمیل کند.
  await Browser.close().catch(() => {});

  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) throw error;

  // هر تلاش یک «state» یک‌بارمصرف و مخصوص خودش دارد (همان چیزی که Supabase در data.url گذاشته).
  // بستنِ بالا فقط جلوی تکمیل یک تب رهاشده را می‌گیرد؛ اگر با این حال یک deep link با state تلاش
  // قدیمی برسد در حالی که code_verifier ذخیره‌شده الان مال همین تلاش تازه است، این چک آن را
  // بی‌صدا نادیده می‌گیرد (نه fail، نه exchange با ترکیب ناهم‌خوان) به‌جای اینکه با «invalid flow
  // state» شکست بخورد.
  let expectedState = null;
  try { expectedState = new URL(data.url).searchParams.get('state'); } catch { /* اگر پارس نشد، چک را رد می‌کنیم نه اینکه کل ورود را بشکنیم */ }

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
      if (settled) return;
      let incomingState = null;
      try { incomingState = new URL(url).searchParams.get('state'); } catch { /* نادیده */ }
      if (expectedState && incomingState && incomingState !== expectedState) return;
      cleanup();
      try {
        const { data: sessionData, error: exErr } = await sb.auth.exchangeCodeForSession(url);
        if (exErr) throw exErr;
        succeed(sessionData);
      } catch (e) {
        fail(e);
      }
    }).then((s) => { urlSub = s; });

    // مرورگر معمولاً دقیقاً همان لحظه‌ای که ریدایرکت موفق اتفاق می‌افتد هم بسته می‌شود — یعنی این
    // رویداد به‌تنهایی نشانه‌ی «لغو واقعی» نیست؛ چون exchangeCodeForSession در appUrlOpen یک
    // درخواست شبکه‌ی async است، ممکن است مرورگر زودتر از تمام‌شدنِ آن ببندد و این‌جا زودتر «لغو
    // شد» گزارش شود، درحالی‌که ورود در واقع دارد با موفقیت تکمیل می‌شود. قبل از قطعی دانستنِ لغو،
    // چند لحظه صبر می‌کنیم تا اگر appUrlOpen برنده شد، این fail دیگر اثری نداشته باشد.
    Browser.addListener('browserFinished', () => {
      setTimeout(() => {
        fail(Object.assign(new Error('ورود لغو شد'), { userCancelled: true }));
      }, 1500);
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
    email,
    password,
    // کد پرسنلی هم مثل شماره عضویت در samat-tech قبل از ذخیره به ارقام انگلیسی نرمال می‌شود، تا
    // چیزی که در ورود با آن مقایسه می‌شود همیشه یکدست باشد.
    options: { data: { full_name, phone, personnel_code: toEnDigits(personnel_code) } },
  });
  if (error) throw error;
  // Supabase برای جلوگیری از افشای این‌که یک ایمیل قبلاً ثبت‌نام و تایید شده یا نه (User
  // Enumeration Protection)، در این حالت نه خطا برمی‌گرداند و نه واقعاً ایمیلی می‌فرستد — فقط یک
  // پاسخ ظاهراً موفق و بدون session می‌دهد، دقیقاً مثل یک ثبت‌نام واقعیِ تازه که هنوز تاییدنشده.
  // قبلاً این دو حالت فقط از روی «session خالیه یا نه» تشخیص داده می‌شد، پس کاربرانی که از قبل
  // حساب تاییدشده داشتند هم بی‌دلیل به مرحله‌ی «کد تایید» فرستاده می‌شدند — با کدی که هیچ‌وقت
  // واقعاً فرستاده نشده بود. تنها نشانه‌ی قابل‌اتکای تشخیص این دو حالت از هم، آرایه‌ی identities
  // است: برای ایمیل از قبل تاییدشده همیشه خالی برمی‌گردد، برای ثبت‌نام واقعیِ تازه پر است.
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('این ایمیل قبلاً ثبت‌نام و تایید شده — از فرم ورود استفاده کنید یا رمز عبور را بازیابی کنید.');
  }
  if (!data.session) return { needsEmailConfirm: true };
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

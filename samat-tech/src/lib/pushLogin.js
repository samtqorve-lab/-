import { sb } from './supabase.js';

/**
 * ورود با تایید Push (اختیاری، هر کاربر خودش از تنظیمات روشن می‌کند). دقیقاً همان زیرساخت پنل
 * ادمین (جدول login_approvals و Edge Functionsهای push-login-notify/push-login-fallback مشترک
 * است — چون user_roles بین این اپ و پنل ادمین مشترک است، هیچ تغییری سمت سرور لازم نبود).
 *
 * فال‌بک خودکار Push→تلگرام: چون Push (Firebase) ممکن است در ایران به‌خاطر تحریم‌ها به دستگاه
 * نرسد، اگر ۲۰ ثانیه پاسخی نیاید یا ارسال Push از همان ابتدا شکست بخورد، به‌صورت خودکار یک کد ۶
 * رقمی از طریق تلگرام (مقاوم‌تر) فرستاده می‌شود.
 *
 * نکته‌ی امنیتی صادقانه: چون Supabase Auth یک‌مرحله‌ای است، این «gate کردن رابط‌کاربری تا تایید»
 * است، نه پیش‌احراز هویت واقعی سمت سرور — برای تهدیدهای معمول (رمز لورفته) کافی است.
 */

// این کد فقط از طریق پیام‌رسان/ایمیل به کاربر می‌رسد — یعنی بین لحظه‌ی ارسال تا لحظه‌ای که کاربر
// واقعاً برنامه‌ی پیام‌رسان را باز می‌کند، کد را می‌بیند، کپی می‌کند و برمی‌گردد به این اپ، همیشه
// چند ده ثانیه طول می‌کشد. مهلت باید سمت سرور (push-login-fallback) و اینجا (تایمر لغو محلی)
// دقیقاً یکسان باشد، وگرنه اپ زودتر از سرور «منقضی شد» نشان می‌دهد یا برعکس.
const CODE_VALID_MS = 5 * 60 * 1000;

export async function isPushLoginEnabled(email) {
  const { data } = await sb.from('user_roles').select('push_login_enabled').eq('email', email).maybeSingle();
  return !!data?.push_login_enabled;
}

/**
 * sb.auth.getSession() همیشه یک فراخوانی محلی/آنی نیست — اگر تشخیص بدهد token نزدیک
 * انقضاست، داخلش یک درخواست شبکه‌ای واقعی (refresh token) می‌زند که هیچ timeout پیش‌فرضی
 * ندارد — اگر همین درخواست شبکه (خصوصاً از ایران) stall کند، این await برای همیشه معلق می‌ماند.
 * قبلاً فقط خودِ fetchِ تابع callFn محافظت‌دار بود (با AbortController)، ولی همین خطِ یک
 * قدم قبل‌تر (گرفتن access token) هیچ‌وقت تحت پوشش نبود — و دقیقاً همین بود علت واقعی
 * «ارسال دوباره‌ی کد» (و حتی خودِ تایید کد) که همیشه بعد از ۳۰-۴۵ ثانیه بی‌صدا با ۴۰۱
 * شکست می‌خورد (طبق لاگ‌های واقعی سرور). اگر تا ۵ ثانیه جواب نیاید، بدون token پیش می‌رویم (سرور
 * خودش با ۴۰۱ تمیز وسریع رد می‌کند — به‌جای اینکه دکمه تا ابد روی «۰۶...» بماند).
 */
async function getAccessTokenSafe(timeoutMs = 5000) {
  try {
    const result = await Promise.race([
      sb.auth.getSession(),
      new Promise((resolve) => { setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    return result?.data?.session?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * fetch() به‌خودی هیچ timeout پیش‌فرضی ندارد — اگر شبکه (که در همین پروژه قبلاً چندبار با
 * AWS/Firebase/Esri دیده شده، خصوصاً از ایران) درخواست را stall کند (نه رد کند، فقط بی‌پاسخ
 * بماند)، این تماس برای همیشه معلق می‌ماند. حالا هم خودِ fetch (با AbortController) و هم مرحله‌ی
 * قبلش (گرفتن access token از getAccessTokenSafe) هردو محافظت دارند — قبلاً فقط خودِ fetch محافظت
 * داشت، ولی خطِ گرفتن session یک قدم قبل‌تر بود که می‌توانست برای همیشه معلق بماند — دقیقاً
 * همان علت یکی از دلایل اصلی «ارسال دوباره‌ی کد همچنان مشکل دارد» که گزارش‌شده بود.
 */
async function callFn(name, body, timeoutMs = 8000) {
  const accessToken = await getAccessTokenSafe();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${sb.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken || ''}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * یک درخواست تایید می‌سازد، Push می‌فرستد، و اگر ۲۰ ثانیه پاسخی نیاید (یا از ابتدا شکست بخورد)
 * خودکار فال‌بک تلگرام را فعال می‌کند.
 * @param {string} email
 * @param {(status: 'approved'|'denied'|'timeout'|'error', detail?: any) => void} onResolve
 * @param {(approvalId: string, resendCode: () => Promise<{ok: boolean, reason?: string}>) => void} onAwaitingCode
 *   وقتی کد تلگرام ارسال شد، صدا زده می‌شود تا رابط‌کاربری فرم ورود کد را نشان دهد. آرگومان دوم
 *   یک تابع «ارسال دوباره‌ی کد» است — اگر کد اول به هر دلیلی (رسیدن دیرهنگام پیام، اشتباه
 *   خواندن) درست نبود، کاربر مجبور نیست کل فرآیند ورود (کد پرسنلی + رمز) را از نو انجام بدهد.
 * @returns {Promise<() => void>}
 */
export async function requestPushApproval(email, onResolve, onAwaitingCode) {
  const { data: approval, error: insertErr } = await sb
    .from('login_approvals')
    .insert({ email })
    .select()
    .single();
  if (insertErr || !approval) { onResolve('error', insertErr?.message); return () => {}; }

  let settled = false;
  let fallbackTried = false;
  let timer = null;
  let channel = null;
  // قبلاً این «شبکه‌ی محافظ نهایی» یک setTimeout جدا و هرگز-پاک‌نشده بود که همیشه بعد از ۳۰
  // ثانیه finish('error') را صدا می‌زد — حتی وقتی کد تلگرام قبلاً با موفقیت ارسال شده بود و
  // armCodeTimer داشت مهلت ۵ دقیقه‌ای درست را می‌شمرد. یعنی کاربر عملاً همیشه فقط ۳۰ ثانیه
  // (نه ۵ دقیقه) فرصت داشت کد را وارد کند. حالا در همان متغیری نگه‌داری می‌شود که armCodeTimer
  // پاک می‌کند، پس به‌محض رسیدن به مرحله‌ی «در انتظار کد»، این تایمر ۳۰ثانیه‌ای بی‌اثر می‌شود و
  // فقط مهلت ۵ دقیقه‌ای واقعی حاکم است.
  let safetyNetTimer = null;

  function finish(status, detail) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(safetyNetTimer);
    if (channel) channel.unsubscribe();
    onResolve(status, detail);
  }

  function armCodeTimer() {
    clearTimeout(timer);
    clearTimeout(safetyNetTimer); // از این لحظه به بعد، فقط همین تایمر ۵دقیقه‌ای تعیین‌کننده‌ی انقضاست
    timer = setTimeout(() => finish('timeout'), CODE_VALID_MS);
  }

  /** برای دکمه‌ی «ارسال دوباره‌ی کد» — روی همان approvalId، بدون نیاز به ورود دوباره‌ی رمز عبور */
  async function resendCode() {
    if (settled) return { ok: false, reason: 'already-resolved' };
    try {
      const data = await callFn('push-login-fallback', { action: 'send', approvalId: approval.id });
      if (data.ok) armCodeTimer();
      return data;
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async function tryTelegramFallback() {
    if (fallbackTried || settled) return;
    fallbackTried = true;
    try {
      const data = await callFn('push-login-fallback', { action: 'send', approvalId: approval.id });
      if (data.ok) {
        armCodeTimer();
        onAwaitingCode && onAwaitingCode(approval.id, resendCode);
      } else {
        finish('error', data.reason || 'fallback-send-failed');
      }
    } catch (err) {
      finish('error', err.name === 'AbortError' ? 'اتصال به سرور برقرار نشد (شبکه/فیلترینگ) — دوباره تلاش کنید' : err.message);
    }
  }

  // Realtime را همین اول (قبل از هر فراخوانی شبکه‌ای دیگر) وصل می‌کنیم — نه بعد از notify — چون
  // اگر تماس notify زیر دچار تأخیر/گیر شبکه شود، نباید لحظه‌ی تاییدشدن را از دست بدهیم.
  channel = sb
    .channel(`login-approval-${approval.id}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'login_approvals', filter: `id=eq.${approval.id}`,
    }, (payload) => {
      const status = payload.new.status;
      if (status === 'pending') return;
      finish(status);
    })
    .subscribe();

  // نکته‌ی مهم: fetch اصلاً timeout پیش‌فرض ندارد — اگر شبکه (خصوصاً از ایران، به‌خاطر
  // تحریم/فیلترینگ) این درخواست را stall کند (نه رد کند، فقط بی‌پاسخ بماند)، این await برای
  // همیشه معلق می‌ماند و تایمر ۲۰ ثانیه‌ی فال‌بک (که قبلاً *بعد* از این await شروع می‌شد) هیچ‌وقت
  // حتی شروع نمی‌شود — دقیقاً همان چیزی که باعث می‌شد دکمه‌ی ورود برای همیشه روی «در انتظار
  // تایید...» بماند. با Promise.race یک سقف زمانی مستقل (۸ ثانیه) روی خودِ این تماس می‌گذاریم تا
  // صرفِ کند/گیرکردن شبکه هم مثل شکست واقعی به فال‌بک تلگرام برسد.
  const notifyPromise = callFn('push-login-notify', { approvalId: approval.id });
  const notifyTimeout = new Promise((resolve) => { setTimeout(() => resolve({ ok: false, reason: 'notify-network-stall' }), 8000); });

  Promise.race([notifyPromise, notifyTimeout]).then((notifyResult) => {
    if (settled) return;
    if (notifyResult && notifyResult.ok === false) {
      // Push از همان ابتدا در دسترس نبود (تنظیم نشده/دستگاه ثبت نشده/شبکه معلق) — مستقیم فال‌بک
      tryTelegramFallback();
    } else {
      // Push فرستاده شد — ۶ ثانیه صبر می‌کنیم، بعد اگر پاسخی نیامد فال‌بک را فعال می‌کنیم
      // ارسال موفق به FCM (سرور Google) هیچ تضمینی برای رسیدن واقعی به گوشی نمی‌دهد — طبق لاگ‌های
      // واقعی این پروژه، حتی وقتی FCM با موفقیت (۲۰۰) پیام را قبول می‌کند، به‌خاطر محدودیت
      // سرویس‌های گوگل در ایران ممکن است هیچ‌وقت به دستگاه نرسد. قبلاً ۲۰ ثانیه صبر می‌کردیم که
      // تجربه‌ی کاربر را کند می‌کرد؛ حالا با تاخیر کوتاه‌تر (۶ ثانیه) به کد تلگرام برمی‌گردیم.
      timer = setTimeout(tryTelegramFallback, 6000);
    }
  }).catch(() => {
    if (!settled) tryTelegramFallback();
  });

  // شبکه‌ی محافظ نهایی: فقط برای مرحله‌ی «قبل از رسیدن به کد» است (یعنی اگر notify/فال‌بک هردو
  // در همان ابتدا برای همیشه گیر کنند). به‌محض اینکه armCodeTimer صدا زده شود (کد با موفقیت
  // ارسال شد)، این تایمر پاک می‌شود و دیگر اثری ندارد — پس کاربر واقعاً ۵ دقیقه‌ی کامل CODE_VALID_MS
  // را برای وارد کردن کد در اختیار دارد، نه فقط تا این ۳۰ ثانیه.
  safetyNetTimer = setTimeout(() => { if (!settled) finish('error', 'اتصال به سرور برقرار نشد — دوباره تلاش کنید'); }, 30000);

  return () => finish('denied');
}

/** کد ۶ رقمی وارد‌شده توسط کاربر را با سرور تایید می‌کند */
export async function verifyFallbackCode(approvalId, code) {
  return callFn('push-login-fallback', { action: 'verify', approvalId, code });
}

import { sb } from './supabase.js';

/**
 * ورود با تایید Push (اختیاری، هر ادمین خودش از تنظیمات روشن می‌کند): بعد از ورود موفق با
 * ایمیل/رمز، اگر push_login_enabled=true باشد، به‌جای دسترسی فوری، یک درخواست تایید ثبت می‌شود،
 * یک Push به دستگاه اندرویدی که قبلاً این قابلیت را در آن روشن کرده‌اید فرستاده می‌شود.
 *
 * فال‌بک خودکار Push→تلگرام: چون Push (Firebase) ممکن است در ایران به‌خاطر تحریم‌ها به دستگاه
 * نرسد، اگر ۲۰ ثانیه پاسخی نیاید یا ارسال Push از همان ابتدا شکست بخورد، به‌صورت خودکار یک کد ۶
 * رقمی از طریق تلگرام (مقاوم‌تر) فرستاده می‌شود — بدون نیاز به تنظیم دستی از سمت کاربر.
 *
 * نکته‌ی امنیتی صادقانه: چون Supabase Auth یک مرحله‌ای است، این «gate کردن رابط‌کاربری تا تایید»
 * است، نه پیش‌احراز هویت واقعی سمت سرور — برای تهدیدهای معمول کافی است.
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
 * fetch() به‌خودی‌خود هیچ timeout پیش‌فرضی ندارد — اگر شبکه (که در همین پروژه قبلاً چندبار با
 * AWS/Firebase/Esri دیده شده، خصوصاً از ایران) درخواست را stall کند (نه رد کند، فقط بی‌پاسخ
 * بماند)، این تماس برای همیشه معلق می‌ماند. بدون AbortController، این مشکل را فقط برای اولین
 * تماس (notify) با یک race بیرونی پوشش داده بودیم، ولی خودِ تماس فال‌بک (push-login-fallback)
 * هم از همان مشکل رنج می‌برد و می‌توانست دوباره برای همیشه گیر کند. حالا timeout مستقیم روی
 * خودِ fetch است، پس هر فراخوانی این تابع (هرجا که باشد) محافظت دارد.
 */
async function callFn(name, body, timeoutMs = 8000) {
  const { data: sessionData } = await sb.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${sb.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
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

  function finish(status, detail) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (channel) channel.unsubscribe();
    onResolve(status, detail);
  }

  function armCodeTimer() {
    clearTimeout(timer);
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
      // Push فرستاده شد — ۲۰ ثانیه صبر می‌کنیم، بعد اگر پاسخی نیامد فال‌بک را فعال می‌کنیم
      timer = setTimeout(tryTelegramFallback, 20000);
    }
  }).catch(() => {
    if (!settled) tryTelegramFallback();
  });

  // شبکه‌ی محافظ نهایی: حتی اگر هر بخش دیگری از این تابع هم (نه فقط دو fetch بالا) به هر دلیلی
  // معلق بماند، بعد از ۳۰ ثانیه به‌طور قطعی خطا نشان می‌دهیم — رابط‌کاربری هرگز نباید برای همیشه
  // روی «در انتظار تایید...» بماند.
  setTimeout(() => { if (!settled) finish('error', 'اتصال به سرور برقرار نشد — دوباره تلاش کنید'); }, 30000);

  return () => finish('denied');
}

/** کد ۶ رقمی وارد‌شده توسط کاربر را با سرور تایید می‌کند */
export async function verifyFallbackCode(approvalId, code) {
  return callFn('push-login-fallback', { action: 'verify', approvalId, code });
}

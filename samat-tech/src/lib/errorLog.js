// ثبت خطاهای اپ در جدول client_errors (best-effort؛ هرگز خطا پرتاب نمی‌کند). لاگ خودِ Supabase
// فقط چند ساعت نگه داشته می‌شود و اغلب وقتی کاربر گزارش می‌کند که «ارسال نشد»، اثری از آن نمانده است.
// ماژول supabase.js عمداً داخل تابع (پویا) import می‌شود تا وابستگی چرخه‌ای با offlineQueue پیش نیاید.

const MAX_PER_SESSION = 25;
let sentCount = 0;
const recent = new Map(); // message -> آخرین زمان ثبت (برای حذف تکراری‌های پشت‌سرهم)
let installed = false;

export async function logClientError(context, err, detail) {
  try {
    if (sentCount >= MAX_PER_SESSION) return;
    const message = String((err && err.message) || err || '').slice(0, 1500);
    const key = `${context}|${message}`;
    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < 30000) return;
    recent.set(key, now);
    const { sb } = await import('./supabase.js');
    const { data: { session } } = await sb.auth.getSession();
    const email = session && session.user && session.user.email;
    if (!email) return; // سیاست دسترسی جدول فقط ثبت خطا با ایمیل خود کاربر را مجاز می‌کند
    sentCount += 1;
    await sb.from('client_errors').insert([{
      email,
      app: 'tech',
      context: String(context).slice(0, 120),
      message,
      detail: detail || null,
      user_agent: (navigator.userAgent || '').slice(0, 400),
    }]);
  } catch {
    // لاگ‌گیری هرگز نباید خودش مشکل بسازد
  }
}

/** خطاهای مدیریت‌نشده‌ی کل اپ را هم ثبت می‌کند. یک‌بار در main.js صدا زده شود. */
export function installGlobalErrorLogging() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    logClientError('window.error', e.error || e.message, { file: e.filename, line: e.lineno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    logClientError('unhandledrejection', e.reason);
  });
}

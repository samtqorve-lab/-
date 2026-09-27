export function toEnDigits(s) {
  if (s == null) return s;
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  return String(s).replace(/[۰-۹٠-٩]/g, (ch) => {
    const i = fa.indexOf(ch);
    if (i > -1) return i;
    const j = ar.indexOf(ch);
    if (j > -1) return j;
    return ch;
  });
}

/** پیام‌های خطای Supabase انگلیسی و فنی‌اند؛ رایج‌ترینشان را به فارسی ساده برمی‌گردانیم */
export function friendlyError(err) {
  const msg = (err && err.message) || String(err || '');
  const m = msg.toLowerCase();
  if (m.includes('user already registered') || m.includes('already registered')) return 'این ایمیل قبلاً ثبت‌نام کرده — از فرم ورود استفاده کنید یا رمز را بازیابی کنید';
  if (m.includes('email not confirmed')) return 'ایمیل شما هنوز تایید نشده — کد ارسالی به ایمیل را وارد کنید';
  if (m.includes('invalid login credentials')) return 'ایمیل یا رمز اشتباه است';
  if (m.includes('rate limit') || m.includes('too many requests')) return 'تعداد تلاش‌ها زیاد بوده — چند دقیقه صبر کنید و دوباره امتحان کنید';
  if (m.includes('failed to fetch') || m.includes('network')) return 'اتصال به اینترنت برقرار نشد — دوباره امتحان کنید';
  // این خطای فنی وقتی ظاهر می‌شود که یک تلاش «ورود با گوگل» قدیمی/رهاشده (که ظاهراً کنسل‌شده به
  // نظر می‌رسید ولی واقعاً هنوز تکمیل نشده بود) دیر به نتیجه برسد، یا فرآیند اکسچنج کد دوبار
  // برای یک تلاش صدا زده شود — به کاربر می‌گوییم چه کار کند، نه متن خام GoTrue را نشان بدهیم.
  if (m.includes('invalid flow state')) return 'ورود قبلی با گوگل هنوز کامل نشده بود یا منقضی شده — لطفاً دوباره روی «ورود سریع با گوگل» بزنید.';
  if (m.includes('password')) return `رمز عبور نامعتبر است: ${msg}`;
  return msg;
}

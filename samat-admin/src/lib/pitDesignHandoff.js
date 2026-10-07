// تحویل «مدل پهپادیِ انتخاب‌شده» از پنجرهٔ مدل سه‌بعدی به صفحهٔ طراحی پله‌بندی.
//
// کاربر در پنجرهٔ مدل روی «📐 طراحی پله‌بندی» می‌زند؛ معدن و شناسهٔ کار در localStorage ذخیره می‌شود، به تب طراحی
// می‌رویم و صفحهٔ طراحی همان مدل را خودکار بارگذاری می‌کند. فقط یک‌بار مصرف می‌شود (take حذفش می‌کند) و بعد از
// چند دقیقه منقضی می‌شود تا مدل قدیمیِ فراموش‌شده، بعداً ناخواسته بارگذاری نشود.
// storage را تزریق می‌کنیم (پیش‌فرض localStorage) تا بدون مرورگر تست شود.

export const HANDOFF_KEY = 'samat:pitDesign:handoff';
export const HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

/** @returns {boolean} true اگر ذخیره شد (حالت خصوصی/پر بودن حافظه می‌تواند خطا بدهد) */
export function saveHandoff(storage, { mineName, jobId }, now = Date.now()) {
  if (!mineName || !jobId) return false;
  try {
    storage.setItem(HANDOFF_KEY, JSON.stringify({ mineName: String(mineName), jobId: String(jobId), at: now }));
    return true;
  } catch { return false; }
}

/** @returns {{ mineName:string, jobId:string }|null} مقدار را می‌خواند و حذف می‌کند؛ نامعتبر/منقضی → null */
export function takeHandoff(storage, now = Date.now(), maxAgeMs = HANDOFF_MAX_AGE_MS) {
  try {
    const raw = storage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    storage.removeItem(HANDOFF_KEY);
    const v = JSON.parse(raw);
    if (!v || typeof v.mineName !== 'string' || typeof v.jobId !== 'string' || !v.mineName || !v.jobId) return null;
    if (!(now - Number(v.at) <= maxAgeMs) || now < Number(v.at) - 1000) return null;
    return { mineName: v.mineName, jobId: v.jobId };
  } catch { return null; }
}

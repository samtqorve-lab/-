export function normalizeKey(s) {
  return String(s || '').replace(/[\s\u200c]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim().toLowerCase();
}

/** فیلد «شماره پروانه/مجوز»ای که برای هر بخش به‌عنوان کلید اصلی تطبیق ردیف‌های ایمپورت استفاده می‌شود */
export const DEPT_LICENSE_KEY = {
  معدن: 'شماره_پروانه',
  صنعت: 'شماره_مجوز',
  اکتشاف: 'شماره_پروانه_اکتشاف',
  فرآوری: 'شماره_پروانه_بهره_برداری',
};

/**
 * شاخص‌های ایمنی (طبق قرارداد بین‌المللی ILO: به‌ازای هر یک میلیون نفر-ساعت کار) و برآورد
 * هزینه‌ی بازسازی زیست‌محیطی/تضمین مالی مرتبط.
 */

/**
 * @param p.recordableInjuries تعداد کل حوادث قابل‌ثبت (شامل فوتی) در بازه
 * @param p.fatalities تعداد فوتی‌ها (زیرمجموعه‌ی recordableInjuries)
 * @param p.lostDays مجموع روزهای از دست‌رفته‌ی کاری ناشی از حوادث
 * @param p.manHours مجموع نفر-ساعت کارکرد در همان بازه
 */
export function calcSafetyIndices(p) {
  if (!(p.manHours > 0)) throw new Error('مجموع نفر-ساعت کارکرد باید بزرگ‌تر از صفر باشد');
  const base = 1000000;
  const ltifr = (p.recordableInjuries * base) / p.manHours; // در نبود آمار «روز از دست‌رفته» جدا، همه‌ی حوادث قابل‌ثبت را lost-time فرض می‌کنیم
  const fatalityRate = (p.fatalities * base) / p.manHours;
  const severityRate = (p.lostDays * base) / p.manHours;
  return { ltifr, fatalityRate, severityRate };
}

/**
 * هزینه‌ی بازسازی زیست‌محیطی = مساحت تخریب‌شده × هزینه‌ی بازسازی هر هکتار + ضریب پیش‌بینی‌نشده.
 * این مبلغ معمولاً همان مبنای تضمین مالی زیست‌محیطی است که باید از بهره‌بردار اخذ شود.
 */
export function calcReclamationGuarantee(p) {
  const baseCost = p.disturbedAreaHectares * p.costPerHectare;
  const contingencyAmount = baseCost * ((p.contingencyPercent || 0) / 100);
  const totalGuarantee = baseCost + contingencyAmount;
  return { baseCost, contingencyAmount, totalGuarantee };
}

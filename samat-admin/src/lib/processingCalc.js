/**
 * محاسبات فرآوری مواد معدنی: توان آسیاب به روش Bond (Bond's Third Theory)، و برآورد اولیه‌ی سطح
 * تیکنر/غلیظ‌ساز به روش «سطح واحد» (Unit Area، بر پایه‌ی نتیجه‌ی آزمایش ته‌نشینی آزمایشگاهی).
 */

/**
 * قانون باند: W (kWh/تن) = 10×Wi×(1/√P80 − 1/√F80)   — F80,P80 بر حسب میکرون
 * @param p.workIndexKwhPerTon اندیس کار باند ماده (Wi) — از آزمایشگاه یا جداول مرجع
 * @param p.feedF80Micron اندازه‌ی ۸۰٪ عبوری خوراک (میکرون)
 * @param p.productP80Micron اندازه‌ی ۸۰٪ عبوری محصول (میکرون)
 * @param p.throughputTonPerHour ظرفیت عبوری آسیاب
 */
export function calcBondMillPower(p) {
  if (!(p.feedF80Micron > p.productP80Micron)) {
    throw new Error('اندازه‌ی خوراک (F80) باید بزرگ‌تر از اندازه‌ی محصول (P80) باشد');
  }
  const specificEnergyKwhPerTon = 10 * p.workIndexKwhPerTon
    * (1 / Math.sqrt(p.productP80Micron) - 1 / Math.sqrt(p.feedF80Micron));
  const requiredPowerKw = specificEnergyKwhPerTon * p.throughputTonPerHour;
  return { specificEnergyKwhPerTon, requiredPowerKw };
}

/**
 * روش سطح واحد (Unit Area / Coe-Clevenger ساده‌شده): سطح لازم = تناژ خشک روزانه × ضریب سطح واحد.
 * ضریب سطح واحد (UA) حتماً باید از آزمایش ته‌نشینی آزمایشگاهی (Settling Test) روی همان پالپ
 * به‌دست بیاید — حدس زدنش معنا ندارد، برای همین این ابزار مقدار پیش‌فرض نمی‌دهد.
 */
export function calcThickenerSizing(p) {
  const areaM2 = p.solidsFeedTonPerDay * p.unitAreaM2DayPerTon;
  const diameterM = Math.sqrt((4 * areaM2) / Math.PI);
  return { areaM2, diameterM };
}

/** موازنه‌ی جرمی ساده‌ی جامد/آب پالپ — برای اتصال خوراک با درصد جامد ورودی به تیکنر/سرریز/زیرریز */
export function calcPulpMassBalance(p) {
  const solidsTonPerHour = p.feedTonPerHour * (p.feedSolidsPercent / 100);
  const feedWaterTonPerHour = p.feedTonPerHour - solidsTonPerHour;
  const underflowTotalTonPerHour = solidsTonPerHour / (p.underflowSolidsPercent / 100);
  const underflowWaterTonPerHour = underflowTotalTonPerHour - solidsTonPerHour;
  const overflowWaterTonPerHour = feedWaterTonPerHour - underflowWaterTonPerHour;
  if (overflowWaterTonPerHour < 0) {
    throw new Error('درصد جامد زیرریز خواسته‌شده از نظر تعادل آب ممکن نیست (آب ورودی کافی نیست) — درصد جامد زیرریز را کم کنید');
  }
  return {
    solidsTonPerHour, feedWaterTonPerHour, underflowTotalTonPerHour,
    underflowWaterTonPerHour, overflowWaterTonPerHour,
  };
}

/**
 * محاسبات فرآوری مواد معدنی: توان آسیاب به روش Bond (Bond's Third Theory)، برآورد اولیه‌ی سطح
 * تیکنر/غلیظ‌ساز به روش «سطح واحد»، اختلاط باطله برای رسیدن به عیار هدف، و آنالیز دانه‌بندی الک.
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

// ————————————————————————— اختلاط باطله برای رسیدن به عیار هدف (Ore Blending) —————————————————————————
/** محاسبه‌ی رفت: چند کپه با تناژ و عیار مشخص را مخلوط کنید، عیار و تناژ محصول نهایی چقدر می‌شود */
export function calcBlendForward(piles) {
  const totalTonnage = piles.reduce((s, p) => s + p.tonnage, 0);
  if (totalTonnage <= 0) throw new Error('مجموع تناژ کپه‌ها باید بزرگ‌تر از صفر باشد');
  const blendedGrade = piles.reduce((s, p) => s + p.tonnage * p.grade, 0) / totalTonnage;
  return { totalTonnage, blendedGrade };
}

/** محاسبه‌ی برگشت (دو کپه): برای رسیدن به عیار هدف، چه نسبتی از هر کپه لازم است */
export function calcBlendTwoPileRatio(p) {
  const { gradeA, gradeB, targetGrade } = p;
  if (gradeA === gradeB) throw new Error('عیار دو کپه یکسان است — نسبت اختلاط تعریف‌نشده است');
  if ((targetGrade - gradeA) * (targetGrade - gradeB) > 0) {
    throw new Error('عیار هدف باید بین عیار دو کپه باشد');
  }
  const fractionA = (gradeB - targetGrade) / (gradeB - gradeA);
  const fractionB = 1 - fractionA;
  return { fractionA, fractionB };
}

// ————————————————————————— آنالیز دانه‌بندی الک (Sieve Analysis) —————————————————————————
/**
 * @param rows آرایه‌ای از {sizeMm, massRetainedG} مرتب‌شده از درشت به ریز
 * @param panMassG جرم باقی‌مانده در ته (کوچک‌تر از ریزترین الک)
 */
export function calcSieveAnalysis(rows, panMassG) {
  const totalMass = rows.reduce((s, r) => s + r.massRetainedG, 0) + panMassG;
  if (totalMass <= 0) throw new Error('مجموع جرم باید بزرگ‌تر از صفر باشد');
  let cumulativeRetained = 0;
  const table = rows.map((r) => {
    cumulativeRetained += r.massRetainedG;
    const percentRetained = (r.massRetainedG / totalMass) * 100;
    const cumulativePercentRetained = (cumulativeRetained / totalMass) * 100;
    const cumulativePercentPassing = 100 - cumulativePercentRetained;
    return { ...r, percentRetained, cumulativePercentRetained, cumulativePercentPassing };
  });

  // درون‌یابی خطی-لگاریتمی برای یافتن اندازه‌ی متناظر با درصد عبوری هدف
  function sizeAtPassing(targetPercent) {
    for (let i = 0; i < table.length - 1; i += 1) {
      const upper = table[i]; const lower = table[i + 1];
      if (upper.cumulativePercentPassing >= targetPercent && lower.cumulativePercentPassing <= targetPercent) {
        const logU = Math.log(upper.sizeMm); const logL = Math.log(lower.sizeMm);
        const frac = (upper.cumulativePercentPassing - targetPercent) / (upper.cumulativePercentPassing - lower.cumulativePercentPassing);
        return Math.exp(logU + frac * (logL - logU));
      }
    }
    return null; // خارج از بازه‌ی الک‌های موجود
  }

  return { table, totalMass, d50: sizeAtPassing(50), d80: sizeAtPassing(80) };
}

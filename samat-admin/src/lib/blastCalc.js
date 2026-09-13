/**
 * فرمول‌های استاندارد طراحی الگوی حفاری و آتش‌باری پله‌ای (بر پایه‌ی روش Ash/Konya که در اکثر
 * متون مهندسی معدن تدریس می‌شود). این محاسبات یک برآورد مهندسی اولیه است، نه طرح نهایی —
 * پیش از اجرای عملیاتی حتماً باید توسط مسئول فنی/مهندس آتش‌باری مسئول معدن بازبینی و بر اساس
 * شرایط واقعی توده‌سنگ (RQD، درزه‌داری، آب‌دار بودن چال) و آیین‌نامه‌ی ایمنی معادن تطبیق داده شود.
 */

// ضریب برم (Kb) بر حسب سختی توده‌سنگ — برم = Kb × قطر چال. مقادیر رایج آموزشی؛ برای سنگ‌های
// بسیار درزه‌دار یا آبدار باید محافظه‌کارانه‌تر (عدد کوچک‌تر) انتخاب شود.
export const ROCK_KB = {
  soft: { label: 'نرم (مثل مارن، شیل سست)', kb: 35 },
  medium: { label: 'متوسط (مثل آهک متوسط، ماسه‌سنگ)', kb: 30 },
  hard: { label: 'سخت (مثل آهک سخت، گرانیت)', kb: 25 },
  veryHard: { label: 'بسیار سخت / درزه‌دار کم', kb: 20 },
};

// چگالی مواد ناریه‌ی رایج (kg/m3) — مقادیر معمول کارخانه‌ای؛ برای محصول خاص از برگه‌ی فنی سازنده استفاده شود.
export const EXPLOSIVE_TYPES = {
  anfo: { label: 'آنفو (ANFO)', densityKgM3: 850 },
  emulsion: { label: 'امولسیون (Emulsion)', densityKgM3: 1200 },
  watergel: { label: 'واترژل / اسلاری', densityKgM3: 1150 },
  dynamite: { label: 'دینامیت / ژلاتینی', densityKgM3: 1400 },
};

/**
 * محاسبه‌ی کامل الگوی آتش‌باری، مصرف مواد ناریه، وسایل انفجاری و برآورد اقتصادی.
 * @param {object} p پارامترهای ورودی (نگاه کنید به مقادیر پیش‌فرض در toolsPage.js)
 */
export function calcBlastDesign(p) {
  const D = p.holeDiameterMm / 1000; // قطر چال بر حسب متر
  if (!(D > 0)) throw new Error('قطر چال باید بزرگ‌تر از صفر باشد');

  const kb = p.kbOverride > 0 ? p.kbOverride : ROCK_KB[p.rockHardness].kb;
  const ks = p.ksOverride > 0 ? p.ksOverride : 1.15;
  const burden = kb * D;
  const spacing = ks * burden;
  const subdrill = (p.subdrillRatio ?? 0.3) * burden;
  const stemming = (p.stemmingRatio ?? 0.8) * burden;
  const holeLength = p.benchHeightM + subdrill;
  const chargeLength = holeLength - stemming;
  if (chargeLength <= 0) {
    throw new Error('طول استمینگ از طول چال بیشتر شده — قطر چال را کم یا ارتفاع پله را زیاد کنید');
  }

  const explosiveDensity = p.explosiveDensityOverride > 0 ? p.explosiveDensityOverride : EXPLOSIVE_TYPES[p.explosiveType].densityKgM3;
  const linearChargeKgPerM = explosiveDensity * (Math.PI / 4) * D * D;
  const chargePerHoleKg = linearChargeKgPerM * chargeLength;

  const holesPerRow = Math.max(1, Math.round(p.faceLengthM / spacing) + 1);
  const rows = Math.max(1, Math.round(p.rows || 1));
  const totalHoles = holesPerRow * rows;

  const volumeM3 = totalHoles * burden * spacing * p.benchHeightM; // برآورد حجم سنگ خردشده
  const rockDensityTonM3 = p.rockDensityTonM3 || 2.6;
  const totalRockTon = volumeM3 * rockDensityTonM3;

  const totalExplosiveKg = chargePerHoleKg * totalHoles;
  const powderFactorKgM3 = totalExplosiveKg / volumeM3;
  const powderFactorKgTon = totalExplosiveKg / totalRockTon;

  const primerCount = Math.round((p.primersPerHole ?? 1) * totalHoles);
  const detonatorCount = Math.round((p.detonatorsPerHole ?? 1) * totalHoles);
  const totalDrillLengthM = holeLength * totalHoles;

  const drillingCost = totalDrillLengthM * (p.pricePerMeterDrilling || 0);
  const explosiveCost = totalExplosiveKg * (p.pricePerKgExplosive || 0);
  const primerCost = primerCount * (p.pricePerPrimer || 0);
  const detonatorCost = detonatorCount * (p.pricePerDetonator || 0);
  const totalCost = drillingCost + explosiveCost + primerCost + detonatorCost;

  return {
    burden, spacing, subdrill, stemming, holeLength, chargeLength,
    linearChargeKgPerM, chargePerHoleKg,
    holesPerRow, rows, totalHoles,
    volumeM3, totalRockTon,
    totalExplosiveKg, powderFactorKgM3, powderFactorKgTon,
    primerCount, detonatorCount, totalDrillLengthM,
    drillingCost, explosiveCost, primerCost, detonatorCost, totalCost,
    costPerM3: totalCost / volumeM3,
    costPerTon: totalCost / totalRockTon,
  };
}

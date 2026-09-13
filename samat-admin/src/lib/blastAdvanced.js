/**
 * محاسبات پیشرفته‌ی آتش‌باری: پیش‌بینی لرزش (PPV) به روش فاصله‌ی مقیاس‌شده‌ی USBM/Duvall-Fordham،
 * و پیش‌بینی خردایش به مدل Kuz-Ram (Kuznetsov + توزیع Rosin-Rammler با ضریب یکنواختی Cunningham).
 * ⚠️ ثابت‌های K و B در فرمول PPV و ضریب یکنواختی n کاملاً وابسته به سایت‌اند — مقادیر پیش‌فرض
 * فقط نقطه‌ی شروع‌اند؛ برای هر معدن باید با پایش لرزش‌نگاری واقعی کالیبره شوند.
 */

// ————————————————————————— لرزش انفجار (PPV) —————————————————————————
/**
 * فرمول فاصله‌ی مقیاس‌شده: PPV = K × (D/√W)^-B
 * D: فاصله تا نقطه‌ی حساس (m)، W: حداکثر خرج مواد ناریه در هر تأخیر (kg)
 */
export function calcPPV(p) {
  const scaledDistance = p.distanceM / Math.sqrt(p.maxChargePerDelayKg);
  const predictedPpvMmS = p.siteK * (scaledDistance ** -p.siteB);
  const safeDistanceM = Math.sqrt(p.maxChargePerDelayKg) * ((p.siteK / p.allowablePpvMmS) ** (1 / p.siteB));
  const withinLimit = predictedPpvMmS <= p.allowablePpvMmS;
  return { scaledDistance, predictedPpvMmS, safeDistanceM, withinLimit };
}

// ————————————————————————— پیش‌بینی خردایش Kuz-Ram —————————————————————————
// ضریب سنگ A (Kuznetsov) — رایج‌ترین مقادیر آموزشی
export const KUZNETSOV_ROCK_FACTOR = {
  soft: { label: 'نرم/متوسط، کمی درزه‌دار', a: 7 },
  hard: { label: 'سخت، به‌شدت درزه‌دار', a: 10 },
  massive: { label: 'سخت و یکپارچه (کم‌درزه)', a: 13 },
};
// قدرت وزنی نسبی نسبت به آنفو (RWS=100) — مقادیر معمول آموزشی
export const RWS_BY_EXPLOSIVE = { anfo: 100, emulsion: 105, watergel: 100, dynamite: 115 };

/**
 * @param p.rockFactorKey یکی از کلیدهای KUZNETSOV_ROCK_FACTOR
 * @param p.volumePerHoleM3 حجم سنگ هر چال (Burden × Spacing × ارتفاع پله)
 * @param p.chargePerHoleKg خرج هر چال (kg)
 * @param p.rws قدرت وزنی نسبی ماده‌ی ناریه نسبت به آنفو
 * @param p.burdenM, p.spacingM, p.holeDiameterMm برای محاسبه‌ی ضریب یکنواختی n
 */
export function calcKuzRamFragmentation(p) {
  const a = KUZNETSOV_ROCK_FACTOR[p.rockFactorKey].a;
  // X50 بر حسب سانتی‌متر (فرمول کلاسیک Kuznetsov)
  const x50Cm = a * ((p.volumePerHoleM3 / p.chargePerHoleKg) ** 0.8) * (p.chargePerHoleKg ** (1 / 6)) * ((115 / p.rws) ** (19 / 30));

  // ضریب یکنواختی Cunningham — نسخه‌ی ساده‌شده (بدون جمله‌ی خطای حفاری و نسبت طول خرج ستونی؛
  // این دو جمله معمولاً نزدیک ۱ هستند وقتی چال‌ها به‌خوبی حفر و کاملاً پرشده باشند)
  const bOverD = p.burdenM / p.holeDiameterMm; // یادآوری: در این فرمول B متر و D میلی‌متر است (عمداً)
  const n = (2.2 - 14 * bOverD) * Math.sqrt((1 + p.spacingM / p.burdenM) / 2);
  if (n <= 0) throw new Error('ضریب یکنواختی منفی شد — نسبت برم به قطر چال را بررسی کنید (چال خیلی گشاد یا برم خیلی زیاد است)');

  const xAtPercent = (percentPassing) => x50Cm * ((Math.log(100 / (100 - percentPassing)) / Math.log(2)) ** (1 / n));

  return { x50Cm, n, x20Cm: xAtPercent(20), x80Cm: xAtPercent(80) };
}

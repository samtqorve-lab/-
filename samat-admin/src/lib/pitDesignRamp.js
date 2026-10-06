// برآورد حجم اضافیِ بریدن رمپ/جادهٔ دسترسی داخل دیوارهٔ پله‌ها — فقط توابع خالص.
//
// مدل ساده: جاده روی لبهٔ بیرونی هر پله می‌نشیند؛ نیم‌عرض بیرونی‌اش (width/2) باید داخل دیوارهٔ بالاییِ پله بریده شود.
// دیواره با شیب سینهٔ پله بالا می‌رود (ارتفاع در فاصلهٔ x از پای دیواره = x·tanα، حداکثر H). سطح مقطع بریده‌شده:
//   ∫₀^h min(x·tanα, H) dx   (h = نیم‌عرض جاده)
// و حجم = سطح مقطع × مجموع طول افقی پاره‌خط‌های رمپ.
// ⚠️ برآورد هندسی تقریبی است: شیب عرضی، پیچ‌ها (کاهش/افزایش حجم در قوس) و برم‌های کاچ‌بنچ را لحاظ نمی‌کند؛
// برای مقایسه‌ی طرح‌ها/برآورد اولیه است، نه صورت‌وضعیت پیمانکار.

/**
 * @param {{ benches:Array, params:{benchHeight:number,benchFaceAngleDeg:number} }} designResult
 * @param {{ width:number, segments:Array<{horizontalRun:number}> }} ramp
 * @returns {{ crossSectionM2:number, lengthM:number, volumeM3:number }}
 */
export function rampExtraCutEstimate(designResult, ramp) {
  const H = designResult.params.benchHeight;
  const tanA = Math.tan((designResult.params.benchFaceAngleDeg * Math.PI) / 180);
  const h = ramp.width / 2;
  let area;
  if (h * tanA <= H) {
    area = 0.5 * h * h * tanA;
  } else {
    const xc = H / tanA; // از اینجا به بعد ارتفاع دیواره به H می‌رسد
    area = 0.5 * xc * H + (h - xc) * H;
  }
  const lengthM = ramp.segments.reduce((s, g) => s + (Number.isFinite(g.horizontalRun) ? g.horizontalRun : 0), 0);
  return { crossSectionM2: area, lengthM, volumeM3: area * lengthM };
}

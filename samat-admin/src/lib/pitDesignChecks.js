// بررسی‌های «تطبیق طراحی با سایت» برای طراحی پله‌بندی — فقط توابع خالص (بدون DOM)، تا جداگانه تست شوند.
//
// دو خطای واقعی که موتور طراحی (pitDesign.js) خودش نمی‌گیرد:
//  1) پوشش داده: elevationAt بیرون از پوشش توپوگرافی «نزدیک‌ترین نقطه‌ی داده» را برمی‌گرداند. اگر برداشت پهپاد
//     (یا فایل توپوگرافی) کوچک‌تر از لبه‌ی نهایی گودال باشد، تشخیص «برون‌زد» و حجم خاک‌برداری آن بخش اندازه‌گیری
//     نیست بلکه برون‌یابی است — باید صریحاً گزارش شود.
//  2) محدوده‌ی پروانه: لبه‌ی نهایی گودال (بیرونی‌ترین حلقه‌ی طراحی) نباید از مرز قانونی معدن بیرون بزند.
//     ⚠️ فاصله‌ی ایمنی/حریم قانونی از مرز اینجا اعمال نمی‌شود (مقدارش به مقرره‌ی حاکم بستگی دارد)؛ فقط «داخل/بیرون» بودن
//     نسبت به خودِ مرز سنجیده می‌شود.

import { interpolateZ } from './volumeCalc.js';
import { pointInPolygon } from './pitDesign.js';

/** نقاطی روی محیط چندضلعی بسته که فاصله‌ی پیاپی‌شان از step بیشتر نشود (رأس‌ها هم می‌آیند) */
export function densifyClosedPolygon(poly, step = 5) {
  const out = [];
  const st = Math.max(step, 1e-6);
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const k = Math.max(1, Math.ceil(len / st));
    for (let j = 0; j < k; j += 1) {
      const t = j / k;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  return out;
}

/** کمترین فاصله‌ی نقطه تا لبه‌های یک چندضلعی بسته */
export function distanceToPolygonEdges(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const dx = x1 - x0; const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
    if (d < best) best = d;
  }
  return best;
}

/**
 * سهم نقاط محیط چندضلعی که روی داده‌ی واقعی‌اند.
 * @param {(x:number,y:number)=>boolean} isCovered
 */
export function polygonCoverage(isCovered, polygon, step = 5) {
  const pts = densifyClosedPolygon(polygon, step);
  let covered = 0;
  pts.forEach(([x, y]) => { if (isCovered(x, y)) covered += 1; });
  return { total: pts.length, covered, fraction: pts.length ? covered / pts.length : 0 };
}

/** پیش‌فرض «پوشش» برای فایل توپوگرافی: داخل پوشش مثلث‌بندی (TIN) خروجی buildSurface */
export function tinCoverageFn(surface) {
  return (x, y) => Number.isFinite(interpolateZ(surface.idx, surface.coordsFlat, surface.triangles, surface.zvals, x, y));
}

/**
 * چه سهمی از محیط چندضلعی طراحی بیرون از مرز پروانه است و بیشترین فاصله‌ی بیرون‌زدگی.
 * @returns {{ total:number, outside:number, outsideFraction:number, maxOutsideM:number }}
 */
export function boundaryExceedance(designPoly, boundaryPoly, step = 5) {
  const pts = densifyClosedPolygon(designPoly, step);
  let outside = 0; let maxOutsideM = 0;
  pts.forEach(([x, y]) => {
    if (pointInPolygon(x, y, boundaryPoly)) return;
    outside += 1;
    const d = distanceToPolygonEdges(x, y, boundaryPoly);
    if (d > maxOutsideM) maxOutsideM = d;
  });
  return {
    total: pts.length, outside, outsideFraction: pts.length ? outside / pts.length : 0, maxOutsideM,
  };
}

const MAX_SAME_CRS_GAP_M = 20_000;

function centroidOf(poly) {
  return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
}
function centroidDistance(a, b) {
  const ca = centroidOf(a); const cb = centroidOf(b);
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
}

const faNum = (n, d = 0) => Number(n).toLocaleString('fa-IR', { maximumFractionDigits: d });

/**
 * هشدارهای تطبیق طراحی با سایت، به‌صورت متن فارسی آماده‌ی نمایش.
 * @param {{ result: object, isCovered?: (x:number,y:number)=>boolean, boundaryPoly?: number[][]|null,
 *           coverageThreshold?: number }} src result خروجی designBenches
 * @returns {Array<{ level: 'warn'|'bad', text: string }>}
 */
export function buildSiteWarnings({
  result, isCovered, boundaryPoly = null, coverageThreshold = 0.98,
}) {
  const warnings = [];
  const finalPoly = result.benches[result.benches.length - 1].polygon;

  if (isCovered) {
    const cov = polygonCoverage(isCovered, finalPoly);
    if (cov.fraction < coverageThreshold) {
      warnings.push({
        level: cov.fraction < 0.8 ? 'bad' : 'warn',
        text: `فقط ${faNum(cov.fraction * 100)}٪ از لبهٔ نهایی گودال روی داده‌ی توپوگرافی است؛ بیرون از پوشش، ارتفاع زمین برون‌یابی (نزدیک‌ترین نقطه) است و برون‌زد و حجم آن بخش اندازه‌گیری نیست — برداشت را گسترش دهید یا گودال را کوچک‌تر کنید.`,
      });
    }
  }

  if (boundaryPoly && boundaryPoly.length >= 3) {
    // فایل توپوگرافی آپلودی ممکن است در سیستم مختصات دیگری (محلی/زون دیگر) باشد؛ آن‌وقت «بیرون از مرز» بی‌معناست
    const gap = centroidDistance(finalPoly, boundaryPoly);
    const ex = boundaryExceedance(finalPoly, boundaryPoly);
    if (gap > MAX_SAME_CRS_GAP_M) {
      warnings.push({
        level: 'warn',
        text: `مرکز طراحی ${faNum(gap / 1000)} کیلومتر با مرکز محدودهٔ پروانه فاصله دارد؛ ظاهراً توپوگرافی با پروانه هم‌سیستم مختصات نیست، پس بررسی مرز انجام نشد. توپوگرافی را در UTM همان زون معدن بدهید یا از مدل پهپادی استفاده کنید.`,
      });
    } else if (ex.outside > 0) {
      warnings.push({
        level: 'bad',
        text: `لبهٔ نهایی گودال در ${faNum(ex.outsideFraction * 100)}٪ محیطش از محدودهٔ پروانه بیرون می‌زند (بیشینه ${faNum(ex.maxOutsideM, 1)} متر). کف یا شیب را طوری تغییر دهید که طراحی داخل مرز بماند. (فاصلهٔ ایمنی/حریم از مرز در این بررسی اعمال نشده؛ طبق مقرره‌ی حاکم تطبیق دهید.)`,
      });
    }
  }
  return warnings;
}

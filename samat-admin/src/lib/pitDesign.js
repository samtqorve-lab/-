// موتور طراحی پارامتریک پله‌بندی معدن روباز.
//
// روش: از یک چندضلعی کف گودال (در تراز کف) شروع می‌کنیم و در هر تراز (به فاصلهٔ
// ارتفاع پله H)، مرز را به‌سمت بیرون آفست می‌دهیم. دو اصل استاندارد طراحی پله‌بندی
// اینجا رعایت شده:
//
//  1) تفکیک شیب بین‌رمپی (Inter-Ramp Angle, IRA) از شیب کلی نهایی دیواره
//     (Overall Slope Angle, OSA): وقتی چند پلهٔ تکی بدون برم میانی روی هم قرار
//     می‌گیرند (کاچ‌بنچ چندتایی / Double-Triple Benching — پارامتر
//     catchBenchInterval)، شیب محلی دیواره بین دو کاچ‌بنچ برابر شیب سینهٔ پله
//     (IRA) است، اما شیب کلی که برم‌های ایمنی را هم حساب می‌کند (OSA) کمتر است.
//     این دقیقاً همان تمایزی است که در طراحی واقعی معادن روباز به‌کار می‌رود.
//  2) امکان وارد کردن مستقیم «شیب نهایی هدف» به‌جای عرض برم: در این حالت عرض برم
//     لازم برای رسیدن به آن شیب حل می‌شود (solveBermForTargetOSA)؛ اگر برمِ حاصل
//     از حداقل عرض ایمنی (فرمول ریچی) کمتر شود، به‌جای شکستن اصل ایمنی، عرض برم
//     در حداقل ایمن نگه داشته می‌شود و شیب واقعاً قابل‌دستیابی به‌جای شیب درخواستی
//     گزارش می‌شود (نه یک عدد گمراه‌کننده).
//
// ⚠️ مقادیر پیش‌فرض (ارتفاع پله، شیب سینه، فرمول ریچی برای برم) مقادیر متداول
// صنعتی هستند، نه رونوشت مستقیم از متن یک آیین‌نامهٔ خاص. این ابزار توده‌سنگ،
// آب زیرزمینی، لرزه‌خیزی یا پایداری واقعی شیب را تحلیل نمی‌کند — طراحی هندسیِ
// الگویی است، نه تحلیل ژئوتکنیکی. پیش از استفادهٔ عملیاتی حتماً با مهندس
// ژئوتکنیک/معدن و متن دقیق مقررهٔ حاکم تطبیق داده شود.
//
// ⚠️ آفست چندضلعی اینجا با روش «آفست لبه‌به‌لبه» (edge-offset) پیاده شده که برای
// چندضلعی‌های محدب/تقریباً محدب (مثلاً مستطیل کف گودال) درست کار می‌کند؛ برای
// اشکال بسیار نامنظم/فرورفته ممکن است در ترازهای بالا خودتلاقی ایجاد کند.
//
// ⚠️ رمپ/جادهٔ دسترسی (designRamp پایین‌تر): یک مسیر مارپیچیِ الگویی حول دیوارهٔ
// بیرونی گودال است (نه یک بهینه‌سازی مسیر واقعی با شعاع گردش/سرعت طراحی کامیون).
// شیب هر پاره‌خط با تنظیم خودکار طول قدم بر اساس محیط هر پله به شیب درخواستی
// نزدیک می‌شود، اما دقیقاً برابر آن نیست — عدد واقعی در خروجی segments هر پاره‌خط
// گزارش می‌شود؛ پیش از استفادهٔ عملیاتی با مهندس معدن تطبیق دهید.

import Delaunator from 'delaunator';
import { buildTriIndex, interpolateZ } from './volumeCalc.js';

// ---------- پارامترها ----------

export function bermWidthRitchie(benchHeight) {
  // فرمول ریچی (Ritchie, 1963) برای حداقل عرض برم ایمنی: B_min = 0.2H + 4.5 (متر)
  return 0.2 * benchHeight + 4.5;
}

export function benchFaceHorizontal(params) {
  return params.benchHeight / Math.tan((params.benchFaceAngleDeg * Math.PI) / 180);
}

/** واپس‌روی یک پلهٔ تکی با برم کامل (مرجع اطلاعاتی — در کاچ‌بنچ چندتایی فقط هر Nامین پله واقعاً برم می‌گیرد). */
export function benchSetback(params) {
  const berm = params.bermWidthAuto ? bermWidthRitchie(params.benchHeight) : params.bermWidth;
  return benchFaceHorizontal(params) + berm;
}

/** شیب بین‌رمپی (IRA): شیب محلی دیوار بین دو کاچ‌بنچ متوالی، بدون برم میانی — برابر شیب سینهٔ پله. */
export function interRampAngleDeg(params) {
  return params.benchFaceAngleDeg;
}

/**
 * شیب کلی نهایی دیواره (OSA)، با احتساب یک برم کاچ‌بنچ روی ارتفاع یک گروه کامل
 * (H × catchBenchInterval). اگر berm داده نشود، از params.bermWidth/bermWidthAuto
 * محاسبه می‌شود (سازگار با نسخهٔ قبلی — امضای این تابع را تغییر نمی‌دهد).
 */
export function overallSlopeAngleDeg(params, berm) {
  const catchN = Math.max(1, params.catchBenchInterval || 1);
  const combinedH = params.benchHeight * catchN;
  const faceHorizontal = benchFaceHorizontal(params);
  const effectiveBerm = berm != null
    ? berm
    : (params.bermWidthAuto ? bermWidthRitchie(combinedH) : params.bermWidth);
  const totalHorizontal = faceHorizontal * catchN + effectiveBerm;
  return (Math.atan(combinedH / totalHorizontal) * 180) / Math.PI;
}

/**
 * عرض برمِ کاچ‌بنچ لازم برای رسیدن به یک شیب کلی هدف (targetOSADeg)، با ثابت نگه‌داشتن
 * ارتفاع پله/شیب سینه/فاصلهٔ کاچ‌بنچ. اگر برمِ حاصل از حداقل ایمن (ریچی) کمتر شود، به
 * حداقل ایمن محدود می‌شود و شیبِ واقعاً قابل‌دستیابی (achievedOSA، کمتر از هدف) گزارش
 * می‌شود — هرگز ایمنی به‌خاطر رسیدن به یک عدد شیب فدا نمی‌شود.
 */
export function solveBermForTargetOSA(params, targetOSADeg) {
  const catchN = Math.max(1, params.catchBenchInterval || 1);
  const combinedH = params.benchHeight * catchN;
  const faceHorizontal = benchFaceHorizontal(params);
  const neededTotalHorizontal = combinedH / Math.tan((targetOSADeg * Math.PI) / 180);
  const rawBerm = neededTotalHorizontal - faceHorizontal * catchN;
  const minBerm = bermWidthRitchie(combinedH);
  if (rawBerm < minBerm) {
    const achievedOSA = (Math.atan(combinedH / (faceHorizontal * catchN + minBerm)) * 180) / Math.PI;
    return {
      berm: minBerm, achievedOSA, requestedOSA: targetOSADeg, clamped: true,
    };
  }
  return {
    berm: rawBerm, achievedOSA: targetOSADeg, requestedOSA: targetOSADeg, clamped: false,
  };
}

// ---------- سطح زمین (TIN) ----------

/**
 * از ابر نقاط ورودی (x,y,z) یک شاخص مثلث‌بندی‌شده می‌سازد که با elevationAt قابل‌پرس‌وجو است.
 * از همان buildTriIndex/interpolateZ استفاده می‌کند که در volumeCalc.js (محاسبهٔ حجم کات/فیل
 * بین دو نقشه‌برداری) هم به‌کار رفته، تا منطق مثلث‌بندی در دو جای پروژه دوگانه نشود.
 */
export function buildSurface(points) {
  if (!points || points.length < 4) throw new Error('حداقل ۴ نقطه برای ساخت مدل سطح (TIN) لازم است');
  const seen = new Set();
  const pts = [];
  points.forEach((p) => {
    const key = `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    if (!seen.has(key)) { seen.add(key); pts.push(p); }
  });
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  pts.forEach(([x, y, z]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  });
  const coordsFlat = new Float64Array(pts.length * 2);
  const zvals = new Float64Array(pts.length);
  pts.forEach((p, i) => { coordsFlat[i * 2] = p[0]; coordsFlat[i * 2 + 1] = p[1]; zvals[i] = p[2]; });
  const del = new Delaunator(coordsFlat);
  const idx = buildTriIndex(coordsFlat, del.triangles, minX, minY, maxX, maxY);
  return {
    coordsFlat, triangles: del.triangles, zvals, idx, bbox: {
      minX, minY, maxX, maxY, minZ, maxZ,
    },
  };
}

/** ارتفاع طبیعی زمین در یک نقطه؛ اگر بیرون از هال محدب باشد، نزدیک‌ترین نقطهٔ داده برگردانده می‌شود. */
export function elevationAt(surface, x, y) {
  const z = interpolateZ(surface.idx, surface.coordsFlat, surface.triangles, surface.zvals, x, y);
  if (!Number.isNaN(z)) return z;
  let best = Infinity; let bestZ = surface.zvals[0];
  for (let i = 0; i < surface.zvals.length; i += 1) {
    const dx = surface.coordsFlat[i * 2] - x;
    const dy = surface.coordsFlat[i * 2 + 1] - y;
    const d = dx * dx + dy * dy;
    if (d < best) { best = d; bestZ = surface.zvals[i]; }
  }
  return bestZ;
}

// ---------- هندسهٔ چندضلعی ----------

function signedArea(coords) {
  let a = 0;
  for (let i = 0; i < coords.length; i += 1) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[(i + 1) % coords.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function lineIntersect(p1, d1, p2, d2) {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/**
 * آفست یک چندضلعی به‌اندازهٔ distance به سمت بیرون (روش لبه‌به‌لبه — نگاه کنید به هشدار بالای فایل).
 * ترتیب و تعداد رأس‌ها با ورودی یکسان می‌ماند — این تناظر یک‌به‌یک در pitDesign3D.js برای ساخت
 * مشِ سینه/برم بین دو حلقهٔ متوالی استفاده می‌شود.
 */
export function offsetPolygonOutward(coords, distance) {
  const area = signedArea(coords);
  const ccw = area > 0;
  const n = coords.length;
  const offsetLines = [];
  for (let i = 0; i < n; i += 1) {
    const p0 = coords[i];
    const p1 = coords[(i + 1) % n];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    const dir = [dx / len, dy / len];
    const normal = ccw ? [dir[1], -dir[0]] : [-dir[1], dir[0]];
    const offP0 = [p0[0] + normal[0] * distance, p0[1] + normal[1] * distance];
    offsetLines.push({ point: offP0, dir });
  }
  const newCoords = [];
  for (let i = 0; i < n; i += 1) {
    const prev = offsetLines[(i - 1 + n) % n];
    const curr = offsetLines[i];
    newCoords.push(lineIntersect(prev.point, prev.dir, curr.point, curr.dir));
  }
  return newCoords;
}

/** کمک‌تابع: ساخت یک چندضلعی مستطیلی سادهٔ کف گودال حول یک نقطهٔ مرکزی. */
export function rectanglePolygon(center, length, width, angleDeg = 0) {
  const [cx, cy] = center;
  const hl = length / 2; const hw = width / 2;
  const corners = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
  const theta = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(theta); const sin = Math.sin(theta);
  return corners.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
}

function pointInPolygon(x, y, coords) {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i, i += 1) {
    const [xi, yi] = coords[i]; const [xj, yj] = coords[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonArea(coords) {
  return Math.abs(signedArea(coords));
}

function polygonPerimeter(coords) {
  let p = 0;
  for (let i = 0; i < coords.length; i += 1) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[(i + 1) % coords.length];
    p += Math.hypot(x1 - x0, y1 - y0);
  }
  return p;
}

function pointAtPerimeterFraction(coords, frac) {
  const n = coords.length;
  const total = polygonPerimeter(coords) || 1;
  let target = (((frac % 1) + 1) % 1) * total;
  for (let i = 0; i < n; i += 1) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[(i + 1) % n];
    const segLen = Math.hypot(x1 - x0, y1 - y0) || 1e-9;
    if (target <= segLen) {
      const t = target / segLen;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    target -= segLen;
  }
  return coords[0];
}

// ---------- طراحی پله‌بندی ----------

/**
 * تولید پله‌ها از کف گودال تا برون‌زد به سطح زمین طبیعی، با پشتیبانی از کاچ‌بنچ چندتایی
 * و حل‌کردن برم بر اساس شیب نهایی هدف (نگاه کنید به توضیح بالای فایل).
 * @param {object} surface خروجی buildSurface
 * @param {number[][]} bottomPolygon چندضلعی کف گودال [[x,y],...]
 * @param {object} params {
 *   benchHeight, benchFaceAngleDeg, bermWidth, bermWidthAuto, maxBenches, bottomElevation,
 *   catchBenchInterval?: number (پیش‌فرض ۱ = هر پله کاچ‌بنچ است؛ ۲/۳ = کاچ‌بنچ چندتایی),
 *   osaMode?: boolean, targetOSADeg?: number (اگر osaMode باشد، بر bermWidth/bermWidthAuto اولویت دارد)
 * }
 * @returns {{benches:Array, params:object, resolvedBerm:number, osaInfo:object|null}}
 *
 * هر پله هم `polygon` (لبهٔ بیرونی نهایی آن تراز) و هم `faceTopPolygon` (لبهٔ بالای سینهٔ
 * پله، پیش از آفست برم — برای پله‌های غیرکاچ‌بنچ برابر خودِ polygon است چون برمی اعمال
 * نمی‌شود) و `isCatchBench` (آیا در این تراز واقعاً برم ایمنی گرفته شده) را نگه می‌دارد.
 */
export function designBenches(surface, bottomPolygon, params) {
  const catchN = Math.max(1, Math.round(params.catchBenchInterval || 1));
  const faceHorizontal = benchFaceHorizontal(params);

  let berm;
  let osaInfo = null;
  if (params.osaMode) {
    osaInfo = solveBermForTargetOSA(params, params.targetOSADeg);
    berm = osaInfo.berm;
  } else {
    berm = params.bermWidthAuto
      ? bermWidthRitchie(params.benchHeight * catchN)
      : params.bermWidth;
  }

  let bottomElev = params.bottomElevation;
  if (bottomElev == null) {
    const zs = bottomPolygon.map(([x, y]) => elevationAt(surface, x, y));
    bottomElev = Math.min(...zs) - params.benchHeight * 5;
  }

  const benches = [{
    level: 0, elevation: bottomElev, polygon: bottomPolygon, outcropped: false, isCatchBench: false,
  }];
  let currentPoly = bottomPolygon;
  let currentElev = bottomElev;
  const maxBenches = params.maxBenches || 40;

  for (let level = 0; level < maxBenches; level += 1) {
    const nextElev = currentElev + params.benchHeight;
    const isCatch = ((level + 1) % catchN) === 0;
    const faceTop = offsetPolygonOutward(currentPoly, faceHorizontal);
    const grown = isCatch ? offsetPolygonOutward(faceTop, berm) : faceTop;
    const groundZ = grown.map(([x, y]) => elevationAt(surface, x, y));
    const outcropped = groundZ.every((z) => z <= nextElev);

    benches.push({
      level: level + 1,
      elevation: nextElev,
      polygon: grown,
      faceTopPolygon: faceTop,
      outcropped,
      isCatchBench: isCatch,
    });
    currentPoly = grown;
    currentElev = nextElev;

    if (outcropped) break;
    if (currentElev > surface.bbox.maxZ + params.benchHeight) break;
  }

  return {
    benches, params: { ...params, catchBenchInterval: catchN }, resolvedBerm: berm, osaInfo,
  };
}

// ---------- رمپ / جادهٔ دسترسی ----------

/**
 * یک رمپ مارپیچیِ الگویی می‌سازد که از بالاترین پلهٔ ساخته‌شده (برون‌زد یا سقف تعداد پله) تا کف
 * گودال پایین می‌رود، با پیمایش حول لبهٔ بیرونی هر پله. طول قدمِ زاویه‌ای در هر تراز طوری تنظیم
 * می‌شود که فاصلهٔ افقی طی‌شده در آن تراز، تا حد امکان با H/tan(شیب درخواستی) برابر باشد — نه یک
 * بهینه‌سازی مسیر واقعی؛ شیب واقعیِ هر پاره‌خط در segments گزارش می‌شود.
 * @param {object} designResult خروجی designBenches
 * @param {{width?:number, gradePercent?:number, startFraction?:number, direction?:1|-1}} [rampParams]
 * @returns {{width:number, requestedGradePercent:number, centerline:Array, leftEdge:Array, rightEdge:Array, segments:Array, totalLength:number}}
 */
export function designRamp(designResult, rampParams = {}) {
  const {
    width = 8, gradePercent = 10, startFraction = 0, direction = 1,
  } = rampParams;
  const benches = designResult.benches;
  if (benches.length < 2) throw new Error('برای رمپ حداقل یک پله لازم است');
  const H = designResult.params.benchHeight;
  const grade = Math.max(0.5, gradePercent) / 100;
  const requiredRun = H / grade;

  const centerline = [];
  let angle = startFraction;
  for (let i = benches.length - 1; i >= 0; i -= 1) {
    const b = benches[i];
    const [x, y] = pointAtPerimeterFraction(b.polygon, angle);
    centerline.push({
      x, y, z: b.elevation, level: b.level,
    });
    if (i > 0) {
      const perim = polygonPerimeter(b.polygon) || 1;
      const stepFrac = Math.min(0.4, Math.max(0.015, requiredRun / perim));
      angle += stepFrac * direction;
    }
  }

  const half = width / 2;
  const leftEdge = []; const rightEdge = []; const segments = [];
  let totalLength = 0;
  for (let i = 0; i < centerline.length; i += 1) {
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(centerline.length - 1, i + 1)];
    let dx = next.x - prev.x; let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy; const ny = dx;
    const c = centerline[i];
    leftEdge.push({ x: c.x + nx * half, y: c.y + ny * half, z: c.z });
    rightEdge.push({ x: c.x - nx * half, y: c.y - ny * half, z: c.z });
    if (i > 0) {
      const a = centerline[i - 1];
      const runH = Math.hypot(c.x - a.x, c.y - a.y);
      const rise = c.z - a.z;
      totalLength += Math.hypot(runH, rise);
      segments.push({
        fromLevel: a.level,
        toLevel: c.level,
        horizontalRun: runH,
        rise,
        gradePercent: runH > 1e-6 ? (Math.abs(rise) / runH) * 100 : Infinity,
      });
    }
  }

  return {
    width, requestedGradePercent: gradePercent, centerline, leftEdge, rightEdge, segments, totalLength,
  };
}

// ---------- حجم خاک‌برداری ----------

export function computeCutVolume(surface, designResult, cellSize = 2) {
  const benches = designResult.benches;
  const finalPoly = benches[benches.length - 1].polygon;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  finalPoly.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  });
  const pad = cellSize;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const cellArea = cellSize * cellSize;
  let total = 0;
  const perBench = {};

  for (let y = minY; y <= maxY; y += cellSize) {
    for (let x = minX; x <= maxX; x += cellSize) {
      let containIdx = -1;
      for (let i = 0; i < benches.length; i += 1) {
        if (pointInPolygon(x, y, benches[i].polygon)) { containIdx = i; break; }
      }
      if (containIdx === -1) continue;

      const terrainZ = elevationAt(surface, x, y);
      const designElev = containIdx === 0 ? benches[0].elevation : benches[containIdx - 1].elevation;
      const depth = Math.max(0, terrainZ - designElev);
      total += depth * cellArea;
      perBench[containIdx] = (perBench[containIdx] || 0) + depth * cellArea;
    }
  }

  return { totalCutM3: total, perBenchM3: perBench, cellSize };
}

export { polygonArea, pointInPolygon, polygonPerimeter };

// ---------- خروجی‌گیری ----------

export function exportBenchesDXF(designResult) {
  const lines = ['0', 'SECTION', '2', 'ENTITIES'];
  designResult.benches.forEach((b) => {
    const n = b.polygon.length;
    const isFinal = b === designResult.benches[designResult.benches.length - 1];
    lines.push('0', 'LWPOLYLINE', '8', isFinal ? 'FINAL_PIT_CREST' : (b.isCatchBench ? 'CATCH_BENCH' : 'PIT_BENCH'));
    lines.push('90', String(n));
    lines.push('70', '1');
    lines.push('38', String(b.elevation));
    b.polygon.forEach(([x, y]) => {
      lines.push('10', String(x), '20', String(y));
    });
  });
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

export function exportRampDXF(rampResult) {
  const lines = ['0', 'SECTION', '2', 'ENTITIES'];
  const writePolyline3D = (pts, layer) => {
    lines.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '8');
    pts.forEach((p) => {
      lines.push('0', 'VERTEX', '8', layer, '10', String(p.x), '20', String(p.y), '30', String(p.z), '70', '32');
    });
    lines.push('0', 'SEQEND');
  };
  writePolyline3D(rampResult.centerline, 'RAMP_CENTERLINE');
  writePolyline3D(rampResult.leftEdge, 'RAMP_EDGE');
  writePolyline3D(rampResult.rightEdge, 'RAMP_EDGE');
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

/** گزارش CSV پارامترها (شامل IRA/OSA و کاچ‌بنچ) + جدول پله‌ها (+ حجم هر تراز و جدول رمپ). */
export function exportReportCSV(designResult, volumeReport, rampResult) {
  const p = designResult.params;
  const rows = [];
  rows.push(['--- پارامترهای طراحی ---']);
  rows.push(['ارتفاع پلهٔ تکی (H, m)', p.benchHeight]);
  rows.push(['شیب سینهٔ پله (deg)', p.benchFaceAngleDeg]);
  rows.push(['فاصلهٔ کاچ‌بنچ (هر چند پله یک برم)', p.catchBenchInterval || 1]);
  rows.push(['عرض برمِ کاچ‌بنچ (m)', designResult.resolvedBerm.toFixed(2)]);
  rows.push(['شیب بین‌رمپی — IRA (deg)', interRampAngleDeg(p).toFixed(2)]);
  rows.push(['شیب کلی نهایی دیواره — OSA (deg)', overallSlopeAngleDeg(p, designResult.resolvedBerm).toFixed(2)]);
  if (designResult.osaInfo) {
    rows.push(['شیب هدف درخواستی (deg)', designResult.osaInfo.requestedOSA]);
    rows.push(['شیب هدف قابل‌دستیابی بود؟', designResult.osaInfo.clamped ? 'خیر — به حداقل برم ایمنی محدود شد' : 'بله']);
  }
  rows.push([]);
  rows.push(['--- پله‌ها ---']);
  rows.push(['شماره پله', 'تراز ارتفاعی (m)', 'مساحت (m2)', 'کاچ‌بنچ؟', 'برون‌زد به سطح؟', 'حجم برآوردی این تراز (m3)']);
  designResult.benches.forEach((b) => {
    const vol = volumeReport ? (volumeReport.perBenchM3[b.level] || 0) : '';
    rows.push([
      b.level, b.elevation.toFixed(2), polygonArea(b.polygon).toFixed(1),
      b.isCatchBench ? 'بله' : 'خیر', b.outcropped ? 'بله' : 'خیر',
      typeof vol === 'number' ? vol.toFixed(1) : vol,
    ]);
  });
  if (volumeReport) {
    rows.push([]);
    rows.push(['--- حجم کل ---']);
    rows.push(['حجم کل خاک‌برداری (m3)', volumeReport.totalCutM3.toFixed(1)]);
    rows.push(['اندازهٔ سلول شبکهٔ محاسبه (m)', volumeReport.cellSize]);
  }
  if (rampResult) {
    rows.push([]);
    rows.push(['--- رمپ / جادهٔ دسترسی ---']);
    rows.push(['عرض جاده (m)', rampResult.width]);
    rows.push(['شیب درخواستی (%)', rampResult.requestedGradePercent]);
    rows.push(['طول کل مسیر (m)', rampResult.totalLength.toFixed(1)]);
    rows.push(['از پله', 'تا پله', 'فاصلهٔ افقی (m)', 'اختلاف ارتفاع (m)', 'شیب واقعی (%)']);
    rampResult.segments.forEach((s) => {
      rows.push([s.fromLevel, s.toLevel, s.horizontalRun.toFixed(1), s.rise.toFixed(1), Number.isFinite(s.gradePercent) ? s.gradePercent.toFixed(1) : '—']);
    });
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

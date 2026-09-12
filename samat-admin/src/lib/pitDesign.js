// موتور طراحی پارامتریک پله‌بندی معدن روباز.
//
// روش: از یک چندضلعی کف گودال (در تراز کف) شروع می‌کنیم و در هر تراز (به فاصلهٔ
// ارتفاع پله H)، مرز را به‌اندازهٔ «واپس‌روی افقی هر پله»
//     setback = H / tan(bench_face_angle) + berm_width
// به‌سمت بیرون آفست می‌دهیم (شیوهٔ متداول طراحی الگویی/دستی پله‌بندی، نه یک
// بهینه‌سازی اقتصادی مثل Lerchs–Grossmann که به مدل بلوک/عیار نیاز دارد).
// در هر تراز، اگر تمام نقاط مرز از سطح زمین طبیعی فراتر رفتند، رشد آن حلقه
// متوقف می‌شود (برون‌زد به سطح).
//
// ⚠️ مقادیر پیش‌فرض (ارتفاع پله، شیب سینه، فرمول ریچی برای برم) مقادیر متداول
// صنعتی هستند، نه رونوشت مستقیم از متن آیین‌نامهٔ اصول طراحی معادن روباز ایران.
// پیش از استفادهٔ عملیاتی با متن دقیق مقرره و نظر مهندس ناظر تطبیق دهید.
//
// ⚠️ آفست چندضلعی اینجا با روش «آفست لبه‌به‌لبه» (edge-offset) پیاده شده که برای
// چندضلعی‌های محدب/تقریباً محدب (مثلاً مستطیل کف گودال) درست کار می‌کند؛ برای
// اشکال بسیار نامنظم/فرورفته ممکن است در ترازهای بالا خودتلاقی ایجاد کند —
// شبیه محدودیت مشابهی که در نسخهٔ پایتون این ابزار (با shapely.buffer) مستند شده.

import Delaunator from 'delaunator';
import { buildTriIndex, interpolateZ } from './volumeCalc.js';

// ---------- پارامترها ----------

export function bermWidthRitchie(benchHeight) {
  // فرمول ریچی (Ritchie, 1963) برای حداقل عرض برم ایمنی: B_min = 0.2H + 4.5 (متر)
  return 0.2 * benchHeight + 4.5;
}

export function benchSetback(params) {
  const berm = params.bermWidthAuto ? bermWidthRitchie(params.benchHeight) : params.bermWidth;
  const faceHorizontal = params.benchHeight / Math.tan((params.benchFaceAngleDeg * Math.PI) / 180);
  return faceHorizontal + berm;
}

export function overallSlopeAngleDeg(params) {
  const setback = benchSetback(params);
  return (Math.atan(params.benchHeight / setback) * 180) / Math.PI;
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
  // برون‌یابی ساده: نزدیک‌ترین نقطهٔ ورودی (برای نقاط بیرون از هال محدب مثلث‌بندی)
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
  // تقاطع دو خط بی‌نهایت به‌صورت نقطه+بردار جهت؛ اگر تقریباً موازی باشند، میانگین دو نقطه برگردانده می‌شود
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/**
 * آفست یک چندضلعی به‌اندازهٔ distance به سمت بیرون (روش لبه‌به‌لبه — نگاه کنید به هشدار بالای فایل).
 * coords: آرایه‌ای از [x,y]، بدون نقطهٔ تکراری پایانی.
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
    // نرمال بیرونی: برای چندضلعی CCW چرخش -۹۰ درجه‌ی جهت لبه؛ برای CW برعکس
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

// ---------- طراحی پله‌بندی ----------

/**
 * تولید پله‌ها از کف گودال تا برون‌زد به سطح زمین طبیعی.
 * @param {object} surface خروجی buildSurface
 * @param {number[][]} bottomPolygon چندضلعی کف گودال [[x,y],...]
 * @param {object} params { benchHeight, benchFaceAngleDeg, bermWidth, bermWidthAuto, maxBenches, bottomElevation }
 * @returns {{benches: Array<{level:number, elevation:number, polygon:number[][], outcropped:boolean}>}}
 */
export function designBenches(surface, bottomPolygon, params) {
  const setback = benchSetback(params);
  let bottomElev = params.bottomElevation;
  if (bottomElev == null) {
    const zs = bottomPolygon.map(([x, y]) => elevationAt(surface, x, y));
    bottomElev = Math.min(...zs) - params.benchHeight * 5;
  }

  const benches = [{
    level: 0, elevation: bottomElev, polygon: bottomPolygon, outcropped: false,
  }];
  let currentPoly = bottomPolygon;
  let currentElev = bottomElev;
  const maxBenches = params.maxBenches || 40;

  for (let level = 0; level < maxBenches; level += 1) {
    const nextElev = currentElev + params.benchHeight;
    const grown = offsetPolygonOutward(currentPoly, setback);
    const groundZ = grown.map(([x, y]) => elevationAt(surface, x, y));
    const outcropped = groundZ.every((z) => z <= nextElev);

    benches.push({
      level: level + 1, elevation: nextElev, polygon: grown, outcropped,
    });
    currentPoly = grown;
    currentElev = nextElev;

    if (outcropped) break;
    if (currentElev > surface.bbox.maxZ + params.benchHeight) break; // ایمنی؛ در ادامه maxZ ست می‌شود
  }

  return { benches, params };
}

// ---------- حجم خاک‌برداری ----------

/**
 * حجم خاک‌برداری با تفاضل رستری بین زمین طبیعی و سطح پله‌ای طراحی‌شده.
 * برای هر سلول شبکه، ارتفاع طراحی = تراز پلهٔ زیرین (annulus) بین دو حلقهٔ متوالی که آن نقطه
 * را دربر می‌گیرند؛ سقف با min(terrain, design) اعمال می‌شود تا حجم منفی تولید نشود.
 */
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
      // کوچک‌ترین حلقه‌ای که این نقطه را دربر می‌گیرد پیدا می‌شود
      let containIdx = -1;
      for (let i = 0; i < benches.length; i += 1) {
        if (pointInPolygon(x, y, benches[i].polygon)) { containIdx = i; break; }
      }
      if (containIdx === -1) continue; // بیرون از پوستهٔ نهایی؛ دست‌نخورده

      const terrainZ = elevationAt(surface, x, y);
      const designElev = containIdx === 0 ? benches[0].elevation : benches[containIdx - 1].elevation;
      const depth = Math.max(0, terrainZ - designElev);
      total += depth * cellArea;
      perBench[containIdx] = (perBench[containIdx] || 0) + depth * cellArea;
    }
  }

  return { totalCutM3: total, perBenchM3: perBench, cellSize };
}

export { polygonArea, pointInPolygon };

// ---------- خروجی‌گیری ----------

/**
 * ساخت متن خام DXF (ASCII، بدون کتابخانه) شامل یک LWPOLYLINE بسته برای هر پله در تراز ارتفاعی
 * خودش (با اِلیوِیشن روی خودِ LWPOLYLINE)، قابل‌باز شدن مستقیم در AutoCAD/Civil3D.
 */
export function exportBenchesDXF(designResult) {
  const lines = ['0', 'SECTION', '2', 'ENTITIES'];
  designResult.benches.forEach((b) => {
    const n = b.polygon.length;
    lines.push('0', 'LWPOLYLINE', '8', b === designResult.benches[designResult.benches.length - 1] ? 'FINAL_PIT_CREST' : 'PIT_BENCHES');
    lines.push('90', String(n)); // تعداد رأس
    lines.push('70', '1'); // ۱ = بسته (closed)
    lines.push('38', String(b.elevation)); // elevation
    b.polygon.forEach(([x, y]) => {
      lines.push('10', String(x), '20', String(y));
    });
  });
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

/** گزارش CSV پارامترها + جدول پله‌ها (+ حجم هر تراز، در صورت وجود). */
export function exportReportCSV(designResult, volumeReport) {
  const p = designResult.params;
  const rows = [];
  rows.push(['--- پارامترهای طراحی ---']);
  rows.push(['ارتفاع پله (H, m)', p.benchHeight]);
  rows.push(['شیب سینهٔ پله (deg)', p.benchFaceAngleDeg]);
  rows.push(['عرض برم ایمنی (m)', p.bermWidthAuto ? bermWidthRitchie(p.benchHeight).toFixed(2) : p.bermWidth]);
  rows.push(['واپس‌روی هر پله (m)', benchSetback(p).toFixed(2)]);
  rows.push(['شیب کلی دیوارهٔ نهایی (deg)', overallSlopeAngleDeg(p).toFixed(2)]);
  rows.push([]);
  rows.push(['--- پله‌ها ---']);
  rows.push(['شماره پله', 'تراز ارتفاعی (m)', 'مساحت (m2)', 'برون‌زد به سطح؟', 'حجم برآوردی این تراز (m3)']);
  designResult.benches.forEach((b) => {
    const vol = volumeReport ? (volumeReport.perBenchM3[b.level] || 0) : '';
    rows.push([b.level, b.elevation.toFixed(2), polygonArea(b.polygon).toFixed(1), b.outcropped ? 'بله' : 'خیر', typeof vol === 'number' ? vol.toFixed(1) : vol]);
  });
  if (volumeReport) {
    rows.push([]);
    rows.push(['--- حجم کل ---']);
    rows.push(['حجم کل خاک‌برداری (m3)', volumeReport.totalCutM3.toFixed(1)]);
    rows.push(['اندازهٔ سلول شبکهٔ محاسبه (m)', volumeReport.cellSize]);
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

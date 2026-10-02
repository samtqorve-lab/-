// تحلیل سطح مدل سه‌بعدی پهباد (مساحت/حجم پلیگون، مقطع، شیب، مقایسه‌ی دو پرواز) — فقط توابع خالص، بدون DOM و بدون
// THREE، تا جداگانه تست شوند. مختصات همه‌جا ENU محلی به متر است: (x=شرق، y=شمال، z=ارتفاع) — دقیقاً همان
// قرارداد volumeCalc.js (coordsFlat = x,y درهم‌تنیده؛ zvals = ارتفاع؛ triangles = اندیس سه‌تایی‌ها).
//
// ⚠️ همه‌ی نتایج «برآورد اولیه» از روی مش فتوگرامتری‌اند؛ دقت به کیفیت مدل (GCP/RTK، پوشش عکس‌ها) و نرخ نمونه‌برداری
// بستگی دارد و جایگزین نقشه‌برداری رسمی نیستند.

import { buildTriIndex, interpolateZ, computeSlopeStats } from './volumeCalc.js';

/**
 * ایندکس مکانی روی مثلث‌های مش می‌سازد تا ارتفاع هر نقطه‌ی (x,y) سریع میان‌یابی شود.
 * @param {Float64Array} coordsFlat x0,y0,x1,y1,...
 * @param {Uint32Array|number[]} triangles
 * @param {Float64Array|Float32Array|number[]} zvals
 */
export function buildSurface(coordsFlat, triangles, zvals) {
  const n = zvals.length;
  if (!n || coordsFlat.length !== n * 2) throw new Error('داده‌ی سطح نامعتبر است');
  if (!triangles.length || triangles.length % 3) throw new Error('مثلثی در مدل پیدا نشد');
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = coordsFlat[i * 2]; const y = coordsFlat[i * 2 + 1]; const z = zvals[i];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const triCount = triangles.length / 3;
  // تقریباً ۲ مثلث در هر خانه؛ سقف برای حافظه‌ی موبایل (۷۰۰×۷۰۰ خانه)
  const cells = Math.min(700, Math.max(40, Math.ceil(Math.sqrt(triCount / 2))));
  const idx = buildTriIndex(coordsFlat, triangles, minX, minY, maxX, maxY, cells);
  return {
    coordsFlat,
    triangles,
    zvals,
    idx,
    vertexCount: n,
    triangleCount: triCount,
    bbox: {
      minX, maxX, minY, maxY, minZ, maxZ,
    },
  };
}

/** ارتفاع سطح در نقطه‌ی (x,y)؛ NaN اگر بیرون از مش باشد */
export function heightAt(surface, x, y) {
  return interpolateZ(surface.idx, surface.coordsFlat, surface.triangles, surface.zvals, x, y);
}

// ───────────────────────── هندسه‌ی پلیگون/مسیر ─────────────────────────

/** مساحت افقی پلیگون (شولیس) */
export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

export function polygonPerimeter(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    s += Math.hypot(x1 - x0, y1 - y0);
  }
  return s;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** طول مسیر سه‌بعدی (نقاط [x,y,z]) */
export function polylineLength3D(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) {
    s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  }
  return s;
}

/** مسیر (باز یا بسته) را طوری ریز می‌کند که فاصله‌ی نقاط پیاپی از step بیشتر نشود */
export function densifyPath(pts, step, closed = false) {
  const out = [];
  const n = closed ? pts.length : pts.length - 1;
  const st = Math.max(step, 1e-6);
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / st));
    for (let j = 0; j < k; j += 1) {
      const t = j / k;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (!closed && pts.length) out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/**
 * صفحه‌ی z = a·x + b·y + c را با کمترین مربعات از نقاط [x,y,z] برازش می‌کند.
 * @returns {{a:number,b:number,c:number,rmse:number}|null} null اگر نقاط کمتر از ۳ تا یا هم‌خط باشند
 */
export function fitPlane(samples) {
  const n = samples.length;
  if (n < 3) return null;
  let mx = 0; let my = 0; let mz = 0;
  samples.forEach(([x, y, z]) => { mx += x; my += y; mz += z; });
  mx /= n; my /= n; mz /= n;
  let sxx = 0; let sxy = 0; let syy = 0; let sxz = 0; let syz = 0;
  samples.forEach(([x, y, z]) => {
    const dx = x - mx; const dy = y - my; const dz = z - mz;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz;
  });
  const det = sxx * syy - sxy * sxy;
  if (!(Math.abs(det) > 1e-9 * Math.max(1e-12, (sxx + syy) ** 2))) return null;
  const a = (sxz * syy - syz * sxy) / det;
  const b = (syz * sxx - sxz * sxy) / det;
  const c = mz - a * mx - b * my;
  let sq = 0;
  samples.forEach(([x, y, z]) => { sq += (z - (a * x + b * y + c)) ** 2; });
  return {
    a, b, c, rmse: Math.sqrt(sq / n),
  };
}

export const VOLUME_BASES = ['plane', 'min', 'mean', 'level'];

/**
 * حجم بالا و پایین یک «سطح مبنا» داخل پلیگون (مثلاً حجم یک توده/انبار روی زمین).
 * مبنا: plane = صفحه‌ی برازش‌شده از ارتفاع‌های محیط پلیگون روی مدل (پیش‌فرض؛ برای زمین شیب‌دار هم درست است)،
 *       min = پایین‌ترین نقطه‌ی محیط، mean = میانگین محیط، level = تراز افقی دلخواه (`level`، هم‌مقیاس با z سطح).
 * روش: شبکه‌ی منظم از خانه‌های cell×cell؛ هر خانه‌ی داخل پلیگون ارتفاع سطح را از مش می‌گیرد؛ مجموع (ارتفاع − مبنا)×مساحت.
 * جمع حجم‌ها در نسبت (مساحت دقیق پلیگون ÷ مساحت خانه‌های داخل) ضرب می‌شود تا خطای گسسته‌سازی لبه‌ها خنثی شود.
 * @returns {{ area:number, perimeter:number, cell:number, insideCells:number, validCells:number, coverage:number,
 *             above:number, below:number, net:number, maxHeight:number, base:object }}
 */
export function polygonVolume(surface, poly, {
  base = 'plane', level = 0, maxCells = 40000, minCell = 0.02,
} = {}) {
  if (!poly || poly.length < 3) throw new Error('حداقل ۳ نقطه برای پلیگون لازم است');
  if (!VOLUME_BASES.includes(base)) throw new Error('نوع سطح مبنا نامعتبر است');
  const area = polygonArea(poly);
  if (!(area > 0)) throw new Error('مساحت پلیگون صفر است — نقاط را روی یک خط نگذارید');
  const perimeter = polygonPerimeter(poly);

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  poly.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  });
  const bboxArea = Math.max((maxX - minX) * (maxY - minY), 1e-9);
  const cell = Math.max(minCell, Math.sqrt(bboxArea / maxCells));

  // ارتفاع‌های محیط پلیگون روی مدل → مبنا
  const ring = densifyPath(poly, Math.max(cell * 2, perimeter / 1500), true);
  const boundary = [];
  ring.forEach(([x, y]) => {
    const z = heightAt(surface, x, y);
    if (Number.isFinite(z)) boundary.push([x, y, z]);
  });
  let baseFn;
  const baseInfo = { type: base };
  if (base === 'level') {
    if (!Number.isFinite(level)) throw new Error('تراز مبنا نامعتبر است');
    baseFn = () => level;
    baseInfo.level = level;
  } else {
    if (boundary.length < 3) throw new Error('محیط پلیگون روی مدل نیست — نقاط را روی خود مدل بزنید');
    if (base === 'plane') {
      const p = fitPlane(boundary);
      if (!p) throw new Error('نقاط محیط هم‌خط‌اند؛ نمی‌توان صفحه‌ی مبنا ساخت');
      baseFn = (x, y) => p.a * x + p.b * y + p.c;
      baseInfo.plane = p;
    } else if (base === 'min') {
      const z0 = Math.min(...boundary.map((p) => p[2]));
      baseFn = () => z0;
      baseInfo.level = z0;
    } else {
      const z0 = boundary.reduce((s, p) => s + p[2], 0) / boundary.length;
      baseFn = () => z0;
      baseInfo.level = z0;
    }
  }

  const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell));
  const cellArea = cell * cell;
  let insideCells = 0; let validCells = 0; let above = 0; let below = 0; let maxHeight = 0;
  for (let j = 0; j < ny; j += 1) {
    const y = minY + (j + 0.5) * cell;
    for (let i = 0; i < nx; i += 1) {
      const x = minX + (i + 0.5) * cell;
      if (!pointInPolygon(x, y, poly)) continue;
      insideCells += 1;
      const z = heightAt(surface, x, y);
      if (!Number.isFinite(z)) continue;
      validCells += 1;
      const d = z - baseFn(x, y);
      if (d > 0) { above += d * cellArea; if (d > maxHeight) maxHeight = d; } else below += -d * cellArea;
    }
  }
  if (!insideCells) throw new Error('پلیگون خیلی کوچک است');
  const norm = area / (insideCells * cellArea);
  above *= norm; below *= norm;
  return {
    area,
    perimeter,
    cell,
    insideCells,
    validCells,
    coverage: validCells / insideCells,
    above,
    below,
    net: above - below,
    maxHeight,
    base: baseInfo,
  };
}

// ───────────────────────── مقطع (پروفیل) ─────────────────────────

/**
 * ارتفاع سطح را روی خط مستقیم a→b نمونه می‌گیرد.
 * @param {[number,number]} a @param {[number,number]} b نقاط (x,y)
 * @returns {{ length:number, samples:Array<{d:number,x:number,y:number,z:number}>, minZ:number, maxZ:number, maxSlopeDeg:number, validCount:number }}
 */
export function profileAlong(surface, a, b, step = 1) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(length > 0)) throw new Error('دو نقطه‌ی مقطع نباید یکی باشند');
  const n = Math.min(800, Math.max(2, Math.ceil(length / Math.max(step, 1e-6))));
  const samples = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const z = heightAt(surface, x, y);
    samples.push({
      d: t * length, x, y, z: Number.isFinite(z) ? z : NaN,
    });
  }
  const valid = samples.filter((s) => Number.isFinite(s.z));
  let minZ = Infinity; let maxZ = -Infinity; let maxSlopeDeg = 0;
  valid.forEach((s) => { if (s.z < minZ) minZ = s.z; if (s.z > maxZ) maxZ = s.z; });
  for (let i = 1; i < samples.length; i += 1) {
    const p = samples[i - 1]; const q = samples[i];
    if (!Number.isFinite(p.z) || !Number.isFinite(q.z)) continue;
    const deg = (Math.atan2(Math.abs(q.z - p.z), q.d - p.d) * 180) / Math.PI;
    if (deg > maxSlopeDeg) maxSlopeDeg = deg;
  }
  return {
    length,
    samples,
    minZ: valid.length ? minZ : NaN,
    maxZ: valid.length ? maxZ : NaN,
    maxSlopeDeg,
    validCount: valid.length,
  };
}

const num = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '');

/**
 * CSV مقطع. offset=[E,N,U] (مبدأ RTC) اگر داده شود ستون‌ها مختصات UTM مطلق‌اند، وگرنه محلی.
 */
export function profileToCsv(samples, offset = null) {
  const abs = Array.isArray(offset);
  const rows = [abs ? 'station_m,easting,northing,elevation_m' : 'station_m,x_local,y_local,z_local'];
  samples.forEach((s) => {
    rows.push([
      num(s.d, 2),
      num(s.x + (abs ? offset[0] : 0), 2),
      num(s.y + (abs ? offset[1] : 0), 2),
      num(s.z + (abs ? offset[2] : 0), 3),
    ].join(','));
  });
  return `${rows.join('\r\n')}\r\n`;
}

/**
 * DXF (قالب ساده‌ی R12 که AutoCAD/BricsCAD/LibreCAD می‌خوانند): مقطع به‌صورت POLYLINE با X = فاصله‌ی افقی از ابتدا
 * و Y = ارتفاع. نقاط بدون داده (بیرون از مدل) مقطع را به چند POLYLINE جدا می‌شکنند.
 */
export function profileToDxf(samples, { layer = 'PROFILE', elevationOffset = 0 } = {}) {
  const parts = [];
  let cur = [];
  samples.forEach((s) => {
    if (Number.isFinite(s.z)) cur.push(s);
    else { if (cur.length) parts.push(cur); cur = []; }
  });
  if (cur.length) parts.push(cur);
  const safeLayer = String(layer).replace(/[^A-Za-z0-9_]/g, '_') || 'PROFILE';
  const lines = ['0', 'SECTION', '2', 'ENTITIES'];
  parts.filter((p) => p.length >= 2).forEach((p) => {
    lines.push('0', 'POLYLINE', '8', safeLayer, '66', '1', '70', '0');
    p.forEach((s) => {
      lines.push('0', 'VERTEX', '8', safeLayer, '10', (s.d).toFixed(3), '20', (s.z + elevationOffset).toFixed(3), '30', '0');
    });
    lines.push('0', 'SEQEND', '8', safeLayer);
  });
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return `${lines.join('\r\n')}\r\n`;
}

// ───────────────────────── شیب ─────────────────────────

const COLOR_GENTLE = [0.25, 0.68, 0.34];
const COLOR_MID = [0.96, 0.74, 0.18];
const COLOR_STEEP = [0.86, 0.2, 0.15];
const COLOR_NONE = [0.45, 0.45, 0.45];

/**
 * رنگ هر رأس از میانگین شیب مثلث‌های اطراف آن: سبز < gentle ≤ زرد < steep ≤ قرمز (درجه).
 * ⚠️ غربالگری اولیه است (همان هشدار computeSlopeStats)؛ آستانه‌ها بسته به جنس سنگ/خاک فرق می‌کنند.
 * @returns {{ colors: Float32Array, maxSlopeDeg:number, steepAreaPct:number, steepTriCount:number, totalTriCount:number }}
 */
export function slopeVertexColors(surface, { gentle = 30, steep = 45 } = {}) {
  const stats = computeSlopeStats(surface, steep);
  const V = surface.vertexCount;
  const sum = new Float64Array(V);
  const cnt = new Uint32Array(V);
  const tri = surface.triangles;
  const { coordsFlat } = surface;
  let steepArea = 0; let totalArea = 0;
  for (let t = 0; t < stats.totalTriCount; t += 1) {
    const s = stats.slopeDeg[t];
    const i0 = tri[t * 3]; const i1 = tri[t * 3 + 1]; const i2 = tri[t * 3 + 2];
    sum[i0] += s; cnt[i0] += 1;
    sum[i1] += s; cnt[i1] += 1;
    sum[i2] += s; cnt[i2] += 1;
    const area = Math.abs((coordsFlat[i1 * 2] - coordsFlat[i0 * 2]) * (coordsFlat[i2 * 2 + 1] - coordsFlat[i0 * 2 + 1])
      - (coordsFlat[i2 * 2] - coordsFlat[i0 * 2]) * (coordsFlat[i1 * 2 + 1] - coordsFlat[i0 * 2 + 1])) / 2;
    totalArea += area;
    if (s >= steep) steepArea += area;
  }
  const colors = new Float32Array(V * 3);
  for (let i = 0; i < V; i += 1) {
    let c = COLOR_NONE;
    if (cnt[i]) {
      const avg = sum[i] / cnt[i];
      if (avg >= steep) c = COLOR_STEEP; else if (avg >= gentle) c = COLOR_MID; else c = COLOR_GENTLE;
    }
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }
  return {
    colors,
    maxSlopeDeg: stats.maxSlopeDeg,
    steepAreaPct: totalArea > 0 ? (steepArea / totalArea) * 100 : 0,
    steepTriCount: stats.steepCount,
    totalTriCount: stats.totalTriCount,
  };
}

// ───────────────────────── مقایسه‌ی دو سطح ─────────────────────────

function percentileAbs(values, p) {
  const arr = [];
  const step = Math.max(1, Math.floor(values.length / 20000));
  for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) arr.push(Math.abs(values[i]));
  if (!arr.length) return 0;
  arr.sort((x, y) => x - y);
  return arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
}

function median(values) {
  const arr = [];
  const step = Math.max(1, Math.floor(values.length / 20000));
  for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) arr.push(values[i]);
  if (!arr.length) return NaN;
  arr.sort((x, y) => x - y);
  return arr[Math.floor(arr.length / 2)];
}

/**
 * سطح `cur` را با سطح مرجع `ref` مقایسه می‌کند (dz = cur − ref؛ منفی = برداشت/کات، مثبت = افزوده/فیل — مثل volumeCalc).
 * shift=[dE,dN,dU]: آنچه به مختصات محلی cur اضافه می‌شود تا در دستگاه مختصات ref بنشیند (اختلاف مبدأهای RTC).
 * zBias: ثابتی که به ارتفاع cur اضافه می‌شود (برای تصحیح اختلاف ارتفاعیِ سیستماتیک دو پرواز).
 * حجم‌ها از روی مثلث‌بندیِ خودِ cur: مساحت افقی × میانگین dz سه رأس، فقط مثلث‌هایی که هر سه رأسشان داخل ref است.
 */
export function compareSurfaces(cur, ref, { shift = [0, 0, 0], zBias = 0 } = {}) {
  const V = cur.vertexCount;
  const dz = new Float32Array(V).fill(NaN);
  for (let i = 0; i < V; i += 1) {
    const x = cur.coordsFlat[i * 2] + shift[0];
    const y = cur.coordsFlat[i * 2 + 1] + shift[1];
    const rz = heightAt(ref, x, y);
    if (Number.isFinite(rz)) dz[i] = cur.zvals[i] + shift[2] + zBias - rz;
  }
  let cut = 0; let fill = 0; let covered = 0; let total = 0;
  const tri = cur.triangles;
  const c = cur.coordsFlat;
  for (let t = 0; t < cur.triangleCount; t += 1) {
    const i0 = tri[t * 3]; const i1 = tri[t * 3 + 1]; const i2 = tri[t * 3 + 2];
    const area = Math.abs((c[i1 * 2] - c[i0 * 2]) * (c[i2 * 2 + 1] - c[i0 * 2 + 1])
      - (c[i2 * 2] - c[i0 * 2]) * (c[i1 * 2 + 1] - c[i0 * 2 + 1])) / 2;
    total += area;
    const d0 = dz[i0]; const d1 = dz[i1]; const d2 = dz[i2];
    if (Number.isNaN(d0) || Number.isNaN(d1) || Number.isNaN(d2)) continue;
    covered += area;
    const v = area * ((d0 + d1 + d2) / 3);
    if (v < 0) cut -= v; else fill += v;
  }
  return {
    dz,
    cut,
    fill,
    net: fill - cut,
    coveredArea: covered,
    totalArea: total,
    coverage: total > 0 ? covered / total : 0,
    medianDz: median(dz),
    p95Abs: percentileAbs(dz, 95),
  };
}

/**
 * رنگ هر رأس از dz: قرمز = پایین‌تر شده (برداشت)، آبی = بالاتر (افزوده)، سفید ≈ بدون تغییر، خاکستری = بدون داده.
 * range: مقدار dz (متر) که رنگ در آن کاملاً اشباع می‌شود.
 */
export function diffVertexColors(dz, range) {
  const r = Math.max(range, 1e-6);
  const colors = new Float32Array(dz.length * 3);
  for (let i = 0; i < dz.length; i += 1) {
    const d = dz[i];
    let rr; let gg; let bb;
    if (Number.isNaN(d)) { [rr, gg, bb] = COLOR_NONE; } else {
      const t = Math.min(1, Math.abs(d) / r);
      if (d < 0) { rr = 1; gg = 1 - t; bb = 1 - t; } else { rr = 1 - t; gg = 1 - t; bb = 1; }
    }
    colors[i * 3] = rr; colors[i * 3 + 1] = gg; colors[i * 3 + 2] = bb;
  }
  return colors;
}

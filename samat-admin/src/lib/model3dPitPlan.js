// طراحی خودکار پله‌بندی (بنچ) و رمپ روی توپوگرافی «مدل سه‌بعدی پهپادی»، بر اساس مشخصات پروانه‌ی معدن —
// فقط منطق خالص (ENU محلی، متر)، بدون DOM و بدون THREE تا جداگانه تست شود. رسم سه‌بعدی در model3dPitPlanViewer.js است.
//
// موتور هندسی همان pitDesign.js است (آفست پله‌ها، کاچ‌بنچ، فرمول ریچی، رمپ مارپیچ، حجم) تا منطق طراحی در دو جای پروژه
// دوگانه نشود؛ این فایل سه کار اضافه می‌کند:
//   ۱) مشخصات پروانه (گروه ماده، ذخیره، وزن مخصوص، ...) را به «حجم هدف» و پارامترهای پیش‌فرض طراحی تبدیل می‌کند.
//   ۲) از روی خودِ توپوگرافی مدل (شیب، پستی‌وبلندی) نوع معدن را پیشنهاد می‌دهد و طراحی را در محدوده‌ی پروانه جا می‌دهد:
//        • pit      گودالی: کف گودال در مرکز محدوده؛ عمق از روی ذخیره حل می‌شود و لبه‌ی نهایی باید داخل پروانه بماند.
//        • hillside دامنه‌ای (کواری): سکوی پایین دامنه (پنجه) + پله‌ها به‌سمت بالادست؛ تراز پنجه از روی ذخیره حل می‌شود.
//        • layered  لایه‌ای: برداشت لایه‌به‌لایه‌ی کم‌عمق روی کل محدوده (ارتفاع پله‌ی کوچک‌تر، سقف عمق = ضخامت لایه).
//   ۳) هندسه‌ی رسم را می‌سازد؛ بخش‌هایی از پله که روی زمین واقعی «در هوا» می‌افتند (پایین‌دست دامنه) حذف می‌شوند.
//
// ⚠️ پیش‌فرض‌های ارتفاع پله/شیب سینه برای هر گروه ماده مقادیر متداول صنعتی‌اند، نه متن آیین‌نامه؛ همه قابل ویرایش‌اند.
// ⚠️ «حجم هدف» از ذخیره‌ی قطعی ÷ وزن مخصوص به‌دست می‌آید و همه‌ی حجم خاک‌برداری را ماده‌ی معدنی فرض می‌کند (بدون باطله/
// ضریب بازیابی). طراحی فقط هندسه‌ی الگویی است و جایگزین طراحی مهندس معدن و ژئوتکنیک نیست.
// ⚠️ مثل pitDesign.js، آفست پله‌ها «لبه‌به‌لبه» است و برای چندضلعی‌های محدب/تقریباً محدب درست کار می‌کند.

import {
  buildSurface as buildTin, designBenches, designRamp, computeCutVolume, offsetPolygonOutward,
  polygonArea, pointInPolygon, interRampAngleDeg, overallSlopeAngleDeg, benchFaceHorizontal,
  exportBenchesDXF, exportRampDXF, exportReportCSV,
} from './pitDesign.js';
import { fitPlane } from './model3dAnalysis.js';

// ───────────────────────── مشخصات پروانه ─────────────────────────

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/** عدد را از متن فارسی/انگلیسی (با جداکننده‌ی هزارگان) می‌خواند؛ نبود یا نامعتبر → null */
export function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = normalizeDigits(v).replace(/[٬,،\s]/g, '').replace(/٫/g, '.');
  const m = /-?\d+(\.\d+)?/.exec(s);
  return m ? parseFloat(m[0]) : null;
}

/** «گروه ۳ - ...» → 3 */
export function detectGroup(dasteh) {
  const m = /گروه\s*([0-9])/.exec(normalizeDigits(dasteh || ''));
  return m ? Number(m[1]) : null;
}

/** پارامترهای شروع طراحی به‌تفکیک گروه ماده (مقادیر متداول؛ نه مقرره) */
export const GROUP_PRESETS = {
  1: {
    label: 'شن، ماسه و خاک رس', benchHeight: 5, benchFaceAngleDeg: 55, catchBenchInterval: 1, rampWidth: 8, rampGradePercent: 8, defaultSG: 1.8,
  },
  2: {
    label: 'سنگ لاشه ساختمانی', benchHeight: 8, benchFaceAngleDeg: 70, catchBenchInterval: 1, rampWidth: 8, rampGradePercent: 10, defaultSG: 2.6,
  },
  3: {
    label: 'آهک، گچ، نمک، مارن و ...', benchHeight: 10, benchFaceAngleDeg: 65, catchBenchInterval: 1, rampWidth: 10, rampGradePercent: 8, defaultSG: 2.4,
  },
  4: {
    label: 'سنگ‌های تزیینی و نما', benchHeight: 4, benchFaceAngleDeg: 75, catchBenchInterval: 1, rampWidth: 6, rampGradePercent: 10, defaultSG: 2.7,
  },
  5: {
    label: 'طبقه دو غیرفلزی', benchHeight: 10, benchFaceAngleDeg: 70, catchBenchInterval: 1, rampWidth: 10, rampGradePercent: 8, defaultSG: 2.5,
  },
  6: {
    label: 'طبقه دو فلزی و زغال‌سنگ', benchHeight: 12, benchFaceAngleDeg: 70, catchBenchInterval: 2, rampWidth: 12, rampGradePercent: 8, defaultSG: 2.8,
  },
};
export const DEFAULT_PRESET = {
  label: 'نامشخص', benchHeight: 8, benchFaceAngleDeg: 65, catchBenchInterval: 1, rampWidth: 8, rampGradePercent: 10, defaultSG: 2.5,
};

/**
 * مشخصات طراحی‌مؤثر را از رکورد معدن (کلیدهای فارسی sections.js) می‌خواند.
 * @returns {{ material:string, group:number|null, preset:object, reserveTons:number|null, probableTons:number|null,
 *   annualTons:number|null, years:number|null, areaKm2:number|null, volumeUnit:boolean, sg:number, sgAssumed:boolean,
 *   volumes:{reserveM3:number|null, probableM3:number|null, termM3:number|null} }}
 */
export function licenseSpecFromRecord(rec = {}) {
  const group = detectGroup(rec['دسته']);
  const preset = (group && GROUP_PRESETS[group]) || DEFAULT_PRESET;
  const unit = String(rec['واحد'] || '');
  const volumeUnit = /مکعب|m3|m³/i.test(unit);
  let sg = parseNum(rec['وزن_مخصوص']);
  const sgAssumed = !(sg > 0);
  if (sgAssumed) sg = preset.defaultSG;
  const reserveTons = parseNum(rec['ذخیره_قطعی']);
  const probableTons = parseNum(rec['ذخیره_احتمالی']);
  const annualTons = parseNum(rec['استخراج_سالیانه']);
  const years = parseNum(rec['مدت_بهره_برداری']);
  const toM3 = (x) => (x > 0 ? (volumeUnit ? x : x / sg) : null);
  return {
    material: String(rec['نام_ماده'] || ''),
    group,
    preset,
    reserveTons,
    probableTons,
    annualTons,
    years,
    areaKm2: parseNum(rec['مساحت']),
    volumeUnit,
    sg,
    sgAssumed,
    volumes: {
      reserveM3: toM3(reserveTons),
      probableM3: toM3(probableTons),
      termM3: annualTons > 0 && years > 0 ? toM3(annualTons * years) : null,
    },
  };
}

// ───────────────────────── هندسه‌ی کمکی ─────────────────────────

function polygonCentroid(poly) {
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const w = x0 * y1 - x1 * y0;
    a += w; cx += (x0 + x1) * w; cy += (y0 + y1) * w;
  }
  if (Math.abs(a) < 1e-9) {
    return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

const scalePolygon = (poly, c, s) => poly.map(([x, y]) => [c[0] + (x - c[0]) * s, c[1] + (y - c[1]) * s]);

function bboxOf(poly) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  poly.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  });
  return {
    minX, maxX, minY, maxY,
  };
}

function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function distToPolygonBoundary(px, py, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) best = Math.min(best, distToSegment(px, py, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/**
 * محدوده‌ی پروانه را به‌اندازه‌ی d متر به داخل می‌برد (حاشیه‌ی ایمنی از مرز پروانه).
 * اگر آفست معتبر نشد (محدوده خیلی کوچک یا خودتلاقی) null.
 */
export function insetPolygon(poly, d) {
  if (!(d > 0)) return poly.map((p) => [p[0], p[1]]);
  const out = offsetPolygonOutward(poly, -d);
  const a0 = polygonArea(poly);
  const a1 = polygonArea(out);
  if (!(a1 > 0) || a1 >= a0) return null;
  if (!out.every(([x, y]) => pointInPolygon(x, y, poly))) return null;
  return out;
}

function ringSamples(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j += 1) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

// ───────────────────────── تحلیل توپوگرافی ─────────────────────────

/**
 * پستی‌وبلندی و شیب منطقه‌ی داخل محدوده‌ی پروانه را از روی ارتفاع مدل می‌سنجد.
 * @param {(e:number,n:number)=>number} heightFn ارتفاع (ENU محلی؛ باید همه‌جا عدد معتبر بدهد)
 */
export function analyzeTerrain(heightFn, poly, { samples = 2500 } = {}) {
  const bb = bboxOf(poly);
  const area = polygonArea(poly);
  const step = Math.max(0.5, Math.sqrt(((bb.maxX - bb.minX) * (bb.maxY - bb.minY)) / samples));
  const pts = [];
  for (let y = bb.minY + step / 2; y <= bb.maxY; y += step) {
    for (let x = bb.minX + step / 2; x <= bb.maxX; x += step) {
      if (!pointInPolygon(x, y, poly)) continue;
      const z = heightFn(x, y);
      if (Number.isFinite(z)) pts.push([x, y, z]);
    }
  }
  if (pts.length < 6) throw new Error('محدوده‌ی پروانه تقریباً روی مدل نیست؛ توپوگرافی کافی برای طراحی وجود ندارد');
  let zMin = Infinity; let zMax = -Infinity; let zSum = 0;
  pts.forEach(([, , z]) => { if (z < zMin) zMin = z; if (z > zMax) zMax = z; zSum += z; });
  const plane = fitPlane(pts);
  const d = Math.max(step, 2);
  let slopeSum = 0;
  pts.forEach(([x, y]) => {
    const gx = (heightFn(x + d, y) - heightFn(x - d, y)) / (2 * d);
    const gy = (heightFn(x, y + d) - heightFn(x, y - d)) / (2 * d);
    slopeSum += Math.atan(Math.hypot(gx, gy));
  });
  let uphill = [0, 1];
  let planeGradeDeg = 0;
  if (plane) {
    const g = Math.hypot(plane.a, plane.b);
    planeGradeDeg = (Math.atan(g) * 180) / Math.PI;
    if (g > 1e-6) uphill = [plane.a / g, plane.b / g];
  }
  return {
    zMin,
    zMax,
    zMean: zSum / pts.length,
    reliefM: zMax - zMin,
    planeGradeDeg,
    meanSlopeDeg: ((slopeSum / pts.length) * 180) / Math.PI,
    planeRmse: plane ? plane.rmse : null,
    uphill,
    areaM2: area,
    sampleCount: pts.length,
    sampleStep: step,
  };
}

export const MODE_LABELS = {
  pit: 'گودالی (Pit)',
  hillside: 'دامنه‌ای / کواری (Quarry)',
  layered: 'لایه‌ای (Layered)',
};

/** نوع معدن را از روی شیب/پستی‌وبلندی واقعیِ مدل و گروه ماده پیشنهاد می‌دهد */
export function suggestMode(terrain, group) {
  if (terrain.meanSlopeDeg >= 15 || terrain.planeGradeDeg >= 12) {
    return {
      mode: 'hillside',
      reason: `شیب زمین در محدوده‌ی پروانه ${terrain.meanSlopeDeg.toFixed(0)}° (متوسط) و ${terrain.planeGradeDeg.toFixed(0)}° (کلی) است؛ برداشت دامنه‌ای مناسب‌تر است`,
    };
  }
  if (group === 1 || terrain.reliefM < 6) {
    return {
      mode: 'layered',
      reason: `زمین تقریباً هموار است (پستی‌وبلندی ${terrain.reliefM.toFixed(1)} متر)${group === 1 ? ' و ماده از گروه ۱ (شن/ماسه/رس) است' : ''}؛ برداشت لایه‌به‌لایه مناسب است`,
    };
  }
  return {
    mode: 'pit',
    reason: `زمین نسبتاً هموار با پستی‌وبلندی ${terrain.reliefM.toFixed(1)} متر است؛ گودال با دیواره‌ی پله‌ای مناسب است`,
  };
}

// ───────────────────────── امکان‌سنجی داخل پروانه ─────────────────────────

/**
 * کسری t∈[0,1] از سینه‌ی پله (از پای سینه A تا لبه‌ی بالا B) که زمین واقعی آن را قطع می‌کند: جایی که ارتفاع سینه برابر
 * ارتفاع زمین می‌شود = لبه‌ی واقعیِ برش (crest). 1 = تمام سینه برش‌خورده (زمین بالاتر از لبه‌ی بالا)؛ null = پای سینه هم در هواست.
 */
export function crestFraction(heightFn, A, zLo, B, zHi) {
  const f = (t) => heightFn(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t) - (zLo + (zHi - zLo) * t);
  if (f(1) >= 0) return 1;
  if (f(0) <= 0) return null;
  let lo = 0; let hi = 1;
  for (let i = 0; i < 16; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * لبه‌ی واقعیِ برش هر پله (محل برخورد سینه با زمین) و لبه‌ی برم‌ها باید داخل محدوده‌ی مجاز باشد. جاهایی که پله روی
 * زمین «برش نمی‌خورد» (پایین‌دست دامنه، یا بالای زمین) نادیده گرفته می‌شود.
 */
export function checkCrest(design, heightFn, allowed, { step = 3, tol = 0.15 } = {}) {
  let bad = 0; let total = 0; let worst = 0;
  const test = (x, y) => {
    total += 1;
    if (!pointInPolygon(x, y, allowed)) {
      bad += 1;
      worst = Math.max(worst, distToPolygonBoundary(x, y, allowed));
    }
  };
  const { benches } = design;
  ringSamples(benches[0].polygon, step).forEach(([x, y]) => { if (heightFn(x, y) > benches[0].elevation + tol) test(x, y); });
  for (let i = 1; i < benches.length; i += 1) {
    const lower = benches[i - 1]; const upper = benches[i];
    if (upper.faceTopPolygon) {
      const A = lower.polygon; const B = upper.faceTopPolygon;
      for (let j = 0; j < A.length; j += 1) {
        const a0 = A[j]; const a1 = A[(j + 1) % A.length]; const b0 = B[j]; const b1 = B[(j + 1) % B.length];
        const k = Math.max(1, Math.ceil(Math.max(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), Math.hypot(b1[0] - b0[0], b1[1] - b0[1])) / step));
        for (let m = 0; m < k; m += 1) {
          const pa = lerp2(a0, a1, m / k); const pb = lerp2(b0, b1, m / k);
          const t = crestFraction(heightFn, pa, lower.elevation, pb, upper.elevation);
          if (t === null) continue;
          const c = lerp2(pa, pb, t);
          test(c[0], c[1]);
        }
      }
    }
    if (upper.isCatchBench) {
      ringSamples(upper.polygon, step).forEach(([x, y]) => { if (heightFn(x, y) > upper.elevation + tol) test(x, y); });
    }
  }
  return {
    ok: bad === 0, bad, total, worstOutsideM: worst,
  };
}

// ───────────────────────── سطح TIN برای موتور pitDesign ─────────────────────────

function sampleTin(heightFn, poly, padRatio = 0.6, cells = 150) {
  const bb = bboxOf(poly);
  const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
  const pad = Math.max(60, padRatio * span);
  const x0 = bb.minX - pad; const x1 = bb.maxX + pad;
  const y0 = bb.minY - pad; const y1 = bb.maxY + pad;
  const step = Math.max(1.5, Math.max(x1 - x0, y1 - y0) / cells);
  const pts = [];
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    for (let x = x0; x <= x1 + 1e-9; x += step) {
      const z = heightFn(x, y);
      if (Number.isFinite(z)) pts.push([x, y, z]);
    }
  }
  return buildTin(pts);
}

// ───────────────────────── برازش طراحی ─────────────────────────

const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function maxBenchesFor(terrain, zFloor, H) {
  return Math.min(60, Math.max(3, Math.ceil((terrain.zMax - zFloor) / H) + 3));
}

function volumeCellFor(area) {
  return Math.max(2, Math.sqrt(area / 8000));
}

/** گودالی/لایه‌ای: کف گودال نسخه‌ی مقیاس‌شده‌ی محدوده‌ی مجاز در مرکز آن؛ عمق از روی حجم هدف حل می‌شود */
function fitPit(ctx, depthCapM) {
  const {
    tin, heightFn, allowed, terrain, params, targetM3,
  } = ctx;
  const H = params.benchHeight;
  const c = polygonCentroid(allowed);
  const design = (s, zFloor) => designBenches(tin, scalePolygon(allowed, c, s), {
    ...params, bottomElevation: zFloor, maxBenches: maxBenchesFor(terrain, zFloor, H),
  });
  const feasible = (d) => checkCrest(d, heightFn, allowed).ok && d.benches[d.benches.length - 1].outcropped;
  const cell = volumeCellFor(terrain.areaM2);
  const SMIN = 0.03;
  const scan = [];
  let best = null;
  for (let D = H; D <= depthCapM + 1e-9; D += H / 2) {
    const zFloor = terrain.zMean - D;
    let sel = null;
    const full = design(1, zFloor);
    if (feasible(full)) sel = { s: 1, d: full };
    else {
      const small = design(SMIN, zFloor);
      if (!feasible(small)) { scan.push({ depthM: D, feasible: false }); break; }
      let lo = SMIN; let hi = 1; let dLo = small;
      for (let it = 0; it < 12; it += 1) {
        const mid = (lo + hi) / 2;
        const dm = design(mid, zFloor);
        if (feasible(dm)) { lo = mid; dLo = dm; } else hi = mid;
      }
      sel = { s: lo, d: dLo };
    }
    const vol = computeCutVolume(tin, sel.d, cell);
    scan.push({
      depthM: D, feasible: true, footprint: sel.s, volumeM3: vol.totalCutM3,
    });
    const cand = {
      design: sel.d, volume: vol, zFloor, footprint: sel.s,
    };
    if (!best || vol.totalCutM3 > best.volume.totalCutM3) best = cand;
    if (targetM3 && vol.totalCutM3 >= targetM3) { best = cand; break; }
  }
  return { best, scan };
}

function unit2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

/** طول وتر محدوده روی خط s=ثابت (در دستگاه u,v) → [tMin, tMax] یا null */
function chordAt(allowed, o, u, v, s) {
  const ts = [];
  for (let i = 0; i < allowed.length; i += 1) {
    const a = allowed[i]; const b = allowed[(i + 1) % allowed.length];
    const sa = (a[0] - o[0]) * u[0] + (a[1] - o[1]) * u[1];
    const sb = (b[0] - o[0]) * u[0] + (b[1] - o[1]) * u[1];
    if ((sa - s) * (sb - s) > 0 || sa === sb) continue;
    const k = (s - sa) / (sb - sa);
    const p = lerp2(a, b, k);
    ts.push((p[0] - o[0]) * v[0] + (p[1] - o[1]) * v[1]);
  }
  if (ts.length < 2) return null;
  return [Math.min(...ts), Math.max(...ts)];
}

/** دامنه‌ای: سکوی پنجه روی زمین، پله‌ها به‌سمت بالادست؛ موقعیت پنجه (تراز) از روی حجم هدف حل می‌شود */
function fitHillside(ctx) {
  const {
    tin, heightFn, allowed, terrain, params, targetM3,
  } = ctx;
  const H = params.benchHeight;
  const u = unit2(terrain.uphill);
  const v = [-u[1], u[0]];
  const o = polygonCentroid(allowed);
  const Wf = params.platformWidthM;
  const proj = allowed.map(([x, y]) => (x - o[0]) * u[0] + (y - o[1]) * u[1]);
  const sMin = Math.min(...proj); const sMax = Math.max(...proj);
  const cell = volumeCellFor(terrain.areaM2);
  const frame = { u, v, origin: o };
  const cands = [];
  const N = 24;
  for (let i = 0; i < N; i += 1) {
    const sc = sMin + Wf / 2 + ((sMax - sMin - Wf) * i) / (N - 1);
    const chord = chordAt(allowed, o, u, v, sc);
    if (!chord || chord[1] - chord[0] < 10) continue;
    const tMid = (chord[0] + chord[1]) / 2;
    const toXY = (s, t) => [o[0] + s * u[0] + t * v[0], o[1] + s * u[1] + t * v[1]];
    const platform = (lam) => {
      const hl = (lam * (chord[1] - chord[0])) / 2;
      return [toXY(sc - Wf / 2, tMid - hl), toXY(sc + Wf / 2, tMid - hl), toXY(sc + Wf / 2, tMid + hl), toXY(sc - Wf / 2, tMid + hl)];
    };
    // تراز کف = پایین‌ترین ارتفاع زمین زیر سکو (صدک ۵٪) تا سکو کاملاً برش باشد و خاک‌ریزی نخواهد
    const gz = [];
    for (let a = 0; a <= 4; a += 1) {
      for (let b = 0; b <= 4; b += 1) {
        const s = sc - Wf / 2 + (Wf * a) / 4; const t = chord[0] + ((chord[1] - chord[0]) * b) / 4;
        gz.push(heightFn(...toXY(s, t)));
      }
    }
    gz.sort((p, q) => p - q);
    const z0 = gz[Math.floor(gz.length * 0.05)];
    const design = (lam) => designBenches(tin, platform(lam), {
      ...params, bottomElevation: z0, maxBenches: maxBenchesFor(terrain, z0, H),
    });
    const ok = (d) => checkCrest(d, heightFn, allowed).ok && d.benches[d.benches.length - 1].outcropped;
    let sel = null;
    const full = design(1);
    if (ok(full)) sel = { lam: 1, d: full };
    else {
      const small = design(0.1);
      if (!ok(small)) continue;
      let lo = 0.1; let hi = 1; let dLo = small;
      for (let it = 0; it < 12; it += 1) {
        const mid = (lo + hi) / 2;
        const dm = design(mid);
        if (ok(dm)) { lo = mid; dLo = dm; } else hi = mid;
      }
      sel = { lam: lo, d: dLo };
    }
    const vol = computeCutVolume(tin, sel.d, cell);
    cands.push({
      design: sel.d, volume: vol, zFloor: z0, footprint: sel.lam, toeS: sc,
    });
  }
  const scan = cands.map((c) => ({
    depthM: terrain.zMax - c.zFloor, feasible: true, footprint: c.footprint, volumeM3: c.volume.totalCutM3,
  }));
  if (!cands.length) return { best: null, scan, frame };
  let best;
  const meet = targetM3 ? cands.filter((c) => c.volume.totalCutM3 >= targetM3) : [];
  if (meet.length) best = meet.reduce((m, c) => (c.volume.totalCutM3 < m.volume.totalCutM3 ? c : m));
  else best = cands.reduce((m, c) => (c.volume.totalCutM3 > m.volume.totalCutM3 ? c : m));
  return { best, scan, frame };
}

// ───────────────────────── رمپ دامنه‌ای (زیگزاگ) ─────────────────────────

function rampEdges(centerline, width) {
  const half = width / 2;
  const leftEdge = []; const rightEdge = []; const segments = [];
  let totalLength = 0;
  for (let i = 0; i < centerline.length; i += 1) {
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(centerline.length - 1, i + 1)];
    let dx = next.x - prev.x; let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const c = centerline[i];
    leftEdge.push({ x: c.x - dy * half, y: c.y + dx * half, z: c.z });
    rightEdge.push({ x: c.x + dy * half, y: c.y - dx * half, z: c.z });
    if (i > 0) {
      const a = centerline[i - 1];
      const run = Math.hypot(c.x - a.x, c.y - a.y);
      const rise = c.z - a.z;
      totalLength += Math.hypot(run, rise);
      segments.push({
        fromLevel: a.level, toLevel: c.level, horizontalRun: run, rise, gradePercent: run > 1e-6 ? (Math.abs(rise) / run) * 100 : Infinity,
      });
    }
  }
  return {
    leftEdge, rightEdge, segments, totalLength,
  };
}

/**
 * رمپ زیگزاگیِ پله‌های دامنه‌ای: هر «پا» روی لبه‌ی بالادست یک پله حرکت می‌کند و دقیقاً یک پله (H) بالا می‌رود؛
 * طول لازم H/شیب، اگر از طول در دسترس بیشتر باشد شیب واقعی تندتر از درخواست می‌شود و در خروجی (tooSteep) گزارش می‌شود.
 * الگوی هندسی است، نه طراحی مسیر واقعی (شعاع پیچ، دید، سرعت طراحی کامیون).
 */
export function designHillsideRamp(design, frame, { width = 8, gradePercent = 10 } = {}) {
  const { benches } = design;
  if (benches.length < 2) throw new Error('برای رمپ حداقل یک پله لازم است');
  const H = design.params.benchHeight;
  const g = Math.max(0.5, gradePercent) / 100;
  const need = H / g;
  const { u } = frame;
  const faceH = benchFaceHorizontal(design.params);
  const sOf = (p) => p[0] * u[0] + p[1] * u[1];
  const centerline = [];
  let flip = false;
  let tooSteep = 0;
  let lastEnd = null;
  for (let i = 1; i < benches.length; i += 1) {
    const ring = offsetPolygonOutward(benches[i - 1].polygon, faceH / 2);
    let bj = 0; let bs = -Infinity;
    for (let j = 0; j < ring.length; j += 1) {
      const m = sOf(lerp2(ring[j], ring[(j + 1) % ring.length], 0.5));
      if (m > bs) { bs = m; bj = j; }
    }
    let A = ring[bj]; let B = ring[(bj + 1) % ring.length];
    if (lastEnd) {
      // پای بعدی از همان سمتی شروع شود که پای قبلی تمام شد
      if (Math.hypot(B[0] - lastEnd[0], B[1] - lastEnd[1]) < Math.hypot(A[0] - lastEnd[0], A[1] - lastEnd[1])) [A, B] = [B, A];
    } else if (flip) [A, B] = [B, A];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const avail = Math.max(0, len - width);
    if (avail < 1) continue;
    const dir = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    const start = [A[0] + dir[0] * width / 2, A[1] + dir[1] * width / 2];
    const climbRun = Math.min(need, avail);
    if (climbRun < need - 1e-6) tooSteep += 1;
    const zLo = benches[i - 1].elevation; const zHi = benches[i].elevation;
    centerline.push({
      x: start[0], y: start[1], z: zLo, level: i - 1,
    });
    const climbEnd = [start[0] + dir[0] * climbRun, start[1] + dir[1] * climbRun];
    centerline.push({
      x: climbEnd[0], y: climbEnd[1], z: zHi, level: i,
    });
    let end = climbEnd;
    if (avail - climbRun > 1) {
      end = [start[0] + dir[0] * avail, start[1] + dir[1] * avail];
      centerline.push({
        x: end[0], y: end[1], z: zHi, level: i,
      });
    }
    lastEnd = end;
    flip = !flip;
  }
  if (centerline.length < 2) throw new Error('محدوده برای رمپ زیگزاگ خیلی باریک است');
  return {
    width, requestedGradePercent: gradePercent, centerline, tooSteep, kind: 'zigzag', ...rampEdges(centerline, width),
  };
}

// ───────────────────────── طراحی کامل ─────────────────────────

/**
 * طراحی خودکار پله + رمپ روی توپوگرافی.
 * @param {object} a
 * @param {(e:number,n:number)=>number} a.heightFn ارتفاع مدل (ENU محلی)، همه‌جا معتبر (بیرون پوشش برون‌یابی‌شده)
 * @param {Array<[number,number]>} a.licensePoly گوشه‌های پروانه (ENU محلی)
 * @param {number|null} a.targetM3 حجم هدف خاک‌برداری (م³)؛ null = فقط هندسه بدون برازش ذخیره
 * @param {'auto'|'pit'|'hillside'|'layered'} [a.mode]
 * @param {object} [a.params] benchHeight, benchFaceAngleDeg, catchBenchInterval, bermWidthAuto, bermWidth,
 *   rampOn, rampWidth, rampGradePercent, boundarySetbackM, platformWidthM, depthCapM
 */
export function planPitDesign({
  heightFn, licensePoly, targetM3 = null, mode = 'auto', params = {}, group = null,
}) {
  if (!licensePoly || licensePoly.length < 3) throw new Error('محدوده‌ی پروانه (حداقل ۳ گوشه) لازم است');
  const p = {
    benchHeight: 8,
    benchFaceAngleDeg: 65,
    catchBenchInterval: 1,
    bermWidthAuto: true,
    bermWidth: 5,
    osaMode: false,
    targetOSADeg: 40,
    rampOn: true,
    rampWidth: 8,
    rampGradePercent: 10,
    boundarySetbackM: 10,
    platformWidthM: 30,
    depthCapM: null,
    ...params,
  };
  if (!(p.benchHeight > 0) || !(p.benchFaceAngleDeg > 0 && p.benchFaceAngleDeg < 90)) throw new Error('ارتفاع پله یا شیب سینه‌ی پله نامعتبر است');
  const warnings = [];
  const allowed = insetPolygon(licensePoly, p.boundarySetbackM);
  if (!allowed) throw new Error('محدوده‌ی پروانه برای حاشیه‌ی مرزی انتخاب‌شده خیلی کوچک است؛ حاشیه را کمتر کنید');
  const terrain = analyzeTerrain(heightFn, allowed);
  const sug = suggestMode(terrain, group);
  const resolved = mode === 'auto' ? sug.mode : mode;
  const tin = sampleTin(heightFn, licensePoly);
  const ctx = {
    tin, heightFn, allowed, terrain, params: p, targetM3,
  };

  let fit;
  if (resolved === 'hillside') {
    fit = fitHillside(ctx);
  } else {
    const H = p.benchHeight;
    const cap = p.depthCapM > 0 ? p.depthCapM : (resolved === 'layered' ? 6 * H : 15 * H);
    fit = fitPit(ctx, cap);
  }
  if (!fit.best) {
    throw new Error('در این محدوده با پارامترهای فعلی هیچ طراحی داخل مرز پروانه جا نمی‌شود — حاشیه‌ی مرزی، ارتفاع پله یا شیب سینه را کمتر کنید');
  }
  const { best } = fit;
  const { design } = best;
  const achieved = best.volume.totalCutM3;
  const meetsTarget = !targetM3 || achieved >= targetM3 * 0.999;
  if (targetM3 && !meetsTarget) {
    warnings.push(`حجم قابل برداشت در محدوده‌ی پروانه (با این پارامترها و حاشیه‌ی مرزی) ${Math.round(achieved).toLocaleString('en-US')} م³ است و به حجم هدف (${Math.round(targetM3).toLocaleString('en-US')} م³) نمی‌رسد؛ ذخیره‌ی ثبت‌شده با این هندسه داخل مرز جا نمی‌شود.`);
  }
  const last = design.benches[design.benches.length - 1];
  if (!last.outcropped) warnings.push('پله‌ها به سطح زمین نرسیدند (سقف تعداد پله)؛ شیب زمین ممکن است از شیب کلی دیواره تندتر باشد.');

  let ramp = null;
  if (p.rampOn && design.benches.length > 1) {
    try {
      ramp = resolved === 'hillside'
        ? designHillsideRamp(design, fit.frame, { width: p.rampWidth, gradePercent: p.rampGradePercent })
        : designRamp(design, { width: p.rampWidth, gradePercent: p.rampGradePercent });
      const worst = ramp.segments.reduce((m, s) => (Number.isFinite(s.gradePercent) && s.gradePercent > m ? s.gradePercent : m), 0);
      ramp.maxGradePercent = worst;
      if (worst > p.rampGradePercent * 1.15) warnings.push(`بیشینه‌ی شیب واقعی رمپ ${worst.toFixed(1)}٪ است (درخواستی ${p.rampGradePercent}٪)؛ طول در دسترس برای رمپ کافی نیست.`);
    } catch (err) {
      warnings.push(`رمپ طراحی نشد: ${err.message}`);
    }
  }

  const params2 = design.params;
  const totalHeight = last.elevation - design.benches[0].elevation;
  return {
    mode: resolved,
    suggestedMode: sug.mode,
    modeReason: sug.reason,
    terrain,
    allowedPoly: allowed,
    design,
    ramp,
    volume: best.volume,
    frame: fit.frame || null,
    fit: {
      targetM3,
      achievedM3: achieved,
      meetsTarget,
      shortfallM3: targetM3 && !meetsTarget ? targetM3 - achieved : 0,
      footprint: best.footprint,
      scan: fit.scan,
    },
    metrics: {
      benchCount: design.benches.length - 1,
      catchCount: design.benches.filter((b) => b.isCatchBench).length,
      iraDeg: interRampAngleDeg(params2),
      osaDeg: overallSlopeAngleDeg(params2, design.resolvedBerm),
      bermM: design.resolvedBerm,
      floorElevation: design.benches[0].elevation,
      topElevation: last.elevation,
      totalHeightM: totalHeight,
      floorAreaM2: polygonArea(design.benches[0].polygon),
    },
    warnings,
  };
}

// ───────────────────────── هندسه‌ی رسم ─────────────────────────

/**
 * مثلث‌ها و خطوط رسم (مختصات ENU). بخش‌هایی از پله که روی زمین واقعی در هوا می‌افتند (زمین پایین‌تر از تراز پله) حذف
 * می‌شوند تا روی مدل پهپادی شناور رسم نشوند (پایین‌دست دامنه).
 * @returns {{ floor:number[], faces:number[], berms:number[], crest:number[] }} آرایه‌های تخت [e,n,u,...]؛
 *   floor/faces/berms سه‌تایی‌های مثلث، crest جفت‌نقطه‌های پاره‌خط
 */
export function buildPlanGeometry(plan, heightFn, { step = 3, tol = 0.15 } = {}) {
  const out = {
    floor: [], faces: [], berms: [], crest: [],
  };
  const { benches } = plan.design;
  const push = (arr, ...pts) => pts.forEach(([x, y, z]) => arr.push(x, y, z));
  // کف
  const f = benches[0];
  const c = polygonCentroid(f.polygon);
  for (let i = 0; i < f.polygon.length; i += 1) {
    const a = f.polygon[i]; const b = f.polygon[(i + 1) % f.polygon.length];
    push(out.floor, [c[0], c[1], f.elevation], [a[0], a[1], f.elevation], [b[0], b[1], f.elevation]);
  }
  const strip = (arr, A, zA, B, zB, keep) => {
    for (let j = 0; j < A.length; j += 1) {
      const a0 = A[j]; const a1 = A[(j + 1) % A.length]; const b0 = B[j]; const b1 = B[(j + 1) % B.length];
      const len = Math.max(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), Math.hypot(b1[0] - b0[0], b1[1] - b0[1]));
      const k = Math.max(1, Math.ceil(len / step));
      for (let m = 0; m < k; m += 1) {
        const t0 = m / k; const t1 = (m + 1) / k;
        const A0 = lerp2(a0, a1, t0); const A1 = lerp2(a0, a1, t1);
        const B0 = lerp2(b0, b1, t0); const B1 = lerp2(b0, b1, t1);
        if (!keep((B0[0] + B1[0]) / 2, (B0[1] + B1[1]) / 2)) continue;
        push(arr, [A0[0], A0[1], zA], [B0[0], B0[1], zB], [B1[0], B1[1], zB]);
        push(arr, [A0[0], A0[1], zA], [B1[0], B1[1], zB], [A1[0], A1[1], zA]);
      }
    }
  };
  // سینه‌ی پله فقط تا جایی که زمین واقعی آن را قطع می‌کند رسم می‌شود (بالاتر از زمین، سینه‌ای وجود ندارد)
  const facePieces = (arr, lower, upper) => {
    const A = lower.polygon; const B = upper.faceTopPolygon;
    for (let j = 0; j < A.length; j += 1) {
      const a0 = A[j]; const a1 = A[(j + 1) % A.length]; const b0 = B[j]; const b1 = B[(j + 1) % B.length];
      const len = Math.max(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), Math.hypot(b1[0] - b0[0], b1[1] - b0[1]));
      const k = Math.max(1, Math.ceil(len / step));
      for (let m = 0; m < k; m += 1) {
        const ends = [m / k, (m + 1) / k].map((t) => {
          const pa = lerp2(a0, a1, t); const pb = lerp2(b0, b1, t);
          const tc = crestFraction(heightFn, pa, lower.elevation, pb, upper.elevation);
          return tc === null ? null : {
            pa, top: lerp2(pa, pb, tc), zTop: lower.elevation + (upper.elevation - lower.elevation) * tc,
          };
        });
        if (!ends[0] || !ends[1]) continue;
        const [e0, e1] = ends;
        push(arr, [e0.pa[0], e0.pa[1], lower.elevation], [e0.top[0], e0.top[1], e0.zTop], [e1.top[0], e1.top[1], e1.zTop]);
        push(arr, [e0.pa[0], e0.pa[1], lower.elevation], [e1.top[0], e1.top[1], e1.zTop], [e1.pa[0], e1.pa[1], lower.elevation]);
      }
    }
  };
  for (let i = 1; i < benches.length; i += 1) {
    const lower = benches[i - 1]; const upper = benches[i];
    if (upper.faceTopPolygon) {
      facePieces(out.faces, lower, upper);
      if (upper.isCatchBench) {
        strip(out.berms, upper.faceTopPolygon, upper.elevation, upper.polygon, upper.elevation, (x, y) => heightFn(x, y) > upper.elevation + tol);
      }
    }
    const ring = upper.polygon;
    for (let j = 0; j < ring.length; j += 1) {
      const a = ring[j]; const b = ring[(j + 1) % ring.length];
      const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let m = 0; m < k; m += 1) {
        const p0 = lerp2(a, b, m / k); const p1 = lerp2(a, b, (m + 1) / k);
        if (heightFn((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2) > upper.elevation + tol) {
          push(out.crest, [p0[0], p0[1], upper.elevation], [p1[0], p1[1], upper.elevation]);
        }
      }
    }
  }
  return out;
}

// ───────────────────────── خروجی‌ها ─────────────────────────

/** طراحی را با مبدأ RTC (UTM) جابه‌جا می‌کند تا خروجی DXF/CSV مختصات مطلق باشد */
export function translateDesign(design, off) {
  const mv = (poly) => (poly ? poly.map(([x, y]) => [x + off[0], y + off[1]]) : poly);
  return {
    ...design,
    benches: design.benches.map((b) => ({
      ...b, polygon: mv(b.polygon), faceTopPolygon: mv(b.faceTopPolygon), elevation: b.elevation + off[2],
    })),
  };
}

export function translateRamp(ramp, off) {
  const mv = (p) => ({ ...p, x: p.x + off[0], y: p.y + off[1], z: p.z + off[2] });
  return {
    ...ramp, centerline: ramp.centerline.map(mv), leftEdge: ramp.leftEdge.map(mv), rightEdge: ramp.rightEdge.map(mv),
  };
}

export function exportPlanBenchesDxf(plan, off = [0, 0, 0]) {
  return exportBenchesDXF(translateDesign(plan.design, off));
}

export function exportPlanRampDxf(plan, off = [0, 0, 0]) {
  if (!plan.ramp) return null;
  return exportRampDXF(translateRamp(plan.ramp, off));
}

/** گزارش CSV: خلاصه‌ی برازش ذخیره + گزارش استاندارد pitDesign (پله‌ها، حجم، رمپ) با تراز مطلق */
export function exportPlanReportCsv(plan, spec = null, off = [0, 0, 0]) {
  const q = (c) => `"${String(c).replace(/"/g, '""')}"`;
  const rows = [
    ['--- خلاصه‌ی طراحی خودکار روی مدل پهپادی ---'],
    ['نوع معدن', MODE_LABELS[plan.mode] || plan.mode],
    ['دلیل پیشنهاد (از توپوگرافی)', plan.modeReason],
    ['حجم هدف (m3)', plan.fit.targetM3 ? Math.round(plan.fit.targetM3) : '—'],
    ['حجم خاک‌برداریِ طراحی (m3)', Math.round(plan.fit.achievedM3)],
    ['به حجم هدف رسید؟', plan.fit.meetsTarget ? 'بله' : 'خیر'],
  ];
  if (spec) {
    rows.push(['ماده معدنی', spec.material || '—'], ['وزن مخصوص (t/m3)', `${spec.sg}${spec.sgAssumed ? ' (فرض پیش‌فرض گروه)' : ''}`]);
  }
  plan.warnings.forEach((w) => rows.push(['هشدار', w]));
  rows.push(['⚠️ برآورد اولیه از روی مدل فتوگرامتری — جایگزین طراحی مهندس معدن/ژئوتکنیک نیست']);
  rows.push([]);
  const head = rows.map((r) => r.map(q).join(',')).join('\r\n');
  const body = exportReportCSV(translateDesign(plan.design, off), plan.volume, plan.ramp ? translateRamp(plan.ramp, off) : null);
  return `\ufeff${head}\r\n${body}\r\n`;
}

// «میدان ارتفاعی پایه» برای لایه‌های کمکی نمایشگر پهباد (تصویر ماهواره‌ای، محدوده‌ی پروانه) — فقط منطق خالص.
//
// مدل پهباد فقط بخشی از معدن را می‌پوشاند و ارتفاعش از نقطه‌ای به نقطه‌ی دیگر خیلی فرق می‌کند. اگر تصویر ماهواره‌ای روی
// یک صفحه‌ی تخت بنشیند، از مدل «فاصله می‌گیرد» (مدل بالای صفحه معلق است)؛ اگر محدوده‌ی پروانه فقط
// روی خودِ مدل چسبانده شود، آنجا که برداشت کوچک‌تر از معدن است ناقص دیده می‌شود. این ماژول از روی سطح مدل یک شبکه‌ی ارتفاعی می‌سازد
// و بیرون از پوشش مدل را با برون‌یابیِ هموار (نزدیک‌ترین ارتفاع معتبر + هموارسازی) پر می‌کند تا هر دو لایه همه‌جا روی
// یک «سطح پیوسته» بنشینند.
//
// ⚠️ بیرون از پوشش مدل، ارتفاع برون‌یابی است نه اندازه‌گیری: افقی دقیق است ولی قائم تقریبی (برای نمایش، نه محاسبه).

import { heightAt } from './model3dAnalysis.js';

/**
 * @param {object} surface خروجی buildSurface (model3dAnalysis.js)
 * @param {{minE:number,maxE:number,minN:number,maxN:number}} extent محدوده‌ی شبکه (ENU محلی، متر)
 * @param {{ nx?: number, ny?: number, smoothIters?: number, lower?: boolean }} [opts]
 *   lower: به‌جای ارتفاع دقیق، کمینه‌ی همسایگی ۳×۳ (سطح «محافظه‌کارانه‌ی زیر مدل») تا سطح درشت‌شبکه از مدل بیرون نزند.
 * @returns {null|{ extent:object, nx:number, ny:number, heights:Float32Array, validCount:number,
 *                  validFraction:number, sample:(e:number,n:number)=>number }} null اگر هیچ نقطه‌ای از شبکه روی مدل نیفتد
 */
export function buildHeightfield(surface, extent, {
  nx = 128, ny = 128, smoothIters = 40, lower = false,
} = {}) {
  const w = nx + 1;
  const h = ny + 1;
  const total = w * h;
  const dE = extent.maxE - extent.minE;
  const dN = extent.maxN - extent.minN;
  if (!(dE > 0) || !(dN > 0)) throw new Error('محدوده‌ی شبکه‌ی ارتفاعی نامعتبر است');
  const vals = new Float32Array(total);
  const valid = new Uint8Array(total);
  let validCount = 0;
  for (let j = 0; j < h; j += 1) {
    const n = extent.minN + (dN * j) / ny;
    for (let i = 0; i < w; i += 1) {
      const e = extent.minE + (dE * i) / nx;
      const z = heightAt(surface, e, n);
      if (Number.isFinite(z)) { vals[j * w + i] = z; valid[j * w + i] = 1; validCount += 1; }
    }
  }
  if (!validCount) return null;

  let base = vals;
  if (lower) {
    base = new Float32Array(vals);
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        const k = j * w + i;
        if (!valid[k]) continue;
        let m = vals[k];
        for (let dj = -1; dj <= 1; dj += 1) {
          for (let di = -1; di <= 1; di += 1) {
            const ii = i + di; const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
            const kk = jj * w + ii;
            if (valid[kk] && vals[kk] < m) m = vals[kk];
          }
        }
        base[k] = m;
      }
    }
  }

  // پر کردن خانه‌های نامعتبر: BFS چندمنبعه از خانه‌های معتبر (نزدیک‌ترین ارتفاع معتبر)، سپس هموارسازی ژاکوبی
  const out = new Float32Array(base);
  const filled = new Uint8Array(valid);
  const queue = new Int32Array(total);
  let qh = 0; let qt = 0;
  for (let k = 0; k < total; k += 1) if (valid[k]) { queue[qt] = k; qt += 1; }
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (qh < qt) {
    const k = queue[qh]; qh += 1;
    const i = k % w; const j = (k - i) / w;
    for (let t = 0; t < 4; t += 1) {
      const ii = i + nb[t][0]; const jj = j + nb[t][1];
      if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
      const kk = jj * w + ii;
      if (filled[kk]) continue;
      filled[kk] = 1; out[kk] = out[k]; queue[qt] = kk; qt += 1;
    }
  }
  if (validCount < total && smoothIters > 0) {
    let a = out;
    let b = new Float32Array(out);
    for (let it = 0; it < smoothIters; it += 1) {
      for (let j = 0; j < h; j += 1) {
        for (let i = 0; i < w; i += 1) {
          const k = j * w + i;
          if (valid[k]) { b[k] = a[k]; continue; }
          const l = a[j * w + Math.max(0, i - 1)];
          const r = a[j * w + Math.min(w - 1, i + 1)];
          const d = a[Math.max(0, j - 1) * w + i];
          const u = a[Math.min(h - 1, j + 1) * w + i];
          b[k] = (l + r + d + u) / 4;
        }
      }
      const tmp = a; a = b; b = tmp;
    }
    if (a !== out) out.set(a);
  }

  function sample(e, n) {
    const fx = Math.max(0, Math.min(nx, ((e - extent.minE) / dE) * nx));
    const fy = Math.max(0, Math.min(ny, ((n - extent.minN) / dN) * ny));
    const i0 = Math.min(nx - 1, Math.floor(fx)); const j0 = Math.min(ny - 1, Math.floor(fy));
    const tx = fx - i0; const ty = fy - j0;
    const z00 = out[j0 * w + i0]; const z10 = out[j0 * w + i0 + 1];
    const z01 = out[(j0 + 1) * w + i0]; const z11 = out[(j0 + 1) * w + i0 + 1];
    return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty;
  }

  return {
    extent, nx, ny, heights: out, validCount, validFraction: validCount / total, sample,
  };
}

/** محدوده‌ی اجتماع مدل و نقاط (مثلاً گوشه‌های پروانه) به‌علاوه‌ی حاشیه‌ی نسبی */
export function unionExtent(bboxEnu, pointsEnu = [], padRatio = 0) {
  let { minE, maxE, minN, maxN } = bboxEnu;
  pointsEnu.forEach(([e, n]) => {
    if (e < minE) minE = e; if (e > maxE) maxE = e;
    if (n < minN) minN = n; if (n > maxN) maxN = n;
  });
  const pad = padRatio * Math.max(maxE - minE, maxN - minN);
  return {
    minE: minE - pad, maxE: maxE + pad, minN: minN - pad, maxN: maxN + pad,
  };
}

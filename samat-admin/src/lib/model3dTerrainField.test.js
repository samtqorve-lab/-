import { describe, it, expect } from 'vitest';
import { buildHeightfield, unionExtent } from './model3dTerrainField.js';
import { buildSurface } from './model3dAnalysis.js';

/** سطح شبکه‌ای فقط روی [x0..x1]×[y0..y1] (برداشتِ کوچک‌تر از معدن) */
function partialSurface(f, { x0 = 40, x1 = 60, y0 = 40, y1 = 60, step = 1 } = {}) {
  const nx = Math.round((x1 - x0) / step) + 1;
  const ny = Math.round((y1 - y0) / step) + 1;
  const coords = new Float64Array(nx * ny * 2);
  const z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const k = j * nx + i;
      coords[k * 2] = x0 + i * step; coords[k * 2 + 1] = y0 + j * step; z[k] = f(x0 + i * step, y0 + j * step);
    }
  }
  const tris = [];
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const a = j * nx + i; const b = a + 1; const c = a + nx; const d = c + 1;
      tris.push(a, b, d, a, d, c);
    }
  }
  return buildSurface(coords, new Uint32Array(tris), z);
}
const EXT = {
  minE: 0, maxE: 100, minN: 0, maxN: 100,
};
const tilt = (x, y) => 100 + 0.2 * x + 0.1 * y; // ۱۱۵…۱۳۰ روی ناحیه‌ی برداشت

describe('buildHeightfield', () => {
  it('داخل پوشش مدل ارتفاع دقیق است و بیرون از آن همه‌جا عدد معتبر می‌دهد', () => {
    const hf = buildHeightfield(partialSurface(tilt), EXT, { nx: 50, ny: 50 });
    expect(hf.validFraction).toBeGreaterThan(0.03);
    expect(hf.validFraction).toBeLessThan(0.3);
    expect(hf.sample(50, 50)).toBeCloseTo(tilt(50, 50), 1);
    expect(hf.sample(45, 55)).toBeCloseTo(tilt(45, 55), 1);
    for (let e = 0; e <= 100; e += 10) for (let n = 0; n <= 100; n += 10) expect(Number.isFinite(hf.sample(e, n))).toBe(true);
  });
  it('برون‌یابی در بازه‌ی ارتفاع‌های معتبر می‌ماند و کنار لبه به ارتفاع لبه نزدیک است', () => {
    const hf = buildHeightfield(partialSurface(tilt), EXT, { nx: 50, ny: 50 });
    const lo = tilt(40, 40); const hi = tilt(60, 60);
    for (let e = 0; e <= 100; e += 5) for (let n = 0; n <= 100; n += 5) {
      const z = hf.sample(e, n);
      expect(z).toBeGreaterThanOrEqual(lo - 1e-3); expect(z).toBeLessThanOrEqual(hi + 1e-3);
    }
    // درست بیرون از لبه‌ی غربی، تفاوت کم با ارتفاع لبه
    expect(Math.abs(hf.sample(38, 50) - tilt(40, 50))).toBeLessThan(4);
  });
  it('lower: سطح هرگز از مدل بالاتر نیست و به‌اندازه‌ی ناهمواری پایین‌تر می‌نشیند', () => {
    const rough = (x, y) => 100 + 3 * Math.sin(x) * Math.cos(y);
    const surf = partialSurface(rough, { step: 0.5 });
    const exact = buildHeightfield(surf, EXT, { nx: 50, ny: 50 });
    const low = buildHeightfield(surf, EXT, { nx: 50, ny: 50, lower: true });
    let strictlyLower = 0;
    for (let k = 0; k < exact.heights.length; k += 1) {
      expect(low.heights[k]).toBeLessThanOrEqual(exact.heights[k] + 1e-4);
      if (low.heights[k] < exact.heights[k] - 1e-3) strictlyLower += 1;
    }
    expect(strictlyLower).toBeGreaterThan(0);
  });
  it('پوشش کامل: بدون برون‌یابی و برابر ارتفاع واقعی', () => {
    const full = partialSurface(tilt, {
      x0: 0, x1: 100, y0: 0, y1: 100, step: 2,
    });
    const hf = buildHeightfield(full, EXT, { nx: 25, ny: 25 });
    expect(hf.validFraction).toBe(1);
    expect(hf.sample(33, 71)).toBeCloseTo(tilt(33, 71), 1);
  });
  it('هیچ پوششی ⇒ null؛ محدوده‌ی نامعتبر ⇒ خطای فارسی', () => {
    expect(buildHeightfield(partialSurface(tilt), {
      minE: 500, maxE: 600, minN: 500, maxN: 600,
    }, { nx: 10, ny: 10 })).toBeNull();
    expect(() => buildHeightfield(partialSurface(tilt), {
      minE: 0, maxE: 0, minN: 0, maxN: 5,
    })).toThrow(/نامعتبر/);
  });
  it('sample بیرون از محدوده گیره می‌شود (NaN نمی‌دهد)', () => {
    const hf = buildHeightfield(partialSurface(tilt), EXT, { nx: 20, ny: 20 });
    expect(Number.isFinite(hf.sample(-50, 500))).toBe(true);
  });
});

describe('unionExtent', () => {
  it('اجتماع مدل و نقاط با حاشیه', () => {
    const u = unionExtent({
      minE: 0, maxE: 10, minN: 0, maxN: 10,
    }, [[-5, 3], [20, 40]], 0.1);
    // بُعد بزرگ‌تر ۴۰ متر (شمالی) ⇒ حاشیه ۴ متر از هر طرف
    expect(u.minE).toBeCloseTo(-5 - 4, 6);
    expect(u.maxE).toBeCloseTo(20 + 4, 6);
    expect(u.minN).toBeCloseTo(0 - 4, 6);
    expect(u.maxN).toBeCloseTo(40 + 4, 6);
  });
  it('بدون نقطه همان مدل (با حاشیه‌ی صفر)', () => {
    expect(unionExtent({
      minE: 1, maxE: 2, minN: 3, maxN: 4,
    })).toEqual({
      minE: 1, maxE: 2, minN: 3, maxN: 4,
    });
  });
});

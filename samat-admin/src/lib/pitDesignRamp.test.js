import { describe, it, expect } from 'vitest';
import { rampExtraCutEstimate } from './pitDesignRamp.js';

const design = (H, ang) => ({ params: { benchHeight: H, benchFaceAngleDeg: ang } });
const ramp = (w, runs) => ({ width: w, segments: runs.map((r) => ({ horizontalRun: r })) });

describe('rampExtraCutEstimate', () => {
  it('دیوارهٔ کوتاه‌تر از H: مثلث ساده 0.5·h²·tanα', () => {
    const r = rampExtraCutEstimate(design(10, 45), ramp(8, [100, 100]));
    expect(r.crossSectionM2).toBeCloseTo(0.5 * 4 * 4 * 1, 6);
    expect(r.lengthM).toBe(200);
    expect(r.volumeM3).toBeCloseTo(8 * 200, 6);
  });
  it('دیوارهٔ بلندتر از H: مثلث + مستطیل (سقف ارتفاع H)', () => {
    // h=8, tan70≈2.747 → h·tan=22 > H=10 ؛ xc=H/tan≈3.64
    const r = rampExtraCutEstimate(design(10, 70), ramp(16, [50]));
    const xc = 10 / Math.tan((70 * Math.PI) / 180);
    expect(r.crossSectionM2).toBeCloseTo(0.5 * xc * 10 + (8 - xc) * 10, 6);
  });
  it('پاره‌خط با طول نامعتبر نادیده گرفته می‌شود', () => {
    const r = rampExtraCutEstimate(design(10, 60), ramp(8, [10, NaN, Infinity].map((x) => x)));
    expect(Number.isFinite(r.lengthM)).toBe(true);
  });
});

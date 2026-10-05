import { describe, it, expect } from 'vitest';
import { buildSurface as buildMeshSurface } from './model3dAnalysis.js';
import {
  eligibleDroneJobs, pickDroneAsset, sampleSurfaceToUtmPoints,
} from './pitDesignDrone.js';
import {
  buildSurface, designBenches, rectanglePolygon, elevationAt,
} from './pitDesign.js';

/** مش شبکه‌ای منظم (ENU محلی)؛ skip(i,j) خانه را حذف می‌کند (حفره) */
function gridMesh(n, step, zFn, skip = () => false) {
  const coords = new Float64Array(n * n * 2);
  const zv = new Float64Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      coords[k * 2] = i * step; coords[k * 2 + 1] = j * step; zv[k] = zFn(i * step, j * step);
    }
  }
  const tris = [];
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      if (skip(i, j)) continue;
      const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
      tris.push(a, b, d, a, d, c);
    }
  }
  return buildMeshSurface(coords, new Uint32Array(tris), zv);
}

describe('eligibleDroneJobs / pickDroneAsset', () => {
  const jobs = [
    { jobId: 'a', status: 'done', mode: 'preview', createdAt: '2026-09-01T00:00:00Z' },
    { jobId: 'b', status: 'done', mode: 'survey', assets: ['model.glb', 'model_lod1.glb', 'dsm.tif'], createdAt: '2026-09-20T00:00:00Z' },
    { jobId: 'c', status: 'queued', mode: 'survey', createdAt: '2026-09-25T00:00:00Z' },
    { jobId: 'd', status: 'done', mode: 'merge', assets: ['dsm.tif'], createdAt: '2026-09-22T00:00:00Z' },
    { jobId: 'e', status: 'done', mode: 'merge', assets: ['model.glb'], createdAt: '2026-09-10T00:00:00Z' },
  ];

  it('فقط کارهای آماده‌ی دارای مدل، از جدید به قدیم، با علامت دقت نقشه‌برداری', () => {
    const out = eligibleDroneJobs(jobs);
    expect(out.map((j) => j.jobId)).toEqual(['b', 'e', 'a']);
    expect(out.find((j) => j.jobId === 'a').surveyGrade).toBe(false);
    expect(out.find((j) => j.jobId === 'e').surveyGrade).toBe(true);
  });

  it('مدل سبک را ترجیح می‌دهد و بدون فهرست asset همان model.glb است', () => {
    expect(pickDroneAsset(jobs[1])).toBe('model_lod1.glb');
    expect(pickDroneAsset(jobs[4])).toBe('model.glb');
    expect(pickDroneAsset(jobs[0])).toBe('model.glb');
  });

  it('ورودی خالی/نامعتبر خطا نمی‌دهد', () => {
    expect(eligibleDroneJobs(null)).toEqual([]);
    expect(eligibleDroneJobs([])).toEqual([]);
  });
});

describe('sampleSurfaceToUtmPoints', () => {
  const rtc = [500000, 3800000, 1200];

  it('نقاط را به UTM مطلق (E,N + ارتفاع RTC) می‌برد و به سقف نقطه احترام می‌گذارد', () => {
    const surface = gridMesh(41, 5, (e) => 0.1 * e); // ۲۰۰×۲۰۰ متر
    const r = sampleSurfaceToUtmPoints(surface, rtc, { maxPoints: 2500 });
    expect(r.points.length).toBeLessThanOrEqual(2500 * 1.2);
    expect(r.points.length).toBeGreaterThan(1000);
    r.points.forEach(([x, y, z]) => {
      expect(x).toBeGreaterThanOrEqual(500000 - 1e-6);
      expect(x).toBeLessThanOrEqual(500200 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(3800000 - 1e-6);
      expect(y).toBeLessThanOrEqual(3800200 + 1e-6);
      expect(z).toBeCloseTo(0.1 * (x - 500000) + 1200, 6);
    });
    expect(r.bboxUtm.minX).toBeCloseTo(500000, 6);
    expect(r.bboxUtm.maxZ).toBeGreaterThan(r.bboxUtm.minZ);
    expect(r.coverageFraction).toBeCloseTo(1, 1);
  });

  it('ماسک پوشش: حفره‌ی مدل و بیرون از محدوده پوشیده نیست، داخل مدل پوشیده است', () => {
    // حفره‌ی بزرگ وسط (خانه‌های ۱۵..۲۵) — مثل ناحیه‌ی بدون داده در پرواز
    const surface = gridMesh(41, 5, () => 10, (i, j) => i >= 15 && i < 25 && j >= 15 && j < 25);
    const r = sampleSurfaceToUtmPoints(surface, rtc, { maxPoints: 4000 });
    expect(r.isCovered(500000 + 20, 3800000 + 20)).toBe(true);
    expect(r.isCovered(500000 + 100, 3800000 + 100)).toBe(false); // مرکز حفره
    expect(r.isCovered(500000 + 500, 3800000 + 100)).toBe(false); // خیلی بیرون
    expect(r.isCovered(500000 - 50, 3800000 + 100)).toBe(false);
    expect(r.coverageFraction).toBeLessThan(0.95);
    // هیچ نقطه‌ای داخل حفره نمونه‌برداری نشده است
    const inHole = r.points.filter(([x, y]) => x > 500000 + 80 && x < 500000 + 120 && y > 3800000 + 80 && y < 3800000 + 120);
    expect(inHole.length).toBe(0);
  });

  it('مدل بدون پوشش کافی خطای فارسی می‌دهد', () => {
    // محدوده‌ای که با مش هیچ هم‌پوشانی ندارد → همه‌ی نمونه‌ها NaN → خطا
    const real = gridMesh(5, 5, () => 0);
    const surface = { ...real, bbox: { ...real.bbox, minX: 10000, maxX: 10020, minY: 10000, maxY: 10020 } };
    expect(() => sampleSurfaceToUtmPoints(surface, rtc)).toThrow('پوشش کافی');
  });

  it('خروجی مستقیم به موتور طراحی پله‌بندی می‌خورد (TIN + پله‌ها)', () => {
    // تپه‌ی مخروطی ۴۰۰×۴۰۰ متر روی UTM مطلق
    const surface = gridMesh(81, 5, (e, n) => 100 - 0.25 * Math.hypot(e - 200, n - 200));
    const r = sampleSurfaceToUtmPoints(surface, rtc, { maxPoints: 6000 });
    const tin = buildSurface(r.points);
    const cx = 500000 + 200; const cy = 3800000 + 200;
    // ۶۰ متر از قله‌ی مخروط (خودِ قله روی گره‌ی شبکه نمی‌افتد و کمی گرد می‌شود)
    expect(elevationAt(tin, cx + 60, cy)).toBeCloseTo(1200 + 100 - 0.25 * 60, 0);
    const result = designBenches(tin, rectanglePolygon([cx, cy], 30, 20, 0), {
      benchHeight: 10, benchFaceAngleDeg: 70, bermWidth: 5, bermWidthAuto: false, maxBenches: 40, bottomElevation: 1200 + 40,
    });
    expect(result.benches.length).toBeGreaterThan(3);
    expect(result.benches[result.benches.length - 1].outcropped).toBe(true);
  });
});

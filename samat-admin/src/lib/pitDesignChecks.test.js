import { describe, it, expect } from 'vitest';
import {
  densifyClosedPolygon, distanceToPolygonEdges, polygonCoverage, tinCoverageFn, boundaryExceedance, buildSiteWarnings,
} from './pitDesignChecks.js';
import { buildSurface, designBenches, rectanglePolygon } from './pitDesign.js';

const square = (c, size) => rectanglePolygon(c, size, size, 0);

describe('densifyClosedPolygon', () => {
  it('فاصله‌ی نقاط پیاپی از step بیشتر نمی‌شود و رأس‌ها حفظ می‌شوند', () => {
    const poly = square([0, 0], 100);
    const pts = densifyClosedPolygon(poly, 10);
    expect(pts.length).toBe(40); // محیط ۴۰۰ متر ÷ ۱۰
    for (let i = 0; i < pts.length; i += 1) {
      const q = pts[(i + 1) % pts.length];
      expect(Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1])).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(pts[0]).toEqual(poly[0]);
  });
});

describe('distanceToPolygonEdges', () => {
  it('فاصله‌ی نقطه‌ی بیرون و داخل تا نزدیک‌ترین ضلع', () => {
    const poly = [[0, 0], [100, 0], [100, 100], [0, 100]];
    expect(distanceToPolygonEdges(150, 50, poly)).toBeCloseTo(50, 6);
    expect(distanceToPolygonEdges(90, 50, poly)).toBeCloseTo(10, 6);
    expect(distanceToPolygonEdges(130, 140, poly)).toBeCloseTo(Math.hypot(30, 40), 6); // گوشه
  });
});

describe('polygonCoverage', () => {
  it('سهم محیط روی پوشش را درست می‌شمارد', () => {
    const poly = square([0, 0], 100); // x,y از -50 تا 50
    const half = (x) => x <= 0;
    const r = polygonCoverage((x) => half(x), poly, 5);
    expect(r.fraction).toBeGreaterThan(0.45);
    expect(r.fraction).toBeLessThan(0.65);
    expect(polygonCoverage(() => true, poly).fraction).toBe(1);
    expect(polygonCoverage(() => false, poly).fraction).toBe(0);
  });
});

describe('boundaryExceedance', () => {
  it('طراحی کاملاً داخل مرز بیرون‌زدگی صفر دارد', () => {
    const r = boundaryExceedance(square([0, 0], 80), square([0, 0], 200));
    expect(r.outside).toBe(0);
    expect(r.maxOutsideM).toBe(0);
  });
  it('بیرون‌زدگی و بیشینه‌ی آن را گزارش می‌کند', () => {
    // طراحی ۲۰۰×۲۰۰ (±۱۰۰) در مرز ۱۰۰×۱۰۰ (±۵۰) → گوشه‌ها حدود ۵۰√۲ از مرز بیرون‌اند
    const r = boundaryExceedance(square([0, 0], 200), square([0, 0], 100));
    expect(r.outsideFraction).toBe(1);
    expect(r.maxOutsideM).toBeGreaterThan(50);
  });
});

function hillPoints(size, peak) {
  const pts = [];
  for (let i = 0; i <= size / 10; i += 1) {
    for (let j = 0; j <= size / 10; j += 1) {
      const x = i * 10; const y = j * 10;
      pts.push([x, y, peak - 0.3 * Math.hypot(x - size / 2, y - size / 2)]);
    }
  }
  return pts;
}
const params = {
  benchHeight: 10, benchFaceAngleDeg: 70, bermWidth: 5, bermWidthAuto: false, maxBenches: 40, bottomElevation: 350,
};

describe('buildSiteWarnings', () => {
  const surface = buildSurface(hillPoints(600, 500));
  const result = designBenches(surface, rectanglePolygon([300, 300], 40, 30, 0), params);

  it('طراحی داخل پوشش و داخل مرز → بدون هشدار', () => {
    const w = buildSiteWarnings({
      result, isCovered: tinCoverageFn(surface), boundaryPoly: square([300, 300], 2000),
    });
    expect(w).toEqual([]);
  });

  it('توپوگرافی کوچک‌تر از گودال → هشدار پوشش', () => {
    const small = buildSurface(hillPoints(200, 500).map(([x, y, z]) => [x + 200, y + 200, z])); // فقط 200..400
    const w = buildSiteWarnings({ result, isCovered: tinCoverageFn(small) });
    expect(w.length).toBe(1);
    expect(w[0].text).toContain('توپوگرافی');
  });

  it('طراحی بیرون از مرز پروانه → هشدار «bad»', () => {
    const w = buildSiteWarnings({ result, boundaryPoly: square([300, 300], 60) });
    expect(w.length).toBe(1);
    expect(w[0].level).toBe('bad');
    expect(w[0].text).toContain('پروانه');
  });

  it('مرز در سیستم مختصات دیگری (فاصله‌ی مراکز > ۲۰ کیلومتر) → بررسی مرز انجام نمی‌شود و هشدار هم‌سیستم‌نبودن می‌آید', () => {
    const far = square([300 + 500_000, 300 + 3_000_000], 60);
    const w = buildSiteWarnings({ result, boundaryPoly: far });
    expect(w.length).toBe(1);
    expect(w[0].level).toBe('warn');
    expect(w[0].text).toContain('هم‌سیستم');
  });

  it('فاصلهٔ ایمنی از مرز: طراحیِ داخل مرز با setback کافی هشدار می‌گیرد', () => {
    // گودال نهایی حدود ۱۰۰–۲۰۰ متر عرض دارد؛ مرز ۱۰۰۰ متری آن را در خود جا می‌دهد
    const finalPoly = result.benches[result.benches.length - 1].polygon;
    const xs = finalPoly.map((p) => p[0]);
    const half = (Math.max(...xs) - Math.min(...xs)) / 2;
    const boundary = square([300, 300], half * 2 + 40); // ۲۰ متر حاشیه هر طرف
    expect(buildSiteWarnings({ result, boundaryPoly: boundary })).toEqual([]);
    const w = buildSiteWarnings({ result, boundaryPoly: boundary, setbackM: 50 });
    expect(w.length).toBe(1);
    expect(w[0].level).toBe('bad');
    expect(w[0].text).toContain('فاصلهٔ ایمنی');
  });

  it('بدون پوشش و مرز → هیچ بررسی‌ای انجام نمی‌شود', () => {
    expect(buildSiteWarnings({ result })).toEqual([]);
  });
});

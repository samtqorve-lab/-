import { describe, it, expect } from 'vitest';
import {
  buildSurface, heightAt, polygonArea, pointInPolygon, polylineLength3D, densifyPath, fitPlane,
  polygonVolume, profileAlong, profileToCsv, profileToDxf, slopeVertexColors, compareSurfaces, diffVertexColors,
} from './model3dAnalysis.js';

/** سطح شبکه‌ای منظم (۰..size با گام step) از تابع ارتفاع f(x,y) */
function gridSurface(f, size = 30, step = 0.5) {
  const n = Math.round(size / step) + 1;
  const coords = new Float64Array(n * n * 2);
  const z = new Float64Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      coords[k * 2] = i * step; coords[k * 2 + 1] = j * step; z[k] = f(i * step, j * step);
    }
  }
  const tris = [];
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
      tris.push(a, b, d, a, d, c);
    }
  }
  return buildSurface(coords, new Uint32Array(tris), z);
}

// هرم مربعی به قاعده‌ی ۱۰×۱۰ و ارتفاع ۵ در مرکز (۱۵،۱۵)؛ حجم دقیق = ۱۰۰×۵/۳ = ۱۶۶٫۶۷
const pyramid = (x, y) => Math.max(0, 5 - Math.max(Math.abs(x - 15), Math.abs(y - 15)));
const PYRAMID_VOL = (100 * 5) / 3;
const POLY = [[8, 8], [22, 8], [22, 22], [8, 22]];

describe('هندسه‌ی پایه', () => {
  it('مساحت و نقطه‌درون‌پلیگون', () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBeCloseTo(100, 9);
    expect(polygonArea([[0, 0], [4, 0], [0, 3]])).toBeCloseTo(6, 9);
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(11, 5, sq)).toBe(false);
  });
  it('طول مسیر سه‌بعدی', () => {
    expect(polylineLength3D([[0, 0, 0], [3, 4, 0], [3, 4, 12]])).toBeCloseTo(17, 9);
  });
  it('ریزکردن مسیر فاصله‌ی نقاط را از گام بیشتر نمی‌کند', () => {
    const pts = densifyPath([[0, 0], [10, 0]], 1, false);
    expect(pts.length).toBe(11);
    for (let i = 1; i < pts.length; i += 1) expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(1.0000001);
  });
  it('برازش صفحه: صفحه‌ی دقیق، و هم‌خط → null', () => {
    const s = [];
    for (let i = 0; i < 5; i += 1) for (let j = 0; j < 5; j += 1) s.push([i, j, 2 + 0.3 * i - 0.1 * j]);
    const p = fitPlane(s);
    expect(p.a).toBeCloseTo(0.3, 9); expect(p.b).toBeCloseTo(-0.1, 9); expect(p.c).toBeCloseTo(2, 9);
    expect(p.rmse).toBeLessThan(1e-9);
    expect(fitPlane([[0, 0, 0], [1, 1, 1], [2, 2, 2]])).toBeNull();
    expect(fitPlane([[0, 0, 0], [1, 1, 1]])).toBeNull();
  });
});

describe('buildSurface / heightAt', () => {
  it('ارتفاع میان‌یابی‌شده و NaN بیرون از مش', () => {
    const s = gridSurface((x, y) => 0.1 * x + 0.05 * y);
    expect(heightAt(s, 10, 10)).toBeCloseTo(1.5, 6);
    expect(heightAt(s, 12.3, 4.7)).toBeCloseTo(0.1 * 12.3 + 0.05 * 4.7, 6);
    expect(Number.isNaN(heightAt(s, 100, 100))).toBe(true);
    expect(Number.isNaN(heightAt(s, -3, 5))).toBe(true);
  });
  it('ورودی نامعتبر خطا می‌دهد', () => {
    expect(() => buildSurface(new Float64Array(0), new Uint32Array(0), new Float64Array(0))).toThrow();
    expect(() => buildSurface(new Float64Array(4), new Uint32Array(0), new Float64Array(2))).toThrow();
  });
});

describe('polygonVolume', () => {
  it('هرم روی زمین تخت: حجم بالای صفحه‌ی مبنا ≈ ۱۶۶٫۶۷ (۲٪)', () => {
    const r = polygonVolume(gridSurface(pyramid), POLY, { base: 'plane' });
    expect(r.above).toBeGreaterThan(PYRAMID_VOL * 0.98);
    expect(r.above).toBeLessThan(PYRAMID_VOL * 1.02);
    expect(r.below).toBeLessThan(1);
    expect(r.coverage).toBe(1);
    expect(r.area).toBeCloseTo(196, 6);
    expect(r.maxHeight).toBeCloseTo(5, 0);
  });
  it('همان هرم روی زمین شیب‌دار: صفحه‌ی مبنا شیب را حذف می‌کند (۳٪)', () => {
    const r = polygonVolume(gridSurface((x, y) => pyramid(x, y) + 0.1 * x + 0.05 * y), POLY, { base: 'plane' });
    expect(r.above).toBeGreaterThan(PYRAMID_VOL * 0.97);
    expect(r.above).toBeLessThan(PYRAMID_VOL * 1.03);
    expect(r.base.plane.a).toBeCloseTo(0.1, 3);
    expect(r.base.plane.b).toBeCloseTo(0.05, 3);
  });
  it('مبنای min / mean روی زمین تخت با plane برابرند', () => {
    const s = gridSurface(pyramid);
    const a = polygonVolume(s, POLY, { base: 'plane' }).above;
    expect(polygonVolume(s, POLY, { base: 'min' }).above).toBeCloseTo(a, 0);
    expect(polygonVolume(s, POLY, { base: 'mean' }).above).toBeCloseTo(a, 0);
  });
  it('تراز دلخواه ۲ متر: فقط هرمِ بالای تراز ۲ (قاعده ۶، ارتفاع ۳ → ۳۶) و زیرِ تراز ≈ بخش زمین', () => {
    const r = polygonVolume(gridSurface(pyramid), POLY, { base: 'level', level: 2 });
    expect(r.above).toBeGreaterThan(36 * 0.96);
    expect(r.above).toBeLessThan(36 * 1.04);
    expect(r.below).toBeGreaterThan(0);
  });
  it('پلیگونی که نیمی از آن بیرون از مدل است: coverage بین ۰ و ۱', () => {
    const r = polygonVolume(gridSurface(pyramid), [[20, 8], [40, 8], [40, 22], [20, 22]], { base: 'min' });
    expect(r.coverage).toBeGreaterThan(0.3);
    expect(r.coverage).toBeLessThan(0.7);
  });
  it('پلیگون کاملاً بیرون از مدل یا کمتر از ۳ نقطه → خطای فارسی روشن', () => {
    const s = gridSurface(pyramid);
    expect(() => polygonVolume(s, [[100, 100], [110, 100], [110, 110], [100, 110]])).toThrow(/روی خود مدل/);
    expect(() => polygonVolume(s, [[1, 1], [2, 2]])).toThrow(/۳ نقطه/);
    expect(() => polygonVolume(s, [[1, 1], [2, 2], [3, 3]])).toThrow(/صفر/);
    expect(() => polygonVolume(s, POLY, { base: 'xyz' })).toThrow(/نامعتبر/);
    expect(() => polygonVolume(s, POLY, { base: 'level', level: Number.NaN })).toThrow(/نامعتبر/);
  });
});

describe('profileAlong / خروجی‌ها', () => {
  const s = gridSurface((x) => 0.1 * x);
  it('شیب ثابت ۰٫۱ → ۵٫۷۱ درجه و ارتفاع‌های درست', () => {
    const p = profileAlong(s, [2, 10], [22, 10], 1);
    expect(p.length).toBeCloseTo(20, 9);
    expect(p.samples[0].z).toBeCloseTo(0.2, 6);
    expect(p.samples[p.samples.length - 1].z).toBeCloseTo(2.2, 6);
    expect(p.maxSlopeDeg).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 3);
    expect(p.validCount).toBe(p.samples.length);
  });
  it('بخشی از مقطع بیرون از مدل: NaN و CSV بدون عدد نامعتبر', () => {
    const p = profileAlong(s, [20, 10], [40, 10], 1);
    expect(p.samples.some((x) => Number.isNaN(x.z))).toBe(true);
    const csv = profileToCsv(p.samples);
    expect(csv).not.toMatch(/NaN|Infinity/);
    expect(csv.split('\r\n')[0]).toBe('station_m,x_local,y_local,z_local');
  });
  it('CSV با آفست RTC مختصات مطلق می‌دهد', () => {
    const p = profileAlong(s, [2, 10], [4, 10], 1);
    const csv = profileToCsv(p.samples, [650000, 3890000, 1000]);
    const row = csv.split('\r\n')[1].split(',');
    expect(row[0]).toBe('0.00');
    expect(Number(row[1])).toBeCloseTo(650002, 1);
    expect(Number(row[2])).toBeCloseTo(3890010, 1);
    expect(Number(row[3])).toBeCloseTo(1000.2, 2);
    expect(csv.split('\r\n')[0]).toBe('station_m,easting,northing,elevation_m');
  });
  it('DXF ساختار R12 دارد، با شکاف دو POLYLINE می‌شود و NaN ندارد', () => {
    const samples = [
      { d: 0, x: 0, y: 0, z: 1 }, { d: 1, x: 1, y: 0, z: 2 }, { d: 2, x: 2, y: 0, z: NaN },
      { d: 3, x: 3, y: 0, z: 3 }, { d: 4, x: 4, y: 0, z: 4 },
    ];
    const dxf = profileToDxf(samples, { layer: 'مقطع 1' });
    expect(dxf.startsWith('0\r\nSECTION')).toBe(true);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect((dxf.match(/POLYLINE/g) || []).length).toBe(2); // نقطه‌ی NaN وسط، مقطع را به دو POLYLINE می‌شکند
    expect((dxf.match(/VERTEX/g) || []).length).toBe(4);
    expect((dxf.match(/SEQEND/g) || []).length).toBe(2);
    expect(dxf).not.toMatch(/NaN/);
    expect(dxf).not.toMatch(/[\u0600-\u06FF]/); // نام لایه‌ی فارسی به ASCII امن تبدیل می‌شود (DXF قدیمی unicode ندارد)
  });
  it('نقاط یکسان → خطا', () => {
    expect(() => profileAlong(s, [5, 5], [5, 5])).toThrow(/یکی/);
  });
});

describe('slopeVertexColors', () => {
  const s = gridSurface(pyramid);
  const idxOf = (x, y) => Math.round(y / 0.5) * 61 + Math.round(x / 0.5);
  it('زمین تخت سبز و سینه‌ی ۴۵ درجه‌ی هرم با آستانه‌ی ۴۰ قرمز؛ با آستانه‌ی ۶۰ زرد', () => {
    const red = slopeVertexColors(s, { gentle: 30, steep: 40 });
    const g = idxOf(2, 2); const f = idxOf(11, 15);
    expect([red.colors[g * 3], red.colors[g * 3 + 1]]).toEqual([expect.closeTo(0.25, 5), expect.closeTo(0.68, 5)]);
    expect(red.colors[f * 3]).toBeCloseTo(0.86, 5);
    expect(red.maxSlopeDeg).toBeGreaterThan(44);
    const amber = slopeVertexColors(s, { gentle: 30, steep: 60 });
    expect(amber.colors[f * 3 + 1]).toBeCloseTo(0.74, 5);
  });
  it('درصد مساحت پرشیب منطقی است (هرم ۱۰×۱۰ از ۳۰×۳۰ ≈ ۱۱٪)', () => {
    const r = slopeVertexColors(s, { gentle: 30, steep: 40 });
    expect(r.steepAreaPct).toBeGreaterThan(9);
    expect(r.steepAreaPct).toBeLessThan(13);
    expect(r.colors.length).toBe(s.vertexCount * 3);
  });
});

describe('compareSurfaces / diffVertexColors', () => {
  const ref = gridSurface(pyramid);
  it('سطح جدید یکنواخت ۱٫۵ متر بالاتر: فقط فیل = مساحت × ۱٫۵، کات صفر', () => {
    const cur = gridSurface((x, y) => pyramid(x, y) + 1.5);
    const r = compareSurfaces(cur, ref);
    expect(r.fill).toBeCloseTo(30 * 30 * 1.5, 0);
    expect(r.cut).toBeCloseTo(0, 6);
    expect(r.coverage).toBeCloseTo(1, 6);
    expect(r.medianDz).toBeCloseTo(1.5, 5);
  });
  it('سطح ۱ متر پایین‌تر: فقط کات؛ و zBias=+۱ آن را خنثی می‌کند', () => {
    const cur = gridSurface((x, y) => pyramid(x, y) - 1);
    const r = compareSurfaces(cur, ref);
    expect(r.cut).toBeCloseTo(900, 0);
    expect(r.fill).toBeCloseTo(0, 6);
    const fixed = compareSurfaces(cur, ref, { zBias: 1 });
    expect(fixed.net).toBeCloseTo(0, 3);
  });
  it('جابه‌جایی مبدأ (shift) ناحیه‌ی هم‌پوشان را کم می‌کند: ۵ متر روی ۳۰ → پوشش ≈ ۸۳٪', () => {
    const cur = gridSurface((x, y) => pyramid(x, y));
    const r = compareSurfaces(cur, ref, { shift: [5, 0, 0] });
    expect(r.coverage).toBeGreaterThan(0.8);
    expect(r.coverage).toBeLessThan(0.86);
  });
  it('اختلاف مبدأ ارتفاعی (shift z) در dz لحاظ می‌شود', () => {
    const cur = gridSurface((x, y) => pyramid(x, y));
    const r = compareSurfaces(cur, ref, { shift: [0, 0, 2] });
    expect(r.medianDz).toBeCloseTo(2, 5);
  });
  it('رنگ‌ها: کات قرمز، فیل آبی، بی‌تغییر سفید، بدون‌داده خاکستری', () => {
    const c = diffVertexColors(Float32Array.from([-2, 2, 0, NaN]), 2);
    expect(Array.from(c.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(c.slice(3, 6))).toEqual([0, 0, 1]);
    expect(Array.from(c.slice(6, 9))).toEqual([1, 1, 1]);
    expect(c[9]).toBeCloseTo(0.45, 5);
  });
});

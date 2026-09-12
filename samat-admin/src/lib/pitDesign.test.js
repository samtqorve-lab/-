import { describe, it, expect } from 'vitest';
import {
  bermWidthRitchie, benchSetback, overallSlopeAngleDeg, rectanglePolygon,
  offsetPolygonOutward, buildSurface, designBenches, computeCutVolume, polygonArea,
} from './pitDesign.js';

describe('bermWidthRitchie', () => {
  it('برای ارتفاع پلهٔ ۱۰ متر باید ۶.۵ متر بدهد (0.2*10+4.5)', () => {
    expect(bermWidthRitchie(10)).toBeCloseTo(6.5, 6);
  });
});

describe('benchSetback / overallSlopeAngleDeg', () => {
  it('واپس‌روی و شیب کلی باید با فرمول مثلثاتی سازگار باشند', () => {
    const params = {
      benchHeight: 10, benchFaceAngleDeg: 70, bermWidth: 5, bermWidthAuto: false,
    };
    const setback = benchSetback(params);
    // H/tan(70) + 5
    const expected = 10 / Math.tan((70 * Math.PI) / 180) + 5;
    expect(setback).toBeCloseTo(expected, 6);
    const overall = overallSlopeAngleDeg(params);
    expect(overall).toBeCloseTo((Math.atan(10 / setback) * 180) / Math.PI, 6);
    // شیب کلی همیشه باید کمتر از شیب سینهٔ پله باشد (چون برم اضافه می‌شود)
    expect(overall).toBeLessThan(70);
  });
});

describe('rectanglePolygon / polygonArea', () => {
  it('مستطیل بدون چرخش باید مساحت طول×عرض بدهد', () => {
    const poly = rectanglePolygon([0, 0], 100, 50, 0);
    expect(polygonArea(poly)).toBeCloseTo(5000, 3);
  });
});

describe('offsetPolygonOutward', () => {
  it('آفست یک مربع به بیرون باید مساحت را افزایش دهد و مربع بماند', () => {
    const square = rectanglePolygon([0, 0], 100, 100, 0);
    const grown = offsetPolygonOutward(square, 10);
    // مربع جدید باید تقریباً ۱۲۰×۱۲۰ باشد
    expect(polygonArea(grown)).toBeCloseTo(120 * 120, -1);
  });
});

function flatHill(cx, cy, peak) {
  // یک سطح مخروطی‌شکل ساده برای تست: هرچه از مرکز دورتر، پایین‌تر
  const pts = [];
  for (let i = 0; i < 30; i += 1) {
    for (let j = 0; j < 30; j += 1) {
      const x = i * 20; const y = j * 20;
      const d = Math.hypot(x - cx, y - cy);
      pts.push([x, y, peak - 0.3 * d]);
    }
  }
  return pts;
}

describe('designBenches (end-to-end روی تپهٔ ساختگی)', () => {
  it('باید چند پله تولید کند که ارتفاعشان صعودی و در نهایت به سطح برسد', () => {
    const points = flatHill(300, 300, 500);
    const surface = buildSurface(points);
    const bottom = rectanglePolygon([300, 300], 40, 30, 0);
    const params = {
      benchHeight: 10, benchFaceAngleDeg: 70, bermWidth: 5, bermWidthAuto: false,
      maxBenches: 40, bottomElevation: 350,
    };
    const result = designBenches(surface, bottom, params);
    expect(result.benches.length).toBeGreaterThan(2);
    for (let i = 1; i < result.benches.length; i += 1) {
      expect(result.benches[i].elevation).toBeGreaterThan(result.benches[i - 1].elevation);
      expect(polygonArea(result.benches[i].polygon)).toBeGreaterThan(polygonArea(result.benches[i - 1].polygon));
    }
    expect(result.benches[result.benches.length - 1].outcropped).toBe(true);
  });

  it('حجم خاک‌برداری محاسبه‌شده باید مثبت باشد', () => {
    const points = flatHill(300, 300, 500);
    const surface = buildSurface(points);
    const bottom = rectanglePolygon([300, 300], 40, 30, 0);
    const params = {
      benchHeight: 10, benchFaceAngleDeg: 70, bermWidth: 5, bermWidthAuto: false,
      maxBenches: 40, bottomElevation: 350,
    };
    const result = designBenches(surface, bottom, params);
    const vol = computeCutVolume(surface, result, 10);
    expect(vol.totalCutM3).toBeGreaterThan(0);
  });
});

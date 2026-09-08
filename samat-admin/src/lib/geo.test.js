import { describe, it, expect } from 'vitest';
import {
  haversineMeters, dmsToDec, decToDms, polygonAreaM2,
} from './geo.js';

describe('haversineMeters', () => {
  it('یک درجه اختلاف عرض جغرافیایی باید تقریباً ۱۱۱.۲ کیلومتر باشد (مقدار استاندارد شناخته‌شده)', () => {
    const d = haversineMeters(35, 47, 36, 47);
    expect(d).toBeGreaterThan(110500);
    expect(d).toBeLessThan(111500);
  });
  it('فاصله‌ی یک نقطه با خودش باید صفر باشد', () => {
    expect(haversineMeters(35.1, 47.8, 35.1, 47.8)).toBe(0);
  });
});

describe('dmsToDec', () => {
  it('رشته‌ی درجه/دقیقه/ثانیه را درست تبدیل کند', () => {
    // 47° 48' 23" = 47 + 48/60 + 23/3600
    const v = dmsToDec('47° 48\' 23"');
    expect(v).toBeCloseTo(47 + 48 / 60 + 23 / 3600, 6);
  });
  it('عدد اعشاری ساده را همان‌طور برگرداند', () => {
    expect(dmsToDec('47.8')).toBeCloseTo(47.8, 6);
  });
  it('مقدار خالی/نامعتبر باید null بدهد', () => {
    expect(dmsToDec('')).toBeNull();
    expect(dmsToDec(null)).toBeNull();
  });
  it('علامت منفی باید حفظ شود (نیم‌کره‌ی جنوبی/غربی)', () => {
    const v = dmsToDec('-47° 30\' 0"');
    expect(v).toBeCloseTo(-47.5, 6);
  });
});

describe('decToDms / dmsToDec round-trip', () => {
  it('تبدیل رفت‌وبرگشت باید مقدار اصلی را (با دقت ثانیه) برگرداند', () => {
    const original = 47.80638888888889;
    const dms = decToDms(original);
    const back = dmsToDec(dms);
    expect(back).toBeCloseTo(original, 3);
  });
});

describe('polygonAreaM2', () => {
  it('یک مربع تقریبی ۱۰۰×۱۰۰ متری باید مساحتی نزدیک به ۱۰,۰۰۰ متر مربع بدهد', () => {
    // در عرض جغرافیایی ۳۵ درجه، هر ۰.0009 درجه تقریباً ۱۰۰ متر است
    const points = [
      { lat: 35.0000, lon: 47.8000 },
      { lat: 35.0000, lon: 47.8011 },
      { lat: 35.0009, lon: 47.8011 },
      { lat: 35.0009, lon: 47.8000 },
    ];
    const area = polygonAreaM2(points);
    expect(area).toBeGreaterThan(8000);
    expect(area).toBeLessThan(12000);
  });
  it('کمتر از ۳ نقطه باید صفر بدهد (چندضلعی معتبر نیست)', () => {
    expect(polygonAreaM2([{ lat: 35, lon: 47 }])).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  utmZoneForLon, latLonToUtm, utmToLatLon, formatUtm,
} from './utm.js';

describe('utmZoneForLon', () => {
  it('محدوده‌ی قروه/کردستان (حدود ۴۷.۸ درجه شرقی) باید zone ۳۸ بدهد', () => {
    expect(utmZoneForLon(47.8)).toBe(38);
  });
  it('نصف‌النهار گرینویچ باید zone ۳۱ بدهد', () => {
    expect(utmZoneForLon(0)).toBe(31);
  });
  it('لبه‌ی غربی هر zone باید دقیقاً همان zone را بدهد نه zone قبلی', () => {
    // هر zone ۶ درجه عرض دارد و از (zone-1)*6-180 شروع می‌شود
    expect(utmZoneForLon(-180)).toBe(1);
    expect(utmZoneForLon(179.999)).toBe(60);
  });
});

describe('latLonToUtm / utmToLatLon (round-trip)', () => {
  it('برای یک نقطه‌ی واقعی نزدیک قروه، تبدیل رفت‌وبرگشت باید همان مختصات اولیه را بدهد (خطای زیر ۱ متر)', () => {
    const lat0 = 35.1637; const lon0 = 47.8064; // نزدیک قروه، کردستان
    const utm = latLonToUtm(lat0, lon0);
    const back = utmToLatLon(utm.zone, utm.hemisphere, utm.easting, utm.northing);
    // ۱ متر ≈ ۰.۰۰۰۰۰۹ درجه — یک آستانه‌ی خیلی سخت‌گیرانه برای فرمول ترانسورس مرکاتور استاندارد
    expect(back.lat).toBeCloseTo(lat0, 5);
    expect(back.lon).toBeCloseTo(lon0, 5);
  });

  it('برای نیم‌کره‌ی جنوبی هم رفت‌وبرگشت درست کار کند (northing با ۱۰,۰۰۰,۰۰۰ آفست می‌شود)', () => {
    const lat0 = -20.5; const lon0 = 47.8;
    const utm = latLonToUtm(lat0, lon0);
    expect(utm.hemisphere).toBe('S');
    const back = utmToLatLon(utm.zone, utm.hemisphere, utm.easting, utm.northing);
    expect(back.lat).toBeCloseTo(lat0, 5);
    expect(back.lon).toBeCloseTo(lon0, 5);
  });

  it('استوا/نیم‌کره‌ی شمالی مرزی — نباید آفست جنوبی اشتباهی اعمال شود', () => {
    const lat0 = 0.001; const lon0 = 47.8;
    const utm = latLonToUtm(lat0, lon0);
    expect(utm.hemisphere).toBe('N');
  });
});

describe('formatUtm', () => {
  it('خروجی خوانا با گرد کردن به عدد صحیح تولید کند', () => {
    const s = formatUtm({
      zone: 38, hemisphere: 'N', easting: 123456.78, northing: 3898765.43,
    });
    expect(s).toBe('38N  123457E  3898765N');
  });
});

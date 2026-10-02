import { describe, it, expect } from 'vitest';
import {
  readRtcCenter, parseEpsgUtm, resolveUtmZone, buildGeoref, enuToUtm, utmToEnu, enuToLatLon,
  cornersToEnu, checkGeorefConsistency, describePoint,
} from './model3dGeo.js';
import { latLonToUtm } from './utm.js';

// مرکز تقریبی شهرستان قروه (زون ۳۸ شمالی)
const QORVEH = [35.17, 47.80];

describe('readRtcCenter', () => {
  it('مرکز CESIUM_RTC که ODM می‌نویسد را می‌خواند (z پیش‌فرض صفر)', () => {
    expect(readRtcCenter({ extensions: { CESIUM_RTC: { center: [650123.5, 3892100.25, 0] } } })).toEqual([650123.5, 3892100.25, 0]);
    expect(readRtcCenter({ extensions: { CESIUM_RTC: { center: [1, 2] } } })).toEqual([1, 2, 0]);
  });
  it('اگر افزونه نبود یا نامعتبر بود null برمی‌گرداند', () => {
    expect(readRtcCenter(null)).toBeNull();
    expect(readRtcCenter({})).toBeNull();
    expect(readRtcCenter({ extensions: {} })).toBeNull();
    expect(readRtcCenter({ extensions: { CESIUM_RTC: { center: [1] } } })).toBeNull();
    expect(readRtcCenter({ extensions: { CESIUM_RTC: { center: ['a', 2, 3] } } })).toBeNull();
    expect(readRtcCenter({ extensions: { CESIUM_RTC: { center: [1, Infinity, 3] } } })).toBeNull();
  });
});

describe('parseEpsgUtm / resolveUtmZone', () => {
  it('EPSG UTM شمالی و جنوبی', () => {
    expect(parseEpsgUtm('EPSG:32638')).toEqual({ zone: 38, hemisphere: 'N' });
    expect(parseEpsgUtm('EPSG:32739')).toEqual({ zone: 39, hemisphere: 'S' });
    expect(parseEpsgUtm('EPSG:4326')).toBeNull();
    expect(parseEpsgUtm('EPSG:32600')).toBeNull();
    expect(parseEpsgUtm(undefined)).toBeNull();
  });
  it('اولویت با crs است و در غیاب آن مرکز گوشه‌های پروانه', () => {
    expect(resolveUtmZone({ crs: 'EPSG:32639', corners: [QORVEH] })).toMatchObject({ zone: 39, source: 'crs' });
    expect(resolveUtmZone({ corners: [QORVEH, [35.18, 47.81]] })).toMatchObject({ zone: 38, hemisphere: 'N', source: 'mine' });
    expect(resolveUtmZone({})).toBeNull();
    expect(resolveUtmZone({ corners: [[NaN, 1]] })).toBeNull();
  });
  it('بدون RTC یا بدون زون، georef ساخته نمی‌شود', () => {
    expect(buildGeoref({ rtc: null, crs: 'EPSG:32638' })).toBeNull();
    expect(buildGeoref({ rtc: [1, 2, 0] })).toBeNull();
    expect(buildGeoref({ rtc: [1, 2, 0], crs: 'EPSG:32638' })).toMatchObject({ zone: 38, hemisphere: 'N' });
  });
});

describe('تبدیل ENU محلی ⇄ UTM ⇄ lat/lon', () => {
  const u0 = latLonToUtm(QORVEH[0], QORVEH[1]);
  const georef = buildGeoref({ rtc: [Math.round(u0.easting), Math.round(u0.northing), 0], crs: 'EPSG:32638' });

  it('enuToUtm و utmToEnu معکوس یکدیگرند', () => {
    const u = enuToUtm(georef, 10.5, -20.25, 3);
    expect(u.easting).toBeCloseTo(georef.rtc[0] + 10.5, 6);
    expect(u.northing).toBeCloseTo(georef.rtc[1] - 20.25, 6);
    expect(u.elevation).toBeCloseTo(3, 6);
    const back = utmToEnu(georef, u.easting, u.northing, u.elevation);
    expect(back[0]).toBeCloseTo(10.5, 6); expect(back[1]).toBeCloseTo(-20.25, 6); expect(back[2]).toBeCloseTo(3, 6);
  });
  it('نقطه‌ی مبدأ به تقریب طول/عرض مرکز قروه برمی‌گردد (کمتر از ۱ متر ≈ ۱e-5 درجه)', () => {
    const ll = enuToLatLon(georef, 0, 0);
    expect(Math.abs(ll.lat - QORVEH[0])).toBeLessThan(1e-4);
    expect(Math.abs(ll.lon - QORVEH[1])).toBeLessThan(1e-4);
  });
  it('cornersToEnu همان UTM گوشه منهای RTC است، حتی با زون اجباری', () => {
    const enu = cornersToEnu(georef, [QORVEH]);
    const u = latLonToUtm(QORVEH[0], QORVEH[1], 38);
    expect(enu[0][0]).toBeCloseTo(u.easting - georef.rtc[0], 6);
    expect(enu[0][1]).toBeCloseTo(u.northing - georef.rtc[1], 6);
  });
});

describe('checkGeorefConsistency', () => {
  const u0 = latLonToUtm(QORVEH[0], QORVEH[1]);
  const georef = buildGeoref({ rtc: [Math.round(u0.easting), Math.round(u0.northing), 0], crs: 'EPSG:32638' });
  const corners = [[35.169, 47.799], [35.171, 47.799], [35.171, 47.801], [35.169, 47.801]];

  it('مدلی که روی پروانه افتاده سازگار است', () => {
    const r = checkGeorefConsistency(georef, {
      minE: -300, maxE: 300, minN: -300, maxN: 300,
    }, corners);
    expect(r.status).toBe('ok');
  });
  it('مدلی که ۲۰ کیلومتر دورتر است «bad» است (نشانه‌ی زون یا آفست غلط)', () => {
    const r = checkGeorefConsistency(georef, {
      minE: 20000, maxE: 20600, minN: -300, maxN: 300,
    }, corners);
    expect(r.status).toBe('bad');
    expect(r.distance).toBeGreaterThan(15000);
  });
  it('بدون گوشه یا بدون georef، null', () => {
    expect(checkGeorefConsistency(georef, {
      minE: 0, maxE: 1, minN: 0, maxN: 1,
    }, [])).toBeNull();
    expect(checkGeorefConsistency(null, {
      minE: 0, maxE: 1, minN: 0, maxN: 1,
    }, corners)).toBeNull();
  });
});

describe('describePoint', () => {
  it('بدون georef صادقانه می‌گوید موقعیت جغرافیایی ثبت نشده', () => {
    expect(describePoint(null, 1, 2, 3)).toContain('ثبت نشده');
  });
  it('با georef شامل زون UTM است', () => {
    const georef = buildGeoref({ rtc: [650000, 3890000, 0], crs: 'EPSG:32638' });
    expect(describePoint(georef, 1, 2, 3)).toContain('38N');
  });
});

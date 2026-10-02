// موقعیت‌یابی جغرافیایی مدل سه‌بعدی پهباد (GLB خروجی OpenDroneMap) — فقط توابع خالص (بدون DOM و بدون THREE)
// تا جداگانه تست شوند.
//
// ODM مختصات رأس‌های مدل را «نسبت به یک مبدأ» می‌نویسد (برای دقت اعداد اعشاری) و آن مبدأ UTM را در افزونه‌ی
// استاندارد CESIUM_RTC داخل خود فایل GLB می‌گذارد: extensions.CESIUM_RTC.center = [x, y, 0]
// (سورس ODM: opendm/gltf.py با rtc=reconstruction.get_proj_offset()). پس برای هر رأس:
//     شرق UTM = x_محلی + center[0]    شمال UTM = y_محلی + center[1]    ارتفاع = z_محلی + center[2]
// «محلی» یعنی دستگاه ENU: x شرق، y شمال، z بالا. نمایشگر مدل را (در صورت لزوم) می‌چرخاند تا بالا = Y شود؛
// تبدیل بین دستگاه صحنه و ENU در model3dScene.js انجام می‌شود، نه اینجا.
//
// زون UTM داخل GLB نیست؛ از EPSG ثبت‌شده در summary کار (مثلاً EPSG:32638) یا در غیاب آن از مختصات گوشه‌های
// پروانه‌ی معدن حدس زده می‌شود. چون حدس غلط (زون یا آفست) مدل را کیلومترها جابه‌جا نشان می‌دهد،
// checkGeorefConsistency فاصله‌ی مرکز مدل تا مرکز پروانه را می‌سنجد و هشدار می‌دهد.

import {
  latLonToUtm, utmToLatLon, utmZoneForLon,
} from './utm.js';

/** مرکز RTC را از JSON فایل glTF می‌خواند؛ اگر نبود یا نامعتبر بود null. @returns {[number, number, number]|null} */
export function readRtcCenter(gltfJson) {
  const ext = gltfJson && gltfJson.extensions && gltfJson.extensions.CESIUM_RTC;
  const c = ext && ext.center;
  if (!Array.isArray(c) || c.length < 2) return null;
  const out = [Number(c[0]), Number(c[1]), c.length > 2 ? Number(c[2]) : 0];
  return out.every(Number.isFinite) ? out : null;
}

/** «EPSG:32638» → {zone: 38, hemisphere: 'N'}؛ غیر UTM-WGS84 → null */
export function parseEpsgUtm(crs) {
  const m = /^EPSG:(326|327)(\d{2})$/i.exec(String(crs || '').trim());
  if (!m) return null;
  const zone = Number(m[2]);
  if (zone < 1 || zone > 60) return null;
  return { zone, hemisphere: m[1] === '326' ? 'N' : 'S' };
}

/**
 * زون UTM مدل را تعیین می‌کند: اول EPSG ثبت‌شده‌ی کار، بعد مرکز گوشه‌های پروانه‌ی معدن.
 * @param {{ crs?: string, corners?: Array<[number, number]> }} src corners: [[lat, lon], ...]
 * @returns {{ zone: number, hemisphere: 'N'|'S', source: 'crs'|'mine' }|null}
 */
export function resolveUtmZone({ crs, corners } = {}) {
  const fromCrs = parseEpsgUtm(crs);
  if (fromCrs) return { ...fromCrs, source: 'crs' };
  const pts = (corners || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return null;
  const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { zone: utmZoneForLon(lon), hemisphere: lat < 0 ? 'S' : 'N', source: 'mine' };
}

/**
 * ساخت «زمین‌مرجع» مدل. اگر RTC یا زون موجود نباشد null برمی‌گرداند و نمایشگر فقط مختصات محلی نشان می‌دهد.
 * @returns {{ rtc: number[], zone: number, hemisphere: string, zoneSource: string }|null}
 */
export function buildGeoref({ rtc, crs, corners } = {}) {
  if (!rtc) return null;
  const z = resolveUtmZone({ crs, corners });
  if (!z) return null;
  return {
    rtc, zone: z.zone, hemisphere: z.hemisphere, zoneSource: z.source,
  };
}

/** نقطه‌ی ENU محلی (متر) → UTM مطلق */
export function enuToUtm(georef, e, n, u) {
  return {
    easting: georef.rtc[0] + e,
    northing: georef.rtc[1] + n,
    elevation: georef.rtc[2] + u,
  };
}

/** UTM مطلق → ENU محلی */
export function utmToEnu(georef, easting, northing, elevation = 0) {
  return [easting - georef.rtc[0], northing - georef.rtc[1], elevation - georef.rtc[2]];
}

/** ENU محلی → طول/عرض جغرافیایی */
export function enuToLatLon(georef, e, n) {
  const u = enuToUtm(georef, e, n, 0);
  return utmToLatLon(georef.zone, georef.hemisphere, u.easting, u.northing);
}

/**
 * گوشه‌های پروانه [[lat, lon], ...] را روی همان زون مدل به ENU محلی [[e, n], ...] می‌برد.
 */
export function cornersToEnu(georef, corners) {
  return (corners || []).map(([lat, lon]) => {
    const u = latLonToUtm(lat, lon, georef.zone);
    return [u.easting - georef.rtc[0], u.northing - georef.rtc[1]];
  });
}

/**
 * سازگاری مدل با محل ثبت‌شده‌ی معدن: فاصله‌ی مرکز محدوده‌ی مدل تا مرکز گوشه‌های پروانه.
 * مدل پهباد باید روی خود معدن باشد؛ فاصله‌ی زیاد یعنی زون/آفست اشتباه یا پروانه‌ی نادرست.
 * @param {{ minE: number, maxE: number, minN: number, maxN: number }} bboxEnu محدوده‌ی مدل در ENU محلی
 * @returns {{ distance: number, status: 'ok'|'warn'|'bad' }|null} null اگر گوشه‌ای ثبت نشده
 */
export function checkGeorefConsistency(georef, bboxEnu, corners) {
  if (!georef || !bboxEnu) return null;
  const enu = cornersToEnu(georef, corners);
  if (!enu.length) return null;
  const cE = enu.reduce((s, p) => s + p[0], 0) / enu.length;
  const cN = enu.reduce((s, p) => s + p[1], 0) / enu.length;
  const mE = (bboxEnu.minE + bboxEnu.maxE) / 2;
  const mN = (bboxEnu.minN + bboxEnu.maxN) / 2;
  const distance = Math.hypot(cE - mE, cN - mN);
  // اگر مرکز پروانه داخل محدوده‌ی مدل باشد قطعاً سازگار است؛ وگرنه با فاصله می‌سنجیم
  const inside = cE >= bboxEnu.minE && cE <= bboxEnu.maxE && cN >= bboxEnu.minN && cN <= bboxEnu.maxN;
  let status = 'bad';
  if (inside || distance <= 2000) status = 'ok';
  else if (distance <= 10000) status = 'warn';
  return { distance, status };
}

const fmtFa = (v, digits = 1) => v.toLocaleString('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** متن خوانا از یک نقطه‌ی ENU محلی (UTM + طول/عرض + ارتفاع) برای پنل نتایج */
export function describePoint(georef, e, n, u) {
  if (!georef) {
    return `محلی: x ${fmtFa(e, 2)} · y ${fmtFa(n, 2)} · ارتفاع ${fmtFa(u, 2)} م (موقعیت جغرافیایی در این مدل ثبت نشده)`;
  }
  const utm = enuToUtm(georef, e, n, u);
  const ll = enuToLatLon(georef, e, n);
  return `${georef.zone}${georef.hemisphere} · E ${fmtFa(utm.easting, 1)} · N ${fmtFa(utm.northing, 1)} · ارتفاع ${fmtFa(utm.elevation, 1)} م · ${ll.lat.toFixed(6)}°, ${ll.lon.toFixed(6)}°`;
}

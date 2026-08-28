// تبدیل UTM ⇄ طول/عرض جغرافیایی روی بیضوی WGS84 — فرمول‌های استاندارد ترانسورس مرکاتور
// (منبع: Snyder, "Map Projections: A Working Manual"، همان فرمول‌های رایج در ابزارهای GIS).

const A = 6378137.0; // شعاع بزرگ بیضوی WGS84
const F = 1 / 298.257223563; // تخت‌شدگی
const E2 = F * (2 - F);
const E2P = E2 / (1 - E2);
const K0 = 0.9996;

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function utmZoneForLon(lon) {
  return Math.floor((lon + 180) / 6) + 1;
}

/** طول/عرض جغرافیایی (درجه‌ی اعشاری) → UTM */
export function latLonToUtm(lat, lon) {
  const zone = utmZoneForLon(lon);
  const lonOrigin = toRad((zone - 1) * 6 - 180 + 3);
  const latR = toRad(lat);
  const lonR = toRad(lon);

  const N = A / Math.sqrt(1 - E2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = E2P * Math.cos(latR) ** 2;
  const Aa = Math.cos(latR) * (lonR - lonOrigin);
  const M = A * (
    (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * latR
    - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * latR)
    + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * latR)
    - ((35 * E2 ** 3) / 3072) * Math.sin(6 * latR)
  );

  let easting = K0 * N * (Aa + ((1 - T + C) * Aa ** 3) / 6
    + ((5 - 18 * T + T ** 2 + 72 * C - 58 * E2P) * Aa ** 5) / 120) + 500000.0;
  let northing = K0 * (M + N * Math.tan(latR) * ((Aa ** 2) / 2
    + ((5 - T + 9 * C + 4 * C ** 2) * Aa ** 4) / 24
    + ((61 - 58 * T + T ** 2 + 600 * C - 330 * E2P) * Aa ** 6) / 720));

  const hemisphere = lat < 0 ? 'S' : 'N';
  if (hemisphere === 'S') northing += 10000000.0;

  easting = Math.round(easting * 100) / 100;
  northing = Math.round(northing * 100) / 100;
  return {
    zone, hemisphere, easting, northing,
  };
}

/** UTM → طول/عرض جغرافیایی (درجه‌ی اعشاری) */
export function utmToLatLon(zone, hemisphere, easting, northing) {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const x = easting - 500000.0;
  let y = northing;
  if (hemisphere === 'S' || hemisphere === 's') y -= 10000000.0;

  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));

  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = E2P * Math.cos(phi1) ** 2;
  const R1 = (A * (1 - E2)) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * K0);

  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * ((D ** 2) / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * E2P) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * E2P - 3 * C1 ** 2) * D ** 6) / 720);
  const lonOrigin = toRad((zone - 1) * 6 - 180 + 3);
  const lon = lonOrigin + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * E2P + 24 * T1 ** 2) * D ** 5) / 120) / Math.cos(phi1);

  return { lat: toDeg(lat), lon: toDeg(lon) };
}

export function formatUtm({
  zone, hemisphere, easting, northing,
}) {
  return `${zone}${hemisphere}  ${Math.round(easting)}E  ${Math.round(northing)}N`;
}

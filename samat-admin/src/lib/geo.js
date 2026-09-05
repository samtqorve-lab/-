// تبدیل رشته‌ی درجه/دقیقه/ثانیه (یا اعشاری) به مختصات اعشاری، و استخراج گوشه‌های محدوده‌ی
// قانونی هر رکورد از فیلدهای طول_A..طول_Z / عرض_A..عرض_Z — عیناً از نسخه‌ی قبلی پورت شده.

// ── مجوز موقعیت‌مکانی نیتیو (فقط داخل اپ اندروید) ────────────────────────────────────────
// در وب/دسکتاپ نیازی نیست: خودِ مرورگر دیالوگ استاندارد را نشان می‌دهد. ولی داخل WebView اندروید،
// اگر مجوز سطح سیستم (ACCESS_FINE_LOCATION) گرفته نشده باشد، navigator.geolocation همیشه با خطا
// رد می‌شود، حتی بدون هیچ دیالوگی — دقیقاً همان الگویی که در اپ مسئول فنی داشتیم.
let nativeLocationPermissionRequested = false;
export async function ensureNativeLocationPermission() {
  if (nativeLocationPermissionRequested) return;
  nativeLocationPermissionRequested = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Geolocation } = await import('@capacitor/geolocation');
    const status = await Geolocation.checkPermissions();
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      await Geolocation.requestPermissions();
    }
  } catch {
    nativeLocationPermissionRequested = false;
  }
}

export function dmsToDec(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  if (!m) {
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }
  const d = parseFloat(m[1]);
  const mm = parseFloat(m[2]);
  const ss = parseFloat(m[3]);
  const sign = d < 0 ? -1 : 1;
  return sign * (Math.abs(d) + mm / 60 + ss / 3600);
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** عدد اعشاری را به فرمت درجه-دقیقه-ثانیه (برای ابزار تبدیل مختصات) تبدیل می‌کند */
export function decToDms(dec) {
  if (dec === null || dec === undefined || Number.isNaN(dec)) return '-';
  const sign = dec < 0 ? '-' : '';
  const abs = Math.abs(dec);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = (minFloat - m) * 60;
  return `${sign}${d}° ${m}' ${s.toFixed(2)}"`;
}

/**
 * مساحت یک چندضلعی از روی رأس‌های lat/lon (به متر مربع) — با تصویر تخت‌سازی ساده (equirectangular)
 * حول اولین رأس؛ برای مساحت‌های کوچک (در حد یک محدوده‌ی معدنی) دقت کافی دارد.
 */
export function polygonAreaM2(points) {
  if (points.length < 3) return 0;
  const R = 6371000;
  const refLat = (points[0].lat * Math.PI) / 180;
  const xy = points.map((p) => ({
    x: ((p.lon * Math.PI) / 180) * R * Math.cos(refLat),
    y: ((p.lat * Math.PI) / 180) * R,
  }));
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    area += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  return Math.abs(area / 2);
}

/** @returns {[number, number][]} آرایه‌ای از [lat, lon] */
export function getMineCorners(record) {
  const points = [];
  LETTERS.forEach((l) => {
    const lonStr = record[`طول_${l}`];
    const latStr = record[`عرض_${l}`];
    if (!lonStr || !latStr) return;
    const lon = dmsToDec(lonStr);
    const lat = dmsToDec(latStr);
    if (lon !== null && lat !== null) points.push([lat, lon]);
  });
  return points;
}

/**
 * موقعیت فعلی کاربر را می‌گیرد و مسیریابی تا مختصات مقصد (مثلاً یک معدن) را در اپلیکیشن نقشه‌ی
 * سیستم (گوگل‌مپ) باز می‌کند — داخل اپ اندروید با پلاگین Browser (که برای ورود گوگل هم استفاده
 * می‌شود)، در وب با یک تب جدید. عمداً موتور مسیریابی داخل خودِ لیفلت پیاده‌سازی نشده تا وابستگی و
 * نگه‌داری اضافه (سرویس مسیریابی/کلید API) به پروژه اضافه نشود؛ گوگل‌مپ خودش این کار را بهتر انجام می‌دهد.
 * @throws در صورت رد شدن/ناموفق بودن دریافت موقعیت مکانی (تا فراخوان‌کننده toast مناسب نشان دهد)
 */
export async function openDirectionsTo(destLat, destLon) {
  await ensureNativeLocationPermission();
  if (!navigator.geolocation) throw new Error('مرورگر از موقعیت‌مکانی پشتیبانی نمی‌کند');
  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => reject(new Error(err.message || 'دریافت موقعیت مکانی ممکن نشد')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
  const { latitude, longitude } = pos.coords;
  const url = `https://www.google.com/maps/dir/?api=1&origin=${latitude},${longitude}&destination=${destLat},${destLon}&travelmode=driving`;
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export function centroid(points) {
  if (!points.length) return null;
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lon = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lat, lon];
}

/** عکس عملِ dmsToDec — درجه‌ی اعشاری را به رشته‌ی درجه/دقیقه/ثانیه برمی‌گرداند */
export function decToDMS(deg) {
  const num = parseFloat(deg);
  if (Number.isNaN(num)) return '';
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  let d = Math.floor(abs);
  const mFull = (abs - d) * 60;
  let m = Math.floor(mFull);
  let s = (mFull - m) * 60;
  // جلوگیری از خطای گرد‌شدن (۵۹.۹۹۵ ثانیه نباید به ۶۰.۰۰ گرد بشه بدون carry به دقیقه/درجه)
  if (s >= 59.995) { s = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  const mStr = String(m).padStart(2, '0');
  return `${sign}${d}° ${mStr}' ${s.toFixed(2)}"`;
}

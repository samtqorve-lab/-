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

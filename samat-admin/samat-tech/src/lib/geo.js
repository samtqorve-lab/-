// ── GPS مشترک و همیشه‌روشن ─────────────────────────────────────────────────
// قبلاً هر نقطه‌ی عکس‌گیری (احراز هویت، گزارش دوره‌ای، چک‌لیست‌ها) موقع باز شدن خودش یک
// watchPosition جداگانه شروع می‌کرد — یعنی GPS واقعاً وقتی به آن نیاز داشتیم تازه بیدار می‌شد.
// الان یک ناظر واحد از لحظه‌ی ورود موفق به اپ (main.js صدا می‌زند) روشن می‌ماند؛ تا وقتی کاربر به
// صفحه‌ی عکس‌گیری برسد، GPS از قبل چند خوانش گرفته و معمولاً دقتش خوب شده — دیگر لازم نیست منتظر
// «لود شدن» GPS بمانیم. توابع پایین (getAccurateGeoLocation، captureLivePhoto) از همین ناظر
// مشترک استفاده می‌کنند، نه این‌که هرکدام watch جدای خودشان را باز کنند.
let prewarmWatchId = null;
let latestCoords = null;
let latestCoordsAt = 0;
let lastGpsError = null;
const gpsListeners = new Set();

// ── نکته‌ی حیاتی اندروید ──────────────────────────────────────────────────
// navigator.geolocation خام (بالا) وقتی داخل WebView کپسیتور اجرا می‌شود، به‌تنهایی هرگز
// پاپ‌آپ «اجازه‌ی دسترسی به موقعیت مکانی» سیستم‌عامل را نشان نمی‌دهد — چون اندروید ۶+ برای این کار
// نیاز به یک درخواست runtime permission واقعی از سمت اپ نیتیو دارد، و WebView به‌تنهایی این کار
// را برای وب‌محتوا انجام نمی‌دهد؛ فقط سکوت می‌کند و خطای POSITION_UNAVAILABLE برمی‌گرداند.
// پلاگین رسمی @capacitor/geolocation دقیقاً همین درخواست نیتیو را انجام می‌دهد؛ یک‌بار که با آن
// اجازه گرفته شد، تماس‌های navigator.geolocation معمولی هم (چون اپ حالا مجوز سیستم را دارد) کار
// می‌کنند — پس بقیه‌ی این فایل دست‌نخورده می‌ماند.
let nativePermissionRequested = false;
async function ensureNativeLocationPermission() {
  if (nativePermissionRequested) return;
  nativePermissionRequested = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return; // در وب معمولی لازم نیست، خود مرورگر مدیریت می‌کند
    const { Geolocation } = await import('@capacitor/geolocation');
    const status = await Geolocation.checkPermissions();
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      await Geolocation.requestPermissions();
    }
  } catch {
    // اگر پلاگین نصب/سینک نشده باشد، بی‌صدا رد می‌شویم — همان رفتار قبلی (بدون پرامپت) باقی می‌ماند
    nativePermissionRequested = false;
  }
}

export function startGpsPrewarm() {
  if (prewarmWatchId !== null || !navigator.geolocation) return;
  ensureNativeLocationPermission().finally(() => {
    if (prewarmWatchId !== null || !navigator.geolocation) return;
    prewarmWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        latestCoords = pos.coords;
        latestCoordsAt = Date.now();
        lastGpsError = null;
        gpsListeners.forEach((fn) => fn(pos.coords));
      },
      (err) => { lastGpsError = err; /* بی‌صدا نگه داشته می‌شود — این فقط پیش‌گرم‌سازی است؛ اگر کاربر
        واقعاً وارد صفحه‌ی عکس‌گیری شود و هنوز خوانشی نباشد، پیام دقیق همان لحظه نشان داده می‌شود. */ },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 },
    );
  });
}

// چون watchPosition با enableHighAccuracy مصرف باتری واقعی دارد، اگر مسئول فنی مدتی با اپ کار
// نکند (مثلاً اپ روی صفحه‌ی موبایل باز مانده ولی گوشی قفل/بی‌کار است)، ناظر خودکار متوقف می‌شود؛
// با اولین فعالیت دوباره (یا اولین درخواست موقعیت مکانی) خودکار روشن می‌شود. توجه: خود
// getAccurateGeoLocation هم اگر ناظر خاموش باشد آن را دوباره روشن می‌کند — یعنی این فقط یک
// «چرت کوتاه» ایجاد می‌کند، نه از دست رفتن قابلیت.
const PREWARM_IDLE_MS = 5 * 60 * 1000;
let prewarmIdleTimer = null;
let prewarmAutoManaged = false;

function resetPrewarmIdleTimer() {
  if (!prewarmAutoManaged) return;
  clearTimeout(prewarmIdleTimer);
  prewarmIdleTimer = setTimeout(() => {
    if (prewarmWatchId !== null) { navigator.geolocation.clearWatch(prewarmWatchId); prewarmWatchId = null; }
    // latestCoords عمداً پاک نمی‌شود — یک خوانش نه‌چندان‌تازه هنوز بهتر از هیچ نقطه‌ی شروعی است
  }, PREWARM_IDLE_MS);
  if (prewarmWatchId === null) startGpsPrewarm();
}

/** نسخه‌ی خودکار startGpsPrewarm که بعد از چند دقیقه بی‌فعالیتی، خودش را خاموش می‌کند (برای صرفه‌جویی باتری) */
export function startManagedGpsPrewarm() {
  prewarmAutoManaged = true;
  ['touchstart', 'click', 'keydown', 'scroll'].forEach((ev) => window.addEventListener(ev, resetPrewarmIdleTimer, { passive: true }));
  resetPrewarmIdleTimer();
}

export function stopGpsPrewarm() {
  if (prewarmWatchId !== null) { navigator.geolocation.clearWatch(prewarmWatchId); prewarmWatchId = null; }
  latestCoords = null;
  clearTimeout(prewarmIdleTimer);
  if (prewarmAutoManaged) {
    prewarmAutoManaged = false;
    ['touchstart', 'click', 'keydown', 'scroll'].forEach((ev) => window.removeEventListener(ev, resetPrewarmIdleTimer));
  }
}

/** آخرین خوانش GPS ناظر مشترک، اگر به‌اندازه‌ی کافی تازه باشد (پیش‌فرض: کمتر از ۸ ثانیه پیش) */
export function getWarmCoords(maxAgeMs = 8000) {
  if (latestCoords && (Date.now() - latestCoordsAt) <= maxAgeMs) return latestCoords;
  return null;
}

/** برای مشترک‌شدن در به‌روزرسانی‌های زنده‌ی همان ناظر مشترک (مثلاً نمای زنده‌ی دوربین) */
export function onGpsUpdate(fn) {
  gpsListeners.add(fn);
  return () => gpsListeners.delete(fn);
}

export function getGeoLocation() {
  return new Promise((resolve, reject) => {
    const warm = getWarmCoords();
    if (warm) { resolve(warm); return; }
    if (!navigator.geolocation) { reject(new Error('مرورگر شما از موقعیت‌مکانی پشتیبانی نمی‌کند')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(new Error(`برای ثبت عکس باید GPS/لوکیشن گوشی فعال باشد و دسترسی موقعیت‌مکانی را تایید کنید (${err.message})`)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

/**
 * برخلاف getGeoLocation، این تابع تا رسیدن دقت به آستانه‌ی قابل‌قبول صبر می‌کند — چون نزدیک
 * تپه/ساختمان‌های معدن، خوانش‌ها می‌توانند ۲۰-۵۰ متر خطا داشته باشند و باعث رد نادرست عکس‌های
 * داخل محدوده می‌شوند. اگر ناظر پیش‌گرم (startGpsPrewarm) از قبل روشن بوده، معمولاً همان اولین
 * لحظه یک خوانش خوب آماده است و اصلاً منتظر نمی‌مانیم؛ در غیر این صورت به همان ناظر مشترک وصل
 * می‌شویم (نه یک watch جدید) تا سقف زمان تعیین‌شده. اگر تا سقف زمان به آستانه نرسید، بهترین خوانش
 * موجود برگردانده می‌شود (تا کاربری که واقعاً در نقطه‌ای با دید ضعیف آسمان است، برای همیشه گیر نکند).
 * @param {(coords: GeolocationCoordinates) => void} [onProgress] برای نمایش زنده‌ی دقت فعلی به کاربر
 */
export function getAccurateGeoLocation({ targetAccuracyM = 20, maxWaitMs = 20000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('مرورگر شما از موقعیت‌مکانی پشتیبانی نمی‌کند')); return; }
    startGpsPrewarm(); // اگر به هر دلیل هنوز روشن نشده (مثلاً این صفحه بدون عبور از main.js باز شده)

    let best = getWarmCoords(30000) || null; // حتی یک خوانش نه‌چندان تازه هم بهتر از هیچ نقطه‌ی شروعی است
    let settled = false;
    if (best) onProgress?.(best);
    if (best && best.accuracy <= targetAccuracyM) { resolve(best); return; }

    const unsubscribe = onGpsUpdate((coords) => {
      if (settled) return;
      if (!best || coords.accuracy < best.accuracy) best = coords;
      onProgress?.(coords);
      if (coords.accuracy <= targetAccuracyM) {
        settled = true;
        unsubscribe();
        resolve(coords);
      }
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (best) resolve(best);
      else if (lastGpsError) reject(new Error(`برای ثبت عکس باید GPS/لوکیشن گوشی فعال باشد و دسترسی موقعیت‌مکانی را تایید کنید (${lastGpsError.message})`));
      else reject(new Error('دریافت موقعیت مکانی با دقت کافی ممکن نشد — به فضای باز بروید و دوباره امتحان کنید.'));
    }, maxWaitMs);
  });
}

export function dmsToDec(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  if (!m) { const n = parseFloat(s); return Number.isNaN(n) ? null : n; }
  const d = parseFloat(m[1]); const mm = parseFloat(m[2]); const ss = parseFloat(m[3]);
  const sign = d < 0 ? -1 : 1;
  return sign * (Math.abs(d) + mm / 60 + ss / 3600);
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export function getMineCorners(m) {
  const points = [];
  LETTERS.forEach((l) => {
    const lonStr = m[`طول_${l}`]; const latStr = m[`عرض_${l}`];
    if (!lonStr || !latStr) return;
    const lon = dmsToDec(lonStr); const lat = dmsToDec(latStr);
    if (lon !== null && lat !== null) points.push([lat, lon]);
  });
  return points;
}

/** برای ابزار پیاده‌کردن نقاط پروانه (استیک‌اوت GPS) — برخلاف getMineCorners، برچسب هر گوشه را هم نگه می‌دارد */
export function getMineCornersLabeled(m) {
  const points = [];
  LETTERS.forEach((l) => {
    const lonStr = m[`طول_${l}`]; const latStr = m[`عرض_${l}`];
    if (!lonStr || !latStr) return;
    const lon = dmsToDec(lonStr); const lat = dmsToDec(latStr);
    if (lon !== null && lat !== null) points.push({ label: l, lat, lon });
  });
  return points;
}

function pointInPolygon(lat, lon, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const yi = corners[i][0]; const xi = corners[i][1];
    const yj = corners[j][0]; const xj = corners[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * فاصله‌ی شمالی-جنوبی و شرقی-غربیِ نقطه‌ی هدف نسبت به موقعیت فعلی را برمی‌گرداند (به متر).
 * چون فاصله‌ی صرف کافی نیست و مسیریابی معمولی هم روی زمین‌های ناهموار معدن بی‌فایده است،
 * این روش (بدون نیاز به قطب‌نمای گوشی که مجوز/دقتش نامطمئن است) مسیر را به دو حرکت ساده می‌شکند.
 */
export function northSouthEastWestOffset(fromLat, fromLon, toLat, toLon) {
  const ns = haversineMeters(fromLat, fromLon, toLat, fromLon) * (toLat >= fromLat ? 1 : -1);
  const ew = haversineMeters(fromLat, fromLon, fromLat, toLon) * (toLon >= fromLon ? 1 : -1);
  return { northMeters: ns, eastMeters: ew, totalMeters: haversineMeters(fromLat, fromLon, toLat, toLon) };
}

const BOUNDARY_FALLBACK_RADIUS_M = 300;
export function isInsideMineBoundary(coords, mine) {
  if (!coords || !mine) return false;
  const corners = getMineCorners(mine);
  if (corners.length >= 3) return pointInPolygon(coords.latitude, coords.longitude, corners);
  if (mine._lat != null && mine._lon != null) {
    return haversineMeters(coords.latitude, coords.longitude, mine._lat, mine._lon) <= BOUNDARY_FALLBACK_RADIUS_M;
  }
  return false;
}

export function getOrCreateDeviceId() {
  let id = localStorage.getItem('tor_device_id');
  if (!id) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('tor_device_id', id);
  }
  return id;
}

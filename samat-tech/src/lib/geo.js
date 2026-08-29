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
const gpsErrorListeners = new Set();

// ── نکته‌ی حیاتی اندروید ──────────────────────────────────────────────────
// navigator.geolocation خام (بالا) وقتی داخل WebView کپسیتور اجرا می‌شود، به‌تنهایی هرگز
// پاپ‌آپ «اجازه‌ی دسترسی به موقعیت مکانی» سیستم‌عامل را نشان نمی‌دهد — چون اندروید ۶+ برای این کار
// نیاز به یک درخواست runtime permission واقعی از سمت اپ نیتیو دارد، و WebView به‌تنهایی این کار
// را برای وب‌محتوا انجام نمی‌دهد؛ فقط سکوت می‌کند و خطای POSITION_UNAVAILABLE برمی‌گرداند.
// پلاگین رسمی @capacitor/geolocation دقیقاً همین درخواست نیتیو را انجام می‌دهد؛ یک‌بار که با آن
// اجازه گرفته شد، تماس‌های navigator.geolocation معمولی هم (چون اپ حالا مجوز سیستم را دارد) کار
// می‌کنند — پس بقیه‌ی این فایل دست‌نخورده می‌ماند.
// درخواست مجوز نیتیو بلافاصله در لحظه‌ی صفر (قبل از این‌که صفحه کامل رندر و Activity آماده‌ی
// نمایش دیالوگ سیستم باشد) روی برخی گوشی‌ها/نسخه‌های اندروید باعث می‌شود دیالوگ اصلاً دیده نشود و
// اندروید بی‌صدا «رد شده» برگرداند — دقیقاً همان چیزی که باعث می‌شود کاربر برای همیشه روی
// «آماده‌سازی» بماند. برای اولین درخواست (که از main.js و خیلی زود صدا زده می‌شود)، کمی صبر
// می‌کنیم تا صفحه کامل بارگذاری و Activity واقعاً آماده شود.
function waitForAppReady() {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') { setTimeout(resolve, 400); return; }
    window.addEventListener('load', () => setTimeout(resolve, 400), { once: true });
  });
}

let nativePermissionRequested = false;
let permissionDenialCount = 0; // بار اول: شاید فقط دیالوگ به‌خاطر زمان‌بندی نمایش داده نشده — دوباره امتحان می‌کنیم.
                                 // از بار دوم به بعد: اندروید معمولاً دیگر دیالوگ نشان نمی‌دهد و باید کاربر را
                                 // مستقیم به صفحه‌ی تنظیمات مجوز اپ ببریم.
async function ensureNativeLocationPermission() {
  if (nativePermissionRequested) return;
  nativePermissionRequested = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return; // در وب معمولی لازم نیست، خود مرورگر مدیریت می‌کند
    await waitForAppReady();
    const { Geolocation } = await import('@capacitor/geolocation');
    const status = await Geolocation.checkPermissions();
    if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
      const result = await Geolocation.requestPermissions();
      if (result.location !== 'granted' && result.coarseLocation !== 'granted') {
        permissionDenialCount += 1;
        // کاربر مجوز را رد کرده (یا اندروید به‌خاطر رد قبلی دیگر دیالوگ را نشان نداده) — این را
        // به‌عنوان یک خطای واقعی به شنونده‌ها اطلاع می‌دهیم تا رابط‌کاربری به‌جای «آماده‌سازی» ابدی،
        // پیام و راه‌حل نشان دهد.
        const err = new Error('permission-denied');
        err.code = 'permission-denied';
        err.needsSettings = permissionDenialCount >= 2; // از رد دوم به بعد، درخواست مجدد بی‌فایده است
        lastGpsError = err;
        gpsErrorListeners.forEach((fn) => fn(err));
      }
    }
  } catch {
    // اگر پلاگین نصب/سینک نشده باشد، بی‌صدا رد می‌شویم — همان رفتار قبلی (بدون پرامپت) باقی می‌ماند
    nativePermissionRequested = false;
  }
}

/** وقتی اندروید دیگر دیالوگ مجوز را نشان نمی‌دهد (بعد از حداقل یک رد قبلی)، تنها راه واقعی باز
 * کردن مستقیم صفحه‌ی تنظیمات مجوزهای همین اپ در اندروید است — کاربر آنجا Location را روشن می‌کند و
 * برمی‌گردد؛ چون شنونده‌ی resume از قبل وصل است، همان لحظه‌ی برگشت خودش دوباره امتحان می‌کند. */
export async function openLocationSettings() {
  try {
    const { NativeSettings, AndroidSettings } = await import('capacitor-native-settings');
    await NativeSettings.open({ optionAndroid: AndroidSettings.ApplicationDetails });
  } catch {
    // در وب/محیط بدون این پلاگین، کاری از دستمان ساخته نیست جز پیام متنی که رابط‌کاربری نشان می‌دهد
  }
}

/** برخلاف openLocationSettings (صفحه‌ی مجوزهای همین اپ)، این صفحه‌ی «موقعیت مکانی» کل گوشی را
 * باز می‌کند — جایی که GPS خودِ دستگاه (نه مجوز اپ) روشن/خاموش می‌شود. لازم است چون POSITION_
 * UNAVAILABLE (کد ۲) معمولاً یعنی GPS گوشی کلاً خاموش است، نه این‌که این اپ مجوز نداشته باشد؛
 * صفحه‌ی «جزئیات اپ» در آن حالت هیچ کمکی نمی‌کند. */
export async function openDeviceLocationSettings() {
  try {
    const { NativeSettings, AndroidSettings } = await import('capacitor-native-settings');
    await NativeSettings.open({ optionAndroid: AndroidSettings.Location });
  } catch {
    // در وب/محیط بدون این پلاگین، کاری از دستمان ساخته نیست جز پیام متنی که رابط‌کاربری نشان می‌دهد
  }
}

/** برای دکمه‌ی «تلاش دوباره» در رابط‌کاربری: وقتی مجوز رد شده یا خطا رخ داده، ناظر فعلی را می‌بندد
 * و از نو شروع می‌کند. اگر قبلاً حداقل یک‌بار رد شده (یعنی اندروید احتمالاً دیگر دیالوگ نشان
 * نمی‌دهد)، به‌جای درخواست بی‌فایده‌ی مجدد، مستقیم صفحه‌ی تنظیمات را باز می‌کند. */
export function retryGpsPrewarm() {
  if (prewarmWatchId !== null) { navigator.geolocation.clearWatch(prewarmWatchId); prewarmWatchId = null; }
  if (isDeviceGpsOffError(lastGpsError)) { openDeviceLocationSettings(); return; }
  nativePermissionRequested = false;
  lastGpsError = null;
  if (permissionDenialCount >= 1) { openLocationSettings(); return; }
  startGpsPrewarm();
}

/** به رابط‌کاربری می‌گوید آیا لمس دکمه‌ی «تلاش دوباره» قرار است صفحه‌ی تنظیمات اندروید را باز کند
 * (بعد از حداقل یک رد قبلی) یا فقط یک درخواست مجوز معمولی دوباره بزند. */
export function willOpenSettingsOnRetry() {
  return permissionDenialCount >= 1;
}

/** کد ۲ (POSITION_UNAVAILABLE) استاندارد Geolocation API معمولاً یعنی GPS/موقعیت‌مکانی خودِ
 * گوشی کلاً خاموش است (نه این‌که فقط این اپ مجوز نداشته باشد) — در آن حالت باز کردن صفحه‌ی
 * «جزئیات اپ» بی‌فایده است؛ باید صفحه‌ی «موقعیت مکانی» کل گوشی باز شود. */
export function isDeviceGpsOffError(err) {
  return !!err && err.code === 2;
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
      (err) => {
        lastGpsError = err;
        gpsErrorListeners.forEach((fn) => fn(err));
        /* برخلاف قبل، خطا را هم به شنونده‌ها اطلاع می‌دهیم — چون این ممکن است «پیش‌گرم‌سازی
        ساکت» باشد، ولی اگر کاربر واقعاً منتظر بماند و هیچ خوانشی نیاید، باید بفهمد چرا. */
      },
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

// ── روشن‌شدن GPS هنگام بازگشت اپ از بک‌گراند ──────────────────────────────
// روی موبایل، وقتی مسئول فنی اپ را می‌بندد/می‌رود سراغ اپ دیگر، اندروید معمولاً پردازه را زنده
// نگه می‌دارد (main.js دوباره اجرا نمی‌شود) — یعنی اگر GPS به‌خاطر بی‌فعالیتی خاموش شده باشد، تا
// قبل از این تغییر فقط با اولین لمس صفحه دوباره روشن می‌شد. رویداد resume پلاگین @capacitor/app
// دقیقاً لحظه‌ی «باز شدن دوباره‌ی اپ» را می‌دهد، پس همان لحظه GPS را به‌صورت واقعی و بدون نیاز به
// لمس کاربر روشن می‌کنیم.
let resumeListenerAttached = false;
async function attachAppResumeListener() {
  if (resumeListenerAttached) return;
  resumeListenerAttached = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { App } = await import('@capacitor/app');
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) { clearTimeout(prewarmIdleTimer); startGpsPrewarm(); resetPrewarmIdleTimer(); }
    });
  } catch {
    resumeListenerAttached = false;
  }
}

/** نسخه‌ی خودکار startGpsPrewarm که بعد از چند دقیقه بی‌فعالیتی، خودش را خاموش می‌کند (برای صرفه‌جویی باتری) */
export function startManagedGpsPrewarm() {
  prewarmAutoManaged = true;
  ['touchstart', 'click', 'keydown', 'scroll'].forEach((ev) => window.addEventListener(ev, resetPrewarmIdleTimer, { passive: true }));
  attachAppResumeListener();
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

/** برای نمایش خطای واقعی GPS در رابط‌کاربری (مثلاً وقتی مجوز رد شده و ناظر برای همیشه ساکت می‌ماند) */
export function onGpsError(fn) {
  gpsErrorListeners.add(fn);
  return () => gpsErrorListeners.delete(fn);
}

export function getGeoLocation() {
  return new Promise((resolve, reject) => {
    const warm = getWarmCoords();
    if (warm) { resolve(warm); return; }
    if (!navigator.geolocation) { reject(new Error('مرورگر شما از موقعیت‌مکانی پشتیبانی نمی‌کند')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => {
        const msg = isDeviceGpsOffError(err)
          ? 'GPS گوشی خاموش است — از تنظیمات گوشی، «موقعیت مکانی» را روشن کنید'
          : `برای ثبت عکس باید GPS/لوکیشن گوشی فعال باشد و دسترسی موقعیت‌مکانی را تایید کنید (${err.message})`;
        reject(new Error(msg));
      },
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

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** جهت (بر حسب درجه، ۰=شمال، ۹۰=شرق) از یک نقطه به نقطه‌ی دیگر — برای چرخاندن فلش راهنما روی نقشه */
export function bearingDegrees(fromLat, fromLon, toLat, toLon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(toLon - fromLon);
  const y = Math.sin(dLon) * Math.cos(toRad(toLat));
  const x = Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) - Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
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

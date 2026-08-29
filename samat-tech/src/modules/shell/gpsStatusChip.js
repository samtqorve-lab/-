import { el } from '../../lib/dom.js';
import {
  onGpsUpdate, onGpsError, getWarmCoords, retryGpsPrewarm, willOpenSettingsOnRetry, isDeviceGpsOffError,
} from '../../lib/geo.js';

/** یک نشان کوچک در بالای صفحه که نشان می‌دهد GPS از قبل پیش‌گرم و آماده است — تا مسئول فنی
 * مطمئن شود لازم نیست موقع عکس‌گرفتن منتظر «لود شدن» GPS بماند. اگر بعد از چند ثانیه هنوز هیچ
 * خوانشی نیامده باشد (معمولاً یعنی مجوز موقعیت‌مکانی رد شده یا GPS گوشی خاموش است)، به‌جای
 * ماندن ابدی روی «آماده‌سازی»، پیام خطا و یک دکمه‌ی «تلاش دوباره» نشان می‌دهیم. */
const STUCK_AFTER_MS = 8000;

export function mountGpsStatusChip(container) {
  let lastErr = null;
  const chip = el('span', {
    style: 'font-size:11px;color:rgba(255,255,255,.75);cursor:pointer',
    onclick: () => {
      const gpsOff = isDeviceGpsOffError(lastErr);
      const toSettings = gpsOff || willOpenSettingsOnRetry();
      retryGpsPrewarm();
      showPreparing(toSettings, gpsOff);
      if (!toSettings) armStuckTimer();
    },
  }, '📡 در حال آماده‌سازی GPS...');
  container.append(chip);

  let settled = false; // یعنی حداقل یک خوانش موفق آمده — دیگر نیازی به تایمر «گیرکرده» نیست
  let stuckTimer = null;

  function showPreparing(openingSettings, gpsOff) {
    chip.textContent = gpsOff
      ? '⚙️ تنظیمات موقعیت مکانی باز شد — برگردید به اپ'
      : openingSettings ? '⚙️ تنظیمات مجوز باز شد — برگردید به اپ' : '📡 در حال آماده‌سازی GPS...';
    chip.style.color = 'rgba(255,255,255,.75)';
  }

  function render(coords) {
    settled = true;
    clearTimeout(stuckTimer);
    if (!coords) return;
    const good = coords.accuracy <= 20;
    chip.textContent = `${good ? '📍' : '📡'} GPS آماده (~${Math.round(coords.accuracy)} متر)`;
    chip.style.color = good ? 'var(--patina-100)' : 'var(--amber-100)';
  }

  function renderError(err) {
    lastErr = err;
    if (settled) return; // اگر قبلاً خوانش موفق داشتیم، یک خطای گذرا بعدی چیز مهمی نیست
    const isDenied = err && err.code === 'permission-denied';
    if (isDeviceGpsOffError(err)) {
      chip.textContent = '📍 GPS گوشی خاموش است — برای باز کردن تنظیمات موقعیت مکانی ضربه بزنید';
    } else if (isDenied && err.needsSettings) {
      chip.textContent = '⚠️ مجوز رد شده — برای باز کردن تنظیمات ضربه بزنید';
    } else if (isDenied) {
      chip.textContent = '⚠️ دسترسی GPS رد شده — برای تلاش دوباره ضربه بزنید';
    } else {
      chip.textContent = '⚠️ GPS فعال نشد — برای تلاش دوباره ضربه بزنید';
    }
    chip.style.color = 'var(--rust-100)';
  }

  function armStuckTimer() {
    clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      if (!settled) renderError(null); // بعد از این مدت، حتی بدون خطای مشخص هم دیگر «گیرکرده» حساب می‌شود
    }, STUCK_AFTER_MS);
  }

  const warm = getWarmCoords(30000);
  if (warm) render(warm);
  else armStuckTimer();
  onGpsUpdate(render);
  onGpsError(renderError);
}

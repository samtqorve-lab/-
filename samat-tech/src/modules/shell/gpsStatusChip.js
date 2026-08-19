import { el } from '../../lib/dom.js';
import { onGpsUpdate, onGpsError, getWarmCoords, retryGpsPrewarm } from '../../lib/geo.js';

/** یک نشان کوچک در بالای صفحه که نشان می‌دهد GPS از قبل پیش‌گرم و آماده است — تا مسئول فنی
 * مطمئن شود لازم نیست موقع عکس‌گرفتن منتظر «لود شدن» GPS بماند. اگر بعد از چند ثانیه هنوز هیچ
 * خوانشی نیامده باشد (معمولاً یعنی مجوز موقعیت‌مکانی رد شده یا GPS گوشی خاموش است)، به‌جای
 * ماندن ابدی روی «آماده‌سازی»، پیام خطا و یک دکمه‌ی «تلاش دوباره» نشان می‌دهیم. */
const STUCK_AFTER_MS = 8000;

export function mountGpsStatusChip(container) {
  const chip = el('span', {
    style: 'font-size:11px;color:rgba(255,255,255,.75);cursor:pointer',
    onclick: () => { retryGpsPrewarm(); showPreparing(); armStuckTimer(); },
  }, '📡 در حال آماده‌سازی GPS...');
  container.append(chip);

  let settled = false; // یعنی حداقل یک خوانش موفق آمده — دیگر نیازی به تایمر «گیرکرده» نیست
  let stuckTimer = null;

  function showPreparing() {
    chip.textContent = '📡 در حال آماده‌سازی GPS...';
    chip.style.color = 'rgba(255,255,255,.75)';
  }

  function render(coords) {
    settled = true;
    clearTimeout(stuckTimer);
    if (!coords) return;
    const good = coords.accuracy <= 20;
    chip.textContent = `${good ? '📍' : '📡'} GPS آماده (~${Math.round(coords.accuracy)} متر)`;
    chip.style.color = good ? '#8bd3a8' : '#ffd699';
  }

  function renderError(err) {
    if (settled) return; // اگر قبلاً خوانش موفق داشتیم، یک خطای گذرا بعدی چیز مهمی نیست
    const isDenied = err && err.code === 'permission-denied';
    chip.textContent = isDenied
      ? '⚠️ دسترسی GPS رد شده — برای تلاش دوباره ضربه بزنید'
      : '⚠️ GPS فعال نشد — برای تلاش دوباره ضربه بزنید';
    chip.style.color = '#ffb4a8';
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

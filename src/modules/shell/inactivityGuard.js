import { el } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

// این پنل داده‌ی حساس (کد ملی، اطلاعات مالی/حقوقی) دارد؛ اگر گوشی/لپ‌تاپ یک ادمین بدون قفل‌شدن
// باز بماند، نشست تا ابد باز می‌ماند. اینجا بعد از مدتی بی‌فعالیت، یک هشدار نشان داده می‌شود؛
// اگر پاسخی نیاید، خودکار خارج می‌شود.
const INACTIVITY_MS = 20 * 60 * 1000; // ۲۰ دقیقه بی‌فعالیتی
const WARNING_BEFORE_MS = 60 * 1000; // ۱ دقیقه قبل از خروج، هشدار نشان داده می‌شود
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];

export function startInactivityGuard() {
  let warnTimer = null;
  let logoutTimer = null;
  let countdownInterval = null;
  let overlay = null;

  function removeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  function doLogout() {
    removeOverlay();
    sb.auth.signOut().then(() => window.location.reload());
  }

  function showWarning() {
    if (overlay) return;
    let secondsLeft = Math.round(WARNING_BEFORE_MS / 1000);
    const countdownSpan = el('span', {}, String(secondsLeft));
    const stayBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:14px' }, '✅ همچنان اینجا هستم');
    stayBtn.addEventListener('click', () => { removeOverlay(); reset(); });
    overlay = el('div', {
      style: 'position:fixed;inset:0;background:rgba(28,27,23,.6);display:flex;align-items:center;justify-content:center;z-index:999;padding:20px',
    }, el('div', { style: 'background:#fff;border-radius:var(--radius-lg);padding:26px 22px;max-width:360px;width:100%;text-align:center;box-shadow:var(--shadow-lg)' }, [
      el('div', { style: 'font-size:32px' }, '⏰'),
      el('h3', { style: 'margin-top:10px' }, 'به‌خاطر عدم فعالیت، به‌زودی از حساب خارج می‌شوید'),
      el('p', { style: 'font-size:var(--text-sm);color:var(--stone-600);margin-top:6px' }, ['خروج خودکار تا ', countdownSpan, ' ثانیه‌ی دیگر']),
      stayBtn,
    ]));
    document.body.append(overlay);
    countdownInterval = setInterval(() => {
      secondsLeft -= 1;
      countdownSpan.textContent = String(Math.max(0, secondsLeft));
      if (secondsLeft <= 0) clearInterval(countdownInterval);
    }, 1000);
  }

  function reset() {
    clearTimeout(warnTimer);
    clearTimeout(logoutTimer);
    if (overlay) removeOverlay(); // فعالیت جدید = دیگر لازم نیست هشدار نشان داده شود
    warnTimer = setTimeout(showWarning, INACTIVITY_MS - WARNING_BEFORE_MS);
    logoutTimer = setTimeout(doLogout, INACTIVITY_MS);
  }

  ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
  reset();

  return () => {
    clearTimeout(warnTimer);
    clearTimeout(logoutTimer);
    removeOverlay();
    ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
  };
}

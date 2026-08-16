import { el, showToast } from '../../lib/dom.js';
import {
  startCheckinSession, pingCheckin, endCheckinSession, markCheckinOverdue, sendOverdueAlert,
  createCheckinTimer, checkinTableMissingError,
} from '../../lib/safetyCheckin.js';

const INTERVAL_OPTIONS = [
  ['1', 'هر ۱ ساعت'], ['2', 'هر ۲ ساعت'], ['4', 'هر ۴ ساعت'],
];
const GRACE_MS = 10 * 60 * 1000; // ۱۰ دقیقه فرصت اضافه بعد از رسیدن مهلت، قبل از ارسال هشدار

/**
 * ویجت «چک‌این ایمنی کارگر تنها» را داخل container می‌سازد. مستقل از پنل مسئول فنی/ایمنی است تا
 * هم در panel.js و هم در safetyOfficer/panel.js با یک خط قابل استفاده باشد.
 */
export function mountSafetyCheckin(container, { email, getMineName, department }) {
  let sessionId = null;
  let timer = null;
  let intervalMs = 2 * 60 * 60 * 1000;
  let overlay = null;
  let activeMineName = '';

  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' });
  const box = el('div');
  container.append(box);

  function removeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }

  function showDueModal() {
    if (overlay) return;
    const imOkBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:14px' }, '✅ بله، حالم خوبه');
    imOkBtn.addEventListener('click', async () => {
      removeOverlay();
      try {
        await pingCheckin(sessionId, intervalMs);
        timer.reschedule();
        showToast('✅ چک‌این ثبت شد');
        drawActive();
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });
    overlay = el('div', {
      style: 'position:fixed;inset:0;background:rgba(183,27,27,.15);display:flex;align-items:center;justify-content:center;z-index:999;padding:20px',
    }, el('div', { style: 'background:#fff;border-radius:var(--radius-lg);padding:26px 22px;max-width:340px;width:100%;text-align:center;box-shadow:var(--shadow-lg)' }, [
      el('div', { style: 'font-size:32px' }, '🦺'),
      el('h3', { style: 'margin-top:8px' }, 'وقت چک‌این ایمنی است'),
      el('p', { style: 'font-size:var(--text-sm);color:var(--stone-600);margin-top:6px' }, 'اگر تا چند دقیقه‌ی دیگر پاسخ ندهید، به مدیر سامانه اطلاع داده می‌شود.'),
      imOkBtn,
    ]));
    document.body.append(overlay);
  }

  async function handleOverdue() {
    removeOverlay();
    try {
      await markCheckinOverdue(sessionId);
      await sendOverdueAlert({ email, mineName: activeMineName });
    } catch { /* بهترین تلاش — اگر ارسال هشدار ناموفق شد، حداقل UI محلی وضعیت را نشان می‌دهد */ }
    showToast('🚨 چون پاسخی ثبت نشد، به مدیر سامانه اطلاع داده شد');
    drawActive();
  }

  function drawIdle() {
    box.innerHTML = '';
    const intervalSelect = el('select', {}, INTERVAL_OPTIONS.map(([v, l]) => el('option', { value: v }, l)));
    const startBtn = el('button', { class: 'btn btn-primary', style: 'width:100%' }, '🟢 شروع کار در سایت (چک‌این ایمنی)');
    startBtn.addEventListener('click', async () => {
      const mineName = getMineName();
      if (!mineName) { showToast('⚠️ ابتدا معدن را انتخاب کنید'); return; }
      startBtn.disabled = true; startBtn.textContent = '⏳ در حال شروع...';
      intervalMs = parseInt(intervalSelect.value, 10) * 60 * 60 * 1000;
      try {
        sessionId = await startCheckinSession(email, mineName, department, intervalMs);
        activeMineName = mineName;
        timer = createCheckinTimer({ intervalMs, graceMs: GRACE_MS, onDue: showDueModal, onOverdue: handleOverdue });
        showToast('🦺 چک‌این ایمنی شروع شد');
        drawActive();
      } catch (err) {
        if (checkinTableMissingError(err)) {
          showToast('⚠️ این قابلیت هنوز روی سرور فعال نشده — با مدیر سامانه هماهنگ کنید');
        } else {
          showToast(`⚠️ ${err.message}`);
        }
        startBtn.disabled = false; startBtn.textContent = '🟢 شروع کار در سایت (چک‌این ایمنی)';
      }
    });
    box.append(
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
        'اگر تنها در سایت معدن کار می‌کنید، این را روشن کنید — هر چند ساعت یک‌بار «من سالمم» می‌زنید؛ اگر پاسخ ندهید، به مدیر سامانه اطلاع داده می‌شود.'),
      el('label', {}, 'فاصله‌ی چک‌این'), intervalSelect,
      startBtn,
    );
  }

  function drawActive() {
    box.innerHTML = '';
    const pingBtn = el('button', { class: 'btn btn-primary', style: 'width:100%' }, '✅ من سالمم');
    pingBtn.addEventListener('click', async () => {
      try {
        await pingCheckin(sessionId, intervalMs);
        timer.reschedule();
        showToast('✅ چک‌این ثبت شد');
        drawActive();
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });
    const endBtn = el('button', { class: 'btn-ghost', style: 'width:100%;margin-top:8px' }, '🔴 پایان کار در سایت');
    endBtn.addEventListener('click', async () => {
      try {
        await endCheckinSession(sessionId);
        timer.clear();
        sessionId = null;
        showToast('👋 چک‌این ایمنی پایان یافت');
        drawIdle();
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });
    box.append(
      el('div', { style: 'background:var(--patina-50);color:var(--patina-700);border-radius:8px;padding:8px 10px;font-size:var(--text-xs);margin-bottom:8px' },
        `🦺 چک‌این ایمنی فعال — ${activeMineName} — هر ${intervalMs / 3600000} ساعت یک‌بار یادآوری می‌شود`),
      pingBtn, endBtn, statusLine,
    );
  }

  drawIdle();
}

import { el, showToast, openModal } from '../../lib/dom.js';
import { getMineCornersLabeled, northSouthEastWestOffset } from '../../lib/geo.js';

const VISIT_THRESHOLD_M = 8;

/** ابزار پیاده‌کردن نقاط پروانه: فاصله‌ی شمال-جنوب/شرق-غرب زنده تا هر گوشه‌ی محدوده‌ی قانونی — بدون نیاز به قطب‌نمای گوشی */
export function openStakeoutModal(mine, nameField) {
  const corners = getMineCornersLabeled(mine);
  if (!corners.length) { showToast('⚠️ مختصات گوشه‌های محدوده برای این معدن ثبت نشده'); return; }

  const { body, overlay } = openModal({ title: `🎯 پیاده کردن نقاط پروانه — ${mine[nameField]}`, width: '420px' });

  let targetIdx = 0;
  const visited = new Set();
  let watchId = null;

  const chipsBox = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px' });
  const guidanceBox = el('div', { style: 'background:var(--stone-50);border-radius:12px;padding:16px;text-align:center' });
  const statusBox = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:10px;text-align:center' });

  function drawChips() {
    chipsBox.innerHTML = '';
    corners.forEach((c, i) => {
      const active = i === targetIdx;
      const done = visited.has(i);
      chipsBox.append(el('button', {
        class: 'btn-sm',
        style: `background:${active ? 'var(--patina-700)' : done ? 'var(--patina-100)' : 'var(--stone-100)'};color:${active ? '#fff' : done ? 'var(--patina-700)' : 'var(--stone-700)'}`,
        onclick: () => { targetIdx = i; drawChips(); },
      }, `${done ? '✅ ' : '📍 '}${c.label}`));
    });
  }

  function renderGuidance(pos) {
    const target = corners[targetIdx];
    const { northMeters, eastMeters, totalMeters } = northSouthEastWestOffset(pos.latitude, pos.longitude, target.lat, target.lon);
    if (totalMeters <= VISIT_THRESHOLD_M) {
      visited.add(targetIdx);
      drawChips();
      guidanceBox.innerHTML = '';
      guidanceBox.append(el('div', { style: 'font-size:34px' }, '🎉'), el('div', { style: 'font-weight:800;margin-top:6px' }, `به نقطه‌ی ${target.label} رسیدید`));
      const nextIdx = corners.findIndex((_, i) => !visited.has(i));
      if (nextIdx !== -1) setTimeout(() => { targetIdx = nextIdx; drawChips(); }, 1200);
      return;
    }
    const nsLabel = northMeters >= 0 ? 'شمال' : 'جنوب';
    const ewLabel = eastMeters >= 0 ? 'شرق' : 'غرب';
    guidanceBox.innerHTML = '';
    guidanceBox.append(
      el('div', { style: 'font-size:13px;color:var(--stone-600)' }, `فاصله تا نقطه‌ی ${target.label}`),
      el('div', { style: 'font-size:30px;font-weight:800;color:var(--ink-700);margin:6px 0' }, `${Math.round(totalMeters)} متر`),
      el('div', { style: 'display:flex;justify-content:center;gap:18px;font-size:14px;font-weight:700' }, [
        el('span', { style: 'color:#1565c0' }, `⬆️ ${Math.round(Math.abs(northMeters))} متر به ${nsLabel}`),
        el('span', { style: 'color:#e65100' }, `➡️ ${Math.round(Math.abs(eastMeters))} متر به ${ewLabel}`),
      ]),
    );
  }

  function onPos(pos) { renderGuidance(pos.coords); }
  function onErr(err) { statusBox.textContent = `⚠️ دریافت موقعیت ناموفق: ${err.message}`; }

  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  } else {
    statusBox.textContent = '⚠️ مرورگر شما از موقعیت‌مکانی پشتیبانی نمی‌کند';
  }

  drawChips();
  body.append(
    chipsBox, guidanceBox, statusBox,
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:10px;text-align:center' }, 'وقتی فاصله به کمتر از ۸ متر برسد، آن نقطه به‌طور خودکار «رسیده» علامت می‌خورد.'),
  );

  // چون نه دکمه‌ی ✖ و نه کلیک روی پس‌زمینه‌ی مودال دسترسی مستقیم به این تابع ندارند،
  // با MutationObserver حذف مودال از DOM را تشخیص می‌دهیم تا ردیابی GPS بی‌دلیل روشن نماند.
  const stopWatching = () => { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } };
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) { stopWatching(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true });
}

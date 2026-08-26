import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { el, showToast, openModal } from '../../lib/dom.js';
import { getMineCornersLabeled, northSouthEastWestOffset } from '../../lib/geo.js';

const VISIT_THRESHOLD_M = 8;

/** ابزار پیاده‌کردن نقاط پروانه: نقشه‌ی ماهواره‌ای با پلی‌گون محدوده + فاصله‌ی شمال-جنوب/شرق-غرب زنده تا هر گوشه */
export function openStakeoutModal(mine, nameField) {
  const corners = getMineCornersLabeled(mine);
  if (!corners.length) { showToast('⚠️ مختصات گوشه‌های محدوده برای این معدن ثبت نشده'); return; }

  const { body, overlay } = openModal({ title: `🎯 پیاده کردن نقاط پروانه — ${mine[nameField]}`, width: '440px' });

  let targetIdx = 0;
  const visited = new Set();
  let watchId = null;

  const mapHost = el('div', { style: 'width:100%;height:220px;border-radius:12px;overflow:hidden;margin-bottom:12px;background:var(--stone-200)' });
  const chipsBox = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px' });
  const guidanceBox = el('div', { style: 'background:var(--stone-50);border-radius:12px;padding:16px;text-align:center' });
  const statusBox = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:10px;text-align:center' });

  // مودال هنوز چیزی به body اضافه نکرده — اول همه‌ی ظرف‌ها را می‌چسبانیم، بعد نقشه را می‌سازیم.
  // Leaflet هنگام ساخت، اندازه‌ی واقعی container را از DOM می‌خواند؛ اگر element هنوز به صفحه
  // وصل نباشد، اندازه صفر محاسبه می‌شود و fitBounds نمی‌تواند مرکز/زوم درستی پیدا کند —
  // نتیجه‌اش یک نقشه‌ی خاکستری/خالی است که پلی‌گون رویش دیده نمی‌شود، حتی بعد از invalidateSize.
  body.append(
    mapHost,
    chipsBox, guidanceBox, statusBox,
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:10px;text-align:center' }, 'وقتی فاصله به کمتر از ۸ متر برسد، آن نقطه به‌طور خودکار «رسیده» علامت می‌خورد.'),
  );

  // --- نقشه‌ی ماهواره‌ای + پلی‌گون محدوده‌ی قانونی ---
  const map = L.map(mapHost, { zoomControl: true, attributionControl: false });
  L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { subdomains: ['0', '1', '2', '3'], maxZoom: 21 }).addTo(map);
  const boundaryPolygon = L.polygon(corners.map((c) => [c.lat, c.lon]), {
    color: '#C97A31', weight: 2, fillColor: '#C97A31', fillOpacity: 0.12,
  }).addTo(map);
  map.fitBounds(boundaryPolygon.getBounds(), { padding: [24, 24] });

  const cornerMarkers = corners.map((c, i) => L.circleMarker([c.lat, c.lon], {
    radius: 7, color: '#fff', weight: 2, fillColor: '#8A5A16', fillOpacity: 1,
  }).bindTooltip(c.label, { permanent: true, direction: 'top', className: 'stakeout-corner-label' }).addTo(map));

  let meMarker = null;
  function updateCornerMarkerStyles() {
    cornerMarkers.forEach((m, i) => {
      const color = i === targetIdx ? '#C97A31' : visited.has(i) ? '#245349' : '#8A5A16';
      m.setStyle({ fillColor: color });
    });
  }
  function updateMePosition(lat, lon) {
    if (!meMarker) {
      meMarker = L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#1e88e5', fillOpacity: 1 }).addTo(map);
    } else {
      meMarker.setLatLng([lat, lon]);
    }
  }

  function drawChips() {
    chipsBox.innerHTML = '';
    corners.forEach((c, i) => {
      const active = i === targetIdx;
      const done = visited.has(i);
      chipsBox.append(el('button', {
        class: 'btn-sm',
        style: `background:${active ? 'var(--patina-700)' : done ? 'var(--patina-100)' : 'var(--stone-100)'};color:${active ? '#fff' : done ? 'var(--patina-700)' : 'var(--stone-700)'}`,
        onclick: () => { targetIdx = i; drawChips(); updateCornerMarkerStyles(); },
      }, `${done ? '✅ ' : '📍 '}${c.label}`));
    });
    updateCornerMarkerStyles();
  }

  function renderGuidance(pos) {
    updateMePosition(pos.latitude, pos.longitude);
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
        el('span', { style: 'color:var(--schist-600)' }, `⬆️ ${Math.round(Math.abs(northMeters))} متر به ${nsLabel}`),
        el('span', { style: 'color:var(--ochre-600)' }, `➡️ ${Math.round(Math.abs(eastMeters))} متر به ${ewLabel}`),
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
  // مودال بدون انیمیشن باز/بسته می‌شود (خط ۹۷ در dom.js مستقیم document.body.append انجام می‌دهد)
  // پس همین الان هم اندازه‌ی نقشه درست است؛ این invalidateSize فقط یک لایه‌ی احتیاط اضافه است.
  setTimeout(() => map.invalidateSize(), 60);

  // چون نه دکمه‌ی ✖ و نه کلیک روی پس‌زمینه‌ی مودال دسترسی مستقیم به این تابع ندارند،
  // با MutationObserver حذف مودال از DOM را تشخیص می‌دهیم تا ردیابی GPS بی‌دلیل روشن نماند.
  const stopWatching = () => { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } };
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) { stopWatching(); map.remove(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true });
}

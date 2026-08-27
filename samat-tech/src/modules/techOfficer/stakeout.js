import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { el, showToast } from '../../lib/dom.js';
import {
  getMineCornersLabeled, northSouthEastWestOffset, bearingDegrees, haversineMeters, decToDms, dmsToDec, polygonAreaM2,
} from '../../lib/geo.js';

const VISIT_THRESHOLD_M = 8;
const TOOLS = [
  { key: 'nav', icon: '🎯', label: 'مسیریابی' },
  { key: 'point', icon: '➕', label: 'افزودن نقطه' },
  { key: 'distance', icon: '📏', label: 'فاصله' },
  { key: 'area', icon: '📐', label: 'مساحت' },
  { key: 'convert', icon: '🔄', label: 'تبدیل مختصات' },
];

function meArrowIcon(bearing, hasBearing) {
  // یک دایره‌ی آبی «موقعیت من» با یک فلش کوچک رویش که به سمت نقطه‌ی هدف می‌چرخد —
  // بر پایه‌ی زاویه‌ی جغرافیایی واقعی (نه قطب‌نمای گوشی، که مجوز/دقتش نامطمئن است)
  const arrow = hasBearing
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform:rotate(${bearing}deg)">
         <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:16px solid #C97A31;margin-top:-22px;filter:drop-shadow(0 0 2px #fff)"></div>
       </div>`
    : '';
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="position:relative;width:26px;height:26px">
             <div style="position:absolute;inset:5px;border-radius:50%;background:#1e88e5;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>
             ${arrow}
           </div>`,
  });
}

/** ابزار تمام‌صفحه‌ی پیاده‌کردن نقاط پروانه + چند ابزار کاربردی نقشه‌برداری (نقطه/فاصله/مساحت/تبدیل مختصات) */
export function openStakeoutModal(mine, nameField) {
  const corners = getMineCornersLabeled(mine);
  if (!corners.length) { showToast('⚠️ مختصات گوشه‌های محدوده برای این معدن ثبت نشده'); return; }

  let activeTool = 'nav';
  let targetIdx = 0;
  const visited = new Set();
  let watchId = null;
  let lastPos = null;

  // --- حالت‌های هر ابزار ---
  const customPoints = []; // [{lat, lon, label, marker}]
  let distancePoints = []; // حداکثر ۲ نقطه
  let distanceLine = null;
  let areaPoints = []; // ۳+ نقطه
  let areaPolygon = null;

  const screen = el('div', { style: 'position:fixed;inset:0;background:#fff;z-index:460;display:flex;flex-direction:column' });
  const topBar = el('div', {
    style: 'display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:var(--slate-900);color:#fff',
  });
  const backBtn = el('button', {
    style: 'background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px',
    onclick: () => close(),
  }, '→ بازگشت');
  const titleEl = el('div', { style: 'font-weight:700;font-size:14px;flex:1' }, `🎯 پیاده کردن نقاط پروانه — ${mine[nameField]}`);
  topBar.append(backBtn, titleEl);

  const toolbar = el('div', { style: 'display:flex;gap:6px;overflow-x:auto;padding:8px 10px;background:var(--stone-100);border-bottom:1px solid var(--stone-200)' });
  const mapHost = el('div', { style: 'flex:1;min-height:0;background:var(--stone-200)' });
  const panelBox = el('div', { style: 'padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--stone-200);max-height:42vh;overflow-y:auto' });

  screen.append(topBar, toolbar, mapHost, panelBox);
  document.body.append(screen);

  // --- نقشه‌ی ماهواره‌ای + پلی‌گون محدوده‌ی قانونی ---
  const map = L.map(mapHost, { zoomControl: true, attributionControl: false });
  L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { subdomains: ['0', '1', '2', '3'], maxZoom: 21 }).addTo(map);
  const boundaryPolygon = L.polygon(corners.map((c) => [c.lat, c.lon]), {
    color: '#C97A31', weight: 2, fillColor: '#C97A31', fillOpacity: 0.12,
  }).addTo(map);
  map.fitBounds(boundaryPolygon.getBounds(), { padding: [24, 24] });

  const cornerMarkers = corners.map((c) => L.circleMarker([c.lat, c.lon], {
    radius: 7, color: '#fff', weight: 2, fillColor: '#8A5A16', fillOpacity: 1,
  }).bindTooltip(c.label, { permanent: true, direction: 'top', className: 'stakeout-corner-label' }).addTo(map));

  let meMarker = null;
  function updateCornerMarkerStyles() {
    cornerMarkers.forEach((m, i) => {
      const color = i === targetIdx ? '#C97A31' : visited.has(i) ? '#245349' : '#8A5A16';
      m.setStyle({ fillColor: color });
    });
  }
  function updateMeMarker(lat, lon) {
    const target = corners[targetIdx];
    const hasBearing = activeTool === 'nav' && !!target;
    const bearing = hasBearing ? bearingDegrees(lat, lon, target.lat, target.lon) : 0;
    const icon = meArrowIcon(bearing, hasBearing);
    if (!meMarker) meMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
    else { meMarker.setLatLng([lat, lon]); meMarker.setIcon(icon); }
  }

  // ================= ابزار ۱: مسیریابی (پیش‌فرض) =================
  function drawNavPanel() {
    const chipsBox = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px' });
    corners.forEach((c, i) => {
      const active = i === targetIdx;
      const done = visited.has(i);
      chipsBox.append(el('button', {
        class: 'btn-sm',
        style: `background:${active ? 'var(--patina-700)' : done ? 'var(--patina-100)' : 'var(--stone-100)'};color:${active ? '#fff' : done ? 'var(--patina-700)' : 'var(--stone-700)'}`,
        onclick: () => { targetIdx = i; drawNavPanel(); updateCornerMarkerStyles(); if (lastPos) updateMeMarker(lastPos.latitude, lastPos.longitude); },
      }, `${done ? '✅ ' : '📍 '}${c.label}`));
    });
    const guidanceBox = el('div', { style: 'background:var(--stone-50);border-radius:12px;padding:16px;text-align:center' });
    if (lastPos) renderGuidance(guidanceBox, lastPos);
    else guidanceBox.append(el('div', { style: 'color:var(--stone-600);font-size:13px' }, 'در حال دریافت موقعیت...'));
    panelBox.innerHTML = '';
    panelBox.append(
      chipsBox, guidanceBox,
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:10px;text-align:center' }, 'فلش روی نقطه‌ی آبی، جهت واقعی حرکت به سمت نقطه‌ی فعال را نشان می‌دهد. وقتی فاصله کمتر از ۸ متر شود، آن نقطه «رسیده» علامت می‌خورد.'),
    );
    updateCornerMarkerStyles();
  }

  function renderGuidance(guidanceBox, pos) {
    const target = corners[targetIdx];
    const { northMeters, eastMeters, totalMeters } = northSouthEastWestOffset(pos.latitude, pos.longitude, target.lat, target.lon);
    if (totalMeters <= VISIT_THRESHOLD_M) {
      if (!visited.has(targetIdx)) {
        visited.add(targetIdx);
        const nextIdx = corners.findIndex((_, i) => !visited.has(i));
        if (nextIdx !== -1) setTimeout(() => { targetIdx = nextIdx; drawNavPanel(); }, 1200);
      }
      guidanceBox.innerHTML = '';
      guidanceBox.append(el('div', { style: 'font-size:34px' }, '🎉'), el('div', { style: 'font-weight:800;margin-top:6px' }, `به نقطه‌ی ${target.label} رسیدید`));
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

  // ================= ابزار ۲: افزودن نقطه =================
  function drawPointPanel() {
    panelBox.innerHTML = '';
    panelBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'روی نقشه لمس کنید تا یک نقطه‌ی دلخواه ثبت شود (مثلاً محل یک نشانه یا مانع).'));
    if (!customPoints.length) panelBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500)' }, 'هنوز نقطه‌ای اضافه نشده.'));
    customPoints.forEach((p, i) => {
      panelBox.append(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;background:var(--stone-50);border-radius:8px;padding:8px 10px;margin-bottom:6px' }, [
        el('div', { style: 'font-size:12px' }, [
          el('div', { style: 'font-weight:700' }, p.label),
          el('div', { style: 'color:var(--stone-600);direction:ltr;text-align:right' }, `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`),
        ]),
        el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => {
          map.removeLayer(p.marker);
          customPoints.splice(i, 1);
          drawPointPanel();
        } }, 'حذف'),
      ]));
    });
  }

  function addCustomPoint(lat, lon) {
    const label = `نقطه ${customPoints.length + 1}`;
    const marker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#5C4A87', fillOpacity: 1 })
      .bindTooltip(label, { permanent: true, direction: 'top' }).addTo(map);
    customPoints.push({ lat, lon, label, marker });
    drawPointPanel();
    showToast(`✅ ${label} ثبت شد`);
  }

  // ================= ابزار ۳: فاصله =================
  function resetDistance() {
    if (distanceLine) { map.removeLayer(distanceLine); distanceLine = null; }
    distancePoints.forEach((p) => map.removeLayer(p.marker));
    distancePoints = [];
  }
  function drawDistancePanel() {
    panelBox.innerHTML = '';
    panelBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'دو نقطه روی نقشه لمس کنید تا فاصله‌شان محاسبه شود.'));
    if (distancePoints.length === 2) {
      const d = haversineMeters(distancePoints[0].lat, distancePoints[0].lon, distancePoints[1].lat, distancePoints[1].lon);
      panelBox.append(el('div', { style: 'background:var(--stone-50);border-radius:10px;padding:14px;text-align:center;font-size:22px;font-weight:800;color:var(--ink-700)' }, `${d.toFixed(1)} متر`));
    }
    panelBox.append(el('button', { class: 'btn-sm', style: 'margin-top:10px;background:var(--stone-100);color:var(--stone-700)', onclick: () => { resetDistance(); drawDistancePanel(); } }, '🔄 اندازه‌گیری جدید'));
  }
  function addDistancePoint(lat, lon) {
    if (distancePoints.length >= 2) resetDistance();
    const marker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#5B6B72', fillOpacity: 1 }).addTo(map);
    distancePoints.push({ lat, lon, marker });
    if (distancePoints.length === 2) {
      distanceLine = L.polyline(distancePoints.map((p) => [p.lat, p.lon]), { color: '#5B6B72', weight: 3, dashArray: '6 6' }).addTo(map);
    }
    drawDistancePanel();
  }

  // ================= ابزار ۴: مساحت =================
  function resetArea() {
    if (areaPolygon) { map.removeLayer(areaPolygon); areaPolygon = null; }
    areaPoints.forEach((p) => map.removeLayer(p.marker));
    areaPoints = [];
  }
  function drawAreaPanel() {
    panelBox.innerHTML = '';
    panelBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'رأس‌های محدوده‌ی موردنظر را یکی‌یکی روی نقشه لمس کنید (حداقل ۳ نقطه).'));
    if (areaPoints.length >= 3) {
      const m2 = polygonAreaM2(areaPoints);
      panelBox.append(el('div', { style: 'background:var(--stone-50);border-radius:10px;padding:14px;text-align:center' }, [
        el('div', { style: 'font-size:22px;font-weight:800;color:var(--ink-700)' }, `${m2.toFixed(0)} متر مربع`),
        el('div', { style: 'font-size:13px;color:var(--stone-600);margin-top:4px' }, `≈ ${(m2 / 10000).toFixed(3)} هکتار`),
      ]));
    }
    panelBox.append(el('button', { class: 'btn-sm', style: 'margin-top:10px;background:var(--stone-100);color:var(--stone-700)', onclick: () => { resetArea(); drawAreaPanel(); } }, '🔄 محاسبه‌ی جدید'));
  }
  function addAreaPoint(lat, lon) {
    const marker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#245349', fillOpacity: 1 }).addTo(map);
    areaPoints.push({ lat, lon, marker });
    if (areaPolygon) map.removeLayer(areaPolygon);
    if (areaPoints.length >= 2) {
      areaPolygon = L.polygon(areaPoints.map((p) => [p.lat, p.lon]), { color: '#245349', weight: 2, fillColor: '#245349', fillOpacity: 0.15 }).addTo(map);
    }
    drawAreaPanel();
  }

  // ================= ابزار ۵: تبدیل مختصات =================
  function drawConvertPanel() {
    panelBox.innerHTML = '';
    const decLatInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'عرض جغرافیایی اعشاری، مثلاً 35.123456' });
    const decLonInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'طول جغرافیایی اعشاری، مثلاً 47.123456' });
    const resultBox = el('div', { style: 'background:var(--stone-50);border-radius:10px;padding:12px;margin-top:10px;font-size:13px;direction:ltr;text-align:right' });

    function refreshResult() {
      const lat = dmsToDec(decLatInput.value);
      const lon = dmsToDec(decLonInput.value);
      if (lat === null || lon === null) { resultBox.textContent = ''; return; }
      resultBox.innerHTML = '';
      resultBox.append(
        el('div', {}, `Decimal: ${lat.toFixed(6)}, ${lon.toFixed(6)}`),
        el('div', { style: 'margin-top:4px' }, `DMS: ${decToDms(lat)}, ${decToDms(lon)}`),
      );
    }
    decLatInput.addEventListener('input', refreshResult);
    decLonInput.addEventListener('input', refreshResult);

    const useMyPosBtn = el('button', { class: 'btn-sm', style: 'background:var(--schist-100);color:var(--schist-600);margin-top:8px', onclick: () => {
      if (!lastPos) { showToast('⚠️ هنوز موقعیت GPS دریافت نشده'); return; }
      decLatInput.value = lastPos.latitude.toFixed(6);
      decLonInput.value = lastPos.longitude.toFixed(6);
      refreshResult();
    } }, '📍 استفاده از موقعیت فعلی من');

    panelBox.append(
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' }, 'مختصات اعشاری یا به‌صورت درجه°دقیقه\'ثانیه" وارد کنید (هر دو فرمت پذیرفته می‌شود):'),
      el('label', {}, 'عرض جغرافیایی'), decLatInput,
      el('label', {}, 'طول جغرافیایی'), decLonInput,
      useMyPosBtn,
      resultBox,
    );
  }

  // ================= مدیریت کلیک روی نقشه بر اساس ابزار فعال =================
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (activeTool === 'point') addCustomPoint(lat, lng);
    else if (activeTool === 'distance') addDistancePoint(lat, lng);
    else if (activeTool === 'area') addAreaPoint(lat, lng);
  });

  function drawToolbar() {
    toolbar.innerHTML = '';
    TOOLS.forEach((t) => {
      toolbar.append(el('button', {
        style: 'flex-shrink:0;display:flex;align-items:center;gap:5px;padding:8px 12px;border-radius:20px;border:none;font-size:12.5px;cursor:pointer;'
          + `background:${activeTool === t.key ? 'var(--ochre-600)' : 'var(--stone-200)'};color:${activeTool === t.key ? '#fff' : 'var(--ink-700)'}`,
        onclick: () => { activeTool = t.key; drawToolbar(); drawActivePanel(); },
      }, `${t.icon} ${t.label}`));
    });
  }

  function drawActivePanel() {
    if (activeTool === 'nav') drawNavPanel();
    else if (activeTool === 'point') drawPointPanel();
    else if (activeTool === 'distance') drawDistancePanel();
    else if (activeTool === 'area') drawAreaPanel();
    else if (activeTool === 'convert') drawConvertPanel();
    if (lastPos) updateMeMarker(lastPos.latitude, lastPos.longitude);
  }

  function onPos(pos) {
    lastPos = pos.coords;
    updateMeMarker(lastPos.latitude, lastPos.longitude);
    if (activeTool === 'nav') drawNavPanel();
  }
  function onErr(err) { showToast(`⚠️ دریافت موقعیت ناموفق: ${err.message}`); }

  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  } else {
    showToast('⚠️ مرورگر شما از موقعیت‌مکانی پشتیبانی نمی‌کند');
  }

  drawToolbar();
  drawActivePanel();
  setTimeout(() => map.invalidateSize(), 60);

  function close() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    map.remove();
    screen.remove();
  }
}

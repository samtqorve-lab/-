import L from 'leaflet';
import { el } from '../../lib/dom.js';
import {
  haversineMeters, decToDms, dmsToDec, polygonAreaM2,
} from '../../lib/geo.js';
import { latLonToUtm, utmToLatLon, formatUtm } from '../../lib/utm.js';

const TOOLS = [
  { key: 'point', icon: '➕', label: 'نقطه' },
  { key: 'distance', icon: '📏', label: 'فاصله' },
  { key: 'area', icon: '📐', label: 'مساحت' },
  { key: 'path', icon: '〰️', label: 'مسیر' },
  { key: 'convert', icon: '🔄', label: 'تبدیل مختصات' },
];

/**
 * نوار ابزار GIS روی نقشه‌ی معادن: افزودن/حذف نقطه، فاصله، مساحت، ترسیم مسیر، و تبدیل مختصات
 * (UTM ⇄ اعشاری ⇄ درجه-دقیقه-ثانیه). ابزارهای اندازه‌گیری فقط برای همین نشست‌اند (ذخیره نمی‌شوند)
 * — دقیقاً مثل ابزار مشابه در اپ مسئول فنی.
 * @returns {() => void} تابع پاک‌سازی — موقع خروج از تب نقشه صدا بزنید تا لایه‌ها حذف شوند
 */
export function mountMapToolbar(hostEl, map) {
  let activeTool = null; // null یعنی فقط مرور معمولی نقشه، بدون ابزار فعال
  const points = []; // [{lat, lon, marker}] — برای ابزار «نقطه»
  let distancePoints = [];
  let distanceLine = null;
  let pathPoints = [];
  let pathLine = null;
  let areaPoints = [];
  let areaPolygon = null;

  const toolbar = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px' });
  const panel = el('div', { style: 'font-size:var(--text-sm)' });
  hostEl.append(toolbar, panel);

  function resetAllLayers() {
    points.forEach((p) => map.removeLayer(p.marker)); points.length = 0;
    if (distanceLine) { map.removeLayer(distanceLine); distanceLine = null; }
    distancePoints.forEach((p) => map.removeLayer(p.marker)); distancePoints = [];
    if (pathLine) { map.removeLayer(pathLine); pathLine = null; }
    pathPoints.forEach((p) => map.removeLayer(p.marker)); pathPoints = [];
    if (areaPolygon) { map.removeLayer(areaPolygon); areaPolygon = null; }
    areaPoints.forEach((p) => map.removeLayer(p.marker)); areaPoints = [];
  }

  function drawToolbar() {
    toolbar.innerHTML = '';
    TOOLS.forEach((t) => {
      toolbar.append(el('button', {
        class: 'btn-sm',
        style: `background:${activeTool === t.key ? 'var(--ochre-600)' : 'var(--stone-100)'};color:${activeTool === t.key ? '#fff' : 'var(--ink-700)'}`,
        onclick: () => { activeTool = activeTool === t.key ? null : t.key; drawToolbar(); drawPanel(); },
      }, `${t.icon} ${t.label}`));
    });
    if (activeTool && activeTool !== 'convert') {
      toolbar.append(el('button', {
        class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)',
        onclick: () => { resetAllLayers(); drawPanel(); },
      }, '🗑️ پاک کردن'));
    }
  }

  // ---- نقطه ----
  function drawPointPanel() {
    panel.innerHTML = '';
    panel.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:6px' }, 'روی نقشه کلیک کنید تا نقطه ثبت شود.'));
    points.forEach((p, i) => {
      panel.append(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;background:var(--stone-50);border-radius:6px;padding:6px 10px;margin-bottom:4px;font-size:12px' }, [
        el('span', { style: 'direction:ltr' }, `نقطه ${i + 1}: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`),
        el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => { map.removeLayer(p.marker); points.splice(i, 1); drawPointPanel(); } }, 'حذف'),
      ]));
    });
  }
  function addPoint(lat, lon) {
    const marker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#5C4A87', fillOpacity: 1 })
      .bindTooltip(`نقطه ${points.length + 1}`, { permanent: true, direction: 'top' }).addTo(map);
    points.push({ lat, lon, marker });
    drawPointPanel();
  }

  // ---- فاصله ----
  function drawDistancePanel() {
    panel.innerHTML = '';
    panel.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:6px' }, 'دو نقطه کلیک کنید.'));
    if (distancePoints.length === 2) {
      const d = haversineMeters(distancePoints[0].lat, distancePoints[0].lon, distancePoints[1].lat, distancePoints[1].lon);
      panel.append(el('div', { style: 'background:var(--stone-50);border-radius:8px;padding:10px;font-weight:800;font-size:18px' }, `${d.toFixed(1)} متر`));
    }
  }
  function addDistancePoint(lat, lon) {
    if (distancePoints.length >= 2) {
      distancePoints.forEach((p) => map.removeLayer(p.marker));
      if (distanceLine) map.removeLayer(distanceLine);
      distancePoints = []; distanceLine = null;
    }
    const marker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#5B6B72', fillOpacity: 1 }).addTo(map);
    distancePoints.push({ lat, lon, marker });
    if (distancePoints.length === 2) distanceLine = L.polyline(distancePoints.map((p) => [p.lat, p.lon]), { color: '#5B6B72', weight: 3, dashArray: '6 6' }).addTo(map);
    drawDistancePanel();
  }

  // ---- مساحت ----
  function drawAreaPanel() {
    panel.innerHTML = '';
    panel.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:6px' }, 'رأس‌های محدوده را یکی‌یکی کلیک کنید (حداقل ۳ نقطه).'));
    if (areaPoints.length >= 3) {
      const m2 = polygonAreaM2(areaPoints);
      panel.append(el('div', { style: 'background:var(--stone-50);border-radius:8px;padding:10px' }, [
        el('div', { style: 'font-weight:800;font-size:18px' }, `${m2.toFixed(0)} متر مربع`),
        el('div', { style: 'font-size:12px;color:var(--stone-600)' }, `≈ ${(m2 / 10000).toFixed(3)} هکتار`),
      ]));
    }
  }
  function addAreaPoint(lat, lon) {
    const marker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#245349', fillOpacity: 1 }).addTo(map);
    areaPoints.push({ lat, lon, marker });
    if (areaPolygon) map.removeLayer(areaPolygon);
    if (areaPoints.length >= 2) areaPolygon = L.polygon(areaPoints.map((p) => [p.lat, p.lon]), { color: '#245349', weight: 2, fillColor: '#245349', fillOpacity: 0.15 }).addTo(map);
    drawAreaPanel();
  }

  // ---- مسیر ----
  function drawPathPanel() {
    panel.innerHTML = '';
    panel.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:6px' }, 'نقاط مسیر را به‌ترتیب کلیک کنید.'));
    if (pathPoints.length >= 2) {
      let total = 0;
      for (let i = 1; i < pathPoints.length; i++) total += haversineMeters(pathPoints[i - 1].lat, pathPoints[i - 1].lon, pathPoints[i].lat, pathPoints[i].lon);
      panel.append(el('div', { style: 'background:var(--stone-50);border-radius:8px;padding:10px;font-weight:800;font-size:18px' }, `طول کل مسیر: ${(total / 1000).toFixed(3)} کیلومتر (${total.toFixed(0)} متر)`));
    }
  }
  function addPathPoint(lat, lon) {
    const marker = L.circleMarker([lat, lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#8A5A16', fillOpacity: 1 }).addTo(map);
    pathPoints.push({ lat, lon, marker });
    if (pathLine) map.removeLayer(pathLine);
    if (pathPoints.length >= 2) pathLine = L.polyline(pathPoints.map((p) => [p.lat, p.lon]), { color: '#8A5A16', weight: 3 }).addTo(map);
    drawPathPanel();
  }

  // ---- تبدیل مختصات ----
  function drawConvertPanel() {
    panel.innerHTML = '';
    const latInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'عرض جغرافیایی (اعشاری یا DMS)', style: 'width:100%;margin-bottom:6px' });
    const lonInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'طول جغرافیایی (اعشاری یا DMS)', style: 'width:100%;margin-bottom:6px' });
    const zoneInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'Zone، مثلاً 38N', style: 'width:120px' });
    const eastInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'Easting', style: 'width:140px' });
    const northInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'Northing', style: 'width:140px' });
    const resultBox = el('div', { style: 'background:var(--stone-50);border-radius:8px;padding:10px;margin-top:8px;font-size:13px;direction:ltr;text-align:right' });

    function fromLatLon() {
      const lat = dmsToDec(latInput.value); const lon = dmsToDec(lonInput.value);
      if (lat === null || lon === null) { resultBox.textContent = ''; return; }
      const utm = latLonToUtm(lat, lon);
      resultBox.innerHTML = '';
      resultBox.append(
        el('div', {}, `Decimal: ${lat.toFixed(6)}, ${lon.toFixed(6)}`),
        el('div', { style: 'margin-top:4px' }, `DMS: ${decToDms(lat)}, ${decToDms(lon)}`),
        el('div', { style: 'margin-top:4px' }, `UTM: ${formatUtm(utm)}`),
      );
    }
    function fromUtm() {
      const zoneMatch = zoneInput.value.trim().match(/^(\d{1,2})\s*([NnSs])$/);
      const e = parseFloat(eastInput.value); const n = parseFloat(northInput.value);
      if (!zoneMatch || Number.isNaN(e) || Number.isNaN(n)) { resultBox.textContent = ''; return; }
      const { lat, lon } = utmToLatLon(parseInt(zoneMatch[1], 10), zoneMatch[2].toUpperCase(), e, n);
      resultBox.innerHTML = '';
      resultBox.append(
        el('div', {}, `Decimal: ${lat.toFixed(6)}, ${lon.toFixed(6)}`),
        el('div', { style: 'margin-top:4px' }, `DMS: ${decToDms(lat)}, ${decToDms(lon)}`),
      );
    }
    [latInput, lonInput].forEach((i) => i.addEventListener('input', fromLatLon));
    [zoneInput, eastInput, northInput].forEach((i) => i.addEventListener('input', fromUtm));

    panel.append(
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' }, 'از طول/عرض جغرافیایی (اعشاری یا درجه°دقیقه\'ثانیه") به UTM:'),
      latInput, lonInput,
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:10px 0 8px' }, 'یا برعکس، از UTM به طول/عرض جغرافیایی:'),
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [zoneInput, eastInput, northInput]),
      resultBox,
    );
  }

  function drawPanel() {
    panel.innerHTML = '';
    if (activeTool === 'point') drawPointPanel();
    else if (activeTool === 'distance') drawDistancePanel();
    else if (activeTool === 'area') drawAreaPanel();
    else if (activeTool === 'path') drawPathPanel();
    else if (activeTool === 'convert') drawConvertPanel();
  }

  function onMapClick(e) {
    const { lat, lng } = e.latlng;
    if (activeTool === 'point') addPoint(lat, lng);
    else if (activeTool === 'distance') addDistancePoint(lat, lng);
    else if (activeTool === 'area') addAreaPoint(lat, lng);
    else if (activeTool === 'path') addPathPoint(lat, lng);
  }
  map.on('click', onMapClick);

  drawToolbar();

  return function cleanup() {
    map.off('click', onMapClick);
    resetAllLayers();
  };
}

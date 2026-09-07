import { Map as MapLibreMap, NavigationControl, AttributionControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { el, openModal } from '../../lib/dom.js';
import { getMineCorners } from '../../lib/geo.js';
import { getMineBBox } from '../../lib/sentinelHub.js';
import { utmZoneForLon, utmToLatLon } from '../../lib/utm.js';

const ESRI_SATELLITE_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];

/**
 * محاسبه‌ی حجم (volumeCalc.js) قبلاً فقط یک نقشه‌ی حرارتی دوبعدیِ مسطح (renderVolumeHeatmap)
 * تولید می‌کرد. این ماژول همان مثلث‌های TIN محاسبه‌شده (هرکدام با اختلاف ارتفاع d) را به‌صورت
 * منشورهای سه‌بعدیِ واقعی (fill-extrusion در MapLibre) روی تصویر ماهواره‌ای و محدوده‌ی قانونی
 * معدن نمایش می‌دهد — قرمز = کات (برداشت خاک)، آبی = فیل (خاک‌ریزی).
 * محدودیت: چون triangles در دیتابیس ذخیره نمی‌شود (فقط عدد نهایی حجم)، این نما فقط بلافاصله
 * بعد از محاسبه (در همان نشست) در دسترس است، نه برای محاسبات قدیمیِ ذخیره‌شده.
 */
export function open3DVolumeModal(triangles, record, nameField) {
  const mineName = record[nameField] || '—';
  const corners = getMineCorners(record);
  const bbox = getMineBBox(corners, record._lat, record._lon);
  const refLat = record._lat || (corners[0] && corners[0][0]) || 35;
  const refLon = record._lon || (corners[0] && corners[0][1]) || 47;
  const zone = utmZoneForLon(refLon);
  const hemisphere = refLat >= 0 ? 'N' : 'S';

  function toLngLat(x, y) {
    const { lat, lon } = utmToLatLon(zone, hemisphere, x, y);
    return [lon, lat];
  }

  const { body, overlay } = openModal({ title: `🗻 نمای سه‌بعدی حجم کات/فیل — ${mineName}`, width: '90vw' });
  const mapHost = el('div', { style: 'width:100%;height:70vh;border-radius:var(--radius-md);overflow:hidden;background:var(--stone-200)' });
  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, '⏳ در حال بارگذاری نقشه...');
  const legend = el('div', { style: 'display:flex;gap:14px;margin-top:6px;font-size:var(--text-xs)' }, [
    el('span', {}, [el('span', { style: 'display:inline-block;width:12px;height:12px;background:#e53935;border-radius:3px;margin-left:4px;vertical-align:middle' }), 'کات (برداشت خاک)']),
    el('span', {}, [el('span', { style: 'display:inline-block;width:12px;height:12px;background:#1e88e5;border-radius:3px;margin-left:4px;vertical-align:middle' }), 'فیل (خاک‌ریزی)']),
  ]);
  body.append(mapHost, statusLine, legend);

  let exaggeration = 1;
  const exagLevels = ['1', '3', '8'];
  const exagButtons = exagLevels.map((n) => el('button', {
    class: `btn-sm${n === '1' ? '' : ' btn-ghost'}`,
    onclick: () => {
      exaggeration = Number(n);
      exagButtons.forEach((b, i) => { b.className = `btn-sm${exagLevels[i] === n ? '' : ' btn-ghost'}`; });
      if (map.getLayer('cutfill-extrusion')) {
        map.setPaintProperty('cutfill-extrusion', 'fill-extrusion-height', ['*', ['get', 'absD'], exaggeration]);
      }
    },
  }, `×${n}`));
  body.append(el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:8px;font-size:var(--text-xs);color:var(--stone-600)' }, [
    'اغراق ارتفاع (۱× = مقیاس واقعی):', ...exagButtons,
  ]));

  // ── ساخت GeoJSON از مثلث‌های محاسبه‌شده — هر مثلث یک چندضلعی با ارتفاع/رنگ متناظر ──
  const features = [];
  triangles.forEach((tr) => {
    const p0 = toLngLat(tr.x0, tr.y0);
    const p1 = toLngLat(tr.x1, tr.y1);
    const p2 = toLngLat(tr.x2, tr.y2);
    if ([p0, p1, p2].some(([lo, la]) => !Number.isFinite(lo) || !Number.isFinite(la))) return;
    features.push({
      type: 'Feature',
      properties: { absD: Math.abs(tr.d), isCut: tr.d < 0 },
      geometry: { type: 'Polygon', coordinates: [[p0, p1, p2, p0]] },
    });
  });

  const style = {
    version: 8,
    sources: { satellite: { type: 'raster', tiles: ESRI_SATELLITE_TILES, tileSize: 256, attribution: '© Esri World Imagery' } },
    layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite' }],
  };

  const map = new MapLibreMap({
    container: mapHost,
    style,
    center: bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : [refLon, refLat],
    zoom: 17,
    pitch: 55,
    bearing: -20,
    antialias: true,
    attributionControl: false,
  });
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');
  map.addControl(new AttributionControl({ compact: true }));

  let disposed = false;
  map.on('load', () => {
    if (disposed) return;
    if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 24, duration: 0 });

    if (corners.length >= 3) {
      const coords = corners.map(([lat, lon]) => [lon, lat]);
      coords.push(coords[0]);
      map.addSource('boundary', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#ff5722', 'line-width': 3 } });
    }

    map.addSource('cutfill', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: 'cutfill-extrusion',
      type: 'fill-extrusion',
      source: 'cutfill',
      paint: {
        'fill-extrusion-color': ['case', ['get', 'isCut'], '#e53935', '#1e88e5'],
        'fill-extrusion-height': ['*', ['get', 'absD'], exaggeration],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.85,
      },
    });

    statusLine.textContent = `✅ ${features.length.toLocaleString('fa-IR')} مثلث نمایش داده شد`;
  });

  map.on('error', (e) => {
    const msg = e && e.error && e.error.message ? e.error.message : '';
    if (msg.includes('404')) return;
    if (!disposed && !map.loaded()) statusLine.textContent = `❌ خطا: ${msg || 'نامشخص'}`;
  });

  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      disposed = true;
      map.remove();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

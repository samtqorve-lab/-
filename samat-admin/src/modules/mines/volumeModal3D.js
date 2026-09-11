import {
  Map as MapLibreMap, NavigationControl, AttributionControl, Popup, setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// همان فیکس حیاتیِ terrain3d.js — بدون این، setWorkerUrl واقعی هیچ‌وقت اجرا نمی‌شود، DEM هیچ‌وقت
// روی Worker دیکد نمی‌شود، و نقشه بی‌صدا کاملاً دوبعدی می‌ماند (بدون هیچ پیام خطایی). این دو فایل
// (terrain3d.js و این فایل) باید همیشه همین fix را با هم داشته باشند.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { el, openModal, showToast, fmtDate } from '../../lib/dom.js';
import { getMineCorners } from '../../lib/geo.js';
import { getMineBBox } from '../../lib/sentinelHub.js';
import { utmZoneForLon, utmToLatLon } from '../../lib/utm.js';
import { buildTriIndex, interpolateZ, computeLicenseComparison, computeSlopeStats } from '../../lib/volumeCalc.js';

setWorkerUrl(maplibreWorkerUrl);

const ESRI_SATELLITE_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];
// دو منبع کاشیِ ارتفاع برای مقایسه/جایگزینی — همان‌هایی که در terrain3d.js هستند (سرویس‌های
// آمریکایی گاهی از ایران در دسترس نیستند؛ Mapterhorn زیرساخت جدایی دارد و پیش‌فرض شده چون در
// تست‌های واقعی کاربر، AWS خطا می‌داد).
const DEM_SOURCES = {
  mapterhorn: {
    label: 'Mapterhorn', tiles: ['https://tiles.mapterhorn.com/terrarium/{z}/{x}/{y}.webp'], tileSize: 512,
  },
  aws: {
    label: 'AWS (Terrarium)', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256,
  },
};
const DEFAULT_DEM_KEY = 'mapterhorn';
const DEM_MAXZOOM = 13;

/**
 * محاسبه‌ی حجم (volumeCalc.js) قبلاً فقط یک نقشه‌ی حرارتی دوبعدیِ مسطح تولید می‌کرد. این ماژول
 * همان مثلث‌های TIN محاسبه‌شده را به‌صورت منشورهای سه‌بعدیِ واقعی (fill-extrusion در MapLibre)
 * روی تصویر ماهواره‌ای، توپوگرافی واقعی زمین، و محدوده‌ی قانونی معدن نمایش می‌دهد — قرمز = کات،
 * آبی = فیل. با کلیک روی هر بخش جزئیات دقیق دیده می‌شود، و یک ابزار برش عرضی هم برای مقایسه‌ی
 * پروفایل قبل/بعد در یک خط دلخواه هست.
 *
 * @param {object} data { triangles, surfaceA, surfaceB } — یا مستقیم از computeTinVolume (idx
 *   خودش موجود است) یا بازسازی‌شده از فایل ذخیره‌شده در Storage (که در آن صورت idx باید از روی
 *   bbox دوباره با buildTriIndex ساخته شود — این تابع خودش این تشخیص را می‌دهد).
 */
export function open3DVolumeModal(data, record, nameField) {
  const { triangles } = data;
  let { surfaceA, surfaceB } = data;
  if (surfaceA && !surfaceA.idx) {
    surfaceA = { ...surfaceA, idx: buildTriIndex(surfaceA.coordsFlat, surfaceA.triangles, surfaceA.bbox.minX, surfaceA.bbox.minY, surfaceA.bbox.maxX, surfaceA.bbox.maxY) };
  }
  if (surfaceB && !surfaceB.idx) {
    surfaceB = { ...surfaceB, idx: buildTriIndex(surfaceB.coordsFlat, surfaceB.triangles, surfaceB.bbox.minX, surfaceB.bbox.minY, surfaceB.bbox.maxX, surfaceB.bbox.maxY) };
  }

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

  const { body, overlay } = openModal({ title: `🗻 نمای سه‌بعدی حجم کات/فیل — ${mineName}`, width: '92vw' });
  const mapHost = el('div', { style: 'width:100%;height:62vh;border-radius:var(--radius-md);overflow:hidden;background:var(--stone-200)' });
  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, '⏳ در حال بارگذاری نقشه...');
  const legend = el('div', { style: 'display:flex;gap:14px;margin-top:6px;font-size:var(--text-xs);flex-wrap:wrap' }, [
    el('span', {}, [el('span', { style: 'display:inline-block;width:12px;height:12px;background:#e53935;border-radius:3px;margin-left:4px;vertical-align:middle' }), 'کات (برداشت خاک)']),
    el('span', {}, [el('span', { style: 'display:inline-block;width:12px;height:12px;background:#1e88e5;border-radius:3px;margin-left:4px;vertical-align:middle' }), 'فیل (خاک‌ریزی)']),
    el('span', { style: 'color:var(--stone-500)' }, '💡 روی هر بخش کلیک کنید برای جزئیات دقیق'),
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

  let crossSectionMode = false;
  let csPoints = [];
  const csBtn = el('button', { class: 'btn-sm btn-ghost' }, '📏 برش عرضی (دو نقطه کلیک کنید)');
  const csChartBox = el('div', { style: 'display:none;margin-top:10px' });
  csBtn.addEventListener('click', () => {
    crossSectionMode = !crossSectionMode;
    csPoints = [];
    if (map.getLayer('cs-line')) map.removeLayer('cs-line');
    if (map.getSource('cs-line')) map.removeSource('cs-line');
    csChartBox.style.display = 'none';
    csBtn.className = crossSectionMode ? 'btn-sm' : 'btn-sm btn-ghost';
    csBtn.textContent = crossSectionMode ? '📏 روی نقشه دو نقطه کلیک کنید...' : '📏 برش عرضی (دو نقطه کلیک کنید)';
  });

  const exportBtn = el('button', { class: 'btn-sm btn-ghost' }, '📷 دانلود عکس + گزارش');
  exportBtn.addEventListener('click', () => exportSnapshot());

  const slopeBtn = surfaceB ? el('button', { class: 'btn-sm btn-ghost' }, '⚠️ بررسی شیب دیواره‌ها') : null;
  if (slopeBtn) slopeBtn.addEventListener('click', () => toggleSlopeCheck());

  let demKey = DEFAULT_DEM_KEY;
  const demButtons = Object.keys(DEM_SOURCES).map((key) => el('button', {
    class: `btn-sm${key === demKey ? '' : ' btn-ghost'}`,
    onclick: () => {
      if (key === demKey) return;
      demKey = key;
      demButtons.forEach((b, i) => { b.className = `btn-sm${Object.keys(DEM_SOURCES)[i] === key ? '' : ' btn-ghost'}`; });
      switchDemSource(key);
    },
  }, DEM_SOURCES[key].label));

  body.append(el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:10px;font-size:var(--text-xs);color:var(--stone-600);flex-wrap:wrap' }, [
    'اغراق ارتفاع (۱× = واقعی):', ...exagButtons,
    el('span', { style: 'width:1px;height:16px;background:var(--stone-300);margin:0 4px' }),
    csBtn, exportBtn, ...(slopeBtn ? [slopeBtn] : []),
  ]));
  body.append(el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:4px;font-size:var(--text-xs);color:var(--stone-600)' }, [
    'منبع داده‌ی ارتفاع:', ...demButtons,
  ]));
  body.append(csChartBox);

  const features = [];
  triangles.forEach((tr) => {
    const p0 = toLngLat(tr.x0, tr.y0);
    const p1 = toLngLat(tr.x1, tr.y1);
    const p2 = toLngLat(tr.x2, tr.y2);
    if ([p0, p1, p2].some(([lo, la]) => !Number.isFinite(lo) || !Number.isFinite(la))) return;
    features.push({
      type: 'Feature',
      properties: { absD: Math.abs(tr.d), isCut: tr.d < 0, d: tr.d },
      geometry: { type: 'Polygon', coordinates: [[p0, p1, p2, p0]] },
    });
  });

  const style = {
    version: 8,
    sources: {
      satellite: { type: 'raster', tiles: ESRI_SATELLITE_TILES, tileSize: 256, attribution: '© Esri World Imagery' },
      terrainSource: {
        type: 'raster-dem', tiles: DEM_SOURCES[demKey].tiles, tileSize: DEM_SOURCES[demKey].tileSize, encoding: 'terrarium', maxzoom: DEM_MAXZOOM,
      },
    },
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

  function switchDemSource(key) {
    if (disposed) return;
    statusLine.textContent = `⏳ در حال تعویض منبع ارتفاع به ${DEM_SOURCES[key].label}...`;
    try {
      map.setTerrain(null);
      if (map.getSource('terrainSource')) map.removeSource('terrainSource');
      map.addSource('terrainSource', {
        type: 'raster-dem', tiles: DEM_SOURCES[key].tiles, tileSize: DEM_SOURCES[key].tileSize, encoding: 'terrarium', maxzoom: DEM_MAXZOOM,
      });
      map.setTerrain({ source: 'terrainSource', exaggeration: 1 });
      map.once('idle', () => { if (!disposed && demKey === key) statusLine.textContent = `✅ منبع ارتفاع «${DEM_SOURCES[key].label}» فعال شد`; });
    } catch (err) {
      statusLine.textContent = `❌ منبع «${DEM_SOURCES[key].label}» فعال نشد (${err.message})`;
    }
  }

  let disposed = false;
  let clickPopup = null;
  let slopeVisible = false;
  const SAFE_SLOPE_THRESHOLD_DEG = 45;

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
        'fill-extrusion-opacity': 0.88,
        'fill-extrusion-vertical-gradient': true,
      },
    });

    try { map.setTerrain({ source: 'terrainSource', exaggeration: 1 }); } catch { /* بی‌صدا نادیده گرفته می‌شود، نمای مسطح جایگزین است */ }

    statusLine.textContent = `✅ ${features.length.toLocaleString('fa-IR')} مثلث نمایش داده شد`;

    map.on('click', 'cutfill-extrusion', (e) => {
      if (crossSectionMode) return;
      const f = e.features && e.features[0];
      if (!f) return;
      if (clickPopup) clickPopup.remove();
      const { d } = f.properties;
      clickPopup = new Popup({ closeButton: true })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="font-family:inherit;font-size:12px;direction:rtl">
          <b>${d < 0 ? '🔴 کات' : '🔵 فیل'}</b><br>
          اختلاف ارتفاع: ${Math.abs(d).toFixed(2)} متر<br>
          مختصات: ${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}
        </div>`)
        .addTo(map);
    });
    map.on('mouseenter', 'cutfill-extrusion', () => { if (!crossSectionMode) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cutfill-extrusion', () => { map.getCanvas().style.cursor = ''; });

    map.on('click', (e) => {
      if (!crossSectionMode) return;
      csPoints.push([e.lngLat.lng, e.lngLat.lat]);
      if (csPoints.length === 1) {
        showToast('نقطه‌ی دوم را هم کلیک کنید');
      } else if (csPoints.length === 2) {
        drawCrossSection(csPoints[0], csPoints[1]);
        crossSectionMode = false;
        csBtn.className = 'btn-sm btn-ghost';
        csBtn.textContent = '📏 برش عرضی (دو نقطه کلیک کنید)';
      }
    });
  });

  function lngLatToUtmXY(lng, lat) {
    const A = 6378137.0; const F = 1 / 298.257223563; const E2 = F * (2 - F); const E2P = E2 / (1 - E2); const K0 = 0.9996;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const lonOrigin = toRad((zone - 1) * 6 - 180 + 3);
    const latR = toRad(lat); const lonR = toRad(lng);
    const N = A / Math.sqrt(1 - E2 * Math.sin(latR) ** 2);
    const T = Math.tan(latR) ** 2; const C = E2P * Math.cos(latR) ** 2;
    const Aa = Math.cos(latR) * (lonR - lonOrigin);
    const M = A * ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * latR
      - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * latR)
      + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * latR)
      - ((35 * E2 ** 3) / 3072) * Math.sin(6 * latR));
    const easting = K0 * N * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * E2P) * Aa ** 5) / 120) + 500000;
    let northing = K0 * (M + N * Math.tan(latR) * ((Aa ** 2) / 2 + ((5 - T + 9 * C + 4 * C ** 2) * Aa ** 4) / 24
      + ((61 - 58 * T + T ** 2 + 600 * C - 330 * E2P) * Aa ** 6) / 720));
    if (lat < 0) northing += 10000000;
    return { x: easting, y: northing };
  }

  function drawCrossSection(lngLat0, lngLat1) {
    map.addSource('cs-line', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [lngLat0, lngLat1] } } });
    map.addLayer({ id: 'cs-line', type: 'line', source: 'cs-line', paint: { 'line-color': '#ffeb3b', 'line-width': 3, 'line-dasharray': [2, 1] } });

    const N = 60;
    const profA = []; const profB = [];
    for (let i = 0; i <= N; i += 1) {
      const t = i / N;
      const lng = lngLat0[0] + (lngLat1[0] - lngLat0[0]) * t;
      const lat = lngLat0[1] + (lngLat1[1] - lngLat0[1]) * t;
      const { x, y } = lngLatToUtmXY(lng, lat);
      const zA = surfaceA ? interpolateZ(surfaceA.idx, surfaceA.coordsFlat, surfaceA.triangles, surfaceA.zvals, x, y) : NaN;
      const zB = surfaceB ? interpolateZ(surfaceB.idx, surfaceB.coordsFlat, surfaceB.triangles, surfaceB.zvals, x, y) : NaN;
      profA.push(zA); profB.push(zB);
    }
    renderCrossSectionChart(profA, profB);
  }

  function renderCrossSectionChart(profA, profB) {
    csChartBox.innerHTML = '';
    csChartBox.style.display = 'block';
    const canvas = el('canvas', { width: '900', height: '220', style: 'width:100%;border-radius:8px;border:1px solid var(--stone-300);background:#fff' });
    csChartBox.append(
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:6px' },
        'پروفایل برش عرضی — نارنجی: نقشه‌ی قبلی، آبی: نقشه‌ی جدید (ناحیه‌ی رنگی بین دو خط = فیل/کات در همان برش)'),
      canvas,
    );
    const ctx = canvas.getContext('2d');
    const W = canvas.width; const H = canvas.height; const pad = 30;
    const valid = [...profA, ...profB].filter(Number.isFinite);
    if (!valid.length) { ctx.fillText('داده‌ی مشترکی در این خط یافت نشد', 20, 20); return; }
    const zMin = Math.min(...valid); const zMax = Math.max(...valid);
    const zRange = (zMax - zMin) || 1;
    const N = profA.length - 1;
    const toX = (i) => pad + (i / N) * (W - 2 * pad);
    const toY = (z) => H - pad - ((z - zMin) / zRange) * (H - 2 * pad);

    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < N; i += 1) {
      if (![profA[i], profA[i + 1], profB[i], profB[i + 1]].every(Number.isFinite)) continue;
      ctx.beginPath();
      ctx.moveTo(toX(i), toY(profA[i]));
      ctx.lineTo(toX(i + 1), toY(profA[i + 1]));
      ctx.lineTo(toX(i + 1), toY(profB[i + 1]));
      ctx.lineTo(toX(i), toY(profB[i]));
      ctx.closePath();
      ctx.fillStyle = profB[i] > profA[i] ? 'rgba(30,136,229,0.25)' : 'rgba(229,57,53,0.25)';
      ctx.fill();
    }
    const drawLine = (prof, color) => {
      ctx.beginPath();
      let started = false;
      prof.forEach((z, i) => {
        if (!Number.isFinite(z)) { started = false; return; }
        if (!started) { ctx.moveTo(toX(i), toY(z)); started = true; } else ctx.lineTo(toX(i), toY(z));
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    };
    drawLine(profA, '#fb8c00');
    drawLine(profB, '#1e88e5');
  }

  function fmtNum(n) {
    return Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 1 });
  }

  /**
   * قبلاً این دکمه («📷 دانلود عکس + گزارش») فقط همان عکس PNG را دانلود می‌کرد — هیچ گزارشی
   * ساخته نمی‌شد با اینکه در متن دکمه وعده داده شده بود. حالا یک پیش‌نمایش چاپی واقعی (همان
   * الگوی fuelPrintModal.js/qrCheckinModal.js) باز می‌شود: عکس نمای سه‌بعدی + اطلاعات پروانه +
   * اعداد حجم + مقایسه‌ی تناژی — آماده‌ی چاپ یا پیوست به مکاتبات اداری.
   */
  /**
   * شیب هر مثلث از آخرین نقشه‌برداری (surfaceB) را حساب و مثلث‌های شیب‌دارتر از حد آستانه را
   * با رنگ هشدار (زرد/قرمز پررنگ) روی نمای سه‌بعدی برجسته می‌کند — قبلاً هیچ ابزاری برای دیدن
   * شیب دیواره‌های معدن در این پنل وجود نداشت، فقط حجم کات/فیل دیده می‌شد.
   */
  function toggleSlopeCheck() {
    if (slopeVisible) {
      if (map.getLayer('slope-warning')) map.removeLayer('slope-warning');
      if (map.getSource('slope-warning')) map.removeSource('slope-warning');
      slopeVisible = false;
      slopeBtn.textContent = '⚠️ بررسی شیب دیواره‌ها';
      statusLine.textContent = `✅ ${features.length.toLocaleString('fa-IR')} مثلث نمایش داده شد`;
      return;
    }
    const stats = computeSlopeStats(surfaceB, SAFE_SLOPE_THRESHOLD_DEG);
    const slopeFeatures = [];
    stats.steepTriIndices.forEach((t) => {
      const i0 = surfaceB.triangles[t * 3]; const i1 = surfaceB.triangles[t * 3 + 1]; const i2 = surfaceB.triangles[t * 3 + 2];
      const p0 = toLngLat(surfaceB.coordsFlat[i0 * 2], surfaceB.coordsFlat[i0 * 2 + 1]);
      const p1 = toLngLat(surfaceB.coordsFlat[i1 * 2], surfaceB.coordsFlat[i1 * 2 + 1]);
      const p2 = toLngLat(surfaceB.coordsFlat[i2 * 2], surfaceB.coordsFlat[i2 * 2 + 1]);
      if ([p0, p1, p2].some(([lo, la]) => !Number.isFinite(lo) || !Number.isFinite(la))) return;
      slopeFeatures.push({
        type: 'Feature', properties: { slope: stats.slopeDeg[t] }, geometry: { type: 'Polygon', coordinates: [[p0, p1, p2, p0]] },
      });
    });
    map.addSource('slope-warning', { type: 'geojson', data: { type: 'FeatureCollection', features: slopeFeatures } });
    map.addLayer({
      id: 'slope-warning',
      type: 'fill-extrusion',
      source: 'slope-warning',
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'slope'], SAFE_SLOPE_THRESHOLD_DEG, '#fbc02d', 70, '#c62828'],
        'fill-extrusion-height': 3,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.95,
      },
    });
    slopeVisible = true;
    slopeBtn.textContent = '✖️ پنهان‌کردن نمای شیب';
    if (!stats.steepCount) {
      statusLine.textContent = `✅ هیچ‌کدام از ${stats.totalTriCount.toLocaleString('fa-IR')} بخش سطح، شیبی بیش از ${SAFE_SLOPE_THRESHOLD_DEG}° نداشت (بیشینه‌ی یافت‌شده: ${fmtNum(stats.maxSlopeDeg)}°).`;
    } else {
      statusLine.textContent = `⚠️ ${stats.steepCount.toLocaleString('fa-IR')} بخش (از ${stats.totalTriCount.toLocaleString('fa-IR')}) شیبی بیش از ${SAFE_SLOPE_THRESHOLD_DEG}° دارند — بیشینه: ${fmtNum(stats.maxSlopeDeg)}°. این فقط یک هشدار غربالگری اولیه است، برای تایید نیاز به بررسی مهندسی ژئوتکنیک دارید.`;
    }
  }

  function exportSnapshot() {
    const dataUrl = map.getCanvas().toDataURL('image/png');
    const { cutVolume, fillVolume, netVolume, calcDate } = data;
    const hasVolumes = cutVolume != null;

    const { body: modalBody } = openModal({ title: '🖨️ پیش‌نمایش گزارش حجم', width: '640px' });
    const printArea = el('div', { class: 'volume-print-area', style: 'border:1px solid var(--stone-200);border-radius:8px;padding:14px;background:#fff' });

    const rows = [];
    rows.push(`<div class="pf-title">گزارش محاسبه‌ی حجم برداشت/انباشت — ${mineName}</div>`);
    rows.push(`<div class="pf-underline" style="text-align:center;margin-bottom:10px">اداره صنعت، معدن و تجارت شهرستان قروه</div>`);
    rows.push('<div class="pf-divider"></div>');
    if (hasVolumes) {
      rows.push('<table class="pf-table"><tr><th>حجم کات (m³)</th><th>حجم فیل (m³)</th><th>خالص (m³)</th></tr>'
        + `<tr><td>${fmtNum(cutVolume)}</td><td>${fmtNum(fillVolume)}</td><td>${fmtNum(netVolume)}</td></tr></table>`);
      const cmp = computeLicenseComparison(record, cutVolume);
      if (cmp) {
        rows.push('<div class="pf-body" style="margin-top:12px">');
        rows.push(`<div>⚖️ معادل تناژی (وزن مخصوص پروانه: ${cmp.sg}): <b>${fmtNum(cmp.tons)} تن</b></div>`);
        if (cmp.pctOfReserve != null) rows.push(`<div>📊 نسبت به ذخیره‌ی قطعی (${fmtNum(cmp.reserveTons)} تن): <b>${cmp.pctOfReserve.toFixed(1)}٪</b></div>`);
        if (cmp.expectedTons != null) rows.push(`<div>📅 برداشت مورد انتظار طبق نرخ مجاز سالیانه تا امروز: <b>${fmtNum(cmp.expectedTons)} تن</b></div>`);
        rows.push('</div>');
      }
    } else {
      rows.push('<div class="pf-body">این محاسبه از تاریخچه بازیابی شده و اعداد حجم آن در دسترس نیست.</div>');
    }
    rows.push(`<img src="${dataUrl}" style="width:100%;border-radius:8px;margin-top:14px;border:1px solid #ddd" />`);
    rows.push(`<div class="pf-sign-row"><span>تاریخ محاسبه: ${calcDate || fmtDate(new Date())}</span><span>تاریخ چاپ گزارش: ${fmtDate(new Date())}</span></div>`);
    rows.push('<div style="font-size:10px;color:#999;margin-top:10px">⚠️ این گزارش بر پایه‌ی فایل‌های نقشه‌برداری آپلودشده توسط کاربر تهیه شده و جایگزین تایید مهندسی رسمی نیست.</div>');
    printArea.innerHTML = rows.join('');

    modalBody.append(
      printArea,
      el('div', { style: 'display:flex;gap:10px;margin-top:16px' }, [
        el('button', { class: 'btn btn-primary', style: 'flex:1', onclick: () => window.print() }, '🖨️ چاپ گزارش'),
        el('button', {
          class: 'btn btn-ghost', style: 'flex:1',
          onclick: () => { const a = document.createElement('a'); a.href = dataUrl; a.download = `حجم-کات-فیل-${mineName}.png`; a.click(); },
        }, '📷 دانلود فقط عکس'),
      ]),
    );
  }

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

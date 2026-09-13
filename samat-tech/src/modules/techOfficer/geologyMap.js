import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { cachedTileLayer } from '../../lib/cachedTileLayer.js';
import { getMineCornersLabeled, getWarmCoords } from '../../lib/geo.js';

// لایه‌ی زمین‌شناسی: Macrostrat — بزرگ‌ترین پایگاه یکپارچه‌ی نقشه‌های زمین‌شناسی جهان، ترکیبی از
// بیش از ۲۰۰ منبع رسمی (از جمله USGS آمریکا) که به‌صورت رایگان و بدون نیاز به کلید/API روی
// tiles.macrostrat.org سرو می‌شود (مجوز CC BY 4.0). چون سرویس‌های OneGeology/GSI برای همه‌ی
// نقاط ایران WMS عمومیِ پایدار ندارند، این گزینه قابل‌اعتمادترین نقشه‌ی زمین‌شناسیِ با پوشش جهانی
// و آدرس XYZ ساده است. صادقانه: در مناطقی که نقشه‌ی رسمی محلی (مثل نقشه‌های سازمان زمین‌شناسی
// کشور) به Macrostrat نرسیده، این لایه فقط در مقیاس کوچک/منطقه‌ای نمایش داده می‌شود، نه با جزئیات
// نقشه‌ی ۱:۱۰۰۰۰۰ محلی — برای اکتشاف دقیق باید همیشه با نقشه‌ی رسمی سازمان زمین‌شناسی کشور مطابقت داده شود.
const GEOLOGY_TILE_URL = 'https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png';
const SAT_TILE_URL = 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
const STREET_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

async function loadBoreholes(mineName) {
  if (!mineName) return [];
  const { data, error } = await sb.from('exploration_boreholes')
    .select('borehole_no,lat,lon,depth_m,lithology,drill_date')
    .eq('mine_name', mineName)
    .not('lat', 'is', null).not('lon', 'is', null)
    .limit(300);
  if (error) return [];
  return data || [];
}

/**
 * نقشه‌ی زمین‌شناسی تمام‌صفحه — مخصوص تخصص «اکتشاف». لایه‌ی زمین‌شناسیِ Macrostrat (که خودش
 * داده‌های USGS و ده‌ها سازمان زمین‌شناسی رسمی دیگر را ترکیب می‌کند) روی نقشه‌ی پایه‌ی
 * ماهواره‌ای/خیابانی می‌نشیند و محدوده‌ی قانونی معدن + گمانه/ترانشه‌های ثبت‌شده‌ی همان بخش
 * اکتشاف (explorationLog.js) هم رویش نمایش داده می‌شود.
 * @param {object} mine
 * @param {string} nameField
 */
export function openGeologyMapModal(mine, nameField) {
  const mineName = mine?.[nameField] || '';
  const corners = getMineCornersLabeled(mine || {});

  const screen = el('div', { style: 'position:fixed;inset:0;background:#fff;z-index:460;display:flex;flex-direction:column' });
  const topBar = el('div', {
    style: 'display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:var(--slate-900);color:#fff',
  });
  const backBtn = el('button', {
    style: 'background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px',
    onclick: () => close(),
  }, '→ بازگشت');
  const titleEl = el('div', { style: 'font-weight:700;font-size:14px;flex:1' }, `🗺️ نقشه زمین‌شناسی${mineName ? ` — ${mineName}` : ''}`);
  topBar.append(backBtn, titleEl);

  const toolbar = el('div', { style: 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--stone-100);border-bottom:1px solid var(--stone-200);flex-wrap:wrap' });
  const mapHost = el('div', { style: 'flex:1;min-height:0;background:var(--stone-200)' });
  const footer = el('div', {
    style: 'padding:8px 14px calc(8px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--stone-200);font-size:var(--text-xs);color:var(--stone-600);line-height:1.8',
  }, [
    el('div', {}, '🌍 لایه‌ی زمین‌شناسی: Macrostrat — ترکیبی از نقشه‌های رسمی جهانی (از جمله USGS) — CC BY 4.0.'),
    el('div', {}, '⚠️ در مناطق بدون نقشه‌ی محلی دقیق، این لایه فقط در مقیاس کوچک/منطقه‌ای است؛ همیشه با نقشه‌ی رسمی سازمان زمین‌شناسی کشور تطبیق دهید.'),
  ]);

  screen.append(topBar, toolbar, mapHost, footer);
  document.body.append(screen);

  const map = L.map(mapHost, { zoomControl: true, attributionControl: false });

  let baseSat = true;
  const satLayer = cachedTileLayer(SAT_TILE_URL, { subdomains: ['0', '1', '2', '3'], maxZoom: 20 });
  const streetLayer = cachedTileLayer(STREET_TILE_URL, { subdomains: ['a', 'b', 'c', 'd'], maxZoom: 19 });
  satLayer.addTo(map);

  const geologyLayer = L.tileLayer(GEOLOGY_TILE_URL, { maxZoom: 16, opacity: 0.65 });
  geologyLayer.addTo(map);

  // --- محدوده‌ی قانونی معدن/محدوده‌ی اکتشافی (در صورت وجود مختصات گوشه‌ها) ---
  let boundaryPolygon = null;
  if (corners.length) {
    boundaryPolygon = L.polygon(corners.map((c) => [c.lat, c.lon]), {
      color: '#C97A31', weight: 2, fillColor: '#C97A31', fillOpacity: 0.08,
    }).addTo(map);
    corners.forEach((c) => {
      L.circleMarker([c.lat, c.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#8A5A16', fillOpacity: 1 })
        .bindTooltip(c.label, { permanent: true, direction: 'top' }).addTo(map);
    });
  }

  // --- گمانه/ترانشه‌های ثبت‌شده (از همان جدول exploration_boreholes) ---
  const boreholeLayer = L.layerGroup().addTo(map);
  function renderBoreholes(rows) {
    boreholeLayer.clearLayers();
    rows.forEach((r) => {
      const lines = [`<b>${r.borehole_no || '—'}</b>`];
      if (r.depth_m != null) lines.push(`عمق: ${r.depth_m} متر`);
      if (r.lithology) lines.push(`لیتولوژی: ${r.lithology}`);
      if (r.drill_date) lines.push(`تاریخ: ${r.drill_date}`);
      L.circleMarker([r.lat, r.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#5C4A87', fillOpacity: 1 })
        .bindPopup(lines.join('<br>'))
        .addTo(boreholeLayer);
    });
  }

  // --- محدوده‌ی اولیه‌ی نما ---
  if (boundaryPolygon) {
    map.fitBounds(boundaryPolygon.getBounds(), { padding: [24, 24] });
  } else {
    const warm = getWarmCoords(60000);
    if (warm) map.setView([warm.latitude, warm.longitude], 13);
    else map.setView([32.4279, 53.688], 5); // مرکز ایران؛ تا موقعیت دقیق‌تری در دسترس باشد
  }

  loadBoreholes(mineName).then((rows) => {
    renderBoreholes(rows);
    if (!boundaryPolygon && rows.length) {
      const group = L.featureGroup(rows.map((r) => L.marker([r.lat, r.lon])));
      map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 15 });
    }
  });

  // --- کنترل‌های نوار ابزار: جابه‌جایی لایه‌ی پایه + شفافیت لایه‌ی زمین‌شناسی ---
  const baseToggleBtn = el('button', {
    class: 'btn-sm',
    style: 'background:var(--stone-200);color:var(--ink-700)',
    onclick: () => {
      baseSat = !baseSat;
      if (baseSat) { map.removeLayer(streetLayer); satLayer.addTo(map); }
      else { map.removeLayer(satLayer); streetLayer.addTo(map); }
      geologyLayer.bringToFront();
      baseToggleBtn.textContent = baseSat ? '🛰️ ماهواره‌ای' : '🗺️ ساده';
    },
  }, '🛰️ ماهواره‌ای');

  let geologyVisible = true;
  const geologyToggleBtn = el('button', {
    class: 'btn-sm',
    style: 'background:var(--patina-100);color:var(--patina-700)',
    onclick: () => {
      geologyVisible = !geologyVisible;
      if (geologyVisible) geologyLayer.addTo(map); else map.removeLayer(geologyLayer);
      geologyToggleBtn.style.background = geologyVisible ? 'var(--patina-100)' : 'var(--stone-200)';
      geologyToggleBtn.style.color = geologyVisible ? 'var(--patina-700)' : 'var(--ink-700)';
      opacitySlider.style.display = geologyVisible ? '' : 'none';
    },
  }, '🌍 لایه زمین‌شناسی');

  const opacitySlider = el('input', {
    type: 'range', min: '20', max: '100', value: '65', style: 'width:110px;vertical-align:middle',
    oninput: (e) => geologyLayer.setOpacity(Number(e.target.value) / 100),
  });

  const myPosBtn = el('button', {
    class: 'btn-sm',
    style: 'background:var(--schist-100);color:var(--schist-600)',
    onclick: () => {
      const warm = getWarmCoords(60000);
      if (!warm) { showToast('⚠️ هنوز موقعیت GPS دریافت نشده'); return; }
      map.setView([warm.latitude, warm.longitude], 15);
    },
  }, '📍 موقعیت من');

  toolbar.append(
    baseToggleBtn, geologyToggleBtn,
    el('span', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-xs);color:var(--stone-600)' }, ['شفافیت', opacitySlider]),
    myPosBtn,
  );

  setTimeout(() => map.invalidateSize(), 60);

  function close() {
    map.remove();
    screen.remove();
  }
}

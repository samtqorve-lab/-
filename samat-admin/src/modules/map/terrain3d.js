import { Map as MaplibreMap, AttributionControl, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { el, showToast, openModal } from '../../lib/dom.js';
import { getMineCorners } from '../../lib/geo.js';
import {
  getMineBBox, checkCopernicusStatus, getCopernicusToken, fetchSentinelImage, SAT_LAYERS,
} from '../../lib/sentinelHub.js';

// ── چرا MapLibre GL JS به‌جای پیاده‌سازی قبلی (Three.js دستی) ──
// این ماژول قبلاً با Three.js یک شبکه‌ی ارتفاع را دستی می‌ساخت و اگر Sentinel Hub تنظیم نشده
// بود، به‌جای عکس واقعی فقط رنگ‌بندی بر اساس ارتفاع (سبز تا سفید) نشان می‌داد — یعنی حتی با
// تنظیم‌نشدن Sentinel Hub، شبیه گوگل‌ارث به‌نظر نمی‌رسید. راه‌حل اول که امتحان شد («کاشی‌های
// ماهواره‌ای رایگان گوگل که همین الان در نقشه‌ی دوبعدی استفاده می‌شوند را به‌عنوان بافت سه‌بعدی
// بچسبانیم») در عمل با یک مانع فنی برخورد کرد: سرور کاشی گوگل هیچ هدر CORS نمی‌فرستد، و بدون آن
// مرورگر اجازه نمی‌دهد یک تصویر cross-origin را روی canvas/WebGL texture بکشیم (خطای امنیتی
// "tainted canvas") — برای نمایش ساده‌ی <img> در نقشه‌ی لیفلت مشکلی نیست، ولی برای بافت سه‌بعدی
// غیرممکن است. MapLibre GL JS این مشکل را از ریشه حل می‌کند چون: (۱) مدل ارتفاعی‌اش را مستقیم از
// همان کاشی‌های رایگان Terrarium می‌گیرد که خودِ این پروژه از قبل استفاده می‌کند (میزبانی‌شده روی
// AWS S3 با هدر CORS باز)، (۲) به‌عنوان بافت پیش‌فرض از EOX Sentinel-2 Cloudless استفاده می‌کند
// (یک لایه‌ی ماهواره‌ای رایگان و جهانی که رسماً برای همین کاربرد CORS باز دارد)، و (۳) اگر
// Sentinel Hub توسط ادمین تنظیم شده باشد، همان تصویر واقعی و به‌روزتر را جایگزین می‌کند — دقیقاً
// مثل قبل، فقط این‌بار حالت پیش‌فرض (بدون هیچ تنظیمی) هم عکس واقعی نشان می‌دهد، نه رنگ ارتفاعی.
const TERRARIUM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// EOX Sentinel-2 Cloudless — پوشش جهانی، رایگان، بدون نیاز به کلید/حساب (نیازمند ذکر منبع طبق
// شرایط استفاده‌ی EOX؛ AttributionControl پایین همین کار را می‌کند)
const EOX_CLOUDLESS_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';

/** اگر Copernicus (Sentinel Hub) در پنل «پایش ماهواره‌ای» تنظیم شده باشد، تصویر واقعی و دقیق‌تر
 * همان بازه‌ی مختصاتی را می‌گیرد؛ در غیر این‌صورت null برمی‌گرداند تا از EOX (پیش‌فرض) استفاده شود. */
async function fetchSentinelHubTexture(bbox) {
  const status = await checkCopernicusStatus();
  if (!status.configured) return null;
  try {
    const token = await getCopernicusToken('', '');
    const today = new Date();
    const dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    const layer = SAT_LAYERS.truecolor;
    const blob = await fetchSentinelImage(token, bbox, dateStr, layer.script, 1024, 1024, layer.collection, 45);
    return URL.createObjectURL(blob);
  } catch {
    return null; // بی‌صدا به EOX (پیش‌فرض) برمی‌گردیم
  }
}

/**
 * مدل سه‌بعدی توپوگرافی محدوده‌ی یک معدن را با MapLibre GL JS باز می‌کند — ارتفاع واقعی زمین
 * (از داده‌ی رایگان Terrarium) با بافت ماهواره‌ای واقعی روی آن (EOX رایگان، یا Sentinel Hub در
 * صورت تنظیم‌شدن) دقیقاً مثل نمای سه‌بعدی گوگل‌ارث.
 */
export function open3DTerrainModal(record, nameField) {
  const mineName = record[nameField] || '—';
  const corners = getMineCorners(record);
  const bbox = getMineBBox(corners, record._lat, record._lon);
  if (!bbox) { showToast('⚠️ این رکورد مختصات ثبت‌شده ندارد'); return; }
  const [west, south, east, north] = bbox;

  const { body, overlay } = openModal({ title: `🗻 مدل سه‌بعدی توپوگرافی — ${mineName}`, width: '90vw' });
  const mapHost = el('div', { style: 'width:100%;height:70vh;border-radius:var(--radius-md);overflow:hidden;background:var(--stone-200)' });
  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, '⏳ در حال دریافت تصویر ماهواره‌ای...');
  const hint = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:4px' },
    'برای چرخش زاویه/شیب دیدن، کلیک راست را نگه دارید و بکشید (یا با دو انگشت روی موبایل)؛ برای جابه‌جایی بکشید، برای زوم اسکرول کنید.');
  body.append(mapHost, statusLine, hint);

  let disposed = false;

  const map = new MaplibreMap({
    container: mapHost,
    style: {
      version: 8,
      sources: {
        terrainSource: {
          type: 'raster-dem',
          tiles: [TERRARIUM_TILES],
          tileSize: 256,
          encoding: 'terrarium', // پیش‌فرض MapLibre رمزگذاری 'mapbox' است — با منبع Terrarium ما اگر این را صریح ننویسیم، ارتفاع‌ها کاملاً غلط محاسبه می‌شوند
          maxzoom: 15,
        },
        satBase: {
          type: 'raster',
          tiles: [EOX_CLOUDLESS_TILES],
          tileSize: 256,
          attribution: '© EOX IT Services GmbH — Sentinel-2 cloudless',
        },
        boundary: {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: corners.length >= 3 ? [...corners.map(([lat, lon]) => [lon, lat]), [corners[0][1], corners[0][0]]] : [] },
          },
        },
      },
      layers: [
        { id: 'sat-base', type: 'raster', source: 'satBase' },
        { id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#ff5722', 'line-width': 3 } },
      ],
      terrain: { source: 'terrainSource', exaggeration: 1.5 },
      sky: {},
    },
    center: [(west + east) / 2, (south + north) / 2],
    zoom: 13,
    attributionControl: false,
    maxPitch: 85,
  });
  map.addControl(new AttributionControl({ compact: true }));
  map.addControl(new NavigationControl({ visualizePitch: true }));

  map.on('load', () => {
    if (disposed) return;
    map.fitBounds([[west, south], [east, north]], { padding: 40, animate: false });
    map.once('idle', () => {
      if (disposed) return;
      map.easeTo({ pitch: 60, bearing: -20, duration: 600 });
    });
  });

  fetchSentinelHubTexture(bbox).then((url) => {
    if (disposed) return;
    if (!url) {
      statusLine.textContent = 'ℹ️ تصویر ماهواره‌ای پایه (EOX، رایگان و جهانی) نمایش داده می‌شود — برای تصویر به‌روزتر، Sentinel Hub را در «پایش ماهواره‌ای» تنظیم کنید.';
      return;
    }
    const applyImage = () => {
      if (disposed) return;
      map.addSource('satImage', {
        type: 'image',
        url,
        coordinates: [[west, north], [east, north], [east, south], [west, south]],
      });
      map.addLayer({ id: 'sat-hires', type: 'raster', source: 'satImage' }, 'boundary-line');
      statusLine.textContent = '✅ بافت از تصویر ماهواره‌ای واقعی (Sentinel-2 Hub) — به‌روزتر از لایه‌ی پایه';
    };
    if (map.isStyleLoaded()) applyImage(); else map.once('load', applyImage);
  });

  // پاک‌سازی وقتی مودال بسته می‌شود (چون shell.js موقع تعویض تب فقط innerHTML را پاک می‌کند، نه
  // unmount واقعی — بدون این observer، نمونه‌ی WebGL همچنان در حافظه و کارت گرافیک زنده می‌ماند)
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      disposed = true;
      map.remove();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

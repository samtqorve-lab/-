import { Map as MapLibreMap, NavigationControl, AttributionControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { el, showToast, openModal } from '../../lib/dom.js';
import { getMineCorners } from '../../lib/geo.js';
import {
  getMineBBox, checkCopernicusStatus, getCopernicusToken, fetchSentinelImage, SAT_LAYERS,
} from '../../lib/sentinelHub.js';

/**
 * قبلاً این ماژول با Three.js دستی یک صفحه‌ی مربع می‌ساخت و ارتفاع را با یک ضریب اغراقِ کور
 * می‌کشید — نتیجه هیچ ربطی به شکل/مقیاس واقعی زمین نداشت. maplibre-gl از قبل در package.json
 * این پروژه بود (حتی کامنت قدیمی terrain3dPage.js به «سنگین بودن MapLibre GL JS» اشاره می‌کرد)
 * ولی هیچ‌جا واقعاً استفاده نشده بود. حالا از موتور واقعی نقشه با terrain سه‌بعدیِ بومی
 * (raster-dem + camera pitch/bearing واقعی) استفاده می‌کنیم — دقیقاً همان روشی که گوگل‌ارث و
 * اکثر نقشه‌های سه‌بعدی واقعی از آن استفاده می‌کنند، پس نتیجه به‌طور طبیعی بسیار نزدیک‌تر است.
 */
const TERRAIN_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
// تصویر ماهواره‌ای پیش‌فرض/بازگشتی وقتی Sentinel Hub تنظیم نشده — رایگان، بدون نیاز به کلید،
// و تصویرش خیلی شبیه به‌همان چیزی‌ست که در گوگل‌ارث/گوگل‌مپ دیده می‌شود.
const ESRI_SATELLITE_TILES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];

/**
 * اگر Copernicus (Sentinel Hub) از قبل در پنل «پایش ماهواره‌ای» تنظیم شده باشد، همان تصویر
 * رنگ‌طبیعیِ واقعیِ محدوده را (نه یک بافت عمومی) به‌عنوان یک لایه‌ی image روی همان bbox دقیق
 * می‌گذاریم — کیفیت و به‌روزی بیشتری نسبت به کاشی‌های عمومی Esri دارد.
 */
async function fetchSatelliteImageUrl(bbox) {
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
    return null;
  }
}

/**
 * مدل سه‌بعدی توپوگرافی محدوده‌ی یک معدن را در یک مودال باز می‌کند.
 */
export function open3DTerrainModal(record, nameField) {
  const mineName = record[nameField] || '—';
  const corners = getMineCorners(record);
  const bbox = getMineBBox(corners, record._lat, record._lon);
  if (!bbox) { showToast('⚠️ این رکورد مختصات ثبت‌شده ندارد'); return; }
  const [west, south, east, north] = bbox;

  const { body, overlay } = openModal({ title: `🗻 مدل سه‌بعدی توپوگرافی — ${mineName}`, width: '90vw' });
  const mapHost = el('div', { style: 'width:100%;height:70vh;border-radius:var(--radius-md);overflow:hidden;background:var(--stone-200)' });
  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, '⏳ در حال بارگذاری نقشه و مدل زمین...');
  const hint = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:4px' },
    'برای چرخش دیدِ سه‌بعدی: Ctrl+بکشید (یا دو انگشتی روی موبایل)؛ برای زوم: اسکرول کنید.');
  body.append(mapHost, statusLine, hint);

  let exaggeration = 1; // ۱ = مقیاس واقعی، مثل گوگل‌ارث پیش‌فرض
  const exagLevels = ['1', '1.5', '2.5'];
  const exagButtons = exagLevels.map((n) => el('button', {
    class: `btn-sm${n === '1' ? '' : ' btn-ghost'}`,
    onclick: () => {
      exaggeration = Number(n);
      map.setTerrain({ source: 'terrainSource', exaggeration });
      exagButtons.forEach((b, i) => { b.className = `btn-sm${exagLevels[i] === n ? '' : ' btn-ghost'}`; });
    },
  }, `×${n}`));
  body.append(el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:8px;font-size:var(--text-xs);color:var(--stone-600)' }, [
    'اغراق ارتفاع (۱× = مقیاس واقعی، مثل گوگل‌ارث):', ...exagButtons,
  ]));

  const style = {
    version: 8,
    sources: {
      satellite: {
        type: 'raster', tiles: ESRI_SATELLITE_TILES, tileSize: 256, attribution: '© Esri World Imagery',
      },
      terrainSource: {
        // نکته‌ی مهم: کاشی‌های Terrarium بالاتر از زوم ۱۳ اصلاً وجود ندارند — اگر maxzoom بالاتر
        // تنظیم شود، MapLibre مستقیم درخواست z14/z15 می‌فرستد که ۴۰۴ برمی‌گردد و باعث می‌شد
        // زمین سه‌بعدی اصلاً فعال نشود (دقیقاً همان چیزی که باعث افتادن به نمای دوبعدی می‌شد).
        // با maxzoom:13، خودِ MapLibre از کاشی‌های زوم ۱۳ به‌صورت بزرگ‌نمایی‌شده (oversample)
        // استفاده می‌کند.
        type: 'raster-dem', tiles: TERRAIN_TILES, tileSize: 256, encoding: 'terrarium', maxzoom: 13,
      },
    },
    layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite' }],
    // عمداً terrain این‌جا در استایل اولیه تنظیم نمی‌شود — اگر منبع ارتفاع (DEM) هر مشکلی داشته
    // باشد (شبکه/CORS/...)، نباید کل نقشه‌ی پایه هم به‌خاطرش گیر کند؛ بعد از «load» جداگانه با
    // setTerrain اضافه می‌شود، تا حداقل تصویر ماهواره‌ای مسطح همیشه دیده شود.
  };

  const map = new MapLibreMap({
    container: mapHost,
    style,
    center: [(west + east) / 2, (south + north) / 2],
    zoom: 14,
    pitch: 0,
    bearing: -20,
    antialias: true,
    attributionControl: false,
  });
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');
  map.addControl(new AttributionControl({ compact: true }));

  let disposed = false;
  let hasBoundaryLayer = false;
  let terrainApplied = false;

  const loadTimeout = setTimeout(() => {
    if (!disposed && !map.loaded()) {
      statusLine.textContent = '⚠️ بارگذاری بیش از حد معمول طول کشید — احتمالاً اتصال شبکه یا یکی از سرویس‌های نقشه/ارتفاع در دسترس نیست. لطفاً اتصال اینترنت را چک کنید یا بعداً دوباره امتحان کنید.';
    }
  }, 18000);

  map.on('load', () => {
    if (disposed) return;
    clearTimeout(loadTimeout);
    map.fitBounds([[west, south], [east, north]], { padding: 24, duration: 0 });

    if (corners.length >= 3) {
      const coords = corners.map(([lat, lon]) => [lon, lat]);
      coords.push(coords[0]);
      map.addSource('boundary', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
      });
      map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#ff5722', 'line-width': 3 } });
      hasBoundaryLayer = true;
    }

    statusLine.textContent = '✅ نقشه‌ی پایه آماده شد — در حال فعال‌سازی زمین سه‌بعدی...';
    // اگر بارگذاری کاشی‌های ارتفاع (DEM) گیر کند یا خطا بدهد، بعد از چند ثانیه بی‌صدا رها می‌کنیم
    // و کاربر همچنان نقشه‌ی مسطح (ماهواره + محدوده) را می‌بیند، نه یک صفحه‌ی خالیِ گیرکرده.
    const terrainTimeout = setTimeout(() => {
      if (!disposed && !terrainApplied) statusLine.textContent = '⚠️ نقشه آماده است، ولی زمین سه‌بعدی بارگذاری نشد (مشکل شبکه/سرویس ارتفاع) — نمای مسطح نمایش داده می‌شود.';
    }, 20000);
    try {
      map.setTerrain({ source: 'terrainSource', exaggeration });
      map.setPitch(65);
      terrainApplied = true;
      clearTimeout(terrainTimeout);
      statusLine.textContent = '✅ آماده — در حال تلاش برای دریافت تصویر ماهواره‌ای دقیق‌تر (Sentinel Hub)...';
    } catch (err) {
      clearTimeout(terrainTimeout);
      statusLine.textContent = `⚠️ زمین سه‌بعدی فعال نشد (${err.message}) — نمای مسطح نمایش داده می‌شود.`;
    }

    fetchSatelliteImageUrl(bbox).then((url) => {
      if (disposed) return;
      if (!url) {
        if (terrainApplied) statusLine.textContent = '✅ آماده (تصویر پس‌زمینه: Esri — برای تصویر دقیق‌تر Sentinel Hub را از پنل «پایش ماهواره‌ای» تنظیم کنید)';
        return;
      }
      map.addSource('sentinel-overlay', {
        type: 'image',
        url,
        coordinates: [[west, north], [east, north], [east, south], [west, south]],
      });
      map.addLayer({ id: 'sentinel-layer', type: 'raster', source: 'sentinel-overlay' }, hasBoundaryLayer ? 'boundary-line' : undefined);
      statusLine.textContent = '✅ تصویر ماهواره‌ای واقعی (Sentinel Hub) بارگذاری شد';
    });
  });

  map.on('error', (e) => {
    const msg = e && e.error && e.error.message ? e.error.message : '';
    // بعضی کاشی‌های لبه‌ی محدوده ممکن است ۴۰۴ بدهند (خارج از پوشش) — این‌ها را نادیده می‌گیریم و
    // فقط خطاهای واقعی/مسدودکننده را به کاربر نشان می‌دهیم (نه فقط در کنسول، که کاربر نمی‌بیند).
    if (msg.includes('404')) return;
    if (!disposed && !map.loaded()) {
      statusLine.textContent = `❌ خطا در بارگذاری نقشه: ${msg || 'نامشخص'}`;
    }
    // eslint-disable-next-line no-console
    console.warn('نقشه‌ی سه‌بعدی: خطا', e);
  });

  // پاک‌سازی وقتی مودال بسته می‌شود
  const observer = new MutationObserver(() => {
    if (!document.body.contains(overlay)) {
      disposed = true;
      map.remove();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

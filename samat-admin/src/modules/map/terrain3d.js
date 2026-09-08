import { Map as MapLibreMap, NavigationControl, AttributionControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// خودِ maplibre-gl در زمان اجرا آدرس اسکریپت Worker خودش (maplibre-gl-worker.mjs) را با
// import.meta.url نسبی به فایل خودش می‌سازد. این الگو برای Vite قابل تشخیص نیست (نه در dev که
// dependency pre-bundling می‌کند و نه در build که فقط import های استاتیک را دنبال می‌کند)، پس این
// فایل هیچ‌وقت کپی/سرو نمی‌شود و درخواستش ۴۰۴ می‌خورد — نتیجه: DEM هیچ‌وقت روی Worker دیکد
// نمی‌شود، پس setTerrain ظاهراً موفق است ولی نتیجه‌اش یک نقشه‌ی کاملاً مسطح (۲بعدی) است، نه خطا.
// ⚠️ این fix قبلاً یک‌بار در کامیت 22df63e اضافه شده بود ولی در یک کامیت بعدی از سشن موازی
// (ef9de2c) به‌طور ناخواسته حذف شد — لطفاً این import و خط setWorkerUrl زیر را در ادیت‌های بعدیِ
// این فایل حفظ کنید.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { el, showToast, openModal } from '../../lib/dom.js';
import { getMineCorners } from '../../lib/geo.js';
import {
  getMineBBox, checkCopernicusStatus, getCopernicusToken, fetchSentinelImage, SAT_LAYERS,
} from '../../lib/sentinelHub.js';

setWorkerUrl(maplibreWorkerUrl);

/**
 * قبلاً این ماژول با Three.js دستی یک صفحه‌ی مربع می‌ساخت و ارتفاع را با یک ضریب اغراقِ کور
 * می‌کشید — نتیجه هیچ ربطی به شکل/مقیاس واقعی زمین نداشت. maplibre-gl از قبل در package.json
 * این پروژه بود (حتی کامنت قدیمی terrain3dPage.js به «سنگین بودن MapLibre GL JS» اشاره می‌کرد)
 * ولی هیچ‌جا واقعاً استفاده نشده بود. حالا از موتور واقعی نقشه با terrain سه‌بعدیِ بومی
 * (raster-dem + camera pitch/bearing واقعی) استفاده می‌کنیم — دقیقاً همان روشی که گوگل‌ارث و
 * اکثر نقشه‌های سه‌بعدی واقعی از آن استفاده می‌کنند، پس نتیجه به‌طور طبیعی بسیار نزدیک‌تر است.
 */
// دو منبع کاشیِ ارتفاع (DEM) برای مقایسه‌ی مستقیم کنار هم: هر دو استاندارد Terrarium (بدون کلید)،
// ولی روی زیرساخت‌های متفاوت میزبانی می‌شوند — چون سرویس‌های آمریکایی مثل AWS/Esri معمولاً از
// ایران فیلتر/مسدودند، Mapterhorn (زیرساخت جدا، پروژه‌ی متن‌باز NLnet) شانس بهتری برای در دسترس
// بودن دارد؛ ولی چون از قبل مطمئن نیستیم، دکمه‌ی تعویض گذاشته‌ایم تا در محل واقعی کاربر تست/مقایسه شود.
const DEM_SOURCES = {
  mapterhorn: {
    label: 'Mapterhorn',
    tiles: ['https://tiles.mapterhorn.com/terrarium/{z}/{x}/{y}.webp'],
    tileSize: 512,
  },
  aws: {
    label: 'AWS (Terrarium)',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    tileSize: 256,
  },
};
const DEFAULT_DEM_KEY = 'mapterhorn';
// کاشی‌های Terrarium (هر دو منبع) بالاتر از این زوم پوشش ندارند — اگر maxzoom بالاتر تنظیم شود،
// MapLibre مستقیم درخواست زوم بالاتر می‌فرستد که ۴۰۴ برمی‌گردد و باعث می‌شد زمین سه‌بعدی اصلاً
// فعال نشود (دقیقاً همان چیزی که باعث افتادن به نمای دوبعدی می‌شد). MapLibre خودش از کاشی‌های این
// زوم به‌صورت بزرگ‌نمایی‌شده (oversample) برای زوم‌های بالاتر استفاده می‌کند.
const DEM_MAXZOOM = 13;
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

  // دکمه‌ی تعویض منبع کاشی ارتفاع (DEM) — برای مقایسه‌ی مستقیم AWS در برابر Mapterhorn، مخصوصاً
  // چون ممکن است یکی از این دو از ایران در دسترس نباشد و باید در محل واقعی تست شود.
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
  body.append(el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:4px;font-size:var(--text-xs);color:var(--stone-600)' }, [
    'منبع داده‌ی ارتفاع (برای مقایسه):', ...demButtons,
  ]));

  const style = {
    version: 8,
    sources: {
      satellite: {
        type: 'raster', tiles: ESRI_SATELLITE_TILES, tileSize: 256, attribution: '© Esri World Imagery',
      },
      terrainSource: {
        type: 'raster-dem',
        tiles: DEM_SOURCES[demKey].tiles,
        tileSize: DEM_SOURCES[demKey].tileSize,
        encoding: 'terrarium',
        maxzoom: DEM_MAXZOOM,
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

  /**
   * تعویض زنده‌ی منبع ارتفاع بدون بستن مودال — چون MapLibre اجازه‌ی عوض کردن tileSize یک منبع
   * موجود را با setTiles نمی‌دهد (فقط آدرس تایل‌ها را عوض می‌کند، نه اندازه‌شان)، و دو منبع ما
   * tileSize متفاوت دارند (۲۵۶ در برابر ۵۱۲)، ساده‌ترین و مطمئن‌ترین راه این است که کل
   * terrainSource را حذف و با تنظیمات جدید دوباره اضافه کنیم.
   */
  function switchDemSource(key) {
    if (disposed) return;
    statusLine.textContent = `⏳ در حال تعویض منبع ارتفاع به ${DEM_SOURCES[key].label}...`;
    terrainApplied = false;
    try {
      map.setTerrain(null);
      if (map.getSource('terrainSource')) map.removeSource('terrainSource');
      map.addSource('terrainSource', {
        type: 'raster-dem',
        tiles: DEM_SOURCES[key].tiles,
        tileSize: DEM_SOURCES[key].tileSize,
        encoding: 'terrarium',
        maxzoom: DEM_MAXZOOM,
      });
      map.setTerrain({ source: 'terrainSource', exaggeration });
      terrainApplied = true;
      const switchTimeout = setTimeout(() => {
        if (!disposed && demKey === key) {
          statusLine.textContent = `⚠️ منبع «${DEM_SOURCES[key].label}» بعد از چند ثانیه هنوز کاشی نداده — احتمالاً این سرویس هم از اینجا در دسترس نیست.`;
        }
      }, 12000);
      map.once('idle', () => { clearTimeout(switchTimeout); if (!disposed && demKey === key) statusLine.textContent = `✅ منبع ارتفاع «${DEM_SOURCES[key].label}» فعال شد`; });
    } catch (err) {
      statusLine.textContent = `❌ منبع «${DEM_SOURCES[key].label}» فعال نشد (${err.message})`;
    }
  }

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

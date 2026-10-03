// لایه‌ی تصویر ماهواره‌ای زیر مدل سه‌بعدی پهباد — فقط منطق خالص (بدون DOM و بدون THREE) تا جداگانه تست شود.
//
// روش: کاشی‌های Web-Mercator (۲۵۶ پیکسلی، همان Esri World Imagery که نقشه‌ی سه‌بعدی و حجم‌گیری اپ هم استفاده می‌کنند)
// پوشش‌دهنده‌ی محدوده‌ی مدل (به‌علاوه‌ی حاشیه) را می‌گیریم و به یک بوم می‌چسبانیم. سپس یک صفحه‌ی شبکه‌ای در دستگاه ENU
// (همان دستگاه تحلیل‌ها) می‌سازیم که UV هر رأسش از طول/عرض جغرافیایی واقعیِ همان رأس به پیکسل کاشی‌ها می‌رود؛
// چون نگاشت رأس‌به‌رأس است، اختلاف شبکه‌ی UTM و مرکاتور (چرخش و کشیدگی کوچک) دقیقاً لحاظ می‌شود.
//
// ⚠️ محدودیت‌های صادقانه: (۱) وضوح این تصویر متری است و از عکس پهباد (سانتی‌متری) خیلی کم‌جزئیات‌تر است؛ برای
// زمینه و مکان‌یابی است نه اندازه‌گیری. (۲) تاریخ عکس‌های Esri معلوم نیست و ممکن است قدیمی‌تر از وضعیت فعلی معدن باشد.
// (۳) صفحه‌ی ماهواره‌ای تخت و زیر پایین‌ترین نقطه‌ی مدل است، نه روی زمین واقعی. (۴) برخی مناطق در زوم‌های بالا پوشش
// ندارند (Esri کاشی خاکستری «داده در دسترس نیست» می‌دهد)؛ با «جزئیات» کمتر امتحان کنید.

export const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_ATTRIBUTION = '© Esri World Imagery';
export const TILE_SIZE = 256;
export const MAX_ZOOM = 18;
export const MIN_ZOOM = 6;
export const MAX_TILES_PER_SIDE = 12; // بوم حداکثر ۳۰۷۲ پیکسل — روی موبایل‌های معمولی امن است

/** سطح «جزئیات»: سقف تعداد کاشی (دانلود/حافظه) */
export const DETAIL_LEVELS = {
  low: { label: 'کم (سریع)', maxTiles: 12 },
  medium: { label: 'متوسط', maxTiles: 30 },
  high: { label: 'زیاد (کندتر)', maxTiles: 70 },
};

const MAX_LAT = 85.0511287798;
const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/** پیکسل سراسری Web-Mercator در زوم z (مبدأ: گوشه‌ی بالا-چپ نقشه‌ی جهان) */
export function lonLatToPixel(lon, lat, z) {
  const scale = TILE_SIZE * 2 ** z;
  const rad = (clampLat(lat) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale,
  };
}

export function tileUrl(template, z, x, y) {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** تعداد کاشی‌های لازم برای محدوده‌ی lat/lon در زوم z */
export function tileRange(bounds, z) {
  const a = lonLatToPixel(bounds.minLon, bounds.maxLat, z); // بالا-چپ
  const b = lonLatToPixel(bounds.maxLon, bounds.minLat, z); // پایین-راست
  const x0 = Math.floor(a.x / TILE_SIZE);
  const y0 = Math.floor(a.y / TILE_SIZE);
  const x1 = Math.floor(b.x / TILE_SIZE);
  const y1 = Math.floor(b.y / TILE_SIZE);
  return {
    x0, y0, nx: x1 - x0 + 1, ny: y1 - y0 + 1,
  };
}

/** بالاترین زومی که تعداد کاشی‌هایش از سقف نگذرد (و هر ضلع از MAX_TILES_PER_SIDE) */
export function pickZoom(bounds, maxTiles, { maxZoom = MAX_ZOOM, minZoom = MIN_ZOOM } = {}) {
  for (let z = maxZoom; z >= minZoom; z -= 1) {
    const r = tileRange(bounds, z);
    if (r.nx * r.ny <= maxTiles && r.nx <= MAX_TILES_PER_SIDE && r.ny <= MAX_TILES_PER_SIDE) return z;
  }
  return minZoom;
}

/**
 * برنامه‌ی کاشی‌ها برای یک مدل.
 * @param {{ minE:number, maxE:number, minN:number, maxN:number }} bboxEnu محدوده‌ی مدل (ENU محلی، متر)
 * @param {(e:number, n:number) => {lat:number, lon:number}} toLatLon تبدیل ENU محلی → طول/عرض جغرافیایی
 * @param {{ padRatio?: number, minPad?: number, maxTiles?: number, maxZoom?: number }} [opts]
 * @returns {{ z:number, x0:number, y0:number, nx:number, ny:number, widthPx:number, heightPx:number,
 *             tiles:Array<{x:number,y:number,col:number,row:number}>,
 *             extentEnu:{minE:number,maxE:number,minN:number,maxN:number}, bounds:object }}
 */
export function planSatellite(bboxEnu, toLatLon, {
  padRatio = 0.6, minPad = 100, maxTiles = DETAIL_LEVELS.medium.maxTiles, maxZoom = MAX_ZOOM,
} = {}) {
  const dE = bboxEnu.maxE - bboxEnu.minE;
  const dN = bboxEnu.maxN - bboxEnu.minN;
  if (!(dE > 0) || !(dN > 0)) throw new Error('محدوده‌ی مدل نامعتبر است');
  const pad = Math.max(minPad, padRatio * Math.max(dE, dN));
  const extentEnu = {
    minE: bboxEnu.minE - pad, maxE: bboxEnu.maxE + pad, minN: bboxEnu.minN - pad, maxN: bboxEnu.maxN + pad,
  };
  const corners = [
    [extentEnu.minE, extentEnu.minN], [extentEnu.maxE, extentEnu.minN],
    [extentEnu.maxE, extentEnu.maxN], [extentEnu.minE, extentEnu.maxN],
  ].map(([e, n]) => toLatLon(e, n));
  if (corners.some((c) => !Number.isFinite(c.lat) || !Number.isFinite(c.lon))) throw new Error('تبدیل مختصات ناموفق بود');
  const bounds = {
    minLat: Math.min(...corners.map((c) => c.lat)),
    maxLat: Math.max(...corners.map((c) => c.lat)),
    minLon: Math.min(...corners.map((c) => c.lon)),
    maxLon: Math.max(...corners.map((c) => c.lon)),
  };
  const z = pickZoom(bounds, maxTiles, { maxZoom });
  const {
    x0, y0, nx, ny,
  } = tileRange(bounds, z);
  const tiles = [];
  for (let row = 0; row < ny; row += 1) {
    for (let col = 0; col < nx; col += 1) tiles.push({ x: x0 + col, y: y0 + row, col, row });
  }
  return {
    z, x0, y0, nx, ny, widthPx: nx * TILE_SIZE, heightPx: ny * TILE_SIZE, tiles, extentEnu, bounds,
  };
}

/** UV (u: چپ→راست، v: پایین→بالا مثل THREE با flipY) برای نقطه‌ی lat/lon روی بوم برنامه */
export function latLonToUv(plan, lat, lon) {
  const p = lonLatToPixel(lon, lat, plan.z);
  return {
    u: (p.x - plan.x0 * TILE_SIZE) / plan.widthPx,
    v: 1 - (p.y - plan.y0 * TILE_SIZE) / plan.heightPx,
  };
}

/**
 * شبکه‌ی صفحه (segments×segments) روی extentEnu در ارتفاع u (ENU)، با UV از نگاشت رأس‌به‌رأس.
 * @returns {{ positions: Float32Array, uvs: Float32Array, indices: Uint32Array }} positions به‌صورت ENU (e,n,u)
 */
export function buildSatelliteGrid(plan, toLatLon, elevation, segments = 24) {
  const { extentEnu: ex } = plan;
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j += 1) {
    const nn = ex.minN + ((ex.maxN - ex.minN) * j) / segments;
    for (let i = 0; i < n; i += 1) {
      const e = ex.minE + ((ex.maxE - ex.minE) * i) / segments;
      const k = j * n + i;
      positions[k * 3] = e; positions[k * 3 + 1] = nn; positions[k * 3 + 2] = elevation;
      const ll = toLatLon(e, nn);
      const uv = latLonToUv(plan, ll.lat, ll.lon);
      uvs[k * 2] = uv.u; uvs[k * 2 + 1] = uv.v;
    }
  }
  const indices = new Uint32Array(segments * segments * 6);
  let t = 0;
  for (let j = 0; j < segments; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
      indices[t] = a; indices[t + 1] = b; indices[t + 2] = d;
      indices[t + 3] = a; indices[t + 4] = d; indices[t + 5] = c;
      t += 6;
    }
  }
  return { positions, uvs, indices };
}

/**
 * کاشی‌ها را با هم‌زمانیِ محدود می‌گیرد و هرکدام را با drawTile روی بوم می‌گذارد.
 * هیچ کاشیِ ناموفقی کل کار را نمی‌اندازد؛ نتیجه شمار موفق/ناموفق است تا رابط کاربری صادقانه گزارش کند.
 * @param {object} plan خروجی planSatellite
 * @param {(tile:{x:number,y:number,col:number,row:number,url:string}) => Promise<any>} fetchTile تصویر کاشی را می‌گیرد (یا reject)
 * @param {(image:any, col:number, row:number) => void} drawTile
 * @param {{ template?: string, concurrency?: number, signal?: {aborted:boolean}, onProgress?: (done:number,total:number)=>void }} [opts]
 * @returns {Promise<{ ok:number, failed:number, total:number, aborted:boolean }>}
 */
export async function loadSatelliteTiles(plan, fetchTile, drawTile, {
  template = SATELLITE_TILE_URL, concurrency = 6, signal = { aborted: false }, onProgress = () => {},
} = {}) {
  const queue = plan.tiles.map((t) => ({ ...t, url: tileUrl(template, plan.z, t.x, t.y) }));
  const total = queue.length;
  let ok = 0; let failed = 0; let done = 0; let next = 0;
  async function worker() {
    while (next < queue.length && !signal.aborted) {
      const tile = queue[next]; next += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        const image = await fetchTile(tile);
        if (signal.aborted) return;
        drawTile(image, tile.col, tile.row);
        ok += 1;
      } catch {
        failed += 1;
      }
      done += 1;
      onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return {
    ok, failed, total, aborted: !!signal.aborted,
  };
}

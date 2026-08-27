import L from 'leaflet';
import { getCachedTile, putCachedTile } from './tileCache.js';

/**
 * لایه‌ی کاشی نقشه با کش IndexedDB: ابتدا از شبکه می‌گیرد (و در پس‌زمینه در کش ذخیره می‌کند)،
 * و اگر شبکه در دسترس نبود (سایت معدنی بدون آنتن)، همان کاشی که قبلاً یک‌بار دیده شده را از
 * کش نشان می‌دهد. برای سایت‌هایی که مسئول فنی مرتب سر می‌زند، بعد از اولین بازدید (با اینترنت)
 * دفعات بعد نقشه حتی بدون آنتن هم لود می‌شود.
 */
const CachedTileLayer = L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement('img');
    img.alt = '';
    const url = this.getTileUrl(coords);

    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('bad-status');
        const blob = await res.blob();
        img.src = URL.createObjectURL(blob);
        putCachedTile(url, blob); // best-effort، منتظرش نمی‌مانیم تا نمایش کاشی کند نشود
        done(null, img);
      } catch {
        const cached = await getCachedTile(url);
        if (cached) {
          img.src = URL.createObjectURL(cached.blob);
          done(null, img);
        } else {
          done(new Error('offline-and-not-cached'), img);
        }
      }
    })();

    return img;
  },
});

export function cachedTileLayer(urlTemplate, options) {
  return new CachedTileLayer(urlTemplate, options);
}

function lonToTileX(lon, z) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

/**
 * همه‌ی کاشی‌های یک محدوده (bbox) را در چند سطح زوم از قبل دانلود و در کش ذخیره می‌کند —
 * برای اینکه مسئول فنی قبل از رفتن به سایتی که آنتن ندارد، نقشه‌اش را (وقتی هنوز اینترنت دارد)
 * از قبل آماده کند، نه اینکه فقط منتظر بماند تا هر کاشی یک‌بار اتفاقی دیده شود.
 * @param {{minLat,maxLat,minLon,maxLon}} bounds
 * @param {(done:number, total:number) => void} onProgress
 */
export async function prefetchTilesForBounds(urlTemplate, bounds, onProgress) {
  const subdomains = ['0', '1', '2', '3'];
  const zooms = [14, 15, 16, 17, 18];
  const tiles = [];
  zooms.forEach((z) => {
    const x1 = lonToTileX(bounds.minLon, z); const x2 = lonToTileX(bounds.maxLon, z);
    const y1 = latToTileY(bounds.maxLat, z); const y2 = latToTileY(bounds.minLat, z);
    for (let x = Math.min(x1, x2) - 1; x <= Math.max(x1, x2) + 1; x++) {
      for (let y = Math.min(y1, y2) - 1; y <= Math.max(y1, y2) + 1; y++) {
        tiles.push({ x, y, z });
      }
    }
  });

  let done = 0;
  const CONCURRENCY = 6;
  let cursor = 0;
  async function worker() {
    while (cursor < tiles.length) {
      const { x, y, z } = tiles[cursor++];
      const s = subdomains[(x + y) % subdomains.length];
      const url = urlTemplate.replace('{s}', s).replace('{z}', z).replace('{x}', x).replace('{y}', y);
      try {
        const cached = await getCachedTile(url);
        if (!cached) {
          const res = await fetch(url);
          if (res.ok) await putCachedTile(url, await res.blob());
        }
      } catch {
        // یک کاشی ناموفق نباید کل پیش‌دانلود را متوقف کند
      }
      done++;
      onProgress?.(done, tiles.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

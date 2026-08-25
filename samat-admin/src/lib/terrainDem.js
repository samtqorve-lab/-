// دیکود مدل ارتفاعی زمین (DEM) — دو منبع پشتیبانی می‌شود: کاشی‌های عمومی/رایگان Terrarium
// (بدون نیاز به احراز هویت) و Copernicus DEM GLO-30 معتبرتر از طریق Sentinel Hub (نیازمند
// همان Client ID/Secret که برای تصاویر ماهواره‌ای ذخیره شده). فرمت رمزگذاری ارتفاع در هر دو یکسان
// است: ارتفاع (متر) = (R×256 + G + B/256) − 32768

import { fetchSentinelImage, SAT_EVALSCRIPT_DEM_TERRARIUM } from './sentinelHub.js';

const TILE_SIZE = 256;
const TERRARIUM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

function lon2tileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * (2 ** z));
}
function lat2tileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * (2 ** z));
}

function decodeTerrariumPixel(r, g, b) {
  return (r * 256 + g + b / 256) - 32768;
}

/**
 * همان نتیجه‌ی fetchElevationGrid را می‌دهد، ولی از Copernicus DEM GLO-30 (ماموریت TanDEM-X)
 * از طریق Sentinel Hub می‌گیرد — نیازمند Client ID/Secret ذخیره‌شده در پنل «پایش ماهواره‌ای»
 * است (همان که برای تصاویر ماهواره‌ای استفاده می‌شود). چون Process API تصویر را دقیقاً به اندازه‌ی
 * gridSize×gridSize و منطبق بر bbox درخواستی برمی‌گرداند، برخلاف مسیر رایگان (fetchElevationGrid)
 * نیازی به کاشی‌بندی/نمونه‌برداری نیست — هر پیکسل مستقیماً یک نقطه‌ی شبکه است.
 * @returns {Promise<{grid: Float32Array, gridSize: number, minElev: number, maxElev: number}>}
 */
export async function fetchElevationGridSentinelHub(token, bbox, gridSize = 64) {
  const today = new Date();
  const dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
  const blob = await fetchSentinelImage(token, bbox, dateStr, SAT_EVALSCRIPT_DEM_TERRARIUM, gridSize, gridSize, 'dem', 15);

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('دیکود تصویر ارتفاعی TanDEM-X ناموفق بود'));
    image.src = URL.createObjectURL(blob);
  });
  const canvas = document.createElement('canvas');
  canvas.width = gridSize; canvas.height = gridSize;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, gridSize, gridSize);

  const grid = new Float32Array(gridSize * gridSize);
  let minElev = Infinity; let maxElev = -Infinity;
  for (let i = 0; i < gridSize * gridSize; i++) {
    const elev = decodeTerrariumPixel(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    grid[i] = elev;
    if (elev < minElev) minElev = elev;
    if (elev > maxElev) maxElev = elev;
  }
  return { grid, gridSize, minElev, maxElev };
}

async function loadTileElevations(z, x, y) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`کاشی ارتفاعی (${z}/${x}/${y}) در دسترس نبود`));
    img.src = TERRARIUM_URL(z, x, y);
  });
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE; canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const elevations = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    elevations[i] = decodeTerrariumPixel(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  return elevations;
}

/**
 * برای یک bbox (همان قالب [west, south, east, north] که در getMineBBox استفاده می‌شود)، یک شبکه‌ی
 * ارتفاع gridSize×gridSize می‌سازد. چون محدوده‌ی هر معدن معمولاً کوچک‌تر از یک کاشی است، zoom ثابت
 * ۱۳ (وضوح ~۱۰ متر) به‌کار می‌رود که برای نمایش شکل کلی زمین کافی و برای این حجم دانلود منطقی است.
 * @returns {Promise<{grid: Float32Array, gridSize: number, minElev: number, maxElev: number}>}
 */
export async function fetchElevationGrid(bbox, gridSize = 64) {
  const [west, south, east, north] = bbox;
  const zoom = 13;
  const txMin = lon2tileX(west, zoom);
  const txMax = lon2tileX(east, zoom);
  const tyMin = lat2tileY(north, zoom);
  const tyMax = lat2tileY(south, zoom);

  const tileCache = new Map();
  async function getTile(tx, ty) {
    const key = `${tx}_${ty}`;
    if (!tileCache.has(key)) tileCache.set(key, loadTileElevations(zoom, tx, ty));
    return tileCache.get(key);
  }

  function tileXYFromLonLat(lon, lat) {
    const n = 2 ** zoom;
    const xf = ((lon + 180) / 360) * n;
    const rad = (lat * Math.PI) / 180;
    const yf = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    return { xf, yf };
  }

  const grid = new Float32Array(gridSize * gridSize);
  let minElev = Infinity; let maxElev = -Infinity;

  // eslint-disable-next-line no-restricted-syntax
  for (let row = 0; row < gridSize; row++) {
    const lat = north - ((north - south) * row) / (gridSize - 1);
    // eslint-disable-next-line no-restricted-syntax
    for (let col = 0; col < gridSize; col++) {
      const lon = west + ((east - west) * col) / (gridSize - 1);
      const { xf, yf } = tileXYFromLonLat(lon, lat);
      const tx = Math.floor(xf); const ty = Math.floor(yf);
      const px = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((xf - tx) * TILE_SIZE)));
      const py = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((yf - ty) * TILE_SIZE)));
      // eslint-disable-next-line no-await-in-loop
      const tileData = await getTile(Math.max(txMin, Math.min(txMax, tx)), Math.max(tyMin, Math.min(tyMax, ty)));
      const elev = tileData[py * TILE_SIZE + px];
      grid[row * gridSize + col] = elev;
      if (elev < minElev) minElev = elev;
      if (elev > maxElev) maxElev = elev;
    }
  }
  return { grid, gridSize, minElev, maxElev };
}

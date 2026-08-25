import { sb } from './supabase.js';

const SENTINEL_PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sentinel-proxy`;

// نکته‌ی امنیتی: باید توکن نشست واقعی کاربر (نه کلید anon) فرستاده شود، چون سرور با همین توکن
// هویت و نقش ادمین را تایید می‌کند (requireAdmin).
async function getAuthBearer() {
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.access_token : import.meta.env.VITE_SUPABASE_ANON_KEY;
}

async function callProxy(body) {
  const jwt = await getAuthBearer();
  const res = await fetch(SENTINEL_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
  return res;
}

export async function checkCopernicusStatus() {
  try {
    const res = await callProxy({ action: 'status' });
    const data = await res.json().catch(() => ({}));
    return data && data.configured ? { configured: true, clientId: data.clientId || '' } : { configured: false };
  } catch {
    return { configured: false, unreachable: true };
  }
}

/** ذخیره‌سازی از طریق تابع واسط سرور انجام می‌شود — نه insert مستقیم کلاینت — تا secret هرگز با کلید anon قابل خواندن نباشد */
export async function saveCopernicusCreds(clientId, clientSecret) {
  const res = await callProxy({ action: 'save', clientId, clientSecret });
  if (!res.ok) throw new Error('ذخیره‌سازی ناموفق بود — Client ID/Secret را بررسی کنید');
}

export async function getCopernicusToken(clientId, clientSecret) {
  let res;
  try {
    res = await callProxy({ action: 'token', clientId, clientSecret });
  } catch {
    throw new Error('اتصال به تابع واسط (sentinel-proxy) برقرار نشد — مطمئن شوید این Edge Function در Supabase دیپلوی شده');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`احراز هویت ناموفق بود — Client ID/Secret را بررسی کنید (کد ${res.status})`);
  return data.access_token;
}

export async function fetchSentinelImage(token, bbox, dateStr, evalscript, width, height, collection, dayWindow) {
  const res = await callProxy({
    action: 'image', token, bbox, date: dateStr, evalscript, width, height, collection: collection || 'sentinel-2-l2a', dayWindow: dayWindow || 15,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`خطا در دریافت تصویر (کد ${res.status}). ممکن است تصویر/گذر مناسبی در این بازه تاریخ موجود نباشد. ${txt.slice(0, 200)}`);
  }
  return res.blob();
}

export async function searchActualDate(token, bbox, dateStr, collection, dayWindow) {
  try {
    const res = await callProxy({ action: 'search', token, bbox, date: dateStr, collection: collection || 'sentinel-2-l2a', dayWindow: dayWindow || 15 });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && data.found ? data : null; // {actualDate, cloudCover, daysOff}
  } catch {
    return null;
  }
}

export function getMineBBox(corners, fallbackLat, fallbackLon) {
  if (corners.length >= 3) {
    let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
    corners.forEach(([lat, lon]) => {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    });
    const padLat = Math.max((maxLat - minLat) * 0.3, 0.002);
    const padLon = Math.max((maxLon - minLon) * 0.3, 0.002);
    return [minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat];
  }
  if (fallbackLat && fallbackLon) {
    const pad = 0.004;
    return [fallbackLon - pad, fallbackLat - pad, fallbackLon + pad, fallbackLat + pad];
  }
  return null;
}

export const SAT_EVALSCRIPT_TRUECOLOR = `//VERSION=3
function setup() { return { input: ["B02","B03","B04"], output: { bands: 3 } }; }
function evaluatePixel(s) { return [2.5*s.B04, 2.5*s.B03, 2.5*s.B02]; }`;

// باند SCL برای حذف پیکسل‌های ابر/سایه/برف از محاسبه — بدون این کار، پیکسل‌های ابری
// به‌اشتباه به‌عنوان «تغییر پوشش گیاهی» شناسایی می‌شدند و دقت را به‌شدت پایین می‌آوردند.
// نکته: این نسخه برای نمایش انسانی رنگی شده (قهوه‌ای←زرد←سبز) — نسخه‌ی خام تک‌کاناله (برای
// تحلیل عددی خودکار) به‌صورت جدا و مستقل داخل Edge Function «boundary-monitor» نگه‌داری می‌شود
// و به این فایل وابسته نیست، پس این تغییر رنگی روی پایش خودکار مرزی هیچ اثری ندارد.
export const SAT_EVALSCRIPT_NDVI = `//VERSION=3
function setup() { return { input: [{bands:["B04","B08","SCL"]}], output: { bands: 4 } }; }
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 0.0001);
  let cloudLike = (s.SCL===3 || s.SCL===8 || s.SCL===9 || s.SCL===10 || s.SCL===11);
  if (cloudLike) return [0.55, 0.55, 0.55, 0];
  let r, g, b;
  if (ndvi < 0.1) { r=0.68; g=0.52; b=0.35; }
  else if (ndvi < 0.3) { r=0.85; g=0.78; b=0.35; }
  else if (ndvi < 0.5) { r=0.55; g=0.75; b=0.3; }
  else { r=0.1; g=0.5; b=0.15; }
  return [r, g, b, 1];
}`;

// شاخص خاک‌برهنه (Bare Soil Index) — برای تشخیص خاک/باطله‌ی تازه‌جابه‌جاشده، مکمل NDVI برای معدن.
// رنگی‌شده برای نمایش انسانی (سبز=پوشش‌دار، زرد/نارنجی=خاک نسبی، قرمز=خاک شدیداً برهنه).
export const SAT_EVALSCRIPT_BSI = `//VERSION=3
function setup() { return { input: [{bands:["B02","B04","B08","B11","SCL"]}], output: { bands: 4 } }; }
function evaluatePixel(s) {
  let bsi = ((s.B11 + s.B04) - (s.B08 + s.B02)) / ((s.B11 + s.B04) + (s.B08 + s.B02) + 0.0001);
  let cloudLike = (s.SCL===3 || s.SCL===8 || s.SCL===9 || s.SCL===10 || s.SCL===11);
  if (cloudLike) return [0.55, 0.55, 0.55, 0];
  let r, g, b;
  if (bsi < -0.1) { r=0.1; g=0.5; b=0.2; }
  else if (bsi < 0.05) { r=0.55; g=0.72; b=0.3; }
  else if (bsi < 0.2) { r=0.88; g=0.72; b=0.2; }
  else { r=0.82; g=0.2; b=0.12; }
  return [r, g, b, 1];
}`;

export const SAT_EVALSCRIPT_S1 = `//VERSION=3
function setup() { return { input: ["VV"], output: { bands: 4 } }; }
function evaluatePixel(s) {
  let db = s.VV > 0 ? 10 * Math.log10(s.VV) : -30;
  let norm = (db + 25) / 25;
  norm = Math.min(1, Math.max(0, norm));
  return [norm, norm, norm, 1];
}`;

// ارتفاع را دقیقاً با همان کدگذاری کاشی‌های عمومی Terrarium (R×256+G+B/256−32768) در سه کانال
// RGB می‌ریزد — تا بشود از همان رمزگشای موجود (decodeTerrariumPixel در terrainDem.js) بدون
// تغییر استفاده کرد. منبع داده اینجا دیگر آن کاشی‌های عمومی/رایگان (SRTM بازآمیخته) نیست؛
// Sentinel Hub این را از dataset احرازهویت‌شده‌ی Copernicus DEM GLO-30 (ماموریت TanDEM-X، ماهواره
// راداری آلمانی-فرانسوی با دقت افقی و عمودی به‌مراتب بهتر) می‌دهد — همان Client ID/Secret که برای
// تصاویر ماهواره‌ای ذخیره شده کافی است، نیازی به تنظیمات جداگانه نیست.
export const SAT_EVALSCRIPT_DEM_TERRARIUM = `//VERSION=3
function setup() { return { input: ["DEM"], output: { bands: 3, sampleType: "UINT8" } }; }
function evaluatePixel(s) {
  let v = s.DEM + 32768.0;
  if (v < 0) v = 0; if (v > 65535.999) v = 65535.999;
  let r = Math.floor(v / 256.0);
  let rem = v - r * 256.0;
  let g = Math.floor(rem);
  let b = Math.floor((rem - g) * 256.0);
  return [r, g, b];
}`;

export const SAT_LAYERS = {
  truecolor: { label: '🛰️ تصویر رنگ طبیعی', script: SAT_EVALSCRIPT_TRUECOLOR, collection: 'sentinel-2-l2a', dayWindow: 15 },
  ndvi: { label: '🌿 شاخص پوشش گیاهی (NDVI)', script: SAT_EVALSCRIPT_NDVI, collection: 'sentinel-2-l2a', dayWindow: 15 },
  bsi: { label: '🟤 شاخص خاک برهنه/باطله (BSI)', script: SAT_EVALSCRIPT_BSI, collection: 'sentinel-2-l2a', dayWindow: 15 },
  radar: { label: '📡 راداری (ابر/شب هم کار می‌کند)', script: SAT_EVALSCRIPT_S1, collection: 'sentinel-1-grd', dayWindow: 12 },
};

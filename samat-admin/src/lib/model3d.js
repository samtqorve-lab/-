import { sb } from './supabase.js';
import {
  importKey, encryptBytes, decryptBytes, buildBundle,
} from './model3dCrypto.js';
import { extractApp1Segments, patchExifSegment, injectApp1Segments } from './model3dExif.js';
import { buildJobMeta, planPhotoNames, rewriteNames } from './model3dGeoref.js';

/**
 * ساخت مدل سه‌بعدی از عکس‌های پهباد: عکس‌ها در همین دستگاه کوچک و رمز می‌شوند، از طریق Edge Function
 * `model3d` به ریپوی GitHub (samat-3d) می‌روند و آنجا با OpenDroneMap پردازش می‌شوند. مدل نهایی هم
 * رمزشده روی GitHub می‌ماند؛ Supabase فقط یک ردیف کوچک (وضعیت/تگ) نگه می‌دارد.
 */

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/model3d`;

export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 600;
const MAX_BUNDLE_BYTES = 12 * 1024 * 1024; // هر آپلود حدود ۱۲ مگابایت — برای اینترنت ضعیف و محدودیت نرخ GitHub
const MAX_BUNDLE_BYTES_ORIGINAL = 24 * 1024 * 1024; // عکس‌های اندازه‌ی اصلی (۸–۱۰ مگابایتی)؛ سقف Edge Function ۴۰ مگابایت است
const MAX_BUNDLE_PHOTOS = 30;
const PARALLEL_UPLOADS = 2;

export const QUALITY_OPTIONS = [
  { id: 'small', label: 'کوچک‌شده (۲ مگاپیکسل) — پیشنهادی', maxPixels: 2_000_000 },
  { id: 'medium', label: 'کوچک‌شده (۴ مگاپیکسل) — دقیق‌تر، آپلود کندتر', maxPixels: 4_000_000 },
  { id: 'original', label: 'اندازه‌ی اصلی — حجم آپلود زیاد', maxPixels: 0 },
];

async function authHeaders() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('نشست منقضی شده است — دوباره وارد شوید');
  return { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY };
}

async function call(action, payload = {}) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `خطای سرور (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const listJobs = (mineName) => call('list', { mineName }).then((d) => d.jobs || []);
export const getJobStatus = (jobId) => call('status', { jobId });
export const createJob = (mineName, { mode = 'preview', georef = 'exif' } = {}) => call('create', { mineName, mode, georef });
export const startJob = (jobId, { expected, photos }) => call('start', { jobId, expected, photos });
export const removeJob = (jobId) => call('remove', { jobId });
export const getJobKey = (jobId) => call('key', { jobId }).then((d) => d.key_b64);
/** فقط ادمین: بررسی اتصال به GitHub، توکن، workflow و یک رفت‌وبرگشت آزمایشی (بدون پردازش واقعی) */
export const runSelftest = () => call('selftest');

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * یک عکس JPEG را برای آپلود آماده می‌کند: اگر بزرگ‌تر از سقف پیکسل باشد کوچک می‌شود، ولی EXIF (GPS،
 * فاصله‌ی کانونی، ...) و XMP عکس اصلی حفظ می‌شوند، چون ODM برای مقیاس و سرعت به آن‌ها نیاز دارد.
 * @param {File} file
 * @param {number} maxPixels صفر یعنی بدون کوچک‌کردن
 * @returns {Promise<Uint8Array>}
 */
export async function prepareJpeg(file, maxPixels) {
  const orig = new Uint8Array(await file.arrayBuffer());
  if (orig.length < 4 || orig[0] !== 0xFF || orig[1] !== 0xD8) {
    throw new Error(`«${file.name}» عکس JPEG نیست`);
  }
  if (!maxPixels) return orig;

  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const w = bmp.width;
    const h = bmp.height;
    if (w * h <= maxPixels * 1.15) return orig; // از قبل کوچک است؛ دست‌نخورده می‌ماند
    const scale = Math.sqrt(maxPixels / (w * h));
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    canvas.getContext('2d').drawImage(bmp, 0, 0, nw, nh);
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.9); });
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('کوچک‌کردن عکس ناموفق بود');
    const resized = new Uint8Array(await blob.arrayBuffer());
    const segments = extractApp1Segments(orig).map((s) => (
      s.kind === 'exif' ? patchExifSegment(s.bytes, { width: nw, height: nh, scale }) : s.bytes
    ));
    return injectApp1Segments(resized, segments);
  } finally {
    if (bmp.close) bmp.close();
  }
}

async function uploadAsset(jobId, index, bytes) {
  const name = `${String(index).padStart(4, '0')}.enc`;
  const url = `${FN_URL}?action=upload&job_id=${jobId}&name=${name}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await sleep(1500 * attempt);
    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await fetch(url, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/octet-stream' },
        body: bytes,
      });
    } catch {
      lastErr = new Error('اتصال اینترنت قطع شد — دوباره تلاش کنید');
      continue; // خطای شبکه: تلاش مجدد
    }
    if (res.ok) return;
    // eslint-disable-next-line no-await-in-loop
    const data = await res.json().catch(() => ({}));
    lastErr = new Error(data.error || `خطای سرور (${res.status})`);
    if (res.status < 500 && res.status !== 429) throw lastErr; // خطای دائمی: تلاش مجدد بی‌فایده است
  }
  throw lastErr || new Error('آپلود ناموفق بود');
}

/**
 * عکس‌ها را کوچک، بسته‌بندی، رمز و آپلود می‌کند. تنظیمات پردازش (job.json) و فایل‌های موقعیت دقیق
 * (geo.txt یا gcp_list.txt) هم در یک بسته‌ی جدا و رمزشده می‌روند تا workflow آن‌ها را بخواند.
 * @param {{ jobId: string, keyB64: string, files: File[], maxPixels: number,
 *           settings?: { mode?: string, georef?: string, gpsAccuracy?: number, demResolution?: number,
 *                        quality?: string, ortho?: boolean, geoText?: string, gcpText?: string },
 *           onProgress?: (p: { phase: string, done: number, total: number }) => void,
 *           shouldCancel?: () => boolean }} opts
 * @returns {Promise<{ assets: number, photos: number }>}
 */
export async function uploadPhotos({
  jobId, keyB64, files, maxPixels, settings = {}, onProgress = () => {}, shouldCancel = () => false,
}) {
  const key = await importKey(keyB64);
  const total = files.length;
  const mode = settings.mode || 'preview';
  const georef = mode === 'survey' ? (settings.georef || 'exif') : 'exif';
  // مختصات پیکسلی نقاط GCP مربوط به اندازه‌ی اصلی عکس‌هاست؛ پس با GCP هرگز کوچک نمی‌کنیم
  const pixels = georef === 'gcp' ? 0 : maxPixels;
  const bundleLimit = pixels ? MAX_BUNDLE_BYTES : MAX_BUNDLE_BYTES_ORIGINAL;
  // نام اصلی عکس‌ها حفظ می‌شود (فایل‌های geo/GCP با همان نام‌ها به عکس‌ها اشاره می‌کنند)
  const { names, mapping } = planPhotoNames(files.map((f) => f.name));

  let prepared = 0;
  let uploaded = 0;
  let assets = 0;
  let firstError = null;
  const inflight = new Set();

  const report = (phase) => onProgress({ phase, done: phase === 'prepare' ? prepared : uploaded, total });

  const flush = async (items, photoCount = items.length) => {
    assets += 1;
    const index = assets;
    const task = (async () => {
      const encrypted = await encryptBytes(buildBundle(items), key);
      await uploadAsset(jobId, index, encrypted);
      uploaded += photoCount;
      report('upload');
    })().catch((e) => { if (!firstError) firstError = e; }).finally(() => inflight.delete(task));
    inflight.add(task);
    if (inflight.size >= PARALLEL_UPLOADS) await Promise.race(inflight);
  };

  let bundle = [];
  let bundleBytes = 0;
  for (let i = 0; i < files.length; i += 1) {
    if (shouldCancel()) throw new Error('CANCELLED');
    if (firstError) break;
    // eslint-disable-next-line no-await-in-loop
    const bytes = await prepareJpeg(files[i], pixels);
    prepared += 1;
    report('prepare');
    bundle.push({ name: names[i], bytes });
    bundleBytes += bytes.length;
    if (bundleBytes >= bundleLimit || bundle.length >= MAX_BUNDLE_PHOTOS) {
      const items = bundle;
      bundle = [];
      bundleBytes = 0;
      // eslint-disable-next-line no-await-in-loop
      await flush(items);
    }
  }
  if (!firstError && bundle.length) await flush(bundle);

  // بسته‌ی تنظیمات: job.json همیشه؛ geo.txt / gcp_list.txt فقط در صورت انتخاب همان روش
  if (!firstError) {
    const enc = new TextEncoder();
    const extras = [{ name: 'job.json', bytes: enc.encode(buildJobMeta({ ...settings, mode, georef })) }];
    if (mode === 'survey' && georef === 'geo' && settings.geoText) {
      extras.push({ name: 'geo.txt', bytes: enc.encode(rewriteNames(settings.geoText, 'geo', mapping)) });
    }
    if (mode === 'survey' && georef === 'gcp' && settings.gcpText) {
      extras.push({ name: 'gcp_list.txt', bytes: enc.encode(rewriteNames(settings.gcpText, 'gcp', mapping)) });
    }
    await flush(extras, 0);
  }
  await Promise.all(inflight);
  if (firstError) throw firstError;
  return { assets, photos: total };
}

/** خروجی‌های قابل دریافت یک کار و نوع فایل هرکدام */
export const ASSET_INFO = {
  'model.glb': { label: 'مدل سه‌بعدی', mime: 'model/gltf-binary', file: 'model3d.glb' },
  'dsm.tif': { label: 'DSM (مدل ارتفاعی)', mime: 'image/tiff', file: 'dsm.tif' },
  'ortho.tif': { label: 'اورتوفوتو', mime: 'image/tiff', file: 'orthophoto.tif' },
  'stats.json': { label: 'گزارش دقت', mime: 'application/json', file: 'stats.json' },
};

/** یکی از خروجی‌های آماده را از GitHub (از طریق Edge Function) می‌گیرد و در همین دستگاه رمزگشایی می‌کند. */
export async function downloadModel(jobId, asset = 'model.glb') {
  const info = ASSET_INFO[asset] || ASSET_INFO['model.glb'];
  const keyB64 = await getJobKey(jobId);
  const res = await fetch(`${FN_URL}?action=download&job_id=${jobId}&asset=${encodeURIComponent(asset)}`, { headers: await authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `دریافت فایل ناموفق بود (${res.status})`);
  }
  const encrypted = new Uint8Array(await res.arrayBuffer());
  const plain = await decryptBytes(encrypted, await importKey(keyB64));
  return new Blob([plain], { type: info.mime });
}

/** ذخیره یا اشتراک‌گذاری فایل: اول منوی اشتراک‌گذاری موبایل، در غیر این صورت دانلود معمولی */
export async function saveBlob(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // کاربر خودش بست
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

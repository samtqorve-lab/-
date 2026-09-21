// فایل‌های موقعیت‌یابی دقیق برای ساخت مدل «نقشه‌برداری» (OpenDroneMap):
//  - geo.txt     موقعیت دقیق هر عکس (خروجی PPK/RTK)      : «نام x y z [yaw pitch roll [دقت‌افقی دقت‌عمودی]]»
//  - gcp_list    نقاط کنترل زمینی (GCP)                   : «x y z im_x im_y نام‌عکس [نام‌نقطه]»
// خط اول هر دو فایل سیستم مختصات است، مثل EPSG:32638. این ماژول فقط توابع خالص دارد (بدون DOM) تا
// جداگانه تست شود.

const CRS_RE = /^(EPSG:\d{4,6}|\+proj\S.*)$/i;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export const MIN_GCP = 3;
export const RECOMMENDED_GCP = 5;

const isNum = (s) => NUM_RE.test(s);

function meaningfulLines(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * ورودی PPK را به قالب geo.txt تبدیل می‌کند. اگر فایل از قبل با EPSG/proj شروع شود همان را برمی‌گرداند؛
 * اگر CSV/TSV با سرستون‌هایی مثل name, lat, lon, alt باشد، به EPSG:4326 تبدیل می‌کند (ODM: x=lon, y=lat).
 * @returns {{ ok: boolean, text?: string, error?: string, converted?: boolean }}
 */
export function normalizeGeoInput(raw) {
  const lines = meaningfulLines(raw);
  if (!lines.length) return { ok: false, error: 'فایل خالی است' };
  if (CRS_RE.test(lines[0])) return { ok: true, text: `${lines.join('\n')}\n`, converted: false };

  const sep = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : (lines[0].includes(';') ? ';' : null));
  if (!sep) {
    return { ok: false, error: 'خط اول باید سیستم مختصات باشد، مثل EPSG:32638 (یا فایل CSV با سرستون name, lat, lon, alt)' };
  }
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const find = (...names) => head.findIndex((h) => names.includes(h));
  const iName = find('name', 'filename', 'file', 'image', 'photo', 'image_name', 'imagename');
  const iLat = find('lat', 'latitude', 'y');
  const iLon = find('lon', 'lng', 'long', 'longitude', 'x');
  const iAlt = find('alt', 'altitude', 'height', 'elevation', 'z', 'ellipsoidal height', 'ellipsoidal_height');
  if ([iName, iLat, iLon, iAlt].some((i) => i < 0)) {
    return { ok: false, error: 'سرستون‌های CSV باید شامل name, lat, lon, alt باشند' };
  }
  const out = ['EPSG:4326'];
  for (const line of lines.slice(1)) {
    const c = line.split(sep).map((v) => v.trim());
    if (c.length <= Math.max(iName, iLat, iLon, iAlt)) continue;
    if (!c[iName] || !isNum(c[iLat]) || !isNum(c[iLon]) || !isNum(c[iAlt])) {
      return { ok: false, error: `ردیف نامعتبر در CSV: «${line.slice(0, 60)}»` };
    }
    out.push(`${c[iName]} ${c[iLon]} ${c[iLat]} ${c[iAlt]}`);
  }
  return { ok: true, text: `${out.join('\n')}\n`, converted: true };
}

/** geo.txt را بررسی می‌کند. @returns {{ ok, crs?, rows?, count?, error? }} */
export function parseGeo(text) {
  const lines = meaningfulLines(text);
  if (!lines.length) return { ok: false, error: 'فایل خالی است' };
  const crs = lines[0];
  if (!CRS_RE.test(crs)) return { ok: false, error: 'خط اول باید سیستم مختصات باشد، مثل EPSG:32638' };
  const rows = [];
  for (const line of lines.slice(1)) {
    const p = line.split(/\s+/);
    if (p.length < 4 || !isNum(p[1]) || !isNum(p[2]) || !isNum(p[3])) {
      return { ok: false, error: `ردیف نامعتبر: «${line.slice(0, 60)}» (لازم: نام x y z)` };
    }
    rows.push({ name: p[0], x: Number(p[1]), y: Number(p[2]), z: Number(p[3]) });
  }
  if (rows.length < 3) return { ok: false, error: 'حداقل ۳ عکس در فایل موقعیت لازم است' };
  return { ok: true, crs, rows, count: rows.length };
}

/** فایل GCP را بررسی می‌کند. @returns {{ ok, crs?, rows?, points?, error?, warning? }} */
export function parseGcp(text) {
  const lines = meaningfulLines(text);
  if (!lines.length) return { ok: false, error: 'فایل خالی است' };
  const crs = lines[0];
  if (!CRS_RE.test(crs)) return { ok: false, error: 'خط اول باید سیستم مختصات باشد، مثل EPSG:32638' };
  const rows = [];
  for (const line of lines.slice(1)) {
    const p = line.split(/\s+/);
    if (p.length < 6 || ![0, 1, 2, 3, 4].every((i) => isNum(p[i]))) {
      return { ok: false, error: `ردیف نامعتبر: «${line.slice(0, 60)}» (لازم: x y z im_x im_y نام‌عکس)` };
    }
    rows.push({
      x: Number(p[0]), y: Number(p[1]), z: Number(p[2]), imX: Number(p[3]), imY: Number(p[4]), name: p[5], label: p[6] || `${p[0]},${p[1]}`,
    });
  }
  const points = new Set(rows.map((r) => r.label));
  if (points.size < MIN_GCP) return { ok: false, error: `حداقل ${MIN_GCP} نقطه‌ی کنترل متفاوت لازم است (فایل ${points.size} نقطه دارد)` };
  const out = { ok: true, crs, rows, points: points.size };
  if (points.size < RECOMMENDED_GCP) out.warning = `فقط ${points.size} نقطه‌ی کنترل؛ ${RECOMMENDED_GCP} نقطه یا بیشتر توصیه می‌شود`;
  return out;
}

/** نام عکس‌های فایل موقعیت/GCP که بین عکس‌های انتخاب‌شده نیستند */
export function unmatchedNames(rows, photoNames) {
  const have = new Set(photoNames);
  const referenced = [...new Set(rows.map((r) => r.name))];
  const missing = referenced.filter((n) => !have.has(n));
  return { referenced: referenced.length, matched: referenced.length - missing.length, missing };
}

/**
 * برای هر عکس یک نام امن و یکتا می‌سازد (فقط حروف/عدد/._-) که با پسوند JPEG تمام شود. نام اصلی در
 * فایل‌های geo/GCP هم ممکن است باشد، پس نگاشت (اصلی ← نهایی) برمی‌گردد تا آن فایل‌ها بازنویسی شوند.
 * @param {string[]} originals
 * @returns {{ names: string[], mapping: Map<string, string> }}
 */
export function planPhotoNames(originals) {
  const used = new Set();
  const mapping = new Map();
  const names = originals.map((orig) => {
    let base = String(orig).split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
    if (!/\.jpe?g$/i.test(base)) base = `${base}.jpg`;
    let name = base;
    for (let i = 2; used.has(name); i += 1) name = base.replace(/(\.[^.]+)$/, `_${i}$1`);
    used.add(name);
    if (name !== orig && !mapping.has(orig)) mapping.set(orig, name);
    return name;
  });
  return { names, mapping };
}

/**
 * نام عکس‌ها را در متن geo.txt (ستون اول) یا GCP (ستون ششم) طبق نگاشت بازنویسی می‌کند.
 * @param {string} text @param {'geo'|'gcp'} kind @param {Map<string,string>} mapping
 */
export function rewriteNames(text, kind, mapping) {
  if (!mapping || !mapping.size) return text;
  const col = kind === 'gcp' ? 5 : 0;
  return String(text).split(/\r?\n/).map((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#') || (i === 0 && CRS_RE.test(t)) || CRS_RE.test(t)) return line;
    const parts = t.split(/\s+/);
    if (parts.length > col && mapping.has(parts[col])) parts[col] = mapping.get(parts[col]);
    return parts.join(' ');
  }).join('\n');
}

/** job.json: تنظیمات پردازش که workflow می‌خواند (scripts/odm_options.py) */
export function buildJobMeta({
  mode = 'preview', georef = 'exif', gpsAccuracy = 0.05, demResolution = 5, quality = 'standard', ortho = false,
} = {}) {
  const meta = { version: 1, mode, georef };
  if (mode === 'survey') {
    meta.demResolution = demResolution;
    meta.quality = quality;
    meta.ortho = !!ortho;
    if (georef === 'geo') meta.gpsAccuracy = gpsAccuracy;
  }
  return JSON.stringify(meta);
}

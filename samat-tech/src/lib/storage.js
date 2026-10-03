import { sb } from './supabase.js';

// هش کوتاه و پایدار (djb2) — برای اینکه نام‌های فارسی مختلف بعد از حذف حروف غیرلاتین به یک پوشه‌ی
// مشترک نروند.
function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(6, '0').slice(-6);
}

/**
 * مسیر ذخیره‌سازی فقط ASCII مجاز است؛ قبلاً هر حرف فارسی (مثلاً نام معدن یا دوره) به «_» تبدیل می‌شد و
 * عکس/فایل همه‌ی معدن‌ها در یک پوشه‌ی «_» می‌ریخت. حالا اگر نام شامل حرف غیر ASCII (یا فاصله و علامت)
 * باشد، یک هش کوتاه از نام اصلی به انتهای بخش ASCII اضافه می‌شود تا هر معدن/دوره پوشه‌ی جدای خودش را
 * داشته باشد. نام‌های کاملاً ASCII دست‌نخورده می‌مانند.
 */
export function safeStoragePathSegment(s) {
  const raw = String(s || '').trim();
  const ascii = raw.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const changed = /[^\w.-]/.test(raw);
  const base = changed ? `${ascii.slice(0, 60)}${ascii ? '_' : ''}${shortHash(raw)}` : ascii;
  return (base || '_').slice(0, 80);
}

export async function uploadTechFile(fileOrBlob, fileName, mineName, period, category) {
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fileName.replace(/[^\w.-]/g, '_')}`;
  const path = `${safeStoragePathSegment(mineName)}/${safeStoragePathSegment(period || 'نامشخص')}/${category}/${safeName}`;
  const { error } = await sb.storage.from('tech-reports').upload(path, fileOrBlob, { upsert: false });
  if (error) throw new Error(`آپلود فایل ناموفق بود: ${error.message}`);
  const { data } = sb.storage.from('tech-reports').getPublicUrl(path);
  return data.publicUrl;
}

/** عکس‌های حادثه در باکت جدای «incident-photos» ذخیره می‌شوند (نه tech-reports) */
export async function uploadIncidentFile(blob, mineName) {
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const path = `${safeStoragePathSegment(mineName)}/${safeName}`;
  const { error } = await sb.storage.from('incident-photos').upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
  if (error) throw new Error(`آپلود عکس ناموفق بود: ${error.message}`);
  const { data } = sb.storage.from('incident-photos').getPublicUrl(path);
  return data.publicUrl;
}

/** یادداشت صوتی هم در همان باکت incident-photos ذخیره می‌شود (پسوند/نوع فایل فرقی نمی‌کند، فقط برای سادگی زیرساخت) */
export async function uploadVoiceNote(blob, mineName) {
  const ext = (blob.type || '').includes('mp4') ? 'm4a' : (blob.type || '').includes('ogg') ? 'ogg' : 'webm';
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${safeStoragePathSegment(mineName)}/voice/${safeName}`;
  const { error } = await sb.storage.from('incident-photos').upload(path, blob, { upsert: false, contentType: blob.type || 'audio/webm' });
  if (error) throw new Error(`آپلود یادداشت صوتی ناموفق بود: ${error.message}`);
  const { data } = sb.storage.from('incident-photos').getPublicUrl(path);
  return data.publicUrl;
}

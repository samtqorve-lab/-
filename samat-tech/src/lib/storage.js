import { sb } from './supabase.js';

export function safeStoragePathSegment(s) {
  return String(s || '').trim().replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || '_';
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

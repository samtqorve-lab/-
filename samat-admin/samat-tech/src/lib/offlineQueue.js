// چون این اپ در سایت معدن با اینترنت ضعیف/قطع استفاده می‌شود، گزارش‌ها هرگز نباید فقط به‌خاطر
// نبود آنتن از دست بروند. اگر ارسال ناموفق شود (یا اصلاً آنلاین نباشیم)، آیتم با تمام عکس‌ها
// (Blob) در IndexedDB ذخیره می‌شود و به‌محض اتصال دوباره، خودکار برای ارسال تلاش می‌شود.
// کاربر هیچ‌وقت «خطا در اینترنت» نمی‌بیند — همیشه «ذخیره شد، به‌محض اتصال ارسال می‌شود».

const DB_NAME = 'tech-officer-offline-v1';
const STORE = 'pending-submissions';

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** item = { id, type: 'identityVerification'|'safetyChecklist'|'equipmentPhoto', payload, queuedAt } */
export async function queueOfflineSubmission(item) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedSubmissions() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteQueuedSubmission(id) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putQueuedSubmission(item) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** کاربر می‌تواند یک مورد «ناموفق دائمی» را دستی دوباره در صف فعال بگذارد (شمارنده صفر می‌شود) */
export async function retryFailedSubmission(id) {
  const items = await getQueuedSubmissions();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  await putQueuedSubmission({ ...item, retryCount: 0, failed: false });
  await emitChange();
}

/** حذف قطعی یک مورد از صف (چه در حال انتظار، چه ناموفق دائمی) — با تایید صریح کاربر در UI */
export async function discardQueuedSubmission(id) {
  await deleteQueuedSubmission(id);
  await emitChange();
}

export function isLikelyNetworkError(err) {
  const m = ((err && err.message) || String(err || '')).toLowerCase();
  return !navigator.onLine || m.includes('failed to fetch') || m.includes('network') || m.includes('timeout') || m.includes('load failed');
}

export function newQueueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// نگاشت type به تابع واقعی ارسال — چون خود این ماژول نباید به auth/storage وابسته باشد
// (تا وابستگی چرخه‌ای پیش نیاید)، توابع ارسال را main.js موقع boot ثبت می‌کند.
const senders = {};
export function registerSender(type, fn) {
  senders[type] = fn;
}

// بعد از این‌همه تلاش ناموفق پیاپی (نه فقط قطعی موقت اینترنت، بلکه مثلاً خطای اعتبارسنجی سرور
// که با تلاش مجدد هم درست نمی‌شود)، آیتم را «ناموفق دائمی» علامت می‌زنیم تا برای همیشه ساکت در
// صف نماند و هر بار خودکار دوباره امتحان نشود — به‌جایش به کاربر نشان داده می‌شود تا خودش تصمیم
// بگیرد (دوباره امتحان کن، یا برای همیشه حذفش کن).
const MAX_RETRIES = 5;

let syncInProgress = false;
const listeners = new Set();
export function onQueueChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
async function emitChange() {
  const items = await getQueuedSubmissions();
  const pending = items.filter((i) => !i.failed).length;
  const failed = items.filter((i) => i.failed).length;
  listeners.forEach((fn) => fn({ pending, failed }));
}

export async function trySyncQueuedItems(manual, showToastFn) {
  if (syncInProgress) return;
  if (!navigator.onLine) { if (manual) showToastFn?.('⚠️ هنوز اینترنت وصل نیست'); return; }
  syncInProgress = true;
  try {
    const items = (await getQueuedSubmissions()).filter((i) => !i.failed);
    if (!items.length) { if (manual) showToastFn?.('چیزی در صف نیست'); await emitChange(); return; }
    if (manual) showToastFn?.(`⏳ در حال ارسال ${items.length} مورد ذخیره‌شده...`);
    let okCount = 0;
    for (const item of items) {
      const send = senders[item.type];
      if (!send) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await send(item.payload);
        // eslint-disable-next-line no-await-in-loop
        await deleteQueuedSubmission(item.id);
        okCount++;
      } catch (err) {
        // این یکی هنوز ناموفق بود — اگر دلیلش قطعی شبکه است، همین که وصل شد خودکار دوباره
        // امتحان می‌شود بدون اینکه شمارنده‌اش زیاد شود؛ اگر دلیل دیگری دارد (مثلاً سرور رد کرد)،
        // شمارنده بالا می‌رود و بعد از MAX_RETRIES بار، دیگر خودکار امتحان نمی‌شود.
        console.warn('offline sync item failed, will retry later', err);
        const retryCount = isLikelyNetworkError(err) ? (item.retryCount || 0) : (item.retryCount || 0) + 1;
        // eslint-disable-next-line no-await-in-loop
        await putQueuedSubmission({ ...item, retryCount, failed: retryCount >= MAX_RETRIES, lastError: err.message || String(err) });
      }
    }
    await emitChange();
    if (okCount > 0) showToastFn?.(`✅ ${okCount} مورد ذخیره‌شده با موفقیت ارسال شد`);
  } finally {
    syncInProgress = false;
  }
}

export function initOfflineQueueWatcher(showToastFn) {
  window.addEventListener('online', () => trySyncQueuedItems(false, showToastFn));
  emitChange();
  trySyncQueuedItems(false, showToastFn);
}

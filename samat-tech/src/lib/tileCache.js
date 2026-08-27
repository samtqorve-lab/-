// کش کاشی‌های نقشه با IndexedDB خام — نه Service Worker. طبق مستندات خود Capacitor، سرویس‌ورکرها
// برای رهگیری/کش‌کردن درخواست‌های شبکه‌ی remote داخل WebView اندرویدشان قابل‌اعتماد نیستند
// (و روی iOS اصلاً کار نمی‌کنند). چون بیشتر مسئولین فنی از همین اپ نصب‌شده (نه نسخه‌ی PWA
// مرورگر) استفاده می‌کنند، به‌جای سرویس‌ورکر مستقیماً IndexedDB را از کد خود اپ صدا می‌زنیم —
// این روش در هر دو حالت (اپ نصب‌شده و PWA) یکسان و مطمئن کار می‌کند.
const DB_NAME = 'samat-tile-cache';
const STORE = 'tiles';
const MAX_AGE_MS = 45 * 24 * 3600 * 1000; // ۴۵ روز — کاشی‌های ماهواره‌ای به‌ندرت عوض می‌شوند
const MAX_ENTRIES = 4000; // برای یک محدوده‌ی معدنی معمولی خیلی بیشتر از کافی، بدون پرکردن فضای گوشی

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function getCachedTile(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null; // کش فقط یک بهینه‌سازی است؛ شکستش نباید چیزی را خراب کند
  }
}

export async function putCachedTile(key, blob) {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, blob, savedAt: Date.now() });
    if (Math.random() < 0.01) pruneOldTiles(db); // پاک‌سازی سبک، نه هر بار — هزینه‌ی مرور کل کش را زیاد نمی‌کند
  } catch {
    // نادیده گرفتن خطا عمدی است
  }
}

async function pruneOldTiles(db) {
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  const all = await new Promise((resolve) => {
    const items = [];
    const cur = store.openCursor();
    cur.onsuccess = (e) => {
      const c = e.target.result;
      if (c) { items.push({ key: c.key, savedAt: c.value.savedAt }); c.continue(); } else resolve(items);
    };
    cur.onerror = () => resolve(items);
  });
  const cutoff = Date.now() - MAX_AGE_MS;
  const expired = all.filter((t) => t.savedAt < cutoff).map((t) => t.key);
  const overflow = all.length - expired.length > MAX_ENTRIES
    ? all.filter((t) => !expired.includes(t.key)).sort((a, b) => a.savedAt - b.savedAt).slice(0, all.length - expired.length - MAX_ENTRIES).map((t) => t.key)
    : [];
  [...expired, ...overflow].forEach((k) => store.delete(k));
}

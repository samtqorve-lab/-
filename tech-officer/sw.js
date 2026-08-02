// سرویس‌ورکر: پوسته‌ی برنامه را کش می‌کند تا در سایت معدن با اینترنت ضعیف سریع باز شود،
// و همزمان با استراتژی stale-while-revalidate خودش را در پس‌زمینه به‌روز نگه می‌دارد
// (به‌جای کش خشک که تا تغییر دستی CACHE_NAME هیچ‌وقت رفرش نمی‌شد — همان مشکلی که قبلاً
// باعث می‌شد نسخه‌ی جدید سایت را نبینید مگر با Incognito).
// آپلود گزارش/عکس/داده همیشه مستقیم از شبکه می‌رود (هیچ‌وقت کش نمی‌شود) — صف آفلاین
// آن را در سطح صفحه (index.html، نه اینجا) مدیریت می‌کند.
const CACHE_NAME = 'tech-officer-app-v9';
const APP_SHELL = ['/tech-officer/', '/tech-officer/index.html', '/tech-officer/manifest.json', '/tech-officer/icons/icon-192.png', '/tech-officer/icons/icon-512.png', '/tech-officer/icons/icon-maskable-192.png', '/tech-officer/icons/icon-maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  // عمداً skipWaiting فوری صدا زده نمی‌شود؛ صبر می‌کنیم صفحه با postMessage('SKIP_WAITING')
  // درخواست کند، تا کاربر وسط پرکردن فرم غافلگیر نشود (رفرش ناگهانی وسط کار)
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // فقط فایل‌های خود برنامه را کش کن؛ درخواست‌های Supabase (داده/آپلود) همیشه مستقیم از شبکه بروند
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const networkFetch = fetch(event.request).then((res) => {
        if (res && res.ok) cache.put(event.request, res.clone());
        return res;
      }).catch(() => null);

      // اگر نسخه‌ی کش‌شده داریم: همان را فوری بده (سرعت در اینترنت ضعیف)، ولی در پس‌زمینه
      // نسخه‌ی تازه را بگیر و جایگزین کن تا دفعه‌ی بعد به‌روز باشد (stale-while-revalidate).
      if (cached) { networkFetch; return cached; }
      // اگر کش نداریم (اولین بار یا فایل جدید): منتظر شبکه بمان.
      const fresh = await networkFetch;
      return fresh || new Response('آفلاین و این فایل هنوز کش نشده', { status: 503 });
    })
  );
});

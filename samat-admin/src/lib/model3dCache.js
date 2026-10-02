// کش «رمزشده»ی خروجی‌های مدل سه‌بعدی روی همین دستگاه (Cache Storage مرورگر).
//
// چرا فقط متن رمزشده؟ مدل‌ها عمداً روی GitHub رمزشده‌اند و کلید فقط با ورود معتبر از Edge Function می‌آید. اگر نسخه‌ی
// رمزگشایی‌شده را روی دیسک نگه می‌داشتیم، روی رایانه‌ی مشترک اداره بدون ورود هم قابل خواندن بود. اینجا فقط بایت‌های
// رمزشده کش می‌شوند؛ بدون کلید بی‌مصرف‌اند و کلید همچنان هر بار با احراز هویت گرفته می‌شود. نتیجه: دفعه‌ی دوم
// «👁 مشاهده» دوباره صدها مگابایت دانلود نمی‌کند.
//
// امنیت کار: کارها (job_id) یک‌بار ساخته می‌شوند و هیچ‌وقت درجا بازنویسی نمی‌شوند (ادغام هم job_id جدید می‌سازد)،
// پس کلید jobId+asset هیچ‌گاه کهنه نمی‌شود. حذف کار (removeJob) ورودی‌هایش را هم پاک می‌کند.

const CACHE_NAME = 'samat-model3d-v1';
const KEY_PREFIX = 'https://samat.invalid/model3d/';
export const MAX_CACHED_ENTRIES = 6;
export const MAX_CACHED_BYTES = 250 * 1024 * 1024; // بزرگ‌تر از این کش نمی‌شود (RAM/دیسک موبایل)

const keyFor = (jobId, asset) => `${KEY_PREFIX}${encodeURIComponent(jobId)}/${encodeURIComponent(asset)}`;

/**
 * @param {CacheStorage|undefined} cacheStorage معمولاً `globalThis.caches`؛ undefined یعنی کش در دسترس نیست
 */
export function createCiphertextCache(cacheStorage) {
  const open = async () => (cacheStorage ? cacheStorage.open(CACHE_NAME) : null);

  return {
    /** @returns {Promise<Uint8Array|null>} */
    async get(jobId, asset) {
      try {
        const cache = await open();
        if (!cache) return null;
        const hit = await cache.match(keyFor(jobId, asset));
        if (!hit) return null;
        const bytes = new Uint8Array(await hit.arrayBuffer());
        return bytes.length ? bytes : null;
      } catch {
        return null; // خرابی کش نباید جلوی دانلود عادی را بگیرد
      }
    },

    /** @returns {Promise<boolean>} true اگر ذخیره شد */
    async put(jobId, asset, bytes) {
      try {
        const cache = await open();
        if (!cache || !bytes || !bytes.length || bytes.length > MAX_CACHED_BYTES) return false;
        await cache.put(keyFor(jobId, asset), new Response(bytes, {
          headers: { 'Content-Type': 'application/octet-stream', 'X-Cached-At': String(Date.now()) },
        }));
        // کهنه‌ترین‌ها را حذف کن تا از سقف تعداد نگذرد
        const keys = await cache.keys();
        if (keys.length > MAX_CACHED_ENTRIES) {
          const dated = [];
          for (const req of keys) {
            // eslint-disable-next-line no-await-in-loop
            const res = await cache.match(req);
            dated.push({ req, at: Number((res && res.headers.get('X-Cached-At')) || 0) });
          }
          dated.sort((a, b) => a.at - b.at);
          for (const d of dated.slice(0, dated.length - MAX_CACHED_ENTRIES)) {
            // eslint-disable-next-line no-await-in-loop
            await cache.delete(d.req);
          }
        }
        return true;
      } catch {
        return false; // سهمیه‌ی ذخیره‌سازی پر است یا مرورگر اجازه نمی‌دهد
      }
    },

    /** همه‌ی خروجی‌های کش‌شده‌ی یک کار را پاک می‌کند (هنگام حذف کار) */
    async removeJob(jobId) {
      try {
        const cache = await open();
        if (!cache) return;
        const prefix = `${KEY_PREFIX}${encodeURIComponent(jobId)}/`;
        const keys = await cache.keys();
        for (const req of keys) {
          // eslint-disable-next-line no-await-in-loop
          if (req.url.startsWith(prefix)) await cache.delete(req);
        }
      } catch { /* بی‌اثر */ }
    },
  };
}

export const ciphertextCache = createCiphertextCache(typeof caches !== 'undefined' ? caches : undefined);

import { describe, it, expect } from 'vitest';
import { createCiphertextCache, MAX_CACHED_ENTRIES, MAX_CACHED_BYTES } from './model3dCache.js';

/** CacheStorage ساختگی بر پایه‌ی Map (Node بدون caches واقعی) */
function fakeCaches({ failPut = false } = {}) {
  const store = new Map();
  const cache = {
    async match(k) { const key = typeof k === 'string' ? k : k.url; return store.has(key) ? store.get(key).clone() : undefined; },
    async put(k, res) { if (failPut) throw new Error('QuotaExceededError'); store.set(typeof k === 'string' ? k : k.url, res); },
    async delete(k) { return store.delete(typeof k === 'string' ? k : k.url); },
    async keys() { return [...store.keys()].map((url) => ({ url })); },
  };
  return { open: async () => cache, _store: store };
}
const bytes = (n, v = 7) => new Uint8Array(n).fill(v);

describe('createCiphertextCache', () => {
  it('put سپس get همان بایت‌ها را برمی‌گرداند؛ کلید دیگر null', async () => {
    const c = createCiphertextCache(fakeCaches());
    expect(await c.get('job1', 'model.glb')).toBeNull();
    expect(await c.put('job1', 'model.glb', bytes(100, 9))).toBe(true);
    const got = await c.get('job1', 'model.glb');
    expect(got.length).toBe(100);
    expect(got[0]).toBe(9);
    expect(await c.get('job1', 'dsm.tif')).toBeNull();
    expect(await c.get('job2', 'model.glb')).toBeNull();
  });
  it('بدون CacheStorage همه‌چیز بی‌صدا غیرفعال است', async () => {
    const c = createCiphertextCache(undefined);
    expect(await c.put('j', 'a', bytes(10))).toBe(false);
    expect(await c.get('j', 'a')).toBeNull();
    await expect(c.removeJob('j')).resolves.toBeUndefined();
  });
  it('خطای سهمیه در put نباید پرتاب شود', async () => {
    const c = createCiphertextCache(fakeCaches({ failPut: true }));
    expect(await c.put('j', 'a', bytes(10))).toBe(false);
  });
  it('فایل خالی یا بزرگ‌تر از سقف کش نمی‌شود', async () => {
    const c = createCiphertextCache(fakeCaches());
    expect(await c.put('j', 'a', new Uint8Array(0))).toBe(false);
    expect(await c.put('j', 'a', { length: MAX_CACHED_BYTES + 1 })).toBe(false);
  });
  it('از سقف تعداد که بگذرد کهنه‌ترین‌ها حذف می‌شوند', async () => {
    const fc = fakeCaches();
    const c = createCiphertextCache(fc);
    for (let i = 0; i < MAX_CACHED_ENTRIES + 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await c.put(`job${i}`, 'model.glb', bytes(10, i + 1));
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 3); });
    }
    expect(fc._store.size).toBe(MAX_CACHED_ENTRIES);
    expect(await c.get('job0', 'model.glb')).toBeNull();
    expect(await c.get('job1', 'model.glb')).toBeNull();
    expect(await c.get(`job${MAX_CACHED_ENTRIES + 1}`, 'model.glb')).not.toBeNull();
  });
  it('removeJob فقط خروجی‌های همان کار را پاک می‌کند', async () => {
    const c = createCiphertextCache(fakeCaches());
    await c.put('jobA', 'model.glb', bytes(10));
    await c.put('jobA', 'dsm.tif', bytes(10));
    await c.put('jobB', 'model.glb', bytes(10));
    await c.removeJob('jobA');
    expect(await c.get('jobA', 'model.glb')).toBeNull();
    expect(await c.get('jobA', 'dsm.tif')).toBeNull();
    expect(await c.get('jobB', 'model.glb')).not.toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import {
  lonLatToPixel, tileUrl, tileRange, pickZoom, planSatellite, latLonToUv, latLonToCanvas, buildSatelliteGrid, loadSatelliteTiles,
  TILE_SIZE, SATELLITE_TILE_URL, GOOGLE_TILE_URL, ESRI_TILE_URL, SATELLITE_PROVIDERS, MAX_TILES_PER_SIDE, DETAIL_LEVELS,
} from './model3dSatellite.js';
import { buildGeoref, enuToLatLon } from './model3dGeo.js';
import { latLonToUtm } from './utm.js';

// مرکز شهرستان قروه؛ georef با مبدأ RTC نزدیک همان نقطه
const QORVEH = [35.17, 47.8];
const u0 = latLonToUtm(QORVEH[0], QORVEH[1]);
const georef = buildGeoref({ rtc: [Math.round(u0.easting), Math.round(u0.northing), 1800], crs: 'EPSG:32638' });
const toLatLon = (e, n) => enuToLatLon(georef, e, n);
const BBOX = {
  minE: -250, maxE: 250, minN: -200, maxN: 200,
};

describe('Web-Mercator', () => {
  it('نقاط مرجع: (0,0) در زوم ۱ وسط نقشه؛ گوشه‌ی بالا-چپ جهان', () => {
    expect(lonLatToPixel(0, 0, 1)).toEqual({ x: 256, y: 256 });
    const tl = lonLatToPixel(-180, 85.0511287798, 3);
    expect(tl.x).toBeCloseTo(0, 6); expect(tl.y).toBeCloseTo(0, 3);
    const br = lonLatToPixel(180, -85.0511287798, 0);
    expect(br.x).toBeCloseTo(256, 6); expect(br.y).toBeCloseTo(256, 3);
  });
  it('نمونه‌ی شناخته‌شده: کاشی OSM برای لندن (51.5074, −0.1278) در زوم ۱۰ = x 511, y 340', () => {
    const p = lonLatToPixel(-0.1278, 51.5074, 10);
    expect(Math.floor(p.x / TILE_SIZE)).toBe(511);
    expect(Math.floor(p.y / TILE_SIZE)).toBe(340);
  });
  it('عرض‌های خارج از بازه به ±۸۵٫۰۵ گیره می‌شوند (NaN نمی‌دهند)', () => {
    expect(Number.isFinite(lonLatToPixel(10, 90, 5).y)).toBe(true);
    expect(Number.isFinite(lonLatToPixel(10, -90, 5).y)).toBe(true);
  });
  it('قالب آدرس Esri ترتیب z/y/x دارد', () => {
    expect(tileUrl(ESRI_TILE_URL, 17, 5, 9)).toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/9/5');
  });
  it('قالب آدرس Google: فقط ماهواره (lyrs=s)، x/y/z درست و زیردامنه از روی x+y', () => {
    // x+y = 14 → 14 % 4 = 2
    expect(tileUrl(GOOGLE_TILE_URL, 17, 5, 9)).toBe('https://mt2.google.com/vt/lyrs=s&x=5&y=9&z=17');
    // زیردامنه همیشه یکی از mt0..mt3 است
    for (let x = 0; x < 8; x += 1) expect(tileUrl(GOOGLE_TILE_URL, 15, x, 3)).toMatch(/^https:\/\/mt[0-3]\.google\.com\//);
  });
  it('پیش‌فرض منبع تصویر Google است و Esri به‌عنوان پشتیبان تعریف شده', () => {
    expect(SATELLITE_TILE_URL).toBe(GOOGLE_TILE_URL);
    expect(SATELLITE_PROVIDERS.google.template).toBe(GOOGLE_TILE_URL);
    expect(SATELLITE_PROVIDERS.esri.template).toBe(ESRI_TILE_URL);
  });
});

describe('planSatellite', () => {
  it('مدل ۵۰۰×۴۰۰ متری: زوم بالا (۱۷ یا ۱۸) با کمتر از سقف کاشی و بدون ناحیه‌ی خالی', () => {
    const plan = planSatellite(BBOX, toLatLon, { maxTiles: DETAIL_LEVELS.medium.maxTiles });
    expect(plan.z).toBeGreaterThanOrEqual(16);
    expect(plan.tiles.length).toBeLessThanOrEqual(DETAIL_LEVELS.medium.maxTiles);
    expect(plan.tiles.length).toBe(plan.nx * plan.ny);
    expect(plan.widthPx).toBe(plan.nx * TILE_SIZE);
    // حاشیه ≥ ۱۰۰ متر دور مدل
    expect(plan.extentEnu.minE).toBeLessThanOrEqual(BBOX.minE - 100);
    expect(plan.extentEnu.maxN).toBeGreaterThanOrEqual(BBOX.maxN + 100);
    expect(plan.coversExtra).toBe(false);
  });
  it('همه‌ی چهار گوشه‌ی extent داخل بوم می‌افتند (UV در ۰..۱)', () => {
    const plan = planSatellite(BBOX, toLatLon);
    const ex = plan.extentEnu;
    [[ex.minE, ex.minN], [ex.maxE, ex.minN], [ex.maxE, ex.maxN], [ex.minE, ex.maxN]].forEach(([e, n]) => {
      const ll = toLatLon(e, n);
      const { u, v } = latLonToUv(plan, ll.lat, ll.lon);
      expect(u).toBeGreaterThanOrEqual(-1e-9); expect(u).toBeLessThanOrEqual(1 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9);
    });
  });
  it('جزئیات بیشتر ⇒ زوم بالاتر یا برابر؛ جزئیات کم ⇒ کاشی کمتر', () => {
    const lo = planSatellite(BBOX, toLatLon, { maxTiles: DETAIL_LEVELS.low.maxTiles });
    const hi = planSatellite(BBOX, toLatLon, { maxTiles: DETAIL_LEVELS.high.maxTiles });
    expect(hi.z).toBeGreaterThanOrEqual(lo.z);
    expect(lo.tiles.length).toBeLessThanOrEqual(DETAIL_LEVELS.low.maxTiles);
  });
  it('مدل خیلی بزرگ (۴۰ کیلومتر) زوم را پایین می‌آورد و از سقف ضلع نمی‌گذرد', () => {
    const plan = planSatellite({
      minE: -20000, maxE: 20000, minN: -20000, maxN: 20000,
    }, toLatLon, { maxTiles: DETAIL_LEVELS.high.maxTiles });
    expect(plan.z).toBeLessThan(15);
    expect(plan.nx).toBeLessThanOrEqual(MAX_TILES_PER_SIDE);
    expect(plan.ny).toBeLessThanOrEqual(MAX_TILES_PER_SIDE);
  });
  it('محدوده‌ی نامعتبر یا تبدیل ناموفق خطای فارسی می‌دهد', () => {
    expect(() => planSatellite({
      minE: 0, maxE: 0, minN: 0, maxN: 10,
    }, toLatLon)).toThrow(/نامعتبر/);
    expect(() => planSatellite(BBOX, () => ({ lat: NaN, lon: NaN }))).toThrow(/ناموفق/);
  });
  it('tileRange و pickZoom با هم سازگارند', () => {
    const plan = planSatellite(BBOX, toLatLon);
    const r = tileRange(plan.bounds, plan.z);
    expect(r).toMatchObject({ x0: plan.x0, y0: plan.y0, nx: plan.nx, ny: plan.ny });
    expect(pickZoom(plan.bounds, 1_000_000, { maxZoom: 9 })).toBe(9);
  });
});

describe('planSatellite با پوشش کل محدوده‌ی معدن (extraEnu)', () => {
  // مدل پهباد کوچک (۱۰۰×۸۰ متر) در گوشه‌ای از یک محدوده‌ی ۲×۲ کیلومتری
  const SMALL = {
    minE: -50, maxE: 50, minN: -40, maxN: 40,
  };
  const MINE = [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]];

  it('بدون extraEnu فقط اطراف مدل پوشانده می‌شود (رفتار قبلی)', () => {
    const plan = planSatellite(SMALL, toLatLon);
    expect(plan.extentEnu.maxE).toBeLessThan(500);
    expect(plan.coversExtra).toBe(false);
  });
  it('با extraEnu کل محدوده‌ی معدن داخل extent و داخل بوم می‌افتد', () => {
    const plan = planSatellite(SMALL, toLatLon, { extraEnu: MINE });
    expect(plan.coversExtra).toBe(true);
    const ex = plan.extentEnu;
    expect(ex.minE).toBeLessThanOrEqual(-1000); expect(ex.maxE).toBeGreaterThanOrEqual(1000);
    expect(ex.minN).toBeLessThanOrEqual(-1000); expect(ex.maxN).toBeGreaterThanOrEqual(1000);
    MINE.forEach(([e, n]) => {
      const ll = toLatLon(e, n);
      const { u, v } = latLonToUv(plan, ll.lat, ll.lon);
      expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
    });
  });
  it('مدل کوچک هم داخل extent می‌ماند و از سقف کاشی/ضلع نمی‌گذرد (زوم پایین‌تر می‌آید)', () => {
    const near = planSatellite(SMALL, toLatLon);
    const wide = planSatellite(SMALL, toLatLon, { extraEnu: MINE });
    expect(wide.extentEnu.minE).toBeLessThanOrEqual(SMALL.minE); expect(wide.extentEnu.maxE).toBeGreaterThanOrEqual(SMALL.maxE);
    expect(wide.z).toBeLessThanOrEqual(near.z);
    expect(wide.tiles.length).toBeLessThanOrEqual(DETAIL_LEVELS.medium.maxTiles);
    expect(wide.nx).toBeLessThanOrEqual(MAX_TILES_PER_SIDE); expect(wide.ny).toBeLessThanOrEqual(MAX_TILES_PER_SIDE);
  });
  it('نقاط نامعتبر (NaN) نادیده گرفته می‌شوند و extent را خراب نمی‌کنند', () => {
    const plan = planSatellite(SMALL, toLatLon, { extraEnu: [[NaN, 5], [1, Infinity], null, 'x'] });
    expect(plan.coversExtra).toBe(false);
    expect(Number.isFinite(plan.extentEnu.minE)).toBe(true);
  });
});

describe('latLonToUv / latLonToCanvas / buildSatelliteGrid', () => {
  const plan = planSatellite(BBOX, toLatLon);
  it('گوشه‌ی بالا-چپ بوم UV (0,1) و پایین-راست (1,0)', () => {
    const tl = latLonToUv(plan, 0, 0); // فقط برای اطمینان از عدم کرش
    expect(Number.isFinite(tl.u)).toBe(true);
    // نقطه‌ی بالا-چپ بوم → لات/لون معکوس از پیکسل
    const scale = TILE_SIZE * 2 ** plan.z;
    const lon = ((plan.x0 * TILE_SIZE) / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * plan.y0 * TILE_SIZE) / scale;
    const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
    const a = latLonToUv(plan, lat, lon);
    expect(a.u).toBeCloseTo(0, 6); expect(a.v).toBeCloseTo(1, 6);
  });
  it('latLonToCanvas با latLonToUv هم‌خوان است (مبدأ بالا-چپ، y به سمت پایین)', () => {
    const ll = toLatLon(120, -60);
    const uv = latLonToUv(plan, ll.lat, ll.lon);
    const px = latLonToCanvas(plan, ll.lat, ll.lon);
    expect(px.x / plan.widthPx).toBeCloseTo(uv.u, 9);
    expect(px.y / plan.heightPx).toBeCloseTo(1 - uv.v, 9);
  });
  it('شبکه: تعداد رأس/ایندکس درست، ارتفاع ثابت، UV داخل ۰..۱ و شمال بالاتر ⇒ v بزرگ‌تر', () => {
    const g = buildSatelliteGrid(plan, toLatLon, 123.5, 8);
    expect(g.positions.length).toBe(9 * 9 * 3);
    expect(g.uvs.length).toBe(9 * 9 * 2);
    expect(g.indices.length).toBe(8 * 8 * 6);
    for (let k = 0; k < 81; k += 1) {
      expect(g.positions[k * 3 + 2]).toBeCloseTo(123.5, 4);
      expect(g.uvs[k * 2]).toBeGreaterThanOrEqual(-1e-6); expect(g.uvs[k * 2]).toBeLessThanOrEqual(1 + 1e-6);
      expect(g.uvs[k * 2 + 1]).toBeGreaterThanOrEqual(-1e-6); expect(g.uvs[k * 2 + 1]).toBeLessThanOrEqual(1 + 1e-6);
    }
    // ردیف اول (کمترین شمال) v کوچک‌تر از ردیف آخر (بیشترین شمال)
    expect(g.uvs[1]).toBeLessThan(g.uvs[(8 * 9) * 2 + 1]);
    // ایندکس‌ها در بازه‌ی رأس‌ها
    expect(Math.max(...g.indices)).toBe(80);
  });
  it('نقطه‌ی مرکز مدل (ENU صفر) به مرکز تقریبی بوم می‌افتد وقتی مدل وسط extent است', () => {
    const ll = toLatLon(0, 0);
    const { u, v } = latLonToUv(plan, ll.lat, ll.lon);
    expect(Math.abs(u - 0.5)).toBeLessThan(0.35);
    expect(Math.abs(v - 0.5)).toBeLessThan(0.35);
  });
});

describe('loadSatelliteTiles', () => {
  const plan = { z: 15, tiles: [0, 1, 2, 3, 4].map((i) => ({ x: i, y: 7, col: i, row: 0 })) };
  it('همه‌ی کاشی‌ها گرفته و کشیده می‌شوند و پیشرفت گزارش می‌شود', async () => {
    const drawn = []; const prog = [];
    const r = await loadSatelliteTiles(plan, async (t) => ({ id: t.x, url: t.url }), (img, c, rw) => drawn.push([img.id, c, rw]), {
      concurrency: 2, onProgress: (d, t) => prog.push([d, t]),
    });
    expect(r).toEqual({
      ok: 5, failed: 0, total: 5, aborted: false,
    });
    expect(drawn.map((d) => d[0]).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(prog.at(-1)).toEqual([5, 5]);
  });
  it('آدرس هر کاشی با قالب و z درست ساخته می‌شود', async () => {
    const urls = [];
    await loadSatelliteTiles(plan, async (t) => { urls.push(t.url); return {}; }, () => {});
    expect(urls).toContain(tileUrl(SATELLITE_TILE_URL, 15, 3, 7));
  });
  it('قالب دلخواه (مثلاً Esri برای حالت پشتیبان) رعایت می‌شود', async () => {
    const urls = [];
    await loadSatelliteTiles(plan, async (t) => { urls.push(t.url); return {}; }, () => {}, { template: ESRI_TILE_URL });
    expect(urls).toContain(tileUrl(ESRI_TILE_URL, 15, 3, 7));
    expect(urls.every((u) => u.startsWith('https://server.arcgisonline.com/'))).toBe(true);
  });
  it('کاشی ناموفق کل کار را نمی‌اندازد و در failed شمرده می‌شود', async () => {
    const r = await loadSatelliteTiles(plan, async (t) => { if (t.x % 2) throw new Error('404'); return {}; }, () => {});
    expect(r.ok).toBe(3); expect(r.failed).toBe(2); expect(r.total).toBe(5);
  });
  it('هم‌زمانی از سقف بیشتر نمی‌شود', async () => {
    let cur = 0; let max = 0;
    await loadSatelliteTiles(plan, async () => {
      cur += 1; max = Math.max(max, cur);
      await new Promise((res) => { setTimeout(res, 5); });
      cur -= 1; return {};
    }, () => {}, { concurrency: 2 });
    expect(max).toBeLessThanOrEqual(2);
  });
  it('لغو (signal) کار را متوقف می‌کند و aborted برمی‌گرداند', async () => {
    const signal = { aborted: false };
    const r = await loadSatelliteTiles(plan, async (t) => { if (t.x === 1) signal.aborted = true; return {}; }, () => {}, { concurrency: 1, signal });
    expect(r.aborted).toBe(true);
    expect(r.ok + r.failed).toBeLessThan(5);
  });
});

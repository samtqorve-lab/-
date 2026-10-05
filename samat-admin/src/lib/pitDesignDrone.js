// منبع توپوگرافی «مدل سه‌بعدی پهپاد» برای ابزار طراحی پله‌بندی.
//
// جریان: GLB خروجی ODM (samat-3d) → سطح ENU محلی (model3dScene.collectEnuMesh) → نمونه‌برداری شبکه‌ای منظم →
// نقاط [x,y,z] در UTM مطلق (با مبدأ CESIUM_RTC مدل) → همان buildSurface/designBenches که فایل توپوگرافی استفاده می‌کند.
//
// چرا شبکه‌ی منظم و نه رأس‌های خام مش؟ مدل پهپاد صدها هزار تا میلیون‌ها رأس دارد؛ مثلث‌بندی دوباره‌ی همه‌ی آن‌ها در
// buildSurface (Delaunay) روی موبایل سنگین است و برای طراحی پله‌بندی (مقیاس ده‌ها متر) جزئیات سانتی‌متری لازم نیست.
// نمونه‌برداری شبکه‌ای سقف تعداد نقطه را کنترل می‌کند و «ماسک پوشش» هم می‌دهد: مثلث‌بندی دوباره‌ی نقاط، حفره‌ها و
// بخش‌های فرورفته‌ی پوشش مدل را پر می‌کند (محدب می‌شود) و بدون ماسک نمی‌شود فهمید کجا داده‌ی واقعی است.
//
// ⚠️ ارتفاع‌ها همان ارتفاع مدل‌اند: اگر پرواز فقط GPS معمولی (EXIF) داشته باشد، ارتفاع «بیضوی‌وار» (نه از سطح دریا) و
// با خطای چند متری است. برای طراحی/حجم «نسبی» داخل خودِ مدل مشکلی ندارد، ولی تراز مطلق را با نقشه‌برداری رسمی تطبیق دهید.

import { heightAt } from './model3dAnalysis.js';
import { collectEnuMesh, detectUpAxis } from './model3dScene.js';
import {
  readRtcCenter, buildGeoref, checkGeorefConsistency,
} from './model3dGeo.js';

export const DRONE_SAMPLE_MAX_POINTS = 40_000;

/** نام‌های asset که برای طراحی مناسب‌اند، به ترتیب اولویت (مدل سبک ۳۵٪ مثلث کافی و خیلی سریع‌تر دانلود می‌شود) */
const ASSET_PREFERENCE = ['model_lod1.glb', 'model.glb'];

/**
 * کارهای آماده‌ی دارای مدل را از جدید به قدیم برمی‌گرداند.
 * پیش‌نمایش (GPS معمولی) هم می‌آید ولی `surveyGrade=false` علامت می‌خورد تا UI هشدار بدهد.
 * @param {Array<{jobId:string,status:string,mode?:string,georef?:string,assets?:string[],createdAt?:string}>} jobs
 */
export function eligibleDroneJobs(jobs) {
  return (jobs || [])
    .filter((j) => {
      if (j.status !== 'done') return false;
      const assets = j.assets && j.assets.length ? j.assets : ['model.glb'];
      return ASSET_PREFERENCE.some((a) => assets.includes(a));
    })
    .map((j) => ({ ...j, surveyGrade: j.mode === 'survey' || j.mode === 'merge' }))
    .sort((a, b) => (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0));
}

/** کدام asset برای طراحی دانلود شود: مدل سبک اگر هست، وگرنه کامل */
export function pickDroneAsset(job) {
  const assets = job.assets && job.assets.length ? job.assets : ['model.glb'];
  return ASSET_PREFERENCE.find((a) => assets.includes(a)) || 'model.glb';
}

/**
 * سطح ENU محلی را به نقاط UTM مطلق + ماسک پوشش تبدیل می‌کند (بدون THREE؛ در Node تست‌پذیر).
 * @param {object} surface خروجی buildSurface از model3dAnalysis.js (surface.bbox در ENU محلی)
 * @param {[number, number, number]} rtc مبدأ UTM مدل (CESIUM_RTC)
 * @returns {{ points: number[][], spacing: number, bboxUtm: {minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number},
 *             isCovered: (x:number,y:number)=>boolean, coverageFraction: number }}
 */
export function sampleSurfaceToUtmPoints(surface, rtc, { maxPoints = DRONE_SAMPLE_MAX_POINTS, minSpacing = 0.5 } = {}) {
  const b = surface.bbox;
  const w = b.maxX - b.minX; const h = b.maxY - b.minY;
  if (!(w > 0) || !(h > 0)) throw new Error('محدوده‌ی مدل نامعتبر است');
  const spacing = Math.max(minSpacing, Math.sqrt((w * h) / Math.max(1000, maxPoints)));
  const nx = Math.floor(w / spacing) + 1;
  const ny = Math.floor(h / spacing) + 1;
  const valid = new Uint8Array(nx * ny);
  const points = [];
  let minZ = Infinity; let maxZ = -Infinity;
  for (let j = 0; j < ny; j += 1) {
    const n = b.minY + j * spacing;
    for (let i = 0; i < nx; i += 1) {
      const e = b.minX + i * spacing;
      const u = heightAt(surface, e, n);
      if (!Number.isFinite(u)) continue;
      valid[j * nx + i] = 1;
      const z = u + rtc[2];
      points.push([e + rtc[0], n + rtc[1], z]);
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  if (points.length < 4) throw new Error('مدل پوشش کافی برای ساخت سطح ندارد');

  const originX = b.minX + rtc[0]; const originY = b.minY + rtc[1];
  // نقطه پوشیده است اگر یکی از چهار گره‌ی دور سلولش مقدار معتبر داشته باشد
  const isCovered = (x, y) => {
    const fi = (x - originX) / spacing; const fj = (y - originY) / spacing;
    if (fi < -0.5 || fj < -0.5 || fi > nx - 0.5 || fj > ny - 0.5) return false;
    const i0 = Math.floor(fi); const j0 = Math.floor(fj);
    for (let dj = 0; dj <= 1; dj += 1) {
      for (let di = 0; di <= 1; di += 1) {
        const i = i0 + di; const j = j0 + dj;
        if (i >= 0 && j >= 0 && i < nx && j < ny && valid[j * nx + i]) return true;
      }
    }
    return false;
  };
  return {
    points,
    spacing,
    bboxUtm: {
      minX: originX, maxX: b.maxX + rtc[0], minY: originY, maxY: b.maxY + rtc[1], minZ, maxZ,
    },
    isCovered,
    coverageFraction: points.length / (nx * ny),
  };
}

function disposeGltf(g) {
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (m) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

/**
 * GLB رمزگشایی‌شده‌ی یک پرواز را می‌خواند و توپوگرافی طراحی را می‌سازد. فقط در مرورگر (Three.js + Draco)؛
 * Three.js فقط همین‌جا و با dynamic import لود می‌شود تا باز شدن صفحه‌ی طراحی سنگین نشود.
 * @param {Blob} blob
 * @param {{ corners?: Array<[number,number]>, crs?: string, maxPoints?: number }} [opts]
 * @returns {Promise<{ points:number[][], spacing:number, bboxUtm:object, isCovered:Function, coverageFraction:number,
 *                     rtc:number[], zone:number|null, hemisphere:string|null, zoneSource:string|null,
 *                     triangleCount:number, warnings:string[] }>}
 */
export async function loadDroneTerrain(blob, { corners = [], crs, maxPoints = DRONE_SAMPLE_MAX_POINTS } = {}) {
  const [THREE, { GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
  ]);
  // همان تنظیم نمایشگر مدل: ODM با Draco می‌نویسد و رمزگشا از public/draco/ همین origin لود می‌شود
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  draco.setDecoderConfig({ type: 'wasm' });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  let gltf;
  try {
    gltf = await new Promise((resolve, reject) => {
      blob.arrayBuffer().then((buf) => loader.parse(buf, '', resolve, reject), reject);
    });
  } catch (err) {
    draco.dispose();
    throw new Error(`خواندن مدل ناموفق بود: ${(err && err.message) || err}`);
  }
  try {
    const rtc = readRtcCenter(gltf.parser && gltf.parser.json);
    if (!rtc) {
      throw new Error('این مدل موقعیت جغرافیایی (CESIUM_RTC) ندارد؛ برای طراحی در مختصات واقعی، مدل نقشه‌برداری/دوباره‌ساخته‌شده لازم است');
    }
    const holder = new THREE.Group();
    holder.add(gltf.scene);
    const upAxis = detectUpAxis(THREE, gltf.scene);
    const { surface, bboxEnu } = collectEnuMesh(THREE, holder, upAxis);
    const sampled = sampleSurfaceToUtmPoints(surface, rtc, { maxPoints });
    const georef = buildGeoref({ rtc, crs, corners });
    const warnings = [];
    if (!georef) {
      warnings.push('زون UTM مدل مشخص نیست (EPSG ثبت‌نشده و گوشه‌ی پروانه‌ی معدن هم ندارد)؛ گمانه‌ها و مرز پروانه روی نقشه نمی‌نشینند.');
    } else {
      const chk = checkGeorefConsistency(georef, bboxEnu, corners);
      if (chk && chk.status !== 'ok') {
        warnings.push(`مرکز مدل ${(chk.distance / 1000).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} کیلومتر با پروانه‌ی معدن فاصله دارد — زون یا موقعیت مدل را بررسی کنید.`);
      }
    }
    return {
      ...sampled,
      rtc,
      zone: georef ? georef.zone : null,
      hemisphere: georef ? georef.hemisphere : null,
      zoneSource: georef ? georef.zoneSource : null,
      triangleCount: surface.triangleCount,
      warnings,
    };
  } finally {
    disposeGltf(gltf);
    draco.dispose();
  }
}

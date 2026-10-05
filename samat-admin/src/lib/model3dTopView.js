// نمای از بالای مدل سه‌بعدی پهباد به‌صورت تصویر زمین‌مرجع برای نمایش روی «نقشه‌ی معادن» (Leaflet، دوبعدی).
//
// چرا رندر در فضای مرکاتور؟ Leaflet تصویر را بین دو گوشه‌ی (جنوب‌غرب، شمال‌شرق) در سیستم Web-Mercator «خطی» می‌کشد؛ ولی مدل
// پهباد در شبکه‌ی UTM است و شبکه‌ی UTM نسبت به شمال جغرافیایی چند درجه چرخش دارد (در قروه ≈ ۱٫۶°، یعنی حدود ۲۸ متر روی ۱ کیلومتر).
// پس رأس‌های مدل را یک‌به‌یک به طول/عرض جغرافیایی و از آنجا به مختصات مرکاتور می‌بریم و با دوربین موازی (orthographic)
// از بالا رندر می‌کنیم؛ تصویر خروجی دقیقاً در همان فضایی است که Leaflet می‌کشد، بدون چرخش یا کشیدگی.
//
// ⚠️ این نمای «از بالا» است و ارتفاع/شیب را نشان نمی‌دهد؛ برای دیدن سه‌بعدی، نمایشگر سه‌بعدی را باز کنید.

import { enuFromLocal, detectUpAxis } from './model3dScene.js';
import { enuToUtm, enuToLatLon } from './model3dGeo.js';
import { utmToLatLon } from './utm.js';

const R = 6378137;
const MAX_LAT = 85.0511287798;
const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/** مرکاتور کروی بی‌بعد (رادیان): x = lon, y = ln tan(π/4 + φ/2) — همان فضای خطیِ Leaflet/Web-Mercator */
export function mercatorXY(lat, lon) {
  const phi = (clampLat(lat) * Math.PI) / 180;
  return { x: (lon * Math.PI) / 180, y: Math.log(Math.tan(Math.PI / 4 + phi / 2)) };
}

export function mercatorInverse(x, y) {
  return {
    lat: ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI,
    lon: (x * 180) / Math.PI,
  };
}

/** محدوده‌ی lat/lon از محدوده‌ی مرکاتور: {south, west, north, east} */
export function boundsFromMercator(b) {
  const sw = mercatorInverse(b.minX, b.minY);
  const ne = mercatorInverse(b.maxX, b.maxY);
  return {
    south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon,
  };
}

/** ابعاد پیکسلی تصویر با حفظ نسبت (ضلع بلند = maxPx) */
export function imageSizeFor(b, maxPx) {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (!(w > 0) || !(h > 0)) throw new Error('محدوده‌ی مدل نامعتبر است');
  const long = Math.max(16, Math.floor(maxPx));
  return w >= h
    ? { width: long, height: Math.max(1, Math.round((long * h) / w)) }
    : { width: Math.max(1, Math.round((long * w) / h)), height: long };
}

/**
 * رأس‌های همه‌ی مش‌های مدل را به فضای مرکاتور می‌برد: (x=lon, y=merc, z=ارتفاع به همان مقیاس).
 * هندسه‌ی تازه می‌سازد؛ مدل اصلی دست‌نخورده می‌ماند. UV و ایندکس و متریال (بافت) همان اصل‌اند.
 * @returns {{ meshes: Array<{ geometry: object, map: object|null, color: object|null }>,
 *             origin: {x:number,y:number,z:number}, // مختصات هر رأس نسبت به این مرکز ذخیره شده است
 *             bounds: {minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number} }}
 */
export function buildMercatorMeshes(THREE, gltfScene, georef) {
  gltfScene.updateMatrixWorld(true);
  const upAxis = detectUpAxis(THREE, gltfScene);
  const v = new THREE.Vector3();
  const raw = [];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  gltfScene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    // Float64 تا لحظه‌ی آخر: مختصات مرکاتور (≈ ۰٫۸ رادیان) در Float32 فقط ≈ ۰٫۴ متر دقت دارد
    const arr = new Float64Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const [e, n, u] = enuFromLocal(upAxis, v.x, v.y, v.z);
      const utm = enuToUtm(georef, e, n, u);
      const ll = utmToLatLon(georef.zone, georef.hemisphere, utm.easting, utm.northing);
      const m = mercatorXY(ll.lat, ll.lon);
      const z = utm.elevation / R; // متر → رادیان زمینی؛ فقط برای ترتیب عمق
      arr[i * 3] = m.x; arr[i * 3 + 1] = m.y; arr[i * 3 + 2] = z;
      if (m.x < minX) minX = m.x; if (m.x > maxX) maxX = m.x;
      if (m.y < minY) minY = m.y; if (m.y > maxY) maxY = m.y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    raw.push({ o, arr });
  });
  if (!raw.length) throw new Error('مدل هیچ مشی ندارد');
  // مختصات نسبت به مرکز محدوده ذخیره می‌شود (origin) تا Float32 دقت زیرپیکسل بدهد؛ مرکز به مختصات مطلق برمی‌گردد
  const origin = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: minZ };
  const out = raw.map(({ o, arr }) => {
    const rel = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i += 3) {
      rel[i] = arr[i] - origin.x; rel[i + 1] = arr[i + 1] - origin.y; rel[i + 2] = arr[i + 2] - origin.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(rel, 3));
    if (o.geometry.attributes.uv) g.setAttribute('uv', o.geometry.attributes.uv.clone());
    if (o.geometry.attributes.color) g.setAttribute('color', o.geometry.attributes.color.clone());
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    const mat = o.material;
    return {
      geometry: g,
      map: (mat && mat.map) || null,
      color: mat && mat.color ? mat.color.clone() : null,
      vertexColors: !!o.geometry.attributes.color,
    };
  });
  return {
    meshes: out,
    origin,
    bounds: {
      minX, maxX, minY, maxY, minZ, maxZ,
    },
  };
}

/**
 * مدل را از بالا رندر می‌کند و PNG شفاف (فقط ناحیه‌ی مدل) به‌همراه محدوده‌ی جغرافیایی برمی‌گرداند.
 * @param {object} THREE
 * @param {object} gltfScene gltf.scene
 * @param {object} georef خروجی buildGeoref
 * @param {{ maxPx?: number }} [opts]
 * @returns {Promise<{ blob: Blob, width: number, height: number, bounds: {south:number,west:number,north:number,east:number} }>}
 */
export async function renderTopView(THREE, gltfScene, georef, { maxPx = 2048 } = {}) {
  const { meshes, bounds, origin } = buildMercatorMeshes(THREE, gltfScene, georef);
  const { width, height } = imageSizeFor(bounds, maxPx);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  const created = [];
  try {
    const cap = renderer.capabilities && renderer.capabilities.maxTextureSize;
    const w = cap ? Math.min(width, cap) : width;
    const h = cap ? Math.min(height, cap) : height;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    meshes.forEach((m) => {
      const mat = new THREE.MeshBasicMaterial({
        map: m.map || null,
        color: m.map ? 0xffffff : (m.color || 0xcccccc),
        vertexColors: m.vertexColors,
        side: THREE.DoubleSide,
      });
      created.push(mat, m.geometry);
      scene.add(new THREE.Mesh(m.geometry, mat));
    });
    const unit = 1e-6; // ≈ ۶ متر در مقیاس رادیان؛ فقط حاشیه‌ی ایمنی عمق
    const dz = bounds.maxZ - bounds.minZ; // رأس‌ها نسبت به origin ذخیره شده‌اند: z از ۰ تا dz
    const camera = new THREE.OrthographicCamera(
      bounds.minX - origin.x, bounds.maxX - origin.x, bounds.maxY - origin.y, bounds.minY - origin.y, 0, dz + 4 * unit,
    );
    camera.position.set(0, 0, dz + 2 * unit);
    camera.lookAt(0, 0, -2 * unit);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const blob = await new Promise((resolve, reject) => {
      renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('ساخت تصویر ناموفق بود'))), 'image/png');
    });
    return {
      blob, width: w, height: h, bounds: boundsFromMercator(bounds),
    };
  } finally {
    created.forEach((x) => { if (x.dispose) x.dispose(); });
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
  }
}

// برای تست‌ها: تبدیل ENU → مرکاتور با همان مسیر (بدون THREE)
export function enuToMercator(georef, e, n) {
  const ll = enuToLatLon(georef, e, n);
  return mercatorXY(ll.lat, ll.lon);
}

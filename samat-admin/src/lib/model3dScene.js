// پل بین صحنه‌ی Three.js نمایشگر پهباد و تحلیل‌های خالص (model3dAnalysis.js / model3dGeo.js).
// THREE از بیرون تزریق می‌شود (dynamic import در model3dViewer.js) تا کتابخانه‌ی سنگین فقط هنگام باز شدن نمایشگر لود شود،
// و همین‌طور بدون مرورگر (در Node) قابل‌تست است.
//
// قرارداد: «holder» گروه والدِ مدل است؛ فضای «محلی holder» همان فضای glTF (بعد از تبدیل گره‌ها) است. دو حالت بالا:
//   upAxis 'z' → خروجی ODM: x=شرق، y=شمال، z=بالا          (ENU = محلی)
//   upAxis 'y' → glTF استاندارد: x=شرق، y=بالا، z=−شمال      (ENU = (x, −z, y))
// چرخش دیداریِ holder (دکمه‌ی 🔄) روی تحلیل اثری ندارد، چون همه‌چیز از فضای محلی holder به ENU می‌رود.

import { buildSurface, densifyPath, heightAt } from './model3dAnalysis.js';

/** سقف مثلث برای تحلیل روی دستگاه؛ بیشتر از این حافظه‌ی موبایل را می‌ترکاند و باید از مدل سبک (LOD) استفاده شود */
export const MAX_ANALYSIS_TRIANGLES = 3_000_000;

/** تشخیص محور بالا: کوچک‌ترین بُعد مدل (زمین) باید عمودی باشد؛ اگر z بود یعنی خروجی ODM */
export function detectUpAxis(THREE, root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  return (size.z < size.y && size.z < size.x) ? 'z' : 'y';
}

export function enuFromLocal(upAxis, x, y, z) {
  return upAxis === 'z' ? [x, y, z] : [x, -z, y];
}

export function localFromEnu(upAxis, e, n, u) {
  return upAxis === 'z' ? [e, n, u] : [e, u, -n];
}

/** نقطه‌ی جهانیِ صحنه → ENU محلی [e, n, u] */
export function sceneToEnu(THREE, holder, upAxis, worldPoint) {
  holder.updateMatrixWorld(true);
  const l = holder.worldToLocal(worldPoint.clone());
  return enuFromLocal(upAxis, l.x, l.y, l.z);
}

/** ENU محلی → نقطه‌ی جهانیِ صحنه (THREE.Vector3) */
export function enuToScene(THREE, holder, upAxis, e, n, u) {
  holder.updateMatrixWorld(true);
  const [x, y, z] = localFromEnu(upAxis, e, n, u);
  return holder.localToWorld(new THREE.Vector3(x, y, z));
}

/**
 * همه‌ی مش‌های زیر holder را به یک سطحِ ENU واحد تبدیل می‌کند (برای میان‌یابی ارتفاع، حجم، مقطع، شیب).
 * @returns {{ surface: object, parts: Array<{mesh: object, start: number, count: number}>,
 *             bboxEnu: {minE:number,maxE:number,minN:number,maxN:number,minU:number,maxU:number} }}
 */
export function collectEnuMesh(THREE, holder, upAxis) {
  holder.updateMatrixWorld(true);
  const meshes = [];
  // لایه‌های کمکی (مثل تصویر ماهواره‌ای زیر مدل) با userData.excludeFromAnalysis علامت می‌خورند و جزو سطح تحلیل نیستند
  holder.traverse((o) => {
    if (o.isMesh && !o.userData.excludeFromAnalysis && o.geometry && o.geometry.attributes.position) meshes.push(o);
  });
  if (!meshes.length) throw new Error('مدل هیچ مشی ندارد');

  let totalV = 0; let totalI = 0;
  meshes.forEach((m) => {
    totalV += m.geometry.attributes.position.count;
    totalI += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
  });
  if (totalI / 3 > MAX_ANALYSIS_TRIANGLES) {
    throw new Error(`مدل برای تحلیل روی این دستگاه خیلی سنگین است (${Math.round(totalI / 3e6 * 10) / 10} میلیون مثلث). مدل سبک (LOD) را باز کنید`);
  }

  const coords = new Float64Array(totalV * 2);
  const zv = new Float64Array(totalV);
  const tris = new Uint32Array(totalI - (totalI % 3));
  const parts = [];
  const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let vo = 0; let io = 0;
  meshes.forEach((mesh) => {
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      const k = vo + i;
      if (upAxis === 'z') { coords[k * 2] = v.x; coords[k * 2 + 1] = v.y; zv[k] = v.z; } else { coords[k * 2] = v.x; coords[k * 2 + 1] = -v.z; zv[k] = v.y; }
    }
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    const usable = n - (n % 3);
    for (let k = 0; k < usable; k += 1) tris[io + k] = (idx ? idx.getX(k) : k) + vo;
    parts.push({ mesh, start: vo, count: pos.count });
    vo += pos.count;
    io += usable;
  });
  const surface = buildSurface(coords, tris.subarray(0, io), zv);
  const b = surface.bbox;
  return {
    surface,
    parts,
    bboxEnu: {
      minE: b.minX, maxE: b.maxX, minN: b.minY, maxN: b.maxY, minU: b.minZ, maxU: b.maxZ,
    },
  };
}

/**
 * یک مسیر ENU (نقاط [e,n]) را روی سطح مدل «می‌چسباند» و به‌صورت LineSegments برمی‌گرداند؛ جاهایی که مسیر از مدل
 * بیرون می‌زند خودکار قطع می‌شود. lift: چند متر بالاتر از سطح تا زیر مش گم نشود.
 * @returns {object|null} THREE.LineSegments، یا null اگر هیچ بخشی از مسیر روی مدل نبود
 */
export function drapedLine(THREE, holder, upAxis, surface, pathEnu, {
  closed = false, color = 0xff3b30, step = 1, lift = 0.2, heightFn = null,
} = {}) {
  const pts = densifyPath(pathEnu, step, closed);
  // heightFn (اختیاری): ارتفاعِ دلخواه برای هر نقطه، مثلاً سطح برون‌یابی‌شده بیرون از پوشش مدل؛ بدون آن، مسیر فقط
  // روی خودِ مدل رسم می‌شود و بیرون از آن قطع می‌شود.
  const hOf = heightFn || ((e, n) => heightAt(surface, e, n));
  const heights = pts.map(([e, n]) => hOf(e, n));
  const onModelCount = heightFn ? pts.filter(([e, n]) => Number.isFinite(heightAt(surface, e, n))).length : null;
  const positions = [];
  const seg = (i, j) => {
    [i, j].forEach((k) => {
      const p = enuToScene(THREE, holder, upAxis, pts[k][0], pts[k][1], heights[k] + lift);
      positions.push(p.x, p.y, p.z);
    });
  };
  let valid = 0; let total = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    total += 1;
    if (Number.isFinite(heights[i]) && Number.isFinite(heights[i + 1])) { seg(i, i + 1); valid += 1; }
  }
  if (closed && pts.length > 1) {
    const last = pts.length - 1;
    total += 1;
    if (Number.isFinite(heights[last]) && Number.isFinite(heights[0])) { seg(last, 0); valid += 1; }
  }
  if (!positions.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
  line.renderOrder = 997;
  line.userData.coverage = total ? valid / total : 0; // سهمی از مسیر که رسم شده است
  // سهم نقاط مسیر که واقعاً روی خودِ مدل‌اند (بقیه با heightFn روی سطح برون‌یابی‌شده رسم شده‌اند)
  line.userData.onModel = onModelCount === null ? line.userData.coverage : onModelCount / pts.length;
  return line;
}

/**
 * لایه‌ی رنگ روی مدل (شیب، نقشه‌ی تغییر): رنگ هر رأس را جایگزین بافت می‌کند و restore حالت اصلی را برمی‌گرداند.
 * فقط یک لایه فعال است؛ apply دوباره حالت قبلی را بدون از دست رفتن اصل (بافت/رنگ رأس اولیه) عوض می‌کند.
 */
export function createColorLayer(THREE, parts) {
  const originals = new Map();
  let active = false;

  function save(mesh) {
    if (originals.has(mesh)) return;
    const m = mesh.material;
    originals.set(mesh, {
      map: m.map || null,
      color: m.color ? m.color.clone() : null,
      vertexColors: !!m.vertexColors,
      colorAttr: mesh.geometry.attributes.color || null,
    });
  }

  return {
    get active() { return active; },
    /** @param {Float32Array} colors سه عدد (r,g,b) برای هر رأس مجموعِ همه‌ی مش‌ها (همان ترتیب parts) */
    apply(colors) {
      parts.forEach(({ mesh, start, count }) => {
        save(mesh);
        const slice = Float32Array.from(colors.subarray(start * 3, (start + count) * 3));
        mesh.geometry.setAttribute('color', new THREE.BufferAttribute(slice, 3));
        const m = mesh.material;
        m.map = null;
        if (m.color) m.color.set(0xffffff);
        m.vertexColors = true;
        m.needsUpdate = true;
      });
      active = true;
    },
    restore() {
      originals.forEach((o, mesh) => {
        const m = mesh.material;
        m.map = o.map;
        if (o.color && m.color) m.color.copy(o.color);
        m.vertexColors = o.vertexColors;
        if (o.colorAttr) mesh.geometry.setAttribute('color', o.colorAttr);
        else mesh.geometry.deleteAttribute('color');
        m.needsUpdate = true;
      });
      active = false;
    },
  };
}

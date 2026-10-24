// خروجی‌گرفتن از مدل سه‌بعدی پهباد (GLB خروجی OpenDroneMap) در قالب‌های دیگر: OBJ، STL، PLY، DXF، LandXML، XYZ.
//
// دو بخش دارد:
//  ۱) سازنده‌های خالص (بدون DOM و بدون THREE) که از ساختار ساده‌ی `data` فایل می‌سازند و در Node تست می‌شوند.
//  ۲) extractExportMeshes: فقط در مرورگر (THREE تزریق می‌شود) مش‌های صحنه را به همان ساختار ساده تبدیل می‌کند.
//
// قرارداد مختصات: همه‌ی خروجی‌ها دستگاه راست‌گرد با Z بالا هستند (X=شرق، Y=شمال، Z=ارتفاع)، یعنی همان ENU محلی
// مدل. اگر offset داده شود (مرکز RTC مدل = مبدأ UTM) به همه‌ی رأس‌ها اضافه می‌شود تا مختصات UTM مطلق شوند.
// STL و PLY (حالت float) با دقت ۳۲بیتی‌اند؛ برای همین فقط با مختصات محلی توصیه می‌شوند (UTM حدود ۵ میلیون متر
// شمالی با float32 دقتی در حد نیم‌متر دارد). PLY در حالت UTM خودکار double می‌نویسد.
//
// ساختار data:
//   meshes:    [{ positions: Float64Array(3n), indices: Uint32Array, uvs: Float32Array(2n)|null, colors: Uint8Array(3n)|null, material: number }]
//   materials: [{ name: string, color: [r,g,b] (۰..۱), texture: string|null }]
//   textures:  [{ name: string, bytes: Uint8Array }]   (JPEG)

import { buildZip } from './zipStore.js';

/** سقف مثلث برای ساخت خروجی روی دستگاه: قالب‌های متنی خیلی پرحجم‌اند (چند صد بایت برای هر مثلث) */
export const MAX_TEXT_TRIANGLES = 2_000_000;
export const MAX_BINARY_TRIANGLES = 10_000_000;

export const EXPORT_FORMATS = [
  {
    id: 'obj', label: 'OBJ', ext: 'obj', text: true, needsTextures: true, wantsColors: false,
    desc: 'با بافت و رنگ عکس‌ها (ZIP شامل obj + mtl + عکس) — بلندر، MeshLab، CloudCompare',
  },
  {
    id: 'stl', label: 'STL', ext: 'stl', text: false, needsTextures: false, wantsColors: false,
    desc: 'فقط شکل، بدون رنگ — چاپ سه‌بعدی و نرم‌افزارهای CAD',
  },
  {
    id: 'ply', label: 'PLY', ext: 'ply', text: false, needsTextures: false, wantsColors: true,
    desc: 'شکل + رنگ رأس‌ها (از بافت عکس‌ها) — CloudCompare، MeshLab',
  },
  {
    id: 'dxf', label: 'DXF', ext: 'dxf', text: true, needsTextures: false, wantsColors: false,
    desc: 'مثلث‌های 3DFACE — اتوکد و نقشه‌برداری (مختصات UTM پیشنهاد می‌شود)',
  },
  {
    id: 'landxml', label: 'LandXML', ext: 'xml', text: true, needsTextures: false, wantsColors: false,
    desc: 'سطح TIN — Civil 3D و نرم‌افزارهای نقشه‌برداری/راه (مختصات UTM پیشنهاد می‌شود)',
  },
  {
    id: 'xyz', label: 'XYZ', ext: 'xyz', text: true, needsTextures: false, wantsColors: true,
    desc: 'فقط نقاط رأس (E N Z و در صورت وجود رنگ) — Surfer، CloudCompare، اکسل',
  },
];

export const getExportFormat = (id) => EXPORT_FORMATS.find((f) => f.id === id) || null;

export function countTriangles(data) {
  return data.meshes.reduce((s, m) => s + Math.floor(m.indices.length / 3), 0);
}

export function countVertices(data) {
  return data.meshes.reduce((s, m) => s + m.positions.length / 3, 0);
}

// ───────────────────────── کمک‌ها ─────────────────────────

const f3 = (v) => v.toFixed(3);
const off3 = (offset) => (offset || [0, 0, 0]);

/** نویسنده‌ی متن: رشته‌ها را تکه‌تکه به Uint8Array تبدیل می‌کند تا حافظه‌ی رشته‌های عظیم نسازد */
function createTextWriter(limit = 1 << 20) {
  const enc = new TextEncoder();
  const chunks = [];
  let buf = [];
  let len = 0;
  return {
    push(s) {
      buf.push(s);
      len += s.length;
      if (len >= limit) { chunks.push(enc.encode(buf.join(''))); buf = []; len = 0; }
    },
    finish() {
      if (buf.length) chunks.push(enc.encode(buf.join('')));
      buf = [];
      return chunks;
    },
  };
}

const safeName = (s, fallback) => (String(s || '').replace(/[^A-Za-z0-9_.-]/g, '_') || fallback);

// ───────────────────────── OBJ ─────────────────────────

/**
 * @returns {{ obj: Uint8Array[], mtl: Uint8Array[]|null }} mtl فقط وقتی متریال/بافتی هست
 */
export function buildObj(data, { offset = null, mtlName = 'model.mtl' } = {}) {
  const [ox, oy, oz] = off3(offset);
  const useMtl = data.materials.length > 0 && data.textures.length > 0;
  const w = createTextWriter();
  w.push('# SAMAT 3D model export\n# X=East Y=North Z=Up (metres)\n');
  if (offset) w.push('# coordinates are absolute UTM (easting northing elevation)\n');
  if (useMtl) w.push(`mtllib ${mtlName}\n`);
  let base = 0;
  data.meshes.forEach((m, k) => {
    const n = m.positions.length / 3;
    const mat = data.materials[m.material];
    const textured = !!(useMtl && mat && mat.texture && m.uvs);
    const colored = !textured && !!m.colors;
    w.push(`o mesh_${k}\n`);
    const p = m.positions;
    for (let i = 0; i < n; i += 1) {
      const line = `v ${f3(p[i * 3] + ox)} ${f3(p[i * 3 + 1] + oy)} ${f3(p[i * 3 + 2] + oz)}`;
      w.push(colored
        ? `${line} ${(m.colors[i * 3] / 255).toFixed(4)} ${(m.colors[i * 3 + 1] / 255).toFixed(4)} ${(m.colors[i * 3 + 2] / 255).toFixed(4)}\n`
        : `${line}\n`);
    }
    if (textured) {
      for (let i = 0; i < n; i += 1) w.push(`vt ${m.uvs[i * 2].toFixed(6)} ${(1 - m.uvs[i * 2 + 1]).toFixed(6)}\n`); // مبدأ v در OBJ پایین است، در glTF بالا
    }
    if (useMtl && mat) w.push(`usemtl ${safeName(mat.name, `mat_${m.material}`)}\n`);
    const idx = m.indices;
    const usable = idx.length - (idx.length % 3);
    for (let t = 0; t < usable; t += 3) {
      const a = base + idx[t] + 1; const b = base + idx[t + 1] + 1; const c = base + idx[t + 2] + 1;
      w.push(textured ? `f ${a}/${a} ${b}/${b} ${c}/${c}\n` : `f ${a} ${b} ${c}\n`);
    }
    base += n;
  });
  const obj = w.finish();
  let mtl = null;
  if (useMtl) {
    const mw = createTextWriter();
    mw.push('# SAMAT 3D model export\n');
    data.materials.forEach((mat, i) => {
      const c = mat.color || [0.8, 0.8, 0.8];
      mw.push(`newmtl ${safeName(mat.name, `mat_${i}`)}\nKa 1.000 1.000 1.000\nKd ${c[0].toFixed(4)} ${c[1].toFixed(4)} ${c[2].toFixed(4)}\nKs 0.000 0.000 0.000\nillum 1\n`);
      if (mat.texture) mw.push(`map_Kd ${mat.texture}\n`);
    });
    mtl = mw.finish();
  }
  return { obj, mtl };
}

// ───────────────────────── STL (باینری) ─────────────────────────

export function buildStl(data, { offset = null } = {}) {
  const [ox, oy, oz] = off3(offset);
  const total = countTriangles(data);
  const header = new Uint8Array(84);
  header.set(new TextEncoder().encode('SAMAT 3D model export - binary STL'));
  new DataView(header.buffer).setUint32(80, total, true);
  const parts = [header];
  const PER = 50_000;
  let buf = null; let dv = null; let filled = 0;
  const open = () => { buf = new ArrayBuffer(PER * 50); dv = new DataView(buf); filled = 0; };
  const close = () => { if (filled) parts.push(new Uint8Array(buf, 0, filled * 50)); buf = null; };
  open();
  data.meshes.forEach((m) => {
    const p = m.positions; const idx = m.indices;
    const usable = idx.length - (idx.length % 3);
    for (let t = 0; t < usable; t += 3) {
      const ia = idx[t] * 3; const ib = idx[t + 1] * 3; const ic = idx[t + 2] * 3;
      const ax = p[ia] + ox; const ay = p[ia + 1] + oy; const az = p[ia + 2] + oz;
      const bx = p[ib] + ox; const by = p[ib + 1] + oy; const bz = p[ib + 2] + oz;
      const cx = p[ic] + ox; const cy = p[ic + 1] + oy; const cz = p[ic + 2] + oz;
      const ux = bx - ax; const uy = by - ay; const uz = bz - az;
      const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
      let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = filled * 50;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true);
      dv.setFloat32(o + 24, bx, true); dv.setFloat32(o + 28, by, true); dv.setFloat32(o + 32, bz, true);
      dv.setFloat32(o + 36, cx, true); dv.setFloat32(o + 40, cy, true); dv.setFloat32(o + 44, cz, true);
      dv.setUint16(o + 48, 0, true);
      filled += 1;
      if (filled === PER) { close(); open(); }
    }
  });
  close();
  return parts;
}

// ───────────────────────── PLY (باینری) ─────────────────────────

/** @param {{ offset?: number[]|null, double?: boolean }} opts double: مختصات ۶۴بیتی (پیش‌فرض: با offset فعال) */
export function buildPly(data, { offset = null, double = !!offset } = {}) {
  const [ox, oy, oz] = off3(offset);
  const V = countVertices(data);
  const F = countTriangles(data);
  const hasColors = data.meshes.some((m) => m.colors);
  const type = double ? 'double' : 'float';
  const head = [
    'ply', 'format binary_little_endian 1.0', 'comment SAMAT 3D model export - X=East Y=North Z=Up (metres)',
    ...(offset ? ['comment coordinates are absolute UTM'] : []),
    `element vertex ${V}`, `property ${type} x`, `property ${type} y`, `property ${type} z`,
    ...(hasColors ? ['property uchar red', 'property uchar green', 'property uchar blue'] : []),
    `element face ${F}`, 'property list uchar int vertex_indices', 'end_header', '',
  ].join('\n');
  const parts = [new TextEncoder().encode(head)];
  const coordBytes = double ? 8 : 4;
  const vStride = coordBytes * 3 + (hasColors ? 3 : 0);
  const PER = 50_000;

  data.meshes.forEach((m) => {
    const n = m.positions.length / 3;
    const p = m.positions;
    for (let s = 0; s < n; s += PER) {
      const e = Math.min(n, s + PER);
      const buf = new ArrayBuffer((e - s) * vStride);
      const dv = new DataView(buf);
      let o = 0;
      for (let i = s; i < e; i += 1) {
        const x = p[i * 3] + ox; const y = p[i * 3 + 1] + oy; const z = p[i * 3 + 2] + oz;
        if (double) { dv.setFloat64(o, x, true); dv.setFloat64(o + 8, y, true); dv.setFloat64(o + 16, z, true); } else { dv.setFloat32(o, x, true); dv.setFloat32(o + 4, y, true); dv.setFloat32(o + 8, z, true); }
        o += coordBytes * 3;
        if (hasColors) {
          const c = m.colors;
          dv.setUint8(o, c ? c[i * 3] : 200); dv.setUint8(o + 1, c ? c[i * 3 + 1] : 200); dv.setUint8(o + 2, c ? c[i * 3 + 2] : 200);
          o += 3;
        }
      }
      parts.push(new Uint8Array(buf));
    }
  });

  let base = 0;
  data.meshes.forEach((m) => {
    const idx = m.indices;
    const usable = Math.floor(idx.length / 3) * 3;
    for (let s = 0; s < usable; s += PER * 3) {
      const e = Math.min(usable, s + PER * 3);
      const buf = new ArrayBuffer(((e - s) / 3) * 13);
      const dv = new DataView(buf);
      let o = 0;
      for (let t = s; t < e; t += 3) {
        dv.setUint8(o, 3);
        dv.setInt32(o + 1, base + idx[t], true); dv.setInt32(o + 5, base + idx[t + 1], true); dv.setInt32(o + 9, base + idx[t + 2], true);
        o += 13;
      }
      parts.push(new Uint8Array(buf));
    }
    base += m.positions.length / 3;
  });
  return parts;
}

// ───────────────────────── DXF (3DFACE) ─────────────────────────

export function buildDxf(data, { offset = null, layer = 'MODEL3D' } = {}) {
  const [ox, oy, oz] = off3(offset);
  const L = safeName(layer, 'MODEL3D');
  const w = createTextWriter();
  w.push(['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '1',
    '0', 'LAYER', '2', L, '70', '0', '62', '7', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', ''].join('\r\n'));
  data.meshes.forEach((m) => {
    const p = m.positions; const idx = m.indices;
    const usable = idx.length - (idx.length % 3);
    for (let t = 0; t < usable; t += 3) {
      const a = idx[t] * 3; const b = idx[t + 1] * 3; const c = idx[t + 2] * 3;
      const A = `${f3(p[a] + ox)}\r\n20\r\n${f3(p[a + 1] + oy)}\r\n30\r\n${f3(p[a + 2] + oz)}`;
      const B = `${f3(p[b] + ox)}\r\n21\r\n${f3(p[b + 1] + oy)}\r\n31\r\n${f3(p[b + 2] + oz)}`;
      const C = `${f3(p[c] + ox)}\r\n22\r\n${f3(p[c + 1] + oy)}\r\n32\r\n${f3(p[c + 2] + oz)}`;
      const D = `${f3(p[c] + ox)}\r\n23\r\n${f3(p[c + 1] + oy)}\r\n33\r\n${f3(p[c + 2] + oz)}`; // رأس چهارم = سوم (مثلث)
      w.push(`0\r\n3DFACE\r\n8\r\n${L}\r\n10\r\n${A}\r\n11\r\n${B}\r\n12\r\n${C}\r\n13\r\n${D}\r\n`);
    }
  });
  w.push('0\r\nENDSEC\r\n0\r\nEOF\r\n');
  return w.finish();
}

// ───────────────────────── LandXML (سطح TIN) ─────────────────────────

/**
 * نقاط به ترتیب «شمال شرق ارتفاع» (قرارداد LandXML)؛ وجه‌ها در پلان خلاف عقربه‌های ساعت و مثلث‌های قائم
 * (مساحت افقی صفر) حذف می‌شوند.
 */
export function buildLandXml(data, { offset = null, name = 'SAMAT-3D' } = {}) {
  const [ox, oy, oz] = off3(offset);
  const w = createTextWriter();
  const now = new Date();
  const esc = (s) => String(s).replace(/[<>&"']/g, '_');
  w.push(`<?xml version="1.0" encoding="UTF-8"?>\n<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${now.toISOString().slice(0, 10)}" time="${now.toISOString().slice(11, 19)}" language="English" readOnly="false">\n`);
  w.push('  <Units>\n    <Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars" diameterUnit="meter" widthUnit="meter" heightUnit="meter"/>\n  </Units>\n');
  w.push('  <Application name="SAMAT" desc="Photogrammetric surface exported from SAMAT 3D viewer - preliminary, not an official survey"/>\n');
  w.push(`  <Surfaces>\n    <Surface name="${esc(name)}">\n      <Definition surfType="TIN">\n        <Pnts>\n`);
  let id = 0;
  data.meshes.forEach((m) => {
    const p = m.positions;
    const n = p.length / 3;
    for (let i = 0; i < n; i += 1) {
      id += 1;
      w.push(`          <P id="${id}">${f3(p[i * 3 + 1] + oy)} ${f3(p[i * 3] + ox)} ${f3(p[i * 3 + 2] + oz)}</P>\n`);
    }
  });
  w.push('        </Pnts>\n        <Faces>\n');
  let base = 0;
  data.meshes.forEach((m) => {
    const p = m.positions; const idx = m.indices;
    const usable = idx.length - (idx.length % 3);
    for (let t = 0; t < usable; t += 3) {
      let a = idx[t]; let b = idx[t + 1]; const c = idx[t + 2];
      // مساحت علامت‌دار افقی (شرق = x، شمال = y)
      const area2 = (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[c * 3] - p[a * 3]) * (p[b * 3 + 1] - p[a * 3 + 1]);
      if (Math.abs(area2) < 1e-9) continue;
      if (area2 < 0) { const tmp = a; a = b; b = tmp; }
      w.push(`          <F>${base + a + 1} ${base + b + 1} ${base + c + 1}</F>\n`);
    }
    base += p.length / 3;
  });
  w.push('        </Faces>\n      </Definition>\n    </Surface>\n  </Surfaces>\n</LandXML>\n');
  return w.finish();
}

// ───────────────────────── XYZ ─────────────────────────

export function buildXyz(data, { offset = null } = {}) {
  const [ox, oy, oz] = off3(offset);
  const hasColors = data.meshes.some((m) => m.colors);
  const w = createTextWriter();
  data.meshes.forEach((m) => {
    const p = m.positions;
    const n = p.length / 3;
    for (let i = 0; i < n; i += 1) {
      const xyz = `${f3(p[i * 3] + ox)} ${f3(p[i * 3 + 1] + oy)} ${f3(p[i * 3 + 2] + oz)}`;
      if (!hasColors) w.push(`${xyz}\n`);
      else if (m.colors) w.push(`${xyz} ${m.colors[i * 3]} ${m.colors[i * 3 + 1]} ${m.colors[i * 3 + 2]}\n`);
      else w.push(`${xyz} 200 200 200\n`);
    }
  });
  return w.finish();
}

// ───────────────────────── نقطه‌ی ورود ─────────────────────────

/**
 * @param {string} formatId یکی از EXPORT_FORMATS
 * @param {object} data خروجی extractExportMeshes (یا ساختار هم‌شکل)
 * @param {{ offset?: number[]|null }} [opts] offset: مبدأ UTM مدل (georef.rtc) برای مختصات مطلق؛ null = محلی
 * @returns {{ blob: Blob, filename: string }}
 */
export function buildExport(formatId, data, { offset = null } = {}) {
  const fmt = getExportFormat(formatId);
  if (!fmt) throw new Error(`قالب «${formatId}» پشتیبانی نمی‌شود`);
  const tris = countTriangles(data);
  if (!tris) throw new Error('مدل هیچ مثلثی ندارد');
  const max = fmt.text ? MAX_TEXT_TRIANGLES : MAX_BINARY_TRIANGLES;
  if (tris > max) {
    throw new Error(`مدل ${(tris / 1e6).toFixed(1)} میلیون مثلث دارد؛ قالب ${fmt.label} برای بیش از ${(max / 1e6).toFixed(0)} میلیون مثلث روی این دستگاه ساخته نمی‌شود. مدل سبک (LOD) را باز کنید و از آن خروجی بگیرید`);
  }
  const tag = offset ? 'utm' : 'local';
  const base = `model3d-${tag}`;
  switch (formatId) {
    case 'obj': {
      const { obj, mtl } = buildObj(data, { offset });
      if (!mtl) return { blob: new Blob(obj, { type: 'model/obj' }), filename: `${base}.obj` };
      const entries = [{ name: 'model.obj', chunks: obj }, { name: 'model.mtl', chunks: mtl }, ...data.textures.map((t) => ({ name: t.name, chunks: [t.bytes] }))];
      return { blob: buildZip(entries), filename: `${base}-obj.zip` };
    }
    case 'stl': return { blob: new Blob(buildStl(data, { offset }), { type: 'model/stl' }), filename: `${base}.stl` };
    case 'ply': return { blob: new Blob(buildPly(data, { offset }), { type: 'application/octet-stream' }), filename: `${base}.ply` };
    case 'dxf': return { blob: new Blob(buildDxf(data, { offset }), { type: 'application/dxf' }), filename: `${base}.dxf` };
    case 'landxml': return { blob: new Blob(buildLandXml(data, { offset }), { type: 'application/xml' }), filename: `${base}.xml` };
    case 'xyz': return { blob: new Blob(buildXyz(data, { offset }), { type: 'text/plain' }), filename: `${base}.xyz` };
    default: throw new Error(`قالب «${formatId}» پشتیبانی نمی‌شود`);
  }
}

// ───────────────────────── استخراج از صحنه‌ی Three.js (فقط مرورگر) ─────────────────────────

async function imageToJpeg(img, quality = 0.95) {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('بوم تصویر در دسترس نیست');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      // eslint-disable-next-line no-await-in-loop
      const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', quality); });
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error('ساخت JPEG ناموفق بود');
      return new Uint8Array(await blob.arrayBuffer());
    } catch (err) {
      lastErr = err;
      w = Math.max(1, Math.floor(w / 2)); // بوم‌های خیلی بزرگ روی موبایل شکست می‌خورند؛ نصف می‌کنیم
      h = Math.max(1, Math.floor(h / 2));
    }
  }
  throw lastErr || new Error('ذخیره‌ی بافت ناموفق بود');
}

/** بافت را به حداکثر ۴۰۹۶ پیکسل کوچک و داده‌ی RGBA آن را برمی‌گرداند (برای نمونه‌برداری رنگ رأس‌ها) */
function sampleSource(img) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.min(1, 4096 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * s));
  const h = Math.max(1, Math.round(ih * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  canvas.width = 0;
  canvas.height = 0;
  return { w, h, data };
}

/**
 * مش‌های زیر root را به ساختار data (ENU محلی) تبدیل می‌کند. root باید همان گره‌ی gltf.scene باشد؛ تبدیل
 * محور مثل model3dScene.js است (upAxis 'z' → (x,y,z)؛ 'y' → (x,−z,y)).
 * @param {object} THREE
 * @param {object} root
 * @param {'y'|'z'} upAxis
 * @param {{ wantTextures?: boolean, bakeColors?: boolean }} [opts]
 *   wantTextures: عکس بافت‌ها هم JPEG شود (OBJ)؛ bakeColors: اگر رنگ رأس نبود از بافت نمونه‌برداری شود (PLY/XYZ)
 */
export async function extractExportMeshes(THREE, root, upAxis, { wantTextures = false, bakeColors = false } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const list = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.excludeFromAnalysis && o.geometry && o.geometry.attributes.position) list.push(o);
  });
  if (!list.length) throw new Error('مدل هیچ مشی ندارد');

  const materials = [];
  const matIndex = new Map();
  const textures = [];
  const texIndex = new Map();
  const samples = new Map();
  const meshes = [];

  for (let mi = 0; mi < list.length; mi += 1) {
    const mesh = list[mi];
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const n = pos.count;
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    const positions = new Float64Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      if (upAxis === 'z') { positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z; } else { positions[i * 3] = v.x; positions[i * 3 + 1] = -v.z; positions[i * 3 + 2] = v.y; }
    }
    const idx = geo.index;
    const count = idx ? idx.count : n;
    const usable = count - (count % 3);
    const indices = new Uint32Array(usable);
    for (let k = 0; k < usable; k += 1) indices[k] = idx ? idx.getX(k) : k;

    let uvs = null;
    const uvAttr = geo.attributes.uv;
    if (uvAttr) {
      uvs = new Float32Array(n * 2);
      for (let i = 0; i < n; i += 1) { uvs[i * 2] = uvAttr.getX(i); uvs[i * 2 + 1] = uvAttr.getY(i); }
    }

    let colors = null;
    const colAttr = geo.attributes.color;
    if (colAttr) {
      colors = new Uint8Array(n * 3);
      const q = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
      for (let i = 0; i < n; i += 1) { colors[i * 3] = q(colAttr.getX(i)); colors[i * 3 + 1] = q(colAttr.getY(i)); colors[i * 3 + 2] = q(colAttr.getZ(i)); }
    }

    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const map = mat && mat.map && mat.map.image ? mat.map : null;

    let textureName = null;
    if (map && wantTextures) {
      if (!texIndex.has(map.uuid)) {
        // eslint-disable-next-line no-await-in-loop
        const bytes = await imageToJpeg(map.image);
        const name = `texture_${textures.length}.jpg`;
        textures.push({ name, bytes });
        texIndex.set(map.uuid, name);
      }
      textureName = texIndex.get(map.uuid);
    }

    if (!colors && map && bakeColors && uvs) {
      if (!samples.has(map.uuid)) samples.set(map.uuid, sampleSource(map.image));
      const s = samples.get(map.uuid);
      colors = new Uint8Array(n * 3);
      for (let i = 0; i < n; i += 1) {
        const u = uvs[i * 2] - Math.floor(uvs[i * 2]); // پیچش (repeat)
        const t = uvs[i * 2 + 1] - Math.floor(uvs[i * 2 + 1]);
        const px = Math.min(s.w - 1, Math.floor(u * s.w));
        const py = Math.min(s.h - 1, Math.floor(t * s.h)); // UV در glTF از بالا است، همان ردیف‌های تصویر
        const o = (py * s.w + px) * 4;
        colors[i * 3] = s.data[o]; colors[i * 3 + 1] = s.data[o + 1]; colors[i * 3 + 2] = s.data[o + 2];
      }
    }

    let rgb = [0.8, 0.8, 0.8];
    if (mat && mat.color) {
      try {
        const c = {};
        mat.color.getRGB(c, THREE.SRGBColorSpace);
        rgb = [c.r, c.g, c.b];
      } catch { rgb = [mat.color.r, mat.color.g, mat.color.b]; }
    }
    const key = `${textureName || '-'}|${rgb.map((x) => x.toFixed(3)).join(',')}`;
    if (!matIndex.has(key)) {
      matIndex.set(key, materials.length);
      materials.push({ name: `mat_${materials.length}`, color: rgb, texture: textureName });
    }
    meshes.push({
      positions, indices, uvs, colors, material: matIndex.get(key),
    });
  }
  return { meshes, materials, textures };
}

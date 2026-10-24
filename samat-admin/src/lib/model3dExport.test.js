import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildObj, buildStl, buildPly, buildDxf, buildLandXml, buildXyz, buildExport, countTriangles, countVertices, extractExportMeshes,
  EXPORT_FORMATS, MAX_TEXT_TRIANGLES,
} from './model3dExport.js';
import { crc32, buildZip } from './zipStore.js';

const dec = new TextDecoder();
const text = (chunks) => chunks.map((c) => dec.decode(c)).join('');
const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
};

// دو مثلث روی یک مربع ۱۰×۱۰ متری؛ مثلث دوم عمداً ساعتگرد است (برای تست جهت وجه‌ها در LandXML)
function sample({ colors = false, textured = false } = {}) {
  return {
    meshes: [{
      positions: new Float64Array([0, 0, 1, 10, 0, 2, 10, 10, 3, 0, 10, 4]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      uvs: textured ? new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) : null,
      colors: colors ? new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]) : null,
      material: 0,
    }],
    materials: [{ name: 'mat_0', color: [0.5, 0.5, 0.5], texture: textured ? 'texture_0.jpg' : null }],
    textures: textured ? [{ name: 'texture_0.jpg', bytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]) }] : [],
  };
}

describe('zipStore', () => {
  it('CRC-32 مقدار مرجع', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });
  it('ساختار ZIP: امضاها، تعداد و اندازه‌ها', async () => {
    const blob = buildZip([{ name: 'a.txt', chunks: [new TextEncoder().encode('he'), new TextEncoder().encode('llo')] }, { name: 'b.bin', chunks: [new Uint8Array([1, 2, 3])] }]);
    const b = await bytes(blob);
    const dv = new DataView(b.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034B50);
    const end = b.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054B50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    const cdOffset = dv.getUint32(end + 16, true);
    expect(dv.getUint32(cdOffset, true)).toBe(0x02014B50);
    expect(dv.getUint32(cdOffset + 16, true)).toBe(crc32(new TextEncoder().encode('hello')));
    expect(dv.getUint32(cdOffset + 20, true)).toBe(5);
    expect(dec.decode(b.subarray(30, 35))).toBe('a.txt');
    expect(dec.decode(b.subarray(35, 40))).toBe('hello');
  });
});

describe('شمارش', () => {
  it('مثلث و رأس', () => {
    const d = sample();
    expect(countTriangles(d)).toBe(2);
    expect(countVertices(d)).toBe(4);
  });
});

describe('OBJ', () => {
  it('بدون بافت: رأس و وجه، بدون mtl', () => {
    const { obj, mtl } = buildObj(sample());
    const t = text(obj);
    expect(mtl).toBeNull();
    expect(t.match(/^v /gm)).toHaveLength(4);
    expect(t.match(/^f /gm)).toHaveLength(2);
    expect(t).toContain('f 1 2 3');
    expect(t).toContain('v 10.000 0.000 2.000');
  });
  it('با بافت: vt با v برعکس‌شده، usemtl، mtllib و map_Kd', () => {
    const { obj, mtl } = buildObj(sample({ textured: true }));
    const t = text(obj);
    expect(t).toContain('mtllib model.mtl');
    expect(t).toContain('usemtl mat_0');
    expect(t).toContain('vt 0.000000 1.000000'); // رأس اول (u=0,v=0) → v=1
    expect(t).toContain('f 1/1 2/2 3/3');
    expect(text(mtl)).toContain('map_Kd texture_0.jpg');
  });
  it('رنگ رأس به‌صورت v x y z r g b', () => {
    const t = text(buildObj(sample({ colors: true })).obj);
    expect(t).toContain('v 0.000 0.000 1.000 1.0000 0.0000 0.0000');
  });
  it('offset مختصات UTM مطلق می‌سازد', () => {
    const t = text(buildObj(sample(), { offset: [500000, 3900000, 1800] }).obj);
    expect(t).toContain('v 500010.000 3900000.000 1802.000');
  });
  it('اندیس‌های مش دوم با پایه‌ی رأس‌های قبلی جابه‌جا می‌شوند', () => {
    const d = sample();
    d.meshes.push({ ...d.meshes[0] });
    const t = text(buildObj(d).obj);
    expect(t).toContain('f 5 6 7');
  });
});

describe('STL', () => {
  it('سرآیند، تعداد مثلث و حجم فایل', () => {
    const parts = buildStl(sample());
    const b = concat(parts);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    expect(dv.getUint32(80, true)).toBe(2);
    expect(b.length).toBe(84 + 2 * 50);
    // مثلث اول (0,0,1)→(10,0,2)→(10,10,3): نرمال رو به بالا
    expect(dv.getFloat32(84 + 8, true)).toBeGreaterThan(0);
    expect(dv.getFloat32(84 + 12, true)).toBe(0);
    expect(dv.getFloat32(84 + 12 + 12, true)).toBe(10);
  });
  it('بیش از یک تکه‌ی ۵۰هزارتایی', () => {
    const n = 120_000;
    const idx = new Uint32Array(n * 3);
    for (let i = 0; i < n; i += 1) { idx[i * 3] = 0; idx[i * 3 + 1] = 1; idx[i * 3 + 2] = 2; }
    const d = { meshes: [{ positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: idx, uvs: null, colors: null, material: 0 }], materials: [], textures: [] };
    const b = concat(buildStl(d));
    expect(b.length).toBe(84 + n * 50);
  });
});

describe('PLY', () => {
  const split = (b) => {
    const s = dec.decode(b.subarray(0, Math.min(b.length, 600)));
    const end = s.indexOf('end_header\n') + 'end_header\n'.length;
    return { header: s.slice(0, end), body: b.subarray(end) };
  };
  it('float بدون رنگ', () => {
    const { header, body } = split(concat(buildPly(sample())));
    expect(header).toContain('element vertex 4');
    expect(header).toContain('element face 2');
    expect(header).toContain('property float x');
    expect(header).not.toContain('red');
    expect(body.length).toBe(4 * 12 + 2 * 13);
  });
  it('با رنگ و UTM به‌صورت double', () => {
    const { header, body } = split(concat(buildPly(sample({ colors: true }), { offset: [500000, 3900000, 1800] })));
    expect(header).toContain('property double x');
    expect(header).toContain('property uchar red');
    expect(body.length).toBe(4 * (24 + 3) + 2 * 13);
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    expect(dv.getFloat64(0, true)).toBe(500000);
    expect(body[24]).toBe(255);
    // وجه اول
    const f0 = 4 * 27;
    expect(body[f0]).toBe(3);
    expect(dv.getInt32(f0 + 1, true)).toBe(0);
    expect(dv.getInt32(f0 + 9, true)).toBe(2);
  });
});

describe('DXF', () => {
  it('هر مثلث یک 3DFACE و ساختار معتبر', () => {
    const t = text(buildDxf(sample()));
    expect(t.match(/3DFACE/g)).toHaveLength(2);
    expect(t).toContain('SECTION');
    expect(t.trimEnd().endsWith('EOF')).toBe(true);
    // گروه‌های ۱۰..۳۳ برای مثلث اول: رأس دوم (10,0,2) با کدهای 11/21/31
    expect(t).toContain('11\r\n10.000\r\n21\r\n0.000\r\n31\r\n2.000');
  });
  it('مختصات UTM', () => {
    const t = text(buildDxf(sample(), { offset: [500000, 3900000, 1800] }));
    expect(t).toContain('10\r\n500000.000\r\n20\r\n3900000.000\r\n30\r\n1801.000');
  });
});

describe('LandXML', () => {
  it('نقاط به ترتیب شمال شرق ارتفاع و وجه‌ها ۱-پایه', () => {
    const t = text(buildLandXml(sample(), { offset: [500000, 3900000, 1800] }));
    expect(t).toContain('<P id="2">3900000.000 500010.000 1802.000</P>');
    expect(t.match(/<P /g)).toHaveLength(4);
    expect(t.match(/<F>/g)).toHaveLength(2);
    expect(t).toContain('surfType="TIN"');
  });
  it('وجه‌ها خلاف عقربه‌ها می‌شوند و مثلث قائم حذف می‌شود', () => {
    const d = {
      meshes: [{
        // ساعتگرد در پلان: (0,0)→(0,10)→(10,0)؛ و یک مثلث قائم (روی یک خط در پلان)
        positions: new Float64Array([0, 0, 0, 0, 10, 0, 10, 0, 0, 5, 5, 0, 5, 5, 9, 5, 5, 3]),
        indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
        uvs: null, colors: null, material: 0,
      }],
      materials: [],
      textures: [],
    };
    const t = text(buildLandXml(d));
    expect(t.match(/<F>/g)).toHaveLength(1);
    expect(t).toContain('<F>2 1 3</F>'); // جای دو رأس اول عوض شد
  });
});

describe('XYZ', () => {
  it('بدون رنگ سه ستون، با رنگ شش ستون', () => {
    const a = text(buildXyz(sample())).trim().split('\n');
    expect(a).toHaveLength(4);
    expect(a[1]).toBe('10.000 0.000 2.000');
    const b = text(buildXyz(sample({ colors: true }))).trim().split('\n');
    expect(b[0]).toBe('0.000 0.000 1.000 255 0 0');
  });
});

describe('buildExport', () => {
  it('همه‌ی قالب‌ها فایل و نام درست می‌دهند', async () => {
    const names = {};
    for (const f of EXPORT_FORMATS) {
      const { blob, filename } = buildExport(f.id, sample({ colors: true }), { offset: null });
      expect(blob.size).toBeGreaterThan(0);
      names[f.id] = filename;
    }
    expect(names.obj).toBe('model3d-local.obj');
    expect(names.landxml).toBe('model3d-local.xml');
    expect(buildExport('dxf', sample(), { offset: [1, 2, 3] }).filename).toBe('model3d-utm.dxf');
  });
  it('OBJ دارای بافت به ZIP تبدیل می‌شود', async () => {
    const { blob, filename } = buildExport('obj', sample({ textured: true }));
    expect(filename).toBe('model3d-local-obj.zip');
    const b = await bytes(blob);
    const s = dec.decode(b);
    expect(s).toContain('model.obj');
    expect(s).toContain('model.mtl');
    expect(s).toContain('texture_0.jpg');
  });
  it('قالب ناشناخته و مدل خالی و مدل خیلی سنگین خطا می‌دهند', () => {
    expect(() => buildExport('fbx', sample())).toThrow();
    expect(() => buildExport('stl', { meshes: [], materials: [], textures: [] })).toThrow();
    const big = {
      meshes: [{ positions: new Float64Array(9), indices: new Uint32Array((MAX_TEXT_TRIANGLES + 1) * 3), uvs: null, colors: null, material: 0 }], materials: [], textures: [],
    };
    expect(() => buildExport('dxf', big)).toThrow(/LOD/);
  });
});

describe('extractExportMeshes (Three.js)', () => {
  const tri = (positions, extra = {}) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    if (extra.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(extra.uv), 2));
    if (extra.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(extra.color), 3));
    if (extra.index) g.setIndex(extra.index);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: extra.matColor || 0xffffff }));
  };

  it('upAxis z: مختصات بدون تغییر', async () => {
    const root = new THREE.Group();
    root.add(tri([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const d = await extractExportMeshes(THREE, root, 'z');
    expect(Array.from(d.meshes[0].positions)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(d.meshes[0].indices)).toEqual([0, 1, 2]);
    expect(d.meshes[0].uvs).toBeNull();
    expect(d.meshes[0].colors).toBeNull();
  });

  it('upAxis y: (x, y, z) → (x, −z, y) مثل model3dScene', async () => {
    const root = new THREE.Group();
    root.add(tri([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const d = await extractExportMeshes(THREE, root, 'y');
    expect(Array.from(d.meshes[0].positions)).toEqual([1, -3, 2, 4, -6, 5, 7, -9, 8]);
  });

  it('تبدیل‌های والدِ root (چرخش/جابه‌جایی نمایشگر) اثری ندارد، ولی تبدیل خودِ مش و فرزندان اعمال می‌شود', async () => {
    const holder = new THREE.Group();
    holder.rotation.set(-Math.PI / 2, 0, 0);
    holder.position.set(100, 200, 300);
    const root = new THREE.Group();
    holder.add(root);
    const child = new THREE.Group();
    child.position.set(10, 0, 0);
    child.add(tri([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    root.add(child);
    const d = await extractExportMeshes(THREE, root, 'z');
    const p = Array.from(d.meshes[0].positions).map((v) => Math.round(v * 1e6) / 1e6);
    expect(p).toEqual([10, 0, 0, 11, 0, 0, 10, 1, 0]);
  });

  it('ایندکس، UV و رنگ رأس (۰..۱ → ۰..۲۵۵) و مواد یکتا', async () => {
    const root = new THREE.Group();
    root.add(tri([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], {
      index: [0, 1, 2, 2, 1, 3], uv: [0, 0, 1, 0, 0, 1, 1, 1], color: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0.5, 0.5, 0.5], matColor: 0x808080,
    }));
    root.add(tri([0, 0, 0, 1, 0, 0, 0, 1, 0], { matColor: 0x808080 }));
    const d = await extractExportMeshes(THREE, root, 'z');
    expect(Array.from(d.meshes[0].indices)).toEqual([0, 1, 2, 2, 1, 3]);
    expect(Array.from(d.meshes[0].uvs)).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
    expect(Array.from(d.meshes[0].colors.slice(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(d.meshes[0].colors.slice(9, 12))).toEqual([128, 128, 128]);
    expect(d.materials).toHaveLength(1); // دو مش با رنگ یکسان یک ماده
    expect(d.meshes[1].material).toBe(0);
    expect(d.materials[0].color[0]).toBeCloseTo(0.5, 1);
    expect(countTriangles(d)).toBe(3);
  });

  it('مش‌های excludeFromAnalysis (تصویر ماهواره) کنار گذاشته می‌شوند و مدل خالی خطا می‌دهد', async () => {
    const root = new THREE.Group();
    const sat = tri([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    sat.userData.excludeFromAnalysis = true;
    root.add(sat);
    await expect(extractExportMeshes(THREE, root, 'z')).rejects.toThrow();
    root.add(tri([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    const d = await extractExportMeshes(THREE, root, 'z');
    expect(d.meshes).toHaveLength(1);
  });
});

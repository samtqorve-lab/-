import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  detectUpAxis, enuFromLocal, localFromEnu, sceneToEnu, enuToScene, collectEnuMesh, drapedLine, createColorLayer,
  MAX_ANALYSIS_TRIANGLES,
} from './model3dScene.js';
import { heightAt, polygonVolume } from './model3dAnalysis.js';

/** مش شبکه‌ای ۰..size؛ مثل خروجی ODM: x شرق، y شمال، z بالا (upAxis='z') */
function demMesh({ size = 20, step = 1, f = (x, y) => 0.1 * x + 0.05 * y, indexed = true, zUp = true } = {}) {
  const n = Math.round(size / step) + 1;
  const pos = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = i * step; const y = j * step; const h = f(x, y);
      if (zUp) pos.push(x, y, h); else pos.push(x, h, -y); // glTF استاندارد: y بالا، z = −شمال
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  if (indexed) {
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
  } else {
    const flat = [];
    idx.forEach((k) => flat.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]));
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  }
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xcccccc }));
}

function setup(opts) {
  const holder = new THREE.Group();
  const root = new THREE.Group();
  const mesh = demMesh(opts);
  root.add(mesh);
  holder.add(root);
  return { holder, root, mesh };
}

describe('detectUpAxis', () => {
  it('خروجی ODM (z کوچک‌ترین بُعد) → z؛ glTF استاندارد → y', () => {
    expect(detectUpAxis(THREE, setup({ zUp: true }).root)).toBe('z');
    expect(detectUpAxis(THREE, setup({ zUp: false }).root)).toBe('y');
  });
});

describe('تبدیل ENU ⇄ محلی', () => {
  it('رفت‌وبرگشت برای هر دو محور بالا', () => {
    ['z', 'y'].forEach((up) => {
      const l = localFromEnu(up, 3, 4, 5);
      expect(enuFromLocal(up, ...l)).toEqual([3, 4, 5]);
    });
    expect(localFromEnu('y', 3, 4, 5)).toEqual([3, 5, -4]);
  });
});

describe('collectEnuMesh', () => {
  it('ارتفاع سطحِ ENU با تابع اصلی برابر است (Z-up، ایندکس‌دار)', () => {
    const { holder } = setup();
    const { surface, bboxEnu, parts } = collectEnuMesh(THREE, holder, 'z');
    expect(heightAt(surface, 10, 10)).toBeCloseTo(1.5, 4);
    expect(heightAt(surface, 3.3, 7.7)).toBeCloseTo(0.1 * 3.3 + 0.05 * 7.7, 4);
    expect(bboxEnu).toMatchObject({ minE: 0, maxE: 20, minN: 0, maxN: 20 });
    expect(parts).toHaveLength(1);
    expect(parts[0].count).toBe(21 * 21);
  });
  it('همان نتیجه برای مش بدون ایندکس (مثل خروجی ODM)', () => {
    const { holder } = setup({ indexed: false });
    const { surface } = collectEnuMesh(THREE, holder, 'z');
    expect(heightAt(surface, 10, 10)).toBeCloseTo(1.5, 4);
  });
  it('مدل Y-up (glTF استاندارد) با upAxis=y همان ENU را می‌دهد', () => {
    const { holder } = setup({ zUp: false });
    const { surface } = collectEnuMesh(THREE, holder, 'y');
    expect(heightAt(surface, 10, 10)).toBeCloseTo(1.5, 4);
    expect(heightAt(surface, 4, 16)).toBeCloseTo(0.4 + 0.8, 4);
  });
  it('چرخش و جابه‌جایی holder (دکمه‌ی 🔄 و مرکزسازی) روی ENU اثری ندارد', () => {
    const { holder } = setup();
    holder.rotation.set(-Math.PI / 2, 0, 0);
    holder.position.set(-10, -1, 10);
    const { surface } = collectEnuMesh(THREE, holder, 'z');
    expect(heightAt(surface, 10, 10)).toBeCloseTo(1.5, 4);
  });
  it('تبدیل جهانی ⇄ ENU با holder چرخیده درست است', () => {
    const { holder } = setup();
    holder.rotation.set(-Math.PI / 2, 0, 0);
    holder.position.set(-10, -1, 10);
    const world = enuToScene(THREE, holder, 'z', 4, 6, 2);
    const back = sceneToEnu(THREE, holder, 'z', world);
    expect(back[0]).toBeCloseTo(4, 5); expect(back[1]).toBeCloseTo(6, 5); expect(back[2]).toBeCloseTo(2, 5);
    // با چرخش −۹۰° حول X، بالا = Y صحنه است: ارتفاع ۲ باید در y ظاهر شود
    expect(world.y).toBeCloseTo(2 + holder.position.y, 5);
  });
  it('مدل بدون مش یا خیلی سنگین خطای فارسی می‌دهد', () => {
    expect(() => collectEnuMesh(THREE, new THREE.Group(), 'z')).toThrow(/مشی ندارد/);
    expect(MAX_ANALYSIS_TRIANGLES).toBeGreaterThan(1_000_000);
    const g = new THREE.BufferGeometry();
    const big = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    // شبیه‌سازی مش بزرگ بدون ساخت واقعی حافظه: index ساختگی با count بزرگ
    Object.defineProperty(g, 'index', { value: { count: (MAX_ANALYSIS_TRIANGLES + 1) * 3 } });
    const h = new THREE.Group(); h.add(big);
    expect(() => collectEnuMesh(THREE, h, 'z')).toThrow(/سنگین/);
  });
  it('حجم پلیگون روی سطح استخراج‌شده از مش درست است (تپه‌ی مخروطی تقریبی)', () => {
    // هرم ۱۰×۱۰ ارتفاع ۵ روی مش ۰..۳۰ با گام ۰٫۵
    const pyr = (x, y) => Math.max(0, 5 - Math.max(Math.abs(x - 15), Math.abs(y - 15)));
    const { holder } = setup({ size: 30, step: 0.5, f: pyr });
    const { surface } = collectEnuMesh(THREE, holder, 'z');
    const r = polygonVolume(surface, [[8, 8], [22, 8], [22, 22], [8, 22]], { base: 'plane' });
    expect(r.above).toBeGreaterThan((500 / 3) * 0.97);
    expect(r.above).toBeLessThan((500 / 3) * 1.03);
  });
});

describe('drapedLine', () => {
  it('خط روی سطح می‌نشیند و در مرز مدل قطع می‌شود', () => {
    const { holder } = setup();
    const { surface } = collectEnuMesh(THREE, holder, 'z');
    const inside = drapedLine(THREE, holder, 'z', surface, [[2, 2], [18, 2], [18, 18], [2, 18]], { closed: true, step: 1, lift: 0 });
    expect(inside).not.toBeNull();
    const p = inside.geometry.attributes.position;
    // هر رأس خط باید روی سطح باشد (z = 0.1x + 0.05y) چون holder بدون تبدیل است
    for (let i = 0; i < p.count; i += 7) {
      expect(p.getZ(i)).toBeCloseTo(0.1 * p.getX(i) + 0.05 * p.getY(i), 4);
    }
    // مسیری که کاملاً بیرون مدل است → null
    expect(drapedLine(THREE, holder, 'z', surface, [[100, 100], [120, 100]], { step: 1 })).toBeNull();
    // مسیری که نیمی از آن بیرون است → قطعه‌ها فقط داخل مدل
    const half = drapedLine(THREE, holder, 'z', surface, [[10, 10], [40, 10]], { step: 1, lift: 0 });
    const hp = half.geometry.attributes.position;
    for (let i = 0; i < hp.count; i += 1) expect(hp.getX(i)).toBeLessThanOrEqual(20.0001);
  });
});

describe('createColorLayer', () => {
  it('apply رنگ رأس را جایگزین بافت می‌کند و restore دقیقاً حالت اولیه را برمی‌گرداند', () => {
    const { holder, mesh } = setup();
    const tex = new THREE.Texture();
    mesh.material.map = tex;
    mesh.material.color.set(0x123456);
    const { parts, surface } = collectEnuMesh(THREE, holder, 'z');
    const layer = createColorLayer(THREE, parts);
    const colors = new Float32Array(surface.vertexCount * 3).fill(0.5);
    layer.apply(colors);
    expect(layer.active).toBe(true);
    expect(mesh.material.map).toBeNull();
    expect(mesh.material.vertexColors).toBe(true);
    expect(mesh.geometry.attributes.color.count).toBe(surface.vertexCount);
    expect(mesh.material.color.getHex()).toBe(0xffffff);
    // اعمال دوباره (لایه‌ی دیگر) اصل را از دست نمی‌دهد
    layer.apply(colors.map(() => 0.9));
    layer.restore();
    expect(layer.active).toBe(false);
    expect(mesh.material.map).toBe(tex);
    expect(mesh.material.vertexColors).toBe(false);
    expect(mesh.geometry.attributes.color).toBeUndefined();
    expect(mesh.material.color.getHex()).toBe(0x123456);
  });
  it('رنگ رأس اصلی مدل بعد از restore برمی‌گردد', () => {
    const { holder, mesh } = setup();
    const orig = new THREE.BufferAttribute(new Float32Array(21 * 21 * 3).fill(0.2), 3);
    mesh.geometry.setAttribute('color', orig);
    mesh.material.vertexColors = true;
    const { parts, surface } = collectEnuMesh(THREE, holder, 'z');
    const layer = createColorLayer(THREE, parts);
    layer.apply(new Float32Array(surface.vertexCount * 3).fill(1));
    layer.restore();
    expect(mesh.geometry.attributes.color).toBe(orig);
    expect(mesh.material.vertexColors).toBe(true);
  });
});

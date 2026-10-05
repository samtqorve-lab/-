import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  mercatorXY, mercatorInverse, boundsFromMercator, imageSizeFor, buildMercatorMeshes, enuToMercator,
} from './model3dTopView.js';
import { buildGeoref } from './model3dGeo.js';
import { latLonToUtm } from './utm.js';

const u0 = latLonToUtm(35.175, 47.805);
const georef = buildGeoref({ rtc: [Math.round(u0.easting), Math.round(u0.northing), 1800], crs: 'EPSG:32638' });

describe('mercator', () => {
  it('رفت‌وبرگشت و نقاط مرجع', () => {
    const z0 = mercatorXY(0, 0);
    expect(z0.x).toBeCloseTo(0, 12); expect(z0.y).toBeCloseTo(0, 12);
    const m = mercatorXY(35.175, 47.805);
    const ll = mercatorInverse(m.x, m.y);
    expect(ll.lat).toBeCloseTo(35.175, 9); expect(ll.lon).toBeCloseTo(47.805, 9);
    expect(mercatorXY(45, 0).y).toBeCloseTo(Math.log(Math.tan(Math.PI / 4 + Math.PI / 8)), 12);
  });
  it('عرض‌های خارج از بازه گیره می‌شوند', () => {
    expect(Number.isFinite(mercatorXY(90, 10).y)).toBe(true);
  });
  it('boundsFromMercator و imageSizeFor', () => {
    const a = mercatorXY(35.17, 47.80); const b = mercatorXY(35.18, 47.81);
    const bb = boundsFromMercator({ minX: a.x, maxX: b.x, minY: a.y, maxY: b.y });
    expect(bb.south).toBeCloseTo(35.17, 9); expect(bb.north).toBeCloseTo(35.18, 9);
    expect(bb.west).toBeCloseTo(47.80, 9); expect(bb.east).toBeCloseTo(47.81, 9);
    expect(imageSizeFor({ minX: 0, maxX: 4, minY: 0, maxY: 2 }, 1000)).toEqual({ width: 1000, height: 500 });
    expect(imageSizeFor({ minX: 0, maxX: 1, minY: 0, maxY: 4 }, 1000)).toEqual({ width: 250, height: 1000 });
    expect(() => imageSizeFor({ minX: 0, maxX: 0, minY: 0, maxY: 1 }, 100)).toThrow(/نامعتبر/);
  });
});

function gridScene({ zUp = true } = {}) {
  const pos = []; const uv = []; const idx = [];
  const n = 5;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const e = i * 100; const nn = j * 100; const h = 10 + i;
      if (zUp) pos.push(e, nn, h); else pos.push(e, h, -nn);
      uv.push(i / (n - 1), j / (n - 1));
    }
  }
  for (let j = 0; j < n - 1; j += 1) for (let i = 0; i < n - 1; i += 1) { const a = j * n + i; idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const tex = new THREE.Texture();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }));
  const scene = new THREE.Group(); scene.add(mesh);
  return { scene, tex };
}

describe('buildMercatorMeshes', () => {
  it('هر رأس دقیقاً به مرکاتورِ lat/lon خودش می‌رود (Z-up)', () => {
    const { scene, tex } = gridScene();
    const { meshes, bounds, origin } = buildMercatorMeshes(THREE, scene, georef);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].map).toBe(tex);
    const pos = meshes[0].geometry.attributes.position;
    const exp = enuToMercator(georef, 300, 200); // رأس i=3,j=2
    const k = 2 * 5 + 3;
    // مختصات نسبت به origin ذخیره می‌شود؛ با افزودن آن باید به مرکاتور دقیق برسیم (خطا ≪ یک سانتی‌متر)
    expect(Math.abs(pos.getX(k) + origin.x - exp.x) * 6378137).toBeLessThan(0.01);
    expect(Math.abs(pos.getY(k) + origin.y - exp.y) * 6378137).toBeLessThan(0.01);
    expect(pos.getZ(k) + origin.z).toBeCloseTo((georef.rtc[2] + 13) / 6378137, 9);
    expect(bounds.minX).toBeLessThan(bounds.maxX); expect(bounds.minY).toBeLessThan(bounds.maxY);
    // UV و ایندکس حفظ می‌شوند
    expect(meshes[0].geometry.attributes.uv.count).toBe(25);
    expect(meshes[0].geometry.index.count).toBe(16 * 6);
  });
  it('مدل Y-up (glTF استاندارد) همان مرکاتور را می‌دهد', () => {
    const a = buildMercatorMeshes(THREE, gridScene({ zUp: true }).scene, georef);
    const b = buildMercatorMeshes(THREE, gridScene({ zUp: false }).scene, georef);
    const pa = a.meshes[0].geometry.attributes.position; const pb = b.meshes[0].geometry.attributes.position;
    for (let k = 0; k < 25; k += 6) {
      expect(Math.abs((pb.getX(k) + b.origin.x) - (pa.getX(k) + a.origin.x)) * 6378137).toBeLessThan(0.01);
      expect(Math.abs((pb.getY(k) + b.origin.y) - (pa.getY(k) + a.origin.y)) * 6378137).toBeLessThan(0.01);
      expect(pb.getZ(k) + b.origin.z).toBeCloseTo(pa.getZ(k) + a.origin.z, 9);
    }
  });
  it('چرخش شبکه‌ی UTM نسبت به شمال جغرافیایی لحاظ می‌شود: لبه‌ی «شرقی» در مرکاتور کمی کج است', () => {
    const { scene } = gridScene();
    const { meshes } = buildMercatorMeshes(THREE, scene, georef);
    const p = meshes[0].geometry.attributes.position;
    // همه‌ی رأس‌های ردیف اول (n=0، شرق‌به‌شرق) باید در مرکاتور y متفاوت داشته باشند (کج‌شدگی ≈ همگرایی نصف‌النهار)
    expect(Math.abs(p.getY(4) - p.getY(0))).toBeGreaterThan(1e-9);
    const slopeDeg = (Math.atan2(p.getY(4) - p.getY(0), p.getX(4) - p.getX(0)) * 180) / Math.PI;
    expect(Math.abs(slopeDeg)).toBeGreaterThan(0.5);
    expect(Math.abs(slopeDeg)).toBeLessThan(3);
  });
  it('مدل بدون مش خطا می‌دهد', () => {
    expect(() => buildMercatorMeshes(THREE, new THREE.Group(), georef)).toThrow(/مشی ندارد/);
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { collectEnuMesh, drapedLine } from './model3dScene.js';
import { heightAt } from './model3dAnalysis.js';

/** مش شبکه‌ای ۰..size (x شرق، y شمال، z بالا) */
function gridMesh(size, step, f) {
  const n = Math.round(size / step) + 1;
  const pos = [];
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) pos.push(i * step, j * step, f(i * step, j * step));
  const idx = [];
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

describe('لایه‌های کمکی جزو سطح تحلیل نیستند', () => {
  it('مشِ علامت‌خورده با excludeFromAnalysis (مثل صفحه‌ی ماهواره‌ای) جزو سطح تحلیل نیست', () => {
    const holder = new THREE.Group();
    holder.add(gridMesh(20, 1, (x, y) => 0.1 * x + 0.05 * y));
    const plane = gridMesh(60, 10, () => -5); // صفحه‌ی تخت بزرگ زیر مدل
    plane.userData.excludeFromAnalysis = true;
    holder.add(plane);
    const { surface, parts, bboxEnu } = collectEnuMesh(THREE, holder, 'z');
    expect(parts).toHaveLength(1);
    expect(surface.vertexCount).toBe(21 * 21);
    expect(bboxEnu.maxE).toBe(20); // صفحه تا ۶۰ می‌رفت
    expect(heightAt(surface, 10, 10)).toBeCloseTo(1.5, 4); // نه −۵
  });
  it('بدون علامت، همان مش جزو تحلیل می‌شود (نشانه‌ی اینکه فلگ واقعاً کار می‌کند)', () => {
    const holder = new THREE.Group();
    holder.add(gridMesh(20, 1, () => 0));
    holder.add(gridMesh(60, 10, () => -5));
    const { parts } = collectEnuMesh(THREE, holder, 'z');
    expect(parts).toHaveLength(2);
  });
});

describe('drapedLine با heightFn: محدوده‌ی کامل حتی بیرون از پوشش مدل', () => {
  it('بدون heightFn بیرون مدل قطع می‌شود؛ با heightFn کل مسیر رسم می‌شود و onModel سهم روی مدل است', () => {
    const holder = new THREE.Group();
    holder.add(gridMesh(20, 1, () => 2)); // مدل فقط ۰..۲۰
    const { surface } = collectEnuMesh(THREE, holder, 'z');
    const path = [[-30, -30], [50, -30], [50, 50], [-30, 50]]; // محدوده‌ی بزرگ‌تر از مدل
    const cut = drapedLine(THREE, holder, 'z', surface, path, { closed: true, step: 2, lift: 0 });
    expect(cut).toBeNull(); // هیچ‌جای این مسیر روی مدل نیست
    const full = drapedLine(THREE, holder, 'z', surface, path, {
      closed: true, step: 2, lift: 0, heightFn: () => 7,
    });
    expect(full).not.toBeNull();
    expect(full.userData.coverage).toBeCloseTo(1, 6);
    expect(full.userData.onModel).toBe(0);
    const p = full.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 5) expect(p.getZ(i)).toBeCloseTo(7, 4);
  });
  it('مسیری که نیمی روی مدل است: onModel بین ۰ و ۱ و روی مدل ارتفاع خودِ مدل', () => {
    const holder = new THREE.Group();
    holder.add(gridMesh(20, 1, () => 2));
    const { surface } = collectEnuMesh(THREE, holder, 'z');
    const line = drapedLine(THREE, holder, 'z', surface, [[10, 10], [50, 10]], {
      step: 1, lift: 0, heightFn: (e, n) => (e <= 20 ? 2 : 9) + 0 * n,
    });
    expect(line.userData.onModel).toBeGreaterThan(0.2);
    expect(line.userData.onModel).toBeLessThan(0.6);
    expect(line.userData.coverage).toBeCloseTo(1, 6);
  });
});

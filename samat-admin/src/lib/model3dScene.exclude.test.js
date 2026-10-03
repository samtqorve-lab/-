import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { collectEnuMesh } from './model3dScene.js';
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

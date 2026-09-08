import { describe, it, expect } from 'vitest';
import {
  computeTinVolume, buildTriIndex, interpolateZ,
} from './volumeCalc.js';

// یک شبکه‌ی ۴×۴ نقطه روی مربع ۱۰×۱۰ متر (۰,۰ تا ۱۰,۱۰) با ارتفاع ثابت z می‌سازد — برای این‌که
// هم مساحت (۱۰۰ متر مربع) و هم حجم (مساحت × اختلاف ارتفاع) از قبل دقیقاً قابل‌محاسبه باشد.
function flatGrid(z) {
  const pts = [];
  for (let i = 0; i <= 3; i += 1) {
    for (let j = 0; j <= 3; j += 1) {
      pts.push([i * (10 / 3), j * (10 / 3), z]);
    }
  }
  return pts;
}

describe('computeTinVolume', () => {
  it('وقتی سطح جدید دقیقاً ۲ متر یکنواخت بالاتر از سطح قبلی باشد، باید فقط فیل (به‌اندازه‌ی مساحت × ۲) محاسبه شود و کات صفر باشد', async () => {
    const prev = flatGrid(0);
    const curr = flatGrid(2);
    const result = await computeTinVolume(prev, curr);
    // مساحت واقعی مربع ۱۰×۱۰ = ۱۰۰ متر مربع؛ حجم فیل = ۱۰۰ × ۲ = ۲۰۰ متر مکعب
    expect(result.fillVolume).toBeCloseTo(200, 0);
    expect(result.cutVolume).toBeCloseTo(0, 0);
    expect(result.netVolume).toBeCloseTo(200, 0);
  });

  it('وقتی سطح جدید یکنواخت پایین‌تر باشد، باید فقط کات محاسبه شود', async () => {
    const prev = flatGrid(5);
    const curr = flatGrid(3);
    const result = await computeTinVolume(prev, curr);
    expect(result.cutVolume).toBeCloseTo(200, 0);
    expect(result.fillVolume).toBeCloseTo(0, 0);
    expect(result.netVolume).toBeCloseTo(-200, 0);
  });

  it('وقتی دو سطح کاملاً یکسان باشند، خالص باید صفر باشد', async () => {
    const prev = flatGrid(10);
    const curr = flatGrid(10);
    const result = await computeTinVolume(prev, curr);
    expect(result.netVolume).toBeCloseTo(0, 0);
  });

  it('با کمتر از ۳ نقطه باید خطای معنادار بدهد، نه کرش خاموش', async () => {
    await expect(computeTinVolume([[0, 0, 0], [1, 1, 0]], flatGrid(0))).rejects.toThrow();
  });
});

describe('interpolateZ (درون‌یابی ارتفاع داخل یک مثلث)', () => {
  it('روی یک سطح مسطح، هر نقطه‌ی داخلی باید همان ارتفاع ثابت را بدهد', () => {
    const pts = flatGrid(7);
    const coordsFlat = new Float64Array(pts.length * 2);
    pts.forEach((p, i) => { coordsFlat[i * 2] = p[0]; coordsFlat[i * 2 + 1] = p[1]; });
    const zvals = pts.map((p) => p[2]);
    // برای این تست، خودمان یک مثلث‌بندی ساده‌ی دستی از دو مثلث پوشاننده‌ی کل مربع می‌سازیم
    // (به‌جای وابستگی به کتابخانه‌ی Delaunator که در تست‌های بالا مستقیم آزموده شده)
    const triangles = [0, 3, 12, 3, 15, 12]; // اندیس‌های چهار گوشه‌ی شبکه‌ی ۴×۴ (۰و۱۲و۳و۱۵)
    const idx = buildTriIndex(coordsFlat, triangles, 0, 0, 10, 10);
    const z = interpolateZ(idx, coordsFlat, triangles, zvals, 5, 5);
    expect(z).toBeCloseTo(7, 6);
  });

  it('برای نقطه‌ی کاملاً بیرون از محدوده باید NaN بدهد (نه یک عدد ساختگی)', () => {
    const pts = flatGrid(7);
    const coordsFlat = new Float64Array(pts.length * 2);
    pts.forEach((p, i) => { coordsFlat[i * 2] = p[0]; coordsFlat[i * 2 + 1] = p[1]; });
    const zvals = pts.map((p) => p[2]);
    const triangles = [0, 3, 12, 3, 15, 12];
    const idx = buildTriIndex(coordsFlat, triangles, 0, 0, 10, 10);
    const z = interpolateZ(idx, coordsFlat, triangles, zvals, 500, 500);
    expect(Number.isNaN(z)).toBe(true);
  });
});

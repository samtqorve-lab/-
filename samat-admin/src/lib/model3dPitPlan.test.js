import { describe, it, expect } from 'vitest';
import {
  parseNum, detectGroup, licenseSpecFromRecord, insetPolygon, analyzeTerrain, suggestMode,
  planPitDesign, buildPlanGeometry, exportPlanReportCsv, exportPlanBenchesDxf, checkCrest, crestFraction,
} from './model3dPitPlan.js';
import { pointInPolygon } from './pitDesign.js';

const square = (c, half) => [[c[0] - half, c[1] - half], [c[0] + half, c[1] - half], [c[0] + half, c[1] + half], [c[0] - half, c[1] + half]];
const flat = () => 1000;
const slope = (deg) => (e, n) => 1000 + Math.tan((deg * Math.PI) / 180) * n;

describe('مشخصات پروانه', () => {
  it('عدد فارسی و جداکننده‌ی هزارگان را می‌خواند', () => {
    expect(parseNum('۱۲٬۵۰۰')).toBe(12500);
    expect(parseNum('1,250,000')).toBe(1250000);
    expect(parseNum('۲٫۵')).toBeCloseTo(2.5);
    expect(parseNum('')).toBeNull();
    expect(parseNum(null)).toBeNull();
  });
  it('گروه ماده را از متن دسته می‌خواند', () => {
    expect(detectGroup('گروه ۳ - سایر مواد طبقه یک (آهک، گچ، نمک، مارن و ...)')).toBe(3);
    expect(detectGroup('غیره')).toBeNull();
  });
  it('حجم هدف را از ذخیره و وزن مخصوص می‌سازد و فرض وزن مخصوص را علامت می‌زند', () => {
    const a = licenseSpecFromRecord({ دسته: 'گروه ۲ - سنگ لاشه ساختمانی', ذخیره_قطعی: '۲٬۶۰۰٬۰۰۰', واحد: 'تن', وزن_مخصوص: '2.6' });
    expect(a.volumes.reserveM3).toBeCloseTo(1000000, 0);
    expect(a.sgAssumed).toBe(false);
    const b = licenseSpecFromRecord({ دسته: 'گروه ۱ - شن', ذخیره_قطعی: 1800000, واحد: 'تن' });
    expect(b.sgAssumed).toBe(true);
    expect(b.volumes.reserveM3).toBeCloseTo(1000000, 0);
    const c = licenseSpecFromRecord({ ذخیره_قطعی: 500000, واحد: 'متر مکعب' });
    expect(c.volumes.reserveM3).toBe(500000);
  });
});

describe('insetPolygon / توپوگرافی', () => {
  it('آفست به داخل مساحت را کم می‌کند و محدوده‌ی خیلی کوچک را رد می‌کند', () => {
    const inner = insetPolygon(square([0, 0], 100), 10);
    expect(inner).not.toBeNull();
    inner.forEach(([x, y]) => expect(Math.max(Math.abs(x), Math.abs(y))).toBeCloseTo(90, 3));
    expect(insetPolygon(square([0, 0], 5), 20)).toBeNull();
  });
  it('زمین شیب‌دار را دامنه‌ای و زمین هموار را لایه‌ای/گودالی پیشنهاد می‌دهد', () => {
    const poly = square([0, 0], 100);
    const t1 = analyzeTerrain(slope(28), poly);
    expect(t1.planeGradeDeg).toBeCloseTo(28, 0);
    expect(t1.uphill[1]).toBeGreaterThan(0.99);
    expect(suggestMode(t1, 3).mode).toBe('hillside');
    expect(suggestMode(analyzeTerrain(flat, poly), 1).mode).toBe('layered');
    const bumpy = (e, n) => 1000 + 15 * Math.sin(e / 40) * Math.cos(n / 40);
    expect(suggestMode(analyzeTerrain(bumpy, poly), 3).mode).toBe('pit');
  });
});

describe('planPitDesign — گودالی روی زمین هموار', () => {
  it('عمق را از حجم هدف حل می‌کند و لبه‌ها داخل مرز پروانه می‌مانند', () => {
    const poly = square([0, 0], 150);
    const plan = planPitDesign({
      heightFn: flat, licensePoly: poly, targetM3: 3_000_000, mode: 'pit',
      params: { benchHeight: 10, benchFaceAngleDeg: 70, boundarySetbackM: 10 },
    });
    expect(plan.mode).toBe('pit');
    expect(plan.fit.meetsTarget).toBe(true);
    expect(plan.fit.achievedM3).toBeGreaterThanOrEqual(3_000_000 * 0.999);
    expect(plan.metrics.benchCount).toBeGreaterThan(1);
    expect(checkCrest(plan.design, flat, plan.allowedPoly).ok).toBe(true);
    expect(plan.ramp).not.toBeNull();
    expect(plan.metrics.osaDeg).toBeLessThan(plan.metrics.iraDeg);
  });
  it('اگر ذخیره داخل مرز جا نشود، کسری را صادقانه گزارش می‌کند', () => {
    const plan = planPitDesign({
      heightFn: flat, licensePoly: square([0, 0], 60), targetM3: 50_000_000, mode: 'pit',
      params: { benchHeight: 10, boundarySetbackM: 10 },
    });
    expect(plan.fit.meetsTarget).toBe(false);
    expect(plan.fit.shortfallM3).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.includes('نمی‌رسد'))).toBe(true);
  });
});

describe('planPitDesign — دامنه‌ای روی شیب ۲۵ درجه', () => {
  const poly = square([0, 0], 150);
  const plan = planPitDesign({
    heightFn: slope(25), licensePoly: poly, targetM3: 150_000, mode: 'auto', group: 3,
    params: { benchHeight: 10, benchFaceAngleDeg: 65, boundarySetbackM: 10, platformWidthM: 30 },
  });
  it('خودکار دامنه‌ای انتخاب می‌شود و به حجم هدف می‌رسد', () => {
    expect(plan.mode).toBe('hillside');
    expect(plan.fit.meetsTarget).toBe(true);
    expect(plan.design.benches[plan.design.benches.length - 1].outcropped).toBe(true);
  });
  it('هیچ بخشِ واقعاً برش‌خورده‌ای بیرون از مرز مجاز نیست', () => {
    const chk = checkCrest(plan.design, slope(25), plan.allowedPoly);
    expect(chk.ok).toBe(true);
    expect(chk.total).toBeGreaterThan(20);
  });
  it('رمپ زیگزاگ ساخته می‌شود و هندسه‌ی رسم بخش‌های در هوا را حذف می‌کند', () => {
    expect(plan.ramp.kind).toBe('zigzag');
    expect(plan.ramp.totalLength).toBeGreaterThan(0);
    const geo = buildPlanGeometry(plan, slope(25));
    expect(geo.faces.length).toBeGreaterThan(0);
    // سینه‌ها فقط جایی‌اند که زمین بالاتر از تراز پایین پله است
    for (let i = 0; i < geo.faces.length; i += 9) {
      const e = geo.faces[i]; const n = geo.faces[i + 1];
      expect(slope(25)(e, n)).toBeGreaterThan(plan.design.benches[0].elevation - 0.5);
    }
  });
  it('خروجی DXF و CSV تولید می‌شود و CSV کسری/هشدار را دارد', () => {
    const csv = exportPlanReportCsv(plan, null, [500000, 3800000, 1500]);
    expect(csv).toContain('خلاصه‌ی طراحی خودکار');
    expect(exportPlanBenchesDxf(plan, [500000, 3800000, 1500])).toContain('LWPOLYLINE');
  });
});

describe('crestFraction', () => {
  it('محل برخورد سینه با زمین را درست پیدا می‌کند', () => {
    // سینه از (0,0,z=0) تا (10,0,z=10)؛ زمین تخت در ارتفاع ۴ → برخورد در t=0.4
    expect(crestFraction(() => 4, [0, 0], 0, [10, 0], 10)).toBeCloseTo(0.4, 2);
    expect(crestFraction(() => 20, [0, 0], 0, [10, 0], 10)).toBe(1);
    expect(crestFraction(() => -5, [0, 0], 0, [10, 0], 10)).toBeNull();
  });
});

describe('خطاها', () => {
  it('محدوده‌ی خارج از مدل خطای روشن می‌دهد', () => {
    expect(() => planPitDesign({ heightFn: () => NaN, licensePoly: square([0, 0], 100), mode: 'pit' })).toThrow();
  });
  it('پارامتر نامعتبر رد می‌شود', () => {
    expect(() => planPitDesign({ heightFn: flat, licensePoly: square([0, 0], 100), params: { benchHeight: 0 } })).toThrow();
  });
});

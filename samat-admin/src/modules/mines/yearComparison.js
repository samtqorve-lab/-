import { el } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getCurrentJalaliYMD } from '../../lib/jalali.js';

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

function periodYear(period) {
  const m = String(period || '').match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}
function periodMonthIndex(period) {
  const name = String(period || '').split(' ')[0];
  return JALALI_MONTHS.indexOf(name);
}

function bar(value, max, color) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
  return el('div', { style: 'flex:1;display:flex;flex-direction:column;align-items:center;gap:4px' }, [
    el('div', { style: 'width:100%;height:60px;display:flex;align-items:flex-end' },
      el('div', { style: `width:100%;height:${pct}%;background:${color};border-radius:3px 3px 0 0` })),
    el('div', { style: 'font-size:9px;color:var(--stone-600)' }, value ? String(value) : ''),
  ]);
}

function renderComparisonRow(title, thisYearByMonth, lastYearByMonth, thisYear, lastYear) {
  const max = Math.max(1, ...thisYearByMonth, ...lastYearByMonth);
  return el('div', { style: 'margin-bottom:18px' }, [
    el('div', { style: 'font-weight:700;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:10px' }, [
      el('span', {}, title),
      el('span', { style: 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--ochre-700);font-weight:400' }, [
        el('span', { style: 'width:9px;height:9px;border-radius:2px;background:var(--ochre-600);display:inline-block' }), String(thisYear),
      ]),
      el('span', { style: 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--stone-600);font-weight:400' }, [
        el('span', { style: 'width:9px;height:9px;border-radius:2px;background:var(--stone-300);display:inline-block' }), String(lastYear),
      ]),
    ]),
    el('div', { style: 'display:flex;gap:3px' }, JALALI_MONTHS.map((mLabel, i) => el('div', { style: 'flex:1;display:flex;gap:2px' }, [
      bar(lastYearByMonth[i], max, 'var(--stone-300)'),
      bar(thisYearByMonth[i], max, 'var(--ochre-600)'),
    ]))),
    el('div', { style: 'display:flex;gap:3px;margin-top:4px' }, JALALI_MONTHS.map((mLabel) => el('div', { style: 'flex:1;text-align:center;font-size:8px;color:var(--stone-500)' }, mLabel[0]))),
  ]);
}

/**
 * مقایسه‌ی سال جاری با سال قبل برای یک معدن: تعداد گزارش‌های دوره‌ای ارسالی، و (در صورت وجود
 * داده) تناژ تولید ثبت‌شده — ماه‌به‌ماه، به‌صورت نمودار میله‌ای ساده (بدون کتابخانه‌ی نموداری جدید).
 */
export async function mountYearComparison(hostEl, mineName) {
  const { y: currentJYear } = getCurrentJalaliYMD();
  const lastJYear = currentJYear - 1;

  const [reportsRes, productionRes] = await Promise.all([
    sb.from('tech_reports').select('period').eq('mine_name', mineName),
    sb.from('production_reports').select('period, tonnage').eq('mine_name', mineName),
  ]);

  const reportRows = reportsRes.data || [];
  const prodRows = productionRes.data || [];

  const reportsThisYear = new Array(12).fill(0);
  const reportsLastYear = new Array(12).fill(0);
  reportRows.forEach((r) => {
    const y = periodYear(r.period); const mi = periodMonthIndex(r.period);
    if (mi < 0) return;
    if (y === currentJYear) reportsThisYear[mi] += 1;
    else if (y === lastJYear) reportsLastYear[mi] += 1;
  });

  const prodThisYear = new Array(12).fill(0);
  const prodLastYear = new Array(12).fill(0);
  prodRows.forEach((r) => {
    const y = periodYear(r.period); const mi = periodMonthIndex(r.period);
    if (mi < 0) return;
    const tonnage = Number(r.tonnage) || 0;
    if (y === currentJYear) prodThisYear[mi] += tonnage;
    else if (y === lastJYear) prodLastYear[mi] += tonnage;
  });

  const hasAnyData = reportRows.length || prodRows.length;
  if (!hasAnyData) {
    hostEl.append(el('div', { style: 'font-size:12px;color:var(--stone-600)' }, 'هنوز داده‌ی کافی برای مقایسه‌ی سالانه ثبت نشده.'));
    return;
  }

  hostEl.append(renderComparisonRow('📤 تعداد گزارش دوره‌ای ارسالی', reportsThisYear, reportsLastYear, currentJYear, lastJYear));
  if (prodRows.length) {
    hostEl.append(renderComparisonRow('📈 تناژ تولید ثبت‌شده', prodThisYear, prodLastYear, currentJYear, lastJYear));
  }
}

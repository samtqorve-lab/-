import { el } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import { licenseExpiryInfo } from '../../lib/jalali.js';
import { setMineInDept } from '../../router.js';

const SIX_MONTHS_MS = 182 * 24 * 3600 * 1000;

function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
}

function urgencyScore(row) {
  // بالاتر = فوری‌تر: پروانه‌ی منقضی/نزدیک‌به‌انقضا + بی‌گزارشیِ طولانی، بالای جدول می‌آید
  let score = 0;
  if (row.license) {
    if (row.license.expired) score += 1000 + Math.abs(row.license.monthsLeft);
    else if (row.license.monthsLeft <= 3) score += 200 - row.license.monthsLeft * 10;
  }
  if (row.lastReportDays === null) score += 150;
  else if (row.lastReportDays > 45) score += Math.min(140, row.lastReportDays);
  return score;
}

function licenseBadge(license) {
  if (!license) return el('span', { style: 'color:var(--stone-500);font-size:11px' }, '—');
  if (license.expired) return el('span', { class: 'badge badge-rust' }, `منقضی (${Math.abs(license.monthsLeft)} ماه پیش)`);
  if (license.monthsLeft <= 3) return el('span', { class: 'badge badge-amber' }, `${license.monthsLeft} ماه مانده`);
  return el('span', { class: 'badge badge-patina' }, `${license.monthsLeft} ماه مانده`);
}

function reportBadge(days) {
  if (days === null) return el('span', { class: 'badge badge-rust' }, 'بدون گزارش');
  if (days > 45) return el('span', { class: 'badge badge-amber' }, `${days} روز پیش`);
  return el('span', { class: 'badge badge-patina' }, `${days} روز پیش`);
}

/**
 * جدول رتبه‌بندی معادن برای اولویت‌بندی بازدید: وضعیت پروانه + آخرین گزارش دوره‌ای + تعداد
 * گزارش در ۶ ماه اخیر. پیش‌فرض بر اساس فوریت مرتب می‌شود (منقضی/بی‌گزارش‌ها بالا).
 */
export async function renderComplianceRanking(container, state) {
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div>در حال بارگذاری...</div>';

  const nameField = DEPT_NAME_FIELD.معدن;
  let mines = await fetchDeptRecords('معدن').catch(() => []);
  mines = applyGeoScope(mines, state.assignedProvince, state.assignedCounty);

  const { data: reportRows } = await sb.from('tech_reports').select('mine_name, created_at').eq('department', 'معدن');
  const byMine = new Map();
  (reportRows || []).forEach((r) => {
    const cur = byMine.get(r.mine_name) || { lastDate: null, count6mo: 0 };
    if (!cur.lastDate || new Date(r.created_at) > new Date(cur.lastDate)) cur.lastDate = r.created_at;
    if (Date.now() - new Date(r.created_at).getTime() <= SIX_MONTHS_MS) cur.count6mo += 1;
    byMine.set(r.mine_name, cur);
  });

  let rows = mines.map((m) => {
    const name = m[nameField] || '—';
    const stats = byMine.get(name) || { lastDate: null, count6mo: 0 };
    const license = licenseExpiryInfo(m, 'معدن');
    const row = {
      id: m._rowId, name, license, lastReportDate: stats.lastDate, lastReportDays: daysAgo(stats.lastDate), count6mo: stats.count6mo,
    };
    row.score = urgencyScore(row);
    return row;
  });
  rows.sort((a, b) => b.score - a.score);

  container.innerHTML = '';
  container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:14px' },
    'پیش‌فرض بر اساس فوریت مرتب شده (پروانه‌ی منقضی/نزدیک‌به‌انقضا و بی‌گزارشی طولانی، بالای جدول). برای مرتب‌سازی دیگر، روی عنوان ستون کلیک کنید.'));

  const table = el('table', { class: 'data-table', style: 'width:100%' });
  const thead = el('thead', {}, el('tr', {}, [
    el('th', {}, 'معدن'),
    el('th', { style: 'cursor:pointer', onclick: () => { rows = [...rows].sort((a, b) => (a.license?.monthsLeft ?? 999) - (b.license?.monthsLeft ?? 999)); drawBody(); } }, 'وضعیت پروانه ↕'),
    el('th', { style: 'cursor:pointer', onclick: () => { rows = [...rows].sort((a, b) => (b.lastReportDays ?? 9999) - (a.lastReportDays ?? 9999)); drawBody(); } }, 'آخرین گزارش ↕'),
    el('th', { style: 'cursor:pointer', onclick: () => { rows = [...rows].sort((a, b) => a.count6mo - b.count6mo); drawBody(); } }, 'تعداد گزارش (۶ ماه) ↕'),
  ]));
  const tbody = el('tbody');
  table.append(thead, tbody);

  function drawBody() {
    tbody.innerHTML = '';
    rows.forEach((r) => {
      tbody.append(el('tr', { style: 'cursor:pointer', onclick: () => setMineInDept(r.id, 'معدن') }, [
        el('td', { style: 'font-weight:600' }, r.name),
        el('td', {}, licenseBadge(r.license)),
        el('td', {}, reportBadge(r.lastReportDays)),
        el('td', {}, String(r.count6mo)),
      ]));
    });
  }
  drawBody();
  container.append(table);
}

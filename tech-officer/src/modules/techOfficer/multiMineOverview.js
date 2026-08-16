import { el } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { recentPeriodOptions } from '../../lib/jalali.js';

/**
 * فقط وقتی بیش از یک معدن اختصاص دارد نمایش داده می‌شود: نشان می‌دهد کدام معدن‌ها گزارش دوره‌ای
 * این ماه را هنوز ندارند — قبلاً برای دیدن این وضعیت باید یکی‌یکی از dropdown انتخاب می‌شد.
 */
export function mountMultiMineOverview(container, mines, nameField, onPick) {
  if (!mines || mines.length < 2) { container.innerHTML = ''; return; }
  const currentPeriod = recentPeriodOptions(1)[0];
  container.innerHTML = '';
  container.append(el('div', { class: 'loading-state' }, 'در حال بررسی وضعیت گزارش‌های این ماه...'));

  const mineNames = mines.map((m) => m[nameField]);
  sb.from('tech_reports').select('mine_name, period').in('mine_name', mineNames).eq('period', currentPeriod)
    .then(({ data, error }) => {
      container.innerHTML = '';
      if (error) { container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--rust-600)' }, 'خطا در بررسی وضعیت گزارش‌ها')); return; }
      const reported = new Set((data || []).map((r) => r.mine_name));
      const missing = mineNames.filter((n) => !reported.has(n));
      if (!missing.length) {
        container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--patina-700)' }, `✅ گزارش دوره‌ای ${currentPeriod} برای همه‌ی موارد اختصاصی ثبت شده`));
        return;
      }
      container.append(
        el('div', { style: 'font-size:var(--text-xs);color:var(--amber-700);margin-bottom:6px' }, `⚠️ گزارش دوره‌ای ${currentPeriod} برای ${missing.length} مورد هنوز ثبت نشده:`),
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, missing.map((n) => el('button', {
          class: 'btn-sm', style: 'background:var(--amber-100);color:var(--amber-700)', onclick: () => onPick(n),
        }, n))),
      );
    });
}

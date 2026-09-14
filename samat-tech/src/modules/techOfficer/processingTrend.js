import { el, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { JALALI_MONTHS } from '../../lib/jalali.js';

function periodSortKey(period) {
  const [monthName, year] = period.split(' ');
  const mi = JALALI_MONTHS.indexOf(monthName);
  return Number(year) * 12 + (mi === -1 ? 0 : mi);
}

async function loadReports(mineName) {
  const { data, error } = await sb.from('processing_reports')
    .select('period,feed_tonnage,product_tonnage,recovery_percent')
    .eq('mine_name', mineName).limit(200);
  if (error || !data) return [];
  // چون چند گزارش برای یک دوره ممکن است ثبت شده باشد، آخرین مقدار هر دوره نگه داشته می‌شود
  // (ترتیب برگشتی Supabase تضمینی نیست، پس صرفاً بر اساس دوره یکتاسازی می‌کنیم، نه «آخرین»).
  const byPeriod = new Map();
  data.forEach((r) => { byPeriod.set(r.period, r); });
  return [...byPeriod.values()].sort((a, b) => periodSortKey(a.period) - periodSortKey(b.period)).slice(-12);
}

/**
 * نمودار روند تولید — تناژ خوراک/محصول و درصد بازیابی در ۱۲ دوره‌ی اخیر، از روی گزارش‌های
 * قبلاً ثبت‌شده در processing_reports (بدون نیاز به ورودی جدید یا کتابخانه‌ی نمودار خارجی).
 * @param {object} mine
 * @param {string} nameField
 */
export async function openProcessingTrendModal(mine, nameField) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `📈 روند تولید — ${mineName}`, width: '440px' });
  body.append(el('div', { style: 'text-align:center;padding:20px;color:var(--stone-500)' }, '⏳ در حال بارگذاری...'));

  const rows = await loadReports(mineName);
  body.innerHTML = '';

  if (!rows.length) {
    body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500)' }, 'هنوز گزارش خوراک/محصولی برای این واحد ثبت نشده.'));
    return;
  }

  const maxTonnage = Math.max(...rows.map((r) => Math.max(r.feed_tonnage || 0, r.product_tonnage || 0)), 1);

  body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'نوار آبی: تناژ خوراک ورودی — نوار سبز: تناژ محصول خروجی — عدد سمت راست: درصد بازیابی همان دوره.'));

  rows.forEach((r) => {
    const feedPct = ((r.feed_tonnage || 0) / maxTonnage) * 100;
    const prodPct = ((r.product_tonnage || 0) / maxTonnage) * 100;
    body.append(el('div', { style: 'margin-bottom:12px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;font-size:11px;color:var(--stone-600);margin-bottom:2px' }, [
        el('span', {}, r.period),
        el('span', { style: 'font-weight:700;color:var(--patina-700)' }, r.recovery_percent != null ? `${r.recovery_percent}٪ بازیابی` : '—'),
      ]),
      el('div', { style: 'background:var(--stone-100);border-radius:4px;height:10px;overflow:hidden;margin-bottom:2px' },
        el('div', { style: `width:${feedPct}%;height:100%;background:#5b8def` })),
      el('div', { style: 'background:var(--stone-100);border-radius:4px;height:10px;overflow:hidden' },
        el('div', { style: `width:${prodPct}%;height:100%;background:#3fa66a` })),
      el('div', { style: 'font-size:10px;color:var(--stone-500);margin-top:2px' },
        `خوراک: ${r.feed_tonnage ?? '—'} تن  ·  محصول: ${r.product_tonnage ?? '—'} تن`),
    ]));
  });
}

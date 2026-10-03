import { el, fmtDate } from '../../lib/dom.js';
import { fetchNoticesForUser } from '../../lib/notices.js';

/**
 * اطلاعیه‌های «یک معدن مشخص»: فقط اطلاعیه‌های اختصاصی همان معدنِ انتخاب‌شده + اطلاعیه‌های عمومیِ
 * بخش (mine_name خالی). اطلاعیه‌ی معدن‌های دیگرِ همین کاربر (اگر چند معدن دارد) هرگز اینجا
 * نمایش داده نمی‌شود، تا اطلاعیه‌ی معدن‌ها با هم قاطی نشود.
 *
 * بعد از mount، هر بار که معدنِ انتخاب‌شده عوض شد onMineChange() را صدا بزنید.
 */
export function mountMineNotices(host, { getMineName, department }) {
  let cache = null;

  function noticeCard(n, tag) {
    return el('div', { style: 'border:1px solid var(--stone-200);border-radius:10px;padding:10px 12px;margin-bottom:8px' }, [
      el('div', { style: 'font-weight:700;font-size:var(--text-sm)' }, n.title),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:2px 0 6px' }, `${tag} · ${fmtDate(n.created_at)}`),
      el('div', { style: 'font-size:var(--text-sm);white-space:pre-wrap' }, n.body),
    ]);
  }

  function draw() {
    host.innerHTML = '';
    const mine = (getMineName() || '').trim();
    if (!mine) {
      host.append(el('div', { class: 'empty-state' }, 'ابتدا معدن را انتخاب کنید'));
      return;
    }
    const own = (cache || []).filter((n) => n.mine_name === mine);
    const general = (cache || []).filter((n) => !n.mine_name);
    if (!own.length && !general.length) {
      host.append(el('div', { class: 'empty-state' }, `اطلاعیه‌ای برای «${mine}» ثبت نشده`));
      return;
    }
    own.forEach((n) => host.append(noticeCard(n, `📌 مخصوص ${mine}`)));
    general.forEach((n) => host.append(noticeCard(n, '📢 عمومی')));
  }

  async function refresh() {
    host.innerHTML = '';
    host.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری اطلاعیه‌ها...'));
    try {
      cache = await fetchNoticesForUser(department);
    } catch (err) {
      host.innerHTML = '';
      host.append(el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, `خطا در بارگذاری اطلاعیه‌ها: ${err.message}`));
      return;
    }
    draw();
  }

  function onMineChange() {
    if (cache) draw(); else refresh();
  }

  return { refresh, onMineChange };
}

import { el, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso || '-';
  }
}

/** همه‌ی عکس‌های سینه‌کار/ماشین‌آلات یک معدن را از دو منبع (گزارش‌های دوره‌ای + ثبت مستقیم
 * ماشین‌آلات پیش‌فرض) جمع، بر اساس تاریخ مرتب، و به‌صورت یک گالری زمانی نمایش می‌دهد. */
export async function openPhotoTimelineModal(mineName) {
  const { body } = openModal({ title: `🖼️ گالری زمانی عکس‌ها — ${mineName}`, width: '760px' });
  body.append(el('div', { class: 'loading-state' }, [el('div', { class: 'spinner' }), 'در حال بارگذاری عکس‌ها...']));

  const [reportsRes, equipRes] = await Promise.all([
    sb.from('tech_reports').select('created_at, period, file_urls').eq('mine_name', mineName).order('created_at', { ascending: false }),
    sb.from('mine_equipment').select('created_at, photo_url, machine_type, photo_type, serial_no').eq('mine_name', mineName).order('created_at', { ascending: false }),
  ]);

  const items = [];
  (reportsRes.data || []).forEach((r) => {
    (r.file_urls?.face || []).forEach((url) => items.push({
      url, date: r.created_at, label: `سینه‌کار — گزارش ${r.period}`, kind: 'face',
    }));
    (r.file_urls?.equip || []).forEach((url) => items.push({
      url, date: r.created_at, label: `ماشین‌آلات — گزارش ${r.period}`, kind: 'equip',
    }));
  });
  (equipRes.data || []).forEach((e) => {
    items.push({
      url: e.photo_url,
      date: e.created_at,
      label: `${e.machine_type || 'ماشین‌آلات'}${e.serial_no ? ` — سریال ${e.serial_no}` : ''} (${e.photo_type === 'overview' ? 'نمای دور' : 'پلاک سریال'})`,
      kind: 'equip',
    });
  });
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  body.innerHTML = '';
  if (!items.length) {
    body.append(el('div', { style: 'font-size:var(--text-sm);color:var(--stone-600);text-align:center;padding:20px' }, 'هنوز عکسی برای این معدن ثبت نشده.'));
    return;
  }

  const filterBar = el('div', { style: 'display:flex;gap:6px;margin-bottom:12px' });
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px' });

  function draw(filter) {
    grid.innerHTML = '';
    items.filter((it) => filter === 'all' || it.kind === filter).forEach((it) => {
      grid.append(el('a', { href: it.url, target: '_blank', style: 'display:block;text-decoration:none;color:inherit' }, [
        el('img', {
          src: it.url, loading: 'lazy',
          style: 'width:100%;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--stone-200)',
        }),
        el('div', { style: 'font-size:10.5px;color:var(--stone-600);margin-top:4px' }, formatDate(it.date)),
        el('div', { style: 'font-size:10.5px;color:var(--ink-700);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, it.label),
      ]));
    });
  }
  ['all', 'face', 'equip'].forEach((key) => {
    filterBar.append(el('button', {
      class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)',
      onclick: (e) => {
        filterBar.querySelectorAll('button').forEach((b) => { b.style.background = 'var(--stone-100)'; b.style.color = 'var(--ink-700)'; });
        e.target.style.background = 'var(--ochre-600)'; e.target.style.color = '#fff';
        draw(key);
      },
    }, key === 'all' ? `همه (${items.length})` : key === 'face' ? `سینه‌کار (${items.filter((i) => i.kind === 'face').length})` : `ماشین‌آلات (${items.filter((i) => i.kind === 'equip').length})`));
  });
  filterBar.firstChild.style.background = 'var(--ochre-600)';
  filterBar.firstChild.style.color = '#fff';

  body.append(filterBar, grid);
  draw('all');
}

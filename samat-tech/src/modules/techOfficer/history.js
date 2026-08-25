import { el, esc, fmtDate } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

export function mountHistory(container, mineNames) {
  const searchInput = el('input', { type: 'text', placeholder: 'جست‌وجو بر اساس معدن یا دوره...', style: 'margin-bottom:8px' });
  const listBox = el('div');
  container.append(searchInput, listBox);

  let data = [];

  async function load() {
    if (!mineNames || !mineNames.length) { listBox.innerHTML = ''; return; }
    listBox.innerHTML = '';
    listBox.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری...'));
    const { data: rows, error } = await sb.from('tech_reports').select('*').in('mine_name', mineNames).order('created_at', { ascending: false }).limit(20);
    if (error) { listBox.innerHTML = ''; listBox.append(el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, 'خطا در بارگذاری تاریخچه')); return; }
    data = rows || [];
    draw();
  }

  function fileLinks(fu) {
    if (!fu) return null;
    const groups = [
      ['report', '📄 گزارش', fu.report],
      ['face', '📷 سینه‌کار', fu.face],
      ['equip', '📷 ماشین‌آلات', fu.equip],
    ];
    const parts = groups.filter(([, , urls]) => urls && urls.length).map(([key, label, urls]) => urls.map((u, i) => el('a', {
      href: u, target: '_blank', rel: 'noopener', style: 'color:var(--schist-600);margin-left:10px;font-size:var(--text-xs)',
    }, `${label}${urls.length > 1 ? ` ${i + 1}` : ''}`)));
    if (!parts.length) return null;
    return el('div', { style: 'margin-top:4px' }, parts.flat());
  }

  function draw() {
    const q = searchInput.value.trim().toLowerCase();
    const rows = !q ? data : data.filter((r) => (r.mine_name || '').toLowerCase().includes(q) || (r.period || '').toLowerCase().includes(q));
    listBox.innerHTML = '';
    if (!data.length) { listBox.append(el('div', { class: 'empty-state' }, 'هنوز گزارشی ارسال نشده')); return; }
    if (!rows.length) { listBox.append(el('div', { class: 'empty-state' }, 'موردی با این جست‌وجو پیدا نشد')); return; }
    rows.forEach((r) => {
      listBox.append(el('div', { style: 'background:var(--stone-50);border-radius:10px;padding:10px 12px;margin-bottom:6px;font-size:var(--text-sm)' }, [
        el('b', {}, esc(r.mine_name)), ` — ${esc(r.period || '')} `,
        el('span', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, `(${fmtDate(r.created_at)})`),
        r.note ? el('div', { style: 'color:var(--stone-600);margin-top:4px' }, esc(r.note)) : null,
        fileLinks(r.file_urls),
      ]));
    });
  }

  searchInput.addEventListener('input', draw);
  load();
  return { reload: load };
}

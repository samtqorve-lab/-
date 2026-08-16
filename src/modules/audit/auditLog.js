import { el, fmtDateTime } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

const DEPT_LABELS = { user_access: '👤 دسترسی کاربران', معدن: '⛏️ معدن', صنعت: '🏭 صنعت', اکتشاف: '🔍 اکتشاف', فرآوری: '⚗️ فرآوری' };
const PAGE_SIZE = 40;

/**
 * این تب داده‌ای را نشان می‌دهد که از قبل در جدول audit_log نوشته می‌شد (تغییر نقش/دسترسی کاربران،
 * بررسی احراز هویت) اما هیچ‌جای رابط کاربری نمایش داده نمی‌شد — یعنی این تب فقط یک viewer برای
 * داده‌ی موجود است، نه یک مکانیزم لاگ جدید.
 */
export async function renderAuditLog(container) {
  container.innerHTML = '';

  const filterBar = el('div', { class: 'card', style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end' });
  const deptSelect = el('select', {}, [
    el('option', { value: '' }, 'همه‌ی بخش‌ها'),
    ...Object.entries(DEPT_LABELS).map(([k, l]) => el('option', { value: k }, l)),
  ]);
  const userInput = el('input', { type: 'text', placeholder: 'ایمیل تغییردهنده یا موضوع...', style: 'min-width:220px' });
  const searchBtn = el('button', { class: 'btn btn-primary' }, '🔎 اعمال فیلتر');
  filterBar.append(
    el('div', {}, [el('label', {}, 'بخش'), deptSelect]),
    el('div', { style: 'flex:1' }, [el('label', {}, 'جست‌وجو (ایمیل/موضوع)'), userInput]),
    searchBtn,
  );
  container.append(filterBar);

  const listBox = el('div', { style: 'margin-top:16px' });
  const loadMoreBox = el('div', { style: 'text-align:center;margin-top:14px' });
  container.append(listBox, loadMoreBox);

  let offset = 0;
  let rows = [];

  async function load(reset) {
    if (reset) { offset = 0; rows = []; listBox.innerHTML = ''; }
    loadMoreBox.innerHTML = '';
    listBox.append(el('div', { class: 'loading-state', id: 'auditLoading' }, [el('div', { class: 'spinner' }), 'در حال بارگذاری...']));

    let query = sb.from('audit_log').select('*').order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    if (deptSelect.value) query = query.eq('department', deptSelect.value);
    const q = userInput.value.trim();
    if (q) query = query.or(`changed_by.ilike.%${q}%,record_name.ilike.%${q}%`);

    const { data, error } = await query;
    document.getElementById('auditLoading')?.remove();
    if (error) {
      listBox.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${error.message}`));
      return;
    }
    rows = rows.concat(data || []);
    offset += (data || []).length;
    draw();
    if ((data || []).length === PAGE_SIZE) {
      loadMoreBox.append(el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => load(false) }, 'موارد قبلی‌تر ↓'));
    }
  }

  function draw() {
    listBox.innerHTML = '';
    if (!rows.length) { listBox.append(el('div', { class: 'empty-state' }, 'موردی ثبت نشده')); return; }
    rows.forEach((r) => {
      listBox.append(el('div', { class: 'card', style: 'padding:12px 16px;margin-bottom:8px' }, [
        el('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px' }, [
          el('div', { style: 'font-weight:700;font-size:var(--text-sm)' }, r.field_label || r.field_key || '—'),
          el('span', { style: 'font-size:var(--text-xs);color:var(--stone-500)' }, fmtDateTime(r.created_at)),
        ]),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:4px' },
          `${DEPT_LABELS[r.department] || r.department || '—'} — موضوع: ${r.record_name || '—'}`),
        r.new_value ? el('div', { style: 'font-size:var(--text-xs);color:var(--ink-700);margin-top:4px;background:var(--stone-50);border-radius:6px;padding:6px 8px' }, r.new_value) : null,
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:4px' }, `توسط: ${r.changed_by || '—'}`),
      ]));
    });
  }

  searchBtn.addEventListener('click', () => load(true));
  userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(true); });
  deptSelect.addEventListener('change', () => load(true));

  await load(true);
}

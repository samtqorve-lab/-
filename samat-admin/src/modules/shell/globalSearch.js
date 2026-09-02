import { el } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { fetchDeptRecords } from '../../lib/records.js';
import { DEPT_NAME_FIELD, DEPT_PLURAL_LABEL } from '../../lib/sections.js';
import { setMineInDept, setTab, getState, onChange } from '../../router.js';

// قبلاً این جست‌وجو همیشه هم‌زمان در همه‌ی بخش‌ها (معدن/صنعت/اکتشاف/فرآوری/اصناف) می‌گشت —
// یعنی وقتی کاربر داخل بخش صنعت بود، نتایج معدن هم می‌آمدند و کل تجربه به‌جای مختص‌بودن به
// بخش فعال، سراسری به نظر می‌رسید. حالا فقط همان بخشی که کاربر الان در آن است جست‌وجو می‌شود.
async function searchMines(query, department) {
  const nameField = DEPT_NAME_FIELD[department] || 'نام_معدن';
  const list = await fetchDeptRecords(department).catch(() => []);
  return list
    .filter((r) => (r[nameField] || '').includes(query))
    .slice(0, 8)
    .map((r) => ({ type: 'mine', dept: department, id: r._rowId, name: r[nameField] || '', nameField }));
}

async function searchUsers(query) {
  const { data } = await sb.from('user_roles').select('email, full_name, role')
    .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`).limit(6);
  return (data || []).map((u) => ({
    type: 'user', email: u.email, name: u.full_name || u.email, role: u.role,
  }));
}

async function searchReports(query) {
  const { data } = await sb.from('tech_reports').select('id, mine_name, period, note')
    .or(`mine_name.ilike.%${query}%,note.ilike.%${query}%`)
    .order('created_at', { ascending: false }).limit(6);
  return (data || []).map((r) => ({
    type: 'report', mineName: r.mine_name, period: r.period, note: r.note,
  }));
}

/** نوار جست‌وجوی بالای صفحه — در بخش‌ها (معادن/صنایع/...) محدود به بخش فعال، به‌علاوه‌ی کاربران و گزارش‌های دوره‌ای که سراسری‌اند */
export function mountGlobalSearch(hostEl) {
  const input = el('input', {
    type: 'text', placeholder: '🔍 جست‌وجو...',
    style: 'width:100%;max-width:360px',
  });
  const results = el('div', {
    style: 'position:absolute;top:100%;right:0;left:0;background:#fff;border:1px solid var(--stone-200);'
      + 'border-radius:var(--radius-md);box-shadow:var(--shadow-lg);max-height:60vh;overflow-y:auto;z-index:1100;display:none',
  });
  const wrap = el('div', { style: 'position:relative;flex:1;max-width:360px' }, [input, results]);
  hostEl.append(wrap);

  function updatePlaceholder() {
    const plural = DEPT_PLURAL_LABEL[getState().department] || 'معادن';
    input.placeholder = `🔍 جست‌وجو در ${plural}، کاربران، گزارش‌ها...`;
  }
  updatePlaceholder();
  onChange(updatePlaceholder);

  let debounceTimer = null;
  let requestId = 0;

  function hide() { results.style.display = 'none'; }
  function show() { results.style.display = 'block'; }

  function row(icon, title, subtitle, onClick) {
    return el('button', {
      style: 'display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:right;'
        + 'background:none;border:none;border-bottom:1px solid var(--stone-100);padding:10px 12px;cursor:pointer',
      onclick: () => { onClick(); hide(); input.value = ''; },
    }, [
      el('div', { style: 'font-size:13px;font-weight:700' }, `${icon} ${title}`),
      subtitle ? el('div', { style: 'font-size:11px;color:var(--stone-600);margin-top:2px' }, subtitle) : null,
    ]);
  }

  async function runSearch(query) {
    const myRequestId = ++requestId;
    const department = getState().department;
    const [mines, users, reports] = await Promise.all([
      searchMines(query, department), searchUsers(query), searchReports(query),
    ]);
    if (myRequestId !== requestId) return; // یک جست‌وجوی جدیدتر شروع شده، این نتیجه دیرهنگام است

    results.innerHTML = '';
    if (!mines.length && !users.length && !reports.length) {
      results.append(el('div', { style: 'padding:14px;font-size:12px;color:var(--stone-600);text-align:center' }, 'نتیجه‌ای یافت نشد'));
      show();
      return;
    }
    if (mines.length) {
      results.append(el('div', { style: 'padding:8px 12px;font-size:11px;color:var(--stone-500);background:var(--stone-50)' }, `⛏ ${DEPT_PLURAL_LABEL[department] || 'معادن'}`));
      mines.forEach((m) => results.append(row('⛏', m.name, m.dept, () => setMineInDept(m.id, m.dept))));
    }
    if (users.length) {
      results.append(el('div', { style: 'padding:8px 12px;font-size:11px;color:var(--stone-500);background:var(--stone-50)' }, '◐ کاربران'));
      users.forEach((u) => results.append(row('◐', u.name, `${u.email} — ${u.role}`, () => setTab('users'))));
    }
    if (reports.length) {
      results.append(el('div', { style: 'padding:8px 12px;font-size:11px;color:var(--stone-500);background:var(--stone-50)' }, '📤 گزارش‌های دوره‌ای'));
      reports.forEach((r) => results.append(row('📤', r.mineName, `${r.period}${r.note ? ` — ${r.note.slice(0, 40)}` : ''}`, () => setTab('mines'))));
    }
    show();
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 2) { hide(); return; }
    debounceTimer = setTimeout(() => runSearch(query), 300);
  });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) show(); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) hide(); });
}

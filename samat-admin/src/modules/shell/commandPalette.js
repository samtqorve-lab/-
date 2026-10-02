import { el } from '../../lib/dom.js';
import { getState, setTab, setDepartment, setMineInDept } from '../../router.js';
import { searchMines, searchUsers, searchReports } from './globalSearch.js';
import { DEPT_PLURAL_LABEL } from '../../lib/sections.js';

const DEPARTMENTS = ['معدن', 'اکتشاف', 'فرآوری', 'صنعت', 'اصناف'];
const ZWNJ = String.fromCharCode(0x200c);

function norm(s) {
  return String(s || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .split(ZWNJ).join(' ')
    .toLowerCase();
}

let hotkeyBound = false;

/**
 * پنجره‌ی جست‌وجوی سریع (Ctrl+K / ⌘K): پرش به صفحه‌ها و بخش‌ها (فوری و آفلاین) + نتایج زنده‌ی
 * معدن/کاربر/گزارش. ناوبری با ↑ ↓ Enter و بستن با Esc.
 * @param {{ getPages: () => {tab:string,label:string,icon:string}[] }} opts
 * @returns {{ open: () => void }}
 */
export function mountCommandPalette({ getPages }) {
  let overlay = null;

  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function open() {
    if (overlay) return;
    let active = 0;
    let items = [];
    let sections = [];
    let reqId = 0;
    let timer = null;

    const input = el('input', {
      type: 'text', class: 'cmdk-input', autocomplete: 'off',
      placeholder: 'برو به صفحه، بخش، معدن، کاربر یا گزارش...',
    });
    const list = el('div', { class: 'cmdk-list', role: 'listbox' });
    const card = el('div', { class: 'cmdk-card' }, [
      input, list, el('div', { class: 'cmdk-hint' }, '↑ ↓ حرکت · Enter انتخاب · Esc بستن'),
    ]);
    overlay = el('div', { class: 'cmdk-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, card);
    document.body.append(overlay);

    function highlight() {
      Array.from(list.querySelectorAll('.cmdk-item')).forEach((node, i) => {
        node.classList.toggle('active', i === active);
        if (i === active) node.scrollIntoView({ block: 'nearest' });
      });
    }

    function choose(idx) {
      const it = items[idx];
      if (!it) return;
      close();
      it.run();
    }

    function draw() {
      list.innerHTML = '';
      items = [];
      sections.forEach((sec) => {
        if (!sec.rows.length) return;
        list.append(el('div', { class: 'cmdk-sec' }, sec.title));
        sec.rows.forEach((r) => {
          const idx = items.length;
          items.push(r);
          list.append(el('button', {
            type: 'button', role: 'option', class: `cmdk-item${idx === active ? ' active' : ''}`,
            onclick: () => choose(idx),
            onmousemove: () => { if (active !== idx) { active = idx; highlight(); } },
          }, [
            el('span', { class: 'cmdk-ico' }, r.icon),
            el('span', { class: 'cmdk-txt' }, [
              el('span', { class: 'cmdk-title' }, r.title),
              r.subtitle ? el('span', { class: 'cmdk-sub' }, r.subtitle) : null,
            ]),
          ]));
        });
      });
      if (!items.length) list.append(el('div', { class: 'cmdk-empty' }, 'نتیجه‌ای یافت نشد'));
    }

    function localSections(q) {
      const nq = norm(q);
      const match = (s) => !nq || norm(s).includes(nq);
      const pages = getPages().filter((p) => match(p.label))
        .map((p) => ({ icon: p.icon, title: p.label, subtitle: 'صفحه', run: () => setTab(p.tab) }));
      const depts = DEPARTMENTS.filter((d) => match(d) || match(`بخش ${d}`))
        .map((d) => ({ icon: '🏷️', title: `بخش ${d}`, subtitle: 'تعویض بخش', run: () => setDepartment(d) }));
      return [{ title: 'صفحه‌ها', rows: pages }, { title: 'بخش‌ها', rows: depts }];
    }

    async function remoteSections(q) {
      const department = getState().department;
      const plural = DEPT_PLURAL_LABEL[department] || 'معادن';
      const [mines, users, reports] = await Promise.all([
        searchMines(q, department).catch(() => []),
        searchUsers(q).catch(() => []),
        searchReports(q).catch(() => []),
      ]);
      return [
        { title: plural, rows: mines.map((m) => ({ icon: '⛏', title: m.name, subtitle: m.dept, run: () => setMineInDept(m.id, m.dept) })) },
        { title: 'کاربران', rows: users.map((u) => ({ icon: '◐', title: u.name, subtitle: `${u.email} — ${u.role}`, run: () => setTab('users') })) },
        {
          title: 'گزارش‌های دوره‌ای',
          rows: reports.map((r) => ({
            icon: '📤', title: r.mineName || '—', subtitle: `${r.period || ''}${r.note ? ` — ${r.note.slice(0, 40)}` : ''}`, run: () => setTab('mines'),
          })),
        },
      ];
    }

    function update() {
      const q = input.value.trim();
      active = 0;
      sections = localSections(q);
      draw();
      clearTimeout(timer);
      if (q.length < 2) return;
      const mine = ++reqId;
      timer = setTimeout(async () => {
        const remote = await remoteSections(q);
        if (mine !== reqId || !overlay) return; // نتیجه‌ی دیرهنگام
        sections = [...localSections(q), ...remote];
        draw();
      }, 250);
    }

    input.addEventListener('input', update);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); return; }
      if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    });

    update();
    input.focus();
  }

  if (!hotkeyBound) {
    hotkeyBound = true;
    document.addEventListener('keydown', (e) => {
      const isK = e.code === 'KeyK' || String(e.key).toLowerCase() === 'k';
      if ((e.ctrlKey || e.metaKey) && isK) {
        e.preventDefault();
        if (overlay) close(); else open();
      }
    });
  }

  return { open };
}

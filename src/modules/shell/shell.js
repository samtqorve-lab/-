import { el } from '../../lib/dom.js';
import { getState, setTab, setDepartment, onChange } from '../../router.js';
import { signOut } from '../../lib/auth.js';
import { fetchPendingIdentityCount } from '../../lib/identity.js';

const DEPARTMENTS = ['معدن', 'صنعت', 'اکتشاف', 'فرآوری'];

const NAV_ITEMS = [
  { tab: 'dashboard', label: 'داشبورد', icon: '◈' },
  { tab: 'mines', label: 'فهرست معادن', icon: '⛏' },
  { tab: 'legal', label: 'الزامات قانونی', icon: '⚖' },
  { tab: 'checklist', label: 'گزارش‌های تکمیلی', icon: '🛠' },
  { tab: 'identity', label: 'احراز هویت', icon: '🪪', hideForDept: 'صنعت' },
  { tab: 'map', label: 'نقشه', icon: '🗺' },
  { tab: 'users', label: 'کاربران', icon: '◐' },
  { tab: 'audit', label: 'تاریخچه تغییرات', icon: '📜' },
];

/**
 * پوسته‌ی اصلی برنامه را می‌سازد و یک تابع برمی‌گرداند که هر بار تب/بخش فعال عوض شود،
 * محتوای مناسب را داخل ناحیه‌ی content می‌سازد (renderContent باید توسط main.js تزریق شود).
 */
export function mountShell(root, { userLabel, renderContent }) {
  root.innerHTML = '';

  const sidebar = el('aside', { class: 'sidebar' });
  const header = el('div', { class: 'sidebar-header' }, [
    el('div', { class: 'org-name' }, 'اداره صنعت، معدن و تجارت قروه'),
    el('div', { class: 'app-name' }, 'سامانه جامع مدیریت معادن'),
    el('div', { class: 'app-sub' }, 'SAMAT'),
  ]);

  const deptSwitch = el('div', { class: 'dept-switch' });
  const navGroup = el('nav', { class: 'nav-group' });
  const footer = el('div', { class: 'sidebar-footer' }, userLabel || '');

  sidebar.append(header, deptSwitch, navGroup, footer);

  const main = el('div', { class: 'main' });
  const topbar = el('div', { class: 'topbar' });
  const content = el('div', { class: 'content' });
  main.append(topbar, content);

  root.append(sidebar, main);

  function renderDeptSwitch(activeDept) {
    deptSwitch.innerHTML = '';
    DEPARTMENTS.forEach((d) => {
      const btn = el('button', {
        class: `dept-item${d === activeDept ? ' active' : ''}`,
        onclick: () => setDepartment(d),
      }, d);
      deptSwitch.append(btn);
    });
  }

  function renderNav(state) {
    navGroup.innerHTML = '';
    navGroup.append(el('div', { class: 'nav-label' }, 'بخش‌ها'));
    const effectiveTab = state.tab === 'mineDetail' ? 'mines' : state.tab;
    NAV_ITEMS.filter((item) => item.hideForDept !== state.department).forEach((item) => {
      const btn = el('button', {
        class: `nav-item${item.tab === effectiveTab ? ' active' : ''}`,
        onclick: () => setTab(item.tab),
      }, [
        el('span', { class: 'ic' }, item.icon),
        el('span', {}, item.label),
      ]);
      navGroup.append(btn);
      if (item.tab === 'identity') {
        const badge = el('span', {
          style: 'display:none;background:var(--amber-600);color:#fff;border-radius:10px;font-size:10px;padding:1px 6px;margin-inline-start:auto;font-weight:700',
        });
        btn.append(badge);
        fetchPendingIdentityCount(state.department).then((count) => {
          if (count > 0) { badge.textContent = String(count); badge.style.display = 'inline-block'; }
        });
      }
    });
  }

  function renderTopbar(s) {
    const activeItem = NAV_ITEMS.find((i) => i.tab === s.tab);
    const title = activeItem ? activeItem.label : (s.tab === 'mineDetail' ? 'جزئیات رکورد' : '');
    topbar.innerHTML = '';
    topbar.append(
      el('div', {}, [
        el('h1', {}, title),
        el('div', { class: 'crumb' }, `بخش ${s.department}`),
      ]),
      el('button', { class: 'btn btn-ghost', onclick: () => signOut().then(() => location.reload()) }, 'خروج'),
    );
  }

  function full(s) {
    renderDeptSwitch(s.department);
    renderNav(s);
    renderTopbar(s);
    content.innerHTML = '';
    renderContent(content, s);
  }

  full(getState());
  onChange(full);

  return { content };
}

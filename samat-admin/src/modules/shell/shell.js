import { el } from '../../lib/dom.js';
import { getState, setTab, setDepartment, onChange } from '../../router.js';
import { signOut } from '../../lib/auth.js';
import { fetchPendingIdentityCount } from '../../lib/identity.js';
import { mountGlobalSearch } from './globalSearch.js';

// اکتشاف و فرآوری زیرمجموعه‌ی معدن‌اند (پیش از استخراج و پس از آن)، نه بخش‌های هم‌تراز با صنعت/اصناف
const DEPARTMENT_TREE = [
  { dept: 'معدن', children: ['اکتشاف', 'فرآوری'] },
  { dept: 'صنعت' },
  { dept: 'اصناف' },
];

const NAV_ITEMS = [
  { tab: 'dashboard', label: 'نقشه معادن', icon: '🗺' },
  { tab: 'mines', label: 'فهرست معادن', icon: '⛏' },
  { tab: 'legal', label: 'الزامات قانونی', icon: '⚖' },
  { tab: 'checklist', label: 'گزارش‌های تکمیلی', icon: '🛠' },
  { tab: 'notices', label: 'اطلاعیه‌ها', icon: '📢' },
  { tab: 'identity', label: 'احراز هویت', icon: '🪪', hideForDept: 'صنعت' },
  { tab: 'stats', label: 'آمار و پیگیری', icon: '◈' },
  { tab: 'compliance', label: 'رتبه‌بندی معادن', icon: '📋', hideForDept: ['صنعت', 'اکتشاف', 'فرآوری', 'اصناف'] },
  { tab: 'users', label: 'کاربران', icon: '◐' },
  { tab: 'audit', label: 'تاریخچه تغییرات', icon: '📜' },
  { tab: 'boundaryMonitor', label: 'پایش مرزی', icon: '🛰️', hideForDept: 'اصناف' },
  { tab: 'mySettings', label: 'تنظیمات من', icon: '⚙' },
];

/**
 * پوسته‌ی اصلی برنامه را می‌سازد و یک تابع برمی‌گرداند که هر بار تب/بخش فعال عوض شود،
 * محتوای مناسب را داخل ناحیه‌ی content می‌سازد (renderContent باید توسط main.js تزریق شود).
 */
export function mountShell(root, { userLabel, renderContent }) {
  root.innerHTML = '';

  const sidebar = el('aside', { class: 'sidebar' });
  const backdrop = el('div', { class: 'sidebar-backdrop', onclick: () => closeSidebar() });
  const header = el('div', { class: 'sidebar-header' }, [
    el('img', { src: '/favicon.svg', class: 'sidebar-logo', alt: 'صمت' }),
    el('div', { class: 'org-name' }, 'اداره صنعت، معدن و تجارت قروه'),
    el('div', { class: 'app-name' }, 'پنل ادمین صمت'),
  ]);

  function openSidebar() { sidebar.classList.add('open'); backdrop.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('open'); }
  function toggleSidebar() { sidebar.classList.contains('open') ? closeSidebar() : openSidebar(); }

  const deptSwitch = el('div', { class: 'dept-switch' });
  const navGroup = el('nav', { class: 'nav-group' });
  const footer = el('div', { class: 'sidebar-footer' }, [
    el('div', {}, userLabel || ''),
    el('button', {
      class: 'btn btn-ghost', style: 'width:100%;justify-content:center;margin-top:8px',
      onclick: () => signOut().then(() => location.reload()),
    }, '🚪 خروج از سامانه'),
  ]);

  sidebar.append(header, deptSwitch, navGroup, footer);

  const main = el('div', { class: 'main' });
  const topbar = el('div', { class: 'topbar' });
  const content = el('div', { class: 'content' });
  const topbarTitle = el('div', { style: 'display:flex;align-items:center;gap:10px;flex:1' });
  const topbarSearch = el('div', { style: 'display:flex;align-items:center' });
  topbar.append(topbarTitle, topbarSearch);
  main.append(topbar, content);

  root.append(sidebar, backdrop, main);
  mountGlobalSearch(topbarSearch);

  function renderDeptSwitch(activeDept) {
    deptSwitch.innerHTML = '';
    DEPARTMENT_TREE.forEach(({ dept, children }) => {
      deptSwitch.append(el('button', {
        class: `dept-item${dept === activeDept ? ' active' : ''}`,
        onclick: () => setDepartment(dept),
      }, dept));
      (children || []).forEach((child) => {
        deptSwitch.append(el('button', {
          class: `dept-item dept-item--child${child === activeDept ? ' active' : ''}`,
          onclick: () => setDepartment(child),
        }, child));
      });
    });
  }

  function renderNav(state) {
    navGroup.innerHTML = '';
    navGroup.append(el('div', { class: 'nav-label' }, 'بخش‌ها'));
    const effectiveTab = state.tab === 'mineDetail' ? 'mines' : state.tab;
    NAV_ITEMS.filter((item) => {
      if (!item.hideForDept) return true;
      return Array.isArray(item.hideForDept) ? !item.hideForDept.includes(state.department) : item.hideForDept !== state.department;
    }).forEach((item) => {
      const btn = el('button', {
        class: `nav-item${item.tab === effectiveTab ? ' active' : ''}`,
        onclick: () => { setTab(item.tab); closeSidebar(); },
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

    // لینک ثابت (نه یک تب داخلی، چون در تب جدید مرورگر باز می‌شود): برای وقتی خود کاربر ستادی
    // سر معدن است و می‌خواهد با موقعیت مکانی زنده‌ی خودش گزارش ثبت کند — همان اپ مسئول فنی،
    // فقط با همین حساب واردش می‌شود.
    const fieldLink = el('a', {
      href: '/tech-officer/', target: '_blank', rel: 'noopener',
      class: 'nav-item', style: 'text-decoration:none;margin-top:10px;border-top:1px solid var(--stone-200);padding-top:14px',
    }, [
      el('span', { class: 'ic' }, '📍'),
      el('span', {}, 'ثبت گزارش میدانی (GPS)'),
    ]);
    navGroup.append(fieldLink);
  }

  function renderTopbar(s) {
    const activeItem = NAV_ITEMS.find((i) => i.tab === s.tab);
    const title = activeItem ? activeItem.label : (s.tab === 'mineDetail' ? 'جزئیات رکورد' : '');
    topbarTitle.innerHTML = '';
    topbarTitle.append(
      el('button', { class: 'menu-toggle-btn', onclick: () => toggleSidebar(), 'aria-label': 'باز کردن منو' }, '☰'),
      el('div', {}, [
        el('h1', {}, title),
        el('div', { class: 'crumb' }, `بخش ${s.department}`),
      ]),
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

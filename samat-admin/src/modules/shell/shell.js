import { el } from '../../lib/dom.js';
import { getState, setTab, setDepartment, onChange } from '../../router.js';
import { signOut } from '../../lib/auth.js';
import { fetchPendingIdentityCount, fetchPendingBoundaryCount } from '../../lib/identity.js';
import { mountGlobalSearch } from './globalSearch.js';
import { mountCommandPalette } from './commandPalette.js';
import { mountNotificationCenter } from './notificationCenter.js';
import { mountThemeToggle } from './themeToggle.js';
import { mountMobileNav } from './mobileNav.js';
import { enhanceTable } from '../../lib/tableTools.js';
import { DEPT_PLURAL_LABEL } from '../../lib/sections.js';

// اکتشاف و فرآوری زیرمجموعه‌ی معدن‌اند (پیش از استخراج و پس از آن)، نه بخش‌های هم‌تراز با صنعت/اصناف
const DEPARTMENT_TREE = [
  { dept: 'معدن', children: ['اکتشاف', 'فرآوری'] },
  { dept: 'صنعت' },
  { dept: 'اصناف' },
];
const ALL_DEPARTMENTS = DEPARTMENT_TREE.flatMap(({ dept, children }) => [dept, ...(children || [])]);

// وضعیت جمع‌شدنِ نوار کناری در دسکتاپ بین دفعات باز کردن برنامه یادش می‌ماند
const COLLAPSE_KEY = 'samat.sidebar.collapsed';
const isMobileViewport = () => window.matchMedia('(max-width: 860px)').matches;

// label می‌تواند رشته‌ی ثابت باشد یا تابعی که بخش فعال را می‌گیرد و عنوان مخصوص همان بخش را
// می‌سازد — قبلاً «نقشه معادن»/«فهرست معادن» برای همه‌ی بخش‌ها (حتی صنعت/اکتشاف/...) ثابت بود.
const NAV_ITEMS = [
  { tab: 'dashboard', label: (d) => `نقشه ${DEPT_PLURAL_LABEL[d] || 'معادن'}`, icon: '🗺' },
  { tab: 'satelliteMonitor', label: 'پایش ماهواره‌ای', icon: '🛰' },
  { tab: 'terrain3d', label: 'مدل سه‌بعدی', icon: '🗻', hideForDept: ['صنعت', 'اکتشاف', 'فرآوری', 'اصناف'] },
  { tab: 'pitDesign', label: 'طراحی پله‌بندی', icon: '⛰', hideForDept: ['صنعت', 'اکتشاف', 'فرآوری', 'اصناف'] },
  // محاسبات الگوی آتش‌باری/مواد ناریه فقط برای معدن و اکتشاف کاربرد دارد (حفاری اکتشافی هم گاهی
  // آتش‌باری دارد)؛ تبدیل واحد و مشخصات ماشین‌آلات هم داخل همین صفحه (زیرتب) قرار گرفته‌اند.
  { tab: 'tools', label: '🧮 محاسبات و ابزار فنی', icon: '🧮', hideForDept: ['صنعت', 'فرآوری', 'اصناف'] },
  { tab: 'mines', label: (d) => `فهرست ${DEPT_PLURAL_LABEL[d] || 'معادن'}`, icon: '⛏' },
  { tab: 'legal', label: 'الزامات قانونی', icon: '⚖' },
  { tab: 'checklist', label: 'گزارش‌های تکمیلی', icon: '🛠' },
  { tab: 'notices', label: 'اطلاعیه‌ها', icon: '📢' },
  { tab: 'identity', label: 'احراز هویت', icon: '🪪', hideForDept: 'صنعت' },
  { tab: 'stats', label: 'آمار و پیگیری', icon: '◈' },
  // قبلاً فقط برای معدن فعال بود (hideForDept همه‌ی بخش‌های دیگر را می‌پوشاند)، با اینکه منطق
  // محاسبه‌ی انقضای پروانه (jalali.js licenseExpiryInfo) از قبل اکتشاف/فرآوری را هم پشتیبانی
  // می‌کرد — الان برای این دو هم فعال است (صنعت/اصناف چون مفهوم «آخرین گزارش دوره‌ای تکنسینی»
  // در آن‌ها بی‌معنی است، همچنان مخفی می‌مانند).
  {
    tab: 'compliance',
    label: (d) => `رتبه‌بندی ${DEPT_PLURAL_LABEL[d] || 'معادن'}`,
    icon: '📋',
    hideForDept: ['صنعت', 'اصناف'],
  },
  { tab: 'boundaryMonitor', label: 'پایش مرزی', icon: '🛰️', hideForDept: 'اصناف' },
  // ساعات ورود/خروج مسئولین فنی/ایمنی/بهداشت از محدوده‌ی معدن (geofence خودکار GPS اپ مسئول
  // فنی) — بر اساس mine_presence_sessions در Supabase. برای هیچ بخشی مخفی نشده چون همه‌ی
  // بخش‌ها (نه فقط معدن) می‌توانند مسئول فنی داشته باشند.
  { tab: 'presenceReport', label: 'ساعات حضور در معدن', icon: '⏱' },
  { tab: 'users', label: 'کاربران', icon: '◐' },
  { tab: 'audit', label: 'تاریخچه تغییرات', icon: '📜' },
  { tab: 'mySettings', label: 'تنظیمات من', icon: '⚙' },
];

function navLabel(item, department) {
  return typeof item.label === 'function' ? item.label(department) : item.label;
}

function isNavVisible(item, department) {
  if (!item.hideForDept) return true;
  return Array.isArray(item.hideForDept) ? !item.hideForDept.includes(department) : item.hideForDept !== department;
}

function visibleNavEntries(department) {
  return NAV_ITEMS
    .filter((item) => isNavVisible(item, department))
    .map((item) => ({ tab: item.tab, icon: item.icon, label: navLabel(item, department) }));
}

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

  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('open'); }
  function setCollapsed(v) {
    sidebar.classList.toggle('collapsed', v);
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* حافظه‌ی مرورگر در دسترس نیست — فقط یادآوری نمی‌شود */ }
  }
  // موبایل: شیت «بیشتر» از پایین؛ دسکتاپ: جمع/باز شدن نوار کناری به ستون آیکنی
  function toggleSidebar() {
    if (isMobileViewport()) { mobileNav.openSheet(); return; }
    setCollapsed(!sidebar.classList.contains('collapsed'));
  }
  try { if (localStorage.getItem(COLLAPSE_KEY) === '1') sidebar.classList.add('collapsed'); } catch { /* ignore */ }

  const deptSwitch = el('div', { class: 'dept-switch' });
  const navGroup = el('nav', { class: 'nav-group' });
  const doSignOut = () => signOut().then(() => location.reload());
  const footer = el('div', { class: 'sidebar-footer' }, [
    el('div', { class: 'user-label' }, userLabel || ''),
    el('button', {
      class: 'btn btn-ghost', style: 'width:100%;justify-content:center;margin-top:8px', title: 'خروج از سامانه',
      onclick: doSignOut,
    }, [el('span', {}, '🚪'), el('span', { class: 'footer-btn-text' }, ' خروج از سامانه')]),
  ]);

  sidebar.append(header, deptSwitch, navGroup, footer);

  const main = el('div', { class: 'main' });
  const topbar = el('div', { class: 'topbar' });
  const content = el('div', { class: 'content' });
  const topbarTitle = el('div', { style: 'display:flex;align-items:center;gap:10px;flex:1' });
  const topbarActions = el('div', { class: 'topbar-actions' });
  topbar.append(topbarTitle, topbarActions);
  main.append(topbar, content);

  root.append(sidebar, backdrop, main);

  // ── تب‌بار پایین صفحه (فقط موبایل؛ آیکن‌ها پایین صفحه‌اند) ──
  const mobileNav = mountMobileNav({
    root,
    getItems: (s) => visibleNavEntries(s.department),
    departments: ALL_DEPARTMENTS,
    onTab: (tab) => setTab(tab),
    onDept: (name) => setDepartment(name),
    onLogout: doSignOut,
  });

  // ── نوار بالا (راست→چپ): جست‌وجو، جست‌وجوی سریع (Ctrl+K)، اعلان‌ها، تم ──
  const searchHost = el('div', { style: 'display:flex;align-items:center' });
  topbarActions.append(searchHost);
  mountGlobalSearch(searchHost);

  const palette = mountCommandPalette({ getPages: () => visibleNavEntries(getState().department) });
  topbarActions.append(el('button', {
    class: 'top-icon-btn', type: 'button', title: 'جست‌وجوی سریع (Ctrl+K)', 'aria-label': 'جست‌وجوی سریع',
    onclick: () => palette.open(),
  }, '⌘'));
  mountNotificationCenter(topbarActions);
  mountThemeToggle(topbarActions);

  // ── ابزار خودکار جدول‌ها (فیلتر/مرتب‌سازی/اکسل) برای هر جدول `.data-table` که در محتوا ظاهر شود ──
  let scanQueued = false;
  function scanTables() {
    scanQueued = false;
    const all = Array.from(content.querySelectorAll('table.data-table'));
    all.forEach((table, i) => {
      if (!table.dataset.enhanced) enhanceTable(table, `${getState().tab}:${i}`);
    });
  }
  new MutationObserver(() => {
    if (!scanQueued) { scanQueued = true; requestAnimationFrame(scanTables); }
  }).observe(content, { childList: true, subtree: true });

  function renderDeptSwitch(activeDept) {
    deptSwitch.innerHTML = '';
    const makeBtn = (name, extraClass) => el('button', {
      class: `dept-item${extraClass}${name === activeDept ? ' active' : ''}`,
      title: name,
      onclick: () => setDepartment(name),
    }, [el('span', { class: 'dept-short' }, name.charAt(0)), el('span', { class: 'dept-full' }, name)]);
    DEPARTMENT_TREE.forEach(({ dept, children }) => {
      deptSwitch.append(makeBtn(dept, ''));
      (children || []).forEach((child) => deptSwitch.append(makeBtn(child, ' dept-item--child')));
    });
  }

  function renderNav(state) {
    navGroup.innerHTML = '';
    navGroup.append(el('div', { class: 'nav-label' }, 'بخش‌ها'));
    const effectiveTab = state.tab === 'mineDetail' ? 'mines' : state.tab;
    NAV_ITEMS.filter((item) => isNavVisible(item, state.department)).forEach((item) => {
      const btn = el('button', {
        class: `nav-item${item.tab === effectiveTab ? ' active' : ''}`,
        title: navLabel(item, state.department),
        onclick: () => { setTab(item.tab); closeSidebar(); },
      }, [
        el('span', { class: 'ic' }, item.icon),
        el('span', {}, navLabel(item, state.department)),
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
      if (item.tab === 'boundaryMonitor') {
        // قبلاً هیچ نشانه‌ای در منو نبود — ادمین باید خودش یادش می‌ماند هر چند وقت یک‌بار سر بزند
        const badge = el('span', {
          style: 'display:none;background:var(--rust-600);color:#fff;border-radius:10px;font-size:10px;padding:1px 6px;margin-inline-start:auto;font-weight:700',
        });
        btn.append(badge);
        fetchPendingBoundaryCount().then((count) => {
          if (count > 0) { badge.textContent = String(count); badge.style.display = 'inline-block'; }
        });
      }
    });

    // لینک ثابت (نه یک تب داخلی، چون در تب جدید مرورگر باز می‌شود): برای وقتی خود کاربر ستادی
    // سر معدن است و می‌خواهد با موقعیت مکانی زنده‌ی خودش گزارش ثبت کند — همان اپ مسئول فنی،
    // فقط با همین حساب واردش می‌شود.
    const fieldLink = el('a', {
      href: '/tech-officer/', target: '_blank', rel: 'noopener', title: 'ثبت گزارش میدانی (GPS)',
      class: 'nav-item', style: 'text-decoration:none;margin-top:10px;border-top:1px solid var(--stone-200);padding-top:14px',
    }, [
      el('span', { class: 'ic' }, '📍'),
      el('span', {}, 'ثبت گزارش میدانی (GPS)'),
    ]);
    navGroup.append(fieldLink);
  }

  function renderTopbar(s) {
    const activeItem = NAV_ITEMS.find((i) => i.tab === s.tab);
    const title = activeItem ? navLabel(activeItem, s.department) : (s.tab === 'mineDetail' ? 'جزئیات رکورد' : '');
    topbarTitle.innerHTML = '';
    topbarTitle.append(
      el('button', { class: 'menu-toggle-btn', onclick: () => toggleSidebar(), 'aria-label': 'منو', title: 'منو' }, '☰'),
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
    mobileNav.render(s);
    // صفحه‌ی نقشه تمام‌صفحه و بدون حاشیه است (پنل‌ها روی آن شناورند)
    const isMap = s.tab === 'dashboard';
    main.classList.toggle('main--map', isMap);
    content.classList.toggle('content--map', isMap);
    content.innerHTML = '';
    renderContent(content, s);
  }

  full(getState());
  onChange(full);

  return { content };
}

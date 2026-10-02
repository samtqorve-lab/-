import '../../styles/mobileNav.css';
import { el } from '../../lib/dom.js';

/**
 * تب‌بار پایین صفحه (فقط موبایل) + شیت «بیشتر» که همه‌ی صفحه‌ها، سوییچ بخش و خروج را دارد.
 * آیکن‌های تب‌بار خطی (SVG) و هم‌سبک اپ مسئول فنی‌اند. استایل در styles/mobileNav.css است.
 */

const PATHS = {
  dashboard: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  mines: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  identity: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M15 10h3M15 13h3"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  more: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

function icon(name, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" `
    + `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || PATHS.more}</svg>`;
}

// تب‌هایی که در نوار پایین می‌آیند (به ترتیب اولویت؛ فقط آن‌هایی که برای بخش فعال نمایش داده می‌شوند)
const PREFERRED = ['dashboard', 'mines', 'identity', 'stats'];

/**
 * @param {{
 *   root: HTMLElement,
 *   getItems: (state:any) => {tab:string,icon:string,label:string}[],
 *   departments: string[],
 *   onTab: (tab:string) => void,
 *   onDept: (name:string) => void,
 *   onLogout: () => void,
 * }} api
 * @returns {{ render: (state:any) => void, openSheet: () => void }}
 */
export function mountMobileNav(api) {
  const nav = el('nav', { class: 'mobile-nav', 'aria-label': 'ناوبری اصلی' });
  const overlay = el('div', { class: 'mn-overlay', onclick: (e) => { if (e.target === overlay) closeSheet(); } });
  api.root.append(nav, overlay);

  let lastState = null;

  function closeSheet() { overlay.classList.remove('open'); }

  function openSheet() {
    if (!lastState) return;
    const state = lastState;
    const items = api.getItems(state);
    const activeTab = state.tab === 'mineDetail' ? 'mines' : state.tab;

    const closeBtn = el('button', { class: 'top-icon-btn', type: 'button', 'aria-label': 'بستن', onclick: closeSheet });
    closeBtn.innerHTML = icon('close');

    const depts = el('div', { class: 'mn-depts' }, api.departments.map((name) => el('button', {
      type: 'button', class: `mn-dept${name === state.department ? ' active' : ''}`,
      onclick: () => { closeSheet(); api.onDept(name); },
    }, [el('div', { class: 'mn-dot' }, name.charAt(0)), el('span', {}, name)])));

    const grid = el('div', { class: 'mn-grid' }, items.map((item) => el('button', {
      type: 'button', class: `mn-cell${item.tab === activeTab ? ' active' : ''}`,
      onclick: () => { closeSheet(); api.onTab(item.tab); },
    }, [el('span', { class: 'mn-ico' }, item.icon), el('span', {}, item.label)])));

    overlay.innerHTML = '';
    overlay.append(el('div', { class: 'mn-sheet' }, [
      el('div', { class: 'mn-grab' }),
      el('div', { class: 'mn-head' }, [el('span', {}, `منو · بخش ${state.department}`), closeBtn]),
      depts,
      grid,
      el('button', { class: 'btn btn-ghost mn-logout', type: 'button', onclick: () => { closeSheet(); api.onLogout(); } }, '🚪 خروج از سامانه'),
    ]));
    overlay.classList.add('open');
  }

  function render(state) {
    lastState = state;
    nav.innerHTML = '';
    const items = api.getItems(state);
    const activeTab = state.tab === 'mineDetail' ? 'mines' : state.tab;
    const main = PREFERRED.map((t) => items.find((i) => i.tab === t)).filter(Boolean).slice(0, 4);

    main.forEach((item) => {
      const ico = el('span', {});
      ico.innerHTML = icon(item.tab);
      nav.append(el('button', {
        type: 'button', class: `mn-item${item.tab === activeTab ? ' active' : ''}`, 'aria-label': item.label,
        onclick: () => { closeSheet(); api.onTab(item.tab); },
      }, [ico, el('span', { class: 'mn-label' }, item.label)]));
    });

    // اگر صفحه‌ی فعلی یکی از تب‌های اصلی نیست، «بیشتر» فعال دیده می‌شود
    const moreActive = !main.some((i) => i.tab === activeTab);
    const moreIco = el('span', {});
    moreIco.innerHTML = icon('more');
    nav.append(el('button', {
      type: 'button', class: `mn-item${moreActive ? ' active' : ''}`, 'aria-label': 'بیشتر', onclick: openSheet,
    }, [moreIco, el('span', { class: 'mn-label' }, 'بیشتر')]));
  }

  return { render, openSheet };
}

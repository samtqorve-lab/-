import { el } from '../../lib/dom.js';

/**
 * اجزای رابط کاربری به سبک اینستاگرام: آیکن‌های خطیِ SVG، دکمه‌ی آیکنی، ردیف «استوری»
 * (میانبر ابزارها با حلقه‌ی گرادیانی) و تب‌بار پایین.
 */

const PATHS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  plus: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
  list: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

export function icon(name, { size = 24, filled = false, strokeWidth = 1.8 } = {}) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${filled ? 'currentColor' : 'none'}" `
    + `stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
    + `${PATHS[name] || ''}</svg>`;
}

/** دکمه‌ی گرد آیکنی (برای هدر بالا). */
export function iconButton(name, label, onClick) {
  const btn = el('button', { class: 'ig-icon-btn', type: 'button', 'aria-label': label, onclick: onClick });
  btn.innerHTML = icon(name);
  return btn;
}

/**
 * ردیف افقیِ «استوری»: هر آیتم یک دایره‌ی آیکن‌دار با حلقه‌ی گرادیانی است. بعد از اولین لمس،
 * حلقه خاکستری می‌شود (مثل «دیده‌شده» در اینستاگرام) — فقط برای همان نشست.
 * @param {{icon:string, label:string, onClick:() => void}[]} items
 */
export function buildStoriesRow(items) {
  const row = el('div', { class: 'stories', role: 'list' });
  items.forEach((it) => {
    const btn = el('button', {
      class: 'story', type: 'button', role: 'listitem',
      onclick: () => { btn.classList.add('seen'); it.onClick(); },
    }, [
      el('span', { class: 'story-ring' }, el('span', { class: 'story-inner' }, it.icon)),
      el('span', { class: 'story-label' }, it.label),
    ]);
    row.append(btn);
  });
  return row;
}

/**
 * تب‌بار پایین. آیتمی که active باشد آیکن توپر و برچسب پررنگ می‌گیرد.
 * @param {{icon:string, label:string, onClick:() => void, active?:boolean, center?:boolean}[]} items
 */
export function buildBottomNav(items) {
  const nav = el('nav', { class: 'bottom-nav' });
  items.forEach((it) => {
    const ico = el('span', { class: 'bn-ico' });
    ico.innerHTML = icon(it.icon, { filled: !!it.active, size: it.center ? 28 : 24 });
    nav.append(el('button', {
      type: 'button', class: `bottom-nav-item${it.active ? ' active' : ''}`,
      'aria-label': it.label, onclick: it.onClick,
    }, [ico, el('span', { class: 'bn-label' }, it.label)]));
  });
  return nav;
}

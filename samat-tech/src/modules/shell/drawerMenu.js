import { el } from '../../lib/dom.js';
import { icon } from './igUi.js';

/**
 * منوی کشویی از راست (برای بقیه‌ی امکانات، غیر از صفحه‌ی اصلی). یک دکمه‌ی ☰ در بالای صفحه
 * (topbar) این منو را باز می‌کند؛ هر آیتم با لمس، هم منو را می‌بندد و هم اکشن خودش را اجرا می‌کند.
 * آیتمی که danger:true داشته باشد (مثل «خروج») قرمز و با یک خط جداکننده در بالایش نمایش داده می‌شود.
 * @param {{icon:string, label:string, onClick:() => void, danger?:boolean}[]} items
 * @returns {{ toggleBtn: HTMLElement }}
 */
export function mountDrawerMenu(items) {
  const overlay = el('div', { class: 'ig-drawer-overlay' });
  const panel = el('div', { class: 'ig-drawer' });

  let open = false;
  function setOpen(v) {
    open = v;
    overlay.classList.toggle('open', open);
    panel.classList.toggle('open', open);
  }
  overlay.addEventListener('click', () => setOpen(false));

  const closeBtn = el('button', { class: 'ig-icon-btn', type: 'button', 'aria-label': 'بستن منو', onclick: () => setOpen(false) });
  closeBtn.innerHTML = icon('close');

  const list = el('div', { class: 'ig-drawer-list' });
  items.forEach((item) => {
    if (item.danger) list.append(el('div', { class: 'ig-drawer-sep' }));
    list.append(el('button', {
      type: 'button',
      class: `ig-drawer-item${item.danger ? ' danger' : ''}`,
      onclick: () => { setOpen(false); item.onClick(); },
    }, [el('span', { class: 'ig-drawer-ico' }, item.icon), el('span', {}, item.label)]));
  });

  panel.append(el('div', { class: 'ig-drawer-head' }, [el('span', {}, 'منو'), closeBtn]), list);
  document.body.append(overlay, panel);

  const toggleBtn = el('button', { class: 'ig-icon-btn', type: 'button', 'aria-label': 'باز کردن منو', onclick: () => setOpen(!open) });
  toggleBtn.innerHTML = icon('menu');

  return { toggleBtn };
}

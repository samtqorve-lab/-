import { el } from '../../lib/dom.js';

/**
 * منوی کشویی از راست (برای بقیه‌ی امکانات، غیر از صفحه‌ی اصلی). یک دکمه‌ی ☰ در بالای صفحه
 * (topbar) این منو را باز می‌کند؛ هر آیتم با لمس، هم منو را می‌بندد و هم اکشن خودش را اجرا می‌کند.
 * @param {{icon:string, label:string, onClick:() => void}[]} items
 * @returns {{ toggleBtn: HTMLElement }}
 */
export function mountDrawerMenu(items) {
  const overlay = el('div', {
    style: 'position:fixed;inset:0;background:rgba(28,27,23,.5);z-index:400;'
      + 'opacity:0;pointer-events:none;transition:opacity .2s',
  });
  const panel = el('div', {
    style: 'position:fixed;top:0;bottom:0;right:0;width:min(78vw,320px);background:#fff;z-index:401;'
      + 'box-shadow:-4px 0 20px rgba(0,0,0,.25);transform:translateX(100%);transition:transform .22s;'
      + 'display:flex;flex-direction:column;padding-top:env(safe-area-inset-top)',
  });

  let open = false;
  function setOpen(v) {
    open = v;
    overlay.style.opacity = open ? '1' : '0';
    overlay.style.pointerEvents = open ? 'auto' : 'none';
    panel.style.transform = open ? 'translateX(0)' : 'translateX(100%)';
  }
  overlay.addEventListener('click', () => setOpen(false));

  panel.append(
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--stone-200)' }, [
      el('div', { style: 'font-weight:700' }, '☰ منو'),
      el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => setOpen(false) }, '✖'),
    ]),
    el('div', { style: 'flex:1;overflow-y:auto;padding:8px' },
      items.map((item) => el('button', {
        style: 'display:flex;align-items:center;gap:10px;width:100%;text-align:right;background:none;border:none;'
          + 'padding:13px 10px;font-size:var(--text-sm);color:var(--ink-800);border-radius:8px;cursor:pointer',
        onclick: () => { setOpen(false); item.onClick(); },
      }, [el('span', { style: 'font-size:18px' }, item.icon), el('span', {}, item.label)]))),
  );

  document.body.append(overlay, panel);

  const toggleBtn = el('button', {
    class: 'btn-sm',
    style: 'background:rgba(255,255,255,.15);color:#fff;font-size:19px;padding:8px 14px;line-height:1',
    onclick: () => setOpen(!open),
  }, '☰');

  return { toggleBtn };
}

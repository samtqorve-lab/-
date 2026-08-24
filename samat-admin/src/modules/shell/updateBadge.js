import { checkForAppUpdate } from '../../lib/appUpdate.js';
import { el } from '../../lib/dom.js';

/** بنر کوچک شناور بالای صفحه وقتی نسخه‌ی جدیدتری از APK اندروید منتشر شده باشد. */
export async function mountUpdateBadge() {
  const manifest = await checkForAppUpdate();
  if (!manifest) return;

  const banner = el('div', {
    style: 'position:fixed;top:calc(8px + env(safe-area-inset-top));left:8px;right:8px;z-index:1300;'
      + 'background:var(--patina-700);color:#fff;border-radius:10px;padding:10px 14px;'
      + 'display:flex;align-items:center;justify-content:space-between;gap:10px;'
      + 'font-size:var(--text-xs);box-shadow:0 4px 14px rgba(0,0,0,.25)',
  }, [
    el('span', {}, `📲 نسخه‌ی جدیدی از اپ در دسترس است${manifest.versionName ? ` (${manifest.versionName})` : ''}`),
    el('div', { style: 'display:flex;gap:6px;align-items:center;flex-shrink:0' }, [
      el('button', {
        class: 'btn-sm',
        style: 'background:#fff;color:var(--patina-700)',
        onclick: () => { window.open(manifest.url, '_system'); },
      }, 'دانلود و نصب'),
      el('button', {
        class: 'btn-sm',
        style: 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5)',
        onclick: () => banner.remove(),
      }, '✕'),
    ]),
  ]);

  document.body.append(banner);
}

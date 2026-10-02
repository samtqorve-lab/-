import { el } from '../../lib/dom.js';

const KEY = 'samat.theme';

/** تم ذخیره‌شده را روی <html> اعمال می‌کند (پیش‌فرض: روشن؛ فقط با انتخاب صریح کاربر تاریک می‌شود). */
export function applyStoredTheme() {
  try {
    if (localStorage.getItem(KEY) === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch { /* ignore */ }
}

/** دکمه‌ی تعویض حالت روشن/تاریک برای نوار بالا. */
export function mountThemeToggle(host) {
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const btn = el('button', {
    class: 'top-icon-btn', type: 'button', 'aria-label': 'حالت تاریک / روشن', title: 'حالت تاریک / روشن',
  });
  const paint = () => { btn.textContent = isDark() ? '☀️' : '🌙'; };
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    paint();
  });
  paint();
  host.append(btn);
}

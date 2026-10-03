import { el } from '../../lib/dom.js';

const KEY = 'samat.theme';

/** دکمه‌ی تعویض حالت روشن/تاریک برای نوار بالا. پیش‌فرض از تنظیم سیستم می‌آید (index.html)؛ انتخاب دستی ذخیره می‌شود. */
export function mountThemeToggle(host) {
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const btn = el('button', {
    class: 'top-icon-btn', type: 'button', 'aria-label': 'حالت تاریک / روشن', title: 'حالت تاریک / روشن',
  });
  const paint = () => { btn.textContent = isDark() ? '☀️' : '🌙'; };
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.setAttribute('data-theme', 'light');
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    paint();
  });
  paint();
  host.append(btn);
}

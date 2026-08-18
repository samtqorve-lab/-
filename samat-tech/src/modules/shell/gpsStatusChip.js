import { el } from '../../lib/dom.js';
import { onGpsUpdate, getWarmCoords } from '../../lib/geo.js';

/** یک نشان کوچک در بالای صفحه که نشان می‌دهد GPS از قبل پیش‌گرم و آماده است — تا مسئول فنی
 * مطمئن شود لازم نیست موقع عکس‌گرفتن منتظر «لود شدن» GPS بماند. */
export function mountGpsStatusChip(container) {
  const chip = el('span', { style: 'font-size:11px;color:rgba(255,255,255,.75)' }, '📡 در حال آماده‌سازی GPS...');
  container.append(chip);

  function render(coords) {
    if (!coords) return;
    const good = coords.accuracy <= 20;
    chip.textContent = `${good ? '📍' : '📡'} GPS آماده (~${Math.round(coords.accuracy)} متر)`;
    chip.style.color = good ? '#8bd3a8' : '#ffd699';
  }

  const warm = getWarmCoords(30000);
  if (warm) render(warm);
  onGpsUpdate(render);
}

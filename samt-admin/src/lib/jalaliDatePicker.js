import { el } from './dom.js';
import {
  JALALI_MONTHS, daysInJalaliMonth, todayJalali, parseJalaliString, formatJalali, toGregorian,
} from './jalaliCalendar.js';

/** یک تقویم شمسی کشویی را به یک input متنی وصل می‌کند؛ خود input هم قابل تایپ دستی باقی می‌ماند */
export function attachJalaliDatePicker(input) {
  let panel = null;
  let view = null;

  function closePanel() {
    if (panel) { panel.remove(); panel = null; }
    document.removeEventListener('mousedown', onOutsideClick, true);
  }
  function onOutsideClick(e) {
    if (panel && !panel.contains(e.target) && e.target !== input) closePanel();
  }

  function openPanel() {
    if (panel) return;
    const parsed = parseJalaliString(input.value) || todayJalali();
    view = { jy: parsed.jy, jm: parsed.jm };
    panel = el('div', {
      style: 'position:absolute;z-index:200;background:#fff;border:1px solid var(--stone-200);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);padding:10px;width:240px;font-size:var(--text-sm)',
    });
    positionPanel();
    document.body.append(panel);
    drawCalendar();
    document.addEventListener('mousedown', onOutsideClick, true);
  }

  function positionPanel() {
    const r = input.getBoundingClientRect();
    panel.style.top = `${window.scrollY + r.bottom + 4}px`;
    panel.style.left = `${window.scrollX + r.left}px`;
  }

  function drawCalendar() {
    panel.innerHTML = '';
    const prevBtn = el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--stone-100)', onclick: () => { shiftMonth(-1); } }, '›');
    const nextBtn = el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--stone-100)', onclick: () => { shiftMonth(1); } }, '‹');
    const title = el('div', { style: 'flex:1;text-align:center;font-weight:700' }, `${JALALI_MONTHS[view.jm - 1]} ${view.jy}`);
    panel.append(el('div', { style: 'display:flex;align-items:center;margin-bottom:8px' }, [prevBtn, title, nextBtn]));

    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center' });
    ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].forEach((d) => grid.append(el('div', { style: 'font-size:10px;color:var(--stone-600);padding:4px 0' }, d)));

    // شنبه = ابتدای هفته؛ محاسبه‌ی روز هفته‌ی اول ماه با تبدیل به میلادی و گرفتن getDay()
    const firstGreg = toGregorian(view.jy, view.jm, 1);
    const firstWeekday = (new Date(firstGreg.gy, firstGreg.gm - 1, firstGreg.gd).getDay() + 1) % 7; // شنبه=0
    for (let i = 0; i < firstWeekday; i += 1) grid.append(el('div', {}));

    const totalDays = daysInJalaliMonth(view.jy, view.jm);
    const selected = parseJalaliString(input.value);
    for (let d = 1; d <= totalDays; d += 1) {
      const isSelected = selected && selected.jy === view.jy && selected.jm === view.jm && selected.jd === d;
      const dayBtn = el('button', {
        type: 'button',
        style: `padding:6px 0;border:none;border-radius:6px;cursor:pointer;background:${isSelected ? 'var(--ochre-600)' : 'transparent'};color:${isSelected ? '#fff' : 'var(--ink-900)'}`,
        onclick: () => { input.value = formatJalali(view.jy, view.jm, d); input.dispatchEvent(new Event('change')); closePanel(); },
      }, String(d));
      grid.append(dayBtn);
    }
    panel.append(grid);

    const todayBtn = el('button', {
      type: 'button', class: 'btn-sm', style: 'width:100%;margin-top:8px;background:var(--stone-100)',
      onclick: () => { const t = todayJalali(); input.value = formatJalali(t.jy, t.jm, t.jd); input.dispatchEvent(new Event('change')); closePanel(); },
    }, 'امروز');
    panel.append(todayBtn);
  }

  function shiftMonth(dir) {
    view.jm += dir;
    if (view.jm > 12) { view.jm = 1; view.jy += 1; }
    if (view.jm < 1) { view.jm = 12; view.jy -= 1; }
    drawCalendar();
  }

  input.addEventListener('focus', openPanel);
  input.addEventListener('click', openPanel);
}

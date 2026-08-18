// حساب‌های ستادی (ادمین/بازرس) نقش/تخصص ثابت ندارند — قبل از رفتن به پنل گزارش‌دهی، همین‌جا
// انتخاب می‌کنند این‌بار به چه عنوانی (مسئول فنی/ایمنی/بهداشت) و در چه تخصصی (استخراج/اکتشاف/
// فرآوری) می‌خواهند گزارش ثبت کنند. خروجی این صفحه دقیقاً همان چیزی است که بعداً وارد
// fetchMinesByGeoScope و mountTechOfficerPanel/mountSafetyOfficerPanel می‌شود.
import { el } from '../../lib/dom.js';

const ROLE_OPTIONS = [
  { value: 'tech_officer', label: '🦺 مسئول فنی' },
  { value: 'safety_officer', label: '🦺 مسئول ایمنی' },
  { value: 'health_officer', label: '⚕️ بهداشت حرفه‌ای' },
];
const SPECIALTY_OPTIONS = ['استخراج', 'اکتشاف', 'فرآوری'];

/** @param {(choice: {role: string, specialty: string}) => void} onSubmit */
export function mountStaffFieldPicker(root, onSubmit, onLogout) {
  let role = 'tech_officer';
  let specialty = 'استخراج';

  const roleRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' });
  ROLE_OPTIONS.forEach((opt) => {
    const btn = el('button', {
      class: 'btn-sm',
      style: opt.value === role ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)',
      onclick: () => { role = opt.value; redraw(); },
    }, opt.label);
    roleRow.append(btn);
  });

  const specRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' });
  SPECIALTY_OPTIONS.forEach((s) => {
    const btn = el('button', {
      class: 'btn-sm',
      style: s === specialty ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)',
      onclick: () => { specialty = s; redraw(); },
    }, s);
    specRow.append(btn);
  });

  function redraw() {
    roleRow.querySelectorAll('button').forEach((b, i) => {
      b.style.cssText = ROLE_OPTIONS[i].value === role
        ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)';
    });
    specRow.querySelectorAll('button').forEach((b, i) => {
      b.style.cssText = SPECIALTY_OPTIONS[i] === specialty
        ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)';
    });
  }

  root.append(el('div', { class: 'gate-screen' }, el('div', { class: 'gate-card' }, [
    el('div', { style: 'text-align:center;margin-bottom:6px' }, [
      el('div', { style: 'font-size:32px' }, '📋'),
      el('div', { style: 'margin-top:8px;font-size:var(--text-sm)' }, 'این گزارش را به‌عنوان کدام سمت و در کدام تخصص ثبت می‌کنید؟'),
    ]),
    el('div', { style: 'font-size:var(--text-xs);color:var(--ink-500)' }, 'سمت گزارش'),
    roleRow,
    el('div', { style: 'font-size:var(--text-xs);color:var(--ink-500);margin-top:14px' }, 'تخصص / نوع پرونده'),
    specRow,
    el('button', {
      class: 'btn btn-primary', style: 'margin-top:18px;width:100%',
      onclick: () => onSubmit({ role, specialty }),
    }, 'ادامه'),
    el('button', { class: 'btn btn-ghost', style: 'margin-top:8px', onclick: onLogout }, 'خروج'),
  ])));
}

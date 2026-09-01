import { el, showToast, openModal } from '../../lib/dom.js';
import { insertDeptRecords } from '../../lib/records.js';
import { DEPT_SECTIONS, DEPT_CAT_COLORS } from '../../lib/sections.js';
import { attachJalaliDatePicker } from '../../lib/jalaliDatePicker.js';

const DATE_KEY_RE = /تاریخ/;

/**
 * قبلاً تنها راه اضافه‌کردن رکورد، ایمپورت گروهی اکسل/CSV بود (importModal.js) — برای یک واحد
 * تکی (مثلاً یک کارخانه‌ی تازه در بخش صنعت) کاربر مجبور بود یک فایل اکسل تک‌سطری بسازد.
 * این مودال از همان ساختار فیلدهای هر بخش (DEPT_SECTIONS) می‌سازد، پس برای معدن/صنعت/اکتشاف/
 * فرآوری/اصناف بدون هیچ تغییر دیگری کار می‌کند.
 */
export function openAddRecordModal(department, nameField, userEmail, onDone) {
  const sections = DEPT_SECTIONS[department] || [];
  const catColors = DEPT_CAT_COLORS[department] || {};
  const draft = {};

  const { body } = openModal({ title: `➕ افزودن رکورد جدید — ${department}`, width: '560px' });

  const catSelect = el('select', {}, [
    el('option', { value: '' }, '— انتخاب نشده —'),
    ...Object.keys(catColors).map((c) => el('option', { value: c }, c)),
  ]);
  catSelect.addEventListener('change', () => { draft['دسته'] = catSelect.value; });
  body.append(el('div', { style: 'margin-bottom:12px' }, [el('label', {}, 'دسته / وضعیت فعالیت'), catSelect]));

  sections.forEach((sec) => {
    const fieldsGrid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px' });
    sec.keys.forEach(([key, label]) => {
      const input = el('input', {
        type: 'text',
        placeholder: DATE_KEY_RE.test(key) ? 'مثلاً 1403/06/15 (شمسی)' : '',
        autocomplete: 'off',
      });
      input.addEventListener('input', () => { draft[key] = input.value; });
      if (DATE_KEY_RE.test(key)) attachJalaliDatePicker(input);
      fieldsGrid.append(el('div', {}, [el('label', {}, label), input]));
    });
    body.append(el('div', { class: 'card', style: 'margin-bottom:16px' }, [
      el('h3', { style: 'font-size:var(--text-sm);margin-bottom:12px' }, sec.title),
      fieldsGrid,
    ]));
  });

  const saveBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center' }, '💾 ثبت رکورد جدید');
  saveBtn.addEventListener('click', async () => {
    if (!draft[nameField] || !String(draft[nameField]).trim()) {
      showToast('⚠️ نام واحد/معدن را وارد کنید');
      return;
    }
    saveBtn.disabled = true; const orig = saveBtn.textContent; saveBtn.textContent = '⏳ در حال ثبت...';
    try {
      await insertDeptRecords(department, [draft], userEmail || '');
      showToast('✅ رکورد جدید ثبت شد');
      onDone();
    } catch (err) {
      showToast(`❌ خطا در ثبت: ${err.message}`);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = orig;
    }
  });
  body.append(saveBtn);
}

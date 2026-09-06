import { el, showToast, openModal } from '../../lib/dom.js';
import { insertDeptRecords, fetchDeptRecords } from '../../lib/records.js';
import { DEPT_SECTIONS, DEPT_CAT_COLORS } from '../../lib/sections.js';
import { attachJalaliDatePicker } from '../../lib/jalaliDatePicker.js';

const DATE_KEY_RE = /تاریخ/;

// نرمال‌سازی سبک برای تشخیص نام‌های «همان واحد» با نگارش کمی متفاوت (فاصله/نیم‌فاصله/ی-ي) —
// دقیقاً همان الگویی که باعث شد یک معدن («سریش آباد») دو بار جدا ثبت شود (یکی با پرانتز کد
// کاداستر) بدون اینکه کسی متوجه شود، تا وقتی یک بررسی دستی جدا آن را لو داد.
function normalizeName(s) {
  return (s || '').replace(/[\u200c\s]+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim().toLowerCase();
}

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

  let existingNames = [];
  fetchDeptRecords(department).then((rows) => {
    existingNames = rows.map((r) => ({ raw: r[nameField], norm: normalizeName(r[nameField]) })).filter((x) => x.norm);
  }).catch(() => {});

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
    const newNorm = normalizeName(draft[nameField]);
    const dup = existingNames.find((x) => x.norm === newNorm || x.norm.includes(newNorm) || newNorm.includes(x.norm));
    if (dup && !window.confirm(`⚠️ یک رکورد با نامی خیلی نزدیک از قبل ثبت شده: «${dup.raw}»\nاگه این همون واحده، به‌جای رکورد جدید، همون رکورد رو ویرایش کنید — رکورد تکراری باعث گم‌شدن اطلاعات می‌شه (مثل اتفاقی که قبلاً برای «سریش‌آباد» افتاد).\n\nمطمئنید می‌خواید رکورد جدید و جدا ثبت کنید؟`)) {
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

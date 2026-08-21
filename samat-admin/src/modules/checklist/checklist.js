import { el, showToast } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import {
  SUPP_TITLES, fetchAllSupplementary, closeCorrectiveAction, exportCorrectiveActionsForEngineeringOrg,
  approveEquipmentRows, rejectEquipmentRows,
} from '../../lib/supplementary.js';
import { exportXLSX } from '../../lib/exporters.js';
import { attachJalaliDatePicker } from '../../lib/jalaliDatePicker.js';
import { parseJalaliString, toGregorian } from '../../lib/jalaliCalendar.js';
import {
  renderChecklist as renderChecklistRows, renderTraining, renderProduction, renderPersonnel, renderCorrective, renderQuarterlyMaps,
  renderIncidents, renderEquipment,
} from './renderers.js';
import { openChecklistItemsModal } from './checklistItemsModal.js';

const SUB_TABS = Object.keys(SUPP_TITLES);
let activeSub = 'checklist';
let mineFilter = '';
let dateFromStr = '';
let dateToStr = '';

/** نام فیلد «تاریخ رویداد» هر زیرتب — برای فیلتر بازه‌ی زمانی. تب‌هایی که مفهوم تاریخ دقیق ندارند
 * (نفرات: فهرست فعلی پرسنل، تولید: فقط دوره‌ی ماهانه‌ی متنی) در این فهرست نیستند و فیلتر تاریخ
 * رویشان بی‌اثر می‌ماند. */
const DATE_FIELD_BY_SUB = {
  checklist: 'shift_date',
  training: 'training_date',
  corrective: 'created_at',
  quarterlymaps: 'created_at',
  incident: 'created_at',
  equipment: 'created_at',
};

/** رشته‌ی تاریخ ورودی تقویم شمسی («۱۴۰۴/۰۵/۱۰») را به Date میلادی تبدیل می‌کند */
function jalaliInputToDate(str) {
  const parsed = parseJalaliString(str);
  if (!parsed) return null;
  const g = toGregorian(parsed.jy, parsed.jm, parsed.jd);
  return new Date(g.gy, g.gm - 1, g.gd);
}

/** مقدار فیلد تاریخ یک ردیف را به Date تبدیل می‌کند — چه به‌صورت ISO میلادی (created_at) چه رشته‌ی
 * شمسی («۱۴۰۴/۰۵/۱۰» برای shift_date/training_date) */
function rowDateValue(row, field) {
  const raw = row[field];
  if (!raw) return null;
  const jalali = parseJalaliString(raw);
  if (jalali) { const g = toGregorian(jalali.jy, jalali.jm, jalali.jd); return new Date(g.gy, g.gm - 1, g.gd); }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function renderChecklist(container, state) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال بارگذاری گزارش‌های تکمیلی...',
  ]));

  let cache;
  try {
    const nameField = DEPT_NAME_FIELD[state.department];
    const mines = applyGeoScope(await fetchDeptRecords(state.department), state.assignedProvince, state.assignedCounty);
    const scopedNames = new Set(mines.map((m) => m[nameField]));
    cache = await fetchAllSupplementary(state.department, scopedNames);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${err.message}`));
    return;
  }

  container.innerHTML = '';

  const tabs = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px' });
  SUB_TABS.forEach((sub) => {
    tabs.append(el('button', {
      class: 'btn-sm',
      style: sub === activeSub ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)',
      onclick: () => { activeSub = sub; renderChecklist(container, state); },
    }, SUPP_TITLES[sub]));
  });
  container.append(tabs);

  const toolbar = el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap' });
  const filterInput = el('input', { type: 'text', placeholder: 'فیلتر بر اساس نام معدن...', style: 'flex:1;min-width:200px', value: mineFilter });
  filterInput.addEventListener('input', () => { mineFilter = filterInput.value; drawList(); });
  toolbar.append(filterInput);

  const dateFromInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'از تاریخ (مثلاً ۱۴۰۴/۰۱/۰۱)', style: 'width:170px', value: dateFromStr });
  const dateToInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'تا تاریخ', style: 'width:170px', value: dateToStr });
  attachJalaliDatePicker(dateFromInput);
  attachJalaliDatePicker(dateToInput);
  dateFromInput.addEventListener('change', () => { dateFromStr = dateFromInput.value; drawList(); });
  dateToInput.addEventListener('change', () => { dateToStr = dateToInput.value; drawList(); });
  const clearDatesBtn = el('button', {
    type: 'button', class: 'btn-sm', style: 'background:var(--stone-100)',
    onclick: () => { dateFromStr = ''; dateToStr = ''; dateFromInput.value = ''; dateToInput.value = ''; drawList(); },
  }, '✕ پاک‌کردن بازه');
  const dateFieldForActiveSub = () => DATE_FIELD_BY_SUB[activeSub];
  const dateFilterBox = el('div', { style: 'display:flex;gap:6px;align-items:center' }, [dateFromInput, dateToInput, clearDatesBtn]);
  toolbar.append(dateFilterBox);
  if (!dateFieldForActiveSub()) {
    dateFilterBox.style.display = 'none'; // این زیرتب مفهوم «تاریخ رویداد» ندارد (نفرات/تولید)
  }

  const xlsxBtn = el('button', { class: 'btn btn-ghost', onclick: async () => {
    const rows = filteredRows();
    if (!rows.length) { showToast('⚠️ موردی برای خروجی گرفتن یافت نشد'); return; }
    xlsxBtn.disabled = true; const orig = xlsxBtn.textContent; xlsxBtn.textContent = '⏳ در حال آماده‌سازی...';
    try {
      await exportXLSX(rows, `${SUPP_TITLES[activeSub].replace(/[^\p{L}\p{N}]+/gu, '_')}_${state.department}`, activeSub);
      showToast('✅ فایل اکسل دانلود شد');
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    } finally {
      xlsxBtn.disabled = false; xlsxBtn.textContent = orig;
    }
  } }, '📊 خروجی اکسل همین بخش');
  toolbar.append(xlsxBtn);

  if (activeSub === 'corrective') {
    const exportBtn = el('button', { class: 'btn btn-ghost', onclick: async () => {
      const rows = filteredRows();
      if (!rows.length) { showToast('⚠️ موردی برای خروجی گرفتن یافت نشد'); return; }
      showToast('⏳ در حال آماده‌سازی گزارش...');
      try {
        await exportCorrectiveActionsForEngineeringOrg(rows);
        showToast(`✅ فایل دانلود شد — ${rows.length} مورد`);
      } catch (err) {
        showToast(`⚠️ خطا: ${err.message}`);
      }
    } }, '📤 خروجی گزارش برای سازمان نظام مهندسی معدن استان');
    toolbar.append(exportBtn);
  }
  if (activeSub === 'checklist') {
    const manageBtn = el('button', { class: 'btn btn-ghost', onclick: () => openChecklistItemsModal(state.department) }, '⚙️ مدیریت آیتم‌های چک‌لیست');
    toolbar.append(manageBtn);
  }
  container.append(toolbar);

  const listBox = el('div');
  container.append(listBox);

  function filteredRows() {
    let rows = cache[activeSub] || [];
    if (mineFilter.trim()) rows = rows.filter((r) => (r.mine_name || '').includes(mineFilter.trim()));
    const dateField = dateFieldForActiveSub();
    if (dateField && (dateFromStr.trim() || dateToStr.trim())) {
      const from = dateFromStr.trim() ? jalaliInputToDate(dateFromStr) : null;
      const to = dateToStr.trim() ? jalaliInputToDate(dateToStr) : null;
      rows = rows.filter((r) => {
        const d = rowDateValue(r, dateField);
        if (!d) return false; // ردیف بدون تاریخ معتبر، در فیلتر بازه‌ی زمانی نادیده گرفته می‌شود
        if (from && d < from) return false;
        if (to) { const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999); if (d > toEnd) return false; }
        return true;
      });
    }
    return rows;
  }

  function drawList() {
    listBox.innerHTML = '';
    const rows = filteredRows();
    if (activeSub === 'corrective') {
      listBox.append(...renderCorrective(rows, {
        onClose: async (id) => {
          const note = window.prompt('توضیح کوتاه درباره‌ی رفع مشکل (اختیاری):') || '';
          try {
            await closeCorrectiveAction(id, note);
            showToast('✅ بسته شد');
            renderChecklist(container, state);
          } catch (err) {
            showToast(`⚠️ ${err.message}`);
          }
        },
      }));
      return;
    }
    if (activeSub === 'equipment') {
      listBox.append(...renderEquipment(rows, {
        onApprove: async (ids) => {
          try {
            await approveEquipmentRows(ids);
            showToast('✅ تایید شد');
            renderChecklist(container, state);
          } catch (err) {
            showToast(`⚠️ ${err.message}`);
          }
        },
        onReject: async (ids) => {
          const reason = window.prompt('دلیل رد (برای اطلاع مسئول فنی نمایش داده می‌شود):') || '';
          if (!reason.trim()) { showToast('⚠️ برای رد کردن، دلیل را وارد کنید'); return; }
          try {
            await rejectEquipmentRows(ids, reason.trim());
            showToast('❌ رد شد');
            renderChecklist(container, state);
          } catch (err) {
            showToast(`⚠️ ${err.message}`);
          }
        },
      }));
      return;
    }
    const renderers = {
      checklist: renderChecklistRows, training: renderTraining, production: renderProduction,
      personnel: renderPersonnel, quarterlymaps: renderQuarterlyMaps, incident: renderIncidents,
    };
    listBox.append(...renderers[activeSub](rows));
  }

  drawList();
}

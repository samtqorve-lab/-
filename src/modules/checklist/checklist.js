import { el, showToast } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import {
  SUPP_TITLES, fetchAllSupplementary, closeCorrectiveAction, exportCorrectiveActionsForEngineeringOrg,
  approveEquipmentRows, rejectEquipmentRows,
} from '../../lib/supplementary.js';
import { exportXLSX } from '../../lib/exporters.js';
import {
  renderChecklist as renderChecklistRows, renderTraining, renderProduction, renderPersonnel, renderCorrective, renderQuarterlyMaps,
  renderIncidents, renderEquipment,
} from './renderers.js';
import { openChecklistItemsModal } from './checklistItemsModal.js';

const SUB_TABS = Object.keys(SUPP_TITLES);
let activeSub = 'checklist';
let mineFilter = '';

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
    const rows = cache[activeSub] || [];
    if (!mineFilter.trim()) return rows;
    return rows.filter((r) => (r.mine_name || '').includes(mineFilter.trim()));
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

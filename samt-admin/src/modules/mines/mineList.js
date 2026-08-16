import { el, esc, showToast } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_SEARCH_PLACEHOLDER, DEPT_NAME_FIELD, DEPT_CAT_COLORS } from '../../lib/sections.js';
import { setMine } from '../../router.js';
import { openImportModal } from './importModal.js';
import { openBoundaryImportModal } from './boundaryImportModal.js';
import { exportCSV, exportAllKML, exportXLSX } from '../../lib/exporters.js';

export async function renderMineList(container, state, ctx) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال بارگذاری فهرست...',
  ]));

  let allRows;
  try {
    allRows = await fetchDeptRecords(state.department);
    allRows = applyGeoScope(allRows, state.assignedProvince, state.assignedCounty);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${err.message}`));
    return;
  }

  container.innerHTML = '';
  const nameField = DEPT_NAME_FIELD[state.department] || 'نام_معدن';
  const catColors = DEPT_CAT_COLORS[state.department] || {};

  const toolbar = el('div', { class: 'list-toolbar' });
  const searchBox = el('div', { class: 'search-box' }, [
    el('span', { class: 'ic' }, '⌕'),
    el('input', { type: 'text', placeholder: DEPT_SEARCH_PLACEHOLDER[state.department] || 'جست‌وجو...' }),
  ]);
  const catSelect = el('select', { style: 'max-width:220px' });
  toolbar.append(searchBox, catSelect);

  const isAdminRole = ctx && ['admin', 'superadmin'].includes(ctx.myRole);
  if (isAdminRole) {
    const importBtn = el('button', { class: 'btn btn-ghost', onclick: () => openImportModal(state.department, allRows, () => renderMineList(container, state, ctx)) }, '📥 ایمپورت اکسل/CSV');
    toolbar.append(importBtn);
    const boundaryBtn = el('button', { class: 'btn btn-ghost', onclick: () => openBoundaryImportModal(state.department, allRows, () => renderMineList(container, state, ctx)) }, '📐 ایمپورت مختصات کاداستر');
    toolbar.append(boundaryBtn);
  }
  const csvBtn = el('button', { class: 'btn btn-ghost', onclick: () => exportCSV(allRows, `${state.department}_قروه.csv`) }, '📄 خروجی CSV');
  const xlsxBtn = el('button', { class: 'btn btn-ghost', onclick: async () => {
    xlsxBtn.disabled = true; const orig = xlsxBtn.textContent; xlsxBtn.textContent = '⏳ در حال آماده‌سازی...';
    try {
      await exportXLSX(allRows, `${state.department}_قروه`);
      showToast('✅ فایل اکسل دانلود شد');
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    } finally {
      xlsxBtn.disabled = false; xlsxBtn.textContent = orig;
    }
  } }, '📊 خروجی اکسل');
  const kmlBtn = el('button', { class: 'btn btn-ghost', onclick: () => {
    const count = exportAllKML(allRows, nameField, catColors, `${state.department}_قروه`, (m) => (state.department === 'معدن'
      ? `شماره پروانه: ${m['شماره_پروانه'] || '-'} | دارنده: ${m['نام_دارنده'] || '-'} | ماده: ${m['نام_ماده'] || '-'}`
      : `دسته: ${m['دسته'] || '-'}`));
    if (!count) showToast('⚠️ هیچ رکوردی مختصات چهارگوش ثبت‌شده ندارد');
    else showToast(`✅ فایل KML شامل ${count} مورد دانلود شد`);
  } }, '🗺️ خروجی KML');
  toolbar.append(csvBtn, xlsxBtn, kmlBtn);

  const countLabel = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' });
  const listBox = el('div');

  container.append(toolbar, countLabel, listBox);

  const categories = [...new Set(allRows.map((r) => r['دسته']).filter(Boolean))];
  catSelect.append(el('option', { value: '' }, 'همه دسته‌ها'));
  categories.forEach((c) => catSelect.append(el('option', { value: c }, c)));

  function draw() {
    const q = searchBox.querySelector('input').value.trim();
    const cat = catSelect.value;
    let filtered = allRows;
    if (cat) filtered = filtered.filter((r) => r['دسته'] === cat);
    if (q) {
      filtered = filtered.filter((r) =>
        [r[nameField], r['شماره_پروانه'], r['نام_دارنده'], r['کد_کاداستر']].some((v) => (v || '').toString().includes(q)),
      );
    }
    countLabel.textContent = q || cat ? `${filtered.length} از ${allRows.length} مورد` : `${allRows.length} مورد`;
    listBox.innerHTML = '';
    if (!filtered.length) {
      listBox.append(el('div', { class: 'empty-state' }, 'موردی یافت نشد'));
      return;
    }
    filtered.forEach((r) => {
      const catColor = catColors[r['دسته']];
      listBox.append(el('div', {
        class: 'mine-row',
        style: catColor ? `--row-accent:${catColor.border}` : '',
        onclick: () => setMine(r._rowId),
      }, [
        el('div', { style: 'flex:1' }, [
          el('div', { class: 'mine-name' }, esc(r[nameField] || '—')),
          el('div', { class: 'mine-meta' }, `${esc(r['دسته'] || '—')} · ${esc(r['نام_دارنده'] || r['شهرستان'] || '—')}`),
        ]),
        el('span', { class: 'mine-code', dir: 'ltr' }, r['شماره_پروانه'] || r['کد_کاداستر'] || ''),
      ]));
    });
  }

  searchBox.querySelector('input').addEventListener('input', draw);
  catSelect.addEventListener('change', draw);
  draw();
}

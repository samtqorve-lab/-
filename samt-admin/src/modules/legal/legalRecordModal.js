import { el, showToast, openModal } from '../../lib/dom.js';
import { LEGAL_TITLES, saveLegalRecord, legalStatusMeta } from '../../lib/legal.js';
import { LEGAL_SCHEMAS } from './legalSchemas.js';

export function openLegalRecordModal({ sub, existing, mineNames, legalCache, onSaved }) {
  const schema = LEGAL_SCHEMAS[sub];
  const v = existing || {};
  const { body, close } = openModal({ title: `${existing ? '✏️ ویرایش' : '➕ ثبت جدید'} — ${LEGAL_TITLES[sub]}`, width: '460px' });

  const mineSelect = el('select', {}, mineNames.map((name) => el('option', { value: name }, name)));
  if (existing?.mine_name) mineSelect.value = existing.mine_name;
  body.append(el('div', {}, [el('label', {}, 'معدن'), mineSelect]));

  const crossBox = el('div', {});
  body.append(crossBox);
  function refreshCrossCheck() {
    crossBox.innerHTML = '';
    if (!schema.crossCheck) return;
    const result = schema.crossCheck(mineSelect.value, legalCache);
    crossBox.append(el('div', { style: `font-size:var(--text-xs);color:${result.ok ? 'var(--patina-700)' : 'var(--rust-600)'};margin-top:4px` }, result.text));
  }
  mineSelect.addEventListener('change', refreshCrossCheck);
  refreshCrossCheck();

  const fieldEls = {};
  const rowGroups = {};

  schema.fields.forEach((f) => {
    let input;
    const value = v[f.key] ?? f.default ?? '';
    if (f.type === 'select') {
      const opts = f.options.map((opt) => el('option', { value: opt }, (f.optionLabels && f.optionLabels[opt]) || legalStatusMeta(opt).l));
      input = el('select', {}, opts);
      input.value = value || f.options[0];
    } else if (f.type === 'textarea') {
      input = el('textarea', { rows: '2' }, String(value));
    } else if (f.type === 'checkbox') {
      input = el('input', { type: 'checkbox', style: 'width:auto' });
      input.checked = !!value;
    } else {
      input = el('input', { type: f.type, value: f.type === 'checkbox' ? '' : value, placeholder: f.placeholder || '', dir: f.dir || '' });
    }
    fieldEls[f.key] = input;

    const fieldWrap = f.type === 'checkbox'
      ? el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-sm);margin-top:8px' }, [input, f.label])
      : el('div', {}, [el('label', {}, f.label), input]);

    if (f.row) {
      if (!rowGroups[f.row]) {
        rowGroups[f.row] = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' });
        body.append(rowGroups[f.row]);
      }
      rowGroups[f.row].append(fieldWrap);
    } else {
      body.append(fieldWrap);
    }
  });

  const saveBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:16px' }, '💾 ذخیره');
  saveBtn.addEventListener('click', async () => {
    if (!mineSelect.value) { showToast('⚠️ معدن را انتخاب کنید'); return; }
    for (const f of schema.fields) {
      if (f.required && !String(fieldEls[f.key].value || '').trim()) {
        showToast(`⚠️ ${f.label} را وارد کنید`);
        return;
      }
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'در حال ذخیره...';
    try {
      const payload = { mine_name: mineSelect.value };
      schema.fields.forEach((f) => {
        const input = fieldEls[f.key];
        if (f.type === 'number') payload[f.key] = input.value === '' ? null : parseFloat(input.value);
        else if (f.type === 'date') payload[f.key] = input.value || null;
        else if (f.type === 'checkbox') payload[f.key] = input.checked;
        else if (f.type === 'textarea' || f.type === 'text') payload[f.key] = input.value.trim() || null;
        else payload[f.key] = input.value;
      });
      await saveLegalRecord(sub, payload, existing?.id);
      showToast('✅ ذخیره شد');
      close();
      onSaved?.();
    } catch (err) {
      showToast(`⚠️ خطا در ذخیره: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 ذخیره';
    }
  });
  body.append(saveBtn);
}

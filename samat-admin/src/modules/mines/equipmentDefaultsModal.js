import { el, esc, showToast, openModal } from '../../lib/dom.js';
import { updateDeptRecord } from '../../lib/records.js';

const EQUIP_FIELD_KEYS = [
  { field: 'تجهیزات_نفت_گاز', label: 'نفت‌گاز' },
  { field: 'تجهیزات_گاز_مایع', label: 'گاز مایع' },
  { field: 'تجهیزات_نفت_سفید', label: 'نفت سفید' },
];

function getEquipmentList(record) {
  const list = [];
  EQUIP_FIELD_KEYS.forEach(({ field, label }) => {
    const rows = record[field];
    if (Array.isArray(rows)) {
      rows.forEach((row, i) => {
        list.push({
          key: `${field}__${i}`, field, name: row['نام'] || '', model: row['مدل'] || '', type: row['نوع'] || label, count: row['تعداد'] || '',
        });
      });
    }
  });
  return list;
}

/**
 * لیست ماشین‌آلات پیش‌فرض معدن (برای درخواست سهمیه‌ی سوخت در اپ مسئول فنی) را از پنل ادمین هم
 * قابل مدیریت می‌کند — قبلاً فقط خود مسئول فنی می‌توانست این لیست را (از داخل اپ) اضافه کند، و
 * چون هیچ معدنی این فیلدها را از قبل پر نداشت، آن بخش برای هر مسئول فنی همیشه خالی به نظر می‌رسید.
 */
export function openEquipmentDefaultsModal(record, department, rowId) {
  let workingList = getEquipmentList(record);
  let editingKey = null;
  const { body } = openModal({ title: `🛢️ ماشین‌آلات پیش‌فرض (سهمیه‌ی سوخت) — ${record['نام_معدن'] || ''}`, width: '520px' });

  function draw() {
    body.innerHTML = '';
    body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      'این لیست همان چیزی است که مسئول فنی داخل اپ، زیر «ماشین‌آلات پیش‌فرض معدن» می‌بیند و برایش عکس نمای دور + شماره سریال ثبت می‌کند.'));
    if (!workingList.length) {
      body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);padding:6px 0' }, 'هنوز ماشین‌آلاتی برای این معدن ثبت نشده.'));
    }
    workingList.forEach((eq) => {
      if (editingKey === eq.key) {
        const nameInput = el('input', { placeholder: 'نام ماشین', value: eq.name });
        nameInput.addEventListener('input', () => { eq.name = nameInput.value; });
        const modelInput = el('input', { placeholder: 'مدل', value: eq.model, style: 'flex:1' });
        modelInput.addEventListener('input', () => { eq.model = modelInput.value; });
        const countInput = el('input', { placeholder: 'تعداد', value: eq.count, style: 'width:70px' });
        countInput.addEventListener('input', () => { eq.count = countInput.value; });
        const typeSelect = el('select', {}, ['نفت‌گاز', 'گاز مایع', 'نفت سفید'].map((t) => el('option', { value: t }, t)));
        typeSelect.value = eq.type;
        typeSelect.addEventListener('change', () => {
          eq.type = typeSelect.value;
          eq.field = eq.type === 'گاز مایع' ? 'تجهیزات_گاز_مایع' : (eq.type === 'نفت سفید' ? 'تجهیزات_نفت_سفید' : 'تجهیزات_نفت_گاز');
        });
        const doneBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff;flex:1', onclick: () => { editingKey = null; draw(); } }, '✔️ تمام');
        const removeBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => {
          if (!confirm('این دستگاه از لیست حذف شود؟')) return;
          workingList = workingList.filter((r) => r.key !== eq.key);
          draw();
        } }, 'حذف');
        body.append(el('div', { style: 'background:var(--amber-50);border-radius:10px;padding:10px;margin-bottom:8px;border:1.5px solid var(--amber-600)' }, [
          nameInput,
          el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [modelInput, countInput]),
          typeSelect,
          el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [doneBtn, removeBtn]),
        ]));
        return;
      }
      body.append(el('div', { style: 'background:var(--stone-50);border-radius:10px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center' }, [
        el('div', {}, [
          el('div', { style: 'font-weight:700;font-size:var(--text-sm)' }, esc(eq.name || eq.type)),
          el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, `${esc(eq.type)}${eq.model ? ` — مدل ${esc(eq.model)}` : ''}${eq.count ? ` — تعداد ${esc(eq.count)}` : ''}`),
        ]),
        el('button', { style: 'background:none;border:none;font-size:15px;cursor:pointer', onclick: () => { editingKey = eq.key; draw(); } }, '✏️'),
      ]));
    });

    const addBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700);flex:1', onclick: () => {
      const tempKey = `new_${Date.now()}`;
      workingList.push({
        key: tempKey, field: 'تجهیزات_نفت_گاز', name: '', model: '', type: 'نفت‌گاز', count: '',
      });
      editingKey = tempKey;
      draw();
    } }, '➕ افزودن ماشین');
    const saveBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff;flex:1', onclick: async () => {
      saveBtn.disabled = true; saveBtn.textContent = '⏳ در حال ذخیره...';
      try {
        const byField = {};
        EQUIP_FIELD_KEYS.forEach(({ field }) => { byField[field] = []; });
        workingList.forEach((r) => {
          if (!r.name && !r.model && !r.count) return;
          byField[r.field].push({
            نام: r.name, مدل: r.model, نوع: r.type, تعداد: r.count,
          });
        });
        const updated = { ...record, ...byField };
        await updateDeptRecord(department, rowId, updated);
        Object.assign(record, byField);
        showToast('✅ لیست ماشین‌آلات پیش‌فرض ذخیره شد');
        workingList = getEquipmentList(record);
        editingKey = null;
        draw();
      } catch (err) {
        showToast(`❌ خطا: ${err.message}`);
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = '💾 ذخیره لیست';
      }
    } }, '💾 ذخیره لیست');
    body.append(el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [addBtn, saveBtn]));
  }

  draw();
}

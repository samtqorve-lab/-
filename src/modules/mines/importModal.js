import { el, esc, showToast, openModal } from '../../lib/dom.js';
import { ensureXLSX } from '../../lib/xlsxLoader.js';
import { DEPT_SECTIONS, DEPT_NAME_FIELD } from '../../lib/sections.js';
import { insertDeptRecords, updateDeptRecord } from '../../lib/records.js';
import { fetchCustomFields, saveCustomFields, supportsCustomFields } from '../../lib/customFields.js';
import { normalizeKey, DEPT_LICENSE_KEY } from '../../lib/textMatch.js';
import { sb } from '../../lib/supabase.js';

function getKnownFields(department, customFields) {
  const list = [[DEPT_NAME_FIELD[department], 'نام'], [DEPT_LICENSE_KEY[department], 'شماره پروانه/مجوز']];
  (DEPT_SECTIONS[department] || []).forEach((sec) => sec.keys.forEach(([k, l]) => list.push([k, l])));
  Object.entries(customFields).forEach(([k, l]) => { if (!list.some((x) => x[0] === k)) list.push([k, l]); });
  return list;
}

async function readSpreadsheetFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const Papa = (await import('papaparse')).default;
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (res) => resolve({ rows: res.data, headers: res.meta.fields || [] }),
        error: reject,
      });
    });
  }
  const XLSX = await ensureXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return { rows: json, headers: json.length ? Object.keys(json[0]) : [] };
}

export function openImportModal(department, existingRecords, onDone) {
  const { body, close } = openModal({ title: '📥 ایمپورت اکسل/CSV', width: '540px' });
  const nameField = DEPT_NAME_FIELD[department];
  const licenseField = DEPT_LICENSE_KEY[department];
  const canCreateFields = supportsCustomFields(department);

  body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'یک فایل اکسل (.xlsx) یا CSV انتخاب کنید. در مرحله‌ی بعد می‌توانید ستون‌های فایل را با فیلدهای سامانه تطبیق دهید — هیچ‌چیزی قبل از تایید نهایی در دیتابیس ذخیره نمی‌شود.'));
  const fileInput = el('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' });
  body.append(fileInput, statusLine);

  const stepBox = el('div', { style: 'margin-top:14px' });
  body.append(stepBox);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    statusLine.textContent = `در حال خواندن ${file.name} ...`;
    try {
      const { rows, headers } = await readSpreadsheetFile(file);
      statusLine.textContent = `${rows.length} ردیف و ${headers.length} ستون خوانده شد.`;
      if (!headers.length) { showToast('⚠️ ستونی در فایل یافت نشد'); return; }
      renderMapStep(rows, headers);
    } catch (err) {
      statusLine.textContent = '';
      showToast(`⚠️ خطا در خواندن فایل: ${err.message}`);
    }
  });

  async function renderMapStep(rows, headers) {
    stepBox.innerHTML = '';
    let customFields = {};
    let customFieldsRowId = null;
    if (canCreateFields) {
      try {
        const cf = await fetchCustomFields(department);
        customFields = cf.fields;
        customFieldsRowId = cf.rowId;
      } catch { /* اگر بارگذاری فیلدهای اختصاصی شکست بخورد، بدون آن‌ها ادامه می‌دهیم */ }
    }
    const knownFields = getKnownFields(department, customFields);

    const guessCol = (candidates) => headers.find((h) => candidates.some((c) => normalizeKey(h).includes(normalizeKey(c))));
    const licenseColGuess = guessCol(['شماره پروانه', 'شماره_پروانه', 'شماره مجوز', 'شماره_مجوز']);
    const nameColGuess = guessCol(['نام معدن', 'نام_معدن', 'نام واحد', 'نام_واحد', 'نام متقاضی']);

    const licenseColSelect = el('select', {}, [el('option', { value: '' }, '— انتخاب کنید —'), ...headers.map((h) => el('option', { value: h }, h))]);
    const nameColSelect = el('select', {}, [el('option', { value: '' }, '— انتخاب کنید —'), ...headers.map((h) => el('option', { value: h }, h))]);
    if (licenseColGuess) licenseColSelect.value = licenseColGuess;
    if (nameColGuess) nameColSelect.value = nameColGuess;

    stepBox.append(
      el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin-bottom:8px' }, 'مرحله ۲ — تعیین ستون کلید تطبیق'),
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px' }, [
        el('div', {}, [el('label', {}, 'ستون شماره پروانه/مجوز'), licenseColSelect]),
        el('div', {}, [el('label', {}, 'ستون نام'), nameColSelect]),
      ]),
      el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin-bottom:6px' }, 'تطبیق ستون‌ها با فیلدهای سامانه'),
    );

    const mapRows = el('div', { style: 'max-height:260px;overflow-y:auto;border:1px solid var(--stone-200);border-radius:8px' });
    const colSelects = [];
    headers.forEach((h, idx) => {
      const nh = normalizeKey(h);
      let bestKey = '';
      for (const [k, l] of knownFields) { if (normalizeKey(l) === nh) { bestKey = k; break; } }
      if (!bestKey) for (const [k, l] of knownFields) { if (nh.includes(normalizeKey(l)) || normalizeKey(l).includes(nh)) { bestKey = k; break; } }
      const options = [
        el('option', { value: '' }, '— نادیده گرفته شود —'),
        ...(canCreateFields ? [el('option', { value: '__new__', selected: !bestKey ? '' : null }, '➕ فیلد اختصاصی جدید با همین عنوان')] : []),
        ...knownFields.map(([k, l]) => el('option', { value: k, selected: bestKey === k ? '' : null }, l)),
      ];
      const sel = el('select', { style: 'flex:1;font-size:11.5px' }, options);
      sel.value = bestKey || (canCreateFields ? '__new__' : '');
      sel.dataset.header = h;
      colSelects.push(sel);
      mapRows.append(el('div', { style: 'display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--stone-100)' }, [
        el('div', { style: 'flex:1;font-size:var(--text-xs);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: h }, h),
        sel,
      ]));
    });
    stepBox.append(mapRows);

    const previewBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:14px' }, '👁️ پیش‌نمایش تغییرات');
    stepBox.append(previewBtn);
    const previewBox = el('div', { style: 'margin-top:12px' });
    stepBox.append(previewBox);

    previewBtn.addEventListener('click', () => {
      const licenseCol = licenseColSelect.value;
      const nameCol = nameColSelect.value;
      if (!licenseCol && !nameCol) { showToast('⚠️ حداقل یکی از ستون شماره پروانه/مجوز یا نام را انتخاب کنید'); return; }

      const colFieldMap = {};
      colSelects.forEach((sel) => { if (sel.value) colFieldMap[sel.dataset.header] = sel.value; });

      const newFieldDefs = {};
      Object.entries(colFieldMap).forEach(([header, target]) => {
        if (target === '__new__') {
          const key = normalizeKey(header).replace(/[^a-z0-9\u0600-\u06FF]+/gi, '_').replace(/^_+|_+$/g, '') || `field_${Date.now()}`;
          colFieldMap[header] = key;
          if (!customFields[key]) newFieldDefs[key] = header;
        }
      });

      let willAdd = 0;
      let willUpdate = 0;
      const preview = [];
      rows.forEach((row, rowIdx) => {
        const license = licenseCol ? String(row[licenseCol] || '').trim() : '';
        const name = nameCol ? String(row[nameCol] || '').trim() : '';
        if (!license && !name) return;
        let match = null;
        if (license && licenseField) match = existingRecords.find((r) => String(r[licenseField] || '').trim() === license);
        if (!match && name) match = existingRecords.find((r) => String(r[nameField] || '').trim() === name);
        if (match) willUpdate++; else willAdd++;
        preview.push({ rowIdx, license, name, matchId: match ? match._rowId : null });
      });

      previewBox.innerHTML = '';
      const newFieldNote = Object.keys(newFieldDefs).length
        ? `➕ ${Object.keys(newFieldDefs).length} فیلد اختصاصی جدید ساخته می‌شود: ${Object.values(newFieldDefs).slice(0, 8).join('، ')}${Object.keys(newFieldDefs).length > 8 ? ' ...' : ''}`
        : '';
      previewBox.append(
        el('div', { class: 'card' }, [
          el('div', {}, `📄 تعداد کل ردیف‌های معتبر: ${preview.length}`),
          el('div', {}, `🆕 رکورد جدید ساخته می‌شود: ${willAdd}`),
          el('div', {}, `✏️ رکورد موجود به‌روزرسانی می‌شود: ${willUpdate}`),
          newFieldNote ? el('div', { style: 'margin-top:4px' }, newFieldNote) : null,
          el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, '⚠️ فقط سلول‌های غیرخالی فایل جایگزین اطلاعات موجود می‌شوند؛ سلول خالی چیزی را پاک نمی‌کند.'),
        ]),
      );
      const confirmBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:10px' }, '✅ تایید نهایی و ذخیره در دیتابیس');
      previewBox.append(confirmBtn);

      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '⏳ در حال ذخیره...';
        try {
          const { data: { user } } = await sb.auth.getUser();
          if (Object.keys(newFieldDefs).length) {
            Object.assign(customFields, newFieldDefs);
            await saveCustomFields(department, customFields, customFieldsRowId, user ? user.email : '');
          }
          const toInsert = [];
          const toUpdate = [];
          preview.forEach(({ rowIdx, license, name, matchId }) => {
            const row = rows[rowIdx];
            const fields = {};
            Object.entries(colFieldMap).forEach(([header, key]) => {
              const val = row[header];
              if (val !== undefined && val !== null && String(val).trim() !== '') fields[key] = String(val).trim();
            });
            if (matchId) {
              const existing = existingRecords.find((r) => r._rowId === matchId);
              const merged = { ...existing, ...fields };
              delete merged._rowId;
              toUpdate.push({ rowId: matchId, record: merged });
            } else {
              const rec = { [nameField]: name || `رکورد پروانه ${license}`, 'دسته': 'غیره', ...fields };
              if (license && licenseField) rec[licenseField] = license;
              toInsert.push(rec);
            }
          });
          await Promise.all(toUpdate.map((u) => updateDeptRecord(department, u.rowId, u.record)));
          if (toInsert.length) await insertDeptRecords(department, toInsert, user ? user.email : '');

          showToast(`✅ ایمپورت انجام شد — ${toInsert.length} جدید، ${toUpdate.length} به‌روزرسانی`);
          close();
          onDone?.();
        } catch (err) {
          showToast(`⚠️ خطا در ذخیره: ${err.message}`);
          confirmBtn.disabled = false;
          confirmBtn.textContent = '✅ تایید نهایی و ذخیره در دیتابیس';
        }
      });
    });
  }
}

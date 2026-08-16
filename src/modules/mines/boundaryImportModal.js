import { el, esc, showToast, openModal } from '../../lib/dom.js';
import { ensureXLSX } from '../../lib/xlsxLoader.js';
import { decToDMS } from '../../lib/geo.js';
import { updateDeptRecord } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// این فایل‌ها (Rpt_MineInfo و مشابه آن) قالب ثابتی دارند: ردیفی با متن «راس» عنوان ستون شماره‌ی
// گوشه است و درست یک ردیف بالاتر، دو ستون با برچسب «DD» مقادیر طول/عرض جغرافیایی به درجه‌ی اعشاری
// (به ترتیب Long سپس Lat) را نگه می‌دارند. کد شناسایی محدوده هم از متن توضیحات استخراج می‌شود —
// به همین دلیل کاربر لازم نیست ستون‌ها را دستی معرفی کند (برخلاف ایمپورت عمومی اکسل/CSV).
function parseBoundaryReportGrid(grid) {
  let headerRow = -1;
  let cornerCol = -1;
  for (let r = 0; r < grid.length && headerRow < 0; r += 1) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c += 1) {
      if (String(row[c]).trim() === 'راس') { headerRow = r; cornerCol = c; break; }
    }
  }
  if (headerRow < 0) return null;

  const groupRow = grid[headerRow - 1] || [];
  const ddCols = [];
  groupRow.forEach((v, c) => { if (String(v).trim().toUpperCase() === 'DD') ddCols.push(c); });
  if (ddCols.length < 2) return null;
  ddCols.sort((a, b) => a - b);
  const [lonCol, latCol] = ddCols;

  const points = [];
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] || [];
    const label = String(row[cornerCol] ?? '').trim();
    const lon = parseFloat(row[lonCol]);
    const lat = parseFloat(row[latCol]);
    if (!label && (Number.isNaN(lon) || Number.isNaN(lat))) break;
    if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
    points.push({ lat, lon });
  }
  if (!points.length) return null;

  const fullText = grid.map((row) => (row || []).join(' ')).join(' \n ');
  const codeMatch = fullText.match(/کد\s*شناسایی\s+(\d+)/);
  const areaMatch = fullText.match(/مساحت\s+([\d.]+)\s*کیلومتر/);
  return { codeId: codeMatch ? codeMatch[1] : '', area: areaMatch ? areaMatch[1] : '', points };
}

function findRecordByCode(records, codeId) {
  if (!codeId) return null;
  return records.find((r) => String(r['کد_کاداستر'] || '').trim() === codeId)
    || records.find((r) => String(r['شماره_پروانه'] || '').trim() === codeId)
    || null;
}

function cornersPayload(record, points, area) {
  const updated = { ...record };
  LETTERS.forEach((l) => { delete updated[`طول_${l}`]; delete updated[`عرض_${l}`]; });
  points.forEach((p, i) => {
    const letter = LETTERS[i] || `#${i + 1}`;
    updated[`عرض_${letter}`] = decToDMS(p.lat);
    updated[`طول_${letter}`] = decToDMS(p.lon);
  });
  updated['تعداد_ضلع'] = String(points.length);
  if (area && !updated['مساحت']) updated['مساحت'] = area;
  delete updated._rowId;
  return updated;
}

export function openBoundaryImportModal(department, records, onDone) {
  const nameField = DEPT_NAME_FIELD[department];
  const { body, close } = openModal({ title: '📐 ایمپورت خودکار مختصات از گزارش کاداستر رسمی', width: '460px' });
  body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'یک یا چند فایل «مشخصات محدوده» سامانه کاداستر (Rpt_MineInfo یا مشابه) را انتخاب کنید — قالب ستون‌ها به‌صورت خودکار تشخیص داده می‌شود و بر اساس کد شناسایی/شماره پروانه با معدن مربوطه تطبیق داده می‌شود.'));

  const fileInput = el('input', { type: 'file', accept: '.xlsx,.xls', multiple: true });
  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' });
  const summaryBox = el('div', { style: 'margin-top:10px' });
  body.append(fileInput, statusLine, summaryBox);

  let unmatched = [];

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!files.length) return;
    statusLine.textContent = `در حال خواندن ${files.length} فایل...`;
    summaryBox.innerHTML = '';
    await ensureXLSX();
    const XLSX = window.XLSX;
    const results = [];
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const parsed = parseBoundaryReportGrid(grid);
        results.push(parsed ? { fileName: file.name, ...parsed } : { fileName: file.name, error: 'قالب فایل شناخته نشد (ستون «راس» یا مقادیر DD پیدا نشد)' });
      } catch {
        results.push({ fileName: file.name, error: 'خطا در خواندن فایل' });
      }
    }
    statusLine.textContent = '';
    await applyResults(results);
  });

  async function applyResults(results) {
    const okList = [];
    unmatched = [];
    for (const r of results) {
      if (r.error) { unmatched.push(r); continue; }
      const record = findRecordByCode(records, r.codeId);
      if (!record) { unmatched.push(r); continue; }
      // eslint-disable-next-line no-await-in-loop
      try {
        const updated = cornersPayload(record, r.points, r.area);
        if (!updated['کد_کاداستر'] && r.codeId) updated['کد_کاداستر'] = r.codeId;
        // eslint-disable-next-line no-await-in-loop
        await updateDeptRecord(department, record._rowId, updated);
        Object.assign(record, updated);
        okList.push(`${r.fileName} → ${record[nameField] || record['نام_دارنده'] || `کد ${r.codeId}`}`);
      } catch (err) {
        unmatched.push({ ...r, error: `خطا در ذخیره: ${err.message}` });
      }
    }

    if (okList.length) {
      summaryBox.append(el('div', { style: 'color:var(--patina-700);font-size:var(--text-xs);margin-bottom:8px' },
        [`✅ ${okList.length} فایل خودکار تطبیق و ذخیره شد:`, ...okList.map((t) => el('div', {}, t))]));
      showToast(`✅ مختصات ${okList.length} مورد ذخیره شد`);
      onDone?.();
    }
    if (unmatched.length) drawUnmatched();
    else if (!okList.length) showToast('⚠️ هیچ فایلی پردازش نشد');
  }

  function drawUnmatched() {
    summaryBox.append(el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin:10px 0 6px;color:var(--rust-600)' }, `${unmatched.length} فایل نیاز به تطبیق دستی دارند`));
    unmatched.forEach((r) => {
      const row = el('div', { style: 'margin-bottom:10px;border-bottom:1px solid var(--stone-200);padding-bottom:8px' }, [
        el('div', { style: 'font-size:var(--text-xs);font-weight:700' }, r.fileName),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:4px' },
          r.error || (r.codeId ? `کد شناسایی: ${r.codeId} — معدنی با این کد پیدا نشد` : 'کد شناسایی در فایل یافت نشد')),
      ]);
      if (!r.error) {
        const sel = el('select', {}, [
          el('option', { value: '' }, '— انتخاب معدن —'),
          ...records.map((rec) => el('option', { value: rec._rowId }, `${rec[nameField] || rec['نام_دارنده'] || 'بدون نام'} — ${rec['شماره_پروانه'] || rec['کد_کاداستر'] || '—'}`)),
        ]);
        const applyBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700);margin-top:6px', onclick: async () => {
          const record = records.find((rec) => String(rec._rowId) === sel.value);
          if (!record) { showToast('⚠️ یک معدن انتخاب کنید'); return; }
          try {
            const updated = cornersPayload(record, r.points, r.area);
            await updateDeptRecord(department, record._rowId, updated);
            Object.assign(record, updated);
            showToast(`✅ مختصات به «${record[nameField]}» اختصاص یافت`);
            row.remove();
            onDone?.();
          } catch (err) {
            showToast(`⚠️ ${err.message}`);
          }
        } }, '✅ اعمال');
        row.append(sel, applyBtn);
      }
      summaryBox.append(row);
    });
  }

  body.append(el('button', { class: 'btn btn-ghost', style: 'width:100%;justify-content:center;margin-top:14px', onclick: close }, 'بستن'));
}

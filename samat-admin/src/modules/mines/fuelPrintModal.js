import {
  el, esc, showToast, openModal,
} from '../../lib/dom.js';
import { updateDeptRecord } from '../../lib/records.js';
import { sb } from '../../lib/supabase.js';
import { JALALI_MONTHS, todayJalali } from '../../lib/jalaliCalendar.js';
import { attachJalaliDatePicker } from '../../lib/jalaliDatePicker.js';

/**
 * این کل فرم «چاپ درخواست سوخت» (که یک تب کامل پنل ادمین بود) در کامیت e5214d39 («تجزیه» —
 * تبدیل اپ از یک index.html غول‌پیکر به ساختار ماژولار امروزی، ۱۶ شهریور) به‌طور کامل از قلم
 * افتاد و هیچ‌جای ساختار جدید بازسازی نشد. این فایل بازسازی همان فرم اصلی است، با همان متن
 * رسمی/قانونی، منطبق‌شده با الگوهای امروزی (openModal، updateDeptRecord به‌جای saveMineRow قدیمی).
 * بخش‌های «آپلود گزارش سوخت (اکسل/CSV)» و «آرشیو یک‌بارِ ماشین‌آلات» جداگانه اضافه می‌شوند.
 *
 * پیش‌فرض‌های درخواست (نام نماینده، مقدار دریافتی و باقیمانده‌ی هر نوع سوخت، باطله‌برداری و
 * فهرست مواد معدنی/محصولات) داخل خود رکورد معدن (JSONB) زیر کلید FUEL_DEFAULTS_KEY ذخیره می‌شوند —
 * نیازی به تغییر جدول/migration نیست، مثل کلیدهای «تجهیزات_...» همین فرم.
 */

const FUEL_DEFAULTS_KEY = 'پیش_فرض_درخواست_سوخت';

const FUEL_UNITS = { 'نفت‌گاز': 'لیتر', 'گاز مایع': 'کیلوگرم', 'نفت سفید': 'لیتر' };
const FUEL_EQUIP_COLS = {
  'نفت‌گاز': [['نام', 'نام ماشین'], ['نوع', 'نوع/پلاک'], ['تعداد', 'تعداد']],
  'گاز مایع': [['نام', 'نام دستگاه'], ['توضیحات', 'توضیحات'], ['تعداد', 'تعداد']],
  'نفت سفید': [['نام', 'نام دستگاه'], ['توضیحات', 'توضیحات'], ['تعداد', 'تعداد']],
};

function equipKeyForType(type) {
  return `تجهیزات_${type === 'نفت‌گاز' ? 'نفت_گاز' : (type === 'گاز مایع' ? 'گاز_مایع' : 'نفت_سفید')}`;
}

/** فهرست فارسی: «الف، ب و ج» */
function joinFa(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join('، ')} و ${items[items.length - 1]}`;
}

/** دقیقاً همان گروه‌بندی‌ای که صف تایید ادمین (renderers.js) روی mine_equipment انجام می‌دهد —
 * تا عکس نمای‌دور و سریال یک دستگاه کنار هم دیده شوند، نه به‌عنوان دو ردیف جدا. */
function groupApprovedByDevice(rows) {
  const g = {};
  rows.forEach((r) => { const k = r.device_key || `row_${r.id}`; (g[k] = g[k] || []).push(r); });
  return g;
}

function monthYearRow(defaultOffset = 0) {
  const { jy, jm } = todayJalali();
  const monthSel = el('select', { style: 'flex:2' }, JALALI_MONTHS.map((m, i) => el('option', { value: String(i + 1) }, m)));
  const yearSel = el('select', { style: 'flex:1' }, [jy - 1, jy, jy + 1].map((y) => el('option', { value: String(y) }, String(y))));
  monthSel.value = String(jm + defaultOffset > 12 ? 1 : (jm + defaultOffset < 1 ? 12 : jm + defaultOffset));
  yearSel.value = String(jy);
  return { row: el('div', { style: 'display:flex;gap:4px' }, [monthSel, yearSel]), monthSel, yearSel };
}

export function openFuelPrintModal(record, department, rowId, ctx) {
  const nameField = department === 'معدن' ? 'نام_معدن' : 'نام_واحد';
  const mineName = record[nameField] || '';
  const county = record['شهرستان'] || (ctx && ctx.myAssignedCounty) || 'قروه';
  let fuelType = 'نفت‌گاز';
  let equipRows = [];
  let approvedEquip = []; // از mine_equipment status=approved — برای importApprovedEquipment

  // پیش‌فرض‌های ذخیره‌شده‌ی قبلی این معدن (اگر باشد)
  const savedDefaults = (record[FUEL_DEFAULTS_KEY] && typeof record[FUEL_DEFAULTS_KEY] === 'object')
    ? record[FUEL_DEFAULTS_KEY] : {};
  const fuelDraft = JSON.parse(JSON.stringify(savedDefaults['سوخت'] || {})); // { [نوع سوخت]: { دریافتی, باقیمانده } }
  let oreRows = (Array.isArray(savedDefaults['مواد']) && savedDefaults['مواد'].length)
    ? JSON.parse(JSON.stringify(savedDefaults['مواد'])) : [{}]; // [{ نام, مقدار }]
  let lastSavedJson = '';

  const { body, close } = openModal({ title: `🖨️ چاپ درخواست سوخت — ${mineName}`, width: '640px' });

  function loadEquipForType() {
    const key = equipKeyForType(fuelType);
    const saved = Array.isArray(record[key]) ? record[key] : [];
    equipRows = saved.length ? JSON.parse(JSON.stringify(saved)) : [{}];
  }

  async function fetchApprovedEquipment() {
    if (!mineName) return;
    const { data, error } = await sb.from('mine_equipment').select('*').eq('mine_name', mineName).eq('status', 'approved');
    if (!error && data) approvedEquip = data;
  }

  function importApprovedEquipment(silent) {
    const groups = groupApprovedByDevice(approvedEquip);
    const keys = Object.keys(groups);
    if (!keys.length) { if (!silent) showToast('ماشین‌آلات تایید‌شده‌ای برای این معدن ثبت نشده'); return; }
    const existingKeys = new Set(equipRows.map((r) => r._deviceKey).filter(Boolean));
    let added = 0;
    keys.forEach((key) => {
      if (existingKeys.has(key)) return;
      const deviceRows = groups[key];
      const first = deviceRows[0];
      const plateNo = deviceRows.find((r) => r.plate_no)?.plate_no;
      const serialNo = deviceRows.find((r) => r.serial_no)?.serial_no;
      const extraParts = [];
      if (plateNo) extraParts.push(`پلاک: ${plateNo}`);
      if (serialNo) extraParts.push(`سریال: ${serialNo}`);
      const extra = extraParts.join(' — ');
      const row = fuelType === 'نفت‌گاز'
        ? {
          نام: first.machine_type || '', نوع: extra, تعداد: '1', _deviceKey: key,
        }
        : {
          نام: first.machine_type || '', توضیحات: extra, تعداد: '1', _deviceKey: key,
        };
      if (equipRows.length === 1 && Object.values(equipRows[0]).every((v) => !v)) equipRows[0] = row;
      else equipRows.push(row);
      added++;
    });
    if (added) {
      draw();
      if (!silent) showToast(`✅ ${added} ماشین‌آلات تایید‌شده اضافه شد`);
    } else if (!silent) showToast('همه‌ی ماشین‌آلات تایید‌شده از قبل در لیست بودند');
  }

  /** برای دکمه‌ی 📷 هر ردیف — عکس‌های نمای‌دور و سریالِ همان دستگاه را جدا برمی‌گرداند */
  function photosForRow(row) {
    if (!row._deviceKey) return { overview: [], serial: [] };
    const rows = groupApprovedByDevice(approvedEquip)[row._deviceKey] || [];
    return {
      overview: rows.filter((r) => r.photo_type === 'overview' && r.photo_url).map((r) => r.photo_url),
      serial: rows.filter((r) => r.photo_type === 'serial' && r.photo_url).map((r) => r.photo_url),
    };
  }

function openPhotoViewer(name, overview, serial) {
  if (!overview.length && !serial.length) { showToast('⚠️ عکسی برای این دستگاه یافت نشد'); return; }
  const { body: pv } = openModal({ title: `📷 عکس‌های دستگاه — ${name || ''}`, width: '440px' });
  const section = (label, urls) => el('div', { style: 'margin-bottom:10px' }, [
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:6px' }, label),
    urls.length
      ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, urls.map((u) => el('img', {
        src: u, style: 'width:120px;height:120px;object-fit:cover;border-radius:6px;cursor:pointer', onclick: () => window.open(u, '_blank'),
      })))
      : el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500)' }, 'عکسی ثبت نشده'),
  ]);
  pv.append(section('📷 نمای کامل / دور دستگاه', overview), section('🔢 عکس شماره سریال', serial));
}

  const readonlyBox = el('div', { style: 'background:var(--stone-50);border-radius:8px;padding:10px;font-size:var(--text-xs);line-height:2;margin-bottom:10px' });
  const typeSelect = el('select', {}, Object.keys(FUEL_UNITS).map((t) => el('option', { value: t }, t)));
  const repInput = el('input', { placeholder: 'نام نماینده معدن' });
  const reqDateInput = el('input', { placeholder: 'برای انتخاب تاریخ کلیک کنید' });
  attachJalaliDatePicker(reqDateInput);
  const received = monthYearRow(-1);
  const requested = monthYearRow(0);
  const amountReceivedInput = el('input', { placeholder: 'مقدار عددی' });
  const remainingInput = el('input', { placeholder: 'مقدار عددی' });
  const amountRequestedInput = el('input', { placeholder: 'مقدار عددی' });
  const wasteLbl = el('label', {}, department === 'معدن' ? 'باطله‌برداری این دوره (تن)' : 'ضایعات/دورریز این دوره');
  const wasteInput = el('input', { placeholder: 'مقدار عددی' });
  const equipRowsBox = el('div');
  const oreRowsBox = el('div');

  // مقدار اولیه‌ی فیلدها از پیش‌فرض‌های ذخیره‌شده
  repInput.value = savedDefaults['نماینده'] || '';
  wasteInput.value = savedDefaults['باطله'] || '';

  /** مقدار دریافتی/باقیمانده مخصوص هر نوع سوخت است (واحدشان فرق دارد) — جدا نگه داشته می‌شود */
  function stashFuelInputs() {
    fuelDraft[fuelType] = { 'دریافتی': amountReceivedInput.value.trim(), 'باقیمانده': remainingInput.value.trim() };
  }
  function loadFuelInputs() {
    const d = fuelDraft[fuelType] || {};
    amountReceivedInput.value = d['دریافتی'] || '';
    remainingInput.value = d['باقیمانده'] || '';
  }

  function cleanOreRows() {
    return oreRows
      .map((r) => ({ 'نام': (r['نام'] || '').trim(), 'مقدار': (r['مقدار'] || '').trim() }))
      .filter((r) => r['نام'] || r['مقدار']);
  }

  /** همه‌ی چیزی که باید به‌عنوان پیش‌فرض این معدن ذخیره شود */
  function collectDefaults() {
    stashFuelInputs();
    const fuel = {};
    Object.keys(fuelDraft).forEach((t) => {
      const d = fuelDraft[t];
      if (d && (d['دریافتی'] || d['باقیمانده'])) fuel[t] = { 'دریافتی': d['دریافتی'] || '', 'باقیمانده': d['باقیمانده'] || '' };
    });
    return {
      'نماینده': repInput.value.trim(),
      'باطله': wasteInput.value.trim(),
      'مواد': cleanOreRows(),
      'سوخت': fuel,
    };
  }

  /** ذخیره‌ی خودکار — فقط اگر چیزی نسبت به آخرین مقدار ذخیره‌شده تغییر کرده باشد. true = واقعاً نوشت */
  async function persistRequestDefaults() {
    const defaults = collectDefaults();
    const json = JSON.stringify(defaults);
    if (json === lastSavedJson) return false;
    await updateDeptRecord(department, rowId, { ...record, [FUEL_DEFAULTS_KEY]: defaults });
    Object.assign(record, { [FUEL_DEFAULTS_KEY]: defaults });
    lastSavedJson = json;
    return true;
  }

  function renderEquipRows() {
    const cols = FUEL_EQUIP_COLS[fuelType];
    equipRowsBox.innerHTML = '';
    equipRows.forEach((row, i) => {
      const inputs = cols.map(([k, label]) => {
        const input = el('input', { placeholder: label, value: row[k] || '', style: 'flex:1' });
        input.addEventListener('input', () => { row[k] = input.value; });
        return input;
      });
      const { overview, serial } = photosForRow(row);
      const photoBtn = (overview.length || serial.length)
        ? el('button', { class: 'btn-sm', style: 'background:var(--patina-50);color:var(--patina-700)', title: 'مشاهده عکس نمای دور و شماره سریال', onclick: () => openPhotoViewer(row['نام'], overview, serial) }, '📷')
        : null;
      const delBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => { equipRows.splice(i, 1); if (!equipRows.length) equipRows.push({}); renderEquipRows(); } }, '🗑');
      equipRowsBox.append(el('div', { style: 'display:flex;gap:4px;margin-bottom:6px' }, [...inputs, ...(photoBtn ? [photoBtn] : []), delBtn]));
    });
  }

  /** ردیف‌های ماده معدنی (برای معدن) / محصول (برای واحد صنعتی) — هر تعداد ردیف قابل افزودن است */
  function renderOreRows() {
    oreRowsBox.innerHTML = '';
    oreRows.forEach((row, i) => {
      const nameInput = el('input', { placeholder: department === 'معدن' ? 'نام ماده معدنی' : 'نام محصول', value: row['نام'] || '', style: 'flex:2' });
      nameInput.addEventListener('input', () => { row['نام'] = nameInput.value; });
      const amountInput = el('input', { placeholder: department === 'معدن' ? 'مقدار (تن)' : 'مقدار', value: row['مقدار'] || '', style: 'flex:1' });
      amountInput.addEventListener('input', () => { row['مقدار'] = amountInput.value; });
      const delBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => { oreRows.splice(i, 1); if (!oreRows.length) oreRows.push({}); renderOreRows(); } }, '🗑');
      oreRowsBox.append(el('div', { style: 'display:flex;gap:4px;margin-bottom:6px' }, [nameInput, amountInput, delBtn]));
    });
  }

  typeSelect.addEventListener('change', () => {
    stashFuelInputs();
    fuelType = typeSelect.value;
    loadFuelInputs();
    loadEquipForType();
    renderEquipRows();
    importApprovedEquipment(true);
  });

  function buildReadonlyBox() {
    readonlyBox.innerHTML = '';
    const rows = department === 'معدن'
      ? [
        ['نام معدن', record['نام_معدن']], ['نام دارنده / شرکت بهره‌بردار', record['نام_دارنده']],
        ['شماره و تاریخ پروانه', `${record['شماره_پروانه'] || ''} | ${record['تاریخ_پروانه'] || ''}`],
        ['شهرستان', county], ['میزان استخراج اسمی سالیانه', `${record['استخراج_سالیانه'] || ''} ${record['واحد'] || 'تن'}`],
      ]
      : [
        ['نام واحد صنعتی', record['نام_واحد']], ['گروه کالایی', record['گروه_کالایی']],
        ['شماره و تاریخ مجوز', `${record['شماره_مجوز'] || ''} | ${record['تاریخ_مجوز'] || ''}`],
        ['شهرستان', county], ['محصول و ظرفیت اسمی', `${record['نام_محصول'] || ''} — ${record['ظرفیت'] || ''} ${record['واحد_سنجش'] || ''}`],
      ];
    rows.forEach(([label, val]) => readonlyBox.append(el('div', {}, `${label}: ${esc(val || '—')}`)));
  }

  function buildBodyText() {
    const unit = FUEL_UNITS[fuelType];
    const rep = repInput.value.trim();
    const amountReceived = amountReceivedInput.value.trim();
    const remaining = remainingInput.value.trim();
    const amountRequested = amountRequestedInput.value.trim();
    const monthReceived = `${JALALI_MONTHS[+received.monthSel.value - 1]} ${received.yearSel.value}`;
    const monthRequested = `${JALALI_MONTHS[+requested.monthSel.value - 1]} ${requested.yearSel.value}`;
    return department === 'معدن'
      ? `احتراماً اینجانب ${esc(rep)} نماینده ${esc(record['نام_دارنده'] || '')} بهره بردار معدن ${esc(record['نام_معدن'] || '')} با شماره پروانه بهره برداری ${esc(record['شماره_پروانه'] || '')} مورخ ${esc(record['تاریخ_پروانه'] || '')} بدینوسیله اعلام میدارم که مقدار ${esc(amountReceived)} ${unit} ${fuelType} مربوط به ${esc(monthReceived)} را دریافت و در محل فوق الذکر به مصرف رسیده است و در ضمن باقیمانده سوخت به مقدار ${esc(remaining)} ${unit} بوده و بر اساس آمار ارائه شده در جدول ذیل، ماشین‌آلات/تجهیزات موجود در کارگاه و برنامه آتی تولید معدن مذکور متقاضی دریافت مقدار ${esc(amountRequested)} ${unit} ${fuelType} برای ${esc(monthRequested)} می‌باشم. خواهشمند است در این خصوص اقدام لازم را مبذول فرمائید.`
      : `احتراماً اینجانب ${esc(rep)} نماینده واحد صنعتی ${esc(record['نام_واحد'] || '')} با شماره مجوز ${esc(record['شماره_مجوز'] || '')} مورخ ${esc(record['تاریخ_مجوز'] || '')} بدینوسیله اعلام میدارم که مقدار ${esc(amountReceived)} ${unit} ${fuelType} مربوط به ${esc(monthReceived)} را دریافت و در محل فوق الذکر به مصرف رسانده‌ام و در ضمن باقیمانده سوخت به مقدار ${esc(remaining)} ${unit} بوده و بر اساس آمار ارائه شده در جدول ذیل، ماشین‌آلات/تجهیزات موجود در کارگاه و برنامه آتی تولید واحد مذکور متقاضی دریافت مقدار ${esc(amountRequested)} ${unit} ${fuelType} برای ${esc(monthRequested)} می‌باشم. خواهشمند است در این خصوص اقدام لازم را مبذول فرمائید.`;
  }

  function buildPrintHTML() {
    const cols = FUEL_EQUIP_COLS[fuelType];
    const waste = wasteInput.value.trim();
    const oreEntries = cleanOreRows();
    const rows = equipRows.filter((r) => Object.values(r).some((v) => v));
    const tableHead = `<tr><th>ردیف</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr>`;
    const tableRows = rows.map((r, i) => `<tr><td>${i + 1}</td>${cols.map(([k]) => `<td>${esc(r[k] || '')}</td>`).join('')}</tr>`).join('');
    let followup;
    if (department === 'معدن') {
      // چند ماده معدنی: «۱۰۰ تن سنگ آهن، ۴۰ تن مس و ۵۰ تن باطله‌برداری»
      const oreParts = oreEntries.length
        ? oreEntries.map((r) => `${esc(r['مقدار'])} تن ${esc(r['نام'] || (oreEntries.length === 1 ? 'ماده معدنی اصلی' : 'ماده معدنی'))}`)
        : [' تن ماده معدنی اصلی'];
      const productionText = joinFa([...oreParts, `${esc(waste)} تن باطله‌برداری`]);
      followup = `ضمناً در ارتباط با آمار تولید/استخراج دوره قبل به اطلاع می‌رساند میزان استخراج اسمی این واحد ${esc(record['استخراج_سالیانه'] || '')} ${record['واحد'] || 'تن'} سالیانه و در این دوره ${productionText} می‌باشد و مورد تایید این سازمان می‌باشد. ضمناً لیست ماشین‌آلات/تجهیزات بشرح زیر می‌باشد:`;
    } else {
      const unitW = record['واحد_سنجش'] || '';
      const prodParts = oreEntries.length
        ? oreEntries.map((r) => `${esc(r['مقدار'])} ${unitW} ${esc(r['نام'])}`.replace(/\s+/g, ' ').trim())
        : [unitW];
      followup = `ضمناً در ارتباط با آمار تولید دوره قبل به اطلاع می‌رساند ظرفیت اسمی این واحد ${esc(record['ظرفیت'] || '')} ${unitW} ${esc(record['نام_محصول'] || '')} سالیانه و در این دوره ${joinFa(prodParts)} تولید و ${esc(waste)} ${unitW} ضایعات/دورریز داشته است و مورد تایید این سازمان می‌باشد. ضمناً لیست ماشین‌آلات/تجهیزات بشرح زیر می‌باشد:`;
    }
    return `<div class="pf-title">بسمه تعالی</div>`
      + `<div class="pf-title pf-underline">فرم اعلام وصول سوخت و تایید میزان تولید</div>`
      + `<div class="pf-body" style="margin-top:14px"><div>رئیس محترم اداره صنعت، معدن و تجارت شهرستان ${esc(county)}</div><div>با سلام /</div>`
      + `<div style="margin-top:8px">${buildBodyText()}</div></div>`
      + `<div class="pf-sign-row"><div>مهر و امضاء مصرف کننده :</div><div>تاریخ :</div></div><div class="pf-divider"></div>`
      + `<div class="pf-body"><div style="font-weight:700">بخش مربوط به تایید سازمان متولی</div>`
      + `<div style="margin-top:6px">رئیس محترم شرکت ملی پخش فرآورده‌های نفتی ناحیه ${esc(county)}.......... مقدار سوخت اظهاریه فوق مطابق سامانه سوخت تجارت آسان مورد تایید می‌باشد.</div>`
      + `<div style="margin-top:8px">${followup}</div></div>`
      + `<table class="pf-table"><thead>${tableHead}</thead><tbody>${tableRows}</tbody></table>`
      + `<div class="pf-sign-row"><div>مهر و امضاء تایید کننده :</div><div>تاریخ : ${esc(reqDateInput.value.trim())}</div></div>`;
  }

  function draw() {
    body.innerHTML = '';
    buildReadonlyBox();
    renderEquipRows();
    renderOreRows();
    const importBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)', onclick: () => importApprovedEquipment(false) }, '📥 وارد کردن ماشین‌آلات تایید‌شده مسئول فنی');
    const addRowBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => { equipRows.push({}); renderEquipRows(); } }, '➕ افزودن ردیف');
    const addOreBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => { oreRows.push({}); renderOreRows(); } }, department === 'معدن' ? '➕ افزودن ماده معدنی' : '➕ افزودن محصول');
    const saveDefaultBtn = el('button', { class: 'btn-sm', style: 'background:var(--amber-100);color:var(--amber-700)', onclick: async () => {
      try {
        const key = equipKeyForType(fuelType);
        const rows = equipRows.filter((r) => Object.values(r).some((v) => v)).map((r) => ({
          نام: r['نام'] || '', مدل: r['مدل'] || '', نوع: r['نوع'] || r['توضیحات'] || '', تعداد: r['تعداد'] || '',
        }));
        const defaults = collectDefaults();
        const updated = { ...record, [key]: rows, [FUEL_DEFAULTS_KEY]: defaults };
        await updateDeptRecord(department, rowId, updated);
        Object.assign(record, { [key]: rows, [FUEL_DEFAULTS_KEY]: defaults });
        lastSavedJson = JSON.stringify(defaults);
        showToast('✅ تجهیزات و مشخصات پیش‌فرض این معدن ذخیره شد');
      } catch (err) { showToast(`❌ خطا: ${err.message}`); }
    } }, '💾 ذخیره به‌عنوان پیش‌فرض معدن');
    const previewBtn = el('button', { class: 'btn btn-primary', style: 'flex:1', onclick: () => {
      // ذخیره‌ی خودکار پیش‌فرض‌ها در پس‌زمینه؛ پیش‌نمایش منتظر نتیجه نمی‌ماند
      persistRequestDefaults()
        .then((wrote) => { if (wrote) showToast('✅ مشخصات نماینده، مقادیر و مواد این معدن به‌عنوان پیش‌فرض ذخیره شد'); })
        .catch((err) => showToast(`⚠️ پیش‌فرض‌ها ذخیره نشد: ${err.message}`));
      openFuelPrintPreview({
        html: buildPrintHTML(), equipRows, photosForRow, close,
      });
    } }, '👁️ پیش‌نمایش و چاپ');

    body.append(
      el('label', {}, 'نوع سوخت'), typeSelect, readonlyBox,
      el('div', { class: 'fp-section-title', style: 'font-weight:700;margin:10px 0 4px' }, 'مشخصات نماینده و درخواست'),
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, [
        el('div', {}, [el('label', {}, 'نام نماینده'), repInput]),
        el('div', {}, [el('label', {}, 'تاریخ درخواست'), reqDateInput]),
        el('div', {}, [el('label', {}, 'ماه دریافت سوخت (شمسی)'), received.row]),
        el('div', {}, [el('label', {}, 'مقدار دریافتی'), amountReceivedInput]),
        el('div', {}, [el('label', {}, 'باقیمانده سوخت'), remainingInput]),
        el('div', {}, [el('label', {}, 'ماه درخواستی (شمسی)'), requested.row]),
        el('div', {}, [el('label', {}, 'مقدار درخواستی'), amountRequestedInput]),
        el('div', {}, [wasteLbl, wasteInput]),
      ]),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:4px' }, 'نام نماینده، مقدار دریافتی، باقیمانده، باطله‌برداری و مواد زیر بعد از «پیش‌نمایش» برای دفعات بعد ذخیره می‌شوند.'),
      el('div', { style: 'font-weight:700;margin:12px 0 4px' }, department === 'معدن' ? 'مواد معدنی این دوره (برای چند نوع ماده، ردیف اضافه کنید)' : 'محصولات تولیدی این دوره (برای چند محصول، ردیف اضافه کنید)'),
      oreRowsBox,
      el('div', { style: 'margin:6px 0 4px' }, [addOreBtn]),
      el('div', { style: 'font-weight:700;margin:12px 0 4px' }, 'لیست ماشین‌آلات / تجهیزات'),
      equipRowsBox,
      el('div', { style: 'display:flex;gap:6px;margin:6px 0 12px;flex-wrap:wrap' }, [addRowBtn, importBtn]),
      el('div', { style: 'display:flex;gap:6px' }, [previewBtn, saveDefaultBtn]),
    );
  }

  loadEquipForType();
  loadFuelInputs();
  lastSavedJson = JSON.stringify(collectDefaults()); // مبنای مقایسه؛ اگر کاربر چیزی عوض نکند، نوشتن اضافه‌ای انجام نمی‌شود
  fetchApprovedEquipment().then(() => importApprovedEquipment(true));
  draw();
}

function openFuelPrintPreview({
  html, equipRows, photosForRow, close: closeParent,
}) {
  const { body, close } = openModal({ title: '👁️ پیش‌نمایش قبل از چاپ', width: '700px' });
  const printArea = el('div', { class: 'fuel-print-area', style: 'border:1px solid var(--stone-200);border-radius:8px;padding:14px;background:#fff' });
  printArea.innerHTML = html;
  const rowsWithPhotos = equipRows.filter((r) => r._deviceKey);
  const photoList = rowsWithPhotos.length
    ? el('div', { style: 'margin-top:10px' }, [
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:6px' }, 'عکس‌های تایید‌شده‌ی هر دستگاه — فقط برای کنترل شما، در برگه‌ی چاپی نمی‌آید:'),
      ...rowsWithPhotos.map((r) => {
        const { overview, serial } = photosForRow(r);
        return el('div', { style: 'display:flex;justify-content:space-between;align-items:center;background:var(--stone-50);border-radius:6px;padding:6px 10px;margin-bottom:6px' }, [
          el('span', { style: 'font-size:var(--text-xs)' }, r['نام'] || 'دستگاه بدون نام'),
          el('button', { class: 'btn-sm', style: 'background:var(--patina-50);color:var(--patina-700)', onclick: () => openPhotoViewer(r['نام'], overview, serial) }, '📷 نمای دور / سریال'),
        ]);
      }),
    ])
    : null;
  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'عکس ماشین‌آلات فقط برای کنترل شما اینجا نمایش داده می‌شود و در برگه‌ی چاپی نمی‌آید.'),
    printArea,
    ...(photoList ? [photoList] : []),
    el('div', { style: 'display:flex;gap:6px;margin-top:14px' }, [
      el('button', { class: 'btn btn-primary', style: 'flex:1', onclick: () => window.print() }, '🖨️ چاپ نهایی'),
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, '✏️ بازگشت و ویرایش'),
    ]),
  );
}

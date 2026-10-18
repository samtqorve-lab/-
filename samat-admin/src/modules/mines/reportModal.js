import { el, esc, showToast, openModal } from '../../lib/dom.js';
import { fetchDeptRecords, updateDeptRecord } from '../../lib/records.js';
import { sb } from '../../lib/supabase.js';
import { JALALI_MONTHS, todayJalali, formatJalali } from '../../lib/jalaliCalendar.js';
import { attachJalaliDatePicker } from '../../lib/jalaliDatePicker.js';
import {
  createRichEditor, sanitizeHtml, htmlToText, textToHtml,
} from '../../lib/richText.js';

/**
 * «گزارش‌نویسی» هر معدن/واحد — بازسازی بخش «بازدیدها و گزارش‌های تولید» نسخه‌ی تک‌HTML قبل از «تجزیه»
 * (کامیت e5214d39) که در ساختار ماژولار جدید جا افتاده بود، این بار با ویرایشگر متن غنی.
 *
 * مدل داده عمداً با نسخه‌ی قدیمی سازگار است: گزارش‌ها داخل خود رکورد، زیر کلید «بازدیدها» (آرایه)،
 * و عکس‌ها در باکت Supabase «visit-photos» — پس گزارش‌های قبلی (که الان هم در دیتابیس هستند) همین‌جا
 * دیده می‌شوند. فیلد narrative همچنان متن ساده است (سازگاری)؛ متن غنی در narrativeHtml ذخیره می‌شود.
 */

const FONT_TEXT = "'B Nazanin','BNazanin','Nazanin','Vazirmatn',serif";
const REPORT_KEY = 'بازدیدها';
const PHOTO_BUCKET = 'visit-photos';
const TYPE_LABELS = {
  بازدید: ['📷', 'گزارش بازدید میدانی'],
  تولید_ماهانه: ['📊', 'گزارش تولید ماهانه (مسئول فنی)'],
  گزارش_آزاد: ['📝', 'گزارش آزاد'],
};

/* ───────────── قالب چاپ / Word ───────────── */

const REPORT_CSS = `
.rr{font-family:${FONT_TEXT};font-size:15px;line-height:2;color:#000;direction:rtl;text-align:right}
.rr .vr-header{text-align:center;font-weight:700;line-height:1.8}
.rr .vr-hr{border-top:2px solid #000;margin:10px 0}
.rr .vr-to{font-weight:700;margin-bottom:4px}
.rr .vr-subject{font-weight:700;margin-bottom:10px}
.rr .vr-body{text-align:justify}
.rr .vr-body table{border-collapse:collapse;width:100%}
.rr .vr-body td,.rr .vr-body th{border:1px solid #666;padding:4px 8px}
.rr .vr-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
.rr .vr-table th,.rr .vr-table td{border:1px solid #666;padding:4px 6px;text-align:center}
.rr .vr-photos-grid{margin-top:14px}
.rr .vr-photo-item{display:inline-block;width:47%;margin:4px;text-align:center;vertical-align:top;page-break-inside:avoid}
.rr .vr-photo-item img{max-width:100%;max-height:260px;border:1px solid #999}
.rr .vr-photo-caption{font-size:12px}
.rr .vr-sign{width:100%;margin-top:24px;border-collapse:collapse}
.rr .vr-sign td{border:none;padding:0}
.rr .vr-footer{margin-top:26px;font-size:12px;color:#444;text-align:center;border-top:1px solid #ccc;padding-top:8px}
`;

function ensurePrintStyle() {
  if (document.getElementById('report-print-style')) return;
  const s = document.createElement('style');
  s.id = 'report-print-style';
  s.textContent = `.report-print-root{display:none}
@media print{
  body > *:not(.report-print-root){display:none !important}
  body > .report-print-root{display:block !important;position:static;background:#fff;color:#000}
  @page{size:A4;margin:14mm}
}
${REPORT_CSS}`;
  document.head.append(s);
}

function buildReportHTML(v) {
  const isProd = v.reportType === 'تولید_ماهانه';
  const isVisit = !v.reportType || v.reportType === 'بازدید';
  const narrative = v.narrativeHtml ? sanitizeHtml(v.narrativeHtml) : esc(v.narrative || '').replace(/\n/g, '<br>');
  const coords = Array.isArray(v.coords) ? v.coords : [];
  const coordTable = isVisit && coords.length
    ? `<table class="vr-table"><thead><tr><th>ردیف</th><th>طول (X)</th><th>عرض (Y)</th><th>زون</th></tr></thead><tbody>${
      coords.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.x)}</td><td>${esc(c.y)}</td><td>${esc(c.zone)}</td></tr>`).join('')
    }</tbody></table>` : '';
  const photos = (v.photos || []).filter((p) => p && /^https?:\/\//i.test(p.url || ''));
  const photosHTML = photos.map((p, i) => `<div class="vr-photo-item"><img src="${esc(p.url)}"><div class="vr-photo-caption">تصویر شماره ${i + 1}${p.caption ? ` – ${esc(p.caption)}` : ''}</div></div>`).join('');
  const signRow = (l, r) => `<table class="vr-sign"><tr><td style="text-align:right">${l}</td><td style="text-align:left">${r}</td></tr></table>`;

  let bodyBlock;
  if (isProd) {
    bodyBlock = `<div class="vr-body">احتراماً به استحضار می‌رساند گزارش تولید ماهانه واحد فوق برای ${esc(v.prodMonth)} به شرح ذیل توسط مسئول فنی تهیه و تقدیم می‌گردد:<br>مقدار تولید این ماه: <b>${esc(v.prodAmount)} ${esc(v.prodUnit)}</b></div>`
      + (narrative ? `<div class="vr-body" style="margin-top:6px">توضیحات:${narrative}</div>` : '')
      + signRow(`نام و امضای مسئول فنی: ${esc(v.prodOfficer)}`, '');
  } else {
    bodyBlock = `<div class="vr-body">${narrative}</div>${coordTable}`;
  }

  return `<div class="rr">`
    + `<div class="vr-header"><div>جمهوری اسلامی ایران</div><div>وزارت صنعت، معدن و تجارت</div><div>سازمان صنعت، معدن و تجارت استان کردستان</div><div>اداره صنعت، معدن و تجارت شهرستان قروه</div></div>`
    + `<div class="vr-hr"></div>`
    + `<div class="vr-to">ریاست محترم اداره صنعت، معدن و تجارت قروه</div>`
    + `<div class="vr-subject">موضوع: ${esc(v.subject)}</div>`
    + bodyBlock
    + (photosHTML ? `<div class="vr-photos-grid">${photosHTML}</div>` : '')
    + signRow('تهیه‌کننده گزارش:', `تاریخ: ${esc(v.date)}`)
    + `<div class="vr-footer">آدرس: کردستان- شهرستان قروه- خیابان شهید چمران<br>تلفن: 35225750- 35224945 دورنگار: 35226200</div>`
    + `</div>`;
}

async function printReport(v) {
  ensurePrintStyle();
  document.querySelectorAll('.report-print-root').forEach((n) => n.remove());
  const root = el('div', { class: 'report-print-root' });
  root.innerHTML = buildReportHTML(v);
  document.body.append(root);
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => !i.complete);
  if (imgs.length) {
    await Promise.race([
      Promise.all(imgs.map((i) => new Promise((r) => { i.onload = r; i.onerror = r; }))),
      new Promise((r) => { setTimeout(r, 6000); }),
    ]);
  }
  const cleanup = () => { root.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

function downloadWord(v, mineName) {
  const full = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
    + `<head><meta charset="utf-8"><title>${esc(v.subject)}</title><style>${REPORT_CSS}body{direction:rtl}</style></head><body dir="rtl">${buildReportHTML(v)}</body></html>`;
  const blob = new Blob(['\ufeff', full], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `گزارش_${(TYPE_LABELS[v.reportType] || TYPE_LABELS.بازدید)[1].split(' ')[1] || 'بازدید'}_${mineName || 'معدن'}_${(v.date || '').replace(/\//g, '-')}.doc`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ───────────── کمکی‌ها ───────────── */

/** تصویر را قبل از آپلود کوچک و فشرده می‌کند (اینترنت ضعیف + تبدیل HEIC آیفون به JPEG) */
function compressImageFile(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        if (w >= h) { h = Math.round((h * maxDim) / w); w = maxDim; } else { w = Math.round((w * maxDim) / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        resolve(blob ? new File([blob], `${(file.name.replace(/\.[^.]+$/, '') || 'photo')}.jpg`, { type: 'image/jpeg' }) : file);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

const faDigitsToEn = (s) => String(s || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

function parseMonthLabel(label) {
  const txt = faDigitsToEn(label);
  const mi = JALALI_MONTHS.findIndex((m) => txt.includes(m));
  const y = (txt.match(/\d{4}/) || [''])[0];
  return { month: mi >= 0 ? JALALI_MONTHS[mi] : '', year: y };
}

/* ───────────── پنجره‌ی فهرست گزارش‌ها ───────────── */

export function openReportsModal(record, department, rowId, ctx) {
  const role = ctx && ctx.myRole;
  const canWrite = ['admin', 'superadmin', 'inspector'].includes(role);
  const isAdminRole = ['admin', 'superadmin'].includes(role);
  const mineName = record['نام_معدن'] || record['نام_واحد'] || '';
  const kindWord = department === 'معدن' ? 'معدن ' : 'واحد ';

  const { body } = openModal({ title: `📝 گزارش‌نویسی — ${mineName}`, width: '700px' });
  const listBox = el('div');

  const getReports = () => (Array.isArray(record[REPORT_KEY]) ? record[REPORT_KEY] : []);

  /** همیشه روی آخرین نسخه‌ی سرور تغییر می‌دهد (نه نسخه‌ی احتمالاً کهنه‌ی صفحه) تا ویرایش هم‌زمان فیلدهای دیگر رکورد پاک نشود */
  async function mutateReports(fn) {
    const list = await fetchDeptRecords(department, { force: true });
    const fresh = list.find((r) => r._rowId === rowId) || record;
    const next = fn(Array.isArray(fresh[REPORT_KEY]) ? [...fresh[REPORT_KEY]] : []);
    const updated = { ...fresh, [REPORT_KEY]: next };
    delete updated._rowId;
    await updateDeptRecord(department, rowId, updated);
    record[REPORT_KEY] = next;
    return next;
  }

  function renderList() {
    listBox.innerHTML = '';
    const reports = getReports();
    if (!reports.length) {
      listBox.append(el('div', { style: 'padding:18px;text-align:center;color:var(--stone-600);font-size:var(--text-sm)' }, 'هنوز گزارشی ثبت نشده'));
    }
    [...reports].reverse().forEach((v) => {
      const [icon] = TYPE_LABELS[v.reportType] || TYPE_LABELS.بازدید;
      const actions = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
        canWrite ? el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)', onclick: () => openEditor(v) }, '✏️ ویرایش') : null,
        el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => printReport(v) }, '🖨️ چاپ'),
        el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => downloadWord(v, mineName) }, '📝 Word'),
        isAdminRole ? el('button', {
          class: 'btn-sm',
          style: 'background:var(--rust-100);color:var(--rust-700)',
          onclick: async () => {
            if (!window.confirm('این گزارش حذف شود؟')) return;
            try {
              await mutateReports((list) => list.filter((x) => x.id !== v.id));
              showToast('✅ گزارش حذف شد');
              renderList();
            } catch (err) { showToast(`⚠️ خطا در حذف: ${err.message}`); }
          },
        }, '🗑️') : null,
      ]);
      listBox.append(el('div', {
        style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--stone-200);border-radius:8px;margin-bottom:6px',
      }, [
        el('div', { style: 'min-width:0;flex:1' }, [
          el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, `${icon} ${v.date || ''}${v.author ? ` — ${v.author}` : ''}`),
          el('div', { style: 'font-weight:600' }, v.subject || 'گزارش'),
        ]),
        actions,
      ]));
    });
  }

  body.append(
    canWrite
      ? el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-bottom:12px', onclick: () => openEditor(null) }, '➕ نوشتن گزارش جدید')
      : el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'فقط ادمین و بازرس می‌توانند گزارش بنویسند؛ شما می‌توانید گزارش‌ها را ببینید و چاپ کنید.'),
    listBox,
  );
  renderList();

  /* ───────────── ویرایشگر گزارش ───────────── */

  function openEditor(existing) {
    const draftKey = `samat.reportDraft.${department}.${rowId}.${existing ? existing.id : 'new'}`;
    const today = todayJalali();
    const todayStr = formatJalali(today.jy, today.jm, today.jd);
    const defaultSubject = (type) => {
      if (type === 'تولید_ماهانه') return `گزارش تولید ماهانه ${kindWord}${mineName}`;
      if (type === 'گزارش_آزاد') return `گزارش ${kindWord}${mineName}`;
      return `گزارش بازدید از محل ${kindWord}${mineName} واقع در ...`;
    };

    const base = existing ? { ...existing } : {
      reportType: 'بازدید',
      subject: defaultSubject('بازدید'),
      site: '',
      date: todayStr,
      distance: '',
      license: record['شماره_پروانه'] || record['شماره_مجوز'] || '',
      licenseDate: record['تاریخ_پروانه'] || record['تاریخ_مجوز'] || '',
      company: record['نام_دارنده'] || '',
      tonnage: '',
      prodMonth: '',
      prodAmount: '',
      prodUnit: 'تن',
      prodOfficer: record['نام_مسئول_فنی'] || '',
      coords: [{ zone: '39S', y: '', x: '' }],
    };
    let initialHtml = existing ? (existing.narrativeHtml || textToHtml(existing.narrative)) : '';

    // پیش‌نویس ذخیره‌نشده‌ی قبلی (مثلاً بسته‌شدن ناگهانی مرورگر یا قطع اینترنت) را پیشنهاد بازیابی بده
    try {
      const raw = localStorage.getItem(draftKey);
      const draft = raw ? JSON.parse(raw) : null;
      if (draft && draft.fields) {
        if (window.confirm('یک پیش‌نویس ذخیره‌نشده از همین گزارش روی این دستگاه هست. بازیابی شود؟')) {
          Object.assign(base, draft.fields);
          initialHtml = draft.html || '';
        } else {
          localStorage.removeItem(draftKey);
        }
      }
    } catch { /* localStorage در دسترس نیست — بدون پیش‌نویس ادامه می‌دهیم */ }

    let dirty = false;
    const markDirty = () => { dirty = true; };
    const mk = (tag, attrs = {}) => {
      const n = el(tag, attrs);
      n.addEventListener('input', markDirty);
      n.addEventListener('change', markDirty);
      return n;
    };
    const field = (label, node) => el('div', {}, [el('label', {}, label), node]);

    const f = {
      type: mk('select'),
      subject: mk('input', { type: 'text' }),
      date: mk('input', { type: 'text', placeholder: 'برای انتخاب تاریخ کلیک کنید', autocomplete: 'off' }),
      license: mk('input', { type: 'text' }),
      licenseDate: mk('input', { type: 'text', placeholder: 'برای انتخاب تاریخ کلیک کنید', autocomplete: 'off' }),
      company: mk('input', { type: 'text' }),
      site: mk('input', { type: 'text', placeholder: 'مثال: سایت خردایش و دانه‌بندی سورچه' }),
      distance: mk('input', { type: 'text', placeholder: '40 کیلومتری جنوب شرقی' }),
      tonnage: mk('input', { type: 'text', placeholder: '100.000 تن' }),
      prodAmount: mk('input', { type: 'text', placeholder: 'مقدار عددی' }),
      prodUnit: mk('input', { type: 'text', placeholder: 'تن' }),
      prodOfficer: mk('input', { type: 'text' }),
    };
    Object.entries(TYPE_LABELS).forEach(([k, [ic, lb]]) => f.type.append(el('option', { value: k }, `${ic} ${lb}`)));
    f.type.value = TYPE_LABELS[base.reportType] ? base.reportType : 'بازدید';
    f.subject.value = base.subject || '';
    f.date.value = base.date || '';
    f.license.value = base.license || '';
    f.licenseDate.value = base.licenseDate || '';
    f.company.value = base.company || '';
    f.site.value = base.site || '';
    f.distance.value = base.distance || '';
    f.tonnage.value = base.tonnage || '';
    f.prodAmount.value = base.prodAmount || '';
    f.prodUnit.value = base.prodUnit || 'تن';
    f.prodOfficer.value = base.prodOfficer || '';
    attachJalaliDatePicker(f.date);
    attachJalaliDatePicker(f.licenseDate);

    const monthSel = mk('select', { style: 'flex:2' });
    JALALI_MONTHS.forEach((m) => monthSel.append(el('option', { value: m }, m)));
    const yearSel = mk('select', { style: 'flex:1' });
    for (let y = today.jy - 2; y <= today.jy + 1; y += 1) yearSel.append(el('option', { value: String(y) }, String(y)));
    const pm = parseMonthLabel(base.prodMonth);
    monthSel.value = pm.month || JALALI_MONTHS[today.jm - 1];
    yearSel.value = pm.year || String(today.jy);

    let lastAutoSubject = f.subject.value;

    /* بخش‌های مخصوص هر نوع گزارش */
    const visitOnly = el('div', {}, [
      field('محل/سایت بازدید', f.site),
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px' }, [
        field('فاصله از مرکز شهر (اختیاری)', f.distance),
        field('تناژ تخمینی (اختیاری)', f.tonnage),
      ]),
    ]);
    const prodOnly = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:10px' }, [
      field('ماه گزارش تولید (شمسی)', el('div', { style: 'display:flex;gap:4px' }, [monthSel, yearSel])),
      field('مقدار تولید این ماه', f.prodAmount),
      field('واحد سنجش', f.prodUnit),
      field('نام و امضای مسئول فنی', f.prodOfficer),
    ]);

    /* مختصات */
    const coords = (Array.isArray(base.coords) && base.coords.length ? base.coords : [{ zone: '39S', y: '', x: '' }]).map((c) => ({ ...c }));
    const coordBox = el('div');
    function renderCoords() {
      coordBox.innerHTML = '';
      coords.forEach((r, i) => {
        const mkIn = (ph, key) => {
          const inp = el('input', { placeholder: ph, value: r[key] || '' });
          inp.addEventListener('input', () => { r[key] = inp.value; markDirty(); });
          return inp;
        };
        coordBox.append(el('div', { style: 'display:grid;grid-template-columns:1fr 1.5fr 1.5fr auto;gap:6px;margin-bottom:6px' }, [
          mkIn('زون (مثال 39S)', 'zone'), mkIn('Y (عرض)', 'y'), mkIn('X (طول)', 'x'),
          el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => { coords.splice(i, 1); if (!coords.length) coords.push({ zone: '39S', y: '', x: '' }); markDirty(); renderCoords(); } }, '🗑'),
        ]));
      });
    }
    renderCoords();
    const coordsWrap = el('div', { style: 'margin-top:14px' }, [
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'جدول مختصات (UTM)'),
      coordBox,
      el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => { coords.push({ zone: '39S', y: '', x: '' }); markDirty(); renderCoords(); } }, '➕ افزودن ردیف مختصات'),
    ]);

    /* ویرایشگر متن */
    const editor = createRichEditor({ html: initialHtml, onChange: markDirty, minHeight: 300, placeholder: 'شرح گزارش را اینجا بنویسید…' });

    function fillTemplate() {
      const subj = f.subject.value.trim();
      const site = f.site.value.trim();
      const date = f.date.value.trim();
      const coordsTxt = coords.filter((r) => r.x || r.y).map((r) => `زون ${r.zone} - X: ${r.x} - Y: ${r.y}`).join(' / ');
      const lic = f.license.value.trim();
      const licDate = f.licenseDate.value.trim();
      const distance = f.distance.value.trim();
      const tonnage = f.tonnage.value.trim();
      const p1 = `احتراماً پیرو مأموریت محوله در خصوص بازدید از محل ${kindWord}${mineName}${site ? ` واقع در ${site}` : ''} به منظور بررسی وضعیت محل مذکور، به استحضار می‌رساند ${kindWord}مذکور دارای پروانه بهره‌برداری با شماره ${lic} مورخ ${licDate} که در مورخ ${date} از محل مذکور بازدید به عمل آمد. گزارش بازدید به شرح ذیل تقدیم می‌گردد.`;
      const p3 = `${kindWord}${mineName} دارای پروانه بهره‌برداری با شماره ${lic} مورخ ${licDate} تحت بهره‌برداری ${f.company.value.trim()}${distance ? ` در فاصله حدوداً ${distance} مرکز شهر قروه واقع شده است` : ''}. طی مأموریت محول‌شده به منظور بررسی محل مذکور بازدید به عمل آمد${coordsTxt ? ` که با مختصات ${coordsTxt} ثبت گردید` : ''}${tonnage ? `. میزان تخمینی ${tonnage} برآورد و رؤیت شد` : ''}.`;
      if (!editor.isEmpty() && !window.confirm('متن فعلی با پیش‌نویس خودکار جایگزین شود؟')) return;
      editor.setHTML(`<p>${esc(p1)}</p><p><b>شرح گزارش:</b></p><p>${esc(p3)}</p>`);
      if (!subj) f.subject.value = defaultSubject(f.type.value);
    }
    const templateBtn = el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);margin-top:8px', onclick: fillTemplate }, '✍️ پر کردن خودکار پیش‌نویس شرح گزارش (بازدید)');

    function applyType() {
      const t = f.type.value;
      visitOnly.style.display = t === 'بازدید' ? 'block' : 'none';
      coordsWrap.style.display = t === 'بازدید' ? 'block' : 'none';
      prodOnly.style.display = t === 'تولید_ماهانه' ? 'grid' : 'none';
      templateBtn.style.display = t === 'بازدید' ? 'inline-flex' : 'none';
      if (!f.subject.value.trim() || f.subject.value === lastAutoSubject) {
        f.subject.value = defaultSubject(t);
        lastAutoSubject = f.subject.value;
      }
    }
    f.type.addEventListener('change', applyType);

    /* عکس‌ها */
    const keepPhotos = Array.isArray(base.photos) ? base.photos.map((p) => ({ ...p })) : [];
    const newPhotos = [];
    const photoBox = el('div', { style: 'margin-top:8px' });
    function photoRow(url, caption, onCaption, onDelete) {
      const cap = el('input', { type: 'text', placeholder: 'توضیح تصویر (مثال: نمای محل بازدید)', value: caption || '', style: 'flex:1' });
      cap.addEventListener('input', () => onCaption(cap.value));
      return el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' }, [
        el('img', { src: url, style: 'width:64px;height:64px;object-fit:cover;border-radius:6px' }),
        cap,
        el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: onDelete }, '🗑'),
      ]);
    }
    function renderPhotos() {
      photoBox.innerHTML = '';
      keepPhotos.forEach((p, i) => photoBox.append(photoRow(p.url, p.caption, (v) => { p.caption = v; markDirty(); }, () => { keepPhotos.splice(i, 1); markDirty(); renderPhotos(); })));
      newPhotos.forEach((p, i) => photoBox.append(photoRow(p.previewUrl, p.caption, (v) => { p.caption = v; markDirty(); }, () => { URL.revokeObjectURL(p.previewUrl); newPhotos.splice(i, 1); markDirty(); renderPhotos(); })));
    }
    renderPhotos();
    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: '' });
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      for (const file of files) {
        const compressed = await compressImageFile(file);
        newPhotos.push({ file: compressed, previewUrl: URL.createObjectURL(compressed), caption: '' });
        markDirty();
        renderPhotos();
      }
    });

    /* جمع‌آوری مقادیر فرم */
    const collect = () => {
      const t = f.type.value;
      return {
        reportType: t,
        subject: f.subject.value.trim(),
        site: f.site.value.trim(),
        date: f.date.value.trim(),
        distance: f.distance.value.trim(),
        license: f.license.value.trim(),
        licenseDate: f.licenseDate.value.trim(),
        company: f.company.value.trim(),
        tonnage: f.tonnage.value.trim(),
        prodMonth: t === 'تولید_ماهانه' ? `${monthSel.value} ${yearSel.value}` : '',
        prodAmount: f.prodAmount.value.trim(),
        prodUnit: f.prodUnit.value.trim(),
        prodOfficer: f.prodOfficer.value.trim(),
        coords: coords.filter((r) => r.x || r.y),
      };
    };

    /* پوسته‌ی پنجره — عمداً کلیک روی پس‌زمینه آن را نمی‌بندد تا متن نوشته‌شده با یک کلیک اشتباه از بین نرود */
    const overlay = el('div', { style: 'position:fixed;inset:0;background:rgba(91,112,131,.5);display:flex;align-items:flex-start;justify-content:center;z-index:1400;padding:16px;overflow-y:auto' });
    const card = el('div', { style: 'width:100%;max-width:900px;background:var(--surface);color:var(--ink-900);border-radius:var(--radius-md);padding:var(--space-5);box-shadow:var(--shadow-lg)' });
    overlay.append(card);

    const draftTimer = setInterval(() => {
      if (!dirty) return;
      try { localStorage.setItem(draftKey, JSON.stringify({ fields: collect(), html: editor.getHTML(), ts: Date.now() })); } catch { /* حافظه‌ی مرورگر پر است */ }
    }, 4000);

    function closeEditor(force) {
      if (!force && dirty && !window.confirm('تغییرات ذخیره‌نشده از بین می‌رود. پنجره بسته شود؟')) return;
      clearInterval(draftTimer);
      // اگر ضبط صدا هنوز روشن است خاموشش کن (میکروفون نباید بعد از بستن پنجره روشن بماند)
      const mic = editor.root.querySelector('button[title^="تبدیل صوت"]');
      if (mic && mic.classList.contains('on')) mic.click();
      newPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      overlay.remove();
    }

    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', style: 'flex:1;justify-content:center' }, '💾 ذخیره گزارش');
    saveBtn.addEventListener('click', async () => {
      const v = collect();
      if (!v.subject) { showToast('⚠️ موضوع گزارش را وارد کنید'); return; }
      if (editor.isEmpty() && v.reportType !== 'تولید_ماهانه') { showToast('⚠️ شرح گزارش خالی است'); return; }
      if (!navigator.onLine) {
        try { localStorage.setItem(draftKey, JSON.stringify({ fields: v, html: editor.getHTML(), ts: Date.now() })); } catch { /* ignore */ }
        showToast('📡 اینترنت وصل نیست — متن به‌صورت پیش‌نویس روی این دستگاه نگه داشته شد؛ بعد از اتصال دوباره «ذخیره» را بزنید');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ در حال ذخیره...';
      try {
        const uploaded = [];
        const errors = [];
        for (let i = 0; i < newPhotos.length; i += 1) {
          const p = newPhotos[i];
          // مسیر فقط لاتین (بدون نام فارسی معدن) تا مشکل کدگذاری در Supabase Storage پیش نیاید
          const path = `visit/${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}.jpg`;
          let ok = false;
          let lastErr = null;
          for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
            try {
              const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, p.file, { contentType: p.file.type || 'image/jpeg', upsert: true });
              if (error) { lastErr = error; continue; }
              const { data } = sb.storage.from(PHOTO_BUCKET).getPublicUrl(path);
              uploaded.push({ url: data.publicUrl, caption: p.caption });
              ok = true;
            } catch (e) { lastErr = e; }
          }
          if (!ok) errors.push((lastErr && lastErr.message) || 'خطای ناشناخته');
        }
        if (errors.length) {
          showToast(`⚠️ ${errors.length} از ${newPhotos.length} تصویر آپلود نشد؛ بقیه‌ی گزارش ذخیره می‌شود`);
        }

        const { data: userData } = await sb.auth.getUser();
        const html = editor.getHTML();
        const report = {
          ...(existing || {}),
          ...v,
          id: existing ? existing.id : `v${Date.now()}`,
          narrativeHtml: html,
          narrative: htmlToText(html),
          photos: [...keepPhotos, ...uploaded],
          createdAt: existing ? existing.createdAt : new Date().toLocaleDateString('fa-IR'),
          author: existing && existing.author ? existing.author : ((userData && userData.user && userData.user.email) || ''),
          updatedAt: new Date().toISOString(),
        };
        await mutateReports((list) => {
          const i = list.findIndex((x) => x.id === report.id);
          if (i >= 0) list[i] = report; else list.push(report);
          return list;
        });
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
        dirty = false;
        closeEditor(true);
        showToast('✅ گزارش ذخیره شد');
        renderList();
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 ذخیره گزارش';
        showToast(`⚠️ خطا در ذخیره: ${err.message || err}`);
      }
    });

    card.append(
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px' }, [
        el('h3', {}, existing ? '✏️ ویرایش گزارش' : '📝 گزارش جدید'),
        el('button', { type: 'button', class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => closeEditor(false) }, '✖'),
      ]),
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px' }, [
        field('نوع گزارش', f.type),
        field('تاریخ گزارش', f.date),
      ]),
      el('div', { style: 'margin-top:10px' }, [field('موضوع گزارش', f.subject)]),
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:10px' }, [
        field('شماره پروانه/مجوز', f.license),
        field('تاریخ پروانه/مجوز', f.licenseDate),
        field('شرکت/شخص بهره‌بردار', f.company),
      ]),
      el('div', { style: 'margin-top:10px' }, [visitOnly]),
      prodOnly,
      el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'شرح گزارش'),
      editor.root,
      templateBtn,
      coordsWrap,
      el('div', { style: 'font-weight:700;margin:16px 0 4px' }, 'تصاویر / ضمائم'),
      fileInput,
      photoBox,
      el('div', { style: 'display:flex;gap:8px;margin-top:18px' }, [
        saveBtn,
        el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => closeEditor(false) }, 'انصراف'),
      ]),
    );
    document.body.append(overlay);
    applyType();
    // applyType ممکن است موضوع را عوض کرده باشد؛ تغییر خودکار نباید به‌عنوان «تغییر کاربر» حساب شود
    dirty = false;
    if (existing) f.subject.value = base.subject || f.subject.value;
  }
}

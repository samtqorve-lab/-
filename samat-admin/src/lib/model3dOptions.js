import { el } from './dom.js';
import {
  normalizeGeoInput, parseGeo, parseGcp, unmatchedNames, RECOMMENDED_GCP,
} from './model3dGeoref.js';

/**
 * بخش «نوع پردازش» در مودال مدل سه‌بعدی:
 *  - پیش‌نمایش سریع: فقط مدل برای نمایش (پیش‌فرض)
 *  - نقشه‌برداری دقیق: DSM ژئورفرنس‌شده برای محاسبه‌ی حجم، با یکی از سه روش موقعیت‌یابی:
 *      GPS معمولی عکس‌ها | موقعیت دقیق عکس‌ها (PPK/RTK، فایل geo.txt یا CSV) | نقاط کنترل زمینی (GCP)
 * @param {{ onChange?: () => void }} [opts]
 */
export function createOptionsPanel({ onChange = () => {} } = {}) {
  const st = { geoText: '', geoInfo: null, gcpText: '', gcpInfo: null };

  const mkSelect = (options, value) => {
    const s = el('select', {}, options.map(([v, label]) => el('option', { value: v }, label)));
    s.value = value;
    return s;
  };
  const note = (text) => el('div', { style: 'font-size:11px;color:var(--stone-600);margin-top:4px;line-height:1.8' }, text);
  const label = (text) => el('label', { style: 'margin-top:10px;display:block' }, text);

  const modeSel = mkSelect([
    ['preview', 'پیش‌نمایش سریع'],
    ['survey', 'نقشه‌برداری دقیق (برای حجم)'],
  ], 'preview');
  const georefSel = mkSelect([
    ['exif', 'GPS معمولی عکس‌ها'],
    ['geo', 'PPK/RTK — فایل موقعیت عکس‌ها'],
    ['gcp', 'GCP — نقاط کنترل زمینی'],
  ], 'exif');
  const demSel = mkSelect([['3', '۳ سانتی‌متر / پیکسل'], ['5', '۵ سانتی‌متر / پیکسل (پیشنهادی)'], ['10', '۱۰ سانتی‌متر / پیکسل'], ['20', '۲۰ سانتی‌متر / پیکسل']], '5');
  const qualitySel = mkSelect([['standard', 'استاندارد (سریع‌تر، حافظه‌ی کمتر)'], ['high', 'بالا (کندتر، ممکن است روی رانر رایگان حافظه کم بیاورد)']], 'standard');
  const orthoBox = el('input', { type: 'checkbox', style: 'width:auto;flex:none;margin:0' });
  const accInput = el('input', { type: 'number', value: '0.05', min: '0.001', max: '20', step: '0.01', style: 'width:100%' });

  const geoFile = el('input', { type: 'file', accept: '.txt,.csv,.tsv,.geo,text/plain,text/csv', style: 'display:none' });
  const geoBtn = el('button', { class: 'btn', type: 'button', style: 'width:100%' }, '📄 انتخاب فایل موقعیت عکس‌ها (geo.txt / CSV)');
  const geoStatus = el('div', { style: 'font-size:11px;margin-top:4px;line-height:1.8' });
  const gcpFile = el('input', { type: 'file', accept: '.txt,.csv,text/plain', style: 'display:none' });
  const gcpBtn = el('button', { class: 'btn', type: 'button', style: 'width:100%' }, '📄 انتخاب فایل نقاط کنترل (gcp_list.txt)');
  const gcpStatus = el('div', { style: 'font-size:11px;margin-top:4px;line-height:1.8' });
  const msgBox = el('div', { style: 'font-size:11px;margin-top:8px;line-height:1.9' });

  const geoBlock = el('div', { style: 'display:none' }, [
    geoBtn, geoFile, geoStatus,
    label('دقت موقعیت عکس‌ها (متر)'), accInput,
    note('برای PPK/RTK با تصحیح خوب معمولاً ۰٫۰۲ تا ۰٫۰۵ متر. خط اول فایل سیستم مختصات است (مثل EPSG:32638)؛ ردیف‌ها: «نام‌عکس x y z». فایل CSV با ستون‌های name, lat, lon, alt هم پذیرفته می‌شود (ارتفاع باید بیضوی باشد).'),
  ]);
  const gcpBlock = el('div', { style: 'display:none' }, [
    gcpBtn, gcpFile, gcpStatus,
    note(`هر نقطه باید روی چند عکس علامت‌گذاری شده باشد (مثلاً با GCPEditorPro). ردیف‌ها: «x y z im_x im_y نام‌عکس نام‌نقطه». حداقل ۳ و ترجیحاً ${RECOMMENDED_GCP}+ نقطه. با GCP عکس‌ها با اندازه‌ی اصلی آپلود می‌شوند (مختصات پیکسلی نقاط به اندازه‌ی اصلی مربوط است).`),
  ]);
  const surveyBlock = el('div', { style: 'display:none' }, [
    label('روش موقعیت‌یابی'), georefSel,
    geoBlock, gcpBlock,
    label('وضوح DSM'), demSel,
    label('کیفیت پردازش'), qualitySel,
    el('label', { style: 'margin-top:10px;display:flex;align-items:center;gap:8px;cursor:pointer;justify-content:flex-start' }, [orthoBox, el('span', {}, 'ساخت اورتوفوتو هم (زمان و حجم بیشتر)')]),
    note('پیش‌نمایش سریع فقط برای دیدن مدل است. نقشه‌برداری دقیق چند ساعت طول می‌کشد و DSM (GeoTIFF) و گزارش دقت هم می‌دهد؛ GPS معمولی چند متر خطا دارد، برای حجم از PPK/RTK یا GCP استفاده کنید.'),
  ]);

  const node = el('div', { style: 'margin-top:12px;border-top:1px solid var(--stone-200);padding-top:4px' }, [
    label('نوع پردازش'), modeSel, surveyBlock, msgBox,
  ]);

  const isSurvey = () => modeSel.value === 'survey';
  const georef = () => (isSurvey() ? georefSel.value : 'exif');

  function syncVisibility() {
    surveyBlock.style.display = isSurvey() ? 'block' : 'none';
    geoBlock.style.display = georef() === 'geo' ? 'block' : 'none';
    gcpBlock.style.display = georef() === 'gcp' ? 'block' : 'none';
  }

  const setStatus = (box, ok, text) => {
    box.textContent = text;
    box.style.color = ok ? 'var(--patina-700)' : 'var(--rust-700)';
  };

  async function loadGeo(file) {
    st.geoText = ''; st.geoInfo = null;
    if (!file) { geoStatus.textContent = ''; return; }
    try {
      const norm = normalizeGeoInput(await file.text());
      if (!norm.ok) { setStatus(geoStatus, false, `❌ ${norm.error}`); return; }
      const info = parseGeo(norm.text);
      if (!info.ok) { setStatus(geoStatus, false, `❌ ${info.error}`); return; }
      st.geoText = norm.text; st.geoInfo = info;
      setStatus(geoStatus, true, `✅ ${info.count} موقعیت — ${info.crs}${norm.converted ? ' (از CSV تبدیل شد)' : ''}`);
    } catch (err) {
      setStatus(geoStatus, false, `❌ خواندن فایل ناموفق بود: ${err.message}`);
    }
  }

  async function loadGcp(file) {
    st.gcpText = ''; st.gcpInfo = null;
    if (!file) { gcpStatus.textContent = ''; return; }
    try {
      const text = await file.text();
      const info = parseGcp(text);
      if (!info.ok) { setStatus(gcpStatus, false, `❌ ${info.error}`); return; }
      st.gcpText = text; st.gcpInfo = info;
      setStatus(gcpStatus, true, `✅ ${info.points} نقطه، ${info.rows.length} علامت — ${info.crs}`);
    } catch (err) {
      setStatus(gcpStatus, false, `❌ خواندن فایل ناموفق بود: ${err.message}`);
    }
  }

  modeSel.addEventListener('change', () => { syncVisibility(); onChange(); });
  georefSel.addEventListener('change', () => { syncVisibility(); onChange(); });
  [demSel, qualitySel, orthoBox, accInput].forEach((n) => n.addEventListener('change', () => onChange()));
  geoBtn.addEventListener('click', () => geoFile.click());
  gcpBtn.addEventListener('click', () => gcpFile.click());
  geoFile.addEventListener('change', async () => { await loadGeo(geoFile.files[0]); geoFile.value = ''; onChange(); });
  gcpFile.addEventListener('change', async () => { await loadGcp(gcpFile.files[0]); gcpFile.value = ''; onChange(); });

  /** بررسی ترکیب تنظیمات با عکس‌های انتخاب‌شده؛ نتیجه را در پنل هم نشان می‌دهد */
  function render(photoNames = []) {
    const errors = [];
    const warnings = [];
    if (isSurvey()) {
      const g = georef();
      if (g === 'geo') {
        if (!st.geoInfo) errors.push('فایل موقعیت عکس‌ها (geo.txt) را انتخاب کنید');
        else if (photoNames.length) {
          const m = unmatchedNames(st.geoInfo.rows, photoNames);
          if (m.matched === 0) errors.push('نام هیچ‌کدام از عکس‌های انتخابی در فایل موقعیت نیست');
          else {
            const noPos = photoNames.length - m.matched;
            if (noPos > 0) warnings.push(`${noPos} عکس از عکس‌های انتخابی در فایل موقعیت نیستند`);
          }
        }
        const acc = Number(accInput.value);
        if (!(acc >= 0.001 && acc <= 20)) errors.push('دقت موقعیت باید بین ۰٫۰۰۱ و ۲۰ متر باشد');
      } else if (g === 'gcp') {
        if (!st.gcpInfo) errors.push('فایل نقاط کنترل (gcp_list.txt) را انتخاب کنید');
        else {
          if (st.gcpInfo.warning) warnings.push(st.gcpInfo.warning);
          if (photoNames.length) {
            const m = unmatchedNames(st.gcpInfo.rows, photoNames);
            if (m.matched === 0) errors.push('نام هیچ‌کدام از عکس‌های انتخابی در فایل نقاط کنترل نیست');
            else if (m.missing.length) warnings.push(`${m.missing.length} عکس ذکرشده در فایل نقاط کنترل انتخاب نشده‌اند`);
          }
        }
      }
    }
    msgBox.innerHTML = '';
    errors.forEach((t) => msgBox.append(el('div', { style: 'color:var(--rust-700)' }, `⛔ ${t}`)));
    warnings.forEach((t) => msgBox.append(el('div', { style: 'color:var(--stone-600)' }, `⚠️ ${t}`)));
    return { ok: errors.length === 0, errors, warnings };
  }

  function getSettings() {
    const survey = isSurvey();
    const g = georef();
    return {
      mode: survey ? 'survey' : 'preview',
      georef: g,
      gpsAccuracy: Number(accInput.value) || 0.05,
      demResolution: Number(demSel.value) || 5,
      quality: qualitySel.value,
      ortho: orthoBox.checked,
      geoText: survey && g === 'geo' ? st.geoText : '',
      gcpText: survey && g === 'gcp' ? st.gcpText : '',
    };
  }

  /** با GCP، عکس‌ها باید اندازه‌ی اصلی آپلود شوند */
  const forcesOriginalSize = () => isSurvey() && georef() === 'gcp';

  function setDisabled(v) {
    [modeSel, georefSel, demSel, qualitySel, orthoBox, accInput, geoBtn, gcpBtn].forEach((n) => { n.disabled = v; });
  }

  syncVisibility();
  return { node, render, getSettings, forcesOriginalSize, setDisabled };
}

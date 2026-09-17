import {
  el, showToast, openModal, openImageViewer,
} from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getGeoLocation } from '../../lib/geo.js';
import { watermarkPhoto, watermarkLinesForPhoto } from '../../lib/watermark.js';
import { captureLivePhoto, liveCameraSupported } from '../../lib/liveCameraCapture.js';
import { uploadTechFile } from '../../lib/storage.js';
import {
  queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender,
} from '../../lib/offlineQueue.js';

/**
 * ثبت عکس دپوی مواد اولیه/محصول — مخصوص تخصص «فرآوری». مقدار (تناژ) همیشه اجباری و بخشی از خودِ
 * رکورد است (نه فقط یک توضیح آزاد که فقط روی عکس نوشته شود) تا هم قابل جست‌وجو/گزارش‌گیری بماند؛
 * علاوه بر آن، همان مقدار روی واترمارک خودِ عکس هم درج می‌شود تا عکس به‌تنهایی هم گویا باشد.
 */

const TYPE_LABELS = { raw_material: 'دپوی مواد اولیه (خوراک)', product: 'دپوی محصول' };

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendStockpilePayload(payload) {
  const photoUrl = await uploadTechFile(payload.photoBlob, `stockpile_${payload.stockpileType}_${Date.now()}.jpg`, payload.mineName, 'فرآوری', 'stockpile');
  const { error } = await sb.from('processing_stockpile_photos').insert([{
    mine_name: payload.mineName, stockpile_type: payload.stockpileType,
    material_name: payload.materialName || null, amount_tonnage: payload.amountTonnage,
    notes: payload.notes || null, photo_url: photoUrl, submitted_by: payload.submittedBy,
    lat: payload.lat, lon: payload.lon,
  }]);
  if (error) throw new Error(error.message);
}
registerSender('stockpilePhoto', sendStockpilePayload);

async function loadRecentStockpiles(box, mineName) {
  box.innerHTML = '<div style="font-size:11px;color:var(--stone-500)">در حال بارگذاری...</div>';
  const { data, error } = await sb.from('processing_stockpile_photos').select('*').eq('mine_name', mineName).order('created_at', { ascending: false }).limit(15);
  if (error) { box.innerHTML = '<div style="font-size:11px;color:var(--rust-700)">خطا در بارگذاری فهرست</div>'; return; }
  box.innerHTML = '';
  if (!data || !data.length) { box.append(el('div', { style: 'font-size:11px;color:var(--stone-500)' }, 'هنوز عکس دپویی ثبت نشده')); return; }
  data.forEach((r) => {
    box.append(el('div', { style: 'display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--stone-200)' }, [
      el('img', { src: r.photo_url, style: 'width:56px;height:56px;object-fit:cover;border-radius:6px;cursor:pointer;flex-shrink:0', onclick: () => openImageViewer(r.photo_url) }),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { style: 'font-weight:700;font-size:12px' }, TYPE_LABELS[r.stockpile_type] || r.stockpile_type),
        el('div', { style: 'font-size:11px;color:var(--stone-600)' }, `${r.material_name ? `${r.material_name} — ` : ''}${r.amount_tonnage ?? '—'} تن`),
      ]),
    ]));
  });
}

export function openStockpilePhotoModal(mine, nameField, { email, fullName = '', membershipNo = '' } = {}) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `🏭 عکس دپوی مواد اولیه/محصول — ${mineName}`, width: '420px' });

  const typeSelect = el('select', {}, [
    el('option', { value: 'raw_material' }, 'دپوی مواد اولیه (خوراک ورودی)'),
    el('option', { value: 'product' }, 'دپوی محصول'),
  ]);
  const materialInput = el('input', { type: 'text', placeholder: 'مثلاً: سنگ آهن دانه‌بندی‌شده' });
  const amountLabel = el('label', {}, 'مقدار خوراک (تن)');
  const amountInput = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'تن' });
  typeSelect.addEventListener('change', () => {
    amountLabel.textContent = typeSelect.value === 'product' ? 'مقدار محصول (تن)' : 'مقدار خوراک (تن)';
  });
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });
  const listBox = el('div', { style: 'margin-top:14px' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '📷 گرفتن عکس دپو');

  function watermarkLabel() {
    const typeLabel = TYPE_LABELS[typeSelect.value];
    const amountTxt = amountInput.value ? `${amountInput.value} تن` : 'مقدار نامشخص';
    return `${typeLabel} — ${amountTxt}${materialInput.value.trim() ? ` — ${materialInput.value.trim()}` : ''}`;
  }

  async function doSubmit(photoBlob, coords) {
    const payload = {
      mineName, stockpileType: typeSelect.value,
      materialName: materialInput.value.trim(), amountTonnage: parseFloat(amountInput.value),
      notes: notesInput.value.trim(), photoBlob,
      submittedBy: email || await currentUserEmail(),
      lat: coords?.latitude ?? null, lon: coords?.longitude ?? null,
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendStockpilePayload(payload);
      showToast('✅ عکس دپو ثبت شد');
      materialInput.value = ''; amountInput.value = ''; notesInput.value = '';
      loadRecentStockpiles(listBox, mineName);
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('sp'), type: 'stockpilePhoto', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — ثبت شد و به‌محض اتصال خودکار ارسال می‌شود');
        } catch (qErr) { errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`; }
      } else {
        errBox.textContent = err.message;
      }
    }
  }

  const legacyInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  legacyInput.addEventListener('change', async () => {
    const file = legacyInput.files[0];
    legacyInput.value = '';
    if (!file) return;
    showToast('⏳ در حال دریافت موقعیت مکانی...');
    try {
      const coords = await getGeoLocation();
      const watermarked = await watermarkPhoto(file, coords, mine, watermarkLabel(), fullName, membershipNo, nameField);
      await doSubmit(watermarked, coords);
    } catch (err) { errBox.textContent = err.message; }
  });

  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (!amountInput.value || Number.isNaN(parseFloat(amountInput.value))) {
      errBox.textContent = 'مقدار (تناژ) را وارد کنید'; return;
    }
    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    try {
      if (liveCameraSupported()) {
        const { blob, coords } = await captureLivePhoto({
          buildLines: (c) => watermarkLinesForPhoto(c, mine, watermarkLabel(), fullName, membershipNo, nameField),
        });
        await doSubmit(blob, coords);
      } else {
        legacyInput.click();
      }
    } catch (err) {
      if (err.message !== 'CANCELLED') errBox.textContent = err.message;
    }
    btn.disabled = false; btn.textContent = '📷 گرفتن عکس دپو';
  });

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      'مقدار (تناژ) وارد شده هم روی خودِ عکس درج می‌شود و هم در پایگاه‌داده ذخیره می‌شود.'),
    el('label', {}, 'نوع دپو'), typeSelect,
    el('label', {}, 'ماده معدنی (اختیاری)'), materialInput,
    amountLabel, amountInput,
    el('label', {}, 'توضیحات (اختیاری)'), notesInput,
    errBox, btn, legacyInput,
    el('h4', { style: 'margin-top:16px;font-size:var(--text-sm);color:var(--ink-700)' }, 'عکس‌های اخیر این واحد'),
    listBox,
  );
  loadRecentStockpiles(listBox, mineName);
}

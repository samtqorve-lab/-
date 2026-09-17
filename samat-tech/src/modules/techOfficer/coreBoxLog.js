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
 * ثبت عکس جعبه‌ی کور — مخصوص تخصص «اکتشاف». طبق روال معمول اکتشاف، به‌ازای هر ۶ متر پیشروی یک
 * گمانه، از جعبه‌ی مغزه (کور) عکس گرفته می‌شود؛ ولی نتیجه‌ی آنالیز آزمایشگاهی معمولاً هفته‌ها بعد
 * می‌رسد — پس این فرم از همان اول برای «تکمیل بعدی» طراحی شده: عکس و بازه‌ی عمق همین الان ثبت
 * می‌شود، و «نتیجه‌ی آنالیز» یک فیلد جدا است که هر وقت جواب رسید، همین‌جا (روی همان رکورد) کامل
 * یا ویرایش می‌شود، بدون نیاز به ثبت یک رکورد تازه.
 */

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendCoreBoxPayload(payload) {
  const photoUrl = await uploadTechFile(payload.photoBlob, `corebox_${payload.boreholeNo}_${payload.depthFrom}-${payload.depthTo}.jpg`, payload.mineName, 'اکتشاف', 'core-box');
  const { error } = await sb.from('exploration_core_boxes').insert([{
    mine_name: payload.mineName, borehole_no: payload.boreholeNo,
    depth_from: payload.depthFrom, depth_to: payload.depthTo,
    photo_url: photoUrl, submitted_by: payload.submittedBy,
    lat: payload.lat, lon: payload.lon,
  }]);
  if (error) throw new Error(error.message);
}
registerSender('coreBoxPhoto', sendCoreBoxPayload);

async function loadRecentCoreBoxes(box, mineName) {
  box.innerHTML = '<div style="font-size:11px;color:var(--stone-500)">در حال بارگذاری...</div>';
  const { data, error } = await sb.from('exploration_core_boxes').select('*').eq('mine_name', mineName).order('created_at', { ascending: false }).limit(15);
  if (error) { box.innerHTML = '<div style="font-size:11px;color:var(--rust-700)">خطا در بارگذاری فهرست</div>'; return; }
  box.innerHTML = '';
  if (!data || !data.length) { box.append(el('div', { style: 'font-size:11px;color:var(--stone-500)' }, 'هنوز عکس جعبه‌ی کوری ثبت نشده')); return; }
  data.forEach((r) => {
    const analysisBox = el('div', { style: 'font-size:11px;margin-top:4px' });
    function drawAnalysis() {
      analysisBox.innerHTML = '';
      if (r.analysis_result) {
        analysisBox.append(
          el('div', { style: 'color:var(--patina-700)' }, `✅ نتیجه آنالیز: ${r.analysis_result}`),
          el('button', { class: 'btn-sm', style: 'margin-top:4px;background:var(--stone-100)', onclick: openEditor }, '✏️ ویرایش نتیجه'),
        );
      } else {
        analysisBox.append(el('button', { class: 'btn-sm', style: 'background:var(--amber-100);color:var(--amber-700)', onclick: openEditor }, '🧪 تکمیل نتیجه‌ی آنالیز'));
      }
    }
    function openEditor() {
      const ta = el('textarea', { rows: '2', style: 'width:100%' }, r.analysis_result || '');
      const saveBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff;margin-top:4px' }, '💾 ذخیره');
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        const { error: updErr } = await sb.from('exploration_core_boxes')
          .update({ analysis_result: ta.value.trim() || null, analysis_updated_at: new Date().toISOString() })
          .eq('id', r.id);
        if (updErr) { showToast(`⚠️ ${updErr.message}`); saveBtn.disabled = false; return; }
        r.analysis_result = ta.value.trim() || null;
        showToast('✅ نتیجه‌ی آنالیز ذخیره شد');
        drawAnalysis();
      });
      analysisBox.innerHTML = '';
      analysisBox.append(ta, saveBtn);
    }
    drawAnalysis();
    box.append(el('div', { style: 'display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--stone-200)' }, [
      el('img', { src: r.photo_url, style: 'width:56px;height:56px;object-fit:cover;border-radius:6px;cursor:pointer;flex-shrink:0', onclick: () => openImageViewer(r.photo_url) }),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { style: 'font-weight:700;font-size:12px' }, `گمانه ${r.borehole_no} — عمق ${r.depth_from ?? '—'} تا ${r.depth_to ?? '—'} متر`),
        analysisBox,
      ]),
    ]));
  });
}

export function openCoreBoxLogModal(mine, nameField, { email, fullName = '', membershipNo = '' } = {}) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `📦 ثبت عکس جعبه‌ی کور — ${mineName}`, width: '420px' });

  const boreholeInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'مثلاً: BH-12' });
  const depthFromInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'مثلاً: 0' });
  const depthToInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'مثلاً: 6' });
  // پیشنهاد خودکار: به‌محض واردکردن عمق شروع، عمق پایان را با فاصله‌ی استاندارد ۶ متری پر می‌کند
  // (کاربر هر وقت بخواهد می‌تواند خودش تغییرش بدهد).
  depthFromInput.addEventListener('blur', () => {
    if (depthFromInput.value && !depthToInput.value) {
      depthToInput.value = (parseFloat(depthFromInput.value) + 6).toString();
    }
  });
  const errBox = el('div', { class: 'gate-err' });
  const listBox = el('div', { style: 'margin-top:14px' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '📷 گرفتن عکس جعبه‌ی کور');

  async function doSubmit(photoBlob, coords) {
    const payload = {
      mineName, boreholeNo: boreholeInput.value.trim(),
      depthFrom: depthFromInput.value ? parseFloat(depthFromInput.value) : null,
      depthTo: depthToInput.value ? parseFloat(depthToInput.value) : null,
      photoBlob, submittedBy: email || await currentUserEmail(),
      lat: coords?.latitude ?? null, lon: coords?.longitude ?? null,
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendCoreBoxPayload(payload);
      showToast('✅ عکس جعبه‌ی کور ثبت شد');
      loadRecentCoreBoxes(listBox, mineName);
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('cb'), type: 'coreBoxPhoto', payload, queuedAt: Date.now() });
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
      const watermarked = await watermarkPhoto(file, coords, mine, `جعبه کور — گمانه ${boreholeInput.value.trim() || '؟'} (${depthFromInput.value || '؟'}–${depthToInput.value || '؟'} متر)`, fullName, membershipNo, nameField);
      await doSubmit(watermarked, coords);
    } catch (err) { errBox.textContent = err.message; }
  });

  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const boreholeNo = boreholeInput.value.trim();
    if (!boreholeNo) { errBox.textContent = 'شماره گمانه را وارد کنید'; return; }
    if (!depthFromInput.value || !depthToInput.value) { errBox.textContent = 'بازه‌ی عمق (شروع و پایان) را وارد کنید'; return; }
    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    try {
      if (liveCameraSupported()) {
        const { blob, coords } = await captureLivePhoto({
          buildLines: (c) => watermarkLinesForPhoto(c, mine, `جعبه کور — گمانه ${boreholeNo} (${depthFromInput.value}–${depthToInput.value} متر)`, fullName, membershipNo, nameField),
        });
        await doSubmit(blob, coords);
      } else {
        legacyInput.click();
      }
    } catch (err) {
      if (err.message !== 'CANCELLED') errBox.textContent = err.message;
    }
    btn.disabled = false; btn.textContent = '📷 گرفتن عکس جعبه‌ی کور';
  });

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      'برای هر ۶ متر پیشروی گمانه، یک عکس از جعبه‌ی مغزه ثبت کنید. نتیجه‌ی آنالیز آزمایشگاه را هر وقت رسید، از همین‌جا (پایین لیست) کامل کنید.'),
    el('label', {}, 'شماره گمانه'), boreholeInput,
    el('div', { style: 'display:flex;gap:8px' }, [
      el('div', { style: 'flex:1' }, [el('label', {}, 'عمق شروع (متر)'), depthFromInput]),
      el('div', { style: 'flex:1' }, [el('label', {}, 'عمق پایان (متر)'), depthToInput]),
    ]),
    errBox, btn, legacyInput,
    el('h4', { style: 'margin-top:16px;font-size:var(--text-sm);color:var(--ink-700)' }, 'جعبه‌های کور اخیر این محدوده'),
    listBox,
  );
  loadRecentCoreBoxes(listBox, mineName);
}

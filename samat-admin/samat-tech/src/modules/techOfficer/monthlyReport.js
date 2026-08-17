import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getGeoLocation, isInsideMineBoundary } from '../../lib/geo.js';
import { watermarkPhoto, watermarkLinesForPhoto } from '../../lib/watermark.js';
import { captureLivePhoto, liveCameraSupported } from '../../lib/liveCameraCapture.js';
import { uploadTechFile } from '../../lib/storage.js';
import { recentPeriodOptions } from '../../lib/jalali.js';
import { formalizePersianText } from '../../lib/formalize.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';
import { sendEquipmentPhotoPayload } from './equipmentChecklist.js';

// منطق واقعی ارسال گزارش دوره‌ای — هم مسیر آنلاین مستقیم و هم sync بعدی از صف آفلاین از این استفاده می‌کنند.
async function sendTechReportPayload(p) {
  const fileUrls = { report: [], face: [], equip: [], equipmentDetail: [] };
  if (p.reportBlob) fileUrls.report.push(await uploadTechFile(p.reportBlob.blob, p.reportBlob.name, p.mineName, p.period, 'report'));
  // eslint-disable-next-line no-restricted-syntax
  for (const item of p.faceBlobs) {
    // eslint-disable-next-line no-await-in-loop
    fileUrls.face.push(await uploadTechFile(item.blob, 'face.jpg', p.mineName, p.period, 'face'));
  }
  // eslint-disable-next-line no-restricted-syntax
  for (const item of p.equipBlobs) {
    // eslint-disable-next-line no-await-in-loop
    fileUrls.equip.push(await uploadTechFile(item.blob, 'equip.jpg', p.mineName, p.period, 'equip'));
  }

  const { error: insErr } = await sb.from('tech_reports').insert([{
    mine_name: p.mineName, submitted_by: p.submittedBy, period: p.period, note: p.note, file_urls: fileUrls, department: p.department,
  }]);
  if (insErr) throw new Error(`ثبت گزارش در سامانه ناموفق بود: ${insErr.message}`);

  try {
    const { data: sessionData } = await sb.auth.getSession();
    const jwt = sessionData && sessionData.session ? sessionData.session.access_token : null;
    if (!jwt) return;
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ action: 'techReport', mineName: p.mineName, period: p.period, note: p.note, fileUrls, submittedBy: p.submittedBy }),
    });
  } catch {
    // اطلاع‌رسانی فوری best-effort است؛ گزارش قبلاً با موفقیت ثبت شده
  }
}
registerSender('techReport', sendTechReportPayload);

/**
 * بخش «آپلود گزارش ماهانه» را داخل container می‌سازد.
 * @param {HTMLElement} container
 * @param {() => object|null} getMine تابعی که معدن انتخاب‌شده‌ی فعلی را برمی‌گرداند
 * @param {string} nameField
 * @param {string} department
 * @param {() => {fullName:string, membershipNo:string}} getProfile
 * @param {() => void} onSubmitted بعد از ارسال موفق/ذخیره آفلاین صدا زده می‌شود (مثلاً برای رفرش تاریخچه)
 */
export function mountMonthlyReport(container, getMine, nameField, department, getProfile, onSubmitted) {
  const periodSelect = el('select', {}, recentPeriodOptions(6).map((p) => el('option', { value: p }, p)));
  const reportFileInput = el('input', { type: 'file', accept: '.pdf,.doc,.docx,image/*' });

  let faceCaptures = []; // [{blob, previewUrl}]
  let equipCaptures = [];
  const faceThumbs = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' });
  const equipThumbs = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' });
  const noteInput = el('textarea', { rows: '3', placeholder: 'توضیحات تکمیلی...' });
  const statusBox = el('div', { style: 'margin-top:10px;font-size:var(--text-sm)' });

  function drawThumbs(category) {
    const arr = category === 'face' ? faceCaptures : equipCaptures;
    const box = category === 'face' ? faceThumbs : equipThumbs;
    box.innerHTML = '';
    arr.forEach((c, i) => {
      box.append(el('div', { style: 'position:relative;width:76px;height:76px' }, [
        el('img', { src: c.previewUrl, style: 'width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--stone-300)' }),
        el('button', {
          style: 'position:absolute;top:-6px;left:-6px;background:var(--rust-600);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer',
          onclick: () => {
            const removed = arr.splice(i, 1)[0];
            if (removed && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
            drawThumbs(category);
          },
        }, '✕'),
      ]));
    });
  }

  async function handleCaptured(category, mine, blob, coords) {
    const item = { blob, previewUrl: URL.createObjectURL(blob) };
    (category === 'face' ? faceCaptures : equipCaptures).push(item);
    drawThumbs(category);
    showToast('✅ عکس ثبت شد');

    if (category === 'equip') {
      try {
        const insideBoundary = coords ? isInsideMineBoundary(coords, mine) : false;
        const { data: { user } } = await sb.auth.getUser();
        const payload = {
          mineName: mine[nameField], submittedBy: user ? user.email : '',
          machineType: 'سایر ماشین‌آلات (خارج از لیست)', plateNo: '', photoBlob: blob, photoType: 'general',
          deviceKey: `other_${Date.now()}`, lat: coords?.latitude, lon: coords?.longitude, insideBoundary, department,
        };
        try {
          if (!navigator.onLine) throw new Error('OFFLINE');
          await sendEquipmentPhotoPayload(payload);
          showToast('✅ عکس ماشین برای تایید مدیر سامانه ارسال شد');
        } catch (sendErr) {
          if (sendErr.message === 'OFFLINE' || isLikelyNetworkError(sendErr)) {
            await queueOfflineSubmission({ id: newQueueId('eq'), type: 'equipmentPhoto', payload, queuedAt: Date.now() });
            showToast('📴 اینترنت وصل نیست — عکس ذخیره شد و بعداً خودکار ارسال می‌شود');
          } else {
            throw sendErr;
          }
        }
      } catch (subErr) {
        showToast(`⚠️ عکس ذخیره شد ولی ارسال برای تایید ماشین‌آلات ناموفق بود: ${subErr.message}`);
      }
    }
  }

  async function captureViaLiveCamera(category) {
    const mine = getMine();
    if (!mine) { showToast('⚠️ ابتدا معدن را انتخاب کنید'); return; }
    const { fullName, membershipNo } = getProfile();
    try {
      const { blob, coords } = await captureLivePhoto({
        buildLines: (c) => watermarkLinesForPhoto(c, mine, category === 'face' ? 'سینه‌کار' : 'ماشین‌آلات', fullName, membershipNo),
      });
      await handleCaptured(category, mine, blob, coords);
    } catch (err) {
      if (err.message === 'CANCELLED') return;
      showToast(`⚠️ دوربین زنده در دسترس نبود؛ از حالت معمولی استفاده می‌شود (${err.message})`);
      (category === 'face' ? faceCameraInput : equipCameraInput).click();
    }
  }

  async function captureViaLegacyInput(category, file) {
    const mine = getMine();
    if (!mine) { showToast('⚠️ ابتدا معدن را انتخاب کنید'); return; }
    const { fullName, membershipNo } = getProfile();
    showToast('⏳ در حال دریافت موقعیت مکانی...');
    try {
      const coords = await getGeoLocation();
      const watermarked = await watermarkPhoto(file, coords, mine, category === 'face' ? 'سینه‌کار' : 'ماشین‌آلات', fullName, membershipNo);
      await handleCaptured(category, mine, watermarked, coords);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  }

  const faceCameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  faceCameraInput.addEventListener('change', () => { if (faceCameraInput.files[0]) captureViaLegacyInput('face', faceCameraInput.files[0]); faceCameraInput.value = ''; });
  const equipCameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  equipCameraInput.addEventListener('change', () => { if (equipCameraInput.files[0]) captureViaLegacyInput('equip', equipCameraInput.files[0]); equipCameraInput.value = ''; });

  function triggerCapture(category) {
    if (liveCameraSupported()) captureViaLiveCamera(category);
    else (category === 'face' ? faceCameraInput : equipCameraInput).click();
  }

  const formalizeBtn = el('button', { class: 'btn-sm', style: 'background:#f3e5f5;color:#6a1b9a;margin-top:4px', onclick: () => {
    const text = noteInput.value.trim();
    if (!text) { showToast('⚠️ ابتدا متن را بنویسید'); return; }
    noteInput.value = formalizePersianText(text);
    showToast('✅ متن رسمی‌نویسی شد');
  } }, '✨ رسمی‌نویسی خودکار');

  const submitBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:14px' }, '📤 ارسال گزارش');
  submitBtn.addEventListener('click', async () => {
    const mine = getMine();
    if (!mine) { showToast('⚠️ معدن را انتخاب کنید'); return; }
    const { fullName, membershipNo } = getProfile();
    if (!fullName || !membershipNo) { showToast('⚠️ ابتدا نام و شماره عضویت نظام مهندسی خود را در بالا وارد و ذخیره کنید'); return; }
    const period = periodSelect.value;
    const reportFile = reportFileInput.files[0];
    if (reportFile && reportFile.size > 20 * 1024 * 1024) { showToast('⚠️ حجم فایل گزارش بیشتر از ۲۰ مگابایت است'); return; }
    if (!reportFile && !faceCaptures.length && !equipCaptures.length) { showToast('⚠️ حداقل یک فایل یا عکس ثبت کنید'); return; }

    const { data: { user } } = await sb.auth.getUser();
    const payload = {
      mineName: mine[nameField], department, period, note: noteInput.value.trim(), submittedBy: user ? user.email : '',
      reportBlob: reportFile ? { blob: reportFile, name: reportFile.name } : null,
      faceBlobs: faceCaptures.map((c) => ({ blob: c.blob })),
      equipBlobs: equipCaptures.map((c) => ({ blob: c.blob })),
    };

    submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال آپلود...';
    statusBox.textContent = '';
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendTechReportPayload(payload);
      statusBox.innerHTML = '';
      statusBox.append(el('span', { style: 'color:var(--patina-700)' }, '✅ گزارش با موفقیت ذخیره و برای مسئولین ارسال شد.'));
      resetForm();
      onSubmitted?.();
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('tor'), type: 'techReport', payload, queuedAt: Date.now() });
          statusBox.innerHTML = '';
          statusBox.append(el('span', { style: 'color:var(--amber-700)' }, '📴 اینترنت وصل نیست — گزارش ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود.'));
          resetForm();
          onSubmitted?.();
        } catch (qErr) {
          statusBox.innerHTML = '';
          statusBox.append(el('span', { style: 'color:var(--rust-700)' }, `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`));
        }
      } else {
        statusBox.innerHTML = '';
        statusBox.append(el('span', { style: 'color:var(--rust-700)' }, err.message));
      }
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = '📤 ارسال گزارش';
    }
  });

  function resetForm() {
    reportFileInput.value = '';
    noteInput.value = '';
    faceCaptures.forEach((c) => c.previewUrl && URL.revokeObjectURL(c.previewUrl));
    equipCaptures.forEach((c) => c.previewUrl && URL.revokeObjectURL(c.previewUrl));
    faceCaptures = []; equipCaptures = [];
    drawThumbs('face'); drawThumbs('equip');
    periodSelect.innerHTML = '';
    recentPeriodOptions(6).forEach((p) => periodSelect.append(el('option', { value: p }, p)));
  }

  container.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' }, 'گزارش و عکس‌ها مستقیماً برای مسئولین اداره ارسال می‌شود.'),
    el('label', {}, 'دوره گزارش'), periodSelect,
    el('label', {}, 'فایل گزارش ماهانه (PDF/Word/عکس)'), reportFileInput,
    el('div', { class: 'banner banner-amber', style: 'margin-top:14px' }, '📷 همه‌ی عکس‌ها فقط با دوربین همین لحظه گرفته می‌شوند (نه گالری) و مختصات GPS + مشخصات معدن و مسئول فنی روی خود عکس درج می‌شود.'),
    el('label', {}, 'عکس‌های سینه‌کار'),
    el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff', onclick: () => triggerCapture('face') }, '📷 گرفتن عکس سینه‌کار'), faceCameraInput,
    faceThumbs,
    el('label', { style: 'margin-top:14px' }, 'عکس سایر ماشین‌آلات (خارج از لیست چک‌لیست تجهیزات)'),
    el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff', onclick: () => triggerCapture('equip') }, '📷 گرفتن عکس ماشین‌آلات دیگر'), equipCameraInput,
    equipThumbs,
    el('label', {}, 'توضیحات'), noteInput, formalizeBtn,
    submitBtn, statusBox,
  );
}

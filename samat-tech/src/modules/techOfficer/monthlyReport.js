import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { uploadTechFile, uploadVoiceNote } from '../../lib/storage.js';
import { recentPeriodOptions } from '../../lib/jalali.js';
import { formalizePersianText } from '../../lib/formalize.js';
import { mountVoiceRecorder } from '../../lib/voiceRecorder.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';

// منطق واقعی ارسال گزارش دوره‌ای — هم مسیر آنلاین مستقیم و هم sync بعدی از صف آفلاین از این استفاده می‌کنند.
async function sendTechReportPayload(p) {
  const fileUrls = { report: [], face: [], equip: [], equipmentDetail: [], voice: [] };
  if (p.reportBlob) fileUrls.report.push(await uploadTechFile(p.reportBlob.blob, p.reportBlob.name, p.mineName, p.period, 'report'));
  if (p.voiceBlob) fileUrls.voice.push(await uploadVoiceNote(p.voiceBlob, p.mineName));
  // eslint-disable-next-line no-restricted-syntax
  for (const item of p.faceBlobs) {
    // eslint-disable-next-line no-await-in-loop
    fileUrls.face.push(await uploadTechFile(item.blob, `${item.faceName || 'face'}.jpg`, p.mineName, p.period, 'face'));
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
 * بخش «آپلود گزارش ماهانه» را داخل container می‌سازد. عکس‌های سینه‌کار/ماشین‌آلات از قبل در
 * صفحه‌ی اصلی گرفته شده‌اند (captureApi) — این فرم فقط فایل گزارش + دوره + توضیحات را می‌گیرد و
 * همه را با هم ارسال می‌کند، و بعد از ارسال موفق عکس‌های صفحه‌ی اصلی را هم پاک می‌کند.
 * @param {HTMLElement} container
 * @param {() => object|null} getMine تابعی که معدن انتخاب‌شده‌ی فعلی را برمی‌گرداند
 * @param {string} nameField
 * @param {string} department
 * @param {() => {fullName:string, membershipNo:string}} getProfile
 * @param {ReturnType<import('./faceEquipCapture.js').createFaceEquipCapture>} captureApi
 * @param {() => void} onSubmitted بعد از ارسال موفق/ذخیره آفلاین صدا زده می‌شود (مثلاً برای رفرش تاریخچه)
 */
export function mountMonthlyReport(container, getMine, nameField, department, getProfile, captureApi, onSubmitted) {
  const periodSelect = el('select', {}, recentPeriodOptions(6).map((p) => el('option', { value: p }, p)));
  const reportFileInput = el('input', { type: 'file', accept: '.pdf,.doc,.docx,image/*' });
  const noteInput = el('textarea', { rows: '3', placeholder: 'توضیحات تکمیلی...' });
  const voiceBox = el('div', { style: 'margin-top:8px' });
  let voiceBlob = null;
  mountVoiceRecorder(voiceBox, (blob) => { voiceBlob = blob; });
  const statusBox = el('div', { style: 'margin-top:10px;font-size:var(--text-sm)' });
  const captureCountBox = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:8px 0' });

  function refreshCaptureCount() {
    captureCountBox.textContent = `عکس‌های گرفته‌شده در صفحه‌ی اصلی که با این گزارش ارسال می‌شوند: `
      + `${captureApi.getFaceBlobs().length} عکس سینه‌کار، ${captureApi.getEquipBlobs().length} عکس ماشین‌آلات`;
  }
  refreshCaptureCount();

  const formalizeBtn = el('button', { class: 'btn-sm', style: 'background:var(--fluorite-100);color:var(--fluorite-700);margin-top:4px', onclick: () => {
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
    if (!fullName || !membershipNo) { showToast('⚠️ ابتدا نام و شماره عضویت نظام مهندسی خود را از منو → مشخصات وارد و ذخیره کنید'); return; }
    const period = periodSelect.value;
    const reportFile = reportFileInput.files[0];
    if (reportFile && reportFile.size > 20 * 1024 * 1024) { showToast('⚠️ حجم فایل گزارش بیشتر از ۲۰ مگابایت است'); return; }
    const faceBlobs = captureApi.getFaceBlobs();
    const equipBlobs = captureApi.getEquipBlobs();
    if (!reportFile && !faceBlobs.length && !equipBlobs.length) { showToast('⚠️ حداقل یک فایل یا عکس (از صفحه‌ی اصلی) ثبت کنید'); return; }

    // نکته: عمداً getSession (محلی، بدون شبکه) به‌جای getUser (که یک درخواست شبکه‌ی واقعی برای
    // اعتبارسنجی توکن می‌زند) استفاده شده — چون این تابع باید حتی بدون اینترنت هم کار کند؛
    // getUser() در آن حالت throw می‌کرد و کل ارسال را، پیش از رسیدن به منطق «ذخیره در صف
    // آفلاین»، خراب می‌کرد.
    const { data: { session } } = await sb.auth.getSession();
    const payload = {
      mineName: mine[nameField], department, period, note: noteInput.value.trim(), submittedBy: session?.user?.email || '',
      reportBlob: reportFile ? { blob: reportFile, name: reportFile.name } : null,
      voiceBlob,
      faceBlobs,
      equipBlobs,
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
    voiceBlob = null;
    voiceBox.innerHTML = '';
    mountVoiceRecorder(voiceBox, (blob) => { voiceBlob = blob; });
    captureApi.resetAll();
    refreshCaptureCount();
    periodSelect.innerHTML = '';
    recentPeriodOptions(6).forEach((p) => periodSelect.append(el('option', { value: p }, p)));
  }

  container.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' }, 'گزارش و عکس‌ها مستقیماً برای مسئولین اداره ارسال می‌شود.'),
    el('label', {}, 'دوره گزارش'), periodSelect,
    el('label', {}, 'فایل گزارش ماهانه (PDF/Word/عکس)'), reportFileInput,
    captureCountBox,
    el('label', {}, 'توضیحات'), noteInput, formalizeBtn,
    el('label', { style: 'margin-top:10px' }, 'یادداشت صوتی (اختیاری — سریع‌تر از تایپ توی صحرا)'), voiceBox,
    submitBtn, statusBox,
  );
}

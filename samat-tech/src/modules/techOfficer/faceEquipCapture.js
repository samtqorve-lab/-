import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getGeoLocation, isInsideMineBoundary } from '../../lib/geo.js';
import { watermarkPhoto, watermarkLinesForPhoto } from '../../lib/watermark.js';
import { captureLivePhoto, liveCameraSupported } from '../../lib/liveCameraCapture.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError } from '../../lib/offlineQueue.js';
import { sendEquipmentPhotoPayload } from './equipmentChecklist.js';

/**
 * منطق مشترک گرفتن عکس «سینه‌کار» (با نام کوتاه دلخواه، که همان روی واترمارک درج می‌شود) و
 * «ماشین‌آلات» را نگه می‌دارد. صفحه‌ی اصلی از mountWidget برای گرفتن عکس استفاده می‌کند؛
 * فرم «ارسال گزارش دوره‌ای» (که داخل منو جابه‌جا شده) با getFaceBlobs/getEquipBlobs/resetAll
 * همین عکس‌های گرفته‌شده را برای پیوست به گزارش برمی‌دارد.
 * @param {{ getMine: () => object|null, nameField: string, department: string, getProfile: () => {fullName:string, membershipNo:string} }} opts
 */
export function createFaceEquipCapture({
  getMine, nameField, department, getProfile,
}) {
  let faceCaptures = []; // [{blob, previewUrl, faceName}]
  let equipCaptures = []; // [{blob, previewUrl}]
  const faceThumbs = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' });
  const equipThumbs = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' });
  const faceNameInput = el('input', {
    type: 'text',
    placeholder: 'مثلاً «سینه شماره یک جنوبی» یا «A1280»',
  });

  function drawFaceThumbs() {
    faceThumbs.innerHTML = '';
    faceCaptures.forEach((c, i) => {
      faceThumbs.append(el('div', { style: 'position:relative;width:84px' }, [
        el('div', { style: 'position:relative;width:84px;height:84px' }, [
          el('img', { src: c.previewUrl, style: 'width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--stone-300)' }),
          el('button', {
            style: 'position:absolute;top:-6px;left:-6px;background:var(--rust-600);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer',
            onclick: () => {
              const removed = faceCaptures.splice(i, 1)[0];
              if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
              drawFaceThumbs();
            },
          }, '✕'),
        ]),
        el('div', { style: 'font-size:10.5px;color:var(--stone-600);text-align:center;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, c.faceName),
      ]));
    });
  }

  function drawEquipThumbs() {
    equipThumbs.innerHTML = '';
    equipCaptures.forEach((c, i) => {
      equipThumbs.append(el('div', { style: 'position:relative;width:76px;height:76px' }, [
        el('img', { src: c.previewUrl, style: 'width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--stone-300)' }),
        el('button', {
          style: 'position:absolute;top:-6px;left:-6px;background:var(--rust-600);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer',
          onclick: () => {
            const removed = equipCaptures.splice(i, 1)[0];
            if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
            drawEquipThumbs();
          },
        }, '✕'),
      ]));
    });
  }

  async function handleFaceCaptured(mine, blob, faceName) {
    const item = { blob, previewUrl: URL.createObjectURL(blob), faceName };
    faceCaptures.push(item);
    drawFaceThumbs();
    showToast('✅ عکس سینه‌کار ثبت شد');
  }

  async function handleEquipCaptured(mine, blob, coords) {
    const item = { blob, previewUrl: URL.createObjectURL(blob) };
    equipCaptures.push(item);
    drawEquipThumbs();
    showToast('✅ عکس ثبت شد');
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

  async function captureFaceViaLiveCamera() {
    const mine = getMine();
    if (!mine) { showToast('⚠️ ابتدا معدن/محدوده را از بالای صفحه انتخاب کنید'); return; }
    const faceName = faceNameInput.value.trim();
    if (!faceName) { showToast('⚠️ ابتدا نام/توضیح کوتاه سینه‌کار فعال را بنویسید (مثلاً «سینه شماره یک جنوبی»)'); return; }
    const { fullName, membershipNo } = getProfile();
    try {
      const { blob } = await captureLivePhoto({
        buildLines: (c) => watermarkLinesForPhoto(c, mine, `سینه‌کار «${faceNameInput.value.trim() || faceName}»`, fullName, membershipNo),
      });
      await handleFaceCaptured(mine, blob, faceName);
    } catch (err) {
      if (err.message === 'CANCELLED') return;
      showToast(`⚠️ دوربین زنده در دسترس نبود؛ از حالت معمولی استفاده می‌شود (${err.message})`);
      faceCameraInput.click();
    }
  }

  async function captureFaceViaLegacyInput(file) {
    const mine = getMine();
    if (!mine) { showToast('⚠️ ابتدا معدن/محدوده را از بالای صفحه انتخاب کنید'); return; }
    const faceName = faceNameInput.value.trim();
    if (!faceName) { showToast('⚠️ ابتدا نام/توضیح کوتاه سینه‌کار فعال را بنویسید'); return; }
    const { fullName, membershipNo } = getProfile();
    showToast('⏳ در حال دریافت موقعیت مکانی...');
    try {
      const coords = await getGeoLocation();
      const watermarked = await watermarkPhoto(file, coords, mine, `سینه‌کار «${faceName}»`, fullName, membershipNo);
      await handleFaceCaptured(mine, watermarked, faceName);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  }

  async function captureEquipViaLiveCamera() {
    const mine = getMine();
    if (!mine) { showToast('⚠️ ابتدا معدن/محدوده را از بالای صفحه انتخاب کنید'); return; }
    const { fullName, membershipNo } = getProfile();
    try {
      const { blob, coords } = await captureLivePhoto({
        buildLines: (c) => watermarkLinesForPhoto(c, mine, 'ماشین‌آلات', fullName, membershipNo),
      });
      await handleEquipCaptured(mine, blob, coords);
    } catch (err) {
      if (err.message === 'CANCELLED') return;
      showToast(`⚠️ دوربین زنده در دسترس نبود؛ از حالت معمولی استفاده می‌شود (${err.message})`);
      equipCameraInput.click();
    }
  }

  async function captureEquipViaLegacyInput(file) {
    const mine = getMine();
    if (!mine) { showToast('⚠️ ابتدا معدن/محدوده را از بالای صفحه انتخاب کنید'); return; }
    const { fullName, membershipNo } = getProfile();
    showToast('⏳ در حال دریافت موقعیت مکانی...');
    try {
      const coords = await getGeoLocation();
      const watermarked = await watermarkPhoto(file, coords, mine, 'ماشین‌آلات', fullName, membershipNo);
      await handleEquipCaptured(mine, watermarked, coords);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  }

  const faceCameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  faceCameraInput.addEventListener('change', () => { if (faceCameraInput.files[0]) captureFaceViaLegacyInput(faceCameraInput.files[0]); faceCameraInput.value = ''; });
  const equipCameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  equipCameraInput.addEventListener('change', () => { if (equipCameraInput.files[0]) captureEquipViaLegacyInput(equipCameraInput.files[0]); equipCameraInput.value = ''; });

  function triggerFaceCapture() {
    if (liveCameraSupported()) captureFaceViaLiveCamera();
    else {
      const faceName = faceNameInput.value.trim();
      if (!faceName) { showToast('⚠️ ابتدا نام/توضیح کوتاه سینه‌کار فعال را بنویسید'); return; }
      faceCameraInput.click();
    }
  }
  function triggerEquipCapture() {
    if (liveCameraSupported()) captureEquipViaLiveCamera();
    else equipCameraInput.click();
  }

  function mountWidget(container) {
    container.append(
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
        '📷 همه‌ی عکس‌ها فقط با دوربین همین لحظه گرفته می‌شوند و مختصات GPS + مشخصات معدن و مسئول فنی روی خود عکس درج می‌شود.'),
      el('label', {}, 'نام/توضیح کوتاه سینه‌کار فعال'),
      faceNameInput,
      el('div', { style: 'font-size:10.5px;color:var(--stone-500);margin-top:2px;margin-bottom:8px' },
        'همین نام دقیقاً روی واترمارک عکس زیر درج می‌شود — قبل از هر عکس در صورت نیاز تغییرش بدهید.'),
      el('button', { class: 'btn btn-primary', style: 'width:100%', onclick: triggerFaceCapture }, '📷 گرفتن عکس سینه‌کار'),
      faceCameraInput,
      faceThumbs,
      el('div', { style: 'height:1px;background:var(--stone-200);margin:16px 0' }),
      el('label', {}, 'عکس ماشین‌آلات'),
      el('button', { class: 'btn-sm', style: 'width:100%;background:var(--patina-700);color:#fff', onclick: triggerEquipCapture }, '📷 گرفتن عکس ماشین‌آلات'),
      equipCameraInput,
      equipThumbs,
    );
  }

  return {
    mountWidget,
    getFaceBlobs: () => faceCaptures.map((c) => ({ blob: c.blob, faceName: c.faceName })),
    getEquipBlobs: () => equipCaptures.map((c) => ({ blob: c.blob })),
    hasFaceOrEquip: () => faceCaptures.length > 0 || equipCaptures.length > 0,
    resetAll: () => {
      faceCaptures.forEach((c) => c.previewUrl && URL.revokeObjectURL(c.previewUrl));
      equipCaptures.forEach((c) => c.previewUrl && URL.revokeObjectURL(c.previewUrl));
      faceCaptures = []; equipCaptures = [];
      drawFaceThumbs(); drawEquipThumbs();
    },
  };
}

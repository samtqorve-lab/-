import { el, showToast, openModal, openImageViewer } from '../../lib/dom.js';
import { getGeoLocation } from '../../lib/geo.js';
import { watermarkPhoto, watermarkLinesForPhoto } from '../../lib/watermark.js';
import { captureLivePhoto, liveCameraSupported } from '../../lib/liveCameraCapture.js';

/**
 * منطق مشترک گرفتن عکس «سینه‌کار» (با نام کوتاه دلخواه، که همان روی واترمارک درج می‌شود) را
 * نگه می‌دارد. صفحه‌ی اصلی از mountWidget برای گرفتن عکس استفاده می‌کند؛ فرم «ارسال گزارش
 * دوره‌ای» (که داخل منو جابه‌جا شده) با getFaceBlobs/resetAll همین عکس‌های گرفته‌شده را برای
 * پیوست به گزارش برمی‌دارد.
 *
 * نکته‌ی مهم (اصلاح‌شده): قبلاً اینجا یک دکمه‌ی «عکس سایر ماشین‌آلات» جدا هم بود که مستقیم و
 * بی‌نام عکس می‌گرفت — بدون وصل‌بودن به هیچ دستگاه مشخصی از لیست، بدون شماره سریال، و فقط یک
 * عکس (نه نمای دور + شماره سریال). آن باگ واقعی بود: عکس‌ها قابل ردیابی به یک دستگاه مشخص نبودند
 * و هیچ‌وقت به لیست پیش‌فرض دائمی معدن اضافه نمی‌شدند. حالا این دکمه مستقیم همان چک‌لیست
 * ماشین‌آلات پیش‌فرض (equipmentChecklist.js) را باز می‌کند — که همین الان هم شماره سریال
 * اجباری، هم دقیقاً دو عکس اجباری (نمای دور + شماره سریال)، هم افزودن دستگاه جدید به لیست دائمی
 * را پیاده دارد؛ یعنی به‌جای ساختن یک مسیر دوم و ناقص، از همان مسیر درست استفاده می‌کند.
 * getEquipBlobs/hasFaceOrEquip/resetAll برای سازگاری با monthlyReport.js نگه داشته شده‌اند —
 * چون آن عکس‌ها حالا مستقیماً و جداگانه (به همراه نام دستگاه/شماره سریال واقعی) برای تایید ادمین
 * ارسال می‌شوند، دیگر لازم نیست به گزارش دوره‌ای هم پیوست شوند.
 * @param {{ getMine: () => object|null, nameField: string, department: string, getProfile: () => {fullName:string, membershipNo:string} }} opts
 */
export function createFaceEquipCapture({
  getMine, nameField, department, getProfile,
}) {
  let faceCaptures = []; // [{blob, previewUrl, faceName}]
  const faceThumbs = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' });
  const faceNameInput = el('input', {
    type: 'text',
    placeholder: 'مثلاً «سینه شماره یک جنوبی» یا «A1280»',
  });

  function drawFaceThumbs() {
    faceThumbs.innerHTML = '';
    faceCaptures.forEach((c, i) => {
      faceThumbs.append(el('div', { style: 'position:relative;width:84px' }, [
        el('div', { style: 'position:relative;width:84px;height:84px' }, [
          el('img', { src: c.previewUrl, style: 'width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--stone-300);cursor:pointer', onclick: () => openImageViewer(c.previewUrl) }),
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

  async function handleFaceCaptured(mine, blob, faceName) {
    const item = { blob, previewUrl: URL.createObjectURL(blob), faceName };
    faceCaptures.push(item);
    drawFaceThumbs();
    showToast('✅ عکس سینه‌کار ثبت شد');
  }

  function requireProfile() {
    const { fullName, membershipNo } = getProfile();
    if (!fullName || !membershipNo) {
      showToast('⚠️ ابتدا نام و شماره عضویت خود را از منو ☰ → «مشخصات و تنظیمات» وارد و ذخیره کنید (روی واترمارک عکس درج می‌شود)');
      return null;
    }
    return { fullName, membershipNo };
  }

  async function captureFaceViaLiveCamera() {
    const mine = getMine();
    if (!mine) { showToast('⚠️ ابتدا معدن/محدوده را از بالای صفحه انتخاب کنید'); return; }
    const faceName = faceNameInput.value.trim();
    if (!faceName) { showToast('⚠️ ابتدا نام/توضیح کوتاه سینه‌کار فعال را بنویسید (مثلاً «سینه شماره یک جنوبی»)'); return; }
    const profile = requireProfile();
    if (!profile) return;
    const { fullName, membershipNo } = profile;
    try {
      const { blob } = await captureLivePhoto({
        buildLines: (c) => watermarkLinesForPhoto(c, mine, `سینه‌کار «${faceNameInput.value.trim() || faceName}»`, fullName, membershipNo, nameField),
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
    const profile = requireProfile();
    if (!profile) return;
    const { fullName, membershipNo } = profile;
    showToast('⏳ در حال دریافت موقعیت مکانی...');
    try {
      const coords = await getGeoLocation();
      const watermarked = await watermarkPhoto(file, coords, mine, `سینه‌کار «${faceName}»`, fullName, membershipNo, nameField);
      await handleFaceCaptured(mine, watermarked, faceName);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  }

  async function openEquipmentListModal() {
    const mine = getMine();
    if (!mine) { showToast('⚠️ ابتدا معدن/محدوده را از بالای صفحه انتخاب کنید'); return; }
    const profile = requireProfile();
    if (!profile) return;
    const { mountEquipmentChecklist } = await import('./equipmentChecklist.js');
    const { body } = openModal({ title: '📋 عکس ماشین‌آلات (نمای دور + شماره سریال)', width: '560px' });
    mountEquipmentChecklist(body, mine, nameField, department, { value: profile.fullName }, { value: profile.membershipNo });
  }

  const faceCameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  faceCameraInput.addEventListener('change', () => { if (faceCameraInput.files[0]) captureFaceViaLegacyInput(faceCameraInput.files[0]); faceCameraInput.value = ''; });

  function triggerFaceCapture() {
    if (liveCameraSupported()) captureFaceViaLiveCamera();
    else {
      const faceName = faceNameInput.value.trim();
      if (!faceName) { showToast('⚠️ ابتدا نام/توضیح کوتاه سینه‌کار فعال را بنویسید'); return; }
      faceCameraInput.click();
    }
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
      el('div', { style: 'font-size:10.5px;color:var(--stone-500);margin-top:2px;margin-bottom:8px' },
        'هر عکس باید به یک دستگاه مشخص از لیست ماشین‌آلات پیش‌فرض معدن وصل باشد (نمای دور + شماره سریال). اگر دستگاه در لیست نیست، همان‌جا اضافه می‌شود و از این پس بخشی از لیست پیش‌فرض دائمی معدن خواهد بود.'),
      el('button', { class: 'btn-sm', style: 'width:100%;background:var(--patina-700);color:#fff', onclick: openEquipmentListModal }, '📋 ثبت عکس از لیست ماشین‌آلات'),
    );
  }

  return {
    mountWidget,
    getFaceBlobs: () => faceCaptures.map((c) => ({ blob: c.blob, faceName: c.faceName })),
    getEquipBlobs: () => [], // عکس‌های ماشین‌آلات حالا مستقیماً (با نام/سریال واقعی) از چک‌لیست ارسال می‌شوند، نه از اینجا
    hasFaceOrEquip: () => faceCaptures.length > 0,
    resetAll: () => {
      faceCaptures.forEach((c) => c.previewUrl && URL.revokeObjectURL(c.previewUrl));
      faceCaptures = [];
      drawFaceThumbs();
    },
  };
}

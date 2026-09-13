import {
  el, showToast, openImageViewer, openModal,
} from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getGeoLocation, isInsideMineBoundary } from '../../lib/geo.js';
import { watermarkPhoto, watermarkLinesForPhoto } from '../../lib/watermark.js';
import { captureLivePhoto, liveCameraSupported } from '../../lib/liveCameraCapture.js';
import { uploadTechFile } from '../../lib/storage.js';
import {
  queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender,
} from '../../lib/offlineQueue.js';

const LOCATION_TYPES = ['کارخانه', 'دپو محصول', 'دپو مواد اولیه'];

function todayLocalStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function sendProcessingSitePhotoPayload(p) {
  const photoUrl = await uploadTechFile(
    p.photoBlob, `site_${p.locationType}_${p.photoDate}.jpg`, p.mineName, 'site-photos', 'processing_site',
  );
  const { error } = await sb.from('processing_site_photos').insert([{
    mine_name: p.mineName,
    location_type: p.locationType,
    photo_date: p.photoDate,
    photo_url: photoUrl,
    lat: p.lat,
    lon: p.lon,
    inside_boundary: p.insideBoundary,
    submitted_by: p.submittedBy,
  }]);
  if (error) throw new Error(error.message);
}
registerSender('processingSitePhoto', sendProcessingSitePhotoPayload);

async function countTodayPhotos(mineName, locationType, dateStr) {
  const { count, error } = await sb.from('processing_site_photos').select('id', { count: 'exact', head: true })
    .eq('mine_name', mineName).eq('location_type', locationType).eq('photo_date', dateStr);
  return error ? 0 : (count || 0);
}

/**
 * عکس روزانه‌ی محل کارخانه/دپو محصول/دپو مواد اولیه — با واترمارک (GPS + مشخصات واحد فرآوری +
 * مسئول فنی)، دقیقاً هم‌الگو با عکس محل گمانه‌ی اکتشاف، فقط با سه نوع مکان ثابت به‌جای گمانه‌ی آزاد.
 * @param {object} mine
 * @param {string} nameField
 * @param {{ email: string, getProfile: () => {fullName:string, membershipNo:string} }} ctx
 */
export function openProcessingSitePhotoModal(mine, nameField, { email, getProfile }) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `📸 عکس روزانه محل واحد فرآوری — ${mineName}`, width: '420px' });

  const typeSelect = el('select', {}, LOCATION_TYPES.map((t) => el('option', { value: t }, t)));
  const statusBox = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:8px 0;min-height:18px' }, '');
  const thumbBox = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px' });
  const captures = [];

  async function refreshStatus() {
    const type = typeSelect.value;
    statusBox.textContent = '⏳ در حال بررسی وضعیت امروز...';
    const count = await countTodayPhotos(mineName, type, todayLocalStr());
    statusBox.innerHTML = '';
    statusBox.append(count > 0
      ? el('span', { style: 'color:var(--patina-700)' }, `✅ امروز ${count} عکس برای «${type}» ثبت شده — باز هم می‌توانید اضافه کنید`)
      : el('span', { style: 'color:var(--rust-700)' }, `🔴 هنوز امروز عکسی برای «${type}» ثبت نشده`));
  }
  typeSelect.addEventListener('change', refreshStatus);
  refreshStatus();

  function drawThumbs() {
    thumbBox.innerHTML = '';
    captures.forEach((c, i) => {
      thumbBox.append(el('div', { style: 'position:relative;width:76px;height:76px' }, [
        el('img', {
          src: c.previewUrl, style: 'width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--stone-300);cursor:pointer',
          onclick: () => openImageViewer(c.previewUrl),
        }),
        el('button', {
          style: 'position:absolute;top:-6px;left:-6px;background:var(--rust-600);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer',
          onclick: () => { const r = captures.splice(i, 1)[0]; if (r?.previewUrl) URL.revokeObjectURL(r.previewUrl); drawThumbs(); },
        }, '✕'),
      ]));
    });
  }

  function requireProfile() {
    const { fullName, membershipNo } = getProfile();
    if (!fullName || !membershipNo) {
      showToast('⚠️ ابتدا نام و شماره عضویت خود را از منو ☰ → «مشخصات و تنظیمات» وارد و ذخیره کنید (روی واترمارک عکس درج می‌شود)');
      return null;
    }
    return { fullName, membershipNo };
  }

  async function submitCapture(blob, coords) {
    const locationType = typeSelect.value;
    const previewUrl = URL.createObjectURL(blob);
    captures.push({ blob, previewUrl });
    drawThumbs();
    showToast('✅ عکس ثبت شد — در حال ارسال...');
    try {
      const insideBoundary = coords ? isInsideMineBoundary(coords, mine) : false;
      const { data: { session } } = await sb.auth.getSession();
      const payload = {
        mineName, locationType, photoDate: todayLocalStr(), photoBlob: blob,
        lat: coords?.latitude, lon: coords?.longitude, insideBoundary,
        submittedBy: session?.user?.email || email || '',
      };
      try {
        if (!navigator.onLine) throw new Error('OFFLINE');
        await sendProcessingSitePhotoPayload(payload);
        showToast('✅ عکس محل واحد فرآوری ثبت و ارسال شد');
      } catch (sendErr) {
        if (sendErr.message === 'OFFLINE' || isLikelyNetworkError(sendErr)) {
          await queueOfflineSubmission({ id: newQueueId('psp'), type: 'processingSitePhoto', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — عکس ذخیره شد و بعداً خودکار ارسال می‌شود');
        } else {
          throw sendErr;
        }
      }
      refreshStatus();
    } catch (err) {
      showToast(`⚠️ عکس گرفته شد ولی ارسال ناموفق بود: ${err.message}`);
    }
  }

  const legacyInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  legacyInput.addEventListener('change', async () => {
    const file = legacyInput.files[0];
    legacyInput.value = '';
    if (!file) return;
    const profile = requireProfile();
    if (!profile) return;
    showToast('⏳ در حال دریافت موقعیت مکانی...');
    try {
      const coords = await getGeoLocation();
      const watermarked = await watermarkPhoto(file, coords, mine, typeSelect.value, profile.fullName, profile.membershipNo, nameField);
      await submitCapture(watermarked, coords);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  const captureBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:10px' }, '📷 گرفتن عکس محل');
  captureBtn.addEventListener('click', async () => {
    const profile = requireProfile();
    if (!profile) return;
    if (liveCameraSupported()) {
      try {
        const { blob, coords } = await captureLivePhoto({
          buildLines: (c) => watermarkLinesForPhoto(c, mine, typeSelect.value, profile.fullName, profile.membershipNo, nameField),
          checkInside: (c) => isInsideMineBoundary(c, mine),
        });
        await submitCapture(blob, coords);
      } catch (err) {
        if (err.message === 'CANCELLED') return;
        showToast(`⚠️ دوربین زنده در دسترس نبود؛ از حالت معمولی استفاده می‌شود (${err.message})`);
        legacyInput.click();
      }
    } else {
      legacyInput.click();
    }
  });

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      'یک عکس روزانه از کارخانه/دپو محصول/دپو مواد اولیه با مختصات GPS و تاریخ روی خود عکس ثبت می‌شود.'),
    el('label', {}, 'محل'),
    typeSelect,
    statusBox,
    captureBtn,
    legacyInput,
    thumbBox,
  );
}

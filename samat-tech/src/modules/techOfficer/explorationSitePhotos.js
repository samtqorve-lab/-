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

// تاریخ محلی (نه UTC) — چون photo_date از نوع date است و باید با «روز صحرایی» واقعی کاربر یکی
// باشد، نه روزی که ساعت هماهنگ جهانی از آن رد شده (نزدیک نیمه‌شب همیشه قابل اختلاف است).
function todayLocalStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function sendExplorationSitePhotoPayload(p) {
  const photoUrl = await uploadTechFile(
    p.photoBlob, `site_${p.boreholeNo || 'general'}_${p.photoDate}.jpg`, p.mineName, 'site-photos', 'exploration_site',
  );
  const { error } = await sb.from('exploration_site_photos').insert([{
    mine_name: p.mineName,
    borehole_no: p.boreholeNo || null,
    photo_date: p.photoDate,
    photo_url: photoUrl,
    lat: p.lat,
    lon: p.lon,
    inside_boundary: p.insideBoundary,
    submitted_by: p.submittedBy,
  }]);
  if (error) throw new Error(error.message);
}
registerSender('explorationSitePhoto', sendExplorationSitePhotoPayload);

async function loadKnownBoreholes(mineName) {
  const { data, error } = await sb.from('exploration_boreholes')
    .select('borehole_no').eq('mine_name', mineName).not('borehole_no', 'is', null).limit(500);
  if (error || !data) return [];
  return [...new Set(data.map((r) => r.borehole_no).filter(Boolean))].sort();
}

async function countTodayPhotos(mineName, boreholeNo, dateStr) {
  let q = sb.from('exploration_site_photos').select('id', { count: 'exact', head: true })
    .eq('mine_name', mineName).eq('photo_date', dateStr);
  q = boreholeNo ? q.eq('borehole_no', boreholeNo) : q.is('borehole_no', null);
  const { count, error } = await q;
  return error ? 0 : (count || 0);
}

/**
 * عکس روزانه‌ی محل گمانه/محدوده اکتشافی — با واترمارک (GPS + مشخصات معدن + مسئول فنی)، دقیقاً
 * هم‌الگو با عکس ماشین‌آلات مسئول فنی استخراج. کلید هر عکس، گمانه (اختیاری) + تاریخ روز است، پس
 * می‌توان دید امروز برای کدام گمانه/محل هنوز عکس ثبت نشده.
 * @param {object} mine
 * @param {string} nameField
 * @param {{ email: string, getProfile: () => {fullName:string, membershipNo:string} }} ctx
 */
export function openExplorationSitePhotoModal(mine, nameField, { email, getProfile }) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `📸 عکس روزانه محل گمانه — ${mineName}`, width: '420px' });

  const boreholeSelect = el('select', {}, [el('option', { value: '' }, '— بدون گمانه خاص (عکس عمومی محدوده) —')]);
  const customInput = el('input', { type: 'text', placeholder: 'یا شماره گمانه/محل جدید را اینجا تایپ کنید', style: 'margin-top:6px' });
  const statusBox = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:8px 0;min-height:18px' }, 'در حال بررسی وضعیت امروز...');
  const thumbBox = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px' });
  const captures = [];

  function activeBoreholeNo() {
    return customInput.value.trim() || boreholeSelect.value || '';
  }

  async function refreshStatus() {
    const no = activeBoreholeNo();
    statusBox.textContent = '⏳ در حال بررسی وضعیت امروز...';
    const count = await countTodayPhotos(mineName, no, todayLocalStr());
    statusBox.innerHTML = '';
    statusBox.append(count > 0
      ? el('span', { style: 'color:var(--patina-700)' }, `✅ امروز ${count} عکس برای «${no || 'محدوده عمومی'}» ثبت شده — باز هم می‌توانید اضافه کنید`)
      : el('span', { style: 'color:var(--rust-700)' }, `🔴 هنوز امروز عکسی برای «${no || 'محدوده عمومی'}» ثبت نشده`));
  }

  boreholeSelect.addEventListener('change', () => { customInput.value = ''; refreshStatus(); });
  customInput.addEventListener('change', refreshStatus);

  loadKnownBoreholes(mineName).then((nos) => {
    nos.forEach((no) => boreholeSelect.append(el('option', { value: no }, `گمانه/محل ${no}`)));
    refreshStatus();
  });

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
    const boreholeNo = activeBoreholeNo();
    const previewUrl = URL.createObjectURL(blob);
    captures.push({ blob, previewUrl });
    drawThumbs();
    showToast('✅ عکس ثبت شد — در حال ارسال...');
    try {
      const insideBoundary = coords ? isInsideMineBoundary(coords, mine) : false;
      const { data: { session } } = await sb.auth.getSession();
      const payload = {
        mineName, boreholeNo, photoDate: todayLocalStr(), photoBlob: blob,
        lat: coords?.latitude, lon: coords?.longitude, insideBoundary,
        submittedBy: session?.user?.email || email || '',
      };
      try {
        if (!navigator.onLine) throw new Error('OFFLINE');
        await sendExplorationSitePhotoPayload(payload);
        showToast('✅ عکس محل گمانه ثبت و ارسال شد');
      } catch (sendErr) {
        if (sendErr.message === 'OFFLINE' || isLikelyNetworkError(sendErr)) {
          await queueOfflineSubmission({ id: newQueueId('esp'), type: 'explorationSitePhoto', payload, queuedAt: Date.now() });
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
      const boreholeNo = activeBoreholeNo();
      const watermarked = await watermarkPhoto(
        file, coords, mine, `محل گمانه${boreholeNo ? ` «${boreholeNo}»` : ' (عمومی محدوده)'}`,
        profile.fullName, profile.membershipNo, nameField,
      );
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
        const boreholeNo = activeBoreholeNo();
        const { blob, coords } = await captureLivePhoto({
          buildLines: (c) => watermarkLinesForPhoto(c, mine, `محل گمانه${boreholeNo ? ` «${boreholeNo}»` : ' (عمومی محدوده)'}`, profile.fullName, profile.membershipNo, nameField),
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
      'یک عکس روزانه از محل هر گمانه (یا کل محدوده) با مختصات GPS و تاریخ روی خود عکس ثبت می‌شود.'),
    el('label', {}, 'گمانه/محل'),
    boreholeSelect,
    customInput,
    statusBox,
    captureBtn,
    legacyInput,
    thumbBox,
  );
}

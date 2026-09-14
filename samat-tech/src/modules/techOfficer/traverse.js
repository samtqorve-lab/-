import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getGeoLocation, haversineMeters } from '../../lib/geo.js';
import {
  queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender,
} from '../../lib/offlineQueue.js';

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendTraversePayload(payload) {
  const { error } = await sb.from('exploration_traverses').insert([payload]);
  if (error) throw new Error(error.message);
}
registerSender('explorationTraverse', sendTraversePayload);

/**
 * مسیر تراورس اکتشافی — ثبت دستیِ نقاط GPS در طول یک مسیر پیمایش (نه ردیابی خودکار پیوسته،
 * چون ردیابی پیوسته باتری را سریع خالی می‌کند و روی گوشی معمولی مسئول فنی قابل‌اعتماد نیست)؛
 * با هر بار زدن «ثبت نقطه فعلی»، یک نقطه به مسیر اضافه و فاصله‌ی تجمعی (با فرمول هاورساین
 * موجود در پروژه) به‌روزرسانی می‌شود.
 * @param {object} mine
 * @param {string} nameField
 * @param {{ email?: string }} ctx
 */
export function openTraverseModal(mine, nameField, { email } = {}) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `🚶 مسیر تراورس اکتشافی — ${mineName}`, width: '420px' });

  const nameInput = el('input', { type: 'text', placeholder: 'مثلاً: تراورس شمال محدوده' });
  const statusBox = el('div', { style: 'font-size:12px;color:var(--stone-600);margin:8px 0' }, 'مسیر هنوز شروع نشده');
  const distanceBox = el('div', { style: 'font-size:16px;font-weight:700;color:var(--patina-700)' }, '');
  const pointsListBox = el('div', { style: 'margin-top:8px;max-height:160px;overflow-y:auto' });
  const errBox = el('div', { class: 'gate-err' });

  let points = [];
  let totalDistance = 0;

  function renderPoints() {
    pointsListBox.innerHTML = '';
    points.forEach((p, i) => {
      const segDist = i > 0 ? haversineMeters(points[i - 1].lat, points[i - 1].lon, p.lat, p.lon) : 0;
      pointsListBox.append(el('div', { style: 'font-size:11px;color:var(--stone-500);padding:2px 0;border-bottom:1px solid var(--stone-100)' },
        `${i + 1}. ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${i > 0 ? ` (+${segDist.toFixed(0)} متر)` : ''}`));
    });
    distanceBox.textContent = points.length ? `مسافت تجمعی: ${totalDistance.toFixed(0)} متر — ${points.length} نقطه` : '';
  }

  const startBtn = el('button', { class: 'btn btn-primary', style: 'width:100%' }, '▶️ شروع مسیر جدید');
  const addPointBtn = el('button', { class: 'btn-sm', style: 'width:100%;margin-top:8px;background:var(--schist-100);color:var(--schist-600);display:none' }, '📍 ثبت نقطه فعلی');
  const finishBtn = el('button', { class: 'btn-sm', style: 'width:100%;margin-top:8px;background:var(--patina-600);color:#fff;display:none' }, '🏁 پایان و ذخیره مسیر');
  const cancelBtn = el('button', { class: 'btn-sm', style: 'width:100%;margin-top:4px;background:var(--rust-100);color:var(--rust-700);display:none' }, '✖️ لغو این مسیر');

  startBtn.addEventListener('click', () => {
    if (!nameInput.value.trim()) { errBox.textContent = 'نام مسیر را وارد کنید'; return; }
    errBox.textContent = '';
    points = []; totalDistance = 0;
    nameInput.disabled = true;
    startBtn.style.display = 'none';
    addPointBtn.style.display = ''; finishBtn.style.display = ''; cancelBtn.style.display = '';
    statusBox.textContent = '🟢 مسیر در حال ثبت — با هر نقطه‌ی مهم، «ثبت نقطه فعلی» را بزنید';
    renderPoints();
  });

  addPointBtn.addEventListener('click', async () => {
    addPointBtn.disabled = true; addPointBtn.textContent = '⏳ در حال دریافت موقعیت...';
    try {
      const coords = await getGeoLocation();
      const p = { lat: coords.latitude, lon: coords.longitude, t: new Date().toISOString() };
      if (points.length) totalDistance += haversineMeters(points[points.length - 1].lat, points[points.length - 1].lon, p.lat, p.lon);
      points.push(p);
      renderPoints();
      showToast(`✅ نقطه ${points.length} ثبت شد`);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
    addPointBtn.disabled = false; addPointBtn.textContent = '📍 ثبت نقطه فعلی';
  });

  cancelBtn.addEventListener('click', () => {
    points = []; totalDistance = 0;
    nameInput.disabled = false; nameInput.value = '';
    startBtn.style.display = '';
    addPointBtn.style.display = 'none'; finishBtn.style.display = 'none'; cancelBtn.style.display = 'none';
    statusBox.textContent = 'مسیر هنوز شروع نشده';
    renderPoints();
  });

  finishBtn.addEventListener('click', async () => {
    if (points.length < 2) { errBox.textContent = 'حداقل ۲ نقطه لازم است تا مسیر ذخیره شود'; return; }
    errBox.textContent = '';
    finishBtn.disabled = true; finishBtn.textContent = '⏳ در حال ثبت...';
    const payload = {
      mine_name: mineName,
      traverse_name: nameInput.value.trim(),
      points,
      total_distance_m: Math.round(totalDistance),
      started_by: email || await currentUserEmail(),
      ended_at: new Date().toISOString(),
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendTraversePayload(payload);
      showToast(`✅ مسیر «${payload.traverse_name}» با ${points.length} نقطه و ${payload.total_distance_m} متر ثبت شد`);
      cancelBtn.click();
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('etr'), type: 'explorationTraverse', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — مسیر ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
          cancelBtn.click();
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    }
    finishBtn.disabled = false; finishBtn.textContent = '🏁 پایان و ذخیره مسیر';
  });

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      'برای ثبت نیازی به ردیابی پیوسته نیست — فقط سر هر نقطه‌ی مهمِ مسیر (تغییر جهت، نقطه‌ی برداشت و...) دکمه‌ی «ثبت نقطه فعلی» را بزنید.'),
    el('label', {}, 'نام مسیر'), nameInput,
    startBtn,
    statusBox,
    addPointBtn, finishBtn, cancelBtn,
    distanceBox,
    pointsListBox,
    errBox,
  );
}

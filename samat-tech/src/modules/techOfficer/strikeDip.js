import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getGeoLocation } from '../../lib/geo.js';
import {
  queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender,
} from '../../lib/offlineQueue.js';

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendStrikeDipPayload(payload) {
  const { error } = await sb.from('exploration_strike_dip').insert([payload]);
  if (error) throw new Error(error.message);
}
registerSender('explorationStrikeDip', sendStrikeDipPayload);

async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    const res = await DeviceOrientationEvent.requestPermission();
    if (res !== 'granted') throw new Error('دسترسی به سنسور جهت‌یابی رد شد');
  }
}

/**
 * ابزار شیب/امتداد (Strike & Dip) با سنسور جهت‌یابی گوشی — روش دو-مرحله‌ای استاندارد که اکثر
 * اپ‌های قطب‌نمای زمین‌شناسی هم استفاده می‌کنند:
 *   ۱) «ثبت امتداد»: گوشی را تخت روی سطح لایه، در امتداد خط افق آن سطح بگیرید → از قطب‌نمای
 *      گوشی (alpha/webkitCompassHeading) امتداد خوانده می‌شود.
 *   ۲) «ثبت شیب»: گوشی را روی سطح لایه، در جهت شیب (پایین‌ترین جهت سطح) بگیرید → از زاویه‌ی
 *      کج‌شدگی گوشی (beta) شیب خوانده می‌شود.
 * ⚠️ سنسورهای گوشی حدوداً ۵ تا ۱۰ درجه خطا دارند؛ برای گزارش رسمی مهندسی همیشه با قطب‌نمای
 * زمین‌شناسی واقعی مقایسه/تایید شود. این ابزار جایگزین قطب‌نمای زمین‌شناسی نیست، مکملِ سریع آن است.
 * @param {object} mine
 * @param {string} nameField
 * @param {{ email?: string }} ctx
 */
export function openStrikeDipModal(mine, nameField, { email } = {}) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `📐 شیب و امتداد لایه — ${mineName}`, width: '400px' });

  const boreholeInput = el('input', { type: 'text', placeholder: 'شماره گمانه/محل (اختیاری)' });
  const strikeReadout = el('div', { style: 'font-size:22px;font-weight:700;text-align:center;color:var(--patina-700)' }, '—');
  const dipReadout = el('div', { style: 'font-size:22px;font-weight:700;text-align:center;color:var(--fluorite-700)' }, '—');
  const liveHeading = el('div', { style: 'font-size:12px;color:var(--stone-500);text-align:center;min-height:16px' }, '');
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });

  let strikeValue = null;
  let dipValue = null;
  let orientationHandler = null;
  let mode = null; // 'strike' | 'dip' | null

  function stopListening() {
    if (orientationHandler) {
      window.removeEventListener('deviceorientation', orientationHandler);
      orientationHandler = null;
    }
    mode = null;
    liveHeading.textContent = '';
  }

  function currentHeading(e) {
    // iOS Safari: webkitCompassHeading زاویه‌ی واقعی نسبت به شمال (ساعتگرد) را مستقیم می‌دهد.
    // مرورگرهای دیگر (عمدتاً اندروید): alpha را باید از ۳۶۰ کم کرد تا تقریباً هم‌جهت شود —
    // این یک تقریب رایج است، نه استاندارد دقیق، چون alpha به کالیبراسیون مغناطیسی دستگاه وابسته است.
    if (typeof e.webkitCompassHeading === 'number') return e.webkitCompassHeading;
    if (typeof e.alpha === 'number') return (360 - e.alpha) % 360;
    return null;
  }

  async function startCapture(captureMode, instructionText) {
    errBox.textContent = '';
    try {
      await requestOrientationPermission();
    } catch (err) {
      errBox.textContent = err.message;
      return;
    }
    stopListening();
    mode = captureMode;
    showToast(instructionText);
    orientationHandler = (e) => {
      if (mode === 'strike') {
        const h = currentHeading(e);
        if (h != null) liveHeading.textContent = `امتداد لحظه‌ای: ${h.toFixed(0)}°`;
      } else if (mode === 'dip') {
        const d = typeof e.beta === 'number' ? Math.min(90, Math.abs(e.beta)) : null;
        if (d != null) liveHeading.textContent = `شیب لحظه‌ای: ${d.toFixed(0)}°`;
      }
    };
    window.addEventListener('deviceorientation', orientationHandler);
  }

  const strikeBtn = el('button', {
    class: 'btn-sm', style: 'width:100%;background:var(--patina-100);color:var(--patina-700)',
    onclick: () => startCapture('strike', '📱 گوشی را تخت روی سطح لایه، در امتداد خط افق آن بگیرید، سپس «ثبت مقدار» را بزنید'),
  }, '📍 شروع ثبت امتداد (Strike)');
  const captureStrikeBtn = el('button', {
    class: 'btn-sm', style: 'width:100%;margin-top:4px',
    onclick: () => {
      const match = liveHeading.textContent.match(/[\d.]+/);
      if (!match) { showToast('⚠️ ابتدا «شروع ثبت امتداد» را بزنید و چند ثانیه صبر کنید'); return; }
      strikeValue = parseFloat(match[0]);
      strikeReadout.textContent = `${strikeValue.toFixed(0)}°`;
      stopListening();
    },
  }, '✅ ثبت مقدار امتداد');

  const dipBtn = el('button', {
    class: 'btn-sm', style: 'width:100%;background:var(--fluorite-100);color:var(--fluorite-700);margin-top:10px',
    onclick: () => startCapture('dip', '📱 گوشی را روی سطح لایه، در جهت شیب (پایین‌ترین جهت) بگیرید، سپس «ثبت مقدار» را بزنید'),
  }, '📐 شروع ثبت شیب (Dip)');
  const captureDipBtn = el('button', {
    class: 'btn-sm', style: 'width:100%;margin-top:4px',
    onclick: () => {
      const match = liveHeading.textContent.match(/[\d.]+/);
      if (!match) { showToast('⚠️ ابتدا «شروع ثبت شیب» را بزنید و چند ثانیه صبر کنید'); return; }
      dipValue = parseFloat(match[0]);
      dipReadout.textContent = `${dipValue.toFixed(0)}°`;
      stopListening();
    },
  }, '✅ ثبت مقدار شیب');

  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:14px' }, '💾 ذخیره اندازه‌گیری');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (strikeValue == null || dipValue == null) {
      errBox.textContent = 'هم امتداد و هم شیب را ثبت کنید';
      return;
    }
    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    let coords = null;
    try { coords = await getGeoLocation(); } catch { /* موقعیت اختیاری است */ }
    const payload = {
      mine_name: mineName,
      borehole_no: boreholeInput.value.trim() || null,
      strike_deg: strikeValue,
      dip_deg: dipValue,
      lat: coords?.latitude ?? null,
      lon: coords?.longitude ?? null,
      measured_by: email || await currentUserEmail(),
      notes: notesInput.value.trim() || null,
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendStrikeDipPayload(payload);
      showToast('✅ شیب/امتداد ثبت شد');
      strikeValue = null; dipValue = null;
      strikeReadout.textContent = '—'; dipReadout.textContent = '—'; notesInput.value = '';
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('esd'), type: 'explorationStrikeDip', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    }
    btn.disabled = false; btn.textContent = '💾 ذخیره اندازه‌گیری';
  });

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      '⚠️ سنسور گوشی تقریبی است (خطای احتمالی ۵ تا ۱۰ درجه) — برای گزارش رسمی با قطب‌نمای زمین‌شناسی مقایسه کنید.'),
    el('label', {}, 'گمانه/محل (اختیاری)'), boreholeInput,
    el('div', { style: 'display:flex;gap:10px;margin:10px 0' }, [
      el('div', { style: 'flex:1;text-align:center' }, [el('div', { style: 'font-size:11px;color:var(--stone-500)' }, 'امتداد'), strikeReadout]),
      el('div', { style: 'flex:1;text-align:center' }, [el('div', { style: 'font-size:11px;color:var(--stone-500)' }, 'شیب'), dipReadout]),
    ]),
    liveHeading,
    strikeBtn, captureStrikeBtn,
    dipBtn, captureDipBtn,
    el('label', { style: 'margin-top:10px' }, 'توضیحات'), notesInput,
    errBox, btn,
  );
}

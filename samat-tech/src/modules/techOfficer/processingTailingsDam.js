import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { recentPeriodOptions } from '../../lib/jalali.js';
import { getGeoLocation, isInsideMineBoundary } from '../../lib/geo.js';
import {
  queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender,
} from '../../lib/offlineQueue.js';

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendTailingsDamPayload(payload) {
  const { error } = await sb.from('processing_tailings_dam').insert([payload]);
  if (error) throw new Error(error.message);
}
registerSender('processingTailingsDam', sendTailingsDamPayload);

/**
 * مدیریت باطله (سد/دپوی باطله) — ثبت دوره‌ای تناژ باطله‌ی دپوشده، برآورد ظرفیت باقی‌مانده‌ی سد،
 * و موقعیت GPS دپو (برای پایش زیست‌محیطی و پیشگیری از خطر پرشدن سد). روی جدول جدید
 * processing_tailings_dam می‌نویسد.
 * @param {object} mine
 * @param {string} nameField
 */
export function openTailingsDamModal(mine, nameField) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `🏔️ مدیریت باطله — ${mineName}`, width: '400px' });

  const periodSelect = el('select', {}, recentPeriodOptions(6).map((p) => el('option', { value: p }, p)));
  const tonnageInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'تن باطله‌ی دپوشده در این دوره' });
  const capacityInput = el('input', { type: 'number', min: '0', max: '100', step: '0.1', placeholder: '٪ ظرفیت خالی باقی‌مانده سد (برآوردی)' });
  const gpsStatus = el('div', { style: 'font-size:11px;color:var(--stone-500);margin:4px 0' }, '📍 موقعیت دپو هنوز ثبت نشده');
  const notesInput = el('textarea', { rows: '2', placeholder: 'وضعیت پوشش/نشت/فرسایش دیواره و...' });
  const errBox = el('div', { class: 'gate-err' });
  let coords = null;

  const gpsBtn = el('button', {
    class: 'btn-sm', style: 'width:100%;background:var(--schist-100);color:var(--schist-600)',
    onclick: async () => {
      gpsStatus.textContent = '⏳ در حال دریافت موقعیت...';
      try {
        coords = await getGeoLocation();
        const inside = isInsideMineBoundary(coords, mine);
        gpsStatus.textContent = `📍 ثبت شد: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}${inside ? ' (داخل محدوده)' : ' (خارج از محدوده مجوز)'}`;
      } catch (err) { gpsStatus.textContent = `⚠️ ${err.message}`; }
    },
  }, '📍 ثبت موقعیت دپوی باطله با GPS');

  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ثبت گزارش باطله');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const tonnage = tonnageInput.value ? parseFloat(tonnageInput.value) : null;
    const capacity = capacityInput.value ? parseFloat(capacityInput.value) : null;
    if (!tonnage && !capacity) {
      errBox.textContent = 'حداقل تناژ باطله یا درصد ظرفیت باقی‌مانده را وارد کنید';
      return;
    }
    if (capacity !== null && capacity <= 15) {
      showToast('⚠️ توجه: ظرفیت باقی‌مانده‌ی سد باطله کمتر از ۱۵٪ گزارش شده — پیگیری فوری لازم است');
    }

    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    const payload = {
      mine_name: mineName,
      submitted_by: await currentUserEmail(),
      period: periodSelect.value,
      deposited_tonnage: tonnage,
      remaining_capacity_percent: capacity,
      lat: coords?.latitude ?? null,
      lon: coords?.longitude ?? null,
      notes: notesInput.value.trim() || null,
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendTailingsDamPayload(payload);
      showToast('✅ گزارش باطله ثبت شد');
      tonnageInput.value = ''; capacityInput.value = ''; notesInput.value = '';
      coords = null; gpsStatus.textContent = '📍 موقعیت دپو هنوز ثبت نشده';
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('ptd'), type: 'processingTailingsDam', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    }
    btn.disabled = false; btn.textContent = '✅ ثبت گزارش باطله';
  });

  body.append(
    el('label', {}, 'دوره'), periodSelect,
    el('label', {}, 'تناژ باطله‌ی دپوشده'), tonnageInput,
    el('label', {}, 'درصد ظرفیت خالی باقی‌مانده سد'), capacityInput,
    gpsBtn, gpsStatus,
    el('label', {}, 'توضیحات'), notesInput,
    errBox, btn,
  );
}

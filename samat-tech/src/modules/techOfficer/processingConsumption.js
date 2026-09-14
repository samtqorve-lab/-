import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { recentPeriodOptions } from '../../lib/jalali.js';
import {
  queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender,
} from '../../lib/offlineQueue.js';

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendConsumptionPayload(payload) {
  const { error } = await sb.from('processing_consumption').insert([payload]);
  if (error) throw new Error(error.message);
}
registerSender('processingConsumption', sendConsumptionPayload);

/**
 * ثبت مصرف دوره‌ای مواد شیمیایی/فلوکولانت و انرژی (برق/سوخت) کارخانه فرآوری — روی جدول
 * processing_consumption می‌نویسد (هم‌الگو با processing_reports).
 * @param {object} mine
 * @param {string} nameField
 */
export function openProcessingConsumptionModal(mine, nameField) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `⚡ مصرف مواد و انرژی — ${mineName}`, width: '400px' });

  const periodSelect = el('select', {}, recentPeriodOptions(6).map((p) => el('option', { value: p }, p)));
  const chemicalMaterialInput = el('input', { type: 'text', placeholder: 'مثلاً فلوکولانت، آهک، سیانور و...' });
  const chemicalAmountInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'کیلوگرم' });
  const electricityInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'کیلووات‌ساعت' });
  const fuelInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'لیتر' });
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });

  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ثبت مصرف این دوره');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const chemicalAmount = chemicalAmountInput.value ? parseFloat(chemicalAmountInput.value) : null;
    const electricity = electricityInput.value ? parseFloat(electricityInput.value) : null;
    const fuel = fuelInput.value ? parseFloat(fuelInput.value) : null;
    if (!chemicalAmount && !electricity && !fuel) {
      errBox.textContent = 'حداقل یکی از فیلدهای مصرف مواد شیمیایی/برق/سوخت را وارد کنید';
      return;
    }
    if (chemicalAmount && !chemicalMaterialInput.value.trim()) {
      errBox.textContent = 'نام ماده شیمیایی را هم وارد کنید';
      return;
    }

    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    const payload = {
      mine_name: mineName,
      submitted_by: await currentUserEmail(),
      period: periodSelect.value,
      chemical_material: chemicalMaterialInput.value.trim() || null,
      chemical_amount_kg: chemicalAmount,
      electricity_kwh: electricity,
      fuel_liters: fuel,
      notes: notesInput.value.trim() || null,
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendConsumptionPayload(payload);
      showToast('✅ مصرف این دوره ثبت شد');
      chemicalMaterialInput.value = ''; chemicalAmountInput.value = ''; electricityInput.value = ''; fuelInput.value = ''; notesInput.value = '';
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('pc'), type: 'processingConsumption', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    }
    btn.disabled = false; btn.textContent = '✅ ثبت مصرف این دوره';
  });

  body.append(
    el('label', {}, 'دوره'), periodSelect,
    el('label', {}, 'نام ماده شیمیایی/فلوکولانت'), chemicalMaterialInput,
    el('label', {}, 'مقدار مصرف ماده شیمیایی'), chemicalAmountInput,
    el('label', {}, 'مصرف برق'), electricityInput,
    el('label', {}, 'مصرف سوخت'), fuelInput,
    el('label', {}, 'توضیحات'), notesInput,
    errBox, btn,
  );
}

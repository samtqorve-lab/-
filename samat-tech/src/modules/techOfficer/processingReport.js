import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { recentPeriodOptions } from '../../lib/jalali.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendProcessingReportPayload(payload) {
  const { error } = await sb.from('processing_reports').insert([payload]);
  if (error) throw new Error(error.message);
}
registerSender('processingReport', sendProcessingReportPayload);

/**
 * گزارش دوره‌ای خوراک/محصول/بازیابی — مخصوص تخصص «فرآوری»، جایگزین فرم عمومی «تولید و عیار»
 * (که برای استخراج طراحی شده بود و برای واحد فرآوری خوراک/محصول/بازیابی/باطله را جدا نمی‌کرد).
 * روی جدول جدید processing_reports می‌نویسد.
 *
 * موازنه جرمی: وقتی عیار خوراک و محصول هر دو وارد شده باشند، بازیابی با فرمول استاندارد
 * دو-محصولیِ متالورژی (بر پایه‌ی عیار) محاسبه می‌شود که دقیق‌تر از نسبت وزنی خام است؛
 * در غیر این صورت (نبود عیار) به همان نسبت ساده‌ی تناژ محصول به خوراک برمی‌گردد.
 * علاوه‌بر آن، اگر تناژ باطله هم وارد شود، با مقدار محاسبه‌شده از افت جرمی (خوراک−محصول)
 * مقایسه و در صورت اختلاف بیش از ۵٪ هشدار غیرمسدودکننده نمایش داده می‌شود.
 * @param {object} mine
 * @param {string} nameField
 * @param {string} department
 */
export function openProcessingReportModal(mine, nameField, department) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `⚗️ گزارش خوراک/محصول/بازیابی — ${mineName}`, width: '400px' });

  const periodSelect = el('select', {}, recentPeriodOptions(6).map((p) => el('option', { value: p }, p)));
  const feedMaterialInput = el('input', { type: 'text', placeholder: 'مثلاً: سنگ آهن دانه‌بندی‌شده' });
  const feedTonnageInput = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'تن' });
  const feedGradeInput = el('input', { type: 'number', min: '0', max: '100', step: '0.01', placeholder: '٪' });
  const productTonnageInput = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'تن' });
  const productGradeInput = el('input', { type: 'number', min: '0', max: '100', step: '0.01', placeholder: '٪' });
  const recoveryInput = el('input', { type: 'number', min: '0', max: '100', step: '0.01', placeholder: '٪ — اختیاری، در صورت خالی‌بودن از موازنه جرمی محاسبه می‌شود' });
  const tailingsInput = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'تن — اختیاری' });
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });
  const balanceHint = el('div', { style: 'font-size:11px;color:var(--stone-500);margin-top:2px;min-height:14px' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ثبت گزارش');

  function computeRecovery(feedTonnage, productTonnage) {
    const feedGrade = parseFloat(feedGradeInput.value);
    const productGrade = parseFloat(productGradeInput.value);
    if (feedTonnage > 0 && feedGrade > 0 && productGrade > 0 && !Number.isNaN(feedGrade) && !Number.isNaN(productGrade)) {
      // فرمول استاندارد موازنه جرمی دو-محصولی: R% = (تناژ محصول × عیار محصول) / (تناژ خوراک × عیار خوراک)
      return Math.round(((productTonnage * productGrade) / (feedTonnage * feedGrade)) * 10000) / 100;
    }
    if (feedTonnage > 0) return Math.round((productTonnage / feedTonnage) * 10000) / 100; // بدون عیار: نسبت وزنی ساده
    return null;
  }

  function updateBalanceHint() {
    const feedTonnage = parseFloat(feedTonnageInput.value);
    const productTonnage = parseFloat(productTonnageInput.value);
    const enteredTailings = parseFloat(tailingsInput.value);
    balanceHint.textContent = '';
    if (Number.isNaN(feedTonnage) || Number.isNaN(productTonnage) || feedTonnage <= 0) return;
    const calcTailings = feedTonnage - productTonnage;
    if (!Number.isNaN(enteredTailings) && enteredTailings >= 0) {
      const diffPercent = calcTailings > 0 ? Math.abs(enteredTailings - calcTailings) / calcTailings * 100 : 0;
      if (diffPercent > 5) {
        balanceHint.innerHTML = `⚠️ موازنه جرمی همخوان نیست: خوراک−محصول = ${calcTailings.toFixed(1)} تن، ولی باطله وارد‌شده ${enteredTailings.toFixed(1)} تن است (اختلاف ${diffPercent.toFixed(0)}٪)`;
        balanceHint.style.color = 'var(--rust-700)';
        return;
      }
    }
    balanceHint.textContent = `موازنه جرمی: باطله محاسبه‌شده ≈ ${calcTailings.toFixed(1)} تن`;
    balanceHint.style.color = 'var(--stone-500)';
  }
  [feedTonnageInput, productTonnageInput, tailingsInput, feedGradeInput, productGradeInput].forEach((inp) => {
    inp.addEventListener('input', updateBalanceHint);
  });

  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const feedTonnage = parseFloat(feedTonnageInput.value);
    const productTonnage = parseFloat(productTonnageInput.value);
    if (Number.isNaN(feedTonnage) || feedTonnage < 0) { errBox.textContent = 'تناژ خوراک ورودی را درست وارد کنید'; return; }
    if (Number.isNaN(productTonnage) || productTonnage < 0) { errBox.textContent = 'تناژ محصول خروجی را درست وارد کنید'; return; }

    const recovery = recoveryInput.value ? parseFloat(recoveryInput.value) : computeRecovery(feedTonnage, productTonnage);

    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    const payload = {
      mine_name: mineName,
      department,
      submitted_by: await currentUserEmail(),
      period: periodSelect.value,
      feed_material: feedMaterialInput.value.trim() || null,
      feed_tonnage: feedTonnage,
      feed_grade_percent: feedGradeInput.value ? parseFloat(feedGradeInput.value) : null,
      product_tonnage: productTonnage,
      product_grade_percent: productGradeInput.value ? parseFloat(productGradeInput.value) : null,
      recovery_percent: recovery,
      tailings_tonnage: tailingsInput.value ? parseFloat(tailingsInput.value) : null,
      notes: notesInput.value.trim() || null,
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendProcessingReportPayload(payload);
      showToast('✅ گزارش خوراک/محصول/بازیابی ثبت شد');
      feedMaterialInput.value = ''; feedTonnageInput.value = ''; feedGradeInput.value = '';
      productTonnageInput.value = ''; productGradeInput.value = ''; recoveryInput.value = '';
      tailingsInput.value = ''; notesInput.value = ''; balanceHint.textContent = '';
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('prc'), type: 'processingReport', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — گزارش ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    }
    btn.disabled = false; btn.textContent = '✅ ثبت گزارش';
  });

  body.append(
    el('label', {}, 'دوره'), periodSelect,
    el('label', {}, 'ماده معدنی/خوراک ورودی'), feedMaterialInput,
    el('div', { style: 'display:flex;gap:6px' }, [
      el('div', { style: 'flex:1' }, [el('label', {}, 'تناژ خوراک'), feedTonnageInput]),
      el('div', { style: 'flex:1' }, [el('label', {}, 'عیار خوراک ٪'), feedGradeInput]),
    ]),
    el('div', { style: 'display:flex;gap:6px' }, [
      el('div', { style: 'flex:1' }, [el('label', {}, 'تناژ محصول'), productTonnageInput]),
      el('div', { style: 'flex:1' }, [el('label', {}, 'عیار محصول ٪'), productGradeInput]),
    ]),
    el('label', {}, 'درصد بازیابی'), recoveryInput,
    el('label', {}, 'تناژ باطله (اختیاری)'), tailingsInput,
    balanceHint,
    el('label', {}, 'توضیحات'), notesInput,
    errBox, btn,
  );
}

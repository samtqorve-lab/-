import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { recentPeriodOptions } from '../../lib/jalali.js';
import { formalizePersianText } from '../../lib/formalize.js';
import {
  queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender,
} from '../../lib/offlineQueue.js';

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendExplorationProgressPayload(payload) {
  const { error } = await sb.from('exploration_progress_reports').insert([payload]);
  if (error) throw new Error(error.message);
}
registerSender('explorationProgress', sendExplorationProgressPayload);

/**
 * گزارش پیشرفت دوره‌ای اکتشاف — مخصوص تخصص «اکتشاف»؛ همان جایگاه «گزارش خوراک/محصول/بازیابی»ِ
 * فرآوری را برای اکتشاف پر می‌کند: تعداد گمانه/ترانشه‌ی این دوره، متراژ حفاری تجمعی، درصد
 * پیشرفت نسبت به برنامه، موانع/مشکلات و برنامه‌ی دوره‌ی بعد. روی جدول جدید
 * exploration_progress_reports می‌نویسد (هم‌الگو با processing_reports).
 * @param {object} mine
 * @param {string} nameField
 */
export function openExplorationProgressModal(mine, nameField) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `📈 گزارش پیشرفت اکتشاف — ${mineName}`, width: '400px' });

  const periodSelect = el('select', {}, recentPeriodOptions(6).map((p) => el('option', { value: p }, p)));
  const boreholesCountInput = el('input', { type: 'number', min: '0', step: '1', placeholder: 'تعداد' });
  const totalMeterageInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'متر' });
  const progressPercentInput = el('input', { type: 'number', min: '0', max: '100', step: '0.1', placeholder: '٪ نسبت به برنامه مصوب' });
  const obstaclesInput = el('textarea', { rows: '2', placeholder: 'مثلاً تاخیر در تامین قطعات دستگاه حفاری، شرایط جوی، دسترسی جاده و...' });
  const nextPlanInput = el('textarea', { rows: '2', placeholder: 'برنامه‌ی پیش‌بینی‌شده برای دوره‌ی بعد' });
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });

  const formalizeObstaclesBtn = el('button', {
    class: 'btn-sm', style: 'background:var(--fluorite-100);color:var(--fluorite-700);margin-top:4px',
    onclick: () => {
      const text = obstaclesInput.value.trim();
      if (!text) { showToast('⚠️ ابتدا متن را بنویسید'); return; }
      obstaclesInput.value = formalizePersianText(text);
      showToast('✅ متن رسمی‌نویسی شد');
    },
  }, '✨ رسمی‌نویسی خودکار');

  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ثبت گزارش پیشرفت');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const boreholesCount = boreholesCountInput.value ? parseInt(boreholesCountInput.value, 10) : null;
    const totalMeterage = totalMeterageInput.value ? parseFloat(totalMeterageInput.value) : null;
    const progressPercent = progressPercentInput.value ? parseFloat(progressPercentInput.value) : null;
    if (!boreholesCountInput.value && !totalMeterageInput.value && !progressPercentInput.value) {
      errBox.textContent = 'حداقل یکی از فیلدهای تعداد گمانه/متراژ/درصد پیشرفت را وارد کنید';
      return;
    }
    if (progressPercent !== null && (Number.isNaN(progressPercent) || progressPercent < 0 || progressPercent > 100)) {
      errBox.textContent = 'درصد پیشرفت باید بین ۰ تا ۱۰۰ باشد';
      return;
    }

    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    const payload = {
      mine_name: mineName,
      submitted_by: await currentUserEmail(),
      period: periodSelect.value,
      boreholes_count: boreholesCount,
      total_meterage: totalMeterage,
      progress_percent: progressPercent,
      obstacles: obstaclesInput.value.trim() || null,
      next_plan: nextPlanInput.value.trim() || null,
      notes: notesInput.value.trim() || null,
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendExplorationProgressPayload(payload);
      showToast('✅ گزارش پیشرفت اکتشاف ثبت شد');
      boreholesCountInput.value = ''; totalMeterageInput.value = ''; progressPercentInput.value = '';
      obstaclesInput.value = ''; nextPlanInput.value = ''; notesInput.value = '';
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('exp'), type: 'explorationProgress', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — گزارش ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    }
    btn.disabled = false; btn.textContent = '✅ ثبت گزارش پیشرفت';
  });

  body.append(
    el('label', {}, 'دوره'), periodSelect,
    el('label', {}, 'تعداد گمانه/ترانشه‌ی این دوره'), boreholesCountInput,
    el('label', {}, 'متراژ حفاری تجمعی این دوره (متر)'), totalMeterageInput,
    el('label', {}, 'درصد پیشرفت نسبت به برنامه مصوب'), progressPercentInput,
    el('label', {}, 'موانع و مشکلات'), obstaclesInput, formalizeObstaclesBtn,
    el('label', { style: 'margin-top:10px' }, 'برنامه دوره بعد'), nextPlanInput,
    el('label', {}, 'توضیحات'), notesInput,
    errBox, btn,
  );
}

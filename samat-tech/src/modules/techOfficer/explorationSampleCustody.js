import {
  el, esc, showToast, openModal,
} from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import {
  queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender,
} from '../../lib/offlineQueue.js';

const STATUS_FLOW = ['برداشت شده', 'در حال انتقال', 'تحویل آزمایشگاه', 'نتیجه دریافت شد'];
const STATUS_COLOR = {
  'برداشت شده': 'var(--stone-500)',
  'در حال انتقال': 'var(--amber-600)',
  'تحویل آزمایشگاه': 'var(--patina-600)',
  'نتیجه دریافت شد': 'var(--patina-700)',
};

function genSampleCode(boreholeNo) {
  const rand = Date.now().toString(36).toUpperCase().slice(-5);
  return `${(boreholeNo || 'GEN').toString().slice(0, 8)}-${rand}`;
}

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendSampleRegisterPayload(payload) {
  const { error } = await sb.from('exploration_sample_custody').insert([payload]);
  if (error) throw new Error(error.message);
}
registerSender('explorationSampleRegister', sendSampleRegisterPayload);

async function sendSampleStatusUpdatePayload(payload) {
  const { error } = await sb.from('exploration_sample_custody')
    .update({ status: payload.status, lab_name: payload.labName, status_note: payload.statusNote, updated_at: new Date().toISOString() })
    .eq('id', payload.id);
  if (error) throw new Error(error.message);
}
registerSender('explorationSampleStatusUpdate', sendSampleStatusUpdatePayload);

async function loadSamples(mineName) {
  const { data, error } = await sb.from('exploration_sample_custody')
    .select('id,borehole_no,sample_code,status,lab_name,collected_at')
    .eq('mine_name', mineName).order('collected_at', { ascending: false }).limit(50);
  if (error) return [];
  return data || [];
}

/**
 * زنجیره‌ی نگهداری نمونه‌ی اکتشاف — ثبت نمونه‌ی جدید (با کد یکتا برای نوشتن روی کیسه/برچسب نمونه)
 * و پیگیری وضعیت آن از «برداشت شده» تا «نتیجه دریافت شد»، تا نمونه در مسیر گم نشود.
 * ⚠️ در این نسخه کد نمونه فقط متنی است (نه بارکد/QR گرافیکی)؛ افزودن تولید QR واقعی نیاز به
 * کتابخانه‌ی جدید دارد که در این پاس اضافه نشده — روی کیسه با دست نوشته یا چاپ برچسب معمولی می‌شود.
 * @param {object} mine
 * @param {string} nameField
 */
export function openExplorationSampleCustodyModal(mine, nameField) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `🧪 زنجیره نگهداری نمونه — ${mineName}`, width: '440px' });

  const boreholeInput = el('input', { type: 'text', placeholder: 'شماره گمانه/محل برداشت (اختیاری)' });
  const codeInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'کد نمونه (خودکار پر می‌شود، قابل ویرایش)' });
  const labInput = el('input', { type: 'text', placeholder: 'نام آزمایشگاه مقصد (اختیاری)' });
  const errBox = el('div', { class: 'gate-err' });
  const listBox = el('div', { style: 'margin-top:14px' });

  boreholeInput.addEventListener('input', () => {
    if (!codeInput.dataset.touched) codeInput.value = genSampleCode(boreholeInput.value.trim());
  });
  codeInput.addEventListener('input', () => { codeInput.dataset.touched = '1'; });
  codeInput.value = genSampleCode('');

  async function refreshList() {
    listBox.innerHTML = '⏳ در حال بارگذاری...';
    const rows = await loadSamples(mineName);
    listBox.innerHTML = '';
    if (!rows.length) { listBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500)' }, 'هنوز نمونه‌ای ثبت نشده.')); return; }
    rows.forEach((r) => {
      const statusBadge = el('span', {
        style: `background:${STATUS_COLOR[r.status] || 'var(--stone-500)'};color:#fff;border-radius:6px;padding:2px 8px;font-size:11px`,
      }, r.status);
      const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(r.status) + 1];
      const row = el('div', {
        style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--stone-200)',
      }, [
        el('div', {}, [
          el('div', { style: 'font-weight:700;font-size:13px' }, esc(r.sample_code)),
          el('div', { style: 'font-size:11px;color:var(--stone-500)' }, `${r.borehole_no ? `گمانه ${esc(r.borehole_no)} · ` : ''}${r.lab_name ? `آزمایشگاه: ${esc(r.lab_name)}` : ''}`),
        ]),
        el('div', { style: 'display:flex;align-items:center;gap:6px' }, [
          statusBadge,
          nextStatus ? el('button', {
            class: 'btn-sm', style: 'font-size:11px;padding:4px 8px',
            onclick: () => advanceStatus(r, nextStatus),
          }, `➡️ ${nextStatus}`) : null,
        ].filter(Boolean)),
      ]);
      listBox.append(row);
    });
  }

  async function advanceStatus(row, nextStatus) {
    let labName = row.lab_name;
    if (nextStatus === 'تحویل آزمایشگاه' && !labName) {
      labName = prompt('نام آزمایشگاه مقصد؟') || null;
    }
    const payload = {
      id: row.id, status: nextStatus, labName, statusNote: null,
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendSampleStatusUpdatePayload(payload);
      showToast(`✅ وضعیت نمونه به «${nextStatus}» تغییر کرد`);
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        await queueOfflineSubmission({ id: newQueueId('esc'), type: 'explorationSampleStatusUpdate', payload, queuedAt: Date.now() });
        showToast('📴 اینترنت وصل نیست — تغییر وضعیت ذخیره شد و بعداً ارسال می‌شود');
      } else {
        showToast(`⚠️ ${err.message}`);
      }
    }
    refreshList();
  }

  const registerBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:10px' }, '➕ ثبت نمونه جدید');
  registerBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (!codeInput.value.trim()) { errBox.textContent = 'کد نمونه نمی‌تواند خالی باشد'; return; }
    registerBtn.disabled = true; registerBtn.textContent = '⏳ در حال ثبت...';
    const payload = {
      mine_name: mineName,
      borehole_no: boreholeInput.value.trim() || null,
      sample_code: codeInput.value.trim(),
      lab_name: labInput.value.trim() || null,
      collected_by: await currentUserEmail(),
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendSampleRegisterPayload(payload);
      showToast('✅ نمونه ثبت شد — کد را روی کیسه/برچسب نمونه بنویسید');
      boreholeInput.value = ''; labInput.value = ''; delete codeInput.dataset.touched; codeInput.value = genSampleCode('');
      refreshList();
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        await queueOfflineSubmission({ id: newQueueId('esr'), type: 'explorationSampleRegister', payload, queuedAt: Date.now() });
        showToast('📴 اینترنت وصل نیست — نمونه ذخیره شد و بعداً خودکار ارسال می‌شود');
      } else {
        errBox.textContent = err.message;
      }
    }
    registerBtn.disabled = false; registerBtn.textContent = '➕ ثبت نمونه جدید';
  });

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      'برای هر نمونه‌ی برداشت‌شده یک کد یکتا بسازید، روی کیسه/برچسب بنویسید، و وضعیتش را تا تحویل نتیجه پیگیری کنید.'),
    el('label', {}, 'گمانه/محل برداشت'), boreholeInput,
    el('label', {}, 'کد نمونه'), codeInput,
    el('label', {}, 'آزمایشگاه مقصد'), labInput,
    errBox, registerBtn,
    el('div', { style: 'height:1px;background:var(--stone-200);margin:14px 0' }),
    el('div', { style: 'font-weight:700;font-size:13px' }, '📋 نمونه‌های اخیر این محدوده'),
    listBox,
  );
  refreshList();
}

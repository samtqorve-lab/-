import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function sendChecklistPayload(payload) {
  const { error } = await sb.from('safety_checklists').insert([payload.checklistRow]);
  if (error) throw error;
  if (payload.correctiveRows.length) {
    await sb.from('corrective_actions').insert(payload.correctiveRows);
  }
}
registerSender('safetyChecklist', sendChecklistPayload);


export function openSafetyChecklistModal(mine, nameField, department) {
  const { body, close } = openModal({ title: `✅ چک‌لیست ایمنی نوبت‌کاری — ${mine[nameField]}`, width: '440px' });

  const dateInput = el('input', { type: 'date', value: todayStr() });
  const shiftSelect = el('select', {}, ['صبح', 'عصر', 'شب'].map((s) => el('option', { value: s }, s)));
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });
  const itemsBox = el('div', { style: 'margin:10px 0' }, el('div', { class: 'loading-state' }, 'در حال بارگذاری آیتم‌ها...'));

  body.append(
    el('label', {}, 'تاریخ'), dateInput,
    el('label', {}, 'نوبت‌کاری'), shiftSelect,
    itemsBox,
    el('label', {}, 'توضیحات کلی (اختیاری)'), notesInput,
    errBox,
  );

  let itemsList = [];
  const itemStates = {};

  function drawItems() {
    itemsBox.innerHTML = '';
    itemsList.forEach((it) => {
      const st = itemStates[it];
      const okBtn = el('button', { class: 'btn-sm', style: `flex:1;background:${st.status === 'ok' ? 'var(--patina-600)' : 'var(--stone-100)'};color:${st.status === 'ok' ? '#fff' : 'var(--ink-700)'}` }, '✅ سالم');
      const issueBtn = el('button', { class: 'btn-sm', style: `flex:1;background:${st.status === 'issue' ? 'var(--rust-600)' : 'var(--stone-100)'};color:${st.status === 'issue' ? '#fff' : 'var(--ink-700)'}` }, '⚠️ مشکل دارد');
      okBtn.addEventListener('click', () => { st.status = 'ok'; drawItems(); });
      issueBtn.addEventListener('click', () => { st.status = 'issue'; drawItems(); });
      const row = el('div', { style: 'border-bottom:1px solid var(--stone-200);padding:8px 0' }, [
        el('div', { style: 'font-size:var(--text-sm);margin-bottom:4px' }, it),
        el('div', { style: 'display:flex;gap:6px' }, [okBtn, issueBtn]),
      ]);
      if (st.status === 'issue') {
        const noteInput = el('input', { type: 'text', placeholder: 'توضیح مشکل (اختیاری)', value: st.note, style: 'margin-top:6px' });
        noteInput.addEventListener('input', () => { st.note = noteInput.value; });
        row.append(noteInput);
      }
      itemsBox.append(row);
    });
  }

  (async () => {
    const { data, error } = await sb.from('safety_checklist_items').select('item_text').eq('department', department).eq('active', true).order('sort_order');
    if (error || !data || !data.length) {
      itemsBox.innerHTML = '';
      itemsBox.append(el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, '⚠️ آیتم‌های چک‌لیست بارگذاری نشد. اتصال اینترنت را بررسی کنید.'));
      return;
    }
    itemsList = data.map((r) => r.item_text);
    itemsList.forEach((it) => { itemStates[it] = { status: 'ok', note: '' }; });
    drawItems();
  })();

  const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, '✅ ثبت چک‌لیست');
  submitBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (!itemsList.length) { errBox.textContent = 'آیتم‌های چک‌لیست هنوز بارگذاری نشده — کمی صبر کنید'; return; }
    submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال ارسال...';
    const items = itemsList.map((it) => ({ item: it, status: itemStates[it].status, note: itemStates[it].note || null }));
    const issueItems = items.filter((i) => i.status === 'issue');
    const { data: { session } } = await sb.auth.getSession();
    const payload = {
      checklistRow: {
        mine_name: mine[nameField], department, submitted_by: session?.user?.email || '',
        shift_date: dateInput.value || todayStr(), shift_type: shiftSelect.value,
        items, overall_status: issueItems.length ? 'issues' : 'ok', notes: notesInput.value.trim() || null,
      },
      correctiveRows: issueItems.map((i) => ({
        mine_name: mine[nameField], department, submitted_by: session?.user?.email || '',
        description: `چک‌لیست ایمنی — ${i.item}${i.note ? `: ${i.note}` : ''}`,
        source_type: 'other', status: 'open',
      })),
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendChecklistPayload(payload);
      showToast(issueItems.length ? `⚠️ چک‌لیست ثبت شد — ${issueItems.length} مورد نیازمند پیگیری` : '✅ چک‌لیست سالم ثبت شد');
      close();
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('chk'), type: 'safetyChecklist', queuedAt: Date.now(), payload });
          showToast('📥 اینترنت وصل نیست — چک‌لیست ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
          close();
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = '✅ ثبت چک‌لیست';
    }
  });
  body.append(submitBtn);
}

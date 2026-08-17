import { el, esc, showToast, fmtDate } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { fetchNoticesForUser } from '../../lib/notices.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';
import { getGeoLocation } from '../../lib/geo.js';
import { mountGpsStatusChip } from '../shell/gpsStatusChip.js';

async function sendOwnerChecklistPayload(payload) {
  const { error } = await sb.from('safety_checklists').insert([payload]);
  if (error) throw error;
}
registerSender('ownerChecklist', sendOwnerChecklistPayload);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function mountOwnerPanel(root, { email, mines, roleRow, department, onLogout }) {
  root.innerHTML = '';
  const nameField = mines[0]?._nameField || 'نام_معدن';

  const header = el('div', { class: 'panel-header' }, [
    el('div', {}, [
      el('div', { style: 'font-weight:700' }, `🏗 بهره‌بردار — ${roleRow.full_name || email}`),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, mines.length ? mines.map((m) => m[nameField]).join('، ') : 'معدنی برای این حساب ثبت نشده'),
    ]),
    el('button', { class: 'btn-sm', style: 'background:var(--stone-100)', onclick: onLogout }, 'خروج'),
  ]);
  root.append(header);

  const gpsChipHost = el('div', { style: 'margin:8px 0' });
  root.append(gpsChipHost);
  mountGpsStatusChip(gpsChipHost);

  if (!mines.length) {
    root.append(el('div', { class: 'empty-state' }, 'هیچ معدنی به این حساب اختصاص داده نشده — با اداره تماس بگیرید.'));
    return;
  }

  // ── تب‌ها: اطلاعیه‌ها / ثبت گزارش ──
  let activeTab = 'notices';
  const tabsBox = el('div', { style: 'display:flex;gap:6px;margin:14px 0' });
  const body = el('div');
  root.append(tabsBox, body);

  function drawTabs() {
    tabsBox.innerHTML = '';
    [['notices', '📢 اطلاعیه‌ها'], ['report', '📋 ثبت گزارش']].forEach(([key, label]) => {
      tabsBox.append(el('button', {
        class: 'btn-sm',
        style: key === activeTab ? 'background:var(--ochre-600);color:#fff' : 'background:var(--stone-100);color:var(--ink-700)',
        onclick: () => { activeTab = key; drawTabs(); drawBody(); },
      }, label));
    });
  }

  async function drawBody() {
    body.innerHTML = '';
    if (activeTab === 'notices') { await drawNotices(); } else { await drawReportForm(); }
  }

  async function drawNotices() {
    body.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری اطلاعیه‌ها...'));
    let notices;
    try {
      notices = await fetchNoticesForUser(department);
    } catch (err) {
      body.innerHTML = '';
      body.append(el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, `خطا: ${err.message}`));
      return;
    }
    body.innerHTML = '';
    if (!notices.length) {
      body.append(el('div', { class: 'empty-state' }, 'اطلاعیه‌ای برای شما ثبت نشده'));
      return;
    }
    notices.forEach((n) => {
      body.append(el('div', { class: 'card', style: 'margin-bottom:10px' }, [
        el('div', { style: 'font-weight:700;font-size:var(--text-sm)' }, n.title),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:2px 0 8px' },
          `${n.mine_name || '📢 عمومی'} · ${fmtDate(n.created_at)}`),
        el('div', { style: 'font-size:var(--text-sm);white-space:pre-wrap' }, n.body),
      ]));
    });
  }

  async function drawReportForm() {
    body.innerHTML = '';

    const mineSelect = el('select', {}, mines.map((m) => el('option', { value: m[nameField] }, m[nameField])));
    const items = []; // { text, checked, note }
    const itemsBox = el('div', { style: 'margin:10px 0' }, el('div', { class: 'loading-state' }, 'در حال بارگذاری آیتم‌های چک‌لیست...'));
    const extraNote = el('textarea', { rows: '3', placeholder: 'اگر مورد دیگری هست که در فهرست بالا نبود، اینجا بنویسید (اختیاری)...' });
    const errBox = el('div', { class: 'gate-err' });
    const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, '✅ ارسال گزارش');

    body.append(
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
        'مشکلات، انتقادات یا کمبودهایی که مشاهده می‌کنید را علامت بزنید و برای اداره ارسال کنید.'),
      el('label', {}, 'معدن'), mineSelect,
      itemsBox,
      el('label', { style: 'margin-top:6px' }, 'توضیح تکمیلی'), extraNote,
      errBox, submitBtn,
    );

    function drawItems() {
      itemsBox.innerHTML = '';
      if (!items.length) {
        itemsBox.append(el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs)' }, 'موردی برای این بخش تعریف نشده — فقط توضیح تکمیلی را می‌توانید بفرستید.'));
        return;
      }
      items.forEach((it) => {
        const cb = el('input', { type: 'checkbox', style: 'width:auto' });
        cb.checked = it.checked;
        cb.addEventListener('change', () => { it.checked = cb.checked; drawItems(); });
        const row = el('div', { style: 'border-bottom:1px solid var(--stone-200);padding:8px 0' }, [
          el('label', { style: 'display:flex;align-items:flex-start;gap:8px;font-size:var(--text-sm)' }, [cb, it.text]),
        ]);
        if (it.checked) {
          const noteInput = el('input', { type: 'text', placeholder: 'توضیح بیشتر (اختیاری)', value: it.note, style: 'margin-top:6px' });
          noteInput.addEventListener('input', () => { it.note = noteInput.value; });
          row.append(noteInput);
        }
        itemsBox.append(row);
      });
    }

    (async () => {
      const { data, error } = await sb.from('safety_checklist_items').select('item_text').eq('department', department).eq('role', 'owner').eq('active', true).order('sort_order');
      if (error) { itemsBox.innerHTML = ''; itemsBox.append(el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, `⚠️ آیتم‌ها بارگذاری نشد: ${error.message}`)); return; }
      (data || []).forEach((r) => items.push({ text: r.item_text, checked: false, note: '' }));
      drawItems();
    })();

    submitBtn.addEventListener('click', async () => {
      errBox.textContent = '';
      const checkedItems = items.filter((i) => i.checked);
      const note = extraNote.value.trim();
      if (!checkedItems.length && !note) { errBox.textContent = 'حداقل یک مورد را علامت بزنید یا توضیح تکمیلی بنویسید'; return; }
      submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال ارسال...';
      let coords = null;
      try { coords = await getGeoLocation(); } catch { /* بدون GPS هم ارسال می‌شود؛ فقط lat/lon خالی می‌ماند */ }
      const payload = {
        mine_name: mineSelect.value, department, submitted_by: email,
        shift_date: todayStr(), shift_type: 'گزارش بهره‌بردار', submitter_role: 'owner',
        items: checkedItems.map((i) => ({ item: i.text, status: 'issue', note: i.note || null })),
        overall_status: checkedItems.length ? 'issues' : 'ok',
        notes: note || null,
        lat: coords?.latitude ?? null, lon: coords?.longitude ?? null,
      };
      try {
        if (!navigator.onLine) throw new Error('OFFLINE');
        await sendOwnerChecklistPayload(payload);
        showToast('✅ گزارش شما برای اداره ارسال شد');
        activeTab = 'notices'; drawTabs(); drawBody();
      } catch (err) {
        if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
          try {
            await queueOfflineSubmission({ id: newQueueId('own'), type: 'ownerChecklist', queuedAt: Date.now(), payload });
            showToast('📥 اینترنت وصل نیست — گزارش ذخیره شد و به‌محض اتصال ارسال می‌شود');
            activeTab = 'notices'; drawTabs(); drawBody();
          } catch (qErr) {
            errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
          }
        } else {
          errBox.textContent = err.message;
        }
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = '✅ ارسال گزارش';
      }
    });
  }

  drawTabs();
  drawBody();
}

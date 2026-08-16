import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getAccurateGeoLocation, isInsideMineBoundary } from '../../lib/geo.js';
import { watermarkPhoto } from '../../lib/watermark.js';
import { captureLivePhoto, liveCameraSupported } from '../../lib/liveCameraCapture.js';
import { uploadTechFile } from '../../lib/storage.js';
import { jalaliDateSelect, todayJalali, jalaliToISODate } from '../../lib/jalali.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';

// چک‌لیست مسئول ایمنی/بهداشت — برخلاف چک‌لیست پیش‌شیفت مسئول فنی، این یکی الزاماً باید داخل
// محدوده‌ی قانونی معدن پر شود، و برای آیتم‌های علامت‌گذاری‌شده (requires_photo) عکس واترمارک‌دار
// با موقعیت مکانی و نام آیتم الزامی است — دقیقاً طبق ماده ۳ آیین‌نامه ایمنی معادن.
async function sendRoleChecklistPayload(p) {
  const items = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const it of p.items) {
    let photoUrl = null;
    if (it.photoBlob) {
      // eslint-disable-next-line no-await-in-loop
      photoUrl = await uploadTechFile(it.photoBlob, `checklist_${Date.now()}.jpg`, p.mineName, `${p.role}-checklist`, 'checklist');
    }
    items.push({ item: it.item, status: it.status, note: it.note || null, photo_url: photoUrl });
  }
  const issueItems = items.filter((i) => i.status === 'issue');
  const { error } = await sb.from('safety_checklists').insert([{
    mine_name: p.mineName, department: p.department, submitted_by: p.submittedBy,
    submitter_role: p.role, shift_date: p.shiftDate, shift_type: p.shiftType || 'صبح',
    items, overall_status: issueItems.length ? 'issues' : 'ok', notes: p.notes,
    lat: p.coords ? p.coords.latitude : null, lon: p.coords ? p.coords.longitude : null,
    inside_boundary: p.insideBoundary,
  }]);
  if (error) throw new Error(error.message);
  if (issueItems.length) {
    const roleLabel = p.role === 'safety_officer' ? 'چک‌لیست ایمنی' : 'چک‌لیست بهداشت حرفه‌ای';
    await sb.from('corrective_actions').insert(issueItems.map((i) => ({
      mine_name: p.mineName, department: p.department, submitted_by: p.submittedBy,
      description: `${roleLabel} — ${i.item}${i.note ? `: ${i.note}` : ''}`,
      source_type: 'other', status: 'open',
    })));
  }
}
registerSender('roleChecklist', sendRoleChecklistPayload);

export function openRoleChecklistModal(mine, department, role, submittedBy, onDone) {
  const roleLabel = role === 'safety_officer' ? 'ایمنی' : 'بهداشت حرفه‌ای';
  const { body, close } = openModal({ title: `✅ چک‌لیست ${roleLabel} نوبت‌کاری — ${mine['نام_معدن']}`, width: '440px' });

  const [jy, jm, jd] = todayJalali();
  const dateWidget = jalaliDateSelect({ iso: jalaliToISODate(jy, jm, jd) });
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });
  const statusLine = el('div', { style: 'font-size:var(--text-xs);margin:6px 0 10px' }, '⏳ در حال دریافت موقعیت مکانی...');
  const itemsBox = el('div', { style: 'margin:10px 0' }, el('div', { class: 'loading-state' }, 'در حال بارگذاری آیتم‌ها...'));

  body.append(
    el('label', {}, 'تاریخ شیفت'), dateWidget.wrap,
    statusLine,
    itemsBox,
    el('label', {}, 'توضیحات کلی (اختیاری)'), notesInput,
    errBox,
  );

  let itemsList = []; // [{item_text, requires_photo}]
  const itemStates = {};
  let coords = null;
  let insideBoundary = null;

  function drawItems() {
    itemsBox.innerHTML = '';
    itemsList.forEach((it) => {
      const st = itemStates[it.item_text];
      const okBtn = el('button', { class: 'btn-sm', style: `flex:1;background:${st.status === 'ok' ? 'var(--patina-600)' : 'var(--stone-100)'};color:${st.status === 'ok' ? '#fff' : 'var(--ink-700)'}` }, '✅ مطلوب');
      const issueBtn = el('button', { class: 'btn-sm', style: `flex:1;background:${st.status === 'issue' ? 'var(--rust-600)' : 'var(--stone-100)'};color:${st.status === 'issue' ? '#fff' : 'var(--ink-700)'}` }, '⚠️ نامطلوب');
      okBtn.addEventListener('click', () => { st.status = 'ok'; drawItems(); });
      issueBtn.addEventListener('click', () => { st.status = 'issue'; drawItems(); });
      const row = el('div', { style: 'border-bottom:1px solid var(--stone-200);padding:8px 0' }, [
        el('div', { style: 'font-size:var(--text-sm);margin-bottom:4px' }, [
          it.item_text, it.requires_photo ? el('span', { style: 'color:#6a1b9a;font-size:var(--text-xs);margin-right:6px' }, '📷 نیاز به عکس') : null,
        ]),
        el('div', { style: 'display:flex;gap:6px' }, [okBtn, issueBtn]),
      ]);
      if (st.status === 'issue') {
        const noteInput = el('input', { type: 'text', placeholder: 'توضیح مشکل (اختیاری)', value: st.note, style: 'margin-top:6px' });
        noteInput.addEventListener('input', () => { st.note = noteInput.value; });
        row.append(noteInput);
      }
      if (it.requires_photo) {
        if (st.photoPreviewUrl) {
          const retakeBtn = el('button', { class: 'btn-sm', style: 'font-size:11px' }, '🔄 عکس جدید');
          retakeBtn.addEventListener('click', () => capturePhoto(it.item_text));
          row.append(el('div', { style: 'margin-top:6px;display:flex;align-items:center;gap:6px' }, [
            el('img', { src: st.photoPreviewUrl, style: 'width:56px;height:56px;object-fit:cover;border-radius:6px' }), retakeBtn,
          ]));
        } else {
          const capBtn = el('button', { class: 'btn-sm', style: 'margin-top:6px;background:#f3e5f5;color:#6a1b9a;font-size:11px' }, '📷 گرفتن عکس (الزامی)');
          capBtn.addEventListener('click', () => capturePhoto(it.item_text));
          row.append(capBtn);
        }
      }
      itemsBox.append(row);
    });
  }

  function capturePhoto(itemText) {
    if (liveCameraSupported()) {
      captureLivePhoto({
        buildLines: (c) => [
          `🦺 مسئول ${roleLabel} — ${mine['نام_معدن'] || '-'}`,
          `📝 آیتم: ${itemText}`,
          c ? `📍 ${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}  (دقت ~${Math.round(c.accuracy)}م)` : '📍 در حال دریافت GPS...',
          `🕒 ${new Date().toLocaleString('fa-IR')}`,
        ],
        checkInside: (c) => isInsideMineBoundary(c, mine),
      }).then(({ blob, coords: liveCoords }) => {
        itemStates[itemText].photoBlob = blob;
        itemStates[itemText].photoPreviewUrl = URL.createObjectURL(blob);
        if (liveCoords) { coords = liveCoords; insideBoundary = isInsideMineBoundary(liveCoords, mine); }
        drawItems();
      }).catch((err) => {
        if (err.message === 'CANCELLED') return;
        showToast(`⚠️ دوربین زنده در دسترس نبود؛ از حالت معمولی استفاده می‌شود (${err.message})`);
        captureViaLegacyInput(itemText);
      });
      return;
    }
    captureViaLegacyInput(itemText);
  }

  function captureViaLegacyInput(itemText) {
    if (!coords) { showToast('⚠️ موقعیت مکانی هنوز دریافت نشده — کمی صبر کنید'); return; }
    const input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      showToast('⏳ در حال درج واترمارک...');
      const watermarked = await watermarkPhoto(file, coords, mine, itemText);
      itemStates[itemText].photoBlob = watermarked;
      itemStates[itemText].photoPreviewUrl = URL.createObjectURL(watermarked);
      drawItems();
    });
    document.body.append(input);
    input.click();
    input.addEventListener('change', () => input.remove(), { once: true });
  }

  (async () => {
    try {
      coords = await getAccurateGeoLocation({
        targetAccuracyM: 20,
        onProgress: (c) => { statusLine.textContent = `📡 در حال بهبود دقت GPS... (دقت فعلی: ~${Math.round(c.accuracy)} متر)`; },
      });
      insideBoundary = isInsideMineBoundary(coords, mine);
    } catch { /* پیام هشدار پایین نمایش داده می‌شود */ }
    statusLine.innerHTML = '';
    statusLine.append(insideBoundary === true
      ? el('span', { style: 'color:var(--patina-700)' }, '✅ داخل محدوده معدن')
      : insideBoundary === false
        ? el('span', { style: 'color:var(--rust-700)' }, '⚠️ خارج از محدوده قانونی معدن — این چک‌لیست فقط داخل محدوده قابل ثبت است')
        : el('span', { style: 'color:var(--amber-700)' }, '⚠️ موقعیت مکانی دریافت نشد — GPS را بررسی کنید'));

    const { data, error } = await sb.from('safety_checklist_items').select('item_text, requires_photo').eq('department', 'معدن').eq('role', role).eq('active', true).order('sort_order');
    if (error || !data || !data.length) {
      itemsBox.innerHTML = '';
      itemsBox.append(el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, '⚠️ آیتم‌های چک‌لیست بارگذاری نشد. اتصال اینترنت را بررسی کنید.'));
      return;
    }
    itemsList = data;
    data.forEach((it) => { itemStates[it.item_text] = { status: 'ok', note: '', photoBlob: null, photoPreviewUrl: null }; });
    drawItems();
  })();

  const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, '✅ ثبت چک‌لیست');
  submitBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (!itemsList.length) { errBox.textContent = 'آیتم‌های چک‌لیست هنوز بارگذاری نشده — کمی صبر کنید'; return; }
    if (insideBoundary === false) { errBox.textContent = '⚠️ شما خارج از محدوده‌ی قانونی معدن هستید — این چک‌لیست فقط داخل محدوده قابل ثبت است'; return; }
    if (!coords) { errBox.textContent = '⚠️ موقعیت مکانی دریافت نشد — دوباره تلاش کنید'; return; }
    const missing = itemsList.find((it) => it.requires_photo && !itemStates[it.item_text].photoBlob);
    if (missing) { errBox.textContent = `⚠️ برای «${missing.item_text}» عکس الزامی است`; return; }

    submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال ارسال...';
    const payload = {
      mineName: mine['نام_معدن'], department, role, submittedBy,
      shiftDate: dateWidget.getValue(), shiftType: 'صبح',
      notes: notesInput.value.trim() || null,
      coords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
      insideBoundary,
      items: itemsList.map((it) => ({ item: it.item_text, status: itemStates[it.item_text].status, note: itemStates[it.item_text].note, photoBlob: itemStates[it.item_text].photoBlob })),
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendRoleChecklistPayload(payload);
      const issueCount = payload.items.filter((i) => i.status === 'issue').length;
      showToast(issueCount ? `⚠️ چک‌لیست ثبت شد — ${issueCount} مورد نیازمند پیگیری` : '✅ چک‌لیست ثبت شد');
      close();
      onDone?.();
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('rc'), type: 'roleChecklist', payload, queuedAt: Date.now() });
          showToast('📥 اینترنت وصل نیست — چک‌لیست ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
          close();
          onDone?.();
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

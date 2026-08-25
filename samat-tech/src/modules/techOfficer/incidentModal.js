import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { loadScaledImage } from '../../lib/watermark.js';
import { uploadIncidentFile, uploadVoiceNote } from '../../lib/storage.js';
import { formalizePersianText } from '../../lib/formalize.js';
import { mountVoiceRecorder } from '../../lib/voiceRecorder.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';

// منطق واقعی ارسال حادثه — هم مسیر آنلاین مستقیم و هم sync بعدی از صف آفلاین از این استفاده می‌کنند.
async function sendIncidentPayload(p) {
  const photoUrls = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const blob of p.photoBlobs) {
    // eslint-disable-next-line no-await-in-loop
    photoUrls.push(await uploadIncidentFile(blob, p.mineName));
  }
  let voiceUrl = null;
  if (p.voiceBlob) voiceUrl = await uploadVoiceNote(p.voiceBlob, p.mineName);

  const { data: insData, error: incErr } = await sb.from('incident_reports').insert([{
    mine_name: p.mineName, incident_type: p.incidentType, occurred_at: p.occurredAt || null,
    location_detail: p.locationDetail, injured_count: p.injuredCount, fatality_count: p.fatalityCount,
    description: p.description, immediate_actions: p.immediateActions, submitted_by: p.submittedBy,
    file_urls: { photos: photoUrls, voice: voiceUrl ? [voiceUrl] : [] }, department: p.department,
  }]).select('id').single();
  if (incErr) throw new Error(`ثبت حادثه در سامانه ناموفق بود: ${incErr.message}`);

  try {
    const { data: sessionData } = await sb.auth.getSession();
    const jwt = sessionData && sessionData.session ? sessionData.session.access_token : null;
    if (!jwt) return;
    const relayRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        action: 'incidentReport', mineName: p.mineName, incidentType: p.incidentType, occurredAt: p.occurredAt,
        locationDetail: p.locationDetail, injuredCount: p.injuredCount, fatalityCount: p.fatalityCount,
        description: p.description, immediateActions: p.immediateActions, submittedBy: p.submittedBy,
        fileUrls: { photos: photoUrls, voice: voiceUrl ? [voiceUrl] : [] },
      }),
    });
    if (!relayRes.ok) {
      const relayData = await relayRes.json().catch(() => ({}));
      if (insData) await sb.from('incident_reports').update({ notify_failed: true, notify_error: JSON.stringify(relayData.error || relayRes.status) }).eq('id', insData.id);
    }
  } catch {
    // اطلاع‌رسانی فوری best-effort است؛ خود حادثه قبلاً با موفقیت ثبت شده — نباید کل عملیات را ناموفق نشان دهیم
  }
}
registerSender('incident', sendIncidentPayload);

const INCIDENT_TYPES = ['ریزش', 'سقوط', 'برخورد با ماشین‌آلات', 'برق‌گرفتگی', 'انفجار/آتش‌سوزی', 'خفگی/گاز', 'سایر'];

export function openIncidentModal(mine, nameField, department, profileCtx) {
  const mineName = mine[nameField] || '';
  const photos = []; // [{file}]

  const { body, close } = openModal({ title: `🚨 اعلام حادثه — ${mineName}`, width: '440px' });

  const typeSelect = el('select', {}, INCIDENT_TYPES.map((t) => el('option', { value: t }, t)));
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const occurredInput = el('input', { type: 'datetime-local', value: nowLocal });
  const locationInput = el('input', { type: 'text', placeholder: 'مثلاً: پله معدنی شماره ۳' });
  const injuredInput = el('input', { type: 'number', min: '0', value: '0' });
  const fatalInput = el('input', { type: 'number', min: '0', value: '0' });
  const descInput = el('textarea', { rows: '3' });
  const formalizeBtn = el('button', { class: 'btn-sm', style: 'background:var(--fluorite-100);color:var(--fluorite-700);margin-top:4px', onclick: () => {
    const text = descInput.value.trim();
    if (!text) return;
    descInput.value = formalizePersianText(text);
  } }, '✨ رسمی‌نویسی خودکار');
  const actionsInput = el('textarea', { rows: '2' });
  const thumbBox = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px' });
  const errBox = el('div', { class: 'gate-err' });

  function drawThumbs() {
    thumbBox.innerHTML = '';
    photos.forEach((p, i) => {
      thumbBox.append(el('div', { style: 'position:relative;width:64px;height:64px' }, [
        el('img', { src: URL.createObjectURL(p.file), style: 'width:100%;height:100%;object-fit:cover;border-radius:8px' }),
        el('button', {
          style: 'position:absolute;top:-6px;left:-6px;background:var(--rust-600);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer',
          onclick: () => { photos.splice(i, 1); drawThumbs(); },
        }, '✕'),
      ]));
    });
  }

  const photoInput = el('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
  photoInput.addEventListener('change', () => {
    Array.from(photoInput.files || []).forEach((f) => photos.push({ file: f }));
    photoInput.value = '';
    drawThumbs();
  });
  const photoBtn = el('button', { class: 'btn-ghost btn-sm', onclick: () => photoInput.click() }, '📷 افزودن عکس');

  let voiceBlob = null;
  const voiceBox = el('div');
  mountVoiceRecorder(voiceBox, (blob) => { voiceBlob = blob; });

  body.append(
    el('label', {}, 'نوع حادثه'), typeSelect,
    el('label', {}, 'زمان وقوع'), occurredInput,
    el('label', {}, 'محل دقیق'), locationInput,
    el('div', { style: 'display:flex;gap:8px' }, [
      el('div', { style: 'flex:1' }, [el('label', {}, 'تعداد مصدوم'), injuredInput]),
      el('div', { style: 'flex:1' }, [el('label', {}, 'تعداد فوتی'), fatalInput]),
    ]),
    el('label', {}, 'شرح حادثه'), descInput, formalizeBtn,
    el('label', {}, 'اقدامات فوری انجام‌شده'), actionsInput,
    el('label', {}, 'عکس‌ها'), photoBtn, photoInput, thumbBox,
    el('label', { style: 'margin-top:10px' }, 'یادداشت صوتی (اختیاری)'), voiceBox,
    errBox,
  );

  const submitBtn = el('button', { class: 'btn btn-danger', style: 'margin-top:14px' }, '🚨 ارسال فوری');
  submitBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    const description = descInput.value.trim();
    if (!description) { errBox.textContent = 'شرح حادثه را وارد کنید'; return; }
    submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال ارسال...';
    const { data: { user } } = await sb.auth.getUser();
    const payload = {
      mineName, department,
      incidentType: typeSelect.value,
      occurredAt: occurredInput.value,
      locationDetail: locationInput.value.trim(),
      injuredCount: parseInt(injuredInput.value, 10) || 0,
      fatalityCount: parseInt(fatalInput.value, 10) || 0,
      description,
      immediateActions: actionsInput.value.trim(),
      submittedBy: user ? user.email : (profileCtx && profileCtx.email) || '',
      photoBlobs: [],
      voiceBlob,
    };
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const p of photos) {
        // eslint-disable-next-line no-await-in-loop
        const canvas = await loadScaledImage(p.file, 1600);
        // eslint-disable-next-line no-await-in-loop
        const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
        payload.photoBlobs.push(blob);
      }
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendIncidentPayload(payload);
      showToast('✅ حادثه ثبت و به مسئولین اطلاع داده شد');
      close();
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('inc'), type: 'incident', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — حادثه ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
          close();
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = '🚨 ارسال فوری';
    }
  });
  body.append(submitBtn);
}

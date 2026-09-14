import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { jalaliDateSelect } from '../../lib/jalali.js';
import { getGeoLocation } from '../../lib/geo.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

async function sendBoreholePayload(payload) {
  const { error } = await sb.from('exploration_boreholes').insert([payload]);
  if (error) throw new Error(error.message);
}
registerSender('explorationBorehole', sendBoreholePayload);

// رنگ ثابت و تکرارپذیر برای هر نام لیتولوژی (بر پایه‌ی هش متن) — تا رنگ هر جنس سنگ در همه‌ی
// گمانه‌ها یکسان بماند، بدون این‌که کاربر مجبور باشد خودش رنگ انتخاب کند.
function lithologyColor(name) {
  if (!name) return '#c9c2b8';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 40%, 55%)`;
}

function renderStratColumn(layers) {
  if (!Array.isArray(layers) || !layers.length) return null;
  const totalDepth = Math.max(...layers.map((l) => l.to || 0)) || 1;
  const col = el('div', { style: 'display:flex;flex-direction:column;width:34px;height:120px;border:1px solid var(--stone-300);border-radius:4px;overflow:hidden' });
  layers.forEach((l) => {
    const heightPct = (((l.to || 0) - (l.from || 0)) / totalDepth) * 100;
    col.append(el('div', {
      style: `height:${heightPct}%;background:${lithologyColor(l.lithology)}`,
      title: `${l.from}–${l.to} متر: ${l.lithology || '—'}`,
    }));
  });
  const legend = el('div', { style: 'display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--stone-600)' },
    layers.map((l) => el('div', {}, [
      el('span', { style: `display:inline-block;width:8px;height:8px;background:${lithologyColor(l.lithology)};border-radius:2px;margin-left:4px` }),
      `${l.from}–${l.to} متر — ${l.lithology || '—'}`,
    ])));
  return el('div', { style: 'display:flex;gap:8px;margin-top:4px' }, [col, legend]);
}

async function loadRecentBoreholes(box, mineName) {
  box.innerHTML = '<div style="font-size:11px;color:var(--stone-500)">در حال بارگذاری...</div>';
  const { data, error } = await sb.from('exploration_boreholes').select('*').eq('mine_name', mineName).order('created_at', { ascending: false }).limit(10);
  if (error) { box.innerHTML = '<div style="font-size:11px;color:var(--rust-700)">خطا در بارگذاری فهرست</div>'; return; }
  box.innerHTML = '';
  if (!data || !data.length) { box.append(el('div', { style: 'font-size:11px;color:var(--stone-500)' }, 'هنوز گمانه/ترانشه‌ای برای این محدوده ثبت نشده')); return; }
  data.forEach((r) => {
    const lines = [
      el('div', { style: 'font-weight:700' }, `${r.borehole_no || '—'}${r.depth_m != null ? ` — عمق ${r.depth_m} متر` : ''}`),
      el('div', { style: 'font-size:10px;color:var(--stone-500)' }, `${r.drill_date || ''}${r.lithology ? ` | لیتولوژی: ${r.lithology}` : ''}`),
    ];
    if (r.sample_results) lines.push(el('div', { style: 'font-size:11px;margin-top:2px' }, `نتیجه نمونه: ${r.sample_results}`));
    const strat = renderStratColumn(r.layers);
    if (strat) lines.push(strat);
    box.append(el('div', { style: 'padding:6px 0;border-bottom:1px solid var(--stone-200);font-size:12px' }, lines));
  });
}

/**
 * ثبت گمانه/ترانشه‌ی اکتشافی — مخصوص تخصص «اکتشاف». روی جدول موجود exploration_boreholes
 * می‌نویسد (که از قبل توسط پنل ادمین/دیتابیس پشتیبانی می‌شود، صرفاً رابط کاربری برای مسئول فنی
 * اکتشاف در سامت‌تک وجود نداشت). الگوی آفلاین/صف‌بندی دقیقاً مثل بقیه‌ی فرم‌های این اپ.
 *
 * لاگ گرافیکی گمانه (اختیاری): می‌توان بازه‌های عمق را با لیتولوژی هر لایه وارد کرد تا یک
 * ستون استراتیگرافی رنگی (مشابه لاگ‌های زمین‌شناسی واقعی) زیر همان گمانه رسم شود؛ رنگ هر
 * لیتولوژی خودکار و بر پایه‌ی نام آن تعیین می‌شود، نه انتخاب دستی رنگ.
 * @param {object} mine
 * @param {string} nameField
 * @param {{ email?: string }} ctx
 */
export function openExplorationLogModal(mine, nameField, { email } = {}) {
  const mineName = mine[nameField];
  const { body } = openModal({ title: `🪨 ثبت گمانه/ترانشه — ${mineName}`, width: '420px' });

  const boreholeNoInput = el('input', { type: 'text', placeholder: 'مثلاً: BH-12 یا ترانشه T-3' });
  const dateWidget = jalaliDateSelect({});
  const depthInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'متر' });
  const lithologyInput = el('input', { type: 'text', placeholder: 'مثلاً: آهک دولومیتی، رگه کوارتز' });
  const sampleInput = el('textarea', { rows: '2', placeholder: 'عیار/نتیجه آنالیز آزمایشگاه (اختیاری)' });
  const notesInput = el('textarea', { rows: '2' });
  const gpsStatus = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:6px 0' }, '📍 موقعیت هنوز گرفته نشده');
  let coords = null;
  const gpsBtn = el('button', {
    class: 'btn-sm',
    style: 'background:var(--schist-100);color:var(--schist-600)',
    onclick: async () => {
      gpsStatus.textContent = '⏳ در حال دریافت موقعیت...';
      try {
        coords = await getGeoLocation();
        gpsStatus.textContent = `📍 ثبت شد: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
      } catch (err) { gpsStatus.textContent = `⚠️ ${err.message}`; }
    },
  }, '📍 ثبت موقعیت گمانه با GPS');

  // ── لاگ گرافیکی (اختیاری): ردیف‌های از–تا–لیتولوژی که در نهایت به آرایه‌ی layers تبدیل می‌شوند ──
  const layersBox = el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px' });
  const layerRows = [];
  function addLayerRow() {
    const fromInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'از (متر)', style: 'width:70px' });
    const toInput = el('input', { type: 'number', min: '0', step: '0.1', placeholder: 'تا (متر)', style: 'width:70px' });
    const lithInput = el('input', { type: 'text', placeholder: 'لیتولوژی این لایه', style: 'flex:1' });
    const removeBtn = el('button', {
      style: 'background:var(--rust-100);color:var(--rust-700);border:none;border-radius:6px;width:26px;cursor:pointer',
      onclick: () => { row.remove(); const i = layerRows.indexOf(entry); if (i > -1) layerRows.splice(i, 1); },
    }, '✕');
    const entry = { fromInput, toInput, lithInput };
    const row = el('div', { style: 'display:flex;gap:4px;align-items:center' }, [fromInput, toInput, lithInput, removeBtn]);
    layerRows.push(entry);
    layersBox.append(row);
  }
  const addLayerBtn = el('button', {
    class: 'btn-sm', style: 'background:var(--fluorite-100);color:var(--fluorite-700);margin-top:4px',
    onclick: addLayerRow,
  }, '➕ افزودن لایه به ستون گرافیکی');

  const errBox = el('div', { class: 'gate-err' });
  const listBox = el('div', { style: 'margin-top:14px' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ثبت گمانه/ترانشه');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const boreholeNo = boreholeNoInput.value.trim();
    if (!boreholeNo) { errBox.textContent = 'شماره/نام گمانه یا ترانشه را وارد کنید'; return; }

    const layers = layerRows
      .map((r) => ({ from: parseFloat(r.fromInput.value), to: parseFloat(r.toInput.value), lithology: r.lithInput.value.trim() }))
      .filter((l) => !Number.isNaN(l.from) && !Number.isNaN(l.to) && l.to > l.from);
    if (layerRows.length && layers.length !== layerRows.length) {
      errBox.textContent = 'در ردیف‌های ستون گرافیکی، «تا» باید بزرگ‌تر از «از» باشد و هر دو عدد معتبر باشند';
      return;
    }

    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    const payload = {
      mine_name: mineName,
      borehole_no: boreholeNo,
      drill_date: dateWidget.getValue(),
      depth_m: depthInput.value ? parseFloat(depthInput.value) : null,
      lat: coords?.latitude ?? null,
      lon: coords?.longitude ?? null,
      lithology: lithologyInput.value.trim() || null,
      sample_results: sampleInput.value.trim() || null,
      notes: notesInput.value.trim() || null,
      layers: layers.length ? layers : null,
      created_by: email || await currentUserEmail(),
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await sendBoreholePayload(payload);
      showToast('✅ گمانه/ترانشه ثبت شد');
      boreholeNoInput.value = ''; depthInput.value = ''; lithologyInput.value = ''; sampleInput.value = ''; notesInput.value = '';
      coords = null; gpsStatus.textContent = '📍 موقعیت هنوز گرفته نشده';
      layersBox.innerHTML = ''; layerRows.length = 0;
      loadRecentBoreholes(listBox, mineName);
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('exp'), type: 'explorationBorehole', payload, queuedAt: Date.now() });
          showToast('📴 اینترنت وصل نیست — ثبت شد و به‌محض اتصال خودکار ارسال می‌شود');
          boreholeNoInput.value = '';
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    }
    btn.disabled = false; btn.textContent = '✅ ثبت گمانه/ترانشه';
  });

  body.append(
    el('label', {}, 'شماره/نام گمانه یا ترانشه'), boreholeNoInput,
    el('label', {}, 'تاریخ حفاری'), dateWidget.wrap,
    el('label', {}, 'عمق (متر)'), depthInput,
    el('label', {}, 'لیتولوژی/نوع سنگ (خلاصه کلی)'), lithologyInput,
    gpsBtn, gpsStatus,
    el('label', { style: 'margin-top:8px' }, 'ستون گرافیکی (اختیاری — لایه به لایه)'),
    layersBox, addLayerBtn,
    el('label', { style: 'margin-top:10px' }, 'نتیجه نمونه‌برداری/آنالیز (اختیاری)'), sampleInput,
    el('label', {}, 'توضیحات'), notesInput,
    errBox, btn,
    el('h4', { style: 'margin-top:16px;font-size:var(--text-sm);color:var(--ink-700)' }, 'گمانه/ترانشه‌های اخیر این محدوده'),
    listBox,
  );
  loadRecentBoreholes(listBox, mineName);
}

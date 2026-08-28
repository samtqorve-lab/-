import { el, esc, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getGeoLocation, isInsideMineBoundary } from '../../lib/geo.js';
import { watermarkPhoto, watermarkLinesForPhoto } from '../../lib/watermark.js';
import { captureLivePhoto, liveCameraSupported } from '../../lib/liveCameraCapture.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError } from '../../lib/offlineQueue.js';
import { sendEquipmentPhotoPayload } from './equipmentSubmit.js';

const EQUIP_FIELD_KEYS = [
  { field: 'تجهیزات_نفت_گاز', label: 'نفت‌گاز' },
  { field: 'تجهیزات_گاز_مایع', label: 'گاز مایع' },
  { field: 'تجهیزات_نفت_سفید', label: 'نفت سفید' },
];

function getMineEquipmentList(mine) {
  const list = [];
  EQUIP_FIELD_KEYS.forEach(({ field, label }) => {
    const rows = mine[field];
    if (Array.isArray(rows)) {
      rows.forEach((row, i) => {
        const name = row['نام'] || row['نام ماشین'] || row['نام تجهیز'] || '';
        if (!name && !row['مدل'] && !row['نوع']) return;
        list.push({ key: `${field}__${i}`, field, name, model: row['مدل'] || '', type: row['نوع'] || label, count: row['تعداد'] || '' });
      });
    }
  });
  return list;
}

export function mountEquipmentChecklist(container, mine, nameField, department, fullNameInput, membershipInput) {
  let workingList = getMineEquipmentList(mine);
  let editingKey = null;
  const captures = {}; // key -> {overview:[{blob,previewUrl}], serial:[...]}

  function draw() {
    container.innerHTML = '';
    container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      'این ماشین‌آلات پیش‌فرض همین معدن‌اند (نفت‌گاز / گاز مایع / نفت سفید). برای هرکدام، شماره سریال را تایپ کنید و یک عکس نمای دور + یک عکس پلاک شماره سریال بگیرید تا برای درخواست سهمیه‌ی سوخت برای ادمین ارسال شود.'));
    if (!workingList.length) {
      container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);padding:6px 0' }, 'هنوز ماشین‌آلاتی برای این معدن ثبت نشده — با دکمه‌ی زیر اضافه کنید.'));
    }
    workingList.forEach((eq) => {
      if (editingKey === eq.key) {
        const nameInput = el('input', { placeholder: 'نام ماشین', value: eq.name });
        nameInput.addEventListener('input', () => { eq.name = nameInput.value; });
        const modelInput = el('input', { placeholder: 'مدل', value: eq.model, style: 'flex:1' });
        modelInput.addEventListener('input', () => { eq.model = modelInput.value; });
        const countInput = el('input', { placeholder: 'تعداد', value: eq.count, style: 'width:70px' });
        countInput.addEventListener('input', () => { eq.count = countInput.value; });
        const typeSelect = el('select', {}, ['نفت‌گاز', 'گاز مایع', 'نفت سفید'].map((t) => el('option', { value: t }, t)));
        typeSelect.value = eq.type;
        typeSelect.addEventListener('change', () => {
          eq.type = typeSelect.value;
          eq.field = eq.type === 'گاز مایع' ? 'تجهیزات_گاز_مایع' : (eq.type === 'نفت سفید' ? 'تجهیزات_نفت_سفید' : 'تجهیزات_نفت_گاز');
        });
        const doneBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff;flex:1', onclick: () => { editingKey = null; draw(); } }, '✔️ تمام');
        const removeBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => {
          if (!confirm('این دستگاه از لیست حذف شود؟')) return;
          workingList = workingList.filter((r) => r.key !== eq.key);
          draw();
        } }, 'حذف');
        container.append(el('div', { style: 'background:var(--amber-50);border-radius:10px;padding:10px;margin-bottom:8px;border:1.5px solid var(--amber-600)' }, [
          nameInput,
          el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [modelInput, countInput]),
          typeSelect,
          el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [doneBtn, removeBtn]),
        ]));
        return;
      }

      if (!captures[eq.key]) captures[eq.key] = { overview: [], serial: [], serialNo: '' };
      const thumbBox = (photoType) => el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px' },
        captures[eq.key][photoType].map((c, i) => el('div', { style: 'position:relative;width:60px;height:60px' }, [
          el('img', { src: c.previewUrl, style: 'width:100%;height:100%;object-fit:cover;border-radius:6px;border:1px solid var(--stone-300)' }),
          el('button', {
            style: 'position:absolute;top:-5px;left:-5px;background:var(--rust-600);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer',
            onclick: () => { if (confirm('این عکس حذف شود؟')) { captures[eq.key][photoType].splice(i, 1); draw(); } },
          }, '✕'),
        ])));

      const submitCapture = async (photoType, blob, coords) => {
        captures[eq.key][photoType].push({ blob, previewUrl: URL.createObjectURL(blob) });
        draw();
        try {
          const { data: { session } } = await sb.auth.getSession();
          const insideBoundary = coords ? isInsideMineBoundary(coords, mine) : false;
          const payload = {
            mineName: mine[nameField], submittedBy: session?.user?.email || '',
            machineType: eq.name || eq.type, plateNo: eq.model, photoBlob: blob, photoType, deviceKey: eq.key,
            serialNo: captures[eq.key].serialNo.trim(),
            lat: coords?.latitude, lon: coords?.longitude, insideBoundary, department,
          };
          try {
            if (!navigator.onLine) throw new Error('OFFLINE');
            await sendEquipmentPhotoPayload(payload);
            showToast('✅ عکس برای بررسی ادمین ارسال شد');
          } catch (err) {
            if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
              try {
                await queueOfflineSubmission({ id: newQueueId('eq'), type: 'equipmentPhoto', payload, queuedAt: Date.now() });
                showToast('📴 اینترنت وصل نیست — عکس ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
              } catch (qErr) {
                showToast(`⚠️ ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`);
              }
            } else {
              showToast(`⚠️ عکس ذخیره شد ولی ارسال برای تایید ناموفق بود: ${err.message}`);
            }
          }
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      };

      const captureViaLegacyInput = async (photoType, file) => {
        showToast('⏳ در حال دریافت موقعیت مکانی...');
        try {
          const coords = await getGeoLocation();
          const watermarked = await watermarkPhoto(file, coords, mine, photoType === 'overview' ? 'نمای دور' : 'شماره سریال', fullNameInput.value, membershipInput.value, nameField);
          await submitCapture(photoType, watermarked, coords);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      };

      const captureViaLiveCamera = (photoType) => {
        captureLivePhoto({
          buildLines: (c) => watermarkLinesForPhoto(c, mine, photoType === 'overview' ? 'نمای دور' : 'شماره سریال', fullNameInput.value, membershipInput.value, nameField),
        }).then(({ blob, coords }) => submitCapture(photoType, blob, coords)).catch((err) => {
          if (err.message === 'CANCELLED') return;
          showToast(`⚠️ دوربین زنده در دسترس نبود؛ از حالت معمولی استفاده می‌شود (${err.message})`);
          (photoType === 'overview' ? overviewInput : serialInput).click();
        });
      };

      const triggerCapture = (photoType) => {
        if (!fullNameInput.value.trim() || !membershipInput.value.trim()) {
          showToast('⚠️ ابتدا نام و شماره عضویت خود را از منو ☰ → «مشخصات و تنظیمات» وارد و ذخیره کنید (روی واترمارک عکس درج می‌شود)');
          return;
        }
        if (!captures[eq.key].serialNo.trim()) { showToast('⚠️ ابتدا شماره سریال دستگاه را در کادر بالا وارد کنید'); return; }
        if (liveCameraSupported()) captureViaLiveCamera(photoType);
        else (photoType === 'overview' ? overviewInput : serialInput).click();
      };

      const overviewInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
      overviewInput.addEventListener('change', () => { if (overviewInput.files[0]) captureViaLegacyInput('overview', overviewInput.files[0]); overviewInput.value = ''; });
      const serialInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
      serialInput.addEventListener('change', () => { if (serialInput.files[0]) captureViaLegacyInput('serial', serialInput.files[0]); serialInput.value = ''; });

      const serialNoInput = el('input', {
        type: 'text', dir: 'ltr', placeholder: 'شماره سریال دستگاه (برای سهمیه‌ی سوخت)', value: captures[eq.key].serialNo,
        style: 'margin-bottom:8px',
      });
      serialNoInput.addEventListener('input', () => { captures[eq.key].serialNo = serialNoInput.value; });

      container.append(el('div', { style: 'background:var(--stone-50);border-radius:10px;padding:10px;margin-bottom:8px' }, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start' }, [
          el('div', {}, [
            el('div', { style: 'font-weight:700;font-size:var(--text-sm)' }, esc(eq.name || eq.type)),
            el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:6px' }, `${esc(eq.type)}${eq.model ? ` — مدل ${esc(eq.model)}` : ''}${eq.count ? ` — تعداد ${esc(eq.count)}` : ''}`),
          ]),
          el('button', { style: 'background:none;border:none;font-size:15px;cursor:pointer', onclick: () => { editingKey = eq.key; draw(); } }, '✏️'),
        ]),
        el('div', { style: 'font-size:10.5px;color:var(--stone-500);margin-bottom:6px' }, '🛢️ برای درخواست سهمیه‌ی سوخت: شماره سریال را تایپ کنید، سپس یک عکس نمای دور از دستگاه و یک عکس واضح از پلاک شماره سریال بگیرید.'),
        serialNoInput,
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
          el('button', { class: 'btn-sm', style: 'background:var(--schist-100);color:var(--schist-600)', onclick: () => triggerCapture('overview') }, '📷 نمای دور'), overviewInput,
          el('button', { class: 'btn-sm', style: 'background:var(--amber-100);color:var(--amber-700)', onclick: () => triggerCapture('serial') }, '🔢 عکس شماره سریال'), serialInput,
        ]),
        thumbBox('overview'), thumbBox('serial'),
      ]));
    });

    const addBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700);flex:1', onclick: () => {
      const tempKey = `new_${Date.now()}`;
      workingList.push({ key: tempKey, field: 'تجهیزات_نفت_گاز', name: '', model: '', type: 'نفت‌گاز', count: '' });
      editingKey = tempKey;
      draw();
    } }, '➕ افزودن ماشین جدید');
    const saveBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff;flex:1', onclick: async () => {
      saveBtn.disabled = true; saveBtn.textContent = '⏳ در حال ذخیره...';
      try {
        const byField = {};
        EQUIP_FIELD_KEYS.forEach(({ field }) => { byField[field] = []; });
        workingList.forEach((r) => {
          if (!r.name && !r.model && !r.count) return;
          byField[r.field].push({ نام: r.name, مدل: r.model, نوع: r.type, تعداد: r.count });
        });
        for (const field of Object.keys(byField)) {
          const { error } = await sb.rpc('tech_officer_update_equipment', { mine_name_in: mine[nameField], field_in: field, equipment_in: byField[field] });
          if (error) throw new Error(error.message);
        }
        EQUIP_FIELD_KEYS.forEach(({ field }) => { mine[field] = byField[field]; });
        showToast('✅ لیست ماشین‌آلات ذخیره شد');
        workingList = getMineEquipmentList(mine);
        editingKey = null;
        draw();
      } catch (err) {
        showToast(`❌ خطا: ${err.message}`);
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = '💾 ذخیره لیست';
      }
    } }, '💾 ذخیره لیست');
    container.append(el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [addBtn, saveBtn]));
  }

  draw();
}

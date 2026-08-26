import { el, showToast, openModal } from '../../lib/dom.js';
import { getMineCorners, dmsToDec, decToDMS } from '../../lib/geo.js';
import { updateDeptRecord } from '../../lib/records.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function openCornersEditModal(record, department, nameField, onSaved) {
  const existing = getMineCorners(record); // [[lat, lon], ...]
  const points = existing.map(([lat, lon]) => ({ lat, lon }));

  const { body, close } = openModal({ title: `📍 ویرایش مختصات چهارگوش — ${record[nameField] || ''}`, width: '420px' });
  body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'مختصات هر گوشه را به درجه‌ی اعشاری وارد کنید (نه درجه/دقیقه/ثانیه) — مثلاً 35.123456. ترتیب ردیف‌ها همان ترتیب گوشه‌هاست.'));

  const rowsBox = el('div');
  body.append(rowsBox);

  function drawRows() {
    rowsBox.innerHTML = '';
    if (!points.length) {
      rowsBox.append(el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs);text-align:center;padding:10px' }, 'هنوز گوشه‌ای ثبت نشده — با «افزودن گوشه» شروع کنید'));
      return;
    }
    points.forEach((p, i) => {
      const latInput = el('input', { type: 'number', step: 'any', placeholder: 'عرض جغرافیایی (lat)', value: p.lat, style: 'flex:1' });
      latInput.addEventListener('input', () => { p.lat = parseFloat(latInput.value) || 0; });
      const lonInput = el('input', { type: 'number', step: 'any', placeholder: 'طول جغرافیایی (lon)', value: p.lon, style: 'flex:1' });
      lonInput.addEventListener('input', () => { p.lon = parseFloat(lonInput.value) || 0; });
      const delBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => { points.splice(i, 1); drawRows(); } }, '🗑');
      rowsBox.append(el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:6px' }, [
        el('div', { style: 'width:22px;font-weight:700;color:var(--fluorite-700);text-align:center' }, LETTERS[i] || `#${i + 1}`),
        latInput, lonInput, delBtn,
      ]));
    });
  }
  drawRows();

  const addBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)' }, '➕ افزودن گوشه (دستی)');
  addBtn.addEventListener('click', () => {
    const last = points[points.length - 1];
    points.push({ lat: last ? last.lat : 35.0, lon: last ? last.lon : 47.7 });
    drawRows();
  });

  const gpsBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)' }, '📍 افزودن با موقعیت مکانی فعلی');
  gpsBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('⚠️ مرورگر شما از موقعیت‌مکانی پشتیبانی نمی‌کند'); return; }
    gpsBtn.disabled = true; gpsBtn.textContent = '⏳ در حال دریافت...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        points.push({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        drawRows();
        gpsBtn.disabled = false; gpsBtn.textContent = '📍 افزودن با موقعیت مکانی فعلی';
      },
      (err) => {
        showToast(`⚠️ دریافت موقعیت ناموفق بود: ${err.message}`);
        gpsBtn.disabled = false; gpsBtn.textContent = '📍 افزودن با موقعیت مکانی فعلی';
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  body.append(el('div', { style: 'display:flex;gap:6px;margin-top:8px' }, [addBtn, gpsBtn]));

  const saveBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:16px' }, '💾 ذخیره مختصات');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = '⏳ در حال ذخیره...';
    try {
      const updated = { ...record };
      LETTERS.forEach((l) => { delete updated[`طول_${l}`]; delete updated[`عرض_${l}`]; });
      points.forEach((p, i) => {
        const letter = LETTERS[i] || `#${i + 1}`;
        updated[`عرض_${letter}`] = decToDMS(p.lat);
        updated[`طول_${letter}`] = decToDMS(p.lon);
      });
      if (points.length) updated['تعداد_ضلع'] = String(points.length);
      else delete updated['تعداد_ضلع'];
      delete updated._rowId;
      await updateDeptRecord(department, record._rowId, updated);
      Object.assign(record, updated);
      showToast('✅ مختصات ذخیره شد');
      close();
      onSaved?.();
    } catch (err) {
      showToast(`⚠️ خطا در ذخیره: ${err.message}`);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = '💾 ذخیره مختصات';
    }
  });
  body.append(saveBtn);
}

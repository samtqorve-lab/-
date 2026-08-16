import { el, esc, showToast, openModal, fmtDate } from '../../lib/dom.js';
import { extractPointsFromFile, getFileExt } from '../../lib/surveyParsers.js';
import { computeTinVolume, renderVolumeHeatmap } from '../../lib/volumeCalc.js';
import { getMineCorners } from '../../lib/geo.js';
import { updateDeptRecord } from '../../lib/records.js';
import { sb } from '../../lib/supabase.js';

function fmtNum(n) {
  return Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 1 });
}

export function openVolumeModal(record, department, nameField, onSaved) {
  const { body, close } = openModal({ title: `📐 محاسبه‌ی حجم کات/فیل — ${record[nameField] || ''}`, width: '480px' });
  body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'دو فایل برداشت توپوگرافی (نقشه‌ی قدیم و جدید) را انتخاب کنید — فرمت‌های پشتیبانی‌شده: txt/csv/xyz/asc (X Y Z در هر خط)، DXF، KML، LandXML. هر دو فایل باید با یک سیستم مختصات (مثلاً UTM) باشند.'));

  const prevInput = el('input', { type: 'file', accept: '.txt,.csv,.xyz,.asc,.dxf,.kml,.xml' });
  const prevStatus = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:4px 0 10px' });
  const currInput = el('input', { type: 'file', accept: '.txt,.csv,.xyz,.asc,.dxf,.kml,.xml' });
  const currStatus = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:4px 0 10px' });
  body.append(
    el('label', {}, 'نقشه‌ی قبلی (مبنا)'), prevInput, prevStatus,
    el('label', {}, 'نقشه‌ی جدید'), currInput, currStatus,
  );

  const calcBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:8px' }, '📐 محاسبه');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  const canvas = el('canvas', { width: '400', height: '300', style: 'width:100%;border-radius:8px;border:1px solid var(--stone-300);margin-top:8px' });
  body.append(calcBtn, resultBox);

  let lastResult = null;

  calcBtn.addEventListener('click', async () => {
    const fPrev = prevInput.files[0]; const fCurr = currInput.files[0];
    if (!fPrev || !fCurr) { showToast('⚠️ هر دو فایل نقشه را انتخاب کنید'); return; }
    calcBtn.disabled = true; calcBtn.textContent = '⏳ در حال پردازش...';
    prevStatus.textContent = `در حال خواندن (${getFileExt(fPrev.name).toUpperCase()})...`;
    currStatus.textContent = `در حال خواندن (${getFileExt(fCurr.name).toUpperCase()})...`;
    try {
      const [ptsPrev, ptsCurr] = await Promise.all([extractPointsFromFile(fPrev), extractPointsFromFile(fCurr)]);
      prevStatus.textContent = `✅ ${ptsPrev.length.toLocaleString('fa-IR')} نقطه یافت شد`;
      currStatus.textContent = `✅ ${ptsCurr.length.toLocaleString('fa-IR')} نقطه یافت شد`;
      if (ptsPrev.length < 10 || ptsCurr.length < 10) {
        throw new Error('تعداد نقاط استخراج‌شده خیلی کم است — مطمئن شوید فایل شامل مختصات واقعی سه‌بعدی است');
      }
      calcBtn.textContent = '⏳ در حال مثلث‌بندی...';
      const grid = await computeTinVolume(ptsPrev, ptsCurr);
      lastResult = { grid, prevFile: fPrev, currFile: fCurr };

      resultBox.innerHTML = '';
      resultBox.style.display = 'block';
      resultBox.append(
        el('div', { class: 'kpi-grid' }, [
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--rust-600)' }, [el('div', { class: 'kpi-n' }, `${fmtNum(grid.cutVolume)}`), el('div', { class: 'kpi-l' }, 'حجم کات (m³)')]),
          el('div', { class: 'kpi-card', style: '--kpi-accent:#1565c0' }, [el('div', { class: 'kpi-n' }, `${fmtNum(grid.fillVolume)}`), el('div', { class: 'kpi-l' }, 'حجم فیل (m³)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(grid.netVolume)}`), el('div', { class: 'kpi-l' }, 'خالص (m³)')]),
        ]),
        canvas,
      );
      renderVolumeHeatmap(canvas, grid);

      const saveBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '💾 ذخیره نتیجه در پرونده‌ی این معدن');
      saveBtn.addEventListener('click', () => saveResult(saveBtn));
      resultBox.append(saveBtn);
    } catch (err) {
      showToast(`⚠️ خطا: ${err.message}`);
    } finally {
      calcBtn.disabled = false; calcBtn.textContent = '📐 محاسبه';
    }
  });

  async function saveResult(saveBtn) {
    if (!lastResult) return;
    saveBtn.disabled = true; saveBtn.textContent = '⏳ در حال ذخیره فایل‌ها...';
    const safeName = (record[nameField] || 'mine').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
    const ts = Date.now();
    try {
      const pathPrev = `${safeName}/${ts}_prev.${getFileExt(lastResult.prevFile.name)}`;
      const { error: e1 } = await sb.storage.from('survey-maps').upload(pathPrev, lastResult.prevFile);
      if (e1) throw e1;
      const prevUrl = sb.storage.from('survey-maps').getPublicUrl(pathPrev).data.publicUrl;

      const pathCurr = `${safeName}/${ts}_curr.${getFileExt(lastResult.currFile.name)}`;
      const { error: e2 } = await sb.storage.from('survey-maps').upload(pathCurr, lastResult.currFile);
      if (e2) throw e2;
      const currUrl = sb.storage.from('survey-maps').getPublicUrl(pathCurr).data.publicUrl;

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const pathSnap = `${safeName}/${ts}_heatmap.png`;
      const { error: e3 } = await sb.storage.from('survey-maps').upload(pathSnap, blob);
      if (e3) throw e3;
      const snapshotUrl = sb.storage.from('survey-maps').getPublicUrl(pathSnap).data.publicUrl;

      const rec = {
        date: new Date().toLocaleDateString('fa-IR'),
        method: 'tin',
        cutVolume: Math.round(lastResult.grid.cutVolume * 10) / 10,
        fillVolume: Math.round(lastResult.grid.fillVolume * 10) / 10,
        netVolume: Math.round(lastResult.grid.netVolume * 10) / 10,
        cellCount: lastResult.grid.cellCount,
        prevMapUrl: prevUrl,
        currMapUrl: currUrl,
        snapshotUrl,
        createdAt: new Date().toISOString(),
      };
      const updated = { ...record };
      updated['محاسبات_احجام'] = [...(Array.isArray(record['محاسبات_احجام']) ? record['محاسبات_احجام'] : []), rec];
      delete updated._rowId;
      await updateDeptRecord(department, record._rowId, updated);
      Object.assign(record, updated);
      showToast('✅ نتیجه محاسبه حجم ذخیره شد');
      close();
      onSaved?.();
    } catch (err) {
      showToast(`❌ خطا در آپلود — مطمئن شوید باکت "survey-maps" در Supabase Storage ساخته شده: ${err.message}`);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = '💾 ذخیره نتیجه در پرونده‌ی این معدن';
    }
  }
}

export function openVolumeHistoryModal(record, nameField) {
  const list = Array.isArray(record['محاسبات_احجام']) ? record['محاسبات_احجام'] : [];
  const { body } = openModal({ title: `📐 تاریخچه‌ی محاسبات حجم — ${record[nameField] || ''}`, width: '440px' });
  if (!list.length) { body.append(el('div', { class: 'empty-state' }, 'هنوز محاسبه‌ای ثبت نشده')); return; }
  list.slice().reverse().forEach((s) => {
    body.append(el('div', { class: 'card', style: 'margin-bottom:10px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;font-size:var(--text-sm)' }, [
        el('b', {}, s.date), el('span', {}, `خالص: ${fmtNum(s.netVolume)} m³`),
      ]),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:2px' },
        `کات: ${fmtNum(s.cutVolume)} m³ | فیل: ${fmtNum(s.fillVolume)} m³`),
      s.snapshotUrl ? el('img', { src: s.snapshotUrl, style: 'width:100%;border-radius:8px;margin-top:8px' }) : null,
      el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [
        s.prevMapUrl ? el('a', { href: s.prevMapUrl, target: '_blank', class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);text-decoration:none' }, '⬇️ نقشه قبلی') : null,
        s.currMapUrl ? el('a', { href: s.currMapUrl, target: '_blank', class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);text-decoration:none' }, '⬇️ نقشه جدید') : null,
      ]),
    ]));
  });
}

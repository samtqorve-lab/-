import { el, esc, showToast, openModal, fmtDate } from '../../lib/dom.js';
import { extractPointsFromFile, getFileExt } from '../../lib/surveyParsers.js';
import { computeTinVolume, renderVolumeHeatmap } from '../../lib/volumeCalc.js';
import { getMineCorners } from '../../lib/geo.js';
import { updateDeptRecord } from '../../lib/records.js';
import { sb } from '../../lib/supabase.js';
import { parseJalaliDateString, getCurrentJalaliYMD } from '../../lib/jalali.js';

function fmtNum(n) {
  return Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 1 });
}

/**
 * تبدیل حجم کات (کسر شده از زمین) به تناژ با وزن مخصوصِ ثبت‌شده در پروانه‌ی همین معدن، و مقایسه
 * با ذخیره‌ی قطعی و نرخ مجاز استخراج سالیانه — قبلاً محاسبه‌ی حجم فقط عدد m³ خام می‌داد و کاربر
 * باید خودش دستی این تبدیل و مقایسه را انجام می‌داد.
 */
function buildLicenseComparisonBox(record, cutVolumeM3) {
  const sg = parseFloat(record.وزن_مخصوص);
  if (!(sg > 0)) {
    return el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
      'ℹ️ برای تبدیل حجم کات به تناژ و مقایسه با ذخیره‌ی پروانه، فیلد «وزن مخصوص» این رکورد خالی یا نامعتبر است.');
  }
  const tons = cutVolumeM3 * sg;
  const lines = [`⚖️ معادل تناژیِ حجم کات (با وزن مخصوص ${sg} پروانه): <b>${fmtNum(tons)} تن</b>`];
  if (record.ذخیره_قطعی) {
    const pct = (tons / parseFloat(record.ذخیره_قطعی)) * 100;
    lines.push(`📊 نسبت به ذخیره‌ی قطعی ثبت‌شده (${fmtNum(parseFloat(record.ذخیره_قطعی))} تن): <b>${pct.toFixed(1)}٪</b>`);
  }
  if (record.استخراج_سالیانه && record.تاریخ_پروانه) {
    const licenseDate = parseJalaliDateString(record.تاریخ_پروانه);
    if (licenseDate) {
      const now = getCurrentJalaliYMD();
      const yearsElapsed = Math.max(0.1, (now.y - licenseDate.y) + (now.mo - licenseDate.mo) / 12);
      const expectedTons = parseFloat(record.استخراج_سالیانه) * yearsElapsed;
      lines.push(`📅 با نرخ مجاز سالیانه (${fmtNum(parseFloat(record.استخراج_سالیانه))} تن/سال) طی ${yearsElapsed.toFixed(1)} سال از تاریخ پروانه، انتظار می‌رفت حدود <b>${fmtNum(expectedTons)} تن</b> برداشت شده باشد.`);
    }
  }
  const box = el('div', {
    style: 'font-size:var(--text-xs);line-height:1.9;background:var(--stone-50);border-radius:8px;padding:10px 12px;margin-top:8px',
  });
  box.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  return box;
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
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--patina-600)' }, [el('div', { class: 'kpi-n' }, `${fmtNum(grid.fillVolume)}`), el('div', { class: 'kpi-l' }, 'حجم فیل (m³)')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${fmtNum(grid.netVolume)}`), el('div', { class: 'kpi-l' }, 'خالص (m³)')]),
        ]),
        buildLicenseComparisonBox(record, grid.cutVolume),
        canvas,
      );
      renderVolumeHeatmap(canvas, grid);

      const view3dBtn = el('button', { class: 'btn btn-ghost', style: 'width:100%;justify-content:center;margin-top:8px' }, '🗻 نمای سه‌بعدی روی تصویر ماهواره‌ای');
      view3dBtn.addEventListener('click', async () => {
        const { open3DVolumeModal } = await import('./volumeModal3D.js');
        open3DVolumeModal({ triangles: grid.triangles, surfaceA: grid.surfaceA, surfaceB: grid.surfaceB }, record, nameField);
      });
      resultBox.append(view3dBtn);

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

      // برای این‌که «نمای سه‌بعدی» (و برش عرضی) برای این محاسبه بعداً هم از تاریخچه در دسترس
      // باشد، هندسه‌ی خام مثلث‌ها را هم جدا (نه داخل رکورد اصلی معدن که حجیمش می‌کرد) ذخیره
      // می‌کنیم. آرایه‌های تایپ‌شده (Float64Array/Uint32Array) قابل JSON نیستند، پس تبدیل می‌شوند.
      const geometryPayload = {
        triangles: lastResult.grid.triangles,
        surfaceA: {
          coordsFlat: Array.from(lastResult.grid.surfaceA.coordsFlat),
          triangles: Array.from(lastResult.grid.surfaceA.triangles),
          zvals: lastResult.grid.surfaceA.zvals,
          bbox: lastResult.grid.surfaceA.bbox,
        },
        surfaceB: {
          coordsFlat: Array.from(lastResult.grid.surfaceB.coordsFlat),
          triangles: Array.from(lastResult.grid.surfaceB.triangles),
          zvals: lastResult.grid.surfaceB.zvals,
          bbox: lastResult.grid.surfaceB.bbox,
        },
      };
      const pathGeom = `${safeName}/${ts}_geometry.json`;
      const { error: e4 } = await sb.storage.from('survey-maps').upload(pathGeom, new Blob([JSON.stringify(geometryPayload)], { type: 'application/json' }));
      const geometryUrl = e4 ? null : sb.storage.from('survey-maps').getPublicUrl(pathGeom).data.publicUrl;

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
        geometryUrl,
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
    const view3dBtn = s.geometryUrl ? el('button', { class: 'btn-sm', style: 'background:var(--patina-50);color:var(--patina-700)' }, '🗻 نمای سه‌بعدی') : null;
    if (view3dBtn) {
      view3dBtn.addEventListener('click', async () => {
        view3dBtn.disabled = true; const orig = view3dBtn.textContent; view3dBtn.textContent = '⏳ در حال بارگذاری...';
        try {
          const res = await fetch(s.geometryUrl);
          if (!res.ok) throw new Error('فایل هندسه یافت نشد');
          const data = await res.json();
          const { open3DVolumeModal } = await import('./volumeModal3D.js');
          open3DVolumeModal(data, record, nameField);
        } catch (err) {
          showToast(`❌ خطا: ${err.message}`);
        } finally {
          view3dBtn.disabled = false; view3dBtn.textContent = orig;
        }
      });
    }
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
        view3dBtn,
      ]),
    ]));
  });
}

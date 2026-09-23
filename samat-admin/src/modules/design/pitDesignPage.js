import { el, showToast } from '../../lib/dom.js';
import { extractPointsFromFile, getFileExt } from '../../lib/surveyParsers.js';
import {
  buildSurface, designBenches, designRamp, computeCutVolume, rectanglePolygon,
  interRampAngleDeg, overallSlopeAngleDeg, polygonArea,
  exportBenchesDXF, exportRampDXF, exportReportCSV,
} from '../../lib/pitDesign.js';
import { openPitDesign3DViewer } from '../../lib/pitDesign3DViewer.js';

function fmtNum(n, digits = 1) {
  return Number(n).toLocaleString('fa-IR', { maximumFractionDigits: digits });
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function numberField(label, value, step = 'any') {
  const input = el('input', {
    type: 'number', value: String(value), step,
    style: 'width:100%',
  });
  return { wrap: el('div', {}, [el('label', {}, label), input]), input };
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** رسم نمای بالا (plan view) از نقاط توپوگرافی + حلقه‌های پله + خط رمپ روی canvas — بدون کتابخانه‌ی خارجی. */
function renderPlanView(canvas, points, designResult, rampResult) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#E4DFD2'; ctx.fillRect(0, 0, W, H);

  const finalPoly = designResult.benches[designResult.benches.length - 1].polygon;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  [...points.map(([x, y]) => [x, y]), ...finalPoly].forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  });
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08 || 10;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const extentX = (maxX - minX) || 1; const extentY = (maxY - minY) || 1;
  const scale = Math.min(W / extentX, H / extentY);
  const toX = (x) => (x - minX) * scale;
  const toY = (y) => H - (y - minY) * scale;

  ctx.fillStyle = 'rgba(90,74,58,0.35)';
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(toX(x), toY(y), 1.2, 0, Math.PI * 2);
    ctx.fill();
  });

  // حلقه‌های پله: کاچ‌بنچ پررنگ/ضخیم، پلهٔ میانی (بدون برم) کم‌رنگ/نازک، برون‌زد نهایی زرد
  const n = designResult.benches.length;
  designResult.benches.forEach((b, i) => {
    if (i === 0) {
      ctx.strokeStyle = '#3d3b32'; ctx.lineWidth = 2;
    } else if (b.outcropped) {
      ctx.strokeStyle = '#caa53d'; ctx.lineWidth = 2.5;
    } else if (b.isCatchBench) {
      ctx.strokeStyle = '#7a4a2a'; ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = 'rgba(120,110,95,0.55)'; ctx.lineWidth = 1;
    }
    ctx.beginPath();
    b.polygon.forEach(([x, y], j) => {
      if (j === 0) ctx.moveTo(toX(x), toY(y)); else ctx.lineTo(toX(x), toY(y));
    });
    ctx.closePath();
    ctx.stroke();
  });
  void n;

  if (rampResult) {
    ctx.strokeStyle = '#2b6fb0';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    rampResult.centerline.forEach((p, j) => {
      if (j === 0) ctx.moveTo(toX(p.x), toY(p.y)); else ctx.lineTo(toX(p.x), toY(p.y));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export async function renderPitDesign(container) {
  container.innerHTML = '';

  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'طراحی پارامتریک پله‌بندی معدن روباز از روی نقاط برداشت نقشه‌برداری یا فایل توپوگرافی، با تفکیک ',
    el('b', {}, 'شیب بین‌رمپی (IRA)'), ' از ', el('b', {}, 'شیب کلی نهایی دیواره (OSA)'),
    ' و پشتیبانی از کاچ‌بنچ چندتایی (Double/Triple Benching). فرمت‌های ورودی: txt/csv/xyz/asc، DXF، KML، LandXML.',
    el('br'),
    el('b', {}, '⚠️ توجه: '),
    'این ابزار اصول هندسی متداول طراحی پله‌بندی (IRA/OSA، فرمول ریچی برای برم، کاچ‌بنچ) را پیاده می‌کند، ',
    'اما توده‌سنگ، آب زیرزمینی، لرزه‌خیزی یا پایداری واقعی شیب را تحلیل نمی‌کند و بهینه‌سازی اقتصادی (مدل بلوک) هم نیست. ',
    'نتایج فقط طراحی هندسیِ الگویی‌اند — پیش از استفادهٔ عملیاتی حتماً با مهندس ژئوتکنیک/معدن و متن دقیق مقررهٔ حاکم تطبیق داده شود.',
  ]);

  const fileInput = el('input', { type: 'file', accept: '.txt,.csv,.xyz,.asc,.dxf,.kml,.xml' });
  const fileStatus = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:4px 0 10px' });

  const cx = numberField('مختصات مرکز کف گودال — X', 500000);
  const cy = numberField('مختصات مرکز کف گودال — Y', 3800000);
  const bl = numberField('طول کف گودال (m)', 100);
  const bw = numberField('عرض کف گودال (m)', 70);
  const ba = numberField('چرخش کف گودال (deg)', 0);
  const be = numberField('تراز کف گودال (m) — خالی = خودکار', '');
  be.input.placeholder = 'خودکار از روی نقاط';

  const bh = numberField('ارتفاع پلهٔ تکی H (m)', 10);
  const bang = numberField('شیب سینهٔ پله (deg)', 70);
  const catchN = numberField('فاصلهٔ کاچ‌بنچ (هر چند پله یک برم ایمنی)', 1, '1');

  const osaMode = el('input', { type: 'checkbox' });
  const osaModeWrap = el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-xs);margin-top:4px' }, [
    osaMode, 'به‌جای عرض برم ثابت، بر اساس یک «شیب نهایی هدف» طراحی شود (عرض برم خودکار حل می‌شود)',
  ]);
  const targetOSA = numberField('شیب نهایی هدف — OSA (deg)', 42);
  const berm = numberField('عرض برمِ کاچ‌بنچ (m)', 5);
  const bermAuto = el('input', { type: 'checkbox' });
  const bermAutoWrap = el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-xs);margin-top:4px' }, [
    bermAuto, 'به‌جای مقدار ثابت، از فرمول ریچی (۰.۲H+۴.۵ روی ارتفاع گروه کاچ‌بنچ) استفاده شود',
  ]);
  const maxB = numberField('سقف تعداد پله', 40, '1');
  const cellSize = numberField('اندازهٔ سلول محاسبهٔ حجم (m)', 3);

  const rampOn = el('input', { type: 'checkbox', checked: true });
  const rampOnWrap = el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-xs);margin-top:4px' }, [
    rampOn, 'رمپ/جادهٔ دسترسی هم طراحی شود',
  ]);
  const rampWidth = numberField('عرض جاده (m)', 8);
  const rampGrade = numberField('شیب درخواستی جاده (%)', 10);

  const formGrid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    cx.wrap, cy.wrap, bl.wrap, bw.wrap, ba.wrap, be.wrap,
    bh.wrap, bang.wrap, catchN.wrap, targetOSA.wrap, berm.wrap, maxB.wrap, cellSize.wrap,
    rampWidth.wrap, rampGrade.wrap,
  ]);

  function syncOsaFieldState() {
    targetOSA.input.disabled = !osaMode.checked;
    berm.input.disabled = osaMode.checked;
    bermAuto.disabled = osaMode.checked;
    targetOSA.wrap.style.opacity = osaMode.checked ? '1' : '0.45';
    berm.wrap.style.opacity = osaMode.checked ? '0.45' : '1';
    bermAutoWrap.style.opacity = osaMode.checked ? '0.45' : '1';
  }
  syncOsaFieldState();

  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '⛏ اجرای طراحی پله‌بندی');
  const liveHint = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:4px;display:none' }, '↻ با هر تغییر پارامتر، طراحی و نمودار به‌صورت خودکار به‌روز می‌شود.');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  const canvas = el('canvas', { width: '480', height: '360', style: 'width:100%;border-radius:8px;border:1px solid var(--stone-300);margin-top:8px' });

  let points = null;

  function runDesign() {
    if (!points) { showToast('⚠️ ابتدا یک فایل توپوگرافی معتبر انتخاب کنید'); return; }
    runBtn.disabled = true; const orig = runBtn.textContent; runBtn.textContent = '⏳ در حال طراحی...';
    try {
      const surface = buildSurface(points);
      const bottomPolygon = rectanglePolygon(
        [parseFloat(cx.input.value), parseFloat(cy.input.value)],
        parseFloat(bl.input.value), parseFloat(bw.input.value), parseFloat(ba.input.value) || 0,
      );
      const params = {
        benchHeight: parseFloat(bh.input.value),
        benchFaceAngleDeg: parseFloat(bang.input.value),
        catchBenchInterval: parseInt(catchN.input.value, 10) || 1,
        bermWidth: parseFloat(berm.input.value),
        bermWidthAuto: bermAuto.checked,
        osaMode: osaMode.checked,
        targetOSADeg: parseFloat(targetOSA.input.value),
        maxBenches: parseInt(maxB.input.value, 10) || 40,
        bottomElevation: be.input.value === '' ? null : parseFloat(be.input.value),
      };
      const result = designBenches(surface, bottomPolygon, params);
      const volume = computeCutVolume(surface, result, parseFloat(cellSize.input.value) || 3);
      const ramp = rampOn.checked && result.benches.length > 1
        ? designRamp(result, { width: parseFloat(rampWidth.input.value) || 8, gradePercent: parseFloat(rampGrade.input.value) || 10 })
        : null;

      resultBox.innerHTML = '';
      resultBox.style.display = 'block';
      const benchCount = result.benches.length - 1;
      const catchCount = result.benches.filter((b) => b.isCatchBench).length;
      const ira = interRampAngleDeg(result.params);
      const osa = overallSlopeAngleDeg(result.params, result.resolvedBerm);
      const kpis = [
        el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${benchCount}`), el('div', { class: 'kpi-l' }, `پله (${catchCount} کاچ‌بنچ)`)]),
        el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${ira.toFixed(1)}°`), el('div', { class: 'kpi-l' }, 'شیب بین‌رمپی — IRA')]),
        el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${osa.toFixed(1)}°`), el('div', { class: 'kpi-l' }, 'شیب کلی نهایی — OSA')]),
        el('div', { class: 'kpi-card', style: '--kpi-accent:var(--rust-600)' }, [el('div', { class: 'kpi-n' }, fmtNum(volume.totalCutM3, 0)), el('div', { class: 'kpi-l' }, 'حجم کل خاک‌برداری (m³)')]),
      ];
      if (ramp) {
        kpis.push(el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, fmtNum(ramp.totalLength, 0)), el('div', { class: 'kpi-l' }, 'طول کل رمپ (m)')]));
      }
      resultBox.append(el('div', { class: 'kpi-grid' }, kpis));

      const infoLines = [
        `عرض برمِ کاچ‌بنچ: ${result.resolvedBerm.toFixed(2)} m — از تراز ${result.benches[0].elevation.toFixed(1)} تا ${result.benches[result.benches.length - 1].elevation.toFixed(1)} متر`,
      ];
      if (result.osaInfo && result.osaInfo.clamped) {
        infoLines.push(`⚠️ شیب هدف (${result.osaInfo.requestedOSA}°) با حداقل برم ایمنی (ریچی) قابل‌دستیابی نبود؛ برم در حداقل ایمن نگه داشته شد و شیب واقعی معادل ${result.osaInfo.achievedOSA.toFixed(1)}° است — ایمنی فدای عدد شیب نشد.`);
      }
      resultBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, infoLines.join(' — ')), canvas);
      renderPlanView(canvas, points, result, ramp);

      const table = el('table', { class: 'data-table', style: 'width:100%;margin-top:10px;font-size:var(--text-xs)' });
      table.append(el('thead', {}, el('tr', {}, ['پله', 'تراز (m)', 'مساحت (m²)', 'کاچ‌بنچ؟', 'برون‌زد؟'].map((h) => el('th', {}, h)))));
      const tbody = el('tbody');
      result.benches.forEach((b) => {
        tbody.append(el('tr', {}, [
          el('td', {}, String(b.level)),
          el('td', {}, b.elevation.toFixed(1)),
          el('td', {}, fmtNum(polygonArea(b.polygon), 0)),
          el('td', {}, b.isCatchBench ? '🟫' : ''),
          el('td', {}, b.outcropped ? '✅' : ''),
        ]));
      });
      table.append(tbody);
      resultBox.append(table);

      if (ramp) {
        const worst = ramp.segments.reduce((m, s) => (Number.isFinite(s.gradePercent) && s.gradePercent > m ? s.gradePercent : m), 0);
        resultBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
          `رمپ: عرض ${ramp.width} متر، شیب درخواستی ${ramp.requestedGradePercent}٪، بیشینهٔ شیب واقعیِ محاسبه‌شده در طول مسیر: ${worst.toFixed(1)}٪ (خط چین آبی در نقشه).`));
      }

      const view3dBtn = el('button', {
        class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:10px',
        onclick: () => openPitDesign3DViewer(surface, result, ramp),
      }, '🧊 نمایش سه‌بعدی (پله + جاده روی زمین واقعی)');
      resultBox.append(view3dBtn);

      const exportRow = el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [
        el('button', {
          class: 'btn btn-ghost', style: 'flex:1;justify-content:center',
          onclick: () => downloadText(exportBenchesDXF(result), 'pit_benches.dxf', 'application/dxf'),
        }, '⬇ خروجی DXF (پله‌ها)'),
        ...(ramp ? [el('button', {
          class: 'btn btn-ghost', style: 'flex:1;justify-content:center',
          onclick: () => downloadText(exportRampDXF(ramp), 'pit_ramp.dxf', 'application/dxf'),
        }, '⬇ خروجی DXF (رمپ)')] : []),
        el('button', {
          class: 'btn btn-ghost', style: 'flex:1;justify-content:center',
          onclick: () => downloadText(exportReportCSV(result, volume, ramp), 'design_report.csv', 'text/csv;charset=utf-8;'),
        }, '⬇ گزارش CSV'),
      ]);
      resultBox.append(exportRow);
      liveHint.style.display = 'block';
    } catch (err) {
      showToast(`⚠️ خطا: ${err.message}`);
    } finally {
      runBtn.disabled = false; runBtn.textContent = orig;
    }
  }

  const liveRecompute = debounce(() => { if (points) runDesign(); }, 450);
  formGrid.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', liveRecompute);
  });
  [osaMode, bermAuto, rampOn].forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb === osaMode) syncOsaFieldState();
      liveRecompute();
    });
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    fileStatus.textContent = `در حال خواندن (${getFileExt(f.name).toUpperCase()})...`;
    try {
      points = await extractPointsFromFile(f);
      if (points.length < 10) throw new Error('تعداد نقاط استخراج‌شده خیلی کم است');
      fileStatus.textContent = `✅ ${points.length.toLocaleString('fa-IR')} نقطه یافت شد`;
      runDesign();
    } catch (err) {
      points = null;
      fileStatus.textContent = `⚠️ خطا: ${err.message}`;
    }
  });

  runBtn.addEventListener('click', runDesign);

  container.append(el('div', { class: 'card' }, [
    el('h3', {}, '⛰ طراحی پله‌بندی معدن روباز + رمپ دسترسی'),
    intro,
    el('label', {}, 'فایل توپوگرافی'), fileInput, fileStatus,
    formGrid,
    osaModeWrap,
    bermAutoWrap,
    rampOnWrap,
    runBtn,
    liveHint,
    resultBox,
  ]));
}

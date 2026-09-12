import { el, showToast } from '../../lib/dom.js';
import { extractPointsFromFile, getFileExt } from '../../lib/surveyParsers.js';
import {
  buildSurface, designBenches, computeCutVolume, rectanglePolygon,
  benchSetback, overallSlopeAngleDeg, bermWidthRitchie, polygonArea,
  exportBenchesDXF, exportReportCSV,
} from '../../lib/pitDesign.js';

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

/** رسم نمای بالا (plan view) از نقاط توپوگرافی + حلقه‌های پله روی canvas — بدون کتابخانه‌ی خارجی. */
function renderPlanView(canvas, points, designResult) {
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

  // نقاط توپوگرافی به‌عنوان زمینه
  ctx.fillStyle = 'rgba(90,74,58,0.35)';
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(toX(x), toY(y), 1.2, 0, Math.PI * 2);
    ctx.fill();
  });

  // حلقه‌های پله، از کف (تیره) تا پوستهٔ نهایی (روشن)
  const n = designResult.benches.length;
  designResult.benches.forEach((b, i) => {
    const t = n <= 1 ? 0 : i / (n - 1);
    ctx.strokeStyle = `rgb(${Math.round(140 + 100 * t)},${Math.round(40 + 20 * t)},${Math.round(30)})`;
    ctx.lineWidth = i === n - 1 ? 2.5 : 1.2;
    ctx.beginPath();
    b.polygon.forEach(([x, y], j) => {
      if (j === 0) ctx.moveTo(toX(x), toY(y)); else ctx.lineTo(toX(x), toY(y));
    });
    ctx.closePath();
    ctx.stroke();
  });
}

export async function renderPitDesign(container) {
  container.innerHTML = '';

  const intro = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, [
    'طراحی پارامتریک پله‌بندی معدن روباز از روی نقاط برداشت نقشه‌برداری یا فایل توپوگرافی. ',
    'فرمت‌های ورودی: txt/csv/xyz/asc، DXF، KML، LandXML.',
    el('br'),
    el('b', {}, '⚠️ توجه: '),
    'این ابزار پوستهٔ نهایی را به‌صورت هندسی/الگویی می‌سازد (نه بهینه‌سازی اقتصادی با مدل بلوک). ',
    'مقادیر پیش‌فرض (ارتفاع پله، شیب سینه، فرمول ریچی برای برم) مقادیر متداول صنعتی‌اند — پیش از استفادهٔ عملیاتی با متن دقیق آیین‌نامهٔ اصول طراحی معادن روباز و نظر مهندس ناظر تطبیق دهید.',
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

  const bh = numberField('ارتفاع پله H (m)', 10);
  const bang = numberField('شیب سینهٔ پله (deg)', 70);
  const berm = numberField('عرض برم ایمنی (m)', 5);
  const bermAuto = el('input', { type: 'checkbox' });
  const bermAutoWrap = el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-xs);margin-top:4px' }, [
    bermAuto, 'به‌جای مقدار ثابت، از فرمول ریچی (۰.۲H+۴.۵) استفاده شود',
  ]);
  const maxB = numberField('سقف تعداد پله', 40, '1');
  const cellSize = numberField('اندازهٔ سلول محاسبهٔ حجم (m)', 3);

  const formGrid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px 14px' }, [
    cx.wrap, cy.wrap, bl.wrap, bw.wrap, ba.wrap, be.wrap,
    bh.wrap, bang.wrap, berm.wrap, maxB.wrap, cellSize.wrap,
  ]);

  const runBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:12px' }, '⛏ اجرای طراحی پله‌بندی');
  const resultBox = el('div', { style: 'margin-top:14px;display:none' });
  const canvas = el('canvas', { width: '480', height: '360', style: 'width:100%;border-radius:8px;border:1px solid var(--stone-300);margin-top:8px' });

  let points = null;
  let lastResult = null;
  let lastVolume = null;

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    fileStatus.textContent = `در حال خواندن (${getFileExt(f.name).toUpperCase()})...`;
    try {
      points = await extractPointsFromFile(f);
      if (points.length < 10) throw new Error('تعداد نقاط استخراج‌شده خیلی کم است');
      fileStatus.textContent = `✅ ${points.length.toLocaleString('fa-IR')} نقطه یافت شد`;
    } catch (err) {
      points = null;
      fileStatus.textContent = `⚠️ خطا: ${err.message}`;
    }
  });

  runBtn.addEventListener('click', () => {
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
        bermWidth: parseFloat(berm.input.value),
        bermWidthAuto: bermAuto.checked,
        maxBenches: parseInt(maxB.input.value, 10) || 40,
        bottomElevation: be.input.value === '' ? null : parseFloat(be.input.value),
      };
      const result = designBenches(surface, bottomPolygon, params);
      const volume = computeCutVolume(surface, result, parseFloat(cellSize.input.value) || 3);
      lastResult = result; lastVolume = volume;

      resultBox.innerHTML = '';
      resultBox.style.display = 'block';
      const benchCount = result.benches.length - 1;
      resultBox.append(
        el('div', { class: 'kpi-grid' }, [
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${benchCount}`), el('div', { class: 'kpi-l' }, 'تعداد پله')]),
          el('div', { class: 'kpi-card' }, [el('div', { class: 'kpi-n' }, `${overallSlopeAngleDeg(params).toFixed(1)}°`), el('div', { class: 'kpi-l' }, 'شیب کلی دیواره')]),
          el('div', { class: 'kpi-card', style: '--kpi-accent:var(--rust-600)' }, [el('div', { class: 'kpi-n' }, fmtNum(volume.totalCutM3, 0)), el('div', { class: 'kpi-l' }, 'حجم کل خاک‌برداری (m³)')]),
        ]),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
          `واپس‌روی هر پله: ${benchSetback(params).toFixed(2)} m${params.bermWidthAuto ? ` (عرض برم طبق فرمول ریچی: ${bermWidthRitchie(params.benchHeight).toFixed(2)} m)` : ''} — از تراز ${result.benches[0].elevation.toFixed(1)} تا ${result.benches[result.benches.length - 1].elevation.toFixed(1)} متر`),
        canvas,
      );
      renderPlanView(canvas, points, result);

      const table = el('table', { class: 'data-table', style: 'width:100%;margin-top:10px;font-size:var(--text-xs)' });
      table.append(el('thead', {}, el('tr', {}, ['پله', 'تراز (m)', 'مساحت (m²)', 'برون‌زد؟'].map((h) => el('th', {}, h)))));
      const tbody = el('tbody');
      result.benches.forEach((b) => {
        tbody.append(el('tr', {}, [
          el('td', {}, String(b.level)),
          el('td', {}, b.elevation.toFixed(1)),
          el('td', {}, fmtNum(polygonArea(b.polygon), 0)),
          el('td', {}, b.outcropped ? '✅' : ''),
        ]));
      });
      table.append(tbody);
      resultBox.append(table);

      const exportRow = el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [
        el('button', {
          class: 'btn btn-ghost', style: 'flex:1;justify-content:center',
          onclick: () => downloadText(exportBenchesDXF(result), 'pit_benches.dxf', 'application/dxf'),
        }, '⬇ خروجی DXF'),
        el('button', {
          class: 'btn btn-ghost', style: 'flex:1;justify-content:center',
          onclick: () => downloadText(exportReportCSV(result, volume), 'design_report.csv', 'text/csv;charset=utf-8;'),
        }, '⬇ گزارش CSV'),
      ]);
      resultBox.append(exportRow);
    } catch (err) {
      showToast(`⚠️ خطا: ${err.message}`);
    } finally {
      runBtn.disabled = false; runBtn.textContent = orig;
    }
  });

  container.append(el('div', { class: 'card' }, [
    el('h3', {}, '⛰ طراحی پله‌بندی معدن روباز'),
    intro,
    el('label', {}, 'فایل توپوگرافی'), fileInput, fileStatus,
    formGrid,
    bermAutoWrap,
    runBtn,
    resultBox,
  ]));
}

import { el, showToast, openModal } from '../../lib/dom.js';
import {
  QUALITY_OPTIONS, MIN_PHOTOS, MAX_PHOTOS, ASSET_INFO,
  listJobs, createJob, startJob, removeJob, uploadPhotos, downloadModel, saveBlob, runSelftest, mergeJobs,
} from '../../lib/model3d.js';
import { createOptionsPanel } from '../../lib/model3dOptions.js';
import { getMineCorners } from '../../lib/geo.js';
import { saveHandoff } from '../../lib/pitDesignHandoff.js';
import { setTab } from '../../router.js';

/**
 * نسخه‌ی ادمین: همان ساخت مدل سه‌بعدی، به‌همراه «مشاهده»، «بررسی اتصال» و دسترسی به مدل‌های همه‌ی کاربران این معدن.
 * ساخت مدل سه‌بعدی از عکس‌های پهباد برای یک معدن. عکس‌ها در همین دستگاه کوچک و رمز می‌شوند، روی GitHub
 * با OpenDroneMap به مدل تبدیل می‌شوند و فقط خروجی رمزشده آنجا می‌ماند (نه در فضای Supabase).
 * دو نوع پردازش: «پیش‌نمایش سریع» و «نقشه‌برداری دقیق» (DSM برای محاسبه‌ی حجم؛ با GPS معمولی،
 * موقعیت دقیق PPK/RTK یا نقاط کنترل زمینی). ساخت چند دقیقه تا چند ساعت طول می‌کشد؛ بعد از شروع
 * می‌توان صفحه را بست.
 *
 * برای معدن‌های بزرگ که با یک پرواز پوشش داده نمی‌شوند: هر پرواز را جداگانه (دوباره از همین پنجره،
 * با «📂 انتخاب عکس‌های پهباد») در حالت «نقشه‌برداری دقیق» بسازید؛ وقتی دو یا چند پرواز survey از
 * این معدن آماده شد، دکمه‌ی «🧩 ادغام پرواز‌ها» همه‌شان را در یک DSM/ارتوفتو/مدل یکپارچه ادغام می‌کند.
 */

const STATUS = {
  uploading: { label: 'آپلود ناتمام', color: 'var(--stone-600)' },
  queued: { label: 'در حال ساخت مدل…', color: 'var(--ink-700)' },
  done: { label: 'آماده', color: 'var(--patina-700)' },
  failed: { label: 'ناموفق', color: 'var(--rust-700)' },
};
const GEOREF_LABEL = { exif: 'GPS معمولی', geo: 'PPK/RTK', gcp: 'GCP' };
const ASSET_SHORT = {
  'dsm.tif': 'DSM', 'ortho.tif': 'اورتوفوتو', 'stats.json': 'گزارش',
  'pointcloud.laz': 'ابرنقاط', 'contours.dxf': 'تراز DXF', 'report.pdf': 'PDF',
};
const POLL_MS = 30_000;
const MIN_MERGE_FLIGHTS = 2;

const PREFLIGHT_ITEMS = [
  'باتری‌ها شارژ و پروانه‌ها سالم و بدون آسیب است',
  'GPS/موقعیت‌یاب پهباد قفل شده (یا RTK/GCP آماده است)',
  'مسیر پرواز با هم‌پوشانی حداقل ۷۰٪ برنامه‌ریزی شده',
  'وضعیت هوا (باد، بارش، دید) برای پرواز مناسب است',
  'مجوز/هماهنگی لازم برای پرواز در این منطقه گرفته شده',
];

function fmtWhen(iso) {
  try { return new Date(iso).toLocaleString('fa-IR'); } catch { return ''; }
}

const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('fa-IR', { maximumFractionDigits: 1 }) : '—');

/** خطای ODM (متر) را به سانتی‌متر نشان می‌دهد، به‌همراه حجم و تغییر (از samat-3d) اگر موجود باشد */
function summaryText(j) {
  const s = j.summary;
  if (!s) return '';
  const lines = [];
  const fmt = (e) => (e && ['x', 'y', 'z'].every((k) => typeof e[k] === 'number')
    ? `X ${(e.x * 100).toFixed(1)} · Y ${(e.y * 100).toFixed(1)} · Z ${(e.z * 100).toFixed(1)} سانتی‌متر` : '');
  const g = fmt(s.gcp_errors && s.gcp_errors.error);
  if (g) lines.push(`خطای نقاط کنترل: ${g}`);
  else {
    const p = fmt(s.gps_errors && s.gps_errors.error);
    if (p) lines.push(`خطای موقعیت GPS: ${p}`);
  }
  if (s.volume) {
    const v = s.volume;
    lines.push(`حجم — برداشت ${fmtNum(v.cut_m3)} · افزوده ${fmtNum(v.fill_m3)} · خالص ${fmtNum(v.net_change_m3)} م³`);
  }
  if (s.change) {
    const c = s.change;
    lines.push(`تغییر نسبت به قبل — برداشت ${fmtNum(c.cut_m3)} · افزوده ${fmtNum(c.fill_m3)} م³`);
  }
  if (s.warnings && s.warnings.length) lines.push(`⚠️ ${s.warnings.length} هشدار سازگاری هنگام ادغام`);
  return lines.join(' — ');
}

export function openModel3dModal(mine, nameField) {
  const mineName = mine[nameField];
  const { overlay, body, close: closeModal } = openModal({ title: `🚚! مدل سه‌بعدی از پهباد — ${mineName}`, width: '440px' });
  const isOpen = () => document.body.contains(overlay);

  let busy = false;
  let jobsCache = [];
  let files = [];
  let pollTimer = null;
  const preflightChecks = PREFLIGHT_ITEMS.map(() => false);
  const preflightDone = () => preflightChecks.every(Boolean);

  const jobsBox = el('div', { style: 'margin-top:8px' });
  const mergeBox = el('div', { style: 'margin-top:10px;display:none' });
  const errBox = el('div', { style: 'color:var(--rust-700);font-size:var(--text-xs);margin-top:8px;min-height:4px' });
  const fileInput = el('input', { type: 'file', accept: 'image/jpeg', multiple: '', style: 'display:none' });
  const pickBtn = el('button', { class: 'btn', style: 'width:100%' }, '📂 انتخاب عکس‌های پهباد');
  const summary = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' });
  const qualitySelect = el('select', {}, QUALITY_OPTIONS.map((q) => el('option', { value: q.id }, q.label)));
  const qualityNote = el('div', { style: 'font-size:11px;color:var(--stone-600);margin-top:4px;display:none' }, 'با نقاط کنترل زمینی (GCP) عکس‌ها با اندازه‌ی اصلی آپلود می‌شوند.');
  const startBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px', disabled: '' }, '🚀 شروع ساخت مدل');
  const progressText = el('div', { style: 'font-size:var(--text-xs);color:var(--ink-700);margin-top:10px' });
  const progressBar = el('progress', { max: '100', value: '0', style: 'width:100%;display:none' });
  const panel = createOptionsPanel({ onChange: () => refresh() });

  const preflightBox = el('div', { style: 'margin-top:10px;padding:8px;border:1px solid var(--stone-200);border-radius:8px' }, [
    el('div', { style: 'font-weight:700;font-size:11px;margin-bottom:6px;color:var(--ink-700)' }, '✅ چک‌لیست پیش از پرواز'),
    ...PREFLIGHT_ITEMS.map((label, i) => {
      const cb = el('input', { type: 'checkbox', style: 'margin-inline-end:6px' });
      cb.addEventListener('change', () => { preflightChecks[i] = cb.checked; refresh(); });
      return el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--stone-600);padding:2px 0;cursor:pointer' }, [cb, label]);
    }),
  ]);

  /** وضعیت دکمه‌ها را با انتخاب عکس‌ها، تنظیمات پنل، چک‌لیست پیش‌پرواز و مشغول‌بودن هماهنگ می‌کند */
  function refresh() {
    const check = panel.render(files.map((f) => f.name));
    const locked = panel.forcesOriginalSize();
    if (locked) qualitySelect.value = 'original';
    qualityNote.style.display = locked ? 'block' : 'none';
    qualitySelect.disabled = busy || locked;
    pickBtn.disabled = busy;
    panel.setDisabled(busy);
    startBtn.disabled = busy || files.length < MIN_PHOTOS || !check.ok || !preflightDone();
  }

  function setBusy(v) {
    busy = v;
    refresh();
  }

  function setProgress(text, pct) {
    progressText.textContent = text;
    if (pct === null || pct === undefined) { progressBar.style.display = 'none'; return; }
    progressBar.style.display = 'block';
    progressBar.value = pct;
  }

  function schedulePoll(jobs) {
    clearTimeout(pollTimer);
    if (jobs.some((j) => j.status === 'queued')) {
      pollTimer = setTimeout(() => { if (isOpen()) loadJobs(); }, POLL_MS);
    }
  }

  function assetButton(j, asset, text, style) {
    const btn = el('button', { class: 'btn-sm', style }, text);
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '⏳ در حال دریافت...';
      try {
        const blob = await downloadModel(j.jobId, asset);
        const info = ASSET_INFO[asset];
        await saveBlob(blob, `${j.jobId.slice(0, 8)}-${info.file}`);
      } catch (err) { errBox.textContent = err.message; }
      btn.disabled = false; btn.textContent = text;
    });
    return btn;
  }
}

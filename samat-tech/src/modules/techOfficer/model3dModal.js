import { el, showToast, openModal } from '../../lib/dom.js';
import {
  QUALITY_OPTIONS, MIN_PHOTOS, MAX_PHOTOS, ASSET_INFO,
  listJobs, createJob, startJob, removeJob, uploadPhotos, downloadModel, saveBlob,
} from '../../lib/model3d.js';
import { createOptionsPanel } from '../../lib/model3dOptions.js';

/**
 * ساخت مدل سه‌بعدی از عکس‌های پهباد برای یک معدن. عکس‌ها در همین دستگاه کوچک و رمز می‌شوند، روی GitHub
 * با OpenDroneMap به مدل تبدیل می‌شوند و فقط خروجی رمزشده آنجا می‌ماند (نه در فضای Supabase).
 * دو نوع پردازش: «پیش‌نمایش سریع» و «نقشه‌برداری دقیق» (DSM برای محاسبه‌ی حجم؛ با GPS معمولی،
 * موقعیت دقیق PPK/RTK یا نقاط کنترل زمینی). ساخت چند دقیقه تا چند ساعت طول می‌کشد؛ بعد از شروع
 * می‌توان صفحه را بست.
 */

const STATUS = {
  uploading: { label: 'آپلود ناتمام', color: 'var(--stone-600)' },
  queued: { label: 'در حال ساخت مدل…', color: 'var(--ink-700)' },
  done: { label: 'آماده', color: 'var(--patina-700)' },
  failed: { label: 'ناموفق', color: 'var(--rust-700)' },
};
const GEOREF_LABEL = { exif: 'GPS معمولی', geo: 'PPK/RTK', gcp: 'GCP' };
const ASSET_SHORT = { 'dsm.tif': 'DSM', 'ortho.tif': 'اورتوفوتو', 'stats.json': 'گزارش' };
const POLL_MS = 30_000;

function fmtWhen(iso) {
  try { return new Date(iso).toLocaleString('fa-IR'); } catch { return ''; }
}

/** خطای ODM (متر) را به سانتی‌متر نشان می‌دهد؛ فقط اگر عددهای x,y,z موجود باشند */
function summaryText(j) {
  const s = j.summary;
  if (!s) return '';
  const fmt = (e) => (e && ['x', 'y', 'z'].every((k) => typeof e[k] === 'number')
    ? `X ${(e.x * 100).toFixed(1)} · Y ${(e.y * 100).toFixed(1)} · Z ${(e.z * 100).toFixed(1)} سانتی‌متر` : '');
  const g = fmt(s.gcp_errors && s.gcp_errors.error);
  if (g) return `خطای نقاط کنترل: ${g}`;
  const p = fmt(s.gps_errors && s.gps_errors.error);
  return p ? `خطای موقعیت GPS: ${p}` : '';
}

export function openModel3dModal(mine, nameField) {
  const mineName = mine[nameField];
  const { overlay, body } = openModal({ title: `🧊 مدل سه‌بعدی — ${mineName}`, width: '440px' });
  const isOpen = () => document.body.contains(overlay);

  let busy = false;
  let files = [];
  let pollTimer = null;

  const jobsBox = el('div', { style: 'margin-top:8px' });
  const errBox = el('div', { class: 'gate-err' });
  const fileInput = el('input', { type: 'file', accept: 'image/jpeg', multiple: '', style: 'display:none' });
  const pickBtn = el('button', { class: 'btn', style: 'width:100%' }, '📂 انتخاب عکس‌های پهباد');
  const summary = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' });
  const qualitySelect = el('select', {}, QUALITY_OPTIONS.map((q) => el('option', { value: q.id }, q.label)));
  const qualityNote = el('div', { style: 'font-size:11px;color:var(--stone-600);margin-top:4px;display:none' }, 'با نقاط کنترل زمینی (GCP) عکس‌ها با اندازه‌ی اصلی آپلود می‌شوند.');
  const startBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px', disabled: '' }, '🚀 شروع ساخت مدل');
  const progressText = el('div', { style: 'font-size:var(--text-xs);color:var(--ink-700);margin-top:10px' });
  const progressBar = el('progress', { max: '100', value: '0', style: 'width:100%;display:none' });
  const panel = createOptionsPanel({ onChange: () => refresh() });

  /** وضعیت دکمه‌ها را با انتخاب عکس‌ها، تنظیمات پنل و مشغول‌بودن هماهنگ می‌کند */
  function refresh() {
    const check = panel.render(files.map((f) => f.name));
    const locked = panel.forcesOriginalSize();
    if (locked) qualitySelect.value = 'original';
    qualityNote.style.display = locked ? 'block' : 'none';
    qualitySelect.disabled = busy || locked;
    pickBtn.disabled = busy;
    panel.setDisabled(busy);
    startBtn.disabled = busy || files.length < MIN_PHOTOS || !check.ok;
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

  function jobRow(j) {
    const st = STATUS[j.status] || { label: j.status, color: 'var(--stone-600)' };
    const actions = [];
    const assets = j.assets && j.assets.length ? j.assets : ['model.glb'];
    if (j.status === 'done') {
      if (assets.includes('model.glb')) actions.push(assetButton(j, 'model.glb', '⬇️ مدل', 'background:var(--patina-700);color:#fff'));
      ['dsm.tif', 'stats.json', 'ortho.tif'].filter((a) => assets.includes(a)).forEach((a) => {
        actions.push(assetButton(j, a, `⬇️ ${ASSET_SHORT[a]}`, 'background:var(--stone-200);color:var(--ink-700)'));
      });
    }
    if (j.status === 'failed') {
      const retry = el('button', { class: 'btn-sm', style: 'background:var(--stone-200);color:var(--ink-700)' }, '🔁 تلاش مجدد');
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try { await startJob(j.jobId, {}); showToast('دوباره در صف قرار گرفت'); } catch (err) { errBox.textContent = err.message; }
        loadJobs();
      });
      actions.push(retry);
    }
    if (j.status !== 'queued') {
      const del = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)' }, '🗑');
      del.addEventListener('click', async () => {
        // eslint-disable-next-line no-alert
        if (!window.confirm('این مدل و عکس‌های آن برای همیشه حذف شود؟')) return;
        del.disabled = true;
        try { await removeJob(j.jobId); } catch (err) { errBox.textContent = err.message; }
        loadJobs();
      });
      actions.push(del);
    }
    const kind = j.mode === 'survey' ? `نقشه‌برداری (${GEOREF_LABEL[j.georef] || ''})` : 'پیش‌نمایش';
    const extra = j.status === 'done' ? summaryText(j) : '';
    return el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--stone-200)' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap' }, [
        el('div', { style: 'flex:1 1 150px;min-width:0' }, [
          el('div', { style: `font-weight:700;font-size:12px;color:${st.color}` }, `${st.label} — ${kind}`),
          el('div', { style: 'font-size:11px;color:var(--stone-600)' }, `${fmtWhen(j.createdAt)}${j.photoCount ? ` — ${j.photoCount} عکس` : ''}`),
        ]),
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, actions),
      ]),
      extra ? el('div', { style: 'font-size:11px;color:var(--stone-600);margin-top:4px' }, extra) : null,
      j.status === 'failed' && j.error ? el('div', { style: 'font-size:11px;color:var(--rust-700);margin-top:4px' }, j.error) : null,
    ]);
  }

  async function loadJobs() {
    try {
      const jobs = await listJobs(mineName);
      jobsBox.innerHTML = '';
      if (!jobs.length) {
        jobsBox.append(el('div', { style: 'font-size:11px;color:var(--stone-500)' }, 'هنوز مدلی برای این معدن ساخته نشده'));
      } else {
        jobs.forEach((j) => jobsBox.append(jobRow(j)));
      }
      schedulePoll(jobs);
    } catch (err) {
      jobsBox.innerHTML = '';
      jobsBox.append(el('div', { style: 'font-size:11px;color:var(--rust-700)' }, `خطا در بارگذاری فهرست: ${err.message}`));
    }
  }

  fileInput.addEventListener('change', () => {
    errBox.textContent = '';
    files = Array.from(fileInput.files || []).filter((f) => f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name));
    fileInput.value = '';
    const mb = files.reduce((n, f) => n + f.size, 0) / 1048576;
    if (files.length > MAX_PHOTOS) {
      errBox.textContent = `حداکثر ${MAX_PHOTOS} عکس در هر مدل مجاز است`;
      files = [];
    }
    summary.textContent = files.length ? `${files.length} عکس انتخاب شد (${mb.toFixed(0)} مگابایت)` : '';
    if (files.length && files.length < MIN_PHOTOS) errBox.textContent = `حداقل ${MIN_PHOTOS} عکس لازم است (برای مدل خوب معمولاً ده‌ها عکس با هم‌پوشانی ۷۰٪)`;
    refresh();
  });
  pickBtn.addEventListener('click', () => fileInput.click());

  startBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (files.length < MIN_PHOTOS || !panel.render(files.map((f) => f.name)).ok) return;
    const settings = panel.getSettings();
    const quality = QUALITY_OPTIONS.find((q) => q.id === qualitySelect.value) || QUALITY_OPTIONS[0];
    setBusy(true);
    let jobId = null;
    try {
      setProgress('در حال آماده‌سازی...', null);
      const created = await createJob(mineName, { mode: settings.mode, georef: settings.georef });
      jobId = created.jobId;
      const { assets, photos } = await uploadPhotos({
        jobId,
        keyB64: created.key_b64,
        files,
        maxPixels: quality.maxPixels,
        settings,
        shouldCancel: () => !isOpen(),
        onProgress: ({ phase, done, total }) => {
          if (!isOpen()) return;
          const label = phase === 'prepare' ? 'آماده‌سازی عکس‌ها' : 'آپلود';
          setProgress(`${label}: ${done} از ${total} — تا پایان آپلود این صفحه را باز نگه دارید`, Math.round((done / total) * 100));
        },
      });
      if (isOpen()) setProgress('در حال شروع پردازش...', null);
      await startJob(jobId, { expected: assets, photos });
      showToast('✅ پردازش شروع شد — چند دقیقه تا چند ساعت طول می‌کشد');
      files = [];
      summary.textContent = '';
      if (isOpen()) setProgress('پردازش شروع شد. می‌توانید این صفحه را ببندید و بعداً برگردید.', null);
    } catch (err) {
      if (err.message !== 'CANCELLED' && isOpen()) {
        errBox.textContent = err.message;
        setProgress('', null);
      }
    }
    if (isOpen()) { setBusy(false); loadJobs(); }
  });

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px;line-height:1.9' },
      'عکس‌های پهباد را انتخاب کنید تا مدل سه‌بعدی معدن ساخته شود. عکس‌ها رمز می‌شوند و بعد از ساخت مدل پاک می‌شوند. عکس‌ها باید هم‌پوشانی زیاد و موقعیت مکانی (GPS) داشته باشند.'),
    pickBtn, fileInput, summary,
    panel.node,
    el('label', { style: 'margin-top:10px;display:block' }, 'کیفیت عکس برای آپلود'), qualitySelect, qualityNote,
    errBox, startBtn, progressText, progressBar,
    el('h4', { style: 'margin-top:16px;font-size:var(--text-sm);color:var(--ink-700)' }, 'مدل‌های این معدن'),
    jobsBox,
  );
  refresh();
  loadJobs();
}

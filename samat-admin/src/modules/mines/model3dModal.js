import { el, showToast, openModal } from '../../lib/dom.js';
import {
  QUALITY_OPTIONS, MIN_PHOTOS, MAX_PHOTOS,
  listJobs, createJob, startJob, removeJob, uploadPhotos, downloadModel, saveBlob, runSelftest,
} from '../../lib/model3d.js';

/**
 * نسخه‌ی ادمین: همان ساخت مدل سه‌بعدی، به‌همراه «بررسی اتصال» و دسترسی به مدل‌های همه‌ی کاربران این معدن.
 * ساخت مدل سه‌بعدی از عکس‌های پهباد برای یک معدن. عکس‌ها در همین دستگاه کوچک و رمز می‌شوند، روی GitHub
 * با OpenDroneMap به مدل تبدیل می‌شوند و فقط مدل رمزشده آنجا می‌ماند (نه در فضای Supabase).
 * ساخت مدل چند دقیقه تا چند ساعت (بسته به تعداد عکس) طول می‌کشد؛ بعد از شروع می‌توان صفحه را بست.
 */

const STATUS = {
  uploading: { label: 'آپلود ناتمام', color: 'var(--stone-600)' },
  queued: { label: 'در حال ساخت مدل…', color: 'var(--ink-700)' },
  done: { label: 'آماده', color: 'var(--patina-700)' },
  failed: { label: 'ناموفق', color: 'var(--rust-700)' },
};
const POLL_MS = 30_000;

function fmtWhen(iso) {
  try { return new Date(iso).toLocaleString('fa-IR'); } catch { return ''; }
}

export function openModel3dModal(mine, nameField) {
  const mineName = mine[nameField];
  const { overlay, body } = openModal({ title: `🚁 مدل سه‌بعدی از پهباد — ${mineName}`, width: '440px' });
  const isOpen = () => document.body.contains(overlay);

  let busy = false;
  let files = [];
  let pollTimer = null;

  const jobsBox = el('div', { style: 'margin-top:8px' });
  const errBox = el('div', { style: 'color:var(--rust-700);font-size:var(--text-xs);margin-top:8px;min-height:4px' });
  const fileInput = el('input', { type: 'file', accept: 'image/jpeg', multiple: '', style: 'display:none' });
  const pickBtn = el('button', { class: 'btn', style: 'width:100%' }, '📂 انتخاب عکس‌های پهباد');
  const summary = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' });
  const qualitySelect = el('select', {}, QUALITY_OPTIONS.map((q) => el('option', { value: q.id }, q.label)));
  const startBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px', disabled: '' }, '🚀 شروع ساخت مدل');
  const progressText = el('div', { style: 'font-size:var(--text-xs);color:var(--ink-700);margin-top:10px' });
  const progressBar = el('progress', { max: '100', value: '0', style: 'width:100%;display:none' });

  function setBusy(v) {
    busy = v;
    pickBtn.disabled = v;
    qualitySelect.disabled = v;
    startBtn.disabled = v || files.length < MIN_PHOTOS;
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

  function jobRow(j) {
    const st = STATUS[j.status] || { label: j.status, color: 'var(--stone-600)' };
    const actions = [];
    if (j.status === 'done') {
      const view = el('button', { class: 'btn-sm', style: 'background:var(--ink-700);color:#fff' }, '👁 مشاهده');
      view.addEventListener('click', async () => {
        view.disabled = true; view.textContent = '⏳ در حال دریافت...';
        try {
          const blob = await downloadModel(j.jobId);
          const { openModel3dViewer } = await import('../../lib/model3dViewer.js');
          openModel3dViewer(blob, { title: `${mineName} — ${fmtWhen(j.createdAt)}` });
        } catch (err) { errBox.textContent = err.message; }
        view.disabled = false; view.textContent = '👁 مشاهده';
      });
      actions.push(view);
      const dl = el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff' }, '⬇️ دریافت');
      dl.addEventListener('click', async () => {
        dl.disabled = true; dl.textContent = '⏳ در حال دریافت...';
        try {
          const blob = await downloadModel(j.jobId);
          await saveBlob(blob, `model3d-${j.jobId.slice(0, 8)}.glb`);
        } catch (err) { errBox.textContent = err.message; }
        dl.disabled = false; dl.textContent = '⬇️ دریافت';
      });
      actions.push(dl);
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
    return el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--stone-200)' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, [
        el('div', {}, [
          el('div', { style: `font-weight:700;font-size:12px;color:${st.color}` }, st.label),
          el('div', { style: 'font-size:11px;color:var(--stone-600)' }, `${fmtWhen(j.createdAt)}${j.photoCount ? ` — ${j.photoCount} عکس` : ''}`),
        ]),
        el('div', { style: 'display:flex;gap:6px;flex-shrink:0' }, actions),
      ]),
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
    setBusy(false);
  });
  pickBtn.addEventListener('click', () => fileInput.click());

  startBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (files.length < MIN_PHOTOS) return;
    const quality = QUALITY_OPTIONS.find((q) => q.id === qualitySelect.value) || QUALITY_OPTIONS[0];
    setBusy(true);
    let jobId = null;
    try {
      setProgress('در حال آماده‌سازی...', null);
      const created = await createJob(mineName);
      jobId = created.jobId;
      const { assets, photos } = await uploadPhotos({
        jobId,
        keyB64: created.key_b64,
        files,
        maxPixels: quality.maxPixels,
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

  const checkBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);margin-top:16px' }, '🔌 بررسی اتصال به GitHub');
  const checkBox = el('div', { style: 'font-size:var(--text-xs);margin-top:8px;line-height:1.9' });
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    checkBox.textContent = '⏳ در حال بررسی...';
    try {
      const res = await runSelftest();
      checkBox.innerHTML = '';
      res.checks.forEach((c) => {
        checkBox.append(el('div', { style: `color:${c.ok ? 'var(--patina-700)' : 'var(--rust-700)'}` }, `${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`));
      });
      checkBox.append(el('div', { style: 'font-weight:700;margin-top:4px' }, res.ok ? 'همه‌چیز آماده است.' : 'مورد ❌ را اصلاح کنید و دوباره بررسی کنید.'));
    } catch (err) {
      checkBox.textContent = `❌ ${err.message}`;
    }
    checkBtn.disabled = false;
  });

  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px;line-height:1.9' },
      'عکس‌های پهباد را انتخاب کنید تا مدل سه‌بعدی معدن ساخته شود. عکس‌ها رمز می‌شوند و بعد از ساخت مدل پاک می‌شوند. عکس‌ها باید هم‌پوشانی زیاد و موقعیت مکانی (GPS) داشته باشند.'),
    pickBtn, fileInput, summary,
    el('label', { style: 'margin-top:10px;display:block' }, 'کیفیت عکس برای آپلود'), qualitySelect,
    errBox, startBtn, progressText, progressBar,
    el('h4', { style: 'margin-top:16px;font-size:var(--text-sm);color:var(--ink-700)' }, 'مدل‌های این معدن'),
    jobsBox,
    checkBtn, checkBox,
  );
  loadJobs();
}

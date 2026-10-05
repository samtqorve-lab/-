import { el, showToast, openModal } from '../../lib/dom.js';
import { listJobs, downloadModel } from '../../lib/model3d.js';
import { readRtcCenter, buildGeoref } from '../../lib/model3dGeo.js';
import { getMineCorners } from '../../lib/geo.js';

/**
 * مدل پهبادی یک معدن را روی «نقشه‌ی معادن» (Leaflet، دوبعدی) نشان می‌دهد: مدل از بالا رندر می‌شود و به‌صورت یک تصویر
 * زمین‌مرجع (دقیقاً روی مختصات واقعی؛ رندر در فضای مرکاتور، lib/model3dTopView.js) روی نقشه می‌نشیند. نمای سه‌بعدی
 * (چرخش، ارتفاع، شیب، حجم) در «نمایشگر سه‌بعدی» است که از همین پنجره هم باز می‌شود.
 * مدل باید موقعیت جغرافیایی (CESIUM_RTC) داشته باشد؛ مدل‌های قدیمی که ندارند، با پیام روشن رد می‌شوند.
 */

const PANE = 'droneModels';
const POLL_NOTE = 'مدل سبک (برای سرعت) — برای جزئیات بیشتر «کیفیت کامل» را بزنید';
const registry = new WeakMap(); // map → Map(jobId → { layer, bounds, label })

const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString('fa-IR'); } catch { return ''; } };
const KIND = { survey: 'نقشه‌برداری', merge: '🧩 ادغام', preview: 'پیش‌نمایش' };

function layersOf(map) {
  if (!registry.has(map)) registry.set(map, new Map());
  return registry.get(map);
}

function ensurePane(map) {
  // بالای کاشی‌های نقشه (۲۰۰) و زیر چندضلعی‌ها/نشانگرهای معدن‌ها (۴۰۰+) تا کلیک روی معدن‌ها مسدود نشود
  return map.getPane(PANE) || (() => {
    const p = map.createPane(PANE);
    p.style.zIndex = '300';
    p.style.pointerEvents = 'none';
    return p;
  })();
}

async function loadGltf(buffer) {
  const [THREE, { GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
  ]);
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  draco.setDecoderConfig({ type: 'wasm' });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  try {
    const gltf = await new Promise((resolve, reject) => { loader.parse(buffer, '', resolve, reject); });
    return { THREE, gltf };
  } finally {
    draco.dispose();
  }
}

function disposeGltf(gltf) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (m) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

/**
 * مدل یک کار را روی نقشه می‌گذارد. @returns {Promise<{ layer: object, bounds: Array<Array<number>> }>}
 */
async function addModelToMap({ L, map, job, mine, full, maxPx, onStatus }) {
  const asset = !full && (job.assets || []).includes('model_lod1.glb') ? 'model_lod1.glb' : 'model.glb';
  onStatus(`⏳ دریافت ${asset === 'model.glb' ? 'مدل' : 'مدل سبک'}...`);
  const blob = await downloadModel(job.jobId, asset, { onStatus: (t) => onStatus(`⏳ ${t}`) });
  onStatus('⏳ خواندن مدل...');
  const { THREE, gltf } = await loadGltf(await blob.arrayBuffer());
  try {
    const rtc = readRtcCenter(gltf.parser && gltf.parser.json);
    if (!rtc) throw new Error('این مدل موقعیت جغرافیایی ثبت‌شده ندارد (مدل‌های قدیمی). با ساخت دوباره‌ی مدل درست می‌شود');
    const georef = buildGeoref({ rtc, crs: job.summary && job.summary.crs, corners: getMineCorners(mine) });
    if (!georef) throw new Error('زون UTM مدل مشخص نیست (گوشه‌ی پروانه‌ی معدن ثبت نشده)');
    onStatus('⏳ ساخت تصویر از بالا...');
    const { renderTopView } = await import('../../lib/model3dTopView.js');
    const top = await renderTopView(THREE, gltf.scene, georef, { maxPx });
    const url = URL.createObjectURL(top.blob);
    ensurePane(map);
    const b = top.bounds;
    const bounds = [[b.south, b.west], [b.north, b.east]];
    const layer = L.imageOverlay(url, bounds, {
      pane: PANE, opacity: 0.95, interactive: false, className: 'drone-model-overlay',
    });
    layer.once('remove', () => URL.revokeObjectURL(url));
    layer.addTo(map);
    return { layer, bounds, asset };
  } finally {
    disposeGltf(gltf);
  }
}

/**
 * پنجره‌ی انتخاب مدل پهباد برای یک معدن روی نقشه.
 * @param {{ L: object, map: object, mine: object, name: string }} ctx
 */
export async function openDroneMapPanel({ L, map, mine, name }) {
  const { overlay, body } = openModal({ title: `🚚 مدل پهباد روی نقشه — ${name}`, width: '440px' });
  const isOpen = () => document.body.contains(overlay);
  const placed = layersOf(map);
  const msg = el('div', { style: 'font-size:var(--text-xs);color:var(--rust-700);min-height:4px;margin-top:6px' });
  const list = el('div', { style: 'margin-top:8px' });
  const fullChk = el('input', { type: 'checkbox', style: 'margin-inline-end:6px' });
  const qualitySel = el('select', {}, [
    el('option', { value: '1024' }, 'تصویر معمولی (۱۰۲۴ پیکسل)'),
    el('option', { value: '2048', selected: '' }, 'تصویر خوب (۲۰۴۸ پیکسل) — پیشنهادی'),
    el('option', { value: '4096' }, 'تصویر خیلی دقیق (۴۰۹۶ پیکسل — روی گوشی ضعیف سنگین)'),
  ]);
  body.append(
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);line-height:1.9' },
      'مدل پهباد از بالا رندر و دقیقاً روی مختصات واقعی روی نقشه گذاشته می‌شود (زیر چندضلعی معدن‌ها، بدون مسدودکردن کلیک). برای دیدن سه‌بعدی (چرخش، ارتفاع، حجم) «🧊 سه‌بعدی» را بزنید.'),
    el('label', { style: 'display:flex;align-items:center;font-size:11px;margin-top:8px;cursor:pointer' }, [fullChk, `کیفیت کامل مدل (سنگین‌تر) — ${POLL_NOTE}`]),
    qualitySel, msg, list,
  );

  function row(job) {
    const on = placed.get(job.jobId);
    const status = el('div', { style: 'font-size:11px;color:var(--ink-700);min-height:14px' });
    const kind = `${KIND[job.mode] || ''}${job.photoCount ? ` — ${job.mode === 'merge' ? `${job.photoCount} پرواز` : `${job.photoCount} عکس`}` : ''}`;
    const actions = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' });
    const rowBox = el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--stone-200)' }, [
      el('div', { style: 'font-weight:700;font-size:12px' }, `${kind}`),
      el('div', { style: 'font-size:11px;color:var(--stone-600)' }, fmtWhen(job.createdAt)),
      actions, status,
    ]);

    if (on) {
      const slider = el('input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: String(on.layer.options.opacity), style: 'width:90px' });
      slider.addEventListener('input', () => on.layer.setOpacity(parseFloat(slider.value)));
      const rm = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)' }, '✕ حذف از نقشه');
      rm.addEventListener('click', () => { map.removeLayer(on.layer); placed.delete(job.jobId); render(); });
      const zoom = el('button', { class: 'btn-sm', style: 'background:var(--stone-200);color:var(--ink-700)' }, '🎯 رفتن به مدل');
      zoom.addEventListener('click', () => map.fitBounds(on.bounds, { maxZoom: 19, padding: [30, 30] }));
      actions.append(el('span', { style: 'font-size:11px' }, '✅ روی نقشه'), zoom, el('span', { style: 'font-size:11px' }, 'شفافیت'), slider, rm);
    } else {
      const add = el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff' }, '🗺 نمایش روی نقشه');
      add.addEventListener('click', async () => {
        add.disabled = true;
        msg.textContent = '';
        try {
          const res = await addModelToMap({
            L, map, job, mine, full: fullChk.checked, maxPx: parseInt(qualitySel.value, 10) || 2048, onStatus: (t) => { status.textContent = t; },
          });
          placed.set(job.jobId, { layer: res.layer, bounds: res.bounds });
          map.fitBounds(res.bounds, { maxZoom: 19, padding: [30, 30] });
          showToast('✅ مدل روی نقشه قرار گرفت');
          if (isOpen()) render();
        } catch (err) {
          msg.textContent = err.message || String(err);
          status.textContent = '';
          add.disabled = false;
        }
      });
      actions.append(add);
    }

    const view3d = el('button', { class: 'btn-sm', style: 'background:var(--ink-700);color:#fff' }, '🧊 سه‌بعدی');
    view3d.addEventListener('click', async () => {
      view3d.disabled = true; status.textContent = '⏳ دریافت مدل...';
      try {
        const asset = !fullChk.checked && (job.assets || []).includes('model_lod1.glb') ? 'model_lod1.glb' : 'model.glb';
        const blob = await downloadModel(job.jobId, asset, { onStatus: (t) => { status.textContent = `⏳ ${t}`; } });
        const { openModel3dViewer } = await import('../../lib/model3dViewer.js');
        openModel3dViewer(blob, {
          title: `${name} — ${fmtWhen(job.createdAt)}${asset === 'model.glb' ? '' : ' (سبک)'}`,
          summary: job.summary,
          corners: getMineCorners(mine),
        });
        status.textContent = '';
      } catch (err) { msg.textContent = err.message || String(err); status.textContent = ''; }
      view3d.disabled = false;
    });
    actions.append(view3d);
    return rowBox;
  }

  function render(jobs = render.jobs) {
    render.jobs = jobs;
    list.replaceChildren();
    const ready = (jobs || []).filter((j) => j.status === 'done' && (!j.assets || !j.assets.length || j.assets.includes('model.glb')));
    if (!ready.length) {
      list.append(el('div', { style: 'font-size:11px;color:var(--stone-500)' }, 'مدل آماده‌ای برای این معدن نیست — از «مدل سه‌بعدی از پهباد» بسازید'));
      return;
    }
    ready.forEach((j) => list.append(row(j)));
  }

  list.append(el('div', { style: 'font-size:11px;color:var(--stone-500)' }, '⏳ در حال بارگذاری فهرست مدل‌ها...'));
  try {
    const jobs = await listJobs(name);
    if (isOpen()) render(jobs);
  } catch (err) {
    list.replaceChildren(el('div', { style: 'font-size:11px;color:var(--rust-700)' }, `خطا در بارگذاری فهرست: ${err.message}`));
  }
}

/** حذف همه‌ی مدل‌های گذاشته‌شده روی این نقشه (هنگام بازسازی/خروج از صفحه) */
export function clearDroneOverlays(map) {
  const placed = registry.get(map);
  if (!placed) return;
  placed.forEach((v) => { try { map.removeLayer(v.layer); } catch { /* نقشه ممکن است قبلاً حذف شده باشد */ } });
  placed.clear();
}

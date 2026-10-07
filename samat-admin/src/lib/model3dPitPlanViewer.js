import { el } from './dom.js';
import { saveBlob } from './model3d.js';
import {
  readRtcCenter, buildGeoref, cornersToEnu, checkGeorefConsistency,
} from './model3dGeo.js';
import { heightAt } from './model3dAnalysis.js';
import { buildHeightfield, unionExtent } from './model3dTerrainField.js';
import { detectUpAxis, collectEnuMesh, localFromEnu } from './model3dScene.js';
import {
  licenseSpecFromRecord, planPitDesign, buildPlanGeometry, MODE_LABELS,
  exportPlanBenchesDxf, exportPlanRampDxf, exportPlanReportCsv,
} from './model3dPitPlan.js';

const FA = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('fa-IR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');
const nextPaint = () => new Promise((resolve) => { requestAnimationFrame(() => { setTimeout(resolve, 0); }); });

/**
 * نمایشگر «طراحی خودکار پله و رمپ» روی مدل سه‌بعدی پهپادی (GLB خروجی OpenDroneMap).
 * مدل را با همان روش نمایشگر اصلی باز می‌کند، سپس بر اساس مشخصات پروانه (گروه ماده، ذخیره، وزن مخصوص) و توپوگرافی
 * واقعی مدل، پله‌ها و رمپ را طراحی می‌کند و روی خودِ مدل نشان می‌دهد (model3dPitPlan.js). طراحی فرزند holder است، پس با
 * چرخش دید همراه مدل می‌چرخد و هم‌مبدأ با مدل می‌ماند.
 * نیازمند: موقعیت جغرافیایی مدل (CESIUM_RTC) و حداقل ۳ گوشه‌ی پروانه.
 * ⚠️ برآورد اولیه‌ی هندسی از روی مدل فتوگرامتری؛ جایگزین طراحی مهندس معدن/ژئوتکنیک نیست.
 * @param {Blob} blob فایل GLB رمزگشایی‌شده
 * @param {{ title?: string, summary?: object, corners?: Array<[number,number]>, license?: object }} [opts]
 *   license: رکورد معدن (کلیدهای فارسی sections.js)
 * @returns {{ close: () => void }}
 */
export function openPitPlanViewer(blob, {
  title = 'طراحی پله و رمپ', summary = null, corners = [], license = {},
} = {}) {
  const state = { closed: false, raf: 0, disposers: [] };
  const spec = licenseSpecFromRecord(license || {});

  const btnStyle = 'background:#2b2a24;color:#e8e2d0;border:1px solid #3d3b32;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap';
  const inpStyle = 'width:100%;background:#1c1b17;color:#e8e2d0;border:1px solid #3d3b32;border-radius:6px;padding:4px 6px;font-size:12px;box-sizing:border-box';
  const mkBtn = (label, onclick, extra = '') => el('button', { style: btnStyle + extra, onclick }, label);

  const status = el('div', { style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e8e2d0;font-size:14px;text-align:center;padding:24px;pointer-events:none;z-index:7' }, '⏳ در حال بارگذاری مدل...');
  const info = el('div', { style: 'font-size:11px;color:#b9b29c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' });
  const geoLine = el('div', { style: 'font-size:10px;color:#b9b29c' });
  const stage = el('div', { style: 'position:relative;flex:1;min-height:0;touch-action:none' }, [status]);
  const flashBox = el('div', { style: 'position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:92%;background:rgba(18,17,14,.96);border:1px solid #6b3a2e;color:#f0a08a;border-radius:8px;padding:6px 10px;font-size:12px;display:none;z-index:8;text-align:center;line-height:1.7' });

  const panelBody = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  const panel = el('div', {
    style: 'position:absolute;bottom:8px;inset-inline:8px;background:rgba(18,17,14,.95);border:1px solid #3d3b32;border-radius:10px;padding:8px 10px;font-size:11px;color:#e8e2d0;max-height:58%;overflow:auto;z-index:4;display:none',
  }, [panelBody]);
  const panelBtn = mkBtn('🪜 طراحی پله/رمپ', () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
  const closeBtn = mkBtn('✕', () => close());

  const overlay = el('div', { style: 'position:fixed;inset:0;z-index:10000;background:#12110e;display:flex;flex-direction:column;direction:rtl;font-family:inherit' }, [
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #2b2a24;flex-wrap:wrap;flex:0 0 auto' }, [
      el('div', { style: 'min-width:0;flex:1 1 180px' }, [
        el('div', { style: 'color:#f1ead6;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, `🪜 ${title}`),
        info, geoLine,
      ]),
      el('div', { style: 'display:flex;gap:6px' }, [panelBtn, closeBtn]),
    ]),
    stage,
    el('div', { style: 'padding:6px 10px;font-size:11px;color:#8d8775;border-top:1px solid #2b2a24;flex:0 0 auto' }, 'یک انگشت: چرخش — دو انگشت: زوم/جابه‌جایی — طراحی فقط برآورد اولیه‌ی هندسی از روی مدل است و جایگزین طراحی مهندس معدن/ژئوتکنیک نیست'),
  ]);
  document.body.append(overlay);
  stage.append(panel, flashBox);

  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  function close() {
    if (state.closed) return;
    state.closed = true;
    cancelAnimationFrame(state.raf);
    document.removeEventListener('keydown', onKey);
    state.disposers.forEach((fn) => { try { fn(); } catch { /* پاکسازی نباید جلوی بستن را بگیرد */ } });
    overlay.remove();
  }
  function fail(message) {
    status.style.display = 'flex';
    status.style.color = '#f0a08a';
    status.textContent = `❌ ${message}`;
  }
  let flashTimer = 0;
  state.disposers.push(() => clearTimeout(flashTimer));
  function flash(msg, ok = false) {
    flashBox.textContent = msg;
    flashBox.style.color = ok ? '#bfe3c8' : '#f0a08a';
    flashBox.style.borderColor = ok ? '#3d6b52' : '#6b3a2e';
    flashBox.style.display = 'block';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashBox.style.display = 'none'; }, 7000);
  }

  (async () => {
    let THREE; let GLTFLoader; let DRACOLoader; let OrbitControls;
    try {
      [THREE, { GLTFLoader }, { DRACOLoader }, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/loaders/DRACOLoader.js'),
        import('three/examples/jsm/controls/OrbitControls.js'),
      ]);
    } catch (err) {
      fail(`بارگذاری کتابخانه‌ی نمایش ناموفق بود: ${err.message}`);
      return;
    }
    if (state.closed) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      fail('این دستگاه یا مرورگر WebGL را پشتیبانی نمی‌کند.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x1c1b17);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    stage.prepend(renderer.domElement);
    state.disposers.push(() => { renderer.dispose(); renderer.forceContextLoss(); });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.screenSpacePanning = true;
    state.disposers.push(() => controls.dispose());
    const resize = () => {
      const w = Math.max(1, stage.clientWidth); const h = Math.max(1, stage.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    state.disposers.push(() => ro.disconnect());
    resize();

    // Draco: فایل‌های رمزگشا از همان origin اپ (vite.config.js آن‌ها را به public/draco/ کپی می‌کند)
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    draco.setDecoderConfig({ type: 'wasm' });
    state.disposers.push(() => draco.dispose());
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    let gltf;
    try {
      const buffer = await blob.arrayBuffer();
      gltf = await new Promise((resolve, reject) => { loader.parse(buffer, '', resolve, reject); });
    } catch (err) {
      fail(`خواندن مدل ناموفق بود: ${err.message || err}`);
      return;
    }
    if (state.closed) return;

    const holder = new THREE.Group();
    holder.add(gltf.scene);
    scene.add(holder);
    let triangles = 0;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const old = o.material;
      o.material = new THREE.MeshBasicMaterial({
        map: (old && old.map) || null,
        color: old && old.map ? 0xffffff : ((old && old.color) || 0xcccccc),
        vertexColors: !!o.geometry.attributes.color,
        side: THREE.DoubleSide,
      });
      const idx = o.geometry.index;
      triangles += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
      if (old && old.dispose) old.dispose();
    });
    state.disposers.push(() => {
      gltf.scene.traverse((o) => {
        if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    });

    // ── زمین‌مرجع و محدوده‌ی پروانه ──
    const upAxis = detectUpAxis(THREE, gltf.scene);
    const preBox = new THREE.Box3().setFromObject(gltf.scene);
    const bboxRaw = upAxis === 'z'
      ? {
        minE: preBox.min.x, maxE: preBox.max.x, minN: preBox.min.y, maxN: preBox.max.y,
      }
      : {
        minE: preBox.min.x, maxE: preBox.max.x, minN: -preBox.max.z, maxN: -preBox.min.z,
      };
    const rtc = readRtcCenter(gltf.parser && gltf.parser.json);
    const georef = buildGeoref({ rtc, crs: summary && summary.crs, corners });
    const validCorners = (corners || []).filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));

    // ── جهت و قاب‌بندی (همان منطق نمایشگر اصلی) ──
    holder.rotation.set(upAxis === 'z' ? -Math.PI / 2 : 0, 0, 0);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = new THREE.Vector3(); const size = new THREE.Vector3();
    box.getCenter(center);
    holder.position.sub(center);
    holder.updateMatrixWorld(true);
    box.setFromObject(gltf.scene);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const radius = (size.length() / 2) || 1;
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
    camera.near = maxDim / 1000; camera.far = maxDim * 100;
    camera.position.set(0.55, 0.6, 0.9).normalize().multiplyScalar(dist);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.minDistance = maxDim / 50; controls.maxDistance = maxDim * 10;
    controls.update();
    info.textContent = `${Math.round(size.x)} × ${Math.round(size.z)} × ${Math.round(size.y)} متر — ${Math.round(triangles).toLocaleString('fa-IR')} مثلث`;
    status.style.display = 'none';

    const tick = () => {
      if (state.closed) return;
      state.raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    overlay.dataset.ready = '1';

    // ── پیش‌نیازها ──
    panelBody.replaceChildren();
    const note = (text, color = '#b9b29c') => panelBody.append(el('div', { style: `color:${color};line-height:1.8` }, text));
    if (!georef) {
      note('❌ طراحی روی مدل به موقعیت جغرافیایی مدل (CESIUM_RTC) نیاز دارد؛ این مدل آن را ندارد. مدل نقشه‌برداری/ادغام جدید بسازید.', '#f0a08a');
      geoLine.textContent = 'ℹ️ موقعیت جغرافیایی در این مدل ثبت نشده';
      panel.style.display = 'block';
      return;
    }
    if (validCorners.length < 3) {
      note('❌ برای این معدن حداقل ۳ گوشه‌ی مختصاتی ثبت نشده؛ محدوده‌ی پروانه برای طراحی لازم است.', '#f0a08a');
      panel.style.display = 'block';
      return;
    }
    const cornersEnu = cornersToEnu(georef, validCorners);
    const chk = checkGeorefConsistency(georef, bboxRaw, validCorners);
    geoLine.textContent = `📍 UTM ${georef.zone}${georef.hemisphere}`;
    if (chk && chk.status === 'bad') {
      geoLine.style.color = '#f0a08a';
      note(`❌ مرکز مدل ${FA(chk.distance / 1000, 1)} کیلومتر با پروانه فاصله دارد؛ زون یا موقعیت مدل را بررسی کنید. طراحی انجام نمی‌شود.`, '#f0a08a');
      panel.style.display = 'block';
      return;
    }

    // ── سطح ارتفاعی: روی مدل دقیق، بیرون از پوشش مدل برون‌یابی ──
    let analysis;
    try {
      status.style.display = 'flex'; status.style.color = '#e8e2d0'; status.textContent = '⏳ در حال آماده‌سازی سطح مدل...';
      await nextPaint();
      analysis = collectEnuMesh(THREE, holder, upAxis);
    } catch (err) {
      fail(err.message || String(err));
      return;
    } finally {
      if (!state.closed && analysis) status.style.display = 'none';
    }
    const extent = unionExtent(bboxRaw, cornersEnu, 0.5);
    const span = Math.max(extent.maxE - extent.minE, extent.maxN - extent.minN);
    const cells = Math.min(300, Math.max(128, Math.round(span / 2)));
    const field = buildHeightfield(analysis.surface, extent, { nx: cells, ny: cells });
    if (!field) { fail('هیچ بخشی از محدوده‌ی پروانه روی مدل نیست'); return; }
    const heightFn = (e, n) => {
      const z = heightAt(analysis.surface, e, n);
      return Number.isFinite(z) ? z : field.sample(e, n);
    };
    // سهم محدوده‌ی پروانه که واقعاً روی مدل است (بقیه برون‌یابی است)
    let onModel = 0; let tot = 0;
    {
      const xs = cornersEnu.map((p) => p[0]); const ys = cornersEnu.map((p) => p[1]);
      const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
      for (let i = 0; i < 40; i += 1) {
        for (let j = 0; j < 40; j += 1) {
          tot += 1;
          if (Number.isFinite(heightAt(analysis.surface, x0 + ((x1 - x0) * (i + 0.5)) / 40, y0 + ((y1 - y0) * (j + 0.5)) / 40))) onModel += 1;
        }
      }
    }
    const coverage = tot ? onModel / tot : 0;

    // ── فرم پارامترها ──
    const pr = spec.preset;
    const num = (label, value, step = 'any') => {
      const input = el('input', { type: 'number', value: String(value), step, style: inpStyle });
      return { wrap: el('div', {}, [el('div', { style: 'color:#b9b29c;margin-bottom:2px' }, label), input]), input, get v() { return parseFloat(input.value); } };
    };
    const modeSel = el('select', { style: inpStyle }, [
      el('option', { value: 'auto' }, 'خودکار (از روی توپوگرافی مدل)'),
      ...Object.entries(MODE_LABELS).map(([k, v]) => el('option', { value: k }, v)),
    ]);
    const basisSel = el('select', { style: inpStyle }, [
      el('option', { value: 'reserve' }, 'ذخیره‌ی قطعی پروانه'),
      el('option', { value: 'probable' }, 'ذخیره‌ی احتمالی پروانه'),
      el('option', { value: 'term' }, 'برداشت در مدت پروانه (سالیانه × سال)'),
      el('option', { value: 'custom' }, 'مقدار دلخواه (تن)'),
    ]);
    const customTons = num('مقدار دلخواه (تن)', spec.reserveTons || 100000, '1');
    const sgIn = num(`وزن مخصوص (t/m³)${spec.sgAssumed ? ' — فرض پیش‌فرض گروه' : ''}`, spec.sg, '0.01');
    const H = num('ارتفاع پله (m)', pr.benchHeight);
    const face = num('شیب سینه‌ی پله (°)', pr.benchFaceAngleDeg);
    const catchN = num('هر چند پله یک برم', pr.catchBenchInterval, '1');
    const setback = num('حاشیه تا مرز پروانه (m)', 10);
    const rampW = num('عرض رمپ (m)', pr.rampWidth);
    const rampG = num('شیب رمپ (%)', pr.rampGradePercent);
    const platW = num('عرض سکوی پنجه — دامنه‌ای (m)', 30);
    const depthCap = num('سقف عمق (m) — خالی = خودکار', '');
    depthCap.input.placeholder = 'خودکار';

    const specLine = el('div', { style: 'color:#9fc7e8;line-height:1.8' },
      `ماده: ${spec.material || '—'} — ${pr.label}${spec.group ? ` (گروه ${FA(spec.group)})` : ''} — ذخیره‌ی قطعی: ${spec.reserveTons ? `${FA(spec.reserveTons)} تن` : 'ثبت نشده'}${spec.annualTons ? ` — استخراج سالیانه ${FA(spec.annualTons)}` : ''}`);
    const covLine = el('div', {
      style: `color:${coverage < 0.6 ? '#e0a339' : '#8d8775'};line-height:1.8`,
    }, coverage < 0.999
      ? `${coverage < 0.6 ? '⚠️ ' : ''}${FA(coverage * 100)}٪ محدوده‌ی پروانه روی مدل است؛ بقیه با ارتفاع برون‌یابی‌شده (تقریبی) طراحی می‌شود.`
      : '✅ محدوده‌ی پروانه کامل روی مدل است.');
    const results = el('div', { style: 'white-space:pre-line;line-height:1.9;color:#e8e2d0' });
    const actions = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });

    function targetM3() {
      const sg = sgIn.v > 0 ? sgIn.v : spec.sg;
      const conv = (tons) => (tons > 0 ? (spec.volumeUnit ? tons : tons / sg) : null);
      switch (basisSel.value) {
        case 'reserve': return conv(spec.reserveTons);
        case 'probable': return conv(spec.probableTons);
        case 'term': return conv(spec.annualTons && spec.years ? spec.annualTons * spec.years : null);
        default: return conv(customTons.v);
      }
    }

    // ── رسم طراحی روی مدل (فرزند holder؛ هم‌مبدأ با ENU محلی مدل) ──
    let group = null;
    let lastPlan = null;
    function clearDesign() {
      if (group) {
        holder.remove(group);
        group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        group = null;
      }
      lastPlan = null;
      actions.replaceChildren();
    }
    state.disposers.push(clearDesign);

    const toLocal = (arr) => {
      const out = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i += 3) {
        const [x, y, z] = localFromEnu(upAxis, arr[i], arr[i + 1], arr[i + 2]);
        out[i] = x; out[i + 1] = y; out[i + 2] = z;
      }
      return out;
    };
    const lift = Math.max(0.1, maxDim / 3000);
    function meshOf(arr, color, opacity, order) {
      if (!arr.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(toLocal(arr), 3));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color, side: THREE.DoubleSide, transparent: true, opacity, depthTest: false,
      }));
      m.renderOrder = order; m.raycast = () => {}; m.userData.excludeFromAnalysis = true;
      return m;
    }
    function linesOf(arr, color, order) {
      if (!arr.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(toLocal(arr), 3));
      const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
      l.renderOrder = order; l.raycast = () => {}; l.userData.excludeFromAnalysis = true;
      return l;
    }

    function drawPlan(plan) {
      clearDesign();
      lastPlan = plan;
      const geo = buildPlanGeometry(plan, heightFn, { step: Math.max(2, plan.terrain.sampleStep / 1.5) });
      group = new THREE.Group();
      [
        meshOf(geo.floor, 0x2e86de, 0.75, 990),
        meshOf(geo.faces, 0xc0622b, 0.6, 991),
        meshOf(geo.berms, 0xf5d76e, 0.75, 992),
        linesOf(geo.crest, 0xd62828, 995),
      ].forEach((o) => { if (o) group.add(o); });
      if (plan.ramp) {
        const { leftEdge, rightEdge, centerline } = plan.ramp;
        const tri = [];
        for (let i = 0; i < leftEdge.length - 1; i += 1) {
          const l0 = leftEdge[i]; const l1 = leftEdge[i + 1]; const r0 = rightEdge[i]; const r1 = rightEdge[i + 1];
          tri.push(l0.x, l0.y, l0.z + lift, r0.x, r0.y, r0.z + lift, r1.x, r1.y, r1.z + lift);
          tri.push(l0.x, l0.y, l0.z + lift, r1.x, r1.y, r1.z + lift, l1.x, l1.y, l1.z + lift);
        }
        const road = meshOf(tri, 0xeeeeee, 0.85, 993);
        if (road) group.add(road);
        const seg = [];
        for (let i = 0; i < centerline.length - 1; i += 1) {
          seg.push(centerline[i].x, centerline[i].y, centerline[i].z + 2 * lift, centerline[i + 1].x, centerline[i + 1].y, centerline[i + 1].z + 2 * lift);
        }
        const cl = linesOf(seg, 0xff2dd1, 996);
        if (cl) group.add(cl);
      }
      holder.add(group);
    }

    function describe(plan) {
      const m = plan.metrics;
      const off = rtc[2];
      const sg = sgIn.v > 0 ? sgIn.v : spec.sg;
      const tons = spec.volumeUnit ? null : plan.fit.achievedM3 * sg;
      const lines = [
        `نوع: ${MODE_LABELS[plan.mode]}${plan.mode !== plan.suggestedMode ? ` (پیشنهاد توپوگرافی: ${MODE_LABELS[plan.suggestedMode]})` : ''}`,
        `دلیل از توپوگرافی: ${plan.modeReason}`,
        `پله: ${FA(m.benchCount)} (${FA(m.catchCount)} کاچ‌بنچ) — تراز کف ${FA(m.floorElevation + off, 1)} تا ${FA(m.topElevation + off, 1)} متر — ارتفاع کل ${FA(m.totalHeightM, 1)} m`,
        `شیب بین‌رمپی ${FA(m.iraDeg, 1)}° — شیب کلی دیواره ${FA(m.osaDeg, 1)}° — برم ${FA(m.bermM, 1)} m`,
        `حجم خاک‌برداری طراحی: ${FA(plan.fit.achievedM3)} م³${tons ? ` ≈ ${FA(tons)} تن` : ''}${plan.fit.targetM3 ? ` — هدف ${FA(plan.fit.targetM3)} م³ — ${plan.fit.meetsTarget ? '✅ تأمین شد' : `❌ کسری ${FA(plan.fit.shortfallM3)} م³`}` : ''}`,
      ];
      if (plan.ramp) {
        lines.push(`رمپ: طول ${FA(plan.ramp.totalLength)} m — عرض ${FA(plan.ramp.width)} m — بیشینه شیب واقعی ${FA(plan.ramp.maxGradePercent, 1)}٪ (درخواستی ${FA(plan.ramp.requestedGradePercent)}٪)${plan.ramp.kind === 'zigzag' ? ' — زیگزاگ' : ' — مارپیچ'}`);
      }
      plan.warnings.forEach((w) => lines.push(`⚠️ ${w}`));
      lines.push('راهنما: آبی = کف، قهوه‌ای = سینه‌ی پله، زرد = برم، قرمز = لبه‌ی پله، سفید/سرخابی = رمپ. برآورد اولیه‌ی هندسی؛ با مهندس معدن/ژئوتکنیک تأیید شود.');
      return lines.join('\n');
    }

    async function run() {
      runBtn.disabled = true;
      status.style.display = 'flex'; status.style.color = '#e8e2d0'; status.textContent = '⏳ در حال طراحی روی مدل...';
      await nextPaint();
      try {
        const plan = planPitDesign({
          heightFn,
          licensePoly: cornersEnu,
          targetM3: targetM3(),
          mode: modeSel.value,
          group: spec.group,
          params: {
            benchHeight: H.v,
            benchFaceAngleDeg: face.v,
            catchBenchInterval: Math.max(1, Math.round(catchN.v) || 1),
            boundarySetbackM: Math.max(0, setback.v || 0),
            rampWidth: rampW.v || 8,
            rampGradePercent: rampG.v || 10,
            platformWidthM: platW.v || 30,
            depthCapM: depthCap.v > 0 ? depthCap.v : null,
          },
        });
        drawPlan(plan);
        results.textContent = describe(plan);
        const off = rtc;
        const dxfBtn = mkBtn('⬇ DXF پله‌ها', () => saveBlob(new Blob([exportPlanBenchesDxf(plan, off)], { type: 'application/dxf' }), 'pit_benches.dxf').catch(() => {}));
        actions.replaceChildren(dxfBtn);
        if (plan.ramp) actions.append(mkBtn('⬇ DXF رمپ', () => saveBlob(new Blob([exportPlanRampDxf(plan, off)], { type: 'application/dxf' }), 'pit_ramp.dxf').catch(() => {})));
        actions.append(
          mkBtn('⬇ گزارش CSV', () => saveBlob(new Blob([exportPlanReportCsv(plan, spec, off)], { type: 'text/csv;charset=utf-8' }), 'pit_plan_report.csv').catch(() => {})),
          mkBtn('🗑 حذف طراحی', () => { clearDesign(); results.textContent = ''; }),
        );
        flash(plan.fit.meetsTarget || !plan.fit.targetM3 ? 'طراحی روی مدل رسم شد' : 'طراحی رسم شد ولی به حجم هدف نمی‌رسد', plan.fit.meetsTarget || !plan.fit.targetM3);
      } catch (err) {
        flash(err.message || String(err));
      } finally {
        runBtn.disabled = false;
        if (!state.closed) status.style.display = 'none';
      }
    }
    const runBtn = mkBtn('✨ طراحی خودکار روی مدل', () => { run(); }, ';background:#3d6b52;width:100%');

    const grid = (...kids) => el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px 8px' }, kids);
    panelBody.append(
      specLine, covLine,
      el('div', {}, [el('div', { style: 'color:#b9b29c;margin-bottom:2px' }, 'نوع معدن'), modeSel]),
      grid(
        el('div', {}, [el('div', { style: 'color:#b9b29c;margin-bottom:2px' }, 'هدف حجم'), basisSel]),
        customTons.wrap, sgIn.wrap, setback.wrap, H.wrap, face.wrap, catchN.wrap, depthCap.wrap, rampW.wrap, rampG.wrap, platW.wrap,
      ),
      runBtn, results, actions,
    );
    panel.style.display = 'block';
  })();

  return { close };
}

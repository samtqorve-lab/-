import { el } from './dom.js';
import { saveBlob } from './model3d.js';
import {
  readRtcCenter, buildGeoref, enuToUtm, enuToLatLon, cornersToEnu, checkGeorefConsistency, describePoint,
} from './model3dGeo.js';
import {
  polygonVolume, profileAlong, profileToCsv, profileToDxf, slopeVertexColors, compareSurfaces, diffVertexColors,
  VOLUME_BASES,
} from './model3dAnalysis.js';
import {
  detectUpAxis, sceneToEnu, localFromEnu, collectEnuMesh, drapedLine, createColorLayer,
} from './model3dScene.js';
import {
  planSatellite, buildSatelliteGrid, loadSatelliteTiles, DETAIL_LEVELS, SATELLITE_TILE_URL, SATELLITE_ATTRIBUTION, TILE_SIZE,
} from './model3dSatellite.js';

const FA = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString('fa-IR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');
const BASE_LABELS = {
  plane: 'صفحه‌ی مبنا (برازش از محیط) — پیشنهادی',
  min: 'پایین‌ترین نقطه‌ی محیط',
  mean: 'میانگین ارتفاع محیط',
  level: 'تراز دلخواه (ارتفاع مطلق، متر)',
};
const SLOPE_PRESETS = [
  { id: '30-45', gentle: 30, steep: 45, label: '۳۰° / ۴۵° (پیش‌فرض)' },
  { id: '45-60', gentle: 45, steep: 60, label: '۴۵° / ۶۰° (دیواره‌ی معدن)' },
  { id: '20-30', gentle: 20, steep: 30, label: '۲۰° / ۳۰° (انبار/خاکریز)' },
];
const nextPaint = () => new Promise((resolve) => { requestAnimationFrame(() => { setTimeout(resolve, 0); }); });

/**
 * نمایشگر سه‌بعدی مدل GLB (خروجی OpenDroneMap) داخل اپ. Three.js فقط هنگام اولین باز شدن نمایشگر
 * لود می‌شود (dynamic import) تا بارگذاری اولیه‌ی اپ سنگین‌تر نشود.
 *
 * - مدل‌های فتوگرامتری با متریال بدون نورپردازی (Basic) نمایش داده می‌شوند تا رنگ عکس‌ها دست‌نخورده بماند.
 * - جهت «بالا» خودکار تشخیص داده می‌شود (ODM محور Z را بالا می‌گیرد ولی glTF محور Y را) و با دکمه‌ی چرخش
 *   قابل تغییر است. چرخش فقط دید را عوض می‌کند؛ تحلیل‌ها (حجم، مقطع، شیب، ...) از فضای خودِ مدل می‌آیند و به آن وابسته نیستند.
 * - موقعیت جغرافیایی: ODM مبدأ UTM مدل را در افزونه‌ی CESIUM_RTC فایل GLB می‌نویسد (model3dGeo.js). اگر باشد،
 *   ابزارها مختصات UTM/طول و عرض نشان می‌دهند و «🗺 محدوده» پروانه‌ی معدن را روی مدل می‌چسباند؛ اگر نباشد، فقط
 *   مختصات محلی و بدون ادعای موقعیت.
 * - ابزارها (فقط یکی فعال): 📏 فاصله، 📍 مختصات، ⬠ مساحت/حجم (سطح مبنا قابل انتخاب)، 📈 مقطع (CSV/DXF).
 *   لایه‌ها: ⛰ شیب (غربالگری اولیه)، 🗺 محدوده‌ی پروانه، 🔥 مقایسه با پرواز دیگر (نقشه‌ی برداشت/افزوده)،
 *   🛰 تصویر ماهواره‌ای (Esri World Imagery) به‌صورت صفحه‌ی تخت زیر مدل برای مکان‌یابی و زمینه (نیازمند موقعیت جغرافیایی مدل).
 *   📋 خروجی همه‌ی نتایج را CSV می‌کند. چرخاندن/بازنشانی دید، نتایجِ ترسیم‌شده روی مدل را پاک می‌کند (نشانگرها در
 *   فضای صحنه‌اند)؛ پیش از آن «📋 خروجی» بگیرید.
 * ⚠️ همه‌ی اعداد برآورد اولیه از روی مدل فتوگرامتری‌اند و جایگزین نقشه‌برداری رسمی نیستند.
 * @param {Blob} blob فایل GLB رمزگشایی‌شده
 * @param {{ title?: string, summary?: object, corners?: Array<[number,number]>,
 *           compareOptions?: Array<{ id: string, label: string, summary?: object, load: () => Promise<Blob> }> }} [opts]
 *   summary: خلاصه‌ی job (شامل volume/change اختیاری از samat-3d)؛ corners: گوشه‌های پروانه [[lat, lon], ...]؛
 *   compareOptions: مدل‌های دیگرِ همین معدن که می‌توان با آن‌ها مقایسه کرد.
 * @returns {{ close: () => void }}
 */
export function openModel3dViewer(blob, {
  title = 'مدل سه‌بعدی', summary = null, corners = [], compareOptions = [],
} = {}) {
  const state = { closed: false, raf: 0, disposers: [] };

  const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('fa-IR', { maximumFractionDigits: 1 }) : '—');
  function summaryLines(s) {
    if (!s) return [];
    const lines = [];
    if (s.volume) {
      const v = s.volume;
      lines.push(`حجم — برداشت ${fmtNum(v.cut_m3)} · افزوده ${fmtNum(v.fill_m3)} · خالص ${fmtNum(v.net_change_m3)} م³`);
    }
    if (s.change) {
      const c = s.change;
      lines.push(`تغییر نسبت به قبل — برداشت ${fmtNum(c.cut_m3)} · افزوده ${fmtNum(c.fill_m3)} م³`);
    }
    if (s.warnings && s.warnings.length) lines.push(`⚠️ ${s.warnings.length} هشدار سازگاری هنگام ادغام`);
    return lines;
  }

  const status = el('div', { style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e8e2d0;font-size:14px;text-align:center;padding:24px;pointer-events:none;z-index:7' }, '⏳ در حال بارگذاری مدل...');
  const info = el('div', { style: 'font-size:11px;color:#b9b29c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' });
  const geoLine = el('div', { style: 'font-size:10px;color:#b9b29c' });
  const extraLines = summaryLines(summary).map((t) => el('div', { style: 'font-size:10px;color:#b9b29c' }, t));
  const stage = el('div', { style: 'position:relative;flex:1;min-height:0;touch-action:none' }, [status]);

  const btnStyle = 'background:#2b2a24;color:#e8e2d0;border:1px solid #3d3b32;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap';
  const smallBtnStyle = 'background:#2b2a24;color:#e8e2d0;border:1px solid #3d3b32;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;white-space:nowrap';
  const selStyle = 'background:#1c1b17;color:#e8e2d0;border:1px solid #3d3b32;border-radius:6px;padding:3px 6px;font-size:11px;max-width:100%';
  const mkBtn = (label, onclick) => el('button', { style: btnStyle, onclick }, label);
  const mkSmall = (label, onclick) => el('button', { style: smallBtnStyle, onclick }, label);
  const rotateBtn = mkBtn('🔄 چرخش', () => {});
  const wireBtn = mkBtn('🕸 شبکه', () => {});
  const resetBtn = mkBtn('🎯 بازنشانی', () => {});
  const saveBtn = mkBtn('💾 ذخیره', () => saveBlob(blob, 'model3d.glb').catch(() => {}));
  const closeBtn = mkBtn('✕', () => close());

  const toolBtns = {
    distance: mkBtn('📏 فاصله', () => {}),
    probe: mkBtn('📍 مختصات', () => {}),
    area: mkBtn('⬠ مساحت/حجم', () => {}),
    profile: mkBtn('📈 مقطع', () => {}),
  };
  const layerBtns = {
    slope: mkBtn('⛰ شیب', () => {}),
    boundary: mkBtn('🗺 محدوده', () => {}),
    compare: mkBtn('🔥 مقایسه', () => {}),
    satellite: mkBtn('🛰 ماهواره', () => {}),
  };
  const exportBtn = mkBtn('📋 خروجی', () => {});
  const toolRow = el('div', {
    style: 'display:flex;gap:6px;overflow-x:auto;padding:6px 10px;border-bottom:1px solid #2b2a24;white-space:nowrap;flex:0 0 auto',
  }, [...Object.values(toolBtns), ...Object.values(layerBtns), exportBtn]);

  const toolHint = el('span', { style: 'flex:1 1 200px;min-width:0' });
  const areaFinishBtn = mkSmall('✔ پایان', () => {});
  const areaUndoBtn = mkSmall('↩ حذف آخرین', () => {});
  const areaCtl = el('span', { style: 'display:none;gap:6px' }, [areaFinishBtn, areaUndoBtn]);
  const hintBar = el('div', { style: 'font-size:11px;color:#e0a339;display:none;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 10px;border-bottom:1px solid #2b2a24;flex:0 0 auto' }, [toolHint, areaCtl]);

  const satStatus = el('span', { style: 'flex:1 1 220px;min-width:0' });
  const satDetailSel = el('select', { style: selStyle }, Object.entries(DETAIL_LEVELS).map(([k, v]) => el('option', k === 'medium' ? { value: k, selected: '' } : { value: k }, v.label)));
  const satOpacity = el('input', { type: 'range', min: '0.2', max: '1', step: '0.05', value: '1', style: 'width:90px' });
  const satRow = el('div', { style: 'font-size:11px;color:#9fc7e8;display:none;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 10px;border-bottom:1px solid #2b2a24;flex:0 0 auto' }, [
    satStatus, el('span', {}, 'جزئیات'), satDetailSel, el('span', {}, 'شفافیت'), satOpacity,
  ]);

  const resultsList = el('div', { style: 'display:flex;flex-direction:column;gap:2px' });
  const clearAllBtn = el('button', { style: 'font-size:10px;background:none;border:none;color:#e0a339;cursor:pointer;text-decoration:underline;padding:0' }, 'پاک کردن همه');
  const resultsPanel = el('div', {
    style: 'position:absolute;bottom:8px;inset-inline:8px;background:rgba(18,17,14,.92);border:1px solid #3d3b32;border-radius:8px;padding:6px 8px;font-size:11px;color:#e8e2d0;max-height:45%;overflow:auto;display:none;z-index:4',
  }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px' }, [
      el('span', {}, '📏 نتایج'), clearAllBtn,
    ]),
    resultsList,
  ]);
  const legendBox = el('div', { style: 'position:absolute;top:8px;inset-inline:8px;background:rgba(18,17,14,.92);border:1px solid #3d3b32;border-radius:8px;padding:6px 8px;font-size:11px;color:#e8e2d0;display:none;line-height:1.8;z-index:4;max-height:40%;overflow:auto' });
  const flashBox = el('div', { style: 'position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:92%;background:rgba(18,17,14,.96);border:1px solid #6b3a2e;color:#f0a08a;border-radius:8px;padding:6px 10px;font-size:12px;display:none;z-index:8;text-align:center;line-height:1.7' });
  const pickBox = el('div', { style: 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(92%,360px);max-height:70%;overflow:auto;background:rgba(18,17,14,.97);border:1px solid #3d3b32;border-radius:10px;padding:10px;display:none;z-index:6;color:#e8e2d0;font-size:12px' });

  const overlay = el('div', { style: 'position:fixed;inset:0;z-index:10000;background:#12110e;display:flex;flex-direction:column;direction:rtl;font-family:inherit' }, [
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #2b2a24;flex-wrap:wrap;flex:0 0 auto' }, [
      el('div', { style: 'min-width:0;flex:1 1 180px' }, [
        el('div', { style: 'color:#f1ead6;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, title),
        info, geoLine, ...extraLines,
      ]),
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [rotateBtn, wireBtn, resetBtn, saveBtn, closeBtn]),
    ]),
    toolRow,
    hintBar,
    satRow,
    stage,
    el('div', { style: 'padding:6px 10px;font-size:11px;color:#8d8775;border-top:1px solid #2b2a24;flex:0 0 auto' }, 'یک انگشت: چرخش — دو انگشت: بزرگ‌نمایی و جابه‌جایی (ماوس: چپ چرخش، راست جابه‌جایی، چرخ زوم) — اعداد برآورد اولیه‌اند و جایگزین نقشه‌برداری رسمی نیستند'),
  ]);
  document.body.append(overlay);
  stage.append(resultsPanel, legendBox, flashBox, pickBox);

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

    // ── رندرر ──
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
      const w = Math.max(1, stage.clientWidth);
      const h = Math.max(1, stage.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    state.disposers.push(() => ro.disconnect());
    resize();

    // ── بارگذاری مدل ──
    // ODM خروجی GLB را با فشرده‌سازی Draco می‌سازد؛ فایل‌های رمزگشا در هر build از node_modules به
    // public/draco/ کپی می‌شوند (vite.config.js) و از همان origin اپ لود می‌شوند (نه CDN).
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    draco.setDecoderConfig({ type: 'wasm' });
    state.disposers.push(() => draco.dispose());
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const parseGlb = (buffer) => new Promise((resolve, reject) => { loader.parse(buffer, '', resolve, reject); });

    let gltf;
    try {
      gltf = await parseGlb(await blob.arrayBuffer());
    } catch (err) {
      fail(`خواندن مدل ناموفق بود: ${err.message || err}`);
      return;
    }
    if (state.closed) return;

    // ── متریال بدون نورپردازی + آمار ──
    const holder = new THREE.Group();
    holder.add(gltf.scene);
    scene.add(holder);
    const basics = [];
    let triangles = 0;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const old = o.material;
      const basic = new THREE.MeshBasicMaterial({
        map: (old && old.map) || null,
        color: old && old.map ? 0xffffff : ((old && old.color) || 0xcccccc),
        vertexColors: !!o.geometry.attributes.color,
        side: THREE.DoubleSide,
      });
      basics.push(basic);
      o.material = basic;
      const idx = o.geometry.index;
      triangles += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
      if (old && old.dispose) old.dispose();
    });
    state.disposers.push(() => {
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    });

    // ── تشخیص خودکار محور بالا (پیش از هر چرخش) و موقعیت جغرافیایی ──
    // کوچک‌ترین بُعد مدل (زمین) باید عمودی باشد. اگر آن محور Z بود (خروجی معمول ODM)، دید را می‌چرخانیم.
    const upAxis = detectUpAxis(THREE, gltf.scene);
    const preBox = new THREE.Box3().setFromObject(gltf.scene);
    const bboxEnuRaw = upAxis === 'z'
      ? {
        minE: preBox.min.x, maxE: preBox.max.x, minN: preBox.min.y, maxN: preBox.max.y,
      }
      : {
        minE: preBox.min.x, maxE: preBox.max.x, minN: -preBox.max.z, maxN: -preBox.min.z,
      };
    const rtc = readRtcCenter(gltf.parser && gltf.parser.json);
    const georef = buildGeoref({ rtc, crs: summary && summary.crs, corners });
    const validCorners = (corners || []).filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));

    (function describeGeoref() {
      if (!rtc) {
        geoLine.textContent = 'ℹ️ موقعیت جغرافیایی در این مدل ثبت نشده؛ اندازه‌گیری‌ها فقط محلی‌اند (برای مدل‌های جدید یا دوباره‌ساخته‌شده ثبت می‌شود).';
        return;
      }
      if (!georef) {
        geoLine.textContent = 'ℹ️ مبدأ مدل ثبت شده ولی زون UTM مشخص نیست (گوشه‌ی پروانه‌ی معدن ثبت نشده).';
        return;
      }
      const zoneNote = `UTM ${georef.zone}${georef.hemisphere}${georef.zoneSource === 'mine' ? ' (زون از مختصات معدن)' : ''}`;
      const chk = checkGeorefConsistency(georef, bboxEnuRaw, validCorners);
      if (!chk) geoLine.textContent = `📍 ${zoneNote} — گوشه‌ی پروانه برای تطبیق ثبت نشده`;
      else if (chk.status === 'ok') geoLine.textContent = `✅ ${zoneNote} — موقعیت مدل با پروانه‌ی معدن همخوان است`;
      else if (chk.status === 'warn') { geoLine.style.color = '#e0a339'; geoLine.textContent = `⚠️ ${zoneNote} — مرکز مدل ${FA(chk.distance / 1000, 1)} کیلومتر با مرکز پروانه فاصله دارد`; } else { geoLine.style.color = '#f0a08a'; geoLine.textContent = `❌ ${zoneNote} — مرکز مدل ${FA(chk.distance / 1000, 1)} کیلومتر با پروانه فاصله دارد؛ زون یا موقعیت مدل را بررسی کنید`; }
    }());

    // ── وضعیت ابزارها ──
    const fresh = () => ({ pts: [], objs: [], line: null });
    let analysis = null; // { surface, parts, bboxEnu } — فقط هنگام اولین استفاده از یک ابزار ساخته می‌شود
    let colorLayer = null;
    let tool = null;
    let pending = fresh();
    const entries = [];
    let entrySeq = 0;
    let boundaryObj = null;
    let boundaryOn = false;
    let colorMode = null; // 'slope' | 'compare' | null
    let compareState = null;
    let slopePreset = SLOPE_PRESETS[0];
    let lastSlope = null;
    let lastCompare = null;
    let markerRadius = 1;
    let modelDiag = 1;

    let flashTimer = 0;
    state.disposers.push(() => clearTimeout(flashTimer));
    function flash(msg, ok = false) {
      flashBox.textContent = msg;
      flashBox.style.color = ok ? '#bfe3c8' : '#f0a08a';
      flashBox.style.borderColor = ok ? '#3d6b52' : '#6b3a2e';
      flashBox.style.display = 'block';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashBox.style.display = 'none'; }, 6000);
    }

    async function busy(text, fn) {
      status.style.display = 'flex';
      status.style.color = '#e8e2d0';
      status.textContent = `⏳ ${text}`;
      await nextPaint();
      try { return await fn(); } finally { if (!state.closed) status.style.display = 'none'; }
    }

    async function ensureAnalysis() {
      if (analysis) return analysis;
      try {
        analysis = await busy('در حال آماده‌سازی تحلیل مدل...', () => collectEnuMesh(THREE, holder, upAxis));
      } catch (err) {
        flash(err.message || String(err));
        return null;
      }
      colorLayer = createColorLayer(THREE, analysis.parts);
      return analysis;
    }

    function disposeObj(o) {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }

    function addMarker(point, color = 0xffcc33) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(markerRadius, 12, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      marker.position.copy(point);
      marker.renderOrder = 999;
      scene.add(marker);
      return marker;
    }

    const toEnu = (worldPoint) => sceneToEnu(THREE, holder, upAxis, worldPoint);

    /** چسباندن یک مسیر ENU روی سطح مدل (نیازمند analysis) */
    function drape(path, { closed = false, color = 0xff3b30 } = {}) {
      if (!analysis) return null;
      let len = 0;
      for (let i = 1; i < path.length; i += 1) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      if (closed && path.length > 1) len += Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]);
      const line = drapedLine(THREE, holder, upAxis, analysis.surface, path, {
        closed, color, step: Math.max(len / 2500, 0.1), lift: Math.max(0.05, modelDiag / 3000),
      });
      if (line) scene.add(line);
      return line;
    }

    // ── نتایج (ردیف‌های پنل پایین) ──
    function updatePanelVisibility() {
      resultsPanel.style.display = (tool || entries.length) ? 'block' : 'none';
    }

    function removeEntry(id) {
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return;
      const e = entries[idx];
      e.objects.forEach(disposeObj);
      e.row.remove();
      entries.splice(idx, 1);
      updatePanelVisibility();
    }

    function addEntry({
      type, title, objects = [], body = null, data = {},
    }) {
      entrySeq += 1;
      const id = entrySeq;
      const label = el('span', { style: 'flex:1;min-width:0;overflow-wrap:anywhere' }, `#${id} — ${title}`);
      const removeBtn = el('button', { style: 'background:none;border:none;color:#e0a339;cursor:pointer;font-size:11px;padding:0 4px' }, '✕');
      const row = el('div', { style: 'padding:3px 0;border-top:1px solid #2b2a24' }, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:6px' }, [label, removeBtn]),
        body,
      ]);
      resultsList.append(row);
      const entry = {
        id, type, objects, row, data: { text: title, ...data }, label,
      };
      entries.push(entry);
      removeBtn.addEventListener('click', () => removeEntry(id));
      updatePanelVisibility();
      return entry;
    }

    function resetPending() {
      pending.objs.forEach(disposeObj);
      if (pending.line) disposeObj(pending.line);
      pending = fresh();
    }

    function clearEntries() {
      resetPending();
      [...entries].forEach((e) => removeEntry(e.id));
      updatePanelVisibility();
    }
    clearAllBtn.addEventListener('click', clearEntries);

    // ── انتخاب ابزار ──
    const TOOL_HINTS = {
      distance: '📏 فاصله: روی دو نقطه از مدل بزنید (کشیدن همچنان دوربین را می‌چرخاند)',
      probe: '📍 مختصات: روی هر نقطه‌ی مدل بزنید تا مختصات و ارتفاعش بیاید',
      area: '⬠ مساحت/حجم: نقاط محیط را به ترتیب بزنید (حداقل ۳ نقطه) و «✔ پایان» را بزنید',
      profile: '📈 مقطع: نقطه‌ی ابتدا و انتهای مقطع را بزنید',
    };
    function highlight(btn, on) { btn.style.background = on ? '#3d6b52' : '#2b2a24'; }

    function setTool(name) {
      resetPending();
      tool = tool === name ? null : name;
      Object.entries(toolBtns).forEach(([k, b]) => highlight(b, tool === k));
      toolHint.textContent = tool ? TOOL_HINTS[tool] : '';
      hintBar.style.display = tool ? 'flex' : 'none';
      areaCtl.style.display = tool === 'area' ? 'inline-flex' : 'none';
      updatePanelVisibility();
    }
    Object.keys(toolBtns).forEach((k) => { toolBtns[k].onclick = () => setTool(k); });

    // ── ۱) فاصله ──
    function pickDistance(point) {
      pending.objs.push(addMarker(point));
      pending.pts.push(point);
      if (pending.pts.length < 2) return;
      const [a, b] = pending.pts;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: 0xffcc33, depthTest: false }),
      );
      line.renderOrder = 998;
      scene.add(line);
      const straight = a.distanceTo(b);
      const vertical = Math.abs(b.y - a.y);
      const horizontal = Math.sqrt(Math.max(0, straight * straight - vertical * vertical));
      const fmtM = (v) => `${v.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} م`;
      addEntry({
        type: 'distance',
        title: `فاصله — مستقیم ${fmtM(straight)} · افقی ${fmtM(horizontal)} · ارتفاع ${fmtM(vertical)}`,
        objects: [...pending.objs, line],
        data: { straight_m: straight, horizontal_m: horizontal, vertical_m: vertical },
      });
      pending = fresh();
    }

    // ── ۲) مختصات ──
    function pickProbe(point) {
      const enu = toEnu(point);
      const data = { e_local: enu[0], n_local: enu[1], u_local: enu[2] };
      if (georef) {
        const utm = enuToUtm(georef, enu[0], enu[1], enu[2]);
        const ll = enuToLatLon(georef, enu[0], enu[1]);
        Object.assign(data, {
          zone: `${georef.zone}${georef.hemisphere}`, easting: utm.easting, northing: utm.northing, elevation: utm.elevation, lat: ll.lat, lon: ll.lon,
        });
      }
      addEntry({
        type: 'probe', title: `نقطه — ${describePoint(georef, enu[0], enu[1], enu[2])}`, objects: [addMarker(point, 0x4fc3f7)], data,
      });
    }

    // ── ۳) مساحت و حجم ──
    function refreshAreaLine() {
      if (pending.line) { disposeObj(pending.line); pending.line = null; }
      if (pending.pts.length < 2) return;
      const loop = pending.pts.length >= 3 ? [...pending.pts, pending.pts[0]] : pending.pts;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(loop),
        new THREE.LineBasicMaterial({ color: 0x33d17a, depthTest: false }),
      );
      line.renderOrder = 998;
      scene.add(line);
      pending.line = line;
    }
    function pickArea(point) {
      pending.objs.push(addMarker(point, 0x33d17a));
      pending.pts.push(point);
      refreshAreaLine();
      toolHint.textContent = `⬠ ${pending.pts.length.toLocaleString('fa-IR')} نقطه ثبت شد — با «✔ پایان» محاسبه کنید`;
    }
    areaUndoBtn.onclick = () => {
      if (!pending.pts.length) return;
      pending.pts.pop();
      disposeObj(pending.objs.pop());
      refreshAreaLine();
      toolHint.textContent = pending.pts.length ? `⬠ ${pending.pts.length.toLocaleString('fa-IR')} نقطه ثبت شد` : TOOL_HINTS.area;
    };

    async function finishArea() {
      if (pending.pts.length < 3) { flash('برای پلیگون حداقل ۳ نقطه لازم است'); return; }
      const poly = pending.pts.map((p) => toEnu(p)).map(([e, n]) => [e, n]);
      const a = await ensureAnalysis();
      if (!a) return;
      resetPending();
      toolHint.textContent = TOOL_HINTS.area;
      const outline = drape(poly, { closed: true, color: 0x33d17a });
      const resultText = el('div', { style: 'line-height:1.8;white-space:pre-line;margin-top:2px' });
      const baseSel = el('select', { style: selStyle }, VOLUME_BASES.map((b) => el('option', { value: b }, BASE_LABELS[b])));
      const levelInp = el('input', { type: 'number', step: '0.1', placeholder: 'ارتفاع مطلق تراز مبنا (متر)', style: `${selStyle};display:none;margin-top:3px` });
      const entry = addEntry({
        type: 'area', title: 'مساحت و حجم', objects: outline ? [outline] : [], body: el('div', { style: 'display:flex;flex-direction:column;gap:3px' }, [resultText, baseSel, levelInp]),
      });
      const compute = () => {
        const base = baseSel.value;
        levelInp.style.display = base === 'level' ? 'block' : 'none';
        let level = 0;
        if (base === 'level') {
          const abs = parseFloat(levelInp.value);
          if (!Number.isFinite(abs)) { resultText.textContent = 'ارتفاع مطلق تراز مبنا را وارد کنید (مثلاً ۱۸۵۰٫۵)'; return; }
          level = abs - (georef ? georef.rtc[2] : 0);
        }
        try {
          const r = polygonVolume(a.surface, poly, { base, level });
          const lines = [
            `مساحت افقی ${FA(r.area, 0)} م² (${FA(r.area / 10000, 2)} هکتار) · محیط ${FA(r.perimeter, 0)} م`,
            `حجم بالای مبنا ${FA(r.above, 0)} م³ · زیر مبنا ${FA(r.below, 0)} م³ · خالص ${FA(r.net, 0)} م³`,
            `بیشینه ارتفاع از مبنا ${FA(r.maxHeight, 1)} م`,
          ];
          if (r.base.plane) {
            const slope = (Math.atan(Math.hypot(r.base.plane.a, r.base.plane.b)) * 180) / Math.PI;
            lines.push(`شیب صفحه‌ی مبنا ${FA(slope, 1)}° · خطای برازش ${FA(r.base.plane.rmse, 2)} م`);
          } else if (Number.isFinite(r.base.level)) {
            lines.push(`تراز مبنا ${FA(r.base.level + (georef ? georef.rtc[2] : 0), 1)} م`);
          }
          if (r.coverage < 0.9) lines.push(`⚠️ فقط ${FA(r.coverage * 100, 0)}٪ پلیگون روی مدل است؛ حجم ناقص است`);
          resultText.textContent = lines.join('\n');
          entry.data = {
            type: 'area',
            text: lines.join(' | '),
            base,
            area_m2: r.area,
            perimeter_m: r.perimeter,
            above_m3: r.above,
            below_m3: r.below,
            net_m3: r.net,
            max_height_m: r.maxHeight,
            coverage: r.coverage,
            polygon_enu: poly.map(([e, n]) => [Number(e.toFixed(3)), Number(n.toFixed(3))]),
          };
        } catch (err) {
          resultText.textContent = `❌ ${err.message}`;
        }
      };
      baseSel.addEventListener('change', compute);
      levelInp.addEventListener('input', compute);
      compute();
    }
    areaFinishBtn.onclick = () => { finishArea().catch((err) => flash(err.message || String(err))); };

    // ── ۴) مقطع ──
    function drawProfile(canvas, prof, zOff) {
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width; const H = canvas.height;
      const padL = 44; const padR = 6; const padT = 8; const padB = 16;
      ctx.fillStyle = '#1c1b17';
      ctx.fillRect(0, 0, W, H);
      if (!prof.validCount) return;
      const span = Math.max(prof.maxZ - prof.minZ, 0.5);
      const yMin = prof.minZ - span * 0.08; const yMax = prof.maxZ + span * 0.08;
      const X = (d) => padL + (d / prof.length) * (W - padL - padR);
      const Y = (z) => padT + (1 - (z - yMin) / (yMax - yMin)) * (H - padT - padB);
      ctx.strokeStyle = '#3d3b32'; ctx.lineWidth = 1;
      ctx.strokeRect(padL, padT, W - padL - padR, H - padT - padB);
      ctx.fillStyle = '#b9b29c'; ctx.font = '10px sans-serif';
      ctx.fillText((prof.maxZ + zOff).toFixed(1), 2, padT + 8);
      ctx.fillText((prof.minZ + zOff).toFixed(1), 2, H - padB);
      ctx.fillText('0', padL, H - 3);
      ctx.fillText(`${prof.length.toFixed(0)} m`, W - padR - 34, H - 3);
      ctx.strokeStyle = '#e0a339'; ctx.lineWidth = 1.5; ctx.beginPath();
      let pen = false;
      prof.samples.forEach((s) => {
        if (!Number.isFinite(s.z)) { pen = false; return; }
        if (!pen) { ctx.moveTo(X(s.d), Y(s.z)); pen = true; } else ctx.lineTo(X(s.d), Y(s.z));
      });
      ctx.stroke();
    }

    async function pickProfile(point) {
      pending.objs.push(addMarker(point, 0xb388ff));
      pending.pts.push(point);
      if (pending.pts.length < 2) return;
      const markers = pending.objs;
      const [pa, pb] = pending.pts.map((p) => toEnu(p));
      pending = fresh();
      const a = await ensureAnalysis();
      if (!a) { markers.forEach(disposeObj); return; }
      try {
        const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        const prof = profileAlong(a.surface, [pa[0], pa[1]], [pb[0], pb[1]], Math.max(0.1, len / 400));
        const zOff = georef ? georef.rtc[2] : 0;
        const objects = [...markers];
        const line = drape([[pa[0], pa[1]], [pb[0], pb[1]]], { color: 0xb388ff });
        if (line) objects.push(line);
        const canvas = el('canvas', { width: '300', height: '110', style: 'width:100%;max-width:340px;border-radius:6px' });
        drawProfile(canvas, prof, zOff);
        const stats = el('div', { style: 'line-height:1.7' },
          prof.validCount
            ? `طول ${FA(prof.length, 1)} م · ارتفاع ${FA(prof.minZ + zOff, 1)} تا ${FA(prof.maxZ + zOff, 1)} م · بیشینه شیب ${FA(prof.maxSlopeDeg, 0)}° — مقیاس قائم و افقی یکسان نیست`
            : '⚠️ این مقطع روی مدل نیست');
        const entryRef = { id: 0 };
        const csvBtn = mkSmall('⬇️ CSV', () => {
          saveBlob(new Blob(['\ufeff', profileToCsv(prof.samples, georef ? georef.rtc : null)], { type: 'text/csv' }), `profile-${entryRef.id}.csv`).catch(() => {});
        });
        const dxfBtn = mkSmall('⬇️ DXF', () => {
          saveBlob(new Blob([profileToDxf(prof.samples, { layer: `PROFILE_${entryRef.id}`, elevationOffset: zOff })], { type: 'application/dxf' }), `profile-${entryRef.id}.dxf`).catch(() => {});
        });
        const entry = addEntry({
          type: 'profile',
          title: 'مقطع',
          objects,
          body: el('div', { style: 'display:flex;flex-direction:column;gap:3px;margin-top:2px' }, [canvas, stats, el('div', { style: 'display:flex;gap:6px' }, [csvBtn, dxfBtn])]),
          data: {
            text: `مقطع — طول ${FA(prof.length, 1)} م · ارتفاع ${FA(prof.minZ + zOff, 1)} تا ${FA(prof.maxZ + zOff, 1)} م · بیشینه شیب ${FA(prof.maxSlopeDeg, 0)}°`,
            length_m: prof.length,
            min_elevation_m: prof.minZ + zOff,
            max_elevation_m: prof.maxZ + zOff,
            max_slope_deg: prof.maxSlopeDeg,
            start_enu: pa.map((v) => Number(v.toFixed(3))),
            end_enu: pb.map((v) => Number(v.toFixed(3))),
          },
        });
        entryRef.id = entry.id;
      } catch (err) {
        markers.forEach(disposeObj);
        flash(err.message || String(err));
      }
    }

    function onPick(point) {
      if (tool === 'distance') pickDistance(point);
      else if (tool === 'probe') pickProbe(point);
      else if (tool === 'area') pickArea(point);
      else if (tool === 'profile') pickProfile(point).catch((err) => flash(err.message || String(err)));
    }

    // ── لایه: محدوده‌ی پروانه ──
    function rebuildBoundary() {
      if (boundaryObj) { disposeObj(boundaryObj); boundaryObj = null; }
      if (!boundaryOn || !analysis || !georef) return;
      boundaryObj = drape(cornersToEnu(georef, validCorners), { closed: true, color: 0xff3b30 });
    }
    async function toggleBoundary() {
      if (boundaryOn) {
        boundaryOn = false;
        rebuildBoundary();
        highlight(layerBtns.boundary, false);
        return;
      }
      if (!georef) { flash('برای چسباندن محدوده روی مدل، موقعیت جغرافیایی مدل لازم است (این مدل آن را ندارد)'); return; }
      if (validCorners.length < 3) { flash('برای این معدن حداقل ۳ گوشه‌ی مختصاتی ثبت نشده است'); return; }
      const a = await ensureAnalysis();
      if (!a) return;
      boundaryOn = true;
      rebuildBoundary();
      if (!boundaryObj) {
        boundaryOn = false;
        flash('محدوده‌ی پروانه با این مدل هم‌پوشانی ندارد — احتمالاً زون یا موقعیت مدل درست نیست');
        return;
      }
      highlight(layerBtns.boundary, true);
      const cov = boundaryObj.userData.coverage;
      flash(`محدوده‌ی پروانه روی مدل رسم شد (${FA(cov * 100, 0)}٪ از محیط روی مدل است)`, true);
    }
    layerBtns.boundary.onclick = () => { toggleBoundary().catch((err) => flash(err.message || String(err))); };

    // ── لایه‌های رنگی: شیب / مقایسه ──
    function clearColorMode() {
      if (colorLayer && colorLayer.active) colorLayer.restore();
      colorMode = null;
      compareState = null;
      lastSlope = null;
      lastCompare = null;
      legendBox.style.display = 'none';
      legendBox.replaceChildren();
      highlight(layerBtns.slope, false);
      highlight(layerBtns.compare, false);
    }
    const swatch = (color, text) => el('span', { style: 'display:inline-flex;align-items:center;gap:4px;margin-inline-end:10px' }, [
      el('span', { style: `display:inline-block;width:12px;height:12px;border-radius:3px;background:${color}` }),
      text,
    ]);

    function renderSlopeLegend(r) {
      const presetSel = el('select', { style: selStyle }, SLOPE_PRESETS.map((p) => el('option', p.id === slopePreset.id ? { value: p.id, selected: '' } : { value: p.id }, p.label)));
      presetSel.addEventListener('change', () => {
        slopePreset = SLOPE_PRESETS.find((p) => p.id === presetSel.value) || SLOPE_PRESETS[0];
        applySlope().catch((err) => flash(err.message || String(err)));
      });
      legendBox.replaceChildren(
        el('div', { style: 'font-weight:700' }, `⛰ نقشه‌ی شیب — بیشینه ${FA(r.maxSlopeDeg, 0)}° · ${FA(r.steepAreaPct, 1)}٪ مساحت ≥ ${slopePreset.steep.toLocaleString('fa-IR')}°`),
        el('div', {}, [
          swatch('#40ad57', `< ${slopePreset.gentle.toLocaleString('fa-IR')}°`),
          swatch('#f5bd2e', `${slopePreset.gentle.toLocaleString('fa-IR')}–${slopePreset.steep.toLocaleString('fa-IR')}°`),
          swatch('#db3326', `≥ ${slopePreset.steep.toLocaleString('fa-IR')}°`),
        ]),
        presetSel,
        el('div', { style: 'color:#8d8775;font-size:10px' }, 'غربالگری اولیه از روی مدل؛ جایگزین ارزیابی ژئوتکنیک نیست. آستانه‌ها به جنس سنگ/خاک بستگی دارند.'),
      );
      legendBox.style.display = 'block';
    }

    async function applySlope() {
      const a = await ensureAnalysis();
      if (!a) return;
      clearColorMode();
      const r = await busy('در حال محاسبه‌ی شیب...', () => slopeVertexColors(a.surface, slopePreset));
      colorLayer.apply(r.colors);
      colorMode = 'slope';
      lastSlope = { preset: slopePreset.id, max_slope_deg: r.maxSlopeDeg, steep_area_pct: r.steepAreaPct };
      highlight(layerBtns.slope, true);
      renderSlopeLegend(r);
    }
    layerBtns.slope.onclick = () => {
      if (colorMode === 'slope') { clearColorMode(); return; }
      applySlope().catch((err) => flash(err.message || String(err)));
    };

    function disposeGltf(g) {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry) o.geometry.dispose();
        const m = o.material;
        if (m) { if (m.map) m.map.dispose(); m.dispose(); }
      });
    }

    async function loadReference(option) {
      const refBlob = await option.load();
      const g = await parseGlb(await refBlob.arrayBuffer());
      try {
        const refRtc = readRtcCenter(g.parser && g.parser.json);
        if (!refRtc) throw new Error('این مدل موقعیت جغرافیایی (CESIUM_RTC) ندارد؛ نمی‌توان با آن مقایسه کرد');
        const refUp = detectUpAxis(THREE, g.scene);
        const tmp = new THREE.Group();
        tmp.add(g.scene);
        return { surface: collectEnuMesh(THREE, tmp, refUp).surface, rtc: refRtc };
      } finally {
        disposeGltf(g);
      }
    }

    function renderCompareLegend(res, range) {
      const bar = el('div', { style: 'height:10px;border-radius:5px;background:linear-gradient(90deg,#ff0000,#ffffff,#0000ff);margin:3px 0' });
      const parts = [
        el('div', { style: 'font-weight:700' }, `🔥 مقایسه با «${compareState.label}»`),
        el('div', {}, `برداشت ${FA(res.cut, 0)} م³ · افزوده ${FA(res.fill, 0)} م³ · خالص ${FA(res.net, 0)} م³ — پوشش ${FA(res.coverage * 100, 0)}٪ مدل`),
        bar,
        el('div', { style: 'display:flex;justify-content:space-between;font-size:10px;color:#b9b29c' }, [
          el('span', {}, `−${FA(range, 1)} م (پایین‌تر شده)`), el('span', {}, '۰'), el('span', {}, `+${FA(range, 1)} م (بالاتر)`),
        ]),
      ];
      if (compareState.zBias !== 0) {
        parts.push(el('div', { style: 'color:#bfe3c8' }, `✅ با تصحیح ارتفاعی ${FA(compareState.zBias, 2)} م (به‌اندازه‌ی میانه‌ی اختلاف) محاسبه شده؛ فرض بر این است که بیشتر سطح تغییری نکرده.`));
      } else if (Math.abs(res.medianDz) > 0.3) {
        parts.push(el('div', { style: 'color:#e0a339' }, `⚠️ میانه‌ی اختلاف ارتفاع ${FA(res.medianDz, 2)} م است. اگر پروازها GCP/RTK ندارند، این معمولاً خطای سیستماتیک ارتفاع است نه تغییر واقعی.`));
        parts.push(mkSmall('تصحیح با میانه (فرض: بیشتر سطح ثابت است)', () => {
          compareState.zBias -= res.medianDz;
          applyCompare().catch((err) => flash(err.message || String(err)));
        }));
      }
      parts.push(el('div', { style: 'color:#8d8775;font-size:10px' }, 'برآورد اولیه؛ دقت به ژئورفرنس هر دو پرواز (GCP/RTK) بستگی دارد.'));
      legendBox.replaceChildren(...parts);
      legendBox.style.display = 'block';
    }

    async function applyCompare() {
      const res = await busy('در حال مقایسه‌ی دو مدل...', () => compareSurfaces(
        analysis.surface, compareState.ref, { shift: compareState.shift, zBias: compareState.zBias },
      ));
      if (res.coverage < 0.05) {
        clearColorMode();
        flash('این دو مدل تقریباً هم‌پوشانی ندارند — منطقه یا زون UTM یکسان نیست');
        return;
      }
      const range = Math.max(0.5, res.p95Abs);
      const keep = { label: compareState.label, ref: compareState.ref, shift: compareState.shift, zBias: compareState.zBias };
      if (colorLayer.active) colorLayer.restore();
      colorLayer.apply(diffVertexColors(res.dz, range));
      colorMode = 'compare';
      compareState = keep;
      lastCompare = {
        reference: keep.label, cut_m3: res.cut, fill_m3: res.fill, net_m3: res.net, coverage: res.coverage, median_dz_m: res.medianDz, z_bias_m: keep.zBias,
      };
      highlight(layerBtns.slope, false);
      highlight(layerBtns.compare, true);
      renderCompareLegend(res, range);
    }

    async function runCompare(option) {
      pickBox.style.display = 'none';
      const a = await ensureAnalysis();
      if (!a) return;
      try {
        const myCrs = summary && summary.crs;
        const otherCrs = option.summary && option.summary.crs;
        if (myCrs && otherCrs && myCrs !== otherCrs) throw new Error('سیستم مختصات دو مدل یکسان نیست؛ مقایسه معتبر نیست');
        const ref = await busy(`در حال دریافت و خواندن «${option.label}»...`, () => loadReference(option));
        const shift = [rtc[0] - ref.rtc[0], rtc[1] - ref.rtc[1], rtc[2] - ref.rtc[2]];
        clearColorMode();
        compareState = {
          label: option.label, ref: ref.surface, shift, zBias: 0,
        };
        await applyCompare();
      } catch (err) {
        flash(err.message || String(err));
      }
    }

    function openComparePicker() {
      if (colorMode === 'compare') { clearColorMode(); return; }
      if (!georef) { flash('برای مقایسه، مدل فعلی باید موقعیت جغرافیایی داشته باشد (مدل‌های قدیمی/پیش‌نمایش ندارند)'); return; }
      if (!compareOptions.length) { flash('مدل دیگری از همین معدن (پرواز نقشه‌برداری یا ادغام آماده) برای مقایسه نیست'); return; }
      pickBox.replaceChildren(
        el('div', { style: 'font-weight:700;margin-bottom:6px' }, '🔥 مقایسه با کدام مدل؟ (مدل فعلی «جدید» در نظر گرفته می‌شود)'),
        ...compareOptions.map((o) => el('button', {
          style: `${smallBtnStyle};display:block;width:100%;text-align:right;margin-bottom:5px;padding:7px 8px`,
          onclick: () => { runCompare(o).catch((err) => flash(err.message || String(err))); },
        }, o.label)),
        el('div', { style: 'color:#8d8775;font-size:10px;margin:4px 0' }, 'مدل دوم دانلود و روی دستگاه رمزگشایی می‌شود؛ ممکن است چند دقیقه طول بکشد.'),
        mkSmall('انصراف', () => { pickBox.style.display = 'none'; }),
      );
      pickBox.style.display = 'block';
    }
    layerBtns.compare.onclick = () => { try { openComparePicker(); } catch (err) { flash(err.message || String(err)); } };

    // ── لایه: تصویر ماهواره‌ای زیر مدل ──
    // صفحه‌ی تختِ زیر پایین‌ترین نقطه‌ی مدل، فرزندِ holder است تا با چرخش دید همراه شود؛ از تحلیل‌ها و انتخاب نقطه کنار
    // گذاشته می‌شود (userData.excludeFromAnalysis + raycast خالی) تا اندازه‌گیری روی تصویر تخت اشتباه نخورد.
    let satObj = null;
    let satOn = false;
    let satToken = 0;
    let satAbort = { aborted: false };
    let satCtl = null;
    const bboxFlat = bboxEnuRaw;
    const baseElevation = upAxis === 'z' ? preBox.min.z : preBox.min.y;

    function disposeSatelliteMesh() {
      if (!satObj) return;
      holder.remove(satObj);
      satObj.geometry.dispose();
      if (satObj.material.map) satObj.material.map.dispose();
      satObj.material.dispose();
      satObj = null;
    }
    function disposeSatellite() {
      satAbort.aborted = true;
      if (satCtl) satCtl.abort();
      disposeSatelliteMesh();
    }
    state.disposers.push(disposeSatellite);

    async function fetchSatTile(tile, signal) {
      const res = await fetch(tile.url, { mode: 'cors', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return createImageBitmap(await res.blob());
    }

    async function buildSatellite() {
      const myToken = (satToken += 1);
      satAbort.aborted = true; // دانلود قبلی (اگر بود) متوقف شود
      if (satCtl) satCtl.abort();
      const abortCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      satCtl = abortCtl;
      satAbort = { aborted: false };
      const myAbort = satAbort;
      const stale = () => state.closed || myToken !== satToken || myAbort.aborted;
      satStatus.style.color = '#9fc7e8';
      satStatus.textContent = '⏳ در حال دریافت تصویر ماهواره‌ای...';
      let plan;
      try {
        plan = planSatellite(bboxFlat, (e, n) => enuToLatLon(georef, e, n), { maxTiles: DETAIL_LEVELS[satDetailSel.value].maxTiles });
      } catch (err) {
        satStatus.style.color = '#f0a08a';
        satStatus.textContent = `❌ ${err.message}`;
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = plan.widthPx;
      canvas.height = plan.heightPx;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) {
        satStatus.style.color = '#f0a08a';
        satStatus.textContent = '❌ این مرورگر امکان ساخت بوم تصویر را ندارد';
        return;
      }
      ctx.fillStyle = '#3a3a34';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const result = await loadSatelliteTiles(
        plan,
        (tile) => fetchSatTile(tile, abortCtl && abortCtl.signal),
        (img, col, row) => {
          ctx.drawImage(img, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          if (img.close) img.close();
        },
        {
          template: SATELLITE_TILE_URL,
          signal: myAbort,
          onProgress: (d, t) => { if (!stale()) satStatus.textContent = `⏳ دریافت تصویر ماهواره‌ای: ${d.toLocaleString('fa-IR')} از ${t.toLocaleString('fa-IR')} کاشی`; },
        },
      );
      if (abortCtl && stale()) abortCtl.abort();
      if (stale()) return;
      if (!result.ok) {
        satOn = false;
        highlight(layerBtns.satellite, false);
        satRow.style.display = 'none';
        flash('هیچ کاشی ماهواره‌ای دریافت نشد — اینترنت یا دسترسی به سرویس Esri را بررسی کنید (از بعضی شبکه‌ها در دسترس نیست)');
        return;
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities && renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
      const margin = Math.max(0.3, 0.005 * Math.max(bboxFlat.maxE - bboxFlat.minE, bboxFlat.maxN - bboxFlat.minN));
      const grid = buildSatelliteGrid(plan, (e, n) => enuToLatLon(georef, e, n), baseElevation - margin, 24);
      const localPos = new Float32Array(grid.positions.length);
      for (let i = 0; i < grid.positions.length; i += 3) {
        const [x, y, z] = localFromEnu(upAxis, grid.positions[i], grid.positions[i + 1], grid.positions[i + 2]);
        localPos[i] = x; localPos[i + 1] = y; localPos[i + 2] = z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(localPos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(grid.uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(grid.indices, 1));
      const opacity = parseFloat(satOpacity.value) || 1;
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: texture, side: THREE.DoubleSide, transparent: opacity < 1, opacity,
      }));
      mesh.userData.excludeFromAnalysis = true;
      mesh.raycast = () => {};
      mesh.renderOrder = -1;
      disposeSatelliteMesh();
      satObj = mesh;
      holder.add(mesh);
      satStatus.style.color = result.failed ? '#e0a339' : '#9fc7e8';
      satStatus.textContent = `🛰 زوم ${plan.z.toLocaleString('fa-IR')} · ${result.ok.toLocaleString('fa-IR')} از ${result.total.toLocaleString('fa-IR')} کاشی${result.failed ? ' (کاشی‌های ناموفق خاکستری‌اند)' : ''} · ${SATELLITE_ATTRIBUTION} — صفحه‌ی تخت زیر مدل؛ وضوح متری و تاریخ تصویر نامعلوم؛ اگر بخشی خاکستری «داده در دسترس نیست» بود، جزئیات را کمتر کنید.`;
    }

    async function toggleSatellite() {
      if (satOn) {
        satOn = false;
        satToken += 1;
        disposeSatellite();
        highlight(layerBtns.satellite, false);
        satRow.style.display = 'none';
        return;
      }
      if (!georef) { flash('برای تصویر ماهواره‌ای، موقعیت جغرافیایی مدل لازم است (این مدل آن را ندارد)'); return; }
      satOn = true;
      highlight(layerBtns.satellite, true);
      satRow.style.display = 'flex';
      await buildSatellite();
    }
    layerBtns.satellite.onclick = () => { toggleSatellite().catch((err) => flash(err.message || String(err))); };
    satDetailSel.addEventListener('change', () => { if (satOn) buildSatellite().catch((err) => flash(err.message || String(err))); });
    satOpacity.addEventListener('input', () => {
      if (!satObj) return;
      const o = parseFloat(satOpacity.value) || 1;
      satObj.material.opacity = o;
      satObj.material.transparent = o < 1;
      satObj.material.needsUpdate = true;
    });

    // ── خروجی CSV ──
    function buildExport() {
      const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const rows = [
        ['title', title],
        ['coordinate_system', georef ? `UTM ${georef.zone}${georef.hemisphere} WGS84 - easting/northing/elevation in metres` : 'local model coordinates (no georeference in this model)'],
        ['note', 'preliminary estimates from a photogrammetric model - not an official survey'],
        [],
        ['id', 'type', 'text', 'json'],
        ...entries.map((e) => [e.id, e.type, e.data.text || '', JSON.stringify(e.data)]),
      ];
      if (lastSlope) rows.push(['layer', 'slope', `max ${lastSlope.max_slope_deg.toFixed(1)} deg`, JSON.stringify(lastSlope)]);
      if (lastCompare) rows.push(['layer', 'compare', lastCompare.reference, JSON.stringify(lastCompare)]);
      return `\ufeff${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
    }
    exportBtn.onclick = () => {
      if (!entries.length && !lastSlope && !lastCompare) { flash('هنوز نتیجه‌ای برای خروجی نیست — ابتدا یک ابزار را به کار ببرید'); return; }
      saveBlob(new Blob([buildExport()], { type: 'text/csv' }), 'model3d-results.csv').catch(() => {});
    };

    // ── راه‌کاست ساده از روی کلیک/ضربه‌ی بدون جابه‌جایی زیاد (تا با چرخاندن دوربین با OrbitControls تداخل نکند) ──
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downPos = null;
    function onPointerDown(e) { downPos = { x: e.clientX, y: e.clientY }; }
    function onPointerUp(e) {
      if (!tool || !downPos) { downPos = null; return; }
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      downPos = null;
      if (Math.hypot(dx, dy) > 6) return; // کشیدن بوده، نه ضربه‌ی اندازه‌گیری
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(gltf.scene, true); // صفحه‌ی ماهواره‌ای قابل انتخاب نیست (تخت و زیر مدل است)
      if (hits.length) onPick(hits[0].point.clone());
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    state.disposers.push(() => {
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
    });

    // ── جهت و قاب‌بندی ──
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const ROTATIONS = [0, -Math.PI / 2, Math.PI / 2];
    let rotIndex = upAxis === 'z' ? 1 : 0;

    const fit = () => {
      clearEntries(); // نشانگرها در فضای جهانی‌اند؛ با چرخش مدل دیگر معتبر نیستند
      holder.rotation.set(ROTATIONS[rotIndex], 0, 0);
      holder.position.set(0, 0, 0);
      holder.updateMatrixWorld(true);
      box.setFromObject(gltf.scene); // فقط خودِ مدل؛ صفحه‌ی ماهواره‌ای نباید قاب‌بندی و مرکزسازی را عوض کند
      box.getCenter(center);
      holder.position.sub(center);
      holder.updateMatrixWorld(true);
      box.setFromObject(gltf.scene); // فقط خودِ مدل؛ صفحه‌ی ماهواره‌ای نباید قاب‌بندی و مرکزسازی را عوض کند
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      modelDiag = size.length() || 1;
      markerRadius = Math.max(modelDiag / 250, 0.03);
      // فاصله‌ی دوربین طوری که کل مدل هم در عرض و هم در ارتفاع صفحه (حتی موبایلِ عمودی) جا شود
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const radius = (size.length() / 2) || 1;
      const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
      camera.near = maxDim / 1000;
      camera.far = maxDim * 100;
      camera.position.set(0.55, 0.6, 0.9).normalize().multiplyScalar(dist);
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.minDistance = maxDim / 50;
      controls.maxDistance = maxDim * 10;
      controls.update();
      info.textContent = `${Math.round(size.x)} × ${Math.round(size.z)} × ${Math.round(size.y)} متر (طول × عرض × ارتفاع) — ${Math.round(triangles).toLocaleString('fa-IR')} مثلث`;
      rebuildBoundary(); // نسبت به holder جدید دوباره روی سطح می‌نشیند
    };
    fit();

    status.style.display = 'none';

    let wire = false;
    wireBtn.onclick = () => { wire = !wire; basics.forEach((m) => { m.wireframe = wire; }); };
    rotateBtn.onclick = () => { rotIndex = (rotIndex + 1) % ROTATIONS.length; fit(); };
    resetBtn.onclick = () => fit();

    const tick = () => {
      if (state.closed) return;
      state.raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    // برای تست خودکار: نشان می‌دهد نمایشگر بالا آمده
    overlay.dataset.ready = '1';
  })();

  return { close };
}

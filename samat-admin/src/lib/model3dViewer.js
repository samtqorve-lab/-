import { el } from './dom.js';
import { saveBlob } from './model3d.js';
/**
 * نمایشگر سه‌بعدی مدل GLB (خروجی OpenDroneMap) داخل اپ. Three.js فقط هنگام اولین باز شدن نمایشگر
 * لود می‌شود (dynamic import) تا بارگذاری اولیه‌ی اپ سنگین‌تر نشود.
 *
 * - مدل‌های فتوگرامتری با متریال بدون نورپردازی (Basic) نمایش داده می‌شوند تا رنگ عکس‌ها دست‌نخورده بماند.
 * - جهت «بالا» خودکار تشخیص داده می‌شود (ODM محور Z را بالا می‌گیرد ولی glTF محور Y را) و با دکمه‌ی چرخش
 *   قابل تغییر است.
 * @param {Blob} blob فایل GLB رمزگشایی‌شده
 * @param {{ title?: string }} [opts]
 * @returns {{ close: () => void }}
 */
export function openModel3dViewer(blob, { title = 'مدل سه‌بعدی' } = {}) {
  const state = { closed: false, raf: 0, disposers: [] };

  const status = el('div', { style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e8e2d0;font-size:14px;text-align:center;padding:24px;pointer-events:none' }, '⏳ در حال بارگذاری مدل...');
  const info = el('div', { style: 'font-size:11px;color:#b9b29c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' });
  const stage = el('div', { style: 'position:relative;flex:1;min-height:0;touch-action:none' }, [status]);

  const btnStyle = 'background:#2b2a24;color:#e8e2d0;border:1px solid #3d3b32;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap';
  const mkBtn = (label, onclick) => el('button', { style: btnStyle, onclick }, label);
  const rotateBtn = mkBtn('🔄 چرخش', () => {});
  const wireBtn = mkBtn('🕸 شبکه', () => {});
  const resetBtn = mkBtn('🎯 بازنشانی', () => {});
  const saveBtn = mkBtn('💾 ذخیره', () => saveBlob(blob, 'model3d.glb').catch(() => {}));
  const closeBtn = mkBtn('✕', () => close());

  const overlay = el('div', { style: 'position:fixed;inset:0;z-index:10000;background:#12110e;display:flex;flex-direction:column;direction:rtl;font-family:inherit' }, [
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #2b2a24;flex-wrap:wrap' }, [
      el('div', { style: 'min-width:0;flex:1 1 180px' }, [
        el('div', { style: 'color:#f1ead6;font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, title),
        info,
      ]),
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [rotateBtn, wireBtn, resetBtn, saveBtn, closeBtn]),
    ]),
    stage,
    el('div', { style: 'padding:6px 10px;font-size:11px;color:#8d8775;border-top:1px solid #2b2a24' }, 'یک انگشت: چرخش — دو انگشت: بزرگ‌نمایی و جابه‌جایی (ماوس: چپ چرخش، راست جابه‌جایی، چرخ زوم)'),
  ]);
  document.body.append(overlay);

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

    let gltf;
    try {
      const buffer = await blob.arrayBuffer();
      gltf = await new Promise((resolve, reject) => { loader.parse(buffer, '', resolve, reject); });
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

    // ── جهت و قاب‌بندی ──
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    const ROTATIONS = [0, -Math.PI / 2, Math.PI / 2];
    let rotIndex = 0;

    const fit = () => {
      holder.rotation.set(ROTATIONS[rotIndex], 0, 0);
      holder.position.set(0, 0, 0);
      holder.updateMatrixWorld(true);
      box.setFromObject(holder);
      box.getCenter(center);
      holder.position.sub(center);
      holder.updateMatrixWorld(true);
      box.setFromObject(holder);
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
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
    };

    // تشخیص خودکار: کوچک‌ترین بُعد مدل (زمین) باید عمودی باشد. اگر آن محور Z بود (حالت معمول ODM)، مدل را می‌چرخانیم.
    box.setFromObject(gltf.scene);
    box.getSize(size);
    if (size.z < size.y && size.z < size.x) rotIndex = 1;
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

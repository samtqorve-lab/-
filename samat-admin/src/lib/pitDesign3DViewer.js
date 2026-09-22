import { el } from './dom.js';
import {
  buildBenchesGroup, buildRampGroup, buildTerrainMesh, computeOrigin,
} from './pitDesign3D.js';

/**
 * نمایشگر سه‌بعدیِ تمام‌صفحهٔ طراحی پله‌بندی + رمپ/جاده، روی همان TIN واقعی زمینِ طبیعی که برای
 * محاسبات استفاده شده (نه مدل بافت‌دار GLB پهباد — نگاه کنید به توضیح بالای pitDesign3D.js).
 * الگوی UI/چرخهٔ عمر (dynamic import سه‌بعدی، OrbitControls، resize، دکمه‌ها) عمداً هم‌شکلِ
 * model3dViewer.js نگه داشته شده تا تجربهٔ کاربر یکسان بماند.
 * @param {object} surface خروجی buildSurface (pitDesign.js)
 * @param {object} designResult خروجی designBenches
 * @param {object|null} rampResult خروجی designRamp (اختیاری)
 * @param {{title?:string}} [opts]
 * @returns {{close:()=>void}}
 */
export function openPitDesign3DViewer(surface, designResult, rampResult, opts = {}) {
  const { title = 'نمای سه‌بعدی طراحی پله و جاده' } = opts;
  const state = { closed: false, raf: 0, disposers: [] };

  const status = el('div', { style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e8e2d0;font-size:14px;text-align:center;padding:24px;pointer-events:none' }, '⏳ در حال آماده‌سازی صحنه...');
  const stage = el('div', { style: 'position:relative;flex:1;min-height:0;touch-action:none' }, [status]);

  const btnStyle = 'background:#2b2a24;color:#e8e2d0;border:1px solid #3d3b32;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap';
  const mkBtn = (label, onclick) => el('button', { style: btnStyle, onclick }, label);
  const resetBtn = mkBtn('🎯 بازنشانی دید', () => {});
  const closeBtn = mkBtn('✕', () => close());

  const legend = el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#c9c3ae;padding:6px 10px;border-top:1px solid #2b2a24' }, [
    el('span', {}, '🟫 سینهٔ پله'),
    el('span', {}, '🟨 برم'),
    el('span', {}, '⬛ لبهٔ ترازها'),
    el('span', {}, '🟧 برون‌زد به سطح'),
    ...(rampResult ? [el('span', {}, '⬜ جادهٔ دسترسی')] : []),
    el('span', {}, '🟩 زمین طبیعی (TIN واقعی)'),
  ]);

  const overlay = el('div', { style: 'position:fixed;inset:0;z-index:10000;background:#12110e;display:flex;flex-direction:column;direction:rtl;font-family:inherit' }, [
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #2b2a24;flex-wrap:wrap' }, [
      el('div', { style: 'color:#f1ead6;font-weight:700;font-size:13px' }, title),
      el('div', { style: 'display:flex;gap:6px' }, [resetBtn, closeBtn]),
    ]),
    stage,
    legend,
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
    status.style.color = '#f0a08a';
    status.textContent = `❌ ${message}`;
  }

  (async () => {
    let THREE; let OrbitControls;
    try {
      [THREE, { OrbitControls }] = await Promise.all([
        import('three'),
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
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
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

    let group;
    try {
      const origin = computeOrigin(surface);
      group = new THREE.Group();
      group.add(buildTerrainMesh(THREE, surface, origin));
      group.add(buildBenchesGroup(THREE, designResult, origin));
      if (rampResult) group.add(buildRampGroup(THREE, rampResult, origin));
      scene.add(group);
    } catch (err) {
      fail(`ساخت صحنهٔ سه‌بعدی ناموفق بود: ${err.message || err}`);
      return;
    }
    if (state.closed) return;
    state.disposers.push(() => {
      group.traverse((o) => {
        if (o.isMesh || o.isLine || o.isLineLoop) {
          o.geometry.dispose();
          if (o.material) o.material.dispose();
        }
      });
    });

    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);

    const fit = () => {
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const radius = (size.length() / 2) || 1;
      const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.15;
      camera.near = Math.max(0.1, radius / 500);
      camera.far = radius * 200;
      camera.position.set(center.x + dist * 0.6, center.y + dist * 0.55, center.z + dist * 0.6);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = radius / 40;
      controls.maxDistance = radius * 8;
      controls.update();
    };
    resetBtn.onclick = fit;
    fit();
    status.style.display = 'none';

    const tick = () => {
      if (state.closed) return;
      state.raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
    overlay.dataset.ready = '1';
  })();

  return { close };
}

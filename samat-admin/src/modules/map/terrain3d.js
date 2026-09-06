import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { el, showToast, openModal } from '../../lib/dom.js';
import { getMineCorners } from '../../lib/geo.js';
import {
  getMineBBox, checkCopernicusStatus, getCopernicusToken, fetchSentinelImage, SAT_LAYERS,
} from '../../lib/sentinelHub.js';
import { fetchElevationGrid, fetchElevationGridSentinelHub } from '../../lib/terrainDem.js';

// رنگ‌بندی بر اساس ارتفاع نسبی (کم → پرشیب) — یک گرادیان ساده‌ی زمین‌شناسی (سبز کم‌ارتفاع تا
// قهوه‌ای/سفید پرارتفاع). این رنگ‌بندی به‌عنوان بازگشتی (fallback) استفاده می‌شود وقتی بافت
// ماهواره‌ای واقعی در دسترس نیست (Sentinel Hub تنظیم نشده یا دریافت تصویر ناموفق بود) — نگاه کنید
// به fetchSatelliteTexture پایین‌تر برای مسیر اصلی (بافت واقعی).
function elevationColor(t) {
  const stops = [
    [0.00, [0.16, 0.45, 0.28]], // سبز تیره (کم‌ارتفاع)
    [0.35, [0.55, 0.62, 0.30]], // سبز-زرد
    [0.60, [0.62, 0.50, 0.32]], // قهوه‌ای
    [0.85, [0.55, 0.45, 0.40]], // قهوه‌ای روشن/خاکستری
    [1.00, [0.92, 0.92, 0.92]], // سفید (قله)
  ];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i]; const [t1, c1] = stops[i + 1];
  const localT = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return [
    c0[0] + (c1[0] - c0[0]) * localT,
    c0[1] + (c1[1] - c0[1]) * localT,
    c0[2] + (c1[2] - c0[2]) * localT,
  ];
}

// فاصله‌ی واقعی (متر) بین دو نقطه‌ی جغرافیایی — برای ساختن هندسه‌ای با ابعاد افقی/عمودی واقعاً
// متناسب با اندازه‌ی راستین محدوده (نه یک صفحه‌ی مربعِ دلخواه که شکل واقعی معدن را کج می‌کرد).
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * اگر Copernicus (Sentinel Hub) از قبل در پنل «پایش ماهواره‌ای» تنظیم شده باشد (فقط یک‌بار توسط
 * ادمین)، دیگر نیازی به وارد کردن دوباره‌ی Client ID/Secret نیست — سرویس واسط سرور (sentinel-proxy)
 * وقتی clientSecret خالی بفرستیم، خودش مقدار ذخیره‌شده را به‌کار می‌برد (نگاه کنید به action:'token').
 * روی همان bbox دقیقی که برای شبکه‌ی ارتفاع استفاده می‌شود یک تصویر رنگ‌طبیعی می‌گیریم — چون هر دو
 * از یک محدوده‌ی مختصاتی می‌آیند، تراز شدن پیش‌فرض UV صفحه (بدون نیاز به محاسبه‌ی دستی) کافی است.
 */
async function fetchSatelliteTexture(bbox) {
  const status = await checkCopernicusStatus();
  if (!status.configured) return { url: null, reason: 'not-configured' };
  try {
    const token = await getCopernicusToken('', '');
    const today = new Date();
    const dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    const layer = SAT_LAYERS.truecolor;
    const blob = await fetchSentinelImage(token, bbox, dateStr, layer.script, 512, 512, layer.collection, 45);
    return { url: URL.createObjectURL(blob), reason: null };
  } catch (err) {
    return { url: null, reason: err.message };
  }
}

/**
 * مدل سه‌بعدی توپوگرافی محدوده‌ی یک معدن را در یک مودال باز می‌کند. داده‌ی ارتفاعی از کاشی‌های
 * عمومی Terrarium (بدون نیاز به API Key) گرفته می‌شود. اگر Sentinel Hub تنظیم شده باشد، بافت
 * سطح از تصویر ماهواره‌ای واقعی (رنگ طبیعی) ساخته می‌شود؛ در غیر این‌صورت به رنگ‌بندی ارتفاعی
 * (سبز تا سفید) برمی‌گردیم.
 */
export function open3DTerrainModal(record, nameField) {
  const mineName = record[nameField] || '—';
  const corners = getMineCorners(record);
  const bbox = getMineBBox(corners, record._lat, record._lon);
  if (!bbox) { showToast('⚠️ این رکورد مختصات ثبت‌شده ندارد'); return; }

  const { body, overlay } = openModal({ title: `🗻 مدل سه‌بعدی توپوگرافی — ${mineName}`, width: '90vw' });
  const canvasHost = el('div', { style: 'width:100%;height:70vh;border-radius:var(--radius-md);overflow:hidden;background:var(--stone-200);position:relative' });
  const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' }, '⏳ در حال دریافت داده‌ی ارتفاعی و تصویر ماهواره‌ای...');
  const hint = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-500);margin-top:4px' },
    'برای چرخاندن بکشید، برای زوم اسکرول کنید.');
  body.append(canvasHost, statusLine, hint);

  let renderer = null;
  let animId = null;
  let disposed = false;
  let sceneCtx = null; // بعد از buildScene پر می‌شود: { material, texture }
  let elevDone = false;
  let satDone = false;
  let satResult = null;
  let demSource = null; // 'tandem' | 'terrarium'
  let exaggeration = 1; // ۱ = مقیاس واقعی (مثل گوگل‌ارث پیش‌فرض) — کاربر می‌تواند برای دیدن جزئیات بیشتر کند
  let rebuildScene = null; // بعد از اولین buildScene پر می‌شود تا دکمه‌ی اغراق بتواند دوباره بسازد

  const exagButtons = ['1', '2', '3'].map((n) => el('button', {
    class: `btn-sm${n === '1' ? '' : ' btn-ghost'}`,
    onclick: () => {
      exaggeration = Number(n);
      exagButtons.forEach((b, i) => { b.className = `btn-sm${i === Number(n) - 1 ? '' : ' btn-ghost'}`; });
      if (rebuildScene) rebuildScene();
    },
  }, `×${n}`));
  const exagRow = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:8px;font-size:var(--text-xs);color:var(--stone-600)' }, [
    'اغراق ارتفاع (۱× = مقیاس واقعی، مثل گوگل‌ارث):', ...exagButtons,
  ]);
  body.append(exagRow);

  function maybeFinishStatus() {
    if (!elevDone) return;
    const elevLine = demSource === 'tandem'
      ? '🛰️ ارتفاع از Copernicus DEM GLO-30 (ماموریت TanDEM-X، دقت بهتر)'
      : '🗺️ ارتفاع از منبع رایگان عمومی (Terrarium)';
    if (satResult && satResult.url) {
      statusLine.textContent = `✅ ${elevLine} — بافت از تصویر ماهواره‌ای واقعی (Sentinel-2)`;
    } else if (satDone) {
      statusLine.textContent = satResult && satResult.reason === 'not-configured'
        ? `ℹ️ ${elevLine} — برای بافت ماهواره‌ای واقعی هم، Sentinel Hub را در پنل «پایش ماهواره‌ای» تنظیم کنید — فعلاً رنگ‌بندی ارتفاعی نمایش داده می‌شود.`
        : `⚠️ ${elevLine} — دریافت تصویر ماهواره‌ای ناموفق بود؛ رنگ‌بندی ارتفاعی نمایش داده می‌شود.`;
    }
  }

  // ابتدا تلاش می‌کنیم ارتفاع را از Copernicus DEM GLO-30 (دقیق‌تر) از طریق Sentinel Hub بگیریم؛
  // اگر Client ID/Secret تنظیم نشده یا درخواست ناموفق بود، بی‌صدا به منبع رایگان (Terrarium) برمی‌گردیم.
  async function loadElevation() {
    try {
      const status = await checkCopernicusStatus();
      if (status.configured) {
        const token = await getCopernicusToken('', '');
        const result = await fetchElevationGridSentinelHub(token, bbox, 64);
        demSource = 'tandem';
        return result;
      }
    } catch {
      // بی‌صدا به منبع رایگان برمی‌گردیم
    }
    demSource = 'terrarium';
    return fetchElevationGrid(bbox, 64);
  }

  const elevPromise = loadElevation().then(({ grid, gridSize, minElev, maxElev }) => {
    if (disposed) return;
    elevDone = true;
    buildScene(grid, gridSize, minElev, maxElev);
    maybeFinishStatus();
  }).catch((err) => {
    statusLine.textContent = `⚠️ دریافت داده‌ی ارتفاعی ناموفق بود: ${err.message}`;
  });

  fetchSatelliteTexture(bbox).then((result) => {
    if (disposed) return;
    satDone = true;
    satResult = result;
    if (result.url) applySatelliteTexture(result.url);
    maybeFinishStatus();
  });

  function applySatelliteTexture(url) {
    const img = new Image();
    img.onload = () => {
      if (disposed) return;
      const texture = new THREE.Texture(img);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      if (sceneCtx) {
        // صحنه از قبل ساخته شده (شبکه‌ی ارتفاع زودتر رسیده بود) — مستقیم جایگزین بافت رنگی می‌کنیم
        sceneCtx.material.vertexColors = false;
        sceneCtx.material.map = texture;
        sceneCtx.material.color.set(0xffffff); // رنگ پایه سفید تا بافت را تیره نکند
        sceneCtx.material.needsUpdate = true;
        sceneCtx.texture = texture;
      } else {
        // صحنه هنوز ساخته نشده — وقتی buildScene اجرا شود خودش این بافت را برمی‌دارد
        pendingTexture = texture;
      }
      maybeFinishStatus();
    };
    img.src = url;
  }

  let pendingTexture = null;

  function buildScene(grid, gridSize, minElev, maxElev) {
    const width = canvasHost.clientWidth || 800;
    const height = canvasHost.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe7ec);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 20000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    canvasHost.append(renderer.domElement);

    // ابعاد افقی واقعی صحنه (متر) — به‌جای یک صفحه‌ی مربعِ دلخواه، دقیقاً متناسب با شکل و اندازه‌ی
    // واقعی محدوده‌ی معدن (که معمولاً مستطیلی و نامتقارن است، نه مربع).
    const [west, south, east, north] = bbox;
    const midLat = (south + north) / 2;
    const planeWidth = haversineMeters(midLat, west, midLat, east); // شرق-غرب
    const planeHeight = haversineMeters(south, west, north, west); // شمال-جنوب
    const maxPlaneDim = Math.max(planeWidth, planeHeight);
    const elevRange = Math.max(1, maxElev - minElev);

    let terrainMesh = null;
    let boundaryLine = null;
    let geometry = null;

    // چون واحدهای افقی (متر واقعی) و ارتفاع (متر واقعی) این‌جا یکسان‌اند، ضریب ۱× دقیقاً مقیاس
    // واقعی زمین را می‌دهد — همان‌طور که گوگل‌ارث پیش‌فرض نشان می‌دهد؛ کاربر از دکمه‌های ×۱/×۲/×۳
    // می‌تواند برای دیدن جزئیات بهتر در محدوده‌های کم‌شیب، اغراق کند.
    function rebuildTerrainMesh() {
      if (terrainMesh) { scene.remove(terrainMesh); geometry.dispose(); }
      if (boundaryLine) { scene.remove(boundaryLine); boundaryLine.geometry.dispose(); boundaryLine.material.dispose(); }

      const heightScale = exaggeration;
      geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, gridSize - 1, gridSize - 1);
      geometry.rotateX(-Math.PI / 2);
      const posAttr = geometry.attributes.position;
      const colors = new Float32Array(posAttr.count * 3);
      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const idx = row * gridSize + col;
          const elev = grid[idx];
          const y = (elev - minElev) * heightScale;
          posAttr.setY(idx, y);
          const t = (elev - minElev) / elevRange;
          const [r, g, b] = elevationColor(t);
          colors[idx * 3] = r; colors[idx * 3 + 1] = g; colors[idx * 3 + 2] = b;
        }
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeVertexNormals();

      const material = sceneCtx ? sceneCtx.material : new THREE.MeshStandardMaterial({
        vertexColors: !pendingTexture,
        map: pendingTexture || null,
        color: 0xffffff,
        side: THREE.DoubleSide,
        flatShading: false,
      });
      terrainMesh = new THREE.Mesh(geometry, material);
      scene.add(terrainMesh);
      sceneCtx = { material, texture: sceneCtx ? sceneCtx.texture : pendingTexture };

      // ── محدوده‌ی قانونی معدن به‌صورت خط برجسته روی زمین ──
      if (corners.length >= 3) {
        const linePoints = corners.map(([lat, lon]) => {
          const u = (lon - west) / (east - west);
          const v = (lat - south) / (north - south);
          const x = (u - 0.5) * planeWidth;
          const z = (0.5 - v) * planeHeight;
          const gridCol = Math.min(gridSize - 1, Math.max(0, Math.round(u * (gridSize - 1))));
          const gridRow = Math.min(gridSize - 1, Math.max(0, Math.round((1 - v) * (gridSize - 1))));
          const elev = grid[gridRow * gridSize + gridCol];
          const y = (elev - minElev) * heightScale + Math.max(1, maxPlaneDim * 0.005);
          return new THREE.Vector3(x, y, z);
        });
        linePoints.push(linePoints[0]);
        const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xff5722, linewidth: 3 });
        boundaryLine = new THREE.Line(lineGeom, lineMat);
        scene.add(boundaryLine);
      }
    }
    rebuildScene = rebuildTerrainMesh;
    rebuildTerrainMesh();

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(maxPlaneDim * 0.6, maxPlaneDim * 0.9, maxPlaneDim * 0.4);
    scene.add(sun);

    camera.position.set(0, maxPlaneDim * 0.55, maxPlaneDim * 0.7);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    function animate() {
      if (disposed) return;
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function onResize() {
      const w = canvasHost.clientWidth || width;
      const h = canvasHost.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    // پاک‌سازی وقتی مودال بسته می‌شود (چون shell.js تب‌ها را با innerHTML='' پاک می‌کند، بدون
    // این observer، حلقه‌ی رندر و WebGL context بی‌دلیل روشن و نشت‌کننده‌ی حافظه می‌ماند)
    const observer = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        disposed = true;
        if (animId) cancelAnimationFrame(animId);
        window.removeEventListener('resize', onResize);
        controls.dispose();
        renderer.dispose();
        geometry.dispose();
        sceneCtx.material.dispose();
        if (sceneCtx.texture) sceneCtx.texture.dispose();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  }
}

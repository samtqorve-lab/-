import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { el, esc, showToast } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD, DEPT_CAT_COLORS } from '../../lib/sections.js';
import { getMineCorners, ensureNativeLocationPermission } from '../../lib/geo.js';
import { setMine, onChange } from '../../router.js';
import { mountMapToolbar } from './mapTools.js';

let mapInstance = null;

// چون shell.js موقع تعویض تب، محتوای قبلی را با innerHTML='' پاک می‌کند (بدون صدا زدن یک تابع unmount)،
// خودمان با گوش‌دادن به تغییر مسیر، اگر دیگر روی تب نقشه نبودیم، نمونه‌ی Leaflet را آزاد می‌کنیم —
// وگرنه نمونه‌ی قدیمی به یک گره DOM جدا از صفحه (detached) وصل می‌ماند و حافظه نشت می‌کند.
onChange((s) => {
  if (s.tab !== 'dashboard' && mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
});


function createSatelliteLayers() {
  const subdomains = ['0', '1', '2', '3'];
  return {
    hybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains, maxZoom: 21, attribution: 'Imagery © Google',
    }),
    pure: L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      subdomains, maxZoom: 21, attribution: 'Imagery © Google',
    }),
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }),
  };
}

export async function renderMap(container, state) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال بارگذاری نقشه...',
  ]));

  let records;
  try {
    records = applyGeoScope(await fetchDeptRecords(state.department), state.assignedProvince, state.assignedCounty);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری داده: ${err.message}`));
    return;
  }

  container.innerHTML = '';
  const nameField = DEPT_NAME_FIELD[state.department] || 'نام_معدن';
  const catColors = DEPT_CAT_COLORS[state.department] || {};

  const withBoundary = records
    .map((r) => ({ r, corners: getMineCorners(r) }))
    .filter((x) => x.corners.length >= 3);

  if (!withBoundary.length) {
    container.append(el('div', { class: 'empty-state' }, 'هیچ رکوردی مختصات چهارگوش محدوده (طول_A/عرض_A و ...) ثبت‌شده ندارد.'));
    return;
  }

  const mapBox = el('div', { class: 'map-box', style: 'height:65vh;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--stone-200)' });
  const toolsHost = el('div', { class: 'card', style: 'margin-bottom:12px' });
  const printInfo = el('div', { class: 'map-print-only' });
  const printBtn = el('button', {
    class: 'btn-sm map-print-hide', style: 'background:var(--stone-100);color:var(--ink-700);margin-bottom:8px',
    onclick: () => {
      printInfo.innerHTML = '';
      const today = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date());
      printInfo.append(
        el('h2', {}, `نقشه‌ی معادن — بخش ${state.department}`),
        el('div', { style: 'font-size:12px;color:#555;margin-bottom:10px' }, `اداره صنعت، معدن و تجارت قروه — تاریخ چاپ: ${today}`),
      );
      const legend = el('div', { class: 'map-print-legend' });
      Object.entries(catColors).forEach(([label, c]) => {
        legend.append(el('div', { class: 'map-print-legend-item' }, [
          el('span', { class: 'map-print-swatch', style: `background:${c.badge}` }),
          el('span', {}, label),
        ]));
      });
      printInfo.append(legend);
      mapBox.classList.add('map-box--printing');
      setTimeout(() => {
        map.invalidateSize();
        window.print();
        setTimeout(() => mapBox.classList.remove('map-box--printing'), 500);
      }, 50);
    },
  }, '🖨️ چاپ نقشه');
  container.append(printBtn, toolsHost, printInfo, mapBox);

  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const map = L.map(mapBox);
  mapInstance = map;

  const cleanupToolbar = mountMapToolbar(toolsHost, map);
  const unsubscribeToolbar = onChange((s) => {
    if (s.tab !== 'dashboard') { cleanupToolbar(); unsubscribeToolbar(); }
  });

  const layers = createSatelliteLayers();
  layers.hybrid.addTo(map);

  // ── نمایش موقعیت فعلی کاربر روی نقشه (GPS مرورگر/دستگاه) ────────────────────────────
  // از L.control.locate خودمان استفاده نمی‌کنیم (وابستگی اضافه)؛ مستقیم روی Geolocation API
  // مرورگر (navigator.geolocation) که لیفلت هم داخلی همین را صدا می‌زند (map.locate) سوار می‌شویم.
  // watch:true یعنی نقطه با حرکت کاربر (مثلاً روی گوشی، سر معدن) زنده به‌روزرسانی می‌شود.
  // عمداً به‌عنوان یک L.Control واقعی (نه یک دکمه‌ی مطلق‌موقعیت‌یافته‌ی جدا) اضافه می‌شود تا
  // لیفلت خودش آن را زیر دکمه‌ی بزرگ‌نمایی/کوچک‌نمایی بچیند، نه روی دکمه‌ی تعویض لایه‌ها که
  // قبلاً به‌خاطر مختصات ثابت (top:80px) گاهی رویش می‌افتاد.
  let locateWatching = false;
  const locateBtn = el('button', {
    class: 'btn btn-ghost',
    style: 'padding:8px 10px;box-shadow:var(--shadow-md);border-radius:4px',
    title: 'نمایش موقعیت من روی نقشه',
    onclick: async () => {
      if (locateWatching) { map.stopLocate(); locateWatching = false; locateBtn.style.background = ''; return; }
      await ensureNativeLocationPermission(); // در وب/دسکتاپ بی‌اثر است؛ فقط داخل اپ اندروید لازم می‌شود
      map.locate({ watch: true, enableHighAccuracy: true, setView: false });
      locateWatching = true;
      locateBtn.style.background = 'var(--schist-100)';
    },
  }, '📍 موقعیت من');
  const LocateControl = L.Control.extend({
    onAdd: () => {
      L.DomEvent.disableClickPropagation(locateBtn);
      return locateBtn;
    },
  });
  new LocateControl({ position: 'topleft' }).addTo(map);

  L.control.layers({
    '🛰️ ماهواره + عوارض (جاده/نام مکان)': layers.hybrid,
    '🛰️ ماهواره خالص': layers.pure,
    '🗺️ خیابانی': layers.street,
  }, null, { position: 'topleft', collapsed: true }).addTo(map);

  let userMarker = null;
  let userAccuracyCircle = null;
  let firstLocateFix = true;
  map.on('locationfound', (e) => {
    if (userMarker) { userMarker.setLatLng(e.latlng); } else {
      userMarker = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 2, fillColor: '#1e88e5', fillOpacity: 1 }).addTo(map);
    }
    if (userAccuracyCircle) { userAccuracyCircle.setLatLng(e.latlng).setRadius(e.accuracy); } else {
      userAccuracyCircle = L.circle(e.latlng, { radius: e.accuracy, color: '#1e88e5', weight: 1, fillColor: '#1e88e5', fillOpacity: 0.1 }).addTo(map);
    }
    if (firstLocateFix) { map.setView(e.latlng, Math.max(map.getZoom(), 15)); firstLocateFix = false; }
  });
  map.on('locationerror', (e) => {
    showToast(`⚠️ دریافت موقعیت مکانی ممکن نشد: ${e.message}`);
    locateWatching = false;
    locateBtn.style.background = '';
  });
  const unsubscribeLocate = onChange((s) => {
    if (s.tab !== 'dashboard') {
      if (locateWatching) { map.stopLocate(); locateWatching = false; }
      unsubscribeLocate();
    }
  });

  const bounds = [];
  withBoundary.forEach(({ r, corners }) => {
    const cat = catColors[r['دسته']] || catColors['غیره'] || { border: '#6B6250' };
    const name = r[nameField] || '—';
    const popup = el('div', {}, [
      el('b', {}, esc(name)),
      el('br'),
      esc(r['دسته'] || ''),
      el('br'),
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); setMine(r._rowId); } }, 'مشاهده جزئیات'),
    ]);
    const poly = L.polygon(corners, { color: '#fff', weight: 2, fillColor: cat.border, fillOpacity: 0.35 }).addTo(map);
    poly.bindPopup(popup);
    corners.forEach((pt) => bounds.push(pt));
  });

  map.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => map.invalidateSize(), 200);

  const noBoundaryCount = records.length - withBoundary.length;
  if (noBoundaryCount > 0) {
    container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' },
      `${noBoundaryCount} رکورد دیگر مختصات چهارگوش ندارد و روی نقشه نشان داده نشده.`));
  }

  if (state.department === 'معدن') {
    const terrainMineSelect = el('select', {}, withBoundary.map((x, i) => el('option', { value: i }, x.r[nameField] || `#${i}`)));
    const terrainBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:10px' }, '🗻 نمایش مدل سه‌بعدی توپوگرافی');
    terrainBtn.addEventListener('click', async () => {
      const chosen = withBoundary[parseInt(terrainMineSelect.value, 10)];
      if (!chosen) { showToast('⚠️ ابتدا یک معدن انتخاب کنید'); return; }
      terrainBtn.disabled = true; const orig = terrainBtn.textContent; terrainBtn.textContent = '⏳ در حال بارگذاری کتابخانه‌ی سه‌بعدی...';
      try {
        // بارگذاری تنبل (dynamic import): Three.js حجیم است (~۷۰۰ کیلوبایت) و فقط وقتی این دکمه
        // زده می‌شود لازم است — این‌طوری حجم بارگذاری اولیه‌ی داشبورد برای همه‌ی کاربران ثابت می‌ماند.
        const { open3DTerrainModal } = await import('./terrain3d.js');
        open3DTerrainModal(chosen.r, nameField);
      } finally {
        terrainBtn.disabled = false; terrainBtn.textContent = orig;
      }
    });
    container.append(el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('h3', {}, '🗻 مدل سه‌بعدی توپوگرافی'),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
        'داده‌ی ارتفاعی از کاشی‌های عمومی Terrarium گرفته می‌شود (بدون نیاز به تنظیمات یا اعتبارنامه‌ی جدا). رنگ‌بندی بر اساس ارتفاع نسبی است، نه بافت ماهواره‌ای.'),
      el('label', {}, 'معدن'), terrainMineSelect,
      terrainBtn,
    ]));
  }
}

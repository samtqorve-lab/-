import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD, DEPT_CAT_COLORS, DEPT_PLURAL_LABEL } from '../../lib/sections.js';
import {
  getMineCorners, ensureNativeLocationPermission, centroid, openDirectionsTo,
} from '../../lib/geo.js';
import { licenseExpiryInfo } from '../../lib/jalali.js';
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

const SELECT_COLOR = '#0095F6';
const ZWNJ = String.fromCharCode(0x200c);
const normalize = (s) => String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').split(ZWNJ).join(' ').toLowerCase();

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

// لایه‌ی زمین‌شناسی — فقط برای بخش اکتشاف بارگذاری می‌شود (سرویس عمومی/رایگان USGS، شامل
// واحدهای سنگ‌شناسی، گسل‌های اصلی، و محدوده‌های نفت/گاز ایران). توجه: این نقشه در مقیاس
// منطقه‌ای/کلان است (نه دقت محلیِ نقشه‌های ۱:۲۵۰۰۰ سازمان زمین‌شناسی کشور که سرویس زنده‌ی
// رایگانی ندارند) — برای دید کلی زمین‌شناسی محدوده مفید است، نه تصمیم‌گیری اکتشافی دقیق.
function createGeologyLayer() {
  return L.tileLayer('https://certmapper.cr.usgs.gov/server/rest/services/geology/iran/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 11, minZoom: 0, opacity: 0.65,
    attribution: 'Geology: USGS World Energy Project',
  });
}

// آدرس عکس‌ها را (اگر ردیف گزارش چنین فیلدی داشته باشد) به‌صورت عمومی از مقادیر ردیف جمع می‌کند
function collectImageUrls(row) {
  const out = [];
  const visit = (v) => {
    if (out.length >= 4) return;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('http') && /[.](jpe?g|png|webp)([?]|$)/i.test(t)) out.push(t);
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    }
  };
  Object.values(row || {}).forEach(visit);
  return out;
}

async function fetchLastReport(department, name) {
  let res = await sb.from('tech_reports').select('*').eq('department', department).eq('mine_name', name)
    .order('created_at', { ascending: false }).limit(1);
  if (res.error) res = await sb.from('tech_reports').select('*').eq('mine_name', name).limit(1);
  return res.error ? null : ((res.data && res.data[0]) || null);
}

function licenseBadge(license) {
  if (!license) return el('span', { class: 'badge badge-schist' }, 'پروانه: نامشخص');
  if (license.expired) return el('span', { class: 'badge badge-rust' }, `پروانه منقضی (${Math.abs(license.monthsLeft)} ماه پیش)`);
  if (license.monthsLeft <= 3) return el('span', { class: 'badge badge-amber' }, `پروانه: ${license.monthsLeft} ماه مانده`);
  return el('span', { class: 'badge badge-patina' }, `پروانه: ${license.monthsLeft} ماه مانده`);
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
  const department = state.department;
  const nameField = DEPT_NAME_FIELD[department] || 'نام_معدن';
  const catColors = DEPT_CAT_COLORS[department] || {};

  const withBoundary = records
    .map((r) => ({ r, corners: getMineCorners(r) }))
    .filter((x) => x.corners.length >= 3);
  // برخی بخش‌ها (مثل صنعت) به‌جای ۴ گوشه‌ی محدوده، فقط یک مختصات نقطه‌ای (_lat/_lon) دارند —
  // قبلاً نقشه فقط پلی‌گون محدوده را می‌فهمید، پس این رکوردها اصلاً روی نقشه نشان داده نمی‌شدند
  // (و چون بیشتر/همه‌ی رکوردهای صنعت همین‌طورند، کل نقشه برای آن بخش خالی به نظر می‌رسید).
  const withPoint = records.filter((r) => (
    getMineCorners(r).length < 3 && typeof r._lat === 'number' && typeof r._lon === 'number'
  ));

  if (!withBoundary.length && !withPoint.length) {
    container.append(el('div', { class: 'empty-state' }, 'هیچ رکوردی مختصات محدوده یا موقعیت ثبت‌شده ندارد.'));
    return;
  }

  // ── ساختار: نقشه‌ی تمام‌صفحه + پنل‌های شناور روی آن ──
  const mapBox = el('div', { class: 'map-box' });
  const stage = el('div', { class: 'map-stage' }, mapBox);
  const printInfo = el('div', { class: 'map-print-only' });
  container.append(printInfo, stage);

  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const map = L.map(mapBox);
  mapInstance = map;

  // وقتی نوار کناری جمع/باز می‌شود پنجره resize نمی‌شود، پس خودمان به Leaflet خبر می‌دهیم
  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(stage);
  }

  const layers = createSatelliteLayers();
  layers.hybrid.addTo(map);

  // ── نمایش موقعیت فعلی کاربر روی نقشه (GPS مرورگر/دستگاه) ────────────────────────────
  // از L.control.locate خودمان استفاده نمی‌کنیم (وابستگی اضافه)؛ مستقیم روی Geolocation API
  // مرورگر (navigator.geolocation) که لیفلت هم داخلی همین را صدا می‌زند (map.locate) سوار می‌شویم.
  // watch:true یعنی نقطه با حرکت کاربر (مثلاً روی گوشی، سر معدن) زنده به‌روزرسانی می‌شود.
  // عمداً به‌عنوان یک L.Control واقعی (نه یک دکمه‌ی مطلق‌موقعیت‌یافته‌ی جدا) اضافه می‌شود تا
  // لیفلت خودش آن را زیر دکمه‌ی بزرگ‌نمایی/کوچک‌نمایی بچیند، نه روی دکمه‌ی تعویض لایه‌ها.
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
  }, department === 'اکتشاف' ? { '⛏️ زمین‌شناسی (USGS — مقیاس منطقه‌ای)': createGeologyLayer() } : null, { position: 'topleft', collapsed: true }).addTo(map);

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
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
      unsubscribeLocate();
    }
  });

  // ── رکوردها روی نقشه (هر رکورد یک entry: لایه + اطلاعات برای فهرست و کارت) ──
  const entries = [];
  const bounds = [];
  let selected = null;

  function styleFor(entry, isSelected) {
    if (entry.kind === 'poly') {
      return isSelected
        ? { color: SELECT_COLOR, weight: 4, fillColor: entry.color, fillOpacity: 0.5 }
        : { color: '#fff', weight: 2, fillColor: entry.color, fillOpacity: 0.35 };
    }
    return isSelected
      ? { color: SELECT_COLOR, weight: 4, fillColor: entry.color, fillOpacity: 1 }
      : { color: '#fff', weight: 2, fillColor: entry.color, fillOpacity: 1 };
  }

  withBoundary.forEach(({ r, corners }) => {
    const cat = catColors[r['دسته']] || catColors['غیره'] || { border: '#6B6250' };
    const entry = {
      r, name: r[nameField] || '—', cat: r['دسته'] || '', color: cat.border, kind: 'poly', center: centroid(corners),
    };
    entry.layer = L.polygon(corners, styleFor(entry, false)).addTo(map);
    entry.bounds = entry.layer.getBounds();
    entry.layer.on('click', () => select(entry, false));
    entries.push(entry);
    corners.forEach((pt) => bounds.push(pt));
  });
  withPoint.forEach((r) => {
    const cat = catColors[r['دسته']] || catColors['غیره'] || { badge: '#6B6250' };
    const entry = {
      r, name: r[nameField] || '—', cat: r['دسته'] || '', color: cat.badge, kind: 'point', center: [r._lat, r._lon],
    };
    entry.layer = L.circleMarker(entry.center, { radius: 8, ...styleFor(entry, false) }).addTo(map);
    entry.layer.on('click', () => select(entry, false));
    entries.push(entry);
    bounds.push(entry.center);
  });

  map.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => map.invalidateSize(), 200);

  // ── پنل شناور: فهرست رکوردها + جست‌وجو + چاپ ──
  const listRows = el('div', { class: 'map-list-rows' });
  const rowNodes = new Map();
  entries.forEach((entry) => {
    const row = el('button', { class: 'map-row', type: 'button', onclick: () => select(entry, true) }, [
      el('span', { class: 'map-dot', style: `background:${entry.color}` }),
      el('span', { style: 'min-width:0;display:flex;flex-direction:column' }, [
        el('span', { style: 'font-weight:600' }, entry.name),
        entry.cat ? el('span', { class: 'map-row-cat' }, entry.cat) : null,
      ]),
    ]);
    rowNodes.set(entry, row);
    listRows.append(row);
  });

  const searchInput = el('input', { type: 'search', placeholder: '🔎 جست‌وجو در فهرست...', 'aria-label': 'جست‌وجو در فهرست نقشه' });
  searchInput.addEventListener('input', () => {
    const q = normalize(searchInput.value.trim());
    entries.forEach((entry) => {
      rowNodes.get(entry).style.display = !q || normalize(`${entry.name} ${entry.cat}`).includes(q) ? '' : 'none';
    });
  });

  const printBtn = el('button', {
    class: 'top-icon-btn', type: 'button', title: 'چاپ نقشه', 'aria-label': 'چاپ نقشه',
    onclick: () => {
      printInfo.innerHTML = '';
      const today = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date());
      printInfo.append(
        el('h2', {}, `نقشه‌ی معادن — بخش ${department}`),
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
  }, '🖨️');

  const collapseBtn = el('button', { class: 'top-icon-btn', type: 'button', 'aria-label': 'جمع/باز کردن فهرست' }, '▾');
  const noLocationCount = records.length - withBoundary.length - withPoint.length;
  const listPanel = el('div', { class: 'map-float map-list map-print-hide' }, [
    el('div', { class: 'map-list-head' }, [
      el('strong', { style: 'font-size:var(--text-sm)' }, `${DEPT_PLURAL_LABEL[department] || 'معادن'} (${entries.length})`),
      el('div', { style: 'display:flex;gap:2px' }, [printBtn, collapseBtn]),
    ]),
    el('div', { class: 'map-list-body' }, [
      el('div', { class: 'map-list-search' }, searchInput),
      listRows,
      noLocationCount > 0
        ? el('div', { class: 'map-list-foot' }, `${noLocationCount} رکورد دیگر مختصات ندارد و روی نقشه نیست.`)
        : null,
    ]),
  ]);
  collapseBtn.addEventListener('click', () => {
    const c = listPanel.classList.toggle('collapsed');
    collapseBtn.textContent = c ? '▸' : '▾';
  });
  if (window.matchMedia('(max-width: 860px)').matches) { listPanel.classList.add('collapsed'); collapseBtn.textContent = '▸'; }

  // ── پنل شناور: ابزارهای نقشه (پیش‌فرض بسته تا نقشه تمیز بماند) ──
  const toolsHost = el('div', { class: 'map-tools-body' });
  const toolsToggle = el('button', { class: 'map-tools-head', type: 'button' }, '🧰 ابزارهای نقشه ▸');
  const toolsPanel = el('div', { class: 'map-float map-tools map-print-hide collapsed' }, [toolsToggle, toolsHost]);
  toolsToggle.addEventListener('click', () => {
    const c = toolsPanel.classList.toggle('collapsed');
    toolsToggle.textContent = c ? '🧰 ابزارهای نقشه ▸' : '🧰 ابزارهای نقشه ▾';
    setTimeout(() => map.invalidateSize(), 50);
  });
  const cleanupToolbar = mountMapToolbar(toolsHost, map);
  const unsubscribeToolbar = onChange((s) => {
    if (s.tab !== 'dashboard') { cleanupToolbar(); unsubscribeToolbar(); }
  });

  // ── کارت شناور اطلاعات رکورد انتخاب‌شده ──
  const infoBox = el('div', { class: 'map-float map-info map-print-hide', style: 'display:none' });
  let infoToken = 0;

  function clearSelection() {
    if (!selected) return;
    selected.layer.setStyle(styleFor(selected, false));
    rowNodes.get(selected).classList.remove('active');
    selected = null;
  }
  function hideInfo() {
    infoToken += 1;
    infoBox.style.display = 'none';
    clearSelection();
  }

  function showInfo(entry) {
    const token = ++infoToken;
    const { r, name, center } = entry;
    const reportLine = el('div', { class: 'map-info-line' }, '⏳ در حال بررسی آخرین گزارش...');
    const photos = el('div', { class: 'map-info-photos' });
    infoBox.innerHTML = '';
    infoBox.append(
      el('div', { class: 'map-info-head' }, [
        el('div', { style: 'min-width:0' }, [
          el('div', { class: 'map-info-title' }, name),
          entry.cat ? el('div', { class: 'map-info-sub' }, entry.cat) : null,
        ]),
        el('button', { class: 'top-icon-btn', type: 'button', 'aria-label': 'بستن', onclick: hideInfo }, '✕'),
      ]),
      el('div', { class: 'map-info-badges' }, licenseBadge(licenseExpiryInfo(r, department))),
      reportLine,
      photos,
      el('div', { class: 'map-info-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => setMine(r._rowId) }, 'مشاهده جزئیات'),
        el('button', {
          class: 'btn btn-ghost', type: 'button',
          onclick: () => openDirectionsTo(center[0], center[1], name).catch((err) => showToast(`⚠️ ${err.message}`)),
        }, '🧭 مسیریابی'),
      ]),
    );
    infoBox.style.display = 'block';

    fetchLastReport(department, name).then((rep) => {
      if (token !== infoToken) return; // کاربر رکورد دیگری را انتخاب کرده یا کارت را بسته
      if (!rep) { reportLine.textContent = '📤 هنوز گزارش دوره‌ای ثبت نشده'; return; }
      const days = rep.created_at ? Math.floor((Date.now() - new Date(rep.created_at).getTime()) / 86400000) : null;
      const stale = days !== null && days > 45;
      reportLine.textContent = `📤 آخرین گزارش: ${days !== null ? `${days} روز پیش` : 'تاریخ نامشخص'}${rep.period ? ` (${rep.period})` : ''}`;
      if (stale) reportLine.style.color = 'var(--amber-700)';
      collectImageUrls(rep).forEach((url) => {
        photos.append(el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: url, alt: 'عکس گزارش', loading: 'lazy' })));
      });
    }).catch(() => { if (token === infoToken) reportLine.textContent = ''; });
  }

  function select(entry, fly) {
    clearSelection();
    selected = entry;
    entry.layer.setStyle(styleFor(entry, true));
    if (entry.layer.bringToFront) entry.layer.bringToFront();
    const row = rowNodes.get(entry);
    row.classList.add('active');
    row.scrollIntoView({ block: 'nearest' });
    if (fly) {
      if (entry.kind === 'poly') map.fitBounds(entry.bounds, { padding: [70, 70], maxZoom: 17 });
      else map.setView(entry.center, Math.max(map.getZoom(), 15));
    }
    showInfo(entry);
  }

  // کلیک/کشیدن/اسکرول روی پنل‌ها نباید به نقشه‌ی زیرشان برسد
  [listPanel, toolsPanel, infoBox].forEach((node) => {
    L.DomEvent.disableClickPropagation(node);
    L.DomEvent.disableScrollPropagation(node);
  });
  stage.append(listPanel, toolsPanel, infoBox);

  // توجه: باکس «مدل سه‌بعدی توپوگرافی» که قبلاً اینجا زیر نقشه بود، به یک تب/صفحه‌ی جدا
  // منتقل شد (ببینید terrain3dPage.js) — این صفحه فقط خودِ نقشه‌ی معادن را نشان می‌دهد.
}

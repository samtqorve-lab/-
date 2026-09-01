import { el, showToast } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import { getMineCorners } from '../../lib/geo.js';

/**
 * صفحه‌ی مستقل «مدل سه‌بعدی توپوگرافی» — قبلاً این ابزار زیر نقشه‌ی معادن (mapView.js) بود؛
 * حالا یک تب/صفحه‌ی جدا در منوی کناری است تا از نقشه و پایش ماهواره‌ای کاملاً مستقل باشد.
 */
export async function renderTerrain3D(container, state) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال بارگذاری فهرست معادن...',
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

  const withBoundary = records
    .map((r) => ({ r, corners: getMineCorners(r) }))
    .filter((x) => x.corners.length >= 3);

  if (!withBoundary.length) {
    container.append(el('div', { class: 'empty-state' }, 'هیچ رکوردی مختصات چهارگوش محدوده (طول_A/عرض_A و ...) ثبت‌شده ندارد؛ مدل سه‌بعدی نیازمند این مختصات است.'));
    return;
  }

  const terrainMineSelect = el('select', {}, withBoundary.map((x, i) => el('option', { value: i }, x.r[nameField] || `#${i}`)));
  const terrainBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:10px' }, '🗻 نمایش مدل سه‌بعدی توپوگرافی');
  terrainBtn.addEventListener('click', async () => {
    const chosen = withBoundary[parseInt(terrainMineSelect.value, 10)];
    if (!chosen) { showToast('⚠️ ابتدا یک معدن انتخاب کنید'); return; }
    terrainBtn.disabled = true; const orig = terrainBtn.textContent; terrainBtn.textContent = '⏳ در حال بارگذاری کتابخانه‌ی سه‌بعدی...';
    try {
      // بارگذاری تنبل (dynamic import): Three.js حجیم است (~۷۰۰ کیلوبایت) و فقط وقتی این دکمه
      // زده می‌شود لازم است.
      const { open3DTerrainModal } = await import('./terrain3d.js');
      open3DTerrainModal(chosen.r, nameField);
    } finally {
      terrainBtn.disabled = false; terrainBtn.textContent = orig;
    }
  });

  container.append(el('div', { class: 'card' }, [
    el('h3', {}, '🗻 مدل سه‌بعدی توپوگرافی'),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      'داده‌ی ارتفاعی از کاشی‌های عمومی Terrarium گرفته می‌شود (بدون نیاز به تنظیمات یا اعتبارنامه‌ی جدا). رنگ‌بندی بر اساس ارتفاع نسبی است، نه بافت ماهواره‌ای.'),
    el('label', {}, 'معدن'), terrainMineSelect,
    terrainBtn,
  ]));
}

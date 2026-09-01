import { el } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import { getMineCorners } from '../../lib/geo.js';
import { onChange } from '../../router.js';
import { mountSatellitePanel } from './satellitePanel.js';

let currentPanel = null;

// همانند mapView.js: shell.js موقع تعویض تب فقط innerHTML را پاک می‌کند (unmount واقعی صدا زده
// نمی‌شود)، پس خودمان با گوش‌دادن به تغییر مسیر، نمونه‌ی Leaflet داخل پنل پایش ماهواره‌ای را
// وقتی از این تب خارج شدیم آزاد می‌کنیم تا نشتی حافظه پیش نیاید.
onChange((s) => {
  if (s.tab !== 'satelliteMonitor' && currentPanel) {
    currentPanel.destroy();
    currentPanel = null;
  }
});

/**
 * صفحه‌ی مستقل «پایش ماهواره‌ای» — قبلاً این ابزار فقط داخل صفحه‌ی جزئیات هر معدن، با یک کلیک،
 * به‌صورت درون‌خطی باز می‌شد. حالا یک تب/صفحه‌ی جدا در منوی کناری است که فهرست کل معادنِ دارای
 * مختصات محدوده را می‌گیرد و اجازه می‌دهد از همان‌جا هر معدنی را برای پایش انتخاب کنید — کاملاً
 * مستقل از نقشه‌ی معادن (mapView.js) و از مدل سه‌بعدی (terrain3dPage.js).
 */
export async function renderSatelliteMonitor(container, state) {
  if (currentPanel) { currentPanel.destroy(); currentPanel = null; }

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

  const withBoundary = records.filter((r) => getMineCorners(r).length >= 3);

  if (!withBoundary.length) {
    container.append(el('div', { class: 'empty-state' }, 'هیچ رکوردی مختصات چهارگوش محدوده (طول_A/عرض_A و ...) ثبت‌شده ندارد؛ پایش ماهواره‌ای نیازمند این مختصات است.'));
    return;
  }

  const panelHost = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-bottom:8px' }, '🛰️ پایش ماهواره‌ای محدوده‌ی معادن'),
  ]);
  container.append(panelHost);

  currentPanel = mountSatellitePanel(panelHost, { records: withBoundary, nameField });
}

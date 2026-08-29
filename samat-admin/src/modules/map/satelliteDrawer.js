import { el } from '../../lib/dom.js';
import { fetchDeptRecords } from '../../lib/records.js';
import { getMineCorners } from '../../lib/geo.js';
import { mountSatellitePanel } from './satellitePanel.js';
import { renderBoundaryMonitor } from './boundaryMonitor.js';

/**
 * دکمه‌ی شناور ثابت «🛰️» که از هر تب/صفحه‌ای در دسترس است (چون مستقیم به root اضافه می‌شود، نه به
 * ناحیه‌ی content که موقع تعویض تب پاک می‌شود) — با کلیک، یک کشوی کناری باز می‌شود که کاملاً از
 * نقشه‌ی اصلی معادن (mapView.js) جداست: نه رویش سوار می‌شود، نه نمونه‌ی Leaflet مشترک دارد.
 * شامل دو بخش است: ابزار زنده‌ی مشاهده‌ی تصویر ماهواره‌ای + فهرست موارد پایش خودکار ماهانه.
 */
export function mountSatelliteDrawer(root, appCtx) {
  let isOpen = false;
  let panelInstance = null;
  let recordsCache = null;

  const toggleBtn = el('button', { class: 'sat-drawer-toggle', title: 'پایش ماهواره‌ای', onclick: toggleDrawer }, '🛰️');
  const backdrop = el('div', { class: 'sat-drawer-backdrop', onclick: closeDrawer });
  const drawer = el('div', { class: 'sat-drawer' });
  root.append(toggleBtn, backdrop, drawer);

  function toggleDrawer() { if (isOpen) closeDrawer(); else openDrawer(); }

  async function openDrawer() {
    isOpen = true;
    backdrop.classList.add('open');
    drawer.classList.add('open');
    await drawContent();
  }

  function closeDrawer() {
    isOpen = false;
    backdrop.classList.remove('open');
    drawer.classList.remove('open');
    if (panelInstance) { panelInstance.destroy(); panelInstance = null; }
  }

  async function drawContent() {
    drawer.innerHTML = '';
    drawer.append(el('div', { class: 'sat-drawer-header' }, [
      el('h3', { style: 'margin:0' }, '🛰️ پایش ماهواره‌ای'),
      el('button', { class: 'btn-sm', onclick: closeDrawer }, '✕ بستن'),
    ]));
    const body = el('div', { class: 'sat-drawer-body' });
    drawer.append(body);
    body.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری معادن...'));

    if (!recordsCache) {
      try {
        const all = await fetchDeptRecords('معدن');
        recordsCache = all.filter((r) => getMineCorners(r).length >= 3);
      } catch (err) {
        body.innerHTML = '';
        body.append(el('div', {}, `⚠️ خطا در بارگذاری معادن: ${err.message}`));
        return;
      }
    }

    body.innerHTML = '';
    if (!recordsCache.length) {
      body.append(el('div', { style: 'color:var(--stone-600)' }, 'هیچ معدنی با مختصات چهارگوش ثبت‌شده یافت نشد.'));
      return;
    }

    const liveSection = el('div', { class: 'card' });
    body.append(liveSection);
    panelInstance = mountSatellitePanel(liveSection, { records: recordsCache, nameField: 'نام_معدن' });

    body.append(el('h3', { style: 'margin:20px 0 10px' }, '📋 موارد پایش خودکار ماهانه'));
    const reviewSection = el('div');
    body.append(reviewSection);
    renderBoundaryMonitor(reviewSection, {}, appCtx);
  }
}

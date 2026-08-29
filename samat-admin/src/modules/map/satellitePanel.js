import L from 'leaflet';
import { el, showToast, passwordFieldWithToggle } from '../../lib/dom.js';
import {
  checkCopernicusStatus, saveCopernicusCreds, getCopernicusToken, fetchSentinelImage, searchActualDate, getMineBBox, SAT_LAYERS,
} from '../../lib/sentinelHub.js';
import { attachJalaliDatePicker } from '../../lib/jalaliDatePicker.js';
import { parseJalaliString, toGregorian, todayJalali, formatJalali } from '../../lib/jalaliCalendar.js';
import { getMineCorners } from '../../lib/geo.js';

/**
 * پنل پایش ماهواره‌ای — کاملاً مستقل از نقشه‌ی اصلی معادن (mapView.js) است: خودش یک نقشه‌ی کوچک
 * Leaflet جدا می‌سازد (نه روی نقشه‌ی معادن سوار می‌شود، نه با آن نمونه‌ی مشترک دارد) — چون این دو
 * قرار است دو ابزار جدا باشند، نه یک لایه‌ی روی هم.
 *
 * دو حالت دارد: «تک‌تصویر» (یک تاریخ) و «مقایسه‌ی دو تاریخ» (اسلایدر قبل/بعد روی همان محدوده).
 * توجه: حالت مقایسه فقط یک ابزار کمکیِ دیداری برای بازرس است — هشدار خودکار عددیِ درصد تغییر
 * پیاده‌سازی نشده؛ چون بدون تضمین از فرمت دقیق خروجی sentinel-proxy، هر عدد ادعایی می‌توانست
 * گمراه‌کننده باشد — و در ابزار بازرسی رسمی معدن، یک عدد نادرست بدتر از نبودن آن عدد است.
 * (تشخیص خودکار تخلف، جدا و به‌صورت عددی صحیح‌تر، در Edge Function «boundary-monitor» انجام
 * می‌شود — نگاه کنید به boundaryMonitor.js برای بررسی آن نتایج.)
 */
export function mountSatellitePanel(hostContainer, { records, nameField }) {
  let credConfigured = false;
  let currentOverlay = null;
  let compareLayers = null; // {before: L.ImageOverlay, after: L.ImageOverlay}
  let mode = 'single'; // 'single' | 'compare'
  let credsOpen = false; // تب کوچیک تنظیمات اتصال Copernicus — پیش‌فرض بسته

  const mapBox = el('div', { style: 'height:280px;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--stone-200);margin-bottom:10px' });
  const wrap = el('div', {});
  hostContainer.append(mapBox, wrap);

  const map = L.map(mapBox, { attributionControl: false }).setView([35.16, 47.8], 12);
  L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { subdomains: ['0', '1', '2', '3'], maxZoom: 21 }).addTo(map);

  wrap.append(el('div', { class: 'loading-state' }, 'در حال بررسی تنظیمات Copernicus...'));

  checkCopernicusStatus().then((status) => {
    credConfigured = status.configured;
    drawPanel(status);
  });

  function clearMapLayers() {
    if (currentOverlay) { map.removeLayer(currentOverlay); currentOverlay = null; }
    if (compareLayers) { map.removeLayer(compareLayers.before); map.removeLayer(compareLayers.after); compareLayers = null; }
  }

  function drawPanel(status) {
    wrap.innerHTML = '';

    if (status.unreachable) {
      wrap.append(el('div', { style: 'font-size:var(--text-xs);color:var(--rust-600)' },
        'تابع واسط sentinel-proxy در دسترس نیست — مطمئن شوید این Edge Function در Supabase دیپلوی شده است.'));
      return;
    }

    const credsToggle = el('button', {
      class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);width:100%;justify-content:space-between;margin-bottom:8px',
      onclick: () => { credsOpen = !credsOpen; drawPanel(status); },
    }, `🔑 تنظیمات اتصال Copernicus ${credConfigured ? '(تنظیم‌شده) ' : ''}${credsOpen ? '▲' : '▼'}`);
    wrap.append(credsToggle);

    let idInput; let secretInput;
    if (credsOpen) {
      const credsBox = el('div', { style: 'margin-bottom:10px;padding:8px;background:var(--stone-50);border-radius:8px' });
      credsBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
        'این ابزار از سرویس رایگان Copernicus Data Space Ecosystem استفاده می‌کند. Client ID/Secret فقط یک‌بار لازم است وارد شود.'));
      idInput = el('input', { type: 'text', dir: 'ltr', value: status.clientId || '' });
      const secretField = passwordFieldWithToggle({ dir: 'ltr', placeholder: status.configured ? '●●●●●●●● (قبلاً ذخیره شده)' : '••••••••' });
      secretInput = secretField.input;
      const saveBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);margin-top:6px' }, '💾 ذخیره');
      saveBtn.addEventListener('click', async () => {
        if (!idInput.value.trim() || (!secretInput.value.trim() && !credConfigured)) { showToast('⚠️ Client ID/Secret را وارد کنید'); return; }
        saveBtn.disabled = true; saveBtn.textContent = '⏳ در حال ذخیره...';
        try {
          await saveCopernicusCreds(idInput.value.trim(), secretInput.value.trim());
          credConfigured = true;
          showToast('✅ ذخیره شد');
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        } finally {
          saveBtn.disabled = false; saveBtn.textContent = '💾 ذخیره';
        }
      });
      credsBox.append(el('label', {}, 'Client ID'), idInput, el('label', {}, 'Client Secret'), secretField.wrap, saveBtn);
      wrap.append(credsBox);
    } else {
      idInput = el('input', { type: 'hidden', value: status.clientId || '' });
      secretInput = el('input', { type: 'hidden', value: '' });
    }

    const modeSingleBtn = el('button', { class: `btn-sm${mode === 'single' ? '' : ' btn-ghost'}`, style: 'flex:1' }, '🖼️ تک‌تصویر');
    const modeCompareBtn = el('button', { class: `btn-sm${mode === 'compare' ? '' : ' btn-ghost'}`, style: 'flex:1' }, '↔️ مقایسه دو تاریخ');
    modeSingleBtn.addEventListener('click', () => { mode = 'single'; clearMapLayers(); drawPanel(status); });
    modeCompareBtn.addEventListener('click', () => { mode = 'compare'; clearMapLayers(); drawPanel(status); });
    wrap.append(el('div', { style: 'display:flex;gap:6px;margin:8px 0' }, [modeSingleBtn, modeCompareBtn]));

    const mineSelect = el('select', {}, records.map((r, i) => el('option', { value: i }, r[nameField] || `#${i}`)));
    const layerSelect = el('select', {}, Object.entries(SAT_LAYERS).map(([k, v]) => el('option', { value: k }, v.label)));
    wrap.append(el('label', {}, 'معدن'), mineSelect, el('label', {}, 'لایه'), layerSelect);

    if (mode === 'single') mountSingleMode(wrap, { idInput, secretInput, mineSelect, layerSelect, status });
    else mountCompareMode(wrap, { idInput, secretInput, mineSelect, layerSelect, status });

    if (currentOverlay || compareLayers) {
      const clearBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700);margin-top:6px', onclick: () => { clearMapLayers(); drawPanel({ configured: credConfigured, clientId: idInput.value.trim() }); } }, '🗑 حذف لایه از نقشه');
      wrap.append(clearBtn);
    }
  }

  function mountSingleMode(wrap, { idInput, secretInput, mineSelect, layerSelect, status }) {
    const dateInput = el('input', { type: 'text', dir: 'ltr' });
    attachJalaliDatePicker(dateInput);
    const t = todayJalali();
    dateInput.value = formatJalali(t.jy, t.jm, t.jd);
    wrap.append(el('label', {}, 'تاریخ (نزدیک‌ترین تصویر بدون ابر در بازه‌ی ۱۲ تا ۱۵ روز اطراف این تاریخ انتخاب می‌شود)'), dateInput);

    const fetchBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:10px' }, '🛰️ دریافت و نمایش تصویر');
    const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' });
    wrap.append(fetchBtn, statusLine);

    fetchBtn.addEventListener('click', async () => {
      const idVal = idInput.value.trim();
      const secretVal = secretInput.value.trim();
      if (!idVal || (!secretVal && !credConfigured)) { showToast('⚠️ ابتدا Client ID/Secret را وارد و ذخیره کنید'); return; }
      const record = records[parseInt(mineSelect.value, 10)];
      const corners = getMineCorners(record);
      const bbox = getMineBBox(corners, record._lat, record._lon);
      if (!bbox) { showToast('⚠️ این رکورد مختصات ثبت‌شده ندارد'); return; }

      const jalali = parseJalaliString(dateInput.value);
      if (!jalali) { showToast('⚠️ تاریخ را از تقویم انتخاب کنید'); return; }
      const g = toGregorian(jalali.jy, jalali.jm, jalali.jd);
      const dateStr = `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;

      const layer = SAT_LAYERS[layerSelect.value];
      fetchBtn.disabled = true; fetchBtn.textContent = '⏳ در حال احراز هویت...';
      statusLine.textContent = '';
      try {
        const token = await getCopernicusToken(idVal, secretVal);
        credConfigured = true;
        fetchBtn.textContent = '⏳ در حال جست‌وجوی نزدیک‌ترین گذر...';
        const found = await searchActualDate(token, bbox, dateStr, layer.collection, layer.dayWindow);
        if (found) statusLine.textContent = `نزدیک‌ترین تصویر: ${found.actualDate} (${found.daysOff} روز اختلاف، ابرناکی ${found.cloudCover ?? '—'}٪)`;
        fetchBtn.textContent = '⏳ در حال دریافت تصویر...';
        const blob = await fetchSentinelImage(token, bbox, dateStr, layer.script, 512, 512, layer.collection, layer.dayWindow);
        const url = URL.createObjectURL(blob);
        clearMapLayers();
        const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]]; // [[south,west],[north,east]]
        currentOverlay = L.imageOverlay(url, bounds, { opacity: 0.9 }).addTo(map);
        map.fitBounds(bounds, { padding: [20, 20] });
        showToast('✅ تصویر روی نقشه نمایش داده شد');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      } finally {
        fetchBtn.disabled = false; fetchBtn.textContent = '🛰️ دریافت و نمایش تصویر';
      }
    });
  }

  function mountCompareMode(wrap, { idInput, secretInput, mineSelect, layerSelect, status }) {
    wrap.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:6px 0' },
      'دو تصویر روی هم‌دیگر روی نقشه قرار می‌گیرند و با اسلایدر پایین می‌توانید تاریخ «قبل» و «بعد» را دیداری مقایسه کنید — این ابزار کمکی دیداری است، نه محاسبه‌ی خودکار درصد تغییر.'));

    const dateBeforeInput = el('input', { type: 'text', dir: 'ltr' });
    const dateAfterInput = el('input', { type: 'text', dir: 'ltr' });
    attachJalaliDatePicker(dateBeforeInput);
    attachJalaliDatePicker(dateAfterInput);
    const t = todayJalali();
    dateAfterInput.value = formatJalali(t.jy, t.jm, t.jd);
    const oneYearAgo = { jy: t.jy - 1, jm: t.jm, jd: t.jd };
    dateBeforeInput.value = formatJalali(oneYearAgo.jy, oneYearAgo.jm, oneYearAgo.jd);

    wrap.append(
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [
        el('div', {}, [el('label', {}, '📅 تاریخ «قبل»'), dateBeforeInput]),
        el('div', {}, [el('label', {}, '📅 تاریخ «بعد»'), dateAfterInput]),
      ]),
    );

    const fetchBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:10px' }, '🛰️ دریافت و مقایسه');
    const statusLine = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:8px' });
    const sliderBox = el('div', { style: 'display:none;margin-top:10px' });
    const sliderInput = el('input', { type: 'range', min: '0', max: '100', value: '50', style: 'width:100%' });
    const sliderLabels = el('div', { style: 'display:flex;justify-content:space-between;font-size:var(--text-xs);color:var(--stone-600)' }, [
      el('span', {}, '⬅️ بعد'), el('span', {}, 'قبل ➡️'),
    ]);
    sliderBox.append(sliderInput, sliderLabels);
    wrap.append(fetchBtn, statusLine, sliderBox);

    async function fetchOneDate(token, bbox, dateInputEl, layer) {
      const jalali = parseJalaliString(dateInputEl.value);
      if (!jalali) throw new Error('یکی از دو تاریخ از تقویم انتخاب نشده');
      const g = toGregorian(jalali.jy, jalali.jm, jalali.jd);
      const dateStr = `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
      const found = await searchActualDate(token, bbox, dateStr, layer.collection, layer.dayWindow);
      const blob = await fetchSentinelImage(token, bbox, dateStr, layer.script, 512, 512, layer.collection, layer.dayWindow);
      return { blob, actualDate: found ? found.actualDate : dateStr };
    }

    fetchBtn.addEventListener('click', async () => {
      const idVal = idInput.value.trim();
      const secretVal = secretInput.value.trim();
      if (!idVal || (!secretVal && !credConfigured)) { showToast('⚠️ ابتدا Client ID/Secret را وارد و ذخیره کنید'); return; }
      const record = records[parseInt(mineSelect.value, 10)];
      const corners = getMineCorners(record);
      const bbox = getMineBBox(corners, record._lat, record._lon);
      if (!bbox) { showToast('⚠️ این رکورد مختصات ثبت‌شده ندارد'); return; }
      const layer = SAT_LAYERS[layerSelect.value];

      fetchBtn.disabled = true; fetchBtn.textContent = '⏳ در حال احراز هویت...';
      statusLine.textContent = '';
      try {
        const token = await getCopernicusToken(idVal, secretVal);
        credConfigured = true;
        fetchBtn.textContent = '⏳ در حال دریافت تصویر «قبل»...';
        const before = await fetchOneDate(token, bbox, dateBeforeInput, layer);
        fetchBtn.textContent = '⏳ در حال دریافت تصویر «بعد»...';
        const after = await fetchOneDate(token, bbox, dateAfterInput, layer);

        clearMapLayers();
        const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
        const beforeLayer = L.imageOverlay(URL.createObjectURL(before.blob), bounds, { opacity: 1 }).addTo(map);
        const afterLayer = L.imageOverlay(URL.createObjectURL(after.blob), bounds, { opacity: 1 }).addTo(map);
        compareLayers = { before: beforeLayer, after: afterLayer };
        map.fitBounds(bounds, { padding: [20, 20] });

        function applyClip(percent) {
          const afterEl = afterLayer.getElement();
          if (afterEl) afterEl.style.clipPath = `inset(0 0 0 ${percent}%)`;
        }
        sliderInput.value = '50';
        applyClip(50);
        sliderInput.oninput = () => applyClip(sliderInput.value);
        sliderBox.style.display = 'block';

        statusLine.textContent = `قبل: ${before.actualDate} — بعد: ${after.actualDate}. اسلایدر را بکشید تا دو تصویر را مقایسه کنید.`;
        showToast('✅ هر دو تصویر روی نقشه نمایش داده شد');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      } finally {
        fetchBtn.disabled = false; fetchBtn.textContent = '🛰️ دریافت و مقایسه';
      }
    });
  }

  /** برای صدا زدن از بیرون (drawer) موقع بسته‌شدن، تا نمونه‌ی Leaflet جدا از DOM آزاد شود */
  return { destroy: () => map.remove() };
}

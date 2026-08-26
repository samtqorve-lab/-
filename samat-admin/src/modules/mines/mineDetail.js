import { el, esc, showToast, openModal } from '../../lib/dom.js';
import { fetchDeptRecords, updateDeptRecord } from '../../lib/records.js';
import { DEPT_SECTIONS, DEPT_CAT_COLORS, DEPT_NAME_FIELD } from '../../lib/sections.js';
import { fetchCustomFields, saveCustomFields, supportsCustomFields } from '../../lib/customFields.js';
import { attachJalaliDatePicker } from '../../lib/jalaliDatePicker.js';
import { getMineCorners } from '../../lib/geo.js';
import { openCornersEditModal } from './cornersEditModal.js';
import { openVolumeModal, openVolumeHistoryModal } from './volumeModal.js';
import { setTab } from '../../router.js';
import { sb } from '../../lib/supabase.js';

const PHONE_KEY_RE = /تلفن|موبایل|شماره_تماس/;
const DATE_KEY_RE = /تاریخ/;

function fieldValueView(key, value) {
  if (!value) return null;
  if (PHONE_KEY_RE.test(key)) {
    const digits = String(value).match(/0?9\d{9}|0\d{10}|\d{7,11}/);
    if (digits) {
      const a = el('a', { href: `tel:${digits[0]}`, style: 'color:inherit;text-decoration:underline' }, `📞 ${value}`);
      return a;
    }
  }
  return document.createTextNode(String(value));
}

export async function renderMineDetail(container, state, ctx) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال بارگذاری...',
  ]));

  let list;
  try {
    list = await fetchDeptRecords(state.department);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${err.message}`));
    return;
  }

  const record = list.find((r) => r._rowId === state.mineId);
  container.innerHTML = '';

  if (!record) {
    container.append(el('div', { class: 'empty-state' }, 'این رکورد یافت نشد — شاید حذف شده باشد.'));
    container.append(el('button', { class: 'btn btn-ghost', style: 'margin-top:12px', onclick: () => setTab('mines') }, '← بازگشت به فهرست'));
    return;
  }

  const sections = DEPT_SECTIONS[state.department] || [];
  const catColors = DEPT_CAT_COLORS[state.department] || {};
  const nameField = DEPT_NAME_FIELD[state.department] || 'نام_معدن';
  const isAdminRole = ctx && ['admin', 'superadmin'].includes(ctx.myRole);

  let customFields = {};
  let customFieldsRowId = null;
  if (supportsCustomFields(state.department)) {
    try {
      const cf = await fetchCustomFields(state.department);
      customFields = cf.fields;
      customFieldsRowId = cf.rowId;
    } catch { /* نبود فیلدهای اختصاصی نباید مانع نمایش بقیه‌ی فرم شود */ }
  }

  let editMode = false;
  const wrap = el('div', {});
  container.append(wrap);

  function draw() {
    wrap.innerHTML = '';
    const cat = catColors[record['دسته']] || catColors['غیره'] || { bg: '#F1EEE6', badge: '#6B6250', border: '#6B6250' };

    const backBtn = el('button', { class: 'btn btn-ghost', onclick: () => setTab('mines') }, '← بازگشت به فهرست');
    const editBtn = el('button', {
      class: editMode ? 'btn btn-primary' : 'btn btn-ghost',
      onclick: async () => {
        if (editMode) {
          await save();
        } else {
          editMode = true;
          draw();
        }
      },
    }, editMode ? '💾 ذخیره' : '✏️ ویرایش');

    const header = el('div', { class: 'card', style: 'margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px' }, [
      el('div', {}, [
        el('div', { style: `display:inline-block;font-size:var(--text-xs);font-weight:700;color:${cat.badge};background:${cat.bg};padding:3px 10px;border-radius:999px;margin-bottom:8px` }, record['دسته'] || 'بدون دسته'),
        el('h2', { style: 'font-size:var(--text-xl)' }, record[nameField] || '—'),
      ]),
      el('div', { style: 'display:flex;gap:8px' }, [backBtn, editBtn]),
    ]);
    wrap.append(header);

    sections.forEach((sec) => {
      const fieldsGrid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px' });
      let anyVisible = false;

      sec.keys.forEach(([key, label]) => {
        const value = record[key] || '';
        if (editMode) {
          anyVisible = true;
          if (key === 'دسته') {
            const select = el('select', { 'data-key': key }, [
              el('option', { value: '' }, '— انتخاب نشده —'),
              ...Object.keys(catColors).map((c) => el('option', { value: c }, c)),
            ]);
            select.value = value;
            fieldsGrid.append(el('div', {}, [el('label', {}, label), select]));
            return;
          }
          const input = el('input', {
            type: 'text',
            'data-key': key,
            value,
            placeholder: DATE_KEY_RE.test(key) ? 'مثلاً 1403/06/15 (شمسی)' : '',
            autocomplete: 'off',
          });
          if (DATE_KEY_RE.test(key)) attachJalaliDatePicker(input);
          fieldsGrid.append(el('div', {}, [el('label', {}, label), input]));
        } else {
          const displayNode = fieldValueView(key, value);
          if (!displayNode) return;
          anyVisible = true;
          fieldsGrid.append(el('div', {}, [
            el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, label),
            el('div', { style: 'margin-top:2px' }, displayNode),
          ]));
        }
      });

      if (!anyVisible) return;
      wrap.append(el('div', { class: 'card', style: 'margin-bottom:16px' }, [
        el('h3', { style: `color:${cat.badge};font-size:var(--text-sm);margin-bottom:12px` }, sec.title),
        fieldsGrid,
      ]));
    });

    // ── فیلدهای اختصاصی (تعریف‌شده توسط ادمین، مخصوص این بخش) ──
    if (Object.keys(customFields).length || (editMode && isAdminRole)) {
      const cfGrid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px' });
      let anyCfVisible = false;
      Object.entries(customFields).forEach(([key, label]) => {
        const value = record[key] || '';
        if (editMode) {
          anyCfVisible = true;
          cfGrid.append(el('div', {}, [el('label', {}, label), el('input', { type: 'text', 'data-key': key, value })]));
        } else if (value) {
          anyCfVisible = true;
          cfGrid.append(el('div', {}, [
            el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, label),
            el('div', { style: 'margin-top:2px' }, String(value)),
          ]));
        }
      });
      if (anyCfVisible || (editMode && isAdminRole)) {
        const addFieldBtn = (editMode && isAdminRole)
          ? el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);margin-top:8px', onclick: () => promptAddCustomField() }, '➕ افزودن فیلد جدید')
          : null;
        wrap.append(el('div', { class: 'card', style: 'margin-bottom:16px' }, [
          el('h3', { style: 'font-size:var(--text-sm);margin-bottom:12px' }, '📎 فیلدهای اختصاصی'),
          cfGrid,
          addFieldBtn,
        ]));
      }
    }

    // ── مختصات چهارگوش محدوده ──
    const corners = getMineCorners(record);
    const cornersCard = el('div', { class: 'card', style: 'margin-bottom:16px' }, [
      el('h3', { style: 'font-size:var(--text-sm);margin-bottom:8px' }, '📍 مختصات چهارگوش محدوده'),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
        corners.length ? `${corners.length} گوشه ثبت شده` : 'هنوز مختصاتی برای این رکورد ثبت نشده'),
    ]);
    if (isAdminRole) {
      cornersCard.append(el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)', onclick: () => openCornersEditModal(record, state.department, nameField, draw) }, '✏️ ویرایش مختصات'));
    }
    wrap.append(cornersCard);

    // ── محاسبه‌ی حجم کات/فیل ──
    if (state.department === 'معدن') {
      const volCount = Array.isArray(record['محاسبات_احجام']) ? record['محاسبات_احجام'].length : 0;
      const volCard = el('div', { class: 'card', style: 'margin-bottom:16px' }, [
        el('h3', { style: 'font-size:var(--text-sm);margin-bottom:8px' }, '📐 محاسبه‌ی حجم (کات/فیل)'),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
          volCount ? `${volCount} محاسبه ثبت شده` : 'هنوز محاسبه‌ای ثبت نشده'),
        el('div', { style: 'display:flex;gap:8px' }, [
          isAdminRole ? el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)', onclick: () => openVolumeModal(record, state.department, nameField, draw) }, '📐 محاسبه‌ی جدید') : null,
          volCount ? el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => openVolumeHistoryModal(record, nameField) }, '🗂 تاریخچه') : null,
        ]),
      ]);
      wrap.append(volCard);
    }

    // ── مدل سه‌بعدی + پایش ماهواره‌ای ──
    // این دو قبلاً فقط داخل تب «نقشه» بودند؛ چون Leaflet/Three.js سنگین‌اند، اینجا هم فقط با
    // کلیک کاربر (نه به‌صورت eager) لود می‌شوند — همان انگیزه‌ای که باعث lazy-load شدن خود تب‌ها
    // شده (README پاس سوم)، تا صرفاً باز کردن پروفایل یک معدن این دو کتابخانه را دانلود نکند.
    if (corners.length >= 3) {
      const geoCard = el('div', { class: 'card', style: 'margin-bottom:16px' }, [
        el('h3', { style: 'font-size:var(--text-sm);margin-bottom:8px' }, '🛰️ نقشه، مدل سه‌بعدی و پایش ماهواره‌ای'),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
          el('button', {
            class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)',
            onclick: async (ev) => {
              const btn = ev.currentTarget;
              btn.disabled = true; const orig = btn.textContent; btn.textContent = '⏳ در حال بارگذاری...';
              try {
                const { open3DTerrainModal } = await import('../map/terrain3d.js');
                open3DTerrainModal(record, nameField);
              } catch (err) {
                showToast(`⚠️ خطا در بارگذاری مدل سه‌بعدی: ${err.message}`);
              } finally {
                btn.disabled = false; btn.textContent = orig;
              }
            },
          }, '🧊 نمایش مدل سه‌بعدی'),
          el('button', {
            class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)',
            onclick: async (ev) => {
              const btn = ev.currentTarget;
              btn.disabled = true; const orig = btn.textContent; btn.textContent = '⏳ در حال بارگذاری نقشه...';
              try {
                await mountMineGeoPanel(geoCard, record, nameField, corners);
                btn.remove();
              } catch (err) {
                showToast(`⚠️ خطا در بارگذاری نقشه: ${err.message}`);
                btn.disabled = false; btn.textContent = orig;
              }
            },
          }, '🗺️ نمایش نقشه و پایش ماهواره‌ای'),
        ]),
      ]);
      wrap.append(geoCard);
    }

  }

  /** نقشه‌ی کوچک محدود به همین معدن + پنل پایش ماهواره‌ای زیرش را داخل کارت می‌سازد (فقط با تقاضا) */
  async function mountMineGeoPanel(cardEl, record, nameField, corners) {
    const [{ default: L }] = await Promise.all([
      import('leaflet'),
      import('leaflet/dist/leaflet.css'),
    ]);
    const mapDiv = el('div', { style: 'height:360px;border-radius:8px;overflow:hidden;margin-top:10px' });
    cardEl.append(mapDiv);
    const map = L.map(mapDiv);
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery © Google',
    }).addTo(map);
    const polygon = L.polygon(corners, { color: 'var(--ochre-500)', weight: 2, fillOpacity: 0.08 }).addTo(map);
    map.fitBounds(polygon.getBounds(), { padding: [20, 20] });

    const panelHost = el('div', {});
    cardEl.append(panelHost);
    const { mountSatellitePanel } = await import('../map/satellitePanel.js');
    mountSatellitePanel(panelHost, { map, records: [record], nameField });
  }

  async function promptAddCustomField() {
    const { body, close } = openModal({ title: '➕ افزودن فیلد اختصاصی جدید', width: '360px' });
    const labelInput = el('input', { type: 'text', placeholder: 'مثلاً «کد پیگیری استانداری»' });
    const valueInput = el('input', { type: 'text' });
    body.append(
      el('div', {}, [el('label', {}, 'نام فیلد'), labelInput]),
      el('div', {}, [el('label', {}, 'مقدار اولیه برای همین رکورد (اختیاری)'), valueInput]),
    );
    const saveBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:14px' }, '💾 افزودن');
    saveBtn.addEventListener('click', async () => {
      const label = labelInput.value.trim();
      if (!label) { showToast('⚠️ نام فیلد را وارد کنید'); return; }
      const key = `f_${Date.now()}`;
      try {
        const { data: { user } } = await sb.auth.getUser();
        customFields[key] = label;
        customFieldsRowId = await saveCustomFields(state.department, customFields, customFieldsRowId, user ? user.email : '');
        const updated = { ...record, [key]: valueInput.value.trim() };
        delete updated._rowId;
        await updateDeptRecord(state.department, record._rowId, updated);
        Object.assign(record, updated);
        showToast('✅ فیلد اضافه شد');
        close();
        draw();
      } catch (err) {
        showToast(`⚠️ خطا: ${err.message}`);
      }
    });
    body.append(saveBtn);
  }

  async function save() {
    const updated = { ...record };
    wrap.querySelectorAll('[data-key]').forEach((f) => { updated[f.dataset.key] = f.value; });
    delete updated._rowId;
    try {
      await updateDeptRecord(state.department, record._rowId, updated);
      Object.assign(record, updated);
      showToast('✅ ذخیره شد');
      editMode = false;
      draw();
    } catch (err) {
      showToast(`⚠️ خطا در ذخیره: ${err.message}`);
    }
  }

  draw();
}

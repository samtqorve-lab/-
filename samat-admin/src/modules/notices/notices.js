import { el, showToast, fmtDate } from '../../lib/dom.js';
import { fetchDeptRecords, applyGeoScope } from '../../lib/records.js';
import { DEPT_NAME_FIELD } from '../../lib/sections.js';
import { fetchNotices, createNotice, updateNotice, deleteNotice } from '../../lib/notices.js';

export async function renderNotices(container, state) {
  container.innerHTML = '';
  container.append(el('div', { class: 'loading-state' }, [el('div', { class: 'spinner' }), 'در حال بارگذاری اطلاعیه‌ها...']));

  let notices; let mineNames;
  try {
    const nameField = DEPT_NAME_FIELD[state.department];
    const mines = applyGeoScope(await fetchDeptRecords(state.department), state.assignedProvince, state.assignedCounty);
    mineNames = mines.map((m) => m[nameField]).filter(Boolean).sort();
    notices = await fetchNotices(state.department);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${err.message}`));
    return;
  }

  container.innerHTML = '';
  container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:14px' },
    'اطلاعیه‌های این بخش، داخل اپ «ثبت گزارش میدانی» برای بهره‌برداران و مسئولین فنی/ایمنی/بهداشت هر معدن نمایش داده می‌شود.'));

  // ── فرم افزودن اطلاعیه‌ی جدید ──
  const titleInput = el('input', { type: 'text', placeholder: 'عنوان اطلاعیه...' });
  const bodyInput = el('textarea', { rows: '3', placeholder: 'متن اطلاعیه...' });
  const mineSelect = el('select', {}, [
    el('option', { value: '' }, '📢 عمومی — همه‌ی معادن این بخش'),
    ...mineNames.map((n) => el('option', { value: n }, n)),
  ]);
  const addBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:8px' }, '➕ انتشار اطلاعیه');
  addBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    if (!title || !body) { showToast('⚠️ عنوان و متن اطلاعیه را وارد کنید'); return; }
    addBtn.disabled = true;
    try {
      await createNotice(state.department, title, body, mineSelect.value);
      titleInput.value = ''; bodyInput.value = ''; mineSelect.value = '';
      showToast('✅ اطلاعیه منتشر شد');
      renderNotices(container, state);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    } finally {
      addBtn.disabled = false;
    }
  });

  container.append(el('div', { class: 'card', style: 'margin-bottom:18px' }, [
    el('h3', { style: 'font-size:var(--text-sm);margin-bottom:10px' }, '📢 اطلاعیه‌ی جدید'),
    el('label', {}, 'عنوان'), titleInput,
    el('label', { style: 'margin-top:6px' }, 'متن'), bodyInput,
    el('label', { style: 'margin-top:6px' }, 'مخاطب'), mineSelect,
    addBtn,
  ]));

  // ── فهرست اطلاعیه‌های موجود ──
  const listBox = el('div');
  container.append(listBox);
  if (!notices.length) {
    listBox.append(el('div', { class: 'empty-state' }, 'هنوز اطلاعیه‌ای منتشر نشده'));
    return;
  }
  notices.forEach((n) => {
    const activeCb = el('input', { type: 'checkbox', style: 'width:auto' });
    activeCb.checked = n.active;
    activeCb.addEventListener('change', async () => {
      try { await updateNotice(n.id, { active: activeCb.checked }); showToast(activeCb.checked ? '✅ فعال شد' : '⏸ غیرفعال شد'); } catch (err) { showToast(`⚠️ ${err.message}`); }
    });
    const delBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)' }, '🗑 حذف');
    delBtn.addEventListener('click', async () => {
      if (!confirm('این اطلاعیه برای همیشه حذف شود؟')) return;
      try { await deleteNotice(n.id); showToast('✅ حذف شد'); renderNotices(container, state); } catch (err) { showToast(`⚠️ ${err.message}`); }
    });
    listBox.append(el('div', { class: 'card', style: `margin-bottom:10px;opacity:${n.active ? 1 : 0.55}` }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:8px' }, [
        el('div', {}, [
          el('div', { style: 'font-weight:700;font-size:var(--text-sm)' }, n.title),
          el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:2px' },
            `${n.mine_name || '📢 عمومی'} · ${fmtDate(n.created_at)}`),
        ]),
        el('div', { style: 'display:flex;align-items:center;gap:8px;flex-shrink:0' }, [
          el('label', { style: 'display:flex;align-items:center;gap:4px;font-size:11px' }, [activeCb, 'فعال']),
          delBtn,
        ]),
      ]),
      el('div', { style: 'font-size:var(--text-sm);margin-top:8px;white-space:pre-wrap' }, n.body),
    ]));
  });
}

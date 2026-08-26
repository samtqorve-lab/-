import { el, showToast, openModal } from '../../lib/dom.js';
import {
  OFFICER_ROLE_TABS, fetchChecklistItems, addChecklistItem, updateChecklistItem, deleteChecklistItem, moveChecklistItem,
} from '../../lib/checklistItems.js';

export function openChecklistItemsModal(department) {
  const { body, close } = openModal({ title: '⚙️ مدیریت آیتم‌های چک‌لیست', width: '480px' });
  body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
    'این آیتم‌ها همان‌هایی هستند که هر نقش موقع پرکردن چک‌لیست نوبت‌کاری‌اش می‌بیند. تغییرات بلافاصله برای همه اعمال می‌شود.'));

  let activeRole = 'tech_officer';
  const tabsBox = el('div', { style: 'display:flex;gap:6px;margin-bottom:10px' });
  OFFICER_ROLE_TABS.forEach((t) => {
    const btn = el('button', {
      class: 'btn-sm',
      style: `background:${t.role === activeRole ? t.color : 'var(--stone-100)'};color:${t.role === activeRole ? '#fff' : t.color}`,
      onclick: () => { activeRole = t.role; drawTabs(); load(); },
    }, t.label);
    btn.dataset.role = t.role;
    tabsBox.append(btn);
  });
  body.append(tabsBox);

  function drawTabs() {
    tabsBox.querySelectorAll('button').forEach((b) => {
      const t = OFFICER_ROLE_TABS.find((x) => x.role === b.dataset.role);
      const isActive = b.dataset.role === activeRole;
      b.style.background = isActive ? t.color : 'var(--stone-100)';
      b.style.color = isActive ? '#fff' : t.color;
    });
  }

  const newTextInput = el('input', { type: 'text', placeholder: 'متن آیتم جدید...' });
  const newPhotoCb = el('input', { type: 'checkbox', style: 'width:auto' });
  const addBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)' }, '➕ افزودن');
  body.append(el('div', { style: 'display:flex;gap:6px' }, [newTextInput, addBtn]));
  body.append(el('label', { style: 'display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--fluorite-700);margin:6px 0 10px' },
    [newPhotoCb, 'این آیتم نیاز به عکس (با موقعیت مکانی و توضیح در واترمارک) دارد']));

  const listBox = el('div');
  body.append(listBox);

  let cache = [];
  async function load() {
    listBox.innerHTML = '';
    listBox.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری...'));
    try {
      cache = await fetchChecklistItems(department, activeRole);
      draw();
    } catch (err) {
      listBox.innerHTML = '';
      listBox.append(el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, `خطا: ${err.message}`));
    }
  }

  function draw() {
    listBox.innerHTML = '';
    if (!cache.length) {
      listBox.append(el('div', { style: 'color:var(--stone-600);font-size:var(--text-xs);text-align:center;padding:12px' }, 'هنوز آیتمی ثبت نشده'));
      return;
    }
    cache.forEach((it, idx) => {
      const upBtn = el('button', { class: 'btn-sm', style: 'padding:1px 6px;font-size:10px' }, '▲');
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', async () => { await moveChecklistItem(cache, it.id, -1); load(); });

      const downBtn = el('button', { class: 'btn-sm', style: 'padding:1px 6px;font-size:10px' }, '▼');
      downBtn.disabled = idx === cache.length - 1;
      downBtn.addEventListener('click', async () => { await moveChecklistItem(cache, it.id, 1); load(); });

      const textInput = el('input', { type: 'text', value: it.item_text, style: 'flex:1;min-width:160px;font-size:12.5px;padding:6px 8px' });
      textInput.addEventListener('change', async () => {
        const val = textInput.value.trim();
        if (!val) { showToast('⚠️ متن نمی‌تواند خالی باشد'); load(); return; }
        try { await updateChecklistItem(it.id, { item_text: val }); showToast('✅ ذخیره شد'); } catch (err) { showToast(`⚠️ ${err.message}`); }
      });

      const photoCb = el('input', { type: 'checkbox', style: 'width:auto' });
      photoCb.checked = !!it.requires_photo;
      photoCb.addEventListener('change', async () => {
        try { await updateChecklistItem(it.id, { requires_photo: photoCb.checked }); } catch (err) { showToast(`⚠️ ${err.message}`); }
      });

      const activeCb = el('input', { type: 'checkbox', style: 'width:auto' });
      activeCb.checked = !!it.active;
      activeCb.addEventListener('change', async () => {
        try { await updateChecklistItem(it.id, { active: activeCb.checked }); } catch (err) { showToast(`⚠️ ${err.message}`); }
      });

      const delBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700);font-size:10px' }, '🗑');
      delBtn.addEventListener('click', async () => {
        if (!confirm('این آیتم برای همیشه حذف شود؟ (اگر فقط نمی‌خواهید موقتاً نشان داده شود، به‌جای حذف، «فعال» را خاموش کنید)')) return;
        try { await deleteChecklistItem(it.id); showToast('✅ حذف شد'); load(); } catch (err) { showToast(`⚠️ ${err.message}`); }
      });

      listBox.append(el('div', { style: 'display:flex;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid var(--stone-200);flex-wrap:wrap' }, [
        el('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [upBtn, downBtn]),
        textInput,
        el('label', { style: 'display:flex;align-items:center;gap:3px;font-size:10.5px;color:var(--fluorite-700);white-space:nowrap' }, [photoCb, '📷 نیاز به عکس']),
        el('label', { style: `display:flex;align-items:center;gap:3px;font-size:11px;color:${it.active ? 'var(--patina-700)' : 'var(--stone-600)'};white-space:nowrap` }, [activeCb, 'فعال']),
        delBtn,
      ]));
    });
  }

  addBtn.addEventListener('click', async () => {
    const text = newTextInput.value.trim();
    if (!text) { showToast('⚠️ متن آیتم را وارد کنید'); return; }
    try {
      await addChecklistItem(department, activeRole, text, newPhotoCb.checked, cache);
      newTextInput.value = '';
      newPhotoCb.checked = false;
      showToast('✅ آیتم اضافه شد');
      load();
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  load();
  return { close };
}

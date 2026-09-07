import {
  el, esc, showToast, openModal,
} from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { attachJalaliDatePicker } from '../../lib/jalaliDatePicker.js';

/**
 * قبلاً بخش اکتشاف فقط اطلاعات اداری پروانه را ثبت می‌کرد (شماره پروانه، مساحت، ماده هدف، درصد
 * پیشرفت) — هیچ داده‌ی فنی/علمی واقعی (گمانه‌زنی، لیتولوژی، نتیجه‌ی آزمایش نمونه) نگه‌داری
 * نمی‌شد. این ماژول یک دفترچه‌ی ساده‌ی گمانه‌ها برای هر محدوده‌ی اکتشافی اضافه می‌کند.
 */
export function openExplorationLogModal(record, rowId) {
  const mineName = record['نام_متقاضی'] || record['نام_معدن'] || '—';
  const { body } = openModal({ title: `⛏️ دفترچه‌ی گمانه‌زنی — ${mineName}`, width: '640px' });

  const listBox = el('div', { style: 'margin-bottom:16px' });
  body.append(listBox);

  async function loadAndRender() {
    listBox.innerHTML = '';
    listBox.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری...'));
    const { data, error } = await sb.from('exploration_boreholes')
      .select('*').eq('exploration_record_id', rowId).order('drill_date', { ascending: false });
    listBox.innerHTML = '';
    if (error) { listBox.append(el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs)' }, `خطا: ${error.message}`)); return; }
    if (!data || !data.length) { listBox.append(el('div', { class: 'empty-state' }, 'هنوز گمانه‌ای ثبت نشده')); return; }
    data.forEach((b) => {
      listBox.append(el('div', { class: 'card', style: 'margin-bottom:8px;padding:10px' }, [
        el('div', { style: 'display:flex;justify-content:space-between;font-weight:700' }, [
          el('span', {}, `🕳️ گمانه ${esc(b.borehole_no || '—')}`),
          el('span', { style: 'font-weight:400;color:var(--stone-600);font-size:var(--text-xs)' }, b.drill_date || ''),
        ]),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:4px' }, [
          b.depth_m ? `عمق: ${esc(b.depth_m)} متر` : '',
          b.lat && b.lon ? ` — مختصات: ${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}` : '',
        ].join('')),
        b.lithology ? el('div', { style: 'margin-top:6px;font-size:var(--text-xs)' }, [el('b', {}, 'لیتولوژی: '), esc(b.lithology)]) : null,
        b.sample_results ? el('div', { style: 'margin-top:4px;font-size:var(--text-xs)' }, [el('b', {}, 'نتیجه آزمایش نمونه: '), esc(b.sample_results)]) : null,
        b.notes ? el('div', { style: 'margin-top:4px;font-size:var(--text-xs);color:var(--stone-600)' }, esc(b.notes)) : null,
        el('button', {
          class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700);margin-top:8px',
          onclick: async () => {
            if (!window.confirm('این گمانه حذف شود؟')) return;
            await sb.from('exploration_boreholes').delete().eq('id', b.id);
            loadAndRender();
          },
        }, '🗑 حذف'),
      ].filter(Boolean)));
    });
  }

  const noInput = el('input', { placeholder: 'مثلاً BH-01' });
  const dateInput = el('input', { placeholder: 'تاریخ حفاری' });
  attachJalaliDatePicker(dateInput);
  const depthInput = el('input', { type: 'number', placeholder: 'عمق (متر)' });
  const latInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'عرض جغرافیایی' });
  const lonInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'طول جغرافیایی' });
  const lithologyInput = el('textarea', { rows: '2', placeholder: 'توصیف لایه‌ها/سنگ‌شناسی مشاهده‌شده' });
  const sampleInput = el('textarea', { rows: '2', placeholder: 'نتیجه‌ی آزمایش نمونه (عیار/ترکیب و...)' });
  const notesInput = el('textarea', { rows: '2', placeholder: 'یادداشت آزاد' });

  const addBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:8px' }, '➕ ثبت گمانه‌ی جدید');
  addBtn.addEventListener('click', async () => {
    if (!noInput.value.trim()) { showToast('⚠️ شماره/نام گمانه را وارد کنید'); return; }
    addBtn.disabled = true; const orig = addBtn.textContent; addBtn.textContent = '⏳ در حال ثبت...';
    try {
      const { data: userData } = await sb.auth.getUser();
      const { error } = await sb.from('exploration_boreholes').insert({
        exploration_record_id: rowId,
        mine_name: mineName,
        borehole_no: noInput.value.trim(),
        drill_date: dateInput.value.trim() || null,
        depth_m: depthInput.value ? Number(depthInput.value) : null,
        lat: latInput.value ? Number(latInput.value) : null,
        lon: lonInput.value ? Number(lonInput.value) : null,
        lithology: lithologyInput.value.trim() || null,
        sample_results: sampleInput.value.trim() || null,
        notes: notesInput.value.trim() || null,
        created_by: (userData && userData.user && userData.user.email) || null,
      });
      if (error) throw error;
      [noInput, dateInput, depthInput, latInput, lonInput, lithologyInput, sampleInput, notesInput].forEach((i) => { i.value = ''; });
      showToast('✅ گمانه ثبت شد');
      loadAndRender();
    } catch (err) {
      showToast(`❌ خطا: ${err.message}`);
    } finally {
      addBtn.disabled = false; addBtn.textContent = orig;
    }
  });

  body.append(
    el('div', { style: 'font-weight:700;margin-bottom:8px' }, 'افزودن گمانه‌ی جدید'),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, [
      el('div', {}, [el('label', {}, 'شماره گمانه'), noInput]),
      el('div', {}, [el('label', {}, 'تاریخ حفاری'), dateInput]),
      el('div', {}, [el('label', {}, 'عمق (متر)'), depthInput]),
      el('div', {}, [el('label', {}, 'عرض جغرافیایی'), latInput]),
      el('div', {}, [el('label', {}, 'طول جغرافیایی'), lonInput]),
    ]),
    el('label', {}, 'لیتولوژی'), lithologyInput,
    el('label', {}, 'نتیجه‌ی آزمایش نمونه'), sampleInput,
    el('label', {}, 'یادداشت'), notesInput,
    addBtn,
  );

  loadAndRender();
}

import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { jalaliDateSelect, recentPeriodOptions } from '../../lib/jalali.js';
import { loadScaledImage } from '../../lib/watermark.js';
import { uploadTechFile } from '../../lib/storage.js';
import { formalizePersianText } from '../../lib/formalize.js';

async function currentUserEmail() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.email || '';
}

// ── ۱) آموزش ایمنی کارکنان ──────────────────────────────────────────────
export function openTrainingModal(mine, nameField, department) {
  const mineName = mine[nameField];
  const { body, close } = openModal({ title: `🎓 ثبت آموزش ایمنی — ${mineName}`, width: '400px' });
  const dateWidget = jalaliDateSelect({});
  const topicInput = el('input', { type: 'text', placeholder: 'مثلاً: آموزش استفاده از تجهیزات حفاظت فردی' });
  const trainerInput = el('input', { type: 'text' });
  const attendeeCountInput = el('input', { type: 'number', min: '0', value: '1' });
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ثبت آموزش');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const topic = topicInput.value.trim();
    if (!topic) { errBox.textContent = 'موضوع آموزش را وارد کنید'; return; }
    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    try {
      const { error } = await sb.from('safety_trainings').insert([{
        mine_name: mineName, department, submitted_by: await currentUserEmail(),
        topic, training_date: dateWidget.getValue(), trainer_name: trainerInput.value.trim() || null,
        attendee_count: parseInt(attendeeCountInput.value, 10) || 0, notes: notesInput.value.trim() || null,
      }]);
      if (error) throw new Error(error.message);
      showToast('✅ آموزش ثبت شد');
      close();
    } catch (err) { errBox.textContent = err.message; }
    btn.disabled = false; btn.textContent = '✅ ثبت آموزش';
  });
  body.append(
    el('label', {}, 'تاریخ'), dateWidget.wrap,
    el('label', {}, 'موضوع آموزش'), topicInput,
    el('label', {}, 'مدرس'), trainerInput,
    el('label', {}, 'تعداد شرکت‌کننده'), attendeeCountInput,
    el('label', {}, 'توضیحات'), notesInput,
    errBox, btn,
  );
}

// ── ۲) گزارش تولید و عیار ────────────────────────────────────────────────
export function openProductionModal(mine, nameField, department) {
  const mineName = mine[nameField];
  const { body, close } = openModal({ title: `📈 ثبت تولید — ${mineName}`, width: '380px' });
  const periodSelect = el('select', {}, recentPeriodOptions(6).map((p) => el('option', { value: p }, p)));
  const materialInput = el('input', { type: 'text', placeholder: 'مثلاً: سنگ آهک' });
  const tonnageInput = el('input', { type: 'number', min: '0', step: '0.01' });
  const gradeInput = el('input', { type: 'number', min: '0', max: '100', step: '0.01' });
  const errBox = el('div', { class: 'gate-err' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ثبت تولید');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const material = materialInput.value.trim();
    const tonnage = parseFloat(tonnageInput.value);
    if (!material) { errBox.textContent = 'نام ماده معدنی را وارد کنید'; return; }
    if (Number.isNaN(tonnage) || tonnage < 0) { errBox.textContent = 'تناژ را درست وارد کنید'; return; }
    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    try {
      const { error } = await sb.from('production_reports').insert([{
        mine_name: mineName, department, submitted_by: await currentUserEmail(),
        period: periodSelect.value, material, tonnage,
        grade_percent: gradeInput.value ? parseFloat(gradeInput.value) : null,
      }]);
      if (error) throw new Error(error.message);
      showToast('✅ گزارش تولید ثبت شد');
      close();
    } catch (err) { errBox.textContent = err.message; }
    btn.disabled = false; btn.textContent = '✅ ثبت تولید';
  });
  body.append(
    el('label', {}, 'دوره'), periodSelect,
    el('label', {}, 'ماده معدنی'), materialInput,
    el('label', {}, 'تناژ (تن)'), tonnageInput,
    el('label', {}, 'عیار (٪ — اختیاری)'), gradeInput,
    errBox, btn,
  );
}

// ── ۳) پرسنل تحت سرپرستی ─────────────────────────────────────────────────
export function openPersonnelModal(mine, nameField, department) {
  const mineName = mine[nameField];
  const { body, close } = openModal({ title: `👷 ثبت پرسنل — ${mineName}`, width: '380px' });
  const nameInput = el('input', { type: 'text' });
  const roleInput = el('input', { type: 'text', placeholder: 'مثلاً: اپراتور لودر' });
  const phoneInput = el('input', { type: 'tel', dir: 'ltr' });
  const statusSelect = el('select', {}, [el('option', { value: 'active' }, 'فعال'), el('option', { value: 'inactive' }, 'غیرفعال/خروجی')]);
  const errBox = el('div', { class: 'gate-err' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ثبت پرسنل');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const fullName = nameInput.value.trim();
    if (!fullName) { errBox.textContent = 'نام و نام‌خانوادگی را وارد کنید'; return; }
    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    try {
      const { error } = await sb.from('mine_personnel').insert([{
        mine_name: mineName, department, submitted_by: await currentUserEmail(),
        full_name: fullName, role: roleInput.value.trim() || null, phone: phoneInput.value.trim() || null,
        status: statusSelect.value,
      }]);
      if (error) throw new Error(error.message);
      showToast('✅ پرسنل ثبت شد');
      close();
    } catch (err) { errBox.textContent = err.message; }
    btn.disabled = false; btn.textContent = '✅ ثبت پرسنل';
  });
  body.append(
    el('label', {}, 'نام و نام‌خانوادگی'), nameInput,
    el('label', {}, 'سمت/نقش'), roleInput,
    el('label', {}, 'شماره تماس'), phoneInput,
    el('label', {}, 'وضعیت'), statusSelect,
    errBox, btn,
  );
}

// ── ۴) اقدام اصلاحی ───────────────────────────────────────────────────────
const SOURCE_TYPES = [['equipment', '⚙️ ماشین‌آلات'], ['incident', '🚨 حادثه'], ['report', '📋 گزارش دوره‌ای'], ['other', '❓ سایر']];

async function loadOpenCorrectiveList(box, mineName) {
  box.innerHTML = '<div style="font-size:11px;color:var(--stone-500)">در حال بارگذاری...</div>';
  const { data, error } = await sb.from('corrective_actions').select('*').eq('mine_name', mineName).eq('status', 'open').order('created_at', { ascending: false });
  if (error) { box.innerHTML = '<div style="font-size:11px;color:var(--rust-700)">خطا در بارگذاری</div>'; return; }
  box.innerHTML = '';
  if (!data || !data.length) { box.append(el('div', { style: 'font-size:11px;color:var(--stone-500)' }, 'موردی باز نیست')); return; }
  data.forEach((a) => {
    const closeBtn = el('button', { class: 'btn-sm', style: 'font-size:10px;padding:3px 8px;background:var(--patina-100);color:var(--patina-700);margin-top:4px' }, '✅ بسته شد');
    closeBtn.addEventListener('click', async () => {
      // eslint-disable-next-line no-alert
      const note = window.prompt('توضیح کوتاه درباره‌ی رفع مشکل (اختیاری):') || '';
      const { error: closeErr } = await sb.from('corrective_actions').update({
        status: 'closed', closed_note: note || null, closed_at: new Date().toISOString(), closed_by: await currentUserEmail(),
      }).eq('id', a.id);
      if (closeErr) { showToast(`⚠️ ${closeErr.message}`); return; }
      showToast('✅ مورد بسته شد');
      loadOpenCorrectiveList(box, mineName);
    });
    box.append(el('div', { style: 'padding:6px 0;border-bottom:1px solid var(--stone-200);font-size:12px' }, [
      el('div', {}, a.description),
      el('div', { style: 'font-size:10px;color:var(--stone-500)' }, `${new Date(a.created_at).toLocaleDateString('fa-IR')}${a.due_date ? ` | مهلت: ${new Date(a.due_date).toLocaleDateString('fa-IR')}` : ''}`),
      closeBtn,
    ]));
  });
}

export function openCorrectiveModal(mine, nameField, department) {
  const mineName = mine[nameField];
  const { body, close } = openModal({ title: `🛠️ اقدام اصلاحی — ${mineName}`, width: '400px' });
  const sourceSelect = el('select', {}, SOURCE_TYPES.map(([v, l]) => el('option', { value: v }, l)));
  const descInput = el('textarea', { rows: '2' });
  const formalizeBtn = el('button', { class: 'btn-sm', style: 'background:var(--fluorite-100);color:var(--fluorite-700);margin-top:4px', onclick: () => {
    const text = descInput.value.trim();
    if (!text) return;
    descInput.value = formalizePersianText(text);
  } }, '✨ رسمی‌نویسی خودکار');
  const dueWidget = jalaliDateSelect({ optional: true });
  const errBox = el('div', { class: 'gate-err' });
  const listBox = el('div', { style: 'margin-top:14px' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '➕ ثبت مورد جدید');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const description = descInput.value.trim();
    if (!description) { errBox.textContent = 'شرح مشکل را وارد کنید'; return; }
    btn.disabled = true; btn.textContent = '⏳ در حال ثبت...';
    try {
      const { error } = await sb.from('corrective_actions').insert([{
        mine_name: mineName, department, submitted_by: await currentUserEmail(),
        description, source_type: sourceSelect.value, due_date: dueWidget.getValue(), status: 'open',
      }]);
      if (error) throw new Error(error.message);
      showToast('✅ اقدام اصلاحی ثبت شد');
      descInput.value = '';
      loadOpenCorrectiveList(listBox, mineName);
    } catch (err) { errBox.textContent = err.message; }
    btn.disabled = false; btn.textContent = '➕ ثبت مورد جدید';
  });
  body.append(
    el('label', {}, 'منشأ مورد'), sourceSelect,
    el('label', {}, 'شرح مشکل'), descInput, formalizeBtn,
    el('label', {}, 'مهلت رفع (اختیاری)'), dueWidget.wrap,
    errBox, btn,
    el('h4', { style: 'margin-top:16px;font-size:var(--text-sm);color:var(--ink-700)' }, 'موارد باز فعلی'),
    listBox,
  );
  loadOpenCorrectiveList(listBox, mineName);
  void close;
}

// ── ۵) نقشه سه‌ماهه وضعیت معدن ────────────────────────────────────────────
export async function openQuarterlyMapModal(mine, nameField, department) {
  const mineName = mine[nameField];
  const { body, close } = openModal({ title: `🗺️ نقشه سه‌ماهه — ${mineName}`, width: '380px' });
  const hintBox = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' }, 'در حال بررسی آخرین ارسال...');
  const periodInput = el('input', { type: 'text', placeholder: 'مثلاً: بهار ۱۴۰۴' });
  const fileInput = el('input', { type: 'file', accept: '.pdf,image/*' });
  const notesInput = el('textarea', { rows: '2' });
  const errBox = el('div', { class: 'gate-err' });
  const btn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:12px' }, '✅ ارسال');
  btn.addEventListener('click', async () => {
    errBox.textContent = '';
    const period = periodInput.value.trim();
    const file = fileInput.files[0];
    if (!period) { errBox.textContent = 'دوره را وارد کنید'; return; }
    if (!file) { errBox.textContent = 'فایل نقشه را انتخاب کنید'; return; }
    btn.disabled = true; btn.textContent = '⏳ در حال ارسال...';
    try {
      let fileUrl;
      if (file.type === 'application/pdf') {
        fileUrl = await uploadTechFile(file, file.name, mineName, 'quarterly-map', 'map');
      } else {
        const canvas = await loadScaledImage(file, 2000);
        const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
        fileUrl = await uploadTechFile(blob, 'map.jpg', mineName, 'quarterly-map', 'map');
      }
      const { error } = await sb.from('quarterly_maps').insert([{
        mine_name: mineName, department, submitted_by: await currentUserEmail(),
        period, file_url: fileUrl, notes: notesInput.value.trim() || null,
      }]);
      if (error) throw new Error(error.message);
      showToast('✅ نقشه ارسال شد');
      close();
    } catch (err) { errBox.textContent = err.message; }
    btn.disabled = false; btn.textContent = '✅ ارسال';
  });
  body.append(hintBox, el('label', {}, 'دوره'), periodInput, el('label', {}, 'فایل نقشه (PDF یا عکس)'), fileInput, el('label', {}, 'توضیحات'), notesInput, errBox, btn);

  sb.from('quarterly_maps').select('period, created_at').eq('mine_name', mineName).order('created_at', { ascending: false }).limit(1)
    .then(({ data }) => {
      hintBox.textContent = (data && data.length)
        ? `آخرین ارسال: ${data[0].period} (${new Date(data[0].created_at).toLocaleDateString('fa-IR')})`
        : '⚠️ هنوز نقشه‌ای برای این معدن ثبت نشده';
    });
}

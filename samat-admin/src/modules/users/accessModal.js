import { el, esc, showToast, fmtDate, simpleDateStatus } from '../../lib/dom.js';
import {
  PERM_SECTIONS, OFFICER_ROLES, specialtyMeta, fetchAssignableEntities, saveUserAccess, ROLE_LABELS,
} from '../../lib/users.js';
import { openModal } from '../../lib/dom.js';

function licenseBadge(dateStr) {
  if (!dateStr) return el('span', { class: 'badge badge-schist' }, 'تاریخ انقضا ثبت نشده');
  const s = simpleDateStatus(dateStr, 60);
  if (!s) return el('span', {}, '—');
  if (s.expired) return el('span', { class: 'badge badge-rust' }, `⏰ منقضی شده (${fmtDate(dateStr)})`);
  if (s.soon) return el('span', { class: 'badge badge-amber' }, `⚠️ ${s.daysLeft} روز مانده تا انقضا`);
  return el('span', { class: 'badge badge-patina' }, `✅ معتبر تا ${fmtDate(dateStr)}`);
}

export function openAccessModal(userRow, { myEmail, isSuper, onSaved }) {
  const u = userRow;
  const { body, close } = openModal({ title: `${u.email} — نقش فعلی: ${ROLE_LABELS[u.role] || u.role}`, width: '520px' });
  const editableNotif = isSuper || u.email === myEmail;
  const fields = {}; // نگاشت کلید → المنت ورودی، برای خواندن مقدار موقع ذخیره

  // ── ماتریس دسترسی به بخش‌ها (فقط viewer/inspector/admin) ──
  if (['viewer', 'inspector', 'admin'].includes(u.role)) {
    body.append(el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin-bottom:8px' }, 'بخش‌های قابل‌مشاهده'));
    const perms = u.permissions || {};
    PERM_SECTIONS.forEach((sec) => {
      const checked = sec.key === 'viewFuel' ? (u.role === 'admin' || perms.viewFuel === true) : perms[sec.key] !== false;
      const forceDisabled = u.role === 'admin';
      const cb = el('input', { type: 'checkbox', style: 'width:auto' });
      cb.checked = checked;
      cb.disabled = forceDisabled;
      fields[`perm_${sec.key}`] = cb;
      body.append(el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-sm);margin-bottom:6px' }, [cb, sec.label]));
    });
    if (u.role === 'admin') {
      body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
        'ادمین‌ها همیشه به همه‌ی بخش‌های بالا دسترسی دارند و این ماتریس فقط برای مشاهده‌گر/بازرس قابل تنظیم است.'));
    }
  }

  // ── بخش سازمانی (فقط نقش admin) ──
  if (u.role === 'admin') {
    body.append(el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin:14px 0 6px;border-top:1px dashed var(--stone-200);padding-top:10px' }, '🏢 بخش سازمانی'));
    body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      'مشخص می‌کند این ادمین مسئول کدام بخش اداره است — صرفاً یک برچسب سازمانی است (فعلاً برای فیلترکردن خودکار داده استفاده نمی‌شود).'));
    const deptSelect = el('select', {}, [
      el('option', { value: '' }, '— تعیین نشده —'),
      el('option', { value: 'صنعت' }, '🏭 صنعت'),
      el('option', { value: 'معدن' }, '⛏️ معدن'),
      el('option', { value: 'اصناف' }, '🛍️ اصناف'),
    ]);
    deptSelect.value = u.department || '';
    deptSelect.disabled = !editableNotif;
    fields.department = deptSelect;
    body.append(el('div', {}, [el('label', {}, 'بخش'), deptSelect]));
    if (!editableNotif) body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' }, 'فقط سوپرادمین می‌تواند بخش سازمانی را تغییر دهد.'));
  }

  // ── محدوده جغرافیایی ──
  if (['admin', 'inspector', 'viewer', 'superadmin'].includes(u.role)) {
    body.append(el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin:14px 0 6px;border-top:1px dashed var(--stone-200);padding-top:10px' }, '🗺️ محدوده جغرافیایی تحت پوشش (اختیاری)'));
    body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      'اگر این سامانه بین چند استان/شهرستان مشترک باشد، با پر کردن این دو فیلد فقط رکوردهای همان محدوده به این کاربر نشان داده می‌شود. خالی یعنی همه‌ی رکوردها دیده می‌شوند.'));
    const provinceInput = el('input', { type: 'text', value: u.assigned_province || '' });
    const countyInput = el('input', { type: 'text', value: u.assigned_county || '' });
    provinceInput.disabled = !editableNotif;
    countyInput.disabled = !editableNotif;
    fields.assigned_province = provinceInput;
    fields.assigned_county = countyInput;
    body.append(el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [
      el('div', {}, [el('label', {}, 'استان'), provinceInput]),
      el('div', {}, [el('label', {}, 'شهرستان'), countyInput]),
    ]));
    if (!editableNotif) body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' }, 'فقط سوپرادمین یا خود کاربر می‌تواند این محدوده را تغییر دهد.'));
  }

  // ── هویت مسئول فنی/ایمنی/بهداشت ──
  let mineListBox = null;
  if (OFFICER_ROLES.includes(u.role)) {
    const roleTitle = u.role === 'tech_officer' ? '🦺 اطلاعات هویتی / ادعای مسئولیت فنی'
      : u.role === 'safety_officer' ? '🦺 اطلاعات هویتی مسئول ایمنی' : '⚕️ اطلاعات هویتی مسئول بهداشت حرفه‌ای';
    body.append(el('div', { style: 'font-weight:700;color:var(--patina-700);font-size:var(--text-sm);margin:14px 0 6px;border-top:1px dashed var(--stone-200);padding-top:10px' }, roleTitle));

    let spec = u.role === 'tech_officer' ? (u.tech_officer_specialty || 'استخراج') : 'استخراج';
    if (u.role === 'tech_officer') {
      const specSelect = el('select', {}, [
        el('option', { value: 'استخراج' }, '⛏️ استخراج'),
        el('option', { value: 'اکتشاف' }, '🔍 اکتشاف'),
        el('option', { value: 'فرآوری' }, '⚗️ فرآوری'),
      ]);
      specSelect.value = spec;
      specSelect.addEventListener('change', () => { spec = specSelect.value; loadMineList(spec); });
      fields.tech_officer_specialty = specSelect;
      body.append(el('div', {}, [el('label', {}, 'نوع تخصص'), specSelect]));
    } else {
      body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, 'این نقش طبق ماده ۳ آیین‌نامه ایمنی معادن فقط برای معادن (بخش استخراج) تعریف می‌شود.'));
    }

    const idGrid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px' });
    const mkField = (key, label, type = 'text') => {
      const input = el('input', { type, dir: 'ltr', value: u[key] || '' });
      fields[key] = input;
      idGrid.append(el('div', {}, [el('label', {}, label), input]));
    };
    mkField('national_code', 'کد ملی');
    mkField('membership_no', 'شماره عضویت نظام مهندسی');
    mkField('license_no', 'شماره پروانه اشتغال به کار');
    mkField('license_expiry_date', 'تاریخ انقضای پروانه اشتغال (ماده ۴)', 'date');
    mkField('contract_no', 'شماره ثبت قرارداد نظام مهندسی');
    mkField('employment_capacity', 'ظرفیت اشتغال مجاز (ماده ۱۲)', 'number');
    body.append(idGrid);

    if (u.license_no) body.append(el('div', { style: 'margin-top:6px' }, licenseBadge(u.license_expiry_date)));

    const assignedCount = (u.assigned_mines || []).length;
    if (u.employment_capacity && assignedCount > u.employment_capacity) {
      body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--rust-600);margin-top:6px' },
        `⚠️ تعداد موارد اختصاص‌یافته (${assignedCount}) بیشتر از ظرفیت اشتغال ثبت‌شده (${u.employment_capacity}) است`));
    }

    const requestedInput = el('input', { type: 'text', value: u.requested_mine_name || '' });
    fields.requested_mine_name = requestedInput;
    body.append(el('div', { style: 'margin-top:8px' }, [
      el('label', {}, 'نام معدن/محدوده/واحد که ادعا می‌کند مسئول آن است'), requestedInput,
    ]));

    body.append(el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin:14px 0 6px;border-top:1px dashed var(--stone-200);padding-top:10px' }, 'مورد(های) اختصاصی این کاربر'));
    mineListBox = el('div', { class: 'loading-state' }, 'در حال بارگذاری...');
    body.append(mineListBox);
    body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' },
      'این کاربر پس از تایید، فقط همین مورد(ها) را می‌بیند و می‌تواند برایشان چک‌لیست/گزارش ثبت کند.'));

    loadMineList(spec);
  }

  // ── بهره‌بردار: فقط اختصاص معدن، بدون فیلدهای هویتی مسئول فنی ──
  if (u.role === 'owner') {
    body.append(el('div', { style: 'font-weight:700;color:var(--schist-600);font-size:var(--text-sm);margin:14px 0 6px;border-top:1px dashed var(--stone-200);padding-top:10px' }, '🏢 بهره‌بردار — اختصاص معدن'));
    body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      'این نقش فقط برای بخش معدن (استخراج) تعریف می‌شود. کاربر پس از تایید، فقط اطلاعات همین معدن(ها) را در پرتال بهره‌برداران می‌بیند (پروانه، اقدامات اصلاحی، گزارش‌های مسئول فنی، و غیره) — بدون امکان ویرایش.'));
    mineListBox = el('div', { class: 'loading-state' }, 'در حال بارگذاری...');
    body.append(mineListBox);
    loadMineList('استخراج');
  }

  async function loadMineList(spec) {
    if (!mineListBox) return;
    mineListBox.innerHTML = '';
    mineListBox.append(el('div', { class: 'loading-state' }, 'در حال بارگذاری...'));
    try {
      const items = await fetchAssignableEntities(spec);
      const assigned = new Set(u.assigned_mines || []);
      mineListBox.innerHTML = '';
      if (!items.length) {
        mineListBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600)' }, `هیچ موردی در فهرست بخش «${specialtyMeta(spec).dept}» نیست.`));
        return;
      }
      const box = el('div', { style: 'max-height:220px;overflow-y:auto;border:1px solid var(--stone-200);border-radius:8px;padding:8px' });
      items.forEach((r) => {
        const cb = el('input', { type: 'checkbox', class: 'ua-mine', value: r.name, style: 'width:auto' });
        cb.checked = assigned.has(r.name);
        box.append(el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-sm);padding:3px 0' }, [cb, esc(r.name)]));
      });
      mineListBox.append(box);
    } catch (err) {
      mineListBox.innerHTML = '';
      mineListBox.append(el('div', { style: 'font-size:var(--text-xs);color:var(--rust-600)' }, `خطا در بارگذاری فهرست: ${err.message}`));
    }
  }

  // ── تنظیمات اعلان (فقط ادمین/سوپرادمین) ──
  if (['admin', 'superadmin'].includes(u.role)) {
    body.append(el('div', { style: 'font-weight:700;font-size:var(--text-sm);margin:14px 0 6px;border-top:1px dashed var(--stone-200);padding-top:10px' }, 'دریافت گزارش‌های مسئولین فنی'));
    const receivesCb = el('input', { type: 'checkbox', style: 'width:auto' });
    receivesCb.checked = !!u.receives_tech_reports;
    receivesCb.disabled = !editableNotif;
    fields.receives_tech_reports = receivesCb;
    body.append(el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:var(--text-sm);margin-bottom:8px' },
      [receivesCb, 'این کاربر گزارش ماهانه/عکس مسئولین فنی را در تلگرام/روبیکا دریافت کند']));

    const tgInput = el('input', { type: 'text', dir: 'ltr', value: u.telegram_chat_id || '', placeholder: 'مثلاً 123456789' });
    const rbInput = el('input', { type: 'text', dir: 'ltr', value: u.rubika_chat_id || '', placeholder: 'شناسه چت روبیکا' });
    tgInput.disabled = !editableNotif;
    rbInput.disabled = !editableNotif;
    fields.telegram_chat_id = tgInput;
    fields.rubika_chat_id = rbInput;
    body.append(el('div', {}, [el('label', {}, 'آیدی عددی چت تلگرام'), tgInput]));
    body.append(el('div', {}, [el('label', {}, 'آیدی چت روبیکا'), rbInput]));
    if (!editableNotif) body.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-top:6px' }, 'فقط سوپرادمین می‌تواند این تنظیمات را برای سایر ادمین‌ها تغییر دهد.'));
  }

  const saveBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:16px' }, '💾 ذخیره');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'در حال ذخیره...';
    try {
      const patch = {};
      if (['viewer', 'inspector', 'admin'].includes(u.role)) {
        const perms = {};
        PERM_SECTIONS.forEach((sec) => { perms[sec.key] = fields[`perm_${sec.key}`].checked; });
        patch.permissions = perms;
      }
      if (OFFICER_ROLES.includes(u.role)) {
        const chosen = Array.from(document.querySelectorAll('.ua-mine:checked')).map((cb) => cb.value);
        if (chosen.length) patch.assigned_mines = chosen;
        patch.national_code = fields.national_code.value.trim();
        patch.membership_no = fields.membership_no.value.trim();
        patch.license_no = fields.license_no.value.trim();
        patch.license_expiry_date = fields.license_expiry_date.value || null;
        patch.contract_no = fields.contract_no.value.trim();
        patch.employment_capacity = fields.employment_capacity.value ? parseInt(fields.employment_capacity.value, 10) : null;
        patch.requested_mine_name = fields.requested_mine_name.value.trim();
        if (fields.tech_officer_specialty) {
          patch.tech_officer_specialty = fields.tech_officer_specialty.value;
          patch.department = specialtyMeta(patch.tech_officer_specialty).dept;
        } else {
          patch.department = 'معدن';
        }
      }
      if (u.role === 'owner') {
        const chosen = Array.from(document.querySelectorAll('.ua-mine:checked')).map((cb) => cb.value);
        if (chosen.length) patch.assigned_mines = chosen;
        patch.department = 'معدن';
      }
      if (fields.department && !fields.department.disabled) patch.department = fields.department.value || null;
      if (fields.assigned_province && !fields.assigned_province.disabled) patch.assigned_province = fields.assigned_province.value.trim() || null;
      if (fields.assigned_county && !fields.assigned_county.disabled) patch.assigned_county = fields.assigned_county.value.trim() || null;
      if (fields.receives_tech_reports && !fields.receives_tech_reports.disabled) patch.receives_tech_reports = fields.receives_tech_reports.checked;
      if (fields.telegram_chat_id && !fields.telegram_chat_id.disabled) patch.telegram_chat_id = fields.telegram_chat_id.value.trim();
      if (fields.rubika_chat_id && !fields.rubika_chat_id.disabled) patch.rubika_chat_id = fields.rubika_chat_id.value.trim();

      await saveUserAccess(u, patch);
      showToast('✅ تنظیمات ذخیره شد');
      close();
      onSaved?.();
    } catch (err) {
      showToast(`⚠️ خطا در ذخیره: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 ذخیره';
    }
  });
  body.append(saveBtn);
}

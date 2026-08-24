import { el, esc, showToast } from '../../lib/dom.js';
import {
  fetchAllUsers, approveUser, changeUserRole, removeUserRole, fetchAssignableEntities,
  ROLE_LABELS, OFFICER_ROLES, MINE_ASSIGNED_ROLES, addUserRoleManually,
} from '../../lib/users.js';
import { openAccessModal } from './accessModal.js';

const ROLE_OPTIONS = ['viewer', 'inspector', 'tech_officer', 'safety_officer', 'health_officer', 'owner', 'admin'];
const DEPARTMENTS = ['معدن', 'صنعت', 'اکتشاف', 'فرآوری', 'اصناف'];
const ADMIN_DEPARTMENTS = [{ value: 'صنعت', label: '🏭 صنعت' }, { value: 'معدن', label: '⛏️ معدن' }, { value: 'اصناف', label: '🛍️ اصناف' }];

export async function renderUsers(container, state, ctx) {
  container.append(el('div', { class: 'loading-state' }, [
    el('div', { class: 'spinner' }),
    'در حال بارگذاری کاربران...',
  ]));

  let pending;
  let active;
  try {
    ({ pending, active } = await fetchAllUsers());
  } catch (err) {
    container.innerHTML = '';
    container.append(el('div', { class: 'empty-state' }, `خطا در بارگذاری: ${err.message}`));
    return;
  }

  container.innerHTML = '';
  const myEmail = ctx?.myEmail || '';
  const isSuper = ctx?.myRole === 'superadmin';
  const isAdminRole = isSuper || ctx?.myRole === 'admin';

  const refresh = () => renderUsers(container, state, ctx);

  if (pending.length) {
    const section = el('div', { class: 'card', style: 'margin-bottom:20px' }, [
      el('h3', { style: 'color:var(--amber-700);margin-bottom:12px' }, `⏳ درخواست‌های در انتظار تایید (${pending.length})`),
    ]);
    pending.forEach((u) => section.append(renderPendingRow(u, refresh)));
    container.append(section);
  }

  const activeSection = el('div', { class: 'card' }, [
    el('h3', { style: 'margin-bottom:12px' }, `کاربران (${active.length})`),
  ]);
  if (isAdminRole) {
    const newEmailInput = el('input', { type: 'email', dir: 'ltr', placeholder: 'ایمیلی که قبلاً در Supabase Authentication ساخته شده' });
    const newRoleSelect = el('select', {}, ROLE_OPTIONS.map((r) => el('option', { value: r }, ROLE_LABELS[r] || r)));
    const addBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)' }, '➕ افزودن');
    addBtn.addEventListener('click', async () => {
      const email = newEmailInput.value.trim();
      if (!email) { showToast('⚠️ ایمیل را وارد کنید'); return; }
      try {
        await addUserRoleManually(email, newRoleSelect.value);
        newEmailInput.value = '';
        showToast('✅ کاربر اضافه شد');
        refresh();
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });
    activeSection.append(el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--stone-200)' }, [
      newEmailInput, newRoleSelect, addBtn,
    ]));
  }
  if (!active.length) {
    activeSection.append(el('div', { class: 'empty-state' }, 'کاربری ثبت نشده'));
  } else {
    active.forEach((u) => activeSection.append(renderActiveRow(u, { myEmail, isSuper, isAdminRole, refresh })));
  }
  container.append(activeSection);
}

function renderPendingRow(u, refresh) {
  const roleSelect = el('select', { class: 'role-select' });
  ROLE_OPTIONS.forEach((r) => roleSelect.append(el('option', { value: r }, ROLE_LABELS[r] || r)));
  if (u.requested_mine_name) roleSelect.value = 'tech_officer';

  const deptSelect = el('select', { class: 'role-select' });
  function refreshDeptOptions() {
    deptSelect.innerHTML = '';
    const list = roleSelect.value === 'admin' ? ADMIN_DEPARTMENTS : DEPARTMENTS.map((d) => ({ value: d, label: d }));
    list.forEach((d) => deptSelect.append(el('option', { value: d.value }, d.label)));
  }
  refreshDeptOptions();
  roleSelect.addEventListener('change', refreshDeptOptions);

  const mineWrap = el('div', { style: 'margin-top:6px' });

  async function refreshMineWrap() {
    mineWrap.innerHTML = '';
    if (!MINE_ASSIGNED_ROLES.includes(roleSelect.value)) return;
    mineWrap.append(el('div', { class: 'loading-state', style: 'padding:8px 0' }, 'در حال بارگذاری فهرست...'));
    try {
      const items = await fetchAssignableEntities('استخراج'); // نقش‌های ایمنی/بهداشت/بهره‌بردار، و پیش‌فرض مسئول فنی، طبق ماده ۳، فقط معدن
      mineWrap.innerHTML = '';
      const requested = (u.requested_mine_name || '').trim();
      const match = items.find((r) => r.name === requested);
      const select = el('select', { style: 'width:100%;margin-top:2px' }, [
        el('option', { value: '' }, '— انتخاب کنید —'),
        ...items.map((r) => el('option', { value: r.name }, r.name)),
      ]);
      if (match) select.value = match.name;
      mineWrap.append(el('label', { style: 'font-size:var(--text-xs);display:block;margin-top:4px' }, roleSelect.value === 'owner' ? 'معدن متعلق به این بهره‌بردار (الزامی برای تایید)' : 'معدن (الزامی برای تایید)'));
      mineWrap.append(select);
      mineWrap._select = select;
      if (!match && requested) {
        mineWrap.append(el('div', { style: 'font-size:var(--text-xs);color:var(--amber-700);margin-top:3px' },
          `نام اعلام‌شده «${requested}» دقیقاً با هیچ موردی تطبیق نیافت — از لیست بالا انتخاب کنید.`));
      }
    } catch (err) {
      mineWrap.innerHTML = '';
      mineWrap.append(el('div', { style: 'font-size:var(--text-xs);color:var(--rust-600)' }, `خطا: ${err.message}`));
    }
  }
  roleSelect.addEventListener('change', refreshMineWrap);
  if (MINE_ASSIGNED_ROLES.includes(roleSelect.value)) refreshMineWrap();

  const approveBtn = el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)' }, '✅ تایید');
  approveBtn.addEventListener('click', async () => {
    const chosenMine = mineWrap._select ? mineWrap._select.value : '';
    try {
      const update = await approveUser(u.email, roleSelect.value, deptSelect.value, chosenMine);
      showToast(update.assigned_mines ? `✅ کاربر تایید شد و «${update.assigned_mines[0]}» اختصاص داده شد` : '✅ کاربر تایید شد');
      refresh();
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  const rejectBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)' }, 'رد');
  rejectBtn.addEventListener('click', async () => {
    if (!confirm(`دسترسی کاربر ${u.email} حذف شود؟`)) return;
    try {
      await removeUserRole(u.email);
      showToast('🗑 حذف شد');
      refresh();
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  const techInfo = (u.membership_no || u.license_no || u.requested_mine_name || u.contract_no || u.national_code)
    ? el('div', { style: 'background:#fff;border-radius:8px;padding:8px 10px;font-size:var(--text-xs);color:var(--stone-600);line-height:2' }, [
      el('b', { style: 'color:var(--amber-700)' }, '🦺 اطلاعات ثبت‌نام (برای تطبیق/استعلام):'), el('br'),
      u.national_code ? `کد ملی: ${u.national_code}` : '',
      u.national_code ? el('br') : '',
      u.membership_no ? `شماره عضویت نظام مهندسی: ${u.membership_no}` : '',
      u.membership_no ? el('br') : '',
      u.license_no ? `شماره پروانه اشتغال: ${u.license_no}` : '',
      u.license_no ? el('br') : '',
      u.requested_mine_name ? `معدن اعلام‌شده: ${u.requested_mine_name}` : '',
    ])
    : null;

  const row = el('div', { style: 'background:var(--amber-50);border-radius:var(--radius-md);padding:12px;margin-bottom:10px' }, [
    el('div', { style: 'margin-bottom:6px' }, [
      el('b', {}, u.full_name || u.email), ' ',
      el('span', { style: 'color:var(--stone-600);font-size:var(--text-xs)' },
        `${u.email} | ${u.phone || '-'}${u.personnel_code ? ` | کد پرسنلی: ${u.personnel_code}` : ''}`),
    ]),
  ]);
  if (techInfo) row.append(techInfo);
  row.append(el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px' }, [roleSelect, deptSelect, approveBtn, rejectBtn]));
  row.append(mineWrap);
  return row;
}

function renderActiveRow(u, { myEmail, isSuper, isAdminRole, refresh }) {
  const disabled = u.role === 'superadmin' && !isSuper;
  const roleSelect = el('select', { class: 'role-select' });
  ROLE_OPTIONS.forEach((r) => roleSelect.append(el('option', { value: r }, ROLE_LABELS[r] || r)));
  if (u.role === 'superadmin') roleSelect.append(el('option', { value: 'superadmin' }, 'سوپرادمین'));
  roleSelect.value = u.role;
  roleSelect.disabled = disabled;

  roleSelect.addEventListener('change', async () => {
    if (roleSelect.value === 'superadmin' && !confirm(`⚠️ کاربر ${u.email} به سوپرادمین ارتقا پیدا می‌کند و به همه‌ی بخش‌ها و مدیریت سایر کاربران دسترسی کامل خواهد داشت. ادامه می‌دهید؟`)) {
      roleSelect.value = u.role;
      return;
    }
    if (u.role === 'superadmin' && roleSelect.value !== 'superadmin' && !confirm(`⚠️ سوپرادمین‌بودن کاربر ${u.email} گرفته می‌شود. ادامه می‌دهید؟`)) {
      roleSelect.value = u.role;
      return;
    }
    try {
      await changeUserRole(u.email, roleSelect.value);
      showToast('✅ نقش بروزرسانی شد');
      refresh();
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
      roleSelect.value = u.role;
    }
  });

  const btnRow = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [roleSelect]);
  if (isAdminRole) {
    const accessBtn = el('button', { class: 'btn-sm', style: 'background:var(--schist-100);color:var(--schist-600)' }, '🔐 دسترسی و تنظیمات');
    accessBtn.addEventListener('click', () => openAccessModal(u, { myEmail, isSuper, onSaved: refresh }));
    btnRow.append(accessBtn);
  }
  if (u.role !== 'superadmin' || isSuper) {
    const delBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)' }, 'حذف');
    delBtn.addEventListener('click', async () => {
      if (!confirm(`دسترسی کاربر ${u.email} حذف شود؟`)) return;
      try {
        await removeUserRole(u.email);
        showToast('🗑 حذف شد');
        refresh();
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });
    btnRow.append(delBtn);
  }

  const isOfficer = OFFICER_ROLES.includes(u.role);
  let techInfo = null;
  if (isOfficer && (u.membership_no || u.license_no || u.requested_mine_name || u.contract_no || u.national_code)) {
    const officerTitle = u.role === 'tech_officer' ? '🦺 اطلاعات هویتی ثبت‌شده:' : u.role === 'safety_officer' ? '🦺 اطلاعات هویتی مسئول ایمنی:' : '⚕️ اطلاعات هویتی مسئول بهداشت:';
    techInfo = el('div', { style: 'background:var(--patina-50);border-radius:8px;padding:8px 10px;font-size:var(--text-xs);color:var(--stone-600);line-height:2;margin-top:6px;width:100%' }, [
      el('b', { style: 'color:var(--patina-700)' }, officerTitle), el('br'),
      u.national_code ? `کد ملی: ${u.national_code}` : '', u.national_code ? el('br') : '',
      u.membership_no ? `شماره عضویت نظام مهندسی: ${u.membership_no}` : '', u.membership_no ? el('br') : '',
      u.license_no ? `شماره پروانه اشتغال: ${u.license_no}` : '', u.license_no ? el('br') : '',
      (u.assigned_mines || []).length
        ? `مورد(های) اختصاصی: ${u.assigned_mines.join('، ')}`
        : el('span', { style: 'color:var(--amber-700)' }, '⚠️ هنوز موردی اختصاص داده نشده'),
    ]);
  } else if (isOfficer) {
    techInfo = el('div', { style: 'font-size:var(--text-xs);color:var(--amber-700);margin-top:6px;width:100%' },
      'این کاربر اطلاعات هویتی ثبت‌شده‌ای ندارد — از «🔐 دسترسی و تنظیمات» وارد کنید.');
  } else if (u.role === 'owner') {
    techInfo = el('div', { style: 'background:var(--schist-100);border-radius:8px;padding:8px 10px;font-size:var(--text-xs);color:var(--stone-600);line-height:2;margin-top:6px;width:100%' }, [
      el('b', { style: 'color:var(--schist-600)' }, '🏢 بهره‌بردار'), el('br'),
      (u.assigned_mines || []).length
        ? `معدن(های) اختصاصی: ${u.assigned_mines.join('، ')}`
        : el('span', { style: 'color:var(--amber-700)' }, '⚠️ هنوز معدنی اختصاص داده نشده — از «🔐 دسترسی و تنظیمات» اختصاص دهید.'),
    ]);
  }

  const row = el('div', { class: 'mine-row', style: 'cursor:default;flex-wrap:wrap;align-items:flex-start' }, [
    el('div', { style: 'flex:1;min-width:200px' }, [
      el('div', { class: 'mine-name' }, esc(u.email)),
    ]),
    btnRow,
  ]);
  if (techInfo) row.append(techInfo);
  return row;
}

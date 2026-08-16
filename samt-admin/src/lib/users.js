import { sb } from './supabase.js';

export const ROLE_LABELS = {
  superadmin: 'سوپرادمین', admin: 'ادمین', inspector: 'بازرس', viewer: 'مشاهده‌گر',
  tech_officer: 'مسئول فنی', safety_officer: 'مسئول ایمنی', health_officer: 'مسئول بهداشت حرفه‌ای',
  owner: 'بهره‌بردار',
};

export const OFFICER_ROLES = ['tech_officer', 'safety_officer', 'health_officer'];

// نقش «بهره‌بردار» هم مثل نقش‌های مسئول فنی/ایمنی/بهداشت نیاز به اختصاص مورد (معدن) دارد،
// اما یک نقش staff/کارمندی نیست (به همین دلیل جدای OFFICER_ROLES نگه داشته شده — جاهایی از
// کد که «آیا این کاربر پرسنل اداره است» را می‌پرسند باید فقط OFFICER_ROLES را ببینند).
export const MINE_ASSIGNED_ROLES = [...OFFICER_ROLES, 'owner'];

export const SPECIALTY_META = {
  استخراج: { dept: 'معدن', table: 'mine_records', nameField: 'نام_معدن' },
  اکتشاف: { dept: 'اکتشاف', table: 'exploration_records', nameField: 'نام_متقاضی' },
  فرآوری: { dept: 'فرآوری', table: 'processing_records', nameField: 'نام_واحد' },
};
export function specialtyMeta(spec) {
  return SPECIALTY_META[spec] || SPECIALTY_META['استخراج'];
}

export const PERM_SECTIONS = [
  { key: 'viewList', label: '📋 فهرست معادن/واحدها' },
  { key: 'viewMap', label: '🗺️ نقشه' },
  { key: 'viewStats', label: '📊 آمار' },
  { key: 'viewFuel', label: '⛽ گزارش سوخت' },
];

export async function fetchAllUsers() {
  const { data, error } = await sb.from('user_roles').select('*').order('id');
  if (error) throw error;
  const rows = data || [];
  return {
    pending: rows.filter((u) => u.role === 'pending'),
    active: rows.filter((u) => u.role !== 'pending'),
  };
}

/** افزودن دستی یک کاربر که از قبل در Supabase Authentication ساخته شده (بدون فرآیند ثبت‌نام خودکار) */
export async function addUserRoleManually(email, role) {
  const { error } = await sb.from('user_roles').upsert({ email, role }, { onConflict: 'email' });
  if (error) throw new Error('کاربر باید ابتدا در Supabase Authentication ساخته شده باشد');
}

async function logUserAccessChange(action, targetEmail, details) {
  try {
    const { data: { user } } = await sb.auth.getUser();
    await sb.from('audit_log').insert([{
      department: 'user_access', record_name: targetEmail,
      field_key: action, field_label: action,
      old_value: '', new_value: JSON.stringify(details || {}),
      changed_by: user ? user.email : '',
    }]);
  } catch {
    // لاگ نشدنِ رخداد کم‌اهمیت نباید عملیات اصلی را متوقف کند
  }
}

export async function approveUser(email, role, department, assignedMine) {
  const update = { role, department };
  if (MINE_ASSIGNED_ROLES.includes(role)) {
    if (!assignedMine) throw new Error('برای تایید این نقش باید یک مورد از لیست انتخاب شود');
    update.assigned_mines = [assignedMine];
  }
  const { error } = await sb.from('user_roles').update(update).eq('email', email);
  if (error) throw error;
  await logUserAccessChange('تایید کاربر و اعطای نقش', email, update);
  return update;
}

export async function changeUserRole(email, role) {
  const { data: currentRow } = await sb.from('user_roles').select('role').eq('email', email).limit(1).single();
  const wasSuperadmin = currentRow && currentRow.role === 'superadmin';

  if (wasSuperadmin && role !== 'superadmin') {
    const { count } = await sb.from('user_roles').select('email', { count: 'exact', head: true }).eq('role', 'superadmin');
    if (count !== null && count <= 1) {
      throw new Error('این تنها سوپرادمین سامانه است — قبل از تغییر نقشش، حداقل یک سوپرادمین دیگر معرفی کنید');
    }
  }
  const { error } = await sb.from('user_roles').update({ role }).eq('email', email);
  if (error) throw error;
  await logUserAccessChange('تغییر نقش کاربر', email, { role });
}

export async function removeUserRole(email) {
  const { data: currentRow } = await sb.from('user_roles').select('role').eq('email', email).limit(1).single();
  if (currentRow && currentRow.role === 'superadmin') {
    const { count } = await sb.from('user_roles').select('email', { count: 'exact', head: true }).eq('role', 'superadmin');
    if (count !== null && count <= 1) throw new Error('این تنها سوپرادمین سامانه است — نمی‌توان حذفش کرد');
  }
  const { error } = await sb.from('user_roles').delete().eq('email', email);
  if (error) throw error;
  await logUserAccessChange('حذف دسترسی کاربر', email, {});
}

/** فهرست مورد(های) قابل‌اختصاص را از جدول درست، بر اساس تخصص، از طریق تابع RPC می‌گیرد. */
export async function fetchAssignableEntities(specialty) {
  const { data, error } = await sb.rpc('list_assignable_entities', { specialty_in: specialty });
  if (error) throw error;
  return (data || []).filter((r) => r && r.name);
}

export async function saveUserAccess(userRow, patch) {
  const { error } = await sb.from('user_roles').update(patch).eq('email', userRow.email);
  if (error) throw error;
}

import { sb } from './supabase.js';

export const SPECIALTY_META = {
  استخراج: { dept: 'معدن', table: 'mine_records', nameField: 'نام_معدن' },
  اکتشاف: { dept: 'اکتشاف', table: 'exploration_records', nameField: 'نام_متقاضی' },
  فرآوری: { dept: 'فرآوری', table: 'processing_records', nameField: 'نام_واحد' },
};
export function specialtyMeta(spec) {
  return SPECIALTY_META[spec] || SPECIALTY_META['استخراج'];
}

/** فقط معادن/پرونده‌هایی که به این کاربر اختصاص داده شده‌اند را برمی‌گرداند (نه کل جدول) */
export async function fetchAssignedMines(specialty, assignedMines) {
  const meta = specialtyMeta(specialty || 'استخراج');
  const { data, error } = await sb.from(meta.table).select('*');
  if (error || !data) return [];
  return data
    .map((r) => ({ ...r.record, _rowId: r.id, _nameField: meta.nameField }))
    .filter((m) => (assignedMines || []).includes(m[meta.nameField]));
}

/**
 * برای حساب‌های ستادی (ادمین/بازرس) که فهرست ثابت assigned_mines ندارند: به‌جای فیلتر با
 * whitelist، مثل پنل ادمین بر اساس محدوده‌ی جغرافیایی (استان/شهرستان تعیین‌شده برای حسابشان)
 * فیلتر می‌کند. خالی‌بودن هر دو یعنی محدودیتی نیست (دسترسی به همه‌ی معادن آن تخصص).
 */
export async function fetchMinesByGeoScope(specialty, assignedProvince, assignedCounty) {
  const meta = specialtyMeta(specialty || 'استخراج');
  const { data, error } = await sb.from(meta.table).select('*');
  if (error || !data) return [];
  let mines = data.map((r) => ({ ...r.record, _rowId: r.id, _nameField: meta.nameField }));
  if (assignedProvince) mines = mines.filter((m) => (m['استان'] || '').trim() === assignedProvince.trim());
  if (assignedCounty) mines = mines.filter((m) => (m['شهرستان'] || '').trim() === assignedCounty.trim());
  return mines;
}

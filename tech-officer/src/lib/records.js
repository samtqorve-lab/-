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

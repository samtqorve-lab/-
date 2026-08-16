import { sb } from './supabase.js';

// این دو، جدول‌های قدیمی‌ای هستند که قبل از مهاجرت به ساختار id+record فعلی، کل داده را نگه می‌داشتند؛
// حالا فقط برای ذخیره‌ی متادیتای «فیلدهای اختصاصی» باقی مانده‌اند. اکتشاف/فرآوری چنین جدولی نداشتند
// (محدودیتی که در خود نسخه‌ی قبلی هم وجود داشت، نه چیزی که اینجا اضافه شده باشد).
export const DEPT_META_TABLES = { معدن: 'mines', صنعت: 'industry' };

export function supportsCustomFields(department) {
  return Boolean(DEPT_META_TABLES[department]);
}

export async function fetchCustomFields(department) {
  const table = DEPT_META_TABLES[department];
  if (!table) return { fields: {}, rowId: null };
  const { data, error } = await sb.from(table).select('*').limit(1);
  if (error) throw error;
  if (data && data.length) {
    return { fields: (data[0].data && data[0].data.customFields) || {}, rowId: data[0].id };
  }
  return { fields: {}, rowId: null };
}

export async function saveCustomFields(department, fields, rowId, userEmail) {
  const table = DEPT_META_TABLES[department];
  if (!table) return rowId;
  const payload = { data: { customFields: fields }, updated_by: userEmail, updated_at: new Date().toISOString() };
  if (rowId) {
    const { error } = await sb.from(table).update(payload).eq('id', rowId);
    if (error) throw error;
    return rowId;
  }
  const { data, error } = await sb.from(table).insert([payload]).select();
  if (error) throw error;
  return data[0].id;
}

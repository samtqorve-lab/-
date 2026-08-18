import { sb } from './supabase.js';

// نگاشت واقعی بخش‌ها به جدول‌های Supabase — از خود admin-index.html (نسخه‌ی قبلی) استخراج شده،
// چون این اسم‌ها هیچ الگوی قابل‌حدسی ندارند (اصناف/trade_records در UI فعلی غیرفعال است، عمداً حذف شد).
export const DEPT_TABLES = {
  معدن: 'mine_records',
  صنعت: 'industry_records',
  اکتشاف: 'exploration_records',
  فرآوری: 'processing_records',
};

// ── کش حافظه‌ای بین تب‌ها ──────────────────────────────────────────────────
// تقریباً همه‌ی تب‌های داشبورد (داشبورد، فهرست، نقشه، الزامات قانونی، گزارش‌های تکمیلی، احراز
// هویت) همین یک تابع را برای همان بخش صدا می‌زنند؛ بدون کش، سوییچ بین تب‌ها هر بار کل جدول را
// دوباره از سرور می‌خواند. یک TTL کوتاه (نه کش دائمی) نگه می‌داریم تا اگر همکار دیگری هم‌زمان
// رکوردی را عوض کرد، دیر یا زود (حداکثر بعد از TTL) خودش را نشان دهد؛ و هر جهش محلی (ویرایش/درج
// از همین کاربر) بلافاصله و صریح کش همان بخش را باطل می‌کند تا خودِ کاربر هیچ‌وقت داده‌ی
// دست‌نخورده‌ی خودش را با تاخیر نبیند.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // department -> { data, ts }

export function invalidateDeptCache(department) {
  cache.delete(department);
}

/**
 * جدول‌های واقعی داده را با الگوی {id, record:jsonb} ذخیره می‌کنند، نه ستون‌های مسطح.
 * این تابع رکوردها را می‌گیرد و record را داخل خود آبجکت باز (flatten) می‌کند — دقیقاً همان
 * کاری که تابع loadData در نسخه‌ی قبلی انجام می‌داد — تا بقیه‌ی کد بتواند مثل یک آبجکت ساده
 * به فیلدها دسترسی داشته باشد (مثلاً m['نام_معدن']) و مجبور به تکرار r.record[...] در همه‌جا نباشد.
 * @param {string} department
 * @param {{ force?: boolean }} [opts] force=true یعنی از کش رد شو و حتماً از سرور تازه بخوان
 * (مثلاً دکمه‌ی «تازه‌سازی» دستی کاربر).
 */
export async function fetchDeptRecords(department, opts = {}) {
  const cached = cache.get(department);
  if (!opts.force && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return [...cached.data];
  }
  const table = DEPT_TABLES[department];
  if (!table) throw new Error(`جدول این بخش (${department}) تعریف نشده است`);
  const { data, error } = await sb.from(table).select('id, record').order('id', { ascending: true });
  if (error) throw error;
  const rows = (data || []).map((row) => ({ ...row.record, _rowId: row.id }));
  cache.set(department, { data: rows, ts: Date.now() });
  return [...rows];
}

export async function updateDeptRecord(department, rowId, record) {
  const table = DEPT_TABLES[department];
  const { error } = await sb.from(table).update({ record }).eq('id', rowId);
  if (error) throw error;
  invalidateDeptCache(department);
}

/** درج گروهی رکورد جدید (برای ایمپورت اکسل/CSV) — هر رکورد باید یک آبجکت ساده‌ی فیلد باشد (بدون _rowId). */
export async function insertDeptRecords(department, records, userEmail) {
  const table = DEPT_TABLES[department];
  const payload = records.map((r) => ({ record: r, updated_by: userEmail, updated_at: new Date().toISOString() }));
  const { data, error } = await sb.from(table).insert(payload).select();
  if (error) throw error;
  invalidateDeptCache(department);
  return data;
}

/**
 * اگر روی حساب ادمین/بازرس یک استان/شهرستان مشخص ثبت شده باشد، فقط همان محدوده را برمی‌گرداند.
 * خالی‌بودن یعنی محدودیتی نیست (همان رفتار applyGeoScope در نسخه‌ی قبلی).
 */
export function applyGeoScope(list, assignedProvince, assignedCounty) {
  if (!assignedProvince && !assignedCounty) return list;
  return list.filter((m) => {
    if (assignedProvince && (m['استان'] || '').trim() !== assignedProvince.trim()) return false;
    if (assignedCounty && (m['شهرستان'] || '').trim() !== assignedCounty.trim()) return false;
    return true;
  });
}

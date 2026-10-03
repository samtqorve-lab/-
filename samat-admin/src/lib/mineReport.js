import { sb } from './supabase.js';
import { ensureXLSX } from './xlsxLoader.js';

/**
 * گزارش‌گیری «فقط برای یک معدن»: همه‌ی جدول‌های عملیاتی که ستون mine_name دارند، فقط برای همان
 * معدن (و همان بخش) خوانده می‌شوند. hasDept=true یعنی جدول ستون department دارد؛ ردیف‌های قدیمیِ
 * بدون بخش (null) هم شامل می‌شوند تا گزارش ناقص نماند.
 */
const T = (table, label, hasDept = true) => ({ table, label, hasDept });

const COMMON = [
  T('incident_reports', 'حوادث'),
  T('corrective_actions', 'اقدامات اصلاحی'),
  T('safety_checklists', 'چک‌لیست ایمنی'),
  T('mine_equipment', 'ماشین‌آلات'),
  T('mine_personnel', 'پرسنل'),
  T('safety_trainings', 'آموزش ایمنی'),
  T('tech_reports', 'گزارش دوره‌ای'),
  T('quarterly_maps', 'نقشه سه‌ماهه'),
  T('qr_checkins', 'ورود با QR'),
  T('mine_presence_events', 'حضور در معدن'),
  T('identity_verifications', 'احراز هویت'),
];

const BY_DEPT = {
  معدن: [
    T('production_reports', 'گزارش تولید'),
    T('royalty_records', 'حق‌الارض و رویالتی'),
    T('financial_guarantees', 'تضمین مالی'),
    T('environmental_reclamation', 'بازسازی محیط‌زیست'),
    T('discoverer_rights_payments', 'حقوق کاشف'),
    T('license_transfers', 'انتقال پروانه'),
    T('disqualification_cases', 'سلب صلاحیت'),
    T('mine_boundary_monitoring', 'پایش ماهواره‌ای'),
    T('model3d_jobs', 'مدل سه‌بعدی', false),
  ],
  اکتشاف: [
    T('exploration_boreholes', 'گمانه‌ها', false),
    T('exploration_core_boxes', 'جعبه کور', false),
    T('exploration_progress_reports', 'پیشرفت اکتشاف'),
    T('exploration_sample_custody', 'زنجیره نمونه', false),
    T('exploration_site_photos', 'عکس محل گمانه'),
    T('exploration_strike_dip', 'شیب و امتداد', false),
    T('exploration_traverses', 'تراورس', false),
    T('financial_guarantees', 'تضمین مالی'),
    T('license_transfers', 'انتقال پروانه'),
  ],
  فرآوری: [
    T('processing_reports', 'خوراک و محصول'),
    T('processing_consumption', 'مصرف مواد و انرژی'),
    T('processing_stockpile_photos', 'عکس دپو', false),
    T('processing_site_photos', 'عکس روزانه کارخانه'),
    T('processing_tailings_dam', 'باطله'),
    T('production_reports', 'گزارش تولید'),
  ],
};

export function mineReportTables(department) {
  const seen = new Set();
  return [...COMMON, ...(BY_DEPT[department] || [])].filter((t) => {
    if (seen.has(t.table)) return false;
    seen.add(t.table);
    return true;
  });
}

/** فیلتر مشترک: فقط همین معدن (+ همین بخش) و در صورت نیاز بازه‌ی تاریخ ثبت */
function scoped(q, t, department, mineName, range) {
  let query = q.eq('mine_name', mineName);
  if (t.hasDept) query = query.or(`department.eq.${department},department.is.null`);
  if (range && range.from) query = query.gte('created_at', `${range.from}T00:00:00`);
  if (range && range.to) query = query.lte('created_at', `${range.to}T23:59:59`);
  return query;
}

/** شاخص‌های سریع بالای پروفایل معدن — هر کدام مستقل است؛ اگر یکی خطا داد فقط همان null می‌شود */
export async function fetchMineSummary(department, mineName) {
  const head = { count: 'exact', head: true };
  const count = async (build) => {
    try {
      const { count: c, error } = await build();
      if (error) return null;
      return c ?? 0;
    } catch { return null; }
  };
  const [incidents, openCorrective, checklistIssues, pendingEquipment, pendingIdentity, activeNotices] = await Promise.all([
    count(() => scoped(sb.from('incident_reports').select('id', head), T('incident_reports'), department, mineName)),
    count(() => scoped(sb.from('corrective_actions').select('id', head), T('corrective_actions'), department, mineName).neq('status', 'closed')),
    count(() => scoped(sb.from('safety_checklists').select('id', head), T('safety_checklists'), department, mineName).eq('overall_status', 'issues')),
    count(() => scoped(sb.from('mine_equipment').select('id', head), T('mine_equipment'), department, mineName).eq('status', 'pending')),
    count(() => scoped(sb.from('identity_verifications').select('id', head), T('identity_verifications'), department, mineName).eq('status', 'pending')),
    count(() => sb.from('notices').select('id', head).eq('department', department).eq('mine_name', mineName).eq('active', true)),
  ]);
  return { incidents, openCorrective, checklistIssues, pendingEquipment, pendingIdentity, activeNotices };
}

// ستون‌هایی که نباید وارد فایل گزارش شوند (کلیدهای احراز هویت بیومتریک/دستگاه)
const HIDDEN_COLS = new Set(['public_key', 'credential_id', 'credential_counter', 'device_id']);

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function sheetName(label, used) {
  let base = label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Sheet';
  let name = base;
  let i = 2;
  while (used.has(name)) { name = `${base.slice(0, 26)} ${i}`; i += 1; }
  used.add(name);
  return name;
}

/**
 * یک فایل اکسل با یک برگه‌ی «خلاصه» + یک برگه برای هر جدولِ دارای داده، فقط برای همین معدن.
 * @returns {Promise<{ total: number, perTable: Array<{label:string,count:number,error?:string}> }>}
 */
export async function exportMineWorkbook({ department, mineName, range, onProgress }) {
  const XLSX = await ensureXLSX();
  const tables = mineReportTables(department);
  const perTable = [];
  const sheets = [];

  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    if (onProgress) onProgress(i + 1, tables.length, t.label);
    try {
      const { data, error } = await scoped(sb.from(t.table).select('*'), t, department, mineName, range)
        .order('created_at', { ascending: false }).limit(5000);
      if (error) throw error;
      const rows = data || [];
      perTable.push({ label: t.label, count: rows.length });
      if (rows.length) sheets.push({ label: t.label, rows });
    } catch (err) {
      perTable.push({ label: t.label, count: 0, error: err.message || String(err) });
    }
  }

  const wb = XLSX.utils.book_new();
  const used = new Set();

  const rangeText = range && (range.from || range.to) ? `${range.from || '…'} تا ${range.to || '…'}` : 'همه‌ی زمان‌ها';
  const summaryRows = [
    { بخش: 'معدن/واحد', مقدار: mineName },
    { بخش: 'حوزه', مقدار: department },
    { بخش: 'بازه‌ی تاریخ ثبت', مقدار: rangeText },
    { بخش: 'تاریخ تهیه‌ی گزارش', مقدار: new Date().toLocaleDateString('fa-IR') },
    { بخش: '', مقدار: '' },
    ...perTable.map((p) => ({ بخش: p.label, مقدار: p.error ? `⚠️ خطا: ${p.error}` : p.count })),
  ];
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows, { header: ['بخش', 'مقدار'] });
  summaryWs['!cols'] = [{ wch: 28 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, sheetName('خلاصه', used));

  sheets.forEach(({ label, rows }) => {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !HIDDEN_COLS.has(k));
    const plain = rows.map((r) => {
      const o = {};
      keys.forEach((k) => { o[k] = cell(r[k]); });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(plain, { header: keys });
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(label, used));
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = mineName.replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `گزارش_${safeName}_${stamp}.xlsx`);

  return { total: sheets.reduce((s, x) => s + x.rows.length, 0), perTable };
}

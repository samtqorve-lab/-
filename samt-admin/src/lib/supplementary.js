import { sb } from './supabase.js';

export const SUPP_TABLES = {
  checklist: 'safety_checklists',
  training: 'safety_trainings',
  production: 'production_reports',
  personnel: 'mine_personnel',
  corrective: 'corrective_actions',
  quarterlymaps: 'quarterly_maps',
  incident: 'incident_reports',
  equipment: 'mine_equipment',
};

export const SUPP_TITLES = {
  checklist: '✅ چک‌لیست نوبت‌کاری',
  training: '🎓 آموزش‌ها',
  production: '⛏️ گزارش تولید',
  personnel: '👷 پرسنل',
  corrective: '🛠️ اقدام اصلاحی',
  quarterlymaps: '🗺️ نقشه سه‌ماهه',
  incident: '🚨 حوادث',
  equipment: '⚙️ ماشین‌آلات',
};

export async function fetchAllSupplementary(department, geoScopedMineNames) {
  const keys = Object.keys(SUPP_TABLES);
  const results = await Promise.all(
    keys.map((k) => sb.from(SUPP_TABLES[k]).select('*').eq('department', department).order('created_at', { ascending: false })),
  );
  const cache = {};
  keys.forEach((k, i) => {
    let rows = results[i].data || [];
    if (geoScopedMineNames) rows = rows.filter((r) => geoScopedMineNames.has(r.mine_name));
    cache[k] = rows;
  });
  return cache;
}

export function groupByMine(rows) {
  const g = {};
  rows.forEach((r) => { (g[r.mine_name || '—'] = g[r.mine_name || '—'] || []).push(r); });
  return g;
}

export async function closeCorrectiveAction(id, note) {
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('corrective_actions').update({
    status: 'closed', closed_note: note || null, closed_at: new Date().toISOString(), closed_by: user ? user.email : '',
  }).eq('id', id);
  if (error) throw error;
}

/** برای mine_equipment: ممکن است چند ردیف (نمای دور + سریال) به یک device_key تعلق داشته باشند — همه با هم تایید/رد می‌شوند. */
export async function approveEquipmentRows(ids) {
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('mine_equipment').update({
    status: 'approved', reviewed_by: user ? user.email : '', reviewed_at: new Date().toISOString(), reject_reason: null,
  }).in('id', ids);
  if (error) throw error;
}

export async function rejectEquipmentRows(ids, reason) {
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('mine_equipment').update({
    status: 'rejected', reviewed_by: user ? user.email : '', reviewed_at: new Date().toISOString(), reject_reason: reason || null,
  }).in('id', ids);
  if (error) throw error;
}

/**
 * خروجی گزارش تخلفات/موارد نامطلوب، آماده برای ارسال رسمی («رونوشت به») به سازمان نظام مهندسی معدن استان.
 * تشخیص نهایی تخلف مهندسی و اقدام انضباطی بر عهده‌ی همان سازمان است — این فقط داده‌ی خامِ ثبت‌شده در سامانه است.
 */
export async function exportCorrectiveActionsForEngineeringOrg(rows) {
  const { data: officers } = await sb.from('user_roles').select('full_name, email, license_no, membership_no, role, assigned_mines').in('role', ['tech_officer', 'safety_officer', 'health_officer']);
  const roleFa = { tech_officer: 'مسئول فنی', safety_officer: 'مسئول ایمنی', health_officer: 'مسئول بهداشت حرفه‌ای' };
  function findOfficer(mineName) {
    const list = (officers || []).filter((o) => (o.assigned_mines || []).includes(mineName));
    if (!list.length) return null;
    return list.map((o) => `${o.full_name || o.email} (${roleFa[o.role]} — پروانه/عضویت: ${o.license_no || o.membership_no || 'ثبت‌نشده'})`).join(' | ');
  }

  const headers = ['ردیف', 'نام معدن', 'تاریخ ثبت', 'منبع', 'شرح مورد', 'مسئول(ین) مرتبط با معدن', 'وضعیت', 'تاریخ بسته‌شدن', 'توضیح بسته‌شدن'];
  const sourceFa = { equipment: 'ماشین‌آلات', incident: 'حادثه', report: 'گزارش دوره‌ای', other: 'سایر' };
  const statusFa = { open: 'باز', closed: 'بسته‌شده' };
  const csvRows = [headers.join(',')];
  rows.forEach((r, idx) => {
    const cells = [
      idx + 1, r.mine_name || '', r.created_at ? new Date(r.created_at).toLocaleDateString('fa-IR') : '',
      sourceFa[r.source_type] || r.source_type || '', r.description || '',
      findOfficer(r.mine_name) || 'مشخص نشد',
      statusFa[r.status] || r.status || '', r.closed_at ? new Date(r.closed_at).toLocaleDateString('fa-IR') : '',
      r.closed_note || '',
    ];
    csvRows.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  });
  const blob = new Blob([`\uFEFF${csvRows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `گزارش_موارد_ثبت‌شده_برای_نظام‌مهندسی_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

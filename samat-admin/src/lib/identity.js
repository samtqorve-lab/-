import { sb } from './supabase.js';

export async function fetchIdentityVerifications(department) {
  const { data, error } = await sb.from('identity_verifications').select('*').eq('department', department).order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data || [];
}

export async function fetchSignedPhotoUrls(paths) {
  if (!paths.length) return {};
  try {
    const { data } = await sb.storage.from('identity-photos').createSignedUrls(paths, 3600);
    const map = {};
    (data || []).forEach((s) => { if (s && s.path && s.signedUrl) map[s.path] = s.signedUrl; });
    return map;
  } catch {
    return {};
  }
}

/** معادنی که مختصات چهارگوش کامل ندارند و بنابراین فقط با شعاع ۳۰۰ متری بررسی می‌شوند، نه محدوده‌ی دقیق */
export async function fetchMinesMissingBoundary(records, nameField) {
  const letters = 'ABCDEFGHIJKLMNOP'.split('');
  return records
    .filter((rec) => {
      let cornerCount = 0;
      letters.forEach((l) => { if (rec[`طول_${l}`] && rec[`عرض_${l}`]) cornerCount++; });
      return cornerCount < 3;
    })
    .map((rec) => rec[nameField])
    .filter(Boolean);
}

async function logIdentityReviewAudit(department, action, row, extra) {
  try {
    const { data: { user } } = await sb.auth.getUser();
    await sb.from('audit_log').insert([{
      department, record_name: row.mine_name || row.email,
      field_key: 'identity_review', field_label: '🪪 بررسی احراز هویت مسئول فنی',
      old_value: row.kind ? `${row.kind === 'monthly' ? 'تمدید ماهانه' : 'احراز هویت اولیه'} — ${row.email || ''}` : (row.email || ''),
      new_value: extra ? `${action} — ${extra}` : action,
      changed_by: user ? user.email : '',
    }]);
  } catch {
    // لاگ نشدنِ این رخداد نباید عملیات اصلی تایید/رد را متوقف کند
  }
}

export async function approveIdentity(department, row) {
  const { error } = await sb.rpc('review_identity_verification', { id_in: row.id, approve_in: true, reason_in: null });
  if (error) throw error;
  await logIdentityReviewAudit(department, '✅ تایید شد', row);
}

export async function rejectIdentity(department, row, reason) {
  const { error } = await sb.rpc('review_identity_verification', { id_in: row.id, approve_in: false, reason_in: reason });
  if (error) throw error;
  await logIdentityReviewAudit(department, '❌ رد شد', row, reason);
}

export async function resetTrustedDevice(department, email) {
  const { error } = await sb.rpc('admin_reset_trusted_device', { email_in: email });
  if (error) throw error;
  await logIdentityReviewAudit(department, '📵 گوشی مورد اعتماد ریست شد', { email });
}

export async function fetchPendingIdentityCount(department) {
  const { count } = await sb.from('identity_verifications').select('id', { count: 'exact', head: true }).eq('department', department).eq('status', 'pending');
  return count || 0;
}

const IDENTITY_INTERVAL_DEFAULT_DAYS = 30;
const IDENTITY_REMINDER_DEFAULT_DAYS = 5;

/** دوره‌ی تمدید و یادآوری احراز هویت را از public_settings می‌خواند (پیش‌فرض: ماهانه / ۵ روز قبل) */
export async function fetchIdentitySettings() {
  let intervalDays = IDENTITY_INTERVAL_DEFAULT_DAYS;
  let reminderDays = IDENTITY_REMINDER_DEFAULT_DAYS;
  const { data } = await sb.from('public_settings').select('key,value').in('key', ['identity_reverify_interval_days', 'identity_reverify_reminder_days']);
  (data || []).forEach((r) => {
    const n = parseInt(r.value, 10);
    if (!n || n < 1) return;
    if (r.key === 'identity_reverify_interval_days') intervalDays = n;
    if (r.key === 'identity_reverify_reminder_days') reminderDays = n;
  });
  return { intervalDays, reminderDays };
}

/** فقط ادمین/سوپرادمین (طبق RLS جدول public_settings) می‌تواند این را با موفقیت صدا بزند */
export async function saveIdentitySettings({ intervalDays, reminderDays }) {
  const { error } = await sb.from('public_settings').upsert([
    { key: 'identity_reverify_interval_days', value: String(intervalDays) },
    { key: 'identity_reverify_reminder_days', value: String(reminderDays) },
  ], { onConflict: 'key' });
  if (error) throw error;
}

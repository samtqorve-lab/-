import { sb } from './supabase.js';

export const LEGAL_TABLES = {
  royalty: 'royalty_records',
  guarantee: 'financial_guarantees',
  kashef: 'discoverer_rights_payments',
  reclamation: 'environmental_reclamation',
  transfer: 'license_transfers',
  disqualification: 'disqualification_cases',
};

export const LEGAL_TITLES = {
  royalty: '💰 حقوق دولتی (رویالتی)',
  guarantee: '🏦 تضمین مالی',
  kashef: '👤 حقوق کاشف',
  reclamation: '🌱 بازسازی محیط زیست',
  transfer: '🔄 انتقال پروانه',
  disqualification: '⚠️ سلب صلاحیت',
};

export const LEGAL_STATUS_META = {
  pending: { l: 'در انتظار', c: 'var(--amber-700)', bg: 'var(--amber-100)' },
  partial: { l: 'پرداخت جزئی', c: 'var(--amber-700)', bg: 'var(--amber-100)' },
  paid: { l: 'پرداخت‌شده', c: 'var(--patina-700)', bg: 'var(--patina-100)' },
  overdue: { l: 'معوق', c: 'var(--rust-700)', bg: 'var(--rust-100)' },
  active: { l: 'فعال', c: 'var(--patina-700)', bg: 'var(--patina-100)' },
  expired: { l: 'منقضی', c: 'var(--rust-700)', bg: 'var(--rust-100)' },
  released: { l: 'مسترد شده', c: 'var(--fluorite-700)', bg: 'var(--fluorite-100)' },
  reported: { l: 'پرداخت و اعلام به وزارت شده', c: 'var(--patina-700)', bg: 'var(--patina-100)' },
  not_submitted: { l: 'ثبت نشده', c: 'var(--rust-700)', bg: 'var(--rust-100)' },
  pending_approval: { l: 'در انتظار تایید', c: 'var(--amber-700)', bg: 'var(--amber-100)' },
  approved: { l: 'تاییدشده', c: 'var(--patina-700)', bg: 'var(--patina-100)' },
  not_started: { l: 'شروع نشده', c: 'var(--rust-700)', bg: 'var(--rust-100)' },
  in_progress: { l: 'در حال اجرا', c: 'var(--amber-700)', bg: 'var(--amber-100)' },
  completed: { l: 'تکمیل‌شده', c: 'var(--patina-700)', bg: 'var(--patina-100)' },
  submitted: { l: 'ثبت درخواست', c: 'var(--schist-600)', bg: 'var(--schist-100)' },
  clearance_pending: { l: 'در انتظار مفاصا حساب', c: 'var(--amber-700)', bg: 'var(--amber-100)' },
  review: { l: 'بررسی توان فنی/مالی', c: 'var(--schist-600)', bg: 'var(--schist-100)' },
  transfer_approved: { l: 'موافقت شده — در انتظار ظهرنویسی', c: 'var(--patina-700)', bg: 'var(--patina-100)' },
  finalized: { l: 'ظهرنویسی و نهایی شد', c: 'var(--patina-700)', bg: 'var(--patina-100)' },
  rejected: { l: 'رد شد', c: 'var(--rust-700)', bg: 'var(--rust-100)' },
  warned: { l: 'اخطار صادر شد', c: 'var(--amber-700)', bg: 'var(--amber-100)' },
  deadline_passed: { l: 'مهلت رفع تخلف گذشته', c: 'var(--rust-700)', bg: 'var(--rust-100)' },
  committee_review: { l: 'در دست بررسی کمیسیون ماده ۲۰', c: 'var(--schist-600)', bg: 'var(--schist-100)' },
  disqualified: { l: 'سلب صلاحیت شد', c: 'var(--rust-700)', bg: 'var(--rust-100)' },
  resolved: { l: 'رفع تخلف — پرونده بسته شد', c: 'var(--patina-700)', bg: 'var(--patina-100)' },
};

export function legalStatusMeta(status) {
  return LEGAL_STATUS_META[status] || { l: status || '—', c: 'var(--schist-600)', bg: 'var(--schist-100)' };
}

/** بر مبنای فاصله تا یک تاریخ میلادی (فیلدهای این ماژول همه از input type=date می‌آیند) */
export function dateStatus(dateStr, warnDays = 60) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const daysLeft = Math.round((d.getTime() - Date.now()) / 86400000);
  return { daysLeft, expired: daysLeft < 0, soon: daysLeft >= 0 && daysLeft <= warnDays };
}

export async function fetchAllLegalRecords(department, geoScopedMineNames) {
  const keys = Object.keys(LEGAL_TABLES);
  const results = await Promise.all(
    keys.map((k) => sb.from(LEGAL_TABLES[k]).select('*').eq('department', department).order('created_at', { ascending: false })),
  );
  const cache = {};
  keys.forEach((k, i) => {
    let rows = results[i].data || [];
    if (geoScopedMineNames) rows = rows.filter((r) => geoScopedMineNames.has(r.mine_name));
    cache[k] = rows;
  });
  return cache;
}

export async function saveLegalRecord(sub, payload, editId) {
  const table = LEGAL_TABLES[sub];
  const { error } = editId
    ? await sb.from(table).update(payload).eq('id', editId)
    : await sb.from(table).insert([payload]);
  if (error) throw error;
}

export async function deleteLegalRecord(sub, id) {
  const { error } = await sb.from(LEGAL_TABLES[sub]).delete().eq('id', id);
  if (error) throw error;
}

export async function sendLegalComplianceDigest(cache, showToast) {
  const items = [];
  (cache.royalty || []).filter((r) => ['pending', 'partial', 'overdue'].includes(r.status)).forEach((r) => items.push({ category: 'royalty', mineName: r.mine_name, label: `رویالتی ${legalStatusMeta(r.status).l} — دوره ${r.period || '—'}` }));
  (cache.guarantee || []).filter((r) => r.status === 'active').forEach((r) => {
    const d = dateStatus(r.next_adjustment_date, 60);
    if (d && (d.expired || d.soon)) items.push({ category: 'guarantee', mineName: r.mine_name, label: d.expired ? 'موعد تعدیل تضمین مالی گذشته' : `${d.daysLeft} روز تا موعد تعدیل تضمین مالی` });
  });
  (cache.kashef || []).filter((r) => ['pending', 'paid'].includes(r.status)).forEach((r) => items.push({ category: 'kashef', mineName: r.mine_name, label: `حقوق کاشف ${legalStatusMeta(r.status).l} — سال ${r.year || '—'}` }));
  (cache.reclamation || []).filter((r) => r.plan_status !== 'approved').forEach((r) => items.push({ category: 'reclamation', mineName: r.mine_name, label: 'طرح بازسازی محیط‌زیست تایید نشده' }));
  (cache.transfer || []).filter((r) => r.status === 'clearance_pending').forEach((r) => items.push({ category: 'transfer', mineName: r.mine_name, label: 'انتقال پروانه در انتظار مفاصا حساب' }));
  (cache.disqualification || []).filter((r) => r.deadline && new Date(r.deadline) < new Date() && !['committee_review', 'disqualified', 'resolved'].includes(r.status))
    .forEach((r) => items.push({ category: 'disqualification', mineName: r.mine_name, label: 'مهلت رفع تخلف (ماده ۲۰) گذشته' }));

  if (!items.length) { showToast('✅ در حال حاضر هیچ الزام قانونی معوق/نزدیک‌به‌سررسیدی ثبت نشده است'); return; }
  if (!confirm(`هشدار ${items.length} مورد الزام قانونی معوق/نزدیک‌به‌سررسید به تلگرام/روبیکای سوپرادمین‌ها ارسال شود؟`)) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'legalComplianceDigest', items }),
    });
    const j = await res.json();
    showToast(j.notified ? '✅ هشدار ارسال شد' : '⚠️ ارسال ناموفق — گیرنده‌ای با تلگرام/روبیکای تنظیم‌شده یافت نشد');
  } catch {
    showToast('⚠️ خطا در ارسال هشدار');
  }
}

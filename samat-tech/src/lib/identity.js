import { sb } from './supabase.js';

/** توجه: باکت identity-photos خصوصی است؛ فقط مسیر (path) ذخیره می‌شود، نه لینک عمومی. */
export async function submitIdentityVerification({ email, mineName, kind, blob, lat, lon, insideBoundary, deviceId }) {
  const path = `${email.toLowerCase()}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error: upErr } = await sb.storage.from('identity-photos').upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
  if (upErr) throw new Error(`آپلود عکس ناموفق بود: ${upErr.message}`);
  const { error: rpcErr } = await sb.rpc('submit_identity_verification', {
    mine_name_in: mineName, kind_in: kind, photo_url_in: path,
    lat_in: lat, lon_in: lon, inside_boundary_in: insideBoundary, device_id_in: deviceId,
  });
  if (rpcErr) throw new Error(rpcErr.message);
}

export async function fetchLastRejectReason(email, kind) {
  const { data } = await sb.from('identity_verifications').select('reject_reason')
    .eq('email', email).eq('kind', kind).eq('status', 'rejected')
    .order('created_at', { ascending: false }).limit(1);
  return (data && data[0] && data[0].reject_reason) || '';
}

const MONTHLY_IDENTITY_MS_DEFAULT = 30 * 24 * 60 * 60 * 1000;

export async function loadIdentitySettings() {
  let monthlyMs = MONTHLY_IDENTITY_MS_DEFAULT;
  let reminderMs = 5 * 24 * 60 * 60 * 1000;
  try {
    const { data } = await sb.from('public_settings').select('key,value').in('key', ['identity_reverify_interval_days', 'identity_reverify_reminder_days']);
    (data || []).forEach((r) => {
      const n = parseInt(r.value, 10);
      if (!n || n < 1) return;
      if (r.key === 'identity_reverify_interval_days') monthlyMs = n * 24 * 60 * 60 * 1000;
      if (r.key === 'identity_reverify_reminder_days') reminderMs = n * 24 * 60 * 60 * 1000;
    });
  } catch { /* مقادیر پیش‌فرض باقی می‌مانند */ }
  return { monthlyMs, reminderMs };
}

/**
 * بررسی می‌کند آیا کاربر نیاز به گیت احراز هویت دارد.
 * @returns {{ ok:true } | { ok:false, kind:'pending' } | { ok:false, kind:'capture', captureKind:'initial'|'monthly', reason:string }}
 */
export async function checkIdentityGate(email, row, monthlyMs) {
  if (row.identity_status === 'pending') return { ok: false, kind: 'pending' };
  if (row.identity_status !== 'approved') {
    const reason = row.identity_status === 'rejected' ? await fetchLastRejectReason(email, 'initial') : '';
    return { ok: false, kind: 'capture', captureKind: 'initial', reason };
  }
  const last = row.identity_verified_at ? new Date(row.identity_verified_at).getTime() : 0;
  if (Date.now() - last > monthlyMs) {
    const { data: mrows } = await sb.from('identity_verifications').select('reject_reason,status')
      .eq('email', email).eq('kind', 'monthly').order('created_at', { ascending: false }).limit(1);
    const reason = (mrows && mrows[0] && mrows[0].status === 'rejected') ? (mrows[0].reject_reason || '') : '';
    return { ok: false, kind: 'capture', captureKind: 'monthly', reason };
  }
  return { ok: true };
}

import { sb } from './supabase.js';

// چک‌این ایمنی کارگر تنها: مسئول فنی/ایمنی که در سایت معدن (اغلب دورافتاده و بدون همراه) کار
// می‌کند، هر چند ساعت یک‌بار «من سالمم» می‌زند؛ اگر در بازه‌ی مقرر پاسخ ندهد، هشدار به مدیر سامانه
// (از همان کانال notify-relay که برای اعلام حادثه استفاده می‌شود) ارسال می‌شود.
//
// محدودیت صادقانه: این یک تایمر در خود برنامه‌ی وب است، نه یک سرویس پس‌زمینه‌ی واقعی سیستم‌عامل —
// اگر تب/برنامه کاملاً بسته شود یا گوشی خاموش شود، این تایمر متوقف می‌شود (مرورگرها تب‌های پس‌زمینه
// را هم به‌شدت محدود می‌کنند). این جایگزین یک دستگاه اضطراری واقعی (مثل PLB/بی‌سیم) نیست؛ فقط یک
// لایه‌ی کمکیِ اضافه است، به شرط این‌که برنامه باز/در پس‌زمینه‌ی نزدیک بماند.
//
// نیاز به migration: این جدول تازه است و در نسخه‌های قبلی این پروژه وجود نداشت. پیش از استفاده،
// باید در Supabase ساخته شود (به README.md همین پروژه، بخش «چک‌این ایمنی»، مراجعه کنید).
const TABLE = 'safety_checkins';

export function checkinTableMissingError(err) {
  return err && (err.code === '42P01' || /relation .* does not exist/i.test(err.message || ''));
}

export async function startCheckinSession(email, mineName, department, intervalMs) {
  const nextDueAt = new Date(Date.now() + intervalMs).toISOString();
  const { data, error } = await sb.from(TABLE).insert([{
    email, mine_name: mineName, department, status: 'active', next_due_at: nextDueAt,
  }]).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function pingCheckin(sessionId, intervalMs) {
  const nextDueAt = new Date(Date.now() + intervalMs).toISOString();
  const { error } = await sb.from(TABLE).update({ next_due_at: nextDueAt, last_ping_at: new Date().toISOString(), status: 'active' }).eq('id', sessionId);
  if (error) throw error;
}

export async function endCheckinSession(sessionId) {
  const { error } = await sb.from(TABLE).update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', sessionId);
  if (error) throw error;
}

export async function markCheckinOverdue(sessionId) {
  const { error } = await sb.from(TABLE).update({ status: 'overdue' }).eq('id', sessionId);
  if (error) throw error;
}

/** هشدار عدم‌پاسخ به مدیر سامانه — از همان مسیر notify-relay که برای حوادث استفاده می‌شود */
export async function sendOverdueAlert({ email, mineName }) {
  const { data: sessionData } = await sb.auth.getSession();
  const jwt = sessionData && sessionData.session ? sessionData.session.access_token : null;
  if (!jwt) return;
  await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ action: 'checkinOverdue', email, mineName }),
  });
}

/**
 * تایمر محلی چک‌این را مدیریت می‌کند: بعد از رسیدن مهلت، callback هشدار صدا زده می‌شود؛ اگر بعد از
 * مهلت اضافه (grace) هم پاسخی نیاید، callback ارسال هشدار به مدیر صدا زده می‌شود.
 */
export function createCheckinTimer({ intervalMs, graceMs, onDue, onOverdue }) {
  let dueTimer = null;
  let overdueTimer = null;
  function schedule() {
    clear();
    dueTimer = setTimeout(() => { onDue?.(); overdueTimer = setTimeout(() => onOverdue?.(), graceMs); }, intervalMs);
  }
  function clear() {
    if (dueTimer) clearTimeout(dueTimer);
    if (overdueTimer) clearTimeout(overdueTimer);
    dueTimer = null; overdueTimer = null;
  }
  schedule();
  return { reschedule: schedule, clear };
}

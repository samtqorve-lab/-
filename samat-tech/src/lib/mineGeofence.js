import { sb } from './supabase.js';
import { onGpsUpdate, isInsideMineBoundary } from './geo.js';
import { startBackgroundGeofenceWatcher, stopBackgroundGeofenceWatcher } from './backgroundGeofence.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from './offlineQueue.js';

// ─ ردیابی ورود/خروج مسئول فنی/ایمنی/بهداشت از محدوده‌ی معدن‌های اختصاصی‌اش: هر تعویض وضعیت در
// جدول mine_presence_events ثبت می‌شود (برای گزارش ساعات حضور در پنل ادمین) و همزمان یک اعلان
// فوری (Push/تلگرام/...) از طریق notify-relay به ادمین‌ها می‌رود.
//
// دو منبع GPS همزمان تغذیه می‌کنند: ناظر معمولی lib/geo.js (فقط تا وقتی پردازه‌ی اپ زنده است) و
// lib/backgroundGeofence.js (پلاگین بومی سرویس foreground اندروید — حتی وقتی اپ کامل از حافظه پاک
// شده). هر دو دقیقاً همین handleCoords را صدا می‌زنند، پس تشخیص ورود/خروج (و جلوگیری از ثبت
// تکراری، از طریق getLastState/setLastState در localStorage) برای هر دو یکسان است.
const STATE_KEY_PREFIX = 'tor_mine_presence_v1_';
let unsubscribe = null;
let currentCtx = null; // { email, mines, nameField, department }

function stateKey(email, mineName) {
  return `${STATE_KEY_PREFIX}${email}__${mineName}`;
}

function getLastState(email, mineName) {
  try { return JSON.parse(localStorage.getItem(stateKey(email, mineName)) || 'null'); } catch { return null; }
}

function setLastState(email, mineName, state) {
  try { localStorage.setItem(stateKey(email, mineName), JSON.stringify(state)); } catch { /* بی‌اثر */ }
}

async function insertPresenceEvent(row) {
  const { error } = await sb.from('mine_presence_events').insert([row]);
  if (error) throw new Error(error.message);
}
registerSender('minePresenceEvent', insertPresenceEvent);

async function notifyAdmin(eventType, mineName, occurredAt, durationMinutes) {
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const jwt = sessionData && sessionData.session ? sessionData.session.access_token : null;
    if (!jwt) return;
    // نکته: اگر این تابع در پس‌زمینه (بعد از ۵ دقیقه) صدا زده شود، ممکن است اندروید همین fetch
    // خام WebView را کند/محدود کند — تاخیر در رسیدن اعلان فوری به ادمین را باید در نظر داشت،
    // ولی خودِ ثبت رویداد (بالاتر) مستقل از این fetch و قبلاً انجام/صف شده است.
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ action: 'mineBoundaryEvent', eventType, mineName, occurredAt, durationMinutes }),
    });
  } catch { /* اعلان ناموفق نباید ثبت رویداد را متوقف کند — قبلاً در mine_presence_events ثبت/صف شده */ }
}

async function recordTransition({ email, mineName, department }, eventType, coords) {
  const occurredAt = new Date().toISOString();
  const row = {
    email, mine_name: mineName, department, event_type: eventType,
    lat: coords?.latitude ?? null, lon: coords?.longitude ?? null, accuracy: coords?.accuracy ?? null,
    occurred_at: occurredAt,
  };
  let durationMinutes = null;
  if (eventType === 'exit') {
    const prev = getLastState(email, mineName);
    if (prev && prev.state === 'inside' && prev.since) durationMinutes = (Date.now() - prev.since) / 60000;
  }
  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    await insertPresenceEvent(row);
  } catch (err) {
    if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
      await queueOfflineSubmission({ id: newQueueId('mpe'), type: 'minePresenceEvent', payload: row, queuedAt: Date.now() });
    }
    // خطاهای دیگر (مثلاً RLS) بی‌صدا رد می‌شوند — این یک ناظر پس‌زمینه است و نباید UI را مختل کند
  }
  notifyAdmin(eventType, mineName, occurredAt, durationMinutes);
}

function handleCoords(coords) {
  if (!currentCtx) return;
  const { email, mines, nameField, department } = currentCtx;
  mines.forEach((mine) => {
    const mineName = mine[nameField];
    if (!mineName) return;
    const inside = isInsideMineBoundary(coords, mine);
    const prev = getLastState(email, mineName);
    const wasInside = prev?.state === 'inside';
    if (inside && !wasInside) {
      setLastState(email, mineName, { state: 'inside', since: Date.now() });
      recordTransition({ email, mineName, department }, 'enter', coords);
    } else if (!inside && wasInside) {
      setLastState(email, mineName, { state: 'outside', since: Date.now() });
      recordTransition({ email, mineName, department }, 'exit', coords);
    }
  });
}

/** باید بعد از مشخص شدن معدن‌های اختصاص‌یافته به مسئول فنی/ایمنی/بهداشت صدا زده شود (main.js). */
export function startMineGeofenceWatcher({ email, mines, nameField, department }) {
  currentCtx = { email, mines, nameField, department };
  if (!unsubscribe) unsubscribe = onGpsUpdate(handleCoords);
  // بی‌صدا رد می‌شود اگر پلاگین نصب/sync نشده باشد یا در وب اجرا شود — ناظر بالا (onGpsUpdate)
  // به‌تنهایی همان پوشش قبلی (وقتی اپ باز/تازه‌پس‌زمینه است) را می‌دهد.
  startBackgroundGeofenceWatcher(handleCoords).catch(() => {});
}

export function stopMineGeofenceWatcher() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  stopBackgroundGeofenceWatcher().catch(() => {});
  currentCtx = null;
}

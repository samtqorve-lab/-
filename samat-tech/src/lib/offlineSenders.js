import { getQueuedSubmissions, trySyncQueuedItems } from './offlineQueue.js';

/**
 * هر نوع آیتم در صف آفلاین فقط وقتی ارسال می‌شود که تابع ارسال‌ِ همان نوع ثبت (registerSender) شده
 * باشد؛ ولی بیشتر این توابع داخل ماژول‌هایی هستند که فقط با import() پویا و وقتی کاربر همان دکمه را
 * می‌زند بارگذاری می‌شوند. نتیجه: گزارش/عکسی که آفلاین ذخیره شده بود، بعد از وصل شدن اینترنت (یا
 * باز کردن دوباره‌ی اپ) تا وقتی کاربر خودش همان بخش را باز نمی‌کرد هیچ‌وقت ارسال نمی‌شد.
 *
 * این تابع فقط وقتی چیزی در صف هست، دقیقاً ماژول‌های لازم برای نوع‌های موجود در صف را بارگذاری
 * می‌کند (پس وقتی صف خالی است هیچ هزینه‌ی اضافه‌ای ندارد) و بعد یک دور همگام‌سازی اجرا می‌کند.
 */
const LOADERS = {
  incident: () => import('../modules/techOfficer/incidentModal.js'),
  techReport: () => import('../modules/techOfficer/monthlyReport.js'),
  safetyChecklist: () => import('../modules/techOfficer/safetyChecklist.js'),
  equipmentPhoto: () => import('../modules/techOfficer/equipmentSubmit.js'),
  coreBoxPhoto: () => import('../modules/techOfficer/coreBoxLog.js'),
  explorationSitePhoto: () => import('../modules/techOfficer/explorationSitePhotos.js'),
  explorationSampleRegister: () => import('../modules/techOfficer/explorationSampleCustody.js'),
  explorationSampleStatusUpdate: () => import('../modules/techOfficer/explorationSampleCustody.js'),
  stockpilePhoto: () => import('../modules/techOfficer/stockpilePhoto.js'),
  processingSitePhoto: () => import('../modules/techOfficer/processingSitePhotos.js'),
  roleChecklist: () => import('../modules/safetyOfficer/roleChecklist.js'),
  ownerChecklist: () => import('../modules/owner/panel.js'),
};

// برای هر نوعی که در جدول بالا نیست (مثلاً ماژول‌هایی که نوع خودشان را جداگانه ثبت می‌کنند)،
// همه‌ی این ماژول‌ها یک‌بار بارگذاری می‌شوند تا هرکدام نوع خودش را ثبت کند.
const FALLBACK = [
  () => import('../modules/techOfficer/strikeDip.js'),
  () => import('../modules/techOfficer/traverse.js'),
  () => import('../modules/techOfficer/explorationLog.js'),
  () => import('../modules/techOfficer/explorationProgress.js'),
  () => import('../modules/techOfficer/processingReport.js'),
  () => import('../modules/techOfficer/processingConsumption.js'),
  () => import('../modules/techOfficer/processingTailingsDam.js'),
  () => import('../modules/techOfficer/qrCheckin.js'),
];

// نوع‌هایی که خودِ main.js همان لحظه‌ی بوت ثبت می‌کند
const BUILTIN = new Set(['identityVerification']);

/**
 * بعد از ورود موفق (وقتی نشست معتبر است) صدا بزنید. هرگز خطا پرتاب نمی‌کند.
 * @param {(msg: string) => void} showToastFn
 */
export async function flushOfflineQueueAfterLogin(showToastFn) {
  try {
    const pending = (await getQueuedSubmissions()).filter((i) => !i.failed);
    if (!pending.length) return;
    const types = [...new Set(pending.map((i) => i.type))].filter((t) => !BUILTIN.has(t));
    const loaders = new Set();
    let needFallback = false;
    types.forEach((t) => { if (LOADERS[t]) loaders.add(LOADERS[t]); else needFallback = true; });
    if (needFallback) FALLBACK.forEach((l) => loaders.add(l));
    await Promise.allSettled([...loaders].map((l) => l()));
    await trySyncQueuedItems(false, showToastFn);
  } catch {
    // best-effort: ناموفق بودن اینجا نباید روی بالا آمدن اپ اثر بگذارد
  }
}

import { Capacitor } from '@capacitor/core';
import { showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getGeoLocation, isInsideMineBoundary } from '../../lib/geo.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError, registerSender } from '../../lib/offlineQueue.js';

async function sendQrCheckinPayload(p) {
  const { error } = await sb.from('qr_checkins').insert([{
    mine_name: p.mineName, submitted_by: p.submittedBy, department: p.department,
    lat: p.lat, lon: p.lon, inside_boundary: p.insideBoundary,
  }]);
  if (error) throw new Error(error.message);
}
registerSender('qrCheckin', sendQrCheckinPayload);

/**
 * اسکن کد QR ثابت سر درِ ورودی معدن برای تایید حضور فیزیکی — مکمل GPS (که به‌تنهایی با ابزارهای
 * تقلب موقعیت مکانی قابل جعل است، ولی نیاز به ایستادن واقعی جلوی برگه‌ی چاپ‌شده را نمی‌شود جعل کرد).
 * @param {object} mine رکورد معدن انتخاب‌شده (باید فیلد «کد_ورود_QR» را داشته باشد)
 */
export async function scanQrCheckin(mine, nameField, department) {
  if (!Capacitor.isNativePlatform()) {
    showToast('⚠️ اسکن QR فقط داخل اپ نصب‌شده روی اندروید در دسترس است');
    return;
  }
  const expectedToken = mine['کد_ورود_QR'];
  if (!expectedToken) {
    showToast('⚠️ برای این معدن هنوز کد QR ورود از پنل ادمین ساخته نشده');
    return;
  }

  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
  const { camera } = await BarcodeScanner.requestPermissions();
  if (camera !== 'granted' && camera !== 'limited') {
    showToast('⚠️ دسترسی دوربین لازم است — از تنظیمات گوشی مجوز بدهید');
    return;
  }

  let result;
  try {
    result = await BarcodeScanner.scan({ formats: [] });
  } catch (err) {
    showToast(`⚠️ اسکن ناموفق بود: ${err.message}`);
    return;
  }
  const scanned = result.barcodes?.[0]?.rawValue || result.barcodes?.[0]?.displayValue;
  if (!scanned) {
    showToast('⚠️ چیزی اسکن نشد');
    return;
  }
  if (scanned !== expectedToken) {
    showToast('❌ این کد QR متعلق به این معدن نیست — مطمئن شوید معدن درست را از بالای صفحه انتخاب کرده‌اید');
    return;
  }

  showToast('⏳ در حال دریافت موقعیت مکانی...');
  let coords = null;
  try {
    coords = await getGeoLocation();
  } catch {
    // موقعیت مکانی اختیاری است؛ خودِ تایید QR مهم‌تر از مختصات همراهش است
  }

  const { data: { session } } = await sb.auth.getSession();
  const payload = {
    mineName: mine[nameField], department, submittedBy: session?.user?.email || '',
    lat: coords?.latitude, lon: coords?.longitude,
    insideBoundary: coords ? isInsideMineBoundary(coords, mine) : null,
  };

  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    await sendQrCheckinPayload(payload);
    showToast('✅ حضور شما در این معدن تایید و ثبت شد');
  } catch (err) {
    if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
      await queueOfflineSubmission({ id: newQueueId('qr'), type: 'qrCheckin', payload, queuedAt: Date.now() });
      showToast('📴 اینترنت وصل نیست — تایید حضور ذخیره شد و بعداً خودکار ارسال می‌شود');
    } else {
      showToast(`⚠️ ثبت ناموفق بود: ${err.message}`);
    }
  }
}

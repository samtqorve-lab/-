import { sb } from '../../lib/supabase.js';
import { uploadTechFile } from '../../lib/storage.js';
import { registerSender } from '../../lib/offlineQueue.js';

// جدا از UI چک‌لیست (equipmentChecklist.js) تا هم مسیر آنلاین مستقیم و هم sync بعدی از صف
// آفلاین از همین استفاده کنند، و هم صفحه‌ی اصلی (که همیشه بارگذاری می‌شود) مجبور نباشد کل UI
// چک‌لیست تجهیزات پیش‌فرض را هم دانلود کند فقط برای همین یک تابع کوچک.
export async function sendEquipmentPhotoPayload(p) {
  const photoUrl = await uploadTechFile(p.photoBlob, `equip_${p.deviceKey}_${p.photoType}.jpg`, p.mineName, 'equipment', 'equip_submit');
  const { error } = await sb.from('mine_equipment').insert([{
    mine_name: p.mineName, submitted_by: p.submittedBy,
    machine_type: p.machineType, plate_no: p.plateNo, photo_url: photoUrl, photo_type: p.photoType, device_key: p.deviceKey,
    serial_no: p.serialNo || null,
    lat: p.lat, lon: p.lon, inside_boundary: p.insideBoundary, department: p.department,
    status: p.insideBoundary ? 'approved' : 'pending',
    reviewed_by: p.insideBoundary ? 'تایید خودکار (داخل محدوده معدن)' : null,
    reviewed_at: p.insideBoundary ? new Date().toISOString() : null,
  }]);
  if (error) throw new Error(error.message);
}
registerSender('equipmentPhoto', sendEquipmentPhotoPayload);

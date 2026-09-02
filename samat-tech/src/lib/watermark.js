export async function loadScaledImage(file, maxDim = 1600) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = URL.createObjectURL(file);
  });
  let w = img.naturalWidth; let h = img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas;
}

/**
 * فقط متن واترمارک را روی یک canvas از قبل موجود می‌کشد (بدون تبدیل به Blob) — هم برای عکس نهایی
 * استفاده می‌شود (بعد گرفتنش toBlob می‌گیریم) و هم برای پیش‌نمایش زنده‌ی دوربین (هر بار که GPS
 * به‌روز می‌شود، همین تابع روی یک canvas کوچک‌تر جهت پیش‌نمایش دوباره صدا زده می‌شود).
 */
export function paintWatermark(canvas, lines) {
  const ctx = canvas.getContext('2d');
  const fontSize = Math.max(16, Math.round(canvas.width / 42));
  const lineH = Math.round(fontSize * 1.5);
  const boxH = lineH * lines.length + 16;
  // به‌جای نوار مستطیلی سیاه پشت متن، فقط از سایه/دور خط سیاه دور خود حروف استفاده می‌کنیم —
  // متن روی خودِ عکس خوانا می‌ماند بدون این‌که پس‌زمینه‌ی صفحه‌ی عکس را بپوشاند.
  ctx.font = `${fontSize}px Tahoma, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.direction = 'rtl';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    const y = canvas.height - boxH + 8 + i * lineH;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = Math.max(2, Math.round(fontSize / 7));
    ctx.strokeText(line, canvas.width - 12, y, canvas.width - 24);
    ctx.fillStyle = '#fff';
    ctx.fillText(line, canvas.width - 12, y, canvas.width - 24);
  });
}

function canvasToJpegBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88));
}

export function watermarkLinesForIdentity(coords, mine, nameField) {
  const now = new Date();
  return [
    `🦺 احراز هویت مسئول فنی — ${mine[nameField] || '-'}`,
    coords ? `📍 ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}  (دقت ~${Math.round(coords.accuracy)}م)` : '📍 در حال دریافت GPS...',
    `🕒 ${now.toLocaleString('fa-IR')}`,
  ];
}

// نام فیلد پروانه/تاریخ صدور بسته به تخصص مسئول فنی فرق می‌کند (دقیقاً همان نگاشتی که در
// samat-tech/src/lib/textMatch.js و mineCards.js هم استفاده شده) — قبلاً اینجا فقط فیلدهای
// «معدن» (استخراج) هاردکد شده بود، پس برای مسئولین فنی اکتشاف/فرآوری این خطوط همیشه «-» نشان
// می‌داد چون آن فیلدها روی رکورد آن‌ها اصلاً وجود ندارد.
const LICENSE_FIELDS_BY_NAME_FIELD = {
  نام_معدن: { license: 'شماره_پروانه', date: 'تاریخ_پروانه' },
  نام_متقاضی: { license: 'شماره_پروانه_اکتشاف', date: 'تاریخ_صدور' },
  نام_واحد: { license: 'شماره_پروانه_بهره_برداری', date: 'تاریخ_صدور' },
};

export function watermarkLinesForPhoto(coords, mine, typeLabel, fullName, membershipNo, nameField = 'نام_معدن') {
  const now = new Date();
  const lic = LICENSE_FIELDS_BY_NAME_FIELD[nameField] || LICENSE_FIELDS_BY_NAME_FIELD.نام_معدن;
  return [
    `⛏️ ${mine[nameField] || '-'}${typeLabel ? `   |   🏷️ نوع عکس: ${typeLabel}` : ''}`,
    `📜 پروانه: ${mine[lic.license] || '-'}   تاریخ: ${mine[lic.date] || '-'}`,
    `🗺️ کاداستر: ${mine['کد_کاداستر'] || '-'}`,
    coords ? `📍 ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}  (دقت ~${Math.round(coords.accuracy)}م)` : '📍 در حال دریافت GPS...',
    `👤 ${fullName || '-'}   عضویت نظام مهندسی: ${membershipNo || '-'}`,
    `🕒 ${now.toLocaleString('fa-IR')}`,
  ];
}

export async function watermarkIdentityPhoto(file, coords, mine, nameField) {
  const canvas = await loadScaledImage(file, 1600);
  paintWatermark(canvas, watermarkLinesForIdentity(coords, mine, nameField));
  return canvasToJpegBlob(canvas);
}

export async function watermarkPhoto(file, coords, mine, typeLabel, fullName, membershipNo, nameField) {
  const canvas = await loadScaledImage(file, 1600);
  paintWatermark(canvas, watermarkLinesForPhoto(coords, mine, typeLabel, fullName, membershipNo, nameField));
  return canvasToJpegBlob(canvas);
}

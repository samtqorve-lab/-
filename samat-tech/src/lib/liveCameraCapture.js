import { el } from './dom.js';
import { paintWatermark } from './watermark.js';
import { getWarmCoords, onGpsUpdate, startGpsPrewarm } from './geo.js';

// چون مسئول فنی می‌خواست موقع خودِ عکس‌گرفتن، واترمارک را ببیند (نه فقط بعدش)، این ماژول به‌جای
// دادن کار به اپ دوربین گوشی (`<input capture>` — که هیچ کنترلی روی نمای زنده نمی‌دهد)، مستقیم
// از دوربین گوشی از طریق getUserMedia استریم می‌گیرد و یک صفحه‌ی تمام‌صفحه‌ی خودمان می‌سازد:
// نمای زنده‌ی دوربین + متن واترمارک روی همان نما (که هر چند ثانیه با آخرین GPS به‌روز می‌شود) +
// وضعیت داخل/خارج محدوده (اگر callback داده شود) — دقیقاً همان چیزی که موقع فشردن دکمه‌ی ثبت،
// روی خود عکس هم می‌ماند، پس بازخورد لحظه‌ای واقعی است، نه یک شبیه‌سازی جدا.

export function liveCameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * @param {{ buildLines: (coords: GeolocationCoordinates|null) => string[], checkInside?: (coords: GeolocationCoordinates) => boolean }} opts
 * @returns {Promise<{ blob: Blob, coords: GeolocationCoordinates|null, inside: boolean|null }>}
 * در صورت انصراف کاربر، Promise با پیام 'CANCELLED' reject می‌شود (نه یک خطای واقعی).
 */
export function captureLivePhoto({ buildLines, checkInside }) {
  return new Promise((resolve, reject) => {
    let stream = null;
    let unsubscribeGps = null;
    let latestCoords = getWarmCoords(); // اگر پیش‌گرم‌سازی از قبل روشن بوده، شاید همین اول یک خوانش خوب آماده باشد
    let cleaned = false;

    const video = el('video', { autoplay: true, playsinline: true, muted: true, style: 'flex:1;width:100%;object-fit:cover;background:#000;min-height:0' });
    // ست‌کردن attribute برای muted/playsinline کافی نیست (بعضی مرورگرها، مخصوصاً سافاری، فقط به
    // property مستقیم روی خود عنصر ویدیو اعتماد می‌کنند)؛ بدون این، سیاست‌های autoplay ممکن است
    // پخش نمای زنده را کلاً مسدود کنند.
    video.muted = true;
    video.playsInline = true;
    const overlayTextBox = el('div', {
      style: 'position:absolute;bottom:96px;left:0;right:0;background:rgba(0,0,0,.62);color:#fff;padding:10px 12px;'
        + 'font-size:12.5px;line-height:1.9;text-align:right;direction:rtl;pointer-events:none',
    });
    const statusLine = el('div', {
      style: 'position:absolute;top:calc(10px + env(safe-area-inset-top));right:12px;left:12px;display:flex;justify-content:space-between;'
        + 'font-size:12px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)',
    }, [el('span', {}, '📷 در حال باز کردن دوربین...'), el('span', {})]);
    const [gpsStatusSpan, boundaryStatusSpan] = statusLine.children;

    function updateOverlay() {
      overlayTextBox.innerHTML = '';
      buildLines(latestCoords).forEach((l) => overlayTextBox.append(el('div', {}, l)));
      gpsStatusSpan.textContent = latestCoords ? `📡 دقت GPS: ~${Math.round(latestCoords.accuracy)} متر` : '📡 در حال دریافت GPS...';
      if (latestCoords && captureBtn.disabled) { captureBtn.disabled = false; captureBtn.style.opacity = '1'; }
      if (checkInside && latestCoords) {
        const inside = checkInside(latestCoords);
        boundaryStatusSpan.textContent = inside ? '✅ داخل محدوده' : '⚠️ خارج از محدوده';
        boundaryStatusSpan.style.color = inside ? '#8bd3a8' : '#ffb199';
      }
    }
    updateOverlay();

    const captureBtn = el('button', {
      style: 'width:68px;height:68px;border-radius:50%;background:#fff;border:4px solid rgba(255,255,255,.4);cursor:pointer;opacity:.4',
    });
    captureBtn.disabled = true; // تا اولین خوانش GPS نرسیده، فعال نمی‌شود — وگرنه ممکن است متن
    // «در حال دریافت GPS» یا مختصات خالی برای همیشه روی خود عکس نهایی ثبت شود.
    const cancelBtn = el('button', {
      style: 'background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:20px;padding:8px 16px;font-size:12px;cursor:pointer',
    }, '✕ انصراف');
    const controlsRow = el('div', {
      style: 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px calc(16px + env(safe-area-inset-bottom));background:#000',
    }, [el('div', { style: 'width:70px' }), captureBtn, cancelBtn]);

    const overlay = el('div', { style: 'position:fixed;inset:0;background:#000;z-index:500;display:flex;flex-direction:column' }, [
      el('div', { style: 'position:relative;flex:1;min-height:0;overflow:hidden' }, [video, overlayTextBox, statusLine]),
      controlsRow,
    ]);
    document.body.append(overlay);

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (unsubscribeGps) unsubscribeGps();
      overlay.remove();
    }

    cancelBtn.addEventListener('click', () => { cleanup(); reject(new Error('CANCELLED')); });

    captureBtn.addEventListener('click', async () => {
      if (!video.videoWidth) return;
      captureBtn.disabled = true;
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      paintWatermark(canvas, buildLines(latestCoords));
      const blob = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.88));
      const inside = checkInside && latestCoords ? checkInside(latestCoords) : null;
      cleanup();
      resolve({ blob, coords: latestCoords, inside });
    });

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false })
      .then((s) => {
        if (cleaned) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        video.srcObject = s;
        video.play().catch(() => {}); // بعضی مرورگرها فقط با فراخوانی صریح play() واقعاً پخش را شروع می‌کنند
        gpsStatusSpan.textContent = '📡 در حال دریافت GPS...';
      })
      .catch((err) => {
        cleanup();
        reject(new Error(`دسترسی به دوربین ممکن نشد: ${err.message}`));
      });

    startGpsPrewarm(); // اگر به هر دلیل هنوز روشن نشده
    unsubscribeGps = onGpsUpdate((coords) => { latestCoords = coords; updateOverlay(); });
    if (latestCoords) updateOverlay(); // اگر خوانش پیش‌گرم از قبل موجود بود، همین اول نشانش بده
  });
}

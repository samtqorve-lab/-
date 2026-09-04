import { el, showToast } from '../../lib/dom.js';
import { getAccurateGeoLocation, isInsideMineBoundary, getOrCreateDeviceId } from '../../lib/geo.js';
import { watermarkIdentityPhoto, watermarkLinesForIdentity } from '../../lib/watermark.js';
import { captureLivePhoto, liveCameraSupported } from '../../lib/liveCameraCapture.js';
import { submitIdentityVerification } from '../../lib/identity.js';
import { queueOfflineSubmission, newQueueId, isLikelyNetworkError } from '../../lib/offlineQueue.js';

export function mountIdentityPending(root, message, onLogout) {
  root.innerHTML = '';
  root.append(el('div', { class: 'gate-screen' }, el('div', { class: 'gate-card' }, [
    el('div', { style: 'text-align:center' }, [
      el('div', { style: 'font-size:32px' }, '⏳'),
      el('div', { style: 'margin-top:8px;font-size:var(--text-sm)' }, message),
    ]),
    el('button', { class: 'btn btn-ghost', style: 'margin-top:14px', onclick: onLogout }, 'خروج'),
  ])));
}

export function mountIdentityQueuedOffline(root, onRetryOrContinue) {
  root.innerHTML = '';
  root.append(el('div', { class: 'gate-screen' }, el('div', { class: 'gate-card' }, [
    el('div', { style: 'text-align:center' }, [
      el('div', { style: 'font-size:32px' }, '📥'),
      el('div', { style: 'margin-top:8px;font-size:var(--text-sm)' },
        'عکس شما چون اینترنت وصل نبود، روی همین گوشی ذخیره شد. به‌محض وصل‌شدن اینترنت، خودکار ارسال می‌شود — لازم نیست کاری بکنید، فقط اپ را باز نگه دارید یا بعداً دوباره باز کنید.'),
    ]),
    el('button', { class: 'btn btn-primary', style: 'margin-top:14px', onclick: onRetryOrContinue }, 'متوجه شدم'),
  ])));
}

export function mountIdentityCapture(root, { email, mines, captureKind, reason, nameField, boundaryExempt }, onDone, onQueuedOffline) {
  root.innerHTML = '';
  let capturedBlob = null;
  let capturedCoords = null;
  let capturedInsideBoundary = false;

  const mineSelect = el('select', {}, mines.length
    ? mines.map((m) => el('option', { value: m[nameField] }, m[nameField]))
    : [el('option', { value: '' }, '— معدنی برای شما ثبت نشده —')]);

  const preview = el('div', { style: 'text-align:center;margin:10px 0' });
  const errBox = el('div', { class: 'gate-err' });
  const accuracyBox = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);text-align:center;min-height:16px' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  const captureBtn = el('button', { class: 'btn btn-ghost' }, '📷 گرفتن عکس با دوربین');

  function acceptCapture(blob, coords, inside, mineName) {
    if (!inside) {
      errBox.textContent = coords && coords.accuracy > 25
        ? `⚠️ شما داخل محدوده قانونی معدن «${mineName}» نیستید (دقت GPS این خوانش ~${Math.round(coords.accuracy)} متر بود — اگر مطمئنید داخل محدوده‌اید، چند قدم جابه‌جا شوید و در فضای بازتر دوباره امتحان کنید).`
        : `⚠️ شما داخل محدوده قانونی معدن «${mineName}» نیستید. لطفاً داخل محدوده معدن این عکس را بگیرید.`;
      return;
    }
    capturedBlob = blob;
    capturedCoords = coords;
    capturedInsideBoundary = inside;
    preview.innerHTML = '';
    preview.append(el('img', { src: URL.createObjectURL(capturedBlob), style: 'width:130px;height:130px;object-fit:cover;border-radius:12px;border:1px solid var(--stone-300)' }));
    showToast('✅ عکس داخل محدوده معدن ثبت شد');
  }

  captureBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    const mineName = mineSelect.value;
    const mine = mines.find((m) => m[nameField] === mineName);
    if (!mine) { errBox.textContent = 'ابتدا معدن را انتخاب کنید'; return; }

    if (liveCameraSupported()) {
      try {
        const { blob, coords, inside } = await captureLivePhoto({
          buildLines: (c) => watermarkLinesForIdentity(c, mine, nameField),
          checkInside: (c) => isInsideMineBoundary(c, mine),
          defaultFacingMode: 'user', // عکس احراز هویت یک سلفی از خودِ کاربر است — دوربین جلو پیش‌فرض باشد
        });
        acceptCapture(blob, coords, inside, mineName);
        return;
      } catch (err) {
        if (err.message === 'CANCELLED') return;
        // دسترسی به دوربین زنده ممکن نشد (مثلاً کاربر اجازه نداد) — به همان روش قدیمی برمی‌گردیم
        showToast(`⚠️ دوربین زنده در دسترس نبود؛ از حالت معمولی استفاده می‌شود (${err.message})`);
      }
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    errBox.textContent = '';
    if (file.lastModified && (Date.now() - file.lastModified) > 3 * 60 * 1000) {
      errBox.textContent = '⚠️ لطفاً همین الان با دوربین یک عکس جدید بگیرید؛ انتخاب عکس قدیمی یا ذخیره‌شده از گالری مجاز نیست.';
      fileInput.value = ''; return;
    }
    const mineName = mineSelect.value;
    const mine = mines.find((m) => m[nameField] === mineName);
    if (!mine) { errBox.textContent = 'ابتدا معدن را انتخاب کنید'; fileInput.value = ''; return; }
    accuracyBox.textContent = '⏳ در حال دریافت موقعیت مکانی — چند ثانیه صبر کنید تا دقت GPS بهتر شود...';
    try {
      const coords = await getAccurateGeoLocation({
        targetAccuracyM: 20,
        onProgress: (c) => { accuracyBox.textContent = `📡 در حال بهبود دقت GPS... (دقت فعلی: ~${Math.round(c.accuracy)} متر)`; },
      });
      accuracyBox.textContent = `📍 دقت نهایی GPS: ~${Math.round(coords.accuracy)} متر`;
      const inside = isInsideMineBoundary(coords, mine);
      // مسئول فنی معاف‌شده (فقط با تایید سوپرادمین از پنل ادمین) از این بلوکِ سخت‌گیرانه رد
      // می‌شود — برخلاف بقیه‌ی محدودیت‌های GPS در اپ (چک‌لیست، QR ورود و غیره) که دست‌نخورده
      // باقی می‌مانند؛ این معافیت فقط مخصوص خودِ عکس احراز هویت است.
      if (!inside && !boundaryExempt) {
        errBox.textContent = coords.accuracy > 25
          ? `⚠️ شما داخل محدوده قانونی معدن «${mineName}» نیستید (دقت GPS این خوانش ~${Math.round(coords.accuracy)} متر بود — اگر مطمئنید داخل محدوده‌اید، چند قدم جابه‌جا شوید و در فضای بازتر دوباره امتحان کنید).`
          : `⚠️ شما داخل محدوده قانونی معدن «${mineName}» نیستید. لطفاً داخل محدوده معدن این عکس را بگیرید.`;
        fileInput.value = ''; return;
      }
      const blob = await watermarkIdentityPhoto(file, coords, mine, nameField);
      acceptCapture(blob, coords, inside, mineName);
    } catch (err) {
      errBox.textContent = err.message;
    }
    fileInput.value = '';
  });

  const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, '📤 ارسال برای تایید');
  submitBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (!capturedBlob || !capturedCoords) { errBox.textContent = 'ابتدا عکس را داخل محدوده معدن بگیرید'; return; }
    if (!mineSelect.value) { errBox.textContent = 'معدن را انتخاب کنید'; return; }
    submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال ارسال...';
    const payload = {
      email, mineName: mineSelect.value, kind: captureKind, blob: capturedBlob,
      lat: capturedCoords.latitude, lon: capturedCoords.longitude, insideBoundary: capturedInsideBoundary, deviceId: getOrCreateDeviceId(),
    };
    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      await submitIdentityVerification(payload);
      showToast('✅ عکس ارسال شد — در انتظار تایید مدیر سامانه');
      onDone();
    } catch (err) {
      if (err.message === 'OFFLINE' || isLikelyNetworkError(err)) {
        try {
          await queueOfflineSubmission({ id: newQueueId('idv'), type: 'identityVerification', payload, queuedAt: Date.now() });
          showToast('📥 اینترنت وصل نیست — عکس ذخیره شد و به‌محض اتصال خودکار ارسال می‌شود');
          onQueuedOffline();
          return;
        } catch (qErr) {
          errBox.textContent = `ذخیره‌ی موقت هم ناموفق بود: ${qErr.message}`;
        }
      } else {
        errBox.textContent = err.message;
      }
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = '📤 ارسال برای تایید';
    }
  });

  const card = el('div', { class: 'gate-card' }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'org' }, 'اداره صنعت، معدن و تجارت قروه'),
      el('div', { class: 'app' }, captureKind === 'monthly' ? '📸 احراز هویت ماهانه (اجباری)' : '📸 احراز هویت مسئول فنی'),
    ]),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' },
      captureKind === 'monthly'
        ? 'طبق سیاست سامانه، هر ماه یک‌بار باید داخل محدوده معدن یک عکس از خودتان بگیرید تا حضورتان تایید شود.'
        : 'برای دسترسی به سامانه، ابتدا باید داخل محدوده قانونی معدنی که مسئول آن هستید یک عکس از خودتان بگیرید.'),
    reason ? el('div', { style: 'color:var(--rust-600);font-size:var(--text-xs);margin-bottom:8px' }, `❌ عکس قبلی رد شد: ${reason}`) : null,
    el('label', {}, 'معدن'), mineSelect,
    captureBtn, fileInput, accuracyBox, preview,
    errBox, submitBtn,
  ]);
  root.append(el('div', { class: 'gate-screen' }, card));
}

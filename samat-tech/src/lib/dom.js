// توابع کمکی مشترک — معادل توابع esc/showToast/... که قبلاً داخل فایل تک‌HTML تکرار می‌شدند

export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastTimer = null;
export function showToast(message) {
  let box = document.getElementById('toastBox');
  if (!box) {
    // بالاتر از تب‌بار پایین (۵۴ پیکسل + safe-area) نمایش داده می‌شود تا روی آن نیفتد
    box = el('div', {
      id: 'toastBox',
      style: 'position:fixed;bottom:calc(72px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:999;background:#262626;color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;box-shadow:var(--shadow-lg);opacity:0;transition:opacity .2s;max-width:90vw;text-align:center',
    });
    document.body.append(box);
  }
  box.textContent = message;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => { box.style.opacity = '1'; });
  toastTimer = setTimeout(() => { box.style.opacity = '0'; }, 2600);
}

export function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('fa-IR'); } catch { return '—'; }
}

/** برخلاف تاریخ‌های شمسیِ رکوردهای معدن، این برای فیلدهای `<input type="date">` (میلادی خالص) است — مثل تاریخ انقضای پروانه اشتغال کاربران. */
export function simpleDateStatus(dateStr, warnDays = 60) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const daysLeft = Math.round((d.getTime() - Date.now()) / 86400000);
  return { daysLeft, expired: daysLeft < 0, soon: daysLeft >= 0 && daysLeft <= warnDays };
}

/**
 * یک فیلد رمز عبور با دکمه‌ی چشمک (نمایش/مخفی‌کردن) کنارش می‌سازد.
 * @returns {{ wrap: HTMLElement, input: HTMLElement }}
 */
export function passwordFieldWithToggle(attrs = {}) {
  const input = el('input', { type: 'password', ...attrs, style: 'padding-right:38px' });
  const toggleBtn = el('button', {
    type: 'button',
    'aria-label': 'نمایش/مخفی‌کردن رمز عبور',
    style: 'position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:15px;padding:4px;color:var(--stone-500)',
    onclick: () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggleBtn.textContent = showing ? '👁' : '🙈';
    },
  }, '👁');
  const wrap = el('div', { style: 'position:relative' }, [input, toggleBtn]);
  return { wrap, input };
}

/**
 * یک مودال (شیت پایین‌آمدنی به سبک اینستاگرام؛ روی صفحه‌ی عریض وسط صفحه) می‌سازد و به body اضافه می‌کند.
 * ظاهرش در کلاس‌های .ig-overlay / .ig-sheet داخل components.css تعریف شده.
 * @returns {{ overlay: HTMLElement, body: HTMLElement, close: () => void }}
 */
export function openModal({ title, width = '480px' }) {
  const overlay = el('div', {
    class: 'ig-overlay',
    onclick: (e) => { if (e.target === overlay) close(); },
  });
  const body = el('div', { class: 'modal-body' });
  const card = el('div', { class: 'ig-sheet', style: `max-width:${width}` }, [
    el('div', { class: 'ig-sheet-grab' }),
    el('div', { class: 'ig-sheet-head' }, [
      el('h3', {}, title || ''),
      el('button', { class: 'ig-icon-btn', type: 'button', 'aria-label': 'بستن', onclick: () => close() }, '✕'),
    ]),
    body,
  ]);
  overlay.append(card);
  document.body.append(overlay);

  function close() {
    overlay.remove();
  }
  return { overlay, body, close };
}

/**
 * نمایش تمام‌صفحه‌ی یک عکس در اندازه‌ی واقعی خودش (object-fit:contain، نه cover) — قبلاً کلیک
 * روی هیچ‌کدام از thumbnailهای ۵۶ تا ۱۳۰ پیکسلی عکس‌های ثبت‌شده (تجهیزات، چک‌لیست ایمنی، حوادث،
 * احراز هویت) هیچ واکنشی نداشت. برای استفاده: روی هر <img> کوچک، onclick: () => openImageViewer(src) بگذارید.
 */
export function openImageViewer(src) {
  const overlay = el('div', {
    style: 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px',
    onclick: () => overlay.remove(),
  }, [
    el('img', { src, style: 'max-width:100%;max-height:100%;object-fit:contain;border-radius:4px' }),
    el('button', {
      style: 'position:absolute;top:calc(12px + env(safe-area-inset-top));left:16px;background:rgba(255,255,255,.15);color:#fff;'
        + 'border:1px solid rgba(255,255,255,.4);border-radius:50%;width:38px;height:38px;font-size:16px;cursor:pointer',
      onclick: () => overlay.remove(),
    }, '✕'),
  ]);
  document.body.append(overlay);
}

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
    box = el('div', {
      id: 'toastBox',
      style: 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:999;background:var(--ink-900);color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;box-shadow:var(--shadow-lg);opacity:0;transition:opacity .2s',
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
 * یک مودال ساده (overlay + کارت) می‌سازد و به body اضافه می‌کند.
 * @returns {{ overlay: HTMLElement, body: HTMLElement, close: () => void }}
 */
export function openModal({ title, width = '480px' }) {
  const overlay = el('div', {
    style: 'position:fixed;inset:0;background:rgba(28,27,23,.5);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px',
    onclick: (e) => { if (e.target === overlay) close(); },
  });
  const body = el('div', { class: 'modal-body' });
  const card = el('div', {
    style: `width:100%;max-width:${width};max-height:88vh;overflow-y:auto;background:#fff;border-radius:var(--radius-lg);padding:var(--space-5);box-shadow:var(--shadow-lg)`,
  }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px' }, [
      el('h3', {}, title || ''),
      el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700)', onclick: () => close() }, '✖'),
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

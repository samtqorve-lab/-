import { el } from './dom.js';

/**
 * اسلایدر مقایسه‌ی دو عکس با کشیدن یک خط جداکننده — جایگزین نمایش «کنار هم» قبلی که مقایسه‌ی
 * دقیق تغییرات (مثلاً گسترش محدوده‌ی معدن) را سخت می‌کرد؛ با این ابزار می‌شود دقیقاً روی یک نقطه
 * نگه داشت و بین قبل/بعد جابه‌جا کرد.
 * @param {string} beforeUrl آدرس عکسِ «قبل»
 * @param {string} afterUrl آدرس عکسِ «بعد»
 * @param {{width?:string, height?:string, beforeLabel?:string, afterLabel?:string}} opts
 */
export function compareSlider(beforeUrl, afterUrl, opts = {}) {
  const {
    width = '100%', height = '260px', beforeLabel = 'قبل', afterLabel = 'اکنون',
  } = opts;

  const wrap = el('div', {
    style: `position:relative;width:${width};height:${height};border-radius:8px;overflow:hidden;`
      + 'border:1px solid var(--stone-200);user-select:none;cursor:ew-resize;background:var(--stone-100)',
  });
  const afterImg = el('img', { src: afterUrl, style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block' });
  const beforeClip = el('div', { style: 'position:absolute;inset:0;width:50%;overflow:hidden' }, [
    el('img', { src: beforeUrl, style: 'height:100%;object-fit:cover;display:block' }),
  ]);
  // عرض تصویر داخل کلیپ باید برابر عرض کانتینر اصلی (نه ۵۰٪ کلیپ) بماند وگرنه تصویر «قبل» فشرده به‌نظر می‌رسد
  const beforeImgInner = beforeClip.firstChild;
  const handle = el('div', {
    style: 'position:absolute;top:0;bottom:0;left:50%;width:3px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);'
      + 'transform:translateX(-50%);pointer-events:none',
  }, [
    el('div', {
      style: 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:30px;height:30px;'
        + 'border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;'
        + 'justify-content:center;font-size:13px;color:var(--stone-700)',
    }, '↔'),
  ]);
  const beforeTag = el('div', { style: 'position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:2px 7px;border-radius:999px' }, beforeLabel);
  const afterTag = el('div', { style: 'position:absolute;top:6px;left:6px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:2px 7px;border-radius:999px' }, afterLabel);

  wrap.append(afterImg, beforeClip, handle, beforeTag, afterTag);

  function setPct(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    beforeClip.style.width = `${clamped}%`;
    handle.style.left = `${clamped}%`;
  }
  function updateInnerWidth() {
    // تصویر داخل کلیپ باید همیشه به اندازه‌ی کل کادر باشد تا وقتی کلیپ باریک/پهن می‌شود، تصویر جابه‌جا نشود نه فشرده
    beforeImgInner.style.width = `${wrap.getBoundingClientRect().width}px`;
  }
  requestAnimationFrame(updateInnerWidth);
  new ResizeObserver(updateInnerWidth).observe(wrap);

  let dragging = false;
  function pctFromClientX(clientX) {
    const rect = wrap.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }
  wrap.addEventListener('pointerdown', (e) => { dragging = true; setPct(pctFromClientX(e.clientX)); wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', (e) => { if (dragging) setPct(pctFromClientX(e.clientX)); });
  wrap.addEventListener('pointerup', () => { dragging = false; });
  wrap.addEventListener('pointercancel', () => { dragging = false; });

  setPct(50);
  return wrap;
}

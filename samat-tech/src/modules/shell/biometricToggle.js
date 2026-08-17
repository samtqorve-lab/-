import { el, showToast } from '../../lib/dom.js';
import {
  bioSupported, hasBiometricCred, enableBiometric, removeBiometricCred,
} from '../../lib/biometric.js';

/** یک ردیف کوچک «فعال/غیرفعال‌سازی ورود با اثر انگشت» می‌سازد؛ اگر دستگاه پشتیبانی نکند چیزی نشان نمی‌دهد */
export function mountBiometricToggle(container, email) {
  if (!bioSupported()) return;
  function draw() {
    container.innerHTML = '';
    const enabled = hasBiometricCred(email);
    container.append(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;background:var(--stone-50);border-radius:8px;padding:8px 10px;margin-top:10px' }, [
      el('span', { style: 'font-size:var(--text-xs)' }, enabled ? '✅ ورود با اثر انگشت روی این دستگاه فعال است' : '👆 برای ورود سریع‌تر دفعات بعد، اثر انگشت را فعال کنید'),
      enabled
        ? el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: () => { removeBiometricCred(email); showToast('🔓 غیرفعال شد'); draw(); } }, 'غیرفعال‌سازی')
        : el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff', onclick: async () => {
          try { await enableBiometric(email); showToast('✅ ورود با اثر انگشت فعال شد'); } catch (err) { showToast(`⚠️ ${err.message}`); }
          draw();
        } }, 'فعال‌سازی'),
    ]));
  }
  draw();
}

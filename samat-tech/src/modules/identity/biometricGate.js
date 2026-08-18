import { el } from '../../lib/dom.js';
import { verifyBiometricGate } from '../../lib/biometric.js';

/**
 * قبل از نمایش داشبورد صدا زده می‌شود. اگر روی این دستگاه برای این ایمیل بیومتریک فعال باشد،
 * صفحه‌ی «لمس برای ورود» را نشان می‌دهد و فقط پس از تایید اثر انگشت/Face ID ادامه می‌دهد.
 * @returns {Promise<boolean>} همیشه در نهایت true — چون نشست Supabase از قبل معتبر است؛
 * این فقط یک لایه‌ی راحتی/حریم‌خصوصی محلی است، نه احراز هویت واقعی.
 */
export function mountBiometricGate(root, email, onLogout) {
  return new Promise((resolve) => {
    const errBox = el('div', { class: 'gate-err' });
    const tryBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, '👆 لمس برای ورود');

    async function attempt() {
      errBox.textContent = '';
      tryBtn.disabled = true; tryBtn.textContent = '⏳ در انتظار تایید اثر انگشت...';
      try {
        const ok = await verifyBiometricGate(email);
        if (ok) { resolve(true); return; }
        errBox.textContent = 'تایید لغو شد — دوباره تلاش کنید';
      } catch (err) {
        errBox.textContent = `تایید اثر انگشت ناموفق بود: ${err.message || err}`;
      } finally {
        tryBtn.disabled = false; tryBtn.textContent = '👆 لمس برای ورود';
      }
    }
    tryBtn.addEventListener('click', attempt);

    root.innerHTML = '';
    root.append(el('div', { class: 'gate-screen' }, el('div', { class: 'gate-card' }, [
      el('div', { style: 'text-align:center' }, [
        el('div', { style: 'font-size:32px' }, '👆'),
        el('div', { style: 'margin-top:8px;font-size:var(--text-sm)' }, `ورود سریع با اثر انگشت/Face ID — ${email}`),
      ]),
      errBox, tryBtn,
      el('div', { class: 'gate-links', style: 'justify-content:center;margin-top:10px' }, [
        el('a', { onclick: onLogout }, 'خروج و ورود با رمز عبور'),
      ]),
    ])));

    attempt();
  });
}

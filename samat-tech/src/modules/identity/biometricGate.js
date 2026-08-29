import { el } from '../../lib/dom.js';
import { verifyBiometricGate } from '../../lib/biometric.js';

/**
 * قبل از نمایش داشبورد صدا زده می‌شود. اگر روی این دستگاه برای این ایمیل بیومتریک فعال باشد،
 * صفحه‌ی «لمس برای ورود» را نشان می‌دهد. چون این فقط یک لایه‌ی راحتی/حریم‌خصوصی محلی است (نشست
 * Supabase از قبل معتبر است، نه یک احراز هویت واقعی جدا)، همیشه یک گزینه‌ی «رد کردن» هم از همان
 * ابتدا و به‌وضوح در کنار تلاش خودکار نشان داده می‌شود — تا اگر سنسور اثر انگشت کسی خراب/ناموفق
 * بود، بدون نیاز به خروج کامل و ورود دوباره، بلافاصله بتواند ادامه بدهد.
 * @returns {Promise<boolean>} همیشه true — یا با تایید اثر انگشت، یا با انتخاب «رد کردن»
 */
export function mountBiometricGate(root, email, onLogout) {
  return new Promise((resolve) => {
    const errBox = el('div', { class: 'gate-err' });
    const tryBtn = el('button', { class: 'btn btn-primary', style: 'width:100%' }, '👆 ورود با اثر انگشت/Face ID');
    const skipBtn = el('button', { class: 'btn btn-ghost', style: 'width:100%;margin-top:8px' }, '⌨️ رد کردن — ادامه بدون اثر انگشت');

    async function attempt(auto) {
      errBox.textContent = '';
      tryBtn.disabled = true; tryBtn.textContent = '⏳ در انتظار تایید اثر انگشت...';
      try {
        const ok = await verifyBiometricGate(email);
        if (ok) { resolve(true); return; }
        if (!auto) errBox.textContent = 'تایید لغو شد — دوباره تلاش کنید یا «رد کردن» را بزنید';
      } catch (err) {
        if (!auto) errBox.textContent = `تایید اثر انگشت ناموفق بود: ${err.message || err}`;
      } finally {
        tryBtn.disabled = false; tryBtn.textContent = '👆 ورود با اثر انگشت/Face ID';
      }
    }
    tryBtn.addEventListener('click', () => attempt(false));
    skipBtn.addEventListener('click', () => resolve(true));

    root.innerHTML = '';
    root.append(el('div', { class: 'gate-screen' }, el('div', { class: 'gate-card' }, [
      el('div', { style: 'text-align:center;margin-bottom:14px' }, [
        el('div', { style: 'font-size:32px' }, '👆'),
        el('div', { style: 'margin-top:8px;font-size:var(--text-sm)' }, `ورود سریع با اثر انگشت/Face ID — ${email}`),
      ]),
      errBox, tryBtn, skipBtn,
      el('div', { class: 'gate-links', style: 'justify-content:center;margin-top:10px' }, [
        el('a', { onclick: onLogout }, 'خروج کامل از حساب'),
      ]),
    ])));

    attempt(true); // تلاش خودکار برای راحتی حالت معمول؛ دو دکمه از همان ابتدا هم قابل‌لمس‌اند
  });
}

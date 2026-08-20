import { el, passwordFieldWithToggle } from '../../lib/dom.js';
import { signIn, signOut } from '../../lib/auth.js';
import { isPushLoginEnabled, requestPushApproval } from '../../lib/pushLogin.js';

export function mountLogin(root, onSuccess) {
  root.innerHTML = '';

  const emailInput = el('input', { type: 'email', dir: 'ltr', placeholder: 'you@example.com', autocomplete: 'username' });
  const { wrap: passWrap, input: passInput } = passwordFieldWithToggle({ dir: 'ltr', placeholder: '••••••••', autocomplete: 'current-password' });
  const errBox = el('div', { class: 'login-err' });
  const submitBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:14px' }, 'ورود');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'در حال ورود...';
      try {
        const email = emailInput.value.trim();
        await signIn(email, passInput.value);

        if (await isPushLoginEnabled(email)) {
          submitBtn.textContent = 'در انتظار تایید...';
          await waitForPushApproval(email);
        }
        onSuccess();
      } catch (err) {
        errBox.textContent = err.pushDenied
          ? 'ورود از طریق اعلان روی گوشی رد شد.'
          : err.pushTimeout
            ? 'زمان تایید ورود از طریق اعلان به پایان رسید — دوباره تلاش کنید.'
            : 'ایمیل یا رمز عبور نادرست است.';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'ورود';
      }
    },
  }, [
    el('label', {}, 'ایمیل'),
    emailInput,
    el('label', {}, 'رمز عبور'),
    passWrap,
    errBox,
    submitBtn,
  ]);

  /** بعد از ورود موفق با رمز، اگر ورود با تایید Push روشن باشد، تا تایید/رد/انقضا صبر می‌کند —
   * و در صورت رد/انقضا، session را هم می‌بندد (چون در این حالت اجازه‌ی دسترسی نداده‌ایم). */
  async function waitForPushApproval(email) {
    return new Promise((resolve, reject) => {
      requestPushApproval(email, async (status, detail) => {
        if (status === 'approved') { resolve(); return; }
        await signOut();
        if (status === 'denied') { const e = new Error('denied'); e.pushDenied = true; reject(e); return; }
        if (status === 'timeout') { const e = new Error('timeout'); e.pushTimeout = true; reject(e); return; }
        reject(new Error(detail || 'push-error'));
      });
    });
  }

  const card = el('div', { class: 'login-card' }, [
    el('div', { class: 'brand' }, [
      el('img', { src: '/favicon.svg', class: 'brand-logo', alt: 'صمت' }),
      el('div', { class: 'org' }, 'اداره صنعت، معدن و تجارت قروه'),
      el('div', { class: 'app' }, 'ورود به پنل ادمین صمت'),
    ]),
    form,
  ]);

  const screen = el('div', { class: 'login-screen' }, card);
  root.append(screen);
}

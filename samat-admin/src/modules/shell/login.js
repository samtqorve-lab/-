import { el, passwordFieldWithToggle } from '../../lib/dom.js';
import { signIn } from '../../lib/auth.js';

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
        await signIn(emailInput.value.trim(), passInput.value);
        onSuccess();
      } catch (err) {
        errBox.textContent = 'ایمیل یا رمز عبور نادرست است.';
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

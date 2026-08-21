import { el, showToast, passwordFieldWithToggle } from '../../lib/dom.js';
import {
  signIn, signUp, confirmSignupCode, resendSignupCode, sendPasswordResetCode, resetPasswordWithCode, signOut,
} from '../../lib/auth.js';
import { isPushLoginEnabled, requestPushApproval } from '../../lib/pushLogin.js';
import { friendlyError } from '../../lib/utils.js';

const MESSENGER_HINTS = {
  telegram: 'آیدی چت تلگرام', bale: 'شماره موبایل یا آیدی چت بله', eitaa: 'آیدی چت/کانال ایتا',
  rubika: 'شناسه چت روبیکا', whatsapp: 'شماره موبایل واتساپ (با کد کشور)',
};

export function mountLogin(root, onSuccess) {
  let screen = 'login';
  let pendingSignupEmail = '';
  let forgotEmailResolved = '';
  let recoverySessionActive = false;

  function draw() {
    root.innerHTML = '';
    const card = el('div', { class: 'gate-card' });
    const wrap = el('div', { class: 'gate-screen' }, card);
    root.append(wrap);

    if (screen === 'login') drawLogin(card);
    else if (screen === 'register') drawRegister(card);
    else if (screen === 'confirmSignup') drawConfirmSignup(card);
    else if (screen === 'registerDone') drawRegisterDone(card);
    else if (screen === 'forgot1') drawForgot1(card);
    else if (screen === 'forgot2') drawForgot2(card);
  }

  function brand(subtitle) {
    return el('div', { class: 'brand' }, [
      el('div', { class: 'org' }, 'اداره صنعت، معدن و تجارت قروه'),
      el('div', { class: 'app' }, subtitle || 'ورود مسئول فنی/ایمنی/بهداشت'),
    ]);
  }

  function drawLogin(card) {
    const idInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'ایمیل یا شماره عضویت نظام مهندسی' });
    const { wrap: passWrap, input: passInput } = passwordFieldWithToggle({ dir: 'ltr', placeholder: '••••••••' });
    const errBox = el('div', { class: 'gate-err' });
    const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, 'ورود');

    submitBtn.addEventListener('click', async () => {
      errBox.textContent = '';
      if (!idInput.value.trim() || !passInput.value) { errBox.textContent = 'ایمیل/شماره عضویت و رمز را وارد کنید'; return; }
      submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال ورود...';
      try {
        const email = await signIn(idInput.value, passInput.value);
        if (await isPushLoginEnabled(email)) {
          submitBtn.textContent = '🔐 در انتظار تایید روی گوشی ثبت‌شده...';
          await waitForPushApproval(email);
        }
        onSuccess();
      } catch (err) {
        errBox.textContent = err.pushDenied
          ? 'ورود از طریق اعلان رد شد.'
          : err.pushTimeout
            ? 'زمان تایید ورود به پایان رسید — دوباره تلاش کنید.'
            : friendlyError(err);
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'ورود';
      }
    });

    /** بعد از ورود موفق با رمز، اگر ورود با تایید Push روشن باشد، تا تایید/رد/انقضا صبر می‌کند */
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

    card.append(
      brand(),
      el('label', {}, 'ایمیل یا شماره عضویت'), idInput,
      el('label', {}, 'رمز عبور'), passWrap,
      errBox, submitBtn,
      el('div', { class: 'gate-links' }, [
        el('a', { onclick: () => { screen = 'forgot1'; draw(); } }, 'فراموشی رمز عبور'),
        el('a', { onclick: () => { screen = 'register'; draw(); } }, 'ثبت‌نام مسئول فنی/ایمنی/بهداشت'),
      ]),
    );
  }

  function drawRegister(card) {
    const { wrap: passWrap, input: passInput } = passwordFieldWithToggle({ dir: 'ltr' });
    const { wrap: pass2Wrap, input: pass2Input } = passwordFieldWithToggle({ dir: 'ltr' });
    const f = {
      full_name: el('input', { type: 'text' }),
      national_code: el('input', { type: 'text', dir: 'ltr', maxlength: '10' }),
      phone: el('input', { type: 'text', dir: 'ltr' }),
      email: el('input', { type: 'email', dir: 'ltr' }),
      pass: passInput,
      pass2: pass2Input,
      specialty: el('select', {}, [
        el('option', { value: 'استخراج' }, '⛏️ استخراج (مسئول فنی/ایمنی/بهداشت معدن)'),
        el('option', { value: 'اکتشاف' }, '🔍 اکتشاف'),
        el('option', { value: 'فرآوری' }, '⚗️ فرآوری'),
      ]),
      membership_no: el('input', { type: 'text', dir: 'ltr' }),
      license_no: el('input', { type: 'text', dir: 'ltr' }),
      mine_name: el('input', { type: 'text' }),
      contract_no: el('input', { type: 'text', dir: 'ltr' }),
      messenger: el('select', {}, Object.entries(MESSENGER_HINTS).map(([v, l]) => el('option', { value: v }, l.replace(/^آیدی |^شماره /, '')))),
      messenger_chat_id: el('input', { type: 'text', dir: 'ltr' }),
    };
    const messengerLabel = el('label', {}, MESSENGER_HINTS[f.messenger.value]);
    f.messenger.addEventListener('change', () => { messengerLabel.textContent = MESSENGER_HINTS[f.messenger.value]; });

    const errBox = el('div', { class: 'gate-err' });
    const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, 'ثبت‌نام');

    submitBtn.addEventListener('click', async () => {
      errBox.textContent = '';
      if (!f.full_name.value.trim() || !f.national_code.value.trim() || !f.phone.value.trim() || !f.email.value.trim() || !f.pass.value) {
        errBox.textContent = 'اطلاعات هویتی، ایمیل و رمز عبور را کامل کنید'; return;
      }
      if (f.pass.value.length < 6) { errBox.textContent = 'رمز عبور باید حداقل ۶ کاراکتر باشد'; return; }
      if (f.pass.value !== f.pass2.value) { errBox.textContent = 'تکرار رمز عبور با رمز عبور یکسان نیست'; return; }
      if (!/^\d{10}$/.test(f.national_code.value.trim())) { errBox.textContent = 'کد ملی باید ۱۰ رقم باشد'; return; }
      if (!f.membership_no.value.trim() || !f.license_no.value.trim() || !f.mine_name.value.trim() || !f.contract_no.value.trim() || !f.messenger_chat_id.value.trim()) {
        errBox.textContent = 'اطلاعات نظام مهندسی، معدن و شناسه پیام‌رسان را کامل کنید'; return;
      }
      submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال ارسال...';
      try {
        const result = await signUp({
          email: f.email.value.trim(), password: f.pass.value,
          full_name: f.full_name.value.trim(), phone: f.phone.value.trim(), national_code: f.national_code.value.trim(),
          membership_no: f.membership_no.value.trim(), license_no: f.license_no.value.trim(),
          requested_mine_name: f.mine_name.value.trim(), contract_no: f.contract_no.value.trim(),
          tech_officer_specialty: f.specialty.value, preferred_messenger: f.messenger.value, messenger_chat_id: f.messenger_chat_id.value.trim(),
        });
        if (result.needsEmailConfirm) {
          pendingSignupEmail = f.email.value.trim();
          screen = 'confirmSignup';
        } else {
          screen = 'registerDone';
        }
        draw();
      } catch (err) {
        errBox.textContent = friendlyError(err);
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'ثبت‌نام';
      }
    });

    card.append(
      brand('ثبت‌نام'),
      el('label', {}, 'نام و نام خانوادگی'), f.full_name,
      el('label', {}, 'کد ملی'), f.national_code,
      el('label', {}, 'تلفن همراه'), f.phone,
      el('label', {}, 'ایمیل'), f.email,
      el('label', {}, 'رمز عبور'), passWrap,
      el('label', {}, 'تکرار رمز عبور'), pass2Wrap,
      el('label', {}, 'نوع تخصص'), f.specialty,
      el('label', {}, 'شماره عضویت نظام مهندسی'), f.membership_no,
      el('label', {}, 'شماره پروانه اشتغال به کار'), f.license_no,
      el('label', {}, 'نام معدن/محدوده/واحدی که مسئولیتش با شماست'), f.mine_name,
      el('label', {}, 'شماره ثبت قرارداد نظام مهندسی'), f.contract_no,
      el('label', {}, 'پیام‌رسان برای اطلاع‌رسانی'), f.messenger,
      messengerLabel, f.messenger_chat_id,
      errBox, submitBtn,
      el('div', { class: 'gate-links', style: 'justify-content:center' }, [
        el('a', { onclick: () => { screen = 'login'; draw(); } }, '← بازگشت به ورود'),
      ]),
    );
  }

  function drawConfirmSignup(card) {
    const codeInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'کد ۶ رقمی' });
    const errBox = el('div', { class: 'gate-err' });
    const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, 'تایید کد');
    submitBtn.addEventListener('click', async () => {
      errBox.textContent = '';
      if (!codeInput.value.trim() || codeInput.value.trim().length < 4) { errBox.textContent = 'کد ارسال‌شده به ایمیل را کامل وارد کنید'; return; }
      try {
        await confirmSignupCode(pendingSignupEmail, codeInput.value);
        pendingSignupEmail = '';
        screen = 'registerDone';
        draw();
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
    const resendBtn = el('button', { class: 'btn btn-ghost', style: 'margin-top:8px' }, 'ارسال دوباره کد');
    resendBtn.addEventListener('click', async () => {
      try { await resendSignupCode(pendingSignupEmail); showToast('✅ کد جدید ارسال شد'); } catch { errBox.textContent = 'خطا در ارسال دوباره'; }
    });
    card.append(
      brand('تایید ایمیل'),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' }, `یک کد ۶ رقمی به ${pendingSignupEmail} ارسال شد.`),
      el('label', {}, 'کد تایید'), codeInput,
      errBox, submitBtn, resendBtn,
    );
  }

  function drawRegisterDone(card) {
    card.append(
      brand('ثبت‌نام انجام شد'),
      el('div', { style: 'text-align:center;padding:12px 0' }, [
        el('div', { style: 'font-size:32px' }, '✅'),
        el('div', { style: 'margin-top:8px;font-size:var(--text-sm)' }, 'درخواست شما ثبت شد و برای تایید به مدیر سامانه ارسال شد. پس از تایید می‌توانید وارد شوید.'),
      ]),
      el('button', { class: 'btn btn-primary', onclick: () => { screen = 'login'; draw(); } }, 'بازگشت به صفحه‌ی ورود'),
    );
  }

  function drawForgot1(card) {
    const idInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'ایمیل یا شماره عضویت' });
    const errBox = el('div', { class: 'gate-err' });
    const sendBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, 'ارسال کد بازیابی');
    sendBtn.addEventListener('click', async () => {
      errBox.textContent = '';
      if (!idInput.value.trim()) { errBox.textContent = 'ایمیل خود را وارد کنید'; return; }
      sendBtn.disabled = true; sendBtn.textContent = '⏳ در حال ارسال...';
      try {
        forgotEmailResolved = await sendPasswordResetCode(idInput.value);
        recoverySessionActive = false;
        screen = 'forgot2';
        draw();
      } catch (err) {
        errBox.textContent = friendlyError(err);
      } finally {
        sendBtn.disabled = false; sendBtn.textContent = 'ارسال کد بازیابی';
      }
    });
    card.append(
      brand('بازیابی رمز عبور'),
      el('label', {}, 'ایمیل یا شماره عضویت'), idInput,
      errBox, sendBtn,
      el('div', { class: 'gate-links', style: 'justify-content:center' }, [el('a', { onclick: () => { screen = 'login'; draw(); } }, '← بازگشت به ورود')]),
    );
  }

  function drawForgot2(card) {
    const codeInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'کد ۶ رقمی' });
    const { wrap: p1Wrap, input: p1 } = passwordFieldWithToggle({ dir: 'ltr' });
    const { wrap: p2Wrap, input: p2 } = passwordFieldWithToggle({ dir: 'ltr' });
    const errBox = el('div', { class: 'gate-err' });
    const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, 'تغییر رمز عبور');
    submitBtn.addEventListener('click', async () => {
      errBox.textContent = '';
      if (!recoverySessionActive && (!codeInput.value.trim() || codeInput.value.trim().length < 4)) { errBox.textContent = 'کد ارسال‌شده به ایمیل را کامل وارد کنید'; return; }
      if (!p1.value || p1.value.length < 6) { errBox.textContent = 'رمز عبور باید حداقل ۶ کاراکتر باشد'; return; }
      if (p1.value !== p2.value) { errBox.textContent = 'تکرار رمز عبور با رمز عبور یکسان نیست'; return; }
      try {
        await resetPasswordWithCode(forgotEmailResolved, codeInput.value, p1.value, recoverySessionActive);
        screen = 'login';
        draw();
        showToast('✅ رمز عبور با موفقیت تغییر کرد — با رمز جدید وارد شوید');
      } catch (err) {
        errBox.textContent = err.message || friendlyError(err);
      }
    });
    card.append(
      brand('کد بازیابی'),
      el('label', {}, 'کد ارسال‌شده به ایمیل'), codeInput,
      el('label', {}, 'رمز عبور جدید'), p1Wrap,
      el('label', {}, 'تکرار رمز عبور جدید'), p2Wrap,
      errBox, submitBtn,
    );
  }

  draw();
}

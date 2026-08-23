import { el, passwordFieldWithToggle, showToast } from '../../lib/dom.js';
import {
  signIn, signOut, signUp, confirmSignupCode, resendSignupCode,
} from '../../lib/auth.js';
import { isPushLoginEnabled, requestPushApproval, verifyFallbackCode } from '../../lib/pushLogin.js';

export function mountLogin(root, onSuccess) {
  root.innerHTML = '';

  let screen = 'login'; // 'login' | 'register' | 'confirmSignup'
  let pendingSignupEmail = '';

  function brand(subtitle) {
    return el('div', { class: 'brand' }, [
      el('img', { src: '/favicon.svg', class: 'brand-logo', alt: 'صمت' }),
      el('div', { class: 'org' }, 'اداره صنعت، معدن و تجارت قروه'),
      el('div', { class: 'app' }, subtitle || 'ورود به پنل ادمین صمت'),
    ]);
  }

  function draw() {
    const card = el('div', { class: 'login-card' });
    if (screen === 'login') drawLogin(card);
    else if (screen === 'register') drawRegister(card);
    else if (screen === 'confirmSignup') drawConfirmSignup(card);

    root.innerHTML = '';
    root.append(el('div', { class: 'login-screen' }, card));
  }

  function drawLogin(card) {
    const emailInput = el('input', { type: 'email', dir: 'ltr', placeholder: 'you@example.com', autocomplete: 'username' });
    const { wrap: passWrap, input: passInput } = passwordFieldWithToggle({ dir: 'ltr', placeholder: '••••••••', autocomplete: 'current-password' });
    const errBox = el('div', { class: 'login-err' });
    const submitBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:14px' }, 'ورود');

    // اگر Push پاسخ ندهد (مثلاً به‌خاطر تحریم/فیلترینگ)، این بخش خودکار ظاهر می‌شود و یک کد ۶ رقمی
    // که از طریق تلگرام فرستاده شده را می‌گیرد.
    const codeInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'کد ۶ رقمی از تلگرام', maxlength: '6' });
    const codeErrBox = el('div', { class: 'login-err' });
    const codeSubmitBtn = el('button', { type: 'button', class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:8px' }, 'تایید کد');
    let currentApprovalId = null;
    const codeBox = el('div', {
      style: 'display:none;margin-top:14px;padding-top:14px;border-top:1px dashed var(--stone-200)',
    }, [
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
        '📲 اعلان Push پاسخی نداشت — یک کد ۶ رقمی از طریق تلگرام برایتان فرستاده شد.'),
      codeInput, codeErrBox, codeSubmitBtn,
    ]);
    codeSubmitBtn.addEventListener('click', async () => {
      codeErrBox.textContent = '';
      if (!codeInput.value.trim() || !currentApprovalId) return;
      codeSubmitBtn.disabled = true; codeSubmitBtn.textContent = 'در حال بررسی...';
      try {
        const result = await verifyFallbackCode(currentApprovalId, codeInput.value.trim());
        if (!result.ok) {
          codeErrBox.textContent = result.expired ? 'مهلت وارد کردن کد به پایان رسید — دوباره وارد شوید.' : 'کد نادرست است.';
        }
        // در صورت درست بودن کد، سرور status را approved می‌کند و همان اشتراک Realtime که در
        // requestPushApproval فعال است خودکار این تغییر را تشخیص و ورود را کامل می‌کند.
      } catch (err) {
        codeErrBox.textContent = err.message;
      } finally {
        codeSubmitBtn.disabled = false; codeSubmitBtn.textContent = 'تایید کد';
      }
    });

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.textContent = '';
        codeBox.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'در حال ورود...';
        try {
          const email = emailInput.value.trim();
          await signIn(email, passInput.value);

          if (await isPushLoginEnabled(email)) {
            submitBtn.textContent = 'در انتظار تایید...';
            await waitForPushApproval(email, (approvalId) => {
              currentApprovalId = approvalId;
              codeBox.style.display = 'block';
              submitBtn.textContent = 'در انتظار کد تلگرام...';
            });
          }
          onSuccess();
        } catch (err) {
          errBox.textContent = err.pushDenied
            ? 'ورود از طریق اعلان روی گوشی رد شد.'
            : err.pushTimeout
              ? 'زمان تایید ورود به پایان رسید — دوباره تلاش کنید.'
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

    card.append(brand(), form, codeBox, el('div', { class: 'login-links', style: 'text-align:center;margin-top:14px' }, [
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); screen = 'register'; draw(); } }, 'درخواست دسترسی ادمین (ثبت‌نام)'),
    ]));
  }

  function drawRegister(card) {
    const fullNameInput = el('input', { type: 'text' });
    const phoneInput = el('input', { type: 'text', dir: 'ltr' });
    const emailInput = el('input', { type: 'email', dir: 'ltr' });
    const { wrap: passWrap, input: passInput } = passwordFieldWithToggle({ dir: 'ltr' });
    const { wrap: pass2Wrap, input: pass2Input } = passwordFieldWithToggle({ dir: 'ltr' });
    const errBox = el('div', { class: 'login-err' });
    const submitBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:14px' }, 'ثبت‌نام');

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.textContent = '';
        if (!fullNameInput.value.trim() || !phoneInput.value.trim() || !emailInput.value.trim() || !passInput.value) {
          errBox.textContent = 'همه‌ی فیلدها را کامل کنید'; return;
        }
        if (passInput.value.length < 6) { errBox.textContent = 'رمز عبور باید حداقل ۶ کاراکتر باشد'; return; }
        if (passInput.value !== pass2Input.value) { errBox.textContent = 'تکرار رمز عبور با رمز عبور یکسان نیست'; return; }
        submitBtn.disabled = true;
        submitBtn.textContent = 'در حال ارسال...';
        try {
          const result = await signUp({
            email: emailInput.value.trim(), password: passInput.value,
            full_name: fullNameInput.value.trim(), phone: phoneInput.value.trim(),
          });
          if (result.needsEmailConfirm) {
            pendingSignupEmail = emailInput.value.trim();
            screen = 'confirmSignup';
          } else {
            showToast('✅ ثبت‌نام انجام شد — پس از تایید سوپرادمین می‌توانید وارد شوید');
            screen = 'login';
          }
          draw();
        } catch (err) {
          errBox.textContent = err.message?.includes('already registered') ? 'این ایمیل قبلاً ثبت شده است' : (err.message || 'خطا در ثبت‌نام');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'ثبت‌نام';
        }
      },
    }, [
      el('label', {}, 'نام و نام خانوادگی'), fullNameInput,
      el('label', {}, 'تلفن همراه'), phoneInput,
      el('label', {}, 'ایمیل'), emailInput,
      el('label', {}, 'رمز عبور'), passWrap,
      el('label', {}, 'تکرار رمز عبور'), pass2Wrap,
      errBox, submitBtn,
    ]);

    card.append(
      brand('درخواست دسترسی ادمین'),
      el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:12px' },
        'بعد از ثبت‌نام، درخواست شما نزد سوپرادمین در انتظار تایید می‌ماند — نقش و بخش سازمانی (صنعت‌ومعدن/اصناف) هنگام تایید مشخص می‌شود.'),
      form,
      el('div', { class: 'login-links', style: 'text-align:center;margin-top:14px' }, [
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); screen = 'login'; draw(); } }, '← بازگشت به ورود'),
      ]),
    );
  }

  function drawConfirmSignup(card) {
    const codeInput = el('input', { type: 'text', dir: 'ltr', placeholder: 'کد ۶ رقمی' });
    const errBox = el('div', { class: 'login-err' });
    const submitBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:14px' }, 'تایید کد');
    const resendBtn = el('button', { type: 'button', class: 'btn btn-ghost', style: 'width:100%;justify-content:center;margin-top:8px' }, 'ارسال دوباره‌ی کد');

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errBox.textContent = '';
        if (!codeInput.value.trim()) { errBox.textContent = 'کد ارسال‌شده به ایمیل را وارد کنید'; return; }
        submitBtn.disabled = true;
        submitBtn.textContent = 'در حال بررسی...';
        try {
          await confirmSignupCode(pendingSignupEmail, codeInput.value);
          showToast('✅ ایمیل تایید شد — پس از تایید سوپرادمین می‌توانید وارد شوید');
          screen = 'login';
          draw();
        } catch (err) {
          errBox.textContent = err.message;
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'تایید کد';
        }
      },
    }, [
      el('label', {}, `کد ارسال‌شده به ${pendingSignupEmail}`), codeInput,
      errBox, submitBtn,
    ]);

    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true;
      try {
        await resendSignupCode(pendingSignupEmail);
        showToast('✅ کد جدید ارسال شد');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      } finally {
        resendBtn.disabled = false;
      }
    });

    card.append(brand('تایید ایمیل'), form, resendBtn);
  }

  /** بعد از ورود موفق با رمز، اگر ورود با تایید Push روشن باشد، تا تایید/رد/انقضا صبر می‌کند —
   * و در صورت رد/انقضا، session را هم می‌بندد (چون در این حالت اجازه‌ی دسترسی نداده‌ایم).
   * onAwaitingCode وقتی فال‌بک تلگرام فعال شود صدا زده می‌شود (نگاه کنید به pushLogin.js). */
  async function waitForPushApproval(email, onAwaitingCode) {
    return new Promise((resolve, reject) => {
      requestPushApproval(email, async (status, detail) => {
        if (status === 'approved') { resolve(); return; }
        await signOut();
        if (status === 'denied') { const e = new Error('denied'); e.pushDenied = true; reject(e); return; }
        if (status === 'timeout') { const e = new Error('timeout'); e.pushTimeout = true; reject(e); return; }
        reject(new Error(detail || 'push-error'));
      }, onAwaitingCode);
    });
  }

  draw();
}

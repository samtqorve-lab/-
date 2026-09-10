import { el } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { deptForSpecialty, callPublicLookup } from '../../lib/auth.js';
import { friendlyError } from '../../lib/utils.js';

const MESSENGER_HINTS = {
  telegram: 'آیدی عددی چت تلگرام (نه یوزرنیم @) — برای گرفتنش تو تلگرام به ربات @userinfobot پیام بدید و /start بزنید',
  bale: 'شماره موبایل یا آیدی چت بله', eitaa: 'آیدی چت/کانال ایتا',
  rubika: 'شناسه چت روبیکا', whatsapp: 'شماره موبایل واتساپ (با کد کشور)',
};

/**
 * ورود سریع با گوگل هیچ‌کدام از فیلدهای هویتی (کد ملی، شماره عضویت نظام مهندسی، شماره پروانه،
 * نام معدن، شماره قرارداد، شناسه پیام‌رسان) را نمی‌گیرد — گوگل فقط نام/ایمیل می‌دهد. قبل از این
 * فیکس، ردیف user_roles با این فیلدها خالی ساخته می‌شد و کاربر مستقیم به صفحه‌ی «در انتظار تایید»
 * می‌رفت؛ سوپرادمین هم یک درخواست تایید با اطلاعات خالی و غیرقابل‌تایید می‌دید. این فرم همان
 * اطلاعات را بعد از ورود با گوگل می‌گیرد و ردیف موجود را تکمیل می‌کند.
 */
export function mountCompleteProfile(root, email, currentRow, onDone, onLogout) {
  const f = {
    full_name: el('input', { type: 'text', value: currentRow.full_name && currentRow.full_name !== email ? currentRow.full_name : '' }),
    national_code: el('input', { type: 'text', dir: 'ltr', maxlength: '10' }),
    phone: el('input', { type: 'text', dir: 'ltr' }),
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

  const memberLookupHint = el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin:-4px 0 4px' });
  let lastLookedUpNo = null;
  let membershipVerified = false;
  f.membership_no.addEventListener('blur', async () => {
    const no = parseInt(f.membership_no.value.trim(), 10);
    if (!Number.isFinite(no) || no === lastLookedUpNo) return;
    lastLookedUpNo = no;
    memberLookupHint.textContent = '⏳ در حال جست‌وجو در فهرست اعضای نظام مهندسی...';
    try {
      const data = await callPublicLookup('lookupEngineeringMember', { membershipNo: no });
      const member = data && data[0];
      if (!member) { memberLookupHint.textContent = ''; return; }
      const suggestedName = `${member.first_name} ${member.last_name}`.trim();
      const suggestedPhone = member.phone || '';
      const ok = window.confirm(`این مشخصات برای عضو شماره ${no} پیدا شد:\nنام: ${suggestedName}\nتلفن: ${suggestedPhone || '—'}\n\nاگه درسته «OK» بزنید تا خودکار پر بشه، وگرنه «Cancel» بزنید و خودتون دستی وارد کنید.`);
      if (ok) {
        f.full_name.value = suggestedName;
        if (suggestedPhone) f.phone.value = suggestedPhone;
        membershipVerified = true;
        memberLookupHint.textContent = '✅ نام و تلفن از فهرست اعضا پر شد — در صورت نیاز می‌توانید ویرایش کنید.';
      } else {
        membershipVerified = false;
        memberLookupHint.textContent = '';
      }
    } catch {
      memberLookupHint.textContent = '';
    }
  });

  const errBox = el('div', { class: 'gate-err' });
  const submitBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:14px' }, 'ثبت و ارسال برای تایید');

  submitBtn.addEventListener('click', async () => {
    errBox.textContent = '';
    if (!f.full_name.value.trim() || !f.national_code.value.trim() || !f.phone.value.trim()) {
      errBox.textContent = 'نام، کد ملی و تلفن همراه را کامل کنید'; return;
    }
    if (!/^\d{10}$/.test(f.national_code.value.trim())) { errBox.textContent = 'کد ملی باید ۱۰ رقم باشد'; return; }
    if (!f.membership_no.value.trim() || !f.license_no.value.trim() || !f.mine_name.value.trim() || !f.contract_no.value.trim() || !f.messenger_chat_id.value.trim()) {
      errBox.textContent = 'اطلاعات نظام مهندسی، معدن و شناسه پیام‌رسان را کامل کنید'; return;
    }
    // برای تلگرام، ربات فقط می‌تواند با آیدی عددی چت پیام خصوصی بفرستد — یوزرنیم (که با @ شروع
    // می‌شود) کار نمی‌کند و باعث می‌شود ارسال کد یادآوری/تایید ورود بی‌صدا و بدون خطای قابل‌مشاهده
    // شکست بخورد (این دقیقاً همان مشکلی بود که برای یک کاربر واقعی رخ داد و کشفش سخت بود، چون
    // سرور HTTP 200 برمی‌گرداند حتی وقتی ارسال واقعی ناموفق است).
    if (f.messenger.value === 'telegram' && !/^\d+$/.test(f.messenger_chat_id.value.trim())) {
      errBox.textContent = 'آیدی چت تلگرام باید فقط عدد باشد (نه یوزرنیم @) — از ربات @userinfobot تو تلگرام بگیرید'; return;
    }
    submitBtn.disabled = true; submitBtn.textContent = '⏳ در حال ارسال...';
    try {
      const { data: taken } = await sb.rpc('is_membership_no_taken', { p_membership_no: f.membership_no.value.trim(), p_exclude_email: email });
      if (taken) throw new Error(`شماره عضویت ${f.membership_no.value.trim()} قبلاً ثبت‌نام شده — با مدیر سامانه تماس بگیرید.`);
      const { error } = await sb.from('user_roles').update({
        full_name: f.full_name.value.trim(),
        phone: f.phone.value.trim(),
        national_code: f.national_code.value.trim(),
        membership_no: f.membership_no.value.trim(),
        license_no: f.license_no.value.trim(),
        requested_mine_name: f.mine_name.value.trim(),
        contract_no: f.contract_no.value.trim(),
        tech_officer_specialty: f.specialty.value,
        department: deptForSpecialty(f.specialty.value),
        preferred_messenger: f.messenger.value,
        messenger_chat_id: f.messenger_chat_id.value.trim(),
        membership_verified: membershipVerified,
      }).eq('email', email);
      if (error) throw error;
      onDone();
    } catch (err) {
      errBox.textContent = friendlyError(err);
      submitBtn.disabled = false; submitBtn.textContent = 'ثبت و ارسال برای تایید';
    }
  });

  root.innerHTML = '';
  root.append(el('div', { class: 'gate-screen' }, el('div', { class: 'gate-card' }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'org' }, 'اداره صنعت، معدن و تجارت قروه'),
      el('div', { class: 'app' }, 'تکمیل مشخصات'),
    ]),
    el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:8px' },
      `با حساب گوگل ${email} وارد شدید — قبل از ارسال درخواست برای تایید مدیر سامانه، این اطلاعات را کامل کنید:`),
    el('label', {}, 'شماره عضویت نظام مهندسی (اول این را وارد کنید)'), f.membership_no, memberLookupHint,
    el('label', {}, 'نام و نام خانوادگی'), f.full_name,
    el('label', {}, 'کد ملی'), f.national_code,
    el('label', {}, 'تلفن همراه'), f.phone,
    el('label', {}, 'نوع تخصص'), f.specialty,
    el('label', {}, 'شماره پروانه اشتغال به کار'), f.license_no,
    el('label', {}, 'نام معدن/محدوده/واحدی که مسئولیتش با شماست'), f.mine_name,
    el('label', {}, 'شماره ثبت قرارداد نظام مهندسی'), f.contract_no,
    el('label', {}, 'پیام‌رسان برای اطلاع‌رسانی'), f.messenger,
    messengerLabel, f.messenger_chat_id,
    errBox, submitBtn,
    el('div', { class: 'gate-links', style: 'justify-content:center;margin-top:10px' }, [
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); onLogout(); } }, 'خروج کامل از حساب'),
    ]),
  ])));
}

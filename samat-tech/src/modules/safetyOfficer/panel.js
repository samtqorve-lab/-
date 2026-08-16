import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { monthlyReminderStatus, licenseExpiryStatus } from '../../lib/banners.js';
import { openRoleChecklistModal } from './roleChecklist.js';
import { mountGovLinks } from '../techOfficer/mineCards.js';
import { openIncidentModal } from '../techOfficer/incidentModal.js';
import { mountBiometricToggle } from '../shell/biometricToggle.js';
import { mountGpsStatusChip } from '../shell/gpsStatusChip.js';
import { mountSafetyCheckin } from '../shell/safetyCheckinWidget.js';
import { mountNotificationToggle } from '../shell/notificationToggle.js';
import { checkAndNotify } from '../../lib/localNotifications.js';

const ROLE_META = {
  safety_officer: { icon: '🦺', label: 'مسئول ایمنی' },
  health_officer: { icon: '⚕️', label: 'بهداشت حرفه‌ای' },
};

export async function mountSafetyOfficerPanel(root, { email, mines, identityVerifiedAt, roleRow, identitySettings, onLogout }) {
  root.innerHTML = '';
  const role = roleRow.role;
  const meta = ROLE_META[role] || ROLE_META.safety_officer;
  const department = 'معدن'; // نقش‌های ایمنی/بهداشت فقط برای معادن تعریف شده‌اند (ماده ۳ آیین‌نامه ایمنی معادن)

  const banners = el('div');
  const monthly = monthlyReminderStatus(identityVerifiedAt, identitySettings.monthlyMs, identitySettings.reminderMs);
  if (monthly) {
    banners.append(el('div', { class: 'banner banner-amber' }, [
      el('span', {}, `⏰ ${monthly.daysLeft} روز تا سررسید تمدید ماهانه احراز هویت مانده — داخل محدوده معدن عکس بگیرید.`),
      el('button', { class: 'btn-sm', style: 'background:var(--patina-600);color:#fff', onclick: () => window.location.reload() }, '📸'),
    ]));
  }
  const lic = licenseExpiryStatus(roleRow.license_no, roleRow.license_expiry_date);
  if (lic) {
    const text = lic.kind === 'expired' ? '⏰ پروانه اشتغال به کار شما منقضی شده است.'
      : lic.kind === 'missing' ? '⚠️ تاریخ انقضای پروانه اشتغال شما ثبت نشده — با مدیر سامانه هماهنگ کنید.'
        : `⚠️ ${lic.daysLeft} روز تا انقضای پروانه اشتغال به کار شما مانده.`;
    banners.append(el('div', { class: 'banner banner-rust' }, el('span', {}, text)));
  }
  checkAndNotify({ monthly, license: lic });

  const fullNameInput = el('input', { type: 'text', value: roleRow.full_name || '' });
  const membershipInput = el('input', { type: 'text', dir: 'ltr', value: roleRow.membership_no || '' });
  const profileStatus = el('span', { style: 'font-size:var(--text-xs);margin-right:8px' });
  const saveBtn = el('button', { class: 'btn btn-ghost', style: 'margin-top:10px' }, '💾 ذخیره مشخصات');
  saveBtn.addEventListener('click', async () => {
    const full_name = fullNameInput.value.trim();
    const membership_no = membershipInput.value.trim();
    const { error } = await sb.from('user_roles').update({ full_name, membership_no }).eq('email', email);
    if (error) { profileStatus.textContent = '⚠️ خطا در ذخیره'; return; }
    profileStatus.textContent = '✅ ذخیره شد';
    setTimeout(() => { profileStatus.textContent = ''; }, 2500);
  });

  const mineSelect = el('select', {}, mines.length
    ? mines.map((m) => el('option', { value: m['نام_معدن'] }, m['نام_معدن']))
    : [el('option', { value: '' }, '— موردی اختصاص نیافته —')]);

  function currentMine() { return mines.find((m) => m['نام_معدن'] === mineSelect.value); }

  const historyBox = el('div');
  async function loadHistory() {
    historyBox.innerHTML = '';
    if (!mines.length) { historyBox.append(el('div', { class: 'empty-state' }, 'معدنی اختصاص نیافته')); return; }
    const { data } = await sb.from('safety_checklists').select('*').eq('submitted_by', email).order('created_at', { ascending: false }).limit(30);
    if (!data || !data.length) { historyBox.append(el('div', { class: 'empty-state' }, 'هنوز چک‌لیستی ثبت نشده')); return; }
    data.forEach((c) => {
      const items = Array.isArray(c.items) ? c.items : [];
      const issues = items.filter((i) => i.status === 'issue');
      historyBox.append(el('div', { style: `background:${c.overall_status === 'issues' ? '#fff8e1' : '#e8f5e9'};border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:var(--text-sm)` }, [
        el('div', { style: 'display:flex;justify-content:space-between' }, [
          el('b', {}, c.mine_name),
          el('span', { style: `color:${c.overall_status === 'issues' ? '#f57c00' : '#2e7d32'};font-weight:700` }, c.overall_status === 'issues' ? `⚠️ ${issues.length} مورد` : '✅ سالم'),
        ]),
        el('div', { style: 'color:var(--stone-500);font-size:var(--text-xs)' }, `${new Date(c.shift_date).toLocaleDateString('fa-IR')}${c.inside_boundary === false ? ' | ⚠️ خارج از محدوده ثبت شده' : ''}`),
      ]));
    });
  }

  const govLinksBox = el('div');
  mountGovLinks(govLinksBox, roleRow.membership_no, roleRow.national_code);
  const bioToggleBox = el('div');
  mountBiometricToggle(bioToggleBox, email);
  const notifToggleBox = el('div');
  const gpsChipBox = el('div', { style: 'margin-top:4px' });
  const checkinBox = el('div');

  const shell = el('div', { class: 'app-shell' }, [
    el('div', { class: 'topbar' }, [
      el('div', {}, [el('div', { class: 'title' }, email), el('div', { class: 'sub' }, `${meta.icon} پنل ${meta.label}`), gpsChipBox]),
      el('button', { class: 'btn-sm', style: 'background:rgba(255,255,255,.15);color:#fff', onclick: onLogout }, 'خروج'),
    ]),
    el('div', { class: 'content' }, [
      banners,
      el('div', { class: 'card' }, [
        el('h3', {}, '👤 مشخصات (روی چک‌لیست و عکس‌ها درج می‌شود)'),
        el('label', {}, 'نام و نام خانوادگی'), fullNameInput,
        el('label', {}, 'شماره عضویت نظام مهندسی/پروانه'), membershipInput,
        saveBtn, profileStatus,
        bioToggleBox,
        notifToggleBox,
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '⛏️ انتخاب معدن'),
        mineSelect,
        el('button', {
          class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700);margin-top:10px',
          onclick: () => { const mine = currentMine(); if (!mine) { showToast('⚠️ ابتدا معدن را انتخاب کنید'); return; } openIncidentModal(mine, 'نام_معدن', department, { email }); },
        }, '🚨 اعلام حادثه'),
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '🦺 چک‌این ایمنی کارگر تنها'),
        checkinBox,
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, `✅ چک‌لیست ${meta.label} نوبت‌کاری`),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'این چک‌لیست باید داخل محدوده‌ی قانونی معدن پر شود؛ برخی آیتم‌ها نیاز به عکس دارند.'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => {
            const mine = currentMine();
            if (!mine) { showToast('⚠️ ابتدا معدن را از لیست بالا انتخاب کنید'); return; }
            openRoleChecklistModal(mine, department, role, email, loadHistory);
          },
        }, '📋 شروع چک‌لیست'),
      ]),
      el('div', { class: 'card' }, [el('h3', {}, '🗂️ چک‌لیست‌های ارسالی قبلی'), historyBox]),
      govLinksBox,
    ]),
  ]);
  root.append(shell);
  mountGpsStatusChip(gpsChipBox);
  mountSafetyCheckin(checkinBox, { email, getMineName: () => currentMine()?.['نام_معدن'] || '', department });
  mountNotificationToggle(notifToggleBox);
  loadHistory();
}

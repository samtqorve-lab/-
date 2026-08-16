import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { specialtyMeta } from '../../lib/records.js';
import { monthlyReminderStatus, licenseExpiryStatus } from '../../lib/banners.js';
import { openSafetyChecklistModal } from './safetyChecklist.js';
import { mountEquipmentChecklist } from './equipmentChecklist.js';
import { mountHistory } from './history.js';
import { mountMonthlyReport } from './monthlyReport.js';
import { mountGovLinks } from './mineCards.js';
import { openIncidentModal } from './incidentModal.js';
import { mountBiometricToggle } from '../shell/biometricToggle.js';
import { mountGpsStatusChip } from '../shell/gpsStatusChip.js';
import { mountSafetyCheckin } from '../shell/safetyCheckinWidget.js';
import { mountNotificationToggle } from '../shell/notificationToggle.js';
import { checkAndNotify } from '../../lib/localNotifications.js';
import { openStakeoutModal } from './stakeout.js';
import { mountMultiMineOverview } from './multiMineOverview.js';
import {
  openTrainingModal, openProductionModal, openPersonnelModal, openCorrectiveModal, openQuarterlyMapModal,
} from './supplementaryReports.js';

const SPEC_ICONS = { استخراج: '⛏️', اکتشاف: '🔍', فرآوری: '⚗️' };

export async function mountTechOfficerPanel(root, { email, mines, identityVerifiedAt, roleRow, identitySettings, onLogout }) {
  root.innerHTML = '';

  const specialty = roleRow.tech_officer_specialty || 'استخراج';
  const meta = specialtyMeta(specialty);
  const nameField = meta.nameField;

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
    const text = lic.kind === 'expired' ? '⏰ پروانه اشتغال به کار شما منقضی شده است (ماده ۴ قانون نظام مهندسی معدن).'
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
    ? mines.map((m) => el('option', { value: m[nameField] }, m[nameField]))
    : [el('option', { value: '' }, '— موردی اختصاص نیافته —')]);

  const equipBox = el('div');
  const reportBox = el('div');
  const historyBox = el('div');
  const govLinksBox = el('div');
  const bioToggleBox = el('div');
  let historyMount = null;

  function currentMine() {
    return mines.find((m) => m[nameField] === mineSelect.value);
  }
  function requireMine(fn) {
    return () => {
      const mine = currentMine();
      if (!mine) { showToast('⚠️ ابتدا معدن را از لیست بالا انتخاب کنید'); return; }
      fn(mine);
    };
  }
  function refreshMineDependent() {
    equipBox.innerHTML = '';
    reportBox.innerHTML = '';
    const mine = currentMine();
    if (mine) {
      mountEquipmentChecklist(equipBox, mine, nameField, meta.dept, fullNameInput, membershipInput);
      mountMonthlyReport(
        reportBox,
        currentMine,
        nameField,
        meta.dept,
        () => ({ fullName: fullNameInput.value.trim(), membershipNo: membershipInput.value.trim() }),
        () => historyMount?.reload(),
      );
    }
  }
  mineSelect.addEventListener('change', refreshMineDependent);

  const gpsChipBox = el('div', { style: 'margin-top:4px' });
  const checkinBox = el('div');
  const notifToggleBox = el('div');
  const multiMineBox = el('div', { style: 'margin-top:10px' });

  const shell = el('div', { class: 'app-shell' }, [
    el('div', { class: 'topbar' }, [
      el('div', {}, [
        el('div', { class: 'title' }, email),
        el('div', { class: 'sub' }, `${SPEC_ICONS[specialty] || '🦺'} مسئول فنی — تخصص: ${specialty}`),
        gpsChipBox,
      ]),
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
        el('h3', {}, `${meta.dept === 'معدن' ? '⛏️' : meta.dept === 'اکتشاف' ? '🔍' : '⚗️'} انتخاب ${meta.dept === 'معدن' ? 'معدن' : meta.dept === 'اکتشاف' ? 'محدوده اکتشافی' : 'واحد فرآوری'}`),
        mineSelect,
        multiMineBox,
        el('button', {
          class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700);margin-top:10px',
          onclick: requireMine((mine) => openIncidentModal(mine, nameField, meta.dept, { email })),
        }, '🚨 اعلام حادثه'),
        el('button', {
          class: 'btn-sm', style: 'background:#e8f5e9;color:#1b5e20;margin-top:8px',
          onclick: requireMine((mine) => openStakeoutModal(mine, nameField)),
        }, '🎯 پیاده کردن نقاط پروانه (استیک‌اوت GPS)'),
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '🦺 چک‌این ایمنی کارگر تنها'),
        checkinBox,
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '✅ چک‌لیست ایمنی نوبت‌کاری'),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'این چک‌لیست باید داخل محدوده‌ی قانونی معدن پر شود.'),
        el('button', { class: 'btn btn-primary', onclick: requireMine((mine) => openSafetyChecklistModal(mine, nameField, meta.dept)) }, '📋 شروع چک‌لیست'),
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '⚙️ چک‌لیست تجهیزات/ماشین‌آلات تایید‌شده'),
        equipBox,
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '📤 گزارش دوره‌ای ماهانه'),
        reportBox,
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '🗂️ گزارش‌های تکمیلی'),
        el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'ثبت سریع آموزش، تولید، پرسنل، اقدام اصلاحی و نقشه‌ی سه‌ماهه.'),
        el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, [
          el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)', onclick: requireMine((mine) => openTrainingModal(mine, nameField, meta.dept)) }, '🎓 آموزش ایمنی'),
          el('button', { class: 'btn-sm', style: 'background:#e3f2fd;color:#1565c0', onclick: requireMine((mine) => openProductionModal(mine, nameField, meta.dept)) }, '📈 تولید و عیار'),
          el('button', { class: 'btn-sm', style: 'background:#e8eaf6;color:#3949ab', onclick: requireMine((mine) => openPersonnelModal(mine, nameField, meta.dept)) }, '👷 پرسنل تحت سرپرستی'),
          el('button', { class: 'btn-sm', style: 'background:var(--amber-100);color:var(--amber-700)', onclick: requireMine((mine) => openCorrectiveModal(mine, nameField, meta.dept)) }, '🛠️ اقدام اصلاحی'),
          el('button', { class: 'btn-sm', style: 'background:#f3e5f5;color:#6a1b9a;grid-column:1 / -1', onclick: requireMine((mine) => openQuarterlyMapModal(mine, nameField, meta.dept)) }, '🗺️ نقشه سه‌ماهه'),
        ]),
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '🗂️ گزارش‌های ارسالی قبلی'),
        historyBox,
      ]),
      govLinksBox,
    ]),
  ]);
  root.append(shell);
  refreshMineDependent();
  historyMount = mountHistory(historyBox, mines.map((m) => m[nameField]));
  mountGovLinks(govLinksBox, roleRow.membership_no, roleRow.national_code);
  mountBiometricToggle(bioToggleBox, email);
  mountGpsStatusChip(gpsChipBox);
  mountSafetyCheckin(checkinBox, { email, getMineName: () => currentMine()?.[nameField] || '', department: meta.dept });
  mountNotificationToggle(notifToggleBox);
  mountMultiMineOverview(multiMineBox, mines, nameField, (name) => { mineSelect.value = name; refreshMineDependent(); });
}

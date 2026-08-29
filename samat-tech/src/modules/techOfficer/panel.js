import { el, showToast, openModal } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { specialtyMeta } from '../../lib/records.js';
import { monthlyReminderStatus, licenseExpiryStatus } from '../../lib/banners.js';
import { createFaceEquipCapture } from './faceEquipCapture.js';
import { mountDrawerMenu } from '../shell/drawerMenu.js';
import { mountBiometricToggle } from '../shell/biometricToggle.js';
import { mountPushLoginToggle } from '../shell/pushLoginToggle.js';
import { mountGpsStatusChip } from '../shell/gpsStatusChip.js';
import { mountSafetyCheckin } from '../shell/safetyCheckinWidget.js';
import { mountNotificationToggle } from '../shell/notificationToggle.js';
import { checkAndNotify } from '../../lib/localNotifications.js';
import { mountMultiMineOverview } from './multiMineOverview.js';
// نکته‌ی کارایی: بقیه‌ی ماژول‌ها (چک‌لیست‌ها، گزارش‌ها، نقشه‌ی استیک‌اوت با Leaflet، و...) عمداً
// این‌جا import نمی‌شوند — هرکدام فقط با import() پویا، دقیقاً لحظه‌ای که کاربر همان دکمه را
// می‌زند بارگذاری می‌شوند. چون این اپ اغلب در سایت‌های معدنیِ با اینترنت ضعیف باز می‌شود، این کار
// حجم دانلود اولیه‌ی اپ را به‌طور محسوس کم می‌کند (Leaflet به‌تنهایی ده‌ها کیلوبایت است).

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

  const gpsChipBox = el('div', { style: 'margin-top:4px' });
  const multiMineBox = el('div', { style: 'margin-top:10px' });
  let historyMount = null; // فقط وقتی مودال «گزارش‌های ارسالی قبلی» باز می‌شود مقداردهی می‌شود

  const captureApi = createFaceEquipCapture({
    getMine: currentMine, nameField, department: meta.dept,
    getProfile: () => ({ fullName: fullNameInput.value.trim(), membershipNo: membershipInput.value.trim() }),
  });
  const captureBox = el('div');
  captureApi.mountWidget(captureBox);

  // ── منوی کشویی: هر چیزی غیر از «انتخاب معدن / پیاده کردن نقاط پروانه / عکس سینه‌کار و ماشین‌آلات» ──
  const drawer = mountDrawerMenu([
    {
      icon: '👤',
      label: 'مشخصات و تنظیمات',
      onClick: () => {
        const { body } = openModal({ title: '👤 مشخصات و تنظیمات' });
        const bioBox = el('div'); const pushBox = el('div'); const notifBox = el('div');
        body.append(
          el('label', {}, 'نام و نام خانوادگی'), fullNameInput,
          el('label', {}, 'شماره عضویت نظام مهندسی/پروانه'), membershipInput,
          saveBtn, profileStatus,
          el('div', { style: 'height:1px;background:var(--stone-200);margin:14px 0' }),
          bioBox, pushBox, notifBox,
        );
        mountBiometricToggle(bioBox, email);
        mountPushLoginToggle(pushBox, email);
        mountNotificationToggle(notifBox);
      },
    },
    {
      icon: '🦺',
      label: 'چک‌این ایمنی کارگر تنها',
      onClick: () => {
        const { body } = openModal({ title: '🦺 چک‌این ایمنی کارگر تنها' });
        mountSafetyCheckin(body, { email, getMineName: () => currentMine()?.[nameField] || '', department: meta.dept });
      },
    },
    {
      icon: '✅',
      label: 'چک‌لیست ایمنی نوبت‌کاری',
      onClick: requireMine(async (mine) => {
        const { openSafetyChecklistModal } = await import('./safetyChecklist.js');
        openSafetyChecklistModal(mine, nameField, meta.dept);
      }),
    },
    {
      icon: '🔳',
      label: 'تایید حضور با اسکن QR',
      onClick: requireMine(async (mine) => {
        const { scanQrCheckin } = await import('./qrCheckin.js');
        scanQrCheckin(mine, nameField, meta.dept);
      }),
    },
    {
      icon: '🚨',
      label: 'اعلام حادثه',
      onClick: requireMine(async (mine) => {
        const { openIncidentModal } = await import('./incidentModal.js');
        openIncidentModal(mine, nameField, meta.dept, { email });
      }),
    },
    {
      icon: '⚙️',
      label: 'چک‌لیست تجهیزات/ماشین‌آلات تایید‌شده',
      onClick: requireMine(async (mine) => {
        const { mountEquipmentChecklist } = await import('./equipmentChecklist.js');
        const { body } = openModal({ title: '⚙️ چک‌لیست تجهیزات/ماشین‌آلات تایید‌شده', width: '560px' });
        mountEquipmentChecklist(body, mine, nameField, meta.dept, fullNameInput, membershipInput);
      }),
    },
    {
      icon: '📤',
      label: 'ارسال گزارش دوره‌ای ماهانه',
      onClick: async () => {
        const { mountMonthlyReport } = await import('./monthlyReport.js');
        const { body } = openModal({ title: '📤 گزارش دوره‌ای ماهانه', width: '560px' });
        mountMonthlyReport(
          body, currentMine, nameField, meta.dept,
          () => ({ fullName: fullNameInput.value.trim(), membershipNo: membershipInput.value.trim() }),
          captureApi,
          () => historyMount?.reload(),
        );
      },
    },
    {
      icon: '🗂️',
      label: 'گزارش‌های تکمیلی',
      onClick: requireMine(async (mine) => {
        const {
          openTrainingModal, openProductionModal, openPersonnelModal, openCorrectiveModal, openQuarterlyMapModal,
        } = await import('./supplementaryReports.js');
        const { body } = openModal({ title: '🗂️ گزارش‌های تکمیلی' });
        body.append(
          el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-bottom:10px' }, 'ثبت سریع آموزش، تولید، پرسنل، اقدام اصلاحی و نقشه‌ی سه‌ماهه.'),
          el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, [
            el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)', onclick: () => openTrainingModal(mine, nameField, meta.dept) }, '🎓 آموزش ایمنی'),
            el('button', { class: 'btn-sm', style: 'background:var(--schist-100);color:var(--schist-600)', onclick: () => openProductionModal(mine, nameField, meta.dept) }, '📈 تولید و عیار'),
            el('button', { class: 'btn-sm', style: 'background:var(--patina-100);color:var(--patina-700)', onclick: () => openPersonnelModal(mine, nameField, meta.dept) }, '👷 پرسنل تحت سرپرستی'),
            el('button', { class: 'btn-sm', style: 'background:var(--amber-100);color:var(--amber-700)', onclick: () => openCorrectiveModal(mine, nameField, meta.dept) }, '🛠️ اقدام اصلاحی'),
            el('button', { class: 'btn-sm', style: 'background:var(--fluorite-100);color:var(--fluorite-700);grid-column:1 / -1', onclick: () => openQuarterlyMapModal(mine, nameField, meta.dept) }, '🗺️ نقشه سه‌ماهه'),
          ]),
        );
      }),
    },
    {
      icon: '🗂️',
      label: 'گزارش‌های ارسالی قبلی',
      onClick: async () => {
        const { mountHistory } = await import('./history.js');
        const { body } = openModal({ title: '🗂️ گزارش‌های ارسالی قبلی', width: '560px' });
        historyMount = mountHistory(body, mines.map((m) => m[nameField]));
      },
    },
    {
      icon: '🏛️',
      label: 'سامانه‌های دولتی مرتبط',
      onClick: async () => {
        const { mountGovLinks } = await import('./mineCards.js');
        const { body } = openModal({ title: '🏛️ سامانه‌های دولتی مرتبط' });
        mountGovLinks(body, roleRow.membership_no, roleRow.national_code);
      },
    },
  ]);

  const shell = el('div', { class: 'app-shell' }, [
    el('div', { class: 'topbar' }, [
      el('div', {}, [
        el('div', { class: 'title' }, roleRow.membership_no || roleRow.full_name || email),
        el('div', { class: 'sub' }, `${SPEC_ICONS[specialty] || '🦺'} مسئول فنی — تخصص: ${specialty}`),
        gpsChipBox,
      ]),
      el('div', { style: 'display:flex;gap:6px;align-items:center' }, [
        drawer.toggleBtn,
        el('button', { class: 'btn-sm', style: 'background:rgba(255,255,255,.15);color:#fff', onclick: onLogout }, 'خروج'),
      ]),
    ]),
    el('div', { class: 'content' }, [
      banners,
      el('div', { class: 'card' }, [
        el('h3', {}, `${meta.dept === 'معدن' ? '⛏️' : meta.dept === 'اکتشاف' ? '🔍' : '⚗️'} انتخاب ${meta.dept === 'معدن' ? 'معدن' : meta.dept === 'اکتشاف' ? 'محدوده اکتشافی' : 'واحد فرآوری'}`),
        mineSelect,
        multiMineBox,
        el('button', {
          class: 'btn-sm', style: 'background:var(--patina-50);color:var(--patina-700);margin-top:10px;width:100%',
          onclick: requireMine(async (mine) => {
            const { openStakeoutModal } = await import('./stakeout.js');
            openStakeoutModal(mine, nameField);
          }),
        }, '🎯 پیاده کردن نقاط پروانه (استیک‌اوت GPS)'),
      ]),
      el('div', { class: 'card' }, [
        el('h3', {}, '📷 عکس سینه‌کار و ماشین‌آلات'),
        captureBox,
        el('div', { style: 'height:1px;background:var(--stone-200);margin:14px 0' }),
        el('button', {
          class: 'btn-sm', style: 'width:100%;background:var(--amber-50);color:var(--amber-700)',
          onclick: requireMine(async (mine) => {
            const { mountEquipmentChecklist } = await import('./equipmentChecklist.js');
            const { body } = openModal({ title: '🛢️ ماشین‌آلات پیش‌فرض معدن (سهمیه‌ی سوخت)', width: '560px' });
            mountEquipmentChecklist(body, mine, nameField, meta.dept, fullNameInput, membershipInput);
          }),
        }, '🛢️ ماشین‌آلات پیش‌فرض معدن (برای سهمیه‌ی سوخت)'),
      ]),
    ]),
  ]);
  root.append(shell);
  mountGpsStatusChip(gpsChipBox);
  mountMultiMineOverview(multiMineBox, mines, nameField, (name) => { mineSelect.value = name; });
}

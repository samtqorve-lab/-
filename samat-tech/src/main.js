import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { sb } from './lib/supabase.js';
import { mountLogin } from './modules/login/login.js';
import { mountIdentityPending, mountIdentityCapture, mountIdentityQueuedOffline } from './modules/identity/identityGate.js';
import { mountBiometricGate } from './modules/identity/biometricGate.js';
import { mountTechOfficerPanel } from './modules/techOfficer/panel.js';
import { mountSafetyOfficerPanel } from './modules/safetyOfficer/panel.js';
import { mountOwnerPanel } from './modules/owner/panel.js';
import { fetchAssignedMines, fetchMinesByGeoScope, specialtyMeta } from './lib/records.js';
import { mountStaffFieldPicker } from './modules/shell/staffFieldPicker.js';
import { checkIdentityGate, loadIdentitySettings, submitIdentityVerification } from './lib/identity.js';
import { registerSender, initOfflineQueueWatcher } from './lib/offlineQueue.js';
import { startManagedGpsPrewarm, stopGpsPrewarm } from './lib/geo.js';
import { mountOfflineBadge } from './modules/shell/offlineBadge.js';
import { mountOnboarding, shouldShowOnboarding } from './modules/shell/onboarding.js';
import { hasBiometricCred } from './lib/biometric.js';
import { el, showToast } from './lib/dom.js';

const OFFICER_ROLES = ['tech_officer', 'safety_officer', 'health_officer'];
// این نقش‌ها (همان نقش‌های پنل ادمین) اجازه دارند وارد اپ مسئول فنی شوند تا خودشان سر معدن
// یک گزارش با موقعیت مکانی زنده ثبت کنند — بدون این‌که نقش ثابتشان در جدول کاربران عوض شود.
const STAFF_FIELD_ROLES = ['admin', 'superadmin', 'inspector'];

registerSender('identityVerification', submitIdentityVerification);
mountOfflineBadge();
initOfflineQueueWatcher(showToast);

function logoutAndReload() {
  stopGpsPrewarm();
  sb.auth.signOut().then(() => window.location.reload());
}

async function boot() {
  const root = document.getElementById('app');
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    mountLogin(root, () => window.location.reload());
    return;
  }
  const email = session.user.email;

  if (hasBiometricCred(email)) {
    const ok = await mountBiometricGate(root, email, logoutAndReload);
    if (!ok) return; // (در عمل همیشه true resolve می‌شود یا کاربر خارج شده)
  }

  const { data } = await sb.from('user_roles')
    .select('role, assigned_mines, tech_officer_specialty, identity_status, identity_verified_at, trusted_device_id, full_name, membership_no, national_code, license_no, license_expiry_date, assigned_province, assigned_county')
    .eq('email', email).limit(1);
  const row = (data && data[0]) || { role: 'pending', assigned_mines: [] };

  root.innerHTML = '';

  if (row.role === 'pending') {
    root.append(el('div', { class: 'gate-screen' }, el('div', { class: 'gate-card' }, [
      el('div', { style: 'text-align:center' }, [
        el('div', { style: 'font-size:32px' }, '⏳'),
        el('div', { style: 'margin-top:8px;font-size:var(--text-sm)' }, 'حساب شما هنوز توسط مدیر سامانه تایید نشده.'),
      ]),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:14px', onclick: logoutAndReload }, 'خروج'),
    ])));
    return;
  }

  if (!OFFICER_ROLES.includes(row.role) && !STAFF_FIELD_ROLES.includes(row.role) && row.role !== 'owner') {
    root.append(el('div', { class: 'gate-screen' }, el('div', { class: 'gate-card' }, [
      el('div', { style: 'text-align:center' }, [
        el('div', { style: 'font-size:32px' }, '🚫'),
        el('div', { style: 'margin-top:8px;font-size:var(--text-sm)' }, 'این حساب دسترسی به اپ مسئول فنی ندارد.'),
      ]),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:14px', onclick: logoutAndReload }, 'خروج'),
    ])));
    return;
  }

  // حساب‌های ستادی (ادمین/بازرس): چون از قبل مجوز/عضویت نظام‌مهندسی و مسئولیت ثابت روی یک معدن
  // خاص ندارند، گیت احراز هویت ماهانه (که مخصوص مسئولین فنی/ایمنی/بهداشت پروانه‌دار است) رد
  // می‌شود؛ فقط سمت و تخصص گزارش را انتخاب می‌کنند و مستقیم می‌روند سراغ همان پنل با فهرست معادن
  // بر اساس محدوده‌ی جغرافیایی حسابشان (نه یک whitelist ثابت).
  if (STAFF_FIELD_ROLES.includes(row.role)) {
    mountStaffFieldPicker(root, async ({ role: chosenRole, specialty }) => {
      root.innerHTML = '';
      const mines = await fetchMinesByGeoScope(specialty, row.assigned_province, row.assigned_county);
      startManagedGpsPrewarm();
      const staffRow = { ...row, role: chosenRole, tech_officer_specialty: specialty };
      if (chosenRole === 'tech_officer') {
        await mountTechOfficerPanel(root, {
          email, mines, identityVerifiedAt: Date.now(), roleRow: staffRow, identitySettings: { monthlyMs: Infinity, reminderMs: Infinity }, onLogout: logoutAndReload,
        });
      } else {
        await mountSafetyOfficerPanel(root, {
          email, mines, identityVerifiedAt: Date.now(), roleRow: staffRow, identitySettings: { monthlyMs: Infinity, reminderMs: Infinity }, onLogout: logoutAndReload,
        });
      }
    }, logoutAndReload);
    return;
  }

  // بهره‌بردار: مثل مسئولین، فهرست معادن ثابتی دارد (assigned_mines) — اما چون یک نقش پروانه‌دار
  // نیست، گیت احراز هویت ماهانه رد می‌شود و مستقیم می‌رود سراغ پنل خودش (اطلاعیه‌ها + ثبت گزارش).
  if (row.role === 'owner') {
    const mines = await fetchAssignedMines(row.tech_officer_specialty || 'استخراج', row.assigned_mines);
    startManagedGpsPrewarm();
    await mountOwnerPanel(root, { email, mines, roleRow: row, department: specialtyMeta(row.tech_officer_specialty || 'استخراج').dept, onLogout: logoutAndReload });
    return;
  }

  const mines = await fetchAssignedMines(row.tech_officer_specialty, row.assigned_mines);
  const identitySettings = await loadIdentitySettings();

  // از همین لحظه (بعد از تایید نقش، قبل از هر صفحه‌ای که ممکن است عکس/GPS بخواهد) GPS را
  // پیش‌گرم می‌کنیم — چه کاربر برود سراغ صفحه‌ی احراز هویت، چه مستقیم به پنل اصلی برسد، دیگر از
  // صفر منتظر «لود شدن» GPS نمی‌ماند.
  startManagedGpsPrewarm();
  const gate = await checkIdentityGate(email, row, identitySettings.monthlyMs);

  if (!gate.ok) {
    if (gate.kind === 'pending') {
      mountIdentityPending(root, 'عکس احراز هویت شما ارسال شد و در انتظار بررسی و تایید مدیر سامانه است. پس از تایید، دسترسی شما فعال می‌شود.', logoutAndReload);
      return;
    }
    const meta = specialtyMeta(row.tech_officer_specialty || 'استخراج');
    mountIdentityCapture(root, {
      email, mines, captureKind: gate.captureKind, reason: gate.reason, nameField: meta.nameField,
    }, () => window.location.reload(), () => mountIdentityQueuedOffline(root, () => window.location.reload()));
    return;
  }

  if (row.role === 'tech_officer') {
    await mountTechOfficerPanel(root, {
      email, mines, identityVerifiedAt: row.identity_verified_at, roleRow: row, identitySettings, onLogout: logoutAndReload,
    });
  } else {
    await mountSafetyOfficerPanel(root, {
      email, mines, identityVerifiedAt: row.identity_verified_at, roleRow: row, identitySettings, onLogout: logoutAndReload,
    });
  }

  if (shouldShowOnboarding()) mountOnboarding(document.body, () => {});
}

boot();


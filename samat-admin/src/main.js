import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { getSession, fetchMyRole, isStaffRole } from './lib/auth.js';
import { setGeoScope } from './router.js';
import { mountLogin } from './modules/shell/login.js';
import { mountShell } from './modules/shell/shell.js';
import { startInactivityGuard } from './modules/shell/inactivityGuard.js';
import { renderDashboard } from './modules/dashboard/dashboard.js';

// بقیه‌ی تب‌ها به‌صورت تنبل (dynamic import) لود می‌شوند — چون هرکدام یک کتابخانه‌ی نسبتاً سنگین
// با خودشان می‌آورند (نقشه→Leaflet، الزامات قانونی/هویت→تقویم شمسی، مدیریت کاربران→فرم‌های حجیم)
// و اکثر جلسات کاری فقط ۱-۲ تب را باز می‌کنند؛ فقط داشبورد (تب پیش‌فرض هنگام ورود) بلافاصله لازم
// است، برای همین همچنان eager import شده تا اولین نمایش صفحه یک رفت‌وبرگشت شبکه‌ی اضافه نخورد.
const LAZY_RENDERERS = {
  mines: () => import('./modules/mines/mineList.js').then((m) => m.renderMineList),
  mineDetail: () => import('./modules/mines/mineDetail.js').then((m) => m.renderMineDetail),
  legal: () => import('./modules/legal/legal.js').then((m) => m.renderLegal),
  checklist: () => import('./modules/checklist/checklist.js').then((m) => m.renderChecklist),
  notices: () => import('./modules/notices/notices.js').then((m) => m.renderNotices),
  map: () => import('./modules/map/mapView.js').then((m) => m.renderMap),
  identity: () => import('./modules/identity/identity.js').then((m) => m.renderIdentity),
  users: () => import('./modules/users/users.js').then((m) => m.renderUsers),
  audit: () => import('./modules/audit/auditLog.js').then((m) => m.renderAuditLog),
};

let appCtx = null;

async function renderContent(container, state) {
  if (state.tab === 'dashboard') { await renderDashboard(container, state, appCtx); return; }
  const loadFn = LAZY_RENDERERS[state.tab];
  if (!loadFn) return;
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div>در حال بارگذاری بخش...</div>';
  const fn = await loadFn();
  await fn(container, state, appCtx);
}

async function boot() {
  const root = document.getElementById('app');
  const session = await getSession();

  if (!session) {
    mountLogin(root, () => window.location.reload());
    return;
  }

  let roleRow;
  try {
    roleRow = await fetchMyRole(session.user.email);
  } catch {
    root.innerHTML = '<div class="empty-state">حساب شما هنوز در سامانه تعریف نشده — با مدیر سیستم تماس بگیرید.</div>';
    return;
  }

  if (!isStaffRole(roleRow.role)) {
    root.innerHTML = '<div class="empty-state">این حساب دسترسی به پنل مدیریت ندارد.</div>';
    return;
  }

  setGeoScope(roleRow.assigned_province, roleRow.assigned_county);
  appCtx = { myEmail: session.user.email, myRole: roleRow.role };
  startInactivityGuard();

  mountShell(root, {
    userLabel: `${roleRow.full_name || session.user.email} — ${roleRow.role}`,
    renderContent,
  });
}

boot();

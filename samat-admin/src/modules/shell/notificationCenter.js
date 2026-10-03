import { el } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import { getSession } from '../../lib/auth.js';
import { fetchPendingIdentityCount, fetchPendingBoundaryCount } from '../../lib/identity.js';
import { openNotificationDetail } from '../../lib/notificationRoute.js';
import { getState, setTab, onChange } from '../../router.js';

const SEEN_KEY = 'samat.notif.seenAt';
const REFRESH_MS = 120000;

function readSeen() {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
}
function writeSeen(iso) {
  try { localStorage.setItem(SEEN_KEY, iso); } catch { /* ignore */ }
}

let nativeTapAttached = false;
/**
 * لمس روی اعلان سیستمی اندروید (Push یا اعلان محلی): قبلاً فقط «تایید ورود» پردازش می‌شد و لمس بقیه‌ی
 * اعلان‌ها اپ را باز می‌کرد ولی هیچ‌چیز نشان نمی‌داد. حالا جزئیات اعلان باز می‌شود.
 * (اگر اپ با لمس اعلان از حالت بسته باز شده باشد، Capacitor رویداد را تا اضافه‌شدن شنونده نگه می‌دارد.)
 */
async function attachNativeTapHandlers() {
  if (nativeTapAttached) return;
  nativeTapAttached = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const n = action.notification || {};
      const data = n.data || {};
      if (data.type === 'login-approval') return; // این یکی را pushNative.js پردازش می‌کند
      openNotificationDetail({ title: n.title, body: n.body, data, created_at: new Date().toISOString() });
    });
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const n = event.notification || {};
      const data = n.extra || {};
      if (data.type === 'login-approval') return;
      openNotificationDetail({ title: n.title, body: n.body, data, created_at: new Date().toISOString() });
    });
  } catch { nativeTapAttached = false; }
}

/**
 * مرکز اعلان‌ها (زنگ بالای صفحه): کارهای منتظر اقدام (احراز هویت و پایش مرزی) + آخرین اعلان‌های
 * جدول notifications برای همین کاربر (با Realtime). با لمس هر اعلان، جزئیات کامل آن (و دکمه‌ی رفتن
 * به صفحه‌ی مربوط) باز می‌شود. «خوانده‌شده» فقط سمت دستگاه ذخیره می‌شود.
 */
export function mountNotificationCenter(host) {
  const badge = el('span', { class: 'bell-badge' });
  const btn = el('button', {
    class: 'top-icon-btn', type: 'button', 'aria-label': 'اعلان‌ها', title: 'اعلان‌ها',
    onclick: (e) => { e.stopPropagation(); toggle(); },
  }, ['🔔', badge]);
  const panel = el('div', { class: 'notif-panel' });
  host.append(btn);
  document.body.append(panel);

  let email = '';
  let pending = { identity: 0, boundary: 0 };
  let items = [];
  let isOpen = false;

  const unreadCount = (seenAt) => items.filter((n) => n.created_at && (!seenAt || n.created_at > seenAt)).length;

  function renderBadge() {
    const total = pending.identity + pending.boundary + unreadCount(readSeen());
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.display = total > 0 ? 'inline-flex' : 'none';
  }

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; }
  }

  function renderPanel(seenAt) {
    panel.innerHTML = '';
    panel.append(el('div', { class: 'notif-head' }, '🔔 اعلان‌ها'));

    const todo = [];
    if (pending.identity > 0) todo.push({ icon: '🪪', title: `${pending.identity} درخواست احراز هویت در انتظار بررسی`, run: () => setTab('identity') });
    if (pending.boundary > 0) todo.push({ icon: '🛰️', title: `${pending.boundary} مورد پایش مرزی نیازمند بررسی`, run: () => setTab('boundaryMonitor') });
    if (todo.length) {
      panel.append(el('div', { class: 'notif-sec' }, 'نیازمند اقدام'));
      todo.forEach((t) => panel.append(el('button', {
        class: 'notif-item', type: 'button', onclick: () => { close(); t.run(); },
      }, [el('span', { class: 'ni-ico' }, t.icon), el('span', { class: 'nt' }, t.title)])));
    }

    if (items.length) {
      panel.append(el('div', { class: 'notif-sec' }, 'اعلان‌های اخیر'));
      items.forEach((n) => {
        const unread = n.created_at && (!seenAt || n.created_at > seenAt);
        // دکمه‌ی واقعی (نه div) تا لمس/کلیک کار کند: جزئیات کامل اعلان در یک مودال باز می‌شود
        panel.append(el('button', {
          class: `notif-item${unread ? ' unread' : ''}`, type: 'button',
          onclick: () => { close(); openNotificationDetail(n); },
        }, [
          el('span', { class: 'ni-ico' }, unread ? '🔵' : '▫️'),
          el('span', { class: 'ni-txt' }, [
            el('span', { class: 'nt' }, n.title || 'اعلان'),
            n.body ? el('span', { class: 'nb' }, String(n.body).length > 90 ? `${String(n.body).slice(0, 90)}…` : n.body) : null,
            n.created_at ? el('span', { class: 'nd' }, fmtTime(n.created_at)) : null,
          ]),
        ]));
      });
    }

    if (!todo.length && !items.length) {
      panel.append(el('div', { class: 'notif-empty' }, 'اعلان یا موردی برای بررسی وجود ندارد ✅'));
    }
  }

  function open() {
    isOpen = true;
    const seenBefore = readSeen();
    renderPanel(seenBefore);
    panel.classList.add('open');
    writeSeen(new Date().toISOString());
    renderBadge();
  }
  function close() {
    isOpen = false;
    panel.classList.remove('open');
  }
  function toggle() { if (isOpen) close(); else open(); }
  document.addEventListener('click', (e) => {
    if (isOpen && !panel.contains(e.target) && !btn.contains(e.target)) close();
  });

  async function loadNotifications() {
    if (!email) return [];
    let res = await sb.from('notifications').select('*').eq('recipient_email', email)
      .order('created_at', { ascending: false }).limit(20);
    if (res.error) res = await sb.from('notifications').select('*').eq('recipient_email', email).limit(20);
    return res.error ? [] : (res.data || []);
  }

  async function refresh() {
    const [identity, boundary, list] = await Promise.all([
      Promise.resolve(fetchPendingIdentityCount(getState().department)).catch(() => 0),
      Promise.resolve(fetchPendingBoundaryCount()).catch(() => 0),
      loadNotifications().catch(() => []),
    ]);
    pending = { identity: Number(identity) || 0, boundary: Number(boundary) || 0 };
    items = list;
    renderBadge();
    if (isOpen) renderPanel(readSeen());
  }

  async function init() {
    attachNativeTapHandlers();
    try {
      const session = await getSession();
      email = session?.user?.email || '';
    } catch { email = ''; }
    await refresh();
    if (email) {
      sb.channel(`bell-${email}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_email=eq.${email}`,
        }, (payload) => {
          items = [payload.new, ...items].slice(0, 20);
          renderBadge();
          if (isOpen) renderPanel(readSeen());
        })
        .subscribe();
    }
    setInterval(refresh, REFRESH_MS);
    onChange(() => { refresh(); });
  }
  init();
}

import { el, openModal, fmtDateTime } from './dom.js';
import { setTab } from '../router.js';

// صفحه‌هایی که اعلان اجازه دارد کاربر را به آن‌ها ببرد (برای جلوگیری از رفتن به تب نامعتبر)
const KNOWN_TABS = [
  'dashboard', 'mines', 'identity', 'users', 'boundaryMonitor', 'notices', 'compliance',
  'stats', 'presenceReport', 'checklist', 'legal', 'audit',
];

// اگر خود اعلان تب مقصد را نداشته باشد، از روی متن عنوان/متن حدس زده می‌شود
const KEYWORD_RULES = [
  [/احراز|هویت/, 'identity'],
  [/ثبت.?نام|کاربر جدید|نقش/, 'users'],
  [/مرز|پایش/, 'boundaryMonitor'],
  [/اطلاعیه/, 'notices'],
  [/پروانه|انقضا|رتبه/, 'compliance'],
  [/حادثه|گزارش|چک.?لیست|شیفت/, 'mines'],
];

/** صفحه‌ی مقصد یک اعلان (یا null اگر نامشخص باشد). فیلدهای tab / data.tab را مستقیم قبول می‌کند. */
export function routeForNotification(n) {
  const data = n.data || {};
  const direct = n.tab || data.tab;
  if (direct && KNOWN_TABS.includes(direct)) return direct;
  const text = `${n.title || ''} ${n.body || ''}`;
  const hit = KEYWORD_RULES.find(([re]) => re.test(text));
  return hit ? hit[1] : null;
}

/** مودال جزئیات یک اعلان: متن کامل + زمان + دکمه‌ی رفتن به صفحه‌ی مربوط. */
export function openNotificationDetail(n) {
  const { body, close } = openModal({ title: n.title || 'اعلان', width: '460px' });
  if (n.created_at) {
    body.append(el('div', { style: 'font-size:12px;color:var(--stone-600);margin-bottom:10px' }, fmtDateTime(n.created_at)));
  }
  body.append(el('div', {
    style: 'font-size:14px;line-height:1.9;white-space:pre-wrap;word-break:break-word',
  }, n.body || 'متنی برای این اعلان ثبت نشده است.'));

  const route = routeForNotification(n);
  const actions = el('div', { style: 'display:flex;gap:8px;margin-top:16px' });
  if (route) {
    actions.append(el('button', {
      class: 'btn btn-primary', type: 'button', style: 'flex:1;justify-content:center',
      onclick: () => { close(); setTab(route); },
    }, 'رفتن به صفحه‌ی مربوط'));
  }
  actions.append(el('button', {
    class: 'btn btn-ghost', type: 'button', style: 'flex:1;justify-content:center', onclick: close,
  }, 'بستن'));
  body.append(actions);
}

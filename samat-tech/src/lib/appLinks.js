import { sb } from './supabase.js';

// آدرس‌های پیش‌فرض سامانه‌های دولتی — اگر ادمین هنوز مقداری در جدول app_links ثبت نکرده باشد،
// همین آدرس‌ها به‌کار می‌روند تا مسئول فنی با صفحه‌ی خالی مواجه نشود.
const APP_LINK_FALLBACKS = {
  sanam: 'https://ime.org.ir',
  cadastre_tech: 'http://mcs.mimt.gov.ir/',
  cadastre_operator: 'http://cadastre.mimt.gov.ir/default.aspx',
  fuel_system: 'https://newtejaratasan.niopdc.ir',
};

const ICONS = { sanam: '📋', cadastre_tech: '🗺️', cadastre_operator: '🗺️', fuel_system: '⛽' };
const LABELS = {
  sanam: 'سامانه سنم (گزارش ماهانه نظام مهندسی)',
  cadastre_tech: 'سامانه کاداستر — ورود مسئول فنی',
  cadastre_operator: 'سامانه کاداستر — ورود بهره‌بردار',
  fuel_system: 'سامانه سوخت (سدف)',
};

export function appLinkHint(key, membership, national) {
  const hints = {
    sanam: `نام‌کاربری: کد عضویت (${membership}) — رمز: کد ملی (${national})`,
    cadastre_tech: `نام‌کاربری: شماره عضویت (${membership})`,
    cadastre_operator: 'برای بهره‌بردار/دارنده پروانه',
    fuel_system: 'درخواست سهمیه گازوئیل معدن',
  };
  return hints[key] || '';
}

/** فهرست سامانه‌های دولتی قابل‌استفاده را برمی‌گرداند (از جدول app_links، یا آدرس‌های پیش‌فرض) */
export async function fetchAppLinks() {
  let data = null;
  try {
    const res = await sb.from('app_links').select('*');
    data = res.data;
  } catch {
    // از پیش‌فرض استفاده می‌شود
  }
  const links = (data && data.length) ? data : Object.keys(APP_LINK_FALLBACKS).map((k) => ({ key: k, url: APP_LINK_FALLBACKS[k] }));
  return links
    .map((l) => ({ ...l, url: l.url || APP_LINK_FALLBACKS[l.key] || '', icon: ICONS[l.key] || '🔗', label: l.label || LABELS[l.key] || l.key }))
    .filter((l) => l.url);
}

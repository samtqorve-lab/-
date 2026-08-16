// تبدیل تقویم شمسی↔میلادی — بدون کتابخانه‌ی خارجی (همان الگوریتم استاندارد نسخه‌ی قبلی).
// چون رکوردهای این اپ (اقدام اصلاحی، پرسنل، آموزش، تولید) در ستون‌های واقعی date پایگاه‌داده
// ذخیره می‌شوند (که میلادی می‌خواهند)، ورودی کاربر شمسی گرفته و قبل از ذخیره به ISO میلادی تبدیل می‌شود.
import { el } from './dom.js';

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

export function gregorianToJalali(gy, gm, gd) {
  const date = new Date(gy, gm - 1, gd, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const parts = fmt.formatToParts(date);
  const y = parseInt(parts.find((p) => p.type === 'year').value, 10);
  const mo = parseInt(parts.find((p) => p.type === 'month').value, 10);
  const d = parseInt(parts.find((p) => p.type === 'day').value, 10);
  return [y, mo, d];
}

export function jalaliToGregorian(jyIn, jm, jd) {
  let jy = jyIn + 1595;
  let days = -355668 + (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + jd
    + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const isLeap = (gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0);
  const monthDays = [0, 31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm;
  for (gm = 1; gm <= 12; gm++) {
    if (gd <= monthDays[gm]) break;
    gd -= monthDays[gm];
  }
  return [gy, gm, gd];
}

export function jalaliToISODate(jy, jm, jd) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

export function todayJalali() {
  const now = new Date();
  return gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * سه کشویی روز/ماه/سال شمسی می‌سازد — جایگزین `<input type="date">` مرورگر (که میلادی/غیربومی است)
 * برای همه‌ی فیلدهای تاریخ این اپ.
 * @param {{ iso?: string, optional?: boolean }} opts iso = مقدار اولیه (میلادی YYYY-MM-DD)، optional = آیا «انتخاب نشده» مجاز است
 * @returns {{ wrap: HTMLElement, getValue: () => string|null, setValue: (iso: string|null) => void }}
 */
export function jalaliDateSelect({ iso, optional = false } = {}) {
  const [curY] = todayJalali();
  const emptyOpt = optional ? [el('option', { value: '' }, '—')] : [];
  const daySel = el('select', { style: 'flex:1' }, [...emptyOpt, ...Array.from({ length: 31 }, (_, i) => el('option', { value: String(i + 1) }, String(i + 1)))]);
  const moSel = el('select', { style: 'flex:1.4' }, [...emptyOpt, ...JALALI_MONTHS.map((mm, i) => el('option', { value: String(i + 1) }, mm))]);
  const ySel = el('select', { style: 'flex:1' }, [...emptyOpt, ...[curY - 1, curY, curY + 1, curY + 2].map((y) => el('option', { value: String(y) }, String(y)))]);

  function setValue(isoStr) {
    let jy;
    let jm;
    let jd;
    const m = String(isoStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      [jy, jm, jd] = gregorianToJalali(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    } else if (!optional) {
      [jy, jm, jd] = todayJalali();
    }
    daySel.value = jd ? String(jd) : '';
    moSel.value = jm ? String(jm) : '';
    ySel.value = jy ? String(jy) : '';
  }
  setValue(iso || null);

  function getValue() {
    if (!daySel.value || !moSel.value || !ySel.value) return null;
    return jalaliToISODate(parseInt(ySel.value, 10), parseInt(moSel.value, 10), parseInt(daySel.value, 10));
  }

  const wrap = el('div', { style: 'display:flex;gap:6px' }, [daySel, moSel, ySel]);
  return { wrap, getValue, setValue };
}

/** برای دوره‌ی گزارش دوره‌ای/تولید — ماه جاری + چند ماه قبل، به‌جای متن آزاد (که باعث ثبت اسم ماه نادرست می‌شد) */
export function recentPeriodOptions(count = 6) {
  const [jy, jm] = todayJalali();
  const opts = [];
  for (let i = 0; i < count; i++) {
    let mo = jm - i;
    let yr = jy;
    while (mo <= 0) { mo += 12; yr -= 1; }
    opts.push(`${JALALI_MONTHS[mo - 1]} ${yr}`);
  }
  return opts;
}

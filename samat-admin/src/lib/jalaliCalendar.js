// تبدیل شمسی↔میلادی — پیاده‌سازی مستقیم الگوریتم استاندارد jalaali (بدون وابستگی خارجی،
// چون این محاسبه باید همیشه دقیق و بدون نیاز به کتابخانه‌ی اضافه در دسترس باشد)

const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function div(a, b) { return ~~(a / b); }
function mod(a, b) { return a - ~~(a / b) * b; }

function jalCal(jy) {
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14; let jp = breaks[0];
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export function toJalali(gy, gm, gd) {
  const jdn = g2d(gy, gm, gd);
  const info = jalCalFromJdn(jdn);
  return info;
}

function jalCalFromJdn(jdn) {
  // پیدا کردن سال شمسی تقریبی، سپس دقیق‌سازی
  let jy = 979 + 33 * div(jdn - g2d(1600, 3, 1), 12053);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = jalCal(jy);
    const j1 = g2d(r.gy, 3, r.march);
    if (jdn < j1) { jy -= 1; continue; }
    const r2 = jalCal(jy + 1);
    const j2 = g2d(r2.gy, 3, r2.march);
    if (jdn >= j2) { jy += 1; continue; }
    const k = jdn - j1;
    let jm;
    let jd;
    if (k <= 185) { jm = 1 + div(k, 31); jd = mod(k, 31) + 1; } else { jm = 7 + div(k - 186, 30); jd = mod(k - 186, 30) + 1; }
    return { jy, jm, jd };
  }
}

export function toGregorian(jy, jm, jd) {
  const r = jalCal(jy);
  const jdn = g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  const g = d2g(jdn);
  return { gy: g.gy, gm: g.gm, gd: g.gd };
}

export function isLeapJalaliYear(jy) {
  return jalCal(jy).leap === 0;
}

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

export function daysInJalaliMonth(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

export function todayJalali() {
  const t = new Date();
  return toJalali(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

/** رشته‌ی «۱۴۰۳/۰۶/۱۵» یا مشابه را می‌خواند */
export function parseJalaliString(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  let jy = parseInt(m[1], 10);
  if (jy < 100) jy += 1300;
  return { jy, jm: parseInt(m[2], 10), jd: parseInt(m[3], 10) };
}

export function formatJalali(jy, jm, jd) {
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

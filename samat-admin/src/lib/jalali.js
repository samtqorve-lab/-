// تاریخ‌ها در این سامانه به‌صورت رشته‌ی شمسی ذخیره می‌شوند (مثلاً «1403/05/12»)، نه میلادی.
// این توابع عیناً از admin-index.html (نسخه‌ی قبلی) منتقل شده‌اند تا محاسبه‌ی انقضای پروانه
// دقیقاً همان نتیجه‌ی قبلی را بدهد — بازنویسی با Date میلادی نتیجه را کاملاً غلط می‌کند.

export function getCurrentJalaliYMD() {
  try {
    const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' });
    const parts = fmt.formatToParts(new Date());
    const y = parseInt(parts.find((p) => p.type === 'year').value, 10);
    const mo = parseInt(parts.find((p) => p.type === 'month').value, 10);
    const d = parseInt(parts.find((p) => p.type === 'day').value, 10);
    return { y, mo, d };
  } catch {
    return { y: 1404, mo: 1, d: 1 };
  }
}

export function parseJalaliDateString(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  let y = parseInt(m[1], 10);
  if (y < 100) y += 1300;
  return { y, mo: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}

/**
 * وضعیت اعتبار پروانه را بر اساس بخش (چون هر بخش فیلد تاریخ/مدت متفاوتی دارد) حساب می‌کند.
 * @param {object} m رکورد
 * @param {'معدن'|'صنعت'|'اکتشاف'|'فرآوری'} department
 */
export function licenseExpiryInfo(m, department) {
  let issue;
  let durationYears;
  if (department === 'اکتشاف') {
    issue = parseJalaliDateString(m['تاریخ_صدور']);
    const months = parseFloat(m['مدت_اعتبار_ماه']);
    durationYears = !Number.isNaN(months) && months ? months / 12 : null;
  } else if (department === 'فرآوری' || department === 'اصناف') {
    issue = parseJalaliDateString(m['تاریخ_صدور']);
    durationYears = parseFloat(m['مدت_اعتبار_سال']);
  } else {
    issue = parseJalaliDateString(m['تاریخ_پروانه']);
    durationYears = parseFloat(m['مدت_بهره_برداری']);
  }
  if (!issue || !durationYears || Number.isNaN(durationYears)) return null;
  const expiryY = issue.y + Math.floor(durationYears);
  const now = getCurrentJalaliYMD();
  let monthsLeft = (expiryY - now.y) * 12 + (issue.mo - now.mo);
  if (now.d > issue.d) monthsLeft -= 1;
  return { expiryY, expiryMo: issue.mo, monthsLeft, expired: monthsLeft < 0 };
}

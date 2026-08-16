export function monthlyReminderStatus(identityVerifiedAt, monthlyMs, reminderMs) {
  if (!identityVerifiedAt) return null;
  const dueAt = new Date(identityVerifiedAt).getTime() + monthlyMs;
  const remainMs = dueAt - Date.now();
  if (remainMs > 0 && remainMs <= reminderMs) {
    return { daysLeft: Math.max(1, Math.ceil(remainMs / 86400000)) };
  }
  return null;
}

/** طبق ماده ۴ قانون نظام مهندسی معدن، فعالیت فنی مستلزم پروانه اشتغال معتبر است — این بنر فقط اطلاع‌رسانی است */
export function licenseExpiryStatus(licenseNo, expiryDate) {
  if (!licenseNo) return null;
  if (!expiryDate) return { kind: 'missing' };
  const d = new Date(`${expiryDate}T00:00:00`);
  const daysLeft = Math.round((d.getTime() - Date.now()) / 86400000);
  if (daysLeft < 0) return { kind: 'expired' };
  if (daysLeft <= 60) return { kind: 'soon', daysLeft };
  return null;
}

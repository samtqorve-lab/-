import { fmtDate } from '../../lib/dom.js';
import { legalStatusMeta, dateStatus } from '../../lib/legal.js';

// هر schema فیلدهای فرم را توصیف می‌کند (به‌جای تکرار یک بلوک if/else غول‌پیکر مثل نسخه‌ی قبلی)
// و یک تابع summary برای خط خلاصه‌ی هر ردیف در لیست.

export const LEGAL_SCHEMAS = {
  royalty: {
    fields: [
      { key: 'period', label: 'دوره (مثال: سال ۱۴۰۴)', type: 'text', required: true },
      { key: 'tonnage', label: 'تناژ اعلامی (تن)', type: 'number', row: 'a' },
      { key: 'rate_per_ton', label: 'نرخ (به ازای هر تن)', type: 'number', row: 'a' },
      { key: 'calculated_amount', label: 'مبلغ محاسبه‌شده', type: 'number', row: 'b' },
      { key: 'paid_amount', label: 'مبلغ پرداخت‌شده', type: 'number', default: 0, row: 'b' },
      { key: 'due_date', label: 'تاریخ سررسید', type: 'date', row: 'c' },
      { key: 'paid_date', label: 'تاریخ پرداخت', type: 'date', row: 'c' },
      { key: 'status', label: 'وضعیت', type: 'select', options: ['pending', 'partial', 'paid', 'overdue'] },
      { key: 'notes', label: 'یادداشت', type: 'textarea' },
    ],
    summary: (r) => [
      `دوره ${r.period || '—'}`,
      `تناژ اعلامی: ${r.tonnage ?? '—'} تن | نرخ: ${r.rate_per_ton ?? '—'} | مبلغ محاسبه‌شده: ${r.calculated_amount ?? '—'} | پرداخت‌شده: ${r.paid_amount ?? 0}`,
      `سررسید: ${fmtDate(r.due_date)} | تاریخ پرداخت: ${fmtDate(r.paid_date)}`,
    ],
  },

  guarantee: {
    fields: [
      { key: 'guarantee_type', label: 'نوع تضمین', type: 'text', placeholder: 'ضمانت‌نامه بانکی، سپرده نقدی، ...' },
      { key: 'amount', label: 'مبلغ', type: 'number', row: 'a' },
      { key: 'issue_date', label: 'تاریخ صدور', type: 'date', row: 'a' },
      { key: 'next_adjustment_date', label: 'تاریخ تعدیل بعدی (طبق ماده ۴۳ آیین‌نامه، معمولاً هر ۳ سال یک‌بار)', type: 'date' },
      { key: 'linked_to_reclamation', label: 'این تضمین بابت تعهد بازسازی محیط‌زیست (ماده ۶ ضوابط زیست‌محیطی) است', type: 'checkbox' },
      { key: 'status', label: 'وضعیت', type: 'select', options: ['active', 'expired', 'released'] },
      { key: 'notes', label: 'یادداشت', type: 'textarea' },
    ],
    summary: (r) => {
      const adj = dateStatus(r.next_adjustment_date, 60);
      const adjNote = adj?.expired ? ' (موعد تعدیل گذشته)' : adj?.soon ? ` (${adj.daysLeft} روز مانده)` : '';
      return [
        r.guarantee_type || 'تضمین مالی',
        `مبلغ: ${r.amount ?? '—'} | تاریخ صدور: ${fmtDate(r.issue_date)}`,
        `تعدیل بعدی: ${fmtDate(r.next_adjustment_date)}${adjNote}`,
      ];
    },
  },

  kashef: {
    fields: [
      { key: 'year', label: 'سال', type: 'text', placeholder: '۱۴۰۴', required: true },
      { key: 'amount', label: 'مبلغ', type: 'number', row: 'a' },
      { key: 'payment_date', label: 'تاریخ پرداخت', type: 'date', row: 'a' },
      { key: 'document_url', label: 'لینک مستندات (اختیاری)', type: 'text', dir: 'ltr' },
      { key: 'status', label: 'وضعیت', type: 'select', options: ['pending', 'paid', 'reported'],
        optionLabels: { pending: 'در انتظار پرداخت', paid: 'پرداخت‌شده - در انتظار اعلام به وزارت' } },
      { key: 'notes', label: 'یادداشت', type: 'textarea' },
    ],
    summary: (r) => [
      `سال ${r.year || '—'}`,
      `مبلغ: ${r.amount ?? '—'} | تاریخ پرداخت: ${fmtDate(r.payment_date)}`,
    ],
    docUrlKey: 'document_url',
  },

  reclamation: {
    fields: [
      { key: 'plan_status', label: 'وضعیت طرح بازسازی', type: 'select', options: ['not_submitted', 'pending_approval', 'approved'], row: 'a' },
      { key: 'approval_date', label: 'تاریخ تایید طرح', type: 'date', row: 'a' },
      { key: 'restoration_status', label: 'وضعیت اجرای بازسازی', type: 'select', options: ['not_started', 'in_progress', 'completed'] },
      { key: 'doc_url', label: 'لینک مستندات (اختیاری)', type: 'text', dir: 'ltr' },
      { key: 'notes', label: 'یادداشت', type: 'textarea' },
    ],
    summary: (r) => [
      'طرح بازسازی',
      `تاریخ تایید طرح: ${fmtDate(r.approval_date)}`,
    ],
    statusKeys: ['plan_status', 'restoration_status'],
    docUrlKey: 'doc_url',
    // بنر متقابل: آیا تضمین مالی فعال و مرتبط با بازسازی برای همین معدن ثبت شده؟
    crossCheck: (mineName, cache) => {
      const linked = cache.guarantee.some((g) => g.mine_name === mineName && g.linked_to_reclamation && g.status === 'active');
      return linked
        ? { ok: true, text: '✅ تضمین مالی بازسازی برای این معدن ثبت و فعال است (تب «تضمین مالی»)' }
        : { ok: false, text: '⚠️ هنوز تضمین مالی فعالی برای بازسازی این معدن (در تب «تضمین مالی») علامت‌گذاری نشده' };
    },
  },

  transfer: {
    fields: [
      { key: 'transferor_name', label: 'انتقال‌دهنده', type: 'text', row: 'a' },
      { key: 'transferee_name', label: 'انتقال‌گیرنده', type: 'text', row: 'a' },
      { key: 'request_date', label: 'تاریخ ثبت درخواست', type: 'date', row: 'b' },
      { key: 'finalization_date', label: 'تاریخ ظهرنویسی (ماده ۴۷ تبصره ۱)', type: 'date', row: 'b' },
      { key: 'status', label: 'وضعیت', type: 'select', options: ['submitted', 'clearance_pending', 'review', 'transfer_approved', 'finalized', 'rejected'] },
      { key: 'notes', label: 'یادداشت (توان فنی/مالی انتقال‌گیرنده و غیره)', type: 'textarea' },
    ],
    summary: (r) => [
      `${r.transferor_name || '—'} ← ${r.transferee_name || '—'}`,
      `تاریخ درخواست: ${fmtDate(r.request_date)} | ظهرنویسی: ${fmtDate(r.finalization_date)}`,
    ],
    // بنر متقابل: آیا این معدن رویالتی معوق/تسویه‌نشده دارد؟ (ماده ۴۷ — پیش‌نیاز انتقال)
    crossCheck: (mineName, cache) => {
      const overdue = cache.royalty.some((rr) => rr.mine_name === mineName && ['overdue', 'pending', 'partial'].includes(rr.status));
      return overdue
        ? { ok: false, text: '⚠️ این معدن رویالتی معوق/تسویه‌نشده دارد — طبق ماده ۴۷ باید پیش از انتقال، مفاصا حساب حقوق دولتی ارائه شود' }
        : { ok: true, text: '✅ رویالتی معوقی برای این معدن ثبت نشده' };
    },
  },

  disqualification: {
    fields: [
      { key: 'violation_description', label: 'شرح تخلف', type: 'textarea' },
      { key: 'warning_date', label: 'تاریخ اخطار', type: 'date', row: 'a' },
      { key: 'deadline', label: 'مهلت رفع تخلف', type: 'date', row: 'a' },
      { key: 'committee_decision_date', label: 'تاریخ بررسی/تصمیم کمیسیون ماده ۲۰', type: 'date' },
      { key: 'status', label: 'وضعیت', type: 'select', options: ['warned', 'deadline_passed', 'committee_review', 'disqualified', 'resolved'] },
      { key: 'document_url', label: 'لینک مستندات (اختیاری)', type: 'text', dir: 'ltr' },
      { key: 'notes', label: 'یادداشت', type: 'textarea' },
    ],
    summary: (r) => [
      (r.violation_description || '—').slice(0, 60),
      `اخطار: ${fmtDate(r.warning_date)} | مهلت: ${fmtDate(r.deadline)} | تصمیم کمیسیون: ${fmtDate(r.committee_decision_date)}`,
    ],
    docUrlKey: 'document_url',
  },
};

export function legalRowBadges(sub, r) {
  const schema = LEGAL_SCHEMAS[sub];
  const keys = schema.statusKeys || ['status'];
  return keys.map((k) => legalStatusMeta(r[k]));
}

import QRCode from 'qrcode';
import { el, showToast, openModal } from '../../lib/dom.js';
import { updateDeptRecord } from '../../lib/records.js';

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * QR ورود برای تایید حضور فیزیکی مسئول فنی سر معدن — مکمل GPS (که به‌تنهایی قابل جعل است).
 * یک کد تصادفی به رکورد معدن اضافه می‌شود (اگر قبلاً نداشته)، بعد QR همان کد رندر می‌شود.
 * پیشنهاد می‌شود این برگه پرینت و روی درِ ورودی معدن نصب شود.
 */
export async function openQrCheckinModal(record, department, rowId) {
  const { body } = openModal({ title: `🔳 QR ورود — ${record['نام_معدن'] || ''}`, width: '380px' });
  body.append(el('div', { style: 'text-align:center;color:var(--stone-600);font-size:13px' }, 'در حال آماده‌سازی...'));

  let token = record['کد_ورود_QR'];
  if (!token) {
    token = randomToken();
    try {
      await updateDeptRecord(department, rowId, { ...record, کد_ورود_QR: token });
      record['کد_ورود_QR'] = token;
    } catch (err) {
      body.innerHTML = '';
      body.append(el('div', { style: 'color:var(--rust-700)' }, `خطا در ساخت کد: ${err.message}`));
      return;
    }
  }

  const svg = await QRCode.toString(token, { type: 'svg', margin: 1, width: 260 });
  body.innerHTML = '';
  const printArea = el('div', { class: 'qr-print-area', style: 'text-align:center' }, [
    el('h3', {}, record['نام_معدن'] || ''),
    el('div', { style: 'font-size:12px;color:#555;margin-bottom:10px' }, 'کد ورود مسئول فنی — این برگه را چاپ و سر درِ ورودی معدن نصب کنید'),
    el('div', { style: 'display:flex;justify-content:center' }, (() => {
      const wrap = document.createElement('div');
      wrap.innerHTML = svg;
      return wrap.firstChild;
    })()),
  ]);
  body.append(
    printArea,
    el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
      el('button', { class: 'btn btn-primary', style: 'flex:1', onclick: () => window.print() }, '🖨️ چاپ برگه‌ی QR'),
      el('button', { class: 'btn btn-ghost', onclick: async () => {
        if (!confirm('کد فعلی باطل و یک کد جدید ساخته شود؟ برگه‌ی قبلی دیگر کار نخواهد کرد.')) return;
        token = randomToken();
        try {
          await updateDeptRecord(department, rowId, { ...record, کد_ورود_QR: token });
          record['کد_ورود_QR'] = token;
          showToast('✅ کد جدید ساخته شد — دوباره چاپ کنید');
          openQrCheckinModal(record, department, rowId);
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      } }, '🔄 صدور کد جدید'),
    ]),
  );
}

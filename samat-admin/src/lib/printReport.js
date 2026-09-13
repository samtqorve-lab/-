/**
 * چاپ/PDF نتیجه‌ی محاسبات — به‌جای افزودن یک کتابخانه‌ی سنگین PDF، از قابلیت «چاپ» خود مرورگر
 * استفاده می‌کند (پنجره‌ی چاپ مرورگر گزینه‌ی «Save as PDF» دارد)، دقیقاً مثل fuelPrintModal.js و
 * گزارش حجم/کاداستر که از قبل در این پروژه هستند.
 */
export function printReportHTML(title, bodyHtml) {
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) { throw new Error('مرورگر اجازه‌ی باز شدن پنجره‌ی چاپ را نداد — پاپ‌آپ را برای این سایت فعال کنید'); }
  win.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: Vazirmatn, Tahoma, sans-serif; padding: 24px; color: #1c1a17; }
  h1 { font-size: 18px; border-bottom: 2px solid #a06a3a; padding-bottom: 8px; }
  h4 { font-size: 14px; margin: 16px 0 6px; color: #6b5a4a; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 8px 0; }
  .kpi-card { border: 1px solid #ddd6cc; border-radius: 8px; padding: 10px; text-align: center; }
  .kpi-n { font-size: 16px; font-weight: 800; }
  .kpi-l { font-size: 11px; color: #6b5a4a; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
  th, td { border: 1px solid #ddd6cc; padding: 6px 8px; text-align: right; }
  th { background: #f4efe6; }
  .footer-note { margin-top: 24px; font-size: 11px; color: #6b5a4a; border-top: 1px solid #ddd6cc; padding-top: 8px; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<h1>${title}</h1>
${bodyHtml}
<div class="footer-note">تولیدشده در سامانه‌ی صمت — اداره صنعت، معدن و تجارت قروه — ${new Date().toLocaleDateString('fa-IR')}</div>
<button onclick="window.print()" style="margin-top:16px;padding:8px 16px;cursor:pointer">🖨️ چاپ / ذخیره PDF</button>
</body>
</html>`);
  win.document.close();
  win.focus();
}

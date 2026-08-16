// نکته‌ی امنیتی مهم: پکیج npm به‌نام «xlsx» (SheetJS) یک آسیب‌پذیری شدید بدون پچ دارد
// (Prototype Pollution + ReDoS — GHSA-4r6h-8v6p-xvw6 و GHSA-5pgg-2g8v-p4x9) چون SheetJS دیگر
// نسخه‌های وصله‌شده را روی npm منتشر نمی‌کند، فقط روی CDN اختصاصی خودشان. به همین دلیل (دقیقاً
// همان تصمیمی که در نسخه‌ی قبلی این پروژه هم گرفته شده بود) به‌جای نصب از npm، اسکریپت را در
// زمان اجرا از CDN رسمی خودشان لود می‌کنیم — نه یک CDN واسط ناشناس.
let xlsxPromise = null;
export function ensureXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('بارگذاری ابزار خواندن اکسل ناموفق بود — اتصال اینترنت را بررسی کنید'));
    document.head.append(script);
  });
  return xlsxPromise;
}

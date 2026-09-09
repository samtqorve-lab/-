import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  // شماره‌ی build (از GitHub Actions run_number) برای مقایسه با manifest آپدیت اندروید؛
  // در dev محلی همیشه ۰ است، یعنی هیچ‌وقت پیشنهاد آپدیت نمی‌دهد.
  define: {
    __APP_BUILD__: JSON.stringify(Number(process.env.APP_BUILD_NUMBER || 0)),
  },
  test: {
    // بدون این exclude، الگوی پیش‌فرض vitest («**/*.spec.js») فایل‌های تست Playwright را هم
    // (که با runner دیگری اجرا می‌شوند: npx playwright test) به‌اشتباه جمع می‌کند و چون این
    // فایل‌ها test.describe از پکیج @playwright/test را صدا می‌زنند نه vitest، با خطا شکست
    // می‌خورند — این باعث fail شدن ورک‌فلوی «Build Check» روی هر کامیتی شده بود.
    exclude: [...configDefaults.exclude, '**/smoke-tests/**'],
  },
  build: {
    // terrain3d.js (Three.js) به‌صورت dynamic import فقط با کلیک روی دکمه‌ی «مدل سه‌بعدی» لود
    // می‌شود، نه در مسیر بارگذاری اولیه‌ی داشبورد — بنابراین هشدار پیش‌فرض ۵۰۰ کیلوبایتی Vite
    // برای همین یک چانک (که واقعاً هم به همین دلیل بزرگ است) صرفاً نویز است، نه یک مشکل واقعی.
    chunkSizeWarningLimit: 600,
    // بدون این تنظیم، فشرده‌سازِ CSS (Lightning CSS) کوئری‌های @media (max-width: ...) را به
    // سینتکس مدرن‌تر «width<=Npx» تبدیل می‌کند؛ این سینتکس روی کروم/وب‌ویوهای اندروید قدیمی‌تر
    // (پیش از Chrome 104) اصلاً شناخته نمی‌شود و کل قانون نادیده گرفته می‌شود — نتیجه‌اش این بود
    // که دکمه‌ی منوی همبرگری موبایل هیچ‌وقت نمایش داده نمی‌شد. با هدف‌گیری صریح مرورگرهای قدیمی‌تر
    // اینجا، ابزار مجبور می‌شود همان سینتکس کلاسیک و سازگار را تولید کند.
    cssTarget: ['chrome87', 'safari14', 'firefox78', 'edge88'],
  },
});

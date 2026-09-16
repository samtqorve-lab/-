import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── فیکس واقعیِ باگ «مدل سه‌بعدی مسطح می‌ماند» ──
// روش قبلی (`import ... from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'` + setWorkerUrl) در
// نسخه‌ی فعلی Vite/Rolldown دیگر کار نمی‌کند: Vite این فایل را به‌عنوان یک ماژول واقعی می‌بیند
// (نه یک asset خام) و آن را با یک نام هش‌دار جدا کپی می‌کند، ولی importِ نسبیِ داخلی خودش
// (`./maplibre-gl-shared.mjs`) را resolve/کپی نمی‌کند — نتیجه: خودِ فایل Worker خروجی به یک
// چانک ناموجود اشاره می‌کند، مرورگر آن را با ۴۰۴ رد می‌کند، Worker هیچ‌وقت واقعاً اجرا نمی‌شود،
// DEM هیچ‌وقت دیکد نمی‌شود، و setTerrain ظاهراً موفق است ولی نتیجه یک نقشه‌ی کاملاً مسطح (۲بعدی)
// است — بدون هیچ خطای قابل‌مشاهده‌ای در UI (دقیقاً همان علامتِ قدیمی، با یک علت جدید).
// راه‌حل: هر دو فایلِ به‌هم‌وابسته (worker + shared) را عیناً و بدون هیچ پردازشی، کنار هم و با
// همان نام اصلی، در public/ کپی می‌کنیم تا importِ نسبیِ داخلی‌شان دقیقاً همان‌طور که خودِ
// maplibre-gl نوشته سالم بماند. این کپی در همین‌جا (نه در git) و در هر اجرای dev/build دوباره از
// node_modules تازه انجام می‌شود، تا با هر بار آپدیت شدن نسخه‌ی maplibre-gl خودش را به‌روز نگه دارد
// و هیچ‌وقت stale نشود (به همین دلیل public/maplibre-vendor/ در .gitignore هم اضافه شده).
function copyMaplibreWorkerFiles() {
  const srcDir = path.join(__dirname, 'node_modules/maplibre-gl/dist');
  const destDir = path.join(__dirname, 'public/maplibre-vendor');
  fs.mkdirSync(destDir, { recursive: true });
  ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'].forEach((name) => {
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  });
}
copyMaplibreWorkerFiles();

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

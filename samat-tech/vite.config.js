import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// رمزگشای Draco برای نمایشگر مدل سه‌بعدی پهباد (lib/model3dViewer.js): فایل‌های decoder از خود پکجِ
// three در هر اجرای dev/build به public/draco/ کپی می‌شوند (public/draco/ در .gitignore است) تا
// نمایشگر از همان origin اپ لود کند، نه CDN — چون اپ اندروید/دسکتاپ و کاربران ایرانی نباید
// به سرویس خارجی وابسته باشند (همان روش samat-admin/vite.config.js).
function copyDracoDecoderFiles() {
  const srcDir = path.join(__dirname, 'node_modules/three/examples/jsm/libs/draco/gltf');
  const destDir = path.join(__dirname, 'public/draco');
  fs.mkdirSync(destDir, { recursive: true });
  ['draco_decoder.wasm', 'draco_wasm_wrapper.js'].forEach((name) => {
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  });
}
copyDracoDecoderFiles();

// این پروژه سه مقصد دارد:
//   ۱) PWA مستقل → ریشه‌ی دامنه، یعنی base: '/'                            → npm run build
//   ۲) زیرپوشه‌ی «tech-officer» داخل ریپوی samat-admin (novinproduct.ir/tech-officer/)
//      → base: '/tech-officer/'                                            → npm run build:web-sub
//   ۳) اندروید (Capacitor) → base: '/'، ولی بدون service worker             → npm run cap:sync (--mode android)
// حالت دوم با «--mode web-sub» و حالت سوم با «--mode android» فعال می‌شود (مستقل از سیستم‌عامل،
// بر خلاف متغیر محیطی).
export default defineConfig(({ mode }) => {
  const isSubPath = mode === 'web-sub';
  const isAndroid = mode === 'android';
  const base = isSubPath ? '/tech-officer/' : '/';

  return {
    base,
    // شماره‌ی build (از GitHub Actions run_number) برای مقایسه با manifest آپدیت اندروید؛
    // در dev محلی همیشه ۰ است، یعنی هیچ‌وقت پیشنهاد آپدیت نمی‌دهد.
    define: {
      __APP_BUILD__: JSON.stringify(Number(process.env.APP_BUILD_NUMBER || 0)),
    },
    build: {
      // خروجی جدا از dist اصلی، تا با build آندروید/PWA اصلی قاطی نشه
      outDir: isSubPath ? 'dist-web-sub' : 'dist',
      // بدون این، Lightning CSS کوئری‌های @media (max-width:...) را به سینتاکس مدرن‌تر «width<=Npx»
      // تبدیل می‌کند که روی کروم/وب‌ویوهای اندروید قدیمی‌تر از Chrome 104 اصلاً کار نمی‌کند.
      cssTarget: ['chrome87', 'safari14', 'firefox78', 'edge88'],
    },
    plugins: [
      VitePWA({
        registerType: 'autoUpdate',
        // داخل APK اندروید، فایل‌های وب مستقیم از خود APK لود می‌شوند و service worker فقط ضرر دارد:
        // بعد از نصب APK جدید، WebView همچنان باندل‌ قدیمیِ کش‌شده را سرو می‌کرد (و حتی بعد از
        // حذف و نصب مجدد، به‌خاطر بازگردانی داده‌ی WebView از بکاپ). پس برای بیلد اندروید ثبت
        // service worker اصلاً تزریق نمی‌شود؛ PWA وب و سابپث بدون تغییر می‌مانند.
        injectRegister: isAndroid ? false : 'auto',
        // فقط فایل‌های استاتیک خود اپ (JS/CSS/فونت) کش می‌شوند — نه پاسخ‌های Supabase؛
        // صف کارهای آفلاین (عکس/گزارش ثبت‌شده بدون اینترنت) یک لایه‌ی جدا در خود اپلیکیشن است، نه service worker.
        workbox: {
          globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        },
        manifest: {
          name: 'سامانه مسئول فنی و ایمنی',
          short_name: 'مسئول فنی و ایمنی',
          description: 'اپ مسئول فنی/ایمنی/بهداشت اداره صنعت، معدن و تجارت قروه',
          lang: 'fa',
          dir: 'rtl',
          theme_color: '#1E2622',
          background_color: '#1E2622',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
            { src: `${base}icons/icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
  };
});

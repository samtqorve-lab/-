import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// این پروژه دو مقصد دارد که مسیر پایه‌شون فرق می‌کنه:
//   ۱) اندروید (Capacitor) و PWA مستقل → ریشه‌ی دامنه، یعنی base: '/'      → npm run build
//   ۲) زیرپوشه‌ی «tech-officer» داخل ریپوی samat-admin (novinproduct.ir/tech-officer/)
//      → base: '/tech-officer/'                                            → npm run build:web-sub
// حالت دوم با «--mode web-sub» فعال می‌شه (مستقل از سیستم‌عامل، بر خلاف متغیر محیطی).
export default defineConfig(({ mode }) => {
  const isSubPath = mode === 'web-sub';
  const base = isSubPath ? '/tech-officer/' : '/';

  return {
    base,
    build: {
      // خروجی جدا از dist اصلی، تا با build آندروید/PWA اصلی قاطی نشه
      outDir: isSubPath ? 'dist-web-sub' : 'dist',
    },
    plugins: [
      VitePWA({
        registerType: 'autoUpdate',
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

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // فقط فایل‌های استاتیک خود اپ (JS/CSS/فونت) کش می‌شوند — نه پاسخ‌های Supabase؛
      // صف کارهای آفلاین (عکس/گزارش ثبت‌شده بدون اینترنت) یک لایه‌ی جدا در خود اپلیکیشن است، نه service worker.
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
      },
      manifest: {
        name: 'مسئول فنی — SAMAT',
        short_name: 'SAMAT مسئول فنی',
        description: 'اپ مسئول فنی/ایمنی/بهداشت اداره صنعت، معدن و تجارت قروه',
        lang: 'fa',
        dir: 'rtl',
        theme_color: '#1E2622',
        background_color: '#1E2622',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});

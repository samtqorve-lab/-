import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ir.novinproduct.samattech',
  appName: 'سامات — مسئول فنی',
  webDir: 'dist',
  server: {
    // اجازه می‌دهد در حالت توسعه با vite dev server زنده تست کنید (اختیاری، فقط برای dev):
    // androidScheme پیش‌فرض https است تا API‌های حساس به context امن (getUserMedia، Geolocation،
    // WebAuthn) داخل WebView هم به‌عنوان "secure origin" در نظر گرفته شوند — دقیقاً چیزی که این
    // اپ (دوربین زنده، GPS، بیومتریک) بهش وابسته است.
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;

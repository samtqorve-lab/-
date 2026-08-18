import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // terrain3d.js (Three.js) به‌صورت dynamic import فقط با کلیک روی دکمه‌ی «مدل سه‌بعدی» لود
    // می‌شود، نه در مسیر بارگذاری اولیه‌ی داشبورد — بنابراین هشدار پیش‌فرض ۵۰۰ کیلوبایتی Vite
    // برای همین یک چانک (که واقعاً هم به همین دلیل بزرگ است) صرفاً نویز است، نه یک مشکل واقعی.
    chunkSizeWarningLimit: 600,
  },
});

// این اپ الکترون هیچ منطق جدیدی ندارد — فقط همان build وب (پوشه‌ی app/, که خروجی
// `npm run build` پروژه‌ی samat-admin در آن کپی می‌شود) را داخل یک پنجره‌ی بومی ویندوز نشان می‌دهد.
// چرا از یک سرور محلی express استفاده شده، نه بارگذاری مستقیم index.html با file://؟
// چون ماژول‌های ES (import/export) و بعضی API‌های مرورگر (fetch به Supabase) روی پروتکل file://
// در الکترون رفتار غیرقابل‌اعتماد/محدودی دارند؛ سرو کردن روی http://localhost دقیقاً همان محیطی
// است که در مرورگر واقعی هم اجرا می‌شود — یعنی هیچ رفتار متفاوتی بین نسخه‌ی وب و دسکتاپ نیست.

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const express = require('express');

const PORT = 47821; // یک پورت محلی نسبتاً غیرمعمول، برای پرهیز از تصادم با برنامه‌های دیگر کاربر

function startLocalServer() {
  return new Promise((resolve) => {
    const srv = express();
    srv.use(express.static(path.join(__dirname, 'app')));
    // چون پنل ادمین یک SPA است (چیدمان تب‌ها کاملاً داخل جاوااسکریپت، بدون تغییر مسیر URL)،
    // نیازی به fallback مسیر برای refresh نیست؛ همیشه از همان index.html شروع می‌شود.
    const server = srv.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'پنل ادمین سامات',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(`http://127.0.0.1:${PORT}/`);

  // لینک‌هایی که هدف‌شان تب جدید است (target="_blank" — مثلاً لینک‌های ماهواره‌ای/خروجی فایل)
  // باید در مرورگر پیش‌فرض سیستم باز شوند، نه یک پنجره‌ی الکترون جدید بی‌قاب.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  await startLocalServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// این اپ الکترون هیچ منطق جدیدی ندارد — فقط همان build وب (پوشه‌ی app/, که خروجی
// `npm run build` پروژه‌ی samat-admin در آن کپی می‌شود) را داخل یک پنجره‌ی بومی ویندوز نشان می‌دهد.
// چرا از یک سرور محلی express استفاده شده، نه بارگذاری مستقیم index.html با file://؟
// چون ماژول‌های ES (import/export) و بعضی API‌های مرورگر (fetch به Supabase) روی پروتکل file://
// در الکترون رفتار غیرقابل‌اعتماد/محدودی دارند؛ سرو کردن روی http://localhost دقیقاً همان محیطی
// است که در مرورگر واقعی هم اجرا می‌شود — یعنی هیچ رفتار متفاوتی بین نسخه‌ی وب و دسکتاپ نیست.

const {
  app, BrowserWindow, shell, dialog,
} = require('electron');
const path = require('path');
const express = require('express');
const { autoUpdater } = require('electron-updater');

const PORT = 47821; // یک پورت محلی نسبتاً غیرمعمول، برای پرهیز از تصادم با برنامه‌های دیگر کاربر

// آپدیت خودکار: با هر اجرا، از GitHub Releases (تنظیم‌شده در package.json → build.publish)
// بررسی می‌شود که نسخه‌ی جدیدتری منتشر شده یا نه؛ اگر بله، در پس‌زمینه دانلود می‌شود و کاربر
// فقط با یک پیام «آماده‌ی نصب است» مواجه می‌شود، نه یک دانلود دستی از GitHub.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdate(win) {
  autoUpdater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'نسخه‌ی جدید آماده است',
      message: 'یک نسخه‌ی جدید از پنل ادمین صمت دانلود شد. برای نصب، برنامه باید بسته و دوباره باز شود.',
      buttons: ['نصب و راه‌اندازی مجدد', 'بعداً (موقع بستن برنامه نصب می‌شود)'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (err) => {
    // خطای شبکه یا نبودِ نسخه‌ی جدید نباید کاربر را با پاپ‌آپ مزاحم کند؛ فقط لاگ می‌شود.
    console.error('[auto-update]', err == null ? 'unknown' : (err.stack || err).toString());
  });

  autoUpdater.checkForUpdates();
}

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
    title: 'پنل ادمین صمت',
    icon: path.join(__dirname, 'build', 'icon.ico'),
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
  setupAutoUpdate(BrowserWindow.getAllWindows()[0]);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// این اپ الکترون هیچ منطق جدیدی ندارد — فقط همان build وب (پوشه‌ی app/, که خروجی
// `npm run build` پروژه‌ی samat-admin در آن کپی می‌شود) را داخل یک پنجره‌ی بومی ویندوز نشان می‌دهد.
// چرا از یک سرور محلی express استفاده شده، نه بارگذاری مستقیم index.html با file://؟
// چون ماژول‌های ES (import/export) و بعضی API‌های مرورگر (fetch به Supabase) روی پروتکل file://
// در الکترون رفتار غیرقابل‌اعتماد/محدودی دارند؛ سرو کردن روی http://localhost دقیقاً همان محیطی
// است که در مرورگر واقعی هم اجرا می‌شود — یعنی هیچ رفتار متفاوتی بین نسخه‌ی وب و دسکتاپ نیست.

const {
  app, BrowserWindow, shell, ipcMain,
} = require('electron');
const path = require('path');
const express = require('express');
const { autoUpdater } = require('electron-updater');

const PORT = 47821; // یک پورت محلی نسبتاً غیرمعمول، برای پرهیز از تصادم با برنامه‌های دیگر کاربر

// آپدیت خودکار: از GitHub Releases (تنظیم‌شده در package.json → build.publish) بررسی می‌شود که
// نسخه‌ی جدیدتری منتشر شده یا نه؛ اگر بله، در پس‌زمینه دانلود می‌شود. برخلاف نسخه‌ی قبلی که فقط
// یک‌بار موقع باز شدن برنامه چک می‌کرد و با یک پاپ‌آپ مسدودکننده (dialog) اطلاع می‌داد، این نسخه:
//   ۱) هر چند ساعت هم در حین کار کاربر، در پس‌زمینه دوباره چک می‌کند (چون این برنامه معمولاً
//      برای مدت طولانی باز می‌ماند، نه اینکه هر بار بسته و باز شود).
//   ۲) به‌جای پاپ‌آپ مودال، وضعیت را از طریق IPC به صفحه می‌فرستد تا preload.js یک بنر کوچک و
//      غیرمسدودکننده در گوشه‌ی صفحه نشان دهد — کاربر می‌تواند کارش را ادامه دهد و هر وقت خواست
//      «نصب و راه‌اندازی مجدد» را بزند، یا بنر را ببندد (باز هم موقع بستن برنامه نصب می‌شود).
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // هر ۴ ساعت، چون برنامه معمولاً کل روز باز است

function setupAutoUpdate(win) {
  const sendStatus = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  autoUpdater.on('update-available', (info) => {
    sendStatus('samat-update:available', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus('samat-update:downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus('samat-update:downloaded', {
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    });
  });

  autoUpdater.on('error', (err) => {
    // خطای شبکه یا نبودِ نسخه‌ی جدید نباید کاربر را با پاپ‌آپ مزاحم کند؛ فقط لاگ می‌شود.
    console.error('[auto-update]', err == null ? 'unknown' : (err.stack || err).toString());
  });

  // درخواست نصب از سمت بنر داخل‌صفحه‌ای (preload.js → ipcRenderer.send)
  ipcMain.on('samat-update:install', () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
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

  return win;
}

app.whenReady().then(async () => {
  await startLocalServer();
  const win = createWindow();
  setupAutoUpdate(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

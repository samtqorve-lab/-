// این وب‌اپ به هیچ API نودی نیاز ندارد (فقط با Supabase از طریق HTTPS معمولی کار می‌کند)،
// پس چیزی از طریق contextBridge به صفحه expose نمی‌شود — همان الگوی امن قبلی حفظ شده.
//
// تنها کاری که این preload انجام می‌دهد: نمایش یک بنر کوچک و غیرمسدودکننده‌ی «آپدیت»
// در گوشه‌ی پایین-راست صفحه، بر اساس پیام‌هایی که main.js از طریق IPC می‌فرستد
// (samat-update:available / samat-update:downloading / samat-update:downloaded).
// این جایگزین پاپ‌آپ مودال قبلی است تا کار کاربر در برنامه قطع نشود.
//
// صادقانه: چون preload حتی با contextIsolation:true به همان DOM صفحه دسترسی دارد
// (فقط زمینه‌ی جاوااسکریپت جداست، نه خود سند)، بنر مستقیماً همین‌جا به document.body
// اضافه می‌شود — بدون نیاز به تغییر کد وب‌اپ اصلی (samat-admin) که بین نسخه‌ی وب/موبایل/دسکتاپ مشترک است.

const { ipcRenderer } = require('electron');

function injectBannerStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #samat-update-banner {
      position: fixed;
      bottom: 16px;
      left: 16px;
      z-index: 2147483647;
      direction: rtl;
      font-family: 'Vazirmatn', Tahoma, sans-serif;
      background: #1f2937;
      color: #f3f4f6;
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,.35);
      padding: 12px 14px;
      max-width: 320px;
      font-size: 13px;
      line-height: 1.6;
      display: none;
      gap: 8px;
      flex-direction: column;
    }
    #samat-update-banner.samat-visible { display: flex; }
    #samat-update-banner .samat-update-title { font-weight: 700; }
    #samat-update-banner .samat-update-row { display: flex; gap: 8px; justify-content: flex-end; }
    #samat-update-banner button {
      cursor: pointer; border: none; border-radius: 6px; padding: 6px 10px; font-size: 12px;
      font-family: inherit;
    }
    #samat-update-banner .samat-btn-install { background: #16a34a; color: #fff; font-weight: 700; }
    #samat-update-banner .samat-btn-dismiss { background: transparent; color: #cbd5e1; }
    #samat-update-banner .samat-progress-track {
      background: #374151; border-radius: 4px; height: 6px; overflow: hidden;
    }
    #samat-update-banner .samat-progress-fill {
      background: #3b82f6; height: 100%; width: 0%; transition: width .3s ease;
    }
  `;
  document.head.appendChild(style);
}

function createBanner() {
  const el = document.createElement('div');
  el.id = 'samat-update-banner';
  el.innerHTML = `
    <div class="samat-update-title"></div>
    <div class="samat-update-body"></div>
    <div class="samat-update-row">
      <button type="button" class="samat-btn-dismiss">بستن</button>
      <button type="button" class="samat-btn-install" style="display:none">نصب و راه‌اندازی مجدد</button>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('.samat-btn-dismiss').addEventListener('click', () => {
    el.classList.remove('samat-visible');
  });
  el.querySelector('.samat-btn-install').addEventListener('click', () => {
    ipcRenderer.send('samat-update:install');
  });

  return el;
}

function setupUpdateBanner() {
  injectBannerStyles();
  const banner = createBanner();
  const title = banner.querySelector('.samat-update-title');
  const body = banner.querySelector('.samat-update-body');
  const installBtn = banner.querySelector('.samat-btn-install');

  const show = () => banner.classList.add('samat-visible');

  ipcRenderer.on('samat-update:available', (_event, { version }) => {
    title.textContent = `نسخه‌ی جدید ${version} پیدا شد`;
    body.textContent = 'در حال دانلود در پس‌زمینه...';
    body.innerHTML += '<div class="samat-progress-track"><div class="samat-progress-fill"></div></div>';
    installBtn.style.display = 'none';
    show();
  });

  ipcRenderer.on('samat-update:downloading', (_event, { percent }) => {
    const fill = banner.querySelector('.samat-progress-fill');
    if (fill) fill.style.width = `${percent}%`;
  });

  ipcRenderer.on('samat-update:downloaded', (_event, { version, notes }) => {
    title.textContent = `نسخه‌ی ${version} آماده‌ی نصب است`;
    body.textContent = notes
      ? notes.replace(/<[^>]*>/g, '').slice(0, 200)
      : 'برای اعمال آپدیت، برنامه باید بسته و دوباره باز شود.';
    installBtn.style.display = 'inline-block';
    show();
  });
}

window.addEventListener('DOMContentLoaded', setupUpdateBanner);

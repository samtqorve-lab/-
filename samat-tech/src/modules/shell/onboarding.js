import { el } from '../../lib/dom.js';

// راهنمای تصویری اولین اجرا — فقط یک‌بار (روی همین گوشی) بعد از اولین ورود موفق نشان داده می‌شود
const SLIDES = [
  { icon: '📷', title: 'عکس فقط با دوربین، همین لحظه', text: 'همه‌ی عکس‌های سینه‌کار، ماشین‌آلات و احراز هویت باید مستقیم با دوربین گرفته بشن (نه از گالری) — موقعیت GPS و مشخصات شما خودکار روی عکس درج می‌شه.' },
  { icon: '🎯', title: 'پیاده کردن نقاط پروانه', text: 'با دکمه‌ی «پیاده کردن نقاط پروانه» می‌تونید فاصله و جهت خودتون تا هر گوشه‌ی محدوده‌ی قانونی معدن رو ببینید — نیازی به قطب‌نمای گوشی نیست.' },
  { icon: '📴', title: 'حتی بدون اینترنت هم کار می‌کنه', text: 'اگه تو سایت معدن آنتن نداشته باشید، گزارش و عکس‌ها ذخیره می‌مونن و به‌محض وصل‌شدن اینترنت خودکار ارسال می‌شن — چیزی گم نمی‌شه.' },
  { icon: '✨', title: 'رسمی‌نویسی خودکار', text: 'روی دکمه‌ی «رسمی‌نویسی خودکار» کنار توضیحات بزنید تا رایج‌ترین عبارات محاوره‌ای به رسمی جایگزین بشه — هیچ عدد یا ادعای جدیدی اضافه نمی‌شه و متن نهایی همیشه با خودتونه.' },
];

const STORAGE_KEY = 'techOfficerOnboardingSeen';

export function shouldShowOnboarding() {
  return localStorage.getItem(STORAGE_KEY) !== '1';
}

export function mountOnboarding(root, onDone) {
  let idx = 0;
  const iconBox = el('div', { style: 'font-size:48px;text-align:center' });
  const titleBox = el('h3', { style: 'text-align:center;margin-top:10px' });
  const textBox = el('p', { style: 'text-align:center;color:var(--stone-600);margin-top:8px;line-height:1.9' });
  const dotsBox = el('div', { style: 'display:flex;justify-content:center;gap:6px;margin-top:16px' });
  const nextBtn = el('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:18px' });
  const backBtn = el('button', { class: 'btn-ghost btn-sm', style: 'margin-top:8px;width:100%' }, 'قبلی');

  function render() {
    const s = SLIDES[idx];
    iconBox.textContent = s.icon;
    titleBox.textContent = s.title;
    textBox.textContent = s.text;
    dotsBox.innerHTML = '';
    SLIDES.forEach((_, i) => dotsBox.append(el('span', {
      style: `width:7px;height:7px;border-radius:50%;background:${i === idx ? 'var(--patina-700)' : 'var(--stone-300)'}`,
    })));
    nextBtn.textContent = idx === SLIDES.length - 1 ? '✅ شروع کنید' : 'بعدی';
    backBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
  }
  function finish() {
    localStorage.setItem(STORAGE_KEY, '1');
    overlay.remove();
    onDone?.();
  }
  nextBtn.addEventListener('click', () => { if (idx < SLIDES.length - 1) { idx++; render(); } else { finish(); } });
  backBtn.addEventListener('click', () => { if (idx > 0) { idx--; render(); } });

  const overlay = el('div', {
    style: 'position:fixed;inset:0;background:rgba(28,27,23,.55);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px',
  }, el('div', { style: 'width:100%;max-width:360px;background:#fff;border-radius:var(--radius-lg);padding:28px 22px;box-shadow:var(--shadow-lg)' }, [
    iconBox, titleBox, textBox, dotsBox, nextBtn, backBtn,
  ]));
  root.append(overlay);
  render();
}

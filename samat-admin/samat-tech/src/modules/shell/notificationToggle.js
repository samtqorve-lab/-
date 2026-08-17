import { el, showToast } from '../../lib/dom.js';
import { notificationsSupported, notificationPermission, requestNotificationPermission } from '../../lib/localNotifications.js';

/** یک ردیف کوچک «فعال‌سازی اعلان» می‌سازد؛ اگر مرورگر پشتیبانی نکند چیزی نشان نمی‌دهد */
export function mountNotificationToggle(container) {
  if (!notificationsSupported()) return;
  function draw() {
    container.innerHTML = '';
    const perm = notificationPermission();
    if (perm === 'granted') {
      container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--patina-700);background:var(--stone-50);border-radius:8px;padding:8px 10px;margin-top:10px' },
        '✅ اعلان‌های یادآوری (تمدید احراز هویت، انقضای پروانه) فعال است'));
      return;
    }
    if (perm === 'denied') {
      container.append(el('div', { style: 'font-size:var(--text-xs);color:var(--stone-600);background:var(--stone-50);border-radius:8px;padding:8px 10px;margin-top:10px' },
        '🔕 اعلان‌ها مسدود شده — برای فعال‌سازی، از تنظیمات مرورگر اجازه دهید'));
      return;
    }
    container.append(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;background:var(--stone-50);border-radius:8px;padding:8px 10px;margin-top:10px' }, [
      el('span', { style: 'font-size:var(--text-xs)' }, '🔔 برای یادآوری تمدید احراز هویت و انقضای پروانه، اعلان را فعال کنید'),
      el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff', onclick: async () => {
        const result = await requestNotificationPermission();
        if (result === 'granted') showToast('✅ اعلان‌ها فعال شد');
        else if (result === 'denied') showToast('🔕 اجازه داده نشد');
        draw();
      } }, 'فعال‌سازی'),
    ]));
  }
  draw();
}

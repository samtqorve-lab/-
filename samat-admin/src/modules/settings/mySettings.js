import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

/**
 * تب «تنظیمات من»: در حال حاضر فقط شامل سوییچ «ورود با تایید Push» است. چون گرفتن توکن FCM فقط
 * داخل اپ اندروید صمت ممکن است (وب معمولی زیرساخت Web Push جدا می‌خواهد که نصب نشده)، این سوییچ
 * فقط داخل همان اپ فعال است — در وب/دسکتاپ یک توضیح غیرفعال نمایش داده می‌شود.
 */
export async function renderMySettings(container, state, appCtx) {
  container.innerHTML = '';
  const email = appCtx.myEmail;

  const card = el('div', { class: 'card', style: 'max-width:520px' });
  card.append(el('h3', { style: 'margin-top:0' }, '🔐 ورود با تایید Push'));

  let isNativeAndroid = false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch { /* پلاگین در بیلد وب/دسکتاپ اصلاً import نمی‌شود */ }

  const { data: row } = await sb.from('user_roles').select('push_login_enabled, push_fcm_token').eq('email', email).maybeSingle();
  const enabled = !!row?.push_login_enabled;

  if (!isNativeAndroid) {
    card.append(
      el('p', { style: 'color:var(--stone-600);font-size:var(--text-sm)' },
        `این قابلیت فقط از داخل اپ اندروید «پنل ادمین صمت» قابل‌فعال‌سازی است — چون برای دریافت اعلان نیاز به ثبت این دستگاه دارد. وضعیت فعلی حساب شما: ${enabled ? '✅ فعال (روی یک دستگاه اندروید دیگر)' : '⭕ غیرفعال'}.`),
      enabled ? el('button', {
        class: 'btn btn-ghost', style: 'margin-top:8px',
        onclick: async () => {
          await sb.from('user_roles').update({ push_login_enabled: false, push_fcm_token: null }).eq('email', email);
          showToast('✅ ورود با تایید Push غیرفعال شد');
          renderMySettings(container, state, appCtx);
        },
      }, 'غیرفعال‌سازی از این حساب') : null,
    );
    container.append(card);
    return;
  }

  const statusLine = el('p', { style: 'color:var(--stone-600);font-size:var(--text-sm)' },
    enabled ? '✅ فعال — از این به بعد، هر ورود جدید (از هر دستگاهی) نیاز به تایید یک اعلان روی همین گوشی دارد.'
      : 'وقتی روشن کنید، این گوشی به‌عنوان دستگاه تاییدکننده ثبت می‌شود. از آن پس، هر ورود جدید با ایمیل/رمز (از وب، دسکتاپ، یا هر دستگاه دیگر) تا تایید یک اعلان روی همین گوشی معلق می‌ماند.');
  const toggleBtn = el('button', { class: `btn ${enabled ? 'btn-ghost' : 'btn-primary'}` }, enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی روی این دستگاه');

  toggleBtn.onclick = async () => {
    toggleBtn.disabled = true;
    try {
      if (enabled) {
        await sb.from('user_roles').update({ push_login_enabled: false, push_fcm_token: null }).eq('email', email);
        showToast('✅ ورود با تایید Push غیرفعال شد');
      } else {
        const { registerForPushLogin } = await import('../../lib/pushNative.js');
        await registerForPushLogin(email);
        showToast('✅ این دستگاه به‌عنوان تاییدکننده‌ی ورود ثبت شد');
      }
      renderMySettings(container, state, appCtx);
    } catch (err) {
      showToast(`⚠️ ${err.message || 'خطا در تنظیم Push'}`);
      toggleBtn.disabled = false;
    }
  };

  card.append(statusLine, toggleBtn);
  container.append(card);
}

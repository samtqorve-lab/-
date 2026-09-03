import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';
import {
  bioSupported, hasBiometricCred, enableBiometric, removeBiometricCred,
} from '../../lib/biometric.js';

function renderBiometricCard(email) {
  const card = el('div', { class: 'card', style: 'max-width:520px;margin-top:16px' });
  card.append(el('h3', { style: 'margin-top:0' }, '👆 ورود سریع با اثر انگشت/Face ID'));
  if (!bioSupported()) {
    card.append(el('p', { style: 'color:var(--stone-600);font-size:var(--text-sm)' },
      'این قابلیت فقط داخل اپ اندروید/ویندوز نصب‌شده در دسترس است، نه در مرورگر وب معمولی.'));
    return card;
  }
  function draw() {
    card.querySelectorAll('.bio-row').forEach((n) => n.remove());
    const enabled = hasBiometricCred(email);
    const row = el('div', { class: 'bio-row' }, [
      el('p', { style: 'color:var(--stone-600);font-size:var(--text-sm)' },
        enabled ? '✅ فعال — دفعات بعد قبل از ورود، اثر انگشت/Face ID این گوشی را می‌خواهد.'
          : 'وقتی فعال کنید، دفعات بعد به‌جای رمز عبور کافی است اثر انگشت/Face ID خودتان را نشان دهید (این یک قفل محلی روی همین دستگاه است).'),
      enabled
        ? el('button', { class: 'btn btn-ghost', onclick: () => { removeBiometricCred(email); showToast('🔓 غیرفعال شد'); draw(); } }, 'غیرفعال‌سازی')
        : el('button', { class: 'btn btn-primary', onclick: async () => {
          try { await enableBiometric(email); showToast('✅ ورود با اثر انگشت فعال شد'); } catch (err) { showToast(`⚠️ ${err.message}`); }
          draw();
        } }, 'فعال‌سازی روی این دستگاه'),
    ]);
    card.append(row);
  }
  draw();
  return card;
}

/**
 * تب «تنظیمات من»: شامل سوییچ «ورود با تایید Push» و «ورود سریع با اثر انگشت/Face ID». چون گرفتن
 * توکن FCM فقط داخل اپ اندروید سامات ممکن است (وب معمولی زیرساخت Web Push جدا می‌خواهد که نصب
 * نشده)، سوییچ Push فقط داخل همان اپ فعال است — در وب/دسکتاپ یک توضیح غیرفعال نمایش داده می‌شود.
 */
export async function renderMySettings(container, state, appCtx) {
  container.innerHTML = '';
  const email = appCtx.myEmail;
  container.append(renderBiometricCard(email));

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
        `این قابلیت فقط از داخل اپ اندروید «پنل ادمین سامات» قابل‌فعال‌سازی است — چون برای دریافت اعلان نیاز به ثبت این دستگاه دارد. وضعیت فعلی حساب شما: ${enabled ? '✅ فعال (روی یک دستگاه اندروید دیگر)' : '⭕ غیرفعال'}.`),
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

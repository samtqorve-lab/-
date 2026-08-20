import { el, showToast } from '../../lib/dom.js';
import { sb } from '../../lib/supabase.js';

/** ردیف «فعال/غیرفعال‌سازی ورود با تایید Push» — فقط داخل اپ اندروید معنا دارد (برای گرفتن توکن
 * FCM باید همین دستگاه ثبت شود)؛ در نسخه‌ی وب/PWA چیزی نشان نمی‌دهد. */
export async function mountPushLoginToggle(container, email) {
  let isNativeAndroid = false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch { /* در بیلد وب اصلاً import نمی‌شود */ }
  if (!isNativeAndroid) return;

  async function draw() {
    container.innerHTML = '';
    const { data } = await sb.from('user_roles').select('push_login_enabled').eq('email', email).maybeSingle();
    const enabled = !!data?.push_login_enabled;
    container.append(el('div', { style: 'display:flex;justify-content:space-between;align-items:center;background:var(--stone-50);border-radius:8px;padding:8px 10px;margin-top:10px' }, [
      el('span', { style: 'font-size:var(--text-xs)' }, enabled ? '✅ ورود با تایید Push روی این دستگاه فعال است' : '🔐 برای امنیت بیشتر، تایید ورود با اعلان را فعال کنید'),
      enabled
        ? el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700)', onclick: async () => {
          await sb.from('user_roles').update({ push_login_enabled: false, push_fcm_token: null }).eq('email', email);
          showToast('🔓 غیرفعال شد'); draw();
        } }, 'غیرفعال‌سازی')
        : el('button', { class: 'btn-sm', style: 'background:var(--patina-700);color:#fff', onclick: async () => {
          try {
            const { registerForPushLogin } = await import('../../lib/pushNative.js');
            await registerForPushLogin(email);
            showToast('✅ ورود با تایید Push فعال شد');
          } catch (err) { showToast(`⚠️ ${err.message}`); }
          draw();
        } }, 'فعال‌سازی'),
    ]));
  }
  draw();
}

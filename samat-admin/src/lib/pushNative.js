import { sb } from './supabase.js';
import { el, passwordFieldWithToggle, showToast } from './dom.js';
import { signIn } from './auth.js';

/**
 * ثبت این دستگاه برای دریافت اعلان‌های عمومی سامانه (ثبت‌نام جدید، گزارش، حادثه، ...) — بدون
 * فعال کردن «ورود با تایید Push». آن یک ویژگی جدا و اختیاریی ۲مرحله‌ای برای ورود است
 * (پایین‌تر: registerForPushLogin) و نباید صرفِ باز کردن اپ فعال شود.
 */
export async function registerDeviceToken(email) {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') {
    const req = await PushNotifications.requestPermissions();
    if (req.receive !== 'granted') return false;
  }

  const token = await new Promise((resolve, reject) => {
    const successHandle = PushNotifications.addListener('registration', (t) => {
      successHandle.remove();
      errorHandle.remove();
      resolve(t.value);
    });
    const errorHandle = PushNotifications.addListener('registrationError', (err) => {
      successHandle.remove();
      errorHandle.remove();
      reject(new Error(err.error || 'ثبت اعلان ناموفق بود'));
    });
    PushNotifications.register();
  });

  const { error } = await sb.from('user_roles').update({ push_fcm_token: token, push_app: 'samat-admin' }).eq('email', email);
  if (error) throw error;
  return true;
}

/** «ورود با تایید Push» (۲مرحله‌ای، از تنظیمات فعال می‌شود) — علاوه بر ثبت توکن، پرچم را هم روشن می‌کند. */
export async function registerForPushLogin(email) {
  await registerDeviceToken(email);
  const { error } = await sb.from('user_roles').update({ push_login_enabled: true }).eq('email', email);
  if (error) throw error;
  await attachLoginApprovalHandler();
}

async function showNativeLocal(title, body, data) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') return;
    }
    await LocalNotifications.schedule({
      notifications: [{ id: Math.floor(Math.random() * 2147483647), title, body, extra: data || {} }],
    });
  } catch { /* اگر پلاگین در دسترس نبود، بی‌صدا رد می‌شود — بدتر از این نیست که اصلاً چیزی نشان داده نشود */ }
}

async function showBrowserNotification(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body });
  } catch { /* بی‌اثر */ }
}

/**
 * صفحه‌ی کوچک تایید ورود — وقتی لمس روی نوتیفیکیشن «تایید ورود» اتفاق افتاد که این دستگاه
 * (برخلاف دستگاهی که روی وب/دسکتاپ رمز وارد شده) از قبل لاگین نبوده — مثلاً از اپ خارج شده
 * یا سشنش منقضی شده. قبلاً این حالت باعث می‌شد کاربر بدون هیچ دیالوگی مستقیم به صفحه‌ی ورود عادی پرتاب شود — یعنی
 * همان چیزی که باعث شد این قابلیت اصلاً کار نکند. راه‌حل: همین‌جا روی همان لمس، یک صفحه‌ی کوچک مستقل (روی
 * document.body، نه روی SPA container) نشان می‌دهیم که اول رمز را می‌گیرد (برای همان ایمیلی‌ای
 * که قبلاً ورودش را فعال کرده)، سپس همان respond موجود را صدا می‌زند و با یک reload کامل، بوت طبیعی
 * با همان سشن تازه ادامه پیدا می‌کند. در هر دو حالت (تایید/رد) رمز لازم است — چون سرور
 * برای فراخوانی respond همیشه یک سشن معتبر می‌خواهد (همان قراردادی که از قبل برای حالت لاگین‌بودن
 * وجود دارد)؛ یعنی ردکردن هم مستلزم وارد کردن رمز است — تا کسی جز صاحب واقعی حساب نتواند به
 * جای او تصمیم بگیرد (حتی برای رد کردن).
 */
function mountQuickApprovalOverlay(data, respond) {
  const overlay = el('div', {
    style: 'position:fixed;inset:0;z-index:999999;background:rgba(20,20,20,0.72);display:flex;'
      + 'align-items:center;justify-content:center;padding:16px;font-family:inherit;direction:rtl',
  });

  const card = el('div', {
    style: 'background:#fff;border-radius:14px;padding:20px;max-width:360px;width:100%;'
      + 'box-shadow:0 10px 40px rgba(0,0,0,.3)',
  });

  const title = el('div', { style: 'font-weight:800;font-size:16px;margin-bottom:6px' }, '🔐 درخواست ورود به پنل ادمین صمت');
  const subtitle = el('div', { style: 'font-size:13px;color:#555;margin-bottom:14px;line-height:1.7' },
    `یک نفر با ایمیل «${data.email || '—'}» در حال ورود به وب/دسکتاپ است. چون این گوشی الان لاگین نیست، `
    + 'برای تایید یا رد این ورود، رمز عبور خودتان را وارد کنید.');

  const passLabel = el('label', { style: 'font-size:13px;display:block;margin-bottom:4px' }, 'رمز عبور');
  const { wrap: passWrap, input: passInput } = passwordFieldWithToggle({ dir: 'ltr', placeholder: '••••••••', autocomplete: 'current-password' });
  const errBox = el('div', { style: 'color:#c0392b;font-size:12px;margin-top:8px;min-height:16px' });

  const approveBtn = el('button', {
    type: 'button',
    style: 'flex:1;background:#1a8f4c;color:#fff;border:none;border-radius:8px;padding:10px;font-weight:700;cursor:pointer',
  }, '✅ تایید می‌کنم');
  const denyBtn = el('button', {
    type: 'button',
    style: 'flex:1;background:#c0392b;color:#fff;border:none;border-radius:8px;padding:10px;font-weight:700;cursor:pointer',
  }, '❌ رد می‌کنم');
  const laterBtn = el('button', {
    type: 'button',
    style: 'width:100%;background:transparent;color:#888;border:none;padding:8px;margin-top:10px;font-size:12px;cursor:pointer',
  }, 'بعداً — بدون پاسخ ببند');

  let busy = false;
  async function submit(decision) {
    if (busy) return;
    if (!passInput.value.trim()) { errBox.textContent = 'رمز عبور را وارد کنید'; return; }
    if (!data.email) { errBox.textContent = 'ایمیل این درخواست مشخص نیست — از داخل اپ دستی وارد شوید'; return; }
    busy = true;
    errBox.textContent = '';
    approveBtn.disabled = true; denyBtn.disabled = true;
    const originalApproveLabel = approveBtn.textContent;
    const originalDenyLabel = denyBtn.textContent;
    (decision === 'approved' ? approveBtn : denyBtn).textContent = '⏳ در حال بررسی رمز...';
    try {
      await signIn(data.email, passInput.value);
    } catch {
      errBox.textContent = 'رمز عبور نادرست است';
      busy = false;
      approveBtn.disabled = false; denyBtn.disabled = false;
      approveBtn.textContent = originalApproveLabel; denyBtn.textContent = originalDenyLabel;
      return;
    }
    (decision === 'approved' ? approveBtn : denyBtn).textContent = '⏳ در حال ثبت پاسخ...';
    await respond(data.approvalId, decision);
    overlay.remove();
    showToast(decision === 'approved' ? '✅ ورود تایید شد' : '❌ ورود رد شد');
    // حالا که این گوشی هم لاگین شد، کل اپ را ریلود می‌کنیم تا boot() طبیعی ادامه پیدا کند و داشبورد خودش را ببیند
    setTimeout(() => window.location.reload(), 600);
  }

  approveBtn.addEventListener('click', () => submit('approved'));
  denyBtn.addEventListener('click', () => submit('denied'));
  laterBtn.addEventListener('click', () => overlay.remove());

  card.append(title, subtitle, passLabel, passWrap, errBox,
    el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [approveBtn, denyBtn]),
    laterBtn);
  overlay.append(card);
  document.body.append(overlay);
  passInput.focus();
}

let handlerAttached = false;
/**
 * شنونده‌ی مشترک همه‌ی نوع Pushها (هم «تایید ورود» هم اعلان‌های عمومی سامانه). این تابع باید هرچه
 * زودتر در بوت اپ سوار شود — حتی قبل از بررسی سشن (نگاه کنید به main.js) — چون اگر اپ از طریق لمس
 * نوتیفیکیشن «تایید ورود» به‌صورت سرد باز شده باشد و این گوشی سشن معتبری نداشته باشد، تنها همین
 * زمان‌بندی زودهنگام تضمین می‌کند رویداد لمس نوتیفیکیشن (pushNotificationActionPerformed) از دست نرود.
 */
export async function attachLoginApprovalHandler() {
  if (handlerAttached) return;
  handlerAttached = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { PushNotifications } = await import('@capacitor/push-notifications');

    async function respond(approvalId, decision) {
      const { data: sessionData } = await sb.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) return;
      await fetch(`${sb.supabaseUrl}/functions/v1/push-login-respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ approvalId, decision }),
      }).catch(() => {});
    }

    async function confirmLogin(data) {
      // اگر همین الان روی این گوشی سشن معتبر هست (حالت قبلی: اپ از قبل لاگین بوده)،
      // همان دیالوگ سادهی تایید/رد کافی است. اگر سشن ندارد (مثلاً اپ از طریق لمس نوتیفیکیشن
      // به‌صورت سرد باز شده)، یک صفحه‌ی کوچک برای گرفتن رمز و احراز‌هویت همزمان با تایید/رد
      // نشان می‌دهیم — بدون اینکه کاربر را اول به صفحه‌ی ورود عادی ببرد که اصلاً راهی به این تایید/رد ندارد.
      const { data: sessionData } = await sb.auth.getSession();
      if (sessionData?.session) {
        const ok = window.confirm(`🔐 درخواست ورود به پنل ادمین صمت\nآیا شما (${data.email || ''}) در حال ورود هستید؟\n\nOK = تایید می‌کنم\nCancel = رد می‌کنم`);
        respond(data.approvalId, ok ? 'approved' : 'denied');
        return;
      }
      mountQuickApprovalOverlay(data, respond);
    }

    // pushNotificationReceived فقط در پیش‌زمینه فایر می‌شود (طبق مستندات Capacitor)، و در این
    // حالت اندروید خودش اعلان سیستمی نشان نمی‌دهد — برای رویدادهای عمومی سامانه (غیر از تایید
    // ورود) این‌جا دستی با LocalNotifications همان اعلان را نشان می‌دهیم.
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      const data = notification.data || {};
      if (data.type === 'login-approval' && data.approvalId) {
        confirmLogin(data);
        return;
      }
      showNativeLocal(notification.title || 'اعلان جدید', notification.body || '', data);
    });

    // وقتی اپ بسته/پس‌زمینه بوده و کاربر روی اعلان سیستمی (که خودِ اندروید نشان داده) لمس کرده:
    // برای «تایید ورود» باید دیالوگ تایید/رد نشان داده شود؛ برای بقیه‌ی انواع، کاربر همین الان با
    // لمس همان اعلان وارد اپ شده — کار اضافه‌ای لازم نیست.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification?.data || {};
      if (data.type === 'login-approval' && data.approvalId) confirmLogin(data);
    });
  } catch {
    handlerAttached = false;
  }
}

let realtimeAttached = false;
function attachRealtimeNotifications(email) {
  if (realtimeAttached) return;
  realtimeAttached = true;
  sb.channel(`notif-${email}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_email=eq.${email}` }, (payload) => {
      showBrowserNotification(payload.new.title, payload.new.body);
    })
    .subscribe();
}

/**
 * نقطه‌ی ورود واحد که باید بعد از تایید نقش (داخل boot، برای هر کاربر ستادی) صدا زده شود —
 * main.js. روی اندروید: توکن دستگاه را (اگر قبلاً ثبت نشده) ثبت می‌کند تا اعلان سامانه به این
 * حساب برسد. شنونده‌ی Push (attachLoginApprovalHandler) دیگر از این‌جا صدا زده نمی‌شود — چون باید
 * حتی بدون سشن هم زودتر سوار شده باشد؛ نگاه کنید به فراخوانی مستقیمش در main.js. روی وب/ویندوز
 * (Electron، که اصلاً FCM ندارد): مستقیم روی جدول notifications عضو Realtime می‌شود.
 */
export async function initNotifications(email) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      await registerDeviceToken(email).catch(() => {});
    } else {
      attachRealtimeNotifications(email);
    }
  } catch { /* بی‌اثر */ }
}

package ir.novinproduct.samattech;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * پیام‌های Push از نوع «درخواست تایید ورود» (data.type == "login-approval") را همین‌جا، در سطح
 * بومی و بدون نیاز به باز شدن اپ/WebView، با یک نوتیفیکیشن واقعی و دو دکمه‌ی «تایید»/«رد» نمایش
 * می‌دهد — لمس هرکدام مستقیماً LoginApprovalActionReceiver را (بدون باز کردن هیچ Activity‌ای)
 * صدا می‌زند.
 *
 * چرا پیام باید data-only باشد (نه notification+data): اگر پیام FCM فیلد notification هم داشته
 * باشد، خودِ سیستم‌عامل — قبل از اینکه اصلاً این کلاس فرصت اجرا پیدا کند — یک نوتیفیکیشن پیش‌فرض
 * (بدون دکمه) می‌سازد و نمایش می‌دهد. سرور (push-login-notify) از این پس فقط data می‌فرستد،
 * دقیقاً به همین دلیل — این نکته اگر رعایت نشود، دوباره دکمه‌ها ناپدید می‌شوند.
 *
 * از کلاس خودِ Capacitor (نه مستقیم از FirebaseMessagingService) ارث‌بری می‌کنیم تا برای همه‌ی
 * پیام‌های دیگر (که به این ویژگی ربطی ندارند) رفتار عادی پلاگین — یعنی رساندن پیام به شنونده‌ی
 * جاوااسکریپت pushNotificationReceived دست‌نخورده بماند.
 */
public class PushLoginMessagingService extends MessagingService {

  private static final String CHANNEL_ID = "login_approval";
  private static final String ACTION_APPROVE = "ir.novinproduct.samattech.LOGIN_APPROVE";
  private static final String ACTION_DENY = "ir.novinproduct.samattech.LOGIN_DENY";
  public static final String EXTRA_APPROVAL_ID = "approvalId";
  public static final String EXTRA_RESPONSE_TOKEN = "responseToken";

  @Override
  public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
    Map<String, String> data = remoteMessage.getData();
    if (!"login-approval".equals(data.get("type"))) {
      // هر پیام دیگری (مثلاً اطلاعیه‌های عمومی که ممکن است بعداً اضافه شود) دقیقاً مثل قبل توسط
      // خودِ پلاگین کپسیتور مدیریت شود — این سرویس فقط برای این یک نوع پیام رفتار متفاوت دارد.
      super.onMessageReceived(remoteMessage);
      return;
    }

    String approvalId = data.get("approvalId");
    String responseToken = data.get("responseToken");
    if (approvalId == null || responseToken == null) return;

    String title = data.get("title");
    String body = data.get("body");
    String displayTitle = title != null ? title : "🔐 درخواست ورود";
    String displayBody = body != null ? body : "آیا شما در حال ورود هستید؟";

    ensureChannel();

    PendingIntent approveIntent = actionPendingIntent(ACTION_APPROVE, approvalId, responseToken);
    PendingIntent denyIntent = actionPendingIntent(ACTION_DENY, approvalId, responseToken);

    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(displayTitle)
      .setContentText(displayBody)
      .setStyle(new NotificationCompat.BigTextStyle().bigText(displayBody))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setAutoCancel(true)
      .addAction(new NotificationCompat.Action(android.R.drawable.checkbox_on_background, "✅ تایید می‌کنم", approveIntent))
      .addAction(new NotificationCompat.Action(android.R.drawable.ic_menu_close_clear_cancel, "❌ رد می‌کنم", denyIntent));

    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (nm != null) nm.notify(approvalId.hashCode(), builder.build());
  }

  private PendingIntent actionPendingIntent(String action, String approvalId, String responseToken) {
    Intent intent = new Intent(this, LoginApprovalActionReceiver.class);
    intent.setAction(action);
    intent.putExtra(EXTRA_APPROVAL_ID, approvalId);
    intent.putExtra(EXTRA_RESPONSE_TOKEN, responseToken);
    // requestCode باید برای approvalId+action ترکیب یکتا باشد، وگرنه اکشن «تایید» و «رد» همان
    // approval روی هم PendingIntent بازنویسی می‌کنند و فقط یکی‌شان واقعاً کار می‌کند.
    int requestCode = (approvalId + action).hashCode();
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getBroadcast(this, requestCode, intent, flags);
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      if (nm == null) return;
      NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID, "تایید ورود", NotificationManager.IMPORTANCE_HIGH);
      channel.setDescription("درخواست‌های تایید ورود که نیاز به پاسخ سریع دارند");
      channel.enableVibration(true);
      nm.createNotificationChannel(channel);
    }
  }
}

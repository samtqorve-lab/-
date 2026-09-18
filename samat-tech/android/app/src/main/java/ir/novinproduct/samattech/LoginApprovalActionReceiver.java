package ir.novinproduct.samattech;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * با لمس دکمه‌ی «تایید»/«رد» روی نوتیفیکیشن (ساخته‌شده در PushLoginMessagingService) صدا زده
 * می‌شود — بدون باز کردن هیچ Activity/WebView‌ای، مستقیماً و در پس‌زمینه به push-login-respond
 * وصل می‌شود (که با یک responseToken یک‌بارمصرف مخصوص همین approval کار می‌کند، نه نشست
 * Supabase Auth، چون اپ ممکن است اصلاً در حافظه اجرا نباشد).
 *
 * چرا goAsync(): BroadcastReceiver.onReceive عادی باید طی چند صدم‌ثانیه برگردد؛ کار شبکه‌ای در
 * همان thread باعث ANR/قطع زودهنگام سیستم‌عامل می‌شود. goAsync() مهلتی (طبق مستندات اندروید در
 * حد چند ثانیه) برای اتمام کار پس‌زمینه می‌دهد که برای یک درخواست HTTP کوچک کافی است.
 */
public class LoginApprovalActionReceiver extends BroadcastReceiver {

  private static final String TAG = "LoginApprovalAction";
  private static final String ACTION_APPROVE = "ir.novinproduct.samattech.LOGIN_APPROVE";
  private static final ExecutorService executor = Executors.newSingleThreadExecutor();

  @Override
  public void onReceive(Context context, Intent intent) {
    String approvalId = intent.getStringExtra(PushLoginMessagingService.EXTRA_APPROVAL_ID);
    String responseToken = intent.getStringExtra(PushLoginMessagingService.EXTRA_RESPONSE_TOKEN);
    String action = ACTION_APPROVE.equals(intent.getAction()) ? "approve" : "deny";
    if (approvalId == null || responseToken == null) return;

    NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm != null) nm.cancel(approvalId.hashCode());

    // اگر BuildConfig خالی باشد (env varhaye CI موقع بیلد ست نشده بودند)، به‌جای کرش یا تلاش بی‌فایده
    // برای وصل شدن به آدرس نامعتبر، فقط با یک لاگ خارج می‌شوییم — این حالت فقط در بیلدهای محلیِ
    // بدون .env درست پیش می‌آید، نه در APK واقعی منتشرشده.
    if (BuildConfig.SUPABASE_URL.isEmpty()) {
      Log.e(TAG, "SUPABASE_URL خالی است — این بیلد بدون secrets صحیح ساخته شده");
      return;
    }

    final PendingResult pendingResult = goAsync();
    final String finalApprovalId = approvalId;
    final String finalResponseToken = responseToken;
    final String finalAction = action;
    executor.execute(() -> {
      try {
        sendResponse(finalApprovalId, finalResponseToken, finalAction);
      } catch (Exception e) {
        Log.e(TAG, "push-login-respond failed", e);
      } finally {
        pendingResult.finish();
      }
    });
  }

  private void sendResponse(String approvalId, String responseToken, String action) throws Exception {
    JSONObject payload = new JSONObject();
    payload.put("approvalId", approvalId);
    payload.put("responseToken", responseToken);
    payload.put("action", action);

    URL url = new URL(BuildConfig.SUPABASE_URL + "/functions/v1/push-login-respond");
    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
    try {
      conn.setRequestMethod("POST");
      conn.setConnectTimeout(8000);
      conn.setReadTimeout(8000);
      conn.setDoOutput(true);
      conn.setRequestProperty("Content-Type", "application/json");
      conn.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY);
      try (OutputStream os = conn.getOutputStream()) {
        os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
      }
      int code = conn.getResponseCode();
      Log.i(TAG, "push-login-respond status=" + code);
    } finally {
      conn.disconnect();
    }
  }
}

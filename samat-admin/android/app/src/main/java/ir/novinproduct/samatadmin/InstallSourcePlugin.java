package ir.novinproduct.samatadmin;

import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * فقط یک متد دارد: برگرداندن نام پکیج نصب‌کننده‌ی این اپ (مثلاً "com.farsitel.bazaar" اگر از
 * کافه‌بازار نصب شده باشد، "com.android.vending" برای گوگل‌پلی، یا null اگر مستقیم/سایدلود شده).
 * دلیل وجودش: قوانین انتشار کافه‌بازار می‌گویند اپ‌هایی که از بازار نصب می‌شوند فقط باید از طریق
 * خودِ بازار به‌روزرسانی شوند — پس در سمت جاوااسکریپت (appUpdate.js) با همین مقدار تشخیص می‌دهیم
 * که آیا باید بنر «آپدیت جدید» خودمان را نشان دهیم یا نه.
 */
@CapacitorPlugin(name = "InstallSource")
public class InstallSourcePlugin extends Plugin {
  @PluginMethod
  public void getInstaller(PluginCall call) {
    JSObject ret = new JSObject();
    String installer = null;
    try {
      PackageManager pm = getContext().getPackageManager();
      String pkg = getContext().getPackageName();
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        InstallSourceInfo info = pm.getInstallSourceInfo(pkg);
        installer = info.getInstallingPackageName();
      } else {
        installer = pm.getInstallerPackageName(pkg);
      }
    } catch (Exception ignored) {
      // اگر به هر دلیلی این استعلام شکست بخورد، installer را null نگه می‌داریم — یعنی سمت
      // جاوااسکریپت طوری رفتار می‌کند که انگار از بازار نصب نشده (محافظه‌کارانه‌ترین حالت
      // برای کاربرانی که واقعاً مستقیم/سایدلود نصب کرده‌اند)
    }
    ret.put("installer", installer);
    call.resolve(ret);
  }
}

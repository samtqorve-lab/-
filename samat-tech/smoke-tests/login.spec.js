import { test, expect } from '@playwright/test';

test.describe('صفحه‌ی ورود اپ مسئول فنی', () => {
  test('باید بدون خطای جاوااسکریپت بارگذاری شود و فرم ورود را نشان دهد', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/');

    // فیلد ایمیل/شماره عضویت و دکمه‌ی «ورود» باید ظاهر شوند — یعنی boot() اجرا شده، نشستی پیدا
    // نکرده (چون کاربر واقعی وارد نشده)، و mountLogin() صفحه‌ی ورود را درست رندر کرده.
    await expect(page.getByPlaceholder('ایمیل یا شماره عضویت نظام مهندسی')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'ورود', exact: true })).toBeVisible();

    expect(jsErrors, `خطاهای جاوااسکریپت رخ داده در بارگذاری صفحه: ${jsErrors.join('; ')}`).toEqual([]);
  });

  test('لینک «ثبت‌نام» باید فرم ثبت‌نام را با فیلد شماره عضویت باز کند', async ({ page }) => {
    await page.goto('/');
    await page.getByText('ثبت‌نام', { exact: false }).first().click();
    // فیلدهای فرم این پروژه label و input را به‌صورت siblingِ ساده می‌چینند (بدون for/id)، پس
    // getByLabel کار نمی‌کند — مستقیم متن لیبل را که باید اول فرم باشد چک می‌کنیم.
    await expect(page.getByText('شماره عضویت نظام مهندسی (اول این را وارد کنید)')).toBeVisible({ timeout: 10000 });
  });
});

import { test, expect } from '@playwright/test';

test.describe('صفحه‌ی ورود پنل ادمین', () => {
  test('باید بدون خطای جاوااسکریپت بارگذاری شود و فرم ورود را نشان دهد', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/');

    await expect(page.getByPlaceholder('کد پرسنلی')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'ورود', exact: true })).toBeVisible();

    expect(jsErrors, `خطاهای جاوااسکریپت رخ داده در بارگذاری صفحه: ${jsErrors.join('; ')}`).toEqual([]);
  });
});

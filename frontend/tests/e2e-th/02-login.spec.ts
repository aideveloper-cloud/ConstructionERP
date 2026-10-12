import { expect, test } from '@playwright/test';

// These tests sign in themselves, so they start without the saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Sign in with an employee ID', () => {
  test('the login field asks for employee ID or email', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('รหัสพนักงานหรืออีเมล')).toBeVisible();
    await expect(page.getByPlaceholder(/EMP001/)).toBeVisible();
  });

  test('a wrong password is refused in Thai', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('รหัสพนักงานหรืออีเมล').fill('EMP001');
    await page.locator('input[type="password"]').fill('not-the-password');
    await page.locator('input[type="password"]').press('Enter');
    await expect(page.getByText('รหัสพนักงาน/อีเมล หรือรหัสผ่านไม่ถูกต้อง')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('staff sign in with their employee ID, in any letter case', async ({ page }) => {
    await page.goto('/login');
    // EMP001 / SitePass2026x is the local test account created for this suite.
    await page.getByLabel('รหัสพนักงานหรืออีเมล').fill('emp001');
    await page.locator('input[type="password"]').fill('SitePass2026x');
    await page.locator('input[type="password"]').press('Enter');
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText(/Somchai Test/).first()).toBeVisible();
  });
});

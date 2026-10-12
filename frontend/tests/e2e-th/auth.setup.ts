import { expect, test as setup } from '@playwright/test';

/**
 * Sign in once as the demo admin and keep the session for every other test.
 *
 * A sign-in without "remember me" keeps its tokens in sessionStorage, which
 * Playwright's storageState does not save, so every later test would start
 * signed out. The tokens are moved to localStorage the way the app itself
 * stores a remembered sign-in (oe_remember=1), and a reload proves the app
 * accepts that before the state is saved.
 */
setup('sign in as the demo admin', async ({ page }) => {
  await page.goto('/login');
  await page.getByText('demo@openconstructionerp.com', { exact: false }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await page.evaluate(() => {
    for (const key of ['oe_access_token', 'oe_refresh_token']) {
      const value = sessionStorage.getItem(key) ?? localStorage.getItem(key);
      if (value) localStorage.setItem(key, value);
      sessionStorage.removeItem(key);
    }
    localStorage.setItem('oe_remember', '1');
    localStorage.removeItem('oe_session_tabs');
  });
  await page.reload();
  await expect(page.getByRole('main').getByRole('heading', { name: 'ภาพรวมธุรกิจ', level: 1 })).toBeVisible();
  await page.context().storageState({ path: 'tests/e2e-th/.auth/admin.json' });
});

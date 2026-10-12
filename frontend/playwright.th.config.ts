import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the Thai edition (tests/e2e-th).
 *
 *   npx playwright test -c playwright.th.config.ts
 *
 * Runs against the production build the backend serves (OE_TH_BASE_URL,
 * default http://localhost:8000) with the seeded demo data. A setup project
 * signs in once through the demo-admin button and every other test reuses
 * that session, so the login rate limit is not hit.
 */
const BASE_URL = process.env.OE_TH_BASE_URL ?? 'http://localhost:8000';

export default defineConfig({
  testDir: './tests/e2e-th',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'qa-report-th', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'th-TH',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'th-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'tests/e2e-th/.auth/admin.json' },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});

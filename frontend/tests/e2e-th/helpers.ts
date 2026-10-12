import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Demo project used by these tests (Lebensmittelmarkt Karlsruhe). */
export const PROJECT_ID = '9a2ec5af-2e3a-4d04-8400-ea94f21b7a84';

/** Bearer token for API calls, read from the signed-in page. */
export async function apiToken(page: Page): Promise<string> {
  const token = await page.evaluate(
    () => localStorage.getItem('oe_access_token') ?? sessionStorage.getItem('oe_access_token'),
  );
  expect(token, 'signed-in session token').toBeTruthy();
  return token!;
}

export async function api<T = unknown>(
  request: APIRequestContext,
  token: string,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request[method](`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(res.status(), `${method.toUpperCase()} ${path} → ${await res.text().catch(() => '')}`).toBeLessThan(400);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

/** Make the demo project the active one (pages like /procurement need it). */
export async function openProject(page: Page): Promise<void> {
  await page.goto(`/projects/${PROJECT_ID}`);
  await expect(page.getByRole('main').getByRole('heading', { name: /Lebensmittelmarkt Karlsruhe/ })).toBeVisible();
}

/**
 * Collect uncaught page errors and failed (5xx) API responses while a test
 * runs, so a page that "renders" but throws or 500s still fails the test.
 */
export function watchForErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return { errors };
}

/** WCAG relative-luminance contrast ratio of two CSS rgb()/rgba() colours. */
export function contrast(fg: string, bg: string): number {
  const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const a = lum(parse(fg));
  const b = lum(parse(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

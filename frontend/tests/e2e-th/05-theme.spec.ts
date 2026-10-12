import { expect, test, type Page } from '@playwright/test';
import { contrast } from './helpers';

/** Colours an element is painted with, walking up to the first opaque background. */
async function colours(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const fg = getComputedStyle(el).color;
    let node: Element | null = el;
    let bg = 'rgb(255, 255, 255)';
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      // rgba(r, g, b, a): only a (nearly) opaque layer counts as the backdrop
      const alpha = c.startsWith('rgba') ? Number(c.split(',')[3]?.replace(')', '')) : 1;
      if (c && c !== 'transparent' && alpha >= 0.9) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    return { fg, bg };
  });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme is readable`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('oe_theme', t), theme);
    });

    test(`body text and headings meet WCAG AA (${theme})`, async ({ page }) => {
      await page.goto('/approvals?tab=history');
      await expect(page.getByRole('main').getByRole('heading', { name: 'ศูนย์อนุมัติ', level: 1 })).toBeVisible();
      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      expect(isDark).toBe(theme === 'dark');
      for (const sel of ['main h1', 'main p']) {
        const { fg, bg } = await colours(page, sel);
        expect(contrast(fg, bg), `${sel}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`status badges stay readable (${theme})`, async ({ page }) => {
      await page.goto('/approvals?tab=history');
      const card = page.getByTestId('approval-card').first();
      await expect(card).toBeVisible();
      // the status pill (approved / rejected) inside the first card
      const pill = card.locator('span.rounded-full').first();
      const { fg, bg } = await pill.evaluate((el) => ({
        fg: getComputedStyle(el).color,
        bg: getComputedStyle(el).backgroundColor,
      }));
      const page_bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
      // the pill's tint is translucent, so judge the text against the card behind it
      expect(contrast(fg, page_bg), `pill ${fg} on ${bg} over ${page_bg}`).toBeGreaterThanOrEqual(3);
    });
  });
}

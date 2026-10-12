import { expect, test } from '@playwright/test';
import { PROJECT_ID, openProject, watchForErrors } from './helpers';

test.describe('Thai shell and core pages', () => {
  test('the sidebar shows the 12 Thai menu items', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('complementary', { name: 'เมนูหลัก' }).getByRole('navigation');
    for (const label of [
      'ภาพรวมธุรกิจ', 'โครงการ', 'แผนงานและความคืบหน้า', 'จัดซื้อและผู้ขาย', 'คลังวัสดุ', 'การเงินและต้นทุน',
      'งวดงานและวางบิล', 'บุคลากรและแรงงาน', 'เครื่องจักรและอุปกรณ์', 'เอกสารและรายงาน', 'ศูนย์อนุมัติ', 'ตั้งค่าระบบ',
    ]) {
      await expect(nav.getByRole('link', { name: new RegExp(label) })).toBeVisible();
    }
  });

  // Every page the Thai menu leads to opens without a crash, an error page or a 5xx.
  const PAGES: [string, RegExp][] = [
    ['/dashboard', /ภาพรวมธุรกิจ/], // tab title matches the page heading
    ['/projects', /โครงการ/],
    ['/schedule', /.+/],
    ['/procurement', /จัดซื้อ/],
    ['/requisitions', /ใบขอซื้อ/],
    ['/site-inventory', /.+/],
    ['/finance', /การเงิน/],
    ['/contracts', /สัญญา/],
    ['/field-time', /.+/],
    ['/equipment', /.+/],
    ['/documents', /.+/],
    ['/approvals', /ศูนย์อนุมัติ/],
    ['/approval-routes', /สายอนุมัติ/],
    ['/users', /ผู้ใช้/],
    ['/settings', /.+/],
  ];
  for (const [path, title] of PAGES) {
    test(`page ${path} loads cleanly`, async ({ page }) => {
      const watch = watchForErrors(page);
      await openProject(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveTitle(title);
      await expect(page.getByText('หน้านี้ไม่ได้เปิดใช้ในระบบ')).toHaveCount(0);
      await expect(page.getByText(/Something went wrong|เกิดข้อผิดพลาดบางอย่าง/)).toHaveCount(0);
      expect(watch.errors, watch.errors.join('\n')).toEqual([]);
    });
  }

  test('a module outside the Thai edition shows the "not enabled" page', async ({ page }) => {
    await page.goto('/bim');
    await expect(page.getByText('หน้านี้ไม่ได้เปิดใช้ในระบบ')).toBeVisible();
    await page.getByRole('link', { name: 'กลับหน้าภาพรวม' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('the project page shows the location card with a working map', async ({ page }) => {
    const tiles: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/geo-hub/vector-tiles/') || r.url().includes('/geo-hub/basemap-style/')) tiles.push(r.status());
    });
    await page.goto(`/projects/${PROJECT_ID}`);
    await expect(page.getByText('ที่ตั้งโครงการ')).toBeVisible();
    await expect(page.getByRole('link', { name: /เปิดใน Google Maps/ })).toHaveAttribute('href', /google\.com\/maps/);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => tiles.length, { timeout: 30_000 }).toBeGreaterThan(1);
    expect(tiles.every((s) => s === 200), `tile statuses ${tiles}`).toBe(true);
  });
});

import { expect, test } from '@playwright/test';
import { api, apiToken, openProject } from './helpers';

test.describe('Purchase order: Thai numbers, VAT and withholding tax', () => {
  test('a mixed materials + labour order withholds 3% on the labour line only', async ({ page, request }) => {
    await openProject(page);
    await page.goto('/procurement');
    await page.getByText('ใบสั่งซื้อใหม่').first().click();

    // Line 1: materials (no WHT). Line 2: labour (WHT).
    await page.getByLabel('คำอธิบายสำหรับบรรทัด 1').fill('ค่าเหล็กเสริม DB12');
    await page.getByLabel('อัตราหน่วยสำหรับบรรทัด 1').fill('100000');
    await page.getByRole('button', { name: /เพิ่มรายการ/ }).click();
    await page.getByLabel('คำอธิบายสำหรับบรรทัด 2').fill('ค่าแรงผูกเหล็ก');
    await page.getByLabel('อัตราหน่วยสำหรับบรรทัด 2').fill('40000');

    await page.getByRole('combobox', { name: 'หัก ณ ที่จ่าย' }).selectOption('hire_of_work');
    await page.getByText('หัก ณ ที่จ่าย (ค่าแรง/ค่าบริการ)').nth(1).click();

    // The summary shows net / VAT / total / WHT / net payable before saving.
    const form = page.locator('[role="dialog"], .fixed').filter({ hasText: 'ราคาที่กรอก' }).last();
    await expect(form).toContainText('140,000.00');
    await expect(form).toContainText('9,800.00');
    await expect(form).toContainText('149,800.00');
    await expect(form).toContainText('หัก ณ ที่จ่าย 3% (ฐาน 40,000.00)');
    await expect(form).toContainText('1,200.00');
    await expect(form).toContainText('148,600.00');

    const created = page.waitForResponse((r) => r.url().endsWith('/api/v1/procurement/') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'สร้าง', exact: true }).click();
    const po = await (await created).json();

    // The server stored the same figures the form showed.
    expect(po.po_number).toMatch(/^PO\d{4}-\d{4}$/);
    expect([po.amount_subtotal, po.tax_amount, po.amount_total]).toEqual(['140000.00', '9800.00', '149800.00']);
    expect([po.wht_type, po.wht_rate, po.wht_base, po.wht_amount, po.net_payable]).toEqual([
      'hire_of_work', '3', '40000.00', '1200.00', '148600.00',
    ]);

    // Once approved (approval needs a vendor), the VAT / WHT can no longer change in place.
    const token = await apiToken(page);
    const contacts = await api<{ items?: { id: string }[] } | { id: string }[]>(request, token, 'get', '/contacts/?limit=1');
    const vendorId = (Array.isArray(contacts) ? contacts : contacts.items ?? [])[0]!.id;
    await api(request, token, 'patch', `/procurement/${po.id}`, { vendor_contact_id: vendorId });
    await api(request, token, 'post', `/procurement/${po.id}/approve/`);
    const res = await request.patch(`/api/v1/procurement/${po.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { wht_rate: '5' },
    });
    expect(res.status()).toBe(409);
  });

  test('numbers run company-wide in one monthly sequence', async ({ page, request }) => {
    await openProject(page);
    const token = await apiToken(page);
    const line = [{ description: 'ทราย', quantity: '1', unit_rate: '1000' }];
    const a = await api<{ po_number: string }>(request, token, 'post', '/procurement/', {
      project_id: '9a2ec5af-2e3a-4d04-8400-ea94f21b7a84', vat_mode: 'exclusive', items: line,
    });
    const b = await api<{ po_number: string }>(request, token, 'post', '/procurement/', {
      project_id: 'f1a95000-0001-4a00-8b00-000000000001', vat_mode: 'exclusive', items: line,
    });
    const [pa, na] = a.po_number.split('-');
    const [pb, nb] = b.po_number.split('-');
    expect(pa).toBe(pb); // same PO<yymm>
    expect(Number(nb)).toBe(Number(na) + 1); // next number, although another project
  });
});

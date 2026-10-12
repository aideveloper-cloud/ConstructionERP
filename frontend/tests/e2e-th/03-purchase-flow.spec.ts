import { expect, test, type Page } from '@playwright/test';
import { api, apiToken, openProject, watchForErrors } from './helpers';

/** Fill and send a new purchase requisition; returns its number (PR<yymm>-<nnnn>). */
async function createAndSubmitPR(page: Page, title: string, qty: string, price: string): Promise<string> {
  await openProject(page);
  await page.goto('/requisitions/new');
  await page.getByPlaceholder('เช่น เหล็กเสริมงานฐานราก โซน A').fill(title);
  await page.getByPlaceholder('เช่น หน้างาน / คลังกลาง').fill('หน้างาน อาคาร A');
  await page.getByRole('textbox', { name: 'รายการ', exact: true }).fill('ปูนซีเมนต์ปอร์ตแลนด์');
  await page.getByRole('textbox', { name: 'หน่วย', exact: true }).first().fill('ถุง');
  await page.getByRole('textbox', { name: 'จำนวน' }).fill(qty);
  await page.getByRole('textbox', { name: 'ราคา/หน่วย (ประมาณ)' }).fill(price);
  await page.getByRole('button', { name: 'ส่งอนุมัติ' }).click();
  await expect(page).toHaveURL(/\/requisitions\/[0-9a-f-]{36}$/);
  await expect(page.getByText('รออนุมัติ').first()).toBeVisible();
  const heading = await page.getByRole('main').getByRole('heading', { level: 1 }).innerText();
  const number = heading.match(/PR\d{4}-\d{4}/)?.[0];
  expect(number, `PR number in "${heading}"`).toBeTruthy();
  return number!;
}

/** The approval-center card of one document, on the "waiting for me" tab. */
async function approvalCard(page: Page, number: string) {
  await page.goto('/approvals?tab=mine');
  const card = page.getByTestId('approval-card').filter({ hasText: number });
  await expect(card).toBeVisible();
  return card;
}

test.describe('Purchase requisition → approval → purchase order', () => {
  test('a PR is approved in the approval center and turned into a PO with VAT 7%', async ({ page, request }) => {
    const watch = watchForErrors(page);
    const number = await createAndSubmitPR(page, `E2E ปูนงานฐานราก ${Date.now()}`, '100', '130');
    const prUrl = page.url();

    // It shows in the approval center with its amount and chain.
    const card = await approvalCard(page, number);
    await expect(card).toContainText('13,000.00');
    await expect(card).toContainText('ผู้จัดการโครงการ (PM)');
    await card.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('ยืนยันการอนุมัติ')).toBeVisible();
    await dialog.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await expect(page.getByText(/อนุมัติแล้ว 1 รายการ/)).toBeVisible();

    // The PR follows the chain's outcome.
    await page.goto(prUrl);
    await expect(page.getByText('อนุมัติแล้ว').first()).toBeVisible({ timeout: 20_000 });

    // Turn it into a purchase order.
    await page.getByRole('button', { name: 'ออกใบสั่งซื้อ' }).click();
    const poDialog = page.getByRole('dialog');
    await poDialog.getByPlaceholder('ค้นหาผู้ขาย…').fill('Pfinz');
    await page.getByText(/PfinzKlima/).first().click();
    await expect(poDialog).toContainText('13,910.00'); // 13,000 + VAT 7%
    await poDialog.getByRole('button', { name: 'สร้างใบสั่งซื้อ (ร่าง)' }).click();
    await expect(page).toHaveURL(/\/procurement\?po=/);

    // The PO carries the Thai number, the VAT split and the link back to the PR.
    const poId = new URL(page.url()).searchParams.get('po')!;
    const token = await apiToken(page);
    const po = await api<Record<string, string>>(request, token, 'get', `/procurement/${poId}`);
    expect(po.po_number).toMatch(/^PO\d{4}-\d{4}$/);
    expect([po.vat_mode, po.amount_subtotal, po.tax_amount, po.amount_total]).toEqual([
      'exclusive', '13000.00', '910.00', '13910.00',
    ]);
    const pr = await api<{ status: string; po: { po_number: string } }>(
      request, token, 'get', `/procurement/requisitions/${prUrl.split('/').pop()}`,
    );
    expect(pr.status).toBe('ordered');
    expect(pr.po.po_number).toBe(po.po_number);
    expect(watch.errors, watch.errors.join('\n')).toEqual([]);
  });

  test('a rejection needs a reason and returns the PR to the requester with it', async ({ page }) => {
    const number = await createAndSubmitPR(page, `E2E ส่งกลับ ${Date.now()}`, '10', '500');
    const prUrl = page.url();

    const card = await approvalCard(page, number);
    await card.getByRole('button', { name: 'ไม่อนุมัติ', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'ไม่อนุมัติและส่งกลับ' });
    await expect(confirm).toBeDisabled(); // no reason yet
    await dialog.getByRole('button', { name: 'ราคาสูงกว่าใบเสนอราคา' }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByText(/ส่งกลับแล้ว 1 รายการ/)).toBeVisible();

    await page.goto(prUrl);
    await expect(page.getByText('ถูกส่งกลับให้แก้ไข')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('ราคาสูงกว่าใบเสนอราคา')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งอนุมัติอีกครั้ง' })).toBeVisible();
  });

  test('the approval badge in the header counts what is waiting', async ({ page }) => {
    await page.goto('/approvals?tab=mine');
    const tab = page.getByRole('button', { name: /รอฉันอนุมัติ/ });
    // wait until the tab shows its count, then compare with the header button
    await expect(tab).toContainText(/\d/);
    const tabCount = Number((await tab.innerText()).replace(/\D/g, ''));
    const header = page.locator('button[title="เอกสารรออนุมัติ"]');
    if (tabCount > 0) await expect(header).toContainText(String(tabCount));
    else await expect(header.locator('span.rounded-full')).toHaveCount(0);
  });
});

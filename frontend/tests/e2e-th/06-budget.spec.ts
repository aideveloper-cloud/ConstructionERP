import { expect, test, type APIRequestContext } from '@playwright/test';
import { api, apiToken, openProject, PROJECT_ID, watchForErrors } from './helpers';

interface CostLine {
  id: string;
  boq_position_id: string | null;
  estimate_amount: string | null;
}

interface BudgetCheck {
  level: string;
  budget_lines: { cost_line_id: string; budget: string; ordered: string; pending: string; remaining: string }[];
}

/** BOQ-linked cost lines of the demo project (the spine is built from the BOQ if missing). */
async function budgetedLines(request: APIRequestContext, token: string): Promise<CostLine[]> {
  const load = async () => {
    const res = await api<CostLine[] | { items: CostLine[] }>(
      request, token, 'get', `/costmodel/projects/${PROJECT_ID}/spine/lines/?limit=200`,
    );
    return (Array.isArray(res) ? res : res.items).filter(
      (l) => l.boq_position_id && Number(l.estimate_amount ?? 0) > 0,
    );
  };
  let lines = await load();
  if (lines.length === 0) {
    await api(request, token, 'post', `/costmodel/projects/${PROJECT_ID}/spine/generate-from-boq/`, {});
    lines = await load();
  }
  expect(lines.length, 'BOQ-linked cost lines').toBeGreaterThan(0);
  return lines;
}

test.describe('Budget check on purchase requisitions', () => {
  test('a line well inside its BOQ budget shows as within budget', async ({ page, request }) => {
    const watch = watchForErrors(page);
    await openProject(page);
    const token = await apiToken(page);
    const lines = await budgetedLines(request, token);

    // Pick the line with the most budget left, so 1.00 can't tip it over 85%.
    const checks = await Promise.all(
      lines.map((l) =>
        api<BudgetCheck>(request, token, 'post', '/procurement/requisitions/budget-check', {
          project_id: PROJECT_ID,
          lines: [{ boq_position_id: l.boq_position_id, quantity: '1', unit_cost: '1' }],
        }).then((c) => ({ line: l, check: c })),
      ),
    );
    const roomy = checks.find((c) => c.check.level === 'ok');
    test.skip(!roomy, 'every BOQ line of the demo project is already near or over budget');

    await page.goto('/requisitions/new');
    await page.getByRole('main').locator('select').first().selectOption(roomy!.line.boq_position_id!);
    await page.getByRole('textbox', { name: 'จำนวน' }).fill('1');
    await page.getByRole('textbox', { name: 'ราคา/หน่วย (ประมาณ)' }).fill('1');

    const panel = page.getByTestId('budget-panel');
    await expect(panel).toContainText('อยู่ในงบ');
    await expect(page.getByTestId('line-budget')).toContainText('งบคงเหลือหลังขอ');
    expect(watch.errors, watch.errors.join('\n')).toEqual([]);
  });

  test('an over-budget PR needs confirmation, is flagged to approvers and kept out of bulk approval', async ({ page, request }) => {
    const watch = watchForErrors(page);
    await openProject(page);
    const token = await apiToken(page);
    const [line] = await budgetedLines(request, token);

    await page.goto('/requisitions/new');
    await page.getByPlaceholder('เช่น เหล็กเสริมงานฐานราก โซน A').fill(`E2E เกินงบ ${Date.now()}`);
    await page.getByRole('main').locator('select').first().selectOption(line!.boq_position_id!);
    await page.getByRole('textbox', { name: 'จำนวน' }).fill('1');
    await page.getByRole('textbox', { name: 'ราคา/หน่วย (ประมาณ)' }).fill('999999999');

    // Live check while typing: the line and the side panel both say "over budget".
    await expect(page.getByTestId('line-budget')).toContainText('เกินงบ');
    await expect(page.getByTestId('budget-panel')).toContainText('เกินงบ');

    // Sending asks once more before it goes out.
    await page.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
    await expect(page.getByText('ใบขอซื้อนี้เกินงบ BOQ')).toBeVisible();
    await page.getByRole('button', { name: 'ส่งอนุมัติต่อ' }).click();
    await expect(page).toHaveURL(/\/requisitions\/[0-9a-f-]{36}$/);
    await expect(page.getByText('รออนุมัติ').first()).toBeVisible();
    const prId = page.url().split('/').pop()!;
    const heading = await page.getByRole('main').getByRole('heading', { level: 1 }).innerText();
    const number = heading.match(/PR\d{4}-\d{4}/)![0];

    const pr = await api<{ budget_level: string }>(request, token, 'get', `/procurement/requisitions/${prId}`);
    expect(pr.budget_level).toBe('over');

    // The approver sees the warning and can't tick it for bulk approval.
    await page.goto('/approvals?tab=mine');
    const card = page.getByTestId('approval-card').filter({ hasText: number });
    await expect(card.getByTestId('budget-warning')).toContainText('เกินงบ BOQ');
    await expect(card.getByRole('checkbox')).toBeDisabled();

    // The server refuses it in a bulk decision as well.
    const queue = await api<{ items: { instance_id: string; target_id: string }[] }>(
      request, token, 'get', '/approval-routes/queue?tab=mine&target_kind=purchase_requisition',
    );
    const mine = queue.items.find((i) => i.target_id === prId)!;
    // The same id twice makes it a bulk call without touching anyone else's documents.
    const res = await api<{ results: { ok: boolean; error?: unknown }[] }>(
      request, token, 'post', '/approval-routes/queue/decide',
      { instance_ids: [mine.instance_id, mine.instance_id], decision: 'approved' },
    );
    expect(res.results.map((r) => r.ok)).toEqual([false, false]);
    expect(JSON.stringify(res.results[0]!.error)).toContain('over_budget');

    // Clean up: reject it so it doesn't count as pending in later runs.
    await api(request, token, 'post', '/approval-routes/queue/decide', {
      instance_ids: [mine.instance_id], decision: 'rejected', comment: 'E2E cleanup',
    });
    expect(watch.errors, watch.errors.join('\n')).toEqual([]);
  });
});

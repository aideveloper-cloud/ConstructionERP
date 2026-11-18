// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  payments: [] as Record<string, unknown>[],
  posted: [] as { url: string; body?: Record<string, unknown> }[],
}));

vi.mock('@/shared/lib/api', () => ({
  apiGet: vi.fn(() => Promise.resolve({ items: api.payments })),
  apiPost: vi.fn((url: string, body?: Record<string, unknown>) => {
    api.posted.push({ url, body });
    return Promise.resolve({});
  }),
}));

import { apiGet } from '@/shared/lib/api';
import { remainingSettlement, settleAndMarkPaid } from '../markInvoicePaid';

beforeEach(() => {
  api.payments = [];
  api.posted.length = 0;
});

describe('remainingSettlement', () => {
  it('subtracts cash and withholding already recorded, and adds refunds back', () => {
    const left = remainingSettlement({ id: 'i', amount_total: '1000.00' }, [
      { amount: '300.00', withholding_amount: '50.00' },
      { amount: '100.00', is_refund: true },
    ]);
    expect(left).toEqual({ gross: 750, cash: 750, withheld: 0 });
  });

  it('holds back only the retainage not withheld yet', () => {
    const left = remainingSettlement({ id: 'i', amount_total: '1000', retention_amount: '100' }, [
      { amount: '460', withholding_amount: '40' },
    ]);
    expect(left).toEqual({ gross: 500, cash: 440, withheld: 60 });
  });
});

describe('settleAndMarkPaid', () => {
  it('records the open balance with a stable key before moving the status', async () => {
    await settleAndMarkPaid({ id: 'inv-1', amount_total: '1210.00', currency_code: 'EUR' }, '2026-09-25');
    expect(api.posted.map((p) => p.url)).toEqual([
      '/v1/finance/invoices/inv-1/record-payment/',
      '/v1/finance/inv-1/pay/',
    ]);
    expect(api.posted[0]?.body).toEqual({
      payment_date: '2026-09-25',
      amount: '1210.00',
      withholding_amount: '0.00',
      currency_code: 'EUR',
      idempotency_key: 'markpaid:inv-1',
    });
  });

  it('records nothing more for an invoice already paid in full', async () => {
    api.payments = [{ amount: '1210.00' }];
    await settleAndMarkPaid({ id: 'inv-1', amount_total: '1210.00', currency_code: 'EUR' }, '2026-09-25');
    expect(api.posted.map((p) => p.url)).toEqual(['/v1/finance/inv-1/pay/']);
  });

  it('reads every page of earlier payments before working out what is open', async () => {
    const first = Array.from({ length: 100 }, () => ({ amount: '10.00' }));
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ items: first, total: 101, offset: 0, limit: 100 })
      .mockResolvedValueOnce({ items: [{ amount: '10.00' }], total: 101, offset: 100, limit: 100 });
    await settleAndMarkPaid({ id: 'inv-1', amount_total: '1010.00', currency_code: 'EUR' }, '2026-09-25');
    expect(vi.mocked(apiGet).mock.calls.at(-1)?.[0]).toContain('offset=100');
    expect(api.posted.map((p) => p.url)).toEqual(['/v1/finance/inv-1/pay/']);
  });
});
describe('Thai withholding tax (หัก ณ ที่จ่าย)', () => {
  it('counts WHT already deducted as settled', () => {
    const left = remainingSettlement({ id: 'i', amount_total: '37450' }, [{ amount: '18425', wht_amount: '300' }]);
    expect(left).toEqual({ gross: 18725, cash: 18725, withheld: 0 });
  });

  it('pays the supplier the rest and records the WHT on the payment', async () => {
    await settleAndMarkPaid({ id: 'inv-1', amount_total: '37450.00', currency_code: 'THB' }, '2026-11-25', {
      type: 'hire_of_work',
      rate: 3,
      amount: 600,
      certificateNo: 'WHT-6911-0001',
    });
    expect(api.posted[0].body).toMatchObject({
      amount: '36850.00',
      wht_type: 'hire_of_work',
      wht_rate: '3',
      wht_amount: '600.00',
      wht_certificate_no: 'WHT-6911-0001',
    });
    expect(api.posted[1].url).toContain('/pay/');
  });

  it('sends no WHT fields when nothing is withheld', async () => {
    await settleAndMarkPaid({ id: 'inv-2', amount_total: '1000' }, '2026-11-25', null);
    expect(api.posted[0].body).not.toHaveProperty('wht_amount');
    expect(api.posted[0].body).toMatchObject({ amount: '1000.00' });
  });

  it('refuses WHT larger than what is left to pay', async () => {
    await expect(
      settleAndMarkPaid({ id: 'inv-3', amount_total: '100' }, '2026-11-25', { type: 'service', rate: 3, amount: 200 }),
    ).rejects.toThrow(/more than/);
    expect(api.posted).toHaveLength(0);
  });
});

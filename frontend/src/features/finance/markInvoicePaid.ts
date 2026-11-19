// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { apiGet, apiPost, type Page } from '@/shared/lib/api';

/** The slice of an invoice that settling it needs (InvoiceResponse on the wire). */
export interface SettleableInvoice {
  id: string;
  amount_total?: string | number | null;
  amount?: string | number | null;
  retention_amount?: string | number | null;
  currency_code?: string | null;
}

interface PaymentRow {
  amount: string;
  withholding_amount?: string | null;
  /** Thai withholding tax deducted from the payment; it settles the invoice like cash. */
  wht_amount?: string | null;
  is_refund?: boolean;
}

/** Thai withholding tax (หัก ณ ที่จ่าย) deducted from the settling payment. */
export interface PaymentWht {
  type: string;
  rate: number;
  amount: number;
  certificateNo?: string;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What is still to be settled on an invoice, split into cash and retainage.
 *
 * A payment row carries the cash paid and the retainage withheld beside it,
 * and both reduce what is still owed. The retainage still to hold back is the
 * invoice's own retention less what earlier payments already withheld, and it
 * never exceeds what is left.
 */
export function remainingSettlement(
  invoice: SettleableInvoice,
  payments: PaymentRow[],
): { gross: number; cash: number; withheld: number } {
  const total = num(invoice.amount_total ?? invoice.amount);
  let settled = 0;
  let withheldBefore = 0;
  for (const p of payments) {
    const sign = p.is_refund ? -1 : 1;
    settled += sign * (num(p.amount) + num(p.withholding_amount) + num(p.wht_amount));
    if (!p.is_refund) withheldBefore += num(p.withholding_amount);
  }
  const gross = cents(Math.max(0, total - settled));
  const withheld = cents(Math.min(gross, Math.max(0, num(invoice.retention_amount) - withheldBefore)));
  return { gross, cash: cents(gross - withheld), withheld };
}

/**
 * Mark an invoice paid the way the ledger needs it: record the payment for
 * what is still open, then move the status.
 *
 * `/pay/` alone only changes the status. No payment row was written, so the
 * payments list, the cash flow and the statements stayed at zero for every
 * invoice closed with the row button. The payment goes through
 * `record-payment` (which holds back retainage), keyed on the invoice so a
 * second click, or a retry after `/pay/` failed, returns the payment already
 * made instead of paying twice. An invoice already settled in full by earlier
 * payments records nothing more.
 */
export async function settleAndMarkPaid(
  invoice: SettleableInvoice,
  paymentDate: string,
  wht?: PaymentWht | null,
): Promise<void> {
  // Every earlier payment, not the first page of them: a short read would
  // leave part of the invoice looking open and pay it a second time.
  const payments: PaymentRow[] = [];
  for (;;) {
    const page = await apiGet<Page<PaymentRow>>(
      `/v1/finance/payments/?invoice_id=${encodeURIComponent(invoice.id)}&limit=100&offset=${payments.length}`,
    );
    const rows = page?.items ?? [];
    payments.push(...rows);
    if (rows.length === 0 || payments.length >= (page?.total ?? 0)) break;
  }
  const { gross, cash, withheld } = remainingSettlement(invoice, payments);
  if (gross > 0) {
    // WHT goes to the Revenue Department: the supplier is paid the rest.
    const whtAmount = wht && wht.amount > 0 ? cents(wht.amount) : 0;
    if (whtAmount > cash) {
      throw new Error(`Withholding tax ${whtAmount.toFixed(2)} is more than the ${cash.toFixed(2)} left to pay`);
    }
    await apiPost(`/v1/finance/invoices/${encodeURIComponent(invoice.id)}/record-payment/`, {
      payment_date: paymentDate,
      amount: cents(cash - whtAmount).toFixed(2),
      withholding_amount: withheld.toFixed(2),
      currency_code: invoice.currency_code || '',
      idempotency_key: `markpaid:${invoice.id}`,
      ...(whtAmount > 0 && wht
        ? {
            wht_type: wht.type,
            wht_rate: String(wht.rate),
            wht_amount: whtAmount.toFixed(2),
            wht_certificate_no: wht.certificateNo || null,
          }
        : {}),
    });
  }
  await apiPost(`/v1/finance/${encodeURIComponent(invoice.id)}/pay/`);
}

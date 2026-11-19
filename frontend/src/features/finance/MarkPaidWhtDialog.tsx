// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
// Pay a supplier invoice and deduct Thai withholding tax (หัก ณ ที่จ่าย).
//
// The supplier receives the open amount less the WHT; the WHT is recorded on
// the same payment (type, rate, amount, certificate number) so finance can file
// ภ.ง.ด.3 / 53 and the accounting system books it to WHT payable. When the
// invoice was raised from a purchase order with WHT terms, they are the default.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { WideModal, WideModalSection } from '@/shared/ui/WideModal';
import { Button, Input } from '@/shared/ui';
import { apiGet, type Page } from '@/shared/lib/api';
import { WHT_RATES, type WhtType } from '@/app/thai/vat';
import { remainingSettlement, type PaymentWht } from './markInvoicePaid';

export interface WhtPayableInvoice {
  id: string;
  invoice_number: string;
  amount_subtotal?: string | null;
  amount_total?: string | null;
  amount?: number;
  retention_amount?: string | null;
  currency_code?: string | null;
  purchase_order_id?: string | null;
}

interface PoWhtTerms {
  amount_subtotal?: string | null;
  wht_type?: WhtType | null;
  wht_rate?: string | null;
  wht_base?: string | null;
}

const TYPES = Object.keys(WHT_RATES) as WhtType[];

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const cents = (n: number) => Math.round(n * 100) / 100;

export function MarkPaidWhtDialog({
  invoice,
  busy,
  onClose,
  onConfirm,
}: {
  invoice: WhtPayableInvoice | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (paymentDate: string, wht: PaymentWht | null) => void;
}) {
  const { t } = useTranslation();
  const open = invoice !== null;
  const subtotal = num(invoice?.amount_subtotal);
  const total = num(invoice?.amount_total ?? invoice?.amount);

  // What is still open: earlier payments (cash, retainage, WHT) already settled part of it.
  const paid = useQuery({
    queryKey: ['finance', 'payments', 'open-balance', invoice?.id],
    queryFn: () =>
      apiGet<Page<{ amount: string; withholding_amount?: string | null; wht_amount?: string | null; is_refund?: boolean }>>(
        `/v1/finance/payments/?invoice_id=${encodeURIComponent(invoice!.id)}&limit=100`,
      ),
    enabled: open,
  });
  const open_ = invoice ? remainingSettlement(invoice, paid.data?.items ?? []) : { gross: 0, cash: 0, withheld: 0 };

  // WHT terms of the purchase order behind the invoice, when there is one.
  const po = useQuery({
    queryKey: ['procurement', 'po-wht', invoice?.purchase_order_id],
    queryFn: () => apiGet<PoWhtTerms>(`/v1/procurement/${encodeURIComponent(invoice!.purchase_order_id!)}`),
    enabled: open && !!invoice?.purchase_order_id,
  });

  const [date, setDate] = useState('');
  const [type, setType] = useState<WhtType | ''>('');
  const [rate, setRate] = useState('');
  const [base, setBase] = useState('');
  const [amount, setAmount] = useState('');
  const [certificateNo, setCertificateNo] = useState('');

  // Once the person changes a field, a late or refetched PO answer must not overwrite it.
  const [touched, setTouched] = useState(false);

  // Start fresh for each invoice.
  const invoiceId = invoice?.id;
  useEffect(() => {
    if (!invoiceId) return;
    setTouched(false);
    setDate(new Date().toISOString().slice(0, 10));
    setCertificateNo('');
    setType('');
    setRate('');
    setBase(subtotal.toFixed(2));
    setAmount('0.00');
  }, [invoiceId, subtotal]);

  // Default to the PO's WHT terms, pro-rated to this invoice, until the person edits.
  const terms = invoice?.purchase_order_id ? po.data : undefined;
  const termsType = terms?.wht_type ?? null;
  const termsRate = num(terms?.wht_rate);
  const termsBase = num(terms?.wht_base);
  const termsSubtotal = num(terms?.amount_subtotal);
  useEffect(() => {
    if (touched || !termsType || termsRate <= 0) return;
    const share = termsSubtotal > 0 ? subtotal / termsSubtotal : 1;
    const b = cents(termsBase * share);
    setType(termsType);
    setRate(String(termsRate));
    setBase(b.toFixed(2));
    setAmount(cents((b * termsRate) / 100).toFixed(2));
  }, [touched, termsType, termsRate, termsBase, termsSubtotal, subtotal]);

  const pickType = (next: WhtType | '') => {
    setTouched(true);
    setType(next);
    const r = next ? WHT_RATES[next] : 0;
    setRate(next ? String(r) : '');
    setAmount(cents((num(base) * r) / 100).toFixed(2));
  };
  const changeBase = (v: string) => {
    setTouched(true);
    setBase(v);
    setAmount(cents((num(v) * num(rate)) / 100).toFixed(2));
  };
  const changeRate = (v: string) => {
    setTouched(true);
    setRate(v);
    setAmount(cents((num(base) * num(v)) / 100).toFixed(2));
  };

  const whtAmount = type ? cents(num(amount)) : 0;
  const cash = cents(open_.cash - whtAmount);
  const invalid = useMemo(
    () => !date || paid.isLoading || whtAmount < 0 || whtAmount > open_.cash || (type !== '' && whtAmount === 0),
    [date, paid.isLoading, whtAmount, open_.cash, type],
  );
  const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <WideModal
      open={open}
      onClose={onClose}
      busy={busy}
      size="md"
      title={t('finance.wht_pay.title', { defaultValue: 'จ่ายเงินและปิดใบแจ้งหนี้ {{number}}', number: invoice?.invoice_number ?? '' })}
      subtitle={t('th_ui.wht.form_hint')}
      testId="mark-paid-wht-dialog"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel', { defaultValue: 'ยกเลิก' })}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={invalid}
            onClick={() =>
              onConfirm(
                date,
                type ? { type, rate: num(rate), amount: whtAmount, certificateNo: certificateNo.trim() || undefined } : null,
              )
            }
          >
            {t('finance.wht_pay.confirm', { defaultValue: 'บันทึกจ่ายและปิดใบแจ้งหนี้' })}
          </Button>
        </div>
      }
    >
      <WideModalSection title={t('th_ui.wht.label')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="date"
            label={t('finance.wht_pay.date', { defaultValue: 'วันที่จ่าย' })}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-content-secondary">{t('th_ui.wht.label')}</span>
            <select
              className="h-10 rounded-lg border border-border bg-surface-primary px-3"
              value={type}
              onChange={(e) => pickType(e.target.value as WhtType | '')}
              data-testid="wht-type"
            >
              <option value="">{t('th_ui.wht.none')}</option>
              {TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`th_ui.wht.type.${k}`)} {WHT_RATES[k]}%
                </option>
              ))}
            </select>
          </label>
          {type && (
            <>
              <Input
                type="number"
                step="0.01"
                label={t('finance.wht_pay.base', { defaultValue: 'ฐานภาษี (ก่อน VAT)' })}
                value={base}
                onChange={(e) => changeBase(e.target.value)}
              />
              <Input
                type="number"
                step="0.01"
                label={t('th_ui.wht.rate')}
                value={rate}
                onChange={(e) => changeRate(e.target.value)}
              />
              <Input
                type="number"
                step="0.01"
                label={t('finance.wht_pay.amount', { defaultValue: 'ยอดหัก ณ ที่จ่าย' })}
                value={amount}
                onChange={(e) => {
                  setTouched(true);
                  setAmount(e.target.value);
                }}
                data-testid="wht-amount"
              />
              <Input
                label={t('finance.wht_pay.certificate', { defaultValue: 'เลขที่หนังสือรับรองการหักภาษี ณ ที่จ่าย' })}
                value={certificateNo}
                onChange={(e) => setCertificateNo(e.target.value)}
              />
            </>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-content-secondary">{t('finance.wht_pay.total', { defaultValue: 'ยอดตามใบแจ้งหนี้' })}</dt>
          <dd className="text-right tabular-nums">{money(total)}</dd>
          {open_.gross !== total && (
            <>
              <dt className="text-content-secondary">{t('finance.wht_pay.open', { defaultValue: 'คงค้างชำระ' })}</dt>
              <dd className="text-right tabular-nums">{money(open_.gross)}</dd>
            </>
          )}
          {open_.withheld > 0 && (
            <>
              <dt className="text-content-secondary">{t('finance.wht_pay.retention', { defaultValue: 'เงินประกันผลงานที่กันไว้' })}</dt>
              <dd className="text-right tabular-nums">-{money(open_.withheld)}</dd>
            </>
          )}
          <dt className="text-content-secondary">{t('th_ui.wht.label')}</dt>
          <dd className="text-right tabular-nums">-{money(whtAmount)}</dd>
          <dt className="font-semibold">{t('th_ui.wht.net_payable')}</dt>
          <dd className="text-right font-semibold tabular-nums" data-testid="wht-net">
            {money(cash)}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-content-tertiary">
          {t('finance.confirm_pay_msg_immutable', {
            defaultValue: 'This records the payment as an immutable ledger entry and closes the invoice. It cannot be undone.',
          })}
        </p>
      </WideModalSection>
    </WideModal>
  );
}

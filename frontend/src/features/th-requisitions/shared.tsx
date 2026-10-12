/** ใบขอซื้อ — ส่วนที่ใช้ร่วมกันระหว่างหน้ารายการและหน้าเอกสาร */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { RequisitionStatus } from './api';

export const STATUS_TONE: Record<RequisitionStatus, string> = {
  draft: 'bg-surface-secondary text-content-secondary',
  submitted: 'bg-[#fff7e6] text-[#b45309]',
  approved: 'bg-[#e8f8ef] text-[#15803d]',
  rejected: 'bg-[#fef2f2] text-[#dc2626]',
  ordered: 'bg-[#eaf2ff] text-[#2563d9]',
  received: 'bg-[#eaf2ff] text-[#2563d9]',
  consumed: 'bg-surface-secondary text-content-tertiary',
  cancelled: 'bg-surface-secondary text-content-quaternary line-through',
};

export function StatusPill({ status }: { status: RequisitionStatus }) {
  const { t } = useTranslation();
  return (
    <span className={clsx('inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[status])}>
      {t(`th_ui.pr.status.${status}`)}
    </span>
  );
}

export function useFmt() {
  const { i18n } = useTranslation();
  const th = i18n.language.startsWith('th');
  return useMemo(() => {
    const locale = th ? 'th-TH' : 'en-GB';
    const num = (v: string | number | null | undefined, digits = 2) => {
      const n = typeof v === 'number' ? v : Number(v ?? NaN);
      return Number.isFinite(n)
        ? n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
        : '—';
    };
    const qty = (v: string | number | null | undefined) => {
      const n = typeof v === 'number' ? v : Number(v ?? NaN);
      return Number.isFinite(n) ? n.toLocaleString(locale, { maximumFractionDigits: 3 }) : '—';
    };
    const date = (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(th ? 'th-TH-u-ca-buddhist' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    return { num, qty, date, th };
  }, [th]);
}

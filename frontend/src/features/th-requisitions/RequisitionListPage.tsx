/**
 * ใบขอซื้อ (PR) — รายการของโครงการที่เลือกอยู่
 *
 * แท็บตามสถานะ ค้นหาเลขที่/เรื่อง และคอลัมน์ "ใบสั่งซื้อ" บอกว่า PR ไหนออก PO แล้ว
 * (สายเอกสาร PR → PO) กดแถวเพื่อเปิดหน้าเอกสาร
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { Card } from '@/shared/ui';
import { RequiresProject } from '@/shared/auth/RequiresProject';
import { useActiveProjectId } from '@/shared/hooks/useActiveProjectId';
import { useRequisitions, type Requisition } from './api';
import { StatusPill, useFmt } from './shared';

type Filter = 'all' | 'draft' | 'submitted' | 'approved' | 'ordered' | 'rejected';
const FILTERS: Filter[] = ['all', 'draft', 'submitted', 'approved', 'ordered', 'rejected'];

export function RequisitionListPage() {
  return (
    <RequiresProject>
      <RequisitionList />
    </RequiresProject>
  );
}

function RequisitionList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fmt = useFmt();
  const projectId = useActiveProjectId();
  const { data, isLoading, isError, refetch } = useRequisitions(projectId);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const all = data?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, draft: 0, submitted: 0, approved: 0, ordered: 0, rejected: 0 };
    for (const r of all) if (r.status in c) c[r.status as Filter] += 1;
    return c;
  }, [all]);
  const rows = all.filter((r: Requisition) => {
    if (filter !== 'all' && r.status !== filter) return false;
    const needle = q.trim().toLowerCase();
    return !needle || `${r.req_number ?? ''} ${r.title ?? ''} ${r.requester_name ?? ''}`.toLowerCase().includes(needle);
  });

  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[1.1px] text-oe-blue">Purchase Requisition</div>
          <h1 className="mb-1 mt-1 text-[25px] font-bold tracking-tight text-content-primary">
            {t('th_ui.pr.title', { defaultValue: 'ใบขอซื้อ (PR)' })}
          </h1>
          <p className="text-xs text-content-quaternary">
            {t('th_ui.pr.subtitle', {
              defaultValue: 'ขอซื้อวัสดุจากรายการ BOQ หรือนอก BOQ ส่งอนุมัติ แล้วจัดซื้อออกใบสั่งซื้อต่อได้ทันที',
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/procurement"
            className="rounded-lg border border-border-light bg-surface-primary px-3.5 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-secondary"
          >
            {t('th_ui.pr.to_po_list', { defaultValue: 'ใบสั่งซื้อ (PO)' })}
          </Link>
          <Link
            to="/requisitions/new"
            className="inline-flex items-center gap-1 rounded-lg bg-oe-blue px-3.5 py-2 text-xs font-semibold text-white shadow-[0_3px_9px_#3278f626] hover:bg-oe-blue-hover"
          >
            <Plus size={14} />
            {t('th_ui.pr.new', { defaultValue: 'สร้างใบขอซื้อ' })}
          </Link>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold',
                filter === f ? 'bg-oe-blue text-white' : 'bg-surface-primary text-content-secondary hover:bg-surface-secondary',
              )}
            >
              {f === 'all' ? t('th_ui.pr.filter_all', { defaultValue: 'ทั้งหมด' }) : t(`th_ui.pr.status.${f}`)}
              <span className={clsx('tabular-nums', filter === f ? 'text-white/80' : 'text-content-quaternary')}>{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="relative w-full sm:w-[280px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-quaternary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('th_ui.pr.search', { defaultValue: 'ค้นหาเลขที่ เรื่อง ผู้ขอ…' })}
            className="h-9 w-full rounded-lg border border-border-light bg-surface-primary pl-8 pr-3 text-xs"
          />
        </label>
      </div>

      <Card padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border-light bg-surface-secondary/60 text-left text-[11px] font-semibold text-content-tertiary">
                <th className="px-4 py-2.5">{t('th_ui.pr.col_number', { defaultValue: 'เลขที่' })}</th>
                <th className="px-4 py-2.5">{t('th_ui.pr.col_title', { defaultValue: 'เรื่อง' })}</th>
                <th className="px-4 py-2.5">{t('th_ui.pr.col_requester', { defaultValue: 'ผู้ขอ' })}</th>
                <th className="px-4 py-2.5">{t('th_ui.pr.col_needed', { defaultValue: 'วันที่ต้องการ' })}</th>
                <th className="px-4 py-2.5 text-right">{t('th_ui.pr.col_total', { defaultValue: 'ยอดประมาณ' })}</th>
                <th className="px-4 py-2.5">{t('th_ui.pr.col_status', { defaultValue: 'สถานะ' })}</th>
                <th className="px-4 py-2.5">{t('th_ui.pr.col_po', { defaultValue: 'ใบสั่งซื้อ' })}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [0, 1, 2].map((n) => (
                  <tr key={n} className="border-b border-border-light">
                    <td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-surface-secondary" /></td>
                  </tr>
                ))
              ) : isError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-content-secondary">
                    {t('th_ui.pr.load_failed', { defaultValue: 'โหลดรายการไม่สำเร็จ' })}{' '}
                    <button type="button" onClick={() => refetch()} className="font-semibold text-oe-blue hover:underline">
                      {t('th_ui.approvals.retry', { defaultValue: 'ลองอีกครั้ง' })}
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    <ClipboardList size={28} className="mx-auto mb-2 text-content-quaternary" />
                    <p className="text-sm text-content-secondary">
                      {all.length === 0
                        ? t('th_ui.pr.empty', { defaultValue: 'ยังไม่มีใบขอซื้อในโครงการนี้' })
                        : t('th_ui.pr.empty_filter', { defaultValue: 'ไม่มีใบขอซื้อที่ตรงกับตัวกรอง' })}
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/requisitions/${r.id}`)}
                    className="cursor-pointer border-b border-border-light last:border-0 hover:bg-surface-secondary/40"
                  >
                    <td className="px-4 py-2.5 font-mono text-[12.5px] font-semibold text-oe-blue">{r.req_number}</td>
                    <td className="max-w-[320px] truncate px-4 py-2.5 text-content-primary">{r.title}</td>
                    <td className="px-4 py-2.5 text-content-secondary">{r.requester_name ?? '—'}</td>
                    <td className="px-4 py-2.5 tabular-nums text-content-secondary">{fmt.date(r.required_date)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt.num(r.total)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusPill status={r.status} />
                        {(r.budget_level === 'over' || r.budget_level === 'warning') && (
                          <span
                            title={t(`th_ui.budget.level.${r.budget_level}`)}
                            className={clsx(
                              'rounded px-1.5 py-px text-[10px] font-semibold',
                              r.budget_level === 'over' ? 'bg-[#fef2f2] text-[#dc2626]' : 'bg-[#fff7e6] text-[#b45309]',
                            )}
                          >
                            {t(`th_ui.budget.level.${r.budget_level}`)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.po ? (
                        <Link
                          to={`/procurement?po=${r.po.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[12px] font-semibold text-oe-blue hover:underline"
                        >
                          {r.po.po_number}
                        </Link>
                      ) : (
                        <span className="text-content-quaternary">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

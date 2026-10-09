/**
 * ศูนย์อนุมัติ (ฉบับไทย) — แบบ Mango Approve
 *
 * คิวเดียวของทุกเอกสารที่ต้องอนุมัติ (PO, VO, งวดงาน, ใบแจ้งหนี้ ...) จาก engine
 * approval_routes เดิม: เห็นเลขที่/ยอดเงิน/โครงการ/ผู้ส่ง/สายอนุมัติในการ์ดเดียว
 * อนุมัติได้จากรายการเลย เลือกหลายใบอนุมัติพร้อมกันได้ ไม่อนุมัติต้องระบุเหตุผล
 * ขั้นที่ยอดเงินไม่ถึงวงเงิน (min_amount) แสดงเป็น "ข้าม"
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Inbox,
  Search,
  Settings2,
  SkipForward,
  X,
  XCircle,
} from 'lucide-react';
import { Card } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { normalizeRole } from '@/shared/lib/roles';
import {
  APPROVAL_TABS,
  useApprovalQueue,
  useDecide,
  type ApprovalItem,
  type ApprovalTab,
  type ChainStep,
} from './api';

/* ── formatting ─────────────────────────────────────────────────────────── */

function useFmt() {
  const { i18n } = useTranslation();
  const th = i18n.language.startsWith('th');
  return useMemo(() => {
    const locale = th ? 'th-TH' : 'en-GB';
    const money = (v: string | null, currency: string | null) => {
      const n = v == null ? NaN : Number(v);
      if (!Number.isFinite(n)) return '—';
      const s = n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (!currency || currency === 'THB') return th ? `${s} บาท` : `฿${s}`;
      return `${s} ${currency}`;
    };
    const date = (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(th ? 'th-TH-u-ca-buddhist' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    const dateTime = (iso: string | null | undefined) => {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleString(th ? 'th-TH-u-ca-buddhist' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    };
    return { money, date, dateTime };
  }, [th]);
}

function useLabels() {
  const { t } = useTranslation();
  return useMemo(() => {
    const kind = (k: string) => t(`th_ui.approvals.kind.${k}`, { defaultValue: k });
    const kindShort = (k: string) => t(`th_ui.approvals.kind_short.${k}`, { defaultValue: k.toUpperCase() });
    const role = (r: string | null) => (r ? t(`th_ui.approvals.role.${r}`, { defaultValue: r }) : '');
    const approver = (s: ChainStep) => s.approver_name || role(s.approver_role);
    const waited = (hours: number) =>
      hours < 1
        ? t('th_ui.approvals.waited_minutes', { defaultValue: 'เพิ่งส่ง' })
        : hours < 24
          ? t('th_ui.approvals.waited_hours', { defaultValue: 'รอ {{n}} ชม.', n: Math.floor(hours) })
          : t('th_ui.approvals.waited_days', { defaultValue: 'รอ {{n}} วัน', n: Math.floor(hours / 24) });
    return { kind, kindShort, role, approver, waited };
  }, [t]);
}

const KIND_TONE: Record<string, string> = {
  purchase_order: 'bg-[#eaf2ff] text-[#2563d9]',
  change_order: 'bg-[#fff4e5] text-[#b45309]',
  progress_claim: 'bg-[#e8f8ef] text-[#15803d]',
  invoice: 'bg-[#f3ecff] text-[#7c3aed]',
  contract: 'bg-[#eef2f7] text-[#334155]',
};

const QUICK_REASONS = ['price', 'incomplete', 'budget', 'revise'] as const;

/* ── page ───────────────────────────────────────────────────────────────── */

export function ApprovalCenterPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (APPROVAL_TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as ApprovalTab) : 'mine';
  const [kind, setKind] = useState('');
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const { data, isLoading, isError, refetch } = useApprovalQueue({ tab, targetKind: kind, projectId, q: debouncedQ });
  const items = data?.items ?? [];
  const counts = data?.counts;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [tab, kind, projectId, debouncedQ]);
  const selectable = items.filter((i) => i.can_decide);
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.instance_id));

  const [dialog, setDialog] = useState<{ decision: 'approved' | 'rejected'; items: ApprovalItem[] } | null>(null);

  // Filter options come from what the queue already holds, so a filter never
  // offers a value that matches nothing.
  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.project?.id) m.set(i.project.id, i.project.name ?? i.project.id);
    if (projectId && !m.has(projectId)) m.set(projectId, projectId);
    return [...m.entries()];
  }, [items, projectId]);
  const labels = useLabels();
  const kindOptions = ['purchase_order', 'change_order', 'progress_claim', 'invoice', 'contract'];
  const isAdmin = normalizeRole(useAuthStore((s) => s.userRole)) === 'admin';

  const setTab = (next: ApprovalTab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[1.1px] text-oe-blue">Approval Center</div>
          <h1 className="mb-1 mt-1 text-[25px] font-bold tracking-tight text-content-primary">
            {t('th_ui.approvals.title', { defaultValue: 'ศูนย์อนุมัติ' })}
          </h1>
          <p className="text-xs text-content-quaternary">
            {t('th_ui.approvals.subtitle', {
              defaultValue: 'เอกสารทุกชนิดที่ต้องอนุมัติอยู่ที่นี่ เรียงจากรอนานที่สุด อนุมัติได้จากรายการเลย',
            })}
          </p>
        </div>
        {isAdmin && (
          <Link
            to="/approval-routes"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-light bg-surface-primary px-3.5 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-secondary"
          >
            <Settings2 size={14} />
            {t('th_ui.approvals.settings_link', { defaultValue: 'ตั้งค่าสายอนุมัติและวงเงิน' })}
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-3 flex flex-wrap gap-1 border-b border-border-light">
        {APPROVAL_TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={clsx(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors',
              tab === name
                ? 'border-oe-blue text-oe-blue'
                : 'border-transparent text-content-tertiary hover:text-content-primary',
            )}
          >
            {t(`th_ui.approvals.tab.${name}`)}
            {counts && (
              <span
                className={clsx(
                  'min-w-[20px] rounded-full px-1.5 py-px text-center text-[10.5px] font-bold tabular-nums',
                  name === 'mine' && counts.mine > 0
                    ? 'bg-[#ef4444] text-white'
                    : 'bg-surface-secondary text-content-tertiary',
                )}
              >
                {counts[name]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="h-9 rounded-lg border border-border-light bg-surface-primary px-2.5 text-xs text-content-secondary"
          aria-label={t('th_ui.approvals.filter_kind', { defaultValue: 'ชนิดเอกสาร' })}
        >
          <option value="">{t('th_ui.approvals.all_kinds', { defaultValue: 'ทุกชนิดเอกสาร' })}</option>
          {kindOptions.map((k) => (
            <option key={k} value={k}>{labels.kind(k)}</option>
          ))}
        </select>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-9 max-w-[260px] rounded-lg border border-border-light bg-surface-primary px-2.5 text-xs text-content-secondary"
          aria-label={t('th_ui.approvals.filter_project', { defaultValue: 'โครงการ' })}
        >
          <option value="">{t('th_ui.approvals.all_projects', { defaultValue: 'ทุกโครงการ' })}</option>
          {projectOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <label className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-quaternary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('th_ui.approvals.search', { defaultValue: 'ค้นหาเลขที่เอกสาร ชื่อเรื่อง…' })}
            className="h-9 w-full rounded-lg border border-border-light bg-surface-primary pl-8 pr-3 text-xs text-content-primary placeholder:text-content-quaternary"
          />
        </label>
      </div>

      {/* Bulk bar */}
      {tab === 'mine' && selectable.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-light bg-surface-primary px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-content-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--oe-blue)]"
              checked={allSelected}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(selectable.map((i) => i.instance_id)) : new Set())
              }
            />
            {selected.size > 0
              ? t('th_ui.approvals.selected', { defaultValue: 'เลือกแล้ว {{n}} รายการ', n: selected.size })
              : t('th_ui.approvals.select_all', { defaultValue: 'เลือกทั้งหมด' })}
          </label>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() =>
              setDialog({ decision: 'approved', items: items.filter((i) => selected.has(i.instance_id)) })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#16a34a] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={14} />
            {t('th_ui.approvals.approve_selected', { defaultValue: 'อนุมัติที่เลือก ({{n}})', n: selected.size })}
          </button>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-[132px] animate-pulse rounded-xl border border-border-light bg-surface-primary" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-8 text-center text-sm text-content-secondary">
          {t('th_ui.approvals.load_failed', { defaultValue: 'โหลดรายการไม่สำเร็จ' })}{' '}
          <button type="button" onClick={() => refetch()} className="font-semibold text-oe-blue hover:underline">
            {t('th_ui.approvals.retry', { defaultValue: 'ลองอีกครั้ง' })}
          </button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#e8f8ef] text-[#16a34a]">
            {tab === 'mine' ? <CheckCircle2 size={22} /> : <Inbox size={22} />}
          </span>
          <p className="text-sm font-semibold text-content-primary">{t(`th_ui.approvals.empty.${tab}`)}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ApprovalCard
              key={item.instance_id}
              item={item}
              tab={tab}
              selected={selected.has(item.instance_id)}
              onSelect={(on) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(item.instance_id);
                  else next.delete(item.instance_id);
                  return next;
                })
              }
              onDecide={(decision) => setDialog({ decision, items: [item] })}
            />
          ))}
        </div>
      )}

      {dialog && (
        <DecisionDialog
          decision={dialog.decision}
          items={dialog.items}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

/* ── card ───────────────────────────────────────────────────────────────── */

function ApprovalCard({
  item,
  tab,
  selected,
  onSelect,
  onDecide,
}: {
  item: ApprovalItem;
  tab: ApprovalTab;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onDecide: (decision: 'approved' | 'rejected') => void;
}) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const labels = useLabels();
  const [open, setOpen] = useState(false);
  const target = item.target;
  const sla = item.current_step?.sla_hours ?? null;
  const overdue = item.status === 'pending' && sla != null && item.waiting_hours > sla;

  return (
    <Card padding="none" className={clsx('overflow-hidden', selected && 'ring-2 ring-oe-blue/40')}>
      <div className="flex gap-3 px-4 pb-3 pt-3.5 sm:px-5">
        {tab === 'mine' && (
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--oe-blue)]"
            checked={selected}
            disabled={!item.can_decide}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={target?.code ?? item.target_id}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className={clsx(
                  'rounded-md px-2 py-0.5 text-[10.5px] font-bold',
                  KIND_TONE[item.target_kind] ?? 'bg-surface-secondary text-content-secondary',
                )}
                title={labels.kind(item.target_kind)}
              >
                {labels.kindShort(item.target_kind)}
              </span>
              <span className="font-mono text-[13px] font-semibold text-content-primary">
                {target?.code ?? item.target_id.slice(0, 8)}
              </span>
              <span className="text-[11.5px] text-content-quaternary">{fmt.date(target?.doc_date ?? item.started_at)}</span>
              <StatusPill item={item} />
            </div>
            <div className="text-right text-[17px] font-bold tabular-nums text-content-primary">
              {fmt.money(item.amount, item.currency)}
            </div>
          </div>

          {target?.title && <p className="mt-1 line-clamp-1 text-[13px] text-content-secondary">{target.title}</p>}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-content-tertiary">
            {item.project?.name && <span className="max-w-[320px] truncate">{item.project.name}</span>}
            {item.requester.name && (
              <span>
                {t('th_ui.approvals.requester', { defaultValue: 'ผู้ส่ง' })}: {item.requester.name}
              </span>
            )}
            {item.status === 'pending' && (
              <span className={clsx('inline-flex items-center gap-1', overdue && 'font-semibold text-[#dc2626]')}>
                <Clock size={12} />
                {labels.waited(item.waiting_hours)}
                {overdue && ` · ${t('th_ui.approvals.overdue', { defaultValue: 'เกินกำหนด' })}`}
              </span>
            )}
          </div>

          {/* Compact chain */}
          <ChainStrip item={item} />

          {item.rejection && (
            <div className="mt-2.5 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs text-[#991b1b]">
              <span className="font-semibold">{t('th_ui.approvals.reject_reason', { defaultValue: 'เหตุผลที่ไม่อนุมัติ' })}:</span>{' '}
              {item.rejection.comment}
              {item.rejection.by_name && <span className="text-[#b91c1c]/70"> — {item.rejection.by_name}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-light bg-surface-secondary/50 px-4 py-2 sm:px-5">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-primary"
          >
            <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} />
            {t('th_ui.approvals.chain', { defaultValue: 'สายอนุมัติ' })}
          </button>
          {target?.url && (
            <Link
              to={target.url}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-primary"
            >
              <ExternalLink size={13} />
              {t('th_ui.approvals.open_doc', { defaultValue: 'ดูเอกสาร' })}
            </Link>
          )}
        </div>
        {item.can_decide && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDecide('rejected')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#fecaca] bg-surface-primary px-3 py-1.5 text-xs font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
            >
              <X size={14} />
              {t('th_ui.approvals.reject', { defaultValue: 'ไม่อนุมัติ' })}
            </button>
            <button
              type="button"
              onClick={() => onDecide('approved')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#16a34a] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#15803d]"
            >
              <Check size={14} />
              {t('th_ui.approvals.approve', { defaultValue: 'อนุมัติ' })}
            </button>
          </div>
        )}
      </div>

      {open && <ChainTimeline item={item} />}
    </Card>
  );
}

function StatusPill({ item }: { item: ApprovalItem }) {
  const { t } = useTranslation();
  if (item.status === 'pending') {
    return (
      <span className="rounded-full bg-[#fff7e6] px-2 py-0.5 text-[10.5px] font-semibold text-[#b45309]">
        {t('th_ui.approvals.step_of', {
          defaultValue: 'ขั้น {{n}}/{{total}}',
          n: item.position ?? '?',
          total: item.step_count,
        })}
      </span>
    );
  }
  const tone =
    item.status === 'approved'
      ? 'bg-[#e8f8ef] text-[#15803d]'
      : item.status === 'rejected'
        ? 'bg-[#fef2f2] text-[#dc2626]'
        : 'bg-surface-secondary text-content-tertiary';
  return (
    <span className={clsx('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', tone)}>
      {t(`th_ui.approvals.status.${item.status}`)}
    </span>
  );
}

function ChainStrip({ item }: { item: ApprovalItem }) {
  const labels = useLabels();
  return (
    <ol className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {item.chain.map((s, n) => (
        <li key={s.step_id} className="flex items-center gap-1.5">
          {n > 0 && <span className="h-px w-3 bg-border-medium" aria-hidden />}
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
              s.state === 'approved' && 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]',
              s.state === 'rejected' && 'border-[#fecaca] bg-[#fef2f2] text-[#dc2626]',
              s.state === 'current' && 'border-oe-blue/40 bg-oe-blue-subtle font-semibold text-oe-blue',
              s.state === 'waiting' && 'border-border-light text-content-tertiary',
              s.state === 'skipped' && 'border-dashed border-border-light text-content-quaternary line-through',
            )}
          >
            {s.state === 'approved' && <CheckCircle2 size={12} />}
            {s.state === 'rejected' && <XCircle size={12} />}
            {s.state === 'current' && <Clock size={12} />}
            {s.state === 'skipped' && <SkipForward size={12} />}
            {labels.approver(s)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ChainTimeline({ item }: { item: ApprovalItem }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const labels = useLabels();
  return (
    <div className="border-t border-border-light px-5 py-4">
      <div className="mb-3 text-[11px] font-semibold text-content-tertiary">
        {item.route?.name}
      </div>
      <ol className="relative space-y-4 border-s border-border-light ps-5">
        {item.chain.map((s) => (
          <li key={s.step_id} className="relative">
            <span
              className={clsx(
                'absolute -start-[27px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full ring-4 ring-surface-elevated',
                s.state === 'approved' && 'bg-[#16a34a]',
                s.state === 'rejected' && 'bg-[#dc2626]',
                s.state === 'current' && 'bg-oe-blue',
                (s.state === 'waiting' || s.state === 'skipped') && 'bg-border-medium',
              )}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
              <span className="font-semibold text-content-primary">
                {t('th_ui.approvals.step_n', { defaultValue: 'ขั้นที่ {{n}}', n: s.ordinal })} · {labels.approver(s)}
              </span>
              {s.min_amount && (
                <span className="text-[11px] text-content-quaternary">
                  {t('th_ui.approvals.min_amount', {
                    defaultValue: 'เมื่อยอดตั้งแต่ {{amount}}',
                    amount: fmt.money(s.min_amount, item.currency),
                  })}
                </span>
              )}
              <span className="text-[11px] text-content-tertiary">{t(`th_ui.approvals.chain_state.${s.state}`)}</span>
            </div>
            {s.decisions.map((d, n) => (
              <div key={n} className="mt-1 text-xs text-content-secondary">
                <span className={d.decision === 'approved' ? 'text-[#15803d]' : 'text-[#dc2626]'}>
                  {t(`th_ui.approvals.status.${d.decision}`)}
                </span>
                {d.by_name && ` · ${d.by_name}`}
                {d.at && <span className="text-content-quaternary"> · {fmt.dateTime(d.at)}</span>}
                {d.comment && <div className="mt-0.5 rounded-md bg-surface-secondary px-2 py-1 text-content-secondary">{d.comment}</div>}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── decision dialog ────────────────────────────────────────────────────── */

function DecisionDialog({
  decision,
  items,
  onClose,
  onDone,
}: {
  decision: 'approved' | 'rejected';
  items: ApprovalItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const addToast = useToastStore((s) => s.addToast);
  const decide = useDecide();
  const [comment, setComment] = useState('');
  const reject = decision === 'rejected';
  const needsReason = reject && !comment.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // One currency → show the sum; mixed currencies → show the count only.
  const currencies = new Set(items.map((i) => i.currency ?? ''));
  const total = currencies.size === 1 ? items.reduce((a, i) => a + (Number(i.amount) || 0), 0) : null;

  const submit = () => {
    decide.mutate(
      { instance_ids: items.map((i) => i.instance_id), decision, comment: comment.trim() || undefined },
      {
        onSuccess: (res) => {
          if (res.failed === 0) {
            addToast({
              type: 'success',
              title: reject
                ? t('th_ui.approvals.toast_rejected', { defaultValue: 'ส่งกลับแล้ว {{n}} รายการ', n: res.ok })
                : t('th_ui.approvals.toast_approved', { defaultValue: 'อนุมัติแล้ว {{n}} รายการ', n: res.ok }),
            });
          } else {
            addToast({
              type: 'warning',
              title: t('th_ui.approvals.toast_partial', {
                defaultValue: 'สำเร็จ {{ok}} รายการ ไม่สำเร็จ {{failed}} รายการ',
                ok: res.ok,
                failed: res.failed,
              }),
              message: t('th_ui.approvals.toast_partial_hint', {
                defaultValue: 'บางรายการอาจถูกอนุมัติไปแล้วหรือไม่ใช่ขั้นของคุณ',
              }),
            });
          }
          onDone();
        },
        onError: (err) => {
          addToast({
            type: 'error',
            title: t('th_ui.approvals.toast_failed', { defaultValue: 'บันทึกไม่สำเร็จ' }),
            message: err instanceof Error ? err.message : undefined,
          });
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[480px] rounded-2xl bg-surface-elevated p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-content-primary">
          {reject
            ? t('th_ui.approvals.dialog_reject_title', { defaultValue: 'ไม่อนุมัติเอกสาร' })
            : t('th_ui.approvals.dialog_approve_title', { defaultValue: 'ยืนยันการอนุมัติ' })}
        </h2>
        <div className="mt-3 max-h-[160px] space-y-1 overflow-y-auto rounded-lg bg-surface-secondary px-3 py-2">
          {items.map((i) => (
            <div key={i.instance_id} className="flex justify-between gap-3 text-xs">
              <span className="truncate font-mono text-content-secondary">{i.target?.code ?? i.target_id.slice(0, 8)}</span>
              <span className="shrink-0 tabular-nums text-content-primary">{fmt.money(i.amount, i.currency)}</span>
            </div>
          ))}
        </div>
        {items.length > 1 && (
          <p className="mt-2 text-right text-xs text-content-tertiary">
            {t('th_ui.approvals.dialog_total', { defaultValue: '{{n}} รายการ', n: items.length })}
            {total != null && ` · ${fmt.money(String(total), items[0]?.currency ?? null)}`}
          </p>
        )}

        <label className="mt-4 block text-xs font-semibold text-content-secondary">
          {reject
            ? t('th_ui.approvals.reason_label', { defaultValue: 'เหตุผลที่ไม่อนุมัติ (จำเป็น)' })
            : t('th_ui.approvals.comment_label', { defaultValue: 'ความเห็น (ไม่บังคับ)' })}
        </label>
        {reject && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((r) => {
              const text = t(`th_ui.approvals.quick_reason.${r}`);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setComment((c) => (c.trim() ? `${c.trim()} ${text}` : text))}
                  className="rounded-full border border-border-light px-2.5 py-1 text-[11px] text-content-secondary hover:bg-surface-secondary"
                >
                  {text}
                </button>
              );
            })}
          </div>
        )}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          autoFocus={reject}
          maxLength={2000}
          className="mt-2 w-full resize-none rounded-lg border border-border-light bg-surface-primary p-2.5 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/30"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-light px-3.5 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-secondary"
          >
            {t('th_ui.approvals.cancel', { defaultValue: 'ยกเลิก' })}
          </button>
          <button
            type="button"
            disabled={needsReason || decide.isPending}
            onClick={submit}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40',
              reject ? 'bg-[#dc2626] hover:bg-[#b91c1c]' : 'bg-[#16a34a] hover:bg-[#15803d]',
            )}
          >
            {reject ? <X size={14} /> : <Check size={14} />}
            {reject
              ? t('th_ui.approvals.confirm_reject', { defaultValue: 'ไม่อนุมัติและส่งกลับ' })
              : t('th_ui.approvals.confirm_approve', { defaultValue: 'อนุมัติ' })}
          </button>
        </div>
      </div>
    </div>
  );
}

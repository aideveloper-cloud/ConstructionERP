/**
 * ภาพรวมธุรกิจ (ฉบับไทย) — แทนแดชบอร์ด 28 widget เดิม
 *
 * ใช้ข้อมูลจริงจาก API ที่มีอยู่แล้วทั้งหมด:
 *   - GET /v1/projects/           → การ์ด KPI + ตารางโครงการ + สถานะ
 *   - GET /v1/dashboard/rollup/   → มูลค่า BOQ, โครงการเกินงบ, จัดซื้อ, งานเพิ่ม-ลด
 *   - GET /v1/dashboard/inbox/    → รายการที่ต้องดำเนินการ / รออนุมัติ
 * แดชบอร์ดเดิมยังเปิดได้ที่ /dashboard/classic
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  Plus,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { projectsApi, type Project } from '@/features/projects/api';
import { useDashboardRollup } from '@/features/dashboard/hooks/useDashboardRollup';
import { useInboxQuery } from '@/features/inbox/useInbox';
import type { InboxItem } from '@/features/inbox/api';
import { useAuthStore } from '@/stores/useAuthStore';

/** ฟิลด์ที่ API ส่งมาแต่ type เดิมของ frontend ยังไม่ได้ประกาศ */
type ProjectRow = Project & {
  project_code?: string | null;
  contract_value?: string | null;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
};

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
};

function useFormatters(lang: string) {
  return useMemo(() => {
    const locale = lang.startsWith('th') ? 'th-TH' : 'en-GB';
    const money = (v: number) => v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const short = (v: number) => {
      const a = Math.abs(v);
      if (a >= 1e6) return `${(v / 1e6).toLocaleString(locale, { maximumFractionDigits: 2 })}M`;
      if (a >= 1e3) return `${(v / 1e3).toLocaleString(locale, { maximumFractionDigits: 1 })}K`;
      return v.toLocaleString(locale, { maximumFractionDigits: 0 });
    };
    const date = (iso?: string | null) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleDateString(lang.startsWith('th') ? 'th-TH-u-ca-buddhist' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    return { money, short, date };
  }, [lang]);
}

/** ความคืบหน้าตามเวลา (ระยะเวลาที่ผ่านไปเทียบแผน) — ใช้จนกว่าจะเชื่อมผลงานจริงจากแผนงาน */
function elapsedPct(p: ProjectRow): number | null {
  if (!p.planned_start_date || !p.planned_end_date) return null;
  const s = Date.parse(p.planned_start_date);
  const e = Date.parse(p.planned_end_date);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - s) / (e - s)) * 100)));
}

const STATUS_STYLE: Record<string, { cls: string; color: string }> = {
  active: { cls: 'bg-[#e3f7ee] text-[#118259]', color: '#1fa978' },
  planning: { cls: 'bg-[#e9f1ff] text-[#2868d7]', color: '#347df6' },
  on_hold: { cls: 'bg-[#fff4dc] text-[#9b6a12]', color: '#f2bc4b' },
  completed: { cls: 'bg-[#eef1f5] text-[#5b6c83]', color: '#96a6bf' },
  archived: { cls: 'bg-[#eef1f5] text-[#5b6c83]', color: '#c3ccd8' },
};
const statusStyle = (s: string) => STATUS_STYLE[s] ?? { cls: 'bg-[#eef1f5] text-[#5b6c83]', color: '#c3ccd8' };

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={clsx('min-w-0 rounded-xl border border-border-light bg-surface-primary shadow-[0_4px_18px_#15294b08]', className)}>
      {children}
    </div>
  );
}

function CardHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-[18px] pb-3 pt-4">
      <div>
        <h2 className="m-0 text-sm font-semibold text-content-primary">{title}</h2>
        {sub && <p className="m-0 mt-0.5 text-[11px] text-content-quaternary">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Kpi({ label, value, foot, icon, tone }: { label: string; value: string; foot: React.ReactNode; icon: React.ReactNode; tone: string }) {
  return (
    <Card className="px-[18px] py-4">
      <div className="flex items-center justify-between gap-2 text-xs text-content-quaternary">
        {label}
        <span className={clsx('grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px]', tone)}>{icon}</span>
      </div>
      <div className="mb-1 mt-2.5 text-2xl font-bold tracking-tight tabular-nums text-content-primary">{value}</div>
      <div className="text-[11px] text-content-quaternary">{foot}</div>
    </Card>
  );
}

export function ThaiOverviewPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const f = useFormatters(i18n.language);
  const userName = useAuthStore((s) => s.userFullName ?? '');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const projectsQ = useQuery({ queryKey: ['projects', 'th-overview'], queryFn: () => projectsApi.list() as Promise<ProjectRow[]>, staleTime: 60_000 });
  const rollup = useDashboardRollup({ widgets: ['boq_summary', 'budget_variance', 'procurement_pipeline', 'change_orders'] });
  const inbox = useInboxQuery(8);

  const projects = projectsQ.data ?? [];
  const boqByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rollup.data?.boq_summary?.by_project ?? []) m.set(r.project_id, num(r.total_value));
    return m;
  }, [rollup.data]);
  const overBudget = useMemo(() => new Set((rollup.data?.budget_variance?.top_over ?? []).map((r) => r.project_id)), [rollup.data]);

  const active = projects.filter((p) => p.status === 'active');
  // ยอดรวมแยกสกุลเงิน แสดงสกุลที่มีมูลค่ามากที่สุด
  const totals = useMemo(() => {
    const by = new Map<string, number>();
    for (const p of projects) {
      const v = num(p.contract_value) || num(p.budget_estimate);
      if (v) by.set(p.currency || 'THB', (by.get(p.currency || 'THB') ?? 0) + v);
    }
    const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]);
    return { main: sorted[0] ?? null, others: sorted.length - 1 };
  }, [projects]);

  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of projects) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects]);

  const statusLabel = (s: string) => t(`th_ui.status.${s}`, { defaultValue: s });

  const rows = projects
    .filter((p) => statusFilter === 'all' || p.status === statusFilter)
    .filter((p) => `${p.project_code ?? ''} ${p.name}`.toLowerCase().includes(q.trim().toLowerCase()));

  const chartRows = projects
    .map((p) => ({ p, contract: num(p.contract_value) || num(p.budget_estimate), boq: boqByProject.get(p.id) ?? 0 }))
    .filter((r) => r.contract || r.boq)
    .sort((a, b) => b.contract + b.boq - (a.contract + a.boq))
    .slice(0, 6);
  const chartMax = Math.max(1, ...chartRows.map((r) => Math.max(r.contract, r.boq)));

  const approvals = inbox.data?.approvals_count ?? 0;
  const tasks: InboxItem[] = (inbox.data?.items ?? []).slice(0, 5);
  const pipeline = rollup.data?.procurement_pipeline;
  const co = rollup.data?.change_orders;

  // donut
  const totalP = projects.length || 1;
  let acc = 0;
  const donut = statusCounts
    .map(([s, n]) => {
      const from = (acc / totalP) * 100;
      acc += n;
      return `${statusStyle(s).color} ${from}% ${(acc / totalP) * 100}%`;
    })
    .join(',');

  const fiscalYear = new Date().getFullYear() + (i18n.language.startsWith('th') ? 543 : 0);

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[1.1px] text-oe-blue">
            {t('th_ui.overview.eyebrow', { defaultValue: 'Operations Center / ปีบัญชี {{year}}', year: fiscalYear })}
          </div>
          <h1 className="mb-1 mt-1 text-[25px] font-bold tracking-tight text-content-primary">
            {t('th_ui.nav.overview', { defaultValue: 'ภาพรวมธุรกิจ' })}
          </h1>
          <div className="text-xs text-content-quaternary">
            {userName
              ? t('th_ui.overview.greeting', { defaultValue: 'สวัสดี {{name}} · สถานะโครงการ ต้นทุน และรายการที่ต้องดำเนินการ', name: userName })
              : t('th_ui.overview.sub', { defaultValue: 'สถานะโครงการ ต้นทุน และรายการที่ต้องดำเนินการ' })}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/dashboard/classic" className="rounded-lg border border-border-light bg-surface-primary px-3.5 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-secondary">
            {t('th_ui.overview.classic', { defaultValue: 'แดชบอร์ดแบบเดิม' })}
          </Link>
          <Link to="/projects/new" className="inline-flex items-center gap-1 rounded-lg bg-oe-blue px-3.5 py-2 text-xs font-semibold text-white shadow-[0_3px_9px_#3278f626] hover:bg-oe-blue-hover">
            <Plus size={14} aria-hidden />
            {t('th_ui.overview.new_project', { defaultValue: 'สร้างโครงการ' })}
          </Link>
        </div>
      </div>

      {/* KPI */}
      <section className="mb-4 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <Kpi
          label={t('th_ui.overview.kpi_active', { defaultValue: 'โครงการที่กำลังดำเนินการ' })}
          value={String(active.length)}
          foot={t('th_ui.overview.kpi_active_foot', { defaultValue: 'จากทั้งหมด {{n}} โครงการ', n: projects.length })}
          icon={<FolderKanban size={16} />}
          tone="bg-oe-blue-subtle text-oe-blue"
        />
        <Kpi
          label={t('th_ui.overview.kpi_contract', { defaultValue: 'มูลค่าสัญญา / งบรวม' })}
          value={totals.main ? `${f.short(totals.main[1])} ${totals.main[0]}` : '—'}
          foot={totals.others > 0
            ? t('th_ui.overview.kpi_contract_more', { defaultValue: 'และอีก {{n}} สกุลเงิน', n: totals.others })
            : t('th_ui.overview.kpi_contract_foot', { defaultValue: 'รวมทุกโครงการ' })}
          icon={<Banknote size={16} />}
          tone="bg-[#e5f7ef] text-[#16986a]"
        />
        <Kpi
          label={t('th_ui.overview.kpi_over', { defaultValue: 'โครงการเกินงบประมาณ' })}
          value={String(rollup.data?.budget_variance?.over_budget_count ?? 0)}
          foot={t('th_ui.overview.kpi_over_foot', { defaultValue: 'ต้นทุนคาดการณ์สูงกว่างบ' })}
          icon={<AlertTriangle size={16} />}
          tone="bg-[#fff2df] text-[#c7831c]"
        />
        <Kpi
          label={t('th_ui.overview.kpi_approvals', { defaultValue: 'รายการรออนุมัติ' })}
          value={String(approvals).padStart(2, '0')}
          foot={<Link to="/approvals" className="font-bold text-oe-blue">{t('th_ui.overview.go_approvals', { defaultValue: 'ไปศูนย์อนุมัติ →' })}</Link>}
          icon={<CheckCircle2 size={16} />}
          tone="bg-[#f1eaff] text-[#8456d9]"
        />
      </section>

      {/* กราฟ + สถานะ */}
      <section className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <Card>
          <CardHead
            title={t('th_ui.overview.chart_title', { defaultValue: 'มูลค่าสัญญาเทียบมูลค่า BOQ รายโครงการ' })}
            sub={t('th_ui.overview.chart_sub', { defaultValue: '6 โครงการที่มีมูลค่าสูงสุด' })}
            action={
              <div className="flex gap-3.5 text-[10.5px] text-content-quaternary">
                <span><i className="me-1.5 inline-block h-2 w-2 rounded-sm bg-[#dbe7fb]" />{t('th_ui.overview.legend_contract', { defaultValue: 'มูลค่าสัญญา/งบ' })}</span>
                <span><i className="me-1.5 inline-block h-2 w-2 rounded-sm bg-oe-blue" />{t('th_ui.overview.legend_boq', { defaultValue: 'มูลค่า BOQ' })}</span>
              </div>
            }
          />
          <div className="px-[18px] pb-4">
            {chartRows.length === 0 ? (
              <p className="py-16 text-center text-xs text-content-quaternary">{t('th_ui.overview.chart_empty', { defaultValue: 'ยังไม่มีโครงการที่ระบุมูลค่าสัญญาหรือ BOQ' })}</p>
            ) : (
              <div
                className="flex h-[220px] items-end gap-3.5 border-b border-border-light px-1.5 pt-3"
                style={{ background: 'repeating-linear-gradient(to bottom,transparent 0,transparent 53px,#edf1f7 53px,#edf1f7 54px)' }}
              >
                {chartRows.map(({ p, contract, boq }) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                    title={`${p.name}\n${f.money(contract)} / ${f.money(boq)} ${p.currency}`}
                  >
                    <span className="flex h-[calc(100%-22px)] items-end gap-1">
                      <span className="w-4 rounded-t bg-[#dbe7fb]" style={{ height: `${(contract / chartMax) * 100}%` }} />
                      <span className="w-4 rounded-t bg-gradient-to-b from-[#5d9aff] to-oe-blue" style={{ height: `${(boq / chartMax) * 100}%` }} />
                    </span>
                    <span className="w-full truncate text-center text-[10.5px] text-content-quaternary">{p.project_code || p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHead
            title={t('th_ui.overview.status_title', { defaultValue: 'สถานะโครงการ' })}
            sub={t('th_ui.overview.status_sub', { defaultValue: 'จำแนกตามสถานะล่าสุด' })}
            action={<Link to="/projects" className="text-[11.5px] font-bold text-oe-blue">{t('th_ui.overview.see_projects', { defaultValue: 'ดูโครงการ →' })}</Link>}
          />
          <div className="flex min-h-[220px] flex-wrap items-center justify-center gap-6 px-4 pb-5">
            <div className="grid h-[148px] w-[148px] shrink-0 place-items-center rounded-full" style={{ background: projects.length ? `conic-gradient(${donut})` : '#e8edf5' }}>
              <div className="grid h-[102px] w-[102px] place-items-center rounded-full bg-surface-primary text-center">
                <div className="text-2xl font-bold">{projects.length}<small className="block text-[10px] font-medium text-content-quaternary">{t('th_ui.overview.projects_unit', { defaultValue: 'โครงการ' })}</small></div>
              </div>
            </div>
            <div className="grid min-w-[130px] gap-3">
              {statusCounts.map(([s, n]) => (
                <div key={s} className="flex items-center gap-2 text-[11.5px]">
                  <i className="h-2 w-2 rounded-full" style={{ background: statusStyle(s).color }} />
                  {statusLabel(s)}
                  <b className="ms-auto">{n}</b>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* ตารางโครงการ */}
      <Card className="mb-4">
        <CardHead
          title={t('th_ui.overview.table_title', { defaultValue: 'ทะเบียนโครงการ' })}
          sub={t('th_ui.overview.table_sub', { defaultValue: 'มูลค่าสัญญา มูลค่า BOQ ระยะเวลา และสถานะ · คลิกแถวเพื่อเปิดโครงการ' })}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('th_ui.overview.search', { defaultValue: 'ค้นหาโครงการ…' })}
                aria-label={t('th_ui.overview.search', { defaultValue: 'ค้นหาโครงการ…' })}
                className="rounded-md border border-border-light bg-surface-primary px-2.5 py-1.5 text-[11.5px] outline-none focus:border-oe-blue"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label={t('th_ui.overview.status_filter', { defaultValue: 'สถานะ' })}
                className="rounded-md border border-border-light bg-surface-primary px-2.5 py-1.5 text-[11.5px]"
              >
                <option value="all">{t('th_ui.overview.all_status', { defaultValue: 'ทุกสถานะ' })}</option>
                {statusCounts.map(([s]) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </div>
          }
        />
        <div className="overflow-x-auto px-[15px]">
          <table className="w-full whitespace-nowrap text-xs">
            <thead className="bg-[#f6f8fc] text-[#66758b] dark:bg-surface-secondary">
              <tr>
                {[
                  t('th_ui.overview.col_code', { defaultValue: 'รหัส' }),
                  t('th_ui.overview.col_name', { defaultValue: 'ชื่อโครงการ' }),
                  t('th_ui.overview.col_contract', { defaultValue: 'มูลค่าสัญญา / งบ' }),
                  t('th_ui.overview.col_boq', { defaultValue: 'มูลค่า BOQ' }),
                  t('th_ui.overview.col_period', { defaultValue: 'ระยะเวลา' }),
                  t('th_ui.overview.col_elapsed', { defaultValue: 'เวลาผ่านไป' }),
                  t('th_ui.overview.col_status', { defaultValue: 'สถานะ' }),
                ].map((h, i) => (
                  <th key={h} className={clsx('border-y border-border-light px-2.5 py-2.5 font-semibold', i >= 2 && i <= 3 ? 'text-end' : 'text-start')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projectsQ.isLoading && (
                <tr><td colSpan={7} className="py-8 text-center text-content-quaternary">{t('common.loading', { defaultValue: 'กำลังโหลด…' })}</td></tr>
              )}
              {!projectsQ.isLoading && rows.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-content-quaternary">{t('th_ui.overview.no_rows', { defaultValue: 'ไม่พบโครงการที่ตรงกับเงื่อนไข' })}</td></tr>
              )}
              {rows.map((p) => {
                const pct = elapsedPct(p);
                const contract = num(p.contract_value) || num(p.budget_estimate);
                return (
                  <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="cursor-pointer border-b border-[#edf1f6] hover:bg-[#fafcff] dark:border-border-light dark:hover:bg-surface-secondary">
                    <td className="px-2.5 py-3 font-bold text-oe-blue">{p.project_code || '—'}</td>
                    <td className="max-w-[340px] truncate px-2.5 py-3 font-semibold text-content-primary">
                      {p.name}
                      {overBudget.has(p.id) && (
                        <span className="ms-2 rounded-md bg-[#ffeded] px-1.5 py-0.5 text-[10px] font-semibold text-[#bd4242]">{t('th_ui.overview.over_budget', { defaultValue: 'เกินงบ' })}</span>
                      )}
                    </td>
                    <td className="px-2.5 py-3 text-end tabular-nums">{contract ? `${f.money(contract)} ${p.currency}` : '—'}</td>
                    <td className="px-2.5 py-3 text-end tabular-nums">{boqByProject.has(p.id) ? f.money(boqByProject.get(p.id) ?? 0) : '—'}</td>
                    <td className="px-2.5 py-3 text-content-tertiary">{f.date(p.planned_start_date)} – {f.date(p.planned_end_date)}</td>
                    <td className="px-2.5 py-3">
                      {pct === null ? '—' : (
                        <span className="flex items-center gap-2">
                          <b className="w-9 text-end tabular-nums">{pct}%</b>
                          <span className="h-[5px] w-[70px] overflow-hidden rounded-full bg-[#e8edf5]">
                            <span className={clsx('block h-full rounded-full', pct >= 90 ? 'bg-[#e4ad42]' : 'bg-oe-blue')} style={{ width: `${pct}%` }} />
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-3"><span className={clsx('rounded-md px-2 py-1 text-[10.5px] font-semibold', statusStyle(p.status).cls)}>{statusLabel(p.status)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border-light px-[18px] py-3 text-xs text-content-quaternary">
          {t('th_ui.overview.row_count', { defaultValue: 'แสดง {{n}} จาก {{total}} โครงการ', n: rows.length, total: projects.length })}
          <Link to="/projects" className="text-[11.5px] font-bold text-oe-blue">{t('th_ui.overview.see_all', { defaultValue: 'ดูทั้งหมด →' })}</Link>
        </div>
      </Card>

      {/* งานที่ต้องทำ + สรุป */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHead
            title={t('th_ui.overview.tasks_title', { defaultValue: 'รายการที่ต้องดำเนินการ' })}
            sub={t('th_ui.overview.tasks_sub', { defaultValue: 'เอกสารรออนุมัติและการแจ้งเตือนล่าสุด' })}
            action={<Link to="/inbox" className="text-[11.5px] font-bold text-oe-blue">{t('th_ui.overview.see_all', { defaultValue: 'ดูทั้งหมด →' })}</Link>}
          />
          <div className="px-[18px] pb-3">
            {tasks.length === 0 && (
              <p className="py-6 text-center text-xs text-content-quaternary">{t('th_ui.overview.no_tasks', { defaultValue: 'ไม่มีรายการค้าง' })}</p>
            )}
            {tasks.map((it) => {
              const title = it.title_key ? t(it.title_key, { ...(it.body_context ?? {}), defaultValue: it.title ?? it.title_key }) : it.title ?? '';
              const isApproval = it.kind === 'approval';
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => it.action_url && navigate(it.action_url)}
                  className="flex w-full items-start gap-3 border-b border-[#edf1f6] py-3 text-start last:border-b-0 dark:border-border-light"
                >
                  <span className={clsx('grid h-[31px] w-[31px] shrink-0 place-items-center rounded-[9px]', isApproval ? 'bg-[#fff1e7] text-[#c87828]' : 'bg-oe-blue-subtle text-oe-blue')}>
                    {isApproval ? <ClipboardList size={14} /> : <AlertTriangle size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-xs text-content-primary">{title}</b>
                    <small className="block truncate text-[11px] text-content-quaternary">{it.project_name ?? t(`th_ui.source.${it.source}`, { defaultValue: it.source })}</small>
                  </span>
                  <span className={clsx('shrink-0 rounded-md px-2 py-1 text-[10.5px] font-semibold',
                    it.severity === 'critical' ? 'bg-[#ffeded] text-[#bd4242]' : it.severity === 'warning' ? 'bg-[#fff4dc] text-[#9b6a12]' : 'bg-[#e9f1ff] text-[#2868d7]')}
                  >
                    {isApproval ? t('th_ui.overview.waiting', { defaultValue: 'รออนุมัติ' }) : t(`th_ui.severity.${it.severity}`, { defaultValue: it.severity })}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardHead
            title={t('th_ui.overview.summary_title', { defaultValue: 'สรุปจัดซื้อและงานเปลี่ยนแปลง' })}
            sub={t('th_ui.overview.summary_sub', { defaultValue: 'ทุกโครงการที่คุณเข้าถึงได้' })}
            action={<Link to="/procurement" className="text-[11.5px] font-bold text-oe-blue">{t('th_ui.overview.detail', { defaultValue: 'รายละเอียด →' })}</Link>}
          />
          <div className="px-[18px] pb-4 text-xs">
            {[
              [t('th_ui.overview.rfq_pending', { defaultValue: 'ขอใบเสนอราคา รอผล' }), String(pipeline?.rfqs_pending ?? 0), <ShoppingCart key="i" size={13} />],
              [t('th_ui.overview.po_issued', { defaultValue: 'ใบสั่งซื้อที่ออกแล้ว' }), String(pipeline?.pos_issued ?? 0), <ShoppingCart key="i" size={13} />],
              [t('th_ui.overview.po_received', { defaultValue: 'ใบสั่งซื้อที่รับของแล้ว' }), String(pipeline?.pos_received ?? 0), <CheckCircle2 key="i" size={13} />],
              [t('th_ui.overview.co_open', { defaultValue: 'งานเพิ่ม-ลด ที่ยังเปิดอยู่' }), String(co?.open_count ?? 0), <TrendingUp key="i" size={13} />],
              [t('th_ui.overview.co_impact', { defaultValue: 'มูลค่างานเพิ่ม-ลดที่รอตัดสิน' }), co ? `${f.money(num(co.total_impact))} ${co.currency}` : '—', <TrendingUp key="i" size={13} />],
            ].map(([label, value, icon], i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-b border-[#edf1f6] py-2.5 last:border-b-0 dark:border-border-light">
                <span className="flex items-center gap-2 text-content-quaternary">{icon}{label}</span>
                <b className="tabular-nums text-content-primary">{value}</b>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

export default ThaiOverviewPage;

/**
 * ใบขอซื้อ (PR) — หน้าเอกสาร (สร้าง / แก้ไข / ติดตาม) ตามรูปแบบหน้าเอกสาร 8.5
 *
 * - แถบสายเอกสาร: ใบขอซื้อ → อนุมัติ → ใบสั่งซื้อ → รับของ
 * - รายการเลือกจาก BOQ (เติมชื่อ/หน่วย/ราคาประมาณให้) หรือพิมพ์เองสำหรับของนอก BOQ
 * - ปุ่มตามสถานะ: บันทึกร่าง / ส่งอนุมัติ / ดึงกลับ / ออกใบสั่งซื้อ / ยกเลิก
 * - ยอดรวมพร้อมคำอ่านบาท
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronRight,
  ClipboardList,
  Loader2,
  Plus,
  Send,
  ShoppingCart,
  Trash2,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import { Card } from '@/shared/ui';
import { ContactSearchInput } from '@/shared/ui/ContactSearchInput';
import { ApiError } from '@/shared/lib/api';
import { useActiveProjectId } from '@/shared/hooks/useActiveProjectId';
import { useToastStore } from '@/stores/useToastStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { normalizeRole } from '@/shared/lib/roles';
import { BillPositionPicker } from '@/features/procurement/BillPositionPicker';
import { fetchPositionLine } from '@/features/procurement/costSpineApi';
import { bahtText } from '@/app/thai/bahtText';
import { computeVat, THAI_VAT_RATE, type VatMode } from '@/app/thai/vat';
import {
  useBudgetCheck,
  type BudgetCheck,
  type BudgetLevel,
  type BudgetLineCheck,
  useCreateRequisition,
  useDeleteRequisition,
  useRequisition,
  useRequisitionAction,
  useRequisitionToPO,
  useUpdateRequisition,
  type Requisition,
  type RequisitionItemInput,
} from './api';
import { StatusPill, useFmt } from './shared';

interface DraftLine {
  key: string;
  boq_position_id: string | null;
  cost_line_id: string | null;
  description: string;
  unit: string;
  quantity: string;
  unit_cost: string;
}

let lineSeq = 0;
const newLine = (): DraftLine => ({
  key: `l${++lineSeq}`,
  boq_position_id: null,
  cost_line_id: null,
  description: '',
  unit: '',
  quantity: '',
  unit_cost: '',
});

const isNum = (v: string) => v.trim() !== '' && Number.isFinite(Number(v.replace(/,/g, '')));
const clean = (v: string) => v.replace(/,/g, '').trim();

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export function RequisitionDocPage() {
  const { reqId } = useParams<{ reqId: string }>();
  const isNew = !reqId || reqId === 'new';
  const { data, isLoading, isError } = useRequisition(isNew ? undefined : reqId);
  const { t } = useTranslation();
  if (!isNew && isLoading) {
    return <div className="mx-auto h-[420px] max-w-[1280px] animate-pulse rounded-xl bg-surface-primary" />;
  }
  if (!isNew && (isError || !data)) {
    return (
      <Card className="mx-auto max-w-[520px] p-8 text-center text-sm text-content-secondary">
        {t('th_ui.pr.not_found', { defaultValue: 'ไม่พบใบขอซื้อนี้' })}{' '}
        <Link to="/requisitions" className="font-semibold text-oe-blue">{t('th_ui.pr.back', { defaultValue: 'กลับรายการ' })}</Link>
      </Card>
    );
  }
  return <RequisitionDoc key={data?.id ?? 'new'} req={isNew ? null : data!} />;
}

function RequisitionDoc({ req }: { req: Requisition | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fmt = useFmt();
  const addToast = useToastStore((s) => s.addToast);
  const activeProjectId = useActiveProjectId();
  const projectId = req?.project_id ?? activeProjectId;
  const role = normalizeRole(useAuthStore((s) => s.userRole));
  const canBuy = role === 'admin' || role === 'manager';

  const editable = !req || req.status === 'draft' || req.status === 'rejected';
  const [title, setTitle] = useState(req?.title ?? '');
  const [requiredDate, setRequiredDate] = useState(req?.required_date ?? '');
  const [location, setLocation] = useState(req?.delivery_location ?? '');
  const [notes, setNotes] = useState(req?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    req && req.items.length
      ? req.items.map((i) => ({
          key: i.id,
          boq_position_id: null,
          cost_line_id: i.cost_line_id,
          description: i.description,
          unit: i.unit ?? '',
          quantity: String(Number(i.quantity_requested)),
          unit_cost: String(Number(i.unit_cost)),
        }))
      : [newLine()],
  );
  const [dirty, setDirty] = useState(false);
  const [showPO, setShowPO] = useState(false);
  const touch = () => setDirty(true);

  const create = useCreateRequisition();
  const update = useUpdateRequisition(req?.id ?? '');
  const remove = useDeleteRequisition(req?.id ?? '');
  const submit = useRequisitionAction('submit');
  const withdraw = useRequisitionAction('withdraw');
  const cancel = useRequisitionAction('cancel');
  const busy = create.isPending || update.isPending || submit.isPending || withdraw.isPending || cancel.isPending;

  const total = useMemo(
    () => lines.reduce((a, l) => a + (isNum(l.quantity) && isNum(l.unit_cost) ? Number(clean(l.quantity)) * Number(clean(l.unit_cost)) : 0), 0),
    [lines],
  );
  const filled = lines.filter((l) => l.description.trim() || l.quantity.trim());

  // ── Budget check: live while typing (debounced), against the BOQ budget lines.
  // Shown while the PR is still in play; once ordered its lines live on the PO.
  const showBudget = !req || ['draft', 'rejected', 'submitted', 'approved'].includes(req.status);
  const [settledLines, setSettledLines] = useState(lines);
  useEffect(() => {
    const id = window.setTimeout(() => setSettledLines(lines), 400);
    return () => window.clearTimeout(id);
  }, [lines]);
  const settledFilled = useMemo(
    () => settledLines.filter((l) => l.description.trim() || l.quantity.trim()),
    [settledLines],
  );
  const budgetQuery = useBudgetCheck(
    showBudget ? projectId : '',
    settledFilled.map((l) => ({
      boq_position_id: l.boq_position_id,
      cost_line_id: l.boq_position_id ? null : l.cost_line_id,
      quantity: isNum(l.quantity) ? clean(l.quantity) : '0',
      unit_cost: isNum(l.unit_cost) ? clean(l.unit_cost) : '0',
    })),
    req?.id,
  );
  const budget = showBudget ? budgetQuery.data : undefined;
  /** Budget level and line of one draft line, matched by its position in the checked list. */
  const budgetFor = (key: string): { level: BudgetLevel; line?: BudgetLineCheck } | null => {
    if (!budget) return null;
    const idx = settledFilled.findIndex((l) => l.key === key);
    const hit = idx >= 0 ? budget.lines[idx] : undefined;
    if (!hit) return null;
    return { level: hit.level, line: budget.budget_lines.find((b) => b.cost_line_id === hit.cost_line_id) };
  };
  const [confirmOver, setConfirmOver] = useState(false);

  const problems: string[] = [];
  if (!title.trim()) problems.push(t('th_ui.pr.err_title', { defaultValue: 'ใส่เรื่องที่ขอซื้อ' }));
  if (filled.length === 0) problems.push(t('th_ui.pr.err_lines', { defaultValue: 'เพิ่มรายการอย่างน้อย 1 รายการ' }));
  filled.forEach((l, n) => {
    if (!l.description.trim() || !isNum(l.quantity) || Number(clean(l.quantity)) <= 0) {
      problems.push(t('th_ui.pr.err_line', { defaultValue: 'รายการที่ {{n}}: ใส่ชื่อและจำนวนให้ครบ', n: n + 1 }));
    }
  });

  const payload = () => ({
    title: title.trim(),
    required_date: requiredDate || null,
    delivery_location: location.trim() || null,
    notes: notes.trim() || null,
    items: filled.map<RequisitionItemInput>((l) => ({
      description: l.description.trim(),
      unit: l.unit.trim() || null,
      quantity_requested: clean(l.quantity),
      unit_cost: isNum(l.unit_cost) ? clean(l.unit_cost) : '0',
      boq_position_id: l.boq_position_id,
      cost_line_id: l.boq_position_id ? null : l.cost_line_id,
    })),
  });

  /** Save (create or update); resolves to the saved requisition id. */
  const save = async (): Promise<string | null> => {
    if (problems.length) {
      addToast({ type: 'warning', title: problems[0]! });
      return null;
    }
    try {
      if (!req) {
        const created = (await create.mutateAsync({ ...payload(), project_id: projectId })) as Requisition;
        return created.id;
      }
      if (dirty || req.status === 'rejected') await update.mutateAsync(payload());
      setDirty(false);
      return req.id;
    } catch (e) {
      addToast({ type: 'error', title: t('th_ui.pr.save_failed', { defaultValue: 'บันทึกไม่สำเร็จ' }), message: errorText(e) });
      return null;
    }
  };

  const onSave = async () => {
    const id = await save();
    if (!id) return;
    addToast({ type: 'success', title: t('th_ui.pr.saved', { defaultValue: 'บันทึกร่างแล้ว' }) });
    if (!req) navigate(`/requisitions/${id}`, { replace: true });
  };

  const onSubmit = async () => {
    // Over budget: say so once and let the requester decide to send anyway.
    if (budget?.level === 'over' && !confirmOver) {
      setConfirmOver(true);
      return;
    }
    setConfirmOver(false);
    const id = await save();
    if (!id) return;
    try {
      await submit.mutateAsync(id);
      addToast({
        type: 'success',
        title: t('th_ui.pr.submitted', { defaultValue: 'ส่งอนุมัติแล้ว' }),
        message: t('th_ui.po.sent_body', { defaultValue: 'ติดตามได้ที่ศูนย์อนุมัติ แท็บ "ที่ฉันส่ง"' }),
      });
      navigate(`/requisitions/${id}`, { replace: true });
    } catch (e) {
      const noRoute = e instanceof ApiError && e.status === 409 && JSON.stringify(e.body ?? '').includes('no_route');
      addToast({
        type: noRoute ? 'warning' : 'error',
        title: noRoute
          ? t('th_ui.pr.no_route', { defaultValue: 'ยังไม่ได้ตั้งสายอนุมัติใบขอซื้อ' })
          : t('th_ui.pr.submit_failed', { defaultValue: 'ส่งอนุมัติไม่สำเร็จ' }),
        message: noRoute
          ? t('th_ui.po.no_route_body', { defaultValue: 'ให้ผู้ดูแลระบบตั้งสายอนุมัติและวงเงินในหน้าตั้งค่า' })
          : errorText(e),
      });
      if (!req) navigate(`/requisitions/${id}`, { replace: true });
    }
  };

  const run = (m: { mutateAsync: (id: string) => Promise<unknown> }, ok: string) => async () => {
    if (!req) return;
    try {
      await m.mutateAsync(req.id);
      addToast({ type: 'success', title: ok });
    } catch (e) {
      addToast({ type: 'error', title: t('th_ui.pr.action_failed', { defaultValue: 'ทำรายการไม่สำเร็จ' }), message: errorText(e) });
    }
  };

  const onDelete = async () => {
    try {
      await remove.mutateAsync(undefined);
      navigate('/requisitions', { replace: true });
    } catch (e) {
      addToast({ type: 'error', title: t('th_ui.pr.action_failed', { defaultValue: 'ทำรายการไม่สำเร็จ' }), message: errorText(e) });
    }
  };

  const setLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    touch();
  };

  const pickPosition = async (key: string, positionId: string | null) => {
    setLine(key, { boq_position_id: positionId, cost_line_id: null });
    if (!positionId || !projectId) return;
    const pos = await fetchPositionLine(projectId, positionId).catch(() => null);
    if (!pos) return;
    setLines((ls) =>
      ls.map((l) =>
        l.key === key
          ? {
              ...l,
              description: l.description.trim() ? l.description : pos.description,
              unit: l.unit.trim() ? l.unit : (pos.unit ?? ''),
              unit_cost: l.unit_cost.trim() ? l.unit_cost : String(Number(pos.estimate_unit_rate) || ''),
            }
          : l,
      ),
    );
  };

  const status = req?.status ?? 'draft';

  return (
    <div className="mx-auto max-w-[1280px]">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/requisitions" className="mb-1 inline-flex items-center gap-1 text-xs text-content-tertiary hover:text-content-primary">
            <ArrowLeft size={13} />
            {t('th_ui.pr.title', { defaultValue: 'ใบขอซื้อ (PR)' })}
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-bold tracking-tight text-content-primary">
              {req ? (
                <>
                  {t('th_ui.pr.doc_title', { defaultValue: 'ใบขอซื้อ' })}{' '}
                  <span className="font-mono">{req.req_number}</span>
                </>
              ) : (
                t('th_ui.pr.new', { defaultValue: 'สร้างใบขอซื้อ' })
              )}
            </h1>
            {req && <StatusPill status={req.status} />}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && req && (
            <button type="button" onClick={onDelete} disabled={busy} className={btn('ghost-danger')}>
              <Trash2 size={14} />
              {t('th_ui.pr.delete', { defaultValue: 'ลบ' })}
            </button>
          )}
          {status === 'approved' && (
            <button type="button" onClick={run(cancel, t('th_ui.pr.cancelled', { defaultValue: 'ยกเลิกแล้ว' }))} disabled={busy} className={btn('ghost-danger')}>
              <Ban size={14} />
              {t('th_ui.pr.cancel', { defaultValue: 'ยกเลิกใบขอซื้อ' })}
            </button>
          )}
          {status === 'submitted' && (
            <button type="button" onClick={run(withdraw, t('th_ui.pr.withdrawn', { defaultValue: 'ดึงกลับมาเป็นร่างแล้ว' }))} disabled={busy} className={btn('secondary')}>
              <Undo2 size={14} />
              {t('th_ui.pr.withdraw', { defaultValue: 'ดึงกลับมาแก้ไข' })}
            </button>
          )}
          {editable && (
            <button type="button" onClick={onSave} disabled={busy} className={btn('secondary')}>
              {create.isPending || update.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {t('th_ui.pr.save', { defaultValue: 'บันทึกร่าง' })}
            </button>
          )}
          {editable && (
            <button type="button" onClick={onSubmit} disabled={busy} className={btn('primary')}>
              {submit.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {status === 'rejected'
                ? t('th_ui.pr.resubmit', { defaultValue: 'ส่งอนุมัติอีกครั้ง' })
                : t('th_ui.po.submit', { defaultValue: 'ส่งอนุมัติ' })}
            </button>
          )}
          {status === 'approved' && canBuy && (
            <button type="button" onClick={() => setShowPO(true)} className={btn('primary')}>
              <ShoppingCart size={14} />
              {t('th_ui.pr.to_po', { defaultValue: 'ออกใบสั่งซื้อ' })}
            </button>
          )}
        </div>
      </div>

      {req && <DocChain req={req} />}

      {confirmOver && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">
          <span>
            <span className="font-semibold">{t('th_ui.budget.over_confirm_title', { defaultValue: 'ใบขอซื้อนี้เกินงบ BOQ' })}</span>{' '}
            {t('th_ui.budget.over_confirm_body', {
              defaultValue: 'ผู้อนุมัติจะเห็นว่าเกินงบ และต้องพิจารณาทีละใบ ส่งอนุมัติต่อหรือไม่?',
            })}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setConfirmOver(false)} className={btn('secondary')}>
              {t('th_ui.approvals.cancel', { defaultValue: 'ยกเลิก' })}
            </button>
            <button type="button" onClick={onSubmit} className={btn('primary')}>
              {t('th_ui.budget.send_anyway', { defaultValue: 'ส่งอนุมัติต่อ' })}
            </button>
          </span>
        </div>
      )}

      {req?.status === 'rejected' && (
        <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">
          <span className="font-semibold">{t('th_ui.pr.returned', { defaultValue: 'ถูกส่งกลับให้แก้ไข' })}:</span>{' '}
          {req.rejection_reason ?? '—'}
          <span className="mt-0.5 block text-xs text-[#b91c1c]/80">
            {t('th_ui.pr.returned_hint', { defaultValue: 'แก้ไขรายการแล้วกด "ส่งอนุมัติอีกครั้ง"' })}
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {/* Main info */}
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold text-content-primary">{t('th_ui.pr.section_info', { defaultValue: 'ข้อมูลหลัก' })}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('th_ui.pr.f_title', { defaultValue: 'เรื่อง / วัตถุประสงค์' })} className="sm:col-span-2">
                <input value={title} disabled={!editable} onChange={(e) => { setTitle(e.target.value); touch(); }} placeholder={t('th_ui.pr.f_title_ph', { defaultValue: 'เช่น เหล็กเสริมงานฐานราก โซน A' })} className={inp} />
              </Field>
              <Field label={t('th_ui.pr.f_needed', { defaultValue: 'วันที่ต้องการ' })}>
                <input type="date" value={requiredDate} disabled={!editable} onChange={(e) => { setRequiredDate(e.target.value); touch(); }} className={inp} />
              </Field>
              <Field label={t('th_ui.pr.f_location', { defaultValue: 'สถานที่ส่งของ' })}>
                <input value={location} disabled={!editable} onChange={(e) => { setLocation(e.target.value); touch(); }} placeholder={t('th_ui.pr.f_location_ph', { defaultValue: 'เช่น หน้างาน / คลังกลาง' })} className={inp} />
              </Field>
              <Field label={t('th_ui.pr.f_notes', { defaultValue: 'หมายเหตุ' })} className="sm:col-span-2">
                <textarea value={notes} disabled={!editable} rows={2} onChange={(e) => { setNotes(e.target.value); touch(); }} className={clsx(inp, 'h-auto resize-none py-2')} />
              </Field>
            </div>
          </Card>

          {/* Lines */}
          <Card padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between px-4 pb-2 pt-4 sm:px-5">
              <h2 className="text-sm font-semibold text-content-primary">{t('th_ui.pr.section_lines', { defaultValue: 'รายการที่ขอซื้อ' })}</h2>
              <span className="text-[11px] text-content-quaternary">
                {t('th_ui.pr.lines_hint', { defaultValue: 'เลือกจาก BOQ เพื่อผูกงบ หรือพิมพ์เองสำหรับของนอก BOQ' })}
              </span>
            </div>
            <div className="space-y-2 px-4 pb-3 sm:px-5">
              {lines.map((l, n) => (
                <div key={l.key} className="rounded-lg border border-border-light p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-content-tertiary">
                      {t('th_ui.pr.line_n', { defaultValue: 'รายการที่ {{n}}', n: n + 1 })}
                      {l.cost_line_id && !l.boq_position_id && (
                        <span className="ms-2 rounded bg-oe-blue-subtle px-1.5 py-px text-[10px] text-oe-blue">BOQ</span>
                      )}
                    </span>
                    {editable && lines.length > 1 && (
                      <button type="button" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); touch(); }} className="rounded p-1 text-content-quaternary hover:bg-surface-secondary hover:text-[#dc2626]" aria-label={t('th_ui.pr.remove_line', { defaultValue: 'ลบรายการ' })}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {editable && projectId && (
                    <div className="mb-2">
                      <BillPositionPicker projectId={projectId} value={l.boq_position_id} onChange={(id) => void pickPosition(l.key, id)} line={n + 1} />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_90px_110px_130px_130px]">
                    <input value={l.description} disabled={!editable} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder={t('th_ui.pr.l_desc', { defaultValue: 'รายการ เช่น เหล็กเสริม DB12' })} className={clsx(inp, 'col-span-2 sm:col-span-1')} aria-label={t('th_ui.pr.l_desc_label', { defaultValue: 'รายการ' })} />
                    <input value={l.unit} disabled={!editable} onChange={(e) => setLine(l.key, { unit: e.target.value })} placeholder={t('th_ui.pr.l_unit', { defaultValue: 'หน่วย' })} className={inp} aria-label={t('th_ui.pr.l_unit', { defaultValue: 'หน่วย' })} />
                    <input value={l.quantity} disabled={!editable} inputMode="decimal" onChange={(e) => setLine(l.key, { quantity: e.target.value })} placeholder={t('th_ui.pr.l_qty', { defaultValue: 'จำนวน' })} className={clsx(inp, 'text-right tabular-nums')} aria-label={t('th_ui.pr.l_qty', { defaultValue: 'จำนวน' })} />
                    <input value={l.unit_cost} disabled={!editable} inputMode="decimal" onChange={(e) => setLine(l.key, { unit_cost: e.target.value })} placeholder={t('th_ui.pr.l_rate', { defaultValue: 'ราคา/หน่วย (ประมาณ)' })} className={clsx(inp, 'text-right tabular-nums')} aria-label={t('th_ui.pr.l_rate', { defaultValue: 'ราคา/หน่วย (ประมาณ)' })} />
                    <div className="flex h-9 items-center justify-end rounded-lg bg-surface-secondary px-2.5 text-sm font-semibold tabular-nums text-content-primary">
                      {isNum(l.quantity) && isNum(l.unit_cost) ? fmt.num(Number(clean(l.quantity)) * Number(clean(l.unit_cost))) : '—'}
                    </div>
                  </div>
                  {showBudget && (l.description.trim() || l.quantity.trim()) && (
                    <LineBudgetBadge check={budgetFor(l.key)} fmt={fmt} />
                  )}
                  {req && !editable && Number(req.items[n]?.quantity_ordered ?? 0) > 0 && (
                    <p className="mt-1.5 text-[11px] text-content-tertiary">
                      {t('th_ui.pr.ordered_qty', { defaultValue: 'สั่งซื้อแล้ว {{q}}', q: fmt.qty(req.items[n]?.quantity_ordered) })}
                      {' · '}
                      {t('th_ui.pr.received_qty', { defaultValue: 'รับแล้ว {{q}}', q: fmt.qty(req.items[n]?.quantity_received) })}
                    </p>
                  )}
                </div>
              ))}
              {editable && (
                <button type="button" onClick={() => { setLines((ls) => [...ls, newLine()]); touch(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border-medium px-3 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-secondary">
                  <Plus size={14} />
                  {t('th_ui.pr.add_line', { defaultValue: 'เพิ่มรายการ' })}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border-light bg-surface-secondary/50 px-4 py-3 sm:px-5">
              <span className="text-xs text-content-tertiary">
                {fmt.th && total > 0 ? `(${bahtText(total)})` : ''}
              </span>
              <span className="text-sm text-content-secondary">
                {t('th_ui.pr.total', { defaultValue: 'ยอดประมาณการรวม' })}{' '}
                <span className="ms-2 text-lg font-bold tabular-nums text-content-primary">{fmt.num(total)}</span>
              </span>
            </div>
          </Card>
        </div>

        {/* Side */}
        <div className="space-y-4">
          {showBudget && budget && budget.budget_lines.length + budget.lines.length > 0 && (
            <BudgetPanel budget={budget} fmt={fmt} />
          )}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-content-primary">{t('th_ui.pr.section_status', { defaultValue: 'สถานะเอกสาร' })}</h2>
            <dl className="space-y-2.5 text-xs">
              <Row label={t('th_ui.pr.requester', { defaultValue: 'ผู้ขอ' })} value={req?.requester_name ?? t('th_ui.pr.you', { defaultValue: 'คุณ' })} />
              <Row label={t('th_ui.pr.created', { defaultValue: 'วันที่สร้าง' })} value={req ? fmt.date(req.created_at) : '—'} />
              <Row label={t('th_ui.pr.approval', { defaultValue: 'การอนุมัติ' })} value={req?.approval_status ? t(`th_ui.approvals.status.${req.approval_status}`) : t('th_ui.pr.not_sent', { defaultValue: 'ยังไม่ส่ง' })} />
            </dl>
            {req?.approval_status && (
              <Link to="/approvals?tab=submitted" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-oe-blue hover:underline">
                {t('th_ui.pr.view_chain', { defaultValue: 'ดูสายอนุมัติในศูนย์อนุมัติ' })}
                <ChevronRight size={13} />
              </Link>
            )}
          </Card>
          {req?.po && (
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-content-primary">{t('th_ui.pr.section_po', { defaultValue: 'ใบสั่งซื้อที่ออกแล้ว' })}</h2>
              <Link to={`/procurement?po=${req.po.id}`} className="font-mono text-sm font-semibold text-oe-blue hover:underline">{req.po.po_number}</Link>
              <p className="mt-1 text-xs text-content-tertiary">{req.po.vendor_name ?? '—'}</p>
              <p className="mt-1 text-xs text-content-secondary">
                {t('th_ui.pr.po_amount', { defaultValue: 'ยอด' })} <span className="font-semibold tabular-nums">{fmt.num(req.po.amount_total)}</span> · {t(`th_ui.pr.po_status.${req.po.status}`, { defaultValue: req.po.status })}
              </p>
            </Card>
          )}
        </div>
      </div>

      {showPO && req && <CreatePODialog req={req} onClose={() => setShowPO(false)} />}
    </div>
  );
}

/* ── document chain ─────────────────────────────────────────────────────── */

function DocChain({ req }: { req: Requisition }) {
  const { t } = useTranslation();
  const received = req.po && ['received', 'partially_received', 'completed', 'closed'].includes(req.po.status);
  const steps: { label: string; detail: string; state: 'done' | 'current' | 'todo' | 'bad'; to?: string; icon: React.ElementType }[] = [
    { label: t('th_ui.pr.chain_pr', { defaultValue: 'ใบขอซื้อ' }), detail: req.req_number ?? '', state: 'done', icon: ClipboardList },
    {
      label: t('th_ui.pr.chain_approval', { defaultValue: 'อนุมัติ' }),
      detail: req.approval_status ? t(`th_ui.approvals.status.${req.approval_status}`) : t('th_ui.pr.not_sent', { defaultValue: 'ยังไม่ส่ง' }),
      state: req.status === 'rejected' ? 'bad' : ['approved', 'ordered', 'received', 'consumed'].includes(req.status) ? 'done' : req.status === 'submitted' ? 'current' : 'todo',
      to: req.approval_status ? '/approvals?tab=submitted' : undefined,
      icon: Check,
    },
    {
      label: t('th_ui.pr.chain_po', { defaultValue: 'ใบสั่งซื้อ' }),
      detail: req.po?.po_number ?? '—',
      state: req.po ? 'done' : req.status === 'approved' ? 'current' : 'todo',
      to: req.po ? `/procurement?po=${req.po.id}` : undefined,
      icon: ShoppingCart,
    },
    {
      label: t('th_ui.pr.chain_receive', { defaultValue: 'รับของ' }),
      detail: received ? t('th_ui.pr.received', { defaultValue: 'รับแล้ว' }) : '—',
      state: received ? 'done' : req.po ? 'current' : 'todo',
      to: req.po ? `/procurement?po=${req.po.id}` : undefined,
      icon: Truck,
    },
  ];
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-border-light bg-surface-primary px-3 py-2.5">
      <li className="me-1 text-[11px] font-semibold text-content-tertiary">{t('th_ui.pr.chain', { defaultValue: 'สายเอกสาร' })}:</li>
      {steps.map((s, n) => {
        const Icon = s.icon;
        const body = (
          <span
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs',
              s.state === 'done' && 'bg-[#f0fdf4] text-[#15803d]',
              s.state === 'current' && 'bg-oe-blue-subtle font-semibold text-oe-blue',
              s.state === 'todo' && 'text-content-quaternary',
              s.state === 'bad' && 'bg-[#fef2f2] text-[#dc2626]',
            )}
          >
            <Icon size={13} />
            {s.label}
            <span className="font-mono text-[11px] opacity-80">{s.detail}</span>
          </span>
        );
        return (
          <li key={n} className="flex items-center gap-1.5">
            {n > 0 && <ChevronRight size={13} className="text-content-quaternary" />}
            {s.to ? <Link to={s.to} className="hover:opacity-80">{body}</Link> : body}
          </li>
        );
      })}
    </ol>
  );
}

/* ── PR → PO ────────────────────────────────────────────────────────────── */

function CreatePODialog({ req, onClose }: { req: Requisition; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const toPO = useRequisitionToPO(req.id);
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState(req.required_date ?? '');
  const [vatMode, setVatMode] = useState<VatMode>('exclusive');
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(req.items.map((i) => [i.id, String(Number(i.unit_cost))])),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = req.items.reduce((a, i) => a + Number(i.quantity_requested) * (Number(clean(rates[i.id] ?? '0')) || 0), 0);
  const ratesOk = req.items.every((i) => isNum(rates[i.id] ?? ''));
  const vat = computeVat(total, vatMode, THAI_VAT_RATE);

  const submit = async () => {
    try {
      const res = (await toPO.mutateAsync({
        vendor_contact_id: vendorId,
        issue_date: issueDate || null,
        delivery_date: deliveryDate || null,
        lines: req.items.map((i) => ({ item_id: i.id, unit_rate: clean(rates[i.id] ?? '0') })),
        vat_mode: vatMode,
        vat_rate: String(THAI_VAT_RATE),
      })) as Requisition;
      addToast({
        type: 'success',
        title: t('th_ui.pr.po_created', { defaultValue: 'ออกใบสั่งซื้อ {{n}} แล้ว', n: res.po?.po_number ?? '' }),
        message: t('th_ui.pr.po_created_hint', { defaultValue: 'ใบสั่งซื้อเป็นร่าง ตรวจแล้วกด "ส่งอนุมัติ" ที่หน้าจัดซื้อ' }),
      });
      onClose();
      if (res.po) navigate(`/procurement?po=${res.po.id}`);
    } catch (e) {
      addToast({ type: 'error', title: t('th_ui.pr.po_failed', { defaultValue: 'ออกใบสั่งซื้อไม่สำเร็จ' }), message: errorText(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-[640px] overflow-y-auto rounded-2xl bg-surface-elevated p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-content-primary">
          {t('th_ui.pr.to_po_title', { defaultValue: 'ออกใบสั่งซื้อจาก {{n}}', n: req.req_number })}
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t('th_ui.pr.vendor', { defaultValue: 'ผู้ขาย' })} className="sm:col-span-2">
            <ContactSearchInput
              value={vendorId}
              displayValue={vendorName}
              onChange={(id, name) => { setVendorId(id); setVendorName(name); }}
              placeholder={t('th_ui.pr.vendor_ph', { defaultValue: 'ค้นหาผู้ขาย…' })}
              browseContactTypes={['supplier', 'subcontractor']}
            />
          </Field>
          <Field label={t('th_ui.pr.issue_date', { defaultValue: 'วันที่สั่งซื้อ' })}>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inp} />
          </Field>
          <Field label={t('th_ui.pr.delivery_date', { defaultValue: 'กำหนดส่ง' })}>
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={inp} />
          </Field>
        </div>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="bg-surface-secondary text-left text-content-tertiary">
                <th className="px-3 py-2">{t('th_ui.pr.l_desc_label', { defaultValue: 'รายการ' })}</th>
                <th className="px-3 py-2 text-right">{t('th_ui.pr.l_qty', { defaultValue: 'จำนวน' })}</th>
                <th className="px-3 py-2 text-right">{t('th_ui.pr.l_price', { defaultValue: 'ราคา/หน่วย' })}</th>
                <th className="px-3 py-2 text-right">{t('th_ui.pr.l_amount', { defaultValue: 'รวม' })}</th>
              </tr>
            </thead>
            <tbody>
              {req.items.map((i) => (
                <tr key={i.id} className="border-t border-border-light">
                  <td className="px-3 py-2 text-content-primary">{i.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt.qty(i.quantity_requested)} {i.unit}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input value={rates[i.id] ?? ''} inputMode="decimal" onChange={(e) => setRates((r) => ({ ...r, [i.id]: e.target.value }))} className={clsx(inp, 'h-8 w-28 text-right tabular-nums')} aria-label={t('th_ui.pr.l_price', { defaultValue: 'ราคา/หน่วย' })} />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmt.num(Number(i.quantity_requested) * (Number(clean(rates[i.id] ?? '0')) || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <label className="text-xs text-content-secondary">
            <span className="mb-1 block font-semibold text-content-tertiary">{t('th_ui.vat.mode_label', { defaultValue: 'ราคาที่กรอก' })}</span>
            <select value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)} className={clsx(inp, 'h-8 w-auto text-xs')}>
              <option value="exclusive">{t('th_ui.vat.exclusive', { defaultValue: 'ยังไม่รวม VAT' })}</option>
              <option value="inclusive">{t('th_ui.vat.inclusive', { defaultValue: 'รวม VAT แล้ว' })}</option>
              <option value="none">{t('th_ui.vat.none', { defaultValue: 'ไม่มี VAT / ยกเว้น' })}</option>
            </select>
          </label>
          <dl className="min-w-[220px] space-y-1 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-content-secondary">{t('th_ui.vat.net', { defaultValue: 'มูลค่าก่อน VAT' })}</dt><dd className="tabular-nums">{fmt.num(vat.net)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-content-secondary">{vatMode === 'none' ? t('th_ui.vat.none', { defaultValue: 'ไม่มี VAT / ยกเว้น' }) : t('th_ui.vat.amount', { defaultValue: 'ภาษีมูลค่าเพิ่ม {{rate}}%', rate: THAI_VAT_RATE })}</dt><dd className="tabular-nums">{fmt.num(vat.vat)}</dd></div>
            <div className="flex justify-between gap-4 border-t border-border-light pt-1 font-bold"><dt>{t('th_ui.vat.total', { defaultValue: 'รวมทั้งสิ้น' })}</dt><dd className="tabular-nums">{fmt.num(vat.total)}</dd></div>
          </dl>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn('secondary')}>{t('th_ui.approvals.cancel', { defaultValue: 'ยกเลิก' })}</button>
          <button type="button" onClick={submit} disabled={!vendorId || !ratesOk || toPO.isPending} className={btn('primary')}>
            {toPO.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
            {t('th_ui.pr.to_po_confirm', { defaultValue: 'สร้างใบสั่งซื้อ (ร่าง)' })}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── budget ─────────────────────────────────────────────────────────────── */

type Fmt = ReturnType<typeof useFmt>;

const LEVEL_TONE: Record<BudgetLevel, string> = {
  ok: 'bg-[#f0fdf4] text-[#15803d]',
  warning: 'bg-[#fff7e6] text-[#b45309]',
  over: 'bg-[#fef2f2] text-[#dc2626]',
  unbudgeted: 'bg-surface-secondary text-content-tertiary',
};

/** One line's budget state, under the line. */
/** Percent of budget used; huge overruns read as ">999%" instead of a long number. */
function fmtPct(pct: number | null | undefined): string {
  if (pct == null) return '';
  return pct > 999 ? '>999%' : `${pct}%`;
}

function LineBudgetBadge({ check, fmt }: { check: { level: BudgetLevel; line?: BudgetLineCheck } | null; fmt: Fmt }) {
  const { t } = useTranslation();
  if (!check) return null;
  const b = check.line;
  const pct = fmtPct(b?.used_pct);
  const text =
    check.level === 'unbudgeted' || !b
      ? t('th_ui.budget.unbudgeted_line', { defaultValue: 'นอก BOQ: ไม่มีงบให้เทียบ' })
      : check.level === 'over'
        ? t('th_ui.budget.over_line', {
            defaultValue: 'เกินงบ {{amount}} (ใช้ {{pct}} ของงบ {{budget}})',
            amount: fmt.num(-Number(b.remaining)),
            pct,
            budget: fmt.num(b.budget),
          })
        : t(check.level === 'warning' ? 'th_ui.budget.warning_line' : 'th_ui.budget.ok_line', {
            defaultValue:
              check.level === 'warning'
                ? 'ใกล้เต็มงบ: เหลือ {{amount}} (ใช้ {{pct}})'
                : 'งบคงเหลือหลังขอ {{amount}} (ใช้ {{pct}})',
            amount: fmt.num(b.remaining),
            pct,
          });
  return (
    <p data-testid="line-budget" data-level={check.level} className={clsx('mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-medium', LEVEL_TONE[check.level])}>
      {b?.code ? <span className="me-1.5 font-mono">{b.code}</span> : null}
      {text}
    </p>
  );
}

/** Side panel: every budget line the request touches, with the figures behind its level. */
function BudgetPanel({ budget, fmt }: { budget: BudgetCheck; fmt: Fmt }) {
  const { t } = useTranslation();
  const outside = budget.lines.filter((l) => l.level === 'unbudgeted').length;
  return (
    <Card className="p-4" data-testid="budget-panel" data-level={budget.level}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-content-primary">{t('th_ui.budget.title', { defaultValue: 'งบประมาณ (BOQ)' })}</h2>
        <span className={clsx('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', LEVEL_TONE[budget.level])}>
          {t(`th_ui.budget.level.${budget.level}`)}
        </span>
      </div>
      <div className="space-y-3">
        {budget.budget_lines.map((b) => (
          <div key={b.cost_line_id} className="rounded-lg border border-border-light p-2.5 text-xs">
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-content-primary" title={b.description ?? ''}>
                <span className="me-1 font-mono text-content-tertiary">{b.code}</span>
                {b.description}
              </span>
              <span className={clsx('shrink-0 rounded px-1.5 py-px text-[10px] font-semibold', LEVEL_TONE[b.level])}>
                {fmtPct(b.used_pct) || '—'}
              </span>
            </div>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-secondary">
              <div
                className={clsx('h-full rounded-full', b.level === 'over' ? 'bg-[#dc2626]' : b.level === 'warning' ? 'bg-[#e4ad42]' : 'bg-[#16a34a]')}
                style={{ width: `${Math.min(100, b.used_pct ?? 0)}%` }}
              />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
              <dt className="text-content-tertiary">{t('th_ui.budget.budget', { defaultValue: 'งบ' })}</dt>
              <dd className="text-right">{fmt.num(b.budget)}</dd>
              <dt className="text-content-tertiary">{t('th_ui.budget.ordered', { defaultValue: 'สั่งซื้อแล้ว' })}</dt>
              <dd className="text-right">{fmt.num(b.ordered)}</dd>
              <dt className="text-content-tertiary">{t('th_ui.budget.pending', { defaultValue: 'ขอซื้อค้างอนุมัติ' })}</dt>
              <dd className="text-right">{fmt.num(b.pending)}</dd>
              <dt className="text-content-tertiary">{t('th_ui.budget.this', { defaultValue: 'ใบนี้' })}</dt>
              <dd className="text-right font-semibold">{fmt.num(b.this)}</dd>
              <dt className="font-semibold text-content-secondary">{t('th_ui.budget.remaining', { defaultValue: 'คงเหลือ' })}</dt>
              <dd className={clsx('text-right font-bold', Number(b.remaining) < 0 ? 'text-[#dc2626]' : 'text-content-primary')}>
                {fmt.num(b.remaining)}
              </dd>
            </dl>
          </div>
        ))}
        {outside > 0 && (
          <p className="text-[11px] text-content-tertiary">
            {t('th_ui.budget.outside_count', { defaultValue: '{{n}} รายการอยู่นอก BOQ จึงไม่มีงบให้เทียบ', n: outside })}
          </p>
        )}
      </div>
    </Card>
  );
}

/* ── bits ───────────────────────────────────────────────────────────────── */

const inp =
  'h-9 w-full rounded-lg border border-border-light bg-surface-primary px-2.5 text-sm text-content-primary placeholder:text-content-quaternary focus:outline-none focus:ring-2 focus:ring-oe-blue/30 disabled:bg-surface-secondary disabled:text-content-secondary';

function btn(kind: 'primary' | 'secondary' | 'ghost-danger') {
  return clsx(
    'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40',
    kind === 'primary' && 'bg-oe-blue text-white hover:bg-oe-blue-hover',
    kind === 'secondary' && 'border border-border-light bg-surface-primary text-content-secondary hover:bg-surface-secondary',
    kind === 'ghost-danger' && 'text-[#dc2626] hover:bg-[#fef2f2]',
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-[11px] font-semibold text-content-tertiary">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-content-tertiary">{label}</dt>
      <dd className="text-right font-medium text-content-primary">{value}</dd>
    </div>
  );
}

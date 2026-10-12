/**
 * ใบขอซื้อ (PR) — API (backend: procurement/requisitions_router.py)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/shared/lib/api';
import { APPROVAL_QUEUE_ROOT } from '@/features/th-approvals/api';
import { INBOX_QUERY_ROOT } from '@/features/inbox/useInbox';

export type RequisitionStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'ordered'
  | 'received'
  | 'consumed'
  | 'cancelled';

export interface RequisitionItem {
  id: string;
  description: string;
  unit: string | null;
  quantity_requested: string;
  quantity_ordered: string;
  quantity_received: string;
  unit_cost: string;
  extended_cost: string;
  cost_line_id: string | null;
  sort_order: number;
}

export interface Requisition {
  id: string;
  project_id: string;
  req_number: string | null;
  title: string | null;
  status: RequisitionStatus;
  required_date: string | null;
  delivery_location: string | null;
  notes: string | null;
  requester_id: string | null;
  requester_name: string | null;
  approver_id: string | null;
  total: string;
  currency: string | null;
  items: RequisitionItem[];
  po: { id: string; po_number: string; status: string; amount_total: string; vendor_name: string | null } | null;
  approval_status: string | null;
  rejection_reason: string | null;
  /** Budget check stored when the PR was sent. */
  budget_level?: 'ok' | 'warning' | 'over' | 'unbudgeted' | null;
  created_at: string;
  updated_at: string;
}

export interface RequisitionItemInput {
  description: string;
  unit?: string | null;
  quantity_requested: string;
  unit_cost?: string;
  boq_position_id?: string | null;
  cost_line_id?: string | null;
}

export interface RequisitionInput {
  title: string;
  required_date?: string | null;
  delivery_location?: string | null;
  notes?: string | null;
  items: RequisitionItemInput[];
}

export interface RequisitionToPOInput {
  vendor_contact_id: string;
  issue_date?: string | null;
  delivery_date?: string | null;
  payment_terms?: string | null;
  lines: { item_id: string; unit_rate: string; quantity?: string }[];
  vat_mode?: 'exclusive' | 'inclusive' | 'none';
  vat_rate?: string;
}

const BASE = '/v1/procurement/requisitions';
export const REQUISITIONS_ROOT = 'th-requisitions';

export function useRequisitions(projectId: string) {
  return useQuery({
    queryKey: [REQUISITIONS_ROOT, 'list', projectId],
    queryFn: () => apiGet<{ items: Requisition[]; total: number }>(`${BASE}/?project_id=${projectId}`),
    enabled: !!projectId,
    staleTime: 15_000,
  });
}

export function useRequisition(id: string | undefined) {
  return useQuery({
    queryKey: [REQUISITIONS_ROOT, 'one', id],
    queryFn: () => apiGet<Requisition>(`${BASE}/${id}`),
    enabled: !!id,
  });
}

/** Every write refreshes the PR lists, the approval queue and the header badge. */
function useRequisitionMutation<TVars>(fn: (vars: TVars) => Promise<Requisition | void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: [REQUISITIONS_ROOT] });
      qc.invalidateQueries({ queryKey: [APPROVAL_QUEUE_ROOT] });
      qc.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
      if (data && 'id' in data) qc.setQueryData([REQUISITIONS_ROOT, 'one', data.id], data);
    },
  });
}

export const useCreateRequisition = () =>
  useRequisitionMutation((v: RequisitionInput & { project_id: string }) => apiPost<Requisition>(`${BASE}/`, v));
export const useUpdateRequisition = (id: string) =>
  useRequisitionMutation((v: Partial<RequisitionInput>) => apiPatch<Requisition>(`${BASE}/${id}`, v));
export const useDeleteRequisition = (id: string) =>
  useRequisitionMutation(() => apiDelete(`${BASE}/${id}`).then(() => undefined));
/** submit / withdraw / cancel; the PR id is the mutation variable, so a PR
 *  created a moment ago (no id at render time) uses the same cache-refreshing path. */
export const useRequisitionAction = (action: 'submit' | 'withdraw' | 'cancel') =>
  useRequisitionMutation((id: string) => apiPost<Requisition>(`${BASE}/${id}/${action}`));
export const useRequisitionToPO = (id: string) =>
  useRequisitionMutation((v: RequisitionToPOInput) => apiPost<Requisition>(`${BASE}/${id}/create-po`, v));

/* ── Budget check (POST /requisitions/budget-check) ───────────────────────── */

export type BudgetLevel = 'ok' | 'warning' | 'over' | 'unbudgeted';

export interface BudgetLineCheck {
  cost_line_id: string;
  code: string | null;
  description: string | null;
  unit: string | null;
  budget: string;
  budget_qty: string;
  ordered: string;
  ordered_qty: string;
  pending: string;
  pending_qty: string;
  this: string;
  this_qty: string;
  after: string;
  remaining: string;
  used_pct: number | null;
  level: BudgetLevel;
}

export interface BudgetCheck {
  level: BudgetLevel;
  lines: { index: number; cost_line_id: string | null; level: BudgetLevel }[];
  budget_lines: BudgetLineCheck[];
}

export interface BudgetCheckLineInput {
  boq_position_id?: string | null;
  cost_line_id?: string | null;
  quantity: string;
  unit_cost: string;
}

/** Live budget check of the lines being typed; refetches when they settle. */
export function useBudgetCheck(projectId: string, lines: BudgetCheckLineInput[], excludeId?: string) {
  const key = JSON.stringify(lines);
  return useQuery({
    queryKey: [REQUISITIONS_ROOT, 'budget', projectId, excludeId ?? '', key],
    queryFn: () =>
      apiPost<BudgetCheck>(`${BASE}/budget-check`, {
        project_id: projectId,
        exclude_requisition_id: excludeId,
        lines,
      }),
    enabled: !!projectId && lines.length > 0,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

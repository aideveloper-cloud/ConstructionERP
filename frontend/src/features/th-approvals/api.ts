/**
 * ศูนย์อนุมัติ — API ของคิวอนุมัติ (backend: approval_routes/queue.py)
 *
 *   GET  /v1/approval-routes/queue          รายการตามแท็บ + จำนวนทุกแท็บ
 *   POST /v1/approval-routes/queue/decide   อนุมัติ/ไม่อนุมัติ ทีละใบหรือหลายใบ
 *   POST /v1/approval-routes/queue/submit   ส่งเอกสารเข้าสายอนุมัติ
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/shared/lib/api';
import { INBOX_QUERY_ROOT } from '@/features/inbox/useInbox';

export type ApprovalTab = 'mine' | 'waiting' | 'submitted' | 'history';
export const APPROVAL_TABS: ApprovalTab[] = ['mine', 'waiting', 'submitted', 'history'];

export type ChainState = 'approved' | 'rejected' | 'current' | 'waiting' | 'skipped';

export interface ChainDecision {
  decision: 'approved' | 'rejected';
  by: string | null;
  by_name: string | null;
  at: string | null;
  comment: string | null;
}

export interface ChainStep {
  step_id: string;
  ordinal: number;
  approver_role: string | null;
  approver_user_id: string | null;
  approver_name: string | null;
  min_amount: string | null;
  sla_hours: number | null;
  state: ChainState;
  decisions: ChainDecision[];
}

export interface ApprovalTarget {
  kind: string;
  id: string;
  code: string | null;
  title: string | null;
  amount: string | null;
  currency: string | null;
  project_id: string | null;
  doc_date: string | null;
  status: string | null;
  url: string | null;
  /** Budget check stored on a purchase requisition. */
  budget?: {
    level: 'ok' | 'warning' | 'over' | 'unbudgeted';
    over?: { cost_line_id: string; code: string | null; description: string | null; remaining: string }[];
    unbudgeted_lines?: number;
  } | null;
}

export interface ApprovalItem {
  instance_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  target_kind: string;
  target_id: string;
  target: ApprovalTarget | null;
  route: { id: string; name: string } | null;
  project: { id: string; name: string | null } | null;
  amount: string | null;
  currency: string | null;
  requester: { id: string | null; name: string | null };
  started_at: string;
  completed_at: string | null;
  waiting_hours: number;
  current_step: ChainStep | null;
  position: number | null;
  step_count: number;
  chain: ChainStep[];
  can_decide: boolean;
  my_decision: 'approved' | 'rejected' | null;
  rejection: ChainDecision | null;
}

export interface ApprovalQueue {
  tab: ApprovalTab;
  items: ApprovalItem[];
  counts: Record<ApprovalTab, number>;
}

export interface QueueFilters {
  tab: ApprovalTab;
  targetKind?: string;
  projectId?: string;
  q?: string;
}

export interface DecideResult {
  results: { instance_id: string; ok: boolean; status?: string; error?: unknown }[];
  ok: number;
  failed: number;
}

export const APPROVAL_QUEUE_ROOT = 'th-approval-queue';

export function useApprovalQueue(filters: QueueFilters) {
  const params = new URLSearchParams({ tab: filters.tab });
  if (filters.targetKind) params.set('target_kind', filters.targetKind);
  if (filters.projectId) params.set('project_id', filters.projectId);
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  return useQuery({
    queryKey: [APPROVAL_QUEUE_ROOT, filters.tab, filters.targetKind ?? '', filters.projectId ?? '', filters.q ?? ''],
    queryFn: () => apiGet<ApprovalQueue>(`/v1/approval-routes/queue?${params.toString()}`),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { instance_ids: string[]; decision: 'approved' | 'rejected'; comment?: string }) =>
      apiPost<DecideResult>('/v1/approval-routes/queue/decide', body),
    meta: { suppressGlobalErrorToast: true },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [APPROVAL_QUEUE_ROOT] });
      qc.invalidateQueries({ queryKey: [INBOX_QUERY_ROOT] });
    },
  });
}

export function submitForApproval(targetKind: string, targetId: string) {
  return apiPost<{ id: string }>('/v1/approval-routes/queue/submit', {
    target_kind: targetKind,
    target_id: targetId,
  });
}

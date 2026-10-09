/**
 * ปุ่ม "อนุมัติ" บนแถบบน พร้อมจำนวนเอกสารที่รออนุมัติ — กดแล้วไปศูนย์อนุมัติ
 * ตัวเลขจาก /v1/dashboard/inbox/ (รวมคิว "รอฉันอนุมัติ" ของศูนย์อนุมัติแล้ว) กดแล้วไปหน้า /approvals
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { useInboxQuery } from '@/features/inbox/useInbox';

export function ApprovalsHeaderButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data } = useInboxQuery(8);
  const count = data?.approvals_count ?? 0;

  return (
    <button
      type="button"
      onClick={() => navigate('/approvals')}
      title={t('th_ui.approvals_title', { defaultValue: 'เอกสารรออนุมัติ' })}
      className="relative flex h-9 items-center gap-1.5 rounded-[9px] border border-border-light bg-surface-primary px-2.5 text-xs font-semibold text-content-secondary hover:bg-surface-secondary"
    >
      <CheckCircle2 size={16} strokeWidth={1.9} aria-hidden />
      <span className="hidden md:inline">{t('th_ui.approvals_button', { defaultValue: 'อนุมัติ' })}</span>
      {count > 0 && (
        <span className="rounded-full bg-[#dc5555] px-1.5 text-[10px] font-bold leading-4 text-white">{count}</span>
      )}
    </button>
  );
}

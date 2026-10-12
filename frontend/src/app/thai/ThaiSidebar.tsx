/**
 * ConstructionERP ฉบับไทย — เมนูซ้าย 12 รายการ (แทนเมนูเดิม 31 กลุ่ม / 164 รายการ)
 *
 * แต่ละรายการชี้ไปหน้าที่มีอยู่แล้ว และนับว่า "อยู่ในเมนูนี้" ด้วย prefix ของ path
 * หลายตัว (เช่น จัดซื้อ = /procurement, /supplier-catalogs, /rfq-bidding)
 * โมดูลอื่นที่ไม่อยู่ในเมนูยังเข้าได้จาก "โมดูลเพิ่มเติม" (เฉพาะผู้ดูแล) หรือ Ctrl+K
 */
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  Banknote,
  Boxes,
  CalendarClock,
  CheckCircle2,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LayoutGrid,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useBrandingStore } from '@/stores/useBrandingStore';
import { normalizeRole } from '@/shared/lib/roles';
import { useInboxQuery } from '@/features/inbox/useInbox';
import { PRODUCT_NAME } from './flags';

interface ThaiNavItem {
  key: string;
  to: string;
  icon: LucideIcon;
  /** path prefix อื่นที่นับว่าเป็นเมนูนี้ */
  also?: string[];
  adminOnly?: boolean;
  badge?: 'approvals';
}

export const THAI_NAV: ThaiNavItem[] = [
  { key: 'overview', to: '/dashboard', icon: LayoutDashboard, also: ['/dashboards'] },
  { key: 'projects', to: '/projects', icon: FolderKanban },
  { key: 'planning', to: '/schedule', icon: CalendarClock, also: ['/schedule-advanced', '/progress', '/daily-diary', '/field-reports', '/tasks'] },
  { key: 'procurement', to: '/procurement', icon: ShoppingCart, also: ['/requisitions', '/supplier-catalogs', '/rfq-bidding'] },
  { key: 'inventory', to: '/site-inventory', icon: Boxes },
  { key: 'finance', to: '/finance', icon: Banknote },
  { key: 'billing', to: '/contracts', icon: Receipt, also: ['/subcontractors', '/changeorders', '/variations'] },
  { key: 'workforce', to: '/field-time', icon: Users, also: ['/resources', '/payroll'] },
  { key: 'equipment', to: '/equipment', icon: Wrench },
  { key: 'documents', to: '/documents', icon: FileText, also: ['/reports', '/reporting'] },
  { key: 'approvals', to: '/approvals', icon: CheckCircle2, also: ['/inbox', '/approval-routes'], badge: 'approvals' },
  { key: 'settings', to: '/settings', icon: Settings, also: ['/users', '/admin'], adminOnly: true },
];

const DEFAULT_LABELS: Record<string, string> = {
  overview: 'ภาพรวมธุรกิจ',
  projects: 'โครงการ',
  planning: 'แผนงานและความคืบหน้า',
  procurement: 'จัดซื้อและผู้ขาย',
  inventory: 'คลังวัสดุ',
  finance: 'การเงินและต้นทุน',
  billing: 'งวดงานและวางบิล',
  workforce: 'บุคลากรและแรงงาน',
  equipment: 'เครื่องจักรและอุปกรณ์',
  documents: 'เอกสารและรายงาน',
  approvals: 'ศูนย์อนุมัติ',
  settings: 'ตั้งค่าระบบ',
};

function matches(pathname: string, item: ThaiNavItem): boolean {
  return [item.to, ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** ข้อความหัวเมนูของ path ปัจจุบัน (ใช้ทำ breadcrumb บนแถบบน) */
export function useThaiNavLabel(pathname: string): string | null {
  const { t } = useTranslation();
  const item = THAI_NAV.find((i) => matches(pathname, i));
  return item ? t(`th_ui.nav.${item.key}`, { defaultValue: DEFAULT_LABELS[item.key] }) : null;
}

export function ThaiSidebar({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const role = normalizeRole(useAuthStore((s) => s.userRole));
  const isAdmin = role === 'admin';
  const companyName = useBrandingStore((s) => s.companyName.trim());
  const { data: inbox } = useInboxQuery(8);
  const approvals = inbox?.approvals_count ?? 0;

  const items = THAI_NAV.filter((i) => !i.adminOnly || isAdmin);

  return (
    <aside
      className="th-side flex h-full flex-col gap-5 overflow-y-auto px-3.5 py-5"
      style={{ width: 'var(--oe-sidebar-width)' }}
      aria-label={t('th_ui.nav.aria', { defaultValue: 'เมนูหลัก' })}
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-2 pb-4">
        <div
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-white"
          style={{ background: 'linear-gradient(135deg,#4b93ff,#2454cb)' }}
          aria-hidden
        >
          <LayoutGrid size={19} />
        </div>
        <div className="min-w-0">
          <strong className="block truncate text-[15px] tracking-tight text-white">{PRODUCT_NAME}</strong>
          <small className="block truncate text-[11px] text-[#91a4c0]">
            {t('th_ui.brand_tagline', { defaultValue: 'ระบบบริหารงานรับเหมาก่อสร้าง' })}
          </small>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ms-auto rounded-md p-1 text-[#91a4c0] hover:bg-white/10 lg:hidden"
            aria-label={t('common.close', { defaultValue: 'ปิด' })}
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="th-side-group -mb-3 px-2.5 text-[10px] font-semibold uppercase tracking-[1.3px]">
        {t('th_ui.nav.workspace', { defaultValue: 'Workspace' })}
      </div>

      <nav className="grid gap-1">
        {items.map((item) => {
          const active = matches(pathname, item);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.key}
              to={item.to}
              onClick={onClose}
              aria-current={active ? 'page' : undefined}
              className={clsx('th-side-link flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-[13.5px]', active && 'font-semibold')}
            >
              <Icon size={17} strokeWidth={1.9} className="shrink-0" aria-hidden />
              <span className="truncate">{t(`th_ui.nav.${item.key}`, { defaultValue: DEFAULT_LABELS[item.key] })}</span>
              {item.badge === 'approvals' && approvals > 0 && (
                <span className="ms-auto rounded-full bg-white/20 px-2 text-[11px] font-bold text-white">{approvals}</span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {isAdmin && (
        <NavLink
          to="/modules"
          onClick={onClose}
          className="th-side-link -mt-2 flex items-center gap-3 rounded-[9px] px-3 py-2 text-[12px]"
        >
          <LayoutGrid size={15} aria-hidden />
          {t('th_ui.nav.more_modules', { defaultValue: 'โมดูลเพิ่มเติม' })}
        </NavLink>
      )}

      <div className="th-side-card mt-auto flex items-center gap-2.5 rounded-[10px] p-3 text-xs">
        <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#dce8ff] text-xs font-bold text-[#2856a6]" aria-hidden>
          {(companyName || PRODUCT_NAME).slice(0, 2)}
        </div>
        <div className="min-w-0">
          <b className="block truncate text-white">
            {companyName || t('th_ui.company_placeholder', { defaultValue: 'ตั้งชื่อบริษัทในตั้งค่าระบบ' })}
          </b>
          <small className="text-[#93a5bf]">{t('th_ui.head_office', { defaultValue: 'สำนักงานใหญ่' })}</small>
        </div>
      </div>
    </aside>
  );
}

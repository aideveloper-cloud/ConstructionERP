/**
 * ConstructionERP ฉบับไทย — หน้าจอที่อยู่นอกขอบเขต
 *
 * คู่กับ backend/app/core/thai_edition.py: backend ไม่โหลดโมดูลเหล่านี้ (ไม่มี API)
 * ฝั่งหน้าจอจึงปิด path ของโมดูลนั้นด้วย เปิดหน้าเหล่านี้จะเห็นหน้า "ไม่มีในฉบับไทย"
 * แทนหน้าจอที่โหลดข้อมูลไม่ขึ้น ตั้ง VITE_ALL_MODULES=true เพื่อเปิดทุกหน้า
 * (ต้องตั้ง OE_ALL_MODULES=1 ฝั่ง backend คู่กัน)
 */
export const ALL_MODULES = import.meta.env.VITE_ALL_MODULES === 'true';

/** path ชั้นแรก (ไม่มี / นำหน้า) ของหน้าที่ปิดในฉบับไทย */
export const THAI_EDITION_BLOCKED_ROUTES: ReadonlySet<string> = new Set([
  // BIM / CAD / ถอดแบบ / ภูมิสารสนเทศ
  'bim', 'cad-explorer', 'cad-takeoff', 'data-explorer', 'model-review', 'clash', 'coordination', 'bcf',
  'geo', 'geo-hub', 'pointcloud', 'rebar-schedule', 'takeoff', 'takeoff-viewer', 'dwg-takeoff',
  'markups', 'match-elements', 'cost-match', 'quantities', 'sheets', 'plan-room',
  // ประมาณราคาเชิงลึก / ฐานราคาต่างประเทศ
  'assemblies', 'rom-estimate', 'estimate-basis', 'estimate-copilot', 'allowances', 'preliminaries',
  'formwork', 'waste-factors', 'norm-expansion', 'labor-rates', 'resource-summary', 'design-options',
  'postcalc', 'price-index', 'cost-explorer', 'costs',
  // AI
  'ai-agents', 'ai-estimate', 'ai-estimator', 'advisor', 'chat', 'find',
  // ระบบเอกสาร ISO 19650 / นำเข้า
  'cde', 'transmittals', 'connectors', 'inbound', 'inbound-email', 'correspondence',
  // บริหารต้นทุน/ความเสี่ยงแบบตะวันตก
  'full-evm', 'cvr', 'value', 'project-controls', 'project-intelligence', 'portfolio', 'risks',
  'risk-analysis', 'analytics',
  // งานเปลี่ยนแปลง / ข้อพิพาท (ใช้ /changeorders เป็นหลัก)
  'variations', 'moc', 'change-intelligence', 'claims-evidence', 'reconciliation', 'phone-log',
  // คุณภาพ / ความปลอดภัยขั้นสูง
  'qms', 'ncr', 'construction-control', 'hse-advanced', 'commissioning', 'temporary-works',
  'compliance', 'requirements', 'interface-management', 'site-supervision', 'site-prep',
  'site-logistics',
  // ซ้ำซ้อน
  'tendering', 'bid-management', 'workflows', 'schedule-advanced', 'takt', 'dashboards',
  'bi-dashboards', 'timeline', 'field-reports',
  // ชุดประเทศ / กฎหมายต่างประเทศ
  'certified-payroll', 'payment-clock', 'einvoice-clearance', 'funding', 'project-route',
  'authority-submissions', 'review-authority',
  // ESG / ธุรกิจอื่น
  'carbon', 'esg', 'prefab', 'accommodation', 'property-dev', 'buyer-portal',
  // เครื่องมือนักพัฒนา / สาธิต
  'pipelines', 'module-builder', 'architecture', 'cases', 'eac', 'validation', 'styles-lab',
  'videos', 'how-it-works', 'inside', 'governance',
]);

export function isBlockedInThaiEdition(pathname: string): boolean {
  if (ALL_MODULES) return false;
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return THAI_EDITION_BLOCKED_ROUTES.has(first);
}

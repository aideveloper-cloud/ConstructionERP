/**
 * ฉบับไทย (performance): กลุ่มคีย์คำแปลที่ตัดออกจาก bundle ตอน build
 *
 * locales/th.ts (7 MB) และ en.ts (3 MB) ถูกโหลดตั้งแต่หน้าแรก แต่เกือบครึ่งเป็น
 * ข้อความของโมดูลที่ฉบับไทยไม่ได้เปิด (BIM, AI, ESG ...) และคู่มือกระบวนการ
 * (cases/howto/tour) ที่ซ่อนอยู่ ปลั๊กอิน `thaiLocalePrune` ใน vite.config.ts ตัด
 * บรรทัดของคีย์ที่ขึ้นต้นด้วยกลุ่มด้านล่างออกตอน build/serve ไฟล์ต้นฉบับไม่ถูกแก้
 *
 * เกณฑ์เลือก: ไม่มีโค้ดนอกโฟลเดอร์ของโมดูลที่ตัดอ้างถึงคีย์กลุ่มนั้นเลย
 * (สแกนทั้ง src) ชื่อกลุ่มที่กว้างเกินไป (search, info, chat, hse ...) ไม่ใส่
 * แม้สแกนแล้วไม่พบ เพราะอาจถูกสร้างคีย์แบบ dynamic จากหน้าที่ยังใช้
 *
 * ตั้ง VITE_ALL_MODULES=true เพื่อปิดการตัดนี้ (ได้คำแปลครบเหมือนเดิม)
 * ไฟล์นี้ต้องไม่ import อะไรจากฝั่งเบราว์เซอร์ เพราะ vite.config.ts อ่านด้วย
 */
export const PRUNED_KEY_PREFIXES: readonly string[] = [
  // คู่มือกระบวนการ / ทัวร์ / หน้า How it works (ซ่อนในฉบับไทย)
  'cases', 'cases_for_module', 'howto', 'tour', 'processes', 'videos', 'modules_developer_guide',
  // AI
  'advisor', 'agents', 'ai-estimator', 'ai_estimate', 'aiest', 'copilot', 'erp_chat', 'retrieval',
  'qdrant_health',
  // BIM / CAD / ถอดแบบ / GIS
  'bcf', 'bim_federations', 'bim_requirements', 'cad_explorer', 'cad_takeoff', 'coordination',
  'coordination_hub', 'dwg_compare', 'geo', 'geo-hub', 'geoHub', 'geo_admin', 'geo_development',
  'geo_project', 'ifc', 'markups_compare', 'match', 'match-elements', 'match_progress', 'match_readiness',
  'match_wizard', 'pdf_compare', 'pdf_takeoff', 'pointcloud', 'quantities', 'sheetCompleteness',
  'smartViews', 'takeoff_compare', 'takeoff_create', 'takeoff_crosslink', 'takeoff_drift',
  'takeoff_viewer', 'takeoff_wall', 'cost_match',
  // ประมาณราคาเชิงลึก
  'allowances', 'assemblies_new', 'assembly', 'assembly_detail', 'assembly_library', 'benchmarks',
  'costExplorer', 'designOptions', 'estimate_rollup', 'laborRates', 'methodology', 'normExpansion',
  'preliminaries', 'pricingEngine', 'resourceSummary', 'romEstimate', 'waste_factors',
  // ต้นทุน/ความเสี่ยงแบบตะวันตก, BI
  'analytics', 'bi', 'cvr', 'dashboards', 'full_evm', 'project-controls', 'project_intelligence',
  'risk-analysis', 'value', 'leveling', 'takt', 'schedule_advanced', 'timeline',
  // งานเปลี่ยนแปลง / ข้อพิพาท / เอกสาร ISO
  'change_intelligence', 'claims_evidence', 'cost_recovery', 'reconciliation', 'phonelog',
  'connectors', 'inbound', 'inbound_email',
  // คุณภาพ / ความปลอดภัยขั้นสูง
  'commissioning', 'credentials', 'hse_advanced', 'requirements', 'siteLogistics', 'validation_rules',
  // ประมูล / ชุดประเทศ / ESG / ธุรกิจอื่น
  'bid_management', 'bid_portal', 'buyer_portal', 'buyer_portal_panel', 'einvoice_clearance',
  'payment_clock', 'carbon', 'esg', 'sustainability', 'prefab', 'accommodation', 'accommodation_detail',
  'propdev_bulk_ops', 'propdev_inventory_map', 'propdev_pricing',
  // เครื่องมือนักพัฒนา
  'architecture', 'governance', 'module_builder', 'pipeline', 'pipelines', 'styles_lab',
];

/** คีย์ที่ยังต้องเก็บแม้กลุ่มจะถูกตัด (ใช้ใน Header ทุกหน้า) */
export const PRUNE_KEEP_KEYS: ReadonlySet<string> = new Set(['howto.page_title', 'howto.menu_item']);

/** ตัดบรรทัด `"key": "value",` ของคีย์ที่อยู่ในกลุ่มที่ตัดออกจากซอร์ส locale */
export function pruneLocaleSource(code: string): { code: string; removed: number } {
  const prefixes = new Set(PRUNED_KEY_PREFIXES);
  let removed = 0;
  const out = code
    .split('\n')
    .filter((line) => {
      const m = /^\s*"([^"]+)":\s*".*",?\s*$/.exec(line);
      if (!m) return true;
      const key = m[1]!;
      if (PRUNE_KEEP_KEYS.has(key)) return true;
      if (prefixes.has(key.split('.')[0]!)) {
        removed++;
        return false;
      }
      return true;
    })
    .join('\n');
  return { code: out, removed };
}

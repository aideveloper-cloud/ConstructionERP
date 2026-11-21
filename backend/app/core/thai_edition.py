"""ConstructionERP ฉบับไทย — ขอบเขตโมดูลที่ใช้งาน

ฉบับไทยใช้เฉพาะโมดูลที่ตรงกับงานผู้รับเหมาไทย (BOQ/งบ, จัดซื้อ, คลัง, งวดงาน,
การเงิน, QC, เอกสาร, อนุมัติ) โมดูลในรายการด้านล่างจะ "ไม่ถูกโหลด" ตอนเริ่มระบบ:
ไม่มี API ไม่มีหน้าจอ แต่ไฟล์ยังอยู่ เพราะโมดูลที่ใช้งานบางตัวเรียกโค้ดของโมดูลเหล่านี้
โดยตรง (เช่น boq เรียกโค้ดของ takeoff/costs) การลบไฟล์ทิ้งจึงต้องแยกทำทีละตัว

กติกา:
- โมดูลที่ถูกตัดแต่มีโมดูลที่ใช้งานประกาศ ``depends`` ถึง จะยังถูกโหลดอัตโนมัติ
  (resolve_order เดินตาม depends เสมอ) ระบบจึงไม่ล่มเพราะขาด dependency
- ตั้ง ``OE_ALL_MODULES=1`` เพื่อโหลดครบทุกโมดูลแบบเดิม
- รายการต้องตรงกับ ``frontend/src/app/thai/editionScope.ts`` (ฝั่งหน้าจอ)
"""

from __future__ import annotations

import os

# ชื่อโฟลเดอร์ใต้ app/modules/ (ไม่มี prefix oe_)
THAI_EDITION_CUT_MODULES: frozenset[str] = frozenset(
    {
        # ชุดประเทศ / กฎหมายต่างประเทศ
        "asia_pac_pack",
        "china_pack",
        "dach_pack",
        "india_pack",
        "latam_pack",
        "mexico_pack",
        "middle_east_pack",
        "russia_pack",
        "sa_pack",
        "uk_pack",
        "us_ca_pack",
        "us_pack",
        "us_tx_pack",
        "certified_payroll",
        "payment_clock",
        "einvoice",
        "einvoice_clearance",
        "bimlv",
        "funding",
        "project_route",
        "authority_submission",
        "review_authority",
        # BIM / CAD / ถอดแบบ
        "cad",
        "bim_requirements",
        "clash",
        "clash_ai_triage",
        "clash_cost_impact",
        "coordination_hub",
        "smart_views",
        "bcf",
        "opencde_api",
        "pointcloud",
        "rebar_schedule",
        "takeoff",
        "dwg_takeoff",
        "markups",
        "match",
        "match_elements",
        "cost_match",
        # ประมาณราคาเชิงลึก
        "assemblies",
        "methodology",
        "rom_estimate",
        "estimate_basis",
        "estimate_rollup",
        "allowances",
        "preliminaries",
        "formwork",
        "waste_factors",
        "norm_expansion",
        "labor_rates",
        "resource_summary",
        "design_options",
        "postcalc",
        "price_index",
        "cost_explorer",
        "cost_plan",
        # AI / ค้นหาเชิงความหมาย
        "ai",
        "ai_agents",
        "ai_estimator",
        "erp_chat",
        "compliance_ai",
        "voice",
        "search",
        "retrieval",
        # ระบบเอกสาร ISO 19650 และช่องทางนำเข้า
        "cde",
        "transmittals",
        "file_transmittals",
        "file_distribution",
        "file_references",
        "record_publishing",
        "source_data",
        "inbound_email",
        "inbound_capture",
        "connectors",
        "file_approvals",
        "plan_room",
        # บริหารต้นทุน/ความเสี่ยงแบบตะวันตก
        "full_evm",
        "cvr",
        "value",
        "project_controls",
        "risk",
        "portfolio",
        "project_intelligence",
        # งานเปลี่ยนแปลง / ข้อพิพาท
        "moc",
        "change_intelligence",
        "claims_evidence",
        "reconciliation",
        "phonelog",
        "correspondence",
        "cost_recovery",
        # คุณภาพ / ความปลอดภัยขั้นสูง (ใช้ inspections + punchlist + safety แทน)
        "qms",
        "ncr",
        "construction_control",
        "hse_advanced",
        "commissioning",
        "temporary_works",
        "credentials",
        "compliance",
        "compliance_docs",
        "requirements",
        "interface_management",
        "site_supervision",
        "site_prep",
        "site_logistics",
        # ซ้ำซ้อน (เลือกใช้ตัวอื่นแล้ว)
        "tendering",
        "bid_management",
        "enterprise_workflows",
        "schedule_advanced",
        "dashboards",
        "bi_dashboards",
        "timeline",
        # ESG / ธุรกิจอื่น
        "carbon",
        "esg",
        "prefab",
        "accommodation",
        # หมายเหตุ: geo_hub (+ property_dev ที่มันต้องใช้) ยังโหลดอยู่ เพราะเป็นตัวให้บริการ
        # แผนที่ (basemap proxy) และค้นหาพิกัดจากที่อยู่ ให้หน้าโครงการ หน้าจอ geo-hub ยังปิดอยู่
        # เครื่องมือนักพัฒนา / ทดลอง
        "pipelines",
        "module_builder",
        "architecture_map",
        "cases",
        "eac",
        "validation",
        "collaboration_locks",
        "webhook_leads",
    }
)


def thai_edition_active() -> bool:
    """ปิดการตัดโมดูลได้ด้วย OE_ALL_MODULES=1"""
    return os.environ.get("OE_ALL_MODULES", "").strip().lower() not in {"1", "true", "yes"}


def is_cut(module_name: str) -> bool:
    """module_name เป็นชื่อใน manifest (มีหรือไม่มี prefix oe_ ก็ได้)"""
    return thai_edition_active() and module_name.removeprefix("oe_") in THAI_EDITION_CUT_MODULES

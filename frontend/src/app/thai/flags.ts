/**
 * ConstructionERP ฉบับไทย — สวิตช์เปิด/ปิดส่วนที่สืบทอดจาก OpenConstructionERP
 *
 * ฉบับไทยซ่อน widget/ปุ่มที่ไม่เกี่ยวกับงานรับเหมาไทย (AI ลอย, tour, What's new,
 * GitHub, 44 ภาษา ฯลฯ) แต่ไม่ลบโค้ด ตั้ง `VITE_UPSTREAM_EXTRAS=true` เพื่อเปิดกลับ
 * ทั้งหมด หรือ `VITE_LEGACY_NAV=true` เพื่อกลับไปใช้เมนูซ้ายเดิม 164 รายการ
 */
export const SHOW_UPSTREAM_EXTRAS = import.meta.env.VITE_UPSTREAM_EXTRAS === 'true';

export const USE_LEGACY_NAV = import.meta.env.VITE_LEGACY_NAV === 'true';

/** ภาษาที่ให้ผู้ใช้เลือกในฉบับไทย */
export const UI_LANGUAGE_CODES: readonly string[] = ['th', 'en'];

/** ชื่อระบบที่แสดงบนแท็บเบราว์เซอร์และเมนู เมื่อยังไม่ได้ตั้งชื่อบริษัท */
export const PRODUCT_NAME = 'ConstructionERP';

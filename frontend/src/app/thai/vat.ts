/**
 * ภาษีมูลค่าเพิ่ม (VAT) — คำนวณแบบเดียวกับ backend (procurement/service.py ``compute_vat``)
 *
 *   exclusive  ราคายังไม่รวม VAT → VAT = ฐาน × อัตรา, รวม = ฐาน + VAT
 *   inclusive  ราคารวม VAT แล้ว → ฐาน = รวม × 100 / (100 + อัตรา), VAT = รวม − ฐาน
 *   none       ไม่มี VAT
 *
 * ปัดเป็นสตางค์ (ครึ่งขึ้น) และ ฐาน + VAT = รวม เสมอ หน้าจอจึงแสดงตัวเลขเดียวกับที่บันทึก
 */
export type VatMode = 'exclusive' | 'inclusive' | 'none';

export const THAI_VAT_RATE = 7;

/** ปัดครึ่งขึ้นเป็นสตางค์ โดยทำงานเป็นจำนวนเต็มสตางค์เพื่อเลี่ยงทศนิยมลอยตัว */
const toCents = (v: number) => Math.round((v + Number.EPSILON) * 100);

export function computeVat(linesTotal: number, mode: VatMode, ratePercent: number) {
  const gross = toCents(linesTotal);
  const rate = Number.isFinite(ratePercent) && ratePercent > 0 ? ratePercent : 0;
  if (mode === 'inclusive' && rate > 0) {
    const net = Math.round((gross * 100) / (100 + rate));
    return { net: net / 100, vat: (gross - net) / 100, total: gross / 100 };
  }
  if (mode === 'exclusive' && rate > 0) {
    const vat = Math.round((gross * rate) / 100);
    return { net: gross / 100, vat: vat / 100, total: (gross + vat) / 100 };
  }
  return { net: gross / 100, vat: 0, total: gross / 100 };
}

/**
 * จำนวนเงินเป็นคำอ่านภาษาไทย (บาทถ้วน / สตางค์) สำหรับยอดรวมในเอกสาร
 *
 *   bahtText(1250.5)   → "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์"
 *   bahtText(21)       → "ยี่สิบเอ็ดบาทถ้วน"
 *   bahtText(1000000)  → "หนึ่งล้านบาทถ้วน"
 *
 * ปัดเป็นสตางค์ (2 ตำแหน่ง) ก่อนอ่าน ตามแบบที่ใช้บนใบสั่งซื้อ/ใบเสร็จ
 */
const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** อ่านเลข 0..999,999 (ไม่มีคำว่า "ล้าน") */
function readBelowMillion(n: number, afterMillion = false): string {
  if (n === 0) return '';
  // A trailing 1 right after "ล้าน" reads เอ็ด too: 1,000,001 = หนึ่งล้านเอ็ด.
  if (n === 1 && afterMillion) return 'เอ็ด';
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const place = s.length - i - 1;
    if (d === 0) continue;
    if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else if (place === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
    else out += (DIGITS[d] ?? '') + (PLACES[place] ?? '');
  }
  return out;
}

/** อ่านจำนวนเต็มไม่จำกัดหลัก โดยแบ่งเป็นช่วงละ 6 หลัก (ล้าน) */
function readInteger(n: bigint): string {
  if (n === 0n) return DIGITS[0]!;
  const groups: number[] = [];
  let rest = n;
  while (rest > 0n) {
    groups.unshift(Number(rest % 1_000_000n));
    rest /= 1_000_000n;
  }
  return groups
    .map((g, i) => {
      const isLast = i === groups.length - 1;
      // "หนึ่งล้าน" ไม่ใช่ "เอ็ดล้าน": กลุ่มที่มีค่าเท่ากับ 1 อ่านว่าหนึ่ง
      const words = g === 1 && !isLast ? 'หนึ่ง' : readBelowMillion(g, i > 0);
      return words + (isLast ? '' : g === 0 ? '' : 'ล้าน');
    })
    .join('')
    .replace(/(ล้าน)+$/, 'ล้าน');
}

export function bahtText(amount: number | string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '';
  const satangTotal = BigInt(Math.round(Math.abs(n) * 100));
  const baht = satangTotal / 100n;
  const satang = Number(satangTotal % 100n);
  const sign = n < 0 ? 'ลบ' : '';
  if (baht === 0n && satang === 0) return 'ศูนย์บาทถ้วน';
  const bahtPart = baht > 0n ? `${readInteger(baht)}บาท` : '';
  const satangPart = satang > 0 ? `${readBelowMillion(satang)}สตางค์` : 'ถ้วน';
  return sign + bahtPart + satangPart;
}

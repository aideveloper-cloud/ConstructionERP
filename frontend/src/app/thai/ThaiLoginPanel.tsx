/**
 * แผงขวาของหน้าเข้าสู่ระบบ (ฉบับไทย) — แทนคอลัมน์ marketing เดิม
 * บอกสั้นๆ ว่าระบบทำอะไรให้ผู้ใช้แต่ละฝ่าย ไม่มีลิงก์ออกนอกระบบ
 */
import { useTranslation } from 'react-i18next';
import { Banknote, CheckCircle2, ClipboardList, ShoppingCart } from 'lucide-react';
import { PRODUCT_NAME } from './flags';

export function ThaiLoginPanel() {
  const { t } = useTranslation();
  const points = [
    { icon: ClipboardList, title: t('th_ui.login.p1_title', { defaultValue: 'คุมงบตั้งแต่ BOQ' }), desc: t('th_ui.login.p1_desc', { defaultValue: 'เห็นงบ ผูกพัน และคงเหลือรายบรรทัดก่อนสั่งซื้อทุกครั้ง' }) },
    { icon: ShoppingCart, title: t('th_ui.login.p2_title', { defaultValue: 'จัดซื้อครบสาย' }), desc: t('th_ui.login.p2_desc', { defaultValue: 'ขอซื้อ เปรียบเทียบราคา สั่งซื้อ รับของ และตั้งหนี้ เชื่อมกันอัตโนมัติ' }) },
    { icon: Banknote, title: t('th_ui.login.p3_title', { defaultValue: 'งวดงานและการเงิน' }), desc: t('th_ui.login.p3_desc', { defaultValue: 'เบิกงวดผู้รับเหมา วางบิลเจ้าของงาน ภาษีหัก ณ ที่จ่าย และเงินประกันผลงาน' }) },
    { icon: CheckCircle2, title: t('th_ui.login.p4_title', { defaultValue: 'อนุมัติที่เดียว' }), desc: t('th_ui.login.p4_desc', { defaultValue: 'ผู้บริหารอนุมัติเอกสารทุกชนิดได้จากศูนย์อนุมัติ ทั้งบนคอมพิวเตอร์และมือถือ' }) },
  ];
  return (
    <div
      className="relative z-10 hidden flex-col justify-center gap-8 px-14 py-10 text-[#d7e1f1] lg:order-2 lg:flex xl:px-20"
      style={{ background: 'linear-gradient(160deg,#101d33 0%,#172943 60%,#0e192b 100%)' }}
    >
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[1.3px] text-[#6f9cff]">{PRODUCT_NAME}</div>
        <h2 className="mt-2 max-w-[22ch] text-[30px] font-bold leading-tight text-white">
          {t('th_ui.login.headline', { defaultValue: 'ระบบบริหารงานรับเหมาก่อสร้าง สำหรับธุรกิจไทย' })}
        </h2>
        <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-[#aebdd1]">
          {t('th_ui.login.sub', { defaultValue: 'BOQ งบประมาณ จัดซื้อ คลังวัสดุ งวดงาน และบัญชีการเงิน อยู่ในระบบเดียว ทุกฝ่ายเห็นข้อมูลชุดเดียวกัน' })}
        </p>
      </div>
      <ul className="grid max-w-[560px] gap-4">
        {points.map(({ icon: Icon, title, desc }) => (
          <li key={title} className="flex gap-3.5 rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#2f72e8] text-white"><Icon size={17} aria-hidden /></span>
            <span>
              <b className="block text-[14px] text-white">{title}</b>
              <span className="text-[12.5px] leading-relaxed text-[#aebdd1]">{desc}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

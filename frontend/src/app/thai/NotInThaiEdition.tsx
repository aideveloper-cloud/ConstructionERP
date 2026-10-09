/** หน้าที่แสดงเมื่อเปิด path ของโมดูลที่ไม่อยู่ในฉบับไทย */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PackageX } from 'lucide-react';

export function NotInThaiEdition() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto mt-16 max-w-[520px] rounded-xl border border-border-light bg-surface-primary p-8 text-center shadow-[0_4px_18px_#15294b08]">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-oe-blue-subtle text-oe-blue"><PackageX size={22} aria-hidden /></span>
      <h1 className="mt-4 text-lg font-bold text-content-primary">
        {t('th_ui.not_in_edition.title', { defaultValue: 'หน้านี้ไม่ได้เปิดใช้ในระบบ' })}
      </h1>
      <p className="mt-2 text-sm text-content-tertiary">
        {t('th_ui.not_in_edition.body', { defaultValue: 'ฟังก์ชันนี้ไม่อยู่ในขอบเขตของระบบบริหารงานรับเหมาก่อสร้างฉบับไทย หากต้องการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' })}
      </p>
      <Link to="/dashboard" className="mt-5 inline-block rounded-lg bg-oe-blue px-4 py-2 text-xs font-semibold text-white hover:bg-oe-blue-hover">
        {t('th_ui.not_in_edition.back', { defaultValue: 'กลับหน้าภาพรวม' })}
      </Link>
    </div>
  );
}

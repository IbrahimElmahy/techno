import { Segmented, Tooltip } from 'antd';
import { NUMERALS_LABELS, type Numerals, setNumerals, useNumerals } from '../utils/numerals';

/**
 * مفتاح شكل الأرقام — جنب ارتفاع الصف في قايمة المستخدم.
 *
 * مكانه هناك مش في شاشة «المستخدمين»: ده اختيار **صاحب العين**، زي ارتفاع الصف
 * بالظبط، ومحدش يقدر يختاره لحد غيره. وشاشة المستخدمين بيفتحها المدير عشان يعمل
 * حسابات لناس تانية — إعداد قراءة شخصي محطوط هناك بيبقى المدير هو اللي بيختار
 * لكل واحد إزاي يقرا.
 *
 * والتغيير بيبان في نفس اللحظة على كل جدول مفتوح: `App` مشترك في المخزن، فرندر
 * واحد بيعيد رسم الشجرة كلها من غير إعادة تحميل ومن غير ما التبويبات تتقفل.
 */
export default function NumeralsControl() {
  const numerals = useNumerals();
  return (
    <Tooltip title="شكل الأرقام المعروضة — في النظام كله. الخانات اللي بتكتب فيها بتفضل بالأرقام اللاتينية.">
      <Segmented
        size="small"
        value={numerals}
        onChange={(v) => setNumerals(v as Numerals)}
        options={[
          { value: 'arabic', label: NUMERALS_LABELS.arabic },
          { value: 'latin', label: NUMERALS_LABELS.latin },
        ]}
        {...{ 'aria-label': 'شكل الأرقام' }}
      />
    </Tooltip>
  );
}

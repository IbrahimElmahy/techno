import React from 'react';
import { InputNumber as AntInputNumber } from 'antd';
import type { InputNumberProps } from 'antd';

/**
 * خانة الأرقام — بتعرض عربي، وبتقبل اللي الإيد بتكتبه.
 *
 * الأرقام المعروضة في النظام كلها بقت عربية (`utils/money.ts`)، لكن الخانات فضلت لاتينية:
 * «٩٠٠٫٠٠» في عمود الإجمالي و«900.00» في خانة سعر الوحدة اللي جنبه على نفس السطر. الشكلين
 * جنب بعض على السطر الواحد هو أوحش مكان ممكن يحصل فيه الاختلاف — العين بتقارن رأسياً، وكل
 * مرة الشكل بيتغيّر بتتوقف.
 *
 * **وده مش بيكسر الكتابة.** الحل مش إننا نحشر أرقام عربية جوّه الخانة ونسيبها؛ ده كان
 * هيبوّظ التعديل. `formatter` بيحوّل المعروض لعربي، و`parser` بيرجّعه لاتيني قبل ما antd
 * تقراه — يعني اللي بيكتب على كيبورد لاتيني بيكتب `900` وبيشوف `٩٠٠`، واللي بيكتب على
 * كيبورد عربي بيكتب `٩٠٠` وبتتقرا صح. الاتنين بيوصلوا نفس الرقم.
 *
 * **من غير فاصلة آلاف.** `money()` بتحط `٬` في العرض لأن اللي بيقرا محتاجها؛ الخانة لأ،
 * لأن الفاصلة اللي بتتحرك تحت الإيد وهي بتكتب بتخلّي المؤشر يقفز.
 *
 * الملف ده بيتنده مكان `antd` في كل شاشة فيها أرقام، فالخانة اللي هتتكتب بكرة تمشي على
 * نفس القاعدة من غير ما حد يفتكر.
 */

const AR = '٠١٢٣٤٥٦٧٨٩';
/** الفاصلة العشرية العربية (U+066B) — دي اللي `ar-EG` بتستعملها. */
const AR_DECIMAL = '٫';

/** لاتيني ← عربي، للعرض. */
export const toArabicDigits = (s: string): string => s
  .replace(/[0-9]/g, (d) => AR[Number(d)])
  .replace(/\./g, AR_DECIMAL);

/** عربي (أو فارسي) ← لاتيني، عشان الرقم يتقرا. */
export const toLatinDigits = (s: string): string => s
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(new RegExp(AR_DECIMAL, 'g'), '.')
  // فاصلة الآلاف العربية لو حد لزقها من مكان تاني — بتتشال، مش بتتقرا كرقم.
  .replace(/٬/g, '');

/**
 * نفس `InputNumber` بتاعة antd بالظبط، بس بتعرض عربي.
 *
 * أي `formatter`/`parser` بيتبعتوا من بره بيكسبوا — الشاشة اللي عندها سبب تعرض بطريقة
 * تانية (نسبة، أو وحدة ملزوقة) مابتتفرضش عليها القاعدة دي.
 */
// `forwardRef` مش تفصيلة: في فاتورة المرتجع الشاشة بتمسك الخانة بـ`ref` عشان تنطّ للكمية
// اللي بعدها لما حد يدوس Enter. أي غلاف بياكل الـ`ref` بيقطع الطريق ده في صمت.
export const InputNumber = React.forwardRef<HTMLInputElement, InputNumberProps<any>>(
  ({ formatter, parser, ...rest }, ref) => (
    <AntInputNumber
      {...rest}
      ref={ref as any}
      formatter={formatter ?? ((v) => toArabicDigits(String(v ?? '')))}
      parser={parser ?? ((v) => toLatinDigits(String(v ?? '')) as any)}
    />
  ),
);
InputNumber.displayName = 'InputNumber';

export default InputNumber;

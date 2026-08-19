/**
 * التأكيدات اتشالت من النظام — بطلب صاحبه.
 *
 * الملف ده كان بيعرض بوباب «متأكد؟» قبل كل عكس وكل إقفال، وستاشر شاشة بتنادي عليه. صاحب
 * النظام شاف الرسايل دي وقال يشيلها كلها، فالداّلتين فضلوا بنفس الاسم والتوقيع وبينفّذوا على
 * طول — يعني ستاشر شاشة ماتغيّرش فيها سطر، والقرار كله في ملف واحد.
 *
 * **الحمايات الحقيقية مكانها السيرفر وهي فاضلة زي ما هي:** الحذف بيقفل مش بيمسح، والقيد
 * مابيتعدلش في مكانه والتصحيح عكس، والفترة المقفولة بترفض. اللي اتشال هو السؤال، مش الحارس.
 *
 * لو رجع يوم وقال «رجّعها» — بترجع من هنا.
 */
interface ConfirmParams {
  title?: string;
  content?: string;
  onOk: () => void | Promise<any>;
  onCancel?: () => void;
  okText?: string;
  cancelText?: string;
}

export function showReversalConfirm({ onOk }: ConfirmParams) {
  void onOk();
}

export function showDeactivationConfirm({ onOk }: ConfirmParams) {
  void onOk();
}

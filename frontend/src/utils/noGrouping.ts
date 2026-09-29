/**
 * **الأرقام من غير فاصل آلاف — العلامة العشرية بس.** (طلب العميل، ٢٠٢٦-٠٩-٢٩)
 *
 * «١٬٢٣٤٫٥٠» بقت «١٢٣٤٫٥٠». الفاصل كان بييجي من `toLocaleString` نفسها — وهي متندهة في
 * أكتر من ستين مكان في الشاشات والطباعة، غير اللي هيتكتب بكرة. فالتعديل هنا مرة واحدة:
 * أي `toLocaleString` على رقم بتبقى `useGrouping: false` لو اللي بينده ماقالش غير كده.
 *
 * التواريخ مش متأثرة — دي `Date.prototype.toLocaleString`، دالة تانية خالص.
 *
 * بيتحمّل أول حاجة في `main.tsx`، قبل أي شاشة.
 */
const original = Number.prototype.toLocaleString;

// eslint-disable-next-line no-extend-native
Number.prototype.toLocaleString = function toLocaleString(
  this: number,
  locales?: string | string[],
  options?: Intl.NumberFormatOptions,
) {
  return original.call(this, locales, { useGrouping: false, ...(options || {}) });
};

export {};

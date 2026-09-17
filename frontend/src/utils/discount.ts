/**
 * محرك الخصم — **المكان الوحيد اللي بيحسب فيه خصم في الفرونت**.
 *
 * أي شاشة بتخصم بتنده من هنا: الفواتير، المرتجعات، الطلبات، كارت الصنف. مافيش
 * `* (1 - pct/100)` مكتوبة في صفحة.
 *
 * ---------------------------------------------------------------------------
 * **الخصمين بيتطبقوا ورا بعض، مش بيتجمعوا.**
 *
 *     ١٠٪ وبعدها ٥٪  =  ١٤٫٥٪   مش ١٥٪
 *
 * التانية بتتحسب على اللي فضل بعد الأولى. ده مش اختيار جمالي — ده اللي a5 بيعمله،
 * واتقاس على سطوره:
 *
 *     ٨ × ١٦٦٫٢٥ بخصم ١٠٪ ثم ٥٪  →  ١٬١٣٧٫١٥   ← الرقم اللي على فاتورتهم
 *     نفس السطر بالجمع (١٥٪)      →  ١٬١٣٠٫٥٠   ← فرق ٦٫٦٥ على سطر واحد
 *
 * **والناتج نسبة واحدة** لأن سطر الفاتورة عنده خانة خصم واحدة — بس محسوبة بالتركيب.
 *
 * **السقف ٩٩٫٩٩٪.** خصم ١٠٠٪ معناه سطر بصفر، ودي حاجة تتعمل بمسح السطر مش بخصم.
 *
 * ⚠️ **والقاعدة دي مكتوبة تلات مرات، مرة لكل لغة** — مافيش طريقة تشارك كود بين
 * TypeScript وPython وDart. التانيتين:
 *
 *     backend/src/lib/discounts.py
 *     mobile/lib/models/discount.dart
 *
 * أي تعديل هنا لازم يتعمل في التلاتة، والمثال اللي فوق (١٬١٣٧٫١٥) مكتوب في التلاتة
 * عشان أي واحدة تفرق تبان في أول قياس.
 */

/** أعلى خصم مسموح. شوف الشرح فوق. */
export const MAX_DISCOUNT_PCT = 99.99;

const pct = (v: unknown): number => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 100 ? 100 : n;
};

/** تقريب على منزلتين — `discount_pct` في القاعدة `Numeric(5,2)`. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * خصمين (أو أكتر) ورا بعض → نسبة واحدة مكافئة.
 *
 *     combineDiscounts(10, 5)   → 14.5
 *     combineDiscounts(25, 10)  → 32.5
 *     combineDiscounts(10)      → 10
 *     combineDiscounts()        → 0
 */
export function combineDiscounts(...percentages: unknown[]): number {
  const remaining = percentages.reduce<number>((acc, p) => acc * (1 - pct(p) / 100), 1);
  return Math.min(MAX_DISCOUNT_PCT, round2(100 * (1 - remaining)));
}

/**
 * المبلغ بعد الخصمين — بيستعمل [combineDiscounts] عشان الرقم يطابق المخزّن.
 *
 *     applyDiscounts(1330, 10, 5)  → 1137.15
 */
export function applyDiscounts(amount: unknown, ...percentages: unknown[]): number {
  return Number(amount ?? 0) * (1 - combineDiscounts(...percentages) / 100);
}

/**
 * المبلغ بعد نسبة خصم **واحدة جاهزة** — للسطر اللي خصمه متخزّن مركّب خلاص.
 *
 * نفس حساب `applyDiscounts(amount, p)`، والاسم بيفرّق عشان اللي بيقرا الكود يعرف
 * هو بيركّب نِسب ولا بيطبّق نسبة اتحسبت قبل كده.
 */
export function netOf(amount: unknown, percentage: unknown): number {
  return Number(amount ?? 0) * (1 - pct(percentage) / 100);
}

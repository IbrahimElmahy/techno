/**
 * الخصم بعد الخصم — نفس قاعدة `backend/src/lib/discounts.py` بالظبط.
 *
 * الشاشة لازم تطلع نفس رقم السيرفر وإلا اللي بيكتب الفاتورة بيشوف إجمالي، وبيتطبع
 * له إجمالي تاني. عشان كده القاعدة مكتوبة هنا مرة واحدة، مش في كل شاشة:
 *
 *     ١٠٠ × (١ − ٠٫١٠) × (١ − ٠٫٠٥) = ٨٥٫٥٠     ← الفعلي ١٤٫٥٪
 *     ١٠٠ − (١٠٪ + ٥٪)              = ٨٥٫٠٠     ← الجمع الغلط
 *
 * `combinePct` للعرض بس («خصم ١٤٫٥٪»)؛ المبلغ بيتحسب من `applyPct` بالنِسَب
 * الأصلية عشان التقريب مايتراكمش.
 */

const num = (v: unknown) => Number(v || 0);

/** الباقي بعد النِسَب ورا بعض — ٢٠٪ ثم ١٠٪ بترجع ٠٫٧٢. */
export function remainingFactor(...pcts: Array<number | string | null | undefined>) {
  return pcts.reduce<number>((out, p) => out * (1 - num(p) / 100), 1);
}

/** النسبة الفعلية للخصومات مع بعض — ١٠ و٥ = ١٤٫٥. */
export function combinePct(...pcts: Array<number | string | null | undefined>) {
  return (1 - remainingFactor(...pcts)) * 100;
}

/** المبلغ بعد الخصومات ورا بعض. */
export function applyPct(amount: number | string | null | undefined,
                         ...pcts: Array<number | string | null | undefined>) {
  return num(amount) * remainingFactor(...pcts);
}

/** أعلى خصم مسموح. ١٠٠٪ معناها سطر بصفر، ودي حاجة تتعمل بمسح السطر مش بخصم. */
export const MAX_DISCOUNT_PCT = 99.99;

/**
 * المبلغ بعد نسبة خصم **واحدة جاهزة** — للسطر اللي خصمه متخزّن مركّب خلاص.
 *
 * مش نفس `applyPct(amount, pct)` في المعنى وإن كان نفس الحساب: دي بتقول «النسبة دي
 * محسوبة خلاص، طبّقها»، والتانية بتقول «ركّب النِسب دي وطبّقها».
 */
export function netOf(amount: number | string | null | undefined,
                      pct: number | string | null | undefined): number {
  return applyPct(amount, pct);
}

/**
 * نصّي خصم سطر محفوظ — للشاشات اللي خانة المتغيّر فيها اسمها `discount_pct`
 * (الشرا ومردوده ومردود البيع).
 *
 * كانت بتحط المركّب كله في خانة «متغيّر» و«ثابت» فاضي، فالسطر اللي اتحفظ بخصم ثابت ١٠
 * بيرجع «متغيّر ١٠». السيرفر بقى بيحفظ النصّين؛ السطر القديم اللي مالوش قسمة (الاتنين
 * `null`) بيفضل زي ما كان: المركّب في المتغيّر.
 */
export function splitLineDiscount(l: {
  discount_pct?: unknown; fixed_discount_pct?: unknown; variable_discount_pct?: unknown;
}): { discount_pct: number | null; fixed_discount_pct: number | null } {
  const has = (v: unknown) => v !== null && v !== undefined && v !== '';
  if (has(l.fixed_discount_pct) || has(l.variable_discount_pct)) {
    return {
      discount_pct: Number(l.variable_discount_pct || 0) || null,
      fixed_discount_pct: Number(l.fixed_discount_pct || 0) || null,
    };
  }
  return {
    discount_pct: has(l.discount_pct) ? Number(l.discount_pct) : null,
    fixed_discount_pct: null,
  };
}

/** أسماء قديمة — الملف `utils/discount.ts` اتشال، ودول عشان اللي بيستورده مايتكسرش. */
export const combineDiscounts = combinePct;
export const applyDiscounts = applyPct;

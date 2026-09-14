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

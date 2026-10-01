import { flashExistingItem } from './duplicateItem';

/**
 * نتيجة إضافة صنف واحد من شباك الأصناف.
 *
 * `needsQty` = مفتاح سطر **جديد** كميته لسه فاضية (المؤشر يروح له). `dup` = الصنف كان
 * موجود على المستند أصلاً.
 */
export type PickResult = { needsQty?: string | number; dup?: number } | void | null;

/**
 * إضافة كذا صنف من الشباك — **واحد ورا التاني**، كل إضافة بتستنى اللي قبلها.
 *
 * وبعدها المؤشر بيروح لكمية أول سطر جديد ماتكتبلوش كمية، عشان اللي سايب الكميات للآخر
 * يكتبها نازل سطر سطر. كله اتكتب ⇒ مافيش حاجة تتمسك. ولو مافيش ولا سطر جديد (كلهم
 * كانوا موجودين) بيتعلّم أول واحد منهم — نفس اللي بيحصل للاختيار المكرر لوحده.
 */
export async function addPickedSequentially(
  ids: number[],
  qtys: Record<number, number> | undefined,
  add: (id: number, qty: number | null) => PickResult | Promise<PickResult>,
  focus: (key: any) => void,
): Promise<void> {
  let first: string | number | null = null;
  let dup: number | null = null;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const r = await add(id, qtys?.[id] ?? null);
    if (r?.needsQty != null && first == null) first = r.needsQty;
    if (r?.dup != null && dup == null) dup = r.dup;
  }
  if (first != null) focus(first);
  else if (dup != null) flashExistingItem(dup);
}

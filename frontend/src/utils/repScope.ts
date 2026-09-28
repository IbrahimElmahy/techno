/**
 * عملاء المندوب — لما فلتر «المندوب» يتختار، فلتر «العميل» جنبه بيعرض عملاءه هو بس.
 *
 * من غيرها اللي اختار مندوب ويدوّر على عميل بيقلّب في ٣٠٠٠ اسم، ويختار عميل مش بتاع
 * المندوب فالكشف يطلع فاضي من غير ما يعرف ليه. المندوب فاضي ⇒ كل العملاء.
 */
export function customersOfRep<T extends { rep_id?: number | null }>(
  customers: T[], repId?: number | null,
): T[] {
  return repId ? customers.filter((c) => c.rep_id === repId) : customers;
}

/**
 * العميل المختار لسه من عملاء المندوب؟ — لو المندوب اتغيّر والعميل مش بتاعه، الفلتر
 * بيتفضّى بدل ما يفضل مختار عميل مخفي من القايمة والكشف يطلع فاضي.
 */
export function customerFitsRep<T extends { id: number; rep_id?: number | null }>(
  customers: T[], customerId?: number | null, repId?: number | null,
): boolean {
  if (!customerId || !repId) return true;
  const c = customers.find((x) => x.id === customerId);
  return !c || c.rep_id === repId;
}

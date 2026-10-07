/**
 * المناديب في المنتقيات — **الموقوف مايظهرش** (طلب العميل ٢٠٢٦-١٠-٠٧).
 *
 * «إيقاف» المندوب من شاشة المناديب بيقفل دخوله على التطبيق (السيرفر بيرفض أي طلب
 * بجلسته)، بس `/api/v1/users` بيرجّع الكل — فكان لسه بيتختار على فاتورة أو عميل أو
 * في فلتر تقرير.
 *
 * `keep`: المندوب المتسجّل على مستند قديم بيفضل في القايمة بعلامة «موقوف» — من غيره
 * المنتقي بيعرض رقمه بدل اسمه لما المستند يتفتح.
 */
export interface RepLike {
  id: number;
  full_name?: string | null;
  username?: string | null;
  active?: boolean;
}

export const isStopped = (r: RepLike) => r.active === false;

export function repChoices<T extends RepLike>(reps: T[], keep?: number | null): T[] {
  return reps.filter((r) => !isStopped(r) || (keep != null && r.id === keep));
}

export function repOptions(reps: RepLike[], keep?: number | null) {
  return repChoices(reps, keep).map((r) => ({
    value: r.id,
    label: `${r.full_name || r.username || r.id}${isStopped(r) ? ' (موقوف)' : ''}`,
  }));
}

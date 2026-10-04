import { useMemo } from 'react';
import { useAuth } from '../components/AuthProvider';

/**
 * فصل الفروع — «حاجات الفرع ده» في مكان واحد.
 *
 * السيرفر هو الحارس (`org_service.assert_same_branch`): مستند الفرع مايستخدمش مخزن ولا
 * خزنة ولا عميل ولا مندوب من فرع تاني. الشاشة هنا راحة مش حماية — بتعرض حاجات فرع المستند
 * بس عشان اللي بيكتب مايختارش حاجة هتترفض وقت الحفظ.
 *
 * * موظف الفرع: فرعه هو، دايماً (السيرفر كمان بيرجّعله قوايم فرعه).
 * * الأدمن/المالك: فرع المستند = فرع المخزن اللي اختاره. قبل ما يختار، القوايم كلها.
 * * اللي مالوش فرع (`branch_id` فاضي) مشترك — بيظهر في كل الفروع.
 */

export interface Branchy {
  branch_id?: number | null;
}

/** الخزنة/الصندوق: ليه فرع، وممكن يكون متوجّه كخزنة عامة لفروع تانية. */
export interface CashBranchy extends Branchy {
  routed_branch_ids?: number[] | null;
}

export function isAdminRole(role?: string | null): boolean {
  return role === 'system_admin' || role === 'owner';
}

/** الصف ده من الفرع ده؟ فرع فاضي في أي طرف = مشترك/مش متحدد ⇒ أيوه. */
export function inBranch(row: Branchy | null | undefined, branchId?: number | null): boolean {
  if (!branchId || !row) return true;
  return row.branch_id == null || row.branch_id === branchId;
}

export function inBranchCash(row: CashBranchy | null | undefined, branchId?: number | null): boolean {
  if (!branchId || !row) return true;
  return inBranch(row, branchId) || (row.routed_branch_ids || []).includes(branchId);
}

export function filterBranch<T extends Branchy>(rows: T[], branchId?: number | null): T[] {
  return branchId ? rows.filter((r) => inBranch(r, branchId)) : rows;
}

export function filterBranchCash<T extends CashBranchy>(rows: T[], branchId?: number | null): T[] {
  return branchId ? rows.filter((r) => inBranchCash(r, branchId)) : rows;
}

/**
 * فرع المستند وأدوات الفلترة بتاعته.
 *
 * `chosen` = الفرع اللي المستند اتحدد عليه من الشاشة — غالباً فرع مخزن المستند
 * (`branchOf(warehouses, warehouseId)`). موظف الفرع بيتجاهله ويفضل على فرعه.
 */
export function useBranchScope(chosen?: number | null) {
  const { user } = useAuth();
  const admin = isAdminRole(user?.role);
  const bound = !admin && user?.branch_id ? user.branch_id : null;
  const branchId = bound ?? chosen ?? null;
  return useMemo(() => ({
    /** فرع المستند — `null` = لسه مااتحددش (أدمن قبل ما يختار مخزن). */
    branchId,
    /** فرع الموظف لو محبوس فيه. */
    bound,
    isAdmin: admin,
    keep: <T extends Branchy>(rows: T[]) => filterBranch(rows, branchId),
    keepCash: <T extends CashBranchy>(rows: T[]) => filterBranchCash(rows, branchId),
    has: (row: Branchy | null | undefined) => inBranch(row, branchId),
  }), [branchId, bound, admin]);
}

/** فرع مخزن بالرقم من قايمة المخازن المحمّلة. */
export function branchOf(rows: Array<{ id: number; branch_id?: number | null }>,
  id?: number | null): number | null {
  if (id == null) return null;
  return rows.find((r) => r.id === id)?.branch_id ?? null;
}

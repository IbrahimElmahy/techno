import { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * شجرة فئات الأصناف — فئة رئيسية ← فئة فرعية ← أصناف. (031)
 *
 * الفئة بقى ليها **أب اختياري** (`parent_value` على صف القايمة). الفرع اللي ما عملش
 * شجرة كل فئاته أبوها `null`، و`hasTree` بترجع `false`، وكل اللي بيقرا من هنا بيرسم
 * نفس القايمة المسطّحة اللي كانت — بالحرف.
 *
 * **بيتحمّل مرة واحدة للتبويب كله.** القايمة دي بتتقري من منتقي الأصناف اللي بيتفتح
 * في كل شاشة مستند، ومن كارت الصنف، ومن الكتالوج — يعني نداء لكل مكوّن كان هيبقى
 * أربع نداءات على نفس الأربعين صف في الشاشة الواحدة. الوعد متخزّن هنا، فاللي بيطلبه
 * تاني بياخد نفس النسخة من غير شبكة.
 *
 * `invalidateCategoryTree()` بتترمي بعد أي تعديل من شاشة الفئات — من غيرها الفئة
 * الجديدة مابتظهرش في المنتقي غير بعد ريفرش، واللي أضافها يقول إنها ماتسجّلتش.
 */

export interface CategoryTree {
  /** القيمة ← الاسم المعروض. */
  labels: Record<string, string>;
  /** القيمة ← قيمة أبوها. الفئة الرئيسية مش موجودة هنا أصلاً. */
  parentOf: Record<string, string>;
  /** قيمة الأب ← فروعه بترتيب القايمة. */
  childrenOf: Record<string, string[]>;
  /** الفئات اللي مالهاش أب، بترتيب القايمة. */
  roots: string[];
  /** فيه فئة واحدة على الأقل ليها أب؟ لو لأ، الشاشة بترسم المسطّح زي ما كان. */
  hasTree: boolean;
}

export const EMPTY_TREE: CategoryTree = {
  labels: {}, parentOf: {}, childrenOf: {}, roots: [], hasTree: false,
};

/** الفئة الرئيسية لقيمة — هي نفسها لو مالهاش أب. خطوة واحدة، الشجرة مستويين. */
export function rootOf(tree: CategoryTree, value: string | null | undefined): string | null {
  if (!value) return null;
  return tree.parentOf[value] || value;
}

/** القيمة ومعاها فروعها — اللي بيختار رئيسية بيقصد كل اللي تحتها. */
export function withChildren(tree: CategoryTree, value: string): string[] {
  return [value, ...(tree.childrenOf[value] || [])];
}

function build(rows: any[]): CategoryTree {
  const labels: Record<string, string> = {};
  const parentOf: Record<string, string> = {};
  const childrenOf: Record<string, string[]> = {};
  const roots: string[] = [];
  rows.forEach((r) => { labels[r.value] = r.label; });
  rows.forEach((r) => {
    // أب مأشّر على فئة مش موجودة بيتعامل كأنه مافيش أب. السيرفر بيمنع ده، بس الشاشة
    // اللي بتصدّق أي قيمة نازلة بتوقّع فئة من القايمة بالكامل — والفئة اللي مابتظهرش
    // معناها أصناف مالهاش طريق.
    const parent = r.parent_value && labels[r.parent_value] ? r.parent_value : null;
    if (parent) {
      parentOf[r.value] = parent;
      (childrenOf[parent] = childrenOf[parent] || []).push(r.value);
    } else {
      roots.push(r.value);
    }
  });
  return { labels, parentOf, childrenOf, roots, hasTree: Object.keys(parentOf).length > 0 };
}

export interface CategoryOption { value: string; label: string }
export type CategorySelectOption =
  | CategoryOption
  | { label: string; title: string; options: CategoryOption[] };

/**
 * خيارات قايمة منسدلة مرتّبة كشجرة — الرئيسية عنوان مجموعة وفروعها تحتها.
 *
 * **القيمة المتخزّنة ما اتغيّرتش**: الاختيار لسه بيرجّع `value` نص زي ما كان، فالصنف
 * اللي متسجّل على فئة قبل الشجرة بيفضل عليها من غير أي لمس.
 *
 * والرئيسية **موجودة كاختيار جوّه مجموعتها** مش عنوان وبس: فيه أصناف متعلّقة عليها
 * فعلاً من قبل ما تتعمل رئيسية، ولو شيلناها من القايمة الكارت بتاعهم كان هيفتح على
 * خانة بتعرض القيمة الخام (`مواسير_PVC`) ومش عارف يحفظها تاني.
 *
 * ولو مافيش شجرة بترجّع نفس القايمة المسطّحة اللي دخلت — نفس الترتيب ونفس الشكل.
 */
export function categorySelectOptions(
  tree: CategoryTree, options: CategoryOption[],
): CategorySelectOption[] {
  if (!tree.hasTree) return options;
  const byValue = new Map(options.map((o) => [o.value, o]));
  const out: CategorySelectOption[] = [];
  const done = new Set<string>();
  options.forEach((o) => {
    const parent = tree.parentOf[o.value];
    // الفرع بيتحط مع أبوه. ولو الأب مخفي (مش في القايمة) بيتحط لوحده بدل ما يختفي —
    // فئة موجودة على أصناف ومش ظاهرة في المنسدلة معناها صنف مالوش طريق يتصحّح.
    if (parent && byValue.has(parent)) return;
    if (done.has(o.value)) return;
    done.add(o.value);
    const kids = (tree.childrenOf[o.value] || [])
      .map((v) => byValue.get(v))
      .filter(Boolean) as CategoryOption[];
    if (!kids.length) { out.push(o); return; }
    kids.forEach((k) => done.add(k.value));
    out.push({ label: o.label, title: o.label, options: [o, ...kids] });
  });
  return out;
}

let cached: Promise<CategoryTree> | null = null;

function load(): Promise<CategoryTree> {
  if (!cached) {
    cached = api
      .get('/api/v1/settings/lookups', { params: { category: 'item_category' } })
      .then((res) => build(res.data || []))
      .catch(() => {
        // الشجرة مالهاش fallback: القوايم نفسها عندها واحد في `useLookup`، واللي
        // مالوش شجرة عايش على المسطّح أصلاً. بنرجّع فاضية عشان الشاشة تكمّل مسطّحة
        // بدل ما تقع — ومابنخزّنش الفشل عشان النداء الجاي يحاول تاني.
        cached = null;
        return EMPTY_TREE;
      });
  }
  return cached;
}

/** بتترمي بعد أي إضافة/تعديل/حذف في شاشة الفئات. */
export function invalidateCategoryTree(): void {
  cached = null;
}

export function useCategoryTree(): { tree: CategoryTree; loading: boolean } {
  const [tree, setTree] = useState<CategoryTree>(EMPTY_TREE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    load().then((t) => {
      if (cancelled) return;
      setTree(t);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { tree, loading };
}

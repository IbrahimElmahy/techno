/**
 * الشجرة: قسم أبوه مش ظاهر لازم يفضل باين.
 *
 * The tree is built client-side from a flat list, and the list is filtered before it is built —
 * by a search box and by a «الشغّالة / المقفولة» switch. So a child whose parent did not survive
 * the filter is routine, not exotic: search «القاهرة» and the parent «المبيعات» is gone.
 *
 * The obvious implementation attaches each row to `byId.get(parent_id)` and drops it when that
 * misses. What the user sees then is a department that is simply not there — no message, no
 * count, nothing to click. Orphans hang at the root instead.
 */
import { describe, expect, it } from 'vitest';

import { toTree } from './Departments';

const row = (id: number, name: string, parent_id: number | null = null) => ({
  id, name, parent_id,
  code: `DEP-00${id}`, parent_name: null, manager_employee_id: null, manager_name: null,
  cost_center_id: null, branch_id: null, active: true, notes: null, employee_count: 0,
});

describe('toTree', () => {
  it('بيحط الابن تحت أبوه', () => {
    const tree = toTree([row(1, 'المبيعات'), row(2, 'مبيعات القاهرة', 1)]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('المبيعات');
    expect(tree[0].children?.map((c) => c.name)).toEqual(['مبيعات القاهرة']);
  });

  it('قسم أبوه اتفلتر بيفضل ظاهر في الجذر مش بيختفي', () => {
    // «المبيعات» is not in the list — the search that produced it did not match the parent.
    const tree = toTree([row(2, 'مبيعات القاهرة', 1)]);
    expect(tree.map((t) => t.name)).toEqual(['مبيعات القاهرة']);
  });

  it('بيحافظ على كل صف — مفيش حاجة بتضيع', () => {
    const rows = [row(1, 'أ'), row(2, 'ب', 1), row(3, 'ج', 2), row(4, 'د', 99)];
    const count = (nodes: any[]): number =>
      nodes.reduce((n, x) => n + 1 + count(x.children ?? []), 0);
    expect(count(toTree(rows))).toBe(4);
  });

  it('بيوصل لتلات مستويات', () => {
    const tree = toTree([row(1, 'أ'), row(2, 'ب', 1), row(3, 'ج', 2)]);
    expect(tree[0].children?.[0].children?.[0].name).toBe('ج');
  });

  it('قايمة فاضية بترجع شجرة فاضية', () => {
    expect(toTree([])).toEqual([]);
  });

  it('مابيعدّلش الصفوف الأصلية', () => {
    const rows = [row(1, 'أ'), row(2, 'ب', 1)];
    toTree(rows);
    expect((rows[0] as any).children).toBeUndefined();
  });
});

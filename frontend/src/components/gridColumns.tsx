import React from 'react';
import { Button, InputNumber, Space } from 'antd';
import { normalizeAr } from './ListToolbar';

/**
 * أعمدة بتتفلتر وبتتترتب — الأساس اللي جداول الجرد قايمة عليه.
 *
 * A search box above a table answers one question: «فين الصنف ده». It cannot answer «وريني خامات
 * مخزن الفرع اللي قيمتها فوق الألف», which is the question a stocktake is actually read for — and
 * which needs **three columns filtered at once**.
 *
 * So the filtering moves onto the columns, where each one narrows the rows independently and the
 * narrowings combine. Written once here rather than per screen: five stocktake grids each growing
 * their own filter logic is five places for «lower-case matching» or «Arabic hamza» to be got
 * subtly differently.
 *
 * Arabic matching goes through `normalizeAr`, the same fold the search boxes use, so «مؤسسه» finds
 * «مؤسسة» in a column filter exactly as it does in a search box.
 */

/** Every distinct value in a column, as antd's filter list. */
function distinct<T>(rows: T[], get: (row: T) => any): { text: string; value: string }[] {
  const seen = new Map<string, string>();
  rows.forEach((r) => {
    const raw = get(r);
    const key = raw === null || raw === undefined || raw === '' ? '' : String(raw);
    if (!seen.has(key)) seen.set(key, key || '(فاضي)');
  });
  return [...seen.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ar'))
    .map(([value, text]) => ({ text, value }));
}

/**
 * A categorical column: pick one or several values, with a search box once the list is long.
 *
 * `(فاضي)` is offered as a value of its own. A blank category is a real answer — «الأصناف اللي
 * محدش صنّفها» is a list somebody needs — and dropping it would make those rows unreachable.
 */
export function textColumn<T>(rows: T[], get: (row: T) => any) {
  return {
    filters: distinct(rows, get),
    filterSearch: distinct(rows, get).length > 8,
    onFilter: (value: any, row: T) => {
      const raw = get(row);
      const key = raw === null || raw === undefined || raw === '' ? '' : String(raw);
      return key === value;
    },
    sorter: (a: T, b: T) =>
      normalizeAr(get(a)).localeCompare(normalizeAr(get(b)), 'ar'),
  };
}

/** A numeric column: sorted, and filterable by a range. */
export function numberColumn<T>(get: (row: T) => any) {
  return {
    sorter: (a: T, b: T) => Number(get(a) || 0) - Number(get(b) || 0),
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => {
      const [min, max] = (selectedKeys[0] as (number | null)[] | undefined) ?? [null, null];
      const set = (next: (number | null)[]) =>
        setSelectedKeys(next[0] === null && next[1] === null ? [] : [next]);
      return (
        <div style={{ padding: 10 }} onKeyDown={(e) => e.stopPropagation()}>
          <Space direction="vertical" size={8}>
            <Space>
              <InputNumber placeholder="من" value={min as any} style={{ width: 110 }}
                onChange={(v) => set([v as number | null, max])} />
              <InputNumber placeholder="إلى" value={max as any} style={{ width: 110 }}
                onChange={(v) => set([min, v as number | null])} />
            </Space>
            <Space>
              <Button type="primary" size="small" onClick={() => confirm()}>تصفية</Button>
              <Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>مسح</Button>
            </Space>
          </Space>
        </div>
      );
    },
    onFilter: (value: any, row: T) => {
      const [min, max] = (value as (number | null)[]) ?? [null, null];
      const n = Number(get(row) || 0);
      // A bound left empty is «no bound», not zero — «إلى ١٠٠» must not silently become «من ٠».
      if (min !== null && min !== undefined && n < min) return false;
      if (max !== null && max !== undefined && n > max) return false;
      return true;
    },
  };
}

/**
 * A column of a few fixed states — counted / not counted, matching / differing.
 *
 * Separate from `textColumn` because the options are known in advance and should appear even when
 * no row currently has that state: a filter list that changes shape as rows come and go is one
 * people stop trusting.
 */
export function choiceColumn<T>(
  choices: { text: string; value: string }[], match: (row: T, value: string) => boolean,
) {
  return {
    filters: choices,
    onFilter: (value: any, row: T) => match(row, String(value)),
  };
}

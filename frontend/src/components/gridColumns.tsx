import React from 'react';
import { Button, DatePicker, InputNumber, Space } from 'antd';
import dayjs from 'dayjs';
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
 * A date column: sorted, and filterable by a period.
 *
 * A date is not a number and not a name. Offering its distinct values as a checklist gives one
 * entry per day — useless past a week of data — and a min/max number box asks somebody to type a
 * timestamp. What is actually wanted is «من ١ لـ ١٥», so that is what it asks for.
 *
 * Values are compared as `YYYY-MM-DD` strings rather than as parsed dates. Every date on these
 * screens arrives as ISO text, string comparison on that format sorts and ranges correctly, and it
 * cannot drift by a timezone the way `new Date(...)` does on a bare date.
 */
export function dateColumn<T>(get: (row: T) => any) {
  const day = (row: T): string => String(get(row) ?? '').slice(0, 10);
  return {
    sorter: (a: T, b: T) => day(a).localeCompare(day(b)),
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => {
      const [from, to] = (selectedKeys[0] as (string | null)[] | undefined) ?? [null, null];
      const set = (next: (string | null)[]) =>
        setSelectedKeys(!next[0] && !next[1] ? [] : [next]);
      return (
        <div style={{ padding: 10 }} onKeyDown={(e) => e.stopPropagation()}>
          <Space direction="vertical" size={8}>
            <DatePicker.RangePicker
              allowEmpty={[true, true]} style={{ width: 250 }}
              placeholder={['من', 'إلى']}
              value={[from ? dayjs(from) : null, to ? dayjs(to) : null] as any}
              onChange={(v: any) => set([
                v?.[0] ? v[0].format('YYYY-MM-DD') : null,
                v?.[1] ? v[1].format('YYYY-MM-DD') : null,
              ])}
            />
            <Space>
              <Button type="primary" size="small" onClick={() => confirm()}>تصفية</Button>
              <Button size="small" onClick={() => { clearFilters?.(); confirm(); }}>مسح</Button>
            </Space>
          </Space>
        </div>
      );
    },
    onFilter: (value: any, row: T) => {
      const [from, to] = (value as (string | null)[]) ?? [null, null];
      const d = day(row);
      // A row with no date is excluded once a period is asked for: «إيه اللي حصل في يناير» is not
      // answered by a row that never said when it happened.
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
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

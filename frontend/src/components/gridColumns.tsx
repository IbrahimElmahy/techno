import React from 'react';
import {
  Button, DatePicker, Space,
} from 'antd';
import { InputNumber } from './NumberInput';
import dayjs from 'dayjs';
import { normalizeAr } from './ListToolbar';
import DateRangeFilter from './DateRangeFilter';

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
      if (min !== null && min !== undefined && n < min) return false;
      if (max !== null && max !== undefined && n > max) return false;
      return true;
    },
  };
}

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
            <div style={{ width: 260 }}>
              <DateRangeFilter
                placeholder={['من', 'إلى']}
                value={[from ? dayjs(from) : null, to ? dayjs(to) : null] as any}
                onChange={(v: any) => set([
                  v?.[0] ? v[0].format('YYYY-MM-DD') : null,
                  v?.[1] ? v[1].format('YYYY-MM-DD') : null,
                ])}
              />
            </div>
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
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    },
  };
}

export function choiceColumn<T>(
  choices: { text: string; value: string }[], match: (row: T, value: string) => boolean,
) {
  return {
    filters: choices,
    onFilter: (value: any, row: T) => match(row, String(value)),
  };
}

export function autoColumnFilters<T>(columns: any[] | undefined, rows: readonly T[] | undefined): any[] {
  const data = (rows || []) as T[];
  const valueOf = (col: any) => (row: any): any => {
    if (typeof col.filterValue === 'function') return col.filterValue(row);
    const di = col.dataIndex;
    if (di === undefined || di === null) return undefined;
    if (Array.isArray(di)) return di.reduce((v: any, k: any) => (v == null ? v : v[k]), row);
    return row?.[di];
  };
  const kindOf = (get: (r: any) => any): 'number' | 'date' | 'text' | null => {
    const sample = data.map(get).filter((v) => v !== null && v !== undefined && v !== '').slice(0, 50);
    if (!sample.length) return null;
    if (sample.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))) return 'date';
    if (sample.every((v) => typeof v === 'number'
      || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))))) return 'number';
    if (sample.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      return 'text';
    }
    return null;
  };
  const walk = (cols: any[]): any[] => cols.map((col) => {
    if (!col || typeof col !== 'object') return col;
    if (Array.isArray(col.children)) return { ...col, children: walk(col.children) };
    if (col.filters || col.filterDropdown || col.onFilter) return col;
    if (col.dataIndex === undefined && typeof col.filterValue !== 'function') return col;
    const get = valueOf(col);
    const kind = kindOf(get);
    if (!kind) return col;
    const extra = kind === 'number' ? numberColumn(get as any)
      : kind === 'date' ? dateColumn(get as any)
        : textColumn(data, get as any);
    return { ...extra, ...col, ...(col.sorter ? {} : { sorter: extra.sorter }),
      filters: (extra as any).filters, filterSearch: (extra as any).filterSearch,
      filterDropdown: (extra as any).filterDropdown, onFilter: extra.onFilter };
  });
  return walk(columns || []);
}

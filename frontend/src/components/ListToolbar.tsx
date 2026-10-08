import React, { useMemo, useRef, useState } from 'react';
import { Button, Col, Input, Row, Select, Tag } from 'antd';
import {
  SearchOutlined, ClearOutlined, DownOutlined, UpOutlined, GroupOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useScreenShortcuts } from './keyboard';
import DateRangeFilter from './DateRangeFilter';

export { normalizeAr } from '../utils/arabicSort';
import { normalizeAr, searchFilter, searchRank } from '../utils/arabicSort';

export interface FilterDef {
  key: string;
  placeholder: string;
  options?: { value: any; label: string }[];
  kind?: 'select' | 'text';
  multi?: boolean;
  advanced?: boolean;
  span?: number;
}

export interface UseListFilterOptions<T> {
  search?: (row: T) => any[];
  filters?: Record<string, (row: T, value: any) => boolean>;
  dateOf?: (row: T) => string | null | undefined;
  initialValues?: Record<string, any>;
}

export function useListFilter<T>(rows: T[], options: UseListFilterOptions<T> = {}) {
  const [query, setQuery] = useState('');
  const [values, setValues] = useState<Record<string, any>>(options.initialValues ?? {});
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const setValue = (key: string, value: any) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const reset = () => { setQuery(''); setValues(options.initialValues ?? {}); setRange(null); };

  const filtered = useMemo(() => {
    const needle = normalizeAr(query);
    return (rows || []).filter((row) => {
      if (needle) {
        const hay = (options.search ? options.search(row) : Object.values(row as any))
          .filter((v) => v !== null && v !== undefined && typeof v !== 'object')
          .map(normalizeAr);
        if (!hay.some((h) => h.includes(needle))) return false;
      }
      for (const [key, predicate] of Object.entries(options.filters || {})) {
        const v = values[key];
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) {
          if (!v.length) continue;
          if (!v.some((one) => predicate(row, one))) return false;
        } else if (!predicate(row, v)) return false;
      }
      if (range && options.dateOf) {
        const raw = options.dateOf(row);
        if (!raw) return false;
        const d = dayjs(String(raw).slice(0, 10));
        if (d.isBefore(range[0], 'day') || d.isAfter(range[1], 'day')) return false;
      }
      return true;
    });
  }, [rows, query, values, range, options]);

  const active = !!query
    || Object.values(values).some((v) => v !== undefined && v !== null && v !== ''
                                         && !(Array.isArray(v) && !v.length))
    || !!range;

  return { query, setQuery, values, setValue, range, setRange, reset, filtered, active };
}

export default function ListToolbar({
  query, onQueryChange, searchPlaceholder = 'بحث...', filters = [], values = {}, onValueChange,
  showDateRange = false, range, onRangeChange, onReset, total, shown, searchSpan = 6,
  extra, searchRef: externalSearchRef, groupBy, groupOptions = [], onGroupByChange,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  values?: Record<string, any>;
  onValueChange?: (key: string, value: any) => void;
  showDateRange?: boolean;
  range?: [Dayjs, Dayjs] | null;
  onRangeChange?: (v: [Dayjs, Dayjs] | null) => void;
  onReset?: () => void;
  total?: number;
  shown?: number;
  searchSpan?: number;
  groupBy?: string | null;
  groupOptions?: { value: string; label: string }[];
  onGroupByChange?: (v: string | null) => void;
  extra?: React.ReactNode;
  searchRef?: React.MutableRefObject<any>;
}) {
  const ownSearchRef = useRef<any>(null);
  const searchRef = externalSearchRef ?? ownSearchRef;
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const primary = filters.filter((f) => !f.advanced);
  const advanced = filters.filter((f) => f.advanced);
  const [showMore, setShowMore] = useState(false);
  const hiddenActive = advanced.some((f) => values[f.key] !== undefined
    && values[f.key] !== null && values[f.key] !== ''
    && !(Array.isArray(values[f.key]) && !values[f.key].length));
  const expanded = showMore || hiddenActive;

  const control = (f: FilterDef) => (f.kind === 'text' ? (
    <Input
      allowClear
      style={{ width: '100%' }}
      placeholder={f.placeholder}
      value={values[f.key] ?? undefined}
      onChange={(e) => onValueChange?.(f.key, e.target.value || undefined)}
    />
  ) : (
    <Select
      allowClear
      showSearch
      mode={(f.multi ?? true) ? 'multiple' : undefined}
      maxTagCount="responsive"
      style={{ width: '100%' }}
      placeholder={f.placeholder}
      value={(() => {
        const v = values[f.key];
        if (v === undefined || v === null || v === '') return undefined;
        if ((f.multi ?? true) && !Array.isArray(v)) return [v];
        return v;
      })()}
      onChange={(v) => onValueChange?.(
        f.key, Array.isArray(v) && !v.length ? undefined : v)}
      options={f.options || []} filterOption={searchFilter} filterSort={searchRank}/>
  ));

  const facets: { key: string; label: string; clear: () => void }[] = [];
  if (query) {
    facets.push({ key: '__q', label: `بحث: ${query}`, clear: () => onQueryChange('') });
  }
  for (const f of filters) {
    const v = values[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    const nameOf = (one: any) =>
      f.options?.find((o) => o.value === one)?.label ?? String(one);
    const label = Array.isArray(v)
      ? `${v.slice(0, 2).map(nameOf).join('، ')}${v.length > 2 ? ` +${v.length - 2}` : ''}`
      : nameOf(v);
    facets.push({
      key: f.key,
      label: `${f.placeholder}: ${label}`,
      clear: () => onValueChange?.(f.key, undefined),
    });
  }
  if (range) {
    facets.push({
      key: '__range',
      label: `التاريخ: ${range[0].format('YYYY-MM-DD')} ← ${range[1].format('YYYY-MM-DD')}`,
      clear: () => onRangeChange?.(null),
    });
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        marginBottom: expanded ? 8 : 12,
      }}>
        <div style={{ flex: `1 1 ${Math.max(200, (searchSpan ?? 6) * 26)}px`, minWidth: 180 }}>
          <Input
            allowClear
            ref={searchRef}
            value={query}
            placeholder={searchPlaceholder}
            prefix={<SearchOutlined />}
          onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>

        {extra}

        {primary.map((f) => (
          <div style={{ flex: '0 1 190px', minWidth: 150 }} key={f.key}>{control(f)}</div>
        ))}

        {showDateRange && (
          <div style={{ flex: '0 1 270px', minWidth: 220 }}>
            <DateRangeFilter
              value={range ?? null}
              onChange={(v) => onRangeChange?.(v)}
            />
          </div>
        )}

        {groupOptions.length > 0 && (
          <div style={{ flex: '0 1 190px', minWidth: 150 }}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="تجميع بـ"
              value={groupBy ?? undefined}
              onChange={(v) => onGroupByChange?.(v ?? null)}
              options={groupOptions}
              suffixIcon={<GroupOutlined />}
            />
          </div>
        )}

        {advanced.length > 0 && (
          <Button type="link" style={{ padding: 0, flex: '0 0 auto' }}
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setShowMore((v) => !v)}>
            فلاتر أكثر
          </Button>
        )}

        <Button icon={<ClearOutlined />} onClick={onReset} style={{ flex: '0 0 auto' }} />

        {total !== undefined && (
          <Tag style={{ flex: '0 0 auto', marginInlineEnd: 0 }}
            color={shown !== undefined && shown < total ? 'orange' : 'default'}>
            {shown !== undefined && shown < total ? `${shown}/${total}` : `${total}`}
          </Tag>
        )}
      </div>

      {facets.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {facets.map((f) => (
            <Tag key={f.key} closable color="blue" onClose={f.clear}
                 style={{ marginInlineEnd: 0 }}>
              {f.label}
            </Tag>
          ))}
          {facets.length > 1 && (
            <Button type="link" size="small" style={{ padding: 0 }} onClick={onReset}>
              امسح الكل
            </Button>
          )}
        </div>
      )}

      {expanded && advanced.length > 0 && (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }} align="middle">
          {advanced.map((f) => (
            <Col xs={12} md={f.span ?? 5} key={f.key}>{control(f)}</Col>
          ))}
        </Row>
      )}
    </>
  );
}

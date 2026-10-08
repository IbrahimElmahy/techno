import React from 'react';
import { Table } from 'antd';
import { buildSummary, filteredRows, leavesOf } from './tableTotals';

export const APP_SCROLL_CLASS = 'app-scroll';
export const STICKY_BAR = 12;

const FALLBACK_COL = 100;
const SELECTION_COL = 32;
const EXPAND_COL = 48;

function appScroller(): HTMLElement {
  return (document.querySelector<HTMLElement>(`.${APP_SCROLL_CLASS}`)
    ?? (window as unknown as HTMLElement));
}

const STICKY = {
  offsetHeader: 0,
  offsetScroll: 0,
  offsetSummary: STICKY_BAR,
  getContainer: appScroller,
};

const InsideTable = React.createContext(false);

type Filters = Record<string, any[] | null> | null;

function widthOf(c: { width?: number | string; minWidth?: number }): number {
  if (typeof c.width === 'number' && c.width > 0) return c.width;
  if (typeof c.width === 'string' && /^\d+(\.\d+)?(px)?$/.test(c.width.trim())) {
    return parseFloat(c.width);
  }
  return typeof c.minWidth === 'number' && c.minWidth > 0 ? c.minWidth : FALLBACK_COL;
}

function contentWidth(props: any): number | undefined {
  const cols = leavesOf(props.columns) as any[];
  if (!cols.length) return undefined;
  let w = cols.reduce((s, c) => s + widthOf(c), 0);
  if (props.rowSelection) {
    const cw = props.rowSelection.columnWidth;
    w += typeof cw === 'number' ? cw : SELECTION_COL;
  }
  const exp = props.expandable;
  if (exp?.expandedRowRender && exp.showExpandColumn !== false) {
    w += typeof exp.columnWidth === 'number' ? exp.columnWidth : EXPAND_COL;
  }
  return Math.round(w);
}

function layoutBefore(props: any, scrollX: unknown): 'auto' | 'fixed' {
  const cols = leavesOf(props.columns) as any[];
  if (scrollX && scrollX !== 'max-content' && cols.some((c) => c.fixed)) return 'fixed';
  return cols.some((c) => c.ellipsis) ? 'fixed' : 'auto';
}

const MAX_CHOICES = 400;

function valueOf(row: any, di: any): any {
  if (di === undefined || di === null || di === '') return undefined;
  const path = Array.isArray(di) ? di : [di];
  let v = row;
  for (const k of path) {
    if (v === null || v === undefined) return undefined;
    v = v[k];
  }
  return v;
}

function textOf(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf((node.props as any)?.children);
  return '';
}

function isNumeric(v: any): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim());
}

function rangeFilter(get: (row: any) => any) {
  return {
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => {
      const [min, max] = (selectedKeys[0] as (string | undefined)[] | undefined) ?? [undefined, undefined];
      const set = (a?: string, b?: string) => setSelectedKeys(!a && !b ? [] : [[a, b]]);
      return (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
          onKeyDown={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="ant-input" style={{ width: 110 }} placeholder="من" value={min ?? ''}
              onChange={(e) => set(e.target.value, max)} />
            <input className="ant-input" style={{ width: 110 }} placeholder="إلى" value={max ?? ''}
              onChange={(e) => set(min, e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="ant-btn ant-btn-primary ant-btn-sm" onClick={() => confirm()}>تطبيق</button>
            <button type="button" className="ant-btn ant-btn-default ant-btn-sm"
              onClick={() => { clearFilters?.(); confirm(); }}>مسح</button>
          </div>
        </div>
      );
    },
    onFilter: (value: any, row: any) => {
      const [a, b] = (value as any[]) || [];
      const v = Number(get(row));
      if (!Number.isFinite(v)) return false;
      if (a !== undefined && a !== '' && v < Number(a)) return false;
      if (b !== undefined && b !== '' && v > Number(b)) return false;
      return true;
    },
  };
}

const optionCache = new WeakMap<any[], Map<string, any>>();

function autoFilter(c: any, rows: any[]): any {
  if (c.filters || c.filterDropdown || c.onFilter || c.filterable === false) return c;
  const di = c.dataIndex;
  if (di === undefined || di === null || di === '') return c;
  if (!rows.length) return c;
  const get = (r: any) => valueOf(r, di);
  const ck = `${JSON.stringify(di)}|${String(c.key ?? '')}`;
  let perRows = optionCache.get(rows);
  if (!perRows) { perRows = new Map(); optionCache.set(rows, perRows); }
  if (perRows.has(ck)) {
    const hit = perRows.get(ck);
    if (!hit) return c;
    if (hit === 'range') return { ...c, ...rangeFilter(get) };
    return {
      ...c,
      filters: hit,
      onFilter: (value: any, row: any) => {
        const v = get(row);
        return (v === null || v === undefined || v === '' ? '' : String(v)) === value;
      },
    };
  }
  const out = computeAutoFilter(c, rows, get);
  perRows.set(ck, out === c ? null : (out.filterDropdown ? 'range' : out.filters));
  return out;
}

function computeAutoFilter(c: any, rows: any[], get: (r: any) => any): any {
  const raws = rows.map(get);
  const present = raws.filter((v) => v !== null && v !== undefined && v !== '');
  if (!present.length) return c;
  if (present.some((v) => typeof v === 'object')) return c;
  if (present.every(isNumeric) && present.some((v) => typeof v === 'number' || String(v).includes('.'))) {
    return { ...c, ...rangeFilter(get) };
  }
  const labels = new Map<string, string>();
  rows.forEach((r, i) => {
    const v = raws[i];
    const key = v === null || v === undefined || v === '' ? '' : String(v);
    if (labels.has(key)) return;
    let text = key;
    if (typeof c.render === 'function' && key !== '') {
      try {
        const t = textOf(c.render(v, r, i)).trim();
        if (t) text = t;
      } catch { }
    }
    labels.set(key, text || '(فارغ)');
  });
  if (labels.size < 2 || labels.size > MAX_CHOICES) return c;
  const filters = [...labels.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ar'))
    .map(([value, text]) => ({ text, value }));
  return {
    ...c,
    filters,
    onFilter: (value: any, row: any) => {
      const v = get(row);
      const key = v === null || v === undefined || v === '' ? '' : String(v);
      return key === value;
    },
  };
}

function withFilters(cols: any[] | undefined, rows: any[]): any[] | undefined {
  if (!Array.isArray(cols)) return cols;
  let changed = false;
  const out = cols.map((c) => {
    if (!c || typeof c !== 'object') return c;
    let n = c;
    if (Array.isArray(c.children) && c.children.length) {
      const kids = withFilters(c.children, rows);
      if (kids !== c.children) n = { ...n, children: kids };
    } else {
      n = autoFilter(n, rows);
    }
    if (Array.isArray(n.filters) && n.filters.length && n.filterMode === undefined && !n.filterDropdown) {
      n = { ...n, filterMode: 'tree', filterSearch: n.filterSearch ?? n.filters.length > 6 };
    }
    if (n !== c) changed = true;
    return n;
  });
  return changed ? out : cols;
}

function withDefaults(
  props: any,
  nested: boolean,
  filters: Filters,
  setFilters: (f: Filters) => void,
): any {
  if (props.virtual) return props;
  let next = props;
  const rowsForFilters = Array.isArray(props.dataSource) && !nested ? props.dataSource : [];
  const cols = withFilters(props.columns, rowsForFilters);
  if (cols !== props.columns) next = { ...next, columns: cols };

  if (props.scroll === undefined) {
    const x = contentWidth(props);
    if (x) next = { ...next, scroll: { x } };
  }

  if (props.sticky === undefined && !next.scroll?.y && !nested) {
    next = {
      ...next,
      sticky: STICKY,
      tableLayout: next.tableLayout ?? layoutBefore(next, next.scroll?.x),
    };
  }

  if (props.summary === undefined) {
    const leaves = leavesOf(next.columns);
    const rows = filteredRows(props, leaves, filters);
    const summary = buildSummary(props, leaves, rows, Boolean(next.sticky || next.scroll?.y));
    const onChange = props.onChange;
    next = {
      ...next,
      ...(summary ? { summary } : {}),
      onChange: (...args: any[]) => {
        setFilters(args[1] ?? null);
        return onChange?.(...args);
      },
    };
  }
  return next;
}

const T = Table as unknown as {
  render?: (props: any, ref: any) => React.ReactNode;
  __original?: (props: any, ref: any) => React.ReactNode;
};
if (typeof T.render === 'function') {
  const original = T.__original ?? T.render;
  T.__original = original;
  T.render = function TableWithDefaults(props: any, ref: any) {
    const nested = React.useContext(InsideTable);
    const [filters, setFilters] = React.useState<Filters>(null);
    return (
      <InsideTable.Provider value>
        {original(withDefaults(props, nested, filters, setFilters), ref)}
      </InsideTable.Provider>
    );
  };
}

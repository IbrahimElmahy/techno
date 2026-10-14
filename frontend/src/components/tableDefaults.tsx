import React from 'react';
import { Table } from 'antd';
import { buildSummary, filteredRows, leavesOf } from './tableTotals';
import { WIDTHS_EVENT, storedWidth } from './ColumnResize';
import ColumnSettings from './ColumnSettings';

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

type Sorter = { key: string; order: 'ascend' | 'descend' } | null;
type TableState = { filters?: Filters; sorter?: Sorter; hidden?: string[]; pageSize?: number };

const GEAR_KEY = '__col_settings__';

function colKeyOf(c: any, idx = 0): string {
  if (c.key !== undefined && c.key !== null) return String(c.key);
  const di = c.dataIndex;
  if (Array.isArray(di)) return di.join('.');
  if (di !== undefined && di !== null && di !== '') return String(di);
  return `__col_${idx}__`;
}

function scopeKey(): string {
  const p = new URLSearchParams(window.location.search);
  const extra = ['view', 'tab', 'kind'].map((k) => p.get(k)).filter(Boolean).join('|');
  return `${window.location.pathname}${extra ? `?${extra}` : ''}`;
}

function tableIdOf(cols: any): string | null {
  if (!Array.isArray(cols) || !cols.length) return null;
  if ((cols as any).__tableKey) return `${scopeKey()}#${(cols as any).__tableKey}`;
  const keys = (leavesOf(cols) as any[]).map((c, i) => colKeyOf(c, i)).filter((k) => k !== GEAR_KEY);
  return `${scopeKey()}#${keys.join(',').slice(0, 240)}`;
}

function loadState(id: string | null): TableState {
  if (!id) return {};
  try { return JSON.parse(localStorage.getItem(`tbl:${id}`) || '{}') || {}; } catch { return {}; }
}

function saveState(id: string | null, st: TableState) {
  if (!id) return;
  try { localStorage.setItem(`tbl:${id}`, JSON.stringify(st)); } catch { /* ignore */ }
}

function withControlled(cols: any[] | undefined, filters: Filters, sorter: Sorter): any[] | undefined {
  if (!Array.isArray(cols)) return cols;
  const leaves = leavesOf(cols) as any[];
  const pageSorts = leaves.some((c) => c && c.sortOrder !== undefined);
  const map = (list: any[]): any[] => list.map((c, i) => {
    if (!c || typeof c !== 'object') return c;
    if (Array.isArray(c.children) && c.children.length) return { ...c, children: map(c.children) };
    let n = c;
    const k = colKeyOf(c, i);
    if ((c.filters || c.filterDropdown || c.onFilter) && c.filteredValue === undefined) {
      n = { ...n, filteredValue: filters?.[k] ?? null };
    }
    if (c.sorter && !pageSorts) {
      n = { ...n, sortOrder: sorter && sorter.key === k ? sorter.order : null };
    }
    return n;
  });
  return map(cols);
}

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

function textOfTitle(node: any): string {
  return textOf(typeof node === 'function' ? '' : node).trim();
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
  if (labels.size < 1 || labels.size > MAX_CHOICES) return c;
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

function withStoredWidths(cols: any[] | undefined): any[] | undefined {
  if (!Array.isArray(cols)) return cols;
  let changed = false;
  const out = cols.map((c) => {
    if (!c || typeof c !== 'object') return c;
    if (Array.isArray(c.children) && c.children.length) {
      const kids = withStoredWidths(c.children);
      if (kids !== c.children) { changed = true; return { ...c, children: kids }; }
      return c;
    }
    const heading = textOf(typeof c.title === 'function' ? '' : c.title);
    if (!heading) return c;
    const w = storedWidth(heading);
    if (!w || w === c.width) return c;
    changed = true;
    return { ...c, width: w };
  });
  return changed ? out : cols;
}

function withFilters(cols: any[] | undefined, rows: any[], onOpen?: () => void): any[] | undefined {
  if (!Array.isArray(cols)) return cols;
  let changed = false;
  const out = cols.map((c) => {
    if (!c || typeof c !== 'object') return c;
    let n = c;
    if (Array.isArray(c.children) && c.children.length) {
      const kids = withFilters(c.children, rows, onOpen);
      if (kids !== c.children) n = { ...n, children: kids };
    } else {
      n = autoFilter(n, rows);
      if (onOpen && (n.filters || n.filterDropdown)) {
        const prev = n.onFilterDropdownOpenChange;
        n = { ...n, onFilterDropdownOpenChange: (open: boolean) => { if (open) onOpen(); prev?.(open); } };
      }
    }
    if (Array.isArray(n.filters) && n.filters.length && n.filterMode === undefined && !n.filterDropdown) {
      n = { ...n, filterMode: 'tree', filterSearch: n.filterSearch ?? n.filters.length > 6 };
    }
    if (n !== c) changed = true;
    return n;
  });
  return changed ? out : cols;
}

type Extra = {
  sorter: Sorter;
  pageSize?: number;
  decorate: (cols: any[] | undefined) => any[] | undefined;
  onTableChange: (pagination: any, filters: Filters, sorter: any) => void;
};

function withDefaults(
  props: any,
  nested: boolean,
  filters: Filters,
  setFilters: (f: Filters) => void,
  filterRows?: any[] | null,
  onOpen?: () => void,
  extra?: Extra,
): any {
  if (props.virtual) return props;
  let next = props;
  const rowsForFilters = filterRows
    ?? (Array.isArray(props.dataSource) && !nested ? props.dataSource : []);
  const cols = withStoredWidths(withFilters(props.columns, rowsForFilters, onOpen));
  if (cols !== props.columns) next = { ...next, columns: cols };
  if (!nested && extra) {
    next = { ...next, columns: extra.decorate(withControlled(next.columns, filters, extra.sorter)) };
    if (next.pagination && typeof next.pagination === 'object' && next.pagination.pageSize === undefined
        && extra.pageSize) {
      next = { ...next, pagination: { ...next.pagination, defaultPageSize: extra.pageSize } };
    }
  }

  if (props.scroll === undefined) {
    const x = contentWidth(props);
    if (x) next = { ...next, scroll: { x } };
  }

  if (props.sticky === undefined && !next.scroll?.y && !nested) {
    const sx = next.scroll?.x;
    const x = sx === 'max-content' || sx === true ? contentWidth(next) : undefined;
    next = {
      ...next,
      ...(x ? { scroll: { ...next.scroll, x } } : {}),
      sticky: STICKY,
      tableLayout: 'fixed',
    };
  }

  if (props.summary === undefined) {
    const leaves = leavesOf(next.columns);
    const rows = filteredRows(props, leaves, filters);
    const summary = buildSummary(props, leaves, rows, Boolean(next.sticky || next.scroll?.y));
    if (summary) next = { ...next, summary };
  }
  const onChange = props.onChange;
  next = {
    ...next,
    onChange: (...args: any[]) => {
      setFilters(args[1] ?? null);
      extra?.onTableChange(args[0], args[1] ?? null, args[2]);
      return onChange?.(...args);
    },
  };
  return next;
}

const T = Table as unknown as {
  render?: (props: any, ref: any) => React.ReactNode;
  __original?: (props: any, ref: any) => React.ReactNode;
};
if (typeof T.render === 'function') {
  const original = T.__original ?? T.render;
  T.__original = original;
  T.render = function TableWithDefaults(rawProps: any, ref: any) {
    const nested = React.useContext(InsideTable);
    const tableId = nested ? null : tableIdOf(rawProps.columns);
    const [stored, setStored] = React.useState<TableState>(() => loadState(tableId));
    const [filters, setFilters] = React.useState<Filters>(() => stored.filters ?? null);
    const idRef = React.useRef(tableId);
    React.useEffect(() => {
      if (idRef.current === tableId) return;
      idRef.current = tableId;
      const st = loadState(tableId);
      setStored(st);
      setFilters(st.filters ?? null);
    }, [tableId]);
    const update = (patchState: TableState) => setStored((prev) => {
      const nextState = { ...prev, ...patchState };
      saveState(idRef.current, nextState);
      return nextState;
    });
    const [full, setFull] = React.useState<any[] | null>(null);
    const [, setWidthTick] = React.useState(0);
    React.useEffect(() => {
      const bump = () => setWidthTick((t) => t + 1);
      window.addEventListener(WIDTHS_EVENT, bump);
      return () => window.removeEventListener(WIDTHS_EVENT, bump);
    }, []);
    const loading = React.useRef(false);
    const { fetchAllRows, partialRows, ...props } = rawProps;
    const shown = Array.isArray(props.dataSource) ? props.dataSource.length : 0;
    const partial = typeof fetchAllRows === 'function' && !nested
      && typeof props.pagination === 'object' && props.pagination
      && (Number(props.pagination.total || 0) > shown || !!partialRows);
    const active = !!filters && Object.values(filters).some((v) => Array.isArray(v) && v.length > 0);

    React.useEffect(() => { if (!active && full) setFull(null); }, [active]);

    const onOpen = partial ? () => {
      if (full || loading.current) return;
      loading.current = true;
      Promise.resolve(fetchAllRows()).then((rows: any) => {
        if (Array.isArray(rows)) setFull(rows);
      }).catch(() => {}).finally(() => { loading.current = false; });
    } : undefined;

    let effective = props;
    if (partial && full && active) {
      const size = props.pagination.pageSize || props.pagination.defaultPageSize || 100;
      effective = {
        ...props,
        dataSource: full,
        pagination: { defaultPageSize: size, showSizeChanger: true, showTotal: props.pagination.showTotal },
      };
    }
    const managed = !!(rawProps.columns as any)?.__managed;
    const extra: Extra | undefined = nested || !tableId ? undefined : {
      sorter: stored.sorter ?? null,
      pageSize: stored.pageSize,
      onTableChange: (pagination, f, sorter) => {
        const s = Array.isArray(sorter) ? sorter[0] : sorter;
        const key = s && s.order ? String(s.columnKey ?? colKeyOf(s.column || {})) : null;
        update({
          filters: f,
          sorter: key ? { key, order: s.order } : null,
          ...(pagination?.pageSize ? { pageSize: pagination.pageSize } : {}),
        });
      },
      decorate: (cols) => {
        if (managed || rawProps.pagination === false || !Array.isArray(cols)) return cols;
        const top = cols.filter((c: any) => c && typeof c === 'object');
        if (top.length < 3) return cols;
        const hidden = stored.hidden ?? [];
        const choices = top.map((c: any, i: number) => ({
          key: colKeyOf(c, i),
          title: textOfTitle(c.title) || 'إجراءات',
        }));
        const visible = cols.filter((c: any, i: number) => !hidden.includes(colKeyOf(c, i)));
        const gear = {
          key: GEAR_KEY, width: 36, align: 'center' as const,
          title: (
            <ColumnSettings compact choices={choices} hidden={hidden}
              onChange={(h) => update({ hidden: h })} />
          ),
          render: () => null,
        };
        return [...visible, gear];
      },
    };
    return (
      <InsideTable.Provider value>
        {original(withDefaults(effective, nested, filters, setFilters, partial ? (full ?? null) : null, onOpen, extra), ref)}
      </InsideTable.Provider>
    );
  };
}

export function allRows(fetch: () => Promise<any[]>, partial?: boolean): {} {
  return { fetchAllRows: fetch, partialRows: partial } as {};
}

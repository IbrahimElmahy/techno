import React from 'react';
import { Table } from 'antd';
import { money, qty } from '../utils/money';

declare module 'antd/es/table/interface' {
  interface ColumnType<RecordType> {
    total?: boolean | 'last';
  }
}

type Leaf = {
  key?: React.Key;
  dataIndex?: string | number | readonly (string | number)[];
  title?: unknown;
  render?: (value: any, record: any, index: number) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  total?: boolean | 'last';
  onFilter?: (value: any, record: any) => boolean;
  filteredValue?: any[] | null;
};

const SKIP_TOKENS = new Set([
  'id', 'ids', 'code', 'no', 'num', 'number', 'status', 'type', 'kind', 'state', 'level', 'sort',
  'seq', 'rank', 'year', 'month', 'day', 'date', 'time', 'at', 'phone', 'mobile', 'tel', 'fax',
  'zip', 'pct', 'percent', 'percentage', 'rate', 'ratio', 'price', 'avg', 'average', 'unit',
  'min', 'max', 'reorder', 'limit', 'precision', 'version', 'running', 'cumulative', 'lat',
  'lng', 'latitude', 'longitude', 'index', 'position', 'priority', 'factor', 'multiplier',
]);

const SKIP_TITLE = /إجراء|كود|رقم|تاريخ|هاتف|موبايل|تليفون|نسبة|%|سعر|معدل|متوسط|سنة|شهر|الحالة|ترتيب|الحد |حد الطلب|تراكمي|الجاري|معامل/;
const BALANCE_TITLE = /رصيد/;
const DATE_TITLE = /تاريخ/;

function tokens(key: string): string[] {
  return key
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function keyOf(c: Leaf): string {
  if (Array.isArray(c.dataIndex)) return c.dataIndex.join('.');
  if (c.dataIndex !== undefined && c.dataIndex !== null) return String(c.dataIndex);
  return c.key !== undefined && c.key !== null ? String(c.key) : '';
}

function filterKeyOf(c: Leaf, fallback: string): string {
  if (c.key !== undefined && c.key !== null) return String(c.key);
  if (c.dataIndex !== undefined && c.dataIndex !== null && c.dataIndex !== '') {
    return Array.isArray(c.dataIndex) ? c.dataIndex.join('.') : String(c.dataIndex);
  }
  return fallback;
}

export function nodeText(n: unknown): string | null {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) {
    let out = '';
    for (const x of n) {
      const t = nodeText(x);
      if (t === null) return null;
      out += t;
    }
    return out;
  }
  if (React.isValidElement(n)) {
    if (typeof n.type !== 'string' && n.type !== React.Fragment) return null;
    return nodeText((n.props as any)?.children);
  }
  return null;
}

function footerHasTotals(props: any, total: number): boolean {
  if (props.footer) return true;
  const st = props.pagination && props.pagination.showTotal;
  if (typeof st !== 'function') return false;
  try {
    const text = nodeText(st(total, [1, total]));
    if (text === null) return true;
    if (/[\d٠-٩][.,٫،][\d٠-٩]/.test(text)) return true;
    const numbers = text.match(/[\d٠-٩]+/g) || [];
    return /إجمالي|صافي|رصيد|مجموع/.test(text) && numbers.length >= 2;
  } catch {
    return true;
  }
}

export function leavesOf(cols: readonly unknown[] | undefined): Leaf[] {
  const out: Leaf[] = [];
  (cols || []).forEach((c) => {
    if (!c || typeof c !== 'object') return;
    const col = c as Leaf & { hidden?: boolean; children?: unknown[] };
    if (col.hidden) return;
    if (Array.isArray(col.children) && col.children.length) out.push(...leavesOf(col.children));
    else out.push(col);
  });
  return out;
}

function valueAt(row: any, c: Leaf): unknown {
  const di = c.dataIndex;
  if (di === undefined || di === null || di === '') return undefined;
  const path = Array.isArray(di) ? di : [di];
  let v = row;
  for (const p of path) {
    if (v === null || v === undefined) return undefined;
    v = v[p as any];
  }
  return v;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

function asNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!NUMERIC.test(s)) return undefined;
    if (s.length > 1 && s[0] === '0' && s[1] !== '.') return undefined;
    if (s.length > 2 && s.startsWith('-0') && s[2] !== '.') return undefined;
    return Number(s);
  }
  return undefined;
}

type Mode = 'sum' | 'last';

type Column = { values: (number | null)[]; money: boolean; derived: boolean };

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function parseShown(out: unknown): { n: number | null; money: boolean } | undefined {
  const text = typeof out === 'number' ? String(out) : nodeText(out);
  if (text === null) return undefined;
  const s = text
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[٫،,]/g, '.')
    .replace(/[−–]/g, '-')
    .replace(/[\s‎‏؜]/g, '');
  if (s === '' || s === '-' || s === '—') return { n: null, money: false };
  if (!NUMERIC.test(s)) return undefined;
  return { n: Number(s), money: /\.\d{2}$/.test(s) };
}

function hasIndex(c: Leaf): boolean {
  return c.dataIndex !== undefined && c.dataIndex !== null && c.dataIndex !== '';
}

function readColumn(c: Leaf, rows: readonly any[]): Column | null {
  const values: (number | null)[] = [];
  let money = false;
  let seen = 0;
  if (hasIndex(c)) {
    for (const r of rows) {
      const raw = valueAt(r, c);
      const n = asNumber(raw);
      if (n === undefined) return null;
      if (n !== null) {
        seen += 1;
        if ((typeof raw === 'string' && /\.\d{2}$/.test(raw.trim()))
          || (typeof raw === 'number' && !Number.isInteger(raw))) money = true;
      }
      values.push(n);
    }
    return seen ? { values, money, derived: false } : null;
  }
  if (typeof c.render !== 'function') return null;
  let other = 0;
  for (let i = 0; i < rows.length; i += 1) {
    let shown: ReturnType<typeof parseShown>;
    try {
      shown = parseShown(c.render(rows[i], rows[i], i));
    } catch {
      return null;
    }
    if (shown === undefined) {
      other += 1;
      values.push(null);
    } else {
      if (shown.n !== null) {
        seen += 1;
        if (shown.money) money = true;
      }
      values.push(shown.n);
    }
  }
  return seen && seen >= other ? { values, money, derived: true } : null;
}

function modeOf(c: Leaf, ledger: boolean): Mode | null {
  if (c.total === false) return null;
  if (c.total === 'last') return 'last';
  if (c.total === true) return 'sum';
  const key = keyOf(c);
  if (tokens(key).some((t) => SKIP_TOKENS.has(t))) return null;
  const title = nodeText(c.title) ?? '';
  if (!title.trim() && !hasIndex(c)) return null;
  if (SKIP_TITLE.test(title)) return null;
  if (ledger && (BALANCE_TITLE.test(title) || tokens(key).includes('balance'))) return null;
  return 'sum';
}

function rendered(c: Leaf, value: number): string | number | null {
  if (typeof c.render !== 'function') return null;
  try {
    const out = c.render(value, {}, -1);
    if (typeof out !== 'string' && typeof out !== 'number') return null;
    const shown = parseShown(out);
    return shown && shown.n !== null ? out : null;
  } catch {
    return null;
  }
}

function format(c: Leaf, value: number, col: Column): React.ReactNode {
  if (!col.derived) {
    const own = rendered(c, value);
    if (own !== null) return own;
  }
  return col.money ? money(value) : qty(value);
}

export function filteredRows(props: any, leaves: Leaf[], filters: Record<string, any[] | null> | null): any[] {
  const data: any[] = Array.isArray(props.dataSource) ? props.dataSource : [];
  let rows = data;
  leaves.forEach((c, i) => {
    if (typeof c.onFilter !== 'function') return;
    const active = c.filteredValue !== undefined
      ? c.filteredValue
      : filters?.[filterKeyOf(c, String(i))];
    if (!active || !active.length) return;
    rows = rows.filter((r) => active.some((v) => {
      try { return c.onFilter!(v, r); } catch { return true; }
    }));
  });
  return rows;
}

type Analysis = { cols: (Column | null)[]; values: (number | null)[]; first: number };

const cache = new WeakMap<readonly any[], { sig: string; result: Analysis }>();

function analyse(leaves: Leaf[], rows: readonly any[]): Analysis {
  const sig = leaves.map((c) => `${keyOf(c)}:${nodeText(c.title) ?? ''}:${String(c.total ?? '')}`).join('|');
  const hit = cache.get(rows);
  if (hit && hit.sig === sig) return hit.result;

  const ledger = leaves.some((c) => {
    const title = nodeText(c.title) ?? '';
    return DATE_TITLE.test(title) || tokens(keyOf(c)).includes('date');
  });
  const cols = leaves.map((c) => (modeOf(c, ledger) ? readColumn(c, rows) : null));
  const modes = leaves.map((c, i) => (cols[i] ? modeOf(c, ledger) : null));
  const first = modes.findIndex((m) => m !== null);
  const values = cols.map((col, i) => {
    const m = modes[i];
    if (!m || !col) return null;
    if (m === 'last') {
      for (let k = col.values.length - 1; k >= 0; k -= 1) {
        if (col.values[k] !== null) return col.values[k];
      }
      return null;
    }
    const sum = col.values.reduce<number>((acc, n) => acc + (n ?? 0), 0);
    return Math.round(sum * 1e6) / 1e6;
  });
  const result = { cols, values, first };
  if (!cols.some((c) => c?.derived)) cache.set(rows, { sig, result });
  return result;
}

export function buildSummary(
  props: any,
  leaves: Leaf[],
  rows: readonly any[],
  fixed: boolean,
): ((data: readonly any[]) => React.ReactNode) | undefined {
  if (props.summary !== undefined || props.showHeader === false) return undefined;
  if (!leaves.length || rows.length < 2) return undefined;
  const totalCount = props.pagination && typeof props.pagination.total === 'number'
    ? props.pagination.total : rows.length;
  if (footerHasTotals(props, totalCount)) return undefined;

  const { cols, values, first } = analyse(leaves, rows);
  if (first < 0) return undefined;

  const serverPaged = typeof props.pagination?.total === 'number'
    && props.pagination.total > (Array.isArray(props.dataSource) ? props.dataSource.length : 0);
  const label = serverPaged ? 'إجمالي الصفحة' : 'الإجمالي';
  const exp = props.expandable;
  const offset = (props.rowSelection ? 1 : 0)
    + (exp?.expandedRowRender && exp.showExpandColumn !== false ? 1 : 0);
  const lead = offset + first;

  return () => (
    <Table.Summary fixed={fixed}>
      <Table.Summary.Row className="auto-total">
        {lead > 0 && (
          <Table.Summary.Cell index={0} colSpan={lead}>
            {first > 0 ? label : null}
          </Table.Summary.Cell>
        )}
        {leaves.slice(first).map((c, j) => {
          const i = first + j;
          const v = values[i];
          return (
            <Table.Summary.Cell key={i} index={offset + i} align={c.align}>
              {v === null || !cols[i] ? null : format(c, v, cols[i]!)}
            </Table.Summary.Cell>
          );
        })}
      </Table.Summary.Row>
    </Table.Summary>
  );
}

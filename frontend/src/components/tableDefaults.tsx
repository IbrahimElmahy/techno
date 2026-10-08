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

function withDefaults(
  props: any,
  nested: boolean,
  filters: Filters,
  setFilters: (f: Filters) => void,
): any {
  if (props.virtual) return props;
  let next = props;

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
    const leaves = leavesOf(props.columns);
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

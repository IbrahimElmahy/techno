import React from 'react';
import ColumnSettings, { orderKeys, useHiddenColumns } from './ColumnSettings';

export interface EntryColumn<T> {
  key: string;
  title: React.ReactNode;
  label?: string;
  width?: number | string;
  minWidth?: number;
  tip?: string;
  cellStyle?: React.CSSProperties;
  cellProps?: (row: T, index: number) => React.HTMLAttributes<HTMLTableCellElement>;
  cell: (row: T, index: number) => React.ReactNode;
  locked?: boolean;
  footer?: (rows: T[]) => React.ReactNode;
  span?: number;
  xs?: number;
  align?: 'right' | 'center' | 'left';
}

const MIN_COL = 50;

function loadWidths(key: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function saveWidths(key: string, w: Record<string, number>) {
  try { localStorage.setItem(key, JSON.stringify(w)); } catch {}
}

export function useEntryGrid<T>(storageKey: string, columns: EntryColumn<T>[]) {
  const prefs = useHiddenColumns(storageKey);
  const allKeys = columns.map((c) => c.key);

  const widthsKey = `cols:${storageKey}:widths`;
  const [widths, setWidths] = React.useState<Record<string, number>>(() => loadWidths(widthsKey));
  const defWidth = (c: EntryColumn<T>) => (typeof c.width === 'number' ? c.width : (c.minWidth ?? 100));
  const minOf = (c: EntryColumn<T>) => Math.min(c.minWidth ?? MIN_COL, defWidth(c));
  const widthOf = (c: EntryColumn<T>) => {
    const saved = widths[c.key];
    return Math.max(minOf(c), Math.round(typeof saved === 'number' && saved > 0 ? saved : defWidth(c)));
  };
  const commitWidths = (fn: (prev: Record<string, number>) => Record<string, number>) => {
    setWidths((prev) => {
      const next = fn(prev);
      saveWidths(widthsKey, next);
      return next;
    });
  };
  const resetWidths = () => commitWidths(() => ({}));
  const resetWidth = (key: string) => commitWidths((prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });

  const ordered = React.useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    return orderKeys(allKeys, prefs.order).map((k) => byKey.get(k)!).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, prefs.order]);

  const shown = ordered.filter((c) => !prefs.hidden.includes(c.key));

  const control = (
    <ColumnSettings
      choices={columns.map((c) => ({
        key: c.key,
        title: c.label ?? (typeof c.title === 'string' && c.title ? c.title : c.key),
        locked: !!c.locked,
      }))}
      hidden={prefs.hidden}
      onChange={prefs.setHidden}
      order={prefs.order}
      onMove={(k, d) => prefs.move(k, d, allKeys)}
      onResetWidths={resetWidths}
    />
  );

  const total = shown.reduce((n, c) => n + widthOf(c), 0);
  const stickyKey = shown.length && shown[shown.length - 1].key === 'actions' ? 'actions' : null;
  const stickyCls = (key: string) => (key === stickyKey ? 'eg-sticky-end' : undefined);

  const startResize = (c: EntryColumn<T>) => (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest('th') as HTMLElement | null;
    const table = th?.closest('table') as HTMLTableElement | null;
    const wrap = table?.parentElement;
    if (!th || !table || !wrap) return;
    const col = table.querySelector<HTMLElement>(`col[data-eg-col="${c.key}"]`);
    const rtl = getComputedStyle(th).direction === 'rtl';
    const startX = e.clientX;
    const startRendered = th.getBoundingClientRect().width;
    const others = total - widthOf(c);
    const room = wrap.clientWidth;
    const min = minOf(c);
    let next = widthOf(c);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      const r = Math.max(min, startRendered + (rtl ? -dx : dx));
      const base = r + others >= room ? r : (r * others) / (room - r);
      next = Math.max(min, Math.round(base));
      if (col) col.style.width = `${next}px`;
      th.style.width = `${next}px`;
      table.style.minWidth = `${others + next}px`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('eg-resizing');
      if (moved) commitWidths((prev) => ({ ...prev, [c.key]: next }));
    };
    document.body.classList.add('eg-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const cols = (
    <colgroup>
      {shown.map((c) => <col key={c.key} data-eg-col={c.key} style={{ width: widthOf(c) }} />)}
    </colgroup>
  );

  const tableProps = {
    className: 'entry-grid sale-grid eg-sized',
    style: { tableLayout: 'fixed', width: '100%', minWidth: total } as React.CSSProperties,
  };

  const head = (
    <tr>
      {shown.map((c) => (
        <th key={c.key} className={stickyCls(c.key)} style={{ width: widthOf(c) }}
          title={c.tip ?? (typeof c.title === 'string' && c.title ? c.title : undefined)}>
          {c.title}
          <span className="eg-resize" onPointerDown={startResize(c)}
            onDoubleClick={(e) => { e.stopPropagation(); resetWidth(c.key); }}
            title="تغيير عرض العمود" />
        </th>
      ))}
    </tr>
  );

  const foot = (rows: T[], label: React.ReactNode = 'الإجمالي') => {
    const first = shown.findIndex((c) => c.footer);
    if (first < 0) return null;
    return (
      <tr>
        {first > 0 && (
          <td colSpan={first} style={{ fontWeight: 700 }}>{label}</td>
        )}
        {shown.slice(first).map((c) => (
          <td key={c.key} className={stickyCls(c.key)} style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            {c.footer ? c.footer(rows) : null}
          </td>
        ))}
      </tr>
    );
  };

  const row = (item: T, index: number) => shown.map((c) => (
    <td key={c.key} className={stickyCls(c.key)} style={c.cellStyle} {...(c.cellProps?.(item, index) ?? {})}>
      {c.cell(item, index)}
    </td>
  ));

  const colHead = shown.map((c) => ({
    key: c.key, span: c.span ?? 2, xs: c.xs, align: c.align, title: c.title,
  }));

  const colRow = (item: T, index: number) => shown.map((c) => ({
    key: c.key, span: c.span ?? 2, xs: c.xs, align: c.align,
    node: c.cell(item, index),
  }));

  return {
    control, head, row, foot, colHead, colRow, shown, count: shown.length,
    cols, tableProps, resetWidths,
  };
}

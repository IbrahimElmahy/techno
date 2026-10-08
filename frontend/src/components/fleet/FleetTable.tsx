import React, { useMemo } from 'react';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../ColumnSettings';
import { printReport, type PrintTotal } from '../../print/reportSheet';
import type { DocMeta } from '../../print/brand';

export interface FleetCol<T> {
  key: string;
  title: string;
  text: (r: T) => string | number | null | undefined;
  render?: (r: T) => React.ReactNode;
  numeric?: boolean;
  width?: number;
}

export function useFleetColumns<T extends { id: number }>(
  storageKey: string,
  cols: FleetCol<T>[],
  rows: T[],
  opts: {
    name: string;
    actions?: ColumnsType<T>[number];
    defaultHidden?: string[];
  },
) {
  const dataRows = useMemo(() => rows.map((r) => {
    const out: any = { ...r };
    cols.forEach((c) => { out[`__${c.key}`] = c.text(r) ?? ''; });
    return out as T;
  }), [rows, cols]);

  const tableCols: ColumnsType<T> = [
    ...cols.map((c) => ({
      key: c.key,
      title: c.title,
      dataIndex: `__${c.key}`,
      width: c.width,
      align: c.numeric ? ('left' as const) : undefined,
      render: (_: any, r: T) => (c.render ? c.render(r) : (c.text(r) ?? '')),
    })),
    ...(opts.actions ? [{ ...opts.actions, key: '__actions' }] : []),
  ];

  const table = useTableColumns(storageKey, tableCols as any, {
    defaultHidden: opts.defaultHidden,
    export: { name: opts.name, rows: dataRows },
  });

  const print = (meta: DocMeta, totals?: PrintTotal[]) => {
    const visible = (table.columns as any[]).filter((c) => typeof c.dataIndex === 'string'
      && c.dataIndex.startsWith('__'));
    printReport(meta, visible.map((c) => ({
      title: String(c.title), value: (r: any) => r[c.dataIndex],
      numeric: cols.find((x) => `__${x.key}` === c.dataIndex)?.numeric,
    })), dataRows, totals);
  };

  return { columns: table.columns as ColumnsType<T>, control: table.control, rows: dataRows, print };
}

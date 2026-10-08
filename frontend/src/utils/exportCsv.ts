export interface CsvColumn<T = any> {
  title: string;
  value: keyof T | ((row: T) => unknown);
}

function field(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function valueOf<T>(row: T, column: CsvColumn<T>): unknown {
  return typeof column.value === 'function'
    ? (column.value as (r: T) => unknown)(row)
    : (row as any)[column.value];
}

export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => field(c.title)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => field(valueOf(row, c))).join(','));
  }
  return `﻿${lines.join('\n')}`;
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  downloadCsv(filename, buildCsv(columns, rows));
}

export function columnsFromTable<T = any>(
  tableColumns: { title?: unknown; dataIndex?: any; key?: any }[],
): CsvColumn<T>[] {
  return tableColumns
    .filter((c) => c.dataIndex !== undefined && c.dataIndex !== null)
    .map((c) => ({ title: String(c.title ?? ''), value: c.dataIndex as keyof T }));
}

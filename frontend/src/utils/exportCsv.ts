/**
 * تصدير CSV — مكان واحد بدل ست نسخ.
 *
 * Six screens exported CSV, each with its own copy of the same dozen lines, and the copies had
 * drifted into being different programs:
 *
 *   - **Four of the six never escaped an embedded quote.** One `"` in a customer's name or an
 *     item's description and every column after it in that row shifts by one — a file that opens
 *     fine, reads plausibly, and is wrong. Two of the six did escape it. Nobody could have told
 *     you which four.
 *   - Two never called `revokeObjectURL`, so every export leaked its blob for the life of the tab.
 *   - The BOM comment was written out three times, in three wordings, saying the same thing.
 *
 * So it lives here once. The BOM is the load-bearing part: without it Excel opens Arabic headers
 * as mojibake, which is the whole difference between a file somebody uses and a file somebody
 * reports as broken.
 */

/** عمود في الملف: عنوانه، وإزاي بنطلع قيمته من الصف. */
export interface CsvColumn<T = any> {
  title: string;
  /** المفتاح في الصف — أو دالة للحسابات (فرق، تسمية، تنسيق). */
  value: keyof T | ((row: T) => unknown);
}

/**
 * A CSV field is quoted and its own quotes doubled — the escaping rule from RFC 4180, and the one
 * the four broken copies were missing.
 */
function field(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function valueOf<T>(row: T, column: CsvColumn<T>): unknown {
  return typeof column.value === 'function'
    ? (column.value as (r: T) => unknown)(row)
    : (row as any)[column.value];
}

/** بيبني نص الملف من غير ما ينزّله — عشان يتختبر. */
export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => field(c.title)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => field(valueOf(row, c))).join(','));
  }
  // BOM: Excel reads a UTF-8 file without one as the local codepage, and Arabic comes out as
  // mojibake.
  return `﻿${lines.join('\n')}`;
}

/** بينزّل الملف على الجهاز. الاسم بياخد `.csv` لو مكانش فيه. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  anchor.click();
  // Two of the six copies forgot this and leaked the blob for the life of the tab.
  URL.revokeObjectURL(url);
}

/** التصدير كله في سطر واحد. */
export function exportCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  downloadCsv(filename, buildCsv(columns, rows));
}

/**
 * أعمدة الجدول زي ما هي على الشاشة → أعمدة ملف.
 *
 * The exported file should be what the person is looking at, including the columns they hid and
 * the order they dragged them into. Columns with no `dataIndex` are the action buttons — exporting
 * them adds a blank column with a heading.
 */
export function columnsFromTable<T = any>(
  tableColumns: { title?: unknown; dataIndex?: any; key?: any }[],
): CsvColumn<T>[] {
  return tableColumns
    .filter((c) => c.dataIndex !== undefined && c.dataIndex !== null)
    .map((c) => ({ title: String(c.title ?? ''), value: c.dataIndex as keyof T }));
}

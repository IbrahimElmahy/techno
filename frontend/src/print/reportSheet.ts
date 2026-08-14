/**
 * طباعة أي تقرير على نفس ورق الشركة.
 *
 * Forty-odd reports live in this system and exactly one of them can be printed — the income
 * statement tab of `pages/FinanceReports.tsx`, which builds its own `<table>` HTML by hand. Every
 * other report a manager wants on paper gets a browser screenshot or a phone photograph of the
 * screen.
 *
 * The letterhead, the A4 RTL styles and the `.grid` / `.totals` classes already exist in
 * `print/brand.ts` for invoices and vouchers. All that was missing was the piece that turns a
 * report's columns and rows into that table — so it is here, once, rather than the twelfth
 * hand-built `<table>` string.
 *
 * The filters go in the header block on purpose. A printed report with no dates on it is a page of
 * numbers nobody can date, and it will be read six months later as if it were current.
 */
import { type DocMeta, printDocument } from './brand';

/** عمود مطبوع: عنوانه، وإزاي بنطلع قيمته من الصف. */
export interface PrintColumn<T = any> {
  title: string;
  value: keyof T | ((row: T) => unknown);
  /** «رقم» بيتحاذي لليمين زي باقي الأرقام في المستندات المطبوعة. */
  numeric?: boolean;
}

/** سطر في جدول الإجماليات تحت التقرير. */
export interface PrintTotal {
  label: string;
  value: string | number;
}

/** HTML escaping — a customer called «شركة <النور>» must not become markup. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellOf<T>(row: T, column: PrintColumn<T>): unknown {
  return typeof column.value === 'function'
    ? (column.value as (r: T) => unknown)(row)
    : (row as any)[column.value];
}

/** بيبني الجدول من غير ما يطبع — عشان يتختبر. */
export function reportTableHtml<T>(
  columns: PrintColumn<T>[],
  rows: T[],
  totals?: PrintTotal[],
): string {
  if (!columns.length) return '';
  const head = columns.map((c) => `<th>${esc(c.title)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const align = c.numeric ? ' style="text-align:left;direction:ltr"' : '';
          return `<td${align}>${esc(cellOf(row, c))}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  // An empty report still prints. «مفيش حركة في الفترة دي» is itself an answer somebody asked
  // for, and a blank page does not say it.
  const empty = rows.length
    ? ''
    : `<tr><td colspan="${columns.length}">مفيش بيانات في المدى المحدد</td></tr>`;
  const totalsHtml = totals?.length
    ? `<table class="totals">${totals
        .map((t) => `<tr><td>${esc(t.label)}</td><td>${esc(t.value)}</td></tr>`)
        .join('')}</table>`
    : '';
  return `<table class="grid"><thead><tr>${head}</tr></thead>`
    + `<tbody>${body}${empty}</tbody></table>${totalsHtml}`;
}

/**
 * بيطبع تقرير كامل: ترويسة الشركة + الفلاتر + الجدول + الإجماليات.
 *
 * `meta.meta` carries the filters as [label, value] pairs and lands in the header table — that is
 * what makes a printed page re-readable next year.
 */
export function printReport<T>(
  meta: DocMeta,
  columns: PrintColumn<T>[],
  rows: T[],
  totals?: PrintTotal[],
): void {
  const counted: DocMeta = {
    ...meta,
    meta: [...(meta.meta ?? []), ['عدد السطور', String(rows.length)]],
  };
  printDocument(counted, reportTableHtml(columns, rows, totals));
}

import { type DocMeta, latinDigits, printDocument } from './brand';

export interface PrintColumn<T = any> {
  title: string;
  value: keyof T | ((row: T) => unknown);
  numeric?: boolean;
}

export interface PrintTotal {
  label: string;
  value: string | number;
}

export { latinDigits } from './brand';

export const printMoney = (v: unknown): string => Number(v || 0).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export const printQty = (v: unknown): string => Number(v || 0).toLocaleString('en-US', {
  maximumFractionDigits: 3,
});

function numericCell(value: unknown): unknown {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !/^-?\d+(\.\d+)?$/.test(raw.trim())) return value;
  const decimals = (raw.trim().split('.')[1] ?? '').length;
  return Number(raw).toLocaleString('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
}

export function esc(value: unknown): string {
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
          const v = cellOf(row, c);
          return `<td${align}>${esc(c.numeric ? numericCell(v) : v)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
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

export function printReport<T>(
  meta: DocMeta,
  columns: PrintColumn<T>[],
  rows: T[],
  totals?: PrintTotal[],
): void {
  const counted: DocMeta = {
    ...meta,
    meta: [...(meta.meta ?? []), ['عدد السطور', String(rows.length)]]
      .map(([k, v]) => [k, latinDigits(String(v ?? ''))] as [string, string]),
  };
  printDocument(counted, latinDigits(reportTableHtml(columns, rows, totals)));
}

export interface PayslipData {
  employee_name?: string | null;
  run: { document_number: string; year: number; month: number; status: string };
  line: { net: string; gross: string; total_deductions: string };
  details: {
    label: string; kind: string; quantity: string | null; amount: string;
  }[];
}

export function printPayslip(slip: PayslipData): void {
  const money = printMoney;
  const rows = slip.details.map((d) => `<tr>
      <td style="text-align:start">${esc(d.label)}</td>
      <td>${d.quantity ? esc(Number(d.quantity)) : ''}</td>
      <td class="num">${d.kind === 'earning' ? money(d.amount) : ''}</td>
      <td class="num">${d.kind === 'deduction' ? money(d.amount) : ''}</td>
    </tr>`).join('');

  const body = `<table class="grid">
      <thead><tr><th>البند</th><th>العدد</th><th>استحقاق</th><th>استقطاع</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>إجمالي الاستحقاق</td><td>${money(slip.line.gross)}</td></tr>
      <tr><td>إجمالي الاستقطاع</td><td>${money(slip.line.total_deductions)}</td></tr>
      <tr><td>الصافي</td><td>${money(slip.line.net)}</td></tr>
    </table>
    <div class="signatures">
      <div class="sig">توقيع الموظف</div>
      <div class="sig">المختص</div>
    </div>`;

  printDocument({
    title: 'قسيمة راتب',
    number: slip.run.document_number,
    meta: [
      ['الموظف', slip.employee_name ?? ''],
      ['الشهر', `${slip.run.year}/${String(slip.run.month).padStart(2, '0')}`],
    ],
    note: 'قسيمة صادرة آلياً — أي اعتراض يتقدّم خلال شهر من تاريخ الصرف.',
  }, body);
}

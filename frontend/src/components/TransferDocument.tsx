import { printDocument } from '../print/brand';
import { qty } from '../utils/money';

export interface TransferPrintLine {
  name: string;
  quantity: number | string;
  unit?: string | null;
}

export interface TransferDoc {
  document_number: string;
  status: string;
  route?: string | null;
  source: string;
  dest: string;
  date?: string | null;
  approvedBy?: string | null;
  statement1?: string | null;
  lines: TransferPrintLine[];
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATUS: Record<string, string> = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد ومشحون',
  rejected: 'مرفوض',
  reversed: 'معكوس',
};

export function printTransfer(d: TransferDoc): void {
  const rows = d.lines.map((l, i) => `
    <tr><td>${i + 1}</td><td style="text-align:right">${l.name}</td>
    <td>${qty(l.quantity)}</td><td>${l.unit || '-'}</td>
    <td></td></tr>`).join('');

  const total = d.lines.reduce((t, l) => t + Number(l.quantity || 0), 0);

  const body = `
    <table class="grid">
      <thead><tr>
        <th>#</th><th>الصنف</th><th>الكمية المرسلة</th><th>الوحدة</th>
        <th style="width:120px">الكمية المستلمة</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="5">لا توجد أصناف</td></tr>'}</tbody>
    </table>
    <table class="totals">
      <tr><td>عدد الأصناف</td><td style="text-align:left">${d.lines.length}</td></tr>
      <tr><td>إجمالي الكميات</td><td style="text-align:left">${qty(total)}</td></tr>
    </table>
    <div class="signatures">
      <div class="sig">توقيع المندوب</div>
      <div class="sig">توقيع أمين المخزن</div>
      <div class="sig">توقيع المستلم</div>
    </div>`;

  const meta: [string, string][] = [
    ['من مخزن', d.source],
    ['إلى مخزن', d.dest],
    ['الحالة', STATUS[d.status] || d.status],
  ];
  if (d.approvedBy) meta.push(['اعتمده', d.approvedBy]);
  if (d.statement1) meta.push(['البيان', esc(d.statement1)]);

  printDocument(
    {
      title: 'إذن تحويل مخزني',
      number: d.document_number,
      date: d.date || undefined,
      meta,
      note: 'تُسلَّم البضاعة بعد توقيع الطرفين — وأي فرق بين المرسِل والمستلِم يُكتب على الورقة قبل الاعتماد.',
    },
    body,
  );
}

export default printTransfer;

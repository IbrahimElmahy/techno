import { printDocument } from '../print/brand';

/**
 * طباعة إذن التحويل — الورقة اللي بتمشي مع البضاعة.
 *
 * A transfer permit is not read on a screen at the moment it matters: the goods leave one store
 * and arrive at another, and the paper travels with them so the person receiving can check what
 * was sent against what turned up, and both sign for it. That is the entire reason this exists —
 * an approved transfer with no printout is two storekeepers trusting each other's memory.
 *
 * Built on `printDocument`, the same engine the invoice and the voucher print through, so the
 * letterhead, the fonts, the page rules and the signature styling are defined once. Nothing about
 * printing is written twice here — this file only says what a TRANSFER puts on the page.
 */

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
  lines: TransferPrintLine[];
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

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

  // The «الكمية المستلمة» column is deliberately blank on paper: the point of walking this sheet
  // to the other store is that somebody counts what arrived and writes it there by hand, and a
  // pre-filled number is a number nobody checks.
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

  printDocument(
    {
      title: 'إذن تحويل مخزني',
      number: d.document_number,
      date: d.date || undefined,
      meta,
      note: 'البضاعة تُسلَّم بعد التوقيع من الطرفين — وأي فرق بين المرسل والمستلم يتكتب على الورقة قبل الاعتماد.',
    },
    body,
  );
}

export default printTransfer;

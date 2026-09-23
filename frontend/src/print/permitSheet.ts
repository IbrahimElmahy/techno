import { printDocument } from './brand';
import { money } from '../utils/money';

/**
 * **ورقة إذن المخزن** — إضافة، صرف، أو بضاعة أول المدة.
 *
 * الأذون كانت **مابتتطبعش خالص**: الشاشة فيها «تعديل» و«عكس» ومافيهاش ورقة. وإذن
 * الصرف بالذات ورقة بتتمسك في الإيد — أمين المخزن بيسلّم بيها ويوقّع عليها، والمستلم
 * بيمضي إنه استلم. من غيرها الإذن بيبقى في النظام بس، والتسليم بيحصل على كلام.
 *
 * نفس الشكل المضغوط بتاع الفواتير: ترويسة سطر، وبيانات في شبكة، وجدول أكثف.
 */
export interface PermitDoc {
  document_number: string;
  kind: 'receipt' | 'issue' | 'opening';
  warehouse_name: string | null;
  permit_date: string | null;
  reason: string | null;
  notes: string | null;
  statement1?: string | null;
  external_document_number?: string | null;
  total_cost: string;
  is_reversal: boolean;
  lines: { item_name: string | null; item_id: number; quantity: string;
           unit_cost: string; line_cost: string }[];
}

const TITLE: Record<PermitDoc['kind'], string> = {
  receipt: 'إذن إضافة مخزني',
  issue: 'إذن صرف مخزني',
  opening: 'بضاعة أول المدة',
};

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const qty = (v: string | number) =>
  Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

export function printPermit(p: PermitDoc): void {
  const rows = p.lines.map((l, i) => `<tr>
    <td>${i + 1}</td>
    <td style="text-align:right">${esc(l.item_name || `#${l.item_id}`)}</td>
    <td>${qty(l.quantity)}</td>
    <td>${money(l.unit_cost)}</td>
    <td>${money(l.line_cost)}</td>
  </tr>`).join('');

  const body = `
    <table class="grid">
      <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">لا توجد أصناف</td></tr>'}</tbody>
    </table>
    <div class="f-cols">
      <div class="f-col">
        <div class="f-row"><span>عدد الأصناف</span><b>${p.lines.length}</b></div>
        <div class="f-row f-strong"><span>إجمالي التكلفة</span><b>${money(p.total_cost)} ج.م</b></div>
      </div>
    </div>
    <div class="c-sigs">
      <div class="sig">أمين المخزن</div>
      <div class="sig">${p.kind === 'issue' ? 'المستلم' : 'المسلِّم'}</div>
      <div class="sig">المحاسب</div>
    </div>`;

  const meta: [string, string][] = [
    ['المخزن', esc(p.warehouse_name || '-')],
    ['التاريخ', esc(p.permit_date || '-')],
  ];
  if (p.external_document_number) meta.push(['رقم الورقة', esc(p.external_document_number)]);
  if (p.reason) meta.push(['السبب', esc(p.reason)]);
  if (p.statement1) meta.push(['البيان', esc(p.statement1)]);
  if (p.notes) meta.push(['ملاحظات', esc(p.notes)]);

  printDocument({
    title: p.is_reversal ? `${TITLE[p.kind]} — عكسي` : TITLE[p.kind],
    number: p.document_number,
    meta,
  }, body);
}

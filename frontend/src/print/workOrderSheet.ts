import { printDocument } from './brand';

export interface WorkOrderMaterial {
  item_id: number;
  warehouse_id: number | null;
  planned_quantity: string;
  stage?: string | null;
}

export type WorkOrderStage = 'production' | 'quality';

const STAGE_SHEET: Record<WorkOrderStage, { title: string; note: string; who: string }> = {
  production: {
    title: 'إذن تشغيل — خامات التصنيع',
    who: 'الورشة / المكن',
    note: 'الخامات دي بتتصرف مع بداية الأمر. اكتب المنصرف واللي طلع فعلاً بالقلم وسلّم الورقة للمكتب.',
  },
  quality: {
    title: 'إذن جودة — مواد التعبئة',
    who: 'الجودة / التعبئة',
    note: 'المواد دي بتتصرف بعد ما الإنتاج يطلع. اكتب المنصرف الفعلي بالقلم وسلّم الورقة للمكتب.',
  },
};

export interface WorkOrderProduct {
  id: number;
  item_id: number;
  warehouse_id: number | null;
  planned_quantity: string;
  quantity: string;
}

export interface WorkOrderDoc {
  document_number: string;
  external_document_number: string | null;
  production_date: string | null;
  branch_id: number | null;
  statement1: string | null;
  notes: string | null;
  products: WorkOrderProduct[];
  materials: (WorkOrderMaterial & { product_line_id: number | null })[];
}

export interface WorkOrderNames {
  itemName: (id: number) => string;
  itemCode: (id: number) => string;
  itemUnit: (id: number) => string;
  whName: (id: number | null | undefined) => string;
  branchName: (id: number | null) => string;
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function qty(v: string | number): string {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return String(v ?? '');
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

const SHEET_CSS = `
<style>
  table.wo { width: 100%; border-collapse: collapse; margin-top: 6px; }
  /* رأس الجدول أسود على رمادي فاتح ومقفول بخط أسود — على الشاشة وعلى الورق بنفس الشكل.
     كان أبيض على أخضر، والطابعة الأبيض والأسود بتطبع من غير خلفيات فكان بيطلع فاضي.
     الشرح كامل عند PRINT_COLORS في brand.ts. */
  table.wo > thead > tr > th {
    background: #e6e6e6; color: #000; padding: 6px 8px; font-size: 12.5px; font-weight: 800;
    border: 1px solid #444; border-bottom: 2px solid #000; text-align: center;
  }
  @media print {
    table.wo > thead > tr > th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  table.wo > tbody > tr > td {
    border: 1px solid #444; padding: 6px 8px; font-size: 12.5px; vertical-align: top; color: #000;
  }
  .prod-name { font-weight: 700; font-size: 13px; line-height: 1.5; }
  .prod-code { color: #2b2b2b; font-size: 11.5px; direction: ltr; display: block; }
  .kv { margin-top: 5px; font-size: 12px; color: #1a1a1a; }
  .kv b { color: #000; }
  /* خانة الكتابة بالقلم — سطر مفتوح بعرض معروف، مش مربع فاضي يتلخبط مع الجدول. */
  .pen {
    display: inline-block; min-width: 74px; border-bottom: 1.4px dotted #333;
    height: 17px; vertical-align: -4px;
  }
  table.mat { width: 100%; border-collapse: collapse; }
  table.mat th {
    font-size: 11.5px; color: #000; font-weight: 800; text-align: center;
    border-bottom: 1px solid #444; padding: 2px 4px; background: #eee;
  }
  table.mat td {
    font-size: 12px; padding: 3px 4px; border-bottom: 1px dashed #888;
    text-align: center;
  }
  table.mat td.nm { text-align: right; font-weight: 600; }
  table.mat td.cd { direction: ltr; color: #2b2b2b; font-size: 11.5px; }
  table.mat tr:last-child td { border-bottom: none; }
  .none { color: #444; font-size: 12px; }
  .hdr-note {
    background: #f2f2f2; border: 1px solid #444; padding: 6px 10px;
    font-size: 12px; color: #000; margin-top: 8px;
  }
</style>`;

export function printWorkOrder(
  doc: WorkOrderDoc, n: WorkOrderNames, stage: WorkOrderStage = 'production',
): void {
  const inStage = (m: { stage?: string | null }) =>
    (m.stage === 'quality' ? 'quality' : 'production') === stage;

  const rows = doc.products.map((p, i) => {
    const mine = doc.materials.filter((m) => inStage(m)
      && (m.product_line_id === p.id || (i === 0 && m.product_line_id === null)));
    const mats = mine.length
      ? `<table class="mat">
           <thead><tr>
             <th style="width:38%">الخامة</th><th style="width:20%">الكود</th>
             <th style="width:20%">من مخزن</th><th style="width:11%">المطلوب</th>
             <th style="width:11%">المنصرف</th>
           </tr></thead>
           <tbody>${mine.map((m) => `<tr>
             <td class="nm">${esc(n.itemName(m.item_id))}</td>
             <td class="cd">${esc(n.itemCode(m.item_id))}</td>
             <td>${esc(n.whName(m.warehouse_id))}</td>
             <td><b>${qty(m.planned_quantity)}</b> ${esc(n.itemUnit(m.item_id))}</td>
             <td><span class="pen"></span></td>
           </tr>`).join('')}</tbody>
         </table>`
      : '<span class="none">مافيش مواد في المرحلة دي</span>';

    return `<tr>
      <td style="width:8%;text-align:center">${i + 1}</td>
      <td style="width:30%">
        <span class="prod-name">${esc(n.itemName(p.item_id))}</span>
        <span class="prod-code">${esc(n.itemCode(p.item_id))}</span>
        <div class="kv">المطلوب <b>${qty(p.planned_quantity || p.quantity)}
          ${esc(n.itemUnit(p.item_id))}</b></div>
        <div class="kv">ينزل مخزن <b>${esc(n.whName(p.warehouse_id))}</b></div>
        <div class="kv">اللي طلع فعلاً <span class="pen"></span></div>
      </td>
      <td style="width:62%">${mats}</td>
    </tr>`;
  }).join('');

  const body = `${SHEET_CSS}
    <div class="hdr-note">
      <b>الورقة دي لـ:</b> ${STAGE_SHEET[stage].who}
      ${doc.statement1 ? ` · <b>البيان:</b> ${esc(doc.statement1)}` : ''}
      ${doc.notes ? ` · <b>ملاحظات:</b> ${esc(doc.notes)}` : ''}
    </div>
    <table class="wo">
      <thead><tr><th>#</th><th>المنتج</th><th>المواد المطلوبة له</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">مافيش سطور</td></tr>'}</tbody>
    </table>
    <div class="signatures">
      <div class="sig">أمين المخزن</div>
      <div class="sig">مشرف الإنتاج</div>
      <div class="sig">المستلم</div>
    </div>`;

  printDocument({
    title: STAGE_SHEET[stage].title,
    number: doc.document_number,
    meta: [
      ['تاريخ الإنتاج', doc.production_date || '-'],
      ['الفرع', n.branchName(doc.branch_id)],
      ['رقم الورقة', doc.external_document_number || '-'],
    ],
    note: STAGE_SHEET[stage].note,
  }, body);
}

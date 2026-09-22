import { printDocument } from './brand';

/**
 * **ورقة أمر الشغل** — اللي بتتطبع وتتدّي للورشة بعد التأكيد.
 *
 * مش صورة من الشاشة: الشاشة بتقول التكلفة والحالة والقيمة، والورشة مش محتاجة ولا
 * واحدة فيهم. اللي على الورقة هو اللي حد هيمشي بيه — **يصرف إيه من فين، ويعمل إيه** —
 * ومعاه خانات فاضية يكتب فيها اللي حصل فعلاً بالقلم، عشان الرقم اللي هيتدخّل النظام
 * بعدين يكون مكتوب من ساعتها مش مستنتج آخر اليوم.
 *
 * والتكلفة مش على الورقة **عن قصد**: ورقة بتروح الورشة وفيها سعر الخامة بتتحوّل من
 * تعليمات شغل لورقة أسعار بتتنقل.
 */
export interface WorkOrderMaterial {
  item_id: number;
  warehouse_id: number | null;
  planned_quantity: string;
  stage?: string | null;
}

/** مرحلة الصرف اللي الورقة دي بتتطبع عنها. */
export type WorkOrderStage = 'production' | 'quality';

const STAGE_SHEET: Record<WorkOrderStage, { title: string; note: string }> = {
  production: {
    title: 'إذن تشغيل — خامات التصنيع',
    note: 'الخامات دي بتتصرف مع بداية الأمر. اكتب المنصرف الفعلي بالقلم وسلّم الورقة للمكتب.',
  },
  quality: {
    title: 'إذن جودة — مواد التعبئة',
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

/** رقم بيتقرا: ٣ مش ٣٫٠٠٠، و١٫١٥ بتفضل ١٫١٥. */
function qty(v: string | number): string {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return String(v ?? '');
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/**
 * `stage` بيحدّد الورقة دي بتاعة مين.
 *
 * **ورقتين مش ورقة**: إذن التصنيع بيروح للمكن أول ما الأمر يبدأ، وإذن الجودة بيروح
 * للتعبئة بعد ما المنتج يطلع. طبعهم على ورقة واحدة معناه إن اللي على المكن شايف
 * كرتون مالوش دعوة بيه، واللي في التعبئة شايف خام مش هيلمسه — وكل واحد فيهم ممكن
 * يصرف اللي مش بتاعه.
 */
export function printWorkOrder(
  doc: WorkOrderDoc, n: WorkOrderNames, stage: WorkOrderStage = 'production',
): void {
  const inStage = (m: { stage?: string | null }) =>
    (m.stage === 'quality' ? 'quality' : 'production') === stage;
  const blocks = doc.products.map((p, i) => {
    // خامات السطر ده. واللي مش منسوب لمنتج (product_line_id فاضي) بيتحط تحت أول
    // منتج بدل ما يختفي — ورقة ناقصة خامة أسوأ من ورقة ترتيبها مش مظبوط.
    const mine = doc.materials.filter((m) => inStage(m)
      && (m.product_line_id === p.id || (i === 0 && m.product_line_id === null)));
    const rows = mine.map((m) => `<tr>
      <td style="text-align:right">${esc(n.itemName(m.item_id))}</td>
      <td>${esc(n.itemCode(m.item_id))}</td>
      <td>${esc(n.whName(m.warehouse_id))}</td>
      <td><b>${qty(m.planned_quantity)}</b> ${esc(n.itemUnit(m.item_id))}</td>
      <td style="width:90px"></td>
    </tr>`).join('');
    return `<div class="no-break" style="margin-top:16px">
      <table class="meta" style="margin-bottom:6px">
        <tr>
          <td class="k">منتج ${i + 1}</td>
          <td><b>${esc(n.itemName(p.item_id))}</b> — ${esc(n.itemCode(p.item_id))}</td>
          <td class="k" style="width:90px">المطلوب</td>
          <td style="width:120px"><b>${qty(p.planned_quantity || p.quantity)}</b>
            ${esc(n.itemUnit(p.item_id))}</td>
          <td class="k" style="width:90px">ينزل مخزن</td>
          <td>${esc(n.whName(p.warehouse_id))}</td>
        </tr>
        <tr>
          <td class="k">اللي طلع فعلاً</td>
          <td colspan="5" style="height:30px"></td>
        </tr>
      </table>
      <table class="grid">
        <thead><tr>
          <th style="width:34%">الخامة</th><th>الكود</th><th>تتصرف من</th>
          <th>الكمية المطلوبة</th><th>المنصرف فعلاً</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="5">مافيش خامات في المرحلة دي</td></tr>`}</tbody>
      </table>
    </div>`;
  }).join('');

  const body = `${blocks}
    ${doc.statement1 ? `<p style="margin-top:14px"><b>البيان:</b> ${esc(doc.statement1)}</p>` : ''}
    ${doc.notes ? `<p><b>ملاحظات:</b> ${esc(doc.notes)}</p>` : ''}
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

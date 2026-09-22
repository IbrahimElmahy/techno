import { printDocument } from './brand';

/**
 * **ورقة إذن الصرف** — اللي بتتطبع وتتدّي للورشة أو للتعبئة.
 *
 * مش صورة من الشاشة: الشاشة بتقول التكلفة والحالة والقيمة، والورشة مش محتاجة ولا
 * واحدة فيهم. اللي على الورقة هو اللي حد هيمشي بيه — **يصرف إيه من فين، ويعمل إيه** —
 * ومعاه خانات فاضية يكتب فيها اللي حصل فعلاً بالقلم، عشان الرقم اللي هيتدخّل النظام
 * بعدين يكون مكتوب من ساعتها مش مستنتج آخر اليوم.
 *
 * والتكلفة مش على الورقة **عن قصد**: ورقة بتروح الورشة وفيها سعر الخامة بتتحوّل من
 * تعليمات شغل لورقة أسعار بتتنقل.
 *
 * ---------------------------------------------------------------------------
 * **التوزيع: المنتج على اليمين، خاماته على الشمال.**
 *
 * الشكل الأول كان بيكرّر ترويسة كاملة لكل منتج وتحتها جدول — فالمنتج الواحد كان
 * بياخد ثلث صفحة، وأمر بأربع منتجات بيطلع في صفحتين ونص. والراجل اللي ماسك الورقة
 * بيقلّب عشان يشوف الخامة دي بتاعة أنهي منتج.
 *
 * دلوقتي كل منتج **صف واحد** في جدول واحد: خانة اليمين فيها المنتج وكميته ومخزنه
 * وخانة «اللي طلع»، وخانة الشمال فيها خاماته كجدول صغير. العين بتقرا الاتنين مع
 * بعض في سطر واحد، والصفحة بتشيل أربع أو خمس منتجات بدل واحد.
 */
export interface WorkOrderMaterial {
  item_id: number;
  warehouse_id: number | null;
  planned_quantity: string;
  stage?: string | null;
}

/** مرحلة الصرف اللي الورقة دي بتتطبع عنها. */
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

/** رقم بيتقرا: ٣ مش ٣٫٠٠٠، و١٫١٥ بتفضل ١٫١٥. */
function qty(v: string | number): string {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return String(v ?? '');
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** ستايل الورقة — أصغر وأكتف من الافتراضي، عشان الصفحة تشيل شغل يوم مش منتج. */
const SHEET_CSS = `
<style>
  table.wo { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.wo > thead > tr > th {
    background: #3FA92B; color: #fff; padding: 6px 8px; font-size: 12px;
    border: 1px solid #3FA92B; text-align: center;
  }
  table.wo > tbody > tr > td {
    border: 1px solid #cfe0d4; padding: 6px 8px; font-size: 12px; vertical-align: top;
  }
  .prod-name { font-weight: 700; font-size: 13px; line-height: 1.5; }
  .prod-code { color: #5d6f64; font-size: 11px; direction: ltr; display: block; }
  .kv { margin-top: 5px; font-size: 11.5px; color: #3a4d41; }
  .kv b { color: #16241c; }
  /* خانة الكتابة بالقلم — سطر مفتوح بعرض معروف، مش مربع فاضي يتلخبط مع الجدول. */
  .pen {
    display: inline-block; min-width: 74px; border-bottom: 1.4px dotted #7a8f81;
    height: 17px; vertical-align: -4px;
  }
  table.mat { width: 100%; border-collapse: collapse; }
  table.mat th {
    font-size: 10.5px; color: #5d6f64; font-weight: 700; text-align: center;
    border-bottom: 1px solid #cfe0d4; padding: 2px 4px; background: #f4faf5;
  }
  table.mat td {
    font-size: 11.5px; padding: 3px 4px; border-bottom: 1px dashed #e3eee6;
    text-align: center;
  }
  table.mat td.nm { text-align: right; font-weight: 600; }
  table.mat td.cd { direction: ltr; color: #5d6f64; font-size: 10.5px; }
  table.mat tr:last-child td { border-bottom: none; }
  .none { color: #95a5a6; font-size: 11.5px; }
  .hdr-note {
    background: #f4faf5; border: 1px solid #cfe0d4; padding: 6px 10px;
    font-size: 11.5px; color: #3a4d41; margin-top: 8px;
  }
</style>`;

export function printWorkOrder(
  doc: WorkOrderDoc, n: WorkOrderNames, stage: WorkOrderStage = 'production',
): void {
  const inStage = (m: { stage?: string | null }) =>
    (m.stage === 'quality' ? 'quality' : 'production') === stage;

  const rows = doc.products.map((p, i) => {
    // خامات السطر ده. واللي مش منسوب لمنتج (product_line_id فاضي) بيتحط تحت أول
    // منتج بدل ما يختفي — ورقة ناقصة خامة أسوأ من ورقة ترتيبها مش مظبوط.
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

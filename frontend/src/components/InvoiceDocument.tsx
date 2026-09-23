import React from 'react';
import { Button, Space } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import Logo, { BRAND } from './Logo';
import { printDocument } from '../print/brand';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import { COMPANY, companyLines } from '../config/company';
import { money as n, numeralsLocale } from '../utils/money';

/**
 * A real-looking invoice — used for BOTH sales and purchase invoices, on screen and in print.
 *
 * The same data builds the on-screen sheet and the printed page, so what the user reviews is
 * what comes out of the printer. Before this, the "invoice" was a bare label/value grid.
 */

export interface InvoiceLine {
  name: string;
  itemId?: number | null;   // set → the product name links to its file
  quantity: string | number;
  unit?: string | null;
  unit_price: string | number;
  discount_pct?: string | number;
  points?: string | number;
  line_total: string | number;
  tier?: string | null;
  warehouse?: string | null;   // (030) which warehouse this line moved through
}

export interface InvoiceDoc {
  kind: 'sale' | 'purchase' | 'sale_return';
  document_number: string;
  date?: string | null;
  /** Customer (sale) or supplier (purchase). */
  partyLabel: string;
  partyName: string;
  partyPhone?: string | null;
  partyAddress?: string | null;
  lines: InvoiceLine[];
  gross: string | number;
  discountPct?: string | number;
  net: string | number;
  tax?: string | number;
  cash: string | number;
  credit: string | number;
  entryId?: number | null;
  partyId?: number | null;   // set → the party name links to its profile
  totalPoints?: string | number;
  extraMeta?: [string, string][];
  /** «الفرع» and «مندوب» on the printed head, when the switches ask for them. */
  branchName?: string | null;
  repName?: string | null;
  /** «حساب العميل» — the party's ledger account, for the file copy. */
  partyAccount?: string | null;
  /**
   * حساب العميل **قبل** المستند ده، زي ما كان ساعة الترحيل (`prior_balance`).
   *
   * بيتقرا من المستند مش بيتحسب دلوقتي: رصيد العميل بيتغيّر مع كل حركة، ولو الورقة
   * حسبته وقت الطباعة يبقى نفس المستند بيطلع برقمين في تاريخين. `null`/undefined =
   * مستند أقدم من العمود، والسطر ساعتها مابيتعرضش بدل ما يخترع صفر.
   */
  priorBalance?: string | number | null;
  /** نوع الفاتورة (أبيض/بولي) — بيتكتب جنب «الحساب السابق» عشان يبان إنه حساب الخط ده. */
  family?: string | null;
  /**
   * **مديونية النوع التاني** وقت الترحيل — لو الفاتورة أبيض فده رصيد البولي.
   * بتتطبع تحت «الباقي» عشان العميل يعرف الاتنين من غير ما يتخلطوا في رقم واحد.
   */
  otherFamily?: string | null;
  /** فاتورة بونص — بضاعة هدية بقيمة صفر. الفوتر بيقول قيمتها بسعر البيع بدل الحساب. */
  isBonus?: boolean;
  otherFamilyBalance?: string | number | null;
}


// **«طلب بيع» مش «فاتورة مبيعات».**
//
// الورقة اللي بتتسلّم للعميل بتتطبع ساعة البيع، وكلمة «فاتورة» عليها بتخلّيها تقرا
// كمستند ضريبي وهي مش كده. الفاتورة الرسمية بتطلع من المحاسبة بعد الترحيل. الورقة دي
// بتقول اتفقنا على إيه واستلم إيه — مش بتقوم مقام ورق قانوني.
// (المشتريات والمرتجع زي ما هما: التسمية دي بتاعة اللي بيتسلّم للعميل.)
const titleOf = (d: InvoiceDoc) => (
  d.isBonus ? 'فاتورة بونص'
  : d.kind === 'sale' ? 'طلب بيع'
    : d.kind === 'sale_return' ? 'مرتجع مبيعات'
      : 'فاتورة مشتريات');

const payable = (d: InvoiceDoc) => Number(d.net || 0) + Number(d.tax || 0);

// A sale-return is the reverse of a sale: money flows back to the customer, so the cash line reads
// "المسترد نقداً" and the "credit" line is a reduction of what the customer owes.
const cashLabel = (d: InvoiceDoc) => (
  d.kind === 'sale' ? 'المدفوع نقداً'
    : d.kind === 'sale_return' ? 'المسترد نقداً'
      : 'المسدد نقداً');
const creditLabel = (d: InvoiceDoc) => (
  d.kind === 'sale_return' ? 'خصم من حساب العميل (آجل)' : 'المتبقي (آجل)');
const payableLabel = (d: InvoiceDoc) => (
  d.kind === 'sale_return' ? 'إجمالي المرتجع' : 'الإجمالي المستحق');

const NOTE: Record<InvoiceDoc['kind'], string> = {
  sale: 'البضاعة المباعة لا تُرد ولا تُستبدل إلا وفق شروط الضمان المعتمدة.',
  purchase: 'تم استلام الأصناف المذكورة أعلاه بالحالة والكميات الموضحة.',
  sale_return: 'تم استرجاع الأصناف المذكورة أعلاه إلى المخزن وتسوية قيمتها لحساب العميل.',
};

/** The head cells, filtered by مفاتيح الطباعة.
 *
 * The party's NAME always prints — a document that does not say who it is for is not a document.
 * «بيانات العميل» governs the detail beside it: the phone and address a file copy wants and a
 * receipt handed across a counter does not.
 */
function headMeta(d: InvoiceDoc, o: PrintOptions): [string, string][] {
  const rows: [string, string][] = [[d.partyLabel, d.partyName]];
  if (o.customerDetails) {
    rows.push(['الهاتف', d.partyPhone || '-']);
    if (d.partyAddress) rows.push(['العنوان', d.partyAddress]);
  }
  if (o.customerAccount && d.partyAccount) rows.push(['حساب العميل', d.partyAccount]);
  if (o.branch && d.branchName) rows.push(['الفرع', d.branchName]);
  if (o.rep && d.repName) rows.push(['مندوب', d.repName]);
  rows.push(['التاريخ',
    d.date ? String(d.date).slice(0, 10) : new Date().toLocaleDateString('ar-EG')]);
  if (o.paidAndRemaining) {
    // البونص مالوش سداد — «نقدي» عليه كانت بتقول إن العميل دفع.
    if (!d.isBonus) rows.push(['طريقة السداد', Number(d.credit || 0) > 0 ? 'آجل / جزئي' : 'نقدي']);
  }
  return [...rows, ...(d.extraMeta || [])];
}

/**
 * **الفوتر على تلات أعمدة — زي دفتر الفواتير اللي في إيد المكتب.**
 *
 *     ┌ الخصم ─────────┐ ┌ الحساب ─────────────────────┐ ┌ السداد ───────┐
 *     │ قبل الخصم       │ │ إجمالي الفاتورة               │ │ المدفوع        │
 *     │ الخصم           │ │ يضاف إليه الحساب السابق (أبيض) │ │ الباقي         │
 *     │ الضريبة         │ │ الإجمالي                      │ │ مديونية البولي │
 *     └────────────────┘ └──────────────────────────────┘ └───────────────┘
 *
 * كان جدول إجماليات واحد نازل تسع صفوف، وفيه «الإجمالي المستحق» و«الرصيد بعد الطلب»
 * — والأخير بيجمع الأبيض على البولي في رقم مالوش حساب يتسدّ فيه.
 *
 * **والحساب السابق بتاع نوع الفاتورة بس.** العميل اللي عنده خطّين بيتحصّل منه كل خط
 * لوحده، فالورقة بتجمع الفاتورة على حساب خطها، و**مديونية الخط التاني بتتكتب لوحدها
 * تحت الباقي** — يعرف الاتنين من غير ما يتخلطوا.
 *
 * عمود الخصم بيختفي لو مافيش خصم ولا ضريبة، والتاني بيبقى «إجمالي الفاتورة» بس لما
 * مايكونش فيه حساب سابق (المشتريات والمرتجعات).
 */
function footerColumns(
  d: InvoiceDoc, o: PrintOptions, dPrior: number | null, discount: number,
  pts: (v: any) => string,
): string {
  const row = (k: string, v: string, strong = false) =>
    `<div class="f-row${strong ? ' f-strong' : ''}"><span>${k}</span><b>${v}</b></div>`;
  const cur = (v: number | string) => `${n(v)} ج.م`;
  const due = payable(d);

  const col1: string[] = [];
  if (discount > 0 || Number(d.tax || 0) > 0) {
    col1.push(row('الإجمالي قبل الخصم', cur(d.gross)));
    if (discount > 0) col1.push(row(`الخصم (${Number(d.discountPct || 0)}%)`, cur(discount)));
    if (Number(d.tax || 0) > 0) col1.push(row('ضريبة القيمة المضافة', cur(d.tax as any)));
  }

  const fam = d.family ? ` (${d.family})` : '';
  const col2: string[] = [row(d.kind === 'sale_return' ? 'إجمالي المرتجع' : 'إجمالي الفاتورة', cur(due))];
  if (dPrior != null) {
    col2.push(row(`يضاف إليه الحساب السابق${fam}`, cur(dPrior)));
    col2.push(row('الإجمالي', cur(dPrior + due), true));
  }

  const col3: string[] = [];
  if (o.paidAndRemaining) {
    const paid = Number(d.cash || 0);
    col3.push(row(cashLabel(d), cur(paid)));
    // الباقي من «الإجمالي» لما فيه حساب سابق — ده اللي على العميل بعد الورقة دي.
    const left = dPrior != null ? dPrior + due - paid : Number(d.credit || 0);
    col3.push(row('الباقي', cur(left), true));
  }
  if (d.kind === 'sale' && d.otherFamilyBalance != null) {
    col3.push(row(`مديونية ${d.otherFamily || 'الخط التاني'}`, cur(d.otherFamilyBalance)));
  }
  if (Number(d.totalPoints || 0) > 0) {
    col3.push(row('نقاط الولاء', `${pts(d.totalPoints)} نقطة`));
  }

  const col = (rows: string[]) => (rows.length ? `<div class="f-col">${rows.join('')}</div>` : '');
  // **البونص مالوش حساب.** قيمته صفر ومابيلمسش رصيد العميل، فسطور «الحساب السابق»
  // و«الباقي» هتقول أرقام مالهاش علاقة بالورقة. اللي يهم فيها: خرج بكام بسعر البيع.
  if (d.isBonus) {
    return `
    <div class="f-cols">${col([row('قيمة البونص بسعر البيع', cur(d.gross)),
      row('المطلوب من العميل', cur(0), true)])}</div>
    <div class="c-sigs">
      <div class="sig">توقيع المستلم</div>
      <div class="sig">المندوب</div>
      <div class="sig">المحاسب</div>
    </div>`;
  }
  return `
    <div class="f-cols">${col(col1)}${col(col2)}${col(col3)}</div>
    <div class="c-sigs">
      <div class="sig">${d.kind === 'purchase' ? 'توقيع المورد' : 'توقيع المستلم'}</div>
      <div class="sig">${d.kind === 'purchase' ? 'أمين المخزن' : 'المندوب'}</div>
      <div class="sig">المحاسب</div>
    </div>`;
}

/** Print this invoice on the shared company letterhead, honouring مفاتيح الطباعة. */
export function printInvoice(d: InvoiceDoc, opts?: PrintOptions): void {
  const o = opts ?? loadPrintOptions();
  // Only show a column when at least one line actually uses it.
  const anyDisc = d.lines.some((l) => Number(l.discount_pct || 0) > 0);
  const anyPts = d.lines.some((l) => Number(l.points || 0) > 0);
  // (030) Only worth a column when the document actually spans more than one warehouse —
  // printing the same name on every row would be noise.
  const warehouses = new Set(d.lines.map((l) => l.warehouse).filter(Boolean));
  const anyWh = warehouses.size > 1;
  const cols = 6 + (anyWh ? 1 : 0) + (anyDisc ? 1 : 0) + (anyPts ? 1 : 0);
  const pts = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 });
  const rows = d.lines.map((l, i) => `
    <tr><td>${i + 1}</td><td style="text-align:right">${l.name}</td>
    ${anyWh ? `<td>${l.warehouse || '-'}</td>` : ''}
    <td>${Number(l.quantity)}</td><td>${l.unit || '-'}</td>
    <td>${n(l.unit_price)}</td>${anyDisc ? `<td>${Number(l.discount_pct || 0)}%</td>` : ''}
    ${anyPts ? `<td>${pts(l.points)}</td>` : ''}
    <td>${n(l.line_total)}</td></tr>`).join('');
  const discount = Number(d.gross || 0) - Number(d.net || 0);
  // نفس حساب النسخة اللي على الشاشة بالحرف — الورقة المطبوعة والمعروضة لازم يقولوا
  // نفس الأرقام، وده المكان اللي بيفترقوا فيه لو كل واحد حسب لوحده.
  const dPrior = d.priorBalance == null || d.kind !== 'sale' ? null : Number(d.priorBalance);
  const body = `
    <table class="grid">
      <thead><tr><th>#</th><th>الصنف</th>${anyWh ? '<th>المخزن</th>' : ''}<th>الكمية</th><th>الوحدة</th>
        <th>سعر الوحدة</th>${anyDisc ? '<th>الخصم</th>' : ''}${anyPts ? '<th>النقاط</th>' : ''}<th>الإجمالي</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${cols}">لا توجد أصناف</td></tr>`}</tbody>
    </table>
    ${footerColumns(d, o, dPrior, discount, pts)}`;
  printDocument(
    {
      // **نوع الفاتورة في العنوان نفسه** — «طلب بيع — أبيض». أول حاجة العين
      // بتقراها في الورقة، والمكتب بيفرز بيها قبل أي رقم.
      title: d.family ? `${titleOf(d)} — ${d.family}` : titleOf(d),
      number: d.document_number,
      // **الشكل المضغوط** — الشرح عند `DocMeta.compact`. الترويسة والذيل كانوا
      // بياخدوا تلت الصفحة، فطلب بعشرين صنف كان بيطلع في صفحتين.
      compact: true,
      meta: headMeta(d, o),
      note: NOTE[d.kind],
      hide: {
        // **ورقة البيع بتطلع من غير هوية الشركة — بقرار، مش بمفتاح.**
        //
        // دي مش مستند ضريبي: الفاتورة الرسمية بتطلع من المحاسبة بعد الترحيل. ورقة
        // بشعار الشركة واسمها وعنوانها بتقرا كفاتورة مهما كان المكتوب عليها، واللي
        // بيستلمها مش هيفرّق. فالهوية بتتشال من الأصل بدل ما تتسّاب لمفتاح ينساه حد.
        //
        // ومفتاحَي «شعار الشركة» و«اسم الشركة» لسه بيشتغلوا على المشتريات والمرتجعات —
        // ودول بيتخفوا من قايمة المفاتيح على شاشة البيع عشان مايبقوش وعد كداب.
        logo: d.kind === 'sale' || !o.logo,
        companyName: d.kind === 'sale' || !o.companyName,
        companyFooter: d.kind === 'sale',
        invoiceNumber: !o.invoiceNumber,
        invoiceTitle: !o.invoiceTitle,
      },
    },
    body,
  );
}

const cell: React.CSSProperties = {
  border: '1px solid #d9e6dc', padding: '7px 8px', fontSize: 13, textAlign: 'center',
};
const headCell: React.CSSProperties = {
  ...cell, background: BRAND.green, color: '#fff', border: `1px solid ${BRAND.green}`,
  fontWeight: 700,
};

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div style={{ ...cell, background: '#f2f9f3', fontWeight: 700, textAlign: 'right' }}>{label}</div>
      <div style={{ ...cell, textAlign: 'right' }}>{value ?? '-'}</div>
    </>
  );
}

export default function InvoiceDocument({
  doc, onItemClick, onPartyClick,
}: {
  doc: InvoiceDoc;
  onItemClick?: (itemId: number) => void;
  onPartyClick?: (partyId: number) => void;
}) {
  const discount = Number(doc.gross || 0) - Number(doc.net || 0);
  const anyLineDiscount = doc.lines.some((l) => Number(l.discount_pct || 0) > 0);
  const anyLinePoints = doc.lines.some((l) => Number(l.points || 0) > 0);
  // (030) Show the warehouse column only when the document spans more than one.
  const anyLineWarehouse =
    new Set(doc.lines.map((l) => l.warehouse).filter(Boolean)).size > 1;
  const pts = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 });
  // **الحساب كامل، مش رقم الورقة لوحدها.**
  //
  // العميل اللي عليه حساب من قبل بيقرا «الإجمالي المستحق» على إنه كل اللي عليه، فبيدفع
  // على أساسه ويتفاجئ بعدين. فالورقة بقت بتقول اللي البائع بيقوله بلسانه: كان عليك كذا،
  // والطلب ده بكذا، ودفعت كذا، فالباقي كذا.
  //
  // الرقم جاي من المستند (`prior_balance` المتقفّل وقت الترحيل) — مش بيتحسب دلوقتي.
  const prior = doc.priorBalance == null ? null : Number(doc.priorBalance);
  const totals: [string, string, boolean?][] = [
    ...(prior != null && doc.kind === 'sale'
      ? ([['الحساب السابق', `${n(prior)} ج.م`]] as [string, string][])
      : []),
    ['الإجمالي قبل الخصم', `${n(doc.gross)} ج.م`],
    ...(discount > 0
      ? ([[`الخصم (${Number(doc.discountPct || 0)}%)`, `${n(discount)} ج.م`]] as [string, string][])
      : []),
    ['الصافي', `${n(doc.net)} ج.م`],
    ...(Number(doc.tax || 0) > 0
      ? ([['ضريبة القيمة المضافة', `${n(doc.tax)} ج.م`]] as [string, string][])
      : []),
    [cashLabel(doc), `${n(doc.cash)} ج.م`],
    [creditLabel(doc), `${n(doc.credit)} ج.م`],
    [payableLabel(doc), `${n(payable(doc))} ج.م`, true],
    ...(prior != null && doc.kind === 'sale'
      ? ([['الرصيد بعد الطلب',
           `${n(prior + payable(doc) - Number(doc.cash || 0))} ج.م`, true]] as
          [string, string, boolean][])
      : []),
    ...(Number(doc.totalPoints || 0) > 0
      ? ([['نقاط الولاء المكتسبة', `${pts(doc.totalPoints)} نقطة`]] as [string, string][])
      : []),
  ];

  // المعاينة على الشاشة لازم تبقى هي هي الورقة اللي هتطلع من الطابعة. ورقة البيع
  // بتتطبع من غير هوية الشركة، فالمعاينة مالهاش تعرضها — وإلا اللي بيراجع قبل ما يطبع
  // بيوافق على ورقة غير اللي العميل هياخدها.
  const plain = doc.kind === 'sale';

  return (
    <div style={{ background: '#fff' }}>
      {/* Letterhead */}
      {!plain && (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, paddingBottom: 12, borderBottom: `3px solid ${BRAND.green}`,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: BRAND.green }}>{COMPANY.nameAr}</div>
          {companyLines().map((l) => (
            <div key={l} style={{ fontSize: 11, color: '#5d6f64' }}>{l}</div>
          ))}
        </div>
        <Logo width={150} />
      </div>
      )}
      {!plain && <div style={{ height: 4, background: BRAND.orange, marginTop: 3 }} />}

      {/* Title + number */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, margin: '16px 0 10px', flexWrap: 'wrap',
      }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>{titleOf(doc)}</h2>
        <span style={{
          background: BRAND.green, color: '#fff', padding: '4px 14px',
          borderRadius: 999, fontWeight: 700,
        }}>
          {doc.document_number}
        </span>
      </div>

      {/* Party + terms */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 120px 1fr', marginBottom: 14 }}>
        <MetaRow label={doc.partyLabel} value={
          onPartyClick && doc.partyId
            ? <a onClick={() => onPartyClick(doc.partyId as number)}
                style={{ color: BRAND.green, fontWeight: 600 }}>{doc.partyName}</a>
            : doc.partyName
        } />
        <MetaRow label="الهاتف" value={doc.partyPhone || '-'} />
        <MetaRow label="التاريخ" value={doc.date ? String(doc.date).slice(0, 10) : '-'} />
        {!doc.isBonus && <MetaRow label="طريقة السداد" value={Number(doc.credit || 0) > 0 ? 'آجل / جزئي' : 'نقدي'} />}
        {doc.partyAddress ? <MetaRow label="العنوان" value={doc.partyAddress} /> : null}
        {doc.entryId ? <MetaRow label="رقم القيد" value={doc.entryId} /> : null}
        {(doc.extraMeta || []).map(([k, v]) => <MetaRow key={k} label={k} value={v} />)}
      </div>

      {/* Lines */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['#', 'الصنف', ...(anyLineWarehouse ? ['المخزن'] : []),
                'الكمية', 'الوحدة', 'سعر الوحدة',
                ...(anyLineDiscount ? ['الخصم'] : []),
                ...(anyLinePoints ? ['النقاط'] : []), 'الإجمالي'].map((h) => (
                <th key={h} style={headCell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.lines.length === 0 ? (
              <tr><td style={cell} colSpan={6 + (anyLineWarehouse ? 1 : 0)
                + (anyLineDiscount ? 1 : 0) + (anyLinePoints ? 1 : 0)}>
                لا توجد أصناف</td></tr>
            ) : doc.lines.map((l, i) => (
              <tr key={i} style={i % 2 ? { background: '#f7fbf8' } : undefined}>
                <td style={cell}>{i + 1}</td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {onItemClick && l.itemId
                    ? <a onClick={() => onItemClick(l.itemId as number)}
                        style={{ color: BRAND.green, fontWeight: 600 }}>{l.name}</a>
                    : l.name}
                </td>
                {anyLineWarehouse && <td style={cell}>{l.warehouse || '-'}</td>}
                <td style={cell}>{Number(l.quantity)}</td>
                <td style={cell}>{l.unit || '-'}</td>
                <td style={cell}>{n(l.unit_price)}</td>
                {anyLineDiscount && <td style={cell}>{Number(l.discount_pct || 0)}%</td>}
                {anyLinePoints && <td style={cell}>{pts(l.points)}</td>}
                <td style={cell}>{n(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <table style={{ marginTop: 14, marginInlineStart: 'auto', width: 320 }}>
        <tbody>
          {totals.map(([k, v, strong], i) => (
            <tr key={i}>
              <td style={{
                padding: '6px 10px', fontSize: strong ? 16 : 13,
                borderBottom: strong ? 'none' : '1px dashed #d9e6dc',
                borderTop: strong ? `2px solid ${BRAND.green}` : undefined,
                fontWeight: strong ? 800 : 400, color: strong ? BRAND.green : undefined,
              }}>{k}</td>
              <td style={{
                padding: '6px 10px', textAlign: 'left', fontSize: strong ? 16 : 13,
                borderBottom: strong ? 'none' : '1px dashed #d9e6dc',
                borderTop: strong ? `2px solid ${BRAND.green}` : undefined,
                fontWeight: strong ? 800 : 600, color: strong ? BRAND.green : undefined,
              }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 16, fontSize: 11, color: '#5d6f64' }}>{NOTE[doc.kind]}</div>
    </div>
  );
}

/** A ready-made footer for the modal that shows an invoice. */
export function invoiceFooter(doc: InvoiceDoc | null, onClose: () => void) {
  return (
    <Space>
      <Button type="primary" icon={<PrinterOutlined />} disabled={!doc}
        onClick={() => doc && printInvoice(doc)}>
        طباعة
      </Button>
      <Button onClick={onClose}>إغلاق</Button>
    </Space>
  );
}

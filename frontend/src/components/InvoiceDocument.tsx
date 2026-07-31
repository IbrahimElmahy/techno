import React from 'react';
import { Button, Space } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import Logo, { BRAND } from './Logo';
import { printDocument } from '../print/brand';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import { COMPANY, companyLines } from '../config/company';

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
}


const n = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const titleOf = (d: InvoiceDoc) => (
  d.kind === 'sale' ? 'فاتورة مبيعات'
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
    rows.push(['طريقة السداد', Number(d.credit || 0) > 0 ? 'آجل / جزئي' : 'نقدي']);
  }
  return [...rows, ...(d.extraMeta || [])];
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
  const pts = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
  const rows = d.lines.map((l, i) => `
    <tr><td>${i + 1}</td><td style="text-align:right">${l.name}</td>
    ${anyWh ? `<td>${l.warehouse || '-'}</td>` : ''}
    <td>${Number(l.quantity)}</td><td>${l.unit || '-'}</td>
    <td>${n(l.unit_price)}</td>${anyDisc ? `<td>${Number(l.discount_pct || 0)}%</td>` : ''}
    ${anyPts ? `<td>${pts(l.points)}</td>` : ''}
    <td>${n(l.line_total)}</td></tr>`).join('');
  const discount = Number(d.gross || 0) - Number(d.net || 0);
  const body = `
    <table class="grid">
      <thead><tr><th>#</th><th>الصنف</th>${anyWh ? '<th>المخزن</th>' : ''}<th>الكمية</th><th>الوحدة</th>
        <th>سعر الوحدة</th>${anyDisc ? '<th>الخصم</th>' : ''}${anyPts ? '<th>النقاط</th>' : ''}<th>الإجمالي</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${cols}">لا توجد أصناف</td></tr>`}</tbody>
    </table>
    <table class="totals">
      <tr><td>الإجمالي قبل الخصم</td><td style="text-align:left">${n(d.gross)} ج.م</td></tr>
      ${discount > 0 ? `<tr><td>الخصم (${Number(d.discountPct || 0)}%)</td>
        <td style="text-align:left">${n(discount)} ج.م</td></tr>` : ''}
      <tr><td>الصافي</td><td style="text-align:left">${n(d.net)} ج.م</td></tr>
      ${Number(d.tax || 0) > 0 ? `<tr><td>ضريبة القيمة المضافة</td>
        <td style="text-align:left">${n(d.tax)} ج.م</td></tr>` : ''}
      ${o.paidAndRemaining ? `<tr><td>${cashLabel(d)}</td>
          <td style="text-align:left">${n(d.cash)} ج.م</td></tr>
      <tr><td>${creditLabel(d)}</td><td style="text-align:left">${n(d.credit)} ج.م</td></tr>` : ''}
      <tr><td>${payableLabel(d)}</td><td style="text-align:left">${n(payable(d))} ج.م</td></tr>
      ${Number(d.totalPoints || 0) > 0 ? `<tr><td>نقاط الولاء المكتسبة</td>
        <td style="text-align:left">${pts(d.totalPoints)} نقطة</td></tr>` : ''}
    </table>
    <div class="signatures">
      <div class="sig">${d.kind === 'purchase' ? 'توقيع المورد' : 'توقيع المستلم'}</div>
      <div class="sig">${d.kind === 'purchase' ? 'أمين المخزن' : 'المندوب'}</div>
      <div class="sig">المحاسب</div>
    </div>`;
  printDocument(
    {
      title: titleOf(d),
      number: d.document_number,
      meta: headMeta(d, o),
      note: NOTE[d.kind],
      hide: {
        logo: !o.logo,
        companyName: !o.companyName,
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
  const pts = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
  const totals: [string, string, boolean?][] = [
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
    ...(Number(doc.totalPoints || 0) > 0
      ? ([['نقاط الولاء المكتسبة', `${pts(doc.totalPoints)} نقطة`]] as [string, string][])
      : []),
  ];

  return (
    <div style={{ background: '#fff' }}>
      {/* Letterhead */}
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
      <div style={{ height: 4, background: BRAND.orange, marginTop: 3 }} />

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
        <MetaRow label="طريقة السداد" value={Number(doc.credit || 0) > 0 ? 'آجل / جزئي' : 'نقدي'} />
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

import React from 'react';
import { Button, Space } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import Logo, { BRAND } from './Logo';
import { printDocument } from '../print/brand';
import { amountToArabicWords } from '../utils/arabicNumberWords';
import { COMPANY, companyLines } from '../config/company';

/**
 * A real cash voucher (سند) — receipt, payment, expense, rep hand-over or treasury transfer.
 *
 * Same data drives the on-screen sheet and the print, and the amount is written out in Arabic
 * words next to the figure, which is what makes a signed voucher hard to alter afterwards.
 */

export type VoucherKind = 'receipt' | 'payment' | 'expense' | 'rep_handover' | 'cash_transfer';

export interface VoucherDoc {
  kind: VoucherKind;
  document_number: string;
  date?: string | null;
  amount: string | number;
  /** «العميل» / «المورد» / «الحساب» … */
  partyLabel?: string;
  partyName?: string;
  treasury?: string | null;
  toTreasury?: string | null;
  paymentMethod?: string | null;
  reference?: string | null;
  description?: string | null;
  entryId?: number | null;
  isReversal?: boolean;
}

export const VOUCHER_TITLES: Record<VoucherKind, string> = {
  receipt: 'سند قبض',
  payment: 'سند صرف',
  expense: 'سند مصروف',
  rep_handover: 'سند توريد مندوب',
  cash_transfer: 'سند تحويل بين الخزائن',
};

/** Who signs which side — a receipt is signed by the payer, a payment by the recipient. */
const SIGNATURES: Record<VoucherKind, [string, string, string]> = {
  receipt: ['المستلم (أمين الخزينة)', 'الدافع', 'المحاسب'],
  payment: ['المستلم', 'أمين الخزينة', 'المحاسب'],
  expense: ['المستلم', 'أمين الخزينة', 'المعتمِد'],
  rep_handover: ['أمين الخزينة', 'المندوب', 'المحاسب'],
  cash_transfer: ['أمين الخزينة المُحوِّل', 'أمين الخزينة المستلم', 'المحاسب'],
};

const STATEMENT: Record<VoucherKind, string> = {
  receipt: 'استلمنا من',
  payment: 'صرفنا إلى',
  expense: 'صُرف مقابل',
  rep_handover: 'ورّد المندوب',
  cash_transfer: 'حُوِّل من الخزينة',
};

const n = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function rows(d: VoucherDoc): [string, string][] {
  const out: [string, string][] = [];
  if (d.partyName) out.push([d.partyLabel || 'الطرف', d.partyName]);
  out.push(['التاريخ', d.date ? String(d.date).slice(0, 10) : '-']);
  if (d.treasury) out.push([d.kind === 'cash_transfer' ? 'من خزينة' : 'الخزينة', d.treasury]);
  if (d.toTreasury) out.push(['إلى خزينة', d.toTreasury]);
  if (d.paymentMethod) out.push(['طريقة الدفع', d.paymentMethod]);
  if (d.reference) out.push(['المرجع', d.reference]);
  if (d.description) out.push(['البيان', d.description]);
  if (d.entryId) out.push(['رقم القيد', String(d.entryId)]);
  if (d.isReversal) out.push(['ملاحظة', 'سند عكسي (إلغاء)']);
  return out;
}

/** Print this voucher on the shared company letterhead. */
export function printVoucher(d: VoucherDoc): void {
  const [a, b, c] = SIGNATURES[d.kind];
  const body = `
    <div style="margin:18px 0;padding:16px 18px;border:2px solid ${BRAND.green};
                border-radius:10px;background:#f7fbf8">
      <div style="font-size:13px;color:#5d6f64">المبلغ</div>
      <div style="font-size:30px;font-weight:800;color:${BRAND.green}">${n(d.amount)} ج.م</div>
      <div style="margin-top:8px;font-size:14px;font-weight:700">
        ${amountToArabicWords(d.amount)}
      </div>
      ${d.partyName ? `<div style="margin-top:10px;font-size:14px">
        ${STATEMENT[d.kind]}: <b>${d.partyName}</b></div>` : ''}
    </div>
    <table class="meta">
      ${rows(d).map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('')}
    </table>
    <div class="signatures">
      <div class="sig">${a}</div><div class="sig">${b}</div><div class="sig">${c}</div>
    </div>`;
  printDocument(
    {
      title: VOUCHER_TITLES[d.kind],
      number: d.document_number,
      note: 'هذا السند لا يُعتد به إلا موقعًا ومختومًا من الشركة.',
    },
    body,
  );
}

const cell: React.CSSProperties = {
  border: '1px solid #d9e6dc', padding: '7px 10px', fontSize: 13, textAlign: 'right',
};

export default function VoucherDocument({ doc }: { doc: VoucherDoc }) {
  const [a, b, c] = SIGNATURES[doc.kind];
  return (
    <div style={{ background: '#fff' }}>
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

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, margin: '16px 0 10px', flexWrap: 'wrap',
      }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>{VOUCHER_TITLES[doc.kind]}</h2>
        <span style={{
          background: BRAND.green, color: '#fff', padding: '4px 14px',
          borderRadius: 999, fontWeight: 700,
        }}>
          {doc.document_number}
        </span>
      </div>

      {/* The amount, in figures and in words. */}
      <div style={{
        margin: '14px 0', padding: '14px 16px', border: `2px solid ${BRAND.green}`,
        borderRadius: 10, background: '#f7fbf8',
      }}>
        <div style={{ fontSize: 12, color: '#5d6f64' }}>المبلغ</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: BRAND.green }}>{n(doc.amount)} ج.م</div>
        <div style={{ marginTop: 6, fontWeight: 700 }}>{amountToArabicWords(doc.amount)}</div>
        {doc.partyName && (
          <div style={{ marginTop: 8 }}>
            {STATEMENT[doc.kind]}: <b>{doc.partyName}</b>
          </div>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows(doc).map(([k, v]) => (
            <tr key={k}>
              <td style={{ ...cell, background: '#f2f9f3', fontWeight: 700, width: 130 }}>{k}</td>
              <td style={cell}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 34 }}>
        {[a, b, c].map((s) => (
          <div key={s} style={{
            width: 170, textAlign: 'center', borderTop: '1px solid #98acb9',
            paddingTop: 6, fontSize: 12,
          }}>{s}</div>
        ))}
      </div>
    </div>
  );
}

export function voucherFooter(doc: VoucherDoc | null, onClose: () => void) {
  return (
    <Space>
      <Button type="primary" icon={<PrinterOutlined />} disabled={!doc}
        onClick={() => doc && printVoucher(doc)}>
        طباعة
      </Button>
      <Button onClick={onClose}>إغلاق</Button>
    </Space>
  );
}

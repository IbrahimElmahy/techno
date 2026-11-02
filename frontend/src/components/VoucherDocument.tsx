import React, { useEffect, useState } from 'react';
import { Button, Space } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import Logo, { BRAND } from './Logo';
import { printDocument } from '../print/brand';
import { amountToArabicWords } from '../utils/arabicNumberWords';
import { COMPANY, companyLines } from '../config/company';
import { printMoney as n } from '../print/reportSheet';
import { api } from '../api/client';

export type VoucherKind = 'receipt' | 'payment' | 'expense' | 'rep_handover' | 'cash_transfer'
  | 'partner_withdraw' | 'partner_deposit';

export interface VoucherDoc {
  kind: VoucherKind;
  document_number: string;
  date?: string | null;
  amount: string | number;
  partyLabel?: string;
  partyName?: string;
  treasury?: string | null;
  toTreasury?: string | null;
  paymentMethod?: string | null;
  reference?: string | null;
  description?: string | null;
  statement?: string | null;
  family?: string | null;
  entryId?: number | null;
  isReversal?: boolean;
  voucherId?: number | null;
}

export interface ReceiptContext {
  phone?: string | null;
  rep_name?: string | null;
  prior?: string | number | null;
  total_prior?: string | number | null;
  others?: { family: string; balance: string | number }[];
}

export async function loadReceiptContext(d: VoucherDoc): Promise<ReceiptContext | null> {
  if (d.kind !== 'receipt' || !d.voucherId || d.isReversal) return null;
  try {
    return (await api.get<ReceiptContext>(`/api/v1/vouchers/${d.voucherId}/receipt-context`)).data;
  } catch {
    return null;
  }
}

function balanceRows(d: VoucherDoc, ctx: ReceiptContext | null): [string, number, boolean][] {
  if (!ctx || ctx.prior == null) return [];
  const amount = Number(d.amount || 0);
  const prior = Number(ctx.prior);
  const fam = d.family ? ` (${d.family})` : '';
  const out: [string, number, boolean][] = [
    [`حساب سابق${fam}`, prior, false],
    ['المدفوع', amount, false],
    [`الباقي بعد الدفعة${fam}`, prior - amount, true],
  ];
  if (d.family) {
    (ctx.others || []).forEach((o) => out.push([`مديونية ${o.family}`, Number(o.balance), false]));
    if (ctx.total_prior != null) {
      out.push(['إجمالي حساب العميل بعد الدفعة', Number(ctx.total_prior) - amount, false]);
    }
  }
  return out;
}

export const VOUCHER_TITLES: Record<VoucherKind, string> = {
  receipt: 'سند قبض',
  payment: 'سند صرف',
  expense: 'سند مصروف',
  rep_handover: 'سند توريد مندوب',
  cash_transfer: 'سند تحويل بين الخزائن',
  partner_withdraw: 'سند سحب شريك',
  partner_deposit: 'سند إيداع شريك',
};

const SIGNATURES: Record<VoucherKind, [string, string, string]> = {
  receipt: ['المستلم (أمين الخزينة)', 'الدافع', 'المحاسب'],
  payment: ['المستلم', 'أمين الخزينة', 'المحاسب'],
  expense: ['المستلم', 'أمين الخزينة', 'المعتمِد'],
  rep_handover: ['أمين الخزينة', 'المندوب', 'المحاسب'],
  cash_transfer: ['أمين الخزينة المُحوِّل', 'أمين الخزينة المستلم', 'المحاسب'],
  partner_withdraw: ['المستلم', 'أمين الخزينة', 'المحاسب'],
  partner_deposit: ['المستلم (أمين الخزينة)', 'الدافع', 'المحاسب'],
};

const STATEMENT: Record<VoucherKind, string> = {
  receipt: 'استلمنا من',
  payment: 'صرفنا إلى',
  expense: 'صُرف مقابل',
  rep_handover: 'ورّد المندوب',
  cash_transfer: 'حُوِّل من الخزينة',
  partner_withdraw: 'صرفنا إلى',
  partner_deposit: 'استلمنا من',
};

function titleOf(d: VoucherDoc): string {
  return d.kind === 'receipt' && d.family ? `${VOUCHER_TITLES.receipt} — ${d.family}` : VOUCHER_TITLES[d.kind];
}

function partyStrip(d: VoucherDoc, ctx: ReceiptContext | null): [string, string][] {
  if (d.kind !== 'receipt') return [];
  return [
    [d.partyLabel || 'العميل', d.partyName || '-'],
    ['الهاتف', ctx?.phone || '-'],
    ['المندوب', ctx?.rep_name || '-'],
    ['التاريخ', d.date ? String(d.date).slice(0, 10) : '-'],
    ['رقم القيد', d.entryId ? String(d.entryId) : '-'],
  ];
}

function rows(d: VoucherDoc, ctx: ReceiptContext | null = null): [string, string][] {
  const out: [string, string][] = [];
  if (d.kind === 'receipt') {
    out.push(['على مديونية', d.family || 'الإجمالي (موزّع بالنسبة)']);
    if (d.paymentMethod) out.push(['طريقة الدفع', d.paymentMethod]);
    if (d.reference) out.push(['المرجع', d.reference]);
    if (d.description) out.push(['البيان', d.description]);
    if (d.statement) out.push(['بيان السند', d.statement]);
    if (d.isReversal) out.push(['ملاحظة', 'سند عكسي (إلغاء)']);
    return out;
  }
  if (d.partyName) out.push([d.partyLabel || 'الطرف', d.partyName]);
  if (ctx?.phone) out.push(['الهاتف', ctx.phone]);
  if (ctx?.rep_name) out.push(['المندوب', ctx.rep_name]);
  out.push(['التاريخ', d.date ? String(d.date).slice(0, 10) : '-']);
  if (d.treasury) out.push([d.kind === 'cash_transfer' ? 'من خزينة' : 'الخزينة', d.treasury]);
  if (d.toTreasury) out.push(['إلى خزينة', d.toTreasury]);
  if (d.paymentMethod) out.push(['طريقة الدفع', d.paymentMethod]);
  if (d.reference) out.push(['المرجع', d.reference]);
  if (d.description) out.push(['البيان', d.description]);
  if (d.statement) out.push(['بيان السند', d.statement]);
  if (d.entryId) out.push(['رقم القيد', String(d.entryId)]);
  if (d.isReversal) out.push(['ملاحظة', 'سند عكسي (إلغاء)']);
  return out;
}

export async function printVoucher(d: VoucherDoc): Promise<void> {
  const ctx = await loadReceiptContext(d);
  const bal = balanceRows(d, ctx);
  const [a, b, c] = SIGNATURES[d.kind];
  const strip = partyStrip(d, ctx);
  const top = strip.length ? `
    <div class="c-meta" style="grid-template-columns:repeat(${strip.length},1fr)">
      ${strip.map(([k, v]) => `<div><b>${k}:</b>${v}</div>`).join('')}
    </div>
    <div class="c-doc" style="justify-content:space-between;margin:10px 0 0">
      <span class="t">${titleOf(d)}</span><span class="n">${d.document_number}</span>
    </div>` : '';
  const body = `${top}
    <div style="margin:18px 0;padding:16px 18px;border:2px solid #000;border-radius:10px">
      <div style="font-size:14px;color:#2b2b2b;font-weight:700">المبلغ</div>
      <div style="font-size:30px;font-weight:800;color:#000">${n(d.amount)}</div>
      <div style="margin-top:8px;font-size:14px;font-weight:700">
        ${amountToArabicWords(d.amount)}
      </div>
      ${d.partyName ? `<div style="margin-top:10px;font-size:14px">
        ${STATEMENT[d.kind]}: <b>${d.partyName}</b></div>` : ''}
    </div>
    <table class="meta">
      ${rows(d, ctx).map(([k, v]) => `<tr><td class="k">${k}</td><td>${v}</td></tr>`).join('')}
    </table>
    ${bal.length ? `<table class="meta" style="margin-top:12px">
      ${bal.map(([k, v, big]) => `<tr><td class="k">${k}</td><td style="${big ? 'font-weight:800;font-size:16px' : ''}">${n(v)}</td></tr>`).join('')}
    </table>` : ''}
    <div class="signatures">
      <div class="sig">${a}</div><div class="sig">${b}</div><div class="sig">${c}</div>
    </div>`;
  printDocument(
    {
      title: titleOf(d),
      number: d.document_number,
      hide: strip.length ? { invoiceTitle: true, invoiceNumber: true } : undefined,
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
  const [ctx, setCtx] = useState<ReceiptContext | null>(null);
  useEffect(() => {
    let live = true;
    setCtx(null);
    loadReceiptContext(doc).then((r) => { if (live) setCtx(r); });
    return () => { live = false; };
  }, [doc.kind, doc.voucherId, doc.isReversal]);
  const bal = balanceRows(doc, ctx);
  const strip = partyStrip(doc, ctx);
  return (
    <div style={{ background: '#fff' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, paddingBottom: 12, borderBottom: `3px solid ${BRAND.green}`,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: BRAND.green }}>{COMPANY.nameAr}</div>
          {companyLines().map((l) => (
            <div key={l} style={{ fontSize: 12.5, color: '#5d6f64' }}>{l}</div>
          ))}
        </div>
        <Logo width={150} />
      </div>
      <div style={{ height: 4, background: BRAND.orange, marginTop: 3 }} />

      {strip.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${strip.length}, minmax(0, 1fr))`,
          marginTop: 14, border: '1px solid #d9e6dc', borderRadius: 8, overflow: 'hidden',
        }}>
          {strip.map(([k, v], i) => (
            <div key={k} style={{
              padding: '6px 10px', borderInlineStart: i ? '1px solid #d9e6dc' : undefined,
              minWidth: 0,
            }}>
              <div style={{ fontSize: 12, color: '#5d6f64', background: '#f2f9f3' }}>{k}</div>
              <div style={{ fontWeight: 700, fontSize: 13, overflowWrap: 'anywhere' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

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

      <div style={{
        margin: '14px 0', padding: '14px 16px', border: `2px solid ${BRAND.green}`,
        borderRadius: 10, background: '#f7fbf8',
      }}>
        <div style={{ fontSize: 12.5, color: '#5d6f64' }}>المبلغ</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: BRAND.green }}>{n(doc.amount)}</div>
        <div style={{ marginTop: 6, fontWeight: 700 }}>{amountToArabicWords(doc.amount)}</div>
        {doc.partyName && (
          <div style={{ marginTop: 8 }}>
            {STATEMENT[doc.kind]}: <b>{doc.partyName}</b>
          </div>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows(doc, ctx).map(([k, v]) => (
            <tr key={k}>
              <td style={{ ...cell, background: '#f2f9f3', fontWeight: 700, width: 130 }}>{k}</td>
              <td style={cell}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {bal.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <tbody>
            {bal.map(([k, v, big]) => (
              <tr key={k}>
                <td style={{ ...cell, background: '#f2f9f3', fontWeight: 700, width: 220 }}>{k}</td>
                <td style={{ ...cell, fontWeight: big ? 800 : 400, fontSize: big ? 16 : 13,
                  color: big ? BRAND.green : undefined }}>{n(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 34 }}>
        {[a, b, c].map((s) => (
          <div key={s} style={{
            width: 170, textAlign: 'center', borderTop: '1px solid #98acb9',
            paddingTop: 6, fontSize: 12.5,
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

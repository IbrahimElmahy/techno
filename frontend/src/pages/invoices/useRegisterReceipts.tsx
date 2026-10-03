import React, { useEffect, useRef, useState } from 'react';
import { Descriptions, message } from 'antd';
import { api } from '../../api/client';
import { useLiveRefresh } from '../../utils/live';
import { labelMap, useLookup } from '../../hooks/useLookup';
import { TabModal } from '../../components/TabModal';
import VoucherDocument, { VoucherDoc, voucherFooter } from '../../components/VoucherDocument';
import DocumentAttachments from '../../components/DocumentAttachments';
import type { PaymentRow } from '../../components/PaymentsLogPanel';
import { deleteVoucher, fetchVoucher, type EditableVoucher } from '../vouchers/useQuickVoucher';
import { InvoiceFilters, PAGE_SIZE } from './types';

/**
 * **سندات القبض المستقلة في شريحة «الكل»** (طلب العميل ٢٠٢٦-١٠-٠٣).
 *
 * التحصيل من عميل (من النظام أو التطبيق) بيظهر وسط الفواتير والمرتجعات كصف `doc_type: 'receipt'`.
 * النقدي اللي اندفع مع الفاتورة **مش هنا** — هو أصلاً جزء من صف الفاتورة.
 *
 * السيرفر بيفلتر بالعميل والمندوب والتاريخ بس؛ «نوع الفاتورة» والبيان والبحث بيتطبّقوا هنا.
 * و«طريقة السداد» أو فلتر فحص النظام ⇒ مافيش سندات (مالهمش معنى على السند).
 */
export function useRegisterReceipts(opts: {
  enabled: boolean;
  filters: InvoiceFilters;
  /** بيتزوّد بعد حفظ سند من البوباب ⇒ الصفوف تتجاب تاني. */
  reloadKey: number;
}) {
  const { enabled, filters: f } = opts;
  const skip = !enabled || !!f.payment;
  const [raw, setRaw] = useState<PaymentRow[]>([]);
  const [view, setView] = useState<{ row: any; v: EditableVoucher & Record<string, any> } | null>(null);
  const { options: methodOptions } = useLookup('payment_method');
  const methodLabel = labelMap(methodOptions);
  // آخر طلب بس هو اللي يكتب.
  const seq = useRef(0);

  const load = async () => {
    const my = ++seq.current;
    if (skip) { setRaw([]); return; }
    try {
      const { data } = await api.get<{ rows: PaymentRow[] }>('/api/v1/sales/receipts-log', {
        params: {
          customer_id: f.customer_id ?? undefined,
          rep_id: f.rep_id ?? undefined,
          date_from: f.date_from || undefined,
          date_to: f.date_to || undefined,
          limit: PAGE_SIZE,
        },
      });
      if (my === seq.current) setRaw((data.rows ?? []).filter((r) => r.kind === 'voucher'));
    } catch {
      if (my === seq.current) setRaw([]);
    }
  };

  useEffect(() => { load(); }, // eslint-disable-line react-hooks/exhaustive-deps
    [skip, f.customer_id, f.rep_id, f.date_from, f.date_to, opts.reloadKey]);
  useLiveRefresh(['sales', 'vouchers'], () => { if (!skip) load(); }, { enabled: !skip });

  // الفلاتر اللي السيرفر مابيعرفهاش — بتتطبّق هنا.
  const has = (v: unknown, q: string) => String(v ?? '').toLowerCase().includes(q);
  const fam = f.family;
  const stmt = String(f.statement || '').trim().toLowerCase();
  const q = String(f.q || '').trim().toLowerCase();
  const rows = skip ? [] : raw
    .filter((r) => !fam || r.family === fam)
    .filter((r) => !stmt || has(r.statement, stmt) || has(r.notes, stmt))
    .filter((r) => !q || [r.document_number, r.party_name, r.external_document_number, r.reference]
      .some((v) => has(v, q)))
    .map((r) => {
      const amount = Number(r.amount || 0);
      return {
        id: r.id,
        rowKey: `rcv-${r.id}`,
        doc_type: 'receipt' as const,
        doc_type_label: 'سند قبض',
        document_number: r.document_number,
        original_invoice_number: null,
        external_document_number: r.external_document_number ?? null,
        statement1: r.statement ?? null,
        date: String(r.date || '').slice(0, 10),
        customer_id: r.party_id,
        customer_name: r.party_name,
        rep_id: r.rep_id,
        rep_name: r.rep_name,
        customer_type: null,
        revenue_account_id: null,
        family: r.family,
        gross: null,
        discount_value: null,
        discount_base: 0,
        net: amount,
        amount,
        cash_amount: amount,
        credit_amount: 0,
        residual: null,
        notes: r.notes ?? null,
        source: r.source,
        raw: r,
      };
    });

  /** ورقة السند — نفس `VoucherDocument` اللي في شريحة «سندات القبض». */
  const openView = async (row: any) => {
    try {
      setView({ row: row.raw ?? row, v: await fetchVoucher(row.id) as any });
    } catch { /* رسالة الخطأ من `api` */ }
  };

  /** الحذف الفعلي — التأكيد في عمود الإجراءات. */
  const remove = async (row: any) => {
    await deleteVoucher(row.id);
    message.success('تم حذف السند');
    load();
  };

  const doc = (x: NonNullable<typeof view>): VoucherDoc => ({
    kind: 'receipt',
    document_number: x.v.document_number,
    date: x.v.voucher_date,
    amount: x.v.amount,
    partyLabel: 'العميل',
    partyName: x.row.party_name ?? undefined,
    treasury: x.row.treasury ?? null,
    paymentMethod: x.v.payment_method ? (methodLabel[x.v.payment_method] || x.v.payment_method) : null,
    reference: x.v.reference,
    description: x.v.description,
    statement: x.v.statement1 ?? null,
    family: x.v.family ?? null,
    entryId: x.v.ledger_entry_id ?? null,
    isReversal: x.v.is_reversal,
  });

  const modal = (
    <TabModal
      open={view !== null}
      title={view ? `سند قبض ${view.v.document_number}` : 'سند'}
      onCancel={() => setView(null)}
      footer={voucherFooter(view ? doc(view) : null, () => setView(null))}
      width={760}
      centered
      destroyOnHidden
    >
      {view && (
        <>
          <VoucherDocument doc={doc(view)} />
          <Descriptions column={2} size="small" bordered style={{ marginTop: 12 }}>
            <Descriptions.Item label="رقم المستند">
              {view.v.external_document_number || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="كتبه">{view.row.actor_name || '-'}</Descriptions.Item>
          </Descriptions>
          <DocumentAttachments docType="voucher" docId={view.v.id} />
        </>
      )}
    </TabModal>
  );

  return { rows, view: openView, remove, modal };
}

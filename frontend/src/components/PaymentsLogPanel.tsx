import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Button, Descriptions, Empty, Modal, Space, Spin, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, ExclamationCircleOutlined, EyeOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useLiveRefresh } from '../utils/live';
import { money } from '../utils/money';
import { labelMap, useLookup } from '../hooks/useLookup';
import { deleteVoucher, fetchVoucher, EditableVoucher } from '../pages/vouchers/useQuickVoucher';
import { FilterTable as Table } from './FilterTable';
import { useTableColumns } from './ColumnSettings';
import { useAuth } from './AuthProvider';
import { TabModal } from './TabModal';
import VoucherDocument, { VoucherDoc, voucherFooter } from './VoucherDocument';
import DocumentAttachments from './DocumentAttachments';

export interface PaymentRow {
  key: string;
  kind: 'invoice' | 'voucher';
  id: number;
  date: string;
  document_number: string;
  party_id: number | null;
  party_name: string | null;
  rep_id: number | null;
  rep_name: string | null;
  store: string | null;
  amount: string;
  family: 'أبيض' | 'بولي' | null;
  source: 'app' | 'system';
  treasury?: string | null;
  payment_method?: string | null;
  statement?: string | null;
  notes?: string | null;
  description?: string | null;
  external_document_number?: string | null;
  reference?: string | null;
  actor_name?: string | null;
  created_at?: string | null;
  cost_center?: string | null;
  invoice_total?: string | null;
  credit_amount?: string | null;
}

export type PaymentsLogKind = 'receipts' | 'payments';

const PAYMENTS_LOGS: Record<PaymentsLogKind, {
  endpoint: string; partyParam: string; partyLabel: string; name: string;
  storageKey: string; live: string[]; showRepStore: boolean; voucherName: string;
}> = {
  receipts: {
    endpoint: '/api/v1/sales/receipts-log', partyParam: 'customer_id', partyLabel: 'العميل',
    name: 'سندات القبض', storageKey: 'sales-receipts', live: ['sales', 'vouchers'], showRepStore: true,
    voucherName: 'سند قبض',
  },
  payments: {
    endpoint: '/api/v1/purchases/payments-log', partyParam: 'supplier_id', partyLabel: 'المورد',
    name: 'سندات الصرف', storageKey: 'purchase-payments', live: ['purchases', 'vouchers'],
    showRepStore: false, voucherName: 'سند صرف',
  },
};

export interface PaymentsLogTotals {
  count: number;
  countOnInvoice: number;
  countPayments: number;
  onInvoice: number;
  payments: number;
  total: number;
}

interface Props {
  kind: PaymentsLogKind;
  partyId?: number | null;
  repId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  onOpenInvoice?: (id: number, row: PaymentRow) => void;
  onEditInvoice?: (id: number, row: PaymentRow) => void;
  onDeleteInvoice?: (id: number, row: PaymentRow) => Promise<void> | void;
  onEditVoucher?: (v: EditableVoucher) => void;
  controlSlot?: HTMLElement | null;
  onTotals?: (t: PaymentsLogTotals | null) => void;
}

export default function PaymentsLogPanel({
  kind, partyId, repId, dateFrom, dateTo, onOpenInvoice, onEditInvoice, onDeleteInvoice,
  onEditVoucher, controlSlot, onTotals,
}: Props) {
  const cfg = PAYMENTS_LOGS[kind];
  const { can } = useAuth();
  const canWriteVoucher = can('voucher.write');
  const { options: methodOptions } = useLookup('payment_method');
  const methodLabel = labelMap(methodOptions);
  const [view, setView] = useState<{ row: PaymentRow; v: any } | null>(null);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = async (silent = false) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get<{ rows: PaymentRow[]; [k: string]: any }>(cfg.endpoint, {
        params: {
          [cfg.partyParam]: partyId ?? undefined,
          rep_id: repId ?? undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          limit: 2000,
        },
      });
      if (my === seq.current) {
        setRows(data.rows ?? []);
        onTotals?.({
          count: Number(data.count ?? (data.rows ?? []).length),
          countOnInvoice: Number(data.count_on_invoice ?? 0),
          countPayments: Number(data.count_payments ?? 0),
          onInvoice: Number(data.total_on_invoice ?? 0),
          payments: Number(data.total_payments ?? 0),
          total: Number(data.total ?? 0),
        });
      }
    } catch {
      if (my === seq.current && !silent) { setRows([]); onTotals?.(null); }
    } finally {
      if (my === seq.current && !silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [kind, partyId, repId, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(cfg.live, () => load(true));

  const openVoucher = async (r: PaymentRow) => {
    try {
      setView({ row: r, v: await fetchVoucher(r.id) });
    } catch {}
  };

  const editVoucher = async (r: PaymentRow) => {
    if (!onEditVoucher) return;
    try {
      onEditVoucher(await fetchVoucher(r.id));
    } catch {}
  };

  const confirmDelete = (r: PaymentRow) => {
    const isInv = r.kind === 'invoice';
    Modal.confirm({
      title: isInv ? 'تأكيد حذف الفاتورة' : `تأكيد حذف ${cfg.voucherName}`,
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: isInv
        ? `هل أنت متأكد من حذف الفاتورة رقم (${r.document_number})؟`
        : `هل أنت متأكد من حذف السند رقم (${r.document_number})؟ سيتم حذفه مع قيده.`,
      okText: 'نعم، احذف',
      okType: 'danger',
      cancelText: 'إلغاء',
      onOk: async () => {
        try {
          if (isInv) {
            await onDeleteInvoice?.(r.id, r);
          } else {
            await deleteVoucher(r.id);
            message.success('تم حذف السند');
          }
          load(true);
        } catch {}
      },
    });
  };

  const voucherDoc = (x: { row: PaymentRow; v: any }): VoucherDoc => ({
    kind: kind === 'receipts' ? 'receipt' : 'payment',
    document_number: x.v.document_number,
    date: x.v.voucher_date,
    amount: x.v.amount,
    partyLabel: cfg.partyLabel,
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

  const dash = (v: string | null | undefined) => v || '—';
  const moneyOrDash = (v: string | null | undefined) => (v != null ? money(v) : '—');

  const columns = [
    {
      title: 'النوع', key: 'kind', dataIndex: 'kind', width: 100,
      render: (v: PaymentRow['kind']) => (v === 'invoice'
        ? <Tag color="green">على فاتورة</Tag>
        : <Tag color="blue">دفعة</Tag>),
    },
    {
      title: 'المصدر', key: 'source', dataIndex: 'source', width: 90,
      render: (v: PaymentRow['source']) => (v === 'app'
        ? <Tag color="purple">تطبيق</Tag>
        : <Tag>نظام</Tag>),
    },
    { title: 'التاريخ', key: 'date', dataIndex: 'date', width: 110 },
    {
      title: 'رقم المستند', key: 'document_number', dataIndex: 'document_number',
      render: (v: string, r: PaymentRow) => {
        if (r.kind === 'voucher') {
          return <Typography.Link onClick={() => openVoucher(r)}>{v}</Typography.Link>;
        }
        return onOpenInvoice
          ? <Typography.Link onClick={() => onOpenInvoice(r.id, r)}>{v}</Typography.Link> : v;
      },
    },
    { title: cfg.partyLabel, key: 'party_name', dataIndex: 'party_name' },
    ...(cfg.showRepStore ? [
      { title: 'المندوب', key: 'rep_name', dataIndex: 'rep_name', render: dash },
      { title: 'المخزن', key: 'store', dataIndex: 'store', render: dash },
      { title: 'الخط', key: 'family', dataIndex: 'family', width: 80, render: dash },
    ] : []),
    { title: 'الخزنة', key: 'treasury', dataIndex: 'treasury', render: dash },
    {
      title: 'طريقة الدفع', key: 'payment_method', dataIndex: 'payment_method',
      render: (v: string | null) => (v ? (methodLabel[v] || v) : '—'),
    },
    { title: 'البيان', key: 'statement', dataIndex: 'statement', render: dash },
    {
      title: 'المستند الخارجي', key: 'external_document_number',
      dataIndex: 'external_document_number', render: dash,
    },
    { title: 'المرجع', key: 'reference', dataIndex: 'reference', render: dash },
    { title: 'ملاحظات', key: 'notes', dataIndex: 'notes', render: dash },
    { title: 'مركز التكلفة', key: 'cost_center', dataIndex: 'cost_center', render: dash },
    { title: 'كتبه', key: 'actor_name', dataIndex: 'actor_name', render: dash },
    {
      title: 'وقت الإنشاء', key: 'created_at', dataIndex: 'created_at',
      render: (v: string | null) => (v ? v.slice(0, 16).replace('T', ' ') : '—'),
    },
    {
      title: 'إجمالي الفاتورة', key: 'invoice_total', dataIndex: 'invoice_total',
      align: 'left' as const, render: moneyOrDash,
    },
    {
      title: 'الآجل', key: 'credit_amount', dataIndex: 'credit_amount',
      align: 'left' as const, render: moneyOrDash,
    },
    {
      title: 'المبلغ', key: 'amount', dataIndex: 'amount', align: 'left' as const,
      render: (v: string) => <strong>{money(v)}</strong>,
    },
    {
      title: 'الإجراءات', key: 'actions', width: 110,
      render: (_: unknown, r: PaymentRow) => {
        const isInv = r.kind === 'invoice';
        const canView = isInv ? !!onOpenInvoice : true;
        const canEdit = isInv ? !!onEditInvoice : (!!onEditVoucher && canWriteVoucher);
        const canDelete = isInv ? !!onDeleteInvoice : canWriteVoucher;
        return (
          <Space size={2} onClick={(e) => e.stopPropagation()}>
            {canView && (
              <Tooltip title="عرض">
                <Button type="text" size="small" icon={<EyeOutlined />}
                  onClick={() => (isInv ? onOpenInvoice?.(r.id, r) : openVoucher(r))} />
              </Tooltip>
            )}
            {canEdit && (
              <Tooltip title="تعديل">
                <Button type="text" size="small" icon={<EditOutlined />}
                  onClick={() => (isInv ? onEditInvoice?.(r.id, r) : editVoucher(r))} />
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip title="حذف">
                <Button type="text" size="small" danger icon={<DeleteOutlined />}
                  onClick={() => confirmDelete(r)} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  const tableCols = useTableColumns(cfg.storageKey, columns, {
    locked: ['document_number'],
    defaultHidden: ['reference', 'notes', 'cost_center', 'actor_name', 'created_at',
      'invoice_total', 'credit_amount'],
    export: { name: cfg.name, rows },
  });

  return (
    <div>
      {controlSlot
        ? createPortal(tableCols.control, controlSlot)
        : <div style={{ textAlign: 'left', marginBottom: 8 }}>{tableCols.control}</div>}

      <Spin spinning={loading}>
        <Table<PaymentRow>
          size="small"
          rowKey="key"
          className="sl-table"
          columns={tableCols.columns}
          dataSource={rows}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description={`لا توجد ${cfg.name} بهذه الفلاتر`} /> }}
        />
      </Spin>

      <TabModal
        open={view !== null}
        title={view ? `${cfg.voucherName} ${view.v.document_number}` : 'سند'}
        onCancel={() => setView(null)}
        footer={voucherFooter(view ? voucherDoc(view) : null, () => setView(null))}
        width={760}
        centered
        destroyOnHidden
      >
        {view && (
          <>
            <VoucherDocument doc={voucherDoc(view)} />
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
    </div>
  );
}

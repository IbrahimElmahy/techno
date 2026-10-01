import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Empty, Spin, Tag, Typography } from 'antd';
import { api } from '../api/client';
import { useLiveRefresh } from '../utils/live';
import { money } from '../utils/money';
import { FilterTable as Table } from './FilterTable';
import { useTableColumns } from './ColumnSettings';

/**
 * **شريحة السندات في السجلات** — «سندات القبض» في سجل المبيعات و«سندات الصرف» في سجل
 * المشتريات (طلب العميل ٢٠٢٦-١٠-٠١). لوحة واحدة للاتنين، والفرق كله في `PAYMENTS_LOGS`.
 *
 * صفّين في جدول واحد: النقدي اللي اتدفع مع الفاتورة نفسها («على فاتورة»)، والسندات المستقلة
 * («دفعة») — من النظام أو من التطبيق. الفلاتر الكبيرة (الطرف، المندوب، التاريخ) جاية من الصفحة،
 * والباقي فلاتر الأعمدة.
 */
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
}

export type PaymentsLogKind = 'receipts' | 'payments';

/** كل اللي بيفرق بين سندات القبض وسندات الصرف — في مكان واحد. */
const PAYMENTS_LOGS: Record<PaymentsLogKind, {
  endpoint: string; partyParam: string; partyLabel: string; name: string;
  storageKey: string; live: string[]; showRepStore: boolean;
}> = {
  receipts: {
    endpoint: '/api/v1/sales/receipts-log', partyParam: 'customer_id', partyLabel: 'العميل',
    name: 'سندات القبض', storageKey: 'sales-receipts', live: ['sales', 'vouchers'], showRepStore: true,
  },
  payments: {
    endpoint: '/api/v1/purchases/payments-log', partyParam: 'supplier_id', partyLabel: 'المورد',
    name: 'سندات الصرف', storageKey: 'purchase-payments', live: ['purchases', 'vouchers'],
    showRepStore: false,
  },
};

interface Props {
  kind: PaymentsLogKind;
  partyId?: number | null;
  repId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  onOpenInvoice?: (id: number) => void;
  onOpenVoucher?: (id: number) => void;
  /** مكان «تصدير Excel» و«الأعمدة» في ترويسة الشاشة الشايلة — نفس سطر باقي الشرايح. */
  controlSlot?: HTMLElement | null;
}

export default function PaymentsLogPanel({
  kind, partyId, repId, dateFrom, dateTo, onOpenInvoice, onOpenVoucher, controlSlot,
}: Props) {
  const cfg = PAYMENTS_LOGS[kind];
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  // آخر طلب بس هو اللي يكتب — تغيير فلتر سريع مايخليش رد قديم يغطي على الجديد
  const seq = useRef(0);

  const load = async (silent = false) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get<{ rows: PaymentRow[] }>(cfg.endpoint, {
        params: {
          [cfg.partyParam]: partyId ?? undefined,
          rep_id: repId ?? undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          limit: 2000,
        },
      });
      if (my === seq.current) setRows(data.rows ?? []);
    } catch {
      if (my === seq.current && !silent) setRows([]);
    } finally {
      if (my === seq.current && !silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [kind, partyId, repId, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(cfg.live, () => load(true));

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
        const open = r.kind === 'invoice' ? onOpenInvoice : onOpenVoucher;
        return open ? <Typography.Link onClick={() => open(r.id)}>{v}</Typography.Link> : v;
      },
    },
    { title: cfg.partyLabel, key: 'party_name', dataIndex: 'party_name' },
    ...(cfg.showRepStore ? [
      { title: 'المندوب', key: 'rep_name', dataIndex: 'rep_name', render: (v: string | null) => v || '—' },
      { title: 'المخزن', key: 'store', dataIndex: 'store', render: (v: string | null) => v || '—' },
      { title: 'الخط', key: 'family', dataIndex: 'family', width: 80, render: (v: string | null) => v || '—' },
    ] : []),
    {
      title: 'المبلغ', key: 'amount', dataIndex: 'amount', align: 'left' as const,
      render: (v: string) => <strong>{money(v)}</strong>,
    },
  ];

  const tableCols = useTableColumns(cfg.storageKey, columns, {
    locked: ['document_number'],
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
    </div>
  );
}

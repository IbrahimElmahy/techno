import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Empty, Spin, Tag, Typography } from 'antd';
import { api } from '../api/client';
import { useLiveRefresh } from '../utils/live';
import { money } from '../utils/money';
import { FilterTable as Table } from './FilterTable';
import { useTableColumns } from './ColumnSettings';

/**
 * تبويب «سندات القبض» في سجل المبيعات.
 *
 * صفّين في جدول واحد: النقدية المقبوضة على فاتورة بيع («على فاتورة»)، والدفعات المستقلة
 * («دفعة») — من النظام أو اللي المندوب حصّلها من التطبيق. الفلاتر الكبيرة (عميل، مندوب، تاريخ)
 * جاية من الصفحة؛ النوع والمصدر هنا بيتفلتروا على الشاشة.
 */

export interface ReceiptRow {
  key: string;
  kind: 'invoice' | 'voucher';
  id: number;
  date: string;
  document_number: string;
  customer_id: number | null;
  customer_name: string | null;
  rep_id: number | null;
  rep_name: string | null;
  store: string | null;
  amount: string;
  family: 'أبيض' | 'بولي' | null;
  source: 'app' | 'system';
}

interface ReceiptsLog {
  rows: ReceiptRow[];
  total_on_invoice: string;
  total_payments: string;
  total: string;
}

interface Props {
  customerId?: number | null;
  repId?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  onOpenInvoice?: (id: number) => void;
  onOpenVoucher?: (id: number) => void;
  /** مكان «تصدير Excel» و«الأعمدة» في ترويسة الشاشة الشايلة — نفس سطر باقي الشرايح. */
  controlSlot?: HTMLElement | null;
}

export default function SalesReceiptsPanel({
  customerId, repId, dateFrom, dateTo, onOpenInvoice, onOpenVoucher, controlSlot,
}: Props) {
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(false);
  // آخر طلب بس هو اللي يكتب — تغيير فلتر سريع مايخليش رد قديم يغطي على الجديد
  const seq = useRef(0);

  const load = async (silent = false) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get<ReceiptsLog>('/api/v1/sales/receipts-log', {
        params: {
          customer_id: customerId ?? undefined,
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

  useEffect(() => { load(); }, [customerId, repId, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(['sales', 'vouchers'], () => load(true));


  const columns = [
    {
      title: 'النوع', key: 'kind', dataIndex: 'kind', width: 100,
      render: (v: ReceiptRow['kind']) => (v === 'invoice'
        ? <Tag color="green">على فاتورة</Tag>
        : <Tag color="blue">دفعة</Tag>),
    },
    {
      title: 'المصدر', key: 'source', dataIndex: 'source', width: 90,
      render: (v: ReceiptRow['source']) => (v === 'app'
        ? <Tag color="purple">تطبيق</Tag>
        : <Tag>نظام</Tag>),
    },
    { title: 'التاريخ', key: 'date', dataIndex: 'date', width: 110 },
    {
      title: 'رقم المستند', key: 'document_number', dataIndex: 'document_number',
      render: (v: string, r: ReceiptRow) => {
        const open = r.kind === 'invoice' ? onOpenInvoice : onOpenVoucher;
        return open ? <Typography.Link onClick={() => open(r.id)}>{v}</Typography.Link> : v;
      },
    },
    { title: 'العميل', key: 'customer_name', dataIndex: 'customer_name' },
    { title: 'المندوب', key: 'rep_name', dataIndex: 'rep_name', render: (v: string | null) => v || '—' },
    { title: 'المخزن', key: 'store', dataIndex: 'store', render: (v: string | null) => v || '—' },
    { title: 'الخط', key: 'family', dataIndex: 'family', width: 80, render: (v: string | null) => v || '—' },
    {
      title: 'المبلغ', key: 'amount', dataIndex: 'amount', align: 'left' as const,
      render: (v: string) => <strong>{money(v)}</strong>,
    },
  ];

  // من غير فلاتر زيادة ولا كروت إجماليات (طلب العميل ٢٠٢٦-١٠-٠١) — فلاتر الأعمدة العادية بس.
  const shown = rows;

  const tableCols = useTableColumns('sales-receipts', columns, {
    locked: ['document_number'],
    export: { name: 'سندات القبض', rows: shown },
  });

  return (
    <div>
      {controlSlot
        ? createPortal(tableCols.control, controlSlot)
        : <div style={{ textAlign: 'left', marginBottom: 8 }}>{tableCols.control}</div>}

      <Spin spinning={loading}>
        <Table<ReceiptRow>
          size="small"
          rowKey="key"
          columns={tableCols.columns}
          dataSource={shown}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="لا توجد سندات قبض بهذه الفلاتر" /> }}
        />
      </Spin>
    </div>
  );
}

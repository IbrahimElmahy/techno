import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, Segmented, Space, Spin, Statistic, Tag, Typography } from 'antd';
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
}

type KindFilter = 'all' | 'invoice' | 'voucher';
type SourceFilter = 'all' | 'app' | 'system';

export default function SalesReceiptsPanel({
  customerId, repId, dateFrom, dateTo, onOpenInvoice, onOpenVoucher,
}: Props) {
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
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

  const shown = useMemo(
    () => rows.filter((r) => (kind === 'all' || r.kind === kind) && (source === 'all' || r.source === source)),
    [rows, kind, source],
  );

  // الإجماليات من الصفوف المعروضة — السيرفر بيجمع نفس الصفوف اللي بيرجّعها، فده بيطابقه
  // من غير فلتر، ومع فلتر النوع/المصدر بيفضل الرقم ماشي مع الجدول.
  const totals = useMemo(() => {
    let inv = 0;
    let pay = 0;
    for (const r of shown) {
      if (r.kind === 'invoice') inv += Number(r.amount || 0);
      else pay += Number(r.amount || 0);
    }
    return { inv, pay, all: inv + pay };
  }, [shown]);

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

  const tableCols = useTableColumns('sales-receipts', columns, {
    locked: ['document_number'],
    export: { name: 'سندات القبض', rows: shown },
  });

  return (
    <div>
      <Space wrap style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Space wrap>
          <Segmented<KindFilter>
            value={kind}
            onChange={setKind}
            options={[
              { label: 'الكل', value: 'all' },
              { label: 'على فاتورة', value: 'invoice' },
              { label: 'دفعات', value: 'voucher' },
            ]}
          />
          <Segmented<SourceFilter>
            size="small"
            value={source}
            onChange={setSource}
            options={[
              { label: 'الكل', value: 'all' },
              { label: 'من التطبيق', value: 'app' },
              { label: 'من النظام', value: 'system' },
            ]}
          />
        </Space>
        <div>{tableCols.control}</div>
      </Space>

      <Space wrap style={{ marginBottom: 12 }}>
        <Card size="small"><Statistic title="إجمالي المقبوض على الفواتير" value={money(totals.inv)} /></Card>
        <Card size="small"><Statistic title="إجمالي الدفعات" value={money(totals.pay)} /></Card>
        <Card size="small"><Statistic title="الإجمالي" value={money(totals.all)} valueStyle={{ fontWeight: 700 }} /></Card>
      </Space>

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

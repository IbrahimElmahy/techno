import React, { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Space, Statistic, Table, Tag, Button, Empty } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableColumns } from '../components/ColumnSettings';

/**
 * نظرة مدير الشركة على الفروع.
 *
 * كل شاشة تانية في النظام بتوريك فرعك — وده صح، بس بيسيب اللي فوق الفروع من غير مكان
 * يقارن فيه: هو شايف مجموع الشركة كرقم واحد، وهو عايز يعرف الفرع اللي واقف والفرع اللي
 * ماشي. الشاشة دي هي المكان ده، وهي الوحيدة في النظام اللي بتكسر عزل الفروع عن قصد.
 *
 * أرقام مجمّعة بس، مافيش مستندات. اللي عايز يفتح فاتورة بيروح لشاشتها — نسخة تانية من سجل
 * المبيعات هنا معناها مكان تاني ممكن يتعدّل منه، وده اللي العزل موجود عشانه.
 */

interface Row {
  branch_id: number | null;
  branch_name: string;
  sales_count: number; sales_net: string; sales_cash: string; sales_credit: string;
  returns_count: number; returns_value: string;
  purchases_count: number; purchases_net: string; purchase_returns_count: number;
  transfers_count: number; receipts_total: string; payments_total: string;
  users_count: number; reps_count: number; customers_count: number;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: any) => Number(v || 0).toLocaleString('ar-EG');

export default function BranchOverview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const load = async (r = range) => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/branch-overview', {
        params: {
          date_from: r?.[0] ? r[0].format('YYYY-MM-DD') : undefined,
          date_to: r?.[1] ? r[1].format('YYYY-MM-DD') : undefined,
        },
      });
      setRows(res.data.rows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(null); }, []);

  const total = useMemo(() => rows.reduce((t, r) => ({
    sales: t.sales + Number(r.sales_net || 0),
    salesCount: t.salesCount + r.sales_count,
    returns: t.returns + Number(r.returns_value || 0),
    purchases: t.purchases + Number(r.purchases_net || 0),
    receipts: t.receipts + Number(r.receipts_total || 0),
  }), { sales: 0, salesCount: 0, returns: 0, purchases: 0, receipts: 0 }), [rows]);

  // «صافي المبيعات» هو الصافي ناقص المرتجع — الرقم اللي بيتقارن بيه فرع بفرع.
  const netOf = (r: Row) => Number(r.sales_net || 0) - Number(r.returns_value || 0);
  const best = rows.length
    ? rows.reduce((a, b) => (netOf(b) > netOf(a) ? b : a)) : null;

  const columns = [
    {
      title: 'الفرع', dataIndex: 'branch_name', key: 'branch_name', width: 170,
      render: (v: string, r: Row) => (
        <Space size={4}>
          <b>{v}</b>
          {best && r.branch_id === best.branch_id && netOf(r) > 0 && (
            <Tag color="green" style={{ fontSize: 11 }}>الأعلى</Tag>
          )}
          {r.branch_id === null && (
            <Tag color="default" style={{ fontSize: 11 }}>مستندات قديمة</Tag>
          )}
        </Space>
      ),
    },
    { title: 'فواتير', dataIndex: 'sales_count', key: 'sales_count', width: 80,
      align: 'center' as const, render: num },
    { title: 'مبيعات', dataIndex: 'sales_net', key: 'sales_net', width: 130,
      align: 'left' as const,
      render: (v: string) => <b style={{ color: '#389e0d' }}>{money(v)}</b> },
    { title: 'نقدي', dataIndex: 'sales_cash', key: 'sales_cash', width: 120,
      align: 'left' as const, render: money },
    { title: 'آجل', dataIndex: 'sales_credit', key: 'sales_credit', width: 120,
      align: 'left' as const,
      render: (v: string) => <span style={{ color: Number(v) ? '#cf1322' : undefined }}>{money(v)}</span> },
    { title: 'مرتجعات', dataIndex: 'returns_value', key: 'returns_value', width: 120,
      align: 'left' as const,
      render: (v: string, r: Row) => (
        <span style={{ color: '#eb2f96' }}>{money(v)} <small>({num(r.returns_count)})</small></span>
      ) },
    { title: 'الصافي', dataIndex: 'branch_id', key: 'net', width: 130,
      align: 'left' as const,
      render: (_: any, r: Row) => <b>{money(netOf(r))}</b> },
    { title: 'مشتريات', dataIndex: 'purchases_net', key: 'purchases_net', width: 130,
      align: 'left' as const,
      render: (v: string, r: Row) => (
        <span style={{ color: '#0958d9' }}>{money(v)} <small>({num(r.purchases_count)})</small></span>
      ) },
    { title: 'مردودات شرا', dataIndex: 'purchase_returns_count', key: 'purchase_returns_count',
      width: 110, align: 'center' as const, render: num },
    { title: 'تحويلات', dataIndex: 'transfers_count', key: 'transfers_count', width: 90,
      align: 'center' as const, render: num },
    { title: 'قبض', dataIndex: 'receipts_total', key: 'receipts_total', width: 120,
      align: 'left' as const, render: money },
    { title: 'صرف', dataIndex: 'payments_total', key: 'payments_total', width: 120,
      align: 'left' as const, render: money },
    { title: 'مستخدمين', dataIndex: 'users_count', key: 'users_count', width: 90,
      align: 'center' as const,
      render: (v: number, r: Row) => `${num(v)}${r.reps_count ? ` (${num(r.reps_count)} مندوب)` : ''}` },
    { title: 'عملاء', dataIndex: 'customers_count', key: 'customers_count', width: 90,
      align: 'center' as const, render: num },
  ];

  const cols = useTableColumns('branch-overview', columns as any, { locked: ['branch_name'] });

  return (
    <Card
      title="نظرة على الفروع — كل فرع بأرقامه"
      extra={
        <Space>
          {cols.control}
          <DateRangeFilter
            value={range}
            onChange={(v) => { setRange(v as any); load(v as any); }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
        </Space>
      }
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small" style={{ background: '#f6ffed', borderColor: '#d9f7be' }}>
            <Statistic title="مبيعات الشركة" value={money(total.sales)} suffix="ج.م"
              valueStyle={{ color: '#389e0d', fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" style={{ background: '#fff0f6', borderColor: '#ffd6e7' }}>
            <Statistic title="مرتجعات الشركة" value={money(total.returns)} suffix="ج.م"
              valueStyle={{ color: '#eb2f96', fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" style={{ background: '#e6f4ff', borderColor: '#91caff' }}>
            <Statistic title="مشتريات الشركة" value={money(total.purchases)} suffix="ج.م"
              valueStyle={{ color: '#0958d9', fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="تحصيل الشركة" value={money(total.receipts)} suffix="ج.م"
              valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
      </Row>

      <Table
        rowKey={(r: Row) => String(r.branch_id ?? 'none')}
        size="small"
        loading={loading}
        dataSource={rows}
        columns={cols.columns}
        tableLayout="fixed"
        pagination={false}
        locale={{ emptyText: <Empty description="لا توجد فروع" /> }}
        summary={() => (
          <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
            <Table.Summary.Cell index={0}>الإجمالي</Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="center">{num(total.salesCount)}</Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="left">{money(total.sales)}</Table.Summary.Cell>
            <Table.Summary.Cell index={3} colSpan={20} />
          </Table.Summary.Row>
        )}
      />
    </Card>
  );
}

import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Segmented, Space, Statistic, Table, Button, Typography } from 'antd';
import { PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import DateRangeFilter from '../components/DateRangeFilter';
import { money } from '../utils/money';
import { printReport } from '../print/reportSheet';

/**
 * **تقرير البونص** — البضاعة اللي خرجت هدية، بسعر بيعها وبتكلفتها.
 *
 * البونص كان فاتورة بيع بخصم ١٠٠٪: تقارير المبيعات شايفاه صفر، والتكلفة بتاعته مش
 * باينة في أي حتة — ٣٧٨ ألف في ٣ شهور. هنا بيتجمّع لكل عميل أو مندوب أو شهر.
 */
type Group = 'customer' | 'rep' | 'month';
interface Row { key: string | number | null; name: string; invoices: number; value: string; cost: string }

const GROUP_LABEL: Record<Group, string> = { customer: 'العميل', rep: 'المندوب', month: 'الشهر' };

export default function BonusReport() {
  const [group, setGroup] = useState<Group>('customer');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    [dayjs().startOf('year'), dayjs().endOf('day')]);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ invoices: 0, value: '0', cost: '0' });
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api/v1/sales/bonus-report', {
      params: {
        group,
        date_from: range?.[0]?.format('YYYY-MM-DD'),
        date_to: range?.[1]?.format('YYYY-MM-DD'),
      },
    })
      .then((res) => {
        setRows(res.data.rows || []);
        setTotals({ invoices: res.data.total_invoices, value: res.data.total_value,
          cost: res.data.total_cost });
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [group, range?.[0]?.valueOf(), range?.[1]?.valueOf()]);

  const print = () => printReport<Row>(
    {
      title: 'تقرير البونص',
      meta: [
        ['التجميع', GROUP_LABEL[group]],
        ['الفترة', range ? `${range[0].format('YYYY-MM-DD')} ← ${range[1].format('YYYY-MM-DD')}` : 'الكل'],
      ],
    },
    [
      { title: GROUP_LABEL[group], value: 'name' },
      { title: 'فواتير', value: 'invoices', numeric: true },
      { title: 'القيمة بسعر البيع', value: (r) => money(r.value), numeric: true },
      { title: 'التكلفة', value: (r) => money(r.cost), numeric: true },
    ],
    rows,
    [
      { label: 'عدد فواتير البونص', value: totals.invoices },
      { label: 'القيمة بسعر البيع', value: `${money(totals.value)} ج.م` },
      { label: 'التكلفة', value: `${money(totals.cost)} ج.م` },
    ],
  );

  return (
    <Card
      title={<Typography.Text strong style={{ fontSize: 16 }}>تقرير البونص</Typography.Text>}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
          <Button icon={<PrinterOutlined />} onClick={print} disabled={!rows.length}>طباعة</Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented<Group> value={group} onChange={(v) => setGroup(v)}
          options={[
            { value: 'customer', label: 'لكل عميل' },
            { value: 'rep', label: 'لكل مندوب' },
            { value: 'month', label: 'لكل شهر' },
          ]} />
        <DateRangeFilter value={range} onChange={setRange} />
      </Space>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}><Statistic title="فواتير البونص" value={totals.invoices} /></Col>
        <Col xs={24} md={8}>
          <Statistic title="القيمة بسعر البيع" value={money(totals.value)} suffix="ج.م" />
        </Col>
        <Col xs={24} md={8}>
          <Statistic title="التكلفة" value={money(totals.cost)} suffix="ج.م"
            valueStyle={{ color: '#cf1322' }} />
        </Col>
      </Row>
      <Table<Row>
        size="small" loading={loading} rowKey={(r) => String(r.key ?? 'none')}
        dataSource={rows} pagination={{ pageSize: 50 }}
        columns={[
          { title: GROUP_LABEL[group], dataIndex: 'name' },
          { title: 'فواتير', dataIndex: 'invoices', width: 90, align: 'center',
            sorter: (a, b) => a.invoices - b.invoices },
          { title: 'القيمة بسعر البيع', dataIndex: 'value', width: 160,
            render: (v) => `${money(v)} ج.م`, sorter: (a, b) => Number(a.value) - Number(b.value) },
          { title: 'التكلفة', dataIndex: 'cost', width: 160,
            render: (v) => `${money(v)} ج.م`, sorter: (a, b) => Number(a.cost) - Number(b.cost),
            defaultSortOrder: 'descend' },
        ]}
      />
    </Card>
  );
}

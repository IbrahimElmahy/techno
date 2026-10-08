import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FilterTable as Table } from '../components/FilterTable';
import { GiftOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import DateRangeFilter from '../components/DateRangeFilter';
import { money, numeralsLocale } from '../utils/money';
import ListPage from '../components/ListPage';
import ExportExcelButton from '../components/ExportExcelButton';
import { printReport } from '../print/reportSheet';
import { useQueryTab } from '../components/useQueryTab';

type Group = 'customer' | 'rep' | 'month';
interface Row { key: string | number | null; name: string; invoices: number; value: string; cost: string }

const GROUP_LABEL: Record<Group, string> = { customer: 'العميل', rep: 'المندوب', month: 'الشهر' };

export default function BonusReport() {
  const [groupRaw, setGroup] = useQueryTab('customer');
  const group: Group = ['customer', 'rep', 'month'].includes(groupRaw) ? groupRaw as Group : 'customer';
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
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
      { label: 'القيمة بسعر البيع', value: `${money(totals.value)}` },
      { label: 'التكلفة', value: `${money(totals.cost)}` },
    ],
  );

  const columns: ColumnsType<Row> = [
    { title: GROUP_LABEL[group], dataIndex: 'name' },
    { title: 'فواتير', dataIndex: 'invoices', width: 90, align: 'center',
      sorter: (a, b) => a.invoices - b.invoices },
    { title: 'القيمة بسعر البيع', dataIndex: 'value', width: 160,
      render: (v) => `${money(v)}`, sorter: (a, b) => Number(a.value) - Number(b.value) },
    { title: 'التكلفة', dataIndex: 'cost', width: 160,
      render: (v) => `${money(v)}`, sorter: (a, b) => Number(a.cost) - Number(b.cost),
      defaultSortOrder: 'descend' },
  ];

  const footer = (
    <span className="sl-foot">
      <span>فواتير البونص: <b>{Number(totals.invoices || 0).toLocaleString(numeralsLocale())}</b></span>
      <span>القيمة بسعر البيع: <b>{money(totals.value)}</b></span>
      <span>التكلفة: <b className="is-neg">{money(totals.cost)}</b></span>
    </span>
  );

  return (
    <ListPage<Group>
      icon={<GiftOutlined />}
      title="تقرير البونص"
      subtitle="البضاعة المصروفة بونص بسعر البيع والتكلفة — مجمّعة لكل عميل أو مندوب أو شهر"
      tabs={[
        { key: 'customer', label: 'لكل عميل' },
        { key: 'rep', label: 'لكل مندوب' },
        { key: 'month', label: 'لكل شهر' },
      ]}
      activeTab={group}
      onTabChange={setGroup}
      actions={(<>
        <Button icon={<PrinterOutlined />} onClick={print} disabled={!rows.length}>طباعة</Button>
        <ExportExcelButton name="تقرير البونص" rows={rows} tableColumns={columns as any}
          style={{ marginInlineStart: 0 }} />
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={<DateRangeFilter className="sl-f-dates" value={range} onChange={setRange} />}
    >
      <Table<Row>
        className="sl-table"
        size="small" loading={loading} rowKey={(r) => String(r.key ?? 'none')}
        dataSource={rows}
        pagination={{ pageSize: 50, showTotal: () => footer }}
        columns={columns}
      />
    </ListPage>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import {
  Button, Input, Table, Tag, message,
} from 'antd';
import { BarChartOutlined, SearchOutlined, ClearOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useListFilter } from '../components/ListToolbar';
import ListPage from '../components/ListPage';
import { useScreenShortcuts } from '../components/keyboard';
import DateRangeFilter from '../components/DateRangeFilter';
import { useQueryTab } from '../components/useQueryTab';
import { useCouponLifecycle } from './CouponLifecycle';

import { useCanSeeStats } from '../components/StatsRow';
import { numeralsLocale } from '../utils/money';

interface PartyRow {
  customer_id: number | null;
  name: string;
  phone: string | null;
  issued: number;
  returned: number;
  outstanding: number;
  received: number;
  last_issue: string | null;
  last_receipt: string | null;
}

interface TechRow {
  name: string;
  customer_id: number | null;
  visits: number;
  points: string;
  last_visit: string | null;
}

interface RepRow {
  rep_user_id: number | null;
  name: string;
  visits: number;
  points: string;
  customers: number;
  last_visit: string | null;
}

const num = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 0 });
const pts = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 1 });

export default function AfterSalesReports() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useQueryTab('plumbers');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [loading, setLoading] = useState(false);

  const [plumbers, setPlumbers] = useState<PartyRow[]>([]);
  const [distributors, setDistributors] = useState<PartyRow[]>([]);
  const [techs, setTechs] = useState<TechRow[]>([]);
  const [reps, setReps] = useState<RepRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = {};
    if (range) {
      params.date_from = range[0].format('YYYY-MM-DD');
      params.date_to = range[1].format('YYYY-MM-DD');
    }
    try {
      const [p, d, t, r] = await Promise.all([
        api.get('/api/v1/after-sales-reports/coupons/by-plumber', { params }),
        api.get('/api/v1/after-sales-reports/coupons/by-distributor', { params }),
        api.get('/api/v1/after-sales-reports/inspections/by-technician', { params }),
        api.get('/api/v1/after-sales-reports/inspections/by-rep', { params }),
      ]);
      setPlumbers(p.data || []);
      setDistributors(d.data || []);
      setTechs(t.data || []);
      setReps(r.data || []);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقارير');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const plumberFilter = useListFilter(plumbers, { search: (r) => [r.name, r.phone] });
  const distFilter = useListFilter(distributors, { search: (r) => [r.name, r.phone] });
  const techFilter = useListFilter(techs, { search: (r) => [r.name] });
  const repFilter = useListFilter(reps, { search: (r) => [r.name] });

  const openCard = (id: number | null) => { if (id) navigate(`/customers/${id}`); };

  const plumberColumns = [
    { title: 'الفني', dataIndex: 'name', key: 'name', ellipsis: true,
      render: (v: string, r: PartyRow) => (
        <a onClick={() => openCard(r.customer_id)}>{v}</a>) },
    { title: 'الهاتف', dataIndex: 'phone', key: 'phone', width: 130,
      render: (v: string | null) => v || '-' },
    { title: 'المُعاد', dataIndex: 'received', key: 'received', width: 100,
      sorter: (a: PartyRow, b: PartyRow) => a.received - b.received,
      render: (v: number) => <b>{num(v)}</b> },
    { title: 'المصروف له', dataIndex: 'issued', key: 'issued', width: 100,
      sorter: (a: PartyRow, b: PartyRow) => a.issued - b.issued,
      render: (v: number) => (v ? num(v) : '-') },
    { title: 'آخر استلام', dataIndex: 'last_receipt', key: 'last_receipt', width: 120,
      render: (v: string | null) => v || '-' },
  ];

  const distColumns = [
    { title: 'الموزع / التاجر', dataIndex: 'name', key: 'name', ellipsis: true,
      render: (v: string, r: PartyRow) => (
        <a onClick={() => openCard(r.customer_id)}>{v}</a>) },
    { title: 'الهاتف', dataIndex: 'phone', key: 'phone', width: 130,
      render: (v: string | null) => v || '-' },
    { title: 'المصروف له', dataIndex: 'issued', key: 'issued', width: 110,
      sorter: (a: PartyRow, b: PartyRow) => a.issued - b.issued,
      render: (v: number) => num(v) },
    { title: 'المُعاد', dataIndex: 'returned', key: 'returned', width: 100,
      sorter: (a: PartyRow, b: PartyRow) => a.returned - b.returned,
      render: (v: number) => num(v) },
    { title: 'المتبقي لديه', dataIndex: 'outstanding', key: 'outstanding', width: 110,
      sorter: (a: PartyRow, b: PartyRow) => a.outstanding - b.outstanding,
      render: (v: number) => (
        <Tag color={v > 0 ? 'orange' : 'green'}>{num(v)}</Tag>) },
    { title: 'آخر صرف', dataIndex: 'last_issue', key: 'last_issue', width: 120,
      render: (v: string | null) => v || '-' },
  ];

  const techColumns = [
    { title: 'الفني', dataIndex: 'name', key: 'name', ellipsis: true,
      render: (v: string, r: TechRow) => (
        r.customer_id ? <a onClick={() => openCard(r.customer_id)}>{v}</a> : v) },
    { title: 'معاينات', dataIndex: 'visits', key: 'visits', width: 110,
      sorter: (a: TechRow, b: TechRow) => a.visits - b.visits,
      render: (v: number) => <b>{num(v)}</b> },
    { title: 'النقاط', dataIndex: 'points', key: 'points', width: 130,
      sorter: (a: TechRow, b: TechRow) => Number(a.points) - Number(b.points),
      render: (v: string) => pts(v) },
    { title: 'آخر معاينة', dataIndex: 'last_visit', key: 'last_visit', width: 120,
      render: (v: string | null) => v || '-' },
  ];

  const repColumns = [
    { title: 'المندوب', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'معاينات', dataIndex: 'visits', key: 'visits', width: 110,
      sorter: (a: RepRow, b: RepRow) => a.visits - b.visits,
      render: (v: number) => <b>{num(v)}</b> },
    { title: 'عملاء', dataIndex: 'customers', key: 'customers', width: 110,
      sorter: (a: RepRow, b: RepRow) => a.customers - b.customers,
      render: (v: number) => num(v) },
    { title: 'النقاط', dataIndex: 'points', key: 'points', width: 130,
      sorter: (a: RepRow, b: RepRow) => Number(a.points) - Number(b.points),
      render: (v: string) => pts(v) },
    { title: 'آخر معاينة', dataIndex: 'last_visit', key: 'last_visit', width: 120,
      render: (v: string | null) => v || '-' },
  ];

  const plumberCols = useTableColumns('as-coupons-plumbers', plumberColumns as any, {
    export: { name: 'كوبونات السباكين', rows: plumberFilter.filtered },
  });
  const distCols = useTableColumns('as-coupons-distributors', distColumns as any, {
    export: { name: 'كوبونات الموزعين', rows: distFilter.filtered },
  });
  const techCols = useTableColumns('as-visits-technicians', techColumns as any, {
    export: { name: 'الزيارات بنقاط الفني', rows: techFilter.filtered },
  });
  const repCols = useTableColumns('as-visits-reps', repColumns as any, {
    export: { name: 'زيارات المناديب', rows: repFilter.filtered },
  });

  const totals = useMemo(() => ({
    returnedByPlumbers: plumbers.reduce((s, r) => s + r.received, 0),
    issued: distributors.reduce((s, r) => s + r.issued, 0),
    outstanding: distributors.reduce((s, r) => s + r.outstanding, 0),
    visits: reps.reduce((s, r) => s + r.visits, 0),
    points: reps.reduce((s, r) => s + Number(r.points || 0), 0),
  }), [plumbers, distributors, reps]);

  const canSeeStats = useCanSeeStats();

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const lifecycle = useCouponLifecycle(range, activeTab === 'lifecycle');

  type TabKey = 'plumbers' | 'distributors' | 'technicians' | 'reps' | 'lifecycle';
  const tabs: Record<Exclude<TabKey, 'lifecycle'>, {
    label: string; rows: any[]; filter: any; cols: any; stats: [string, string, string?][];
  }> = {
    plumbers: {
      label: 'كوبونات السباكين', rows: plumbers, filter: plumberFilter, cols: plumberCols,
      stats: [['المُعاد من السباكين', num(totals.returnedByPlumbers)]],
    },
    distributors: {
      label: 'كوبونات الموزعين', rows: distributors, filter: distFilter, cols: distCols,
      stats: [
        ['المصروف للموزعين', num(totals.issued)],
        ['المتبقي لدى الموزعين', num(totals.outstanding), totals.outstanding > 0 ? 'is-neg' : 'is-pos'],
      ],
    },
    technicians: {
      label: 'الزيارات بنقاط الفني', rows: techs, filter: techFilter, cols: techCols,
      stats: [['معاينات', num(totals.visits)], ['نقاط المعاينات', pts(totals.points)]],
    },
    reps: {
      label: 'زيارات المناديب', rows: reps, filter: repFilter, cols: repCols,
      stats: [['معاينات', num(totals.visits)], ['نقاط المعاينات', pts(totals.points)]],
    },
  };
  const tabKeys = [...(Object.keys(tabs) as TabKey[]), 'lifecycle' as TabKey];
  const tabKey: TabKey = (tabKeys.includes(activeTab as TabKey) ? activeTab : 'plumbers') as TabKey;
  const isLifecycle = tabKey === 'lifecycle';
  const cur = tabs[isLifecycle ? 'plumbers' : tabKey as Exclude<TabKey, 'lifecycle'>];

  const footer = (
    <span className="sl-foot">
      <span>العدد: <b>{num(cur.rows.length)}</b></span>
      {cur.filter.filtered.length !== cur.rows.length && (
        <span>المعروض: <b>{num(cur.filter.filtered.length)}</b></span>
      )}
      {canSeeStats && cur.stats.map(([label, value, cls]) => (
        <span key={label}>{label}: <b className={cls}>{value}</b></span>
      ))}
    </span>
  );

  return (
    <ListPage<TabKey>
      icon={<BarChartOutlined />}
      title="تقارير ما بعد البيع" muted="(تقارير المتابعة)"
      tabs={tabKeys.map((k) => (k === 'lifecycle'
        ? { key: k, label: 'حركة الكوبون', count: lifecycle.count }
        : { key: k, label: tabs[k as Exclude<TabKey, 'lifecycle'>].label,
          count: tabs[k as Exclude<TabKey, 'lifecycle'>].rows.length }))}
      activeTab={tabKey}
      onTabChange={setActiveTab}
      actions={isLifecycle ? lifecycle.actions : cur.cols.control}
      filters={isLifecycle ? (<>
        <DateRangeFilter className="sl-f-dates" value={range} onChange={setRange} />
        {lifecycle.filters}
      </>) : (<>
        <Input
          className="sl-f-search"
          ref={searchRef}
          allowClear
          prefix={<SearchOutlined />}
          placeholder="بحث بالاسم"
          value={cur.filter.query}
          onChange={(e) => cur.filter.setQuery(e.target.value)}
        />
        <DateRangeFilter className="sl-f-dates" value={range} onChange={setRange} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={cur.filter.reset}>مسح</Button>
      </>)}
    >
      {isLifecycle ? lifecycle.table : <Table
        key={tabKey}
        className="sl-table"
        rowKey={(r: any) => String(r.customer_id ?? r.rep_user_id ?? r.name)}
        size="small" loading={loading} dataSource={cur.filter.filtered}
        columns={cur.cols.columns} tableLayout="fixed"
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true, locale: { items_per_page: '' },
          showTotal: () => footer,
        }}
        locale={{ emptyText: 'لا توجد بيانات في هذه الفترة' }}
      />}
    </ListPage>
  );
}

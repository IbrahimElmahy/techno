import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Input, Select, Space, Spin, Table, Tabs, Tag, message } from 'antd';
import {
  ClearOutlined, IdcardOutlined, PrinterOutlined, ReloadOutlined, SolutionOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableColumns } from '../components/ColumnSettings';
import { TabDrawer } from '../components/TabModal';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { money, qty, numeralsLocale } from '../utils/money';
import { isStopped } from '../utils/reps';
import { PAGE_SIZE } from '../utils/pagination';
import { printReport, type PrintColumn } from '../print/reportSheet';

interface Row {
  key: string;
  customer_id: number | null;
  name: string;
  code: string | null;
  phone: string | null;
  customer_type: string | null;
  governorate: string | null;
  markaz: string | null;
  rep: string | null;
  coupons_year: number;
  coupons_prev_year: number;
  coupons_period: number;
  coupon_value_period: string;
  receipts_period: number;
  visits_period: number;
  points_period: string;
  last_visit: string | null;
  last_receipt: string | null;
  points_balance: string;
}

interface Details {
  date_from: string;
  date_to: string;
  receipts: Record<string, any>[];
  visits: Record<string, any>[];
  totals: { coupons: number; coupon_value: string; visits: number; points: string };
}

const num = (v: any) => Number(v || 0).toLocaleString(numeralsLocale());
const REP_ROLES = ['sales_rep', 'rep_supervisor', 'sales_manager'];
const TYPE_LABEL: Record<string, string> = {
  plumber: 'فني', trader: 'تاجر', showroom: 'معرض', employee: 'موظف', company: 'شركة',
  establishment: 'مؤسسة', other: 'آخر',
};

const yearRange = (y: number): [Dayjs, Dayjs] => {
  const start = dayjs(`${y}-01-01`);
  const end = y === dayjs().year() ? dayjs() : dayjs(`${y}-12-31`);
  return [start, end];
};

export default function TechnicianStatement() {
  const navigate = useNavigate();
  const thisYear = dayjs().year();
  const [year, setYear] = useState(thisYear);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(() => yearRange(thisYear));
  const [f, setF] = useState<Record<string, any>>({});
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'plumber' | 'all'>('plumber');
  const [activeOnly, setActiveOnly] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<Record<string, any[]>>({});
  const [open, setOpen] = useState<Row | null>(null);

  useEffect(() => {
    const byName = (r: any) => r.full_name || r.username || r.name || '';
    Promise.all([
      api.get('/api/v1/users').catch(() => ({ data: [] })),
      api.get('/api/v1/governorates').catch(() => ({ data: [] })),
    ]).then(([u, g]) => {
      const list = (x: any) => (Array.isArray(x.data) ? x.data : x.data?.rows || []);
      setLists({
        reps: sortByName(list(u).filter((x: any) => REP_ROLES.includes(x.role)), byName),
        governorates: sortByName(list(g), byName),
      });
    });
  }, []);

  const baseParams = () => {
    const p: Record<string, any> = { year, scope };
    if (range?.[0]) p.date_from = range[0].format('YYYY-MM-DD');
    if (range?.[1]) p.date_to = range[1].format('YYYY-MM-DD');
    return p;
  };

  const seq = useRef(0);
  const load = async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const p: Record<string, any> = { ...baseParams(), active_only: activeOnly };
      if (q.trim()) p.q = q.trim();
      Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p[k] = v; });
      const res = await api.get('/api/v1/after-sales-reports/technician-statement', { params: p });
      if (my !== seq.current) return;
      setRows(res.data.rows || []);
      setTotals(res.data.totals || null);
    } catch (err: any) {
      if (my === seq.current) message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [year, range?.[0]?.valueOf(), range?.[1]?.valueOf(), scope, activeOnly, q,
    JSON.stringify(f)]);

  const changeYear = (y: number) => {
    setYear(y);
    setRange(yearRange(y));
  };

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 130, render: (v: string | null) => v || '-' },
    { title: 'الاسم', dataIndex: 'name', key: 'name',
      render: (v: string, r: Row) => <a onClick={() => setOpen(r)}>{v}</a> },
    ...(scope === 'all' ? [{ title: 'النوع', dataIndex: 'customer_type', key: 'customer_type', width: 90,
      render: (v: string | null) => (v ? TYPE_LABEL[v] || v : <Tag>غير مسجل</Tag>) }] : []),
    { title: 'الهاتف', dataIndex: 'phone', key: 'phone', width: 130, render: (v: string | null) => v || '-' },
    { title: 'المحافظة', dataIndex: 'governorate', key: 'governorate', render: (v: string | null) => v || '-' },
    { title: 'المركز', dataIndex: 'markaz', key: 'markaz', render: (v: string | null) => v || '-' },
    { title: 'المندوب', dataIndex: 'rep', key: 'rep', render: (v: string | null) => v || '-' },
    { title: `كوبونات ${year}`, dataIndex: 'coupons_year', key: 'coupons_year', align: 'left' as const,
      sorter: (a: Row, b: Row) => a.coupons_year - b.coupons_year, render: (v: number) => <b>{num(v)}</b> },
    { title: `كوبونات ${year - 1}`, dataIndex: 'coupons_prev_year', key: 'coupons_prev_year', align: 'left' as const,
      sorter: (a: Row, b: Row) => a.coupons_prev_year - b.coupons_prev_year, render: num },
    { title: 'كوبونات الفترة', dataIndex: 'coupons_period', key: 'coupons_period', align: 'left' as const,
      sorter: (a: Row, b: Row) => a.coupons_period - b.coupons_period, render: num },
    { title: 'قيمة كوبونات الفترة', dataIndex: 'coupon_value_period', key: 'coupon_value_period', align: 'left' as const,
      sorter: (a: Row, b: Row) => Number(a.coupon_value_period) - Number(b.coupon_value_period), render: money },
    { title: 'أذون الاستلام', dataIndex: 'receipts_period', key: 'receipts_period', align: 'left' as const,
      render: num },
    { title: 'زيارات الفترة', dataIndex: 'visits_period', key: 'visits_period', align: 'left' as const,
      sorter: (a: Row, b: Row) => a.visits_period - b.visits_period, render: num },
    { title: 'نقاط الفترة', dataIndex: 'points_period', key: 'points_period', align: 'left' as const,
      sorter: (a: Row, b: Row) => Number(a.points_period) - Number(b.points_period),
      render: (v: string) => <b>{qty(v)}</b> },
    { title: 'آخر زيارة', dataIndex: 'last_visit', key: 'last_visit', width: 110,
      render: (v: string | null) => v || '-' },
    { title: 'آخر استلام كوبونات', dataIndex: 'last_receipt', key: 'last_receipt', width: 120,
      render: (v: string | null) => v || '-' },
    { title: 'رصيد النقاط', dataIndex: 'points_balance', key: 'points_balance', align: 'left' as const,
      render: (v: string) => qty(v) },
  ];

  const cols = useTableColumns('technician-statement', columns as any, {
    defaultHidden: ['receipts_period', 'markaz'],
    export: { name: 'كشف حساب الفني', rows },
  });

  const print = () => {
    const visible = (cols.columns as any[]).filter((c) => c.dataIndex);
    const pc: PrintColumn<Row>[] = visible.map((c: any) => ({
      title: String(c.title), numeric: c.align === 'left',
      value: (r: Row) => {
        const v = (r as any)[c.dataIndex];
        if (c.dataIndex === 'coupon_value_period') return money(v);
        if (c.dataIndex === 'points_period' || c.dataIndex === 'points_balance') return qty(v);
        if (c.dataIndex === 'customer_type') return v ? TYPE_LABEL[v] || v : 'غير مسجل';
        if (c.align === 'left') return num(v);
        return v ?? '';
      },
    }));
    const meta: [string, string][] = [
      ['السنة', String(year)],
      ['الفترة', range ? `${range[0].format('YYYY-MM-DD')} — ${range[1].format('YYYY-MM-DD')}` : 'السنة كاملة'],
    ];
    printReport({ title: 'كشف حساب الفني', meta }, pc, rows, totals ? [
      { label: `كوبونات ${year}`, value: num(totals.coupons_year) },
      { label: 'قيمة كوبونات الفترة', value: money(totals.coupon_value_period) },
      { label: 'زيارات الفترة', value: num(totals.visits_period) },
      { label: 'نقاط الفترة', value: qty(totals.points_period) },
    ] : []);
  };

  const years = useMemo(() => Array.from({ length: 8 }, (_, n) => thisYear - n), [thisYear]);
  const setFilter = (k: string, v: any) => setF((prev) => ({ ...prev, [k]: v }));
  const repLabel = (r: any) => `${r.full_name || r.username || r.id}${isStopped(r) ? ' (موقوف)' : ''}`;

  return (
    <ListPage
      icon={<SolutionOutlined />}
      title="كشف حساب الفني"
      muted={`سنة ${year}`}
      actions={(<>
        {cols.control}
        <Button icon={<PrinterOutlined />} onClick={print}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Select style={{ width: 100 }} value={year} onChange={changeYear}
          options={years.map((y) => ({ value: y, label: String(y) }))} />
        <DateRangeFilter value={range as any} onChange={(v: any) => setRange(v)} />
        <Select style={{ width: 150 }} value={scope} onChange={setScope}
          options={[{ value: 'plumber', label: 'الفنيون فقط' }, { value: 'all', label: 'كل من له حركة' }]} />
        <Select allowClear showSearch placeholder="المندوب" value={f.rep_id} style={{ minWidth: 170 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('rep_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={(lists.reps || []).map((r) => ({ value: r.id, label: repLabel(r) }))} />
        <Select allowClear showSearch placeholder="المحافظة" value={f.governorate_id} style={{ minWidth: 140 }}
          onChange={(v) => setFilter('governorate_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.governorates || []).map((g) => ({ value: g.id, label: g.name }))} />
        <Input.Search allowClear placeholder="بحث بالاسم أو الكود أو الهاتف" style={{ width: 240 }}
          value={search} onChange={(e) => { setSearch(e.target.value); if (!e.target.value) setQ(''); }}
          onSearch={(v) => setQ(v)} />
        <Checkbox checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)}>من لهم حركة فقط</Checkbox>
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { setF({}); setSearch(''); setQ(''); setScope('plumber'); setActiveOnly(false);
            setYear(thisYear); setRange(yearRange(thisYear)); }}>مسح</Button>
      </>)}
      summary={totals && (<>
        <ListStat label="عدد الفنيين" value={num(totals.technicians)} hint={`لهم حركة ${num(totals.active)}`} />
        <ListStat label={`كوبونات ${year}`} value={num(totals.coupons_year)} tone="strong" />
        <ListStat label={`كوبونات ${year - 1}`} value={num(totals.coupons_prev_year)} />
        <ListStat label="قيمة كوبونات الفترة" value={money(totals.coupon_value_period)} />
        <ListStat label="زيارات الفترة" value={num(totals.visits_period)} />
        <ListStat label="نقاط الفترة" value={qty(totals.points_period)} tone="info" />
      </>)}
    >
      <Table<Row>
        className="sl-table" size="small" loading={loading}
        rowKey="key" dataSource={rows} columns={cols.columns as any}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
      <TechnicianDrawer row={open} year={year} params={baseParams()} onClose={() => setOpen(null)}
        onOpenCard={(id) => navigate(`/customers/${id}`)} />
    </ListPage>
  );
}

function TechnicianDrawer({ row, year, params, onClose, onOpenCard }: {
  row: Row | null;
  year: number;
  params: Record<string, any>;
  onClose: () => void;
  onOpenCard: (id: number) => void;
}) {
  const [data, setData] = useState<Details | null>(null);
  const [loading, setLoading] = useState(false);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!row) { setData(null); return; }
    let live = true;
    setLoading(true);
    const p: Record<string, any> = { ...params };
    if (row.customer_id) p.customer_id = row.customer_id; else p.name = row.name;
    api.get('/api/v1/after-sales-reports/technician-statement/details', { params: p })
      .then((res) => { if (live) setData(res.data); })
      .catch((err: any) => { if (live) message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التفاصيل'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [row?.key, paramsKey]);

  const tile = (label: string, value: React.ReactNode) => (
    <div style={{ padding: '6px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8 }}>
      <div style={{ fontSize: 14, color: '#8c8c8c' }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );

  const receiptColumns = [
    { title: 'رقم الإذن', dataIndex: 'document_number', key: 'document_number', width: 120 },
    { title: 'تاريخ الاستلام', dataIndex: 'received_date', key: 'received_date', width: 120 },
    { title: 'نوع الكوبون', dataIndex: 'coupon_kind', key: 'coupon_kind', render: (v: string | null) => v || '-' },
    { title: 'العدد', dataIndex: 'coupon_count', key: 'coupon_count', align: 'left' as const, render: num },
    { title: 'قيمة الكوبون', dataIndex: 'unit_value', key: 'unit_value', align: 'left' as const, render: money },
    { title: 'القيمة', dataIndex: 'value', key: 'value', align: 'left' as const,
      render: (v: string) => <b>{money(v)}</b> },
    { title: 'المندوب', dataIndex: 'rep', key: 'rep', render: (v: string | null) => v || '-' },
  ];

  const visitColumns = [
    { title: 'رقم الزيارة', dataIndex: 'document_number', key: 'document_number', width: 120 },
    { title: 'التاريخ', dataIndex: 'inspection_date', key: 'inspection_date', width: 110 },
    { title: 'نوع الزيارة', dataIndex: 'visit_kind', key: 'visit_kind', width: 110 },
    { title: 'نوع المعاينة', dataIndex: 'inspection_type', key: 'inspection_type',
      render: (v: string | null) => v || '-' },
    { title: 'المالك', dataIndex: 'owner_name', key: 'owner_name' },
    { title: 'العنوان', dataIndex: 'owner_address', key: 'owner_address', ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'التاجر', dataIndex: 'merchant', key: 'merchant', render: (v: string | null) => v || '-' },
    { title: 'المندوب', dataIndex: 'rep', key: 'rep', render: (v: string | null) => v || '-' },
    { title: 'الأصناف', dataIndex: 'items', key: 'items', align: 'left' as const, render: num },
    { title: 'النقاط', dataIndex: 'points', key: 'points', align: 'left' as const,
      render: (v: string) => <b>{qty(v)}</b> },
  ];

  return (
    <TabDrawer
      open={!!row}
      onClose={onClose}
      placement="right"
      width="min(1150px, 94vw)"
      destroyOnHidden
      title={row && (
        <Space size={8} wrap>
          <span>كشف حساب الفني: {row.name}</span>
          {row.code && <Tag color="blue">{row.code}</Tag>}
          {row.phone && <span style={{ color: '#8c8c8c', fontWeight: 400 }}>{row.phone}</span>}
        </Space>
      )}
      extra={row?.customer_id ? (
        <Button icon={<IdcardOutlined />} onClick={() => onOpenCard(row.customer_id!)}>كارت العميل</Button>
      ) : null}
    >
      {row && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={8} wrap>
            {tile(`كوبونات ${year}`, num(row.coupons_year))}
            {tile(`كوبونات ${year - 1}`, num(row.coupons_prev_year))}
            {tile('رصيد النقاط', qty(row.points_balance))}
            {data && tile(`الفترة ${data.date_from} — ${data.date_to}`,
              `${num(data.totals.coupons)} كوبون · ${num(data.totals.visits)} زيارة`)}
            {data && tile('قيمة كوبونات الفترة', money(data.totals.coupon_value))}
            {data && tile('نقاط الفترة', qty(data.totals.points))}
          </Space>
          {loading && !data ? (
            <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
          ) : !data || (!data.receipts.length && !data.visits.length) ? (
            <Empty description="لا توجد حركة لهذا الفني في هذه الفترة" />
          ) : (
            <Tabs
              items={[
                { key: 'receipts', label: `استلام الكوبونات (${num(data.receipts.length)})`,
                  children: (
                    <Table className="sl-table" size="small" rowKey="id" loading={loading}
                      dataSource={data.receipts} columns={receiptColumns as any}
                      pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }} />
                  ) },
                { key: 'visits', label: `الزيارات (${num(data.visits.length)})`,
                  children: (
                    <Table className="sl-table" size="small" rowKey="id" loading={loading}
                      dataSource={data.visits} columns={visitColumns as any}
                      scroll={{ x: 'max-content' }}
                      pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }} />
                  ) },
              ]}
            />
          )}
        </Space>
      )}
    </TabDrawer>
  );
}

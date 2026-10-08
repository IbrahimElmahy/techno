import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, DatePicker, Empty, Input, Segmented, Select, Space, Spin, Tag, Tooltip, message,
} from 'antd';
import type { TablePaginationConfig } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import {
  ClearOutlined, FileTextOutlined, IdcardOutlined, PrinterOutlined, SearchOutlined, WalletOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import ListPage, { ListStat, type ListTab } from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { useTableColumns } from '../components/ColumnSettings';
import { TabDrawer } from '../components/TabModal';
import DateRangeFilter from '../components/DateRangeFilter';
import { DocRef, docKindOf, type DocKind } from '../components/DocumentLink';
import { entryTypeLabel } from '../components/labels';
import { useLookup, labelMap } from '../hooks/useLookup';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { money, numeralsLocale } from '../utils/money';
import { useLiveRefresh } from '../utils/live';
import { printReport, type PrintColumn } from '../print/reportSheet';
import { repOptions } from '../utils/reps';

const WHITE = 'أبيض';
const POLY = 'بولي';

interface DebtRow {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  customer_type: string;
  active: boolean;
  branch_id: number | null;
  branch_name: string | null;
  territory_id: number | null;
  territory_name: string | null;
  governorate_id: number | null;
  governorate_name: string | null;
  markaz: string | null;
  rep_id: number | null;
  rep_name: string | null;
  balance_white: string;
  balance_poly: string;
  balance_other: string;
  total: string;
  last_movement_date: string | null;
}

interface DebtSummary {
  count: number;
  sum_white: string;
  sum_poly: string;
  sum_other: string;
  sum_total: string;
  sum_debit: string;
  sum_credit: string;
  debtors_count: number;
  creditors_count: number;
  other_count: number;
}

interface DebtCounts { debtors: number; creditors: number; nonzero: number; all: number }

interface Filters {
  q?: string;
  rep_id?: number;
  territory_id?: number;
  branch_id?: number;
  governorate_id?: number;
  customer_type?: string;
  family?: string;
  min_total?: number;
  max_total?: number;
  active?: boolean;
  as_of?: string;
}

type DebtTab = 'debtors' | 'creditors' | 'all';
type Sort = { field: string; order: 'asc' | 'desc' };

const TYPE_LABELS: Record<string, string> = {
  trader: 'تاجر / موزع', plumber: 'فني سباكة', employee: 'موظف', other: 'آخر',
};

const defaultSort = (tab: DebtTab): Sort =>
  ({ field: 'total', order: tab === 'creditors' ? 'asc' : 'desc' });

const n = (v: unknown) => Number(v || 0);

const Amount = ({ v, strong }: { v: unknown; strong?: boolean }) => {
  const x = n(v);
  if (!x) return <span style={{ color: '#bfbfbf' }}>-</span>;
  const color = strong ? (x > 0 ? '#cf1322' : '#389e0d') : x < 0 ? '#389e0d' : undefined;
  return <span style={{ color, fontWeight: strong ? 700 : undefined }}>{money(x)}</span>;
};

export default function CustomerDebts() {
  const navigate = useNavigate();
  const { options: typeOptions } = useLookup('customer_type');
  const typeLabels = labelMap(typeOptions);
  const typeLabel = (t: string) => typeLabels[t] || TYPE_LABELS[t] || t;

  const [tabRaw, setTabRaw] = useQueryTab('debtors');
  const tab: DebtTab = tabRaw === 'creditors' || tabRaw === 'all' ? tabRaw : 'debtors';
  const [showZero, setShowZero] = useState(false);

  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => {
      const q = search.trim() || undefined;
      if (q !== filters.q) setFilter('q', q);
    }, 400);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const [minDraft, setMinDraft] = useState<number | null>(null);
  const [maxDraft, setMaxDraft] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<Sort>(() => defaultSort(tab));

  const [rows, setRows] = useState<DebtRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<DebtSummary | null>(null);
  const [counts, setCounts] = useState<DebtCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [reps, setReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [governorates, setGovernorates] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);

  const [opened, setOpened] = useState<DebtRow | null>(null);

  const statusOf = (t: DebtTab) => (t === 'all' ? (showZero ? 'all' : 'nonzero') : t);

  const paramsOf = (f: Filters, t: DebtTab, s: Sort) => {
    const p: Record<string, any> = { status: statusOf(t), sort: s.field, order: s.order };
    Object.entries(f).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p[k] = v;
    });
    return p;
  };

  const seq = useRef(0);
  const load = async (opts: {
    f?: Filters; t?: DebtTab; s?: Sort; pg?: number; ps?: number; silent?: boolean;
  } = {}) => {
    const f = opts.f ?? filters;
    const t = opts.t ?? tab;
    const s = opts.s ?? sort;
    const pg = opts.pg ?? page;
    const ps = opts.ps ?? pageSize;
    const my = ++seq.current;
    if (!opts.silent) setLoading(true);
    try {
      const res = await api.get('/api/v1/customers/debts', {
        params: { ...paramsOf(f, t, s), limit: ps, offset: (pg - 1) * ps },
      });
      if (my !== seq.current) return;
      setRows(res.data.rows || []);
      setTotal(Number(res.data.total || 0));
      setSummary(res.data.summary || null);
      setCounts(res.data.counts || null);
    } catch (err: any) {
      if (my === seq.current) {
        message.error(err?.response?.data?.detail?.message || 'تعذر تحميل مديونيات العملاء');
      }
    } finally {
      if (my === seq.current && !opts.silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const byName = (r: any) => r.full_name || r.name;
    Promise.all([
      api.get('/api/v1/users').catch(() => ({ data: [] })),
      api.get('/api/v1/territories').catch(() => ({ data: [] })),
      api.get('/api/v1/governorates').catch(() => ({ data: [] })),
      api.get('/api/v1/branches').catch(() => ({ data: [] })),
    ]).then(([u, t, g, b]) => {
      setReps(sortByName((u.data || []).filter((x: any) => x.role === 'sales_rep'), byName));
      setTerritories(sortByName(t.data || [], byName));
      setGovernorates(sortByName(g.data || [], byName));
      setBranches(sortByName(b.data || [], byName));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useLiveRefresh(['customers', 'sales', 'vouchers', 'cheques'], () => load({ silent: true }));

  const setFilter = (key: keyof Filters, value: any) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    setPage(1);
    load({ f: next, pg: 1 });
  };

  const applySearch = () => {
    const q = search.trim() || undefined;
    if (q !== filters.q) setFilter('q', q);
  };

  const applyRange = () => {
    const mn = minDraft ?? undefined;
    const mx = maxDraft ?? undefined;
    if (mn === filters.min_total && mx === filters.max_total) return;
    const next = { ...filters, min_total: mn, max_total: mx };
    setFilters(next);
    setPage(1);
    load({ f: next, pg: 1 });
  };

  const changeTab = (k: DebtTab) => setTabRaw(k);
  const loadedTab = useRef(tab);
  useEffect(() => {
    if (loadedTab.current === tab) return;
    loadedTab.current = tab;
    const s = defaultSort(tab);
    setSort(s);
    setPage(1);
    load({ t: tab, s, pg: 1 });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstZero = useRef(true);
  useEffect(() => {
    if (firstZero.current) { firstZero.current = false; return; }
    if (tab === 'all') { setPage(1); load({ pg: 1 }); }
  }, [showZero]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetFilters = () => {
    setSearch('');
    setMinDraft(null);
    setMaxDraft(null);
    setFilters({});
    setShowZero(false);
    const s = defaultSort(tab);
    setSort(s);
    setPage(1);
    load({ f: {}, s, pg: 1 });
  };

  const onTableChange = (
    pg: TablePaginationConfig, _f: any, sorter: SorterResult<DebtRow> | SorterResult<DebtRow>[],
    extra: { action: string },
  ) => {
    if (extra.action === 'paginate') {
      const nextPage = pg.current || 1;
      const nextSize = pg.pageSize || pageSize;
      setPage(nextPage);
      setPageSize(nextSize);
      load({ pg: nextPage, ps: nextSize });
    } else if (extra.action === 'sort') {
      const one = Array.isArray(sorter) ? sorter[0] : sorter;
      const s: Sort = one?.order && one.columnKey
        ? { field: String(one.columnKey), order: one.order === 'ascend' ? 'asc' : 'desc' }
        : defaultSort(tab);
      setSort(s);
      setPage(1);
      load({ s, pg: 1 });
    }
  };

  const showOther = (summary?.other_count ?? 0) > 0;

  const srv = (key: string) => ({
    key,
    sorter: true,
    sortDirections: ['descend', 'ascend'] as ('descend' | 'ascend')[],
    sortOrder: sort.field === key ? (sort.order === 'asc' ? 'ascend' as const : 'descend' as const) : null,
  });

  const columns = [
    { title: 'الكود', dataIndex: 'code', width: 110, ...srv('code'),
      render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: 'العميل', dataIndex: 'name', ellipsis: true, ...srv('name'),
      render: (v: string, r: DebtRow) => (
        <Space size={4}>
          <a style={{ fontWeight: 600 }}>{v}</a>
          {!r.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ) },
    { title: 'الهاتف', dataIndex: 'phone', width: 120, ...srv('phone'),
      render: (v: string | null) => v || '-' },
    { title: 'النوع', dataIndex: 'customer_type', width: 100, ...srv('type'),
      filterValue: (r: DebtRow) => typeLabel(r.customer_type),
      render: (t: string) => <Tag color={t === 'plumber' ? 'blue' : 'default'}>{typeLabel(t)}</Tag> },
    { title: 'الفرع', dataIndex: 'branch_name', ellipsis: true, ...srv('branch'),
      render: (v: string | null) => v || '-' },
    { title: 'المنطقة', dataIndex: 'territory_name', ellipsis: true, ...srv('territory'),
      render: (v: string | null) => v || '-' },
    { title: 'المحافظة', dataIndex: 'governorate_name', ellipsis: true, ...srv('governorate'),
      render: (v: string | null) => v || '-' },
    { title: 'المدينة', dataIndex: 'markaz', ellipsis: true, ...srv('markaz'),
      render: (v: string | null) => v || '-' },
    { title: 'المندوب', dataIndex: 'rep_name', ellipsis: true, ...srv('rep'),
      render: (v: string | null) => v || '—' },
    { title: 'مديونية أبيض', dataIndex: 'balance_white', width: 130, align: 'left' as const,
      ...srv('white'), render: (v: string) => <Amount v={v} /> },
    { title: 'مديونية بولي', dataIndex: 'balance_poly', width: 130, align: 'left' as const,
      ...srv('poly'), render: (v: string) => <Amount v={v} /> },
    ...(showOther ? [{
      title: 'أخرى', dataIndex: 'balance_other', width: 120, align: 'left' as const,
      ...srv('other'), render: (v: string) => <Amount v={v} />,
    }] : []),
    { title: 'الإجمالي', dataIndex: 'total', width: 140, align: 'left' as const,
      ...srv('total'), render: (v: string) => <Amount v={v} strong /> },
    { title: 'آخر حركة', dataIndex: 'last_movement_date', width: 110, ...srv('last_date'),
      render: (v: string | null) => (v ? String(v).slice(0, 10) : '-') },
  ];

  const exportRows = useMemo(() => rows.map((r) => ({
    ...r,
    customer_type: typeLabel(r.customer_type),
    balance_white: n(r.balance_white),
    balance_poly: n(r.balance_poly),
    balance_other: n(r.balance_other),
    total: n(r.total),
  })), [rows, typeLabels]); // eslint-disable-line react-hooks/exhaustive-deps

  const tableCols = useTableColumns('customer-debts', columns, {
    defaultHidden: ['governorate', 'markaz'],
    locked: ['name'],
    export: { name: 'مديونيات العملاء', rows: exportRows },
  });

  const print = async () => {
    setPrinting(true);
    try {
      const res = await api.get('/api/v1/customers/debts', {
        params: { ...paramsOf(filters, tab, sort), limit: 5000, offset: 0 },
      });
      const all: DebtRow[] = res.data.rows || [];
      const s: DebtSummary = res.data.summary;
      const cols: PrintColumn<DebtRow>[] = [
        { title: 'الكود', value: 'code' },
        { title: 'العميل', value: 'name' },
        { title: 'الهاتف', value: (r) => r.phone || '' },
        { title: 'النوع', value: (r) => typeLabel(r.customer_type) },
        { title: 'الفرع', value: (r) => r.branch_name || '' },
        { title: 'المنطقة', value: (r) => r.territory_name || '' },
        { title: 'المندوب', value: (r) => r.rep_name || '' },
        { title: 'أبيض', value: (r) => money(r.balance_white), numeric: true },
        { title: 'بولي', value: (r) => money(r.balance_poly), numeric: true },
        ...(s.other_count > 0
          ? [{ title: 'أخرى', value: (r: DebtRow) => money(r.balance_other), numeric: true }] : []),
        { title: 'الإجمالي', value: (r) => money(r.total), numeric: true },
        { title: 'آخر حركة', value: (r) => (r.last_movement_date || '').slice(0, 10) },
      ];
      const nameOf = (list: any[], id?: number, key = 'name') =>
        list.find((x) => x.id === id)?.[key] ?? '';
      const meta: [string, string][] = [
        ['العرض', tab === 'debtors' ? 'المدينين' : tab === 'creditors' ? 'الدائنين' : 'الكل'],
        ...(filters.as_of ? [['الرصيد حتى', filters.as_of] as [string, string]] : []),
        ...(filters.q ? [['بحث', filters.q] as [string, string]] : []),
        ...(filters.rep_id ? [['المندوب', nameOf(reps, filters.rep_id, 'full_name')] as [string, string]] : []),
        ...(filters.branch_id ? [['الفرع', nameOf(branches, filters.branch_id)] as [string, string]] : []),
        ...(filters.territory_id ? [['المنطقة', nameOf(territories, filters.territory_id)] as [string, string]] : []),
        ...(filters.governorate_id ? [['المحافظة', nameOf(governorates, filters.governorate_id)] as [string, string]] : []),
        ...(filters.customer_type ? [['النوع', typeLabel(filters.customer_type)] as [string, string]] : []),
        ...(filters.family ? [['الحساب', filters.family === 'other' ? 'أخرى' : filters.family] as [string, string]] : []),
      ];
      printReport({ title: 'مديونيات العملاء', meta }, cols, all, [
        { label: 'عدد العملاء', value: s.count.toLocaleString(numeralsLocale()) },
        { label: 'مديونية أبيض', value: money(s.sum_white) },
        { label: 'مديونية بولي', value: money(s.sum_poly) },
        ...(s.other_count > 0 ? [{ label: 'أخرى', value: money(s.sum_other) }] : []),
        { label: 'الإجمالي', value: money(s.sum_total) },
        ...(all.length < s.count
          ? [{ label: 'ملحوظة', value: `المطبوع أول ${all.length} من ${s.count}` }] : []),
      ]);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تجهيز الطباعة');
    } finally {
      setPrinting(false);
    }
  };

  const tabs: ListTab<DebtTab>[] = [
    { key: 'debtors', label: 'المدينين', dot: '#cf1322', count: counts?.debtors },
    { key: 'creditors', label: 'الدائنين', dot: '#389e0d', count: counts?.creditors },
    { key: 'all', label: 'الكل', count: counts ? (showZero ? counts.all : counts.nonzero) : undefined },
  ];

  const shown = (v: unknown) => money(tab === 'creditors' ? Math.abs(n(v)) : n(v));
  const word = tab === 'creditors' ? 'دائن' : tab === 'all' ? 'صافي' : 'مديونية';
  const summaryRow = summary && (
    <>
      <ListStat label="عدد العملاء" value={summary.count.toLocaleString(numeralsLocale())} />
      <ListStat label={`${word} أبيض`} value={shown(summary.sum_white)} />
      <ListStat label={`${word} بولي`} value={shown(summary.sum_poly)} />
      {showOther && <ListStat label={`${word} أخرى`} value={shown(summary.sum_other)} />}
      <ListStat
        label={tab === 'creditors' ? 'إجمالي الدائن' : tab === 'all' ? 'صافي الأرصدة' : 'إجمالي المديونية'}
        value={shown(summary.sum_total)}
        tone="strong"
        hint={tab === 'all'
          ? `مدين ${money(summary.sum_debit)} · دائن ${money(summary.sum_credit)}`
          : filters.as_of ? `حتى ${filters.as_of}` : undefined}
      />
    </>
  );

  return (
    <>
      <ListPage<DebtTab>
        icon={<WalletOutlined />}
        title="مديونيات العملاء"
        tabs={tabs}
        activeTab={tab}
        onTabChange={changeTab}
        summary={summaryRow}
        actions={(<>
          <Button icon={<PrinterOutlined />} loading={printing} onClick={print}>طباعة</Button>
          {tableCols.control}
        </>)}
        filters={(<>
          <Input
            className="sl-f-search"
            allowClear
            value={search}
            placeholder="بحث بالاسم أو الكود أو الهاتف"
            prefix={<SearchOutlined />}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value && filters.q) setFilter('q', undefined);
            }}
            style={{ minWidth: 240 }}
            onPressEnter={applySearch}
            onBlur={applySearch}
          />
          <Select allowClear showSearch placeholder="المندوب" value={filters.rep_id}
            style={{ minWidth: 240 }} popupMatchSelectWidth={false}
            onChange={(v) => setFilter('rep_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={repOptions(reps, filters.rep_id)} />
          <Select allowClear showSearch placeholder="الفرع" value={filters.branch_id}
            onChange={(v) => setFilter('branch_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          <Select allowClear showSearch placeholder="المنطقة" value={filters.territory_id}
            onChange={(v) => setFilter('territory_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={territories.map((t) => ({ value: t.id, label: t.name }))} />
          <Select allowClear showSearch placeholder="المحافظة" value={filters.governorate_id}
            onChange={(v) => setFilter('governorate_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={governorates.map((g) => ({ value: g.id, label: g.name }))} />
          <Select allowClear placeholder="نوع العميل" value={filters.customer_type}
            onChange={(v) => setFilter('customer_type', v)}
            options={typeOptions.filter((o) => o.value !== 'owner')
              .map((o) => ({ value: o.value, label: o.label }))} />
          <Select allowClear placeholder="الحساب" value={filters.family}
            onChange={(v) => setFilter('family', v)}
            options={[
              { value: WHITE, label: 'عليه رصيد أبيض' },
              { value: POLY, label: 'عليه رصيد بولي' },
              { value: 'other', label: 'عليه رصيد آخر' },
            ]} />
          <InputNumber placeholder="الإجمالي من" value={minDraft as any}
            onChange={(v: any) => setMinDraft(v === null || v === '' ? null : Number(v))}
            onBlur={applyRange} onPressEnter={applyRange} style={{ width: '100%' }} />
          <InputNumber placeholder="الإجمالي إلى" value={maxDraft as any}
            onChange={(v: any) => setMaxDraft(v === null || v === '' ? null : Number(v))}
            onBlur={applyRange} onPressEnter={applyRange} style={{ width: '100%' }} />
          <Select allowClear placeholder="الحالة" value={filters.active}
            onChange={(v) => setFilter('active', v)}
            options={[{ value: true, label: 'نشط' }, { value: false, label: 'مخفي' }]} />
          <DatePicker placeholder="الرصيد حتى تاريخ" allowClear
            value={filters.as_of ? dayjs(filters.as_of) : null}
            onChange={(d: Dayjs | null) => setFilter('as_of', d ? d.format('YYYY-MM-DD') : undefined)} />
          {tab === 'all' && (
            <Checkbox checked={showZero} onChange={(e) => setShowZero(e.target.checked)}>
              إظهار الأرصدة الصفرية
            </Checkbox>
          )}
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={resetFilters}>مسح</Button>
        </>)}
      >
        <Table<DebtRow>
          className="sl-table"
          dataSource={rows}
          columns={tableCols.columns as any}
          rowKey="id"
          loading={loading}
          size="small"
          tableLayout="fixed"
          onChange={onTableChange as any}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            locale: { items_per_page: '' },
            showTotal: (t) => (
              <span className="sl-foot">
                <span>عدد العملاء: <b>{t.toLocaleString(numeralsLocale())}</b></span>
              </span>
            ),
          }}
          onRow={(r) => ({ onClick: () => setOpened(r), style: { cursor: 'pointer' } })}
        />
      </ListPage>

      <CustomerOpsDrawer
        row={opened}
        asOf={filters.as_of}
        onClose={() => setOpened(null)}
        onOpenStatement={(accountId, merged) => navigate(
          `/account-statement?account=${accountId}${merged ? '' : '&all=0'}`)}
        onOpenCard={(id) => navigate(`/customers/${id}`)}
      />
    </>
  );
}

interface StatementLine {
  entry_id: number;
  entry_date: string;
  entry_type: string;
  description: string;
  doc_statement?: string | null;
  doc_kind?: string | null;
  doc_id?: number | null;
  doc_number?: string | null;
  doc_family?: string | null;
  debit: string;
  credit: string;
  balance: string;
  rep_name?: string | null;
  cash_on_invoice?: boolean;
  _key?: string;
}

interface FamilyBalance { family: string | null; account_id: number; balance: string }

interface Statement {
  account_id: number | null;
  opening_balance: string;
  closing_balance: string;
  total_debit: string;
  total_credit: string;
  lines: StatementLine[];
  families: FamilyBalance[];
}

const DOC_KINDS = new Set<DocKind>(['invoice', 'return', 'purchase', 'purchase_return', 'transfer',
  'stock_permit', 'stock_count', 'production_order', 'voucher']);

function CustomerOpsDrawer({ row, asOf, onClose, onOpenStatement, onOpenCard }: {
  row: DebtRow | null;
  asOf?: string;
  onClose: () => void;
  onOpenStatement: (accountId: number, merged: boolean) => void;
  onOpenCard: (id: number) => void;
}) {
  const [family, setFamily] = useState<string>('');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [data, setData] = useState<Statement | null>(null);
  const [families, setFamilies] = useState<FamilyBalance[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!row) return;
    setFamily('');
    setFamilies([]);
    setData(null);
    setRange(asOf ? [dayjs('2000-01-01'), dayjs(asOf)] : null);
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const seq = useRef(0);
  useEffect(() => {
    if (!row) return;
    const my = ++seq.current;
    const params: Record<string, string> = {};
    if (family) params.family = family;
    if (range) {
      params.date_from = range[0].format('YYYY-MM-DD');
      params.date_to = range[1].format('YYYY-MM-DD');
    }
    setLoading(true);
    api.get(`/api/v1/customers/${row.id}/statement`, { params })
      .then((res) => {
        if (my !== seq.current) return;
        const d = res.data || {};
        setData({
          ...d,
          lines: (d.lines || []).map((l: any, i: number) => ({ ...l, _key: `${l.entry_id}-${i}` })),
        });
        if (d.families?.length) setFamilies(d.families);
      })
      .catch((err) => {
        if (my !== seq.current) return;
        message.error(err?.response?.data?.detail?.message || 'تعذر تحميل سجل العمليات');
        setData(null);
      })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [row?.id, family, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const named = families.filter((f) => f.family);
  const famAccount = family ? named.find((f) => f.family === family)?.account_id : undefined;
  const mainAccount = data?.account_id ?? families[0]?.account_id;

  const docKindFor = (l: StatementLine): DocKind | null => {
    if (l.doc_kind && DOC_KINDS.has(l.doc_kind as DocKind)) return l.doc_kind as DocKind;
    return docKindOf(l.doc_kind);
  };

  const columns = [
    { title: 'التاريخ', dataIndex: 'entry_date', width: 100,
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'النوع', dataIndex: 'entry_type', width: 120,
      filterValue: (l: StatementLine) => entryTypeLabel(l.entry_type),
      render: (t: string, l: StatementLine) => (
        <Tag>{l.cash_on_invoice ? 'مدفوع مع الفاتورة' : entryTypeLabel(t)}</Tag>
      ) },
    { title: 'الحساب', dataIndex: 'doc_family', width: 80,
      render: (v: string | null) => (v
        ? <Tag color={v === POLY ? 'orange' : v === WHITE ? 'geekblue' : 'default'}>{v}</Tag>
        : '-') },
    { title: 'المستند', dataIndex: 'doc_number', width: 140,
      render: (_: unknown, l: StatementLine) => {
        const kind = docKindFor(l);
        return kind && l.doc_id
          ? <DocRef kind={kind} id={l.doc_id} label={l.doc_number || '#'} />
          : <span style={{ color: '#8c8c8c' }}>{l.doc_number || 'قيد يدوي'}</span>;
      } },
    { title: 'البيان', dataIndex: 'description', ellipsis: true,
      render: (v: string, l: StatementLine) => (
        <Tooltip title={l.doc_statement || v}>{l.doc_statement || v || '-'}</Tooltip>
      ) },
    { title: 'مندوب', dataIndex: 'rep_name', width: 120, ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'مدين', dataIndex: 'debit', width: 115, align: 'left' as const,
      render: (v: string) => (n(v) ? money(v) : '-') },
    { title: 'دائن', dataIndex: 'credit', width: 115, align: 'left' as const,
      render: (v: string) => (n(v) ? money(v) : '-') },
    { title: 'الرصيد', dataIndex: 'balance', width: 125, align: 'left' as const,
      render: (v: string) => (
        <b style={{ color: n(v) > 0 ? '#cf1322' : n(v) < 0 ? '#389e0d' : undefined }}>{money(v)}</b>
      ) },
  ];

  const tile = (label: string, value: unknown, color?: string) => (
    <div style={{ padding: '6px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8 }}>
      <div style={{ fontSize: 14, color: '#8c8c8c' }}>{label}</div>
      <div style={{ fontWeight: 700, color }}>{money(value)}</div>
    </div>
  );

  return (
    <TabDrawer
      open={!!row}
      onClose={onClose}
      placement="right"
      width="min(1150px, 94vw)"
      destroyOnHidden
      title={row && (
        <Space size={8} wrap>
          <span>سجل عمليات: {row.name}</span>
          <Tag color="blue">{row.code}</Tag>
          {row.phone && <span style={{ color: '#8c8c8c', fontWeight: 400 }}>{row.phone}</span>}
        </Space>
      )}
      extra={row && (
        <Space>
          <Button icon={<FileTextOutlined />} disabled={!(famAccount ?? mainAccount)}
            onClick={() => onOpenStatement((famAccount ?? mainAccount)!, !famAccount)}>
            فتح كشف الحساب الكامل
          </Button>
          <Button icon={<IdcardOutlined />} onClick={() => onOpenCard(row.id)}>كارت العميل</Button>
        </Space>
      )}
    >
      {row && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={8} wrap>
            {tile('مديونية أبيض', row.balance_white)}
            {tile('مديونية بولي', row.balance_poly)}
            {n(row.balance_other) !== 0 && tile('أخرى', row.balance_other)}
            {tile(asOf ? `الإجمالي حتى ${asOf}` : 'الإجمالي', row.total,
              n(row.total) > 0 ? '#cf1322' : n(row.total) < 0 ? '#389e0d' : undefined)}
          </Space>

          <Space size={12} wrap>
            {named.length > 1 && (
              <Segmented
                value={family}
                onChange={(v) => setFamily(String(v))}
                options={[{ value: '', label: 'الكل' },
                  ...named.map((f) => ({ value: f.family as string, label: f.family as string }))]}
              />
            )}
            <DateRangeFilter value={range} onChange={setRange} />
          </Space>

          {loading && !data ? (
            <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
          ) : !data || (!data.lines.length && !n(data.opening_balance)) ? (
            <Empty description="لا توجد حركة على هذا العميل في هذه الفترة" />
          ) : (
            <>
              <Table<StatementLine>
                className="sl-table"
                dataSource={data.lines}
                columns={columns as any}
                rowKey={(l) => l._key || String(l.entry_id)}
                loading={loading}
                size="small"
                tableLayout="fixed"
                pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
              />
              <Space size={20} wrap style={{ fontSize: 15 }}>
                <span>رصيد أول المدة: <b>{money(data.opening_balance)}</b></span>
                <span>إجمالي مدين: <b>{money(data.total_debit)}</b></span>
                <span>إجمالي دائن: <b>{money(data.total_credit)}</b></span>
                <span>الرصيد الختامي:{' '}
                  <b style={{ color: n(data.closing_balance) > 0 ? '#cf1322' : n(data.closing_balance) < 0 ? '#389e0d' : undefined }}>
                    {money(data.closing_balance)}
                  </b>
                </span>
              </Space>
            </>
          )}
        </Space>
      )}
    </TabDrawer>
  );
}

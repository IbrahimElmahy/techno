import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, DatePicker, Select, Table, TreeSelect, message } from 'antd';
import { ClearOutlined, DatabaseOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableColumns } from '../components/ColumnSettings';
import { useLookup } from '../hooks/useLookup';
import { useCategoryTree, categorySelectOptions } from '../hooks/useCategoryTree';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { money, qty, numeralsLocale } from '../utils/money';
import { PAGE_SIZE } from '../utils/pagination';
import { printReport, type PrintColumn } from '../print/reportSheet';
import { STOCK_PRESETS, type StockDim, type StockPreset } from './stockAnalysisPresets';
import { STOCK_TOPICS, useLiveRefresh } from '../utils/live';

type Row = Record<string, any>;

const DIM_LABEL: Record<StockDim, string> = {
  item: 'الصنف', category: 'الفئة', main_category: 'الفئة الرئيسية', warehouse: 'المخزن',
  branch: 'الفرع', movement_type: 'نوع الحركة', day: 'اليوم', month: 'الشهر', year: 'السنة',
};

const TYPE_COLS: [string, string][] = [
  ['t_opening', 'رصيد أول المدة'], ['t_purchase', 'مشتريات'], ['t_purchase_return', 'مردود مشتريات'],
  ['t_sale', 'مبيعات'], ['t_sales_return', 'مردود مبيعات'], ['t_transfer_in', 'تحويل وارد'],
  ['t_transfer_out', 'تحويل صادر'], ['t_production_in', 'إنتاج'], ['t_consumption_out', 'صرف خامات'],
  ['t_permit_in', 'إذن إضافة'], ['t_permit_out', 'إذن صرف'],
];

export default function StockAnalysis() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const preset: StockPreset = STOCK_PRESETS.find((p) => p.key === params.get('preset')) || STOCK_PRESETS[0];
  const asof = preset.mode === 'asof';

  const [dims, setDims] = useState<StockDim[]>(preset.dims);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().startOf('month'), dayjs()]);
  const [until, setUntil] = useState<Dayjs>(dayjs());
  const [f, setF] = useState<Record<string, any>>({});
  const [includeCustody, setIncludeCustody] = useState(false);
  const [hideZero, setHideZero] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<Record<string, any[]>>({});
  const { options: categoryOptions } = useLookup('item_category');
  const { tree: categoryTree } = useCategoryTree();
  const categoryTreeOptions = useMemo(
    () => categorySelectOptions(categoryTree, categoryOptions), [categoryTree, categoryOptions]);

  useEffect(() => { setDims(preset.dims); }, [preset.key]);

  useEffect(() => {
    Promise.all([
      api.get('/api/v1/branches').catch(() => ({ data: [] })),
      api.get('/api/v1/warehouses').catch(() => ({ data: [] })),
      api.get('/api/v1/items').catch(() => ({ data: [] })),
    ]).then(([b, w, i]) => setLists({
      branches: sortByName(b.data || [], (x: any) => x.name),
      warehouses: sortByName(w.data || [], (x: any) => x.name),
      items: i.data || [],
    }));
  }, []);

  const seq = useRef(0);
  const load = async (opts?: { silent?: boolean }) => {
    const my = ++seq.current;
    if (!opts?.silent) setLoading(true);
    try {
      const p: Record<string, any> = { dims: dims.join(','), include_custody: includeCustody, hide_zero: hideZero };
      if (asof) p.date_to = until.format('YYYY-MM-DD');
      else {
        if (range?.[0]) p.date_from = range[0].format('YYYY-MM-DD');
        if (range?.[1]) p.date_to = range[1].format('YYYY-MM-DD');
      }
      Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p[k] = v; });
      const res = await api.get('/api/v1/reports/stock-analysis', { params: p });
      if (my !== seq.current) return;
      setRows(res.data.rows || []);
      setTotals(res.data.totals || null);
      setTruncated(!!res.data.truncated);
    } catch (err: any) {
      if (my === seq.current) message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
    } finally {
      if (my === seq.current && !opts?.silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dims.join(','), asof, until.valueOf(), range?.[0]?.valueOf(),
    range?.[1]?.valueOf(), JSON.stringify(f), includeCustody, hideZero]);
  useLiveRefresh(STOCK_TOPICS, () => load({ silent: true }));

  const q = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v) ? qty(v) : '');
  const hasItem = dims.includes('item');

  const columns: any[] = [
    ...(hasItem ? [{ title: 'الكود', dataIndex: 'code', key: 'code', width: 110 }] : []),
    ...dims.map((d) => ({
      title: DIM_LABEL[d], dataIndex: d, key: d,
      render: d === 'item' ? (v: string, r: Row) => <a onClick={() => navigate(`/item-card?item=${r.item_id}`)}>{v}</a> : undefined,
    })),
    ...(hasItem ? [
      ...(!dims.includes('category') ? [{ title: 'الفئة', dataIndex: 'category_name', key: 'category_name' }] : []),
      { title: 'الوحدة', dataIndex: 'unit', key: 'unit', width: 80 },
    ] : []),
    ...(!asof ? [{ title: 'رصيد أول الفترة', dataIndex: 'opening', key: 'opening', align: 'left' as const, render: q }] : []),
    ...(!asof ? [
      { title: 'إجمالي الوارد', dataIndex: 'in_qty', key: 'in_qty', align: 'left' as const, render: q },
      { title: 'إجمالي المنصرف', dataIndex: 'out_qty', key: 'out_qty', align: 'left' as const, render: q },
    ] : []),
    ...(!asof ? TYPE_COLS.map(([k, t]) => ({ title: t, dataIndex: k, key: k, align: 'left' as const, render: q })) : []),
    { title: asof ? 'الرصيد' : 'رصيد آخر الفترة', dataIndex: 'closing', key: 'closing', align: 'left' as const,
      render: (v: any) => <b style={{ color: Number(v) < 0 ? '#cf1322' : undefined }}>{qty(v)}</b> },
    ...(hasItem ? [
      { title: 'سعر الشراء الصافي', dataIndex: 'purchase_price', key: 'purchase_price', align: 'left' as const, total: false, render: (v: any) => money(v) },
      { title: 'سعر البيع', dataIndex: 'sale_price', key: 'sale_price', align: 'left' as const, total: false, render: (v: any) => money(v) },
      { title: 'الحد الأدنى', dataIndex: 'min_stock', key: 'min_stock', align: 'left' as const, total: false, render: q },
      { title: 'الحد الأقصى', dataIndex: 'max_stock', key: 'max_stock', align: 'left' as const, total: false, render: q },
    ] : []),
    { title: 'القيمة بسعر الشراء', dataIndex: 'closing_cost_value', key: 'closing_cost_value', align: 'left' as const, render: (v: any) => money(v) },
    { title: 'القيمة بسعر البيع', dataIndex: 'closing_sale_value', key: 'closing_sale_value', align: 'left' as const, render: (v: any) => money(v) },
    { title: 'عدد الحركات', dataIndex: 'moves', key: 'moves', align: 'left' as const },
  ];

  const focusHidden = preset.focus === 'out'
    ? ['in_qty', 't_opening', 't_purchase', 't_sales_return', 't_transfer_in', 't_production_in', 't_permit_in', 'opening', 'closing', 'closing_cost_value', 'closing_sale_value']
    : preset.focus === 'in'
      ? ['out_qty', 't_purchase_return', 't_sale', 't_transfer_out', 't_consumption_out', 't_permit_out', 'opening', 'closing', 'closing_cost_value', 'closing_sale_value']
      : [];
  const cols = useTableColumns(`stock-analysis-${preset.mode}-${preset.focus || 'all'}`, columns, {
    defaultHidden: [...focusHidden, 'min_stock', 'max_stock', 'moves', 't_opening'],
    export: { name: preset.label, rows },
  });

  const setPreset = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('preset', key);
    setParams(next, { replace: true });
  };

  const groups = useMemo(() => {
    const g: Record<string, StockPreset[]> = {};
    STOCK_PRESETS.forEach((p) => { (g[p.group] = g[p.group] || []).push(p); });
    return Object.entries(g).map(([label, list]) => ({ label, options: list.map((p) => ({ value: p.key, label: p.label })) }));
  }, []);

  const print = () => {
    const visible = (cols.columns as any[]).filter((c) => c.dataIndex);
    const numeric = new Set(['opening', 'in_qty', 'out_qty', 'closing', ...TYPE_COLS.map(([k]) => k)]);
    const pc: PrintColumn<Row>[] = visible.map((c: any) => ({
      title: String(c.title), numeric: c.align === 'left',
      value: (r: Row) => (numeric.has(c.dataIndex) ? q(r[c.dataIndex])
        : ['closing_cost_value', 'closing_sale_value', 'purchase_price', 'sale_price'].includes(c.dataIndex)
          ? money(r[c.dataIndex]) : r[c.dataIndex] ?? ''),
    }));
    const meta: [string, string][] = [asof ? ['حتى تاريخ', until.format('YYYY-MM-DD')]
      : ['الفترة', range ? `${range[0].format('YYYY-MM-DD')} — ${range[1].format('YYYY-MM-DD')}` : 'كل الفترات']];
    printReport({ title: preset.label, meta }, pc, rows, totals ? [
      { label: 'القيمة بسعر الشراء', value: money(totals.closing_cost_value) },
      { label: 'القيمة بسعر البيع', value: money(totals.closing_sale_value) },
    ] : []);
  };

  const setFilter = (k: string, v: any) => setF((prev) => ({ ...prev, [k]: v }));

  return (
    <ListPage
      icon={<DatabaseOutlined />}
      title="تقارير المخازن"
      muted={preset.label}
      actions={(<>
        {cols.control}
        <Button icon={<PrinterOutlined />} onClick={print}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Select showSearch style={{ minWidth: 240 }} value={preset.key} onChange={setPreset}
          options={groups} filterOption={searchFilter} popupMatchSelectWidth={false} />
        {asof
          ? <DatePicker value={until} onChange={(d) => d && setUntil(d)} allowClear={false} placeholder="حتى تاريخ" />
          : <DateRangeFilter value={range as any} onChange={(v: any) => setRange(v)} />}
        <Select mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 220 }}
          placeholder="التجميع حسب" value={dims} onChange={(v) => setDims(v as StockDim[])}
          options={(Object.keys(DIM_LABEL) as StockDim[]).map((d) => ({ value: d, label: DIM_LABEL[d] }))} />
        <Select allowClear showSearch placeholder="الفرع" value={f.branch_id} style={{ minWidth: 130 }}
          onChange={(v) => setFilter('branch_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.branches || []).map((b) => ({ value: b.id, label: b.name }))} />
        <Select allowClear showSearch placeholder="المخزن" value={f.warehouse_id} style={{ minWidth: 160 }}
          onChange={(v) => setFilter('warehouse_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.warehouses || []).map((w) => ({ value: w.id, label: w.name }))} />
        <TreeSelect allowClear showSearch placeholder="الفئة" value={f.category} style={{ minWidth: 170 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('category', v)}
          treeData={categoryTreeOptions as any} treeNodeFilterProp="label" />
        <Select allowClear showSearch placeholder="الصنف" value={f.item_id} style={{ minWidth: 200 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('item_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={(lists.items || []).map((i: any) => ({ value: i.id, label: `${i.name} — ${i.code}` }))} />
        <Checkbox checked={includeCustody} onChange={(e) => setIncludeCustody(e.target.checked)}>عهد المناديب</Checkbox>
        <Checkbox checked={hideZero} onChange={(e) => setHideZero(e.target.checked)}>إخفاء الصفري</Checkbox>
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { setF({}); setDims(preset.dims); setUntil(dayjs()); setRange([dayjs().startOf('month'), dayjs()]); }}>مسح</Button>
      </>)}
      summary={totals && (<>
        {!asof && <ListStat label="إجمالي الوارد" value={qty(totals.in_qty)} tone="pos" />}
        {!asof && <ListStat label="إجمالي المنصرف" value={qty(totals.out_qty)} tone="neg" />}
        <ListStat label={asof ? 'إجمالي الرصيد' : 'رصيد آخر الفترة'} value={qty(totals.closing)} />
        <ListStat label="القيمة بسعر الشراء" value={money(totals.closing_cost_value)} tone="strong" />
        <ListStat label="القيمة بسعر البيع" value={money(totals.closing_sale_value)} />
        <ListStat label="عدد السطور" value={rows.length.toLocaleString(numeralsLocale())} />
      </>)}
    >
      {truncated && <Alert type="warning" showIcon style={{ marginBottom: 8 }}
        message="النتيجة كبيرة جداً وتم عرض أول ٢٠٬٠٠٠ سطر — ضيّق الفترة أو الفلاتر" />}
      <Table<Row>
        className="sl-table" size="small" loading={loading}
        rowKey={(r: Row) => dims.map((d) => String(r[`${d}_id`] ?? '')).join('|') || 'all'}
        dataSource={rows} columns={cols.columns as any}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </ListPage>
  );
}

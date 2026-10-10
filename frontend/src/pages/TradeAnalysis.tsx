import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Segmented, Select, Table, TreeSelect, message } from 'antd';
import { BarChartOutlined, ClearOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableColumns } from '../components/ColumnSettings';
import { useOpenDocument, type DocKind } from '../components/DocumentLink';
import { useLookup } from '../hooks/useLookup';
import { useCategoryTree, categorySelectOptions } from '../hooks/useCategoryTree';
import { MULTI, categorySet, filterParams, picked, territorySet, usePrune } from '../utils/reportFilters';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { money, qty, numeralsLocale } from '../utils/money';
import { repOptions } from '../utils/reps';
import { PAGE_SIZE } from '../utils/pagination';
import { printReport, type PrintColumn } from '../print/reportSheet';

import { SALES_PRESETS, PURCHASE_PRESETS, type Preset, type Dim, type Period, type Layout } from './tradeAnalysisPresets';

type Side = 'sales' | 'purchases';

const PERIODS: Period[] = ['day', 'month', 'year'];

const DIM_LABEL = (side: Side): Record<Dim, string> => ({
  document: side === 'sales' ? 'الفاتورة' : 'فاتورة الشراء',
  day: 'اليوم', month: 'الشهر', year: 'السنة',
  party: side === 'sales' ? 'العميل' : 'المورد',
  party_type: side === 'sales' ? 'نوع العميل' : 'نوع المورد',
  rep: 'المندوب', territory: 'المنطقة', main_territory: 'المنطقة الرئيسية',
  governorate: 'المحافظة', markaz: 'المدينة', branch: 'الفرع', warehouse: 'المخزن',
  item: 'الصنف', category: 'الفئة', main_category: 'الفئة الرئيسية',
  price_tier: 'شريحة السعر', kind: 'نوع الحركة',
});

const SIDE_DIMS: Record<Side, Dim[]> = {
  sales: ['document', 'party', 'party_type', 'rep', 'territory', 'main_territory', 'governorate',
    'markaz', 'branch', 'warehouse', 'item', 'category', 'main_category', 'price_tier', 'kind'],
  purchases: ['document', 'party', 'party_type', 'rep', 'governorate', 'branch', 'warehouse',
    'item', 'category', 'main_category', 'kind'],
};

interface Row { [k: string]: any }

const MEASURES = (side: Side) => {
  const sales = side === 'sales';
  return [
    { key: 'sold_qty', title: sales ? 'الكمية المباعة' : 'الكمية المشتراة', kind: 'qty' },
    { key: 'returned_qty', title: 'الكمية المرتجعة', kind: 'qty' },
    { key: 'qty', title: 'صافي الكمية', kind: 'qty' },
    { key: 'gross', title: 'الإجمالي قبل الخصم', kind: 'money' },
    { key: 'discount', title: 'الخصم', kind: 'money' },
    { key: 'discount_pct', title: 'الخصم ٪', kind: 'pct' },
    { key: 'sales_value', title: sales ? 'المبيعات' : 'المشتريات', kind: 'money' },
    { key: 'returns_value', title: 'المرتجعات', kind: 'money' },
    { key: 'returns_pct', title: 'نسبة المرتجع ٪', kind: 'pct' },
    { key: 'net_value', title: 'الصافي', kind: 'money', strong: true },
    { key: 'avg_price', title: 'متوسط السعر', kind: 'money' },
    ...(sales ? [
      { key: 'cost', title: 'التكلفة', kind: 'money' },
      { key: 'profit', title: 'الربح', kind: 'money', strong: true },
      { key: 'margin_pct', title: 'هامش الربح ٪', kind: 'pct' },
      { key: 'missing_cost', title: 'سطور بلا تكلفة', kind: 'int' },
    ] : []),
    { key: 'docs', title: 'عدد الفواتير', kind: 'int' },
    { key: 'return_docs', title: 'عدد المرتجعات', kind: 'int' },
    { key: 'parties', title: sales ? 'عدد العملاء' : 'عدد الموردين', kind: 'int' },
    { key: 'items', title: 'عدد الأصناف', kind: 'int' },
  ] as { key: string; title: string; kind: 'qty' | 'money' | 'pct' | 'int'; strong?: boolean }[];
};

const fmt = (kind: string, v: any) => {
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'qty') return qty(v);
  if (kind === 'money') return money(v);
  if (kind === 'pct') return Number(v) ? `${Number(v).toLocaleString(numeralsLocale())}٪` : '';
  return Number(v).toLocaleString(numeralsLocale());
};

const DOC_OF: Record<Side, Record<string, DocKind>> = {
  sales: { 'بيع': 'invoice', 'مردود': 'return' },
  purchases: { 'بيع': 'purchase', 'مردود': 'purchase_return' },
};

export default function TradeAnalysis({ side: fixedSide }: { side?: Side }) {
  const [params, setParams] = useSearchParams();
  const side: Side = fixedSide ?? (params.get('side') === 'purchases' ? 'purchases' : 'sales');
  const presets = side === 'sales' ? SALES_PRESETS : PURCHASE_PRESETS;
  const presetKey = params.get('preset') || presets[0].key;
  const preset = presets.find((p) => p.key === presetKey) || presets[0];
  const dimLabel = DIM_LABEL(side);
  const openDoc = useOpenDocument();

  const [dims, setDims] = useState<Dim[]>(preset.dims);
  const [period, setPeriod] = useState<Period>(preset.period || 'none');
  const [layout, setLayout] = useState<Layout>(preset.layout || 'table');
  const [pivotMeasure, setPivotMeasure] = useState('net_value');
  const [kind, setKind] = useState<string>(preset.kind || 'net');
  const rangeFor = (pr: Preset): [Dayjs, Dayjs] =>
    [pr.period === 'month' || pr.period === 'year' ? dayjs().startOf('year') : dayjs().startOf('month'), dayjs()];
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(() => rangeFor(preset));
  const [f, setF] = useState<Record<string, any>>({});
  const [includeBonus, setIncludeBonus] = useState(true);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);

  const [lists, setLists] = useState<Record<string, any[]>>({});
  const { options: categoryOptions } = useLookup('item_category');
  const { tree: categoryTree } = useCategoryTree();
  const categoryTreeOptions = useMemo(
    () => categorySelectOptions(categoryTree, categoryOptions), [categoryTree, categoryOptions]);
  const { options: typeOptions } = useLookup('customer_type');

  useEffect(() => {
    setDims(preset.dims);
    setPeriod(preset.period || 'none');
    setLayout(preset.layout || 'table');
    setKind(preset.kind || 'net');
    setRange(rangeFor(preset));
  }, [preset.key, side]);

  useEffect(() => {
    const byName = (r: any) => r.full_name || r.name;
    Promise.all([
      api.get('/api/v1/users').catch(() => ({ data: [] })),
      api.get('/api/v1/territories').catch(() => ({ data: [] })),
      api.get('/api/v1/governorates').catch(() => ({ data: [] })),
      api.get('/api/v1/branches').catch(() => ({ data: [] })),
      api.get('/api/v1/warehouses').catch(() => ({ data: [] })),
      api.get('/api/v1/items').catch(() => ({ data: [] })),
      side === 'sales'
        ? api.get('/api/v1/customers/options', { params: { limit: 20000 } }).catch(() => ({ data: [] }))
        : api.get('/api/v1/suppliers').catch(() => ({ data: [] })),
    ]).then(([u, t, g, b, w, i, p]) => {
      const list = (x: any) => (Array.isArray(x.data) ? x.data : x.data?.rows || []);
      setLists({
        reps: sortByName(list(u).filter((x: any) => ['sales_rep', 'rep_supervisor', 'sales_manager'].includes(x.role) || x.role === 'sales_rep'), byName),
        territories: sortByName(list(t), byName), governorates: sortByName(list(g), byName),
        branches: sortByName(list(b), byName), warehouses: sortByName(list(w), byName),
        items: list(i), parties: list(p),
      });
    });
  }, [side]);

  const effectiveDims = useMemo(
    () => [...dims, ...(period !== 'none' ? [period as Dim] : [])], [dims, period]);

  const seq = useRef(0);
  const load = async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const p: Record<string, any> = { side, dims: effectiveDims.join(','), include_bonus: includeBonus };
      if (range?.[0]) p.date_from = range[0].format('YYYY-MM-DD');
      if (range?.[1]) p.date_to = range[1].format('YYYY-MM-DD');
      if (kind !== 'net') p.kind = kind;
      Object.assign(p, filterParams(f));
      const res = await api.get('/api/v1/reports/analysis', { params: p });
      if (my !== seq.current) return;
      setRows(res.data.rows || []);
      setTotals(res.data.totals || null);
      setTruncated(!!res.data.truncated);
    } catch (err: any) {
      if (my === seq.current) message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [side, effectiveDims.join(','), kind, includeBonus,
    range?.[0]?.valueOf(), range?.[1]?.valueOf(), JSON.stringify(f)]);

  const measures = MEASURES(side);
  const periodDim = effectiveDims.find((d) => PERIODS.includes(d as Period));
  const pivot = layout === 'pivot' && !!periodDim;

  const dimColumns = (list: Dim[]): any[] => list.flatMap((d): any[] => {
    if (d === 'document') {
      return [
        { title: dimLabel.document, dataIndex: 'document', key: 'document', width: 130,
          render: (v: string, r: Row) => (
            <a onClick={() => openDoc(DOC_OF[side][r.document_kind] || (side === 'sales' ? 'invoice' : 'purchase'), r.document_id)}>{v}</a>) },
        { title: 'التاريخ', dataIndex: 'document_date', key: 'document_date', width: 110 },
        { title: 'النوع', dataIndex: 'document_kind', key: 'document_kind', width: 80 },
        ...(!list.includes('party') ? [{ title: dimLabel.party, dataIndex: 'document_party', key: 'document_party' }] : []),
        ...(!list.includes('rep') ? [{ title: 'المندوب', dataIndex: 'document_rep', key: 'document_rep' }] : []),
      ];
    }
    return [{ title: dimLabel[d], dataIndex: d, key: d,
      width: PERIODS.includes(d as Period) ? 110 : undefined }];
  });

  const measureColumns = measures.map((m) => ({
    title: m.title, dataIndex: m.key, key: m.key, align: 'left' as const,
    total: m.kind === 'money' || m.kind === 'qty' || m.kind === 'int' ? undefined : false,
    render: (v: any) => {
      const t = fmt(m.kind, v);
      if (m.key === 'profit' && Number(v) < 0) return <b style={{ color: '#cf1322' }}>{t}</b>;
      return m.strong ? <b>{t}</b> : t;
    },
  }));

  const { pivotRows, pivotCols } = useMemo(() => {
    if (!pivot || !periodDim) return { pivotRows: [] as Row[], pivotCols: [] as string[] };
    const keyDims = effectiveDims.filter((d) => d !== periodDim);
    const map = new Map<string, Row>();
    const cols = new Set<string>();
    rows.forEach((r) => {
      const k = keyDims.map((d) => String(r[`${d}_id`] ?? '')).join('|');
      const p = String(r[periodDim]);
      cols.add(p);
      let cur = map.get(k);
      if (!cur) {
        cur = { __key: k, __total: 0 };
        keyDims.forEach((d) => { cur![d] = r[d]; cur![`${d}_id`] = r[`${d}_id`]; });
        map.set(k, cur);
      }
      cur[`p:${p}`] = Number(cur[`p:${p}`] || 0) + Number(r[pivotMeasure] || 0);
      cur.__total += Number(r[pivotMeasure] || 0);
    });
    return { pivotRows: [...map.values()].sort((a, b) => b.__total - a.__total), pivotCols: [...cols].sort() };
  }, [pivot, rows, pivotMeasure, effectiveDims.join(',')]);

  const pmeasure = measures.find((m) => m.key === pivotMeasure) || measures[0];
  const tableColumns = pivot
    ? [
      ...dimColumns(effectiveDims.filter((d) => d !== periodDim)),
      ...pivotCols.map((p) => ({ title: p, dataIndex: `p:${p}`, key: `p:${p}`, align: 'left' as const,
        render: (v: any) => fmt(pmeasure.kind, v) })),
      { title: 'الإجمالي', dataIndex: '__total', key: '__total', align: 'left' as const,
        render: (v: any) => <b>{fmt(pmeasure.kind, v)}</b> },
    ]
    : [...dimColumns(effectiveDims), ...measureColumns];

  const defaultHidden = ['gross', 'discount_pct', 'returns_pct', 'avg_price', 'return_docs', 'items',
    'missing_cost', ...(side === 'sales' ? [] : ['parties'])];
  const title = preset.label;
  const cols = useTableColumns(`analysis-${side}-${pivot ? 'pivot' : 'table'}`, tableColumns as any, {
    defaultHidden: pivot ? [] : defaultHidden,
    export: { name: title, rows: pivot ? pivotRows : rows },
  });

  const setPreset = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('preset', key);
    setParams(next, { replace: true });
  };

  const print = () => {
    const visible = (cols.columns as any[]).filter((c) => c.dataIndex);
    const pc: PrintColumn<Row>[] = visible.map((c: any) => ({
      title: String(c.title), numeric: c.align === 'left',
      value: (r: Row) => {
        const m = measures.find((x) => x.key === c.dataIndex);
        if (m) return fmt(m.kind, r[c.dataIndex]);
        if (String(c.dataIndex).startsWith('p:') || c.dataIndex === '__total') return fmt(pmeasure.kind, r[c.dataIndex]);
        return r[c.dataIndex] ?? '';
      },
    }));
    const meta: [string, string][] = [
      ['الفترة', range ? `${range[0].format('YYYY-MM-DD')} — ${range[1].format('YYYY-MM-DD')}` : 'كل الفترات'],
    ];
    printReport({ title, meta }, pc, pivot ? pivotRows : rows, totals ? [
      { label: 'الصافي', value: money(totals.net_value) },
      ...(side === 'sales' ? [{ label: 'الربح', value: money(totals.profit) }] : []),
    ] : []);
  };

  const groups = useMemo(() => {
    const g: Record<string, Preset[]> = {};
    presets.forEach((p) => { (g[p.group] = g[p.group] || []).push(p); });
    return Object.entries(g).map(([label, list]) => ({
      label, options: list.map((p) => ({ value: p.key, label: p.label })) }));
  }, [presets]);

  const dimOptions = SIDE_DIMS[side].map((d) => ({ value: d, label: dimLabel[d] }));
  const setFilter = (k: string, v: any) => setF((prev) => ({ ...prev, [k]: v }));

  const warehouseList = useMemo(() => {
    const br = picked(f, 'branch_id');
    const all = lists.warehouses || [];
    return br.length ? all.filter((w: any) => br.includes(w.branch_id)) : all;
  }, [lists.warehouses, JSON.stringify(f.branch_id)]);
  const itemList = useMemo(() => {
    const cats = picked(f, 'category');
    const all = lists.items || [];
    if (!cats.length) return all;
    const set = categorySet(categoryTree, cats);
    return all.filter((i: any) => set.has(i.category));
  }, [lists.items, categoryTree, JSON.stringify(f.category)]);
  const partyList = useMemo(() => {
    let all = lists.parties || [];
    const ter = picked(f, 'territory_id');
    const gov = picked(f, 'governorate_id');
    const rep = picked(f, 'rep_id');
    const typ = picked(f, 'party_type');
    if (ter.length) {
      const set = territorySet(lists.territories || [], ter);
      all = all.filter((p: any) => set.has(p.territory_id));
    }
    if (gov.length) all = all.filter((p: any) => gov.includes(p.governorate_id));
    if (rep.length && side === 'sales') all = all.filter((p: any) => rep.includes(p.rep_id));
    if (typ.length) all = all.filter((p: any) => typ.includes(side === 'sales' ? p.customer_type : p.supplier_type));
    return all;
  }, [lists.parties, lists.territories, side, JSON.stringify([f.territory_id, f.governorate_id, f.rep_id, f.party_type])]);
  usePrune(f, setF, 'warehouse_id', warehouseList);
  usePrune(f, setF, 'item_id', itemList);
  usePrune(f, setF, 'party_id', partyList);
  const partyLabel = (p: any) => `${p.name}${p.code ? ` — ${p.code}` : ''}`;

  return (
    <ListPage
      icon={<BarChartOutlined />}
      title={side === 'sales' ? 'تقارير المبيعات' : 'تقارير المشتريات'}
      muted={title}
      actions={(<>
        {cols.control}
        <Button icon={<PrinterOutlined />} onClick={print}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Select showSearch style={{ minWidth: 260 }} value={preset.key} onChange={setPreset}
          options={groups} filterOption={searchFilter} popupMatchSelectWidth={false} />
        <DateRangeFilter value={range as any} onChange={(v: any) => setRange(v)} />
        <Select mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 220 }}
          placeholder="التجميع حسب" value={dims} onChange={(v) => setDims(v as Dim[])}
          options={dimOptions} />
        <Select style={{ width: 120 }} value={period} onChange={(v) => setPeriod(v)}
          options={[{ value: 'none', label: 'بدون فترة' }, { value: 'day', label: 'باليوم' },
            { value: 'month', label: 'بالشهر' }, { value: 'year', label: 'بالسنة' }]} />
        {period !== 'none' && (
          <Segmented value={layout} onChange={(v) => setLayout(v as Layout)}
            options={[{ value: 'table', label: 'جدول' }, { value: 'pivot', label: 'مقارنة' }]} />
        )}
        {pivot && (
          <Select style={{ width: 150 }} value={pivotMeasure} onChange={setPivotMeasure}
            options={measures.filter((m) => m.kind !== 'pct').map((m) => ({ value: m.key, label: m.title }))} />
        )}
        <Select style={{ width: 120 }} value={kind} onChange={setKind}
          options={[{ value: 'net', label: 'الصافي' }, { value: 'sale', label: side === 'sales' ? 'البيع فقط' : 'الشراء فقط' },
            { value: 'return', label: 'المرتجع فقط' }]} />
        <Select {...MULTI} showSearch placeholder="الفرع" value={picked(f, 'branch_id')} style={{ minWidth: 150 }}
          onChange={(v) => setFilter('branch_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.branches || []).map((b) => ({ value: b.id, label: b.name }))} />
        <Select {...MULTI} showSearch placeholder="المخزن" value={picked(f, 'warehouse_id')} style={{ minWidth: 170 }}
          onChange={(v) => setFilter('warehouse_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={warehouseList.map((w: any) => ({ value: w.id, label: w.name }))} />
        {side === 'sales' && (
          <Select {...MULTI} placeholder="نوع العميل" value={picked(f, 'party_type')} style={{ minWidth: 150 }}
            onChange={(v) => setFilter('party_type', v)}
            options={typeOptions.filter((o) => o.value !== 'owner').map((o) => ({ value: o.value, label: o.label }))} />
        )}
        <Select {...MULTI} showSearch placeholder="المندوب" value={picked(f, 'rep_id')} style={{ minWidth: 180 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('rep_id', v)}
          filterOption={searchFilter} filterSort={searchRank} options={repOptions(lists.reps || [])} />
        {side === 'sales' && (
          <Select {...MULTI} showSearch placeholder="المنطقة" value={picked(f, 'territory_id')} style={{ minWidth: 160 }}
            onChange={(v) => setFilter('territory_id', v)} filterOption={searchFilter} filterSort={searchRank}
            options={(lists.territories || []).map((t) => ({ value: t.id, label: t.name }))} />
        )}
        <Select {...MULTI} showSearch placeholder="المحافظة" value={picked(f, 'governorate_id')} style={{ minWidth: 160 }}
          onChange={(v) => setFilter('governorate_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.governorates || []).map((g) => ({ value: g.id, label: g.name }))} />
        <Select {...MULTI} showSearch placeholder={dimLabel.party} value={picked(f, 'party_id')} style={{ minWidth: 220 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('party_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={partyList.map((p: any) => ({ value: p.id, label: partyLabel(p) }))} />
        <TreeSelect multiple allowClear showSearch maxTagCount="responsive" placeholder="الفئة" value={picked(f, 'category')}
          style={{ minWidth: 180 }} popupMatchSelectWidth={false} onChange={(v) => setFilter('category', v)}
          treeData={categoryTreeOptions as any} treeNodeFilterProp="label" />
        <Select {...MULTI} showSearch placeholder="الصنف" value={picked(f, 'item_id')} style={{ minWidth: 220 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('item_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={itemList.map((i: any) => ({ value: i.id, label: `${i.name} — ${i.code}` }))} />
        {side === 'sales' && (
          <Select {...MULTI} placeholder="شريحة السعر" value={picked(f, 'price_tier')} style={{ minWidth: 150 }}
            onChange={(v) => setFilter('price_tier', v)}
            options={[['commercial', 'تجاري'], ['semi_commercial', 'نصف تجاري'], ['wholesale', 'جملة'],
              ['semi_wholesale', 'نصف جملة'], ['consumer', 'مستهلك']].map(([value, label]) => ({ value, label }))} />
        )}
        {side === 'sales' && (
          <Checkbox checked={includeBonus} onChange={(e) => setIncludeBonus(e.target.checked)}>فواتير البونص</Checkbox>
        )}
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { setF({}); setRange(rangeFor(preset)); setDims(preset.dims);
            setPeriod(preset.period || 'none'); setKind(preset.kind || 'net'); }}>مسح</Button>
      </>)}
      summary={totals && (<>
        <ListStat label={side === 'sales' ? 'المبيعات' : 'المشتريات'} value={money(totals.sales_value)} />
        <ListStat label="المرتجعات" value={money(totals.returns_value)} tone="warn" />
        <ListStat label="الصافي" value={money(totals.net_value)} tone="strong" />
        {side === 'sales' && <ListStat label="التكلفة" value={money(totals.cost)} />}
        {side === 'sales' && (
          <ListStat label="الربح" value={money(totals.profit)} tone={Number(totals.profit) < 0 ? 'neg' : 'pos'}
            hint={`هامش ${Number(totals.margin_pct || 0).toLocaleString(numeralsLocale())}٪`} />
        )}
        <ListStat label="عدد الفواتير" value={Number(totals.docs || 0).toLocaleString(numeralsLocale())} />
        <ListStat label="صافي الكمية" value={qty(totals.qty)} />
      </>)}
    >
      {truncated && <Alert type="warning" showIcon style={{ marginBottom: 8 }}
        message="النتيجة كبيرة جداً وتم عرض أول ٢٠٬٠٠٠ سطر — ضيّق الفترة أو الفلاتر" />}
      {side === 'sales' && totals && Number(totals.missing_cost) > 0 && (
        <Alert type="info" showIcon style={{ marginBottom: 8 }}
          message={`${Number(totals.missing_cost).toLocaleString(numeralsLocale())} سطر بلا تكلفة مسجلة — مستبعدة من حساب الربح والهامش`} />
      )}
      <Table<Row>
        className="sl-table" size="small" loading={loading}
        rowKey={(r: Row) => (pivot ? r.__key : effectiveDims.map((d) => String(r[`${d}_id`] ?? r[d] ?? '')).join('|') || 'all')}
        dataSource={pivot ? pivotRows : rows} columns={cols.columns as any}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </ListPage>
  );
}

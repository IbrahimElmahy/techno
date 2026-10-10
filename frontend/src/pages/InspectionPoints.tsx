import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Select, Table, message } from 'antd';
import { ClearOutlined, PrinterOutlined, ReloadOutlined, TrophyOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableColumns } from '../components/ColumnSettings';
import { MULTI, filterParams, picked, usePrune } from '../utils/reportFilters';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { qty, numeralsLocale } from '../utils/money';
import { isStopped } from '../utils/reps';
import { PAGE_SIZE } from '../utils/pagination';
import { printReport, type PrintColumn } from '../print/reportSheet';
import {
  INSPECTION_POINTS_PRESETS, type InspectionDim, type InspectionPeriod, type InspectionPreset,
} from './inspectionPointsPresets';

const PERIODS: InspectionPeriod[] = ['day', 'month'];

const DIM_LABEL: Record<InspectionDim, string> = {
  document: 'الزيارة', item: 'الصنف', technician: 'الفني', merchant: 'التاجر', rep: 'المندوب',
  visit_kind: 'نوع الزيارة', month: 'الشهر', day: 'اليوم', governorate: 'المحافظة',
  markaz: 'المركز', branch: 'الفرع',
};

const GROUP_DIMS: InspectionDim[] = ['document', 'item', 'technician', 'merchant', 'rep',
  'visit_kind', 'governorate', 'markaz', 'branch'];

interface Row { [k: string]: any }

const MEASURES: { key: string; title: string; kind: 'qty' | 'int'; strong?: boolean }[] = [
  { key: 'qty', title: 'الكمية', kind: 'qty' },
  { key: 'points', title: 'النقاط', kind: 'qty', strong: true },
  { key: 'visits', title: 'عدد الزيارات', kind: 'int' },
  { key: 'technicians', title: 'عدد الفنيين', kind: 'int' },
  { key: 'items', title: 'عدد الأصناف', kind: 'int' },
];

const fmt = (kind: string, v: any) => {
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'qty') return qty(v);
  return Number(v).toLocaleString(numeralsLocale());
};

const REP_ROLES = ['sales_rep', 'rep_supervisor', 'sales_manager'];

export default function InspectionPoints() {
  const [params, setParams] = useSearchParams();
  const presetKey = params.get('preset') || INSPECTION_POINTS_PRESETS[0].key;
  const preset = INSPECTION_POINTS_PRESETS.find((p) => p.key === presetKey) || INSPECTION_POINTS_PRESETS[0];

  const rangeFor = (pr: InspectionPreset): [Dayjs, Dayjs] =>
    [pr.dims.includes('document') ? dayjs().startOf('month') : dayjs().startOf('year'), dayjs()];

  const [dims, setDims] = useState<InspectionDim[]>(preset.dims);
  const [period, setPeriod] = useState<InspectionPeriod>(preset.period || 'none');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(() => rangeFor(preset));
  const [f, setF] = useState<Record<string, any>>({});

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<Record<string, any[]>>({});

  useEffect(() => {
    setDims(preset.dims);
    setPeriod(preset.period || 'none');
    setRange(rangeFor(preset));
  }, [preset.key]);

  useEffect(() => {
    const byName = (r: any) => r.full_name || r.username || r.name || '';
    Promise.all([
      api.get('/api/v1/users').catch(() => ({ data: [] })),
      api.get('/api/v1/governorates').catch(() => ({ data: [] })),
      api.get('/api/v1/branches').catch(() => ({ data: [] })),
      api.get('/api/v1/inspections/item-types', { params: { include_inactive: true } }).catch(() => ({ data: [] })),
      api.get('/api/v1/customers/options', { params: { limit: 20000 } }).catch(() => ({ data: [] })),
    ]).then(([u, g, b, it, c]) => {
      const list = (x: any) => (Array.isArray(x.data) ? x.data : x.data?.rows || []);
      const customers = list(c);
      setLists({
        reps: sortByName(list(u).filter((x: any) => REP_ROLES.includes(x.role)), byName),
        governorates: sortByName(list(g), byName),
        branches: sortByName(list(b), byName),
        items: sortByName(list(it), byName),
        technicians: sortByName(customers.filter((x: any) => x.customer_type === 'plumber'), byName),
        merchants: sortByName(customers.filter((x: any) => !['plumber', 'employee'].includes(x.customer_type)), byName),
      });
    });
  }, []);

  const effectiveDims = useMemo(
    () => [...dims, ...(period !== 'none' ? [period as InspectionDim] : [])], [dims, period]);

  const seq = useRef(0);
  const load = async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const p: Record<string, any> = { dims: effectiveDims.join(',') };
      if (range?.[0]) p.date_from = range[0].format('YYYY-MM-DD');
      if (range?.[1]) p.date_to = range[1].format('YYYY-MM-DD');
      Object.assign(p, filterParams({ ...f, item: undefined }));
      if (picked(f, 'item').length) p.item = picked(f, 'item').join('|');
      const res = await api.get('/api/v1/after-sales-reports/inspection-points', { params: p });
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

  useEffect(() => { load(); }, [effectiveDims.join(','), range?.[0]?.valueOf(), range?.[1]?.valueOf(),
    JSON.stringify(f)]);

  const dimColumns = (list: InspectionDim[]): any[] => list.flatMap((d): any[] => {
    if (d === 'document') {
      return [
        { title: 'رقم الزيارة', dataIndex: 'document', key: 'document', width: 120 },
        { title: 'التاريخ', dataIndex: 'document_date', key: 'document_date', width: 110 },
        { title: 'نوع الزيارة', dataIndex: 'document_kind', key: 'document_kind', width: 110 },
        { title: 'نوع المعاينة', dataIndex: 'document_type', key: 'document_type' },
        { title: 'المالك', dataIndex: 'document_owner', key: 'document_owner' },
        ...(!list.includes('technician') ? [
          { title: 'الفني', dataIndex: 'technician', key: 'technician' },
          { title: 'هاتف الفني', dataIndex: 'technician_phone', key: 'technician_phone', width: 130 },
        ] : []),
        ...(!list.includes('merchant') ? [{ title: 'التاجر', dataIndex: 'merchant', key: 'merchant' }] : []),
        ...(!list.includes('rep') ? [{ title: 'المندوب', dataIndex: 'rep', key: 'rep' }] : []),
      ];
    }
    if (d === 'item') {
      return [
        { title: 'الصنف', dataIndex: 'item', key: 'item' },
        { title: 'نقاط الوحدة', dataIndex: 'item_points', key: 'item_points', align: 'left' as const,
          width: 100, render: (v: any) => fmt('qty', v) },
      ];
    }
    if (d === 'technician') {
      return [
        { title: 'الفني', dataIndex: 'technician', key: 'technician' },
        { title: 'كود الفني', dataIndex: 'technician_code', key: 'technician_code', width: 130 },
        { title: 'هاتف الفني', dataIndex: 'technician_phone', key: 'technician_phone', width: 130 },
        { title: 'محافظة الفني', dataIndex: 'technician_governorate', key: 'technician_governorate' },
        { title: 'مركز الفني', dataIndex: 'technician_markaz', key: 'technician_markaz' },
        { title: 'مندوب الفني', dataIndex: 'technician_rep', key: 'technician_rep' },
      ];
    }
    if (d === 'merchant') {
      return [
        { title: 'التاجر', dataIndex: 'merchant', key: 'merchant' },
        { title: 'كود التاجر', dataIndex: 'merchant_code', key: 'merchant_code', width: 130 },
        { title: 'هاتف التاجر', dataIndex: 'merchant_phone', key: 'merchant_phone', width: 130 },
      ];
    }
    return [{ title: DIM_LABEL[d], dataIndex: d, key: d,
      width: PERIODS.includes(d as InspectionPeriod) ? 110 : undefined }];
  });

  const measureColumns = MEASURES.map((m) => ({
    title: m.title, dataIndex: m.key, key: m.key, align: 'left' as const,
    render: (v: any) => {
      const t = fmt(m.kind, v);
      return m.strong ? <b>{t}</b> : t;
    },
  }));

  const tableColumns = [...dimColumns(effectiveDims), ...measureColumns];
  const title = preset.label;
  const defaultHidden = ['document_type', 'technician_markaz', 'technician_rep', 'merchant_code',
    'items', ...(effectiveDims.includes('technician') ? ['technicians'] : [])];
  const cols = useTableColumns('inspection-points', tableColumns as any, {
    defaultHidden,
    export: { name: title, rows },
  });

  const setPreset = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('preset', key);
    setParams(next, { replace: true });
  };

  const setFilter = (k: string, v: any) => setF((prev) => ({ ...prev, [k]: v }));

  const govs = picked(f, 'governorate_id');
  const technicianList = useMemo(() => (govs.length
    ? (lists.technicians || []).filter((c: any) => govs.includes(c.governorate_id))
    : lists.technicians || []), [lists.technicians, JSON.stringify(govs)]);
  const merchantList = useMemo(() => (govs.length
    ? (lists.merchants || []).filter((c: any) => govs.includes(c.governorate_id))
    : lists.merchants || []), [lists.merchants, JSON.stringify(govs)]);
  usePrune(f, setF, 'technician_id', technicianList);
  usePrune(f, setF, 'merchant_id', merchantList);

  const print = () => {
    const visible = (cols.columns as any[]).filter((c) => c.dataIndex);
    const pc: PrintColumn<Row>[] = visible.map((c: any) => ({
      title: String(c.title), numeric: c.align === 'left',
      value: (r: Row) => {
        const m = MEASURES.find((x) => x.key === c.dataIndex);
        if (m) return fmt(m.kind, r[c.dataIndex]);
        if (c.dataIndex === 'item_points') return fmt('qty', r[c.dataIndex]);
        return r[c.dataIndex] ?? '';
      },
    }));
    const meta: [string, string][] = [
      ['الفترة', range ? `${range[0].format('YYYY-MM-DD')} — ${range[1].format('YYYY-MM-DD')}` : 'كل الفترات'],
    ];
    printReport({ title, meta }, pc, rows, totals ? [
      { label: 'إجمالي النقاط', value: qty(totals.points) },
      { label: 'إجمالي الكمية', value: qty(totals.qty) },
      { label: 'عدد الزيارات', value: Number(totals.visits || 0).toLocaleString(numeralsLocale()) },
    ] : []);
  };

  const groups = useMemo(() => {
    const g: Record<string, InspectionPreset[]> = {};
    INSPECTION_POINTS_PRESETS.forEach((p) => { (g[p.group] = g[p.group] || []).push(p); });
    return Object.entries(g).map(([label, list]) => ({
      label, options: list.map((p) => ({ value: p.key, label: p.label })) }));
  }, []);

  const repLabel = (r: any) => `${r.full_name || r.username || r.id}${isStopped(r) ? ' (موقوف)' : ''}`;
  const partyLabel = (p: any) => `${p.name}${p.code ? ` — ${p.code}` : ''}`;

  return (
    <ListPage
      icon={<TrophyOutlined />}
      title="تحليل أصناف المعاينات بالنقاط"
      muted={title}
      actions={(<>
        {cols.control}
        <Button icon={<PrinterOutlined />} onClick={print}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Select showSearch style={{ minWidth: 240 }} value={preset.key} onChange={setPreset}
          options={groups} filterOption={searchFilter} popupMatchSelectWidth={false} />
        <DateRangeFilter value={range as any} onChange={(v: any) => setRange(v)} />
        <Select mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 220 }}
          placeholder="التجميع حسب" value={dims} onChange={(v) => setDims(v as InspectionDim[])}
          options={GROUP_DIMS.map((d) => ({ value: d, label: DIM_LABEL[d] }))} />
        <Select style={{ width: 120 }} value={period} onChange={(v) => setPeriod(v)}
          options={[{ value: 'none', label: 'بدون فترة' }, { value: 'day', label: 'باليوم' },
            { value: 'month', label: 'بالشهر' }]} />
        <Select {...MULTI} placeholder="نوع الزيارة" value={picked(f, 'visit_kind')} style={{ minWidth: 130 }}
          onChange={(v) => setFilter('visit_kind', v)}
          options={[{ value: 'technician', label: 'معاينة فني' }, { value: 'regular', label: 'زيارة عادية' }]} />
        <Select {...MULTI} showSearch placeholder="الفرع" value={picked(f, 'branch_id')} style={{ minWidth: 130 }}
          onChange={(v) => setFilter('branch_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.branches || []).map((b) => ({ value: b.id, label: b.name }))} />
        <Select {...MULTI} showSearch placeholder="المندوب" value={picked(f, 'rep_id')} style={{ minWidth: 170 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('rep_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={(lists.reps || []).map((r) => ({ value: r.id, label: repLabel(r) }))} />
        <Select {...MULTI} showSearch placeholder="الفني" value={picked(f, 'technician_id')} style={{ minWidth: 200 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('technician_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={technicianList.map((p: any) => ({ value: p.id, label: partyLabel(p) }))} />
        <Select {...MULTI} showSearch placeholder="التاجر" value={picked(f, 'merchant_id')} style={{ minWidth: 200 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('merchant_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={merchantList.map((p: any) => ({ value: p.id, label: partyLabel(p) }))} />
        <Select {...MULTI} showSearch placeholder="الصنف" value={picked(f, 'item')} style={{ minWidth: 200 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('item', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={(lists.items || []).map((i: any) => ({ value: i.name, label: i.name }))} />
        <Select {...MULTI} showSearch placeholder="المحافظة" value={picked(f, 'governorate_id')} style={{ minWidth: 140 }}
          onChange={(v) => setFilter('governorate_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.governorates || []).map((g) => ({ value: g.id, label: g.name }))} />
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { setF({}); setRange(rangeFor(preset)); setDims(preset.dims);
            setPeriod(preset.period || 'none'); }}>مسح</Button>
      </>)}
      summary={totals && (<>
        <ListStat label="إجمالي النقاط" value={qty(totals.points)} tone="strong" />
        <ListStat label="إجمالي الكمية" value={qty(totals.qty)} />
        <ListStat label="عدد الزيارات" value={Number(totals.visits || 0).toLocaleString(numeralsLocale())} />
        <ListStat label="عدد الفنيين" value={Number(totals.technicians || 0).toLocaleString(numeralsLocale())} />
        <ListStat label="عدد الأصناف" value={Number(totals.items || 0).toLocaleString(numeralsLocale())} />
      </>)}
    >
      {truncated && <Alert type="warning" showIcon style={{ marginBottom: 8 }}
        message="النتيجة كبيرة جداً وتم عرض أول ٢٠٬٠٠٠ سطر — ضيّق الفترة أو الفلاتر" />}
      <Table<Row>
        className="sl-table" size="small" loading={loading}
        rowKey={(r: Row) => effectiveDims.map((d) => String(r[`${d}_id`] ?? r[d] ?? '')).join('|') || 'all'}
        dataSource={rows} columns={cols.columns as any}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </ListPage>
  );
}

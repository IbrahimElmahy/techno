import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, DatePicker, Select, Table, message } from 'antd';
import { AuditOutlined, ClearOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableColumns } from '../components/ColumnSettings';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { money, numeralsLocale } from '../utils/money';
import { repOptions } from '../utils/reps';
import { PAGE_SIZE } from '../utils/pagination';
import { printReport, type PrintColumn } from '../print/reportSheet';
import { LEDGER_PRESETS, type LedgerDim, type LedgerPreset } from './ledgerAnalysisPresets';

type Row = Record<string, any>;

const DIM_LABEL: Record<LedgerDim, string> = {
  account: 'الحساب', main_account: 'الحساب الرئيسي', account_type: 'نوع الحساب', nature: 'طبيعة الحساب',
  branch: 'الفرع', cost_center: 'مركز التكلفة', entry_type: 'نوع القيد', party: 'الطرف',
  party_kind: 'نوع الطرف', territory: 'المنطقة', rep: 'المندوب', family: 'الحساب (أبيض/بولي)',
  day: 'اليوم', month: 'الشهر', year: 'السنة',
};

const ACCOUNT_TYPES: [string, string][] = [
  ['treasury', 'خزائن وبنوك'], ['custody', 'عهد'], ['customer_receivable', 'عملاء'],
  ['supplier_payable', 'موردين'], ['sales_revenue', 'إيرادات مبيعات'],
  ['purchases_expense', 'مشتريات'], ['user_defined', 'حسابات أخرى'],
];

export default function LedgerAnalysis() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const preset: LedgerPreset = LEDGER_PRESETS.find((p) => p.key === params.get('preset')) || LEDGER_PRESETS[0];
  const asof = preset.mode === 'asof';

  const [dims, setDims] = useState<LedgerDim[]>(preset.dims);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().startOf('month'), dayjs()]);
  const [until, setUntil] = useState<Dayjs>(dayjs());
  const initialFilters = (p: LedgerPreset) => ({ account_type: p.accountType, party_kind: p.partyKind });
  const [f, setF] = useState<Record<string, any>>(() => initialFilters(preset));
  const [postedOnly, setPostedOnly] = useState(true);
  const [nonzero, setNonzero] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<Record<string, any[]>>({});

  useEffect(() => { setDims(preset.dims); setF(initialFilters(preset)); }, [preset.key]);

  useEffect(() => {
    const byName = (r: any) => r.full_name || r.name;
    const list = (x: any) => (Array.isArray(x.data) ? x.data : x.data?.rows || []);
    Promise.all([
      api.get('/api/v1/branches').catch(() => ({ data: [] })),
      api.get('/api/v1/accounts').catch(() => ({ data: [] })),
      api.get('/api/v1/users').catch(() => ({ data: [] })),
      api.get('/api/v1/territories').catch(() => ({ data: [] })),
      api.get('/api/v1/cost-centers').catch(() => ({ data: [] })),
      api.get('/api/v1/customers/options', { params: { limit: 20000 } }).catch(() => ({ data: [] })),
      api.get('/api/v1/suppliers').catch(() => ({ data: [] })),
    ]).then(([b, a, u, t, c, cu, su]) => setLists({
      branches: sortByName(list(b), byName), accounts: list(a),
      reps: sortByName(list(u).filter((x: any) => x.role === 'sales_rep'), byName),
      territories: sortByName(list(t), byName), costCenters: sortByName(list(c), byName),
      customers: list(cu), suppliers: list(su),
    }));
  }, []);

  const seq = useRef(0);
  const load = async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const p: Record<string, any> = { dims: dims.join(','), posted_only: postedOnly, nonzero };
      if (asof) p.date_to = until.format('YYYY-MM-DD');
      else {
        if (range?.[0]) p.date_from = range[0].format('YYYY-MM-DD');
        if (range?.[1]) p.date_to = range[1].format('YYYY-MM-DD');
      }
      Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p[k] = v; });
      const res = await api.get('/api/v1/reports/ledger-analysis', { params: p });
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

  useEffect(() => { load(); }, [dims.join(','), asof, until.valueOf(), range?.[0]?.valueOf(),
    range?.[1]?.valueOf(), JSON.stringify(f), postedOnly, nonzero]);

  const m = (v: any) => (Number(v) ? money(v) : '');
  const statement = (r: Row) => {
    if (!dims.includes('account') || !r.account_id) return;
    const q = new URLSearchParams({ account: String(r.account_id) });
    if (!asof && range) { q.set('from', range[0].format('YYYY-MM-DD')); q.set('to', range[1].format('YYYY-MM-DD')); }
    navigate(`/account-statement?${q.toString()}`);
  };

  const columns: any[] = [
    ...dims.flatMap((d): any[] => {
      if (d === 'party') {
        return [
          { title: 'الكود', dataIndex: 'party_code', key: 'party_code', width: 110 },
          { title: DIM_LABEL.party, dataIndex: 'party', key: 'party' },
          { title: 'الهاتف', dataIndex: 'party_phone', key: 'party_phone', width: 120 },
        ];
      }
      if (d === 'account') {
        return [
          { title: DIM_LABEL.account, dataIndex: 'account', key: 'account',
            render: (v: string, r: Row) => <a onClick={() => statement(r)}>{v}</a> },
          { title: 'طبيعة الرصيد', dataIndex: 'normal_side', key: 'normal_side', width: 90 },
        ];
      }
      return [{ title: DIM_LABEL[d], dataIndex: d, key: d,
        width: ['day', 'month', 'year'].includes(d) ? 110 : undefined }];
    }),
    ...(!asof ? [
      { title: 'رصيد أول المدة مدين', dataIndex: 'opening_debit', key: 'opening_debit', align: 'left' as const, render: m },
      { title: 'رصيد أول المدة دائن', dataIndex: 'opening_credit', key: 'opening_credit', align: 'left' as const, render: m },
      { title: 'حركة مدين', dataIndex: 'debit', key: 'debit', align: 'left' as const, render: m },
      { title: 'حركة دائن', dataIndex: 'credit', key: 'credit', align: 'left' as const, render: m },
      { title: 'صافي الحركة', dataIndex: 'net', key: 'net', align: 'left' as const, render: m },
    ] : [
      { title: 'إجمالي مدين', dataIndex: 'debit', key: 'debit', align: 'left' as const, render: m },
      { title: 'إجمالي دائن', dataIndex: 'credit', key: 'credit', align: 'left' as const, render: m },
    ]),
    { title: 'الرصيد مدين', dataIndex: 'closing_debit', key: 'closing_debit', align: 'left' as const,
      render: (v: any) => <b style={{ color: Number(v) ? '#cf1322' : undefined }}>{m(v)}</b> },
    { title: 'الرصيد دائن', dataIndex: 'closing_credit', key: 'closing_credit', align: 'left' as const,
      render: (v: any) => <b style={{ color: Number(v) ? '#389e0d' : undefined }}>{m(v)}</b> },
    { title: 'عدد القيود', dataIndex: 'entries', key: 'entries', align: 'left' as const },
  ];

  const cols = useTableColumns(`ledger-analysis-${preset.mode}`, columns, {
    defaultHidden: ['entries', 'party_phone', 'normal_side'],
    export: { name: preset.label, rows },
  });

  const setPreset = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('preset', key);
    setParams(next, { replace: true });
  };

  const groups = useMemo(() => {
    const g: Record<string, LedgerPreset[]> = {};
    LEDGER_PRESETS.forEach((p) => { (g[p.group] = g[p.group] || []).push(p); });
    return Object.entries(g).map(([label, list]) => ({ label, options: list.map((p) => ({ value: p.key, label: p.label })) }));
  }, []);

  const print = () => {
    const visible = (cols.columns as any[]).filter((c) => c.dataIndex);
    const pc: PrintColumn<Row>[] = visible.map((c: any) => ({
      title: String(c.title), numeric: c.align === 'left',
      value: (r: Row) => (c.align === 'left' && c.dataIndex !== 'entries' ? m(r[c.dataIndex]) : r[c.dataIndex] ?? ''),
    }));
    const meta: [string, string][] = [asof ? ['حتى تاريخ', until.format('YYYY-MM-DD')]
      : ['الفترة', range ? `${range[0].format('YYYY-MM-DD')} — ${range[1].format('YYYY-MM-DD')}` : 'كل الفترات']];
    printReport({ title: preset.label, meta }, pc, rows, totals ? [
      { label: 'الرصيد مدين', value: money(totals.closing_debit) },
      { label: 'الرصيد دائن', value: money(totals.closing_credit) },
    ] : []);
  };

  const setFilter = (k: string, v: any) => setF((prev) => ({ ...prev, [k]: v }));
  const parties = f.party_kind === 'supplier' ? lists.suppliers : f.party_kind === 'customer' ? lists.customers : [];
  const accountOptions = useMemo(() => (lists.accounts || [])
    .filter((a: any) => a.name)
    .map((a: any) => ({ value: a.id, label: `${a.code || ''} ${a.name}`.trim() })), [lists.accounts]);

  return (
    <ListPage
      icon={<AuditOutlined />}
      title="تقارير الحسابات"
      muted={preset.label}
      actions={(<>
        {cols.control}
        <Button icon={<PrinterOutlined />} onClick={print}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Select showSearch style={{ minWidth: 260 }} value={preset.key} onChange={setPreset}
          options={groups} filterOption={searchFilter} popupMatchSelectWidth={false} />
        {asof
          ? <DatePicker value={until} onChange={(d) => d && setUntil(d)} allowClear={false} placeholder="حتى تاريخ" />
          : <DateRangeFilter value={range as any} onChange={(v: any) => setRange(v)} />}
        <Select mode="multiple" allowClear maxTagCount="responsive" style={{ minWidth: 220 }}
          placeholder="التجميع حسب" value={dims} onChange={(v) => setDims(v as LedgerDim[])}
          options={(Object.keys(DIM_LABEL) as LedgerDim[]).map((d) => ({ value: d, label: DIM_LABEL[d] }))} />
        <Select allowClear showSearch placeholder="الحساب" value={f.account_id} style={{ minWidth: 220 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('account_id', v)}
          filterOption={searchFilter} filterSort={searchRank} options={accountOptions} />
        <Select allowClear placeholder="نوع الحساب" value={f.account_type} style={{ minWidth: 140 }}
          onChange={(v) => setFilter('account_type', v)}
          options={ACCOUNT_TYPES.map(([value, label]) => ({ value, label }))} />
        <Select allowClear placeholder="نوع الطرف" value={f.party_kind} style={{ minWidth: 120 }}
          onChange={(v) => setF((prev) => ({ ...prev, party_kind: v, party_id: undefined }))}
          options={[{ value: 'customer', label: 'العملاء' }, { value: 'supplier', label: 'الموردين' }]} />
        {f.party_kind && (
          <Select allowClear showSearch placeholder="الطرف" value={f.party_id} style={{ minWidth: 200 }}
            popupMatchSelectWidth={false} onChange={(v) => setFilter('party_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={(parties || []).map((p: any) => ({ value: p.id, label: `${p.name}${p.code ? ` — ${p.code}` : ''}` }))} />
        )}
        <Select allowClear showSearch placeholder="الفرع" value={f.branch_id} style={{ minWidth: 130 }}
          onChange={(v) => setFilter('branch_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.branches || []).map((b) => ({ value: b.id, label: b.name }))} />
        <Select allowClear showSearch placeholder="المنطقة" value={f.territory_id} style={{ minWidth: 140 }}
          onChange={(v) => setFilter('territory_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.territories || []).map((t) => ({ value: t.id, label: t.name }))} />
        <Select allowClear showSearch placeholder="المندوب" value={f.rep_id} style={{ minWidth: 170 }}
          popupMatchSelectWidth={false} onChange={(v) => setFilter('rep_id', v)}
          filterOption={searchFilter} filterSort={searchRank} options={repOptions(lists.reps || [], f.rep_id)} />
        <Select allowClear showSearch placeholder="مركز التكلفة" value={f.cost_center_id} style={{ minWidth: 150 }}
          onChange={(v) => setFilter('cost_center_id', v)} filterOption={searchFilter} filterSort={searchRank}
          options={(lists.costCenters || []).map((c) => ({ value: c.id, label: c.name }))} />
        <Checkbox checked={postedOnly} onChange={(e) => setPostedOnly(e.target.checked)}>المرحّل فقط</Checkbox>
        <Checkbox checked={nonzero} onChange={(e) => setNonzero(e.target.checked)}>إخفاء الصفري</Checkbox>
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { setF(initialFilters(preset)); setDims(preset.dims); setUntil(dayjs()); setRange([dayjs().startOf('month'), dayjs()]); }}>مسح</Button>
      </>)}
      summary={totals && (<>
        {!asof && <ListStat label="حركة مدين" value={money(totals.debit)} />}
        {!asof && <ListStat label="حركة دائن" value={money(totals.credit)} />}
        <ListStat label="الرصيد مدين" value={money(totals.closing_debit)} tone="neg" />
        <ListStat label="الرصيد دائن" value={money(totals.closing_credit)} tone="pos" />
        <ListStat label="الصافي" value={money(totals.closing)} tone="strong"
          hint={Number(totals.closing) >= 0 ? 'مدين' : 'دائن'} />
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

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Select, Space, Spin } from 'antd';
import {
  AuditOutlined, CaretDownOutlined, CaretLeftOutlined, PrinterOutlined, ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import ListPage, { ListStat } from '../../components/ListPage';
import DateRangeFilter from '../../components/DateRangeFilter';
import { normalizeAr } from '../../components/ListToolbar';
import { searchFilter, searchRank } from '../../utils/arabicSort';
import { printDocument } from '../../print/brand';
import { money } from '../../utils/money';

interface Node {
  account_id: number;
  code: string | null;
  name: string | null;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
  children: Node[];
}

const n = (v: any) => Number(v || 0);
const dr = (v: any) => (n(v) > 0 ? n(v) : 0);
const cr = (v: any) => (n(v) < 0 ? -n(v) : 0);
const cell = (v: number) => (v ? money(v) : '');

const CSS = `
.tb-table{width:100%;border-collapse:collapse;font-size:13.5px}
.tb-table th{font-weight:700;color:#334155;background:#f8fafc;padding:7px 10px;border:1px solid #e2e8f0;text-align:center;white-space:nowrap}
.tb-table td{padding:5px 10px;border-bottom:1px solid #f1f5f9;border-inline:1px solid #f1f5f9}
.tb-table td.num{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap;width:120px}
.tb-table tr.tb-top td{font-weight:700;background:#fcfcfd}
.tb-table tr.tb-total td{font-weight:800;background:#f1f5f9;border-top:2px solid #334155;border-bottom:3px double #334155}
.tb-table .tb-toggle{cursor:pointer;user-select:none}
.tb-table .tb-caret{display:inline-block;width:18px;color:#94a3b8}
.tb-table .tb-code{color:#94a3b8;font-size:12px;margin-inline-start:8px}
.tb-table .tb-count{color:#94a3b8;font-size:12px;margin-inline-start:4px}
.tb-table .tb-link{cursor:pointer;color:#1d4ed8}
.tb-table .tb-link:hover{text-decoration:underline}
`;

const keysOf = (nodes: Node[]): number[] => nodes.flatMap((x) => (x.children.length ? [x.account_id, ...keysOf(x.children)] : []));

function filterTree(nodes: Node[], q: string): Node[] {
  if (!q) return nodes;
  const want = normalizeAr(q);
  const out: Node[] = [];
  nodes.forEach((x) => {
    const self = normalizeAr(`${x.name || ''} ${x.code || ''}`).includes(want);
    const kids = filterTree(x.children, q);
    if (self || kids.length) out.push({ ...x, children: self ? x.children : kids });
  });
  return out;
}

export default function TrialBalanceTab() {
  const navigate = useNavigate();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().startOf('year'), dayjs()]);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [costCenterId, setCostCenterId] = useState<number | undefined>();
  const [branches, setBranches] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(() => {});
    api.get('/api/v1/cost-centers?active=true').then((r) => setCostCenters(r.data || [])).catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (range) {
        params.from = range[0].format('YYYY-MM-DD');
        params.to = range[1].format('YYYY-MM-DD');
      }
      if (branchId) params.branch_id = branchId;
      if (costCenterId) params.cost_center_id = costCenterId;
      const res = await api.get('/api/v1/trial-balance-tree', { params });
      setData(res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { run(); }, [range, branchId, costCenterId]);

  const rows: Node[] = useMemo(() => filterTree(data?.rows || [], query), [data, query]);
  const allKeys = useMemo(() => keysOf(rows), [rows]);
  const effectiveOpen = query ? new Set(allKeys) : open;
  const t = data?.totals;

  const toggle = (id: number) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpen(next);
  };

  const openStatement = (id: number) => {
    const p = new URLSearchParams({ account: String(id) });
    if (range) { p.set('from', range[0].format('YYYY-MM-DD')); p.set('to', range[1].format('YYYY-MM-DD')); }
    navigate(`/account-statement?${p.toString()}`);
  };

  const body: React.ReactNode[] = [];
  const walk = (nodes: Node[], level: number) => {
    nodes.forEach((x) => {
      const kids = x.children.length > 0;
      const isOpen = effectiveOpen.has(x.account_id);
      body.push(
        <tr key={`${x.account_id}-${level}`} className={level === 0 ? 'tb-top' : undefined}>
          <td style={{ paddingInlineStart: 10 + level * 22 }}>
            <span className={kids ? 'tb-toggle' : undefined} onClick={kids ? () => toggle(x.account_id) : undefined}>
              <span className="tb-caret">{kids ? (isOpen ? <CaretDownOutlined /> : <CaretLeftOutlined />) : null}</span>
              {kids ? x.name : <span className="tb-link" onClick={() => openStatement(x.account_id)}>{x.name}</span>}
            </span>
            {x.code ? <span className="tb-code">{x.code}</span> : null}
            {kids ? <span className="tb-count">({x.children.length})</span> : null}
          </td>
          <td className="num">{cell(dr(x.opening))}</td>
          <td className="num">{cell(cr(x.opening))}</td>
          <td className="num">{cell(n(x.debit))}</td>
          <td className="num">{cell(n(x.credit))}</td>
          <td className="num">{cell(dr(x.closing))}</td>
          <td className="num">{cell(cr(x.closing))}</td>
        </tr>,
      );
      if (kids && isOpen) walk(x.children, level + 1);
    });
  };
  walk(rows, 0);

  const doPrint = () => {
    if (!data) return;
    const lines: string[] = [];
    const add = (nodes: Node[], level: number) => nodes.forEach((x) => {
      lines.push(`<tr><td style="padding-inline-start:${6 + level * 14}px">${x.name || ''}</td>`
        + `<td class="num">${cell(dr(x.opening))}</td><td class="num">${cell(cr(x.opening))}</td>`
        + `<td class="num">${cell(n(x.debit))}</td><td class="num">${cell(n(x.credit))}</td>`
        + `<td class="num">${cell(dr(x.closing))}</td><td class="num">${cell(cr(x.closing))}</td></tr>`);
      if (effectiveOpen.has(x.account_id)) add(x.children, level + 1);
    });
    add(rows, 0);
    const html = `<table class="grid"><thead>
      <tr><th rowspan="2">الحساب</th><th colspan="2">رصيد أول المدة</th><th colspan="2">حركة الفترة</th><th colspan="2">الرصيد</th></tr>
      <tr><th>مدين</th><th>دائن</th><th>مدين</th><th>دائن</th><th>مدين</th><th>دائن</th></tr></thead>
      <tbody>${lines.join('')}
      <tr style="font-weight:700"><td>الإجمالي</td><td class="num">${money(t.opening_debit)}</td><td class="num">${money(t.opening_credit)}</td>
      <td class="num">${money(t.debit)}</td><td class="num">${money(t.credit)}</td>
      <td class="num">${money(t.closing_debit)}</td><td class="num">${money(t.closing_credit)}</td></tr></tbody></table>`;
    printDocument({
      title: 'ميزان المراجعة',
      meta: [['الفترة', range ? `${range[0].format('YYYY/MM/DD')} — ${range[1].format('YYYY/MM/DD')}` : '']],
    }, html);
  };

  const balanced = t && Math.abs(n(t.debit) - n(t.credit)) < 0.01;

  return (
    <ListPage
      icon={<AuditOutlined />}
      title="ميزان المراجعة"
      actions={(<>
        <Button icon={<PrinterOutlined />} onClick={doPrint} disabled={!data}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={run} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <DateRangeFilter className="sl-f-dates" value={range as any} onChange={(v: any) => setRange(v)} />
        {branches.length > 1 ? (
          <Select allowClear placeholder="كل الفروع" style={{ flex: '0 0 170px' }} value={branchId}
            onChange={setBranchId} options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
        ) : null}
        {costCenters.length ? (
          <Select allowClear showSearch placeholder="مركز التكلفة" style={{ flex: '0 0 190px' }} value={costCenterId}
            onChange={setCostCenterId} filterOption={searchFilter} filterSort={searchRank}
            options={costCenters.map((c: any) => ({ value: c.id, label: c.name }))} />
        ) : null}
        <Input className="sl-f-search" allowClear prefix={<SearchOutlined />} placeholder="بحث بالحساب أو الكود"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </>)}
      summary={t ? (<>
        <ListStat label="حركة مدين" value={money(t.debit)} />
        <ListStat label="حركة دائن" value={money(t.credit)} />
        <ListStat label="الميزان" value={balanced ? 'متوازن' : `فرق ${money(n(t.debit) - n(t.credit))}`}
          tone={balanced ? 'pos' : 'neg'} />
      </>) : undefined}
    >
      <style>{CSS}</style>
      <Space style={{ margin: '6px 0 8px' }}>
        <Button size="small" onClick={() => setOpen(new Set(allKeys))}>فتح الكل</Button>
        <Button size="small" onClick={() => setOpen(new Set())}>طي الكل</Button>
      </Space>
      <Spin spinning={loading}>
        {!data ? <Empty description="لا توجد بيانات" /> : (
          <div style={{ overflowX: 'auto' }}>
            <div className="ant-table" style={{ background: 'transparent' }}>
            <table className="tb-table">
              <colgroup>
                <col /><col style={{ width: 130 }} /><col style={{ width: 130 }} /><col style={{ width: 130 }} />
                <col style={{ width: 130 }} /><col style={{ width: 130 }} /><col style={{ width: 130 }} />
              </colgroup>
              <thead className="ant-table-thead">
                <tr>
                  <th style={{ textAlign: 'start' }}>الحساب</th>
                  <th>أول المدة مدين</th>
                  <th>أول المدة دائن</th>
                  <th>حركة مدين</th>
                  <th>حركة دائن</th>
                  <th>الرصيد مدين</th>
                  <th>الرصيد دائن</th>
                </tr>
              </thead>
              <tbody>
                {body}
                {t ? (
                  <tr className="tb-total">
                    <td>الإجمالي</td>
                    <td className="num">{money(t.opening_debit)}</td>
                    <td className="num">{money(t.opening_credit)}</td>
                    <td className="num">{money(t.debit)}</td>
                    <td className="num">{money(t.credit)}</td>
                    <td className="num">{money(t.closing_debit)}</td>
                    <td className="num">{money(t.closing_credit)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </Spin>
    </ListPage>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Table as AntTable, message } from 'antd';
import { ClearOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, TrophyOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import { FilterTable as Table } from '../components/FilterTable';
import { useTableColumns } from '../components/ColumnSettings';
import { MULTI } from '../utils/reportFilters';
import { matchesWords, searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { numeralsLocale } from '../utils/money';
import { PAGE_SIZE } from '../utils/pagination';
import { printReport, type PrintColumn } from '../print/reportSheet';

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MONTH_KEYS = MONTHS.map((_, i) => `m${String(i + 1).padStart(2, '0')}`);

type Row = Record<string, any>;

const one = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 1 });
const num = (v: any) => (Number(v) ? one(v) : '');
const int = (v: any) => Number(v || 0).toLocaleString(numeralsLocale());

export default function PointsYearly() {
  const [year, setYear] = useState<number>(dayjs().year());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [reps, setReps] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/after-sales-reports/points-yearly', {
        params: { year },
      });
      const per = Number(res.data.gold_points) || 30;
      setRows((res.data.rows || []).map((r: Row): Row => {
        const out: Row = { ...r };
        MONTH_KEYS.forEach((k) => { out[k] = Number(r[k] || 0) / per; });
        return out;
      }));
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [year]);

  const repOptions = useMemo(() => sortByName(
    [...new Set(rows.map((r) => r.party_rep || 'بدون مندوب'))], (r) => r,
  ).map((r) => ({ value: r, label: r })), [rows]);

  const shown = useMemo(() => rows.map((r): Row => ({
    ...r, coupon_gap: Number(r.earned_coupons || 0) - Number(r.received_in_gold || 0),
  })).filter((r) => (!reps.length || reps.includes(r.party_rep || 'بدون مندوب'))
    && (!query.trim() || matchesWords(`${r.party} ${r.party_code || ''} ${r.party_phone || ''}`, query))),
  [rows, reps, query]);

  const totals = useMemo(() => {
    const t: Row = {};
    [...MONTH_KEYS, 'earned_coupons', 'received_gold', 'received_silver', 'received_in_gold', 'coupon_gap']
      .forEach((k) => { t[k] = shown.reduce((s, r) => s + Number(r[k] || 0), 0); });
    return t;
  }, [shown]);

  const columns = [
    { title: 'التاجر', dataIndex: 'party', key: 'party', width: 200, fixed: 'right' as const },
    { title: 'المندوب', dataIndex: 'party_rep', key: 'party_rep', width: 150,
      render: (v: string | null) => v || '' },
    { title: 'الكود', dataIndex: 'party_code', key: 'party_code', width: 110 },
    { title: 'الهاتف', dataIndex: 'party_phone', key: 'party_phone', width: 120 },
    { title: 'المحافظة', dataIndex: 'party_governorate', key: 'party_governorate', width: 110 },
    ...MONTH_KEYS.map((k, i) => ({ title: MONTHS[i], dataIndex: k, key: k, width: 80,
      align: 'center' as const, render: num })),
    { title: 'إجمالي كوبونات السنة', dataIndex: 'earned_coupons', key: 'earned_coupons', width: 120,
      align: 'center' as const, render: (v: any) => <b>{num(v)}</b> },
    { title: 'الكوبونات المسلّمة', key: 'received', children: [
      { title: 'ذهبي', dataIndex: 'received_gold', key: 'received_gold', width: 80, align: 'center' as const, render: int },
      { title: 'فضي', dataIndex: 'received_silver', key: 'received_silver', width: 80, align: 'center' as const, render: int },
    ] },
    { title: 'المجموع بالذهبي', dataIndex: 'received_in_gold', key: 'received_in_gold', width: 110,
      align: 'center' as const, render: (v: any) => <b>{one(v)}</b> },
    { title: 'الفرق', dataIndex: 'coupon_gap', key: 'coupon_gap', width: 100, align: 'center' as const,
      render: (v: any) => <b style={{ color: Number(v) < 0 ? '#cf1322' : undefined }}>{one(v)}</b> },
  ];
  const plain = (list: any[]): any[] => list.map((c) => ({
    ...c, filterable: false, ...(c.children ? { children: plain(c.children) } : {}),
  }));
  const cols = useTableColumns('points-yearly', plain(columns) as any, {
    defaultHidden: ['party_code', 'party_phone', 'party_governorate'],
    export: { name: `مجمع نقاط ${year}`, rows: shown },
  });

  const print = () => {
    const pc: PrintColumn<Row>[] = [
      { title: 'التاجر', value: 'party' },
      { title: 'المندوب', value: (r) => r.party_rep || '' },
      ...MONTH_KEYS.map((k, i) => ({ title: MONTHS[i], value: (r: Row) => num(r[k]), numeric: true })),
      { title: 'إجمالي الكوبونات', value: (r) => num(r.earned_coupons), numeric: true },
      { title: 'مسلّم ذهبي', value: (r) => int(r.received_gold), numeric: true },
      { title: 'مسلّم فضي', value: (r) => int(r.received_silver), numeric: true },
      { title: 'المجموع بالذهبي', value: (r) => one(r.received_in_gold), numeric: true },
      { title: 'الفرق', value: (r) => num(r.coupon_gap), numeric: true },
    ];
    printReport({ title: `مجمع نقاط ${year}`, meta: reps.length ? [['المندوب', reps.join('، ')]] : [] },
      pc, shown, [
        { label: 'إجمالي كوبونات السنة', value: one(totals.earned_coupons) },
        { label: 'المسلّم بالذهبي', value: one(totals.received_in_gold) },
        { label: 'الفرق', value: one(totals.coupon_gap) },
      ]);
  };

  const leaf = cols.columns.flatMap((c: any) => (c.children ? c.children : [c]));

  return (
    <ListPage
      icon={<TrophyOutlined />}
      title="مجمع نقاط"
      muted={`${year} · بالكوبون الذهبي`}
      actions={(<>
        {cols.control}
        <Button icon={<PrinterOutlined />} onClick={print}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear prefix={<SearchOutlined />} placeholder="بحث باسم التاجر أو الكود أو الهاتف"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select style={{ width: 110 }} value={year} onChange={setYear}
          options={Array.from({ length: 6 }, (_, i) => dayjs().year() - i).map((y) => ({ value: y, label: String(y) }))} />
        <Select {...MULTI} showSearch placeholder="المندوب" value={reps} onChange={setReps}
          style={{ minWidth: 220 }} popupMatchSelectWidth={false}
          filterOption={searchFilter} filterSort={searchRank} options={repOptions} />
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { setReps([]); setQuery(''); setYear(dayjs().year()); }}>مسح</Button>
      </>)}
      summary={(<>
        <ListStat label="إجمالي كوبونات السنة" value={one(totals.earned_coupons)} tone="strong" />
        <ListStat label="مسلّم ذهبي" value={int(totals.received_gold) || '0'} />
        <ListStat label="مسلّم فضي" value={int(totals.received_silver) || '0'} />
        <ListStat label="المسلّم بالذهبي" value={one(totals.received_in_gold)} tone="strong" />
        <ListStat label="الفرق" value={one(totals.coupon_gap)} tone={totals.coupon_gap < 0 ? 'neg' : undefined} />
        <ListStat label="عدد التجار" value={shown.length.toLocaleString(numeralsLocale())} />
      </>)}
    >
      <Table<Row>
        className="sl-table" size="small" loading={loading} rowKey={(r: Row) => String(r.party_id)}
        autoFilters={false}
        dataSource={shown} columns={cols.columns as any}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        summary={() => (
          <AntTable.Summary fixed>
            <AntTable.Summary.Row>
              {leaf.map((c: any, i: number) => {
                const k = c.dataIndex as string;
                const v = i === 0 ? 'الإجمالي'
                  : k === 'received_gold' || k === 'received_silver' ? int(totals[k])
                    : k in totals ? num(totals[k]) : '';
                return <AntTable.Summary.Cell key={c.key || i} index={i} align={i === 0 ? undefined : 'center'}>
                  <b>{v}</b></AntTable.Summary.Cell>;
              })}
            </AntTable.Summary.Row>
          </AntTable.Summary>
        )}
      />
    </ListPage>
  );
}

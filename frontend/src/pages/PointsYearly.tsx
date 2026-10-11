import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Table as AntTable, message } from 'antd';
import { ClearOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined, TrophyOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import { useTableColumns } from '../components/ColumnSettings';
import { MULTI } from '../utils/reportFilters';
import { matchesWords, searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { qty, numeralsLocale } from '../utils/money';
import { PAGE_SIZE } from '../utils/pagination';
import { printReport, type PrintColumn } from '../print/reportSheet';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس',
  'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTH_KEYS = MONTHS.map((_, i) => `m${String(i + 1).padStart(2, '0')}`);

type Row = Record<string, any>;

const num = (v: any) => (Number(v) ? qty(v) : '');
const int = (v: any) => (Number(v) ? Number(v).toLocaleString(numeralsLocale()) : '');

export default function PointsYearly() {
  const [year, setYear] = useState<number>(dayjs().year());
  const [goldPoints, setGoldPoints] = useState<number>(30);
  const [silverPoints, setSilverPoints] = useState<number>(10);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [reps, setReps] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/after-sales-reports/points-yearly', {
        params: { year, gold_points: goldPoints || 30, silver_points: silverPoints || 10 },
      });
      setRows(res.data.rows || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [year, goldPoints, silverPoints]);

  const repOptions = useMemo(() => sortByName(
    [...new Set(rows.map((r) => r.technician_rep || 'بدون مندوب'))], (r) => r,
  ).map((r) => ({ value: r, label: r })), [rows]);

  const shown = useMemo(() => rows.filter((r) => (!reps.length || reps.includes(r.technician_rep || 'بدون مندوب'))
    && (!query.trim() || matchesWords(`${r.technician} ${r.technician_code || ''} ${r.technician_phone || ''}`, query))),
  [rows, reps, query]);

  const totals = useMemo(() => {
    const t: Row = {};
    [...MONTH_KEYS, 'total_points', 'earned_coupons', 'received_gold', 'received_silver', 'received_in_gold']
      .forEach((k) => { t[k] = shown.reduce((s, r) => s + Number(r[k] || 0), 0); });
    return t;
  }, [shown]);

  const columns = [
    { title: 'الفني', dataIndex: 'technician', key: 'technician', width: 200, fixed: 'right' as const },
    { title: 'المندوب', dataIndex: 'technician_rep', key: 'technician_rep', width: 150,
      render: (v: string | null) => v || '' },
    { title: 'الكود', dataIndex: 'technician_code', key: 'technician_code', width: 110 },
    { title: 'الهاتف', dataIndex: 'technician_phone', key: 'technician_phone', width: 120 },
    { title: 'المحافظة', dataIndex: 'technician_governorate', key: 'technician_governorate', width: 110 },
    ...MONTH_KEYS.map((k, i) => ({ title: MONTHS[i], dataIndex: k, key: k, width: 90,
      align: 'left' as const, render: num })),
    { title: 'إجمالي نقاط السنة', dataIndex: 'total_points', key: 'total_points', width: 120,
      align: 'left' as const, render: (v: any) => <b>{num(v)}</b> },
    { title: 'إجمالي الكوبونات', dataIndex: 'earned_coupons', key: 'earned_coupons', width: 110,
      align: 'left' as const, render: (v: any) => <b>{num(v)}</b> },
    { title: 'مستلم كوبونات', key: 'received', children: [
      { title: 'ذهبي', dataIndex: 'received_gold', key: 'received_gold', width: 80, align: 'left' as const, render: int },
      { title: 'فضي', dataIndex: 'received_silver', key: 'received_silver', width: 80, align: 'left' as const, render: int },
    ] },
    { title: 'المجموع بالذهبي', dataIndex: 'received_in_gold', key: 'received_in_gold', width: 110,
      align: 'left' as const, render: (v: any) => <b>{num(v)}</b> },
  ];
  const cols = useTableColumns('points-yearly', columns as any, {
    defaultHidden: ['technician_code', 'technician_phone', 'technician_governorate'],
    export: { name: `مجمع نقاط ${year}`, rows: shown },
  });

  const print = () => {
    const pc: PrintColumn<Row>[] = [
      { title: 'الفني', value: 'technician' },
      { title: 'المندوب', value: (r) => r.technician_rep || '' },
      ...MONTH_KEYS.map((k, i) => ({ title: MONTHS[i], value: (r: Row) => num(r[k]), numeric: true })),
      { title: 'إجمالي النقاط', value: (r) => num(r.total_points), numeric: true },
      { title: 'إجمالي الكوبونات', value: (r) => num(r.earned_coupons), numeric: true },
      { title: 'مستلم ذهبي', value: (r) => int(r.received_gold), numeric: true },
      { title: 'مستلم فضي', value: (r) => int(r.received_silver), numeric: true },
      { title: 'المجموع بالذهبي', value: (r) => num(r.received_in_gold), numeric: true },
    ];
    printReport({ title: `مجمع نقاط ${year}`, meta: reps.length ? [['المندوب', reps.join('، ')]] : [] },
      pc, shown, [
        { label: 'إجمالي نقاط السنة', value: qty(totals.total_points) },
        { label: 'إجمالي الكوبونات', value: qty(totals.earned_coupons) },
        { label: 'المستلم بالذهبي', value: qty(totals.received_in_gold) },
      ]);
  };

  const leaf = cols.columns.flatMap((c: any) => (c.children ? c.children : [c]));

  return (
    <ListPage
      icon={<TrophyOutlined />}
      title="مجمع نقاط"
      muted={String(year)}
      actions={(<>
        {cols.control}
        <Button icon={<PrinterOutlined />} onClick={print}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear prefix={<SearchOutlined />} placeholder="بحث باسم الفني أو الكود أو الهاتف"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select style={{ width: 110 }} value={year} onChange={setYear}
          options={Array.from({ length: 6 }, (_, i) => dayjs().year() - i).map((y) => ({ value: y, label: String(y) }))} />
        <Select {...MULTI} showSearch placeholder="المندوب" value={reps} onChange={setReps}
          style={{ minWidth: 220 }} popupMatchSelectWidth={false}
          filterOption={searchFilter} filterSort={searchRank} options={repOptions} />
        <InputNumber addonBefore="نقاط الذهبي" value={goldPoints} min={1} style={{ width: 170 }}
          onChange={(v) => setGoldPoints(Number(v) || 30)} />
        <InputNumber addonBefore="نقاط الفضي" value={silverPoints} min={1} style={{ width: 160 }}
          onChange={(v) => setSilverPoints(Number(v) || 10)} />
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { setReps([]); setQuery(''); setGoldPoints(30); setSilverPoints(10); setYear(dayjs().year()); }}>مسح</Button>
      </>)}
      summary={(<>
        <ListStat label="إجمالي نقاط السنة" value={qty(totals.total_points)} tone="strong" />
        <ListStat label="إجمالي الكوبونات" value={qty(totals.earned_coupons)} />
        <ListStat label="مستلم ذهبي" value={int(totals.received_gold) || '0'} />
        <ListStat label="مستلم فضي" value={int(totals.received_silver) || '0'} />
        <ListStat label="المستلم بالذهبي" value={qty(totals.received_in_gold)} tone="strong" />
        <ListStat label="عدد الفنيين" value={shown.length.toLocaleString(numeralsLocale())} />
      </>)}
    >
      <Table<Row>
        className="sl-table" size="small" loading={loading} rowKey={(r: Row) => String(r.technician_id)}
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
                return <AntTable.Summary.Cell key={c.key || i} index={i} align={i === 0 ? undefined : 'left'}>
                  <b>{v}</b></AntTable.Summary.Cell>;
              })}
            </AntTable.Summary.Row>
          </AntTable.Summary>
        )}
      />
    </ListPage>
  );
}

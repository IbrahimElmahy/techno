import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, DatePicker, Drawer, Empty, Input, Select, Space, Spin, Switch, Table, Tag,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { money, numeralsLocale } from '../utils/money';
import { searchFilter, searchRank } from '../utils/arabicSort';

interface Cell { price: string | null; before: string | null; change_pct: string | null }
interface Row {
  item_id: number; code: string; name: string; category: string | null;
  prices: Record<string, Cell>; last_change: string | null;
}
interface Field { key: string; label: string }
interface Point { date: string | null; price: string }
interface History {
  item: { id: number; code: string; name: string; category: string | null } | null;
  changes: { field: string; label: string; old: string | null; new: string | null; at: string; by: string | null }[];
  series: Record<string, { label: string; points: Point[] }>;
  purchases: { date: string | null; document: string; quantity: string; unit_price: string }[];
}

const LINE_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2', '#a0d911'];
const num = (v: any) => Number(v || 0);

function StepChart({ series }: { series: { label: string; points: Point[]; color: string }[] }) {
  const today = dayjs();
  const prepared = series.map((s) => {
    const dated = s.points.filter((p) => p.date && p.date !== 'current').map((p) => dayjs(p.date as string));
    const first = dated.length ? dated[0] : today;
    const pts = s.points.map((p) => ({
      t: p.date === null ? first.subtract(30, 'day') : p.date === 'current' ? today : dayjs(p.date),
      v: num(p.price),
    })).sort((a, b) => a.t.valueOf() - b.t.valueOf());
    if (pts.length && pts[pts.length - 1].t.isBefore(today)) pts.push({ t: today, v: pts[pts.length - 1].v });
    return { ...s, pts };
  }).filter((s) => s.pts.length > 1);
  if (!prepared.length) return null;
  const all = prepared.flatMap((s) => s.pts);
  const t0 = Math.min(...all.map((p) => p.t.valueOf()));
  const t1 = Math.max(...all.map((p) => p.t.valueOf()));
  const v1 = Math.max(...all.map((p) => p.v)) * 1.1 || 1;
  const W = 640; const H = 220; const L = 60; const B = 24;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - 10);
  const y = (v: number) => H - B - (v / v1) * (H - B - 10);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => v1 * f);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', direction: 'ltr' }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - 10} y1={y(v)} y2={y(v)} stroke="#f0f0f0" />
            <text x={L - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="#8c8c8c">
              {Math.round(v).toLocaleString(numeralsLocale())}
            </text>
          </g>
        ))}
        <text x={L} y={H - 6} fontSize="11" fill="#8c8c8c">{dayjs(t0).format('YYYY-MM-DD')}</text>
        <text x={W - 10} y={H - 6} fontSize="11" fill="#8c8c8c" textAnchor="end">{dayjs(t1).format('YYYY-MM-DD')}</text>
        {prepared.map((s) => {
          let d = '';
          s.pts.forEach((p, i) => {
            const px = x(p.t.valueOf()); const py = y(p.v);
            d += i === 0 ? `M${px},${py}` : `H${px}V${py}`;
          });
          return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={2} />;
        })}
      </svg>
      <Space wrap size={14}>
        {prepared.map((s) => (
          <span key={s.label} style={{ fontSize: 13 }}>
            <span style={{ display: 'inline-block', width: 12, height: 3, background: s.color, marginInlineEnd: 6, verticalAlign: 'middle' }} />
            {s.label}
          </span>
        ))}
      </Space>
    </div>
  );
}

export default function PriceList() {
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [compare, setCompare] = useState<Dayjs | null>(dayjs().subtract(3, 'month'));
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [changedOnly, setChangedOnly] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [history, setHistory] = useState<History | null>(null);

  const load = async (o: Partial<{ asOf: Dayjs; compare: Dayjs | null; changedOnly: boolean }> = {}) => {
    const p = { asOf, compare, changedOnly, ...o };
    setLoading(true);
    try {
      const res = await api.get('/api/v1/price-list', {
        params: {
          as_of: p.asOf.format('YYYY-MM-DD'),
          compare_to: p.compare ? p.compare.format('YYYY-MM-DD') : undefined,
          changed_only: p.changedOnly || undefined,
        },
      });
      setRows(res.data.rows || []);
      setFields(res.data.fields || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (open == null) { setHistory(null); return; }
    api.get(`/api/v1/price-list/items/${open}`).then((r) => setHistory(r.data)).catch(() => setHistory(null));
  }, [open]);

  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))) as string[], [rows]);
  const shown = useMemo(() => {
    const s = q.trim();
    return rows.filter((r) => (!category || r.category === category)
      && (!s || r.name.includes(s) || r.code.toLowerCase().includes(s.toLowerCase())));
  }, [rows, q, category]);

  const priceCell = (c?: Cell) => {
    if (!c || c.price == null) return <span style={{ color: '#bfbfbf' }}>—</span>;
    const p = c.change_pct != null ? Number(c.change_pct) : null;
    return (
      <div style={{ lineHeight: 1.2 }}>
        <div style={{ fontWeight: 600 }}>{money(c.price)}</div>
        {p != null && (
          <div style={{ fontSize: 12, color: p > 0 ? '#389e0d' : '#cf1322', whiteSpace: 'nowrap' }}>
            {p > 0 ? '▲' : '▼'} {Math.abs(p).toLocaleString(numeralsLocale(), { maximumFractionDigits: 1 })}٪
            <span style={{ color: '#8c8c8c' }}> من {money(c.before)}</span>
          </div>
        )}
      </div>
    );
  };

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 110 },
    { title: 'الصنف', dataIndex: 'name', key: 'name', width: 220, ellipsis: true },
    { title: 'الفئة', dataIndex: 'category', key: 'category', width: 130, ellipsis: true },
    ...fields.map((f) => ({
      title: f.label, key: f.key, width: 130,
      render: (_: any, r: Row) => priceCell(r.prices[f.key]),
      sorter: (a: Row, b: Row) => num(a.prices[f.key]?.price) - num(b.prices[f.key]?.price),
    })),
    { title: 'آخر تغيير', dataIndex: 'last_change', key: 'last_change', width: 110,
      render: (v: string | null) => v || '—',
      sorter: (a: Row, b: Row) => (a.last_change || '').localeCompare(b.last_change || '') },
  ];
  const exportRows = shown.map((r) => ({
    code: r.code, name: r.name, category: r.category,
    ...Object.fromEntries(fields.map((f) => [f.key, r.prices[f.key]?.price ?? ''])),
    last_change: r.last_change,
  }));
  const cols = useTableColumns('price-list', columns as any, {
    locked: ['code', 'name'],
    defaultHidden: ['semi_commercial', 'semi_wholesale'],
    export: { name: 'قائمة الأسعار', rows: exportRows },
  });

  const purchaseAvg = history?.purchases?.length
    ? history.purchases.reduce((t, p) => t + num(p.unit_price) * num(p.quantity), 0)
      / Math.max(1e-9, history.purchases.reduce((t, p) => t + num(p.quantity), 0))
    : null;

  return (
    <Card
      title="قائمة الأسعار"
      extra={(
        <Space wrap>
          {cols.control}
          <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
        </Space>
      )}
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="بحث بالاسم أو الكود" style={{ width: 220 }}
          value={q} onChange={(e) => setQ(e.target.value)} />
        <Select allowClear showSearch placeholder="الفئة" style={{ minWidth: 160 }}
          value={category} onChange={setCategory}
          options={categories.map((c) => ({ value: c, label: c }))}
          filterOption={searchFilter} filterSort={searchRank} />
        <Space size={4}>
          <span>الأسعار في</span>
          <DatePicker value={asOf} allowClear={false} format="YYYY-MM-DD"
            onChange={(d) => { if (d) { setAsOf(d); load({ asOf: d }); } }} />
        </Space>
        <Space size={4}>
          <span>مقارنة بـ</span>
          <DatePicker value={compare} format="YYYY-MM-DD"
            onChange={(d) => { setCompare(d); load({ compare: d }); }} />
        </Space>
        <Space size={4}>
          <Switch checked={changedOnly} disabled={!compare}
            onChange={(v) => { setChangedOnly(v); load({ changedOnly: v }); }} />
          <span>المتغيّرة فقط</span>
        </Space>
        <Tag>{shown.length.toLocaleString(numeralsLocale())} صنف</Tag>
      </Space>

      <Table
        size="small" rowKey="item_id" loading={loading} dataSource={shown} columns={cols.columns}
        summary={() => null}
        tableLayout="fixed" pagination={{ pageSize: 50, showSizeChanger: false }}
        onRow={(r: Row) => ({ onClick: () => setOpen(r.item_id), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty description="لا توجد أصناف" /> }}
      />

      <Drawer open={open != null} onClose={() => setOpen(null)} width={720}
        title={history?.item ? `${history.item.name} — ${history.item.code}` : ''}>
        {!history ? <Spin /> : (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <StepChart series={Object.entries(history.series).map(([k, s], i) => ({
              label: s.label, points: s.points, color: LINE_COLORS[i % LINE_COLORS.length], key: k,
            }))} />
            <Table
              size="small" pagination={false} tableLayout="fixed" summary={() => null}
              rowKey={(r: any) => `${r.at}|${r.field}`}
              dataSource={history.changes}
              locale={{ emptyText: 'لا توجد تغييرات مسجلة' }}
              columns={[
                { title: 'التاريخ', dataIndex: 'at', key: 'at', width: 140, render: (v: string) => v.replace('T', ' ') },
                { title: 'السعر', dataIndex: 'label', key: 'label', width: 110 },
                { title: 'من', dataIndex: 'old', key: 'old', width: 110, render: (v: string | null) => (v == null ? '—' : money(v)) },
                { title: 'إلى', dataIndex: 'new', key: 'new', width: 110, render: (v: string | null) => (v == null ? '—' : <b>{money(v)}</b>) },
                { title: 'بواسطة', dataIndex: 'by', key: 'by', ellipsis: true },
              ]}
            />
            {!!history.purchases.length && (
              <Table
                size="small" pagination={false} tableLayout="fixed" summary={() => null}
                title={() => (
                  <Space>
                    <b>أسعار الشراء الفعلية</b>
                    {purchaseAvg != null && <Tag color="blue">المتوسط المرجّح: {money(purchaseAvg)}</Tag>}
                  </Space>
                )}
                rowKey={(r: any) => `${r.document}|${r.date}|${r.unit_price}`}
                dataSource={history.purchases}
                columns={[
                  { title: 'التاريخ', dataIndex: 'date', key: 'date', width: 110 },
                  { title: 'الفاتورة', dataIndex: 'document', key: 'document', width: 140 },
                  { title: 'الكمية', dataIndex: 'quantity', key: 'quantity', width: 100,
                    render: (v: string) => num(v).toLocaleString(numeralsLocale()) },
                  { title: 'سعر الوحدة', dataIndex: 'unit_price', key: 'unit_price',
                    render: (v: string) => money(v) },
                ]}
              />
            )}
          </Space>
        )}
      </Drawer>
    </Card>
  );
}

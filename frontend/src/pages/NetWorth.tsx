import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, Collapse, DatePicker, Empty, Row, Segmented, Select, Space, Spin, Table, Tag,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { money, numeralsLocale } from '../utils/money';

interface Line { name: string; branch?: string | null; kind?: string; count?: number; value: string }
interface Section {
  key: string; label: string; liability: boolean; total: string; rows: Line[];
  missing_cost?: number; fallback?: number; by_category?: { name: string; value: string }[];
}
interface Option { key: string; label: string }
interface Report {
  as_of: string; sections: Section[]; assets: string; liabilities: string; net: string;
  basis: string; price_field: string; period_from: string; bases: Option[]; price_fields: Option[];
}

const COLORS: Record<string, string> = {
  cash: '#1677ff', inventory: '#52c41a', fixed_assets: '#faad14', receivables: '#13c2c2',
  payables: '#f5222d',
};
const PREF = 'net-worth:valuation';
const n = (v: any) => Number(v || 0);
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const fmtPct = (v: number) => `${v.toLocaleString(numeralsLocale(), { maximumFractionDigits: 1 })}٪`;

function loadPref() {
  try {
    return JSON.parse(localStorage.getItem(PREF) || '{}');
  } catch {
    return {};
  }
}

export default function NetWorth() {
  const saved = loadPref();
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [branch, setBranch] = useState<number | null>(null);
  const [basis, setBasis] = useState<string>(saved.basis || 'avg_purchase');
  const [field, setField] = useState<string>(saved.field || 'sale_price');
  const [from, setFrom] = useState<Dayjs>(dayjs().subtract(1, 'year'));
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (o: Partial<{ asOf: Dayjs; branch: number | null; basis: string; field: string; from: Dayjs }> = {}) => {
    const p = { asOf, branch, basis, field, from, ...o };
    setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/net-worth', {
        params: {
          as_of: p.asOf.format('YYYY-MM-DD'), branch_id: p.branch ?? undefined,
          basis: p.basis, price_field: p.field, period_from: p.from.format('YYYY-MM-DD'),
        },
      });
      setData(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.get('/api/v1/branches')
      .then((r) => setBranches((r.data || []).filter((x: any) => x.active !== false)))
      .catch(() => setBranches([]));
    load();
  }, []);

  const change = (o: Partial<{ asOf: Dayjs; branch: number | null; basis: string; field: string; from: Dayjs }>) => {
    if (o.asOf) setAsOf(o.asOf);
    if (o.branch !== undefined) setBranch(o.branch);
    if (o.basis) setBasis(o.basis);
    if (o.field) setField(o.field);
    if (o.from) setFrom(o.from);
    if (o.basis || o.field) {
      try {
        localStorage.setItem(PREF, JSON.stringify({ basis: o.basis || basis, field: o.field || field }));
      } catch {}
    }
    load(o);
  };

  const assets = data ? data.sections.filter((s) => !s.liability) : [];
  const assetsTotal = n(data?.assets);

  const matrix = useMemo(() => {
    if (!data || branch != null) return null;
    const names = Array.from(new Set(data.sections.flatMap((s) => s.rows.map((r) => r.branch || 'عام'))));
    const order = branches.map((b) => b.name).filter((x) => names.includes(x));
    const cols = [...order, ...names.filter((x) => !order.includes(x))].filter((c) => data.sections.some(
      (s) => s.rows.some((r) => (r.branch || 'عام') === c && n(r.value) !== 0)));
    const rows = data.sections.map((s) => {
      const r: any = { key: s.key, label: s.label, liability: s.liability, total: n(s.total) };
      cols.forEach((c) => { r[c] = 0; });
      s.rows.forEach((x) => { r[x.branch || 'عام'] += n(x.value); });
      return r;
    });
    const net: any = { key: 'net', label: 'صافي القيمة', net: true, total: n(data.net) };
    cols.forEach((c) => {
      net[c] = rows.reduce((t, r) => t + (r.liability ? -r[c] : r[c]), 0);
    });
    return { cols, rows: [...rows, net] };
  }, [data, branch, branches]);

  const needsField = basis === 'avg_list' || basis === 'list';
  const needsFrom = basis === 'avg_list' || basis === 'avg_purchase';

  const detailColumns = (s: Section) => [
    { title: 'البند', dataIndex: 'name', key: 'name', ellipsis: true },
    ...(s.key === 'cash' ? [{ title: 'النوع', dataIndex: 'kind', key: 'kind', width: 90 }] : []),
    ...(branch == null ? [{ title: 'الفرع', dataIndex: 'branch', key: 'branch', width: 110,
      render: (v: string | null) => v || 'عام' }] : []),
    ...(s.rows.some((r) => r.count != null) ? [{ title: 'العدد', dataIndex: 'count', key: 'count', width: 80,
      align: 'center' as const,
      render: (v?: number) => (v == null ? '' : Number(v).toLocaleString(numeralsLocale())) }] : []),
    { title: 'القيمة', dataIndex: 'value', key: 'value', width: 160, align: 'left' as const,
      render: (v: string) => money(v) },
    { title: 'النسبة', key: 'share', width: 90, align: 'center' as const,
      render: (_: any, r: Line) => fmtPct(pct(n(r.value), n(s.total))) },
  ];

  const sectionBody = (s: Section) => {
    const table = (rows: Line[], cols = detailColumns(s)) => (
      <Table size="small" tableLayout="fixed" pagination={false} dataSource={rows} columns={cols}
        rowKey={(r: Line) => `${r.name}|${r.branch ?? ''}|${r.kind ?? ''}`} locale={{ emptyText: 'لا يوجد' }} />
    );
    if (s.key !== 'inventory') return table(s.rows);
    return (
      <Row gutter={[16, 12]}>
        <Col xs={24} xl={14}>{table(s.rows)}</Col>
        <Col xs={24} xl={10}>
          {table((s.by_category || []).map((c) => ({ name: c.name, value: c.value })), [
            { title: 'الفئة', dataIndex: 'name', key: 'name', ellipsis: true },
            { title: 'القيمة', dataIndex: 'value', key: 'value', width: 150, align: 'left' as const,
              render: (v: string) => money(v) },
            { title: 'النسبة', key: 'share', width: 80, align: 'center' as const,
              render: (_: any, r: Line) => fmtPct(pct(n(r.value), n(s.total))) },
          ])}
        </Col>
      </Row>
    );
  };

  return (
    <Card
      title="تقييم الممتلكات"
      extra={(
        <Space wrap>
          <Select style={{ minWidth: 140 }} value={branch ?? 0}
            onChange={(v: number) => change({ branch: v || null })}
            options={[{ value: 0, label: 'كل الفروع' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          <DatePicker value={asOf} allowClear={false} format="YYYY-MM-DD"
            onChange={(d) => d && change({ asOf: d })} />
          <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
        </Space>
      )}
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <span style={{ fontWeight: 600 }}>تقييم المخزون:</span>
        <Segmented
          value={basis}
          onChange={(v) => change({ basis: String(v) })}
          options={(data?.bases || [{ key: 'average', label: 'متوسط التكلفة' }]).map((b) => ({ value: b.key, label: b.label }))}
        />
        {needsField && (
          <Select style={{ minWidth: 140 }} value={field} onChange={(v) => change({ field: v })}
            options={(data?.price_fields || []).map((f) => ({ value: f.key, label: f.label }))} />
        )}
        {needsFrom && (
          <Space size={4}>
            <span>من</span>
            <DatePicker value={from} allowClear={false} format="YYYY-MM-DD"
              onChange={(d) => d && change({ from: d })} />
          </Space>
        )}
      </Space>

      <Spin spinning={loading}>
        {!data ? <Empty description="لا توجد بيانات" /> : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              {[
                { t: 'إجمالي الممتلكات', v: data.assets, c: '#389e0d', bg: '#f6ffed', b: '#d9f7be' },
                { t: 'إجمالي الالتزامات', v: data.liabilities, c: '#cf1322', bg: '#fff1f0', b: '#ffccc7' },
                { t: 'صافي القيمة', v: data.net, c: '#0958d9', bg: '#e6f4ff', b: '#91caff' },
              ].map((k) => (
                <Col xs={24} md={8} key={k.t}>
                  <div style={{ background: k.bg, border: `1px solid ${k.b}`, borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ color: '#595959', fontSize: 14 }}>{k.t}</div>
                    <div style={{ color: k.c, fontSize: 26, fontWeight: 700, whiteSpace: 'nowrap' }}>{money(k.v)}</div>
                  </div>
                </Col>
              ))}
            </Row>

            {assetsTotal > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', background: '#f0f0f0' }}>
                  {assets.filter((s) => n(s.total) > 0).map((s) => (
                    <div key={s.key} title={`${s.label}: ${money(s.total)}`}
                      style={{ width: `${pct(n(s.total), assetsTotal)}%`, background: COLORS[s.key] }} />
                  ))}
                </div>
                <Space wrap size={16} style={{ marginTop: 8 }}>
                  {assets.map((s) => (
                    <span key={s.key} style={{ fontSize: 13 }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                        background: COLORS[s.key], marginInlineEnd: 6 }} />
                      {s.label} {fmtPct(pct(n(s.total), assetsTotal))}
                    </span>
                  ))}
                </Space>
              </div>
            )}

            {matrix && (
              <Table
                size="small" tableLayout="fixed" pagination={false} style={{ marginBottom: 20 }}
                rowKey="key" dataSource={matrix.rows} summary={() => null}
                onRow={(r: any) => ({ style: r.net ? { fontWeight: 700, background: '#fafafa' } : undefined })}
                columns={[
                  { title: 'البند', dataIndex: 'label', key: 'label', width: 170,
                    render: (v: string, r: any) => (
                      <Space size={6}>
                        {!r.net && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: COLORS[r.key] }} />}
                        {v}
                      </Space>
                    ) },
                  ...matrix.cols.map((c) => ({
                    title: c, dataIndex: c, key: c, align: 'left' as const,
                    render: (v: number, r: any) => (
                      <span style={{ color: r.liability ? '#cf1322' : undefined }}>{money(v)}</span>
                    ),
                  })),
                  { title: 'الإجمالي', dataIndex: 'total', key: 'total', align: 'left' as const,
                    render: (v: number, r: any) => (
                      <b style={{ color: r.liability ? '#cf1322' : r.net ? '#0958d9' : undefined }}>{money(v)}</b>
                    ) },
                ]}
              />
            )}

            <Collapse
              defaultActiveKey={['inventory']}
              items={data.sections.map((s) => ({
                key: s.key,
                label: (
                  <Space wrap>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: COLORS[s.key] }} />
                    <b>{s.label}</b>
                    {s.key === 'inventory' && !!s.fallback && (
                      <Tag color="gold">{`${s.fallback} صنف بمتوسط التكلفة لعدم وجود سعر`}</Tag>
                    )}
                    {s.key === 'inventory' && !!s.missing_cost && (
                      <Tag color="orange">{`${s.missing_cost} صنف بلا سعر`}</Tag>
                    )}
                  </Space>
                ),
                extra: <b style={{ color: s.liability ? '#cf1322' : '#389e0d' }}>{money(s.total)}</b>,
                children: sectionBody(s),
              }))}
            />
          </>
        )}
      </Spin>
    </Card>
  );
}

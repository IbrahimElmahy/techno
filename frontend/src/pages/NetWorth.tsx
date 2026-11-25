import React, { useEffect, useState } from 'react';
import { Button, Card, Col, DatePicker, Empty, Row, Select, Space, Spin, Table, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { Statistic } from '../components/Statistic';
import { money, numeralsLocale } from '../utils/money';

interface Line { name: string; branch?: string | null; kind?: string; count?: number; value: string }
interface Section { key: string; label: string; liability: boolean; total: string; rows: Line[]; missing_cost?: number }
interface Report { as_of: string; sections: Section[]; assets: string; liabilities: string; net: string }

export default function NetWorth() {
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [branch, setBranch] = useState<number | null>(null);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (d = asOf, b = branch) => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/net-worth', {
        params: { as_of: d.format('YYYY-MM-DD'), branch_id: b ?? undefined },
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

  const showBranch = branch == null;
  const columns = (s: Section) => [
    { title: 'البند', dataIndex: 'name', key: 'name' },
    ...(s.key === 'cash' ? [{ title: 'النوع', dataIndex: 'kind', key: 'kind', width: 90 }] : []),
    ...(showBranch ? [{ title: 'الفرع', dataIndex: 'branch', key: 'branch', width: 120,
      render: (v: string | null) => v || '—' }] : []),
    ...(s.rows.some((r) => r.count != null) ? [{ title: 'العدد', dataIndex: 'count', key: 'count', width: 80,
      align: 'center' as const,
      render: (v: number | undefined) => (v == null ? '' : Number(v).toLocaleString(numeralsLocale())) }] : []),
    { title: 'القيمة', dataIndex: 'value', key: 'value', width: 170, align: 'left' as const,
      render: (v: string) => money(v) },
  ];

  const tone = (s: Section) => (s.liability ? '#cf1322' : '#389e0d');

  return (
    <Card
      title="تقييم الممتلكات"
      extra={(
        <Space wrap>
          <Select
            style={{ minWidth: 150 }}
            value={branch ?? 0}
            onChange={(v: number) => { const b = v || null; setBranch(b); load(asOf, b); }}
            options={[{ value: 0, label: 'كل الفروع' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
          <DatePicker
            value={asOf}
            allowClear={false}
            format="YYYY-MM-DD"
            onChange={(d) => { if (d) { setAsOf(d); load(d, branch); } }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
        </Space>
      )}
    >
      <Spin spinning={loading}>
        {!data ? <Empty description="لا توجد بيانات" /> : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              <Col xs={24} md={8}>
                <Card size="small" style={{ background: '#f6ffed', borderColor: '#d9f7be' }}>
                  <Statistic title="إجمالي الممتلكات" value={money(data.assets)}
                    valueStyle={{ color: '#389e0d', fontSize: 22 }} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small" style={{ background: '#fff1f0', borderColor: '#ffccc7' }}>
                  <Statistic title="إجمالي الالتزامات" value={money(data.liabilities)}
                    valueStyle={{ color: '#cf1322', fontSize: 22 }} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small" style={{ background: '#e6f4ff', borderColor: '#91caff' }}>
                  <Statistic title="صافي القيمة" value={money(data.net)}
                    valueStyle={{ color: '#0958d9', fontSize: 22, fontWeight: 700 }} />
                </Card>
              </Col>
            </Row>

            <Row gutter={[12, 12]}>
              {data.sections.map((s) => (
                <Col xs={24} lg={12} key={s.key}>
                  <Card
                    size="small"
                    title={(
                      <Space>
                        {s.label}
                        {!!s.missing_cost && <Tag color="orange">{`${s.missing_cost} صنف بلا تكلفة`}</Tag>}
                      </Space>
                    )}
                    extra={<b style={{ color: tone(s) }}>{money(s.total)}</b>}
                  >
                    <Table
                      size="small"
                      rowKey={(r: Line) => `${r.name}|${r.branch ?? ''}|${r.kind ?? ''}`}
                      dataSource={s.rows}
                      columns={columns(s)}
                      pagination={false}
                      locale={{ emptyText: 'لا يوجد' }}
                    />
                  </Card>
                </Col>
              ))}
            </Row>
          </>
        )}
      </Spin>
    </Card>
  );
}

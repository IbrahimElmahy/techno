/**
 * التدفق النقدي — اتفصل عن `FinanceReports.tsx`.
 *
 * التبويب ده بيقرا الدفتر كله، فبيجيب داتاه بنفسه أول ما يتفتح بدل ما يتحمّل مع
 * كل فتحة للصفحة زي التقارير اللي قبله. عشان كده هو مكوّن مستقل بحالته، والأب
 * بيديله الفترة وبس.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Select, Space, Statistic, Table, Tag,
} from 'antd';
import { ReloadOutlined, LinkOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useQueryTab } from '../../components/useQueryTab';
import { money, CashFlow, CashFlowLine, CashFlowSection } from './types';

import StatsRow from '../../components/StatsRow';
export default function CashFlowTab({ params }: { params: () => Record<string, string> }) {
  const [cash, setCash] = useState<CashFlow | null>(null);
  const [cashLoading, setCashLoading] = useState(false);

  const loadCash = useCallback(async () => {
    setCashLoading(true);
    try {
      const r = await api.get<CashFlow>('/api/v1/reports/cash-flow', { params: params() });
      setCash(r.data);
    } catch {
    } finally {
      setCashLoading(false);
    }
  }, [params]);

  useEffect(() => { loadCash(); }, [loadCash]);

  return (
    <Card
      title="التدفق النقدي"
      extra={
        <Button icon={<ReloadOutlined />} onClick={loadCash}
                loading={cashLoading}>تحديث</Button>
      }
    >
      {cash && (
        <>
          {!cash.consistent && (
            <Alert
              type="warning" showIcon style={{ marginBottom: 12 }}
              message="فيه قيد فيه حركة خزينة ومش متوازن — الفرق طالع في «غير موزّع»."
            />
          )}
          <StatsRow gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="نقدية أول المدة" value={Number(cash.opening)} precision={2} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="صافي التغيّر" value={Number(cash.net_change)} precision={2}
                  valueStyle={{ color: Number(cash.net_change) >= 0 ? '#2e9e6b' : '#d64545' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title="نقدية آخر المدة" value={Number(cash.closing)} precision={2}
                           valueStyle={{ color: '#0e4c6d' }} />
              </Card>
            </Col>
          </StatsRow>
          {cash.sections.map((sec) => (
            <Table<CashFlowLine>
              key={sec.key}
              rowKey={(r) => `${sec.key}:${r.account_id ?? 'x'}`}
              size="small"
              pagination={false}
              style={{ marginBottom: 16 }}
              loading={cashLoading}
              dataSource={sec.lines}
              title={() => (
                <Space>
                  <b>{sec.label}</b>
                  <Tag color={Number(sec.net) >= 0 ? 'green' : 'red'}>{money(sec.net)}</Tag>
                </Space>
              )}
              columns={[
                {
                  title: 'الحساب المقابل',
                  key: 'acc',
                  render: (_: unknown, r: CashFlowLine) =>
                    r.name || r.code || `#${r.account_id}`,
                },
                {
                  title: 'داخل', dataIndex: 'inflow', width: 150, align: 'left' as const,
                  render: (v: string) => (Number(v) ? money(v) : ''),
                },
                {
                  title: 'خارج', dataIndex: 'outflow', width: 150, align: 'left' as const,
                  render: (v: string) => (Number(v) ? money(v) : ''),
                },
                {
                  title: 'الصافي', dataIndex: 'net', width: 150, align: 'left' as const,
                  render: (v: string) => <b>{money(v)}</b>,
                },
              ]}
            />
          ))}
        </>
      )}
    </Card>
  );
}

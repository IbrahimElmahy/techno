/**
 * التدفق النقدي — اتفصل عن `FinanceReports.tsx`.
 *
 * التبويب ده بيقرا الدفتر كله، فبيجيب داتاه بنفسه أول ما يتفتح بدل ما يتحمّل مع
 * كل فتحة للصفحة زي التقارير اللي قبله. عشان كده هو مكوّن مستقل بحالته، والأب
 * بيديله الفترة وبس.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Button, Space, Tag } from 'antd';
// فلتر على كل عمود — شوف `FilterTable`.
import { FilterTable as Table } from '../../components/FilterTable';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../../api/client';
import { money, CashFlow, CashFlowLine, CashFlowSection } from './types';

import { useCanSeeStats } from '../../components/StatsRow';
import type { TabSlots } from './PartnerLedgerTab';

export default function CashFlowTab({ params, slots }: {
  params: () => Record<string, string>;
  slots?: TabSlots;
}) {
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

  // كروت الإجماليات بقت سطر — ولسه للي عنده `stats.view` بس.
  const canSeeStats = useCanSeeStats();

  return (
    <div>
      {slots?.actions && createPortal(
        <Button icon={<ReloadOutlined />} onClick={loadCash}
                loading={cashLoading}>تحديث</Button>,
        slots.actions,
      )}
      {cash && (
        <>
          {!cash.consistent && (
            <Alert
              type="warning" showIcon style={{ margin: '6px 0 8px' }}
              message="فيه قيد فيه حركة خزينة ومش متوازن — الفرق طالع في «غير موزّع»."
            />
          )}
          {canSeeStats && (
            <div style={{ padding: '8px 4px 10px' }}>
              <span className="sl-foot">
                <span>نقدية أول المدة: <b>{money(cash.opening)}</b></span>
                <span>
                  صافي التغيّر:{' '}
                  <b className={Number(cash.net_change) >= 0 ? 'is-pos' : 'is-neg'}>{money(cash.net_change)}</b>
                </span>
                <span>نقدية آخر المدة: <b>{money(cash.closing)}</b></span>
              </span>
            </div>
          )}
          {cash.sections.map((sec) => (
            <Table<CashFlowLine>
              key={sec.key}
              className="sl-table"
              rowKey={(r) => `${sec.key}:${r.account_id ?? 'x'}`}
              size="small"
              pagination={false}
              style={{ marginBottom: 12 }}
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
    </div>
  );
}

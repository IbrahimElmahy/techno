/**
 * دفتر الشريك — اتفصل عن `FinanceReports.tsx`.
 *
 * التبويب ده بيقرا الدفتر كله، فبيجيب داتاه بنفسه أول ما يتفتح بدل ما يتحمّل مع
 * كل فتحة للصفحة زي التقارير اللي قبله. عشان كده هو مكوّن مستقل بحالته، والأب
 * بيديله الفترة وبس.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Row, Select, Space, Statistic, Table, Tag } from 'antd';
import { ReloadOutlined, LinkOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useQueryTab } from '../../components/useQueryTab';
import { money, PartnerLedgerRow, PartnerLedgerLine } from './types';

export default function PartnerLedgerTab({ params }: { params: () => Record<string, string> }) {
  const navigate = useNavigate();
  const [partnerRows, setPartnerRows] = useState<PartnerLedgerRow[]>([]);
  const [partnerKind, setPartnerKind] = useQueryTab('customer', 'pkind') as
    unknown as [string, (v: string) => void];
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [partnerLoading, setPartnerLoading] = useState(false);

  const loadPartner = useCallback(async () => {
    setPartnerLoading(true);
    try {
      const r = await api.get<PartnerLedgerRow[]>('/api/v1/reports/partner-ledger', {
        params: { ...params(), partner_kind: partnerKind, only_open: onlyOpen },
      });
      setPartnerRows(r.data);
    } catch {
    } finally {
      setPartnerLoading(false);
    }
  }, [params, partnerKind, onlyOpen]);

  useEffect(() => { loadPartner(); }, [loadPartner]);

  return (
    <Card
      title="دفتر الشريك"
      extra={
        <Space>
          <Select
            value={partnerKind}
            style={{ width: 140 }}
            onChange={(v) => setPartnerKind(v)}
            options={[
              { value: 'customer', label: 'العملاء' },
              { value: 'supplier', label: 'الموردين' },
              { value: 'employee', label: 'الموظفين' },
            ]}
          />
          <Select
            value={onlyOpen ? 'open' : 'all'}
            style={{ width: 170 }}
            onChange={(v) => setOnlyOpen(v === 'open')}
            options={[
              { value: 'all', label: 'كل الأطراف' },
              { value: 'open', label: 'اللي عليه مفتوح بس' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={loadPartner}
                  loading={partnerLoading}>تحديث</Button>
        </Space>
      }
    >
      <Table<PartnerLedgerRow>
        rowKey={(r) => `${r.partner_kind}:${r.partner_id}`}
        size="small"
        loading={partnerLoading}
        dataSource={partnerRows}
        pagination={{ defaultPageSize: 20, showTotal: (t) => `إجمالي ${t}` }}
        expandable={{
          expandedRowRender: (row) => (
            <Table<PartnerLedgerLine>
              rowKey="line_id"
              size="small"
              pagination={false}
              dataSource={row.lines}
              columns={[
                { title: 'التاريخ', dataIndex: 'entry_date', width: 110 },
                {
                  title: 'المستند',
                  key: 'doc',
                  width: 180,
                  render: (_: unknown, r: PartnerLedgerLine) => (
                    <Button type="link" size="small"
                      onClick={() => navigate(`/general-ledger?doc=${r.entry_id}`)}>
                      {r.entry_number || `#${r.entry_id}`}
                    </Button>
                  ),
                },
                { title: 'النوع', dataIndex: 'move_type_label', width: 120 },
                {
                  title: 'البيان',
                  key: 'text',
                  render: (_: unknown, r: PartnerLedgerLine) =>
                    r.statement || r.description || '',
                },
                { title: 'الاستحقاق', dataIndex: 'date_maturity', width: 110 },
                {
                  title: 'مدين', dataIndex: 'debit', width: 120, align: 'left' as const,
                  render: (v: string) => (Number(v) ? money(v) : ''),
                },
                {
                  title: 'دائن', dataIndex: 'credit', width: 120, align: 'left' as const,
                  render: (v: string) => (Number(v) ? money(v) : ''),
                },
                {
                  title: 'الرصيد', dataIndex: 'balance', width: 130, align: 'left' as const,
                  render: (v: string) => <b>{money(v)}</b>,
                },
                {
                  title: 'المتبقّي', dataIndex: 'residual', width: 120, align: 'left' as const,
                  render: (v: string | null) =>
                    v === null ? '—' : Number(v) ? money(v) : <Tag color="green">مقفول</Tag>,
                },
                {
                  title: 'المطابقة', dataIndex: 'reconcile_number', width: 110,
                  render: (v: string | null) => (v ? <Tag>{v}</Tag> : ''),
                },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'الطرف', dataIndex: 'partner_name' },
          {
            title: 'أول المدة', dataIndex: 'opening', width: 130, align: 'left' as const,
            render: (v: string) => money(v),
          },
          {
            title: 'مدين', dataIndex: 'debit', width: 130, align: 'left' as const,
            render: (v: string) => money(v),
          },
          {
            title: 'دائن', dataIndex: 'credit', width: 130, align: 'left' as const,
            render: (v: string) => money(v),
          },
          {
            title: 'آخر المدة', dataIndex: 'closing', width: 140, align: 'left' as const,
            render: (v: string) => <b>{money(v)}</b>,
          },
          {
            title: 'المفتوح', dataIndex: 'open_residual', width: 130, align: 'left' as const,
            render: (v: string) => (Number(v) ? money(v) : ''),
          },
          {
            title: '',
            key: 'reconcile',
            width: 110,
            render: (_: unknown, r: PartnerLedgerRow) => (
              <Button type="link" size="small" icon={<LinkOutlined />}
                onClick={() => navigate(
                  `/reconciliation?kind=${r.partner_kind}&partner=${r.partner_id}`)}>
                تسوية
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}

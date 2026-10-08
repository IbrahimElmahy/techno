import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PAGE_SIZE } from '../../utils/pagination';
import { Alert, Button, Select, Tag } from 'antd';
import { FilterTable as Table } from '../../components/FilterTable';
import { ReloadOutlined, LinkOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useQueryTab } from '../../components/useQueryTab';
import StatementFilter, { statementMatches } from '../../components/StatementFilter';
import { money, PartnerLedgerRow, PartnerLedgerLine } from './types';

export interface TabSlots { filters: HTMLElement | null; actions: HTMLElement | null }

export default function PartnerLedgerTab({ params, slots }: {
  params: () => Record<string, string>;
  slots?: TabSlots;
}) {
  const navigate = useNavigate();
  const [partnerRows, setPartnerRows] = useState<PartnerLedgerRow[]>([]);
  const [partnerKind, setPartnerKind] = useQueryTab('customer', 'pkind') as
    unknown as [string, (v: string) => void];
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [partnerLoading, setPartnerLoading] = useState(false);
  const [stmtQ, setStmtQ] = useState('');

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

  const shownRows = useMemo(() => {
    if (!stmtQ) return partnerRows;
    return partnerRows
      .map((r) => {
        const lines = r.lines.filter((l) => statementMatches(stmtQ, l.statement, l.description));
        return {
          ...r,
          lines,
          debit: String(lines.reduce((t, l) => t + Number(l.debit || 0), 0)),
          credit: String(lines.reduce((t, l) => t + Number(l.credit || 0), 0)),
        };
      })
      .filter((r) => r.lines.length);
  }, [partnerRows, stmtQ]);

  return (
    <div>
      {slots?.filters && createPortal(
        <>
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
          <StatementFilter value={stmtQ} onChange={setStmtQ} style={{ width: 200 }} />
        </>,
        slots.filters,
      )}
      {slots?.actions && createPortal(
        <Button icon={<ReloadOutlined />} onClick={loadPartner}
                loading={partnerLoading}>تحديث</Button>,
        slots.actions,
      )}
      {!!stmtQ && (
        <Alert
          type="info" showIcon style={{ margin: '6px 0 8px' }}
          message={`بيان «${stmtQ}» — ${shownRows.length} طرف من ${partnerRows.length}`}
          description="المدين والدائن للسطور المطابقة للبيان فقط؛ أول وآخر المدة رصيد الطرف كله."
        />
      )}
      <Table<PartnerLedgerRow>
        className="sl-table"
        rowKey={(r) => `${r.partner_kind}:${r.partner_id}`}
        size="small"
        loading={partnerLoading}
        dataSource={shownRows}
        pagination={{
          defaultPageSize: PAGE_SIZE,
          locale: { items_per_page: '' },
          showTotal: (t) => <span className="sl-foot"><span>إجمالي الأطراف: <b>{t}</b></span></span>,
        }}
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
            title: stmtQ ? 'مدين (المطابق)' : 'مدين', dataIndex: 'debit', width: 130,
            align: 'left' as const,
            render: (v: string) => money(v),
          },
          {
            title: stmtQ ? 'دائن (المطابق)' : 'دائن', dataIndex: 'credit', width: 130,
            align: 'left' as const,
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
    </div>
  );
}

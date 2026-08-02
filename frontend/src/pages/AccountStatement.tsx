import React, { useEffect, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Empty, Row, Select, Statistic, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import DocumentLink, { DocKind } from '../components/DocumentLink';

/**
 * كشف حساب — any account in the chart, not only customers and suppliers.
 *
 * The party statements on the customer and supplier files already ran a balance; the same
 * question applies to a treasury, a bank, an expense or a revenue account, and there was no
 * reason only two account types could be asked it. Every row carries the balance before the
 * movement and after it, so a disputed figure can be read off one line.
 */

interface StatementLine {
  doc_kind?: DocKind | null;
  doc_id?: number | null;
  doc_number?: string | null;
  entry_id: number;
  entry_date: string;
  entry_type: string;
  description: string;
  debit: string;
  credit: string;
  balance_before: string;
  balance: string;
}

interface StatementOut {
  account_id: number;
  account_name: string;
  opening_balance: string;
  closing_balance: string;
  total_debit: string;
  total_credit: string;
  lines: StatementLine[];
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function AccountStatement() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [statement, setStatement] = useState<StatementOut | null>(null);
  const [loading, setLoading] = useState(false);
  // ?account=<id> — the customer and supplier files hand the account over rather than making the
  // reader find it again in a dropdown they have just come from.
  const [search] = useSearchParams();
  const asked = Number(search.get('account')) || undefined;
  useEffect(() => { if (asked) setAccountId(asked); }, [asked]);

  useEffect(() => {
    api.get('/api/v1/accounts')
      .then((r) => setAccounts(r.data || []))
      .catch(console.error);
  }, []);

  const load = async () => {
    if (!accountId) { setStatement(null); return; }
    setLoading(true);
    try {
      const params: any = {};
      if (range) {
        params.date_from = range[0].format('YYYY-MM-DD');
        params.date_to = range[1].format('YYYY-MM-DD');
      }
      const res = await api.get(`/api/v1/accounts/${accountId}/statement`, { params });
      setStatement(res.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل كشف الحساب');
      setStatement(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [accountId, range]);

  const exportCsv = () => {
    if (!statement?.lines.length) { message.info('لا توجد حركات للتصدير'); return; }
    const heads = ['التاريخ', 'النوع', 'البيان', 'الرصيد قبل', 'مدين', 'دائن', 'الرصيد بعد'];
    const lines = [heads.join(',')];
    statement.lines.forEach((l) => lines.push([
      String(l.entry_date).slice(0, 10), l.entry_type, l.description,
      l.balance_before, l.debit, l.credit, l.balance,
    ].map((v) => `"${v ?? ''}"`).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `statement-${statement.account_id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      title="كشف حساب"
      extra={(
        <>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}
            disabled={!statement?.lines.length} style={{ marginInlineEnd: 8 }}>تصدير CSV</Button>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={!accountId}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={10}>
          <Select
            showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="اختر الحساب" value={accountId} onChange={setAccountId}
            options={accounts.map((a) => ({
              value: a.id,
              label: a.code ? `${a.code} — ${a.name}` : (a.name || `حساب #${a.id}`),
            }))}
          />
        </Col>
        <Col xs={24} md={8}>
          <DatePicker.RangePicker
            style={{ width: '100%' }} value={range as any} allowClear
            onChange={(v) => setRange(v as any)} placeholder={['من تاريخ', 'إلى تاريخ']}
          />
        </Col>
      </Row>

      {!accountId && <Empty description="اختر حساباً لعرض كشفه" />}

      {statement && (
        <>
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="رصيد أول المدة" value={money(statement.opening_balance)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="إجمالي مدين" value={money(statement.total_debit)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="إجمالي دائن" value={money(statement.total_credit)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={`الرصيد — ${statement.account_name}`}
                  value={money(statement.closing_balance)}
                  valueStyle={{ color: '#0B5CA8' }} />
              </Card>
            </Col>
          </Row>

          <Table<StatementLine>
            rowKey={(l) => `${l.entry_id}-${l.entry_date}-${l.balance}`}
            size="small" loading={loading} dataSource={statement.lines}
            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
            pagination={{ defaultPageSize: 25, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: 'التاريخ', dataIndex: 'entry_date',
                render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
              { title: 'النوع', dataIndex: 'entry_type',
                render: (t: string) => <Tag>{t}</Tag> },
              { title: 'البيان', dataIndex: 'description' },
              // Their statement has a cost-centre column. The journal line has always carried one
              // and this screen dropped it, so «against which project?» meant opening the entry.
              { title: 'مركز التكلفة', dataIndex: 'cost_center_name', width: 160,
                render: (v: string | null) => v ?? <span style={{ color: '#bbb' }}>-</span> },
              { title: 'الرصيد قبل', dataIndex: 'balance_before', align: 'left',
                render: (v: string) => <span style={{ color: '#8a8a8a' }}>{money(v)}</span> },
              { title: 'مدين', dataIndex: 'debit', align: 'left',
                render: (v: string) => (Number(v) ? money(v) : '-') },
              { title: 'دائن', dataIndex: 'credit', align: 'left',
                render: (v: string) => (Number(v) ? money(v) : '-') },
              { title: 'الرصيد بعد', dataIndex: 'balance', align: 'left',
                render: (v: string) => <b>{money(v)}</b> },
              // The whole point of a statement is to answer «إيه السطر ده؟» — so the answer is
              // one click away rather than a number to memorise and search for elsewhere.
              { title: 'المستند', key: 'doc', align: 'center',
                render: (_: unknown, l: StatementLine) => (l.doc_kind && l.doc_id ? (
                  <DocumentLink kind={l.doc_kind} id={l.doc_id} size="small"
                    label={l.doc_number || undefined}
                    allowEdit={l.doc_kind === 'invoice'} />
                ) : <span style={{ color: '#bbb' }}>قيد يدوي</span>) },
            ]}
          />
        </>
      )}
    </Card>
  );
}

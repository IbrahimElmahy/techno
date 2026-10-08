import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import {
  Alert, Button, Card, Col, Empty, Input, Row, Select, Space, Tag,
  Tooltip, message,
} from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import {
  LinkOutlined, DisconnectOutlined, ReloadOutlined, ThunderboltOutlined, SearchOutlined,
} from '@ant-design/icons';
import ListPage from '../components/ListPage';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { egp } from '../utils/accounts';
import { normalizeAr } from '../components/ListToolbar';
import { useQueryTab } from '../components/useQueryTab';

import { useCanSeeStats } from '../components/StatsRow';

interface OpenLine {
  line_id: number;
  entry_id: number;
  entry_number: string | null;
  move_type: string | null;
  move_type_label: string | null;
  account_id: number;
  account_name: string | null;
  entry_date: string | null;
  date_maturity: string | null;
  description: string;
  statement: string | null;
  direction: 'debit' | 'credit';
  amount: string;
  residual: string;
}

interface OpenPayload {
  lines: OpenLine[];
  total_debit: string;
  total_credit: string;
  balance: string;
}

interface PartnerRow {
  partner_id: number;
  partner_kind: string;
  partner_name: string;
  open_lines: number;
  balance: string;
}

interface MatchedGroup {
  number: string;
  created_at: string | null;
  amount: string;
  lines: OpenLine[];
}

const KIND_LABEL: Record<string, string> = {
  customer: 'عملاء', supplier: 'موردين', employee: 'موظفين',
};

export default function Reconciliation() {
  const canSeeStats = useCanSeeStats();
  const [tab, setTab] = useQueryTab('open');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const kind = params.get('kind') || 'customer';
  const partnerId = params.get('partner') ? Number(params.get('partner')) : null;

  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [data, setData] = useState<OpenPayload | null>(null);
  const [matched, setMatched] = useState<MatchedGroup[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const setParam = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => {
      if (v === null) merged.delete(k); else merged.set(k, v);
    });
    setParams(merged, { replace: true });
  };

  const loadPartners = useCallback(async () => {
    try {
      const { data } = await api.get('/api/v1/reconciliation/partners', {
        params: { partner_kind: kind },
      });
      setPartners(data || []);
    } catch (err) { console.error(err); }
  }, [kind]);

  const loadOpen = useCallback(async () => {
    if (!partnerId) { setData(null); return; }
    setLoading(true);
    try {
      const { data } = await api.get('/api/v1/reconciliation/open', {
        params: { partner_kind: kind, partner_id: partnerId },
      });
      setData(data);
      setSelected([]);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [kind, partnerId]);

  const loadMatched = useCallback(async () => {
    try {
      const { data } = await api.get('/api/v1/reconciliation/matched', {
        params: partnerId ? { partner_kind: kind, partner_id: partnerId } : {},
      });
      setMatched(data || []);
    } catch (err) { console.error(err); }
  }, [kind, partnerId]);

  useEffect(() => { loadPartners(); }, [loadPartners]);
  useEffect(() => { loadOpen(); }, [loadOpen]);
  useEffect(() => { loadMatched(); }, [loadMatched]);

  const reload = () => { loadPartners(); loadOpen(); loadMatched(); };

  const lines = data?.lines || [];
  const debits = useMemo(() => lines.filter((l) => Number(l.residual) > 0), [lines]);
  const credits = useMemo(() => lines.filter((l) => Number(l.residual) < 0), [lines]);

  const selectedTotals = useMemo(() => {
    let d = 0; let c = 0;
    const accounts = new Set<number>();
    lines.filter((l) => selected.includes(l.line_id)).forEach((l) => {
      const r = Number(l.residual);
      if (r > 0) d += r; else c -= r;
      accounts.add(l.account_id);
    });
    return {
      debit: d, credit: c, willMatch: Math.min(d, c),
      accounts: accounts.size,
      sameAccount: accounts.size <= 1,
    };
  }, [lines, selected]);

  const blockReason = selected.length < 2 ? 'اختر فاتورة ودفعة'
    : !selectedTotals.sameAccount ? 'هذه السطور على حسابات مختلفة — تتم المطابقة داخل الحساب الواحد'
    : selectedTotals.willMatch <= 0 ? 'يجب أن يوجد مدين ودائن'
    : `سيتم إقفال ${egp(selectedTotals.willMatch)}`;

  const doReconcile = async () => {
    if (selected.length < 2) { message.error('اختر سطرين على الأقل'); return; }
    try {
      const { data } = await api.post('/api/v1/reconciliation', { line_ids: selected });
      message.success(
        data.number
          ? `تم إقفال ${egp(data.matched)} — رقم المطابقة ${data.number}`
          : `تم إقفال ${egp(data.matched)} جزئياً — ولا يزال هناك متبقٍّ`);
      reload();
    } catch (err) { console.error(err); }
  };

  const doAuto = async () => {
    if (!partnerId) return;
    try {
      const { data } = await api.post('/api/v1/reconciliation/auto', {
        partner_kind: kind, partner_id: partnerId,
      });
      if (Number(data.matched) <= 0) message.info('لا يوجد ما يمكن إقفاله — إما أن الكل مقفل أو أن الكل في اتجاه واحد');
      else message.success(`تم إقفال ${egp(data.matched)} في ${data.groups} مجموعة`);
      reload();
    } catch (err) { console.error(err); }
  };

  const doUnreconcile = async (number: string) => {
    try {
      const { data } = await api.post('/api/v1/reconciliation/unreconcile', { number });
      message.success(`تم فك المطابقة — أُعيد ${data.unlinked} ربط على ${data.entries} مستند`);
      reload();
    } catch (err) { console.error(err); }
  };

  const shownPartners = useMemo(() => {
    const needle = normalizeAr(q.trim());
    if (!needle) return partners;
    return partners.filter((p) => normalizeAr(p.partner_name).includes(needle));
  }, [partners, q]);

  const activePartner = partners.find((p) => p.partner_id === partnerId);

  const lineColumns = (rows: OpenLine[]) => [
    { title: 'المستند', dataIndex: 'entry_number', key: 'entry_number', width: 150,
      render: (n: string | null, r: OpenLine) => (
        <Space size={4}>
          <a onClick={() => navigate(`/general-ledger?tab=journal&entry=${r.entry_id}`)}>
            {n || `#${r.entry_id}`}
          </a>
          {r.move_type_label && <Tag color="purple">{r.move_type_label}</Tag>}
        </Space>
      ) },
    { title: 'التاريخ', dataIndex: 'entry_date', key: 'entry_date', width: 110,
      render: (d: string | null) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'الاستحقاق', dataIndex: 'date_maturity', key: 'date_maturity', width: 110,
      render: (d: string | null) => {
        if (!d) return '-';
        const late = new Date(d) < new Date(new Date().toDateString());
        return late ? <Tag color="red">{d}</Tag> : d;
      } },
    { title: 'البيان', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: 'الحساب', dataIndex: 'account_name', key: 'account_name', width: 150,
      ellipsis: true, render: (v: string | null) => v || '-' },
    { title: 'القيمة', dataIndex: 'amount', key: 'amount', width: 120,
      render: (v: string) => egp(v) },
    { title: 'المتبقّي', dataIndex: 'residual', key: 'residual', width: 130,
      render: (v: string) => <strong>{egp(Math.abs(Number(v)))}</strong> },
  ];

  const table = (rows: OpenLine[], title: string, color: string) => (
    <Card size="small" styles={{ body: { padding: 8 } }}
      title={<span style={{ color }}>{title} — {rows.length}</span>}>
      <Table
        className="sl-table"
        rowKey="line_id" size="small" dataSource={rows} columns={lineColumns(rows)}
        loading={loading} pagination={false} scroll={{ y: 380 }}
        rowSelection={{
          selectedRowKeys: selected.filter((id) => rows.some((r) => r.line_id === id)),
          onChange: (keys) => {
            const others = selected.filter((id) => !rows.some((r) => r.line_id === id));
            setSelected([...others, ...(keys as number[])]);
          },
        }}
        locale={{ emptyText: <Empty description="لا توجد بيانات" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </Card>
  );

  const canMatch = selected.length >= 2 && selectedTotals.sameAccount
    && selectedTotals.willMatch > 0;

  return (
    <>
    <ListPage
      icon={<LinkOutlined />}
      title="تسوية الحسابات"
      muted={activePartner ? `(${activePartner.partner_name})` : undefined}
      tabs={[
        { key: 'open', label: 'المفتوح', count: partners.length },
        { key: 'matched', label: 'المطابقات', count: matched.length },
      ]}
      activeTab={tab} onTabChange={setTab}
      actions={(<>
        {tab === 'open' && partnerId && (<>
          <Tooltip title={blockReason}>
            <Button type="primary" className="sl-create" icon={<LinkOutlined />}
              disabled={!canMatch} onClick={doReconcile}>
              طابق المحدد
              {selectedTotals.willMatch > 0
                && ` (${egp(selectedTotals.willMatch)})`}
            </Button>
          </Tooltip>
          <Button icon={<ThunderboltOutlined />} onClick={doAuto}>
            مطابقة تلقائية — الأقدم أولاً
          </Button>
          {activePartner && (
            <Button type="link"
              onClick={() => navigate(
                kind === 'supplier'
                  ? `/suppliers/${partnerId}`
                  : `/customers/${partnerId}`)}>
              كارت {activePartner.partner_name}
            </Button>
          )}
        </>)}
        <Button icon={<ReloadOutlined />} onClick={reload}>تحديث</Button>
      </>)}
      filters={(<>
        <Select
          value={kind}
          onChange={(v) => setParam({ kind: String(v), partner: null })}
          options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
        />
        {tab === 'open' && (
          <Input className="sl-f-search" placeholder="بحث عن الطرف بالاسم" allowClear value={q}
            prefix={<SearchOutlined />}
            onChange={(e) => setQ(e.target.value)} />
        )}
      </>)}
    >
      {tab === 'open' ? (
        <Row gutter={12} style={{ padding: '8px 0' }}>
          <Col span={6}>
            <Card size="small" title="الأطراف التي عليها مبالغ مفتوحة"
              styles={{ body: { padding: 8 } }}>
              <Table
                className="sl-table"
                rowKey="partner_id" size="small" pagination={false} scroll={{ y: 460 }}
                showHeader={false} dataSource={shownPartners}
                onRow={(r) => ({
                  onClick: () => setParam({ partner: String(r.partner_id) }),
                  style: {
                    cursor: 'pointer',
                    background: r.partner_id === partnerId ? '#f0f7e6' : undefined,
                  },
                })}
                columns={[
                  { title: 'الطرف', dataIndex: 'partner_name', key: 'partner_name',
                    render: (n: string, r: PartnerRow) => (
                      <div>
                        <div>{n}</div>
                        <div style={{ fontSize: 14, color: '#888' }}>
                          {r.open_lines} سطر مفتوح
                        </div>
                      </div>
                    ) },
                  { title: 'الرصيد', dataIndex: 'balance', key: 'balance', width: 110,
                    align: 'end' as const,
                    render: (v: string) => (
                      <strong style={{ color: Number(v) >= 0 ? '#C0392B' : '#6AB42D' }}>
                        {egp(Math.abs(Number(v)))}
                      </strong>
                    ) },
                ]}
                locale={{ emptyText: <Empty description="لا توجد أطراف عليها مبالغ مفتوحة"
                  image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              />
            </Card>
          </Col>
          <Col span={18}>
            {!partnerId ? (
              <Alert type="info" showIcon
                message="اختر طرفاً من القائمة لعرض المبالغ المفتوحة عليه" />
            ) : (
              <>
                {canSeeStats && (
                  <div style={{ marginBottom: 10 }}>
                    <span className="sl-foot">
                      <span>مستحق عليه: <b className="is-neg">{egp(data?.total_debit ?? 0)}</b></span>
                      <span>دفعات بلا فواتير: <b className="is-pos">{egp(data?.total_credit ?? 0)}</b></span>
                      <span>الصافي المفتوح: <b>{egp(data?.balance ?? 0)}</b></span>
                    </span>
                  </div>
                )}
                <Row gutter={12}>
                  <Col span={12}>{table(debits, 'فواتير ومستحقات', '#C0392B')}</Col>
                  <Col span={12}>{table(credits, 'دفعات ومرتجعات', '#6AB42D')}</Col>
                </Row>
              </>
            )}
          </Col>
        </Row>
      ) : (
        <Table
          className="sl-table"
          rowKey="number" size="small" dataSource={matched}
          pagination={{
            defaultPageSize: PAGE_SIZE, showSizeChanger: true, locale: { items_per_page: '' },
            showTotal: (t) => (
              <span className="sl-foot">
                <span>عدد: <b>{t}</b></span>
                <span>إجمالي المطابَق: <b>{egp(matched
                  .reduce((s, g) => s + Number(g.amount || 0), 0))}</b></span>
              </span>
            ),
          }}
          expandable={{
            expandedRowRender: (g: MatchedGroup) => (
              <Table
                rowKey="line_id" size="small" pagination={false} dataSource={g.lines}
                columns={[
                  { title: 'المستند', dataIndex: 'entry_number', key: 'n',
                    render: (n: string | null, r: OpenLine) => (
                      <a onClick={() => navigate(
                        `/general-ledger?tab=journal&entry=${r.entry_id}`)}>
                        {n || `#${r.entry_id}`}
                      </a>
                    ) },
                  { title: 'النوع', dataIndex: 'move_type_label', key: 't',
                    render: (t: string | null) => t ? <Tag color="purple">{t}</Tag> : '-' },
                  { title: 'التاريخ', dataIndex: 'entry_date', key: 'd',
                    render: (d: string | null) => (d ? String(d).slice(0, 10) : '-') },
                  { title: 'البيان', dataIndex: 'description', key: 'desc' },
                  { title: 'الاتجاه', dataIndex: 'direction', key: 'dir',
                    render: (d: string) => (
                      <Tag color={d === 'debit' ? 'red' : 'green'}>
                        {d === 'debit' ? 'مدين' : 'دائن'}
                      </Tag>
                    ) },
                  { title: 'القيمة', dataIndex: 'amount', key: 'a',
                    render: (v: string) => egp(v) },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'رقم المطابقة', dataIndex: 'number', key: 'number', width: 140,
              render: (n: string) => <Tag color="blue">{n}</Tag> },
            { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', width: 130,
              render: (d: string | null) => (d ? String(d).slice(0, 10) : '-') },
            { title: 'المستندات', dataIndex: 'lines', key: 'lines', width: 110,
              render: (ls: OpenLine[]) => `${ls.length} سطر` },
            { title: 'القيمة', dataIndex: 'amount', key: 'amount', width: 130,
              render: (v: string) => <strong>{egp(v)}</strong> },
            { title: '', key: 'actions', width: 140,
              render: (_: unknown, g: MatchedGroup) => (
                <Button type="link" danger icon={<DisconnectOutlined />}
                  onClick={() => doUnreconcile(g.number)}>فك المطابقة</Button>
              ) },
          ]}
          locale={{ emptyText: <Empty description="لا توجد مطابقات بعد"
            image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      )}
    </ListPage>
    </>
  );
}

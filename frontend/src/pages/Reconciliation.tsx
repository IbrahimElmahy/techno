import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Input, Row, Segmented, Space, Statistic, Table, Tabs, Tag,
  Tooltip, message,
} from 'antd';
import {
  LinkOutlined, DisconnectOutlined, ReloadOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api } from '../api/client';
import { egp } from '../utils/accounts';
import { normalizeAr } from '../components/ListToolbar';
import { useQueryTab } from '../components/useQueryTab';

/**
 * تسوية الحسابات — «الفاتورة دي اتدفعت بإيه، وفاضل عليه إيه».
 *
 * الشاشة اللي المرحلة ٣ كلها بتخدمها. قبلها كان رصيد العميل رقم واحد، والسؤال
 * «الرقم ده من إيه» إجابته إن حد يقعد يطرح بإيده من كشف الحساب.
 *
 * **المفتوح مش الحركات.** الجدول بيوري السطور اللي لسه عليها متبقّي بس — فاتورة
 * ماتدفعتش، أو دفعة ملهاش فاتورة. اللي اتقفل بيختفي من هنا ويبان في تبويب
 * «المطابقات» برقمه، وينفع يتفك من هناك لو طلع غلط.
 *
 * **المطابقة التلقائية بتكتب اللي كان مفهوم ضمناً.** «الأقدم يتدفع الأول» هو نفس
 * الافتراض اللي تقرير الأعمار شغّال بيه من زمان من غير ما يكون مكتوب في أي مكان —
 * هنا بيتكتب، بيبقى ليه رقم، وينفع يتفك.
 */

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

  /** المحدد بيتحسب عشان الزرار يقول هيقفل كام قبل ما حد يضغط.
   *
   *  وبيعدّ الحسابات كمان: السيرفر بيرفض مطابقة سطور من حسابات مختلفة، والرفض بعد
   *  الضغط أسوأ من زرار مقفول بيقول السبب — خصوصاً إن الفرق (أبيض/بولي) مش باين في
   *  اسم الطرف.
   */
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

  const blockReason = selected.length < 2 ? 'اختار فاتورة ودفعة'
    : !selectedTotals.sameAccount ? 'السطور دي على حسابات مختلفة — المطابقة جوّه الحساب الواحد'
    : selectedTotals.willMatch <= 0 ? 'لازم يكون فيه مدين ودائن'
    : `هيتقفل ${egp(selectedTotals.willMatch)}`;

  const doReconcile = async () => {
    if (selected.length < 2) { message.error('اختار سطرين على الأقل'); return; }
    try {
      const { data } = await api.post('/api/v1/reconciliation', { line_ids: selected });
      message.success(
        data.number
          ? `اتقفل ${egp(data.matched)} — رقم المطابقة ${data.number}`
          : `اتقفل ${egp(data.matched)} جزئياً — لسه فيه متبقّي`);
      reload();
    } catch (err) { console.error(err); }
  };

  const doAuto = async () => {
    if (!partnerId) return;
    try {
      const { data } = await api.post('/api/v1/reconciliation/auto', {
        partner_kind: kind, partner_id: partnerId,
      });
      if (Number(data.matched) <= 0) message.info('مافيش حاجة تتقفل — إما كله مقفول أو كله في اتجاه واحد');
      else message.success(`اتقفل ${egp(data.matched)} في ${data.groups} مجموعة`);
      reload();
    } catch (err) { console.error(err); }
  };

  const doUnreconcile = async (number: string) => {
    try {
      const { data } = await api.post('/api/v1/reconciliation/unreconcile', { number });
      message.success(`اتفكّت المطابقة — ${data.unlinked} ربط رجع على ${data.entries} مستند`);
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
    { title: 'التاريخ', dataIndex: 'entry_date', key: 'entry_date', width: 110 },
    { title: 'الاستحقاق', dataIndex: 'date_maturity', key: 'date_maturity', width: 110,
      render: (d: string | null) => {
        if (!d) return '-';
        const late = new Date(d) < new Date(new Date().toDateString());
        return late ? <Tag color="red">{d}</Tag> : d;
      } },
    { title: 'البيان', dataIndex: 'description', key: 'description', ellipsis: true },
    // العميل ممكن يبقى ليه أكتر من حساب (أبيض/بولي)، والمطابقة بتبقى جوّه الحساب
    // الواحد — فالعمود ده هو اللي بيقول ليه سطرين مايتقفلوش على بعض.
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
        rowKey="line_id" size="small" dataSource={rows} columns={lineColumns(rows)}
        loading={loading} pagination={false} scroll={{ y: 380 }}
        rowSelection={{
          selectedRowKeys: selected.filter((id) => rows.some((r) => r.line_id === id)),
          onChange: (keys) => {
            const others = selected.filter((id) => !rows.some((r) => r.line_id === id));
            setSelected([...others, ...(keys as number[])]);
          },
        }}
        locale={{ emptyText: <Empty description="مافيش" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </Card>
  );

  return (
    <Card
      title="تسوية الحسابات"
      extra={
        <Space>
          <Segmented
            value={kind}
            onChange={(v) => setParam({ kind: String(v), partner: null })}
            options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <Button icon={<ReloadOutlined />} onClick={reload}>تحديث</Button>
        </Space>
      }
    >
      <Tabs
        activeKey={tab} onChange={setTab}
        items={[
          {
            key: 'open',
            label: 'المفتوح',
            children: (
              <Row gutter={12}>
                <Col span={6}>
                  <Card size="small" title="الأطراف اللي عليها مفتوح"
                    styles={{ body: { padding: 8 } }}>
                    <Input.Search placeholder="دوّر بالاسم" allowClear value={q}
                      onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
                    <Table
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
                              <div style={{ fontSize: 12, color: '#888' }}>
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
                      locale={{ emptyText: <Empty description="مافيش أطراف عليها مفتوح"
                        image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    />
                  </Card>
                </Col>
                <Col span={18}>
                  {!partnerId ? (
                    <Alert type="info" showIcon
                      message="اختار طرف من القايمة عشان تشوف المفتوح عليه" />
                  ) : (
                    <>
                      <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col span={6}>
                          <Card size="small">
                            <Statistic title="مستحق عليه" value={egp(data?.total_debit ?? 0)} />
                          </Card>
                        </Col>
                        <Col span={6}>
                          <Card size="small">
                            <Statistic title="دفعات ملهاش فواتير"
                              value={egp(data?.total_credit ?? 0)} />
                          </Card>
                        </Col>
                        <Col span={6}>
                          <Card size="small">
                            <Statistic title="الصافي المفتوح"
                              value={egp(data?.balance ?? 0)} />
                          </Card>
                        </Col>
                        <Col span={6}>
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Tooltip title={blockReason}>
                              <Button type="primary" icon={<LinkOutlined />} block
                                disabled={selected.length < 2 || !selectedTotals.sameAccount
                                  || selectedTotals.willMatch <= 0}
                                onClick={doReconcile}>
                                طابق المحدد
                                {selectedTotals.willMatch > 0
                                  && ` (${egp(selectedTotals.willMatch)})`}
                              </Button>
                            </Tooltip>
                            <Button icon={<ThunderboltOutlined />} block onClick={doAuto}>
                              مطابقة تلقائية — الأقدم أولاً
                            </Button>
                            {activePartner && (
                              <Button type="link" size="small" block
                                onClick={() => navigate(
                                  kind === 'supplier'
                                    ? `/suppliers/${partnerId}`
                                    : `/customers/${partnerId}`)}>
                                كارت {activePartner.partner_name}
                              </Button>
                            )}
                          </Space>
                        </Col>
                      </Row>
                      <Row gutter={12}>
                        <Col span={12}>{table(debits, 'فواتير ومستحقات', '#C0392B')}</Col>
                        <Col span={12}>{table(credits, 'دفعات ومرتجعات', '#6AB42D')}</Col>
                      </Row>
                    </>
                  )}
                </Col>
              </Row>
            ),
          },
          {
            key: 'matched',
            label: 'المطابقات',
            children: (
              <Table
                rowKey="number" size="small" dataSource={matched}
                pagination={{ defaultPageSize: 10 }}
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
                        { title: 'التاريخ', dataIndex: 'entry_date', key: 'd' },
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
                  { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', width: 130 },
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
                locale={{ emptyText: <Empty description="مافيش مطابقات لسه"
                  image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}

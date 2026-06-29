import React, { useEffect, useState } from 'react';
import {
  Tabs, Table, Tree, Button, Drawer, Form, Input, InputNumber, Select, DatePicker,
  Tag, message, Row, Col, Divider, Space, Card, Statistic, Empty,
} from 'antd';
import {
  PlusOutlined, RollbackOutlined, BookOutlined, FileAddOutlined, BankOutlined,
  ReloadOutlined, ApartmentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';

// --- Types --------------------------------------------------------------------------------
interface Account {
  id: number;
  code: string | null;
  name: string | null;
  parent_id: number | null;
  nature: string | null;
  normal_side: 'debit' | 'credit';
  is_postable: boolean;
  is_system: boolean;
  active: boolean;
  balance: string;
  children?: Account[] | null;
}

interface JournalLine {
  account_id: number;
  direction: 'debit' | 'credit';
  amount: string;
  statement: string | null;
  cost_center_id?: number | null;
}

interface JournalEntry {
  id: number;
  entry_type: string;
  date: string | null;
  description: string;
  branch_id: number | null;
  reverses_entry_id: number | null;
  lines: JournalLine[];
  total: string;
}

interface TrialRow {
  account_id: number;
  code: string | null;
  name: string | null;
  is_postable: boolean;
  opening: string;
  period_debit: string;
  period_credit: string;
  closing: string;
}

interface LineDraft {
  key: string;
  account_id: number | null;
  direction: 'debit' | 'credit';
  amount: number;
  statement: string;
  cost_center_id?: number | null;
}

interface CostCenter {
  id: number;
  code: string;
  name: string;
  parent_id: number | null;
  active: boolean;
  children?: CostCenter[] | null;
}

const NATURE_LABEL: Record<string, string> = {
  asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات',
};
const NATURE_COLOR: Record<string, string> = {
  asset: 'green', liability: 'volcano', equity: 'gold', income: 'blue', expense: 'orange',
};
const egp = (v: string | number) =>
  parseFloat(String(v)).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GeneralLedger() {
  return (
    <Tabs
      defaultActiveKey="chart"
      items={[
        { key: 'chart', label: <span><BookOutlined /> دليل الحسابات</span>, children: <ChartTab /> },
        { key: 'journal', label: <span><FileAddOutlined /> القيود اليومية</span>, children: <JournalTab /> },
        { key: 'trial', label: <span><BankOutlined /> ميزان المراجعة</span>, children: <TrialBalanceTab /> },
        { key: 'cc', label: <span><ApartmentOutlined /> مراكز التكلفة</span>, children: <CostCenterTab /> },
      ]}
    />
  );
}

// --- Tab 1: Chart of Accounts -------------------------------------------------------------
function ChartTab() {
  const [tree, setTree] = useState<Account[]>([]);
  const [groups, setGroups] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/accounts?tree=true');
      setTree(res.data);
      const flat = await api.get('/api/v1/accounts');
      setGroups(flat.data.filter((a: Account) => !a.is_postable));
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onCreate = async (v: any) => {
    try {
      await api.post('/api/v1/accounts', {
        code: v.code, name: v.name, parent_id: v.parent_id ?? null,
        nature: v.nature, is_postable: v.is_postable,
      });
      message.success('تم إنشاء الحساب');
      setDrawer(false); form.resetFields(); load();
    } catch (err) { console.error(err); }
  };

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 160,
      render: (c: string) => <Tag color="blue">{c}</Tag> },
    { title: 'اسم الحساب', dataIndex: 'name', key: 'name' },
    { title: 'النوع', dataIndex: 'nature', key: 'nature', width: 120,
      render: (n: string) => n ? <Tag color={NATURE_COLOR[n]}>{NATURE_LABEL[n]}</Tag> : '-' },
    { title: 'التصنيف', dataIndex: 'is_postable', key: 'is_postable', width: 120,
      render: (p: boolean, r: Account) =>
        p ? <Tag color="green">قابل للترحيل</Tag> : <Tag>مجموعة</Tag> },
    { title: 'النظام', dataIndex: 'is_system', key: 'is_system', width: 90,
      render: (s: boolean) => s ? <Tag color="purple">نظام</Tag> : '-' },
    { title: 'الرصيد (ج.م)', dataIndex: 'balance', key: 'balance', align: 'left' as const,
      render: (b: string) => <strong>{egp(b)}</strong> },
  ];

  return (
    <Card
      title="الهيكل الشجري لدليل الحسابات"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer(true)}>حساب جديد</Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={tree}
        columns={columns}
        pagination={false}
        expandable={{ defaultExpandAllRows: true, childrenColumnName: 'children' }}
      />

      <Drawer title="إضافة حساب جديد" width={460} open={drawer} onClose={() => setDrawer(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}
          initialValues={{ is_postable: true, nature: 'expense' }}>
          <Form.Item name="parent_id" label="الحساب الأب (المجموعة)"
            extra="اترك فارغاً لإنشاء حساب جذر">
            <Select allowClear placeholder="اختر المجموعة الأب" showSearch optionFilterProp="label"
              options={groups.map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` }))} />
          </Form.Item>
          <Form.Item name="code" label="كود الحساب (مقطعي)"
            rules={[{ required: true, message: 'أدخل الكود' }]}
            extra="يجب أن يبدأ بكود الأب، مثل 5.10.001">
            <Input placeholder="مثال: 5.10.001" />
          </Form.Item>
          <Form.Item name="name" label="اسم الحساب" rules={[{ required: true, message: 'أدخل الاسم' }]}>
            <Input placeholder="مثال: إيجار" />
          </Form.Item>
          <Form.Item name="nature" label="طبيعة الحساب" rules={[{ required: true }]}>
            <Select options={Object.entries(NATURE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Form.Item name="is_postable" label="التصنيف" rules={[{ required: true }]}>
            <Select options={[
              { value: true, label: 'حساب قابل للترحيل (ورقة)' },
              { value: false, label: 'مجموعة (تجميعية فقط)' },
            ]} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>حفظ الحساب</Button>
        </Form>
      </Drawer>
    </Card>
  );
}

// --- Tab 2: Journal Entries ---------------------------------------------------------------
function JournalTab() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [leaves, setLeaves] = useState<Account[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [openingDrawer, setOpeningDrawer] = useState(false);
  const [form] = Form.useForm();
  const [openForm] = Form.useForm();
  const [lines, setLines] = useState<LineDraft[]>([
    { key: '1', account_id: null, direction: 'debit', amount: 0, statement: '' },
    { key: '2', account_id: null, direction: 'credit', amount: 0, statement: '' },
  ]);
  const [openLines, setOpenLines] = useState<LineDraft[]>([
    { key: '1', account_id: null, direction: 'debit', amount: 0, statement: '' },
  ]);

  const load = async () => {
    setLoading(true);
    try {
      const [e, a, b, cc] = await Promise.all([
        api.get('/api/v1/journal-entries'),
        api.get('/api/v1/accounts?postable_only=true&active=true'),
        api.get('/api/v1/branches'),
        api.get('/api/v1/cost-centers?active=true'),
      ]);
      setEntries(e.data); setLeaves(a.data); setBranches(b.data); setCostCenters(cc.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const acctLabel = (id: number) => {
    const a = leaves.find((x) => x.id === id);
    return a ? `${a.code ?? ''} ${a.name ?? a.id}` : `حساب #${id}`;
  };
  const ccLabel = (id: number | null | undefined) => {
    if (!id) return null;
    const c = costCenters.find((x) => x.id === id);
    return c ? `${c.code} — ${c.name}` : `مركز #${id}`;
  };

  const totalDebit = lines.filter((l) => l.direction === 'debit').reduce((s, l) => s + l.amount, 0);
  const totalCredit = lines.filter((l) => l.direction === 'credit').reduce((s, l) => s + l.amount, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const setLine = (k: string, f: keyof LineDraft, v: any) =>
    setLines(lines.map((l) => (l.key === k ? { ...l, [f]: v } : l)));
  const addLine = () =>
    setLines([...lines, { key: String(Date.now()), account_id: null, direction: 'debit', amount: 0, statement: '' }]);
  const removeLine = (k: string) => {
    if (lines.length <= 2) { message.warning('القيد يحتاج سطرين على الأقل'); return; }
    setLines(lines.filter((l) => l.key !== k));
  };

  const onPost = async (v: any) => {
    if (!balanced) { message.error('القيد غير متوازن: مجموع المدين يجب أن يساوي الدائن'); return; }
    const valid = lines.filter((l) => l.account_id);
    if (valid.length < 2) { message.error('أدخل حسابين صالحين على الأقل'); return; }
    try {
      await api.post('/api/v1/journal-entries', {
        date: v.date.format('YYYY-MM-DD'),
        description: v.description,
        branch_id: v.branch_id,
        lines: valid.map((l) => ({
          account_id: l.account_id, direction: l.direction, amount: l.amount.toFixed(2),
          statement: l.statement || null, cost_center_id: l.cost_center_id || null,
        })),
      });
      message.success('تم ترحيل القيد');
      setDrawer(false); form.resetFields();
      setLines([
        { key: '1', account_id: null, direction: 'debit', amount: 0, statement: '' },
        { key: '2', account_id: null, direction: 'credit', amount: 0, statement: '' },
      ]);
      load();
    } catch (err) { console.error(err); }
  };

  const onPostOpening = async (v: any) => {
    const valid = openLines.filter((l) => l.account_id && l.amount > 0);
    if (!valid.length) { message.error('أدخل سطراً واحداً على الأقل'); return; }
    try {
      await api.post('/api/v1/opening-balances', {
        date: v.date.format('YYYY-MM-DD'),
        branch_id: v.branch_id ?? null,
        lines: valid.map((l) => ({ account_id: l.account_id, amount: l.amount.toFixed(2) })),
      });
      message.success('تم تسجيل الأرصدة الافتتاحية');
      setOpeningDrawer(false); openForm.resetFields();
      setOpenLines([{ key: '1', account_id: null, direction: 'debit', amount: 0, statement: '' }]);
      load();
    } catch (err) { console.error(err); }
  };

  const handleReverse = (r: JournalEntry) => {
    showReversalConfirm({
      title: 'عكس قيد اليومية',
      content: `هل تريد عكس القيد #${r.id}؟ سيُنشأ قيد عكسي متوازن ولن يُعدّل الأصل (لا يمكن العكس إلا مرة واحدة).`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/journal-entries/${r.id}/reverse`);
          message.success('تم عكس القيد'); load();
        } catch (err) { console.error(err); }
      },
    });
  };

  const TYPE_LABEL: Record<string, { t: string; c: string }> = {
    journal: { t: 'قيد يومية', c: 'blue' },
    opening_balance: { t: 'رصيد افتتاحي', c: 'gold' },
    reversal: { t: 'عكس', c: 'red' },
  };

  const columns = [
    { title: 'رقم', dataIndex: 'id', key: 'id', width: 70, render: (id: number) => <Tag color="blue">#{id}</Tag> },
    { title: 'التاريخ', dataIndex: 'date', key: 'date', width: 120, render: (d: string) => d || '-' },
    { title: 'النوع', dataIndex: 'entry_type', key: 'entry_type', width: 120,
      render: (t: string) => { const m = TYPE_LABEL[t] || { t, c: 'default' }; return <Tag color={m.c}>{m.t}</Tag>; } },
    { title: 'البيان', dataIndex: 'description', key: 'description' },
    { title: 'الحركات', dataIndex: 'lines', key: 'lines',
      render: (ls: JournalLine[]) => (
        <div>
          {ls.map((l, i) => (
            <div key={i} style={{ fontSize: 13 }}>
              <span style={{ color: l.direction === 'debit' ? '#6AB42D' : '#F5A11D' }}>
                {l.direction === 'debit' ? '[مدين] ' : '[دائن] '}
              </span>
              {acctLabel(l.account_id)}: <strong>{egp(l.amount)}</strong>
              {ccLabel(l.cost_center_id) && <Tag style={{ marginInlineStart: 6 }} color="geekblue">{ccLabel(l.cost_center_id)}</Tag>}
            </div>
          ))}
        </div>
      ) },
    { title: 'الإجمالي', dataIndex: 'total', key: 'total', width: 120, render: (t: string) => <strong>{egp(t)}</strong> },
    { title: '', key: 'actions', width: 130,
      render: (_: any, r: JournalEntry) =>
        (!r.reverses_entry_id && !entries.some((e) => e.reverses_entry_id === r.id)) ? (
          <Button type="link" danger icon={<RollbackOutlined />} onClick={() => handleReverse(r)}>عكس</Button>
        ) : <Tag color="red">معكوس</Tag> },
  ];

  return (
    <Card
      title="قيود اليومية (دفتر الأستاذ الموحد)"
      extra={
        <Space>
          <Button icon={<BankOutlined />} onClick={() => setOpeningDrawer(true)}>أرصدة افتتاحية</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer(true)}>قيد جديد</Button>
        </Space>
      }
    >
      <Table rowKey="id" loading={loading} dataSource={entries} columns={columns} pagination={{ pageSize: 8 }} />

      {/* New journal drawer */}
      <Drawer title="قيد يومية جديد" width={640} open={drawer} onClose={() => setDrawer(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={onPost} requiredMark={false}
          initialValues={{ date: dayjs() }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="date" label="التاريخ المحاسبي" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="branch_id" label="الفرع" rules={[{ required: true, message: 'اختر الفرع' }]}>
                <Select placeholder="اختر الفرع"
                  options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="البيان" rules={[{ required: true, message: 'أدخل البيان' }]}>
            <Input.TextArea rows={2} placeholder="وصف القيد" />
          </Form.Item>

          <Divider orientation="right">حركات القيد المزدوج</Divider>
          {lines.map((l) => (
            <Row gutter={8} key={l.key} align="middle" style={{ marginBottom: 8 }}>
              <Col span={9}>
                <Select placeholder="الحساب" style={{ width: '100%' }} showSearch optionFilterProp="label"
                  value={l.account_id} onChange={(v) => setLine(l.key, 'account_id', v)}
                  options={leaves.map((a) => ({ value: a.id, label: `${a.code ?? ''} ${a.name ?? a.id}` }))} />
              </Col>
              <Col span={5}>
                <Select value={l.direction} style={{ width: '100%' }}
                  onChange={(v) => setLine(l.key, 'direction', v)}
                  options={[{ value: 'debit', label: 'مدين' }, { value: 'credit', label: 'دائن' }]} />
              </Col>
              <Col span={6}>
                <InputNumber min={0.01} style={{ width: '100%' }} placeholder="المبلغ"
                  value={l.amount} onChange={(v) => setLine(l.key, 'amount', v || 0)} />
              </Col>
              <Col span={4}>
                <Button type="text" danger onClick={() => removeLine(l.key)}>حذف</Button>
              </Col>
              <Col span={14} style={{ marginTop: 4 }}>
                <Input size="small" placeholder="بيان السطر (اختياري)"
                  value={l.statement} onChange={(e) => setLine(l.key, 'statement', e.target.value)} />
              </Col>
              <Col span={10} style={{ marginTop: 4 }}>
                <Select size="small" allowClear placeholder="مركز التكلفة (اختياري)" style={{ width: '100%' }}
                  showSearch optionFilterProp="label" value={l.cost_center_id ?? undefined}
                  onChange={(v) => setLine(l.key, 'cost_center_id', v ?? null)}
                  options={costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
              </Col>
            </Row>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addLine} style={{ marginBottom: 16 }}>
            إضافة حركة
          </Button>

          <Row gutter={16}>
            <Col span={8}><Statistic title="إجمالي مدين" value={totalDebit} precision={2} valueStyle={{ color: '#6AB42D' }} /></Col>
            <Col span={8}><Statistic title="إجمالي دائن" value={totalCredit} precision={2} valueStyle={{ color: '#F5A11D' }} /></Col>
            <Col span={8}><Statistic title="الفرق" value={Math.abs(totalDebit - totalCredit)} precision={2}
              valueStyle={{ color: balanced ? '#6AB42D' : '#cf1322' }} /></Col>
          </Row>
          <Divider />
          <Button type="primary" htmlType="submit" block disabled={!balanced}>
            {balanced ? 'ترحيل القيد' : 'القيد غير متوازن'}
          </Button>
        </Form>
      </Drawer>

      {/* Opening balances drawer */}
      <Drawer title="تسجيل الأرصدة الافتتاحية" width={560} open={openingDrawer}
        onClose={() => setOpeningDrawer(false)} destroyOnHidden>
        <Form form={openForm} layout="vertical" onFinish={onPostOpening} requiredMark={false}
          initialValues={{ date: dayjs().startOf('year') }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="date" label="تاريخ الأرصدة" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="branch_id" label="الفرع (اختياري)">
                <Select allowClear placeholder="عام" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            </Col>
          </Row>
          <p style={{ color: '#888', fontSize: 13 }}>
            يُسجَّل كل مبلغ على الجانب الطبيعي للحساب، ويُقابَل الإجمالي بحساب «أرصدة افتتاحية».
          </p>
          {openLines.map((l) => (
            <Row gutter={8} key={l.key} align="middle" style={{ marginBottom: 8 }}>
              <Col span={14}>
                <Select placeholder="الحساب" style={{ width: '100%' }} showSearch optionFilterProp="label"
                  value={l.account_id}
                  onChange={(v) => setOpenLines(openLines.map((x) => x.key === l.key ? { ...x, account_id: v } : x))}
                  options={leaves.map((a) => ({ value: a.id, label: `${a.code ?? ''} ${a.name ?? a.id}` }))} />
              </Col>
              <Col span={8}>
                <InputNumber min={0.01} style={{ width: '100%' }} placeholder="المبلغ" value={l.amount}
                  onChange={(v) => setOpenLines(openLines.map((x) => x.key === l.key ? { ...x, amount: v || 0 } : x))} />
              </Col>
              <Col span={2}>
                <Button type="text" danger
                  onClick={() => setOpenLines(openLines.length > 1 ? openLines.filter((x) => x.key !== l.key) : openLines)}>×</Button>
              </Col>
            </Row>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} style={{ marginBottom: 16 }}
            onClick={() => setOpenLines([...openLines, { key: String(Date.now()), account_id: null, direction: 'debit', amount: 0, statement: '' }])}>
            إضافة حساب
          </Button>
          <Button type="primary" htmlType="submit" block>تسجيل الأرصدة الافتتاحية</Button>
        </Form>
      </Drawer>
    </Card>
  );
}

// --- Tab 3: Trial Balance -----------------------------------------------------------------
function TrialBalanceTab() {
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('year'), dayjs().endOf('year')]);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [costCenterId, setCostCenterId] = useState<number | undefined>();
  const [branches, setBranches] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data)).catch(() => {});
    api.get('/api/v1/cost-centers?active=true').then((r) => setCostCenters(r.data)).catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: range[0].format('YYYY-MM-DD'),
        to: range[1].format('YYYY-MM-DD'),
        include_groups: 'true',
      });
      if (branchId) params.set('branch_id', String(branchId));
      if (costCenterId) params.set('cost_center_id', String(costCenterId));
      const res = await api.get(`/api/v1/trial-balance?${params.toString()}`);
      setData(res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { run(); }, []);

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 130, render: (c: string) => c ? <Tag color="blue">{c}</Tag> : '-' },
    { title: 'الحساب', dataIndex: 'name', key: 'name',
      render: (n: string, r: TrialRow) => r.is_postable ? n : <strong>{n}</strong> },
    { title: 'افتتاحي', dataIndex: 'opening', key: 'opening', align: 'left' as const, render: egp },
    { title: 'مدين', dataIndex: 'period_debit', key: 'period_debit', align: 'left' as const,
      render: (v: string) => <span style={{ color: '#6AB42D' }}>{egp(v)}</span> },
    { title: 'دائن', dataIndex: 'period_credit', key: 'period_credit', align: 'left' as const,
      render: (v: string) => <span style={{ color: '#F5A11D' }}>{egp(v)}</span> },
    { title: 'ختامي', dataIndex: 'closing', key: 'closing', align: 'left' as const, render: (v: string) => <strong>{egp(v)}</strong> },
  ];

  return (
    <Card title="ميزان المراجعة">
      <Space wrap style={{ marginBottom: 16 }}>
        <DatePicker.RangePicker value={range} format="YYYY-MM-DD"
          onChange={(v) => v && setRange(v as [dayjs.Dayjs, dayjs.Dayjs])} />
        <Select allowClear placeholder="كل الفروع" style={{ width: 180 }} value={branchId} onChange={setBranchId}
          options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        <Select allowClear placeholder="كل مراكز التكلفة" style={{ width: 220 }} value={costCenterId}
          onChange={setCostCenterId} showSearch optionFilterProp="label"
          options={costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
        <Button type="primary" icon={<ReloadOutlined />} onClick={run} loading={loading}>عرض</Button>
      </Space>

      {data ? (
        <>
          <Table rowKey="account_id" dataSource={data.rows} columns={columns} loading={loading}
            pagination={false} size="small"
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
                  <Table.Summary.Cell index={0} colSpan={3}>الإجمالي</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="left">{egp(data.grand_total_debit)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="left">{egp(data.grand_total_credit)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="left">
                    {data.balanced ? <Tag color="green">متوازن ✓</Tag> : <Tag color="red">غير متوازن</Tag>}
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
          <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>
            مشتقّ بالكامل من دفتر الأستاذ — إجمالي المدين = إجمالي الدائن دائماً.
          </div>
        </>
      ) : <Empty description="لا توجد بيانات" />}
    </Card>
  );
}

// --- Tab 4: Cost Centers ------------------------------------------------------------------
function CostCenterTab() {
  const [tree, setTree] = useState<CostCenter[]>([]);
  const [flat, setFlat] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [t, f] = await Promise.all([
        api.get('/api/v1/cost-centers?tree=true'),
        api.get('/api/v1/cost-centers'),
      ]);
      setTree(t.data); setFlat(f.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onCreate = async (v: any) => {
    try {
      await api.post('/api/v1/cost-centers', { code: v.code, name: v.name, parent_id: v.parent_id ?? null });
      message.success('تم إنشاء مركز التكلفة');
      setDrawer(false); form.resetFields(); load();
    } catch (err) { console.error(err); }
  };

  const onDeactivate = (r: CostCenter) => {
    showReversalConfirm({
      title: 'تعطيل مركز التكلفة',
      content: `هل تريد تعطيل «${r.name}»؟ لن يُحذف؛ تبقى الحركات التاريخية موسومة به ولا يمكن اختياره لقيود جديدة.`,
      onOk: async () => {
        try { await api.delete(`/api/v1/cost-centers/${r.id}`); message.success('تم التعطيل'); load(); }
        catch (err) { console.error(err); }
      },
    });
  };

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 160, render: (c: string) => <Tag color="geekblue">{c}</Tag> },
    { title: 'الاسم', dataIndex: 'name', key: 'name' },
    { title: 'الحالة', dataIndex: 'active', key: 'active', width: 120,
      render: (a: boolean) => a ? <Tag color="green">نشط</Tag> : <Tag>معطّل</Tag> },
    { title: '', key: 'actions', width: 120,
      render: (_: any, r: CostCenter) => r.active
        ? <Button type="link" danger onClick={() => onDeactivate(r)}>تعطيل</Button> : null },
  ];

  return (
    <Card
      title="مراكز التكلفة (البُعد التحليلي)"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer(true)}>مركز جديد</Button>
        </Space>
      }
    >
      <Table rowKey="id" loading={loading} dataSource={tree} columns={columns} pagination={false}
        expandable={{ defaultExpandAllRows: true, childrenColumnName: 'children' }} />

      <Drawer title="إضافة مركز تكلفة" width={420} open={drawer} onClose={() => setDrawer(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}>
          <Form.Item name="parent_id" label="المركز الأب (اختياري)">
            <Select allowClear placeholder="مركز جذر" showSearch optionFilterProp="label"
              options={flat.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
          </Form.Item>
          <Form.Item name="code" label="الكود" rules={[{ required: true, message: 'أدخل الكود' }]}>
            <Input placeholder="مثال: 1.01" />
          </Form.Item>
          <Form.Item name="name" label="الاسم" rules={[{ required: true, message: 'أدخل الاسم' }]}>
            <Input placeholder="مثال: معرض مدينة نصر" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>حفظ</Button>
        </Form>
      </Drawer>
    </Card>
  );
}

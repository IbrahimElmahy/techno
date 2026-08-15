import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, InputNumber, Row, Select, Space,
  Statistic, Table, Tabs, Tag, Tree, message, Radio
} from 'antd';
import {
  PlusOutlined, RollbackOutlined, BookOutlined, FileAddOutlined, BankOutlined,
  ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useQueryTab } from '../components/useQueryTab';
import {
  APPEARS_IN_LABEL, CostCenter, MAIN_LEVELS, NATURE_COLOR, NATURE_LABEL, egp,
} from '../utils/accounts';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import ListToolbar, { useListFilter, normalizeAr } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, choiceColumn, dateColumn } from '../components/gridColumns';
import { entryTypeLabel } from '../components/labels';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

// --- Types --------------------------------------------------------------------------------
interface Account {
  id: number;
  code: string | null;
  name: string | null;
  parent_id: number | null;
  nature: string | null;
  appears_in?: string | null;
  main_level?: string | null;
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
  // (031) Which book the row belongs in. Their دفتر الإستاذ is four tables on one screen; this is
  // what lets one fetch answer both that view and the flat one.
  nature: 'asset' | 'liability' | 'equity' | 'income' | 'expense' | null;
}

interface LineDraft {
  key: string;
  account_id: number | null;
  direction: 'debit' | 'credit';
  amount: number;
  statement: string;
  cost_center_id?: number | null;
}



// الشجرة تُفلتر بالعقدة أو أي فرع تحتها، حتى لا يختفي حساب مطابق داخل مجموعة غير مطابقة.
const flatten = <T extends { children?: T[] | null }>(node: T): T[] =>
  [node, ...(node.children || []).flatMap(flatten)];

export default function GeneralLedger() {
  // What is left here is what «الأستاذ العام» actually means: the chart, the entries, and the
  // trial balance. الحسابات الرئيسيه، الفرعيه and مراكز التكلفة were tabs of this page and are
  // their own screens now — each is master data you set up once, which is a different job from
  // reading balances, and their menu had always said so.
  const [activeTab, selectTab] = useQueryTab('chart');
  return (
    <Tabs
      activeKey={activeTab} onChange={selectTab}
      items={[
        { key: 'chart', label: <span><BookOutlined /> دليل الحسابات</span>, children: <ChartTab /> },
        { key: 'journal', label: <span><FileAddOutlined /> القيود اليومية</span>, children: <JournalTab /> },
        { key: 'trial', label: <span><BankOutlined /> ميزان المراجعة</span>, children: <TrialBalanceTab /> },
      ]}
    />
  );
}

// --- Tab 1: Chart of Accounts -------------------------------------------------------------
function ChartTab() {
  const navigate = useNavigate();
  const [tree, setTree] = useState<Account[]>([]);
  const [groups, setGroups] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [form] = Form.useForm();

  // «الحسابات الرئيسيه» and «الحسابات الفرعيه» are two menu entries there and one chart here. The
  // distinction is real in the data — a group node versus a postable leaf — so the entry narrows to
  // what it names instead of dropping the reader into the whole tree and leaving them to squint.
  // The chart is a TREE and the columns filter individual accounts, so the distinct lists are
  // built from the flattened accounts — otherwise a child's nature would never appear as a choice.
  const flatAccounts = useMemo(() => tree.flatMap(flatten), [tree]);

  const filter = useListFilter(tree, {
    search: (a) => flatten(a).flatMap((n) => [n.code, n.name]),
    filters: {
      nature: (a, v) => flatten(a).some((n) => n.nature === v),
      appears_in: (a, v) => flatten(a).some((n) => n.appears_in === v),
      is_postable: (a, v) => flatten(a).some((n) => n.is_postable === (v === 'postable')),
      active: (a, v) => flatten(a).some((n) => n.active === (v === 'active')),
    },
  });

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
        appears_in: v.appears_in ?? null,
        main_level: (Array.isArray(v.main_level) ? v.main_level[0] : v.main_level) || null,
      });
      message.success('تم إنشاء الحساب');
      setDrawer(false); form.resetFields(); load();
    } catch (err) { console.error(err); }
  };

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 160,
      ...textColumn(flatAccounts, (a: Account) => a.code),
      render: (c: string) => <Tag color="blue">{c}</Tag> },
    { title: 'اسم الحساب', dataIndex: 'name', key: 'name',
      ...textColumn(flatAccounts, (a: Account) => a.name) },
    { title: 'النوع', dataIndex: 'nature', key: 'nature', width: 120,
      ...textColumn(flatAccounts, (a: Account) => (a.nature ? NATURE_LABEL[a.nature] : '')),
      render: (n: string) => n ? <Tag color={NATURE_COLOR[n]}>{NATURE_LABEL[n]}</Tag> : '-' },
    { title: 'التصنيف', dataIndex: 'is_postable', key: 'is_postable', width: 120,
      ...choiceColumn<Account>([{ text: 'يقبل الترحيل', value: 'yes' }, { text: 'تجميعي', value: 'no' }],
        (a, v) => (v === 'yes' ? !!a.is_postable : !a.is_postable)),
      render: (p: boolean, r: Account) =>
        p ? <Tag color="green">قابل للترحيل</Tag> : <Tag>مجموعة</Tag> },
    { title: 'المستوى الرئيسي', dataIndex: 'main_level', key: 'main_level', width: 170,
      ...textColumn(flatAccounts, (a: any) => a.main_level),
      render: (m: string | null) => m || '-' },
    { title: 'يظهر في', dataIndex: 'appears_in', key: 'appears_in', width: 140,
      ...textColumn(flatAccounts, (a: any) => (a.appears_in ? APPEARS_IN_LABEL[a.appears_in] : '')),
      render: (a: string | null) => (a && APPEARS_IN_LABEL[a]
        ? <Tag color="geekblue">{APPEARS_IN_LABEL[a]}</Tag>
        : <span style={{ color: '#bbb' }}>حسب الطبيعة</span>) },
    { title: 'النظام', dataIndex: 'is_system', key: 'is_system', width: 90,
      ...choiceColumn<Account>([{ text: 'نظام', value: 'yes' }, { text: 'مضاف', value: 'no' }],
        (a: any, v) => (v === 'yes' ? !!a.is_system : !a.is_system)),
      render: (s: boolean) => s ? <Tag color="purple">نظام</Tag> : '-' },
    { title: 'الرصيد (ج.م)', dataIndex: 'balance', key: 'balance', align: 'left' as const,
      ...numberColumn<Account>((a: any) => a.balance),
      render: (b: string) => <strong>{egp(b)}</strong> },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const chartTabCols = useTableColumns('gl-chart', columns);

  // الحساب في الشجرة بيفتح كشف حسابه. اللي بيبص على شجرة الحسابات بيدوّر على حساب عشان يشوف
  // حركته — والشجرة كانت بتوقف عند الاسم.
  const chartKb = useTableKeyboard<any>({
    rows: filter.filtered, rowKey: (a) => a.id,
    onOpen: (a) => navigate(`/account-statement?account=${a.id}`),
  });

  return (
    <Card
      title="الهيكل الشجري لدليل الحسابات"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} />
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setDrawer(true)}>حساب جديد</Button>
        </Space>
      }
    >
      <ListToolbar
        searchPlaceholder="بحث بكود الحساب أو الاسم"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={tree.length} shown={filter.filtered.length}
        filters={[
          { key: 'nature', placeholder: 'طبيعة الحساب',
            options: Object.entries(NATURE_LABEL).map(([v, l]) => ({ value: v, label: l })) },
          { key: 'is_postable', placeholder: 'التصنيف',
            options: [{ value: 'postable', label: 'قابل للترحيل' }, { value: 'group', label: 'مجموعة' }] },
          { key: 'appears_in', placeholder: 'يظهر في',
            options: Object.entries(APPEARS_IN_LABEL).map(([v, l]) => ({ value: v, label: l })) },
          { key: 'active', placeholder: 'الحالة',
            options: [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'معطّل' }] },
        ]}
      />
      <div style={{ textAlign: 'end', marginBottom: 8 }}>{chartTabCols.control}</div>
      <Table
        {...chartKb.tableProps}
        rowKey="id"
        loading={loading}
        dataSource={filter.filtered}
        columns={chartTabCols.columns}
        pagination={false}
        expandable={{ defaultExpandAllRows: true, childrenColumnName: 'children' }}
      />

      <TabModal footer={null} centered title="إضافة حساب جديد" width={460} open={drawer} onCancel={() => setDrawer(false)} destroyOnHidden>
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
          <Form.Item name="main_level" label="المستوى الرئيسي"
            extra="اختر من القائمة أو اكتب مستوى جديد">
            <Select allowClear showSearch placeholder="مثال: مصروفات غير مباشرة"
              options={MAIN_LEVELS.map((l) => ({ value: l, label: l }))}
              // Free text on purpose — the suggestions cover the common chart, not every chart.
              onSearch={() => {}} filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              mode="tags" maxCount={1} />
          </Form.Item>
          <Form.Item name="appears_in" label="يظهر في"
            extra="اتركه فارغاً ليتبع طبيعة الحساب تلقائياً">
            <Select allowClear placeholder="حسب الطبيعة"
              options={Object.entries(APPEARS_IN_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>حفظ الحساب</Button>
        </Form>
      </TabModal>
    </Card>
  );
}

// --- Tab 2: Journal Entries ---------------------------------------------------------------
function JournalTab() {
  const navigate = useNavigate();
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

  /**
   * اللون بس اللي محلي. الاسم بييجي من الخريطة المشتركة.
   *
   * This used to carry its own three names, which meant the same entry read one way here and
   * another on كشف الحساب, and the sixteen types it did not list showed through in English. A
   * colour is a decision about this screen; a name is a fact about the system.
   */
  const TYPE_COLOR: Record<string, string> = {
    journal: 'blue', opening_balance: 'gold', reversal: 'red',
  };
  const TYPE_LABEL = (t: string) => ({ t: entryTypeLabel(t), c: TYPE_COLOR[t] || 'default' });

  const branchName = (id: number | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? `فرع #${id}`) : 'عام';

  const filter = useListFilter(entries, {
    search: (e) => [
      e.id, e.description, entryTypeLabel(e.entry_type), e.entry_type,
      branchName(e.branch_id), ...e.lines.map((l) => acctLabel(l.account_id)),
      ...e.lines.map((l) => l.statement),
    ],
    filters: {
      entry_type: (e, v) => e.entry_type === v,
      branch_id: (e, v) => (v === 0 ? e.branch_id === null : e.branch_id === v),
    },
    dateOf: (e) => e.date,
  });

  const columns = [
    { title: 'رقم', dataIndex: 'id', key: 'id', width: 70, ...numberColumn<JournalEntry>((e) => e.id),
      render: (id: number) => <Tag color="blue">#{id}</Tag> },
    { title: 'التاريخ', dataIndex: 'date', key: 'date', width: 120,
      ...dateColumn<JournalEntry>((e: any) => e.date), render: (d: string) => d || '-' },
    { title: 'النوع', dataIndex: 'entry_type', key: 'entry_type', width: 120,
      ...textColumn(entries, (e: JournalEntry) => (entryTypeLabel(e.entry_type))),
      render: (t: string) => { const m = TYPE_LABEL(t); return <Tag color={m.c}>{m.t}</Tag>; } },
    { title: 'البيان', dataIndex: 'description', key: 'description',
      ...textColumn(entries, (e: JournalEntry) => e.description) },
    { title: 'الحركات', dataIndex: 'lines', key: 'lines',
      // Filtered by how many movements the entry has — «القيود المركّبة» is a real thing to look
      // for, and it is not visible from any other column.
      ...numberColumn<JournalEntry>((e) => (e.lines || []).length),
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
    { title: 'الإجمالي', dataIndex: 'total', key: 'total', width: 120,
      ...numberColumn<JournalEntry>((e: any) => e.total),
      render: (t: string) => <strong>{egp(t)}</strong> },
    { title: '', key: 'actions', width: 130,
      render: (_: any, r: JournalEntry) =>
        (!r.reverses_entry_id && !entries.some((e) => e.reverses_entry_id === r.id)) ? (
          <Button type="link" danger icon={<RollbackOutlined />} onClick={() => handleReverse(r)}>عكس</Button>
        ) : <Tag color="red">معكوس</Tag> },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const journalTabCols = useTableColumns('gl-journal', columns);

  // القيد بيفتح كشف حساب أول سطر فيه — القيد بسطوره ظاهر في الجدول نفسه، واللي بعده هو
  // «الحساب ده رصيده بقى كام».
  const entryKb = useTableKeyboard<any>({
    rows: filter.filtered, rowKey: (e) => e.id,
    onOpen: (e) => { const a = e.lines?.[0]?.account_id;
      if (a) navigate(`/account-statement?account=${a}`); },
  });

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
      <ListToolbar
        searchPlaceholder="بحث برقم القيد أو البيان أو الحساب"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        showDateRange range={filter.range} onRangeChange={filter.setRange}
        onReset={filter.reset}
        total={entries.length} shown={filter.filtered.length}
        filters={[
          { key: 'entry_type', placeholder: 'نوع القيد', span: 4,
            options: Object.entries(TYPE_LABEL).map(([v, m]) => ({ value: v, label: m.t })) },
          { key: 'branch_id', placeholder: 'الفرع', span: 4,
            options: [{ value: 0, label: 'عام' }, ...branches.map((b) => ({ value: b.id, label: b.name }))] },
        ]}
      />
      <div style={{ textAlign: 'end', marginBottom: 8 }}>{journalTabCols.control}</div>
      <Table {...entryKb.tableProps} rowKey="id" loading={loading} dataSource={filter.filtered} columns={journalTabCols.columns} pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }} />

      {/* New journal drawer */}
      <TabModal footer={null} centered title="قيد يومية جديد" width={640} open={drawer} onCancel={() => setDrawer(false)} destroyOnHidden>
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
      </TabModal>

      {/* Opening balances drawer */}
      <TabModal footer={null} centered title="تسجيل الأرصدة الافتتاحية" width={560} open={openingDrawer}
        onCancel={() => setOpeningDrawer(false)} destroyOnHidden>
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
      </TabModal>
    </Card>
  );
}

// --- Tab 3: Trial Balance -----------------------------------------------------------------
/**
 * Their دفتر الإستاذ shows four books on one screen — اصول · خصوم · مصروفات · ايرادات — each with
 * `رقم · الاسم · مدين · دائن · رصيد`.
 *
 * **حقوق الملكية is a fifth here.** It is not among their four, and leaving capital off a ledger
 * would hide the side the books balance against — a section that is empty says «nothing here»,
 * while a section that does not exist says nothing at all.
 *
 * Every row carries more than theirs does: an opening balance, and the period and cost-centre
 * filters this screen already had. Grouping is a toggle rather than a replacement, so the flat
 * trial balance — which is the auditor's view and reads its own way — is still one click away.
 */
const BOOKS: { nature: TrialRow['nature']; label: string }[] = [
  { nature: 'asset', label: 'اصول' },
  { nature: 'liability', label: 'خصوم' },
  { nature: 'equity', label: 'حقوق ملكية' },
  { nature: 'expense', label: 'مصروفات' },
  { nature: 'income', label: 'ايرادات' },
];

function TrialBalanceTab() {
  const navigate = useNavigate();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('year'), dayjs().endOf('year')]);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [costCenterId, setCostCenterId] = useState<number | undefined>();
  const [branches, setBranches] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  // الفترة والفرع ومركز التكلفة من السيرفر — البحث النصي فوق الصفوف المعروضة.
  const [rowQuery, setRowQuery] = useState('');
  // Their four-book view is the default: it is the one somebody arriving from a5 expects.
  const [grouped, setGrouped] = useState(true);

  const rows: TrialRow[] = data?.rows ?? [];
  const trialRows: TrialRow[] = data?.rows ?? [];
  const shownRows = rowQuery
    ? rows.filter((r) => [r.code, r.name].some((f) => normalizeAr(f).includes(normalizeAr(rowQuery))))
    : rows;

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
  // الفترة والفرع ومركز التكلفة كلهم بيحمّلوا على طول — «عرض» فضل للتحديث بنفس الفلاتر.
  // فلتر بيتغيّر والأرقام مابتتحركش بيتقري كأنه مكسور، والراجل يا بيصدّق الأرقام القديمة
  // يا بيضغط الزرار ويستغرب ليه كان لازم.
  useEffect(() => { run(); }, [range, branchId, costCenterId]);

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 130,
      ...textColumn(trialRows, (r: TrialRow) => r.code),
      render: (c: string) => c ? <Tag color="blue">{c}</Tag> : '-' },
    { title: 'الحساب', dataIndex: 'name', key: 'name',
      ...textColumn(trialRows, (r: TrialRow) => r.name),
      render: (n: string, r: TrialRow) => r.is_postable ? n : <strong>{n}</strong> },
    { title: 'افتتاحي', dataIndex: 'opening', key: 'opening', align: 'left' as const,
      ...numberColumn<TrialRow>((r: any) => r.opening), render: egp },
    { title: 'مدين', dataIndex: 'period_debit', key: 'period_debit', align: 'left' as const,
      ...numberColumn<TrialRow>((r: any) => r.period_debit),
      render: (v: string) => <span style={{ color: '#6AB42D' }}>{egp(v)}</span> },
    { title: 'دائن', dataIndex: 'period_credit', key: 'period_credit', align: 'left' as const,
      ...numberColumn<TrialRow>((r: any) => r.period_credit),
      render: (v: string) => <span style={{ color: '#F5A11D' }}>{egp(v)}</span> },
    { title: 'ختامي', dataIndex: 'closing', key: 'closing', align: 'left' as const,
      ...numberColumn<TrialRow>((r: any) => r.closing),
      render: (v: string) => <strong>{egp(v)}</strong> },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const trialBalanceTabCols = useTableColumns('gl-trial-balance', columns);

  // ميزان المراجعة → كشف الحساب: النزول من الرقم المجمّع للحركات اللي عملته. الجداول التلاتة
  // (مقسّم بالطبيعة، وبدون تصنيف، والمسطّح) بتتشارك المؤشر لأن `account_id` مايتكررش بينهم،
  // وواحد بس منهم بيتعرض في المرة.
  const trialKb = useTableKeyboard<any>({
    rows: shownRows, rowKey: (r) => r.account_id,
    onOpen: (r) => navigate(`/account-statement?account=${r.account_id}`),
  });

  return (
    <Card title="ميزان المراجعة">
      <Space wrap style={{ marginBottom: 16 }}>
        <Input allowClear value={rowQuery} onChange={(e) => setRowQuery(e.target.value)}
          prefix={<SearchOutlined />} placeholder="بحث بكود الحساب أو الاسم" style={{ width: 240 }} />
        <DatePicker.RangePicker value={range} format="YYYY-MM-DD"
          onChange={(v) => v && setRange(v as [dayjs.Dayjs, dayjs.Dayjs])} />
        <Select allowClear placeholder="كل الفروع" style={{ width: 180 }} value={branchId} onChange={setBranchId}
          options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        <Select allowClear placeholder="كل مراكز التكلفة" style={{ width: 220 }} value={costCenterId}
          onChange={setCostCenterId} showSearch optionFilterProp="label"
          options={costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
        <Radio.Group size="small" value={grouped} onChange={(e: any) => setGrouped(e.target.value)}>
          <Radio.Button value>مقسّم بالطبيعة</Radio.Button>
          <Radio.Button value={false}>ميزان مسطّح</Radio.Button>
        </Radio.Group>
        <Button type="primary" icon={<ReloadOutlined />} onClick={run} loading={loading}>عرض</Button>
        {trialBalanceTabCols.control}
      </Space>

      {data && grouped ? (
        <>
          {BOOKS.map(({ nature, label }) => {
            const book = shownRows.filter((r) => r.nature === nature);
            const debit = book.reduce((t, r) => t + Number(r.period_debit || 0), 0);
            const credit = book.reduce((t, r) => t + Number(r.period_credit || 0), 0);
            return (
              <Table
                {...trialKb.tableProps}
                key={nature ?? 'none'} rowKey="account_id" dataSource={book} columns={trialBalanceTabCols.columns}
                loading={loading} pagination={false} size="small"
                style={{ marginBottom: 18 }}
                title={() => <strong>{label}</strong>}
                // An empty book is shown, not hidden: «مفيش حسابات هنا» is a fact about the chart,
                // and a section that vanishes reads as one that was never meant to be there.
                locale={{ emptyText: 'لا توجد حسابات في هذا القسم' }}
                summary={() => (book.length ? (
                  <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
                    <Table.Summary.Cell index={0} colSpan={3}>إجمالي {label}</Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="left">{egp(debit)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="left">{egp(credit)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={5} />
                  </Table.Summary.Row>
                ) : null)}
              />
            );
          })}
          {/* Accounts the chart has not classified would otherwise vanish from a grouped view
              entirely — worse than a wrong section, because nobody goes looking for them. */}
          {shownRows.some((r) => !r.nature) && (
            <Table
              {...trialKb.tableProps}
              rowKey="account_id" columns={trialBalanceTabCols.columns} pagination={false} size="small"
              dataSource={shownRows.filter((r) => !r.nature)}
              title={() => <strong style={{ color: '#d46b08' }}>بدون تصنيف</strong>}
            />
          )}
          <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>
            الإجمالي العام: مدين {egp(data.grand_total_debit)} · دائن {egp(data.grand_total_credit)}
            {' '}{data.balanced ? <Tag color="green">متوازن ✓</Tag> : <Tag color="red">غير متوازن</Tag>}
          </div>
        </>
      ) : data ? (
        <>
          <Table {...trialKb.tableProps} rowKey="account_id" dataSource={shownRows} columns={trialBalanceTabCols.columns} loading={loading}
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

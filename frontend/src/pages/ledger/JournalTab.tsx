/**
 * جزء من شاشة الأستاذ العام — اتفصل عن `GeneralLedger.tsx` لما الملف وصل ١٤٠٠ سطر
 * وخمس تبويبات. الشاشة والمسار زي ما هما بالظبط؛ اللي اتغيّر هو إن كل تبويب بقى
 * ملف لوحده، فالتعديل في «الدفاتر» مابيفتحش «ميزان المراجعة» قدامك.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Tooltip, message, Radio,
} from 'antd';
import { InputNumber } from '../../components/NumberInput';
import {
  PlusOutlined, RollbackOutlined, BookOutlined, FileAddOutlined, BankOutlined,
  ReloadOutlined, SearchOutlined, DownloadOutlined, PrinterOutlined,
  ProfileOutlined, CheckCircleOutlined, EditOutlined, StopOutlined, LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import CostCenterSplit from '../../components/CostCenterSplit';
import { api } from '../../api/client';
import { useQueryTab } from '../../components/useQueryTab';
import {
  APPEARS_IN_LABEL, CostCenter, MAIN_LEVELS, NATURE_COLOR, NATURE_LABEL, egp,
} from '../../utils/accounts';
import { showReversalConfirm } from '../../components/ConfirmationDialog';
import ListToolbar, { useListFilter, normalizeAr } from '../../components/ListToolbar';
import { useTableKeyboard } from '../../components/keyboard';
import { textColumn, numberColumn, choiceColumn, dateColumn } from '../../components/gridColumns';
import { entryTypeLabel } from '../../components/labels';
import PartyField from '../../components/PartyField';
import { TabModal } from '../../components/TabModal';
import { useTableColumns } from '../../components/ColumnSettings';
import { exportCsv } from '../../utils/exportCsv';
import DateRangeFilter from '../../components/DateRangeFilter';
import { printReport } from '../../print/reportSheet';
import { Account, Journal, JournalEntry, JournalLine, LineDraft, flatten } from './types';

/** لون تاج الشريك — العميل والمورد والموظف بيتفرقوا بالعين قبل القراية. */
const PARTNER_COLOR: Record<string, string> = {
  customer: 'green', supplier: 'orange', employee: 'blue',
};

/** الأنواع اللي القيد اليدوي ينفع يتكتب عليها.
 *
 *  الموظف مش فيها عن قصد: نافذة الأطراف بتجيب «الموظف» من كشف العملاء (عميل نوعه
 *  موظف)، والشريك `employee` في الدفتر بيشاور على جدول الموظفين بتاع المرتبات —
 *  رقمين مختلفين لنفس الكلمة. القيود على الموظفين بتتكتب من شاشة السلف والمرتبات. */
const PARTNER_KINDS = [
  { value: 'customer', label: 'عميل' },
  { value: 'supplier', label: 'مورد' },
];

export default function JournalTab() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  // القيد اللي الشاشة فاتحاه للتعديل — مسودة بس. `null` معناها قيد جديد.
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [leaves, setLeaves] = useState<Account[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // اسم الشريك اللي اتختار — عشان الخانة تعرضه من غير ما الشاشة تحمّل كشف العملاء كله.
  const [partnerName, setPartnerName] = useState<string>('');
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
      const [e, a, b, cc, j] = await Promise.all([
        api.get('/api/v1/journal-entries'),
        api.get('/api/v1/accounts?postable_only=true&active=true'),
        api.get('/api/v1/branches'),
        api.get('/api/v1/cost-centers?active=true'),
        api.get('/api/v1/journals?active=true'),
      ]);
      setEntries(e.data); setLeaves(a.data); setBranches(b.data); setCostCenters(cc.data);
      setJournals(j.data);
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
    // سطر واحد كفاية: المسودة بتتساب ناقصة عن قصد، والتوازن بيتفرض عند الترحيل بس.
    if (lines.length <= 1) { message.warning('القيد يحتاج سطراً واحداً على الأقل'); return; }
    setLines(lines.filter((l) => l.key !== k));
  };

  const resetDrawer = () => {
    setDrawer(false); setEditing(null); form.resetFields(); setPartnerName('');
    setLines([
      { key: '1', account_id: null, direction: 'debit', amount: 0, statement: '' },
      { key: '2', account_id: null, direction: 'credit', amount: 0, statement: '' },
    ]);
  };

  const openNew = () => {
    setEditing(null); form.resetFields(); setPartnerName('');
    setLines([
      { key: '1', account_id: null, direction: 'debit', amount: 0, statement: '' },
      { key: '2', account_id: null, direction: 'credit', amount: 0, statement: '' },
    ]);
    setDrawer(true);
  };

  const openDraft = (e: JournalEntry) => {
    setEditing(e);
    form.setFieldsValue({
      date: e.date ? dayjs(e.date) : dayjs(),
      description: e.description,
      branch_id: e.branch_id ?? undefined,
      journal_id: e.journal_id ?? undefined,
      partner_kind: e.partner_kind ?? undefined,
      partner_id: e.partner_id ?? undefined,
      due_date: e.due_date ? dayjs(e.due_date) : undefined,
    });
    setPartnerName(e.partner_name ?? '');
    setLines((e.lines || []).map((l, i) => ({
      key: String(i + 1), account_id: l.account_id, direction: l.direction,
      amount: Number(l.amount), statement: l.statement ?? '',
      cost_center_id: l.cost_center_id ?? null,
      cost_center_distribution: l.cost_center_distribution ?? null,
    })));
    setDrawer(true);
  };

  /** الحفظ. `asDraft` بيسيب القيد ناقص بلا رقم؛ الترحيل بيطلب التوازن. */
  const submit = async (asDraft: boolean) => {
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    const valid = lines.filter((l) => l.account_id && l.amount > 0);
    if (!valid.length) { message.error('أدخل سطراً واحداً صالحاً على الأقل'); return; }
    if (!asDraft && !balanced) {
      message.error('القيد غير متوازن: مجموع المدين لازم يساوي الدائن — أو احفظه مسودة');
      return;
    }
    const payload = {
      date: v.date.format('YYYY-MM-DD'),
      description: v.description,
      branch_id: v.branch_id,
      journal_id: v.journal_id ?? null,
      partner_kind: v.partner_kind ?? null,
      partner_id: v.partner_id ?? null,
      due_date: v.due_date ? v.due_date.format('YYYY-MM-DD') : null,
      lines: valid.map((l) => ({
        account_id: l.account_id, direction: l.direction, amount: l.amount.toFixed(2),
        statement: l.statement || null, cost_center_id: l.cost_center_id || null,
        cost_center_distribution: l.cost_center_distribution || null,
      })),
    };
    try {
      if (editing) {
        await api.patch(`/api/v1/journal-entries/${editing.id}`, payload);
        if (!asDraft) await api.post(`/api/v1/journal-entries/${editing.id}/post`);
        message.success(asDraft ? 'تم حفظ المسودة' : 'تم ترحيل القيد');
      } else {
        const { data } = await api.post('/api/v1/journal-entries', {
          ...payload, state: asDraft ? 'draft' : 'posted',
        });
        message.success(asDraft ? 'تم حفظ المسودة' : `تم ترحيل القيد ${data.number ?? ''}`);
      }
      resetDrawer();
      load();
    } catch (err) { console.error(err); }
  };

  const onPost = () => submit(false);

  const handlePostDraft = async (r: JournalEntry) => {
    try {
      const { data } = await api.post(`/api/v1/journal-entries/${r.id}/post`);
      message.success(`تم ترحيل القيد ${data.number ?? ''}`); load();
    } catch (err) { console.error(err); }
  };

  const handleResetDraft = (r: JournalEntry) => {
    showReversalConfirm({
      title: 'رجوع القيد لمسودة',
      content: `القيد ${r.number ?? `#${r.id}`} هيخرج من الحسابات وكل التقارير، ورقمه هيفضل محجوز `
        + 'ليه. تكمّل؟',
      onOk: async () => {
        try {
          await api.post(`/api/v1/journal-entries/${r.id}/reset-to-draft`);
          message.success('رجع مسودة'); load();
        } catch (err) { console.error(err); }
      },
    });
  };

  const handleCancel = (r: JournalEntry) => {
    showReversalConfirm({
      title: 'إلغاء القيد',
      content: `القيد ${r.number ?? `#${r.id}`} هيخرج من الحسابات وهيفضل موجود برقمه للمراجعة. تكمّل؟`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/journal-entries/${r.id}/cancel`);
          message.success('اتلغى القيد'); load();
        } catch (err) { console.error(err); }
      },
    });
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

  const TYPE_COLOR: Record<string, string> = {
    journal: 'blue', opening_balance: 'gold', reversal: 'red',
  };
  const TYPE_LABEL = (t: string) => ({ t: entryTypeLabel(t), c: TYPE_COLOR[t] || 'default' });

  const STATE_META = (s: string | null | undefined) => (
    // NULL = مرحّل؛ القيود اللي اتكتبت قبل ما الحالة توجد.
    s === 'draft' ? { t: 'مسودة', c: 'orange' }
      : s === 'cancelled' ? { t: 'ملغي', c: 'default' }
        : { t: 'مرحّل', c: 'green' }
  );

  const branchName = (id: number | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? `فرع #${id}`) : 'عام';

  const filter = useListFilter(entries, {
    search: (e) => [
      e.id, e.number, e.journal_code, e.journal_name,
      e.description, entryTypeLabel(e.entry_type), e.entry_type,
      branchName(e.branch_id), ...e.lines.map((l) => acctLabel(l.account_id)),
      ...e.lines.map((l) => l.statement),
    ],
    filters: {
      entry_type: (e, v) => e.entry_type === v,
      branch_id: (e, v) => (v === 0 ? e.branch_id === null : e.branch_id === v),
      journal_id: (e, v) => e.journal_id === v,
      state: (e, v) => (e.state ?? 'posted') === v,
    },
    dateOf: (e) => e.date,
  });

  const columns = [
    { title: 'رقم القيد', dataIndex: 'number', key: 'number', width: 140,
      ...textColumn(entries, (e: JournalEntry) => e.number ?? ''),
      render: (n: string | null, r: JournalEntry) =>
        (n ? <Tag color="blue">{n}</Tag> : <Tag>#{r.id} — مسودة</Tag>) },
    { title: 'الدفتر', dataIndex: 'journal_name', key: 'journal_name', width: 130,
      ...textColumn(entries, (e: JournalEntry) => e.journal_name ?? ''),
      render: (n: string | null) => (n ? <Tag color="purple">{n}</Tag> : '-') },
    { title: 'الحالة', dataIndex: 'state', key: 'state', width: 90,
      ...choiceColumn<JournalEntry>(
        [{ text: 'مرحّل', value: 'posted' }, { text: 'مسودة', value: 'draft' },
         { text: 'ملغي', value: 'cancelled' }],
        (e, v) => (e.state ?? 'posted') === v),
      render: (_: any, r: JournalEntry) => {
        const m = STATE_META(r.state);
        return <Tag color={m.c}>{m.t}</Tag>;
      } },
    { title: 'التاريخ', dataIndex: 'date', key: 'date', width: 120,
      ...dateColumn<JournalEntry>((e: any) => e.date), render: (d: string) => d || '-' },
    { title: 'النوع', dataIndex: 'entry_type', key: 'entry_type', width: 120,
      ...textColumn(entries, (e: JournalEntry) => (entryTypeLabel(e.entry_type))),
      render: (t: string) => { const m = TYPE_LABEL(t); return <Tag color={m.c}>{m.t}</Tag>; } },
    { title: 'الشريك', dataIndex: 'partner_name', key: 'partner_name', width: 160,
      ...textColumn(entries, (e: JournalEntry) => e.partner_name ?? ''),
      render: (n: string | null, r: JournalEntry) =>
        (n ? <Tag color={PARTNER_COLOR[r.partner_kind ?? 'customer']}>{n}</Tag> : '-') },
    { title: 'الدفع', dataIndex: 'payment_state', key: 'payment_state', width: 120,
      ...choiceColumn<JournalEntry>(
        [{ text: 'مدفوعة', value: 'paid' }, { text: 'جزئياً', value: 'partial' },
         { text: 'غير مدفوعة', value: 'not_paid' }],
        (e, v) => e.payment_state === v),
      render: (_: unknown, r: JournalEntry) => {
        if (!r.payment_state) return '-';
        const color = r.payment_state === 'paid' ? 'green'
          : r.payment_state === 'partial' ? 'orange' : 'red';
        const rest = Number(r.residual ?? 0);
        return (
          <Tooltip title={rest > 0 ? `متبقّي ${egp(rest)}` : 'مقفولة بالكامل'}>
            <Tag color={color}>{r.payment_state_label ?? r.payment_state}</Tag>
          </Tooltip>
        );
      } },
    { title: 'البيان', dataIndex: 'description', key: 'description',
      ...textColumn(entries, (e: JournalEntry) => e.description) },
    { title: 'الحركات', dataIndex: 'lines', key: 'lines',
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
              {/* السطر المتقسّم مالوش مركز واحد يتكتب — فبيتكتب توزيعه بالنِسَب. */}
              {l.cost_center_distribution && Object.entries(l.cost_center_distribution).map(([cc, pct]) => (
                <Tag key={cc} style={{ marginInlineStart: 6 }} color="purple">
                  {ccLabel(Number(cc))} {Number(pct)}٪
                </Tag>
              ))}
            </div>
          ))}
        </div>
      ) },
    { title: 'الإجمالي', dataIndex: 'total', key: 'total', width: 120,
      ...numberColumn<JournalEntry>((e: any) => e.total),
      render: (t: string) => <strong>{egp(t)}</strong> },
    { title: '', key: 'actions', width: 230,
      render: (_: any, r: JournalEntry) => {
        const state = r.state ?? 'posted';
        if (state === 'cancelled') return <Tag>ملغي</Tag>;
        if (state === 'draft') {
          return (
            <Space size={0}>
              <Button type="link" icon={<EditOutlined />} onClick={() => openDraft(r)}>تعديل</Button>
              <Button type="link" icon={<CheckCircleOutlined />}
                onClick={() => handlePostDraft(r)}>ترحيل</Button>
              <Button type="link" danger icon={<StopOutlined />}
                onClick={() => handleCancel(r)}>إلغاء</Button>
            </Space>
          );
        }
        const reversed = entries.some((e) => e.reverses_entry_id === r.id);
        return (
          <Space size={0}>
            {r.partner_id && r.partner_kind && (
              <Tooltip title="افتح المفتوح على الطرف ده وقفله">
                <Button type="link" icon={<LinkOutlined />}
                  onClick={() => navigate(
                    `/reconciliation?kind=${r.partner_kind}&partner=${r.partner_id}`)}>
                  تسوية
                </Button>
              </Tooltip>
            )}
            {!r.reverses_entry_id && !reversed && (
              <Button type="link" danger icon={<RollbackOutlined />}
                onClick={() => handleReverse(r)}>عكس</Button>
            )}
            {reversed && <Tag color="red">معكوس</Tag>}
            <Button type="link" icon={<RollbackOutlined />}
              onClick={() => handleResetDraft(r)}>رجوع لمسودة</Button>
          </Space>
        );
      } },
  ];

  const journalTabCols = useTableColumns('gl-journal', columns, {
    export: { name: 'قيود اليومية', rows: filter.filtered },
  });

  const entryKb = useTableKeyboard<any>({
    rows: filter.filtered, rowKey: (e) => e.id,
    onOpen: (e) => { const a = e.lines?.[0]?.account_id;
      if (a) navigate(`/account-statement?account=${a}`); },
  });

  const entryReportCols = [
    { title: 'رقم القيد', value: (e: JournalEntry) => e.number ?? `#${e.id}` },
    { title: 'الدفتر', value: (e: JournalEntry) => e.journal_name ?? '' },
    { title: 'الحالة', value: (e: JournalEntry) => STATE_META(e.state).t },
    { title: 'التاريخ', value: (e: JournalEntry) => e.date ?? '' },
    { title: 'النوع', value: (e: JournalEntry) => entryTypeLabel(e.entry_type) },
    { title: 'الشريك', value: (e: JournalEntry) => e.partner_name ?? '' },
    { title: 'الدفع', value: (e: JournalEntry) => e.payment_state_label ?? '' },
    { title: 'البيان', value: (e: JournalEntry) => e.description },
    { title: 'الفرع', value: (e: JournalEntry) => branchName(e.branch_id) },
    { title: 'الحركات', value: (e: JournalEntry) => (e.lines || []).length },
    { title: 'الإجمالي', value: (e: JournalEntry) => e.total, numeric: true },
  ];
  const sideSum = (es: JournalEntry[], dir: 'debit' | 'credit') =>
    es.reduce((t, e) => t + (e.lines || []).reduce((s, l) => s + (l.direction === dir ? Number(l.amount) : 0), 0), 0);
  const exportJournal = () => {
    if (!filter.filtered.length) { message.info('لا توجد بيانات للتصدير'); return; }
    exportCsv('journal-entries', entryReportCols, filter.filtered);
  };
  const printJournal = () => {
    printReport(
      {
        title: 'قيود اليومية',
        date: dayjs().format('YYYY/MM/DD'),
        meta: [
          ['من', filter.range ? filter.range[0].format('YYYY/MM/DD') : 'من البداية'],
          ['إلى', filter.range ? filter.range[1].format('YYYY/MM/DD') : 'حتى اليوم'],
        ],
      },
      entryReportCols, filter.filtered,
      [
        { label: 'إجمالي مدين', value: egp(sideSum(filter.filtered, 'debit')) },
        { label: 'إجمالي دائن', value: egp(sideSum(filter.filtered, 'credit')) },
      ],
    );
  };

  return (
    <Card
      title="قيود اليومية (دفتر الأستاذ الموحد)"
      extra={
        <Space>
          <Button icon={<DownloadOutlined />} onClick={exportJournal}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />} onClick={printJournal}>طباعة</Button>
          <Button icon={<BankOutlined />} onClick={() => setOpeningDrawer(true)}>أرصدة افتتاحية</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>قيد جديد</Button>
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
          { key: 'journal_id', placeholder: 'الدفتر', span: 4,
            options: journals.map((j) => ({ value: j.id, label: j.name })) },
          { key: 'state', placeholder: 'الحالة', span: 3,
            options: [
              { value: 'posted', label: 'مرحّل' },
              { value: 'draft', label: 'مسودة' },
              { value: 'cancelled', label: 'ملغي' },
            ] },
        ]}
      />
      <div style={{ textAlign: 'end', marginBottom: 8 }}>{journalTabCols.control}</div>
      <Table {...entryKb.tableProps} rowKey="id" loading={loading} dataSource={filter.filtered} columns={journalTabCols.columns} pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }} />

      <TabModal footer={null} centered
        title={editing ? `تعديل مسودة ${editing.number ?? `#${editing.id}`}` : 'قيد يومية جديد'}
        width={640} open={drawer} onCancel={resetDrawer} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={onPost} requiredMark={false}
          initialValues={{ date: dayjs() }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="date" label="التاريخ المحاسبي" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="branch_id" label="الفرع" rules={[{ required: true, message: 'اختر الفرع' }]}>
                <Select placeholder="اختر الفرع"
                  options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="journal_id" label="الدفتر"
                tooltip="لو سِبته فاضي بيروح «قيود متنوعة»">
                <Select allowClear placeholder="قيود متنوعة"
                  options={journals.map((j) => ({ value: j.id, label: `${j.code} — ${j.name}` }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="البيان" rules={[{ required: true, message: 'أدخل البيان' }]}>
            <Input.TextArea rows={2} placeholder="وصف القيد" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="partner_kind" label="القيد على"
                tooltip="سيبه فاضي لو القيد مش على طرف — إقفال أو تسوية بين حسابات">
                <Select allowClear placeholder="بدون طرف" options={PARTNER_KINDS}
                  onChange={() => { form.setFieldValue('partner_id', undefined);
                    setPartnerName(''); }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item noStyle shouldUpdate={(a, b) => a.partner_kind !== b.partner_kind}>
                {({ getFieldValue }) => {
                  const kind = getFieldValue('partner_kind');
                  return (
                    <Form.Item name="partner_id" label={kind === 'supplier' ? 'المورد' : 'العميل'}>
                      <PartyField
                        kind={kind === 'supplier' ? 'supplier' : 'customer'}
                        disabled={!kind}
                        style={{ width: '100%' }}
                        // الاسم بييجي من الاختيار نفسه، فالشاشة مابتحمّلش كشف
                        // العملاء كله عشان تعرض اسم واحد.
                        options={(() => {
                          const id = getFieldValue('partner_id');
                          return id && partnerName ? [{ value: id, label: partnerName }] : [];
                        })()}
                        onPicked={(party) => setPartnerName(party.name)}
                      />
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="due_date" label="تاريخ الاستحقاق"
                tooltip="سيبه فاضي ياخد تاريخ القيد — يعني مستحق فوراً">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>

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
              <Col span={7} style={{ marginTop: 4 }}>
                <Select size="small" allowClear placeholder="مركز التكلفة (اختياري)" style={{ width: '100%' }}
                  showSearch optionFilterProp="label"
                  disabled={!!l.cost_center_distribution}
                  value={l.cost_center_id ?? undefined}
                  onChange={(v) => setLine(l.key, 'cost_center_id', v ?? null)}
                  options={costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
              </Col>
              <Col span={3} style={{ marginTop: 4 }}>
                {/* السطر المتقسّم مالوش مركز واحد — فالقايمة بتتقفل والتوزيع هو اللي بيتكتب. */}
                <CostCenterSplit
                  value={l.cost_center_distribution}
                  onChange={(v) => {
                    setLine(l.key, 'cost_center_distribution', v);
                    if (v) setLine(l.key, 'cost_center_id', null);
                  }}
                />
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
          <Row gutter={8}>
            <Col span={12}>
              {/* المسودة مش محتاجة توازن — دي نقطتها. */}
              <Button block onClick={() => submit(true)}>حفظ كمسودة</Button>
            </Col>
            <Col span={12}>
              <Button type="primary" htmlType="submit" block disabled={!balanced}>
                {balanced ? 'ترحيل القيد' : `غير متوازن — الفرق ${Math.abs(totalDebit - totalCredit).toFixed(2)}`}
              </Button>
            </Col>
          </Row>
        </Form>
      </TabModal>

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

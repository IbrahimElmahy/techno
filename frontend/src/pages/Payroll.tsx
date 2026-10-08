import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, Col, DatePicker, Divider, Input, Row, Select, Space, Table, Tag, message,
} from 'antd';
import {
  CheckOutlined, ClearOutlined, DeleteOutlined, DollarOutlined, EditOutlined, PlusOutlined,
  PrinterOutlined, ReloadOutlined, RollbackOutlined, SaveOutlined, SearchOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import ListPage, { ListStat } from '../components/ListPage';
import { useListFilter } from '../components/ListToolbar';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import { TabModal } from '../components/TabModal';
import { useQueryTab } from '../components/useQueryTab';
import { printPayslip, printReport, type PrintColumn } from '../print/reportSheet';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { money, numeralsLocale } from '../utils/money';
import { PAGE_SIZE } from '../utils/pagination';
import { useAdjustmentsTab, useLeavesTab } from './payroll/PayrollExtras';

interface Rule { id?: number; basis: string; basis_label?: string; pct: string | number }

interface EmpRow {
  employee_id: number; code: string; name: string; active: boolean; branch_id: number | null;
  has_card: boolean; effective_from: string | null; basic: string | null; earnings: string;
  deductions: string; insurance: string | null; rules: Rule[]; linked_user: boolean;
}

interface Detail { source: string; label: string; kind: string; quantity: string | null; amount: string }

interface Line {
  line_id: number; employee_id: number; code: string; name: string;
  basic: string; allowances: string; commission: string; commission_base: string | null;
  commission_override: string | null; bonuses: string; earnings: string;
  days_absent: string; absent_override: string | null; absence: string; penalties: string;
  advances: string; insurance: string; other_deductions: string; total_deductions: string;
  net: string; extra_earning: string | null; extra_deduction: string | null;
  notes: string | null; paid: boolean; details: Detail[];
}

interface MonthData {
  run: null | {
    id: number; document_number: string; year: number; month: number; status: string;
    status_label: string; net: string;
  };
  lines: Line[]; branch_id: number; year: number; month: number;
  without_card: { employee_id: number; name: string }[];
  addable: { employee_id: number; name: string }[];
}

interface Remittance {
  id: number; document_number: string; amount: string; remit_date: string;
  branch_id: number | null; treasury_id: number | null; notes: string | null;
}

interface Item { name: string; kind: 'earning' | 'deduction'; amount?: number }

const n = (v: any) => Number(v || 0);
const BASIS = [
  { value: 'sales', label: 'من المبيعات' },
  { value: 'collections', label: 'من التحصيلات' },
];
const STATUS_COLOR: Record<string, string> = { draft: 'default', posted: 'green', reversed: 'red' };

const fail = (err: any, fallback: string) => {
  const detail = err?.response?.data?.detail;
  message.error(detail?.message || fallback, 6);
};

const ruleText = (rules: Rule[]) => rules
  .map((r) => `${Number(r.pct)}٪ ${r.basis === 'collections' ? 'من التحصيلات' : 'من المبيعات'}`)
  .join(' + ');

export default function Payroll() {
  const [tab, setTab] = useQueryTab('month');
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [treasuries, setTreasuries] = useState<any[]>([]);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [period, setPeriod] = useState<Dayjs>(dayjs().subtract(dayjs().date() < 15 ? 1 : 0, 'month'));
  const [data, setData] = useState<MonthData | null>(null);
  const [emps, setEmps] = useState<EmpRow[]>([]);
  const [remits, setRemits] = useState<Remittance[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [cardOf, setCardOf] = useState<number | null>(null);
  const [lineOf, setLineOf] = useState<number | null>(null);
  const [payOpen, setPayOpen] = useState<{ ids?: number[] } | null>(null);
  const [payForm, setPayForm] = useState<{ treasury_id?: number; pay_date: Dayjs }>({ pay_date: dayjs() });
  const [remitOpen, setRemitOpen] = useState<number | 'new' | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState<number | undefined>();
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [newCardId, setNewCardId] = useState<number | undefined>();
  const [remitForm, setRemitForm] = useState<{ amount?: number; remit_date: Dayjs; treasury_id?: number; notes: string }>(
    { remit_date: dayjs(), notes: '' });

  const year = period.year();
  const month = period.month() + 1;
  const run = data?.run || null;
  const draft = run?.status === 'draft';
  const posted = run?.status === 'posted';

  const branchName = (id: number | null | undefined) => branches.find((b) => b.id === id)?.name || '';

  const loadMonth = async (b = branchId, p = period) => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/salary/month', {
        params: { year: p.year(), month: p.month() + 1, branch_id: b },
      });
      setData(res.data);
      if (b === undefined) setBranchId(res.data.branch_id);
    } catch (err: any) { fail(err, 'تعذر تحميل المرتبات'); } finally { setLoading(false); }
  };

  const loadEmps = async (inactive = showInactive) => {
    try {
      const res = await api.get('/api/v1/hr/salary/employees', { params: { include_inactive: inactive } });
      setEmps(res.data || []);
    } catch (err: any) { fail(err, 'تعذر تحميل الموظفين'); }
  };

  const loadRemits = async () => {
    try {
      const res = await api.get('/api/v1/hr/insurance/remittances');
      setRemits(res.data || []);
    } catch (err: any) { fail(err, 'تعذر تحميل سداد التأمينات'); }
  };

  useEffect(() => {
    loadEmps();
    loadRemits();
    api.get('/api/v1/branches').then((r) => {
      const list = (r.data || []).filter((b: any) => b.active !== false);
      setBranches(list);
      const first = list[0]?.id as number | undefined;
      setBranchId(first);
      loadMonth(first);
    }).catch(() => loadMonth());
    api.get('/api/v1/treasuries').then((r) => setTreasuries(r.data || [])).catch(() => {});
  }, []);

  const act = async (fn: () => Promise<any>, ok: string, fallback: string) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res?.data?.lines) setData(res.data); else await loadMonth();
      message.success(ok);
      loadEmps();
    } catch (err: any) { fail(err, fallback); } finally { setBusy(false); }
  };

  const calculate = () => act(
    () => api.post('/api/v1/hr/salary/month/calculate', { year, month, branch_id: branchId }),
    'تم حساب مرتبات الشهر', 'تعذر الحساب');
  const post = () => act(() => api.post(`/api/v1/hr/salary/month/${run!.id}/post`),
    'تم ترحيل المرتبات', 'تعذر الترحيل');
  const unpost = () => act(() => api.post(`/api/v1/hr/salary/month/${run!.id}/unpost`),
    'تم إلغاء الترحيل', 'تعذر إلغاء الترحيل');
  const removeRun = () => act(() => api.delete(`/api/v1/hr/salary/month/${run!.id}`),
    'تم الحذف', 'تعذر الحذف');

  const pay = async () => {
    if (!run || !payOpen) return;
    await act(() => api.post(`/api/v1/hr/salary/month/${run.id}/pay`, {
      treasury_id: payForm.treasury_id ?? null, pay_date: payForm.pay_date.format('YYYY-MM-DD'),
      employee_ids: payOpen.ids ?? null,
    }), 'تم صرف المرتبات', 'تعذر الصرف');
    setPayOpen(null);
  };

  const removeLine = (employeeId: number) => act(
    () => api.delete(`/api/v1/hr/salary/month/${run!.id}/employees/${employeeId}`),
    'تم حذف الموظف من مرتبات الشهر', 'تعذر الحذف');

  const addLine = async () => {
    if (!addId) { message.warning('اختر الموظف'); return; }
    await act(() => api.post(`/api/v1/hr/salary/month/${run!.id}/employees/${addId}`),
      'تمت إضافة الموظف', 'تعذرت الإضافة');
    setAddOpen(false);
    setAddId(undefined);
  };

  const unpay = (employeeId: number) => act(
    () => api.post(`/api/v1/hr/salary/month/${run!.id}/employees/${employeeId}/unpay`),
    'تم إلغاء الصرف', 'تعذر إلغاء الصرف');

  const printSlip = async (line: Line) => {
    try {
      const res = await api.get(`/api/v1/hr/salary/month/${run!.id}/payslip/${line.employee_id}`);
      printPayslip({
        employee_name: line.name, run: res.data.run,
        line: { net: res.data.line.net, gross: res.data.line.earnings,
                total_deductions: res.data.line.total_deductions },
        details: [
          { label: 'الأساسي', kind: 'earning', quantity: null, amount: res.data.line.basic },
          ...res.data.line.details,
        ],
      });
    } catch (err: any) { fail(err, 'تعذر طباعة القسيمة'); }
  };

  const monthFilter = useListFilter(data?.lines || [], {
    search: (r) => [r.code, r.name],
    filters: { paid: (r, v) => (v === 'yes' ? r.paid : !r.paid) },
  });
  const empFilter = useListFilter(emps, {
    search: (r) => [r.code, r.name],
    filters: {
      branch_id: (r, v) => r.branch_id === v,
      card: (r, v) => (v === 'yes' ? r.has_card : !r.has_card),
    },
  });
  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const lines = monthFilter.filtered;
  const sum = (k: keyof Line) => lines.reduce((t, l) => t + n(l[k]), 0);

  const monthColumns: ColumnsType<Line> = [
    { title: 'الموظف', dataIndex: 'name', key: 'name', fixed: 'right', width: 190,
      render: (v: string, r) => <a onClick={() => setLineOf(r.employee_id)}><b>{v}</b></a> },
    { title: 'الأساسي', dataIndex: 'basic', key: 'basic', align: 'left', render: money },
    { title: 'البدلات', dataIndex: 'allowances', key: 'allowances', align: 'left', render: money },
    { title: 'العمولة', dataIndex: 'commission', key: 'commission', align: 'left',
      render: (v: string, r) => (
        <Space size={2}>
          {money(v)}
          {r.commission_override !== null ? <Tag color="gold">يدوي</Tag> : null}
        </Space>
      ) },
    { title: 'مكافآت وإضافات', dataIndex: 'bonuses', key: 'bonuses', align: 'left', render: money },
    { title: 'المستحق', dataIndex: 'earnings', key: 'earnings', align: 'left',
      render: (v: string) => <b>{money(v)}</b> },
    { title: 'أيام الغياب', dataIndex: 'days_absent', key: 'days_absent', align: 'left', total: false,
      render: (v: string, r: Line) => (
        <Space size={2}>
          {n(v) ? Number(v) : ''}
          {r.absent_override !== null ? <Tag color="gold">يدوي</Tag> : null}
        </Space>
      ) } as any,
    { title: 'الغياب', dataIndex: 'absence', key: 'absence', align: 'left', render: money },
    { title: 'جزاءات', dataIndex: 'penalties', key: 'penalties', align: 'left', render: money },
    { title: 'سلف', dataIndex: 'advances', key: 'advances', align: 'left', render: money },
    { title: 'تأمينات', dataIndex: 'insurance', key: 'insurance', align: 'left', render: money },
    { title: 'خصومات أخرى', dataIndex: 'other_deductions', key: 'other_deductions', align: 'left',
      render: (v: string, r) => money(n(v) - n(r.absence)) },
    { title: 'إجمالي الخصم', dataIndex: 'total_deductions', key: 'total_deductions', align: 'left',
      render: money },
    { title: 'الصافي', dataIndex: 'net', key: 'net', align: 'left',
      render: (v: string) => <b style={{ color: n(v) < 0 ? '#cf1322' : undefined }}>{money(v)}</b> },
    { title: 'الصرف', dataIndex: 'paid', key: 'paid', width: 90, total: false,
      render: (v: boolean) => (v ? <Tag color="green">مصروف</Tag> : '—') } as any,
    { title: '', key: 'x', width: 150, total: false,
      render: (_: any, r: Line) => (
        <Space size={0}>
          <Button type="text" icon={<EditOutlined />} title="تعديل" onClick={() => setLineOf(r.employee_id)} />
          <Button type="text" icon={<PrinterOutlined />} title="القسيمة" onClick={() => printSlip(r)} />
          {posted && !r.paid ? (
            <Button type="text" icon={<WalletOutlined />} title="صرف" onClick={() => setPayOpen({ ids: [r.employee_id] })} />
          ) : null}
          {r.paid ? (
            <Popconfirm title="إلغاء صرف المرتب؟" onConfirm={() => unpay(r.employee_id)}>
              <Button type="text" icon={<RollbackOutlined />} title="إلغاء الصرف" />
            </Popconfirm>
          ) : null}
          {draft ? (
            <Popconfirm title="حذف الموظف من مرتبات هذا الشهر؟" onConfirm={() => removeLine(r.employee_id)}>
              <Button type="text" danger icon={<DeleteOutlined />} title="حذف من الشهر" />
            </Popconfirm>
          ) : null}
        </Space>
      ) } as any,
  ];
  const monthCols = useTableColumns('salary-month', monthColumns as any, {
    locked: ['name'],
    export: {
      name: `مرتبات ${year}-${String(month).padStart(2, '0')} ${branchName(branchId)}`,
      rows: lines.map((l) => ({ ...l, other_deductions: n(l.other_deductions) - n(l.absence),
                                paid: l.paid ? 'مصروف' : '' })),
    },
  });
  const monthKb = useTableKeyboard<Line>({
    rows: lines, rowKey: (r) => r.employee_id, onOpen: (r) => setLineOf(r.employee_id),
  });

  const printMonth = () => {
    const cols: PrintColumn<Line>[] = [
      { title: 'الموظف', value: (r) => r.name },
      { title: 'الأساسي', value: (r) => money(r.basic), numeric: true },
      { title: 'البدلات', value: (r) => money(r.allowances), numeric: true },
      { title: 'العمولة', value: (r) => money(r.commission), numeric: true },
      { title: 'إضافات', value: (r) => money(r.bonuses), numeric: true },
      { title: 'المستحق', value: (r) => money(r.earnings), numeric: true },
      { title: 'الغياب', value: (r) => money(r.absence), numeric: true },
      { title: 'جزاءات', value: (r) => money(r.penalties), numeric: true },
      { title: 'سلف', value: (r) => money(r.advances), numeric: true },
      { title: 'تأمينات', value: (r) => money(r.insurance), numeric: true },
      { title: 'إجمالي الخصم', value: (r) => money(r.total_deductions), numeric: true },
      { title: 'الصافي', value: (r) => money(r.net), numeric: true },
      { title: 'التوقيع', value: () => '' },
    ];
    printReport({
      title: 'كشف المرتبات',
      number: run?.document_number,
      meta: [['الفرع', branchName(branchId)], ['الشهر', `${year}/${String(month).padStart(2, '0')}`],
             ['الحالة', run?.status_label || '']],
    }, cols, lines, [
      { label: 'إجمالي المستحق', value: money(sum('earnings')) },
      { label: 'إجمالي الخصم', value: money(sum('total_deductions')) },
      { label: 'الصافي', value: money(sum('net')) },
    ]);
  };

  const empColumns: ColumnsType<EmpRow> = [
    { title: 'رقم', dataIndex: 'code', key: 'code', width: 110, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الموظف', dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <Space size={4}>
          <a onClick={() => setCardOf(r.employee_id)}><b>{v}</b></a>
          {!r.active ? <Tag>موقوف</Tag> : null}
        </Space>
      ) },
    { title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', render: (v: number | null) => branchName(v) },
    { title: 'الأساسي', dataIndex: 'basic', key: 'basic', align: 'left',
      render: (v: string | null) => (v !== null ? <b>{money(v)}</b> : <Tag color="orange">بدون كارت</Tag>) },
    { title: 'البدلات', dataIndex: 'earnings', key: 'earnings', align: 'left', render: money },
    { title: 'خصومات ثابتة', dataIndex: 'deductions', key: 'deductions', align: 'left', render: money },
    { title: 'التأمينات', dataIndex: 'insurance', key: 'insurance', align: 'left',
      render: (v: string | null) => (v !== null ? money(v) : '—') },
    { title: 'العمولة', key: 'rules', total: false,
      render: (_: any, r: EmpRow) => (r.rules.length ? ruleText(r.rules) : '—') } as any,
    { title: 'ساري من', dataIndex: 'effective_from', key: 'effective_from', width: 110, total: false,
      render: (v: string | null) => v || '' } as any,
    { title: '', key: 'x', width: 60, total: false,
      render: (_: any, r: EmpRow) => (
        <Button type="text" icon={<EditOutlined />} title="كارت المرتب" onClick={() => setCardOf(r.employee_id)} />
      ) } as any,
  ];
  const empCols = useTableColumns('salary-employees', empColumns as any, {
    locked: ['name'],
    export: {
      name: 'كروت المرتبات',
      rows: empFilter.filtered.map((r) => ({ ...r, branch_id: branchName(r.branch_id), rules: ruleText(r.rules) })),
    },
  });
  const empKb = useTableKeyboard<EmpRow>({
    rows: empFilter.filtered, rowKey: (r) => r.employee_id, onOpen: (r) => setCardOf(r.employee_id),
  });

  const openRemit = (r?: Remittance) => {
    setRemitForm(r ? {
      amount: n(r.amount), remit_date: dayjs(r.remit_date), treasury_id: r.treasury_id ?? undefined,
      notes: r.notes || '',
    } : { remit_date: dayjs(), notes: '' });
    setRemitOpen(r ? r.id : 'new');
  };

  const deleteRemit = async (id: number) => {
    try {
      await api.delete(`/api/v1/hr/insurance/remittances/${id}`);
      message.success('تم حذف السداد');
      loadRemits();
    } catch (err: any) { fail(err, 'تعذر الحذف'); }
  };

  const saveRemit = async () => {
    if (!remitForm.amount) { message.warning('أدخل المبلغ'); return; }
    setBusy(true);
    try {
      const body = {
        amount: String(remitForm.amount), remit_date: remitForm.remit_date.format('YYYY-MM-DD'),
        treasury_id: remitForm.treasury_id ?? null, notes: remitForm.notes || null,
      };
      if (remitOpen === 'new') await api.post('/api/v1/hr/insurance/remittances', body);
      else await api.put(`/api/v1/hr/insurance/remittances/${remitOpen}`, body);
      message.success(remitOpen === 'new' ? 'تم تسجيل السداد' : 'تم تعديل السداد');
      setRemitOpen(null);
      setRemitForm({ remit_date: dayjs(), notes: '' });
      loadRemits();
    } catch (err: any) { fail(err, 'تعذر التسجيل'); } finally { setBusy(false); }
  };

  const treasuryName = (id: number | null) => treasuries.find((t) => t.id === id)?.name || '';
  const treasuryOptions = treasuries.filter((t: any) => t.active !== false)
    .map((t: any) => ({ value: t.id, label: `${t.name} — ${money(t.balance)}` }));
  const fmt = (v: number) => v.toLocaleString(numeralsLocale());
  const unpaid = (data?.lines || []).filter((l) => !l.paid);
  const unpaidNet = unpaid.reduce((t, l) => t + n(l.net), 0);
  const insuredMonthly = empFilter.filtered.reduce((t, r) => t + n(r.insurance), 0);
  const remitted = remits.reduce((t, r) => t + n(r.amount), 0);

  const pickable = emps.filter((e) => e.active && (!branchId || e.branch_id === branchId))
    .map((e) => ({ employee_id: e.employee_id, name: e.name }));

  const leavesTab = useLeavesTab({
    active: tab === 'leaves', branchId, period, employees: pickable, onChanged: () => loadMonth(),
  });
  const penaltiesTab = useAdjustmentsTab({
    mode: 'penalty', active: tab === 'penalties', branchId, period, employees: pickable,
    onChanged: () => loadMonth(),
  });
  const bonusesTab = useAdjustmentsTab({
    mode: 'bonus', active: tab === 'bonuses', branchId, period, employees: pickable,
    onChanged: () => loadMonth(),
  });
  const extra = tab === 'leaves' ? leavesTab : tab === 'penalties' ? penaltiesTab
    : tab === 'bonuses' ? bonusesTab : null;

  const branchSelect = branches.length > 1 ? (
    <Select showSearch placeholder="الفرع" style={{ minWidth: 160 }} value={branchId}
      onChange={(v) => { setBranchId(v); loadMonth(v, period); }}
      options={branches.map((b) => ({ value: b.id, label: b.name }))}
      filterOption={searchFilter} filterSort={searchRank} />
  ) : null;

  return (
    <>
      <ListPage
        icon={<DollarOutlined />}
        title="المرتبات"
        tabs={[
          { key: 'month', label: 'مرتبات الشهر', count: data?.lines.length ?? null },
          { key: 'leaves', label: 'الإجازات' },
          { key: 'penalties', label: 'الجزاءات' },
          { key: 'bonuses', label: 'المكافآت' },
          { key: 'employees', label: 'كروت المرتبات', count: emps.length },
          { key: 'remittances', label: 'سداد التأمينات', count: remits.length },
        ]}
        activeTab={tab as any}
        onTabChange={(k) => setTab(k)}
        actions={extra ? extra.actions : tab === 'month' ? (<>
          {!run || draft ? (
            <Button type="primary" icon={<ReloadOutlined />} loading={busy} onClick={calculate}>
              {run ? 'إعادة الحساب' : 'احسب الشهر'}
            </Button>
          ) : null}
          {draft ? (
            <Popconfirm title="ترحيل مرتبات الشهر إلى الحسابات؟" onConfirm={post}>
              <Button icon={<CheckOutlined />} loading={busy}>ترحيل</Button>
            </Popconfirm>
          ) : null}
          {posted && unpaid.length ? (
            <Button type="primary" icon={<WalletOutlined />} onClick={() => setPayOpen({})}>
              صرف المرتبات
            </Button>
          ) : null}
          {posted && !(data?.lines || []).some((l) => l.paid) ? (
            <Popconfirm title="إلغاء ترحيل مرتبات الشهر؟" onConfirm={unpost}>
              <Button icon={<RollbackOutlined />} loading={busy}>إلغاء الترحيل</Button>
            </Popconfirm>
          ) : null}
          {draft ? (
            <Popconfirm title="حذف مرتبات الشهر؟" onConfirm={removeRun}>
              <Button danger icon={<DeleteOutlined />} loading={busy}>حذف</Button>
            </Popconfirm>
          ) : null}
          {draft ? (
            <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>إضافة موظف</Button>
          ) : null}
          {run ? <Button icon={<PrinterOutlined />} onClick={printMonth}>طباعة</Button> : null}
          {monthCols.control}
        </>) : tab === 'employees' ? (<>
          <Checkbox checked={showInactive}
            onChange={(e) => { setShowInactive(e.target.checked); loadEmps(e.target.checked); }}>
            إظهار الموقوفين
          </Checkbox>
          <Button type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={() => setNewCardOpen(true)}>كارت مرتب جديد</Button>
          {empCols.control}
          <Button icon={<ReloadOutlined />} onClick={() => loadEmps()}>تحديث</Button>
        </>) : (<>
          <Button type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={() => openRemit()}>سداد جديد</Button>
          <Button icon={<ReloadOutlined />} onClick={loadRemits}>تحديث</Button>
        </>)}
        filters={extra ? (<>
          {branchSelect}
          <DatePicker picker="month" allowClear={false} value={period} format="YYYY/MM"
            onChange={(v) => { if (v) { setPeriod(v); loadMonth(branchId, v); } }} />
        </>) : tab === 'month' ? (<>
          {branchSelect}
          <DatePicker picker="month" allowClear={false} value={period} format="YYYY/MM"
            onChange={(v) => { if (v) { setPeriod(v); loadMonth(branchId, v); } }} />
          <Input className="sl-f-search" allowClear ref={searchRef} value={monthFilter.query}
            placeholder="بحث بالاسم أو الرقم" prefix={<SearchOutlined />}
            onChange={(e) => monthFilter.setQuery(e.target.value)} />
          <Select allowClear placeholder="الصرف" style={{ minWidth: 130 }} value={monthFilter.values.paid}
            onChange={(v) => monthFilter.setValue('paid', v)}
            options={[{ value: 'yes', label: 'مصروف' }, { value: 'no', label: 'غير مصروف' }]} />
        </>) : tab === 'employees' ? (<>
          <Input className="sl-f-search" allowClear ref={searchRef} value={empFilter.query}
            placeholder="بحث بالاسم أو الرقم" prefix={<SearchOutlined />}
            onChange={(e) => empFilter.setQuery(e.target.value)} />
          {branches.length > 1 ? (
            <Select allowClear showSearch placeholder="الفرع" style={{ minWidth: 150 }}
              value={empFilter.values.branch_id} onChange={(v) => empFilter.setValue('branch_id', v)}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              filterOption={searchFilter} filterSort={searchRank} />
          ) : null}
          <Select allowClear placeholder="كارت المرتب" style={{ minWidth: 140 }} value={empFilter.values.card}
            onChange={(v) => empFilter.setValue('card', v)}
            options={[{ value: 'yes', label: 'له كارت' }, { value: 'no', label: 'بدون كارت' }]} />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={empFilter.reset}>مسح</Button>
        </>) : undefined}
        summary={extra ? extra.summary : tab === 'month' ? (<>
          <ListStat label="الحالة" value={run ? <Tag color={STATUS_COLOR[run.status]}>{run.status_label}</Tag> : 'لم يُحسب'} />
          <ListStat label="الموظفين" value={fmt(lines.length)} />
          <ListStat label="إجمالي المستحق" value={money(sum('earnings'))} />
          <ListStat label="إجمالي الخصم" value={money(sum('total_deductions'))} tone="neg" />
          <ListStat label="الصافي" value={money(sum('net'))} tone="strong" />
          {posted ? <ListStat label="لم يُصرف" value={money(unpaidNet)} tone="warn" /> : null}
          {data?.without_card.length ? (
            <ListStat label="بدون كارت مرتب"
              value={<a onClick={() => { empFilter.setValue('card', 'no'); setTab('employees'); }}>{fmt(data.without_card.length)}</a>}
              tone="warn" />
          ) : null}
        </>) : tab === 'employees' ? (<>
          <ListStat label="الموظفين" value={fmt(empFilter.filtered.length)} />
          <ListStat label="لهم كارت" value={fmt(empFilter.filtered.filter((r) => r.has_card).length)} tone="pos" />
          <ListStat label="إجمالي الأساسي" value={money(empFilter.filtered.reduce((t, r) => t + n(r.basic), 0))} />
          <ListStat label="التأمينات الشهرية" value={money(insuredMonthly)} tone="strong" />
        </>) : (<>
          <ListStat label="عدد مرات السداد" value={fmt(remits.length)} />
          <ListStat label="إجمالي المسدد" value={money(remitted)} tone="strong" />
        </>)}
      >
        {extra ? extra.body : tab === 'month' ? (
          <Table<Line>
            {...monthKb.tableProps}
            className="sl-table" rowKey="employee_id" size="small" loading={loading}
            dataSource={lines}
            locale={{ emptyText: run ? 'لا يوجد موظفون' : 'لم تُحسب مرتبات هذا الشهر' }}
            pagination={{ defaultPageSize: 100, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={monthCols.columns}
          />
        ) : tab === 'employees' ? (
          <Table<EmpRow>
            {...empKb.tableProps}
            className="sl-table" rowKey="employee_id" size="small"
            dataSource={empFilter.filtered}
            locale={{ emptyText: 'لا يوجد موظفون' }}
            pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={empCols.columns}
          />
        ) : (
          <Table<Remittance>
            className="sl-table" rowKey="id" size="small" dataSource={remits}
            locale={{ emptyText: 'لا توجد مبالغ مسددة' }}
            pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: 'رقم المستند', dataIndex: 'document_number', key: 'document_number', width: 130 },
              { title: 'التاريخ', dataIndex: 'remit_date', key: 'remit_date', width: 120 },
              { title: 'المبلغ', dataIndex: 'amount', key: 'amount', align: 'left',
                render: (v: string) => <b>{money(v)}</b> },
              { title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', render: (v: number | null) => branchName(v) },
              { title: 'الخزنة', dataIndex: 'treasury_id', key: 'treasury_id', render: (v: number | null) => treasuryName(v) },
              { title: 'ملاحظات', dataIndex: 'notes', key: 'notes', render: (v: string | null) => v || '' },
              { title: '', key: 'x', width: 90,
                render: (_: any, r: Remittance) => (
                  <Space size={0}>
                    <Button type="text" icon={<EditOutlined />} title="تعديل" onClick={() => openRemit(r)} />
                    <Popconfirm title="حذف السداد وعكس قيده؟" onConfirm={() => deleteRemit(r.id)}>
                      <Button type="text" danger icon={<DeleteOutlined />} title="حذف" />
                    </Popconfirm>
                  </Space>
                ) },
            ]}
          />
        )}
      </ListPage>

      {cardOf !== null ? (
        <SalaryCard employeeId={cardOf} period={period}
          onClose={() => setCardOf(null)} onSaved={() => { loadEmps(); }} />
      ) : null}

      {lineOf !== null && data ? (
        <MonthLine
          line={data.lines.find((l) => l.employee_id === lineOf) || null}
          run={run} editable={draft}
          onClose={() => setLineOf(null)}
          onChanged={(d) => setData(d)}
          onPrint={printSlip}
          onPay={(id) => setPayOpen({ ids: [id] })}
          onUnpay={unpay}
          onCard={(id) => { setLineOf(null); setCardOf(id); }}
        />
      ) : null}

      <TabModal
        open={!!payOpen} title={payOpen?.ids ? 'صرف مرتب موظف' : 'صرف المرتبات'} destroyOnClose
        onCancel={() => setPayOpen(null)} onOk={pay} okText="صرف" cancelText="إلغاء"
        okButtonProps={{ loading: busy }}
      >
        <Row gutter={[10, 10]}>
          <Col span={24}>
            المبلغ: <b>{money(payOpen?.ids
              ? unpaid.filter((l) => payOpen.ids!.includes(l.employee_id)).reduce((t, l) => t + n(l.net), 0)
              : unpaidNet)}</b>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>التاريخ</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={payForm.pay_date} onChange={(v) => v && setPayForm({ ...payForm, pay_date: v })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>الخزنة</div>
            <Select allowClear style={{ width: '100%' }} placeholder="خزنة الفرع"
              value={payForm.treasury_id} onChange={(v) => setPayForm({ ...payForm, treasury_id: v })}
              options={treasuryOptions} />
          </Col>
        </Row>
      </TabModal>

      <TabModal
        open={addOpen} title="إضافة موظف لمرتبات الشهر" destroyOnClose
        onCancel={() => setAddOpen(false)} onOk={addLine} okText="إضافة" cancelText="إلغاء"
        okButtonProps={{ loading: busy }}
      >
        <Select showSearch style={{ width: '100%' }} placeholder="الموظف" value={addId}
          onChange={setAddId} filterOption={searchFilter} filterSort={searchRank}
          notFoundContent="لا يوجد موظفون لهم كارت مرتب خارج هذا الشهر"
          options={(data?.addable || []).map((e) => ({ value: e.employee_id, label: e.name }))} />
      </TabModal>

      <TabModal
        open={newCardOpen} title="كارت مرتب جديد" destroyOnClose
        onCancel={() => setNewCardOpen(false)} okText="متابعة" cancelText="إلغاء"
        onOk={() => {
          if (!newCardId) { message.warning('اختر الموظف'); return; }
          setNewCardOpen(false);
          setCardOf(newCardId);
          setNewCardId(undefined);
        }}
      >
        <Select showSearch style={{ width: '100%' }} placeholder="الموظف" value={newCardId}
          onChange={setNewCardId} filterOption={searchFilter} filterSort={searchRank}
          options={emps.filter((e) => e.active).sort((a, b) => Number(a.has_card) - Number(b.has_card))
            .map((e) => ({ value: e.employee_id, label: `${e.name}${e.has_card ? ' — له كارت' : ''}${branches.length > 1 ? ` — ${branchName(e.branch_id)}` : ''}` }))} />
      </TabModal>

      <TabModal
        open={remitOpen !== null} title={remitOpen === 'new' ? 'سداد تأمينات' : 'تعديل سداد تأمينات'} destroyOnClose
        onCancel={() => setRemitOpen(null)} onOk={saveRemit} okText="حفظ" cancelText="إلغاء"
        okButtonProps={{ loading: busy }}
      >
        <Row gutter={[10, 10]}>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>المبلغ *</div>
            <InputNumber style={{ width: '100%' }} min={0} value={remitForm.amount}
              onChange={(v) => setRemitForm({ ...remitForm, amount: v ?? undefined })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>التاريخ</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={remitForm.remit_date} onChange={(v) => v && setRemitForm({ ...remitForm, remit_date: v })} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>الخزنة</div>
            <Select allowClear style={{ width: '100%' }} placeholder="خزنة الفرع"
              value={remitForm.treasury_id} onChange={(v) => setRemitForm({ ...remitForm, treasury_id: v })}
              options={treasuryOptions} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>ملاحظات</div>
            <Input value={remitForm.notes} onChange={(e) => setRemitForm({ ...remitForm, notes: e.target.value })} />
          </Col>
        </Row>
      </TabModal>
    </>
  );
}

function MonthLine({ line, run, editable, onClose, onChanged, onPrint, onPay, onUnpay, onCard }: {
  line: Line | null;
  run: MonthData['run'];
  editable: boolean;
  onClose: () => void;
  onChanged: (d: MonthData) => void;
  onPrint: (l: Line) => void;
  onPay: (employeeId: number) => void;
  onUnpay: (employeeId: number) => void;
  onCard: (employeeId: number) => void;
}) {
  const [form, setForm] = useState({
    absent_override: line?.absent_override !== null && line?.absent_override !== undefined ? Number(line.absent_override) : undefined as number | undefined,
    commission_override: line?.commission_override !== null && line?.commission_override !== undefined ? Number(line.commission_override) : undefined as number | undefined,
    extra_earning: line?.extra_earning ? Number(line.extra_earning) : undefined as number | undefined,
    extra_deduction: line?.extra_deduction ? Number(line.extra_deduction) : undefined as number | undefined,
    notes: line?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  if (!line || !run) return null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/api/v1/hr/salary/month/${run.id}/employees/${line.employee_id}`, {
        absent_override: form.absent_override ?? null,
        commission_override: form.commission_override ?? null,
        extra_earning: form.extra_earning ?? null,
        extra_deduction: form.extra_deduction ?? null,
        notes: form.notes || null,
      });
      onChanged(res.data);
      message.success('تم الحفظ');
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const earn = line.details.filter((d) => d.kind === 'earning');
  const ded = line.details.filter((d) => d.kind === 'deduction');

  return (
    <TabModal open width={760} footer={null} destroyOnClose title={`${line.name} — ${run.year}/${String(run.month).padStart(2, '0')}`}
      onCancel={onClose}>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Divider style={{ margin: '0 0 6px' }}>المستحق</Divider>
          <Table size="small" pagination={false} rowKey={(_, i) => `e${i}`}
            dataSource={[{ label: 'الأساسي', amount: line.basic, quantity: null } as any, ...earn]}
            columns={[
              { title: 'البند', dataIndex: 'label' },
              { title: 'المبلغ', dataIndex: 'amount', align: 'left', render: money },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="left"><b>{money(line.earnings)}</b></Table.Summary.Cell>
              </Table.Summary.Row>
            )} />
        </Col>
        <Col xs={24} md={12}>
          <Divider style={{ margin: '0 0 6px' }}>الخصومات</Divider>
          <Table size="small" pagination={false} rowKey={(_, i) => `d${i}`} dataSource={ded}
            locale={{ emptyText: 'لا توجد خصومات' }}
            columns={[
              { title: 'البند', dataIndex: 'label',
                render: (v: string, d: Detail) => (d.source === 'absence' && d.quantity ? `${v} (${Number(d.quantity)} يوم)` : v) },
              { title: 'المبلغ', dataIndex: 'amount', align: 'left', render: money },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="left"><b>{money(line.total_deductions)}</b></Table.Summary.Cell>
              </Table.Summary.Row>
            )} />
        </Col>
      </Row>

      <div style={{ fontSize: 16, margin: '12px 0' }}>
        الصافي: <b>{money(line.net)}</b>
        {line.paid ? <Tag color="green" style={{ marginInlineStart: 8 }}>مصروف</Tag> : null}
        {line.commission_base !== null && n(line.commission_base) ? (
          <span style={{ marginInlineStart: 16, color: '#666' }}>
            أساس العمولة: {money(line.commission_base)}
          </span>
        ) : null}
      </div>

      {editable ? (<>
        <Divider style={{ margin: '6px 0' }}>تعديل هذا الشهر</Divider>
        <Row gutter={[10, 10]}>
          <Col xs={12} md={6}>
            <div style={{ marginBottom: 4 }}>أيام الغياب</div>
            <InputNumber style={{ width: '100%' }} min={0} value={form.absent_override}
              placeholder={String(Number(line.days_absent))}
              onChange={(v) => setForm({ ...form, absent_override: v ?? undefined })} />
          </Col>
          <Col xs={12} md={6}>
            <div style={{ marginBottom: 4 }}>العمولة</div>
            <InputNumber style={{ width: '100%' }} min={0} value={form.commission_override}
              placeholder={money(line.commission)}
              onChange={(v) => setForm({ ...form, commission_override: v ?? undefined })} />
          </Col>
          <Col xs={12} md={6}>
            <div style={{ marginBottom: 4 }}>إضافة</div>
            <InputNumber style={{ width: '100%' }} min={0} value={form.extra_earning}
              onChange={(v) => setForm({ ...form, extra_earning: v ?? undefined })} />
          </Col>
          <Col xs={12} md={6}>
            <div style={{ marginBottom: 4 }}>خصم</div>
            <InputNumber style={{ width: '100%' }} min={0} value={form.extra_deduction}
              onChange={(v) => setForm({ ...form, extra_deduction: v ?? undefined })} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>ملاحظات</div>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Col>
        </Row>
      </>) : null}

      <Space style={{ marginTop: 14 }} wrap>
        {editable ? <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>حفظ</Button> : null}
        <Button icon={<PrinterOutlined />} onClick={() => onPrint(line)}>طباعة القسيمة</Button>
        {run.status === 'posted' && !line.paid ? (
          <Button icon={<WalletOutlined />} onClick={() => onPay(line.employee_id)}>صرف مرتبه</Button>
        ) : null}
        {line.paid ? (
          <Popconfirm title="إلغاء صرف المرتب؟" onConfirm={() => onUnpay(line.employee_id)}>
            <Button icon={<RollbackOutlined />}>إلغاء الصرف</Button>
          </Popconfirm>
        ) : null}
        <Button icon={<EditOutlined />} onClick={() => onCard(line.employee_id)}>كارت المرتب</Button>
      </Space>
    </TabModal>
  );
}

function SalaryCard({ employeeId, period, onClose, onSaved }: {
  employeeId: number; period: Dayjs; onClose: () => void; onSaved: () => void;
}) {
  const [card, setCard] = useState<any>(null);
  const [from, setFrom] = useState<Dayjs>(dayjs().startOf('month'));
  const [basic, setBasic] = useState<number | undefined>();
  const [items, setItems] = useState<Item[]>([]);
  const [insurance, setInsurance] = useState<number | undefined>();
  const [rules, setRules] = useState<Rule[]>([]);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [names, setNames] = useState<{ name: string; kind: string }[]>([]);

  const fill = (c: any) => {
    setCard(c);
    setBasic(c.current.basic !== null ? Number(c.current.basic) : undefined);
    setItems((c.current.items || []).map((i: any) => ({ name: i.name, kind: i.kind, amount: Number(i.amount) })));
    setInsurance(Number(c.insurance || 0) || undefined);
    setRules((c.rules || []).map((r: any) => ({ basis: r.basis, pct: Number(r.pct) })));
  };

  const load = async () => {
    try {
      const res = await api.get(`/api/v1/hr/salary/employees/${employeeId}`);
      fill(res.data);
      const pv = await api.get(`/api/v1/hr/salary/employees/${employeeId}/commission`,
        { params: { year: period.year(), month: period.month() + 1 } });
      setPreview(pv.data);
    } catch (err: any) { fail(err, 'تعذر تحميل كارت المرتب'); }
  };

  useEffect(() => {
    load();
    api.get('/api/v1/hr/payroll/components')
      .then((r) => setNames((r.data || []).filter((c: any) => c.active !== false)
        .map((c: any) => ({ name: c.name, kind: c.kind }))))
      .catch(() => {});
  }, [employeeId]);

  const save = async () => {
    if (basic === undefined || basic === null) { message.warning('أدخل الأساسي'); return; }
    setSaving(true);
    try {
      const res = await api.put(`/api/v1/hr/salary/employees/${employeeId}`, {
        effective_from: from.format('YYYY-MM-DD'), basic: String(basic),
        items: items.filter((i) => i.name.trim()).map((i) => ({ ...i, amount: String(i.amount ?? 0) })),
        insurance: String(insurance ?? 0),
        rules: rules.filter((r) => Number(r.pct) > 0).map((r) => ({ basis: r.basis, pct: String(r.pct) })),
      });
      fill(res.data);
      message.success('تم حفظ كارت المرتب');
      onSaved();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const removeVersion = async (id: number) => {
    try {
      await api.delete(`/api/v1/hr/payroll/salaries/versions/${id}`);
      message.success('تم الحذف');
      await load();
      onSaved();
    } catch (err: any) { fail(err, 'تعذر الحذف'); }
  };

  const setItem = (i: number, patch: Partial<Item>) => setItems(items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const setRule = (i: number, patch: Partial<Rule>) => setRules(rules.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const earnTotal = items.filter((i) => i.kind === 'earning').reduce((t, i) => t + n(i.amount), 0);
  const dedTotal = items.filter((i) => i.kind === 'deduction').reduce((t, i) => t + n(i.amount), 0);
  const nameOptions = useMemo(() => names.map((x) => ({ value: x.name, label: x.name })), [names]);

  return (
    <TabModal open width={860} footer={null} destroyOnClose
      title={card ? `كارت المرتب — ${card.employee.name}` : 'كارت المرتب'} onCancel={onClose}>
      {!card ? null : (<>
        <Row gutter={[10, 10]} align="bottom">
          <Col xs={12} md={6}>
            <div style={{ marginBottom: 4 }}>ساري من</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={from} onChange={(v) => v && setFrom(v)} />
          </Col>
          <Col xs={12} md={6}>
            <div style={{ marginBottom: 4 }}>الأساسي *</div>
            <InputNumber style={{ width: '100%' }} min={0} value={basic} onChange={(v) => setBasic(v ?? undefined)} />
          </Col>
          <Col xs={12} md={6}>
            <div style={{ marginBottom: 4 }}>التأمينات الشهرية</div>
            <InputNumber style={{ width: '100%' }} min={0} value={insurance} onChange={(v) => setInsurance(v ?? undefined)} />
          </Col>
        </Row>

        <Divider style={{ margin: '12px 0 6px' }}>البدلات والخصومات الثابتة</Divider>
        {items.map((it, i) => (
          <Row gutter={8} key={i} style={{ marginBottom: 6 }}>
            <Col xs={6} md={5}>
              <Select style={{ width: '100%' }} value={it.kind} onChange={(v) => setItem(i, { kind: v })}
                options={[{ value: 'earning', label: 'إضافة' }, { value: 'deduction', label: 'خصم' }]} />
            </Col>
            <Col xs={10} md={11}>
              <Select showSearch allowClear style={{ width: '100%' }} placeholder="اسم البند"
                value={it.name || undefined}
                options={[...nameOptions.filter((o) => names.find((x) => x.name === o.value)?.kind === it.kind),
                  ...(it.name && !names.some((x) => x.name === it.name) ? [{ value: it.name, label: it.name }] : [])]}
                onSearch={(v) => v && setItem(i, { name: v })}
                onChange={(v) => setItem(i, { name: v || '' })}
                filterOption={searchFilter} />
            </Col>
            <Col xs={6} md={6}>
              <InputNumber style={{ width: '100%' }} min={0} value={it.amount} placeholder="المبلغ"
                onChange={(v) => setItem(i, { amount: v ?? undefined })} />
            </Col>
            <Col xs={2} md={2}>
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setItems(items.filter((_, k) => k !== i))} />
            </Col>
          </Row>
        ))}
        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={() => setItems([...items, { name: '', kind: 'earning' }])}>بند</Button>
          <span>البدلات: <b>{money(earnTotal)}</b></span>
          <span>الخصومات الثابتة: <b>{money(dedTotal)}</b></span>
          <span>إجمالي الثابت: <b>{money(n(basic) + earnTotal - dedTotal - n(insurance))}</b></span>
        </Space>

        <Divider style={{ margin: '12px 0 6px' }}>العمولة</Divider>
        {!card.employee.linked_user ? (
          <Tag color="orange">الموظف غير مربوط بحساب مستخدم أو مندوب</Tag>
        ) : (<>
          {rules.map((r, i) => (
            <Row gutter={8} key={i} style={{ marginBottom: 6 }}>
              <Col xs={8} md={5}>
                <InputNumber style={{ width: '100%' }} min={0} max={100} value={Number(r.pct) || undefined}
                  addonAfter="٪" onChange={(v) => setRule(i, { pct: v ?? 0 })} />
              </Col>
              <Col xs={12} md={8}>
                <Select style={{ width: '100%' }} value={r.basis} options={BASIS}
                  onChange={(v) => setRule(i, { basis: v })} />
              </Col>
              <Col xs={4} md={2}>
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setRules(rules.filter((_, k) => k !== i))} />
              </Col>
            </Row>
          ))}
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => setRules([...rules, { basis: 'sales', pct: 1 }])}>نسبة عمولة</Button>
            {preview && preview.length ? preview.map((p) => (
              <span key={p.id}>
                {p.basis_label} {period.format('YYYY/MM')}: <b>{money(p.base)}</b> ← عمولة <b>{money(p.amount)}</b>
              </span>
            )) : null}
          </Space>
        </>)}

        <div style={{ marginTop: 14 }}>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>حفظ</Button>
        </div>

        <Divider style={{ margin: '14px 0 6px' }}>سجل المرتب</Divider>
        <Table size="small" rowKey="id" pagination={false} dataSource={card.versions}
          locale={{ emptyText: 'لا يوجد' }}
          columns={[
            { title: 'ساري من', dataIndex: 'effective_from', width: 110 },
            { title: 'الأساسي', dataIndex: 'basic', align: 'left', render: money },
            { title: 'البنود', dataIndex: 'items',
              render: (v: any[]) => v.map((i) => `${i.kind === 'deduction' ? '−' : '+'} ${i.name} ${money(i.amount)}`).join('، ') },
            { title: '', key: 'x', width: 90,
              render: (_: any, v: any) => (v.locked ? <Tag>🔒 مرحّل</Tag> : (
                <Popconfirm onConfirm={() => removeVersion(v.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )) },
          ]} />

        <Divider style={{ margin: '14px 0 6px' }}>التأمينات</Divider>
        <Table size="small" rowKey="id" pagination={false} dataSource={card.insurance_history.versions}
          locale={{ emptyText: 'لا يوجد' }}
          columns={[
            { title: 'ساري من', dataIndex: 'effective_from', width: 110 },
            { title: 'المبلغ', dataIndex: 'amount', align: 'left', render: money },
            { title: '', key: 'x', width: 90, render: (_: any, v: any) => (v.locked ? <Tag>🔒 مرحّل</Tag> : null) },
          ]} />

        <Divider style={{ margin: '14px 0 6px' }}>الشهور</Divider>
        <Table size="small" rowKey="run_id" pagination={false} dataSource={card.months}
          locale={{ emptyText: 'لا يوجد' }}
          columns={[
            { title: 'الشهر', key: 'm', width: 90, render: (_: any, m: any) => `${m.year}/${String(m.month).padStart(2, '0')}` },
            { title: 'المستحق', dataIndex: 'gross', align: 'left', render: money },
            { title: 'التأمينات', dataIndex: 'insurance', align: 'left', render: money },
            { title: 'الصافي', dataIndex: 'net', align: 'left', render: (v: string) => <b>{money(v)}</b> },
            { title: 'الحالة', dataIndex: 'status', width: 90,
              render: (v: string, m: any) => <Tag color={STATUS_COLOR[v]}>{m.status_label}</Tag> },
            { title: 'الصرف', dataIndex: 'paid', width: 90, render: (v: boolean) => (v ? <Tag color="green">مصروف</Tag> : '—') },
          ]} />
      </>)}
    </TabModal>
  );
}

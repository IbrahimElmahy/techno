import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Alert, Button, Col, DatePicker, Dropdown, Input, Row, Segmented, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import {
  DownloadOutlined, DownOutlined, IdcardOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useTableKeyboard } from '../components/keyboard';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import { TabModal } from '../components/TabModal';
import CostCenterField from '../components/CostCenterField';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn, type PrintTotal } from '../print/reportSheet';
import { money, numeralsLocale } from '../utils/money';
import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import ReceiptModal from './vouchers/ReceiptModal';
import EmployeeFormModal from '../components/EmployeeFormModal';
import { useAuth } from '../components/AuthProvider';
import { ownBranches } from '../utils/branchScope';
import PaymentModal from './vouchers/PaymentModal';
import { useQuickVoucher } from './vouchers/useQuickVoucher';
import type { PartyKind } from './vouchers/PartyKind';
import type { Party } from './vouchers/types';
import PlanEditor, { equalPlan, type PlanMode, type PlanRow } from './payroll/PlanEditor';
import type { ListTab } from '../components/ListPage';

interface DueRow {
  employee_id: number | null;
  employee_code: string | null;
  employee_name: string | null;
  job_title: string | null;
  department: string | null;
  branch_id: number | null;
  active: boolean | null;
  account_id: number | null;
  account_code: string | null;
  account_name: string | null;
  customer_id: number | null;
  ledger_debit: string;
  ledger_credit: string;
  ledger_balance: string;
  ledger_lines: number;
  last_ledger_date: string | null;
  advances_outstanding: string | null;
  open_advances: number | null;
  remaining_instalments: number | null;
  next_instalment_year: number | null;
  next_instalment_month: number | null;
  next_instalment_amount: string | null;
  last_advance_date: string | null;
  total_due: string;
  last_movement: string | null;
}

interface DuesPayload {
  rows: DueRow[];
  total_ledger: string;
  total_advances: string;
  total_due: string;
  unlinked_employees: number;
  advances_visible: boolean;
}

interface ScheduleRow {
  id: number; year: number; month: number; amount: string; paid: boolean;
  method: 'payroll' | 'cash' | null; voucher_id: number | null; paid_on: string | null;
}

interface Advance {
  id: number;
  document_number: string;
  employee_id: number;
  employee_name: string | null;
  advance_date: string;
  amount: string;
  instalments: number;
  instalment_amount: string;
  start_year: number;
  start_month: number;
  status: string;
  taken: string;
  outstanding: string;
  reason: string | null;
  treasury_id: number | null;
  cost_center_id: number | null;
  schedule: ScheduleRow[];
}

interface Adjustment {
  id: number;
  document_number: string;
  employee_id: number;
  employee_name: string | null;
  kind: string;
  basis: string;
  quantity: string | null;
  amount: string;
  year: number;
  month: number;
  reason: string | null;
  status: string;
  applied: boolean;
}

type TabKey = 'open' | 'all' | 'advances' | 'adjustments';
const TAB_KEYS: TabKey[] = ['open', 'all', 'advances', 'adjustments'];

const ADVANCE_STATUS: Record<string, { label: string; color?: string }> = {
  active: { label: 'قيد التقسيط', color: 'blue' },
  settled: { label: 'مسدَّدة', color: 'green' },
  cancelled: { label: 'ملغية' },
};

const KIND: Record<string, { label: string; color: string; sign: number }> = {
  penalty: { label: 'جزاء', color: 'red', sign: -1 },
  bonus: { label: 'مكافأة', color: 'green', sign: 1 },
  other_deduction: { label: 'استقطاع', color: 'volcano', sign: -1 },
  other_earning: { label: 'استحقاق', color: 'cyan', sign: 1 },
};

const period = (y: number | null, m: number | null) =>
  (y && m ? `${y}/${String(m).padStart(2, '0')}` : '');

export function instalmentLabel(count: number, each: string): string {
  return count <= 1 ? 'قسط واحد' : `${count} أقساط × ${money(each)}`;
}

export function adjustmentValue(row: Adjustment): string {
  if (row.basis === 'days') return `${Number(row.quantity)} يوم`;
  if (row.basis === 'hours') return `${Number(row.quantity)} ساعة`;
  return money(row.amount);
}

const remaining = (a: Advance) => (a.status === 'cancelled' ? 0 : Number(a.outstanding || 0));

const editable = (a: Advance) => a.status === 'active' && Number(a.taken) === 0;

const emptyAdvance = () => ({
  id: undefined as number | undefined,
  employee_id: undefined as number | undefined,
  amount: undefined as number | undefined,
  advance_date: dayjs() as Dayjs,
  start: dayjs() as Dayjs,
  instalments: 1,
  treasury_id: undefined as number | undefined,
  cost_center_id: undefined as number | undefined,
  reason: '',
  planMode: 'equal' as PlanMode,
  planRows: [] as PlanRow[],
});

export interface ReceivablesHost {
  title: React.ReactNode; icon: React.ReactNode;
  tabs: ListTab<any>[]; activeTab: string; onTabChange: (k: any) => void;
}

export default function EmployeeReceivables({ host }: { host?: ReceivablesHost } = {}) {
  const navigate = useNavigate();
  const [tabRaw, setTab] = useQueryTab('open', host ? 'sub' : 'tab');
  const tab: TabKey = tabRaw === 'nonzero' ? 'open'
    : (TAB_KEYS.includes(tabRaw as TabKey) ? tabRaw as TabKey : 'open');
  const onDues = tab === 'open' || tab === 'all';

  const [dues, setDues] = useState<DuesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState<number | undefined>();
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [treasuries, setTreasuries] = useState<any[]>([]);

  const [advances, setAdvances] = useState<Advance[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [employeeId, setEmployeeId] = useState<number | undefined>();
  const [advStatus, setAdvStatus] = useState<string | undefined>();
  const [byEmployee, setByEmployee] = useState<Record<number, Advance[]>>({});
  const [expanded, setExpanded] = useState<React.Key[]>([]);

  const [advOpen, setAdvOpen] = useState(false);
  const [advForm, setAdvForm] = useState(emptyAdvance());
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState<any>({
    employee_id: undefined, kind: 'penalty', basis: 'amount',
    amount: undefined, quantity: undefined, period: dayjs() as Dayjs, reason: '',
  });
  const [saving, setSaving] = useState(false);

  const loadDues = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/employee-dues', {
        params: { q: q || undefined, branch_id: branchId, only_open: tab !== 'all' },
      });
      setDues(res.data);
    } catch {} finally { setLoading(false); }
  }, [q, branchId, tab === 'all']);

  const advancesVisible = dues?.advances_visible ?? false;
  const { user } = useAuth();
  const canAddEmployee = ['owner', 'system_admin', 'branch_manager', 'accountant'].includes(user?.role ?? '');
  const [empOpen, setEmpOpen] = useState(false);

  const loadAdvances = useCallback(async () => {
    if (!advancesVisible) return;
    setLoading(true);
    try {
      const params = { employee_id: employeeId, status: advStatus };
      const [a, j] = await Promise.all([
        api.get('/api/v1/hr/advances', { params }),
        api.get('/api/v1/hr/adjustments', { params: { employee_id: employeeId } }),
      ]);
      setAdvances(a.data || []);
      setAdjustments(j.data || []);
    } catch {} finally { setLoading(false); }
  }, [advancesVisible, employeeId, advStatus]);

  useEffect(() => { loadDues(); }, [loadDues]);
  useEffect(() => { if (!onDues) loadAdvances(); }, [onDues, loadAdvances]);
  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(ownBranches(r.data || [], user))).catch(() => {});
    api.get('/api/v1/employees').then((r) => setEmployees(r.data || [])).catch(() => {});
  }, []);

  const reloadAll = () => { loadDues(); if (!onDues) loadAdvances(); };

  useEffect(() => {
    setByEmployee({});
    expanded.forEach((k) => {
      const id = Number(String(k).replace(/^e/, ''));
      if (String(k).startsWith('e') && id) loadEmployeeAdvances(id);
    });
  }, [dues]);

  const loadEmployeeAdvances = async (id: number) => {
    try {
      const r = await api.get('/api/v1/hr/advances', { params: { employee_id: id } });
      setByEmployee((m) => ({ ...m, [id]: r.data || [] }));
    } catch {}
  };

  const ensureTreasuries = async () => {
    if (treasuries.length) return treasuries;
    const list = (await api.get('/api/v1/treasuries').catch(() => ({ data: [] }))).data || [];
    setTreasuries(list);
    return list;
  };

  const openAdvance = async (employee?: number, edit?: Advance) => {
    await ensureTreasuries();
    if (edit) {
      setAdvForm({
        id: edit.id, employee_id: edit.employee_id, amount: Number(edit.amount),
        advance_date: dayjs(edit.advance_date),
        start: dayjs(`${edit.start_year}-${String(edit.start_month).padStart(2, '0')}-01`),
        instalments: edit.instalments, treasury_id: edit.treasury_id ?? undefined,
        cost_center_id: edit.cost_center_id ?? undefined, reason: edit.reason ?? '',
        planMode: edit.schedule.length ? 'custom' : 'none',
        planRows: edit.schedule.map((p) => ({ year: p.year, month: p.month, amount: Number(p.amount) })),
      });
    } else {
      setAdvForm({ ...emptyAdvance(), employee_id: employee });
    }
    setAdvOpen(true);
  };

  const saveAdvance = async () => {
    if (!advForm.employee_id || !advForm.amount) {
      message.warning('اختر الموظف واكتب المبلغ'); return;
    }
    setSaving(true);
    const plan = advForm.planMode === 'equal'
      ? equalPlan(Number(advForm.amount), advForm.instalments || 1, advForm.start)
      : advForm.planMode === 'custom' ? advForm.planRows.filter((r) => Number(r.amount) > 0) : [];
    if (plan.reduce((t, r) => t + Number(r.amount), 0) > Number(advForm.amount) + 0.001) {
      message.warning('مجموع الأقساط أكبر من مبلغ السلفة'); return;
    }
    const body = {
      amount: String(advForm.amount),
      advance_date: advForm.advance_date.format('YYYY-MM-DD'),
      instalments: Math.max(plan.length, 1),
      start_year: advForm.start.year(),
      start_month: advForm.start.month() + 1,
      reason: advForm.reason || null,
      treasury_id: advForm.treasury_id ?? null,
      cost_center_id: advForm.cost_center_id ?? null,
      plan: plan.map((r) => ({ year: r.year, month: r.month, amount: String(r.amount) })),
    };
    try {
      if (advForm.id) {
        await api.put(`/api/v1/hr/advances/${advForm.id}`, body);
        message.success('تم تعديل السلفة');
      } else {
        await api.post('/api/v1/hr/advances', { ...body, employee_id: advForm.employee_id });
        message.success('تم صرف السلفة');
      }
      setAdvOpen(false);
      reloadAll();
    } catch {} finally { setSaving(false); }
  };

  const [repayOf, setRepayOf] = useState<Advance | null>(null);
  const [repayForm, setRepayForm] = useState<{ amount?: number; date: Dayjs; treasury_id?: number; notes: string }>(
    { date: dayjs(), notes: '' });
  const [planOf, setPlanOf] = useState<Advance | null>(null);
  const [planRows, setPlanRows] = useState<PlanRow[]>([]);
  const [planMode, setPlanMode] = useState<PlanMode>('custom');
  const [planCount, setPlanCount] = useState(1);
  const [planStart, setPlanStart] = useState<Dayjs>(dayjs());

  const openRepay = async (a: Advance) => {
    await ensureTreasuries();
    setRepayForm({ amount: Number(a.outstanding), date: dayjs(), treasury_id: a.treasury_id ?? undefined, notes: '' });
    setRepayOf(a);
  };
  const saveRepay = async () => {
    if (!repayOf || !repayForm.amount) { message.warning('اكتب المبلغ'); return; }
    setSaving(true);
    try {
      await api.post(`/api/v1/hr/advances/${repayOf.id}/repay`, {
        amount: String(repayForm.amount), pay_date: repayForm.date.format('YYYY-MM-DD'),
        treasury_id: repayForm.treasury_id ?? null, notes: repayForm.notes || null,
      });
      message.success('تم التحصيل وتسجيل سند القبض');
      setRepayOf(null);
      reloadAll();
      if (repayOf.employee_id) loadEmployeeAdvances(repayOf.employee_id);
    } catch {} finally { setSaving(false); }
  };
  const openPlan = (a: Advance) => {
    const pending = a.schedule.filter((p) => !p.paid);
    setPlanRows(pending.map((p) => ({ year: p.year, month: p.month, amount: Number(p.amount) })));
    setPlanMode(pending.length ? 'custom' : 'none');
    setPlanCount(Math.max(pending.length, 1));
    setPlanStart(dayjs());
    setPlanOf(a);
  };
  const savePlan = async () => {
    if (!planOf) return;
    const left = Number(planOf.outstanding);
    const plan = planMode === 'equal' ? equalPlan(left, planCount, planStart)
      : planMode === 'custom' ? planRows.filter((r) => Number(r.amount) > 0) : [];
    setSaving(true);
    try {
      await api.put(`/api/v1/hr/advances/${planOf.id}/plan`,
        plan.map((r) => ({ year: r.year, month: r.month, amount: String(r.amount) })));
      message.success('تم حفظ خطة السداد');
      setPlanOf(null);
      reloadAll();
      if (planOf.employee_id) loadEmployeeAdvances(planOf.employee_id);
    } catch {} finally { setSaving(false); }
  };
  const cancelRepay = async (a: Advance, p: ScheduleRow) => {
    try {
      await api.post(`/api/v1/hr/advances/${a.id}/repayments/${p.id}/cancel`);
      message.success('تم إلغاء التحصيل وعكس سند القبض');
      reloadAll();
      loadEmployeeAdvances(a.employee_id);
    } catch {}
  };

  const cancel = async (what: 'advances' | 'adjustments', id: number) => {
    try {
      await api.post(`/api/v1/hr/${what}/${id}/cancel`);
      message.success('تم الإلغاء');
      reloadAll();
    } catch {}
  };

  const saveAdjustment = async () => {
    if (!adjForm.employee_id) { message.warning('اختر الموظف'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/hr/adjustments', {
        employee_id: adjForm.employee_id,
        kind: adjForm.kind,
        basis: adjForm.basis,
        quantity: adjForm.basis === 'amount' ? null : String(adjForm.quantity ?? 0),
        amount: adjForm.basis === 'amount' ? String(adjForm.amount ?? 0) : '0',
        year: adjForm.period.year(),
        month: adjForm.period.month() + 1,
        reason: adjForm.reason || null,
      });
      message.success('تم التسجيل');
      setAdjOpen(false);
      reloadAll();
    } catch {} finally { setSaving(false); }
  };

  const receipt = useQuickVoucher(() => reloadAll());
  const payment = useQuickVoucher(() => reloadAll());
  const [voucherKind, setVoucherKind] = useState<PartyKind>('employee');
  const [cards, setCards] = useState<Party[]>([]);
  const [families, setFamilies] = useState<Record<number, any[]>>({});
  const [target, setTarget] = useState('');

  const openVoucher = async (which: 'receipt' | 'payment', r: DueRow) => {
    let list = cards;
    if (!list.length) {
      list = (await api.get<Party[]>('/api/v1/customers', { params: { party_group: 'employees' } })
        .catch(() => ({ data: [] as Party[] }))).data || [];
    }
    const name = r.employee_name ?? r.account_name ?? '';
    if (r.customer_id && !list.some((c) => c.id === r.customer_id)) {
      list = [...list, { id: r.customer_id, name, customer_type: 'employee' }];
    }
    setCards(list);
    const kind: PartyKind = r.customer_id ? 'employee' : 'account';
    setVoucherKind(kind);
    setTarget('');
    const v = which === 'receipt' ? receipt : payment;
    await v.show();
    const values: any = kind === 'employee'
      ? { customer_id: r.customer_id } : { account_id: r.account_id };
    values.description = which === 'receipt' ? `تحصيل من ذمة ${name}` : `صرف على ذمة ${name}`;
    setTimeout(() => v.form.setFieldsValue(values), 0);
  };

  const branchName = useMemo(
    () => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);
  const rows = dues?.rows ?? [];

  const rowActions = (r: DueRow) => {
    const items: any[] = [];
    if (advancesVisible && r.employee_id) {
      items.push({ key: 'advance', label: 'صرف سلفة على المرتب' });
    }
    if (r.account_id) {
      items.push(
        { key: 'receipt', label: 'تحصيل (سند قبض على الذمة)' },
        { key: 'payment', label: 'صرف على الذمة (سند صرف)' },
        { key: 'statement', label: 'كشف حساب الموظف' },
      );
    }
    if (advancesVisible && r.employee_id && r.last_advance_date) {
      items.push({ key: 'advances', label: 'كل سلفه' });
    }
    if (advancesVisible && r.employee_id) {
    }
    const onClick = ({ key }: { key: string }) => {
      if (key === 'advance') openAdvance(r.employee_id!);
      if (key === 'receipt') openVoucher('receipt', r);
      if (key === 'payment') openVoucher('payment', r);
      if (key === 'statement') navigate(`/account-statement?account=${r.account_id}`);
      if (key === 'advances') { setEmployeeId(r.employee_id!); setAdvStatus(undefined); setTab('advances'); }
      if (key === 'adjustment') {
        setAdjForm({ ...adjForm, employee_id: r.employee_id, amount: undefined, quantity: undefined, reason: '' });
        setAdjOpen(true);
      }
    };
    return items.length ? (
      <Dropdown menu={{ items, onClick }} trigger={['click']}>
        <Button size="small" onClick={(e) => e.stopPropagation()}>
          إجراءات <DownOutlined />
        </Button>
      </Dropdown>
    ) : null;
  };

  const dueColumns: ColumnsType<DueRow> = [
    {
      title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name', width: 220, ellipsis: true,
      sorter: (a, b) => (a.employee_name ?? a.account_name ?? '')
        .localeCompare(b.employee_name ?? b.account_name ?? ''),
      render: (v: string | null, r) => (v ? (
        <span>
          {v}
          {r.active === false ? <Tag style={{ marginInlineStart: 6 }}>معطّل</Tag> : null}
        </span>
      ) : (
        <span>{r.account_name} <Tag color="default">حساب بلا موظف</Tag></span>
      )),
    },
    { title: 'كود الموظف', dataIndex: 'employee_code', key: 'employee_code', width: 120,
      render: (v: string | null) => v ?? '—' },
    { title: 'الوظيفة', dataIndex: 'job_title', key: 'job_title', width: 130, ellipsis: true,
      render: (v: string | null) => v ?? '—' },
    { title: 'القسم', dataIndex: 'department', key: 'department', width: 130, ellipsis: true,
      render: (v: string | null) => v ?? '—' },
    { title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', width: 100,
      render: (v: number | null) => (v ? branchName[v] ?? `#${v}` : '—') },
    {
      title: 'الذمة (الدفتر)', dataIndex: 'ledger_balance', key: 'ledger_balance', width: 130,
      align: 'left', sorter: (a, b) => Number(a.ledger_balance) - Number(b.ledger_balance),
      render: (v: string, r) => (r.account_id ? money(v) : (
        <Tooltip title="ليس له حساب ذمة في الشجرة — تُحتسب سلفه فقط">—</Tooltip>
      )),
    },
    ...(advancesVisible ? [
      {
        title: 'السلف المتبقية', dataIndex: 'advances_outstanding', key: 'advances_outstanding',
        width: 130, align: 'left' as const,
        sorter: (a: DueRow, b: DueRow) =>
          Number(a.advances_outstanding ?? 0) - Number(b.advances_outstanding ?? 0),
        render: (v: string | null) => (Number(v) ? money(v) : '—'),
      },
      {
        title: 'الأقساط', key: 'instalments', width: 190,
        render: (_: any, r: DueRow) => (r.remaining_instalments ? (
          <span>
            متبقٍّ {r.remaining_instalments} {r.remaining_instalments === 1 ? 'قسط' : 'أقساط'}
            <span style={{ color: '#888' }}>
              {' · '}{period(r.next_instalment_year, r.next_instalment_month)}: {money(r.next_instalment_amount)}
            </span>
          </span>
        ) : '—'),
      },
    ] : []),
    {
      title: 'الإجمالي', dataIndex: 'total_due', key: 'total_due', width: 140, align: 'left',
      defaultSortOrder: 'descend',
      sorter: (a, b) => Math.abs(Number(a.total_due)) - Math.abs(Number(b.total_due)),
      render: (v: string) => <b style={{ color: Number(v) < 0 ? '#cf1322' : undefined }}>{money(v)}</b>,
    },
    { title: 'آخر حركة', dataIndex: 'last_movement', key: 'last_movement', width: 110,
      sorter: (a, b) => (a.last_movement ?? '').localeCompare(b.last_movement ?? ''),
      render: (v: string | null) => v ?? '—' },
    { title: 'الحساب', dataIndex: 'account_name', key: 'account_name', width: 200, ellipsis: true,
      render: (v: string | null, r) => (v ? `${v} (${r.account_code})` : '—') },
    { title: 'حركات', dataIndex: 'ledger_lines', key: 'ledger_lines', width: 80, align: 'left' },
    { title: '', key: 'actions', width: 120, fixed: 'left', render: (_: any, r) => rowActions(r) },
  ];

  const advanceColumns = (withEmployee: boolean): ColumnsType<Advance> => [
    { title: 'رقم السلفة', dataIndex: 'document_number', key: 'document_number', width: 130 },
    ...(withEmployee ? [{ title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name' }] : []),
    { title: 'التاريخ', dataIndex: 'advance_date', key: 'advance_date', width: 110 },
    { title: 'المبلغ', dataIndex: 'amount', key: 'amount', width: 110,
      render: (v: string) => money(v) },
    { title: 'الخطة', key: 'instalments', width: 170,
      render: (_: any, r: Advance) => {
        const pending = r.schedule.filter((p) => !p.paid);
        return pending.length ? `${pending.length} شهر · ${money(pending.reduce((t, p) => t + Number(p.amount), 0))}` : 'بدون خطة';
      } },
    { title: 'المسدد', dataIndex: 'taken', key: 'taken', width: 110,
      render: (v: string) => money(v) },
    { title: 'المتبقي', dataIndex: 'outstanding', key: 'outstanding', width: 120,
      render: (_: string, r: Advance) => (r.status === 'cancelled' ? '—'
        : <b style={{ color: remaining(r) ? '#cf1322' : '#6AB42D' }}>{money(r.outstanding)}</b>) },
    { title: 'الحالة', dataIndex: 'status', key: 'status', width: 110,
      render: (v: string) => <Tag color={ADVANCE_STATUS[v]?.color}>{ADVANCE_STATUS[v]?.label ?? v}</Tag> },
    { title: 'السبب', dataIndex: 'reason', key: 'reason', ellipsis: true,
      render: (v: string | null) => v ?? '' },
    { title: '', key: 'actions', width: 300, render: (_: any, r: Advance) => (
      r.status === 'active' ? (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Button size="small" type="primary" onClick={() => openRepay(r)}>تحصيل</Button>
          <Button size="small" onClick={() => openPlan(r)}>الخطة</Button>
          {editable(r) ? (<>
          <Button size="small" onClick={() => openAdvance(undefined, r)}>تعديل</Button>
          <Popconfirm
            title="هل تريد إلغاء السلفة؟"
            description="سيُعكس قيد الصرف وتعود المبالغ إلى الخزنة."
            okText="إلغاء السلفة" cancelText="رجوع" okButtonProps={{ danger: true }}
            onConfirm={() => cancel('advances', r.id)}
          >
            <Button size="small" danger>إلغاء</Button>
          </Popconfirm>
          </>) : null}
        </span>
      ) : null
    ) },
  ];

  const scheduleTable = (r: Advance) => (
    <Table
      size="small" pagination={false} rowKey={(p) => `${p.year}-${p.month}`}
      dataSource={r.schedule}
      locale={{ emptyText: 'لا توجد أقساط' }}
      columns={[
        { title: 'الشهر', key: 'period', width: 120,
          render: (_: any, p: ScheduleRow) => period(p.year, p.month) },
        { title: 'القسط', dataIndex: 'amount', width: 140, render: (v: string) => money(v) },
        { title: '', dataIndex: 'paid',
          render: (_: boolean, p: ScheduleRow) => (p.method === 'cash' ? (
            <Space size={4}>
              <Tag color="green">تحصيل نقدي {p.paid_on || ''}</Tag>
              <Popconfirm title="إلغاء التحصيل وعكس سند القبض؟" okText="إلغاء التحصيل" cancelText="رجوع"
                onConfirm={() => cancelRepay(r, p)}>
                <Button size="small" type="link" danger>إلغاء</Button>
              </Popconfirm>
            </Space>
          ) : p.method === 'payroll' ? <Tag color="green">خُصم من المرتب</Tag>
            : <Tag color="orange">مخطط على المرتب</Tag>) },
      ]}
    />
  );

  const adjustmentCols: ColumnsType<Adjustment> = [
    { title: 'الرقم', dataIndex: 'document_number', key: 'document_number', width: 120 },
    { title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name' },
    { title: 'النوع', dataIndex: 'kind', key: 'kind', width: 110,
      render: (v: string) => <Tag color={KIND[v]?.color}>{KIND[v]?.label ?? v}</Tag> },
    { title: 'القيمة', key: 'value', width: 130, render: (_: any, r) => adjustmentValue(r) },
    { title: 'الشهر', key: 'period', width: 110, render: (_: any, r) => period(r.year, r.month) },
    { title: 'السبب', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: 'الحالة', key: 'status', width: 130,
      render: (_: any, r) => (r.applied
        ? <Tag color="green">احتُسب في المسير</Tag>
        : r.status === 'cancelled' ? <Tag>ملغي</Tag> : <Tag color="orange">بانتظار المسيّر</Tag>) },
    { title: '', key: 'actions', width: 90, render: (_: any, r) => (
      !r.applied && r.status !== 'cancelled' ? (
        <Popconfirm title="هل تريد إلغاءه؟" okText="إلغاء" cancelText="رجوع"
          onConfirm={() => cancel('adjustments', r.id)}>
          <Button size="small" danger>إلغاء</Button>
        </Popconfirm>
      ) : null
    ) },
  ];

  const dueCols = useTableColumns('employee-dues', dueColumns, {
    locked: ['employee_name', 'actions'],
    defaultHidden: ['department', 'account_name', 'ledger_lines'],
    export: { name: 'ذمم وسلف الموظفين', rows },
  });
  const advCols = useTableColumns('hr-advances', advanceColumns(true), {
    locked: ['document_number'],
    export: { name: 'السلف', rows: advances },
  });
  const adjCols = useTableColumns('hr-adjustments', adjustmentCols, {
    locked: ['document_number'],
    export: { name: 'الجزاءات والمكافآت', rows: adjustments },
  });

  const rowKey = (r: DueRow) => (r.employee_id ? `e${r.employee_id}` : `a${r.account_id}`);
  const kb = useTableKeyboard<DueRow>({ rows, rowKey });
  const advKb = useTableKeyboard({ rows: advances, rowKey: (r: Advance) => r.id, onOpen: () => undefined });

  const dueCsv: CsvColumn<DueRow>[] = [
    { title: 'الموظف', value: (r) => r.employee_name ?? `(حساب بلا موظف) ${r.account_name ?? ''}` },
    { title: 'كود الموظف', value: (r) => r.employee_code ?? '' },
    { title: 'الوظيفة', value: (r) => r.job_title ?? '' },
    { title: 'الفرع', value: (r) => (r.branch_id ? branchName[r.branch_id] ?? '' : '') },
    { title: 'الحساب', value: (r) => (r.account_name ? `${r.account_name} (${r.account_code})` : '') },
    { title: 'الذمة', value: (r) => r.ledger_balance },
    ...(advancesVisible ? [
      { title: 'السلف المتبقية', value: (r: DueRow) => r.advances_outstanding ?? '' },
      { title: 'الأقساط المتبقية', value: (r: DueRow) => String(r.remaining_instalments ?? '') },
    ] : []),
    { title: 'الإجمالي', value: (r) => r.total_due },
    { title: 'آخر حركة', value: (r) => r.last_movement ?? '' },
  ];

  const advCsv: CsvColumn<Advance>[] = [
    { title: 'رقم السلفة', value: 'document_number' },
    { title: 'الموظف', value: 'employee_name' },
    { title: 'التاريخ', value: 'advance_date' },
    { title: 'المبلغ', value: 'amount' },
    { title: 'المخصوم', value: 'taken' },
    { title: 'المتبقي', value: (r) => String(remaining(r)) },
  ];

  const adjCsv: CsvColumn<Adjustment>[] = [
    { title: 'الرقم', value: 'document_number' },
    { title: 'الموظف', value: 'employee_name' },
    { title: 'النوع', value: (r) => KIND[r.kind]?.label ?? r.kind },
    { title: 'القيمة', value: (r) => adjustmentValue(r) },
    { title: 'الشهر', value: (r) => period(r.year, r.month) },
    { title: 'السبب', value: 'reason' },
  ];

  const printIt = () => {
    if (tab === 'advances') {
      printReport({ title: 'سلف العاملين' }, advCsv as PrintColumn<Advance>[], advances);
      return;
    }
    if (tab === 'adjustments') {
      printReport({ title: 'الجزاءات والمكافآت' }, adjCsv as PrintColumn<Adjustment>[], adjustments);
      return;
    }
    const cols: PrintColumn<DueRow>[] = [
      { title: 'الموظف', value: (r) => r.employee_name ?? `(حساب بلا موظف) ${r.account_name ?? ''}` },
      { title: 'الوظيفة', value: (r) => r.job_title ?? '' },
      { title: 'الذمة', value: (r) => money(r.ledger_balance), numeric: true },
      ...(advancesVisible ? [{ title: 'السلف', value: (r: DueRow) => money(r.advances_outstanding), numeric: true }] : []),
      { title: 'الإجمالي', value: (r) => money(r.total_due), numeric: true },
    ];
    const totals: PrintTotal[] = [
      { label: 'ذمم الدفتر', value: money(dues?.total_ledger) },
      ...(advancesVisible ? [{ label: 'السلف المتبقية', value: money(dues?.total_advances) }] : []),
      { label: 'الإجمالي', value: money(dues?.total_due) },
    ];
    printReport({
      title: 'ذمم وسلف الموظفين',
      date: new Date().toLocaleDateString('en-CA'),
      meta: [
        ['الفرع', branchId ? branchName[branchId] ?? '—' : 'كل الفروع'],
        ['النطاق', tab === 'open' ? 'من عليهم مستحقات' : 'كل الموظفين'],
      ],
    }, cols, rows, totals);
  };

  const exportIt = () => {
    if (tab === 'advances') writeCsv('advances', advCsv, advances);
    else if (tab === 'adjustments') writeCsv('adjustments', adjCsv, adjustments);
    else writeCsv('employee-dues', dueCsv, rows);
  };

  const advTotals = useMemo(() => ({
    outstanding: advances.reduce((n, a) => n + remaining(a), 0),
    open: advances.filter((a) => a.status === 'active').length,
  }), [advances]);

  const employeeOptions = employees.map((e) => ({ value: e.id, label: e.name }));
  const subTabs: ListTab<TabKey>[] = [
    { key: 'open', label: 'من عليهم مستحقات' },
    { key: 'all', label: 'كل الموظفين' },
    ...(advancesVisible ? [
      { key: 'advances' as TabKey, label: 'السلف', count: tab === 'advances' ? advances.length : null },
    ] : []),
  ];
  const totalDue = Number(dues?.total_due ?? 0);

  return (
    <>
    <ListPage<any>
      icon={host ? host.icon : <IdcardOutlined />}
      title={host ? host.title : 'ذمم وسلف الموظفين'}
      tabs={host ? host.tabs : subTabs}
      activeTab={host ? host.activeTab : tab} onTabChange={host ? host.onTabChange : setTab}
      actions={(<>
        {advancesVisible && tab !== 'adjustments' ? (
          <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={() => openAdvance(tab === 'advances' ? employeeId : undefined)}>صرف سلفة</Button>
        ) : null}
        {canAddEmployee && onDues ? (
          <Button icon={<PlusOutlined />} onClick={() => setEmpOpen(true)}>موظف جديد</Button>
        ) : null}
        {advancesVisible && tab === 'adjustments' ? (
          <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={() => setAdjOpen(true)}>جزاء أو مكافأة</Button>
        ) : null}
        <Button icon={<PrinterOutlined />} onClick={printIt}>طباعة</Button>
        <Button icon={<DownloadOutlined />} onClick={exportIt}>تصدير CSV</Button>
        {onDues ? dueCols.control : tab === 'advances' ? advCols.control : adjCols.control}
        <Button icon={<ReloadOutlined />} onClick={reloadAll}>تحديث</Button>
      </>)}
      filters={onDues ? (<>
        {host ? <Segmented value={tab} onChange={(v) => setTab(v as string)}
          options={subTabs.map((t) => ({ value: t.key, label: t.label }))} /> : null}
        <Input.Search className="sl-f-search" allowClear placeholder="بحث بالاسم أو الكود"
          onSearch={setQ} onChange={(e) => { if (!e.target.value) setQ(''); }} />
        {branches.length > 1 ? (
          <Select className="sl-f-customer" allowClear placeholder="كل الفروع"
            value={branchId} onChange={setBranchId}
            options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        ) : null}
      </>) : (<>
        {host ? <Segmented value={tab} onChange={(v) => setTab(v as string)}
          options={subTabs.map((t) => ({ value: t.key, label: t.label }))} /> : null}
        <Select
          allowClear showSearch style={{ flex: '0 1 320px' }}
          placeholder="كل الموظفين" value={employeeId} onChange={setEmployeeId}
          options={employeeOptions} filterOption={searchFilter} filterSort={searchRank} />
        {tab === 'advances' ? (
          <Select allowClear style={{ flex: '0 1 200px' }} placeholder="كل الحالات"
            value={advStatus} onChange={setAdvStatus}
            options={Object.entries(ADVANCE_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
        ) : null}
      </>)}
    >
      {onDues && dues && dues.unlinked_employees > 0 ? (
        <Alert
          type="info" showIcon style={{ margin: '6px 0 8px' }}
          message={`${dues.unlinked_employees} موظف نشط ليس له حساب ذمة في شجرة a5`}
        />
      ) : null}

      {onDues ? (
        <Table<DueRow>
          className="sl-table"
          rowKey={rowKey}
          columns={dueCols.columns}
          dataSource={rows}
          loading={loading}
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={{
            pageSize: PAGE_SIZE, showSizeChanger: true,
            showTotal: (t) => (
              <span className="sl-foot">
                <span>العدد: <b>{t.toLocaleString(numeralsLocale())}</b></span>
                <span>ذمم الدفتر: <b>{money(dues?.total_ledger)}</b></span>
                {advancesVisible ? <span>السلف المتبقية: <b>{money(dues?.total_advances)}</b></span> : null}
                <span>الإجمالي: <b className={totalDue < 0 ? 'is-neg' : 'is-pos'}>
                  {money(dues?.total_due)}</b></span>
              </span>
            ),
          }}
          expandable={advancesVisible ? {
            rowExpandable: (r) => !!r.employee_id && !!r.last_advance_date,
            expandedRowKeys: expanded,
            onExpandedRowsChange: (keys) => setExpanded([...keys]),
            onExpand: (open, r) => { if (open && r.employee_id && !byEmployee[r.employee_id]) loadEmployeeAdvances(r.employee_id); },
            expandedRowRender: (r) => (
              <Table<Advance>
                size="small" rowKey="id" pagination={false}
                loading={!byEmployee[r.employee_id!]}
                columns={advanceColumns(false)}
                dataSource={byEmployee[r.employee_id!] ?? []}
                expandable={{ expandedRowRender: scheduleTable }}
              />
            ),
          } : undefined}
          {...kb.tableProps}
        />
      ) : tab === 'advances' ? (
        <Table
          {...advKb.tableProps}
          className="sl-table"
          rowKey="id" size="small" loading={loading}
          columns={advCols.columns} dataSource={advances}
          pagination={{
            defaultPageSize: PAGE_SIZE, showSizeChanger: true,
            showTotal: () => (
              <span className="sl-foot">
                <span>سلف قيد التقسيط: <b>{advTotals.open}</b></span>
                <span>إجمالي المتبقي: <b className={advTotals.outstanding ? 'is-neg' : 'is-pos'}>
                  {money(advTotals.outstanding)}</b></span>
              </span>
            ),
          }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لا توجد سلف' }}
          expandable={{ expandedRowRender: scheduleTable }}
        />
      ) : (
        <Table
          className="sl-table"
          rowKey="id" size="small" loading={loading}
          columns={adjCols.columns} dataSource={adjustments}
          pagination={{
            defaultPageSize: PAGE_SIZE, showSizeChanger: true,
            showTotal: () => (
              <span className="sl-foot">
                <span>السجلات: <b>{adjustments.length}</b></span>
                <span>بانتظار المسيّر: <b>
                  {adjustments.filter((r) => !r.applied && r.status !== 'cancelled').length}</b></span>
              </span>
            ),
          }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لا توجد جزاءات ولا مكافآت' }}
        />
      )}
    </ListPage>

      <TabModal
        open={advOpen} title={advForm.id ? 'تعديل سلفة' : 'صرف سلفة'} onCancel={() => setAdvOpen(false)}
        onOk={saveAdvance} confirmLoading={saving} okText={advForm.id ? 'حفظ التعديل' : 'صرف'}
        cancelText="إلغاء" destroyOnClose
      >
        <Row gutter={[10, 10]}>
          <Col span={14}>
            <div style={{ marginBottom: 4 }}>الموظف *</div>
            <Select showSearch style={{ width: '100%' }} disabled={!!advForm.id}
              value={advForm.employee_id}
              onChange={(v) => setAdvForm({ ...advForm, employee_id: v })}
              options={employeeOptions} filterOption={searchFilter} filterSort={searchRank} />
          </Col>
          <Col span={10}>
            <div style={{ marginBottom: 4 }}>التاريخ</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={advForm.advance_date}
              onChange={(v) => setAdvForm({ ...advForm, advance_date: v || dayjs(), start: v || dayjs() })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>المبلغ *</div>
            <InputNumber style={{ width: '100%' }} min={0.01} value={advForm.amount}
              onChange={(v) => setAdvForm({ ...advForm, amount: v ?? undefined })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>الخزنة</div>
            <Select allowClear style={{ width: '100%' }} placeholder="خزنة فرع الموظف"
              value={advForm.treasury_id}
              onChange={(v) => setAdvForm({ ...advForm, treasury_id: v })}
              options={treasuries.filter((t: any) => t.active !== false)
                .map((t: any) => ({ value: t.id, label: `${t.name} — ${money(t.balance)}` }))} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>مركز التكلفة</div>
            <CostCenterField style={{ width: '100%' }} value={advForm.cost_center_id}
              onChange={(v: any) => setAdvForm({ ...advForm, cost_center_id: v ?? undefined })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>السبب</div>
            <Input value={advForm.reason}
              onChange={(e) => setAdvForm({ ...advForm, reason: e.target.value })} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>خطة السداد</div>
            <PlanEditor total={Number(advForm.amount) || 0}
              mode={advForm.planMode} onMode={(m) => setAdvForm({
                ...advForm, planMode: m,
                planRows: m === 'custom' && !advForm.planRows.length
                  ? equalPlan(Number(advForm.amount) || 0, advForm.instalments || 1, advForm.start) : advForm.planRows,
              })}
              rows={advForm.planRows} onRows={(r) => setAdvForm({ ...advForm, planRows: r })}
              count={advForm.instalments} onCount={(n) => setAdvForm({ ...advForm, instalments: n })}
              start={advForm.start} onStart={(d) => setAdvForm({ ...advForm, start: d })} />
          </Col>
        </Row>
      </TabModal>

      <TabModal open={!!repayOf} title={`تحصيل من سلفة ${repayOf?.document_number || ''} — ${repayOf?.employee_name || ''}`}
        onCancel={() => setRepayOf(null)} onOk={saveRepay} confirmLoading={saving}
        okText="تحصيل" cancelText="إلغاء" destroyOnClose>
        <Row gutter={[10, 10]}>
          <Col span={24}>المتبقي من السلفة: <b>{money(repayOf?.outstanding)}</b></Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>المبلغ *</div>
            <InputNumber style={{ width: '100%' }} min={0.01} max={Number(repayOf?.outstanding) || undefined}
              value={repayForm.amount} onChange={(v) => setRepayForm({ ...repayForm, amount: v ?? undefined })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>التاريخ</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false} value={repayForm.date}
              onChange={(v) => setRepayForm({ ...repayForm, date: v || dayjs() })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>الخزنة</div>
            <Select allowClear style={{ width: '100%' }} placeholder="خزنة الفرع" value={repayForm.treasury_id}
              onChange={(v) => setRepayForm({ ...repayForm, treasury_id: v })}
              options={treasuries.filter((t: any) => t.active !== false)
                .map((t: any) => ({ value: t.id, label: `${t.name} — ${money(t.balance)}` }))} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>ملاحظات</div>
            <Input value={repayForm.notes} onChange={(e) => setRepayForm({ ...repayForm, notes: e.target.value })} />
          </Col>
        </Row>
      </TabModal>

      <TabModal open={!!planOf} title={`خطة سداد ${planOf?.document_number || ''} — ${planOf?.employee_name || ''}`}
        onCancel={() => setPlanOf(null)} onOk={savePlan} confirmLoading={saving}
        okText="حفظ الخطة" cancelText="إلغاء" destroyOnClose width={640}>
        <div style={{ marginBottom: 8 }}>المتبقي من السلفة: <b>{money(planOf?.outstanding)}</b></div>
        <PlanEditor total={Number(planOf?.outstanding) || 0} mode={planMode} onMode={(m) => {
          setPlanMode(m);
          if (m === 'custom' && !planRows.length) setPlanRows(equalPlan(Number(planOf?.outstanding) || 0, planCount, planStart));
        }}
          rows={planRows} onRows={setPlanRows} count={planCount} onCount={setPlanCount}
          start={planStart} onStart={setPlanStart} />
      </TabModal>

      <TabModal
        open={adjOpen} title="جزاء أو مكافأة" onCancel={() => setAdjOpen(false)}
        onOk={saveAdjustment} confirmLoading={saving} okText="حفظ" cancelText="إلغاء"
        destroyOnClose
      >
        <Row gutter={[10, 10]}>
          <Col span={14}>
            <div style={{ marginBottom: 4 }}>الموظف *</div>
            <Select showSearch style={{ width: '100%' }}
              value={adjForm.employee_id}
              onChange={(v) => setAdjForm({ ...adjForm, employee_id: v })}
              options={employeeOptions} filterOption={searchFilter} filterSort={searchRank} />
          </Col>
          <Col span={10}>
            <div style={{ marginBottom: 4 }}>شهر المسير</div>
            <DatePicker picker="month" style={{ width: '100%' }} format="YYYY/MM"
              allowClear={false} value={adjForm.period}
              onChange={(v) => setAdjForm({ ...adjForm, period: v || dayjs() })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>النوع</div>
            <Select style={{ width: '100%' }} value={adjForm.kind}
              onChange={(v) => setAdjForm({ ...adjForm, kind: v })}
              options={Object.entries(KIND).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>الأساس</div>
            <Select style={{ width: '100%' }} value={adjForm.basis}
              onChange={(v) => setAdjForm({ ...adjForm, basis: v })}
              options={[
                { value: 'amount', label: 'مبلغ' },
                { value: 'days', label: 'أيام' },
                { value: 'hours', label: 'ساعات' },
              ]} />
          </Col>
          <Col span={12}>
            {adjForm.basis === 'amount' ? (
              <>
                <div style={{ marginBottom: 4 }}>المبلغ *</div>
                <InputNumber style={{ width: '100%' }} min={0.01} value={adjForm.amount}
                  onChange={(v) => setAdjForm({ ...adjForm, amount: v })} />
              </>
            ) : (
              <>
                <div style={{ marginBottom: 4 }}>
                  {adjForm.basis === 'days' ? 'عدد الأيام *' : 'عدد الساعات *'}
                </div>
                <InputNumber style={{ width: '100%' }} min={0.5} step={0.5}
                  value={adjForm.quantity}
                  onChange={(v) => setAdjForm({ ...adjForm, quantity: v })} />
              </>
            )}
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>السبب</div>
            <Input value={adjForm.reason}
              onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} />
          </Col>
        </Row>
      </TabModal>

      <ReceiptModal
        open={receipt.open} onCancel={receipt.close}
        form={receipt.form} posting={receipt.posting} submit={receipt.submit}
        customers={cards} treasuries={receipt.treasuries} methodOptions={receipt.methodOptions}
        families={families} setFamilies={setFamilies} target={target} setTarget={setTarget}
        editing={receipt.editing} initialKind={voucherKind}
      />
      <PaymentModal
        open={payment.open} onCancel={payment.close}
        form={payment.form} posting={payment.posting} submit={payment.submit}
        suppliers={[]} customers={cards} treasuries={payment.treasuries}
        methodOptions={payment.methodOptions} editing={payment.editing} initialKind={voucherKind}
      />
      <EmployeeFormModal open={empOpen} employee={null} onClose={() => setEmpOpen(false)}
        onSaved={() => { setEmpOpen(false); reloadAll(); }} />
    </>
  );
}

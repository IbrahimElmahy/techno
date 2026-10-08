import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Alert, Button, Col, DatePicker, Dropdown, Input, Row, Select, Table, Tag, Tooltip, message,
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
import PaymentModal from './vouchers/PaymentModal';
import { useQuickVoucher } from './vouchers/useQuickVoucher';
import type { PartyKind } from './vouchers/PartyKind';
import type { Party } from './vouchers/types';

/**
 * ذمم وسلف الموظفين — «الراجل ده عليه كام، ومنين، وهيسدّد إزاي».
 *
 * **كانوا شاشتين بيجاوبوا على نفس السؤال** (طلب العميل ٢٠٢٦-١٠-٠٨): «ذمم الموظفين» بتقرا
 * رصيد حساب الموظف من الدفتر (اللي اتنقل من a5 + السندات)، و«سلف العاملين» بتعرض مستندات
 * السلف اللي بتتخصم من المرتب. اللي بيسأل «فلان عليه كام» كان لازم يفتح الاتنين ويجمع بإيده.
 * دلوقتي صف واحد لكل موظف: ذمته + سلفه المفتوحة = الإجمالي، والعمليات كلها من نفس الصف.
 *
 * **الرقمين في حسابين مختلفين** — السلفة بتتقيد على «سلف العاملين» (حساب واحد للكل) مش على
 * حساب ذمة الموظف، فالإجمالي مجموعهم ومافيش تكرار. والسيرفر بيتأكد (`employee_dues_service`):
 * لو سلفة في يوم اتقيدت على حساب الذمة نفسه مابتتجمعش تاني.
 *
 * **«تحصيل» بينزل على الذمة، والسلفة بتتسدّد من المرتب.** سند القبض بيتقيّد على حساب الموظف؛
 * قسط السلفة بيتخصم في المسير. عشان كده زرار التحصيل بيقول كده صراحةً.
 *
 * **والحسابات اللي مالهاش موظف بتبان برضه.** «عهدة سيارة الفيوم» و«فرع اكتوبر» دلاء محاسبية
 * عليها فلوس فعلاً — إخفاؤها كان هيخلّي مجموع الشاشة أقل من «ذمم الموظفين» في ميزان المراجعة.
 *
 * **والعزل بالفرع من السيرفر**: موظف الفرع بيشوف موظفين فرعه وسلفهم بس.
 */

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

interface ScheduleRow { year: number; month: number; amount: string; paid: boolean }

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
  active: { label: 'بتتقسّط', color: 'blue' },
  settled: { label: 'اتسدّدت', color: 'green' },
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

/** «٣ أقساط × ١٠٠٠٫٠٠» — الجملة اللي بتتقال بالفم. */
export function instalmentLabel(count: number, each: string): string {
  return count <= 1 ? 'قسط واحد' : `${count} أقساط × ${money(each)}`;
}

/** الجزاء بالأيام مالوش مبلغ لحد ما المسير يحسبه — والشاشة لازم تقول كده مش تقول صفر. */
export function adjustmentValue(row: Adjustment): string {
  if (row.basis === 'days') return `${Number(row.quantity)} يوم`;
  if (row.basis === 'hours') return `${Number(row.quantity)} ساعة`;
  return money(row.amount);
}

/** المتبقي من سلفة ملغية صفر — السيرفر بيحسبه «المبلغ − المخصوم» من غير ما يبص على الحالة. */
const remaining = (a: Advance) => (a.status === 'cancelled' ? 0 : Number(a.outstanding || 0));

/** السلفة تتعدّل أو تتلغي لحد أول قسط يتخصم في مسير — بعدها القسيمة اتطبعت على رقمها. */
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
});

export default function EmployeeReceivables() {
  const navigate = useNavigate();
  const [tabRaw, setTab] = useQueryTab('open');
  // `nonzero` كان اسم الشريحة في «ذمم الموظفين» القديمة — الروابط المحفوظة بتفتح صح.
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
  // سلف كل موظف لما صفّه يتفتح — بتتجاب مرة وبتتمسح مع أي تحديث.
  const [byEmployee, setByEmployee] = useState<Record<number, Advance[]>>({});
  // الصفوف المفتوحة — بعد أي تحديث سلفها بتتجاب تاني، مش بتفضل فاضية.
  const [expanded, setExpanded] = useState<React.Key[]>([]);

  const [advOpen, setAdvOpen] = useState(false);
  const [advForm, setAdvForm] = useState(emptyAdvance());
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState<any>({
    employee_id: undefined, kind: 'penalty', basis: 'amount',
    amount: undefined, quantity: undefined, period: dayjs() as Dayjs, reason: '',
  });
  const [saving, setSaving] = useState(false);

  // ------------------------------------------------------------------ التحميل

  const loadDues = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/employee-dues', {
        params: { q: q || undefined, branch_id: branchId, only_open: tab !== 'all' },
      });
      setDues(res.data);
    } catch { /* الرسالة من `api` */ } finally { setLoading(false); }
  }, [q, branchId, tab === 'all']);

  const advancesVisible = dues?.advances_visible ?? false;

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
    } catch { /* الرسالة من `api` */ } finally { setLoading(false); }
  }, [advancesVisible, employeeId, advStatus]);

  useEffect(() => { loadDues(); }, [loadDues]);
  useEffect(() => { if (!onDues) loadAdvances(); }, [onDues, loadAdvances]);
  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(() => {});
    api.get('/api/v1/employees').then((r) => setEmployees(r.data || [])).catch(() => {});
  }, []);

  const reloadAll = () => { loadDues(); if (!onDues) loadAdvances(); };

  useEffect(() => {
    // كل تحميل للذمم بيعيد سلف الصفوف المفتوحة — تعديل أو إلغاء من جوّه الصف يبان فيه.
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
    } catch { /* الرسالة من `api` */ }
  };

  const ensureTreasuries = async () => {
    if (treasuries.length) return treasuries;
    const list = (await api.get('/api/v1/treasuries').catch(() => ({ data: [] }))).data || [];
    setTreasuries(list);
    return list;
  };

  // ------------------------------------------------------------------ السلف

  const openAdvance = async (employee?: number, edit?: Advance) => {
    await ensureTreasuries();
    if (edit) {
      setAdvForm({
        id: edit.id, employee_id: edit.employee_id, amount: Number(edit.amount),
        advance_date: dayjs(edit.advance_date),
        start: dayjs(`${edit.start_year}-${String(edit.start_month).padStart(2, '0')}-01`),
        instalments: edit.instalments, treasury_id: edit.treasury_id ?? undefined,
        cost_center_id: edit.cost_center_id ?? undefined, reason: edit.reason ?? '',
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
    const body = {
      amount: String(advForm.amount),
      advance_date: advForm.advance_date.format('YYYY-MM-DD'),
      instalments: advForm.instalments || 1,
      start_year: advForm.start.year(),
      start_month: advForm.start.month() + 1,
      reason: advForm.reason || null,
      treasury_id: advForm.treasury_id ?? null,
      cost_center_id: advForm.cost_center_id ?? null,
    };
    try {
      if (advForm.id) {
        await api.put(`/api/v1/hr/advances/${advForm.id}`, body);
        message.success('اتعدّلت السلفة');
      } else {
        await api.post('/api/v1/hr/advances', { ...body, employee_id: advForm.employee_id });
        message.success('اتصرفت السلفة');
      }
      setAdvOpen(false);
      reloadAll();
    } catch { /* الرسالة من `api` */ } finally { setSaving(false); }
  };

  const cancel = async (what: 'advances' | 'adjustments', id: number) => {
    try {
      await api.post(`/api/v1/hr/${what}/${id}/cancel`);
      message.success('تم الإلغاء');
      reloadAll();
    } catch { /* الرسالة من `api` */ }
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
    } catch { /* الرسالة من `api` */ } finally { setSaving(false); }
  };

  // ------------------------------------------------------------------ السندات
  //
  // نفس بوبابات شاشة السندات (`useQuickVoucher`) — مش نسخة. الطرف «موظف» على كارته في العملاء
  // (اللي على نفس حساب الذمة)، والحساب اللي مالوش كارت بيتعمل عليه السند كـ«حساب» مباشرة.

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
    // البوباب بيتركّب مع الفتح — القيم بتتحط بعد التركيب (نفس `useQuickVoucher.edit`).
    setTimeout(() => v.form.setFieldsValue(values), 0);
  };

  // ------------------------------------------------------------------ الأعمدة

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
      items.push({ key: 'adjustment', label: 'جزاء أو مكافأة' });
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
        // الحساب اللي مالوش موظف — بيتقال إنه كده صراحةً بدل شرطة بتوحي إن فيه ناقص.
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
        <Tooltip title="مالوش حساب ذمة في الشجرة — سلفه بس هي اللي بتتحسب">—</Tooltip>
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
        // «هيتخصم منه كام الشهر الجاي» — السؤال اللي بييجي بعد «عليه كام».
        render: (_: any, r: DueRow) => (r.remaining_instalments ? (
          <span>
            باقي {r.remaining_instalments} {r.remaining_instalments === 1 ? 'قسط' : 'أقساط'}
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
      // السالب معناه إن الشركة هي اللي عليها للراجل مش العكس — لون مختلف لأن الإشارة
      // لوحدها بتتقرا غلط في عمود مليان أرقام.
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
    { title: 'التقسيط', key: 'instalments', width: 170,
      render: (_: any, r: Advance) => instalmentLabel(r.instalments, r.instalment_amount) },
    { title: 'اتخصم', dataIndex: 'taken', key: 'taken', width: 110,
      render: (v: string) => money(v) },
    // المتبقي هو الرقم اللي أي حد بيسأل عن سلفة بيقصده.
    { title: 'المتبقي', dataIndex: 'outstanding', key: 'outstanding', width: 120,
      render: (_: string, r: Advance) => (r.status === 'cancelled' ? '—'
        : <b style={{ color: remaining(r) ? '#cf1322' : '#6AB42D' }}>{money(r.outstanding)}</b>) },
    { title: 'الحالة', dataIndex: 'status', key: 'status', width: 110,
      render: (v: string) => <Tag color={ADVANCE_STATUS[v]?.color}>{ADVANCE_STATUS[v]?.label ?? v}</Tag> },
    { title: 'السبب', dataIndex: 'reason', key: 'reason', ellipsis: true,
      render: (v: string | null) => v ?? '' },
    { title: '', key: 'actions', width: 150, render: (_: any, r: Advance) => (
      editable(r) ? (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Button size="small" onClick={() => openAdvance(undefined, r)}>تعديل</Button>
          <Popconfirm
            title="تلغي السلفة؟"
            description="قيد الصرف هيتعكس والفلوس هترجع للخزنة."
            okText="إلغاء السلفة" cancelText="رجوع" okButtonProps={{ danger: true }}
            onConfirm={() => cancel('advances', r.id)}
          >
            <Button size="small" danger>إلغاء</Button>
          </Popconfirm>
        </span>
      ) : r.status === 'active' ? (
        // اتخصم منها قسط — التعديل والإلغاء بيبدأوا بعكس المسير. بيتقال بدل زرار بيترفض.
        <Tooltip title="اتخصم منها قسط في مسير مرحّل — اعكس المسير الأول عشان تعدّلها أو تلغيها">
          <Tag>مقفولة للتعديل</Tag>
        </Tooltip>
      ) : null
    ) },
  ];

  // جدول الأقساط تحت السلفة — «هيتخصم مني كام الشهر الجاي» سؤال بيتسأل ساعة الاستلاف،
  // والإجابة مكانها هنا مش في شاشة تانية.
  const scheduleTable = (r: Advance) => (
    <Table
      size="small" pagination={false} rowKey={(p) => `${p.year}-${p.month}`}
      dataSource={r.schedule}
      locale={{ emptyText: 'مافيش أقساط' }}
      columns={[
        { title: 'الشهر', key: 'period', width: 120,
          render: (_: any, p: ScheduleRow) => period(p.year, p.month) },
        { title: 'القسط', dataIndex: 'amount', width: 140, render: (v: string) => money(v) },
        { title: '', dataIndex: 'paid',
          render: (v: boolean) => (v ? <Tag color="green">اتخصم</Tag> : <Tag color="orange">لسه</Tag>) },
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
        ? <Tag color="green">اتحسب في المسير</Tag>
        : r.status === 'cancelled' ? <Tag>ملغي</Tag> : <Tag color="orange">بانتظار المسيّر</Tag>) },
    { title: '', key: 'actions', width: 90, render: (_: any, r) => (
      !r.applied && r.status !== 'cancelled' ? (
        <Popconfirm title="تلغيه؟" okText="إلغاء" cancelText="رجوع"
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

  // ------------------------------------------------------------------ طباعة وتصدير

  const dueCsv: CsvColumn<DueRow>[] = [
    { title: 'الموظف', value: (r) => r.employee_name ?? `(حساب بلا موظف) ${r.account_name ?? ''}` },
    { title: 'كود الموظف', value: (r) => r.employee_code ?? '' },
    { title: 'الوظيفة', value: (r) => r.job_title ?? '' },
    { title: 'الفرع', value: (r) => (r.branch_id ? branchName[r.branch_id] ?? '' : '') },
    { title: 'الحساب', value: (r) => (r.account_name ? `${r.account_name} (${r.account_code})` : '') },
    { title: 'الذمة', value: (r) => r.ledger_balance },
    ...(advancesVisible ? [
      { title: 'السلف المتبقية', value: (r: DueRow) => r.advances_outstanding ?? '' },
      { title: 'أقساط باقية', value: (r: DueRow) => String(r.remaining_instalments ?? '') },
    ] : []),
    { title: 'الإجمالي', value: (r) => r.total_due },
    { title: 'آخر حركة', value: (r) => r.last_movement ?? '' },
  ];

  const advCsv: CsvColumn<Advance>[] = [
    { title: 'رقم السلفة', value: 'document_number' },
    { title: 'الموظف', value: 'employee_name' },
    { title: 'التاريخ', value: 'advance_date' },
    { title: 'المبلغ', value: 'amount' },
    { title: 'اتخصم', value: 'taken' },
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
        ['النطاق', tab === 'open' ? 'اللي عليهم حاجة' : 'كل الموظفين'],
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
  const totalDue = Number(dues?.total_due ?? 0);

  // ------------------------------------------------------------------ الشاشة

  return (
    <>
    <ListPage<TabKey>
      icon={<IdcardOutlined />}
      title="ذمم وسلف الموظفين"
      subtitle="اللي على كل موظف: ذمته من الدفتر (سلف a5، عهد، بضاعة، فلوس لسه ماتورّدتش) + سلفه اللي بتتخصم من المرتب"
      tabs={[
        { key: 'open', label: 'اللي عليهم حاجة' },
        { key: 'all', label: 'كل الموظفين' },
        // السلف والجزاءات أرقام باسم موظف بتتخصم من مرتبه — لمين عنده `salary.view` بس.
        ...(advancesVisible ? [
          { key: 'advances' as TabKey, label: 'السلف', count: tab === 'advances' ? advances.length : null },
          { key: 'adjustments' as TabKey, label: 'الجزاءات والمكافآت',
            count: tab === 'adjustments' ? adjustments.length : null },
        ] : []),
      ]}
      activeTab={tab} onTabChange={setTab}
      actions={(<>
        {advancesVisible && tab !== 'adjustments' ? (
          <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={() => openAdvance(tab === 'advances' ? employeeId : undefined)}>صرف سلفة</Button>
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
        <Input.Search className="sl-f-search" allowClear placeholder="بحث بالاسم أو الكود"
          onSearch={setQ} onChange={(e) => { if (!e.target.value) setQ(''); }} />
        <Select className="sl-f-customer" allowClear placeholder="كل الفروع"
          value={branchId} onChange={setBranchId}
          options={branches.map((b) => ({ value: b.id, label: b.name }))} />
      </>) : (<>
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
          message={`${dues.unlinked_employees} موظف نشط مالوش حساب ذمة في شجرة a5`}
          description={
            'دول مالهمش حساب ذمة أصلاً — سلفهم بتبان هنا، بس التحصيل وكشف الحساب محتاجين حساب. '
            + 'لو واحد فيهم عليه ذمة، لازم يتعمله حساب تحت «ذمم الموظفين» ويتربط '
            + 'بـ`link_employee_receivables`.'
          }
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
          // سلف الموظف تحت صفّه — بجدول أقساطها وتعديلها وإلغاؤها، من غير ما يسيب الشاشة.
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
                <span>سلف بتتقسّط: <b>{advTotals.open}</b></span>
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
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="السلفة أصل لا مصروف"
          description={advForm.id
            ? 'نفس رقم السلفة ونفس قيدها — القيد بيتعدّل والأقساط بتتعمل من جديد.'
            : 'بتتقيد مدين «سلف العاملين» ودائن الخزنة، والمرتب بيسدّدها قسط بقسط.'}
        />
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
              // أول قسط بيمشي مع التاريخ لحد ما حد يغيّره بإيده.
              onChange={(v) => setAdvForm({ ...advForm, advance_date: v || dayjs(), start: v || dayjs() })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>المبلغ *</div>
            <InputNumber style={{ width: '100%' }} min={0.01} value={advForm.amount}
              onChange={(v) => setAdvForm({ ...advForm, amount: v ?? undefined })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>عدد الأقساط</div>
            <InputNumber style={{ width: '100%' }} min={1} max={60}
              value={advForm.instalments}
              onChange={(v) => setAdvForm({ ...advForm, instalments: Number(v) || 1 })} />
            {advForm.amount && advForm.instalments > 1 ? (
              <div style={{ color: '#888', fontSize: 14, marginTop: 4 }}>
                ≈ {money(Number(advForm.amount) / advForm.instalments)} في الشهر
              </div>
            ) : null}
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>أول قسط في مسير شهر</div>
            <DatePicker picker="month" style={{ width: '100%' }} format="YYYY/MM" allowClear={false}
              value={advForm.start}
              onChange={(v) => setAdvForm({ ...advForm, start: v || advForm.advance_date })} />
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
        </Row>
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
            <div style={{ color: '#888', fontSize: 14, marginTop: 4 }}>
              الشهر الذي سيُطبَّق فيه — وجزاء الشهر الماضي يُطبَّق في المسيّر المفتوح.
            </div>
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
                <div style={{ color: '#888', fontSize: 14, marginTop: 4 }}>
                  المسير بيحوّلها لفلوس بأجر يوم الشهر ده.
                </div>
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
    </>
  );
}

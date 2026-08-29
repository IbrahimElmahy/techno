import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Row, Segmented, Select, Statistic, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import { useQueryTab } from '../components/useQueryTab';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import { columnsFromTable, exportCsv as writeCsv } from '../utils/exportCsv';
import { printReport, type PrintColumn, type PrintTotal } from '../print/reportSheet';

/**
 * تقارير الموارد البشرية — تسعتاشر اسم من محرك واحد.
 *
 * Same shape as `TradeReports.tsx`, for the same reason: «كشف حضور تفصيلي» and «ملخص الحضور
 * بالقسم» and «غياب الشهر بالفرع» are not three reports. They are one set of rows crossed with a
 * grain and a grouping, and building them as nineteen screens means the absence rule gets fixed in
 * four of them and stays wrong in the rest.
 *
 * Two things this screen must not get wrong:
 *
 * * **الإجماليات جاية من السيرفر.** Attendance is employees × days — a year of two hundred people
 *   is seventy-odd thousand rows, so the server paginates. Adding up the visible page here would
 *   put a number under «إجمالي المبلغ» that is the answer for the first five hundred rows and
 *   nothing on screen would say so. The card reads `totals`, never `rows`.
 * * **التقرير اللي فيه مبالغ ممكن يترفض.** One endpoint answers both «مين غايب» and «مين بياخد
 *   كام»; the second needs `salary.view`. A 403 here is a normal answer, not a broken screen, so
 *   it says so in Arabic instead of «تعذر تحميل التقرير».
 */

type Subject = 'headcount' | 'attendance' | 'leave' | 'payroll' | 'cost' | 'advance'
  | 'adjustment' | 'leave_balance';
type Level = 'detail' | 'summary';
type GroupBy = 'none' | 'employee' | 'department' | 'branch' | 'job_title' | 'month'
  | 'status' | 'component';

const SUBJECT_LABELS: Record<Subject, string> = {
  headcount: 'الموظفين',
  attendance: 'الحضور',
  leave: 'الأجازات',
  payroll: 'المرتبات',
  cost: 'تكلفة الأجور',
  advance: 'السلف',
  adjustment: 'الجزاءات والمكافآت',
  leave_balance: 'أرصدة الأجازات',
};

/** المواضيع اللي بترجّع مبالغ باسم موظف — الباك إند بيطلب `salary.view` عليها. */
const MONEY_SUBJECTS: Subject[] = ['payroll', 'cost', 'advance', 'adjustment'];

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const num = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

interface Totals { rows: number; quantity: string; amount: string }
interface Page { limit: number | null; offset: number; total_rows: number; truncated: boolean }

/**
 * الأسماء اللي بتظهر في القايمة — كل واحد بيفتح في تبويب باسمه والمفاتيح جاهزة.
 *
 * Nobody wants a screen with three switches and a note saying their report is combination
 * eleven. They want «كشف حضور» and «تحليل تكلفة الأجور بالقسم». The switches stay live once
 * here, so the whole engine is one click away rather than a report nobody ever built.
 */
export interface HrReportView {
  label: string;
  subject: Subject;
  level: Level;
  groupBy: GroupBy;
}

export const REPORT_VIEWS: Record<string, HrReportView> = {
  // الموظفين والهيكل
  // الأسماء دي «كشف …» عن قصد: «الموظفين» و«أرصدة الأجازات» و«الجزاءات والمكافآت» أسماء شاشات
  // شغل موجودة، واسم واحد بيودّي لمكانين بيخلّي اللي بيدوّر في القايمة يفتح الغلط.
  'staff-list': { label: 'كشف الموظفين', subject: 'headcount', level: 'detail', groupBy: 'none' },
  'staff-by-department': { label: 'الموظفين بالقسم', subject: 'headcount', level: 'summary', groupBy: 'department' },
  'staff-by-branch': { label: 'الموظفين بالفرع', subject: 'headcount', level: 'summary', groupBy: 'branch' },
  'staff-by-title': { label: 'الموظفين بالوظيفة', subject: 'headcount', level: 'summary', groupBy: 'job_title' },
  'staff-movement': { label: 'الداخلين والخارجين', subject: 'headcount', level: 'summary', groupBy: 'status' },
  // الحضور
  'attendance-sheet': { label: 'كشف حضور وانصراف', subject: 'attendance', level: 'detail', groupBy: 'none' },
  'attendance-by-employee': { label: 'ملخص الحضور بالموظف', subject: 'attendance', level: 'summary', groupBy: 'employee' },
  'attendance-by-department': { label: 'ملخص الحضور بالقسم', subject: 'attendance', level: 'summary', groupBy: 'department' },
  'attendance-by-status': { label: 'الغياب والتأخير', subject: 'attendance', level: 'summary', groupBy: 'status' },
  // الأجازات
  'leave-movement': { label: 'حركة الأجازات', subject: 'leave', level: 'detail', groupBy: 'none' },
  'leave-by-type': { label: 'الأجازات بالنوع', subject: 'leave', level: 'summary', groupBy: 'status' },
  'leave-balances': { label: 'كشف أرصدة الأجازات', subject: 'leave_balance', level: 'detail', groupBy: 'none' },
  // المرتبات
  'payroll-sheet': { label: 'مسير المرتبات', subject: 'payroll', level: 'detail', groupBy: 'none' },
  'payroll-by-month': { label: 'المرتبات شهر بشهر', subject: 'payroll', level: 'summary', groupBy: 'month' },
  'cost-by-component': { label: 'تكلفة الأجور بالبند', subject: 'cost', level: 'summary', groupBy: 'component' },
  'cost-by-department': { label: 'تكلفة الأجور بالقسم', subject: 'cost', level: 'summary', groupBy: 'department' },
  'cost-by-branch': { label: 'تكلفة الأجور بالفرع', subject: 'cost', level: 'summary', groupBy: 'branch' },
  // السلف والجزاءات
  'advances-outstanding': { label: 'السلف وأرصدتها', subject: 'advance', level: 'detail', groupBy: 'none' },
  'penalties-bonuses': { label: 'كشف الجزاءات والمكافآت', subject: 'adjustment', level: 'detail', groupBy: 'none' },
};

export default function HrReports() {
  const [viewKey] = useQueryTab('', 'view');
  const view: HrReportView | undefined = REPORT_VIEWS[viewKey];

  const [subject, setSubject] = useState<Subject>(view?.subject ?? 'payroll');
  const [level, setLevel] = useState<Level>(view?.level ?? 'detail');
  const [groupBy, setGroupBy] = useState<GroupBy>(view?.groupBy ?? 'none');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    [dayjs().startOf('month'), dayjs()]);
  const [period, setPeriod] = useState<Dayjs | null>(dayjs());
  const [employeeId, setEmployeeId] = useState<number | undefined>();
  const [departmentId, setDepartmentId] = useState<number | undefined>();
  const [branchId, setBranchId] = useState<number | undefined>();
  const [includeDrafts, setIncludeDrafts] = useState(false);

  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      api.get('/api/v1/employees'), api.get('/api/v1/hr/departments'),
      api.get('/api/v1/branches'),
    ]).then(([e, d, b]) => {
      setEmployees(e.data || []); setDepartments(d.data || []); setBranches(b.data || []);
    }).catch(console.error);
  }, []);

  // التبويبات بتفضل مركّبة، فالتقرير المسمّى لازم يفرض مفاتيحه تاني لما المسار يتغيّر — من غير
  // ده بيرث حالة آخر تقرير اتفتح ويعرض حاجة تانية تحت اسمه.
  useEffect(() => {
    if (!view) return;
    setSubject(view.subject); setLevel(view.level); setGroupBy(view.groupBy);
  }, [viewKey]);

  const offPreset = !!view && (subject !== view.subject || level !== view.level
    || groupBy !== view.groupBy);

  /** المواضيع دي بتتفلتر بشهر، والباقي بمدى تواريخ — فالفلتر بيتبدّل مش بيتكدّس. */
  const byPeriod = subject === 'payroll' || subject === 'cost' || subject === 'adjustment';
  const isBalances = subject === 'leave_balance';
  const grouped = groupBy !== 'none';

  const params = useMemo(() => {
    if (isBalances) {
      const p: any = { year: (period ?? dayjs()).year() };
      if (employeeId) p.employee_id = employeeId;
      return p;
    }
    const p: any = { subject, level, group_by: groupBy };
    if (byPeriod && period) { p.year = period.year(); p.month = period.month() + 1; }
    if (!byPeriod && range) {
      p.date_from = range[0].format('YYYY-MM-DD');
      p.date_to = range[1].format('YYYY-MM-DD');
    }
    if (employeeId) p.employee_id = employeeId;
    if (departmentId) p.department_id = departmentId;
    if (branchId) p.branch_id = branchId;
    if (includeDrafts) p.include_drafts = true;
    return p;
  }, [subject, level, groupBy, range, period, employeeId, departmentId, branchId,
    includeDrafts, isBalances, byPeriod]);

  const load = async () => {
    setLoading(true); setDenied(false);
    try {
      const url = isBalances ? '/api/v1/hr/reports/leave-balances' : '/api/v1/hr/reports';
      const res = await api.get(url, { params });
      setRows(res.data.rows || []);
      setTotals(res.data.totals || null);
      setPage(res.data.page || null);
    } catch (err: any) {
      // ٤٠٣ هنا إجابة عادية مش شاشة مكسورة — التقرير ده فيه مبالغ باسم موظف.
      if (err?.response?.status === 403) {
        setDenied(true); setRows([]); setTotals(null); setPage(null);
      } else {
        message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
      }
    } finally { setLoading(false); }
  };

  // التحميل المباشر — أي فلتر يتغيّر التقرير بيتقرا، من غير زرار «عرض».
  useEffect(() => { load(); }, [params]);

  const groupHeading = groupBy === 'employee' ? 'الموظف'
    : groupBy === 'department' ? 'القسم'
      : groupBy === 'branch' ? 'الفرع'
        : groupBy === 'job_title' ? 'الوظيفة'
          : groupBy === 'month' ? 'الشهر'
            : groupBy === 'component' ? 'البند' : 'الحالة';

  /** الأعمدة المخصوصة لكل موضوع — الشكل الموحّد فيه المشترك، ودي اللي بتفرّق التقارير. */
  const detailColumns: any[] = subject === 'attendance' ? [
    { title: 'اليوم', dataIndex: 'work_date', ...dateColumn<any>((r) => r.work_date) },
    { title: 'حضور', dataIndex: 'check_in', ...textColumn(rows, (r: any) => r.check_in),
      render: (v: string) => v || '-' },
    { title: 'انصراف', dataIndex: 'check_out', ...textColumn(rows, (r: any) => r.check_out),
      render: (v: string) => v || '-' },
    { title: 'تأخير (د)', dataIndex: 'late_minutes', align: 'left' as const,
      ...numberColumn<any>((r) => r.late_minutes),
      render: (v: number) => (v ? <b style={{ color: '#cf1322' }}>{num(v)}</b> : '-') },
    { title: 'انصراف مبكر (د)', dataIndex: 'early_leave_minutes', align: 'left' as const,
      ...numberColumn<any>((r) => r.early_leave_minutes),
      render: (v: number) => (v ? num(v) : '-') },
    { title: 'ساعات العمل', dataIndex: 'worked_hours', align: 'left' as const,
      ...numberColumn<any>((r) => r.worked_hours), render: (v: string) => num(v) },
    { title: 'إضافي (س)', dataIndex: 'overtime_hours', align: 'left' as const,
      ...numberColumn<any>((r) => r.overtime_hours),
      render: (v: string) => (Number(v) ? <b style={{ color: '#6AB42D' }}>{num(v)}</b> : '-') },
    { title: 'الحالة', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string, r: any) => (
        <>
          <Tag color={r.status === 'absent' ? 'red' : r.status === 'present' ? 'green' : undefined}>
            {v}
          </Tag>
          {/* يوم جوّه مسير مرحّل مقفول — والعلامة دي بتفسّر ليه التعديل مرفوض. */}
          {r.locked ? <Tag color="gold">مقفول</Tag> : null}
        </>
      ) },
  ] : subject === 'leave' ? [
    { title: 'الطلب', dataIndex: 'document_number',
      ...textColumn(rows, (r: any) => r.document_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'النوع', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label) },
    { title: 'من', dataIndex: 'date_from', ...dateColumn<any>((r) => r.date_from) },
    { title: 'إلى', dataIndex: 'date_to', ...dateColumn<any>((r) => r.date_to) },
    { title: 'أيام', dataIndex: 'quantity', align: 'left' as const,
      ...numberColumn<any>((r) => r.quantity), render: (v: string) => <b>{num(v)}</b> },
    { title: 'الحالة', dataIndex: 'status', ...textColumn(rows, (r: any) => r.status),
      render: (_: string, r: any) => (
        <Tag color={r.approved ? 'green' : r.status === 'rejected' ? 'red' : 'blue'}>
          {r.approved ? 'معتمدة' : r.status === 'rejected' ? 'مرفوضة'
            : r.status === 'cancelled' ? 'ملغاة' : 'منتظرة'}
        </Tag>
      ) },
    { title: 'السبب', dataIndex: 'reason', ...textColumn(rows, (r: any) => r.reason) },
  ] : subject === 'leave_balance' ? [
    { title: 'النوع', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label) },
    { title: 'أول المدة', dataIndex: 'opening', align: 'left' as const,
      ...numberColumn<any>((r) => r.opening), render: (v: string) => num(v) },
    { title: 'المستحق', dataIndex: 'entitled', align: 'left' as const,
      ...numberColumn<any>((r) => r.entitled), render: (v: string) => num(v) },
    { title: 'تسويات', dataIndex: 'adjustment', align: 'left' as const,
      ...numberColumn<any>((r) => r.adjustment), render: (v: string) => num(v) },
    { title: 'المستهلك', dataIndex: 'taken', align: 'left' as const,
      ...numberColumn<any>((r) => r.taken), render: (v: string) => num(v) },
    { title: 'الرصيد', dataIndex: 'remaining', align: 'left' as const,
      ...numberColumn<any>((r) => r.remaining),
      render: (v: string) => (
        <b style={{ color: Number(v) < 0 ? '#cf1322' : '#0B5CA8' }}>{num(v)}</b>) },
  ] : subject === 'payroll' ? [
    { title: 'الشهر', dataIndex: 'period', ...textColumn(rows, (r: any) => r.period) },
    { title: 'المسير', dataIndex: 'document_number',
      ...textColumn(rows, (r: any) => r.document_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الأساسي', dataIndex: 'basic', align: 'left' as const,
      ...numberColumn<any>((r) => r.basic), render: (v: string) => money(v) },
    { title: 'البدلات', dataIndex: 'allowances', align: 'left' as const,
      ...numberColumn<any>((r) => r.allowances), render: (v: string) => money(v) },
    { title: 'الإضافي', dataIndex: 'overtime_amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.overtime_amount), render: (v: string) => money(v) },
    { title: 'الاستحقاق', dataIndex: 'gross', align: 'left' as const,
      ...numberColumn<any>((r) => r.gross), render: (v: string) => <b>{money(v)}</b> },
    { title: 'غياب', dataIndex: 'absence_deduction', align: 'left' as const,
      ...numberColumn<any>((r) => r.absence_deduction), render: (v: string) => money(v) },
    { title: 'جزاءات', dataIndex: 'penalty_amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.penalty_amount), render: (v: string) => money(v) },
    { title: 'تأمينات', dataIndex: 'insurance_employee', align: 'left' as const,
      ...numberColumn<any>((r) => r.insurance_employee), render: (v: string) => money(v) },
    { title: 'ضريبة', dataIndex: 'tax_amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.tax_amount), render: (v: string) => money(v) },
    { title: 'قسط سلفة', dataIndex: 'advance_deduction', align: 'left' as const,
      ...numberColumn<any>((r) => r.advance_deduction), render: (v: string) => money(v) },
    { title: 'الصافي', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount),
      render: (v: string) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
    { title: '', key: 'draft', width: 70,
      render: (_: any, r: any) => (r.status === 'draft'
        ? <Tag color="orange">مسودة</Tag> : null) },
  ] : subject === 'cost' ? [
    { title: 'الشهر', dataIndex: 'period', ...textColumn(rows, (r: any) => r.period) },
    { title: 'البند', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string) => <b>{v}</b> },
    { title: 'النوع', dataIndex: 'status', ...textColumn(rows, (r: any) => r.status),
      render: (v: string) => (
        <Tag color={v === 'earning' ? 'green' : 'red'}>
          {v === 'earning' ? 'استحقاق' : 'استقطاع'}
        </Tag>) },
    { title: 'العدد', dataIndex: 'quantity', align: 'left' as const,
      ...numberColumn<any>((r) => r.quantity),
      render: (v: string) => (Number(v) ? num(v) : '-') },
    { title: 'المبلغ', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount), render: (v: string) => <b>{money(v)}</b> },
  ] : subject === 'advance' ? [
    { title: 'المستند', dataIndex: 'document_number',
      ...textColumn(rows, (r: any) => r.document_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'التاريخ', dataIndex: 'advance_date', ...dateColumn<any>((r) => r.advance_date) },
    { title: 'المبلغ', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount), render: (v: string) => money(v) },
    { title: 'أقساط', dataIndex: 'instalments', align: 'left' as const,
      ...numberColumn<any>((r) => r.instalments) },
    { title: 'المخصوم', dataIndex: 'taken', align: 'left' as const,
      ...numberColumn<any>((r) => r.taken), render: (v: string) => money(v) },
    // المتبقي هو الرقم اللي أي حد بيسأل عن سلفة بيقصده — فهو الغامق.
    { title: 'المتبقي', dataIndex: 'outstanding', align: 'left' as const,
      ...numberColumn<any>((r) => r.outstanding),
      render: (v: string) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
    { title: 'الحالة', dataIndex: 'status', ...textColumn(rows, (r: any) => r.status),
      render: (v: string) => (
        <Tag color={v === 'settled' ? 'green' : v === 'cancelled' ? 'default' : 'blue'}>
          {v === 'settled' ? 'مسدّدة' : v === 'cancelled' ? 'ملغاة' : 'جارية'}
        </Tag>) },
  ] : subject === 'adjustment' ? [
    { title: 'المستند', dataIndex: 'document_number',
      ...textColumn(rows, (r: any) => r.document_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الشهر', dataIndex: 'period', ...textColumn(rows, (r: any) => r.period) },
    { title: 'النوع', dataIndex: 'status', ...textColumn(rows, (r: any) => r.status),
      render: (v: string) => (
        <Tag color={v === 'bonus' ? 'green' : 'red'}>{v === 'bonus' ? 'مكافأة' : 'جزاء'}</Tag>) },
    { title: 'السبب', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label) },
    { title: 'المبلغ', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount), render: (v: string) => <b>{money(v)}</b> },
    { title: '', key: 'applied', width: 90,
      render: (_: any, r: any) => (r.applied
        ? <Tag color="green">اتخصم</Tag> : <Tag>لسه</Tag>) },
  ] : [
    // headcount
    { title: 'الكود', dataIndex: 'code', ...textColumn(rows, (r: any) => r.code) },
    { title: 'التعيين', dataIndex: 'hire_date', ...dateColumn<any>((r) => r.hire_date) },
    { title: 'الوظيفة', dataIndex: 'job_title', ...textColumn(rows, (r: any) => r.job_title) },
    { title: 'الحالة', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string, r: any) => (
        <Tag color={r.status === 'active' ? 'green' : 'default'}>{v}</Tag>) },
    { title: 'المرتب', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount), render: (v: string) => <b>{money(v)}</b> },
  ];

  const columns: any[] = grouped
    ? [
      { title: groupHeading, dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
        render: (v: string) => <b>{v}</b> },
      { title: 'عدد السطور', dataIndex: 'rows', align: 'left' as const,
        ...numberColumn<any>((r) => r.rows) },
      { title: 'العدد', dataIndex: 'quantity', align: 'left' as const,
        ...numberColumn<any>((r) => r.quantity), render: (v: string) => num(v) },
      { title: 'المبلغ', dataIndex: 'amount', align: 'left' as const,
        ...numberColumn<any>((r) => r.amount),
        render: (v: string) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
    ]
    : [
      { title: 'الموظف', dataIndex: 'employee_name',
        ...textColumn(rows, (r: any) => r.employee_name), render: (v: string) => <b>{v}</b> },
      { title: 'القسم', dataIndex: 'department',
        ...textColumn(rows, (r: any) => r.department) },
      ...detailColumns,
    ];

  const printMeta = (): [string, string][] => {
    const pairs: [string, string][] = byPeriod || isBalances
      ? [['الفترة', (period ?? dayjs()).format(isBalances ? 'YYYY' : 'YYYY/MM')]]
      : [
        ['من', range ? range[0].format('YYYY/MM/DD') : 'كل التواريخ'],
        ['إلى', range ? range[1].format('YYYY/MM/DD') : 'كل التواريخ'],
      ];
    if (employeeId) {
      pairs.push(['الموظف', employees.find((e: any) => e.id === employeeId)?.name ?? '']);
    }
    if (departmentId) {
      pairs.push(['القسم', departments.find((d: any) => d.id === departmentId)?.name ?? '']);
    }
    if (branchId) {
      pairs.push(['الفرع', branches.find((b: any) => b.id === branchId)?.name ?? '']);
    }
    // الصفحة المطبوعة لازم تقول إنها مقصوصة — ورقة أرقام ناقصة من غير ما تقول أوحش من ورقة فاضية.
    if (page?.truncated) {
      pairs.push(['ملحوظة', `معروض ${rows.length} من ${page.total_rows} سطر`]);
    }
    return pairs;
  };

  const printIt = () => {
    const printable: PrintColumn<any>[] = columns
      .filter((c) => (c as any).dataIndex)
      .map((c) => ({ title: String(c.title ?? ''), value: (c as any).dataIndex }));
    const lines: PrintTotal[] = totals
      ? [
        { label: 'عدد السطور', value: totals.rows },
        { label: 'الإجمالي (عدد)', value: num(totals.quantity) },
        { label: 'الإجمالي (مبلغ)', value: money(totals.amount) },
      ]
      : [];
    printReport(
      { title: view?.label ?? SUBJECT_LABELS[subject], date: dayjs().format('YYYY/MM/DD'),
        meta: printMeta() },
      printable, rows, lines,
    );
  };

  const exportCsv = () => {
    if (!rows.length) { message.info('لا توجد بيانات للتصدير'); return; }
    writeCsv(`hr-${subject}-${level}-${groupBy}`, columnsFromTable(columns as any[]), rows);
  };

  const rowKeyOf = (r: any, i?: number) => (grouped
    ? `g-${r.key}`
    : `${r.employee_id}-${r.period}-${r.document_number ?? r.work_date ?? r.label ?? i}`);

  /**
   * السطر بيفتح على تفاصيله — المجموعة بتتفكّ لسطورها، والسطر بيضيّق على صاحبه.
   *
   * «القسم ده كلّفنا ٤٠ ألف» is never the end of the question; the next one is always «مين فيهم».
   * There is no document screen behind an attendance day or a grouped total to link to, so the
   * answer this screen can honestly give is the drill-down: the same report, narrowed to the row
   * that was clicked. Grouping by حالة or بند or وظيفة has no matching filter, so those rows say
   * so by doing nothing rather than jumping somewhere unrelated.
   */
  const drillInto = (r: any) => {
    if (grouped) {
      if (groupBy === 'employee') setEmployeeId(r.key ?? undefined);
      else if (groupBy === 'department') setDepartmentId(r.key ?? undefined);
      else if (groupBy === 'branch') setBranchId(r.key ?? undefined);
      else if (groupBy === 'month' && r.key) {
        const month = dayjs(String(r.key).slice(0, 7), 'YYYY-MM');
        if (!month.isValid()) return;
        setPeriod(month);
        setRange([month.startOf('month'), month.endOf('month')]);
      } else return;
      setGroupBy('none'); setLevel('detail');
      return;
    }
    if (r.employee_id && r.employee_id !== employeeId) setEmployeeId(r.employee_id);
  };

  const kb = useTableKeyboard<any>({ rows, rowKey: rowKeyOf, onOpen: drillInto });

  const tableCols = useTableColumns(`hr-reports-${grouped ? 'grouped' : subject}`, columns);

  return (
    <Card
      title={(
        <span>
          {view ? view.label : 'تقارير الموارد البشرية'}
          {offPreset ? (
            <Tag color="orange" style={{ marginInlineStart: 8, fontWeight: 400 }}>معدّل</Tag>
          ) : null}
        </span>
      )}
      extra={(
        <>
          {tableCols.control}
          <Button icon={<DownloadOutlined />} onClick={exportCsv}
            style={{ marginInlineStart: 8 }}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />} onClick={printIt}
            style={{ marginInlineStart: 8, marginInlineEnd: 8 }}>طباعة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} lg={14}>
          <Segmented
            block value={subject} onChange={(v) => setSubject(v as Subject)}
            options={(Object.keys(SUBJECT_LABELS) as Subject[])
              .map((k) => ({ value: k, label: SUBJECT_LABELS[k] }))}
          />
        </Col>
        <Col xs={24} lg={10}>
          <Select
            style={{ width: '100%' }} value={groupBy} disabled={isBalances}
            onChange={(v) => {
              setGroupBy(v);
              // «ملخّص» من غير تجميع الباك إند بيرفضه — فالشاشة بتمنع الحالة دي أصلاً.
              if (v === 'none') setLevel('detail');
              else setLevel('summary');
            }}
            options={[
              { value: 'none', label: 'تفصيلي' },
              { value: 'employee', label: 'مجمّع بالموظف' },
              { value: 'department', label: 'مجمّع بالقسم' },
              { value: 'branch', label: 'مجمّع بالفرع' },
              { value: 'job_title', label: 'مجمّع بالوظيفة' },
              { value: 'month', label: 'مجمّع بالشهر' },
              { value: 'status', label: 'مجمّع بالحالة' },
              { value: 'component', label: 'مجمّع بالبند', disabled: subject !== 'cost' },
            ]}
          />
        </Col>
      </Row>

      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={7}>
          {byPeriod ? (
            <DatePicker
              picker="month" style={{ width: '100%' }} value={period}
              onChange={setPeriod} placeholder="الشهر" allowClear={false}
            />
          ) : isBalances ? (
            <DatePicker
              picker="year" style={{ width: '100%' }} value={period}
              onChange={setPeriod} placeholder="السنة" allowClear={false}
            />
          ) : (
            <DateRangeFilter
              value={range as any}
              onChange={(v) => setRange(v as any)}
            />
          )}
        </Col>
        <Col xs={24} md={6}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="كل الموظفين" value={employeeId} onChange={setEmployeeId}
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
          />
        </Col>
        <Col xs={24} md={5}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="كل الأقسام" value={departmentId} onChange={setDepartmentId}
            disabled={isBalances}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
        </Col>
        <Col xs={24} md={4}>
          <Select
            allowClear style={{ width: '100%' }} placeholder="كل الفروع"
            value={branchId} onChange={setBranchId} disabled={isBalances}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
        </Col>
        {(subject === 'payroll' || subject === 'cost') && (
          <Col xs={24} md={2}>
            <Select
              style={{ width: '100%' }} value={includeDrafts ? 'all' : 'posted'}
              onChange={(v) => setIncludeDrafts(v === 'all')}
              options={[
                { value: 'posted', label: 'المرحّل' },
                { value: 'all', label: 'مع المسودات' },
              ]}
            />
          </Col>
        )}
      </Row>

      {/* ٤٠٣ هنا إجابة، مش عطل. */}
      {denied && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="التقرير ده فيه مبالغ باسم موظف"
          description="صلاحية «عرض المرتبات» غير متاحة لحسابك. اختر موضوعاً آخر، أو اطلب الصلاحية من مدير النظام."
        />
      )}

      {totals && (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={8}>
            <Card size="small"><Statistic title="عدد السطور" value={totals.rows} /></Card>
          </Col>
          <Col xs={8}>
            <Card size="small">
              <Statistic
                title={subject === 'attendance' ? 'عدد الأيام'
                  : subject === 'leave' || isBalances ? 'عدد الأيام' : 'العدد'}
                value={num(totals.quantity)}
              />
            </Card>
          </Col>
          <Col xs={8}>
            <Card size="small">
              <Statistic title="إجمالي المبلغ" value={money(totals.amount)}
                valueStyle={{ color: '#0B5CA8' }} />
            </Card>
          </Col>
        </Row>
      )}

      {/* الإجماليات فوق محسوبة على كل الصفوف؛ الجدول بيعرض صفحة. من غير السطر ده حد ممكن يجمع
          العمود بإيده ويلاقيه مش مطابق الكارت ويفتكر إن فيه غلط. */}
      {page?.truncated && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message={`معروض ${rows.length} سطر من ${page.total_rows}`}
          description="الإجماليات أعلاه محسوبة على كل السطور في المدى المحدد، لا على المعروض منها. ضيّق الفترة أو الفلاتر لعرض الباقي."
        />
      )}

      <Table
        {...kb.tableProps}
        rowKey={rowKeyOf}
        size="small" loading={loading} dataSource={rows} columns={tableCols.columns}
        locale={{ emptyText: denied ? 'مالكش صلاحية على التقرير ده' : 'لا توجد بيانات في هذه الفترة' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
}

/** بتتستخدم في الاختبار — التقرير اللي فيه مبالغ لازم يبقى معروف قبل ما يتبعت. */
export const MONEY_SUBJECT_KEYS = MONEY_SUBJECTS;

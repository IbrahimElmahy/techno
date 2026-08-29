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
 * تقارير التشغيل — النقاط والكوبونات والمعاينات والشيكات والطلبات والحجوزات.
 *
 * سبع مواضيع كان عندها شاشة عرض وبس. You could page through five thousand point records and not
 * ask «مين أعلى عملاء في النقاط»، ولا «المعاينات اتوزّعت إزاي على المندوبين»، ولا «إيه اللي
 * بيستحق الأسبوع الجاي».
 *
 * الحاجات اللي الشاشة دي لازم تقولها صح:
 *
 * * **الملغي بيتعرض ومابيتحسبش.** A voided coupon and a rejected inspection are rows worth seeing
 *   — somebody is looking for why they are gone — and figures worth excluding. The row is greyed
 *   and the totals card says how many were left out, so neither half of that is silent.
 * * **الشيكات محفظة مش حركة.** The date filter runs on the DUE date; «اللي بيستحق خلال ٣٠ يوم» is
 *   a button rather than a date range somebody has to work out.
 * * **الإجماليات جاية من السيرفر** — ده تقرير مقسّم، وجمع الصفحة المعروضة بيبان كإجابة وهو مش.
 */

type Subject = 'points' | 'coupons' | 'coupon_receipts' | 'inspections' | 'cheques'
  | 'orders' | 'reservations';
type Level = 'detail' | 'summary';
type GroupBy = 'none' | 'customer' | 'supplier' | 'rep' | 'kind' | 'status' | 'month'
  | 'branch' | 'shop';

const SUBJECT_LABELS: Record<Subject, string> = {
  points: 'النقاط',
  coupons: 'الكوبونات',
  coupon_receipts: 'استلام الكوبونات',
  inspections: 'المعاينات',
  cheques: 'الشيكات',
  orders: 'الطلبات',
  reservations: 'الحجوزات',
};

/** المواضيع اللي «العدد» فيها نقاط مش قطع — العمود بيسمّي نفسه صح. */
const POINT_SUBJECTS: Subject[] = ['points', 'inspections'];

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const num = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

interface Totals {
  rows: number; counted: number; excluded: number; quantity: string; amount: string;
}
interface Page { limit: number | null; offset: number; total_rows: number; truncated: boolean }

export interface OpsReportView {
  label: string;
  subject: Subject;
  level: Level;
  groupBy: GroupBy;
  /** «بيستحق خلال كام يوم» — بيتحط جاهز في التقارير اللي دي هي فكرتها. */
  dueWithinDays?: number;
  /** يفتح على اللي لسه مفتوح بس. */
  onlyOpen?: boolean;
}

export const REPORT_VIEWS: Record<string, OpsReportView> = {
  // النقاط
  'points-movement': { label: 'حركة النقاط', subject: 'points', level: 'detail', groupBy: 'none' },
  'points-by-customer': { label: 'النقاط بالعميل', subject: 'points', level: 'summary', groupBy: 'customer' },
  'points-by-kind': { label: 'النقاط بنوع الحركة', subject: 'points', level: 'summary', groupBy: 'kind' },
  // الكوبونات
  'coupons-list': { label: 'كشف الكوبونات', subject: 'coupons', level: 'detail', groupBy: 'none' },
  'coupons-by-status': { label: 'الكوبونات بالحالة', subject: 'coupons', level: 'summary', groupBy: 'status' },
  'coupons-by-customer': { label: 'الكوبونات بالعميل', subject: 'coupons', level: 'summary', groupBy: 'customer' },
  // «تقرير …» عن قصد — «استلام الكوبونات» اسم شاشة شغل موجودة، واسم واحد بيودّي لمكانين بيخلّي
  // اللي بيدوّر في القايمة يفتح الغلط.
  'coupon-receipts': { label: 'تقرير استلام الكوبونات', subject: 'coupon_receipts', level: 'detail', groupBy: 'none' },
  'coupon-receipts-by-rep': { label: 'استلام الكوبونات بالمندوب', subject: 'coupon_receipts', level: 'summary', groupBy: 'rep' },
  // المعاينات
  'inspections-list': { label: 'كشف المعاينات', subject: 'inspections', level: 'detail', groupBy: 'none' },
  'inspections-by-rep': { label: 'المعاينات بالمندوب', subject: 'inspections', level: 'summary', groupBy: 'rep' },
  'inspections-by-kind': { label: 'المعاينات بالنوع', subject: 'inspections', level: 'summary', groupBy: 'kind' },
  'inspections-by-shop': { label: 'المعاينات بمحل الشراء', subject: 'inspections', level: 'summary', groupBy: 'shop' },
  'inspections-by-month': { label: 'المعاينات شهر بشهر', subject: 'inspections', level: 'summary', groupBy: 'month' },
  // الشيكات
  'cheque-wallet': { label: 'محفظة الشيكات', subject: 'cheques', level: 'detail', groupBy: 'none' },
  'cheques-due-soon': { label: 'شيكات تستحق قريباً', subject: 'cheques', level: 'detail', groupBy: 'none', dueWithinDays: 30 },
  'cheques-by-status': { label: 'الشيكات بالحالة', subject: 'cheques', level: 'summary', groupBy: 'status' },
  // الطلبات والحجوزات
  'orders-list': { label: 'كشف الطلبات', subject: 'orders', level: 'detail', groupBy: 'none' },
  'orders-open': { label: 'الطلبات المعلقة', subject: 'orders', level: 'detail', groupBy: 'none', onlyOpen: true },
  'reservations-open': { label: 'الحجوزات المفتوحة', subject: 'reservations', level: 'detail', groupBy: 'none', onlyOpen: true },
};

export default function OpsReports() {
  const [viewKey] = useQueryTab('', 'view');
  const view: OpsReportView | undefined = REPORT_VIEWS[viewKey];

  const [subject, setSubject] = useState<Subject>(view?.subject ?? 'inspections');
  const [level, setLevel] = useState<Level>(view?.level ?? 'detail');
  const [groupBy, setGroupBy] = useState<GroupBy>(view?.groupBy ?? 'none');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    [dayjs().startOf('month'), dayjs()]);
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [repId, setRepId] = useState<number | undefined>();
  const [dueWithin, setDueWithin] = useState<number | undefined>(view?.dueWithinDays);
  const [onlyOpen, setOnlyOpen] = useState(!!view?.onlyOpen);

  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);

  const [customers, setCustomers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([api.get('/api/v1/customers'), api.get('/api/v1/users')])
      .then(([c, u]) => { setCustomers(c.data || []); setUsers(u.data || []); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!view) return;
    setSubject(view.subject); setLevel(view.level); setGroupBy(view.groupBy);
    setDueWithin(view.dueWithinDays); setOnlyOpen(!!view.onlyOpen);
  }, [viewKey]);

  const offPreset = !!view && (subject !== view.subject || level !== view.level
    || groupBy !== view.groupBy);

  const grouped = groupBy !== 'none';
  const isCheque = subject === 'cheques';
  const points = POINT_SUBJECTS.includes(subject);

  const params = useMemo(() => {
    const p: any = { subject, level, group_by: groupBy };
    // «بيستحق خلال ٣٠ يوم» بيلغي مدى التواريخ — الاتنين نفس الفلتر، وبعتهم مع بعض بيضيّق مرتين.
    if (dueWithin) p.due_within_days = dueWithin;
    else if (range) {
      p.date_from = range[0].format('YYYY-MM-DD');
      p.date_to = range[1].format('YYYY-MM-DD');
    }
    if (customerId) p.customer_id = customerId;
    if (repId) p.rep_id = repId;
    if (onlyOpen) p.only_open = true;
    return p;
  }, [subject, level, groupBy, range, customerId, repId, dueWithin, onlyOpen]);

  const load = async () => {
    setLoading(true); setDenied(false);
    try {
      const res = await api.get('/api/v1/reports/ops', { params });
      setRows(res.data.rows || []);
      setTotals(res.data.totals || null);
      setPage(res.data.page || null);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setDenied(true); setRows([]); setTotals(null); setPage(null);
      } else {
        message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [params]);

  const groupHeading = groupBy === 'customer' ? 'العميل'
    : groupBy === 'supplier' ? 'المورد'
      : groupBy === 'rep' ? 'المندوب'
        : groupBy === 'kind' ? 'النوع'
          : groupBy === 'month' ? 'الشهر'
            : groupBy === 'branch' ? 'الفرع'
              : groupBy === 'shop' ? 'محل الشراء' : 'الحالة';

  const detailColumns: any[] = isCheque ? [
    { title: 'رقم الشيك', dataIndex: 'cheque_number',
      ...textColumn(rows, (r: any) => r.cheque_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'النوع', dataIndex: 'kind', ...textColumn(rows, (r: any) => r.kind) },
    { title: 'البنك', dataIndex: 'bank_name', ...textColumn(rows, (r: any) => r.bank_name) },
    { title: 'التحرير', dataIndex: 'issue_date', ...dateColumn<any>((r) => r.issue_date) },
    { title: 'الاستحقاق', dataIndex: 'due_date', ...dateColumn<any>((r) => r.due_date),
      render: (v: string, r: any) => (
        <span style={{ color: r.overdue ? '#cf1322' : undefined, fontWeight: r.overdue ? 600 : 400 }}>
          {v}
        </span>) },
    // «فاضل كام يوم» هو السبب اللي حد بيفتح محفظة الشيكات عشانه.
    { title: 'باقي (يوم)', dataIndex: 'days_to_due', align: 'left' as const,
      ...numberColumn<any>((r) => r.days_to_due),
      render: (v: number, r: any) => (r.overdue
        ? <Tag color="red">متأخر {Math.abs(v)}</Tag>
        : <span>{v}</span>) },
    { title: 'المبلغ', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount), render: (v: string) => <b>{money(v)}</b> },
    { title: 'الحالة', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string, r: any) => (
        <Tag color={r.status === 'settled' ? 'green' : r.status === 'bounced' ? 'red'
          : r.status === 'cancelled' ? 'default' : 'blue'}>{v}</Tag>) },
  ] : subject === 'inspections' ? [
    { title: 'المستند', dataIndex: 'document_number',
      ...textColumn(rows, (r: any) => r.document_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'التاريخ', dataIndex: 'date', ...dateColumn<any>((r) => r.date) },
    { title: 'المندوب', dataIndex: 'rep', ...textColumn(rows, (r: any) => r.rep) },
    { title: 'الفني', dataIndex: 'technician_name',
      ...textColumn(rows, (r: any) => r.technician_name) },
    { title: 'محل الشراء', dataIndex: 'shop', ...textColumn(rows, (r: any) => r.shop) },
    { title: 'النوع', dataIndex: 'kind', ...textColumn(rows, (r: any) => r.kind) },
    { title: 'أصناف', dataIndex: 'items', align: 'left' as const,
      ...numberColumn<any>((r) => r.items) },
    { title: 'النقاط', dataIndex: 'quantity', align: 'left' as const,
      ...numberColumn<any>((r) => r.quantity), render: (v: string) => <b>{num(v)}</b> },
  ] : subject === 'points' ? [
    { title: 'التاريخ', dataIndex: 'date', ...dateColumn<any>((r) => r.date) },
    { title: 'الحركة', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string) => <Tag>{v}</Tag> },
    { title: 'النقاط', dataIndex: 'quantity', align: 'left' as const,
      ...numberColumn<any>((r) => r.quantity),
      render: (v: string) => (
        <b style={{ color: Number(v) < 0 ? '#cf1322' : '#6AB42D' }}>{num(v)}</b>) },
    { title: 'بواسطة', dataIndex: 'rep', ...textColumn(rows, (r: any) => r.rep) },
  ] : subject === 'coupons' ? [
    { title: 'المسلسل', dataIndex: 'serial', ...textColumn(rows, (r: any) => r.serial),
      render: (v: string) => <Tag>{v}</Tag> },
    { title: 'التاريخ', dataIndex: 'date', ...dateColumn<any>((r) => r.date) },
    { title: 'النوع', dataIndex: 'kind', ...textColumn(rows, (r: any) => r.kind) },
    { title: 'النقاط', dataIndex: 'points_consumed', align: 'left' as const,
      ...numberColumn<any>((r) => r.points_consumed) },
    { title: 'القيمة', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount), render: (v: string) => <b>{money(v)}</b> },
    { title: 'الحالة', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string, r: any) => (
        <Tag color={r.status === 'redeemed' ? 'green' : r.status === 'voided' ? 'default' : 'blue'}>
          {v}
        </Tag>) },
  ] : subject === 'coupon_receipts' ? [
    { title: 'المستند', dataIndex: 'document_number',
      ...textColumn(rows, (r: any) => r.document_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'التاريخ', dataIndex: 'date', ...dateColumn<any>((r) => r.date) },
    { title: 'المندوب', dataIndex: 'rep', ...textColumn(rows, (r: any) => r.rep) },
    { title: 'النوع', dataIndex: 'kind', ...textColumn(rows, (r: any) => r.kind) },
    { title: 'العدد', dataIndex: 'quantity', align: 'left' as const,
      ...numberColumn<any>((r) => r.quantity), render: (v: string) => <b>{num(v)}</b> },
    { title: 'القيمة', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount), render: (v: string) => money(v) },
  ] : subject === 'orders' ? [
    { title: 'المستند', dataIndex: 'document_number',
      ...textColumn(rows, (r: any) => r.document_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'التاريخ', dataIndex: 'date', ...dateColumn<any>((r) => r.date) },
    { title: 'النوع', dataIndex: 'kind', ...textColumn(rows, (r: any) => r.kind) },
    { title: 'الاستحقاق', dataIndex: 'due_date', ...dateColumn<any>((r) => r.due_date),
      render: (v: string, r: any) => (r.late
        ? <Tag color="red">{v} — فات ميعاده</Tag> : (v || '-')) },
    { title: 'سطور', dataIndex: 'quantity', align: 'left' as const,
      ...numberColumn<any>((r) => r.quantity), render: (v: string) => num(v) },
    { title: 'الإجمالي', dataIndex: 'amount', align: 'left' as const,
      ...numberColumn<any>((r) => r.amount), render: (v: string) => <b>{money(v)}</b> },
    { title: 'الحالة', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string, r: any) => (
        <Tag color={r.status === 'converted' ? 'green' : r.status === 'cancelled' ? 'default' : 'blue'}>
          {v}
        </Tag>) },
  ] : [
    // reservations
    { title: 'المستند', dataIndex: 'document_number',
      ...textColumn(rows, (r: any) => r.document_number), render: (v: string) => <Tag>{v}</Tag> },
    { title: 'ينتهي في', dataIndex: 'expires_on', ...dateColumn<any>((r) => r.expires_on),
      render: (v: string, r: any) => (r.expired
        ? <Tag color="red">{v} — انتهى</Tag> : v) },
    { title: 'الكمية', dataIndex: 'quantity', align: 'left' as const,
      ...numberColumn<any>((r) => r.quantity), render: (v: string) => <b>{num(v)}</b> },
    { title: 'الحالة', dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string, r: any) => (
        <Tag color={r.status === 'active' ? 'blue' : r.status === 'converted' ? 'green' : 'default'}>
          {v}
        </Tag>) },
  ];

  const columns: any[] = grouped
    ? [
      { title: groupHeading, dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
        render: (v: string) => <b>{v}</b> },
      { title: 'عدد السطور', dataIndex: 'rows', align: 'left' as const,
        ...numberColumn<any>((r) => r.rows),
        // الفرق بين «كام سطر» و«كام اتحسب» هو اللي ملغي.
        render: (v: number, r: any) => (r.counted === v
          ? v
          : <span>{v} <Tag color="orange">{v - r.counted} ملغي</Tag></span>) },
      { title: points ? 'النقاط' : 'العدد', dataIndex: 'quantity', align: 'left' as const,
        ...numberColumn<any>((r) => r.quantity), render: (v: string) => num(v) },
      { title: 'المبلغ', dataIndex: 'amount', align: 'left' as const,
        ...numberColumn<any>((r) => r.amount),
        render: (v: string) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
    ]
    : [
      { title: subject === 'coupon_receipts' ? 'التاجر' : 'العميل', dataIndex: 'party',
        ...textColumn(rows, (r: any) => r.party), render: (v: string) => <b>{v || '-'}</b> },
      ...detailColumns,
    ];

  const rowKeyOf = (r: any, i?: number) => (grouped
    ? `g-${r.key}`
    : `${r.document_number ?? r.serial ?? r.cheque_number ?? ''}-${r.date ?? ''}-${i}`);

  /** السطر بيضيّق التقرير على اللي اتضغط — نفس منطق تقارير الموارد البشرية. */
  const drillInto = (r: any) => {
    if (grouped) {
      if (groupBy === 'customer' || groupBy === 'supplier') setCustomerId(r.key ?? undefined);
      else if (groupBy === 'rep') setRepId(r.key ?? undefined);
      else if (groupBy === 'month' && r.key) {
        const month = dayjs(String(r.key).slice(0, 7), 'YYYY-MM');
        if (!month.isValid()) return;
        setDueWithin(undefined);
        setRange([month.startOf('month'), month.endOf('month')]);
      } else return;
      setGroupBy('none'); setLevel('detail');
      return;
    }
    if (r.party_id && r.party_id !== customerId) setCustomerId(r.party_id);
  };

  const kb = useTableKeyboard<any>({ rows, rowKey: rowKeyOf, onOpen: drillInto });

  const printMeta = (): [string, string][] => {
    const pairs: [string, string][] = dueWithin
      ? [['المدى', `يستحق خلال ${dueWithin} يوم`]]
      : [
        ['من', range ? range[0].format('YYYY/MM/DD') : 'كل التواريخ'],
        ['إلى', range ? range[1].format('YYYY/MM/DD') : 'كل التواريخ'],
      ];
    if (customerId) {
      pairs.push(['العميل', customers.find((c: any) => c.id === customerId)?.name ?? '']);
    }
    if (repId) pairs.push(['المندوب', users.find((u: any) => u.id === repId)?.full_name ?? '']);
    if (totals?.excluded) pairs.push(['مستبعد من الإجمالي', `${totals.excluded} سطر ملغي`]);
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
        { label: points ? 'إجمالي النقاط' : 'الإجمالي (عدد)', value: num(totals.quantity) },
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
    writeCsv(`ops-${subject}-${level}-${groupBy}`, columnsFromTable(columns as any[]), rows);
  };

  const tableCols = useTableColumns(`ops-reports-${grouped ? 'grouped' : subject}`, columns);

  return (
    <Card
      title={(
        <span>
          {view ? view.label : 'تقارير التشغيل'}
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
            style={{ width: '100%' }} value={groupBy}
            onChange={(v) => {
              setGroupBy(v);
              setLevel(v === 'none' ? 'detail' : 'summary');
            }}
            options={[
              { value: 'none', label: 'تفصيلي' },
              { value: 'customer', label: 'مجمّع بالعميل' },
              { value: 'rep', label: 'مجمّع بالمندوب' },
              { value: 'kind', label: 'مجمّع بالنوع' },
              { value: 'status', label: 'مجمّع بالحالة' },
              { value: 'month', label: 'مجمّع بالشهر' },
              { value: 'branch', label: 'مجمّع بالفرع' },
              { value: 'shop', label: 'مجمّع بمحل الشراء', disabled: subject !== 'inspections' },
            ]}
          />
        </Col>
      </Row>

      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <DateRangeFilter
            value={range as any}
            onChange={(v) => setRange(v as any)}
          />
        </Col>
        {isCheque && (
          <Col xs={24} md={5}>
            <Select
              allowClear style={{ width: '100%' }} placeholder="بيستحق خلال…"
              value={dueWithin} onChange={setDueWithin}
              options={[
                { value: 7, label: 'أسبوع' },
                { value: 30, label: 'شهر' },
                { value: 90, label: 'تلات شهور' },
              ]}
            />
          </Col>
        )}
        <Col xs={24} md={5}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="كل العملاء" value={customerId} onChange={setCustomerId}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Col>
        <Col xs={24} md={4}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="كل المندوبين" value={repId} onChange={setRepId}
            options={users.map((u) => ({ value: u.id, label: u.full_name || u.username }))}
          />
        </Col>
        <Col xs={24} md={isCheque ? 2 : 7}>
          <Select
            style={{ width: '100%' }} value={onlyOpen ? 'open' : 'all'}
            onChange={(v) => setOnlyOpen(v === 'open')}
            options={[
              { value: 'all', label: 'الكل' },
              { value: 'open', label: 'المفتوح فقط' },
            ]}
          />
        </Col>
      </Row>

      {denied && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="مالكش صلاحية على التقرير ده"
          description="كل موضوع مقيَّد بصلاحية القسم الذي يقرأ منه. اختر موضوعاً آخر، أو اطلب الصلاحية من مدير النظام."
        />
      )}

      {totals && (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={8}>
            <Card size="small">
              <Statistic title="عدد السطور" value={totals.rows}
                suffix={totals.excluded
                  ? <span style={{ fontSize: 13, color: '#d48806' }}>
                      ({totals.excluded} ملغي)
                    </span>
                  : undefined} />
            </Card>
          </Col>
          <Col xs={8}>
            <Card size="small">
              <Statistic title={points ? 'إجمالي النقاط' : 'العدد'}
                value={num(totals.quantity)} />
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

      {/* الملغي بيتعرض ومابيتحسبش — والسطر ده بيقول الاتنين، عشان مايبقاش فيه نص ساكت. */}
      {!!totals?.excluded && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message={`${totals.excluded} سطر ملغي معروض وغير محسوب في الإجماليات`}
          description="يبقى الملغى على الشاشة ليجده من يبحث عن سبب اختفائه، ولا يُحتسب في الأرقام حتى لا يوهم بوجود التزام غير قائم."
        />
      )}

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
        // الملغي باهت — بيتقري، ومابيتقروش كأنه شغّال. ولازم يتلمّ مع كلاس مؤشر الكيبورد، لأن
        // `rowClassName` هنا بيحل محل اللي جاي من `kb.tableProps` مش بيتضاف عليه.
        rowClassName={(r: any) => [
          r.counts === false ? 'row-muted' : '', kb.rowClassName(r),
        ].filter(Boolean).join(' ')}
        locale={{ emptyText: denied ? 'مالكش صلاحية على التقرير ده' : 'لا توجد بيانات في هذه الفترة' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
}

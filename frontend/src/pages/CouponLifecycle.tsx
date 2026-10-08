import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Checkbox, Input, Select, Table, Tag, Tooltip, message,
} from 'antd';
import {
  ClearOutlined, DownloadOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { DocRef } from '../components/DocumentLink';
import { useLookup, labelMap } from '../hooks/useLookup';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { repOptions as repPickerOptions } from '../utils/reps';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { numeralsLocale } from '../utils/money';
import { columnsFromTable, exportCsv as writeCsv } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';

/**
 * حركة الكوبون — صف لكل ورقة: مين كان ماسك الدفتر، اتسلّمت لمين ويوم إيه وعلى أنهي
 * مستند، ورجعت من أنهي سباك ولمين.
 *
 * ده نفس اللي نظامهم القديم بيجاوبه من «صف الورقة» عنده. عندنا الكلام متفرّق على العهدة
 * ومستند الصرف ودفتر الفاتورة والاستلام، والسيرفر هو اللي بيلمّه (`lib/coupon_lifecycle`).
 *
 * **الترقيم في السيرفر.** الورق عشرات الآلاف — تحميله كله في الجدول بيقفّل الشاشة، والعدّ
 * لكل حالة بييجي من السيرفر على كل المفلتر مش على الصفحة المعروضة. التصدير والطباعة
 * بيطلبوا الكل مرة واحدة.
 *
 * الشريحة دي بتعرض نفسها في صفحة «تقارير ما بعد البيع» — فالـhook بيرجّع الفلاتر والأزرار
 * والجدول، والصفحة بتحطهم في أماكنهم، بدل ما الشريحة تبقى صفحة لوحدها برّه التبويبات.
 */

export interface LifecycleRow {
  key: string;
  serial: string;
  kind: string | null;
  status: 'with_rep' | 'given' | 'received' | 'returned';
  status_label: string;
  custody_rep: string | null;
  custody_doc: string | null;
  custody_date: string | null;
  handout_source: 'invoice' | 'issue' | null;
  handout_doc_id: number | null;
  handout_doc: string | null;
  handout_date: string | null;
  party_id: number | null;
  party: string | null;
  party_type: string | null;
  handout_rep: string | null;
  receipt_id: number | null;
  receipt_doc: string | null;
  receipt_date: string | null;
  plumber_id: number | null;
  plumber: string | null;
  receipt_rep: string | null;
  value: string | number | null;
  unlinked: boolean;
}

interface Summary {
  total: number; with_rep: number; given: number; received: number; returned: number;
  unlinked: number; shown: number; value_total: string | number;
}

const STATUS_COLORS: Record<string, string> = {
  with_rep: 'blue', given: 'orange', received: 'green', returned: 'default',
};
const STATUS_OPTIONS = [
  { value: 'with_rep', label: 'في العهدة' },
  { value: 'given', label: 'اتسلّم لتاجر' },
  { value: 'received', label: 'اتستلم من سباك' },
  { value: 'returned', label: 'رجع المكتب' },
];

const num = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 0 });
const money = (v: any) => Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 2 });
const dash = (v: any) => (v === null || v === undefined || v === '' ? '-' : v);
// التصدير بيطلب الكل — نفس حد السيرفر.
const ALL_ROWS = 100000;

export function useCouponLifecycle(range: [Dayjs, Dayjs] | null, active: boolean) {
  const { options: kindLookup } = useLookup('coupon_kind');
  const kindOptions = useMemo(
    () => (kindLookup || []).map((o) => ({ value: o.value, label: o.label })), [kindLookup]);
  const { options: typeLookup } = useLookup('customer_type');
  const typeLabel = useMemo(() => labelMap(typeLookup || []), [typeLookup]);

  const [dateField, setDateField] = useState<'handout' | 'receipt'>('handout');
  const [repId, setRepId] = useState<number | undefined>();
  const [partyId, setPartyId] = useState<number | undefined>();
  const [plumberId, setPlumberId] = useState<number | undefined>();
  const [kind, setKind] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  // الرقم بيتكتب حرف حرف — الطلب بيتبعت لما يخلص (Enter أو مسح)، مش مع كل ضغطة.
  const [serialText, setSerialText] = useState('');
  const [serialToText, setSerialToText] = useState('');
  const [serialQuery, setSerialQuery] = useState<{ from: string; to: string }>({ from: '', to: '' });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [rows, setRows] = useState<LifecycleRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  useEffect(() => {
    if (!active || reps.length || customers.length) return;
    Promise.all([
      api.get('/api/v1/users'),
      api.get('/api/v1/customers/options', { params: { limit: 20000 } }),
    ]).then(([u, c]) => {
      setReps((u.data || []).filter((x: any) => x.role === 'sales_rep'));
      setCustomers(c.data || []);
    }).catch(console.error);
  }, [active]);

  const repOptions = useMemo(
    () => repPickerOptions(sortByName(reps, (r: any) => r.full_name || r.username || ''), repId),
    [reps, repId]);
  // اللي اتسلّمله الدفتر تاجر/معرض/موزع، واللي رجّعه سباك — قايمتين عشان الاختيار مايتلخبطش.
  const partyOptions = useMemo(() => sortByName(
    customers.filter((c: any) => c.customer_type !== 'plumber'), (c: any) => c.name || '')
    .map((c: any) => ({ value: c.id, label: String(c.name ?? '') })), [customers]);
  const plumberOptions = useMemo(() => sortByName(
    customers.filter((c: any) => c.customer_type === 'plumber'), (c: any) => c.name || '')
    .map((c: any) => ({ value: c.id, label: String(c.name ?? '') })), [customers]);

  const params = useMemo(() => {
    const p: Record<string, any> = { date_field: dateField };
    if (range) {
      p.date_from = range[0].format('YYYY-MM-DD');
      p.date_to = range[1].format('YYYY-MM-DD');
    }
    if (repId) p.rep_id = repId;
    if (partyId) p.party_id = partyId;
    if (plumberId) p.plumber_id = plumberId;
    if (kind) p.kind = kind;
    if (status) p.status = status;
    if (onlyUnlinked) p.only_unlinked = true;
    // رقم واحد = ورقة واحدة؛ رقمين = نطاق «من … إلى».
    const from = serialQuery.from.trim();
    const to = serialQuery.to.trim();
    if (from && to) { p.serial_from = from; p.serial_to = to; } else if (from) p.serial = from;
    return p;
  }, [dateField, range, repId, partyId, plumberId, kind, status, onlyUnlinked, serialQuery]);

  const load = useCallback(async (pg = page, ps = pageSize) => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/after-sales-reports/coupons/lifecycle', {
        params: { ...params, limit: ps, offset: (pg - 1) * ps },
      });
      setRows(res.data?.rows || []);
      setSummary(res.data?.summary || null);
      setTotal(Number(res.data?.page?.total_rows || 0));
      setLoaded(true);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل حركة الكوبونات');
    } finally {
      setLoading(false);
    }
  }, [params, page, pageSize]);

  // الشريحة بتتحمّل لما تتفتح بس — الحساب في السيرفر تقيل نسبياً، ومالوش لازمة لو حد
  // فاتح «كوبونات السباكين».
  useEffect(() => {
    if (!active) return;
    setPage(1);
    load(1, pageSize);
  }, [active, params]);

  const reset = () => {
    setRepId(undefined); setPartyId(undefined); setPlumberId(undefined); setKind(undefined);
    setStatus(undefined); setOnlyUnlinked(false); setSerialText(''); setSerialToText('');
    setSerialQuery({ from: '', to: '' });
  };
  const applySerial = () => {
    if (serialText === serialQuery.from && serialToText === serialQuery.to) return;
    setSerialQuery({ from: serialText, to: serialToText });
  };

  const columns = [
    { title: 'الرقم', dataIndex: 'serial', key: 'serial', width: 100,
      render: (v: string) => <b>{v}</b> },
    { title: 'الفئة', dataIndex: 'kind', key: 'kind', width: 80, render: dash },
    { title: 'الحالة', dataIndex: 'status_label', key: 'status', width: 120,
      render: (v: string, r: LifecycleRow) => (
        <span>
          <Tag color={STATUS_COLORS[r.status]}>{v}</Tag>
          {r.unlinked && (
            <Tooltip title="رجعت من سباك والنظام مايعرفش اتسلّمت لمين">
              <Tag color="red">بدون تسليم</Tag>
            </Tooltip>
          )}
        </span>
      ) },
    { title: 'عهدة المندوب', dataIndex: 'custody_rep', key: 'custody_rep', width: 140,
      ellipsis: true, render: dash },
    { title: 'مستند العهدة', dataIndex: 'custody_doc', key: 'custody_doc', width: 120, render: dash },
    { title: 'اتسلّم لـ', dataIndex: 'party', key: 'party', width: 180, ellipsis: true,
      render: (v: string | null) => dash(v) },
    { title: 'النوع', dataIndex: 'party_type', key: 'party_type', width: 80,
      render: (v: string | null) => (v ? (typeLabel[v] || v) : '-') },
    { title: 'تاريخ التسليم', dataIndex: 'handout_date', key: 'handout_date', width: 110,
      render: dash },
    { title: 'مستند التسليم', dataIndex: 'handout_doc', key: 'handout_doc', width: 130,
      render: (v: string | null, r: LifecycleRow) => (r.handout_source === 'invoice'
        ? <DocRef kind="invoice" id={r.handout_doc_id} label={v} />
        : (v ? <Tooltip title="مستند صرف كوبونات">{v}</Tooltip> : '-')) },
    { title: 'مندوب التسليم', dataIndex: 'handout_rep', key: 'handout_rep', width: 140,
      ellipsis: true, render: dash },
    { title: 'رجع من (السباك)', dataIndex: 'plumber', key: 'plumber', width: 170, ellipsis: true,
      render: dash },
    { title: 'تاريخ الاستلام', dataIndex: 'receipt_date', key: 'receipt_date', width: 110,
      render: dash },
    { title: 'مستند الاستلام', dataIndex: 'receipt_doc', key: 'receipt_doc', width: 120,
      render: dash },
    { title: 'مندوب الاستلام', dataIndex: 'receipt_rep', key: 'receipt_rep', width: 140,
      ellipsis: true, render: dash },
    { title: 'القيمة', dataIndex: 'value', key: 'value', width: 90,
      render: (v: any) => (v === null || v === undefined ? '-' : money(v)) },
  ];
  const cols = useTableColumns('as-coupons-lifecycle', columns as any, {
    defaultHidden: ['custody_doc', 'party_type'],
  });

  // التصدير والطباعة على كل المفلتر — الصفحة المعروضة جزء منه بس.
  const fetchAll = async (): Promise<LifecycleRow[] | null> => {
    try {
      const res = await api.get('/api/v1/after-sales-reports/coupons/lifecycle', {
        params: { ...params, limit: ALL_ROWS, offset: 0 },
      });
      return res.data?.rows || [];
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل حركة الكوبونات');
      return null;
    }
  };
  // الأعمدة اللي بتتعرض بنص مركّب (النوع) بتتصدّر بالتسمية مش بالكود.
  const flatColumns = () => columnsFromTable<LifecycleRow>(cols.columns as any[]).map((c) => (
    c.value === 'party_type'
      ? { ...c, value: (r: LifecycleRow) => (r.party_type ? (typeLabel[r.party_type] || r.party_type) : '') }
      : c));

  const exportAll = async () => {
    const all = await fetchAll();
    if (!all) return;
    if (!all.length) { message.info('لا توجد بيانات للتصدير'); return; }
    writeCsv(`حركة-الكوبون-${dayjs().format('YYYY-MM-DD')}`, flatColumns(), all);
  };

  const printAll = async () => {
    const all = await fetchAll();
    if (!all) return;
    const printable: PrintColumn<LifecycleRow>[] = flatColumns()
      .map((c) => ({ title: c.title, value: c.value as any }));
    const meta: [string, string][] = [
      ['التاريخ على', dateField === 'handout' ? 'التسليم' : 'الاستلام'],
      ['من', range ? range[0].format('YYYY/MM/DD') : 'كل التواريخ'],
      ['إلى', range ? range[1].format('YYYY/MM/DD') : 'كل التواريخ'],
    ];
    if (repId) meta.push(['المندوب', repOptions.find((o) => o.value === repId)?.label ?? '']);
    if (partyId) meta.push(['اتسلّم لـ', partyOptions.find((o) => o.value === partyId)?.label ?? '']);
    if (plumberId) meta.push(['السباك', plumberOptions.find((o) => o.value === plumberId)?.label ?? '']);
    if (kind) meta.push(['الفئة', kind]);
    if (status) meta.push(['الحالة', STATUS_OPTIONS.find((o) => o.value === status)?.label ?? '']);
    if (params.serial) meta.push(['الرقم', params.serial]);
    if (params.serial_from) meta.push(['الأرقام', `${params.serial_from} - ${params.serial_to}`]);
    printReport({ title: 'حركة الكوبون', date: dayjs().format('YYYY/MM/DD'), meta },
      printable, all, summaryLines());
  };

  const summaryLines = () => (summary ? [
    { label: 'في العهدة', value: num(summary.with_rep) },
    { label: 'اتسلّم لتاجر', value: num(summary.given) },
    { label: 'اتستلم من سباك', value: num(summary.received) },
    { label: 'رجع المكتب', value: num(summary.returned) },
    { label: 'رجع من غير تسليم معروف', value: num(summary.unlinked) },
  ] : []);

  const filters = (
    <>
      <Select
        value={dateField} onChange={setDateField} style={{ width: 140 }}
        options={[
          { value: 'handout', label: 'بتاريخ التسليم' },
          { value: 'receipt', label: 'بتاريخ الاستلام' },
        ]}
      />
      <Input
        allowClear style={{ width: 120 }} prefix={<SearchOutlined />}
        placeholder="رقم / من" value={serialText}
        onChange={(e) => {
          setSerialText(e.target.value);
          if (!e.target.value && !serialToText) setSerialQuery({ from: '', to: '' });
        }}
        onPressEnter={applySerial} onBlur={applySerial}
      />
      <Input
        allowClear style={{ width: 100 }} placeholder="إلى" value={serialToText}
        onChange={(e) => {
          setSerialToText(e.target.value);
          if (!e.target.value) setSerialQuery((q) => ({ ...q, to: '' }));
        }}
        onPressEnter={applySerial} onBlur={applySerial}
      />
      <Select allowClear placeholder="كل الفئات" value={kind} onChange={setKind}
        options={kindOptions} style={{ width: 110 }} />
      <Select allowClear placeholder="كل الحالات" value={status} onChange={setStatus}
        options={STATUS_OPTIONS} style={{ width: 140 }} popupMatchSelectWidth={false} />
      <Select allowClear showSearch placeholder="كل المناديب" value={repId} onChange={setRepId}
        options={repOptions} filterOption={searchFilter} filterSort={searchRank}
        style={{ width: 170 }} />
      <Select allowClear showSearch placeholder="كل التجار / الموزعين" value={partyId}
        onChange={setPartyId} options={partyOptions} filterOption={searchFilter}
        filterSort={searchRank} style={{ width: 200 }} />
      <Select allowClear showSearch placeholder="كل السباكين" value={plumberId}
        onChange={setPlumberId} options={plumberOptions} filterOption={searchFilter}
        filterSort={searchRank} style={{ width: 180 }} />
      <Checkbox checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)}>
        رجع من غير تسليم
      </Checkbox>
      <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={reset}>مسح</Button>
    </>
  );

  const actions = (
    <>
      <Button icon={<PrinterOutlined />} onClick={printAll}>طباعة</Button>
      <Button icon={<DownloadOutlined />} onClick={exportAll}>تصدير CSV</Button>
      {cols.control}
      <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
    </>
  );

  // الأعداد دي على كل الورق المفلتر (من غير فلتر الحالة) — مش على الصفحة.
  const footer = summary ? (
    <span className="sl-foot">
      <span>العدد: <b>{num(total)}</b></span>
      <span>في العهدة: <b>{num(summary.with_rep)}</b></span>
      <span>اتسلّم لتاجر: <b>{num(summary.given)}</b></span>
      <span>اتستلم من سباك: <b>{num(summary.received)}</b></span>
      <span>رجع المكتب: <b>{num(summary.returned)}</b></span>
      {!!summary.unlinked && (
        <span>من غير تسليم: <b className="is-neg">{num(summary.unlinked)}</b></span>
      )}
      {Number(summary.value_total) > 0 && (
        <span>قيمة المستلم: <b>{money(summary.value_total)}</b></span>
      )}
    </span>
  ) : null;

  const table = (
    <Table<LifecycleRow>
      className="sl-table"
      rowKey="key" size="small" loading={loading} dataSource={rows}
      columns={cols.columns as any} tableLayout="fixed" scroll={{ x: 'max-content' }}
      locale={{ emptyText: 'لا توجد كوبونات بالفلاتر دي' }}
      pagination={{
        current: page, pageSize, total, showSizeChanger: true,
        pageSizeOptions: PAGE_SIZE_OPTIONS, locale: { items_per_page: '' },
        onChange: (p, ps) => { setPage(p); setPageSize(ps); load(p, ps); },
        showTotal: () => footer,
      }}
    />
  );

  return { filters, actions, table, count: loaded ? total : null };
}

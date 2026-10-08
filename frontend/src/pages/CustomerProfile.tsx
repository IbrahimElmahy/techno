import React, { useEffect, useMemo, useState } from 'react';
import { useBackTo } from '../components/useBackTo';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, compareArabic } from '../utils/arabicSort';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Descriptions, Row, Col, Card, Tag, Spin, Space, Button, Empty, Typography,
  Segmented, Checkbox, Input, Select, message, Alert
} from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { Statistic } from '../components/Statistic';
import {
  ReloadOutlined, ArrowRightOutlined, EditOutlined, FileTextOutlined,
  DownloadOutlined, PrinterOutlined, LinkOutlined, SearchOutlined
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useLookup, labelMap } from '../hooks/useLookup';
import InvoiceDocument, { invoiceFooter } from '../components/InvoiceDocument';
import VoucherDocument, { voucherFooter } from '../components/VoucherDocument';
import CustomerEditModal from '../components/CustomerEditModal';
import ListToolbar, { useListFilter, normalizeAr } from '../components/ListToolbar';
import DocumentLink, { DocKind, DocRef, docKindOf, useOpenDocument } from '../components/DocumentLink';
import { entryTypeLabel } from '../components/labels';
import { TabModal } from '../components/TabModal';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableColumns } from '../components/ColumnSettings';
import JournalEntryLines from '../components/JournalEntryLines';
import DocumentItemLines, { hasItemLines } from '../components/DocumentItemLines';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import type { ColumnsType } from 'antd/es/table';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { type PrintColumn } from '../print/reportSheet';
import { printStatement } from '../print/statementSheet';
import CouponStatsOverview from '../components/CouponStatsOverview';

import StatsRow from '../components/StatsRow';
import { money, qty as pointsNum, numeralsLocale } from '../utils/money';
import { runningTotals } from '../utils/statementOrder';

interface AccountRow {
  id: number;
  account_id: number;
  balance: string;
  family: string | null;
  commission_pct: string | null;
}

interface DocRow {
  id: number;
  document_number: string;
  doc_date: string | null;
  amount: string;
  detail: string;
}

interface StatementLine {
  doc_kind?: DocKind | null;
  doc_id?: number | null;
  doc_number?: string | null;
  entry_id: number;
  entry_date: string;
  entry_type: string;
  description: string;
  debit: string;
  credit: string;
  balance_before: string;
  balance: string;
  rep_name?: string | null;
  cost_center_name?: string | null;
  account_id?: number | null;
  account_name?: string | null;
  raw?: any;
  _serial?: number;
  _key?: string;
  residual?: string | null;
  due_date?: string | null;
  days_overdue?: number | null;
  payment_state?: string | null;
  payment_state_label?: string | null;
  matches?: Array<{
    line_id: number; entry_id: number | null; entry_number: string | null;
    entry_type: string | null; entry_date: string | null; amount: string; full: boolean;
  }>;
}

interface ProfileData {
  customer: any;
  account_id: number | null;
  balance: string;
  points_balance: string;
  total_sales: string;
  total_returns: string;
  total_receipts: string;
  invoice_count: number;
  last_invoice_date: string | null;
  invoices: DocRow[];
  returns: DocRow[];
  receipts: DocRow[];
  cheques: any[];
  coupons: any[];
}

interface PointRow {
  id: number;
  date: string | null;
  kind: string;
  kind_label: string;
  delta: string;
  earned: string;
  spent: string;
  doc_kind: string | null;
  doc_id: number | null;
  doc_number: string | null;
  running: string | null;
}

interface PointsLedgerData {
  rows: PointRow[];
  count: number;
  earned: string;
  spent: string;
  net: string;
  balance: string | null;
  kinds: Record<string, string>;
}

const POINTS_PAGE_SIZE = 5000;

const STATUS_LABELS: Record<string, string> = {
  pending: 'تحت التحصيل', settled: 'محصّل', bounced: 'مرتد', cancelled: 'ملغي',
  issued: 'صادر', redeemed: 'مستخدم', draft: 'مسودة', approved: 'معتمد', rejected: 'مرفوض',
};

const statusOptions = (rows: any[]) =>
  Array.from(new Set((rows || []).map((r) => r.status).filter(Boolean)))
    .map((s: any) => ({ value: s, label: STATUS_LABELS[s] || String(s) }));

const docColumns = (amountTitle: string) => [
  { title: 'رقم المستند', dataIndex: 'document_number', key: 'doc' },
  {
    title: 'التاريخ', dataIndex: 'doc_date', key: 'date',
    render: (d: string | null) => (d ? d.slice(0, 10) : '-'),
  },
  {
    title: amountTitle, dataIndex: 'amount', key: 'amount',
    render: (v: string) => <b>{money(v)}</b>,
  },
  { title: 'تفاصيل', dataIndex: 'detail', key: 'detail' },
];

const LINKABLE: Record<string, 'invoice' | 'return' | 'purchase' | 'purchase_return'> = {
  invoice: 'invoice',
  return: 'return',
  purchase: 'purchase',
  purchase_return: 'purchase_return',
};

export default function CustomerProfile() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const goBack = useBackTo('/customers');
  const { options: typeOptionsLookup } = useLookup('customer_type');
  const typeLabels = labelMap(typeOptionsLookup);
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statement, setStatement] = useState<any>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [record, setRecord] = useState<any>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordRef, setRecordRef] = useState<{ kind: string; id: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [points, setPoints] = useState<PointsLedgerData | null>(null);
  const [pointsMoreLoading, setPointsMoreLoading] = useState(false);

  const [repFilter, setRepFilter] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [ccFilter, setCcFilter] = useState<string[]>([]);
  const [docNo, setDocNo] = useState('');
  const [exactMatch, setExactMatch] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<readonly React.Key[]>([]);

  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [entryCache, setEntryCache] = useState<Record<number, any>>({});
  const [entryBusy, setEntryBusy] = useState<Record<number, boolean>>({});

  useEffect(() => {
    api.get('/api/v1/items').then((r) => setItems(r.data || [])).catch(() => {});
    api.get('/api/v1/warehouses').then((r) => setWarehouses(r.data || [])).catch(() => {});
    api.get('/api/v1/cost-centers?active=true').then((r) => setCostCenters(r.data || [])).catch(() => {});
    api.get('/api/v1/accounts').then((r) => setAccountsList(r.data || [])).catch(() => {});
  }, []);

  const invoicesFilter = useListFilter<DocRow>(data?.invoices || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const returnsFilter = useListFilter<DocRow>(data?.returns || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const receiptsFilter = useListFilter<DocRow>(data?.receipts || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const chequesFilter = useListFilter<any>(data?.cheques || [], {
    search: (r) => [r.cheque_number, r.bank_name, r.amount],
    filters: { status: (r, v) => r.status === v },
    dateOf: (r) => r.due_date,
  });
  const couponsFilter = useListFilter<any>(data?.coupons || [], {
    search: (r) => [r.serial, r.value, r.points_consumed],
    filters: { status: (r, v) => r.status === v },
  });
  const pointsFilter = useListFilter<PointRow>(points?.rows || [], {
    search: (r) => [r.doc_number, r.kind_label, r.delta],
    filters: { kind: (r, v) => r.kind === v },
    dateOf: (r) => r.date,
  });

  const load = async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/customers/${customerId}/profile`);
      setData(res.data);
      try {
        const accs = await api.get(`/api/v1/customers/${customerId}/accounts`);
        setAccounts(accs.data?.accounts || []);
      } catch { setAccounts([]); }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const [statementFamily, setStatementFamily] = useState<string>('');

  const loadStatement = async (reset = false, family?: string) => {
    if (!customerId) return;
    const params: any = {};
    if (range && range[0] && range[1] && !reset) {
      params.date_from = range[0].format('YYYY-MM-DD');
      params.date_to = range[1].format('YYYY-MM-DD');
    }
    const fam = family ?? statementFamily;
    if (fam) params.family = fam;
    try {
      const res = await api.get(`/api/v1/customers/${customerId}/statement`, { params });
      setStatement({
        ...res.data,
        lines: (res.data.lines || []).map((l: any, i: number) => ({
          ...l,
          _key: `${l.entry_id}-${i}`,
          doc_kind: l.doc_kind || docKindOf(l.source_doc_type || l.raw?.source_doc_type),
          doc_id: l.doc_id || l.source_doc_id || l.raw?.source_doc_id,
          doc_number: l.doc_number || l.document_number || l.raw?.document_number,
        })),
      });
    } catch (err) {
      setStatement(null);
    }
  };

  const [pointsFailed, setPointsFailed] = useState(false);

  const loadPoints = async (offset = 0) => {
    if (!customerId) return;
    if (offset) setPointsMoreLoading(true);
    try {
      const res = await api.get(`/api/v1/customers/${customerId}/points/ledger`, {
        params: { limit: POINTS_PAGE_SIZE, offset },
      });
      setPointsFailed(false);
      setPoints((prev) => (offset && prev
        ? { ...res.data, rows: [...prev.rows, ...(res.data.rows || [])] }
        : res.data));
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل دفتر النقاط');
      if (!offset) setPoints(null);
      setPointsFailed(true);
    } finally {
      if (offset) setPointsMoreLoading(false);
    }
  };

  useEffect(() => { load(); }, [customerId]);
  useEffect(() => { setPointsMoreLoading(false); loadPoints(); }, [customerId]);
  useEffect(() => { loadStatement(); }, [customerId, range, statementFamily]);

  const pointKindOptions = useMemo(
    () => Object.entries(points?.kinds || {}).map(([value, label]) => ({ value, label })),
    [points?.kinds],
  );

  const renderPointDoc = (r: PointRow) => {
    if (!r.doc_number) return <span style={{ color: '#8c8c8c' }}>-</span>;
    if (r.doc_kind === 'invoice' || r.doc_kind === 'return') {
      return <DocRef kind={r.doc_kind as DocKind} id={r.doc_id} label={r.doc_number} />;
    }
    return <Tag>{r.doc_number}</Tag>;
  };

  const c = data?.customer;
  const balance = Number(data?.balance || 0);
  const pointsBalance = Number(points?.balance ?? data?.points_balance ?? 0);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const families = accounts.filter((a) => a.family);

  const openDoc = useOpenDocument();

  const openRecord = async (kind: string, id: number) => {
    setRecordRef({ kind, id });
    setRecordLoading(true);
    setRecord({ title: 'جارٍ التحميل…', fields: [], lines: [], line_columns: [] });
    try {
      const res = await api.get(`/api/v1/customers/${customerId}/records/${kind}/${id}`);
      setRecord(res.data);
    } catch (err) {
      setRecord(null);
    } finally {
      setRecordLoading(false);
    }
  };

  const rowProps = (kind: string) => (r: any) => ({
    onClick: () => {
      if (kind === 'entry' && r.doc_kind && r.doc_id) { openDoc(r.doc_kind, r.doc_id); return; }
      openRecord(kind, kind === 'entry' ? r.entry_id : r.id);
    },
    style: { cursor: 'pointer' },
  });

  const statementLines: StatementLine[] = statement?.lines ?? [];

  const abc = (a: { label: string }, b: { label: string }) => compareArabic(a.label, b.label);
  const repOptions = useMemo(() => [...new Set(statementLines.map((l: any) => l.rep_name).filter(Boolean))]
    .map((r) => ({ value: r as string, label: r as string })).sort(abc), [statementLines]);
  const typeOptions = useMemo(() => [...new Set(statementLines.map((l: any) => l.entry_type).filter(Boolean))]
    .map((t) => ({ value: t as string, label: entryTypeLabel(t as string) })).sort(abc), [statementLines]);
  const ccOptions = useMemo(() => [...new Set(statementLines.map((l: any) => l.cost_center_name).filter(Boolean))]
    .map((costCenter) => ({ value: costCenter as string, label: costCenter as string })).sort(abc), [statementLines]);

  const PRESETS: Array<{ label: string; get: () => [Dayjs, Dayjs] }> = [
    { label: 'اليوم', get: () => [dayjs(), dayjs()] },
    { label: 'الأمس', get: () => [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')] },
    { label: 'آخر ٧ أيام', get: () => [dayjs().subtract(6, 'day'), dayjs()] },
    { label: 'هذا الشهر', get: () => [dayjs().startOf('month'), dayjs()] },
    {
      label: 'الشهر الماضي',
      get: () => [
        dayjs().subtract(1, 'month').startOf('month'),
        dayjs().subtract(1, 'month').endOf('month'),
      ],
    },
    { label: 'هذه السنة', get: () => [dayjs().startOf('year'), dayjs()] },
  ];
  const presetActive = (p: { get: () => [Dayjs, Dayjs] }) => {
    if (!range || !range[0] || !range[1]) return false;
    const [s, e] = p.get();
    return range[0].isSame(s, 'day') && range[1].isSame(e, 'day');
  };

  const shownLines = useMemo(() => {
    const qRaw = query.trim();
    const q = normalizeAr(qRaw).toLowerCase();
    const dRaw = docNo.trim();
    const d = normalizeAr(dRaw).toLowerCase();
    return statementLines.filter((l: any) => {
      if (repFilter && l.rep_name !== repFilter) return false;
      if (typeFilter.length && !typeFilter.includes(l.entry_type)) return false;
      if (ccFilter.length && !ccFilter.includes(l.cost_center_name ?? '')) return false;
      if (hideZero && !Number(l.debit || 0) && !Number(l.credit || 0)) return false;
      if (dRaw) {
        const dn = normalizeAr(l.doc_number ?? '');
        if (exactMatch ? dn !== d : !dn.includes(d)) return false;
      }
      if (!q) return true;
      const haystacks = [l.description, l.doc_number, l.rep_name, l.cost_center_name,
        l.account_name, entryTypeLabel(l.entry_type)];
      return haystacks.some((v) => {
        const n = normalizeAr(v);
        return exactMatch ? n === q : n.includes(q);
      });
    }).map((l: any, i: number) => ({
      ...l,
      _serial: i + 1,
      doc_kind: l.doc_kind || docKindOf(l.source_doc_type || l.raw?.source_doc_type),
      doc_id: l.doc_id || l.source_doc_id || l.raw?.source_doc_id,
      doc_number: l.doc_number || l.document_number || l.raw?.document_number,
    }));
  }, [statementLines, repFilter, typeFilter, ccFilter, hideZero, docNo, query, exactMatch]);

  const filtering = !!(repFilter || ccFilter.length || typeFilter.length
    || query.trim() || docNo.trim() || hideZero);

  const runningOf = useMemo(() => runningTotals(
    shownLines, (l) => `${l.entry_id}-${l.entry_date}-${l.balance}`), [shownLines]);

  const loadEntry = async (entryId: number) => {
    if (entryId in entryCache || entryBusy[entryId]) return;
    setEntryBusy((b) => ({ ...b, [entryId]: true }));
    try {
      const r = await api.get(`/api/v1/journal-entries/${entryId}`);
      setEntryCache((c) => ({ ...c, [entryId]: r.data }));
    } catch {
      setEntryCache((c) => ({ ...c, [entryId]: null }));
    } finally {
      setEntryBusy((b) => ({ ...b, [entryId]: false }));
    }
  };

  const rowKeyOf = (l: StatementLine) => `${l.entry_id}-${l.entry_date}-${l.balance}`;

  const toggleRow = (l: StatementLine) => {
    const k = rowKeyOf(l);
    setExpandedKeys((keys) => (keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]));
    if (!hasItemLines(l.doc_kind)) loadEntry(l.entry_id);
  };

  useEffect(() => {
    if (showStock) setExpandedKeys(shownLines.map(rowKeyOf));
  }, [showStock, shownLines]);

  const kb = useTableKeyboard<StatementLine>({
    rows: statementLines,
    rowKey: rowKeyOf,
    onOpen: toggleRow,
  });

  const itemNameOf = (id: number) => {
    const it = items.find((x: any) => x.id === id);
    return it ? it.name : `صنف #${id}`;
  };
  const whName = (id: number | null | undefined) => {
    if (!id) return null;
    const w = warehouses.find((x: any) => x.id === id);
    return w ? w.name : `مخزن #${id}`;
  };
  const acctName = (id: number) => {
    const a = accountsList.find((x: any) => x.id === id);
    return a ? (a.code ? `${a.code} — ${a.name || a.owner_name}` : (a.name || a.owner_name || `#${id}`)) : `حساب #${id}`;
  };
  const ccName = (id: number | null | undefined) => {
    if (!id) return null;
    const costCenter = costCenters.find((x: any) => x.id === id);
    return costCenter ? (costCenter.name || `#${id}`) : `#${id}`;
  };

  const customerAccountIds = useMemo(() => {
    const ids: number[] = [];
    if (data?.account_id) ids.push(data.account_id);
    (accounts || []).forEach((a) => {
      if (a.account_id && !ids.includes(a.account_id)) ids.push(a.account_id);
    });
    if (statement?.families) {
      statement.families.forEach((f: any) => {
        if (f.account_id && !ids.includes(f.account_id)) ids.push(f.account_id);
      });
    }
    return ids;
  }, [data?.account_id, accounts, statement?.families]);

  const rowDetail = (l: StatementLine) => {
    const head = (
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10,
      }}>
        <Tag>{entryTypeLabel(l.entry_type)}</Tag>
        <span style={{ color: '#8c8c8c' }}>{String(l.entry_date || '').slice(0, 10)}</span>
        <span>{l.description}</span>
        <span style={{ marginInlineStart: 'auto' }}>
          {l.doc_kind && l.doc_id ? (
            <DocumentLink kind={l.doc_kind} id={l.doc_id}
              label={l.doc_number ? `المستند ${l.doc_number}` : 'فتح المستند'} allowEdit />
          ) : (
            <span style={{ color: '#8c8c8c' }}>قيد يدوي — لا يوجد مستند خلفه</span>
          )}
        </span>
      </div>
    );

    if (l.doc_kind && l.doc_id && hasItemLines(l.doc_kind)) {
      return (
        <div style={{ padding: '4px 8px' }}>
          {head}
          <DocumentItemLines kind={l.doc_kind} id={l.doc_id}
            itemName={itemNameOf} warehouseName={whName} money={money} />
        </div>
      );
    }

    if (entryBusy[l.entry_id] || !(l.entry_id in entryCache)) {
      return <div style={{ padding: '4px 8px' }}>{head}<Spin size="small" /></div>;
    }
    const entry = entryCache[l.entry_id];
    if (!entry) {
      return (
        <div style={{ padding: '4px 8px' }}>
          {head}
          <span style={{ color: '#8c8c8c' }}>تعذر تحميل سطور القيد</span>
        </div>
      );
    }

    return (
      <div style={{ padding: '4px 8px' }}>
        {head}
        <JournalEntryLines
          lines={entry.lines || []}
          currentAccountId={data?.account_id ?? undefined}
          currentAccountIds={customerAccountIds}
          accountLabel={acctName}
          costCenterName={ccName}
          onOpenAccount={(accId) => navigate(`/account-statement?account=${accId}`)}
          money={money}
        />
      </div>
    );
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      message.success('تم نسخ رابط ملف العميل');
    } catch {
      message.error('تعذر نسخ الرابط');
    }
  };

  const printColOf = (k: string): PrintColumn<StatementLine> | null => {
    switch (k) {
      case '_serial': return { title: 'رقم', value: (l) => l._serial ?? '' };
      case 'entry_date': return { title: 'التاريخ', value: (l) => String(l.entry_date || '').slice(0, 10) };
      case 'entry_type': return { title: 'النوع', value: (l) => entryTypeLabel(l.entry_type) };
      case 'description': return { title: 'البيان', value: 'description' };
      case 'rep_name': return { title: 'مندوب', value: (l) => l.rep_name ?? '' };
      case 'cost_center_name': return { title: 'مركز التكلفة', value: (l) => l.cost_center_name ?? '' };
      case 'balance_before': return { title: 'الرصيد قبل', value: 'balance_before', numeric: true };
      case 'debit': return { title: 'مدين', value: 'debit', numeric: true };
      case 'credit': return { title: 'دائن', value: 'credit', numeric: true };
      case 'running':
        return {
          title: 'تراكمي المعروض',
          value: (l) => money(runningOf.get(rowKeyOf(l)) ?? 0),
          numeric: true,
        };
      case 'balance': return { title: 'الرصيد بعد', value: 'balance', numeric: true };
      case 'doc': return { title: 'المستند', value: (l) => l.doc_number ?? '' };
      default: return null;
    }
  };

  const exportCsv = () => {
    if (!statement?.lines?.length) { message.info('لا توجد حركات للتصدير'); return; }
    const visibleKeys = tableCols.columns.map((col: any) => String(col.key ?? col.dataIndex ?? ''));
    const cols: CsvColumn<StatementLine>[] = visibleKeys
      .map((k) => printColOf(k))
      .filter((col): col is PrintColumn<StatementLine> => !!col)
      .map(({ title, value }) => ({ title, value }) as CsvColumn<StatementLine>);
    writeCsv(`customer-${customerId}-statement`, cols, shownLines);
  };

  const printIt = () => {
    if (!statement) return;
    const filters: [string, string][] = [
      ...(statementFamily ? [['فرع الحساب', statementFamily] as [string, string]] : []),
      ...(repFilter ? [['مندوب', repFilter] as [string, string]] : []),
      ...(ccFilter.length ? [['مركز التكلفة', ccFilter.join('، ')] as [string, string]] : []),
      ...(typeFilter.length ? [['نوع الحركة', typeFilter.map(entryTypeLabel).join('، ')] as [string, string]] : []),
      ...(docNo.trim() ? [['رقم المستند', docNo.trim()] as [string, string]] : []),
      ...(query.trim() ? [[exactMatch ? 'بحث (تطابق تام)' : 'بحث', query.trim()] as [string, string]] : []),
      ...(hideZero ? [['عرض', 'بدون الحركات الصفرية'] as [string, string]] : []),
    ];
    printStatement({
      title: 'كشف حساب عميل',
      account: `${c?.name ?? ''}${c?.code ? ` (${c.code})` : ''}`,
      mainAccount: statement.main_account_name ?? null,
      from: range && range[0] && range[1] ? range[0].format('YYYY/MM/DD') : null,
      to: range && range[0] && range[1] ? range[1].format('YYYY/MM/DD') : null,
      opening: statement.opening_balance,
      closing: statement.closing_balance,
      lines: shownLines,
      normalSide: 'debit',
      filtered: filtering,
      filters,
      showAccount: new Set(shownLines.map((l) => l.account_id).filter(Boolean)).size > 1,
    });
  };

  const columns: ColumnsType<StatementLine> = [
    { title: 'رقم', dataIndex: '_serial', width: 60, align: 'center',
      ...numberColumn<StatementLine>((l) => l._serial ?? 0) },
    { title: 'التاريخ', dataIndex: 'entry_date',
      ...dateColumn<StatementLine>((l) => l.entry_date),
      sorter: (a: StatementLine, b: StatementLine) => String(a.entry_date || '')
        .localeCompare(String(b.entry_date || '')),
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'النوع', dataIndex: 'entry_type',
      ...textColumn(statementLines, (l: StatementLine) => entryTypeLabel(l.entry_type)),
      render: (t: string) => <Tag>{entryTypeLabel(t)}</Tag> },
    { title: 'البيان', dataIndex: 'description',
      ...textColumn(statementLines, (l: StatementLine) => l.description) },
    { title: 'مندوب', dataIndex: 'rep_name', width: 140, ellipsis: true,
      ...textColumn(statementLines, (l: StatementLine) => l.rep_name),
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>-</span> },
    { title: 'مركز التكلفة', dataIndex: 'cost_center_name', width: 160,
      ...textColumn(statementLines, (l: StatementLine) => l.cost_center_name),
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>-</span> },
    { title: 'الرصيد قبل', dataIndex: 'balance_before', align: 'left',
      ...numberColumn<StatementLine>((l) => l.balance_before),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.balance_before) - Number(b.balance_before),
      render: (v: string) => <span style={{ color: '#6b6b6b' }}>{money(v)}</span> },
    { title: 'مدين', dataIndex: 'debit', align: 'left',
      ...numberColumn<StatementLine>((l) => l.debit),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.debit) - Number(b.debit),
      render: (v: string) => (Number(v) ? money(v) : '-') },
    { title: 'دائن', dataIndex: 'credit', align: 'left',
      ...numberColumn<StatementLine>((l) => l.credit),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.credit) - Number(b.credit),
      render: (v: string) => (Number(v) ? money(v) : '-') },
    ...(filtering ? [{
      title: 'تراكمي المعروض',
      key: 'running',
      align: 'left' as const,
      render: (_: unknown, l: StatementLine) => (
        <span style={{ color: '#b26a00' }}>
          {money(runningOf.get(rowKeyOf(l)) ?? 0)}
        </span>
      ),
    }] : []),
    { title: 'الرصيد بعد', dataIndex: 'balance', align: 'left',
      ...numberColumn<StatementLine>((l) => l.balance),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.balance) - Number(b.balance),
      render: (v: string) => <b>{money(v)}</b> },
    ...(statement?.reconcilable ? [{
      title: 'المتبقّي',
      dataIndex: 'residual',
      align: 'left' as const,
      render: (_: unknown, l: StatementLine) => {
        if (l.residual === null || l.residual === undefined) {
          return <span style={{ color: '#8c8c8c' }}>-</span>;
        }
        const open = Math.abs(Number(l.residual || 0));
        if (!open) return <Tag color="green">مسدَّد</Tag>;
        return (
          <Space direction="vertical" size={0}>
            <b style={{ color: l.days_overdue ? '#cf1322' : '#b26a00' }}>{money(open)}</b>
            {!!l.days_overdue && <Tag color="red">متأخر {l.days_overdue} يوم</Tag>}
          </Space>
        );
      },
    }] : []),
    { title: 'المستند', key: 'doc', align: 'center',
      ...textColumn(statementLines, (l: StatementLine) => l.doc_number),
      render: (_: unknown, l: StatementLine) => (l.doc_kind && l.doc_id ? (
        <DocumentLink kind={l.doc_kind} id={l.doc_id} size="small"
          label={l.doc_number || undefined}
          allowEdit />
      ) : <span style={{ color: '#8c8c8c' }}>قيد يدوي</span>) },
  ];

  const tableCols = useTableColumns('customer-ledger-v2', columns, {
    export: { name: 'كشف حساب عميل', rows: shownLines },
  });

  return (
    <div>
      <Card
        title={
          <Space>
            <Button type="text" icon={<ArrowRightOutlined />} onClick={goBack}>
              رجوع
            </Button>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {c ? `ملف العميل: ${c.name} (${c.code})` : 'ملف العميل'}
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            <Button type="primary" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
              تعديل البيانات
            </Button>
            <Button icon={<FileTextOutlined />} disabled={!data?.account_id}
              onClick={() => navigate(`/account-statement?account=${data?.account_id}`)}>
              كشف الحساب التفصيلي
            </Button>
            <Button icon={<LinkOutlined />} disabled={!c?.id}
              onClick={() => navigate(`/reconciliation?kind=customer&partner=${c?.id}`)}>
              تسوية المفتوح
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => { load(); loadStatement(); }}>
              تحديث
            </Button>
          </Space>
        }
      >
        {loading && !data ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
        ) : !data ? (
          <Empty description="لا توجد بيانات" />
        ) : (
          <>
            {families.length > 1 && (
              <Card size="small" style={{ marginBottom: 16 }} title="فروع الحساب">
                <Table
                  size="small" pagination={false} rowKey="id" dataSource={families}
                  columns={[
                    { title: 'الحساب', dataIndex: 'family',
                      render: (v: string) => <Tag color="blue">{v}</Tag> },
                    { title: 'العمولة', dataIndex: 'commission_pct', width: 120,
                      render: (v: string | null) => (v === null || v === undefined
                        ? <span style={{ color: '#8c8c8c' }}>—</span> : `${Number(v)}%`) },
                    { title: 'الرصيد', dataIndex: 'balance', align: 'left' as const,
                      render: (v: string) => {
                        const n = Number(v || 0);
                        return (
                          <b style={{ color: n > 0 ? '#cf1322' : n < 0 ? '#1677ff' : '#3f8600' }}>
                            {money(v)}
                          </b>
                        );
                      } },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2}>
                        <strong>الإجمالي</strong>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1}>
                        <strong>
                          {money(families.reduce((t, a) => t + Number(a.balance || 0), 0))}
                        </strong>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              </Card>
            )}

            <StatsRow gutter={[12, 12]} style={{ marginBottom: 16 }}>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="الرصيد المستحق (الذمة)"
                    value={money(data.balance)}
                    valueStyle={{
                      color: balance > 0 ? '#cf1322' : balance < 0 ? '#1677ff' : '#3f8600',
                    }}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي المبيعات" value={money(data.total_sales)} />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي التحصيلات" value={money(data.total_receipts)} />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="رصيد النقاط"
                    value={pointsBalance.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
                    valueStyle={{ color: pointsBalance < 0 ? '#cf1322' : undefined }}
                  />
                </Card>
              </Col>
            </StatsRow>

            <Tabs
              items={[
                {
                  key: 'overview',
                  label: 'نظرة عامة',
                  children: (
                    <Descriptions bordered column={2} size="small">
                      <Descriptions.Item label="الكود">{c.code}</Descriptions.Item>
                      <Descriptions.Item label="الاسم">{c.name}</Descriptions.Item>
                      <Descriptions.Item label="التصنيف">
                        {typeLabels[c.customer_type] || c.customer_type}
                      </Descriptions.Item>
                      <Descriptions.Item label="الحالة">
                        {c.active ? <Tag color="green">نشط</Tag> : <Tag color="red">معطل</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="الهاتف">{c.phone || '-'}</Descriptions.Item>
                      <Descriptions.Item label="أرقام إضافية">
                        {(c.phones || []).join('، ') || '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="المركز">{c.markaz || '-'}</Descriptions.Item>
                      <Descriptions.Item label="العنوان">{c.address || '-'}</Descriptions.Item>
                      <Descriptions.Item label="عدد الفواتير">{data.invoice_count}</Descriptions.Item>
                      <Descriptions.Item label="آخر فاتورة">
                        {data.last_invoice_date ? data.last_invoice_date.slice(0, 10) : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="إجمالي المرتجعات">
                        {money(data.total_returns)}
                      </Descriptions.Item>
                      <Descriptions.Item label="رقم الحساب بالدفتر">
                        {data.account_id ?? '-'}
                      </Descriptions.Item>
                    </Descriptions>
                  ),
                },
                {
                  key: 'statement',
                  label: 'كشف الحساب',
                  children: (
                    <Card
                      size="small"
                      title={(
                        <Space wrap size={[6, 8]}>
                          {(statement?.families?.length ?? 0) > 1 && (
                            <Segmented
                              value={statementFamily}
                              onChange={(v) => {
                                setStatementFamily(String(v));
                              }}
                              options={[
                                { label: 'الكل', value: '' },
                                ...statement.families
                                  .filter((f: any) => f.family)
                                  .map((f: any) => ({
                                    label: `${f.family} — ${money(f.balance)}`,
                                    value: f.family as string,
                                  })),
                              ]}
                            />
                          )}
                          <div style={{ width: 260 }}>
                            <DateRangeFilter
                              value={range as any}
                              onChange={(v) => setRange(v as any)}
                            />
                          </div>
                          <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder="بحث في البيان أو الرقم"
                            style={{ width: 180 }}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                          <Select
                            mode="multiple"
                            showSearch
                            style={{ minWidth: 140 }}
                            allowClear
                            maxTagCount="responsive"
                            placeholder="نوع الحركة"
                            value={typeFilter}
                            onChange={setTypeFilter}
                            options={typeOptions}
                            disabled={!typeOptions.length && !typeFilter.length} filterOption={searchFilter} filterSort={searchRank}/>
                          <Select
                            showSearch
                            style={{ width: 130 }}
                            allowClear
                            placeholder="المندوب"
                            value={repFilter}
                            onChange={setRepFilter}
                            options={repOptions}
                            disabled={!repOptions.length && !repFilter} filterOption={searchFilter} filterSort={searchRank}/>
                        </Space>
                      )}
                      extra={(
                        <Space>
                          {tableCols.control}
                          <Button icon={<LinkOutlined />} onClick={copyLink}
                            disabled={!statement?.lines?.length}>نسخ الرابط</Button>
                          <Button icon={<DownloadOutlined />} onClick={exportCsv}
                            disabled={!statement?.lines?.length}>تصدير CSV</Button>
                          <Button icon={<PrinterOutlined />} onClick={printIt}
                            disabled={!statement?.lines?.length}>طباعة</Button>
                          <Button icon={<ReloadOutlined />} onClick={() => loadStatement()}>تحديث</Button>
                        </Space>
                      )}
                    >
                      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
                        <Col xs={24} md={6}>
                          <Select
                            mode="multiple" showSearch style={{ width: '100%' }}
                            allowClear maxTagCount="responsive"
                            placeholder="مركز التكلفة" value={ccFilter} onChange={setCcFilter}
                            options={ccOptions} disabled={!ccOptions.length && !ccFilter.length} filterOption={searchFilter} filterSort={searchRank}/>
                        </Col>
                        <Col xs={24} md={5}>
                          <Input allowClear prefix={<SearchOutlined />} placeholder="رقم المستند"
                            value={docNo} onChange={(e) => setDocNo(e.target.value)} />
                        </Col>
                        <Col xs={24} md={13}>
                          <Space wrap size={[4, 8]}>
                            {PRESETS.map((p) => (
                              <Button key={p.label} size="small"
                                type={presetActive(p) ? 'primary' : 'default'}
                                onClick={() => setRange(p.get())}>{p.label}</Button>
                            ))}
                            {range && (
                              <Button size="small" onClick={() => setRange(null)}>كل الفترات</Button>
                            )}
                            <Checkbox checked={exactMatch}
                              onChange={(e) => setExactMatch(e.target.checked)}>تطابق تام</Checkbox>
                            <Checkbox checked={hideZero}
                              onChange={(e) => setHideZero(e.target.checked)}>إخفاء الحركات الصفرية</Checkbox>
                          </Space>
                        </Col>
                      </Row>

                      {!statement ? (
                        <Empty description="لا يوجد حساب دفتري لهذا العميل" />
                      ) : (
                        <>
                          <StatsRow gutter={[8, 8]} style={{ marginBottom: 12 }}>
                            <Col xs={12} md={5}>
                              <Card size="small">
                                <Statistic title="رصيد أول المدة"
                                  value={money(statement.opening_balance)} />
                              </Card>
                            </Col>
                            <Col xs={12} md={5}>
                              <Card size="small">
                                <Statistic title={repFilter ? `مدين — ${repFilter}` : 'إجمالي مدين'}
                                  value={money(repFilter
                                    ? shownLines.reduce((t, l) => t + Number(l.debit || 0), 0)
                                    : statement.total_debit)} />
                              </Card>
                            </Col>
                            <Col xs={12} md={5}>
                              <Card size="small">
                                <Statistic title={repFilter ? `دائن — ${repFilter}` : 'إجمالي دائن'}
                                  value={money(repFilter
                                    ? shownLines.reduce((t, l) => t + Number(l.credit || 0), 0)
                                    : statement.total_credit)} />
                              </Card>
                            </Col>
                            <Col xs={12} md={4}>
                              <Card size="small">
                                <Statistic title="رصيد الحركة"
                                  value={money(Number(statement.total_debit || 0) - Number(statement.total_credit || 0))} />
                              </Card>
                            </Col>
                            <Col xs={12} md={5}>
                              <Card size="small">
                                <Statistic title="رصيد آخر المدة (الذمة)"
                                  value={money(statement.closing_balance)}
                                  valueStyle={{ color: '#0B5CA8' }} />
                              </Card>
                            </Col>
                          </StatsRow>

                          {statement?.reconcilable && (
                            <Card size="small" style={{ marginBottom: 12 }}
                              styles={{ body: { padding: '10px 12px' } }}>
                              <StatsRow gutter={[8, 8]} align="middle">
                                <Col xs={12} md={5}>
                                  <Statistic title="إجمالي المستحق"
                                    value={money(statement.total_due || 0)}
                                    valueStyle={{ fontSize: 20, color: '#0B5CA8' }} />
                                </Col>
                                <Col xs={12} md={5}>
                                  <Statistic title="منه متأخر"
                                    value={money(statement.total_overdue || 0)}
                                    valueStyle={{ fontSize: 20,
                                      color: Number(statement.total_overdue || 0) ? '#cf1322' : '#52c41a' }} />
                                </Col>
                                <Col xs={24} md={14}>
                                  <div style={{ fontSize: 14, color: '#8c8c8c', marginBottom: 4 }}>
                                    أعمار المستحق
                                  </div>
                                  <Space size={4} wrap>
                                    {([
                                      ['الحالي', statement.aging?.current, '#52c41a'],
                                      ['١–٣٠ يوم', statement.aging?.d30, '#faad14'],
                                      ['٣١–٦٠', statement.aging?.d60, '#fa8c16'],
                                      ['٦١–٩٠', statement.aging?.d90, '#f5222d'],
                                      ['أقدم من ٩٠', statement.aging?.older, '#a8071a'],
                                    ] as [string, any, string][]).map(([label, value, color]) => (
                                      <Tag key={label} style={{ margin: 0 }}
                                        color={Number(value || 0) ? color : undefined}>
                                        {label}: <b>{money(value || 0)}</b>
                                      </Tag>
                                    ))}
                                  </Space>
                                </Col>
                              </StatsRow>
                  {Number(statement.aging?.credit_open || 0) > 0 && (
                    <div style={{ fontSize: 14, color: '#8c8c8c', marginTop: 6 }}>
                      مطلوب <b>{money(statement.aging?.debit_open || 0)}</b> ·
                      دفعات لم تُخصم بعد من فاتورة <b>{money(statement.aging?.credit_open || 0)}</b> ·
                      الصافي هو المستحق أعلاه
                    </div>
                  )}
                            </Card>
                          )}


                          <div style={{ marginBottom: 8 }}>
                            <Checkbox checked={showStock} onChange={(e) => {
                              const on = e.target.checked;
                              setShowStock(on);
                              if (!on) setExpandedKeys([]);
                            }}>
                              حركة مخزنية — عرض أصناف كل المستندات
                            </Checkbox>
                          </div>

                          <Table<StatementLine>
                            {...kb.tableProps}
                            size="small"
                            rowKey={rowKeyOf}
                            dataSource={shownLines}
                            loading={loading}
                            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
                            pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS }}
                            scroll={{ x: 'max-content' }}
                            columns={tableCols.columns}
                            expandable={{
                              expandedRowKeys: expandedKeys,
                              onExpand: (_open, l) => toggleRow(l),
                              expandedRowRender: rowDetail,
                            }}
                            summary={() => {
                              const td = shownLines.reduce((t, l) => t + Number(l.debit || 0), 0);
                              const tc = shownLines.reduce((t, l) => t + Number(l.credit || 0), 0);
                              const cols = tableCols.columns;
                              const di = cols.findIndex((col: any) => col.dataIndex === 'debit');
                              const ci = cols.findIndex((col: any) => col.dataIndex === 'credit');
                              if (di < 0 || ci < 0) return null;
                              return (
                                <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                                  <Table.Summary.Cell index={0} colSpan={di + 1}><b>الإجمالي ({shownLines.length} حركة)</b></Table.Summary.Cell>
                                  <Table.Summary.Cell index={1}><b>{money(td)}</b></Table.Summary.Cell>
                                  {ci > di + 1 && <Table.Summary.Cell index={2} colSpan={ci - di - 1} />}
                                  <Table.Summary.Cell index={3}><b>{money(tc)}</b></Table.Summary.Cell>
                                  <Table.Summary.Cell index={4} colSpan={Math.max(1, cols.length - ci)} />
                                </Table.Summary.Row>
                              );
                            }}
                          />
                        </>
                      )}
                    </Card>
                  ),
                },
                {
                  key: 'invoices',
                  label: `طلبات البيع (${data.invoices.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم الفاتورة أو التفاصيل"
                        searchSpan={8} showDateRange
                        query={invoicesFilter.query} onQueryChange={invoicesFilter.setQuery}
                        range={invoicesFilter.range} onRangeChange={invoicesFilter.setRange}
                        onReset={invoicesFilter.reset}
                        total={data.invoices.length} shown={invoicesFilter.filtered.length}
                      />
                      <Table size="small" rowKey="id" dataSource={invoicesFilter.filtered} onRow={rowProps('invoice')}
                        columns={docColumns('الإجمالي')} pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS }}
                        scroll={{ x: true }} />
                    </>
                  ),
                },
                {
                  key: 'returns',
                  label: `المرتجعات (${data.returns.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم المستند أو التفاصيل"
                        searchSpan={8} showDateRange
                        query={returnsFilter.query} onQueryChange={returnsFilter.setQuery}
                        range={returnsFilter.range} onRangeChange={returnsFilter.setRange}
                        onReset={returnsFilter.reset}
                        total={data.returns.length} shown={returnsFilter.filtered.length}
                      />
                      <Table size="small" rowKey="id" dataSource={returnsFilter.filtered} onRow={rowProps('return')}
                        columns={docColumns('قيمة المرتجع')} pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS }}
                        scroll={{ x: true }} />
                    </>
                  ),
                },
                {
                  key: 'receipts',
                  label: `سندات القبض (${data.receipts.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم السند أو التفاصيل"
                        searchSpan={8} showDateRange
                        query={receiptsFilter.query} onQueryChange={receiptsFilter.setQuery}
                        range={receiptsFilter.range} onRangeChange={receiptsFilter.setRange}
                        onReset={receiptsFilter.reset}
                        total={data.receipts.length} shown={receiptsFilter.filtered.length}
                      />
                      <Table size="small" rowKey="id" dataSource={receiptsFilter.filtered} onRow={rowProps('receipt')}
                        columns={docColumns('المحصّل')} pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS }}
                        scroll={{ x: true }} />
                    </>
                  ),
                },
                {
                  key: 'cheques',
                  label: `الشيكات (${data.cheques.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم الشيك أو البنك"
                        searchSpan={8} showDateRange
                        query={chequesFilter.query} onQueryChange={chequesFilter.setQuery}
                        values={chequesFilter.values} onValueChange={chequesFilter.setValue}
                        range={chequesFilter.range} onRangeChange={chequesFilter.setRange}
                        onReset={chequesFilter.reset}
                        total={data.cheques.length} shown={chequesFilter.filtered.length}
                        filters={[
                          { key: 'status', placeholder: 'الحالة', options: statusOptions(data.cheques) },
                        ]}
                      />
                      <Table size="small" rowKey="id" dataSource={chequesFilter.filtered} onRow={rowProps('cheque')}
                        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS }} scroll={{ x: true }}
                        columns={[
                        { title: 'رقم الشيك', dataIndex: 'cheque_number', key: 'n' },
                        { title: 'البنك', dataIndex: 'bank_name', key: 'b',
                          render: (v: string) => v || '-' },
                        { title: 'القيمة', dataIndex: 'amount', key: 'a',
                          render: (v: string) => <b>{money(v)}</b> },
                        { title: 'الاستحقاق', dataIndex: 'due_date', key: 'd' },
                        { title: 'الحالة', dataIndex: 'status', key: 's',
                          render: (s: string) => <Tag>{STATUS_LABELS[s] || s}</Tag> },
                      ]} />
                    </>
                  ),
                },
                {
                  key: 'coupons',
                  label: `الكوبونات (${data.coupons.length})`,
                  children: (
                    <>
                      <CouponStatsOverview
                        totalCount={data.coupons.length}
                        totalValue={data.coupons.reduce((s: number, c: any) => s + Number(c.value || 0), 0)}
                        kinds={[
                          {
                            key: 'pending',
                            label: 'صالح للاستخدام',
                            count: data.coupons.filter((c: any) => c.status === 'pending').length,
                            value: data.coupons.filter((c: any) => c.status === 'pending')
                              .reduce((s: number, c: any) => s + Number(c.value || 0), 0),
                            color: '#faad14',
                            onClick: () => {
                              couponsFilter.setValue('status', 'pending');
                            },
                          },
                          {
                            key: 'redeemed',
                            label: 'تم الاسترداد',
                            count: data.coupons.filter((c: any) => c.status === 'redeemed').length,
                            value: data.coupons.filter((c: any) => c.status === 'redeemed')
                              .reduce((s: number, c: any) => s + Number(c.value || 0), 0),
                            color: '#52c41a',
                            onClick: () => {
                              couponsFilter.setValue('status', 'redeemed');
                            },
                          },
                          {
                            key: 'reversed',
                            label: 'ملغي ومعكوس',
                            count: data.coupons.filter((c: any) => c.status === 'reversed').length,
                            value: data.coupons.filter((c: any) => c.status === 'reversed')
                              .reduce((s: number, c: any) => s + Number(c.value || 0), 0),
                            color: '#8c8c8c',
                            onClick: () => {
                              couponsFilter.setValue('status', 'reversed');
                            },
                          },
                        ]}
                      />
                      <ListToolbar
                        searchPlaceholder="بحث بالسريال أو القيمة"
                        searchSpan={8}
                        query={couponsFilter.query} onQueryChange={couponsFilter.setQuery}
                        values={couponsFilter.values} onValueChange={couponsFilter.setValue}
                        onReset={couponsFilter.reset}
                        total={data.coupons.length} shown={couponsFilter.filtered.length}
                        filters={[
                          { key: 'status', placeholder: 'الحالة', options: statusOptions(data.coupons) },
                        ]}
                      />
                      <Table size="small" rowKey="id" dataSource={couponsFilter.filtered} onRow={rowProps('coupon')}
                        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS }} scroll={{ x: true }}
                        columns={[
                          { title: 'السريال', dataIndex: 'serial', key: 's' },
                          { title: 'القيمة', dataIndex: 'value', key: 'v',
                            render: (v: string) => `${money(v)}` },
                          { title: 'النقاط المستهلكة', dataIndex: 'points_consumed', key: 'p' },
                          { title: 'الحالة', dataIndex: 'status', key: 'st',
                            render: (s: string) => <Tag>{STATUS_LABELS[s] || s}</Tag> },
                        ]} />
                    </>
                  ),
                },
                {
                  key: 'points',
                  label: `النقاط (${points?.count ?? 0})`,
                  children: (
                    <>
                      <StatsRow gutter={[12, 12]} style={{ marginBottom: 16 }}>
                        <Col xs={12} md={6}>
                          <Card size="small">
                            <Statistic title="وارد (مكتسب)" value={pointsNum(points?.earned)}
                              valueStyle={{ color: '#3f8600' }} />
                          </Card>
                        </Col>
                        <Col xs={12} md={6}>
                          <Card size="small">
                            <Statistic title="منصرف" value={pointsNum(points?.spent)}
                              valueStyle={{ color: '#cf1322' }} />
                          </Card>
                        </Col>
                        <Col xs={12} md={6}>
                          <Card size="small">
                            <Statistic title="عدد الحركات" value={points?.count ?? 0} />
                          </Card>
                        </Col>
                        <Col xs={12} md={6}>
                          <Card size="small">
                            <Statistic title="الرصيد"
                              value={pointsBalance.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
                              valueStyle={{ color: pointsBalance < 0 ? '#cf1322' : '#1677ff' }} />
                          </Card>
                        </Col>
                      </StatsRow>
                      <ListToolbar
                        searchPlaceholder="بحث برقم المستند أو نوع الحركة"
                        searchSpan={8}
                        query={pointsFilter.query} onQueryChange={pointsFilter.setQuery}
                        values={pointsFilter.values} onValueChange={pointsFilter.setValue}
                        onReset={pointsFilter.reset}
                        showDateRange range={pointsFilter.range} onRangeChange={pointsFilter.setRange}
                        total={points?.rows.length || 0} shown={pointsFilter.filtered.length}
                        filters={[
                          { key: 'kind', placeholder: 'نوع الحركة', options: pointKindOptions },
                        ]}
                      />
                      {!points?.rows.length ? (
                        <Empty description="لا توجد حركة نقاط لهذا العميل" />
                      ) : (
                        <Table size="small" rowKey="id" dataSource={pointsFilter.filtered}
                          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS }}
                          scroll={{ x: true }}
                          columns={[
                            { title: 'التاريخ', dataIndex: 'date', key: 'd', width: 110,
                              render: (d: string | null) => d || '-' },
                            { title: 'النوع', dataIndex: 'kind_label', key: 'k', width: 150,
                              render: (l: string) => <Tag>{l}</Tag> },
                            { title: 'المستند', key: 'doc', width: 160,
                              render: (_: any, r: PointRow) => renderPointDoc(r) },
                            { title: 'وارد', dataIndex: 'earned', key: 'in', align: 'left', width: 110,
                              render: (v: string) => (Number(v) > 0
                                ? <b style={{ color: '#3f8600' }}>{pointsNum(v)}</b> : '-') },
                            { title: 'منصرف', dataIndex: 'spent', key: 'out', align: 'left', width: 110,
                              render: (v: string) => (Number(v) > 0
                                ? <b style={{ color: '#cf1322' }}>{pointsNum(v)}</b> : '-') },
                            { title: 'رصيد جاري', dataIndex: 'running', key: 'run', align: 'left', width: 120,
                              render: (v: string | null) => <b>{pointsNum(v)}</b> },
                          ]} />
                      )}
                      {points && points.count > points.rows.length && (
                        <Alert
                          style={{ marginTop: 12 }}
                          type="warning"
                          showIcon
                          message={`معروض ${points.rows.length} حركة من ${points.count} — لم تُحمَّل الحركات الأقدم بعد.`}
                          action={(
                            <Button size="small" loading={pointsMoreLoading}
                              onClick={() => loadPoints(points.rows.length)}>
                              تحميل المزيد
                            </Button>
                          )}
                        />
                      )}
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>

      <TabModal
        open={record !== null}
        title={record?.title || 'تفاصيل المستند'}
        onCancel={() => setRecord(null)}
        footer={(
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <span>
              {recordRef && LINKABLE[recordRef.kind] && (
                <DocumentLink
                  kind={LINKABLE[recordRef.kind]}
                  id={recordRef.id}
                  allowEdit={recordRef.kind === 'invoice'}
                  onNavigate={() => setRecord(null)}
                />
              )}
            </span>
            <span>
              {record?.doc
                ? invoiceFooter(record.doc, () => setRecord(null))
                : record?.voucher
                  ? voucherFooter(record.voucher, () => setRecord(null))
                  : <Button onClick={() => setRecord(null)}>إغلاق</Button>}
            </span>
          </Space>
        )}
        width={820}
        centered
        destroyOnHidden
      >
        {recordLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : !record ? null : record.doc ? (
          <InvoiceDocument doc={record.doc} />
        ) : record.voucher ? (
          <VoucherDocument doc={record.voucher} />
        ) : (
          <>
            <Descriptions bordered column={2} size="small">
              {(record.fields || []).map((f: any) => (
                <Descriptions.Item key={f.label} label={f.label}>{f.value}</Descriptions.Item>
              ))}
            </Descriptions>
            {(record.lines || []).length > 0 && (
              <Table
                style={{ marginTop: 16 }}
                size="small"
                rowKey="_i"
                dataSource={(record.lines || []).map((row: string[], i: number) => ({
                  _i: i,
                  ...Object.fromEntries(row.map((v, j) => [`c${j}`, v])),
                }))}
                columns={(record.line_columns || []).map((t: string, j: number) => ({
                  title: t, dataIndex: `c${j}`, key: `c${j}`,
                }))}
                pagination={false}
                scroll={{ x: true }}
              />
            )}
          </>
        )}
      </TabModal>

      <CustomerEditModal
        customer={data?.customer}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

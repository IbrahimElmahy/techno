import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Table, Descriptions,
  Statistic, Row, Col, Card, Tag, Spin, Space, Button, Empty, Typography,
  Checkbox, Input, Select, message, Alert
} from 'antd';
import {
  ReloadOutlined, ArrowRightOutlined, EditOutlined, FileTextOutlined,
  DownloadOutlined, PrinterOutlined, LinkOutlined, SearchOutlined
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import InvoiceDocument, { invoiceFooter } from '../components/InvoiceDocument';
import VoucherDocument, { voucherFooter } from '../components/VoucherDocument';
import SupplierEditModal from '../components/SupplierEditModal';
import ListToolbar, { useListFilter, normalizeAr } from '../components/ListToolbar';
import DocumentLink, { DocKind, docKindOf, useOpenDocument } from '../components/DocumentLink';
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
import { printReport, type PrintColumn } from '../print/reportSheet';

/**
 * ملف المورد (Supplier 360) — the mirror of the customer file: balance, account statement,
 * purchase invoices, returns, payment vouchers and cheques, each row opening in a popup.
 */

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
}

interface ProfileData {
  supplier: any;
  account_id: number | null;
  balance: string;
  total_purchases: string;
  total_returns: string;
  total_payments: string;
  invoice_count: number;
  last_invoice_date: string | null;
  purchases: DocRow[];
  returns: DocRow[];
  payments: DocRow[];
  cheques: any[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'تحت الدفع', settled: 'مصروف', bounced: 'مرتد', cancelled: 'ملغي',
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
    render: (v: string) => <b>{money(v)} ج.م</b>,
  },
  { title: 'تفاصيل', dataIndex: 'detail', key: 'detail' },
];

const LINKABLE: Record<string, 'invoice' | 'return' | 'purchase' | 'purchase_return'> = {
  invoice: 'invoice',
  return: 'return',
  purchase: 'purchase',
  purchase_return: 'purchase_return',
};

export default function SupplierProfile() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statement, setStatement] = useState<any>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [record, setRecord] = useState<any>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordRef, setRecordRef] = useState<{ kind: string; id: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);

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

  const purchasesFilter = useListFilter<DocRow>(data?.purchases || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const returnsFilter = useListFilter<DocRow>(data?.returns || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const paymentsFilter = useListFilter<DocRow>(data?.payments || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const chequesFilter = useListFilter<any>(data?.cheques || [], {
    search: (r) => [r.cheque_number, r.bank_name, r.amount],
    filters: { status: (r, v) => r.status === v },
    dateOf: (r) => r.due_date,
  });

  const load = async () => {
    if (!supplierId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/suppliers/${supplierId}/profile`);
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadStatement = async (reset = false) => {
    if (!supplierId) return;
    const params: any = {};
    if (range && !reset) {
      params.date_from = range[0].format('YYYY-MM-DD');
      params.date_to = range[1].format('YYYY-MM-DD');
    }
    try {
      const res = await api.get(`/api/v1/suppliers/${supplierId}/statement`, { params });
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

  useEffect(() => { load(); }, [supplierId]);
  useEffect(() => { loadStatement(); }, [supplierId, range]);

  const openRecord = async (kind: string, id: number) => {
    setRecordRef({ kind, id });
    setRecordLoading(true);
    setRecord({ title: 'جارٍ التحميل…', fields: [], lines: [], line_columns: [] });
    try {
      const res = await api.get(`/api/v1/suppliers/${supplierId}/records/${kind}/${id}`);
      setRecord(res.data);
    } catch (err) {
      setRecord(null);
    } finally {
      setRecordLoading(false);
    }
  };

  const openDoc = useOpenDocument();

  const rowProps = (kind: string) => (r: any) => ({
    onClick: () => {
      if (kind === 'entry' && r.doc_kind && r.doc_id) { openDoc(r.doc_kind, r.doc_id); return; }
      openRecord(kind, kind === 'entry' ? r.entry_id : r.id);
    },
    style: { cursor: 'pointer' },
  });

  const s = data?.supplier;
  const balance = Number(data?.balance || 0);

  const statementLines: StatementLine[] = statement?.lines ?? [];

  const repOptions = useMemo(() => [...new Set(statementLines.map((l: any) => l.rep_name).filter(Boolean))]
    .map((r) => ({ value: r as string, label: r as string })), [statementLines]);
  const typeOptions = useMemo(() => [...new Set(statementLines.map((l: any) => l.entry_type).filter(Boolean))]
    .map((t) => ({ value: t as string, label: entryTypeLabel(t as string) })), [statementLines]);
  const ccOptions = useMemo(() => [...new Set(statementLines.map((l: any) => l.cost_center_name).filter(Boolean))]
    .map((costCenter) => ({ value: costCenter as string, label: costCenter as string })), [statementLines]);

  const PRESETS: Array<{ label: string; get: () => [Dayjs, Dayjs] }> = [
    { label: 'اليوم', get: () => [dayjs(), dayjs()] },
    { label: 'الأمس', get: () => [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')] },
    { label: 'آخر ٧ أيام', get: () => [dayjs().subtract(6, 'day'), dayjs()] },
    { label: 'الشهر ده', get: () => [dayjs().startOf('month'), dayjs()] },
    {
      label: 'الشهر الماضي',
      get: () => [
        dayjs().subtract(1, 'month').startOf('month'),
        dayjs().subtract(1, 'month').endOf('month'),
      ],
    },
    { label: 'السنة دي', get: () => [dayjs().startOf('year'), dayjs()] },
  ];
  const presetActive = (p: { get: () => [Dayjs, Dayjs] }) => {
    if (!range) return false;
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

  const runningOf = useMemo(() => {
    const m = new Map<string, number>();
    let acc = 0;
    for (const l of shownLines) {
      acc += Number(l.debit || 0) - Number(l.credit || 0);
      m.set(`${l.entry_id}-${l.entry_date}-${l.balance}`, acc);
    }
    return m;
  }, [shownLines]);

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
    return it ? (it.code ? `${it.code} — ${it.name}` : it.name) : `صنف #${id}`;
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
      message.success('تم نسخ رابط ملف المورد');
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
    writeCsv(`supplier-${supplierId}-statement`, cols, shownLines);
  };

  const printIt = () => {
    if (!statement) return;
    const visibleKeys = tableCols.columns.map((col: any) => String(col.key ?? col.dataIndex ?? ''));
    const cols = visibleKeys
      .map((k) => printColOf(k))
      .filter((col): col is PrintColumn<StatementLine> => !!col);
    printReport(
      {
        title: `كشف حساب مورد: ${s?.name ?? ''} (${s?.code ?? ''})`,
        meta: [
          ['المورد', `${s?.name ?? ''}${s?.code ? ` (${s.code})` : ''}`],
          ...(range ? [[
            'الفترة',
            `${range[0].format('YYYY/MM/DD')} ← ${range[1].format('YYYY/MM/DD')}`,
          ] as [string, string]] : []),
          ...(repFilter ? [['مندوب', repFilter] as [string, string]] : []),
          ...(ccFilter.length ? [['مركز التكلفة', ccFilter.join('، ')] as [string, string]] : []),
          ...(typeFilter.length ? [['نوع الحركة', typeFilter.map(entryTypeLabel).join('، ')] as [string, string]] : []),
          ...(docNo.trim() ? [['رقم المستند', docNo.trim()] as [string, string]] : []),
          ...(query.trim() ? [[exactMatch ? 'بحث (تطابق تام)' : 'بحث', query.trim()] as [string, string]] : []),
          ...(hideZero ? [['عرض', 'بدون الحركات الصفرية'] as [string, string]] : []),
        ],
      },
      cols,
      shownLines,
      [
        { label: 'رصيد أول المدة', value: money(statement.opening_balance) },
        { label: 'إجمالي مدين (المعروض)', value: money(shownLines.reduce((t, l) => t + Number(l.debit || 0), 0)) },
        { label: 'إجمالي دائن (المعروض)', value: money(shownLines.reduce((t, l) => t + Number(l.credit || 0), 0)) },
        { label: 'الرصيد الختامي', value: money(statement.closing_balance) },
      ],
    );
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
    { title: 'المستند', key: 'doc', align: 'center',
      ...textColumn(statementLines, (l: StatementLine) => l.doc_number),
      render: (_: unknown, l: StatementLine) => (l.doc_kind && l.doc_id ? (
        <DocumentLink kind={l.doc_kind} id={l.doc_id} size="small"
          label={l.doc_number || undefined}
          allowEdit />
      ) : <span style={{ color: '#8c8c8c' }}>قيد يدوي</span>) },
  ];

  const tableCols = useTableColumns('supplier-ledger-v2', columns, {
    export: { name: 'كشف حساب المورد', rows: shownLines },
  });

  return (
    <div>
      <Card
        title={
          <Space>
            <Button type="text" icon={<ArrowRightOutlined />} onClick={() => navigate('/suppliers')}>
              رجوع
            </Button>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {s ? `ملف المورد: ${s.name} (${s.code})` : 'ملف المورد'}
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            {tableCols.control}
            <Button type="primary" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
              تعديل البيانات
            </Button>
            <Button icon={<FileTextOutlined />} disabled={!data?.account_id}
              onClick={() => navigate(`/account-statement?account=${data?.account_id}`)}>
              كشف الحساب التفصيلي
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
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="الرصيد المستحق للمورد"
                    value={money(data.balance)}
                    suffix="ج.م"
                    valueStyle={{
                      color: balance > 0 ? '#cf1322' : balance < 0 ? '#1677ff' : '#3f8600',
                    }}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي المشتريات" value={money(data.total_purchases)} suffix="ج.م" />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي المدفوعات" value={money(data.total_payments)} suffix="ج.م" />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي المرتجعات" value={money(data.total_returns)} suffix="ج.م" />
                </Card>
              </Col>
            </Row>

            <Tabs
              items={[
                {
                  key: 'overview',
                  label: 'نظرة عامة',
                  children: (
                    <Descriptions bordered column={2} size="small">
                      <Descriptions.Item label="الكود">{s.code}</Descriptions.Item>
                      <Descriptions.Item label="الاسم">{s.name}</Descriptions.Item>
                      <Descriptions.Item label="الهاتف">{s.phone || '-'}</Descriptions.Item>
                      <Descriptions.Item label="العنوان">{s.address || '-'}</Descriptions.Item>
                      <Descriptions.Item label="الحالة">
                        {s.active ? <Tag color="green">نشط</Tag> : <Tag color="red">معطل</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="الرقم الضريبي">{s.tax_number || '-'}</Descriptions.Item>
                      <Descriptions.Item label="عدد الفواتير">{data.invoice_count}</Descriptions.Item>
                      <Descriptions.Item label="آخر فاتورة">
                        {data.last_invoice_date ? data.last_invoice_date.slice(0, 10) : '-'}
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
                            optionFilterProp="label"
                            style={{ minWidth: 140 }}
                            allowClear
                            maxTagCount="responsive"
                            placeholder="نوع الحركة"
                            value={typeFilter}
                            onChange={setTypeFilter}
                            options={typeOptions}
                            disabled={!typeOptions.length}
                          />
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ width: 130 }}
                            allowClear
                            placeholder="المندوب"
                            value={repFilter}
                            onChange={setRepFilter}
                            options={repOptions}
                            disabled={!repOptions.length}
                          />
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
                            mode="multiple" showSearch optionFilterProp="label" style={{ width: '100%' }}
                            allowClear maxTagCount="responsive"
                            placeholder="مركز التكلفة" value={ccFilter} onChange={setCcFilter}
                            options={ccOptions} disabled={!ccOptions.length}
                          />
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
                        <Empty description="لا يوجد حساب دفتري لهذا المورد" />
                      ) : (
                        <>
                          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
                            <Col xs={12} md={5}>
                              <Card size="small">
                                <Statistic title="رصيد أول المدة"
                                  value={money(statement.opening_balance)} suffix="ج.م" />
                              </Card>
                            </Col>
                            <Col xs={12} md={5}>
                              <Card size="small">
                                <Statistic title={repFilter ? `مدين — ${repFilter}` : 'إجمالي مدين'}
                                  value={money(repFilter
                                    ? shownLines.reduce((t, l) => t + Number(l.debit || 0), 0)
                                    : statement.total_debit)} suffix="ج.م" />
                              </Card>
                            </Col>
                            <Col xs={12} md={5}>
                              <Card size="small">
                                <Statistic title={repFilter ? `دائن — ${repFilter}` : 'إجمالي دائن'}
                                  value={money(repFilter
                                    ? shownLines.reduce((t, l) => t + Number(l.credit || 0), 0)
                                    : statement.total_credit)} suffix="ج.م" />
                              </Card>
                            </Col>
                            <Col xs={12} md={4}>
                              <Card size="small">
                                <Statistic title="رصيد الحركة"
                                  value={money(Number(statement.total_debit || 0) - Number(statement.total_credit || 0))} suffix="ج.م" />
                              </Card>
                            </Col>
                            <Col xs={12} md={5}>
                              <Card size="small">
                                <Statistic title="رصيد آخر المدة للمورد"
                                  value={money(statement.closing_balance)} suffix="ج.م"
                                  valueStyle={{ color: '#0B5CA8' }} />
                              </Card>
                            </Col>
                          </Row>

                          {filtering && (
                            <Alert
                              type="info" showIcon style={{ marginBottom: 12 }}
                              message={[
                                repFilter && `حركة «${repFilter}»`,
                                ccFilter.length && `مركز تكلفة «${ccFilter.join('، ')}»`,
                                typeFilter.length && `نوع «${typeFilter.map(entryTypeLabel).join('، ')}»`,
                                docNo.trim() && `مستند «${docNo.trim()}»`,
                                query.trim() && `بحث «${query.trim()}»${exactMatch ? ' (تطابق تام)' : ''}`,
                                hideZero && 'بدون الحركات الصفرية',
                              ].filter(Boolean).join(' · ')}
                              description={`${shownLines.length} حركة من إجمالي ${statementLines.length}. `
                                + 'الرصيد أول وآخر المدة للحساب كله — والعمود «تراكمي المعروض» هو الذي يسير مع السطور المعروضة.'}
                            />
                          )}

                          <div style={{ marginBottom: 8 }}>
                            <Checkbox checked={showStock} onChange={(e) => {
                              const on = e.target.checked;
                              setShowStock(on);
                              if (!on) setExpandedKeys([]);
                            }}>
                              حركة مخزنية — فرد أصناف كل المستندات
                            </Checkbox>
                          </div>

                          <Table<StatementLine>
                            {...kb.tableProps}
                            size="small"
                            rowKey={rowKeyOf}
                            dataSource={shownLines}
                            loading={loading}
                            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
                            pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: ['10', '25', '50', '100', '200'] }}
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
                  key: 'purchases',
                  label: `فواتير الشراء (${data.purchases.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم الفاتورة أو التفاصيل"
                        searchSpan={8} showDateRange
                        query={purchasesFilter.query} onQueryChange={purchasesFilter.setQuery}
                        range={purchasesFilter.range} onRangeChange={purchasesFilter.setRange}
                        onReset={purchasesFilter.reset}
                        total={data.purchases.length} shown={purchasesFilter.filtered.length}
                      />
                      <Table size="small" rowKey="id" dataSource={purchasesFilter.filtered}
                        columns={docColumns('الإجمالي')} onRow={rowProps('purchase')}
                        scroll={{ x: true }}
                        pagination={{ defaultPageSize: 10, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }} />
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
                      <Table size="small" rowKey="id" dataSource={returnsFilter.filtered}
                        columns={docColumns('قيمة المرتجع')} onRow={rowProps('return')}
                        scroll={{ x: true }}
                        pagination={{ defaultPageSize: 10, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }} />
                    </>
                  ),
                },
                {
                  key: 'payments',
                  label: `سندات الصرف (${data.payments.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم السند أو التفاصيل"
                        searchSpan={8} showDateRange
                        query={paymentsFilter.query} onQueryChange={paymentsFilter.setQuery}
                        range={paymentsFilter.range} onRangeChange={paymentsFilter.setRange}
                        onReset={paymentsFilter.reset}
                        total={data.payments.length} shown={paymentsFilter.filtered.length}
                      />
                      <Table size="small" rowKey="id" dataSource={paymentsFilter.filtered}
                        columns={docColumns('المدفوع')} onRow={rowProps('payment')}
                        scroll={{ x: true }}
                        pagination={{ defaultPageSize: 10, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }} />
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
                      <Table size="small" rowKey="id" dataSource={chequesFilter.filtered}
                        onRow={rowProps('cheque')} scroll={{ x: true }}
                        pagination={{ defaultPageSize: 10, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                        columns={[
                          { title: 'رقم الشيك', dataIndex: 'cheque_number', key: 'n' },
                          { title: 'البنك', dataIndex: 'bank_name', key: 'b',
                            render: (v: string) => v || '-' },
                          { title: 'القيمة', dataIndex: 'amount', key: 'a',
                            render: (v: string) => <b>{money(v)} ج.م</b> },
                          { title: 'الاستحقاق', dataIndex: 'due_date', key: 'd' },
                          { title: 'الحالة', dataIndex: 'status', key: 's',
                            render: (v: string) => <Tag>{STATUS_LABELS[v] || v}</Tag> },
                        ]} />
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>

      {/* One popup for every document kind. */}
      <TabModal
        open={record !== null}
        title={record?.title || 'تفاصيل المستند'}
        onCancel={() => setRecord(null)}
        footer={(
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            {/* The row is no longer a dead end: from here the document opens in the screen that
                owns it, where editing and reversing already live. */}
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

      <SupplierEditModal
        supplier={data?.supplier}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

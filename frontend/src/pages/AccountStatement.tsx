import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Empty, Input, Row, Select,
  Space, Spin, Statistic, Table, Tag, message,
} from 'antd';
import {
  DownloadOutlined, LinkOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import DocumentLink, { DocKind, docKindOf, useOpenDocument } from '../components/DocumentLink';
import { entryTypeLabel } from '../components/labels';
import JournalEntryLines from '../components/JournalEntryLines';
import DocumentItemLines, { hasItemLines } from '../components/DocumentItemLines';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import { normalizeAr } from '../components/ListToolbar';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';

type Subject = 'account' | 'item';

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
}

interface StatementOut {
  account_id: number;
  account_name: string;
  opening_balance: string;
  closing_balance: string;
  total_debit: string;
  total_credit: string;
  lines: StatementLine[];
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function AccountStatement() {
  const [search, setSearch] = useSearchParams();
  const u0 = {
    subject: (search.get('subject') === 'item' ? 'item' : 'account') as Subject,
    account: Number(search.get('account')) || undefined as number | undefined,
    main: search.get('main') || undefined as string | undefined,
    item: Number(search.get('item')) || undefined as number | undefined,
    wh: Number(search.get('wh')) || undefined as number | undefined,
    from: search.get('from'),
    to: search.get('to'),
    rep: search.get('rep') || undefined as string | undefined,
    types: (search.get('type') || '').split(',').filter(Boolean),
    q: search.get('q') || '',
    cc: (search.get('cc') || '').split(',').filter(Boolean),
    doc: search.get('doc') || '',
    x: search.get('x') === '1',
    z: search.get('z') === '1',
  };
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState<number | undefined>(u0.account);
  const [mainKey, setMainKey] = useState<string | undefined>(u0.main);
  const [subject, setSubject] = useState<Subject>(u0.subject);
  const [items, setItems] = useState<any[]>([]);
  const [itemId, setItemId] = useState<number | undefined>(u0.item);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | undefined>(u0.wh);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    u0.from && u0.to ? [dayjs(u0.from), dayjs(u0.to)] : null,
  );
  const [expandedKeys, setExpandedKeys] = useState<readonly React.Key[]>([]);
  const [showStock, setShowStock] = useState(false);
  const [entryCache, setEntryCache] = useState<Record<number, any>>({});
  const [entryBusy, setEntryBusy] = useState<Record<number, boolean>>({});
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [statement, setStatement] = useState<StatementOut | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/api/v1/accounts')
      .then((r) => setAccounts(r.data || []))
      .catch(console.error);
    api.get('/api/v1/cost-centers?active=true')
      .then((r) => setCostCenters(r.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/api/v1/items').then((r) => setItems(r.data || [])).catch(() => {});
    api.get('/api/v1/warehouses').then((r) => setWarehouses(r.data || [])).catch(() => {});
  }, []);

  const grouped = subject === 'account' && !accountId && !!mainKey;

  const load = async () => {
    setExpandedKeys([]);
    if (subject === 'account') {
      if (!accountId && !mainKey) { setStatement(null); return; }
      setLoading(true);
      try {
        const params: any = {};
        if (range) {
          params.date_from = range[0].format('YYYY-MM-DD');
          params.date_to = range[1].format('YYYY-MM-DD');
        }
        let res;
        if (accountId) {
          res = await api.get(`/api/v1/accounts/${accountId}/statement`, { params });
        } else {
          if (mainKey!.startsWith('grp:')) params.owner_group = mainKey!.slice(4);
          else params.root_id = Number(mainKey!.slice(4));
          res = await api.get('/api/v1/accounts-group/statement', { params });
        }
        setStatement(res.data);
      } catch (err: any) {
        message.error(err?.response?.data?.detail?.message || 'تعذر تحميل كشف الحساب');
        setStatement(null);
      } finally { setLoading(false); }
      return;
    }

    if (!itemId) { setStatement(null); return; }
    setLoading(true);
    try {
      const params: any = {};
      if (range) {
        params.date_from = range[0].format('YYYY-MM-DD');
        params.date_to = range[1].format('YYYY-MM-DD');
      }
      if (warehouseId) {
        params.location_kind = 'warehouse';
        params.location_id = warehouseId;
      }
      const res = await api.get(`/api/v1/items/${itemId}/card`, { params });
      const d = res.data || {};
      setStatement({
        account_id: itemId,
        account_name: `${d.item_name ?? ''}${d.item_code ? ` (${d.item_code})` : ''}`,
        opening_balance: d.opening_balance ?? '0',
        closing_balance: d.closing_balance ?? '0',
        total_debit: d.total_in ?? '0',
        total_credit: d.total_out ?? '0',
        lines: (d.rows || []).map((r: any) => ({
          entry_id: r.movement_id,
          entry_date: r.date,
          entry_type: r.movement_type,
          description: [r.party, r.location].filter(Boolean).join(' — ') || '-',
          debit: r.quantity_in ?? '0',
          credit: r.quantity_out ?? '0',
          balance_before: r.balance_before ?? '0',
          balance: r.balance_after ?? '0',
          rep_name: r.rep_name ?? null,
          cost_center_name: null,
          doc_kind: docKindOf(r.source_doc_type),
          doc_id: r.source_doc_id ?? null,
          doc_number: r.document_number ?? null,
          raw: r,
        })),
      });
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل كشف الصنف');
      setStatement(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [subject, accountId, mainKey, itemId, warehouseId, range]);

  const asked = Number(search.get('account')) || undefined;
  useEffect(() => {
    if (asked && asked !== accountId) {
      setSubject('account');
      setMainKey(undefined);
      setAccountId(asked);
    }
  }, [asked]);

  const labelOf = (a: any) => {
    const named = a.name || a.owner_name || `حساب #${a.id}`;
    return a.code ? `${a.code} — ${named}` : named;
  };

  const mainOptions = useMemo(() => {
    const roots = accounts.filter((a: any) => !a.parent_id && a.code)
      .map((a: any) => ({ value: `acc:${a.id}`, label: labelOf(a) }));
    const groups = [...new Set(accounts
      .filter((a: any) => !a.parent_id && !a.code && a.owner_group)
      .map((a: any) => a.owner_group))]
      .map((g) => ({ value: `grp:${g}`, label: String(g) }));
    return [...roots, ...groups];
  }, [accounts]);

  const visibleAccounts = useMemo(() => {
    if (!mainKey) return accounts;
    if (mainKey.startsWith('grp:')) {
      const group = mainKey.slice(4);
      return accounts.filter((a: any) => a.owner_group === group);
    }
    const rootId = Number(mainKey.slice(4));
    const byId = new Map<number, any>(accounts.map((a: any) => [a.id, a]));
    const inTree = (a: any) => {
      let cur: any = a;
      for (let hops = 0; cur && hops < 12; hops += 1) {
        if (cur.id === rootId) return true;
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
      return false;
    };
    return accounts.filter(inTree);
  }, [accounts, mainKey]);

  useEffect(() => {
    if (!accountId || mainKey || !accounts.length) return;
    const chosen = accounts.find((a: any) => a.id === accountId);
    if (!chosen) return;
    if (chosen.owner_group && !chosen.code) { setMainKey(`grp:${chosen.owner_group}`); return; }
    const byId = new Map<number, any>(accounts.map((a: any) => [a.id, a]));
    let cur: any = chosen;
    for (let hops = 0; cur?.parent_id && hops < 12; hops += 1) cur = byId.get(cur.parent_id);
    if (cur && cur.id !== chosen.id) setMainKey(`acc:${cur.id}`);
  }, [accountId, accounts, mainKey]);

  const lines: StatementLine[] = statement?.lines ?? [];

  const [repFilter, setRepFilter] = useState<string | undefined>(u0.rep);
  const [query, setQuery] = useState(u0.q);
  const [typeFilter, setTypeFilter] = useState<string[]>(u0.types);
  const [ccFilter, setCcFilter] = useState<string[]>(u0.cc);
  const [docNo, setDocNo] = useState(u0.doc);
  const [exactMatch, setExactMatch] = useState(u0.x);
  const [hideZero, setHideZero] = useState(u0.z);

  const repOptions = [...new Set(lines.map((l) => l.rep_name).filter(Boolean))]
    .map((r) => ({ value: r as string, label: r as string }));
  const typeOptions = [...new Set(lines.map((l) => l.entry_type).filter(Boolean))]
    .map((t) => ({ value: t as string, label: entryTypeLabel(t as string) }));
  const ccOptions = [...new Set(lines.map((l) => l.cost_center_name).filter(Boolean))]
    .map((c) => ({ value: c as string, label: c as string }));

  const PRESETS: Array<{ label: string; get: () => [Dayjs, Dayjs] }> = [
    { label: 'اليوم', get: () => [dayjs(), dayjs()] },
    { label: 'الأمس', get: () => [dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')] },
    { label: 'آخر ٧ أيام', get: () => [dayjs().subtract(6, 'day'), dayjs()] },
    { label: 'الشهر ده', get: () => [dayjs().startOf('month'), dayjs()] },
    {
      label: 'الشهر اللي فات',
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

  useEffect(() => {
    const p = new URLSearchParams();
    if (subject === 'item') p.set('subject', 'item');
    if (accountId) p.set('account', String(accountId));
    if (mainKey) p.set('main', mainKey);
    if (itemId) p.set('item', String(itemId));
    if (warehouseId) p.set('wh', String(warehouseId));
    if (range?.[0]) p.set('from', range[0].format('YYYY-MM-DD'));
    if (range?.[1]) p.set('to', range[1].format('YYYY-MM-DD'));
    if (repFilter) p.set('rep', repFilter);
    if (typeFilter.length) p.set('type', typeFilter.join(','));
    if (ccFilter.length) p.set('cc', ccFilter.join(','));
    if (query.trim()) p.set('q', query.trim());
    if (docNo.trim()) p.set('doc', docNo.trim());
    if (exactMatch) p.set('x', '1');
    if (hideZero) p.set('z', '1');
    setSearch(p, { replace: true });
  }, [subject, accountId, mainKey, itemId, warehouseId, range, repFilter, typeFilter,
    ccFilter, query, docNo, exactMatch, hideZero, setSearch]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      message.success('اتنسخ رابط الكشف بالفلاتر زي ما هي — ابعتّه لأي حد يفتحه');
    } catch {
      message.error('المتصفح رفض النسخ — انسخ العنوان من شريط العناوين');
    }
  };

  const shownLines = useMemo(() => {
    const qRaw = query.trim();
    const q = normalizeAr(qRaw).toLowerCase();
    const dRaw = docNo.trim();
    const d = normalizeAr(dRaw).toLowerCase();
    return lines.filter((l) => {
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
    })
      .map((l, i) => ({ ...l, _serial: i + 1 }));
  }, [lines, repFilter, typeFilter, ccFilter, hideZero, docNo, query, exactMatch]);

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
  const openDoc = useOpenDocument();

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
    if (subject === 'account' && !hasItemLines(l.doc_kind)) loadEntry(l.entry_id);
  };

  useEffect(() => {
    if (showStock) setExpandedKeys(shownLines.map(rowKeyOf));
  }, [showStock, shownLines]);

  const kb = useTableKeyboard<StatementLine>({
    rows: lines,
    rowKey: rowKeyOf,
    onOpen: toggleRow,
  });

  const isItem = subject === 'item';
  const LABELS = isItem
    ? { debit: 'داخل', credit: 'خارج', before: 'الرصيد قبل', after: 'الرصيد بعد' }
    : { debit: 'مدين', credit: 'دائن', before: 'الرصيد قبل', after: 'الرصيد بعد' };
  const num = (v: any) => (isItem
    ? Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 })
    : money(v));

  const columns: ColumnsType<StatementLine> = [
    { title: 'رقم', dataIndex: '_serial', width: 60, align: 'center',
      ...numberColumn<StatementLine>((l) => l._serial ?? 0) },
    { title: 'التاريخ', dataIndex: 'entry_date',
      ...dateColumn<StatementLine>((l) => l.entry_date),
      sorter: (a: StatementLine, b: StatementLine) => String(a.entry_date || '')
        .localeCompare(String(b.entry_date || '')),
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'النوع', dataIndex: 'entry_type',
      ...textColumn(lines, (l: StatementLine) => entryTypeLabel(l.entry_type)),
      render: (t: string) => <Tag>{entryTypeLabel(t)}</Tag> },
    ...(grouped ? [{
      title: 'الحساب الفرعي', dataIndex: 'account_name', width: 180, ellipsis: true,
      ...textColumn(lines, (l: StatementLine) => l.account_name),
      render: (v: string | null, l: StatementLine) => (l.account_id ? (
        <a onClick={() => openAccount(l.account_id!)}>{v ?? `#${l.account_id}`}</a>
      ) : (v ?? '-')),
    }] : []),
    { title: 'البيان', dataIndex: 'description',
      ...textColumn(lines, (l: StatementLine) => l.description) },
    { title: 'مندوب', dataIndex: 'rep_name', width: 140, ellipsis: true,
      ...textColumn(lines, (l: StatementLine) => l.rep_name),
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>-</span> },
    { title: 'مركز التكلفة', dataIndex: 'cost_center_name', width: 160,
      ...textColumn(lines, (l: StatementLine) => l.cost_center_name),
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>-</span> },
    { title: LABELS.before, dataIndex: 'balance_before', align: 'left',
      ...numberColumn<StatementLine>((l) => l.balance_before),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.balance_before) - Number(b.balance_before),
      render: (v: string) => <span style={{ color: '#6b6b6b' }}>{num(v)}</span> },
    { title: LABELS.debit, dataIndex: 'debit', align: 'left',
      ...numberColumn<StatementLine>((l) => l.debit),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.debit) - Number(b.debit),
      render: (v: string) => (Number(v) ? num(v) : '-') },
    { title: LABELS.credit, dataIndex: 'credit', align: 'left',
      ...numberColumn<StatementLine>((l) => l.credit),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.credit) - Number(b.credit),
      render: (v: string) => (Number(v) ? num(v) : '-') },
    ...(filtering ? [{
      title: 'تراكمي المعروض',
      key: 'running',
      align: 'left' as const,
      render: (_: unknown, l: StatementLine) => (
        <span style={{ color: '#b26a00' }}>
          {num(runningOf.get(`${l.entry_id}-${l.entry_date}-${l.balance}`) ?? 0)}
        </span>
      ),
    }] : []),
    { title: LABELS.after, dataIndex: 'balance', align: 'left',
      ...numberColumn<StatementLine>((l) => l.balance),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.balance) - Number(b.balance),
      render: (v: string) => <b>{num(v)}</b> },
    { title: 'المستند', key: 'doc', align: 'center',
      ...textColumn(lines, (l: StatementLine) => l.doc_number),
      render: (_: unknown, l: StatementLine) => (l.doc_kind && l.doc_id ? (
        <DocumentLink kind={l.doc_kind} id={l.doc_id} size="small"
          label={l.doc_number || undefined}
          allowEdit />
      ) : <span style={{ color: '#8c8c8c' }}>قيد يدوي</span>) },
  ];

  const tableCols = useTableColumns('account-statement', columns);

  const printColOf = (k: string): PrintColumn<StatementLine> | null => {
    switch (k) {
      case '_serial': return { title: 'رقم', value: (l) => l._serial ?? '' };
      case 'entry_date': return { title: 'التاريخ', value: (l) => String(l.entry_date || '').slice(0, 10) };
      case 'entry_type': return { title: 'النوع', value: (l) => entryTypeLabel(l.entry_type) };
      case 'account_name': return { title: 'الحساب الفرعي', value: (l) => l.account_name ?? '' };
      case 'description': return { title: 'البيان', value: 'description' };
      case 'rep_name': return { title: 'مندوب', value: (l) => l.rep_name ?? '' };
      case 'cost_center_name': return { title: 'مركز التكلفة', value: (l) => l.cost_center_name ?? '' };
      case 'balance_before': return { title: LABELS.before, value: 'balance_before', numeric: true };
      case 'debit': return { title: LABELS.debit, value: 'debit', numeric: true };
      case 'credit': return { title: LABELS.credit, value: 'credit', numeric: true };
      case 'running':
        return {
          title: 'تراكمي المعروض',
          value: (l) => num(runningOf.get(rowKeyOf(l)) ?? 0),
          numeric: true,
        };
      case 'balance': return { title: LABELS.after, value: 'balance', numeric: true };
      case 'doc': return { title: 'المستند', value: (l) => l.doc_number ?? '' };
      default: return null;
    }
  };

  const visibleKeys = tableCols.columns.map((c: any) => String(c.key ?? c.dataIndex ?? ''));

  const exportCsv = () => {
    if (!statement?.lines?.length) { message.info('لا توجد حركات للتصدير'); return; }
    const cols: CsvColumn<StatementLine>[] = visibleKeys
      .map((k) => printColOf(k))
      .filter((c): c is PrintColumn<StatementLine> => !!c)
      .map(({ title, value }) => ({ title, value }) as CsvColumn<StatementLine>);
    writeCsv(`statement-${statement.account_id}`, cols, shownLines);
  };

  const printIt = () => {
    if (!statement) return;
    const cols = visibleKeys
      .map((k) => printColOf(k))
      .filter((c): c is PrintColumn<StatementLine> => !!c);
    printReport(
      {
        title: isItem ? 'كشف صنف' : 'كشف حساب',
        meta: [
          [isItem ? 'الصنف' : 'الحساب', statement.account_name ?? ''],
          ...(range ? [[
            'الفترة',
            `${range[0].format('YYYY/MM/DD')} ← ${range[1].format('YYYY/MM/DD')}`,
          ] as [string, string]] : []),
          ...(isItem && warehouseId
            ? [['المخزن',
                warehouses.find((w: any) => w.id === warehouseId)?.name ?? ''] as [string, string]]
            : []),
          ...(repFilter ? [['مندوب', repFilter] as [string, string]] : []),
          ...(ccFilter.length
            ? [['مركز التكلفة', ccFilter.join('، ')] as [string, string]] : []),
          ...(typeFilter.length
            ? [['نوع الحركة', typeFilter.map(entryTypeLabel).join('، ')] as [string, string]] : []),
          ...(docNo.trim() ? [['رقم المستند', docNo.trim()] as [string, string]] : []),
          ...(query.trim()
            ? [[exactMatch ? 'بحث (تطابق تام)' : 'بحث', query.trim()] as [string, string]] : []),
          ...(hideZero ? [['عرض', 'بدون الحركات الصفرية'] as [string, string]] : []),
        ],
      },
      cols,
      shownLines,
      [
        { label: 'رصيد أول المدة', value: money(statement.opening_balance) },
        { label: `إجمالي ${LABELS.debit} (المعروض)`,
          value: money(shownLines.reduce((t, l) => t + Number(l.debit || 0), 0)) },
        { label: `إجمالي ${LABELS.credit} (المعروض)`,
          value: money(shownLines.reduce((t, l) => t + Number(l.credit || 0), 0)) },
        { label: 'الرصيد الختامي', value: money(statement.closing_balance) },
      ],
    );
  };

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
    const a = accounts.find((x: any) => x.id === id);
    return a ? labelOf(a) : `حساب #${id}`;
  };
  const ccName = (id: number | null | undefined) => {
    if (!id) return null;
    const c = costCenters.find((x: any) => x.id === id);
    return c ? (c.name || `#${id}`) : `#${id}`;
  };

  const openAccount = (id: number) => {
    if (!id || id === accountId) return;
    setSubject('account');
    setMainKey(undefined);
    setAccountId(id);
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
            <span style={{ color: '#8c8c8c' }}>قيد يدوي — مافيش مستند وراه</span>
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

    if (isItem) {
      const r = l.raw || {};
      const facts: Array<[string, React.ReactNode]> = [];
      if (r.quantity_in_unit) facts.push(['الكمية بالوحدة', `${r.quantity_in_unit} ${r.unit ?? ''}`]);
      if (r.unit_price != null) facts.push(['سعر الوحدة', money(r.unit_price)]);
      if (r.discount_pct != null && Number(r.discount_pct)) {
        facts.push(['الخصم', `${Number(r.discount_pct).toLocaleString('ar-EG')}%`]);
      }
      if (r.tax_amount != null && Number(r.tax_amount)) facts.push(['الضريبة', money(r.tax_amount)]);
      if (r.line_total != null) facts.push(['إجمالي السطر', <b key="t">{money(r.line_total)}</b>]);
      if (r.party) facts.push(['الطرف', r.party]);
      if (r.location) facts.push(['المكان', r.location]);
      if (r.expiry_date) facts.push(['تاريخ الصلاحية', String(r.expiry_date).slice(0, 10)]);
      if (r.is_reversal) facts.push(['ملاحظة', <Tag key="rv" color="red">حركة عكسية</Tag>]);

      return (
        <div style={{ padding: '4px 8px' }}>
          {head}
          {facts.length ? (
            <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3, lg: 4 }}>
              {facts.map(([k, v]) => (
                <Descriptions.Item key={k} label={k}>{v}</Descriptions.Item>
              ))}
            </Descriptions>
          ) : (
            <span style={{ color: '#8c8c8c' }}>الحركة دي مالهاش تفاصيل زيادة عن اللي في السطر</span>
          )}
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
          currentAccountId={accountId}
          accountLabel={acctName}
          costCenterName={ccName}
          onOpenAccount={openAccount}
          money={money}
        />
      </div>
    );
  };

  return (
    <Card
      title={isItem ? 'كشف صنف' : 'كشف حساب'}
      extra={(
        <>
          {tableCols.control}
          <Button icon={<LinkOutlined />} onClick={copyLink}
            disabled={!statement?.lines?.length} style={{ marginInlineEnd: 8 }}>نسخ الرابط</Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}
            disabled={!statement?.lines?.length} style={{ marginInlineEnd: 8 }}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />} onClick={printIt}
            disabled={!statement?.lines?.length}
            style={{ marginInlineEnd: 8 }}>طباعة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}
            disabled={isItem ? !itemId : (!accountId && !mainKey)}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={4}>
          <Select
            style={{ width: '100%' }} value={subject}
            onChange={(v) => {
              setSubject(v as Subject);
              setAccountId(undefined); setItemId(undefined);
              setWarehouseId(undefined); setStatement(null);
            }}
            options={[
              { value: 'account', label: 'كشف حساب' },
              { value: 'item', label: 'كشف صنف' },
            ]}
          />
        </Col>

        {isItem ? (
          <>
            <Col xs={24} md={8}>
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }}
                placeholder="اختر الصنف" value={itemId} onChange={setItemId}
                options={items.map((i: any) => ({
                  value: i.id,
                  label: i.code ? `${i.code} — ${i.name}` : i.name,
                }))}
              />
            </Col>
            <Col xs={24} md={4}>
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }} allowClear
                placeholder="كل المخازن" value={warehouseId} onChange={setWarehouseId}
                options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))}
              />
            </Col>
          </>
        ) : (
          <>
            <Col xs={24} md={4}>
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }} allowClear
                placeholder="الحساب الرئيسي" value={mainKey}
                onChange={(v) => { setMainKey(v); setAccountId(undefined); }}
                options={mainOptions}
              />
            </Col>
            <Col xs={24} md={8}>
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }}
                placeholder={mainKey ? 'الكل (كشف مجمّع) — أو اختر حساباً' : 'اختر الحساب'}
                value={accountId} onChange={setAccountId} allowClear
                options={visibleAccounts.map((a: any) => ({ value: a.id, label: labelOf(a) }))}
              />
            </Col>
          </>
        )}
        <Col xs={24} md={6}>
          <DatePicker.RangePicker
            style={{ width: '100%' }} value={range as any} allowClear
            onChange={(v) => setRange(v as any)} placeholder={['من تاريخ', 'إلى تاريخ']}
          />
        </Col>
        <Col xs={24} md={4}>
          <Input allowClear prefix={<SearchOutlined />} placeholder="بحث في الكشف"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </Col>
        <Col xs={24} md={4}>
          <Select
            mode="multiple" showSearch optionFilterProp="label" style={{ width: '100%' }}
            allowClear maxTagCount="responsive"
            placeholder="نوع الحركة" value={typeFilter} onChange={setTypeFilter}
            options={typeOptions} disabled={!typeOptions.length}
          />
        </Col>
        <Col xs={24} md={4}>
          <Select
            showSearch optionFilterProp="label" style={{ width: '100%' }} allowClear
            placeholder="المندوب" value={repFilter} onChange={setRepFilter}
            options={repOptions}
            disabled={!repOptions.length}
          />
        </Col>
      </Row>

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
              <Button size="small" onClick={() => setRange(null)}>مسح الفترة</Button>
            )}
            <Checkbox checked={exactMatch}
              onChange={(e) => setExactMatch(e.target.checked)}>تطابق تام</Checkbox>
            <Checkbox checked={hideZero}
              onChange={(e) => setHideZero(e.target.checked)}>إخفاء الحركات الصفرية</Checkbox>
          </Space>
        </Col>
      </Row>

      {((isItem && !itemId) || (!isItem && !accountId && !mainKey)) && (
        <Empty description={isItem ? 'اختر صنفاً لعرض كشفه'
          : 'اختر حساباً — أو حساباً رئيسياً بس لكشف مجمّع لكل اللي تحته'} />
      )}

      {statement && (
        <>
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={isItem ? 'رصيد أول المدة' : 'رصيد أول المدة (الحساب كله)'}
                  value={num(statement.opening_balance)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={repFilter ? `${LABELS.debit} — ${repFilter}` : `إجمالي ${LABELS.debit}`}
                  value={num(repFilter
                    ? shownLines.reduce((t, l) => t + Number(l.debit || 0), 0)
                    : statement.total_debit)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={repFilter ? `${LABELS.credit} — ${repFilter}` : `إجمالي ${LABELS.credit}`}
                  value={num(repFilter
                    ? shownLines.reduce((t, l) => t + Number(l.credit || 0), 0)
                    : statement.total_credit)} />
              </Card>
            </Col>
            <Col xs={12} md={3}>
              <Card size="small">
                <Statistic title="رصيد الحركة"
                  value={num(Number(statement.total_debit || 0) - Number(statement.total_credit || 0))} />
              </Card>
            </Col>
            <Col xs={12} md={3}>
              <Card size="small">
                <Statistic title={`الرصيد — ${statement.account_name}`}
                  value={num(statement.closing_balance)}
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
              description={`${shownLines.length} حركة من إجمالي ${lines.length}. `
                + 'الرصيد أول وآخر المدة للحساب كله — والعمود «تراكمي المعروض» هو اللي بيمشي '
                + 'مع السطور اللي قدامك.'}
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
            rowKey={rowKeyOf}
            size="small" loading={loading} dataSource={shownLines}
            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
            pagination={{ defaultPageSize: 25, showSizeChanger: true }}
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
              const di = cols.findIndex((c: any) => c.dataIndex === 'debit');
              const ci = cols.findIndex((c: any) => c.dataIndex === 'credit');
              if (di < 0 || ci < 0) return null;
              return (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={di + 1}><b>الإجمالي</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={1}><b>{num(td)}</b></Table.Summary.Cell>
                  {ci > di + 1 && <Table.Summary.Cell index={2} colSpan={ci - di - 1} />}
                  <Table.Summary.Cell index={3}><b>{num(tc)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} colSpan={Math.max(1, cols.length - ci)} />
                </Table.Summary.Row>
              );
            }}
          />
        </>
      )}
    </Card>
  );
}

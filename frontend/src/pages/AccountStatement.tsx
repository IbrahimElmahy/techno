import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank, compareArabic } from '../utils/arabicSort';
import {
  Alert, Button, Checkbox, Descriptions, Empty, Input, Select,
  Space, Spin, Tag, message,
} from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import {
  DownloadOutlined, LinkOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined,
  FileSearchOutlined, ClearOutlined,
} from '@ant-design/icons';
import ListPage from '../components/ListPage';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useOnScreen, useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import DocumentLink, { DocKind, docKindOf, useOpenDocument } from '../components/DocumentLink';
import { entryTypeLabel } from '../components/labels';
import JournalEntryLines from '../components/JournalEntryLines';
import DocumentItemLines, { hasItemLines } from '../components/DocumentItemLines';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import StatementFilter, { statementMatches } from '../components/StatementFilter';
import { normalizeAr } from '../components/ListToolbar';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { type PrintColumn } from '../print/reportSheet';
import { printStatement } from '../print/statementSheet';
import './AccountStatement.css';

import { money, numeralsLocale } from '../utils/money';
import { runningTotals } from '../utils/statementOrder';
type Subject = 'account' | 'item';

interface StatementLine {
  doc_kind?: DocKind | null;
  doc_id?: number | null;
  doc_number?: string | null;
  entry_id: number;
  entry_date: string;
  entry_type: string;
  description: string;
  doc_statement?: string | null;
  debit: string;
  credit: string;
  balance_before: string;
  balance: string;
  rep_name?: string | null;
  store_name?: string | null;
  cash_on_invoice?: boolean;
  doc_family?: string | null;
  voucher_kind?: string | null;
  invoice_type?: string;
  cost_center_name?: string | null;
  account_id?: number | null;
  account_name?: string | null;
  raw?: any;
  _serial?: number;
  line_id?: number | null;
  residual?: string | null;
  due_date?: string | null;
  days_overdue?: number | null;
  payment_state?: string | null;
  payment_state_label?: string | null;
  matches?: StatementMatch[];
  account_balance?: string | null;
  account_balance_before?: string | null;
  balance_debit?: string;
  balance_credit?: string;
  _opening?: boolean;
  _key?: string;
  _running?: number;
}

interface AccountSummary {
  account_id: number;
  account_name: string;
  code?: string | null;
  normal_side: 'debit' | 'credit' | string;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
  lines: number;
}

interface StatementMatch {
  line_id: number;
  entry_id: number | null;
  entry_number: string | null;
  entry_type: string | null;
  entry_date: string | null;
  amount: string;
  full: boolean;
}

interface Aging {
  current: string; d30: string; d60: string; d90: string; older: string; total: string;
  debit_open?: string; credit_open?: string;
}

interface StatementOut {
  account_id: number;
  account_name: string;
  main_account_name?: string | null;
  opening_balance: string;
  closing_balance: string;
  total_debit: string;
  total_credit: string;
  lines: StatementLine[];
  total_due?: string;
  total_overdue?: string;
  aging?: Aging;
  reconcilable?: boolean;
  families?: { family: string | null; account_id: number; balance: string }[];
  customer_id?: number | null;
  normal_side?: 'debit' | 'credit' | string | null;
  account_summaries?: AccountSummary[];
}

function splitBalance(v: unknown, side?: string | null): [string, string] {
  const d = (side === 'credit' ? -1 : 1) * Number(v || 0);
  if (Math.abs(d) < 0.005) return ['0', ''];
  return d > 0 ? [d.toFixed(2), ''] : ['', (-d).toFixed(2)];
}

const asDebit = (v: unknown, side?: string | null) => (side === 'credit' ? -1 : 1) * Number(v || 0);

const lineKey = (l: StatementLine) => `${l.entry_id}-${l.entry_date}-${l.balance}`;

const PAYMENT = 'دفعة';
const VOUCHER_TYPE: Record<string, string> = {
  receipt: PAYMENT, payment: PAYMENT,
  rep_handover: 'توريد', expense: 'مصروف', cash_transfer: 'تحويل',
  partner_withdraw: 'سحب شريك', partner_deposit: 'إيداع شريك',
};

function invoiceTypeOf(l: StatementLine): string {
  if (l.cash_on_invoice) return PAYMENT;
  switch (String(l.doc_kind ?? '')) {
    case 'invoice': return l.doc_family || 'بيع';
    case 'purchase': return l.doc_family || 'شراء';
    case 'return':
    case 'purchase_return': return 'مرتجع';
    case 'voucher': return VOUCHER_TYPE[l.voucher_kind ?? ''] ?? PAYMENT;
    default: break;
  }
  if (l.entry_type === 'receipt' || l.entry_type === 'payment') return PAYMENT;
  if (['sale_return', 'sales_return', 'purchase_return'].includes(l.entry_type)) return 'مرتجع';
  if (l.entry_type === 'sales_invoice') return 'بيع';
  if (l.entry_type === 'purchase_invoice') return 'شراء';
  if (!l.entry_type || l.entry_type === 'journal') return 'قيد';
  return entryTypeLabel(l.entry_type);
}

const SERIAL_RE = /\s*\b(?:[A-Z]{1,4}-)?[A-Z]{1,6}-?\d{3,}\b/g;
function stripSerial(desc: string | null | undefined, docNumber?: string | null): string {
  let s = String(desc ?? '');
  if (docNumber) s = s.split(docNumber).join('');
  s = s.replace(SERIAL_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([—،:])/g, ' $1').trim();
  return s || '-';
}

function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let cur = el?.parentElement ?? null; cur; cur = cur.parentElement) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === 'auto' || oy === 'scroll') return cur;
  }
  return null;
}

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
    st: search.get('st') || '',
    x: search.get('x') === '1',
    z: search.get('z') === '1',
    all: search.get('all') !== '0',
  };
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState<number | undefined>(u0.account);
  const [mainKey, setMainKey] = useState<string | undefined>(u0.main);
  const [subject, setSubject] = useState<Subject>(u0.subject);
  const [items, setItems] = useState<any[]>([]);
  const [itemId, setItemId] = useState<number | undefined>(u0.item);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | undefined>(u0.wh);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(
    u0.from && u0.to ? [dayjs(u0.from), dayjs(u0.to)] : null,
  );
  const [expandedKeys, setExpandedKeys] = useState<readonly React.Key[]>([]);
  const [showStock, setShowStock] = useState(false);
  const [groupBy, setGroupBy] = useState<'none' | 'month' | 'type' | 'account'>('none');
  const [openSections, setOpenSections] = useState<readonly React.Key[]>([]);
  const [entryCache, setEntryCache] = useState<Record<number, any>>({});
  const [entryBusy, setEntryBusy] = useState<Record<number, boolean>>({});
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [statement, setStatement] = useState<StatementOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [allCustomerAccounts, setAllCustomerAccounts] = useState<boolean>(u0.all);
  const [accountsReady, setAccountsReady] = useState(false);

  useEffect(() => {
    api.get('/api/v1/accounts')
      .then((r) => setAccounts(r.data || []))
      .catch(console.error)
      .finally(() => setAccountsReady(true));
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
      if (!accountId && !accountsReady) return;
      setLoading(true);
      try {
        const params: any = {};
        const r = fullRange();
        if (r) {
          params.date_from = r[0].format('YYYY-MM-DD');
          params.date_to = r[1].format('YYYY-MM-DD');
        }
        let res;
        if (accountId) {
          if (allCustomerAccounts) params.all_customer_accounts = true;
          res = await api.get(`/api/v1/accounts/${accountId}/statement`, { params });
        } else {
          const { roots, group } = rootsOf(mainKey!);
          const ids = [...new Set([...roots, ...(group
            ? accounts.filter((a: any) => a.owner_group === group).map((a: any) => a.id) : [])])];
          if (!ids.length) { setStatement(null); return; }
          params.root_ids = ids;
          res = await api.get('/api/v1/accounts-group/statement', {
            params, paramsSerializer: { indexes: null },
          });
          if (!roots.length && group) res = { ...res, data: { ...res.data, account_name: group } };
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
      const r = fullRange();
      if (r) {
        params.date_from = r[0].format('YYYY-MM-DD');
        params.date_to = r[1].format('YYYY-MM-DD');
      }
      if (warehouseId) {
        params.location_kind = 'warehouse';
        params.location_id = warehouseId;
      }
      const res = await api.get(`/api/v1/items/${itemId}/card`, { params });
      const d = res.data || {};
      setStatement({
        account_id: itemId,
        account_name: `${d.item_name ?? ''}`,
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

  useEffect(() => { load(); }, [subject, accountId, mainKey, itemId, warehouseId, range,
    allCustomerAccounts, accountsReady]);

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
  const branchOfCode = (code?: string | null) => (!code ? '' : code.startsWith('AL-') ? 'العلياء'
    : code.startsWith('FC-') ? 'السادات' : code.startsWith('A5') ? 'أكتوبر' : '');
  const accountOption = (a: any) => ({
    value: a.id, label: a.name || a.owner_name || `حساب #${a.id}`,
    search: a.code || '', code: a.code || '', title: a.name || a.owner_name || `حساب #${a.id}`,
  });
  const renderAccountOption = (o: any) => (
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
  );

  const mainGroups = useMemo(() => {
    const map = new Map<string, { roots: number[]; group?: string }>();
    accounts.filter((a: any) => !a.parent_id && a.code).forEach((a: any) => {
      const name = (a.name || a.owner_name || `#${a.id}`).trim();
      const g = map.get(name) ?? { roots: [] };
      g.roots.push(a.id);
      map.set(name, g);
    });
    accounts.filter((a: any) => !a.parent_id && !a.code && a.owner_group).forEach((a: any) => {
      const name = String(a.owner_group).trim();
      const alias = name === 'الموردين' && map.has('الموردون') ? 'الموردون' : name;
      const g = map.get(alias) ?? { roots: [] };
      g.group = name;
      map.set(alias, g);
    });
    return map;
  }, [accounts]);
  const mainOptions = useMemo(() => [...mainGroups.entries()]
    .map(([name, g]) => ({
      value: `nm:${name}`, label: name, search: '', code: '',
      title: g.roots.length > 1 ? `${name} — ${g.roots.length} فروع` : name,
    })), [mainGroups]);
  const rootsOf = (key: string): { roots: number[]; group?: string } => {
    if (key.startsWith('nm:')) return mainGroups.get(key.slice(3)) ?? { roots: [] };
    if (key.startsWith('grp:')) return { roots: [], group: key.slice(4) };
    return { roots: [Number(key.slice(4))] };
  };

  const visibleAccounts = useMemo(() => {
    if (!mainKey) return accounts;
    const { roots, group } = rootsOf(mainKey);
    const rootSet = new Set(roots);
    const byId = new Map<number, any>(accounts.map((a: any) => [a.id, a]));
    const inTree = (a: any) => {
      if (group && a.owner_group === group) return true;
      let cur: any = a;
      for (let hops = 0; cur && hops < 12; hops += 1) {
        if (rootSet.has(cur.id)) return true;
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
      return false;
    };
    return accounts.filter(inTree);
  }, [accounts, mainKey, mainGroups]); // eslint-disable-line react-hooks/exhaustive-deps
  const subOptions = useMemo(() => {
    const base = visibleAccounts.map(accountOption);
    const count = new Map<string, number>();
    base.forEach((o) => count.set(o.label, (count.get(o.label) ?? 0) + 1));
    const withBranch = base.map((o) => (count.get(o.label)! > 1 && branchOfCode(o.code)
      ? { ...o, label: `${o.label} — ${branchOfCode(o.code)}` } : o));
    const again = new Map<string, number>();
    withBranch.forEach((o) => again.set(o.label, (again.get(o.label) ?? 0) + 1));
    return withBranch.map((o) => (again.get(o.label)! > 1 && o.code
      ? { ...o, label: `${o.label} (${o.code})` } : o));
  }, [visibleAccounts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!accountId || mainKey || !accounts.length) return;
    const chosen = accounts.find((a: any) => a.id === accountId);
    if (!chosen) return;
    const nameOfGroup = (g: string) => [...mainGroups.entries()].find(([, v]) => v.group === g)?.[0];
    if (chosen.owner_group && !chosen.code) {
      const n = nameOfGroup(chosen.owner_group);
      setMainKey(n ? `nm:${n}` : `grp:${chosen.owner_group}`);
      return;
    }
    const byId = new Map<number, any>(accounts.map((a: any) => [a.id, a]));
    let cur: any = chosen;
    for (let hops = 0; cur?.parent_id && hops < 12; hops += 1) cur = byId.get(cur.parent_id);
    if (cur && cur.id !== chosen.id) setMainKey(`nm:${(cur.name || cur.owner_name || `#${cur.id}`).trim()}`);
  }, [accountId, accounts, mainKey]);

  const lines: StatementLine[] = statement?.lines ?? [];
  const customerFamilies = subject === 'account' && accountId ? (statement?.families ?? []) : [];
  const multiAccount = new Set(lines.map((l) => l.account_id).filter(Boolean)).size > 1;
  const summaries: AccountSummary[] = statement?.account_summaries ?? [];
  const multiScope = subject === 'account' && (grouped || multiAccount || summaries.length > 1);
  const groupMode = groupBy === 'account' && !multiScope ? 'none' : groupBy;
  const stmtSide = statement?.normal_side ?? 'debit';

  const [repFilter, setRepFilter] = useState<string | undefined>(u0.rep);
  const [query, setQuery] = useState(u0.q);
  const [typeFilter, setTypeFilter] = useState<string[]>(() => [...new Set(u0.types.map((t: string) => entryTypeLabel(t)))]);
  const [ccFilter, setCcFilter] = useState<string[]>(u0.cc);
  const [docNo, setDocNo] = useState(u0.doc);
  const [stmtQ, setStmtQ] = useState(u0.st);
  const [exactMatch, setExactMatch] = useState(u0.x);
  const [hideZero, setHideZero] = useState(u0.z);

  const abc = (a: { label: string }, b: { label: string }) => compareArabic(a.label, b.label);
  const repOptions = [...new Set(lines.map((l) => l.rep_name).filter(Boolean))]
    .map((r) => ({ value: r as string, label: r as string })).sort(abc);
  const typeOptions = [...new Set(lines.filter((l) => l.entry_type).map((l) => entryTypeLabel(l.entry_type)))]
    .map((t) => ({ value: t, label: t })).sort(abc);
  const ccOptions = [...new Set(lines.map((l) => l.cost_center_name).filter(Boolean))]
    .map((c) => ({ value: c as string, label: c as string })).sort(abc);

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
  const fullRange = (): [Dayjs, Dayjs] | null =>
    (range && range[0] && range[1] ? [range[0], range[1]] : null);

  const presetActive = (p: { get: () => [Dayjs, Dayjs] }) => {
    const r = fullRange();
    if (!r) return false;
    const [s, e] = p.get();
    return r[0].isSame(s, 'day') && r[1].isSame(e, 'day');
  };

  const urlShown = useOnScreen();
  useEffect(() => {
    if (!urlShown) return;
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
    if (stmtQ.trim()) p.set('st', stmtQ.trim());
    if (exactMatch) p.set('x', '1');
    if (hideZero) p.set('z', '1');
    if (!allCustomerAccounts) p.set('all', '0');
    setSearch(p, { replace: true });
  }, [subject, accountId, mainKey, itemId, warehouseId, range, repFilter, typeFilter,
    ccFilter, query, docNo, stmtQ, exactMatch, hideZero, allCustomerAccounts, setSearch, urlShown]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      message.success('تم نسخ رابط الكشف');
    } catch {
      message.error('تعذر النسخ — انسخ العنوان من شريط العناوين');
    }
  };

  const shownLines = useMemo(() => {
    const qRaw = query.trim();
    const q = normalizeAr(qRaw).toLowerCase();
    const dRaw = docNo.trim();
    const d = normalizeAr(dRaw).toLowerCase();
    return lines.filter((l) => {
      if (repFilter && l.rep_name !== repFilter) return false;
      if (typeFilter.length && !typeFilter.includes(entryTypeLabel(l.entry_type))) return false;
      if (ccFilter.length && !ccFilter.includes(l.cost_center_name ?? '')) return false;
      if (hideZero && !Number(l.debit || 0) && !Number(l.credit || 0)) return false;
      if (stmtQ.trim() && !statementMatches(stmtQ, l.description, l.doc_statement)) return false;
      if (dRaw) {
        const dn = normalizeAr(l.doc_number ?? '');
        if (exactMatch ? dn !== d : !dn.includes(d)) return false;
      }
      if (!q) return true;
      const haystacks = [l.description, l.doc_statement, l.doc_number, l.rep_name, l.store_name,
        l.cost_center_name,
        l.account_name, entryTypeLabel(l.entry_type)];
      return haystacks.some((v) => {
        const n = normalizeAr(v);
        return exactMatch ? n === q : n.includes(q);
      });
    })
      .map((l, i) => {
        const [bd, bc] = splitBalance(l.balance, stmtSide);
        return {
          ...l, _serial: i + 1, invoice_type: invoiceTypeOf(l), _key: lineKey(l),
          balance_debit: bd, balance_credit: bc,
        };
      });
  }, [lines, repFilter, typeFilter, ccFilter, hideZero, docNo, stmtQ, query, exactMatch, stmtSide]);

  const filtering = !!(repFilter || ccFilter.length || typeFilter.length
    || query.trim() || docNo.trim() || stmtQ.trim() || hideZero);
  const reconcilable = !!statement?.reconcilable;
  const aging = statement?.aging;
  const totalDue = Number(statement?.total_due || 0);
  const totalOverdue = Number(statement?.total_overdue || 0);
  const runningOf = useMemo(() => runningTotals(
    shownLines, (l) => l._key ?? lineKey(l)), [shownLines]);
  const openDoc = useOpenDocument();

  const anchorRef = useRef<HTMLSpanElement>(null);
  const onScreen = useOnScreen();
  const savedScroll = useRef(0);
  useLayoutEffect(() => {
    if (!onScreen) return undefined;
    const box = scrollParentOf(anchorRef.current);
    if (!box) return undefined;
    const top = savedScroll.current;
    const raf = requestAnimationFrame(() => { if (top) box.scrollTop = top; });
    const onScroll = () => { savedScroll.current = box.scrollTop; };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); box.removeEventListener('scroll', onScroll); };
  }, [onScreen]);

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

  const rowKeyOf = (l: StatementLine) => l._key ?? lineKey(l);

  const openingLine = (opening: unknown, side: string | null | undefined, key: string,
    account?: { id: number; name: string }): StatementLine => {
    const [bd, bc] = splitBalance(opening, side);
    return {
      entry_id: -1, entry_date: fullRange()?.[0].format('YYYY-MM-DD') ?? '', entry_type: '',
      description: 'رصيد أول المدة', debit: '', credit: '',
      balance_before: String(opening ?? '0'), balance: String(opening ?? '0'),
      account_id: account?.id ?? null, account_name: account?.name ?? null,
      balance_debit: bd, balance_credit: bc, _opening: true, _key: key,
    };
  };
  const wantsOpening = (opening: unknown) => !!fullRange() || Math.abs(Number(opening || 0)) >= 0.005;

  const tableRows = useMemo(() => (statement && wantsOpening(statement.opening_balance)
    ? [...shownLines, openingLine(statement.opening_balance, stmtSide, 'opening')]
    : shownLines), [shownLines, statement, stmtSide, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => {
    if (groupMode !== 'account' || !statement) return [];
    const byAcct = new Map<number, StatementLine[]>();
    for (const l of shownLines) {
      const a = l.account_id ?? statement.account_id;
      if (!byAcct.has(a)) byAcct.set(a, []);
      byAcct.get(a)!.push(l);
    }
    return summaries
      .filter((s) => !filtering || byAcct.has(s.account_id))
      .map((s) => {
        const own = (byAcct.get(s.account_id) ?? []).map((l, i) => {
          const bal = l.account_balance ?? l.balance;
          const [bd, bc] = splitBalance(bal, s.normal_side);
          return {
            ...l, _serial: i + 1, balance: String(bal),
            balance_before: String(l.account_balance_before ?? l.balance_before),
            balance_debit: bd, balance_credit: bc,
          };
        });
        const run = runningTotals(own, rowKeyOf);
        const rows: StatementLine[] = own.map((l) => ({ ...l, _running: run.get(rowKeyOf(l)) ?? 0 }));
        if (wantsOpening(s.opening) || !rows.length) {
          rows.push(openingLine(s.opening, s.normal_side, `opening-${s.account_id}`,
            { id: s.account_id, name: s.account_name }));
        }
        return {
          key: `acct-${s.account_id}`, summary: s, rows, count: own.length,
          debit: filtering ? own.reduce((t, l) => t + Number(l.debit || 0), 0) : Number(s.debit),
          credit: filtering ? own.reduce((t, l) => t + Number(l.credit || 0), 0) : Number(s.credit),
        };
      });
  }, [groupMode, statement, shownLines, summaries, filtering, range]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOpenSections(sections.length && shownLines.length <= 400 ? sections.map((s) => s.key) : []);
  }, [groupMode, statement]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowTone = useMemo(() => {
    const m = new Map<string, string>();
    let prev: string | null = null;
    let odd = false;
    for (const l of shownLines) {
      const doc = l.doc_kind && l.doc_id ? `${l.doc_kind}:${l.doc_id}` : `e:${l.entry_id}`;
      if (prev !== null && doc !== prev) odd = !odd;
      prev = doc;
      const pay = l.invoice_type === PAYMENT && !l.cash_on_invoice;
      m.set(rowKeyOf(l), pay ? 'st-pay' : odd ? 'st-doc-b' : 'st-doc-a');
    }
    return m;
  }, [shownLines]);
  const rowClass = (l: StatementLine) => (l._opening ? 'st-opening' : [
    kb.rowClassName(l), l.days_overdue ? 'statement-overdue' : '', rowTone.get(rowKeyOf(l)) ?? '',
  ].filter(Boolean).join(' '));

  const toggleRow = (l: StatementLine) => {
    if (l._opening) return;
    const k = rowKeyOf(l);
    setExpandedKeys((keys) => (keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]));
    if (subject === 'account' && !hasItemLines(l.doc_kind)) loadEntry(l.entry_id);
  };

  useEffect(() => {
    if (showStock) setExpandedKeys(shownLines.map(rowKeyOf));
  }, [showStock, shownLines]);

  const kb = useTableKeyboard<StatementLine>({
    rows: shownLines,
    rowKey: rowKeyOf,
    onOpen: toggleRow,
  });

  const isItem = subject === 'item';
  const LABELS = isItem
    ? { debit: 'داخل', credit: 'خارج', before: 'الرصيد قبل', after: 'الرصيد بعد' }
    : { debit: 'مدين', credit: 'دائن', before: 'الرصيد قبل', after: 'الرصيد بعد' };
  const num = (v: any) => (isItem
    ? Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })
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
    ...(!isItem ? [{
      title: 'نوع الفاتورة', dataIndex: 'invoice_type', width: 110, align: 'center' as const,
      ...textColumn(shownLines as StatementLine[], (l: StatementLine) => l.invoice_type),
      render: (v: string | undefined) => (v ? (
        <Tag color={v === PAYMENT ? 'green' : v === 'بولي' ? 'purple'
          : v === 'مرتجع' ? 'orange' : v === 'أبيض' ? 'blue' : undefined}>{v}</Tag>
      ) : '-'),
    }] : []),
    ...(grouped || multiAccount ? [{
      title: 'الحساب الفرعي', dataIndex: 'account_name', width: 180, ellipsis: true,
      ...textColumn(lines, (l: StatementLine) => l.account_name),
      render: (v: string | null, l: StatementLine) => (l.account_id ? (
        <a onClick={() => openAccount(l.account_id!)}>{v ?? `#${l.account_id}`}</a>
      ) : (v ?? '-')),
    }] : []),
    { title: 'البيان', dataIndex: 'description',
      ...textColumn(lines, (l: StatementLine) => stripSerial(l.description, l.doc_number)),
      render: (v: string, l: StatementLine) => {
        const shown = stripSerial(v, l.doc_number);
        const text = l.cash_on_invoice ? <span style={{ color: '#389e0d' }}>{shown}</span> : shown;
        return l.doc_statement && l.doc_statement !== v && !l.cash_on_invoice ? (
          <Space direction="vertical" size={0}>
            <span>{text}</span>
            <span style={{ color: '#8c8c8c', fontSize: 14 }}>{l.doc_statement}</span>
          </Space>
        ) : text;
      } },
    { title: 'مندوب', dataIndex: 'rep_name', width: 140, ellipsis: true,
      ...textColumn(lines, (l: StatementLine) => l.rep_name),
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>-</span> },
    { title: 'المخزن', dataIndex: 'store_name', width: 150, ellipsis: true,
      ...textColumn(lines, (l: StatementLine) => l.store_name),
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
          {num(l._running ?? runningOf.get(rowKeyOf(l)) ?? 0)}
        </span>
      ),
    }] : []),
    { title: LABELS.after, dataIndex: 'balance', key: isItem ? 'qty_balance' : 'balance', align: 'left',
      ...numberColumn<StatementLine>((l) => l.balance),
      sorter: (a: StatementLine, b: StatementLine) => Number(a.balance) - Number(b.balance),
      render: (v: string) => <b>{num(v)}</b> },
    ...(!isItem ? [{
      title: 'رصيد مدين', dataIndex: 'balance_debit', align: 'left' as const,
      ...numberColumn<StatementLine>((l) => l.balance_debit),
      render: (v: string | undefined) => (v ? <b>{num(v)}</b> : <span style={{ color: '#8c8c8c' }}>-</span>),
    }, {
      title: 'رصيد دائن', dataIndex: 'balance_credit', align: 'left' as const,
      ...numberColumn<StatementLine>((l) => l.balance_credit),
      render: (v: string | undefined) => (v ? <b>{num(v)}</b> : <span style={{ color: '#8c8c8c' }}>-</span>),
    }] : []),
    ...(reconcilable ? [{
      title: 'المتبقّي',
      dataIndex: 'residual',
      align: 'left' as const,
      ...numberColumn<StatementLine>((l) => Math.abs(Number(l.residual || 0))),
      sorter: (a: StatementLine, b: StatementLine) =>
        Math.abs(Number(a.residual || 0)) - Math.abs(Number(b.residual || 0)),
      render: (_: unknown, l: StatementLine) => {
        const open = Math.abs(Number(l.residual || 0));
        if (l.residual === null || l.residual === undefined) return <span style={{ color: '#8c8c8c' }}>-</span>;
        if (!open) return <Tag color="green">مسدَّد</Tag>;
        return <b style={{ color: l.days_overdue ? '#cf1322' : '#b26a00' }}>{num(open)}</b>;
      },
    }, {
      title: 'الاستحقاق',
      key: 'due',
      align: 'center' as const,
      render: (_: unknown, l: StatementLine) => {
        if (!Number(l.residual || 0)) return <span style={{ color: '#8c8c8c' }}>-</span>;
        const due = l.due_date ? String(l.due_date).slice(0, 10) : String(l.entry_date || '').slice(0, 10);
        return (
          <Space direction="vertical" size={0}>
            <span>{due}</span>
            {!!l.days_overdue && <Tag color="red">متأخر {l.days_overdue} يوم</Tag>}
          </Space>
        );
      },
    }] : []),
    { title: 'المستند', key: 'doc', align: 'center',
      ...textColumn(lines, (l: StatementLine) => l.doc_number),
      render: (_: unknown, l: StatementLine) => (l.doc_kind && l.doc_id ? (
        <DocumentLink kind={l.doc_kind} id={l.doc_id} size="small"
          label={l.doc_number || undefined}
          allowEdit />
      ) : <span style={{ color: '#8c8c8c' }}>قيد يدوي</span>) },
  ];

  const withOpening = (cols: ColumnsType<StatementLine>): ColumnsType<StatementLine> =>
    cols.map((c: any) => {
      const key = String(c.key ?? c.dataIndex ?? '');
      const { render, sorter, onFilter } = c;
      return {
        ...c,
        render: (v: any, l: StatementLine, i: number) => {
          if (!l._opening) return render ? render(v, l, i) : v;
          switch (key) {
            case 'entry_date': return l.entry_date ? String(l.entry_date).slice(0, 10) : '';
            case 'description': return <b>{l.description}</b>;
            case 'account_name': return l.account_name ?? '';
            case 'balance': case 'qty_balance': return <b>{num(l.balance)}</b>;
            case 'balance_debit': case 'balance_credit': return render(v, l, i);
            default: return null;
          }
        },
        ...(typeof sorter === 'function' ? {
          sorter: (a: StatementLine, b: StatementLine, order?: any) => (
            a._opening ? -1 : b._opening ? 1 : sorter(a, b, order)),
        } : {}),
        ...(typeof onFilter === 'function' ? {
          onFilter: (value: any, l: StatementLine) => (l._opening ? true : onFilter(value, l)),
        } : {}),
      };
    });

  const exportRows = groupMode === 'account' ? sections.flatMap((s) => s.rows)
    : groupMode === 'none' ? tableRows : shownLines;
  const tableCols = useTableColumns('account-statement', withOpening(columns), {
    defaultHidden: ['balance'],
    export: { name: isItem ? 'كشف صنف' : 'كشف حساب', rows: exportRows },
  });

  const printColOf = (k: string): PrintColumn<StatementLine> | null => {
    switch (k) {
      case '_serial': return { title: 'رقم', value: (l) => l._serial ?? '' };
      case 'entry_date': return { title: 'التاريخ', value: (l) => String(l.entry_date || '').slice(0, 10) };
      case 'entry_type': return { title: 'النوع', value: (l) => entryTypeLabel(l.entry_type) };
      case 'invoice_type': return { title: 'نوع الفاتورة', value: (l) => l.invoice_type ?? '' };
      case 'account_name': return { title: 'الحساب الفرعي', value: (l) => l.account_name ?? '' };
      case 'description':
        return {
          title: 'البيان',
          value: (l) => (l.doc_statement && l.doc_statement !== l.description
            ? `${stripSerial(l.description, l.doc_number)} — ${l.doc_statement}`
            : stripSerial(l.description, l.doc_number)),
        };
      case 'rep_name': return { title: 'مندوب', value: (l) => l.rep_name ?? '' };
      case 'store_name': return { title: 'المخزن', value: (l) => l.store_name ?? '' };
      case 'cost_center_name': return { title: 'مركز التكلفة', value: (l) => l.cost_center_name ?? '' };
      case 'balance_before': return { title: LABELS.before, value: 'balance_before', numeric: true };
      case 'debit': return { title: LABELS.debit, value: 'debit', numeric: true };
      case 'credit': return { title: LABELS.credit, value: 'credit', numeric: true };
      case 'running':
        return {
          title: 'تراكمي المعروض',
          value: (l) => (l._opening ? '' : num(l._running ?? runningOf.get(rowKeyOf(l)) ?? 0)),
          numeric: true,
        };
      case 'balance': case 'qty_balance': return { title: LABELS.after, value: 'balance', numeric: true };
      case 'balance_debit': return { title: 'رصيد مدين', value: (l) => l.balance_debit ?? '', numeric: true };
      case 'balance_credit': return { title: 'رصيد دائن', value: (l) => l.balance_credit ?? '', numeric: true };
      case 'doc': return { title: 'المستند', value: (l) => l.doc_number ?? '' };
      case 'residual':
        return {
          title: 'المتبقّي',
          value: (l) => (l.residual === null || l.residual === undefined
            ? '' : num(Math.abs(Number(l.residual || 0)))),
          numeric: true,
        };
      case 'due':
        return {
          title: 'الاستحقاق',
          value: (l) => (Number(l.residual || 0)
            ? `${String(l.due_date || l.entry_date || '').slice(0, 10)}`
              + (l.days_overdue ? ` (متأخر ${l.days_overdue} يوم)` : '')
            : ''),
        };
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
    writeCsv(`statement-${statement.account_id}`, cols, exportRows);
  };

  const printIt = () => {
    if (!statement) return;
    const r = fullRange();
    const filters: [string, string][] = [
      ...(isItem && warehouseId
        ? [['المخزن', warehouses.find((w: any) => w.id === warehouseId)?.name ?? ''] as [string, string]]
        : []),
      ...(repFilter ? [['مندوب', repFilter] as [string, string]] : []),
      ...(ccFilter.length ? [['مركز التكلفة', ccFilter.join('، ')] as [string, string]] : []),
      ...(typeFilter.length
        ? [['نوع الحركة', typeFilter.join('، ')] as [string, string]] : []),
      ...(docNo.trim() ? [['رقم المستند', docNo.trim()] as [string, string]] : []),
      ...(stmtQ.trim() ? [['البيان', stmtQ.trim()] as [string, string]] : []),
      ...(query.trim()
        ? [[exactMatch ? 'بحث (تطابق تام)' : 'بحث', query.trim()] as [string, string]] : []),
      ...(hideZero ? [['عرض', 'بدون الحركات الصفرية'] as [string, string]] : []),
    ];
    const acct = accounts.find((a: any) => a.id === (statement.account_id ?? accountId));
    printStatement({
      title: isItem ? 'كشف صنف' : 'كشف حساب',
      account: statement.account_name ?? '',
      mainAccount: isItem || grouped ? null : statement.main_account_name ?? null,
      from: r ? r[0].format('YYYY/MM/DD') : null,
      to: r ? r[1].format('YYYY/MM/DD') : null,
      opening: statement.opening_balance,
      closing: statement.closing_balance,
      lines: shownLines,
      normalSide: acct?.normal_side === 'credit' ? 'credit' : 'debit',
      filtered: filtering,
      filters,
      quantity: isItem,
      showAccount: grouped || multiAccount,
      sections: groupMode === 'account' ? sections.map((s) => ({
        account: s.summary.account_name,
        opening: s.summary.opening,
        closing: s.summary.closing,
        normalSide: s.summary.normal_side === 'credit' ? 'credit' as const : 'debit' as const,
        lines: s.rows.filter((l) => !l._opening),
      })) : undefined,
      extra: reconcilable ? [
        ['إجمالي المستحق', money(totalDue)],
        ['منه متأخر', money(totalOverdue)],
        ...(aging ? [['أعمار المستحق',
          `الحالي ${money(aging.current)} · ٣٠ ${money(aging.d30)}`
          + ` · ٦٠ ${money(aging.d60)} · ٩٠ ${money(aging.d90)}`
          + ` · أقدم ${money(aging.older)}`] as [string, string]] : []),
      ] : undefined,
    });
  };

  const itemNameOf = (id: number) => {
    const it = items.find((x: any) => x.id === id);
    return it ? it.name : `صنف #${id}`;
  };
  const whName = (id: number | null | undefined) => {
    if (!id) return null;
    const w = warehouses.find((x: any) => x.id === id);
    return w ? w.name : `مخزن #${id}`;
  };

  const groups = useMemo(() => {
    if (groupBy !== 'month' && groupBy !== 'type') return [];
    const map = new Map<string, { key: string; label: string; rows: StatementLine[] }>();
    for (const l of shownLines) {
      const key = groupBy === 'month'
        ? String(l.entry_date || '').slice(0, 7)
        : String(l.entry_type || '');
      const label = groupBy === 'month'
        ? (key ? dayjs(`${key}-01`).format('MMMM YYYY') : 'بدون تاريخ')
        : entryTypeLabel(key);
      if (!map.has(key)) map.set(key, { key, label, rows: [] });
      map.get(key)!.rows.push(l);
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        debit: g.rows.reduce((t, l) => t + Number(l.debit || 0), 0),
        credit: g.rows.reduce((t, l) => t + Number(l.credit || 0), 0),
        overdue: g.rows.reduce((t, l) => t + (l.days_overdue ? Math.abs(Number(l.residual || 0)) : 0), 0),
      }))
      .sort((a, b) => (groupBy === 'month' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)));
  }, [shownLines, groupBy]);

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

  const matchBlock = (l: StatementLine) => {
    const rows = l.matches ?? [];
    if (!rows.length && !Number(l.residual || 0)) return null;
    const open = Math.abs(Number(l.residual || 0));
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 14, color: '#8c8c8c', marginBottom: 4 }}>
          المطابقة
          {l.payment_state_label && <Tag style={{ marginInlineStart: 6 }}
            color={l.payment_state === 'paid' ? 'green'
              : l.payment_state === 'partial' ? 'orange' : 'red'}>
            {l.payment_state_label}
          </Tag>}
        </div>
        {rows.length ? (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {rows.map((m) => (
              <div key={m.line_id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Tag color={m.full ? 'green' : 'orange'} style={{ margin: 0 }}>
                  {m.full ? 'مُقفل' : 'جزئي'}
                </Tag>
                <span style={{ color: '#8c8c8c' }}>{String(m.entry_date || '').slice(0, 10)}</span>
                <span>{m.entry_number || (m.entry_type ? entryTypeLabel(m.entry_type) : '—')}</span>
                <b style={{ marginInlineStart: 'auto' }}>{num(m.amount)}</b>
              </div>
            ))}
          </Space>
        ) : (
          <span style={{ color: '#8c8c8c' }}>لم يُقفل على شيء بعد</span>
        )}
        {!!open && (
          <div style={{ marginTop: 6 }}>
            ما زال مفتوحاً: <b style={{ color: l.days_overdue ? '#cf1322' : '#b26a00' }}>{num(open)}</b>
            {!!l.days_overdue && <Tag color="red" style={{ marginInlineStart: 6 }}>
              متأخر {l.days_overdue} يوم
            </Tag>}
          </div>
        )}
      </div>
    );
  };

  const rowDetail = (l: StatementLine) => {
    const head = (
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10,
      }}>
        <Tag>{entryTypeLabel(l.entry_type)}</Tag>
        <span style={{ color: '#8c8c8c' }}>{String(l.entry_date || '').slice(0, 10)}</span>
        <span>{stripSerial(l.description, l.doc_number)}</span>
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
          {matchBlock(l)}
        </div>
      );
    }

    if (isItem) {
      const r = l.raw || {};
      const facts: Array<[string, React.ReactNode]> = [];
      if (r.quantity_in_unit) facts.push(['الكمية بالوحدة', `${r.quantity_in_unit} ${r.unit ?? ''}`]);
      if (r.unit_price != null) facts.push(['سعر الوحدة', money(r.unit_price)]);
      if (r.discount_pct != null && Number(r.discount_pct)) {
        facts.push(['الخصم', `${Number(r.discount_pct).toLocaleString(numeralsLocale())}%`]);
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
            <span style={{ color: '#8c8c8c' }}>لا توجد لهذه الحركة تفاصيل زائدة عمّا في السطر</span>
          )}
          {matchBlock(l)}
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
        {matchBlock(l)}
      </div>
    );
  };

  const clearLineFilters = () => {
    setQuery(''); setTypeFilter([]); setRepFilter(undefined); setCcFilter([]);
    setDocNo(''); setStmtQ(''); setExactMatch(false); setHideZero(false);
  };

  const shownDebit = shownLines.reduce((t, l) => t + Number(l.debit || 0), 0);
  const shownCredit = shownLines.reduce((t, l) => t + Number(l.credit || 0), 0);

  const colKeyOf = (c: any) => String(c.key ?? c.dataIndex ?? '');
  const totalsRow = (label: React.ReactNode, vals: Record<string, React.ReactNode>) => {
    const keys = (tableCols.columns as any[]).map(colKeyOf);
    const first = keys.findIndex((k) => k in vals);
    if (first < 0) return null;
    return (
      <Table.Summary.Row>
        <Table.Summary.Cell index={0} colSpan={first + 1}><b>{label}</b></Table.Summary.Cell>
        {keys.slice(first).map((k, i) => (
          <Table.Summary.Cell key={k || `c${i}`} index={first + 1 + i}>
            {k in vals ? <b>{vals[k]}</b> : null}
          </Table.Summary.Cell>
        ))}
      </Table.Summary.Row>
    );
  };
  const totalsVals = (debit: number, credit: number, closing: unknown, side?: string | null) => {
    const [bd, bc] = splitBalance(closing, side);
    return {
      debit: num(debit), credit: num(credit), balance: num(closing), qty_balance: num(closing),
      ...(isItem ? {} : { balance_debit: bd ? num(bd) : '-', balance_credit: bc ? num(bc) : '-' }),
    };
  };
  const worded = (v: unknown, side?: string | null) => {
    const d = asDebit(v, side);
    if (Math.abs(d) < 0.005) return num(0);
    return `${num(Math.abs(d))} ${d > 0 ? 'مدين' : 'دائن'}`;
  };

  const summaryLine: React.CSSProperties = {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px',
    padding: '8px 4px', borderBottom: '1px solid #f1f5f9',
  };

  return (
    <ListPage<Subject>
      icon={<FileSearchOutlined />}
      title={isItem ? 'كشف صنف' : 'كشف حساب'}
      muted={statement?.account_name ? `(${statement.account_name})` : undefined}
      tabs={[
        { key: 'account', label: 'كشف حساب' },
        { key: 'item', label: 'كشف صنف' },
      ]}
      activeTab={subject}
      onTabChange={(v) => {
        if (v === subject) return;
        setSubject(v);
        setAccountId(undefined); setItemId(undefined);
        setWarehouseId(undefined); setStatement(null);
      }}
      actions={(<>
        <Button icon={<PrinterOutlined />} onClick={printIt}
          disabled={!statement?.lines?.length}>طباعة</Button>
        <Button icon={<DownloadOutlined />} onClick={exportCsv}
          disabled={!statement?.lines?.length}>تصدير CSV</Button>
        {tableCols.control}
        <Button icon={<LinkOutlined />} onClick={copyLink}
          disabled={!statement?.lines?.length}>نسخ الرابط</Button>
        <Button icon={<ReloadOutlined />} onClick={load}
          disabled={isItem ? !itemId : (!accountId && !mainKey)}>تحديث</Button>
      </>)}
      filters={(<>
        {isItem ? (<>
          <Select
            className="sl-f-customer"
            showSearch
            placeholder="اختر الصنف" value={itemId} onChange={setItemId}
            options={items.map((i: any) => ({
              value: i.id,
              label: i.name, search: i.code || '',
            })).sort(abc)} filterOption={searchFilter} filterSort={searchRank}/>
          <Select
            showSearch allowClear
            placeholder="كل المخازن" value={warehouseId} onChange={setWarehouseId}
            options={warehouses.map((w: any) => ({ value: w.id, label: w.name })).sort(abc)} filterOption={searchFilter} filterSort={searchRank}/>
        </>) : (<>
          <Select
            className="sl-f-account"
            showSearch allowClear
            placeholder="الحساب الرئيسي" value={mainKey}
            onChange={(v) => { setMainKey(v); setAccountId(undefined); }}
            popupMatchSelectWidth={false} popupClassName="sl-account-popup" optionRender={renderAccountOption}
            options={mainOptions} filterOption={searchFilter} filterSort={searchRank}/>
          <Select
            className="sl-f-account"
            showSearch
            placeholder={mainKey ? 'الكل (كشف مجمّع) — أو اختر حساباً' : 'اختر الحساب'}
            value={accountId} onChange={setAccountId} allowClear
            popupMatchSelectWidth={false} popupClassName="sl-account-popup" optionRender={renderAccountOption}
            options={subOptions} filterOption={searchFilter} filterSort={searchRank}/>
        </>)}
        <DateRangeFilter
          className="sl-f-dates"
          value={range as any}
          onChange={(v) => setRange(v as any)}
        />
        <Input className="sl-f-search" allowClear prefix={<SearchOutlined />} placeholder="بحث في الكشف"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select
          mode="multiple" showSearch
          allowClear maxTagCount="responsive"
          placeholder="نوع الحركة" value={typeFilter} onChange={setTypeFilter}
          options={typeOptions} disabled={!typeOptions.length && !typeFilter.length} filterOption={searchFilter} filterSort={searchRank}/>
        <Select
          className="sl-f-rep"
          showSearch allowClear popupMatchSelectWidth={false}
          placeholder="المندوب" value={repFilter} onChange={setRepFilter}
          options={repOptions}
          disabled={!repOptions.length && !repFilter} filterOption={searchFilter} filterSort={searchRank}/>
        <Select
          mode="multiple" showSearch
          allowClear maxTagCount="responsive"
          placeholder="مركز التكلفة" value={ccFilter} onChange={setCcFilter}
          options={ccOptions} disabled={!ccOptions.length && !ccFilter.length} filterOption={searchFilter} filterSort={searchRank}/>
        <Input allowClear prefix={<SearchOutlined />} placeholder="رقم المستند"
          value={docNo} onChange={(e) => setDocNo(e.target.value)} />
        <span className="sl-f-stmt"><StatementFilter value={stmtQ} onChange={setStmtQ} /></span>
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={clearLineFilters}
          disabled={!filtering && !exactMatch}>مسح</Button>
      </>)}
    >
      <span ref={anchorRef} style={{ display: 'none' }} />
      <div style={{ ...summaryLine, gap: '6px 8px' }}>
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
        {customerFamilies.length > 1 && (
          <Checkbox checked={allCustomerAccounts}
            onChange={(e) => setAllCustomerAccounts(e.target.checked)}>
            كل حسابات العميل
            {' '}
            <span style={{ color: '#8c8c8c', fontSize: 14 }}>
              ({customerFamilies.map((f) => `${f.family ?? 'بدون نوع'} ${money(f.balance)}`)
                .join(' · ')})
            </span>
          </Checkbox>
        )}
        {statement && (<>
          <Checkbox checked={showStock} onChange={(e) => {
            const on = e.target.checked;
            setShowStock(on);
            if (!on) setExpandedKeys([]);
          }}>
            حركة مخزنية — عرض أصناف كل المستندات
          </Checkbox>
          <span style={{ marginInlineStart: 'auto', color: '#8c8c8c' }}>تجميع:</span>
          <Select size="small" style={{ width: 170 }} value={groupMode}
            onChange={(v) => setGroupBy(v)}
            options={[
              { value: 'none', label: 'بدون تجميع' },
              { value: 'month', label: 'بالشهر' },
              { value: 'type', label: 'بنوع الحركة' },
              ...(multiScope ? [{ value: 'account' as const, label: 'بالحساب الفرعي' }] : []),
            ]} />
          {groupMode === 'account' && sections.length > 1 && (<>
            <Button size="small" onClick={() => setOpenSections(sections.map((s) => s.key))}>توسيع الكل</Button>
            <Button size="small" onClick={() => setOpenSections([])}>طي الكل</Button>
          </>)}
        </>)}
      </div>

      {((isItem && !itemId) || (!isItem && !accountId && !mainKey)) && (
        <Empty style={{ padding: '32px 0' }} description={isItem ? 'اختر صنفاً لعرض كشفه'
          : 'اختر حساباً أو حساباً رئيسياً'} />
      )}

      {statement && (
        <>
          <div style={summaryLine}>
            <span className="sl-foot">
              <span>{isItem ? 'رصيد أول المدة' : 'رصيد أول المدة (الحساب كله)'}:{' '}
                <b>{num(statement.opening_balance)}</b></span>
              <span>{filtering ? `${LABELS.debit} (المعروض)` : `إجمالي ${LABELS.debit}`}:{' '}
                <b>{num(filtering ? shownDebit : statement.total_debit)}</b></span>
              <span>{filtering ? `${LABELS.credit} (المعروض)` : `إجمالي ${LABELS.credit}`}:{' '}
                <b>{num(filtering ? shownCredit : statement.total_credit)}</b></span>
              <span>رصيد الحركة:{' '}
                <b>{num(Number(statement.total_debit || 0) - Number(statement.total_credit || 0))}</b></span>
              <span>الرصيد — {statement.account_name}:{' '}
                <b style={{ color: '#0B5CA8', fontSize: 15 }}>{num(statement.closing_balance)}</b></span>
            </span>
          </div>

          {reconcilable && (
            <div style={summaryLine}>
              <span className="sl-foot">
                <span>إجمالي المستحق:{' '}
                  <b style={{ color: totalDue ? '#0B5CA8' : undefined }}>{num(totalDue)}</b></span>
                <span>منه متأخر:{' '}
                  <b className={totalOverdue ? 'is-neg' : 'is-pos'}>{num(totalOverdue)}</b></span>
              </span>
              <Space size={4} wrap>
                <span style={{ fontSize: 14, color: '#8c8c8c' }}>أعمار المستحق:</span>
                {([
                  ['الحالي', aging?.current, '#52c41a'],
                  ['١–٣٠ يوم', aging?.d30, '#faad14'],
                  ['٣١–٦٠', aging?.d60, '#fa8c16'],
                  ['٦١–٩٠', aging?.d90, '#f5222d'],
                  ['أقدم من ٩٠', aging?.older, '#a8071a'],
                ] as [string, string | undefined, string][]).map(([label, value, color]) => (
                  <Tag key={label} color={Number(value || 0) ? color : undefined}
                    style={{ margin: 0 }}>
                    {label}: <b>{num(value || 0)}</b>
                  </Tag>
                ))}
              </Space>
              {Number(aging?.credit_open || 0) > 0 && (
                <span style={{ fontSize: 14, color: '#8c8c8c' }}>
                  مطلوب <b>{num(aging?.debit_open || 0)}</b> ·
                  دفعات لم تُخصم بعد من فاتورة <b>{num(aging?.credit_open || 0)}</b> ·
                  الصافي هو المستحق
                </span>
              )}
              {!totalDue && (
                <span style={{ fontSize: 14, color: '#8c8c8c' }}>
                  لا يوجد مستحق مفتوح على هذا الحساب.
                </span>
              )}
            </div>
          )}


          {groupMode === 'account' ? (
            <Table
              className="sl-table"
              size="small" loading={loading} rowKey="key" dataSource={sections}
              pagination={false} autoFilters={false}
              locale={{ emptyText: 'لا توجد حسابات بحركة أو رصيد في هذه الفترة' }}
              columns={[
                { title: 'الحساب الفرعي', key: 'acct',
                  render: (_: unknown, s: any) => <b>{s.summary.account_name}</b> },
                { title: 'عدد الحركات', key: 'count', align: 'center',
                  render: (_: unknown, s: any) => s.count },
                { title: 'رصيد أول المدة', key: 'opening', align: 'left',
                  render: (_: unknown, s: any) => worded(s.summary.opening, s.summary.normal_side) },
                { title: LABELS.debit, key: 'debit', align: 'left',
                  render: (_: unknown, s: any) => num(s.debit) },
                { title: LABELS.credit, key: 'credit', align: 'left',
                  render: (_: unknown, s: any) => num(s.credit) },
                { title: 'رصيد مدين', key: 'close_d', align: 'left',
                  render: (_: unknown, s: any) => {
                    const [d] = splitBalance(s.summary.closing, s.summary.normal_side);
                    return d ? <b>{num(d)}</b> : <span style={{ color: '#8c8c8c' }}>-</span>;
                  } },
                { title: 'رصيد دائن', key: 'close_c', align: 'left',
                  render: (_: unknown, s: any) => {
                    const [, c] = splitBalance(s.summary.closing, s.summary.normal_side);
                    return c ? <b>{num(c)}</b> : <span style={{ color: '#8c8c8c' }}>-</span>;
                  } },
              ]}
              expandable={{
                expandedRowKeys: openSections,
                onExpandedRowsChange: (keys) => setOpenSections(keys),
                expandedRowRender: (s: any) => (
                  <Table<StatementLine>
                    className="st-table"
                    rowKey={rowKeyOf} size="small" dataSource={s.rows}
                    pagination={s.rows.length > PAGE_SIZE ? {
                      defaultPageSize: PAGE_SIZE, showSizeChanger: true, locale: { items_per_page: '' },
                    } : false}
                    scroll={{ x: 'max-content' }}
                    columns={tableCols.columns}
                    rowClassName={rowClass}
                    onRow={(l) => ({ onClick: (e) => {
                      const t = e.target as HTMLElement | null;
                      if (t?.closest?.('a, button, input, .ant-select, .ant-checkbox')) return;
                      toggleRow(l);
                    } })}
                    expandable={{
                      expandedRowKeys: expandedKeys,
                      onExpand: (_open, l) => toggleRow(l),
                      expandedRowRender: rowDetail,
                      rowExpandable: (l) => !l._opening,
                    }}
                    summary={() => totalsRow(`إجمالي ${s.summary.account_name}`,
                      totalsVals(s.debit, s.credit, s.summary.closing, s.summary.normal_side))}
                  />
                ),
              }}
              summary={() => {
                const open = sections.reduce((t, s) => t + asDebit(s.summary.opening, s.summary.normal_side), 0);
                const close = sections.reduce((t, s) => t + asDebit(s.summary.closing, s.summary.normal_side), 0);
                const [cd, cc] = splitBalance(close, 'debit');
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2}><b>الإجمالي</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="center">
                      <b>{sections.reduce((t, s) => t + s.count, 0)}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={2}><b>{worded(open, 'debit')}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={3}>
                      <b>{num(sections.reduce((t, s) => t + s.debit, 0))}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={4}>
                      <b>{num(sections.reduce((t, s) => t + s.credit, 0))}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={5}><b>{cd ? num(cd) : '-'}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={6}><b>{cc ? num(cc) : '-'}</b></Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
          ) : groupMode !== 'none' ? (
            <Table
              className="sl-table"
              size="small" loading={loading} rowKey="key" dataSource={groups}
              pagination={false}
              locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
              columns={[
                { title: groupBy === 'month' ? 'الشهر' : 'نوع الحركة', dataIndex: 'label',
                  render: (v: string) => <b>{v}</b> },
                { title: 'عدد الحركات', dataIndex: 'rows', align: 'center',
                  render: (r: StatementLine[]) => r.length },
                { title: LABELS.debit, dataIndex: 'debit', align: 'left',
                  render: (v: number) => num(v) },
                { title: LABELS.credit, dataIndex: 'credit', align: 'left',
                  render: (v: number) => num(v) },
                { title: 'الصافي', key: 'net', align: 'left',
                  render: (_: unknown, g: any) => <b>{num(g.debit - g.credit)}</b> },
                ...(reconcilable ? [{
                  title: 'متأخر', dataIndex: 'overdue', align: 'left' as const,
                  render: (v: number) => (v
                    ? <b style={{ color: '#cf1322' }}>{num(v)}</b>
                    : <span style={{ color: '#8c8c8c' }}>-</span>),
                }] : []),
              ]}
              expandable={{
                expandedRowRender: (g: any) => (
                  <Table<StatementLine>
                    className="st-table"
                    rowKey={rowKeyOf} size="small" dataSource={g.rows}
                    pagination={false} scroll={{ x: 'max-content' }}
                    columns={tableCols.columns}
                    rowClassName={rowClass}
                    expandable={{
                      expandedRowKeys: expandedKeys,
                      onExpand: (_open, l) => toggleRow(l),
                      expandedRowRender: rowDetail,
                    }}
                  />
                ),
              }}
              summary={() => {
                const td = groups.reduce((t, g) => t + g.debit, 0);
                const tc = groups.reduce((t, g) => t + g.credit, 0);
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2}><b>الإجمالي</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={1}><b>{num(td)}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={2}><b>{num(tc)}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={3}><b>{num(td - tc)}</b></Table.Summary.Cell>
                    {reconcilable && <Table.Summary.Cell index={4}>
                      <b style={{ color: '#cf1322' }}>
                        {num(groups.reduce((t, g) => t + g.overdue, 0))}
                      </b>
                    </Table.Summary.Cell>}
                  </Table.Summary.Row>
                );
              }}
            />
          ) : (
          <Table<StatementLine>
            {...kb.tableProps}
            className="sl-table st-table"
            rowKey={rowKeyOf}
            size="small" loading={loading} dataSource={tableRows}
            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
            pagination={{
              defaultPageSize: PAGE_SIZE, showSizeChanger: true, locale: { items_per_page: '' },
              showTotal: () => (
                <span className="sl-foot">
                  <span>عدد الحركات: <b>{shownLines.length}</b>{filtering ? ` من ${lines.length}` : ''}</span>
                  <span>الرصيد: <b>{num(statement.closing_balance)}</b></span>
                </span>
              ),
            }}
            scroll={{ x: 'max-content' }}
            columns={tableCols.columns}
            rowClassName={rowClass}
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpand: (_open, l) => toggleRow(l),
              expandedRowRender: rowDetail,
              rowExpandable: (l) => !l._opening,
            }}
            summary={() => totalsRow('الإجمالي',
              totalsVals(shownDebit, shownCredit, statement.closing_balance, stmtSide))}
          />
          )}
        </>
      )}
    </ListPage>
  );
}

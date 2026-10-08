import React, { useEffect, useMemo, useRef, useState } from 'react';
import DraftTag from '../components/DraftTag';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { customersOfRep, customerFitsRep } from '../utils/repScope';
import {
  Button, Col, DatePicker, Empty, Form, Input, Modal, Row, Segmented, Select,
  Space, Tag, Tooltip, message,
} from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import { advanceFrom } from '../components/lineKeyboard';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, DeleteOutlined, SearchOutlined, ClearOutlined, HistoryOutlined,
  FileAddOutlined, EditOutlined, EyeOutlined, UndoOutlined, SaveOutlined, PrinterOutlined,
  ArrowLeftOutlined, ArrowRightOutlined, BankOutlined, ReloadOutlined,
  ExclamationCircleOutlined, CheckOutlined, ShoppingCartOutlined, PhoneOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { statementMeta } from '../utils/statements';
import { useDocRoute } from '../components/useDocRoute';
import DocOpening from '../components/DocOpening';
import { useDraft } from '../components/useDraft';
import { netOf } from '../utils/discounts';
import ProductPickerModal from '../components/ProductPickerModal';
import PartyPickerModal, { Party } from '../components/PartyPickerModal';
import SummaryTile from '../components/saleDoc/SummaryTile';
import DocumentAttachments from '../components/DocumentAttachments';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice } from '../components/InvoiceDocument';
import DocumentBar from '../components/DocumentBar';
import LoadPeriodModal from '../components/LoadPeriodModal';
import QuickAddRow from '../components/QuickAddRow';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import DocumentHistoryButton from '../components/DocumentHistory';
import { DocRef } from '../components/DocumentLink';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import ExportExcelButton from '../components/ExportExcelButton';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import CustomerAccountPanel from '../components/CustomerAccountPanel';
import { guardQuantity } from '../components/quantityGuard';
import { useAuth } from '../components/AuthProvider';
import { useLookup, labelMap } from '../hooks/useLookup';
import { TabModal } from '../components/TabModal';
import WarehouseGate from '../components/WarehouseGate';
import TreasuryGate, { useTreasuryGate } from '../components/TreasuryGate';
import DateRangeFilter from '../components/DateRangeFilter';
import { money, numeralsLocale } from '../utils/money';
import { convertUnitPrice, factorOf, unitSelectOptions, type UnitRow } from '../utils/units';
import { applyPct, combinePct, splitLineDiscount } from '../utils/discounts';
import { QTY_DATA_ATTR } from '../utils/duplicateItem';
import { addPickedSequentially, type PickResult } from '../utils/pickMany';

import ListPage from '../components/ListPage';
import { useLiveRefresh } from '../utils/live';
import { repOptions } from '../utils/reps';
import { activeOptions } from '../utils/active';

interface ReturnRecord {
  sales_invoice_id?: number | null;
  invoice_document_number?: string | null;
  return_date?: string | null;
  rep_id?: number | null;
  external_document_number?: string | null;
  notes?: string | null;
  id: number;
  document_number: string;
  customer_id: number;
  gross: string;
  combined_pct: string;
  net: string;
  tax_amount: string;
  cash_refund: string;
  credit_reduction: string;
  ledger_entry_id: number | null;
  created_at?: string | null;
}

interface Customer { id: number; name: string; phone?: string | null; rep_id?: number | null; }
interface Product {
  id: number; name: string; sale_price: string | null; is_serialized: boolean; category: string | null;
  default_discount_pct?: string | null;
}
interface Warehouse { id: number; name: string; }

interface HistRow {
  document_number: string; date: string | null; quantity: string; unit: string | null;
  unit_price: string; effective_price: string;
}
interface LastInfo { last_price: string | null; history: HistRow[]; }

interface ReturnLineItem {
  key: string;
  category: string | null;
  item_id: number | null;
  quantity: number | null;
  unit_price: number;
  discount: number;
  fixed_discount: number;
  warehouse_id: number | null;
  is_serialized?: boolean;
  serials?: string[];
  unit?: string | null;
}

interface Filters {
  q?: string; customer_id?: number; date_from?: string; date_to?: string;
  rep_id?: number;
  statement?: string;
}

interface CouponRow {
  key: string;
  invoice_id?: number;
  coupon_type_id?: number | null;
  count?: number;
  serial_from?: string;
  serial_to?: string;
}

function blankCoupon(): CouponRow {
  return { key: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}` };
}

const SERIAL_SEP = '\n';

export default function Returns({ embedded }: { embedded?: { onExit: () => void } } = {}) {
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const canWriteReturn = can('return.write');
  const { ask: askTreasury, gateProps: treasuryGate } = useTreasuryGate(
    user?.role !== 'sales_rep');

  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState('');
  const [stmtText, setStmtText] = useState('');
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [pointValues, setPointValues] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  const [familyAccounts, setFamilyAccounts] = useState<
    { family: string | null; balance: string }[]>([]);
  const [returnFamily, setReturnFamily] = useState<string | null>(null);
  const families = familyAccounts.filter((a) => a.family);

  const [newStep, setNewStep] = useState<null | 'party' | 'warehouse'>(embedded ? 'party' : null);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [returnDate, setReturnDate] = useState<Dayjs>(dayjs());
  const [repId, setRepId] = useState<number | null>(null);
  const [externalDocNumber, setExternalDocNumber] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [statements, setStatements] = useState<[string, string, string]>(['', '', '']);
  const [reps, setReps] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [issuedBooks, setIssuedBooks] = useState<any[]>([]);
  const [couponRows, setCouponRows] = useState<CouponRow[]>(() => [blankCoupon()]);
  const [createForm] = Form.useForm();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [lines, setLines] = useState<ReturnLineItem[]>([]);
  const [unitsCache, setUnitsCache] = useState<Record<number, UnitRow[]>>({});
  const unitsRequestedRef = useRef<Set<number>>(new Set());
  const fetchUnits = async (itemId: number) => {
    if (unitsCache[itemId] || unitsRequestedRef.current.has(itemId)) return;
    unitsRequestedRef.current.add(itemId);
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({
        name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
    } catch (err) {
      unitsRequestedRef.current.delete(itemId);
      console.error(err);
    }
  };
  useEffect(() => {
    lines.forEach((l) => { if (l.item_id) fetchUnits(l.item_id); });
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [panelItemId, setPanelItemId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const qtyRefs = useRef<Record<string, any>>({});
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const advance = advanceFrom(lines, setFocusLineKey, () => setPickerOpen(true));

  const [cashRefund, setCashRefund] = useState<number>(0);
  const [creditReduction, setCreditReduction] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [customerBalance, setCustomerBalance] = useState<number | null>(null);
  const [docWarehouseId, setDocWarehouseId] = useState<number | null>(null);
  const [availability, setAvailability] = useState<Record<number, Record<number, number>>>({});

  const loadWarehouseStock = async (warehouseId: number) => {
    if (!warehouseId) return;
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: { location_kind: 'warehouse', location_id: warehouseId, only_available: false },
      });
      const map: Record<number, number> = {};
      (res.data || []).forEach((r: any) => { map[r.item_id] = Number(r.on_hand || 0); });
      setAvailability((prev) => ({ ...prev, [warehouseId]: map }));
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (docWarehouseId) {
      loadWarehouseStock(docWarehouseId);
    }
  }, [docWarehouseId, pickerOpen]);
  const lineSeq = useRef(0);
  const [lastInfo, setLastInfo] = useState<Record<number, LastInfo>>({});

  const [detailVisible, setDetailVisible] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [viewReturn, setViewReturn] = useState<any>(null);
  const [loadPeriodOpen, setLoadPeriodOpen] = useState(false);

  const draftPayload = useMemo(() => ({
    customer_id: customerId,
    family: returnFamily,
    return_date: returnDate ? dayjs(returnDate).format('YYYY-MM-DD') : null,
    lines,
    couponRows,
    cashRefund,
    discountPct,
    docWarehouseId,
    repId,
    externalDocNumber,
    docNotes,
  }), [customerId, returnFamily, returnDate, lines, couponRows, cashRefund,
       discountPct, docWarehouseId, repId, externalDocNumber, docNotes]);

  const {
    drafts, savedAt: draftSavedAt, discard: discardDraft,
    remove: removeDraft, adopt: adoptDraft,
  } = useDraft({
    kind: 'sale_return',
    payload: draftPayload,
    paused: Boolean(viewReturn),
    isEmpty: (x: any) => !x.customer_id
      && !(x.lines || []).some((l: any) => l.item_id != null),
    title: (x: any) => {
      const name = customers.find((c) => c.id === x.customer_id)?.name || 'بدون عميل';
      const n = (x.lines || []).filter((l: any) => l.item_id != null).length;
      return `${name} — ${n} صنف`;
    },
  });

  const resumeDraft = (d: any) => {
    const x = d.payload || {};
    adoptDraft(d.id);
    setViewOnly(false); setViewReturn(null); setEditingSourceId(null);
    setLastInfo({}); setCustomerBalance(null); setIssuedBooks([]); setActiveCategory(null);
    setStatements(['', '', '']);
    createForm.resetFields();
    setCreateVisible(true);
    setNewStep(null);
    setCustomerId(x.customer_id ?? null);
    if (x.customer_id) {
      createForm.setFieldsValue({ customer_id: x.customer_id });
      onCustomerChange(x.customer_id);
    }
    setReturnFamily(x.family ?? null);
    if (x.return_date) setReturnDate(dayjs(x.return_date));
    setLines(x.lines || []);
    setCouponRows(x.couponRows?.length ? x.couponRows : [blankCoupon()]);
    setCashRefund(Number(x.cashRefund) || 0);
    setDiscountPct(Number(x.discountPct) || 0);
    setDocWarehouseId(x.docWarehouseId ?? null);
    setRepId(x.repId ?? null);
    setExternalDocNumber(x.externalDocNumber || '');
    setDocNotes(x.docNotes || '');
  };

  const { markOpen, markClosed, opening: docOpening } = useDocRoute<ReturnRecord>({
    rows: returns,
    openId: viewReturn?.id ?? null,
    open: (r) => openDetail(r),
    close: () => closeCreate(),
    loading,
    fetchOne: async (id) => ({ id } as ReturnRecord),
    enabled: !embedded,
  });
  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printOpts, setPrintOpts] = useState<PrintOptions>(loadPrintOptions);
  const returnCols = useHiddenColumns('returns-list', [
    'id', 'gross', 'discount_value', 'combined_pct', 'tax_amount',
    'rep_id', 'notes',
  ]);
  const [histModal, setHistModal] = useState<{ name: string; rows: HistRow[] } | null>(null);

  const fetchReturns = async (override?: Filters, opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const f = override ?? filters;
      const params: any = {};
      if (f.q) params.q = f.q;
      if (f.customer_id) params.customer_id = f.customer_id;
      if (f.rep_id) params.rep_id = f.rep_id;
      if (f.date_from) params.date_from = f.date_from;
      if (f.date_to) params.date_to = f.date_to;
      if (f.statement) params.statement = f.statement;
      const res = await api.get('/api/v1/sales/returns', { params });
      setReturns(res.data);
    } catch (err: any) {
      console.error(err);
      if (!silent) message.error(err?.response?.data?.detail?.message || 'تعذر تحميل المرتجعات');
    } finally { if (!silent) setLoading(false); }
  };
  useLiveRefresh(['sales'], () => fetchReturns(undefined, { silent: true }));

  const loadLookups = async () => {
    try {
      const [custRes, prodRes, whRes, ptRes, repRes, empRes] = await Promise.all([
        api.get('/api/v1/customers/options', { params: { limit: 20000 } }),
        api.get('/api/v1/items?kind=product'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/products/point-values'),
        api.get('/api/v1/users?role=sales_rep').catch(() => ({ data: [] })),
        api.get('/api/v1/employees').catch(() => ({ data: [] })),
      ]);
      setCustomers(custRes.data);
      setProducts(prodRes.data);
      setWarehouses(whRes.data);
      setReps(sortByName((repRes.data || []).filter((u: any) => u.role === 'sales_rep'),
        (u: any) => u.full_name || u.username));
      setEmployees(empRes.data || []);
      const pts: Record<number, number> = {};
      (ptRes.data || []).forEach((r: any) => { pts[r.item_id] = parseFloat(r.point_value) || 0; });
      setPointValues(pts);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل قوائم الشاشة');
    }
  };

  useEffect(() => { fetchReturns(); loadLookups(); }, []);

  const setFilter = (key: keyof Filters, value: any) => {
    const next = { ...filters, [key]: value };
    if (key === 'rep_id' && !customerFitsRep(customers, next.customer_id, next.rep_id)) {
      next.customer_id = undefined;
    }
    setFilters(next); fetchReturns(next);
  };
  const filterCustomerOptions = useMemo(
    () => sortByName(customersOfRep(customers, filters.rep_id), (c) => c.name)
      .map((c) => ({ value: c.id, label: c.name })),
    [customers, filters.rep_id],
  );
  const applySearch = () => {
    const q = search.trim() || undefined;
    if (q !== filters.q) setFilter('q', q);
  };
  const resetFilters = () => { setSearch(''); setStmtText(''); setFilters({}); fetchReturns({}); };

  const summary = useMemo(() => {
    const net = returns.reduce((s, r) => s + Number(r.net || 0), 0);
    const credit = returns.reduce((s, r) => s + Number(r.credit_reduction || 0), 0);
    return { count: returns.length, net, credit };
  }, [returns]);

  const productCategories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [products]);

  const linesByCategory = useMemo(
    () => (lines.length ? [{ category: null as string | null, items: lines as ReturnLineItem[] }] : []),
    [lines]);

  const lineDiscountPct = (l: ReturnLineItem) =>
    Math.min(99.99, combinePct(l.fixed_discount, l.discount));
  const lineTotal = (l: ReturnLineItem) =>
    applyPct(Number(l.quantity || 0) * l.unit_price, l.fixed_discount, l.discount);
  const lineAfterFixed = (l: ReturnLineItem) =>
    applyPct(Number(l.quantity || 0) * l.unit_price, l.fixed_discount);
  const linePoints = (l: ReturnLineItem) =>
    (l.item_id ? (pointValues[l.item_id] || 0) : 0) * (l.quantity || 0);

  const totalReturnPoints = lines.reduce((sum, l) => sum + linePoints(l), 0);

  const grossTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const afterFixedTotal = lines.reduce((s, l) => s + lineAfterFixed(l), 0);
  const netTotal = netOf(grossTotal, discountPct);
  const totalPoints = lines.reduce((s, l) => s + linePoints(l), 0);

  useEffect(() => {
    const credit = Math.max(0, netTotal - (parseFloat(cashRefund.toString()) || 0));
    setCreditReduction(parseFloat(credit.toFixed(2)));
  }, [cashRefund, netTotal]);

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `صنف #${id}`;

  const closeCreate = (opts?: { stay?: boolean; keepUrl?: boolean }) => {
    if (opts?.keepUrl !== true) markClosed({ stay: opts?.stay === true });
    setCreateVisible(false);
    setViewOnly(false);
    setViewReturn(null);
    setLines([]); setActiveCategory(null); setCashRefund(0); setDiscountPct(0);
    setCustomerId(null); setLastInfo({}); setCustomerBalance(null); setDocWarehouseId(null);
    setRepId(null); setExternalDocNumber(''); setDocNotes(''); setStatements(['', '', '']);
    setCouponRows([blankCoupon()]); setIssuedBooks([]);
    setReturnDate(dayjs());
    setEditingSourceId(null);
    createForm.resetFields();
  };

  const handlePartyPicked = (picked: Party) => {
    setPartyPickerOpen(false);
    createForm.setFieldsValue({ customer_id: picked.id });
    setCustomers((prev) => (prev.some((c: any) => c.id === picked.id)
      ? prev : [...prev, { id: picked.id, name: picked.name } as any]));
    onCustomerChange(picked.id);
    if (newStep === 'party') {
      setNewStep('warehouse');
    }
  };

  const storeOfRep = (repId: number | null | undefined): number | null => {
    if (!repId) return null;
    return employees.find((e: any) => e.user_id === repId)?.warehouse_id ?? null;
  };

  const onCustomerChange = (cId: number) => {
    setCustomerId(cId);
    const c = customers.find((x: any) => x.id === cId);
    if ((c as any)?.rep_id) setRepId((c as any).rep_id);
    const remembered = (c as any)?.default_return_warehouse_id ?? null;
    const store = remembered ?? storeOfRep((c as any)?.rep_id);
    if (store) setDocWarehouseId((prev) => prev ?? store);
    setLines([]); setLastInfo({}); setActiveCategory(null);
    setCustomerBalance(null);
    setFamilyAccounts([]); setReturnFamily(null);
    api.get(`/api/v1/customers/${cId}/accounts`)
      .then((res) => {
        const rows = res.data?.accounts || [];
        setFamilyAccounts(rows);
        setCustomerBalance(Number(res.data?.total_balance || 0));
        const named = rows.filter((a: any) => a.family);
        setReturnFamily((cur) => cur ?? (named.length === 1 ? named[0].family : null));
      })
      .catch((err) => { console.error(err); setFamilyAccounts([]); setCustomerBalance(null); });
    setCouponRows([blankCoupon()]);
    api.get(`/api/v1/coupon-receipts/issued-to/${cId}`)
      .then((res) => setIssuedBooks(res.data || []))
      .catch(() => setIssuedBooks([]));
  };

  const fetchLastInfo = async (itemId: number): Promise<LastInfo> => {
    if (lastInfo[itemId]) return lastInfo[itemId];
    try {
      const res = await api.get('/api/v1/sales/customer-item-history', {
        params: { customer_id: customerId, item_id: itemId },
      });
      const info: LastInfo = { last_price: res.data.last_price, history: res.data.history || [] };
      setLastInfo((prev) => ({ ...prev, [itemId]: info }));
      return info;
    } catch (err) {
      console.error(err);
      return { last_price: null, history: [] };
    }
  };

  const addProductById = async (itemId: number, qty: number | null = null): Promise<PickResult> => {
    if (!itemId || !customerId) return null;
    const prod = products.find((p) => p.id === itemId);
    if (docWarehouseId === null) {
      message.warning('اختر مخزن المرتجع أولاً من خانة «المخزن» بالأعلى، ثم أضف الأصناف.');
      return null;
    }
    return addProductByIdWith(itemId, docWarehouseId, qty);
  };

  const addProductByIdWith = async (
    itemId: number, warehouseId: number, qty: number | null = null,
  ): Promise<PickResult> => {
    const prod = products.find((p) => p.id === itemId);
    const info = await fetchLastInfo(itemId);
    let price = info.last_price != null ? parseFloat(info.last_price) : 0;
    let priceUnit: string | null = price > 0 ? (info.history[0]?.unit ?? null) : null;
    let fallbackDisc: number | null = null;
    if (!(price > 0)) {
      priceUnit = null;
      try {
        const r = await api.get(`/api/v1/items/${itemId}/return-price`);
        if (Number(r.data?.unit_price) > 0) price = Number(r.data.unit_price);
        if (Number(r.data?.discount_pct) > 0) fallbackDisc = Number(r.data.discount_pct);
      } catch {}
    }
    if (!(price > 0)) price = prod?.sale_price ? parseFloat(prod.sale_price) : 0;
    const existing = lines.find((x) => x.item_id === itemId);
    if (existing) {
      if (qty) {
        setLines((prev) => prev.map((x) => (x.key === existing.key
          ? { ...x, quantity: Number(x.quantity || 0) + qty } : x)));
        message.info(`«${productName(itemId)}» موجود بالفعل — تمت زيادة كميته`);
      } else {
        message.info(`«${productName(itemId)}» موجود بالفعل — عدّل الكمية من السطر`);
      }
      return { dup: itemId };
    } else {
      const key = `${Date.now()}-${++lineSeq.current}`;
      setLines((prev) => [...prev, {
        key, category: prod?.category ?? null, item_id: itemId,
        quantity: qty || null, unit_price: price, discount: 0,
        fixed_discount: prod?.default_discount_pct
          ? parseFloat(prod.default_discount_pct) : (fallbackDisc ?? 0),
        warehouse_id: warehouseId,
        is_serialized: !!prod?.is_serialized,
        serials: [] as string[],
        unit: priceUnit,
      }]);
      return qty ? null : { needsQty: key };
    }
  };

  useEffect(() => {
    if (!focusLineKey) return undefined;
    if (pickerOpen) return undefined;
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-qty-key="${focusLineKey}"]`
      );
      if (el && document.activeElement === el) { setFocusLineKey(null); return; }
      el?.focus();
      el?.select();
      if (++frames < 40) raf = requestAnimationFrame(tryFocus);
      else setFocusLineKey(null);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [focusLineKey, lines.length, pickerOpen]);

  useEffect(() => {
    if (!createVisible) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (pickerOpen) return;
      const el = e.target as HTMLElement | null;
      if (el && typeof el.closest === 'function') {
        if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return;
        if (el.closest('.ant-select, .ant-modal, button')) return;
      }
      e.preventDefault();
      setPickerOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createVisible, pickerOpen]);

  const handleLineChange = (key: string, field: keyof ReturnLineItem, value: any) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  };
  const handleRemoveLine = (key: string) => setLines(lines.filter((l) => l.key !== key));

  const neighbour = (step: number) => {
    if (!viewReturn) return null;
    const at = returns.findIndex((r) => r.id === viewReturn.id);
    if (at < 0) return null;
    return returns[at + step] ?? null;
  };

  const stepFromDraft = (step: number) => {
    const target = neighbour(step);
    if (!target) return;
    closeCreate({ keepUrl: true });
    openDetail(target);
  };

  const returnToolbar = (): ToolbarAction[] => {
    const typed = lines.filter((l) => l.item_id !== null).length;
    const isSaved = Boolean(editingSourceId && viewReturn);
    return [
      {
        key: 'new',
        label: 'جديد',
        shortcut: 'F2',
        primary: true,
        icon: <FileAddOutlined />,
        onClick: () => {
          createForm.resetFields();
          setLines([]);
          setReturnDate(dayjs());
          setEditingSourceId(null);
          setViewReturn(null);
          setViewOnly(false);
          setNewStep('party');
          setPartyPickerOpen(true);
        },
      },
      {
        key: 'edit',
        label: 'تعديل',
        icon: <EditOutlined />,
        disabled: !isSaved || !viewOnly,
        onClick: () => {
          setViewOnly(false);
          message.info('مردود المبيعات مفتوح الآن للتعديل');
        },
      },
      {
        key: 'undo',
        label: 'تراجع',
        icon: <UndoOutlined />,
        onClick: () => {
          if (!viewOnly && editingSourceId) {
            openDetail({ id: editingSourceId } as ReturnRecord);
          } else if (lines.length > 0) {
            closeCreate();
          } else {
            setLines([]);
          }
        },
      },
      {
        key: 'save',
        label: 'حفظ',
        shortcut: 'F9',
        icon: <SaveOutlined />,
        disabled: viewOnly || typed === 0,
        onClick: () => createForm.submit(),
      },
      {
        key: 'search',
        label: 'بحث',
        shortcut: 'F3',
        icon: <SearchOutlined />,
        onClick: () => {
          if (viewOnly) {
            closeCreate({ stay: true });
          } else {
            setPickerOpen(true);
          }
        },
      },
      {
        key: 'prev',
        label: 'السابق',
        icon: <ArrowRightOutlined />,
        disabled: returns.length === 0,
        onClick: () => stepFromDraft(-1),
      },
      {
        key: 'next',
        label: 'التالى',
        icon: <ArrowLeftOutlined />,
        disabled: returns.length === 0,
        onClick: () => stepFromDraft(1),
      },
      {
        key: 'delete',
        label: 'حذف',
        shortcut: 'F8',
        icon: <DeleteOutlined />,
        danger: true,
        disabled: isSaved ? false : typed === 0,
        onClick: () => {
          if (isSaved && viewReturn) {
            Modal.confirm({
              title: 'تأكيد حذف مردود المبيعات',
              icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
              content: `هل أنت متأكد من حذف سند المردود رقم (${viewReturn.document_number || ''})؟`,
              okText: 'نعم، احذف',
              okType: 'danger',
              cancelText: 'إلغاء',
              onOk: async () => {
                try {
                  await api.delete(`/api/v1/sales/returns/${viewReturn.id}`);
                  message.success('تم حذف مردود المبيعات بنجاح');
                  closeCreate();
                  fetchReturns();
                } catch (err: any) {
                  console.error(err);
                }
              },
            });
          } else {
            setLines([]);
          }
        },
      },
      {
        key: 'print',
        label: 'طباعة',
        shortcut: 'F7',
        icon: <PrinterOutlined />,
        disabled: !isSaved || printing,
        onClick: async () => {
          setPrinting(true);
          try {
            const doc = returnDoc(viewReturn);
            if (doc) printInvoice(doc, printOpts);
          } catch (err: any) {
            message.error(err?.response?.data?.detail?.message || 'تعذر طباعة المرتجع');
          } finally {
            setPrinting(false);
          }
        },
      },
      {
        key: 'accounts',
        label: 'حسابات',
        icon: <BankOutlined />,
        disabled: !customerId && !viewReturn?.customer_id,
        onClick: () => {
          const cid = customerId || viewReturn?.customer_id;
          if (cid) navigate(`/customers/${cid}`);
        },
      },
      {
        key: 'reload',
        label: 'تحميل',
        icon: <ReloadOutlined />,
        onClick: () => setLoadPeriodOpen(true),
      },
    ];
  };

  const handleSubmit = (values: any) => {
    if (!customerId) { message.warning('يرجى اختيار العميل'); return; }
    const valid = lines.filter((l) => l.item_id !== null && Number(l.quantity || 0) > 0);
    if (valid.length === 0) { message.warning('أضف صنفاً واحداً على الأقل للمرتجع'); return; }

    for (const l of valid) {
      if (!l.is_serialized) continue;
      const need = Number(l.quantity || 0);
      const given = [...new Set(l.serials || [])];
      if (given.length !== need) {
        message.error(`«${products.find((p) => p.id === l.item_id)?.name ?? 'صنف'}»: `
          + `اكتب ${need} سيريال بعدد الكمية — وهي التي تعود إلى المخزن.`);
        return;
      }
      l.serials = given;
    }
    const cash = parseFloat(cashRefund.toString()) || 0;
    if (cash + creditReduction - netTotal > 0.01 || netTotal - (cash + creditReduction) > 0.01) {
      message.error('مجموع المسترد نقداً + الخصم من الحساب يجب أن يساوي صافي المرتجع');
      return;
    }
    askTreasury(
      {
        amount: cash,
        direction: 'out',
        family: returnFamily,
        docLabel: 'مردود المبيعات',
      },
      (cashAccountId) => {
        showReversalConfirm({
          title: 'تأكيد تسجيل مرتجع المبيعات',
          content: `سيتم إرجاع ${valid.length} صنف إلى المخزن وتسوية مبلغ ${money(netTotal)} لحساب العميل. متابعة؟`,
          onOk: async () => {
            try {
              const editingId = editingSourceId;
              const send = editingId
                ? (b: any) => api.put(`/api/v1/sales/returns/${editingId}`, b)
                : (b: any) => api.post('/api/v1/sales/returns', b);
              const res = await send({
                customer_id: customerId,
                origin: {
                  location_kind: 'warehouse',
                  location_id: valid[0]?.warehouse_id ?? docWarehouseId,
                },
                variable_discount_pct: discountPct,
                cash_refund: cash,
                credit_reduction: creditReduction,
                cash_account_id: cashAccountId ?? undefined,
                family: returnFamily,
                rep_id: repId ?? undefined,
                external_document_number: externalDocNumber || undefined,
                notes: docNotes || undefined,
                statement1: statements[0] || undefined,
                statement2: statements[1] || undefined,
                statement3: statements[2] || undefined,
                return_date: returnDate.format('YYYY-MM-DD'),
                returned_coupons: couponRows
                  .filter((r) => r.serial_from && r.count)
                  .map((r) => ({ serial_from: r.serial_from, serial_to: r.serial_to, count: r.count })),
                lines: valid.map((l) => ({
                  item_id: l.item_id, quantity: Number(l.quantity || 0), unit_price: l.unit_price,
                  discount_pct: lineDiscountPct(l),
                  fixed_discount_pct: Number(l.fixed_discount || 0),
                  variable_discount_pct: Number(l.discount || 0),
                  warehouse_id: l.warehouse_id ?? undefined,
                  serials: l.is_serialized ? (l.serials || []) : undefined,
                  unit: l.unit ?? null,
                })),
              });
              message.success(editingSourceId
                ? `تم حفظ المرتجع. رقم السند: ${res.data.document_number}`
                : `تم تسجيل المرتجع بنجاح. رقم السند: ${res.data.document_number}`);
              discardDraft();
              closeCreate();
              fetchReturns();
            } catch (err: any) {
              console.error(err);
              message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل المرتجع');
            }
          },
        });
      },
    );
  };

  const lineColumns: EntryColumn<ReturnLineItem>[] = [
    { key: 'idx', title: '#', width: 32, span: 1, xs: 2, locked: true,
      cellStyle: { color: '#6b6b6b', textAlign: 'center' },
      cell: (_l: any, i: number) => i + 1 },
    { key: 'item', title: 'الصنف', span: 4, xs: 24, locked: true, width: 210, minWidth: 120,
      cell: (line) => {
        const name = productName(line.item_id as number);
        return <b className="eg-ellipsis" title={name}>{name}</b>;
      } },
    { key: 'warehouse', title: 'المخزن', span: 3, xs: 12, width: 120,
      cell: (line) => (
        <Select size="small" className="sale-wh-select" style={{ width: '100%' }} placeholder="المخزن"
          disabled={viewOnly}
          value={line.warehouse_id ?? docWarehouseId ?? undefined}
          onChange={(val) => {
            handleLineChange(line.key, 'warehouse_id', val);
            if (val != null) setDocWarehouseId(val as number);
          }}
          options={activeOptions(warehouses, [line.warehouse_id, docWarehouseId])} />
      ) },
    { key: 'unit', title: 'الوحدة', span: 2, xs: 8, width: 80,
      cell: (line) => (
        <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
          disabled={viewOnly} popupMatchSelectWidth={false}
          value={line.unit ?? '__base__'}
          onChange={(v) => setLines((prev) => prev.map((l) => {
            if (l.key !== line.key) return l;
            const unit = v === '__base__' ? null : (v as string);
            const units = unitsCache[l.item_id || 0];
            return { ...l, unit, unit_price: convertUnitPrice(l.unit_price || 0,
              factorOf(units, l.unit), factorOf(units, unit)) };
          }))}
          options={unitSelectOptions(unitsCache[line.item_id || 0])} />
      ) },
    { key: 'last_price', title: 'آخر سعر شراء', span: 2, xs: 12, width: 110,
      cell: (line) => {
        const info = line.item_id ? lastInfo[line.item_id] : undefined;
        const last = info?.last_price;
        return last != null ? (
          <Tag color="green" style={{ cursor: 'pointer' }}
            onClick={() => setHistModal({
              name: productName(line.item_id as number),
              rows: info?.history || [],
            })}>
            <HistoryOutlined /> {money(last)}
          </Tag>
        ) : <Tag>لم يشترِه من قبل</Tag>;
      } },
    { key: 'quantity', title: 'الكمية', span: 2, xs: 8, locked: true, width: 90,
      footer: (rows) => rows.reduce((n, l) => n + Number(l.quantity || 0), 0)
        .toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 }),
      cellProps: (line) => (line.item_id != null
        ? { [QTY_DATA_ATTR]: line.item_id } as any : {}),
      cell: (line) => (
        <InputNumber size="small" style={{ width: '100%' }}
          disabled={viewOnly}
          ref={(el) => { qtyRefs.current[line.key] = el; }}
          data-qty-key={line.key} data-grid-col="qty" keyboard={false}
          placeholder="الكمية" value={line.quantity ?? undefined}
          onChange={(val) => handleLineChange(line.key, 'quantity', val ?? null)}
          onBlur={() => handleLineChange(line.key, 'quantity', guardQuantity({
            value: line.quantity,
            itemName: products.find((p) => p.id === line.item_id)?.name,
          }, null))}
          onPressEnter={(e) => {
            e.preventDefault();
            const kept = guardQuantity({
              value: line.quantity,
              itemName: products.find((p) => p.id === line.item_id)?.name,
            }, null);
            handleLineChange(line.key, 'quantity', kept);
            advance(line.key);
          }} />
      ) },
    { key: 'unit_price', title: 'سعر الإرجاع', span: 2, xs: 8, width: 100,
      cell: (line) => (
        <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
          disabled={viewOnly}
          value={line.unit_price}
          onChange={(val) => handleLineChange(line.key, 'unit_price', val || 0)} />
      ) },
    { key: 'variable_discount', title: 'خصم متغير %', span: 2, xs: 8, width: 70,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="متغير" value={line.discount}
          onChange={(val) => handleLineChange(line.key, 'discount', val || 0)} />
      ) },
    { key: 'fixed_discount', title: 'خصم ثابت %', span: 2, xs: 8, width: 70,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="ثابت" value={line.fixed_discount}
          onChange={(val) => handleLineChange(line.key, 'fixed_discount', val || 0)} />
      ) },
    { key: 'after_fixed', title: 'بعد الثابت', label: 'الإجمالي بعد الخصم الثابت',
      tip: 'الإجمالي بعد الخصم الثابت', span: 2, xs: 12, width: 100,
      cellStyle: { whiteSpace: 'nowrap', color: '#475569' },
      cell: (line) => money(lineAfterFixed(line)),
      footer: (rows) => money(rows.reduce((s, l) => s + lineAfterFixed(l), 0)) },
    { key: 'points', title: 'النقاط', span: 2, xs: 12, align: 'center', width: 64,
      cellStyle: { textAlign: 'center' },
      footer: (rows) => (
        <span style={{ color: '#F5A11D' }}>
          {rows.reduce((s, l) => s + linePoints(l), 0)
            .toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
        </span>
      ),
      cell: (line) => {
        const v = linePoints(line);
        if (v) {
          return (
            <span style={{ color: '#F5A11D', fontWeight: 600 }}>
              {v.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
            </span>
          );
        }
        const per = line.item_id ? (pointValues[line.item_id] || 0) : 0;
        return per > 0
          ? (
            <span style={{ color: '#b0b0b0' }} title={`${per} نقطة للوحدة`}>
              × {per.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
            </span>
          )
          : <span style={{ color: '#b0b0b0' }}>-</span>;
      } },
    { key: 'total', title: 'الإجمالي', span: 3, xs: 12, align: 'center', locked: true, width: 105,
      cellStyle: { textAlign: 'center' },
      footer: (rows) => (
        <span style={{ color: '#cf4b1a' }}>{money(rows.reduce((s, l) => s + lineTotal(l), 0))}</span>
      ),
      cell: (line) => <b style={{ color: '#cf4b1a' }}>{money(lineTotal(line))}</b> },
    { key: 'actions', title: '', label: 'حذف السطر', span: 1, xs: 4, align: 'center',
      locked: true, width: 50, minWidth: 40, cellStyle: { textAlign: 'center' },
      cell: (line) => (viewOnly ? null : (
        <Button type="text" size="small" danger icon={<DeleteOutlined />}
          onClick={() => handleRemoveLine(line.key)} />
      )) },
  ];
  const lineGrid = useEntryGrid('return-lines', lineColumns);

  const returnDoc = (r: any): InvoiceDoc | null => {
    if (!r) return null;
    const known = customers.find((c) => c.id === r.customer_id);
    const customerName = r.customer_name || known?.name;
    return {
      kind: 'sale_return',
      document_number: r.document_number,
      date: r.return_date ?? r.created_at ?? null,
      extraMeta: statementMeta(r),
      partyLabel: 'العميل',
      partyName: customerName ?? `#${r.customer_id}`,
      partyPhone: known?.phone ?? null,
      partyId: r.customer_id ?? null,
      gross: r.gross,
      discountPct: r.combined_pct,
      net: r.net,
      tax: r.tax_amount ?? 0,
      cash: r.cash_refund,
      credit: r.credit_reduction,
      entryId: r.ledger_entry_id ?? null,
      totalPoints: (r.lines || []).reduce(
        (s: number, l: any) => s + (pointValues[l.item_id] || 0) * Number(l.quantity || 0), 0),
      lines: (r.lines || []).map((l: any) => ({
        name: productName(l.item_id),
        itemId: l.item_id,
        quantity: l.quantity,
        unit: l.unit || unitsCache[l.item_id]?.find((u) => u.is_base)?.name || null,
        unit_price: l.unit_price,
        discount_pct: l.discount_pct,
        points: (pointValues[l.item_id] || 0) * Number(l.quantity || 0),
        line_total: l.line_total,
        warehouse: warehouses.find((w) => w.id === l.warehouse_id)?.name ?? null,
      })),
    };
  };

  const handleDeleteReturn = async (record: ReturnRecord) => {
    try {
      await api.delete(`/api/v1/sales/returns/${record.id}`);
      message.success('تم حذف المرتجع');
      fetchReturns();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حذف المرتجع');
    }
  };

  const openDetail = async (record: ReturnRecord) => {
    markOpen(record.id);
    try {
      const res = await api.get(`/api/v1/sales/returns/${record.id}`);
      const det = res.data;
      setViewReturn(det);
      setEditingSourceId(det.id);
      setViewOnly(true);
      if (det.customer_id) {
        createForm.setFieldsValue({ customer_id: det.customer_id });
        onCustomerChange(det.customer_id);
      }
      setReturnDate(det.return_date ? dayjs(det.return_date) : dayjs());
      setRepId(det.rep_id ?? null);
      setReturnFamily(det.family ?? null);
      setExternalDocNumber(det.external_document_number || '');
      setDocNotes(det.notes || '');
      setStatements([det.statement1 || '', det.statement2 || '', det.statement3 || '']);
      setDiscountPct(Number(det.variable_discount_pct) || 0);
      setCashRefund(Number(det.cash_refund) || 0);
      setLines((det.lines || []).map((l: any, i: number) => ({
        key: `${Date.now()}-${i}`,
        category: products.find((pr: any) => pr.id === l.item_id)?.category ?? null,
        item_id: l.item_id,
        quantity: Number(l.quantity) || null,
        unit_price: Number(l.unit_price) || 0,
        ...(() => {
          const d = splitLineDiscount(l);
          return { discount: d.discount_pct || 0, fixed_discount: d.fixed_discount_pct || 0 };
        })(),
        warehouse_id: l.warehouse_id ?? null,
        is_serialized: Boolean(l.serials && l.serials.length > 0),
        serials: l.serials || [],
        points: Number(l.points) || 0,
        unit: l.unit ?? null,
      })));
      setCreateVisible(true);
    } catch (err) {
      console.error(err);
      message.error('تعذر تحميل تفاصيل المردود');
    }
  };

  const handleEditReturn = async (record: ReturnRecord) => {
    await openDetail(record);
    setViewOnly(false);
    message.info('المرتجع مفتوح الآن للتعديل');
  };

  const doors = (
    <>
      <PartyPickerModal contextLabel="مرتجع مبيعات"
        open={newStep === 'party' || partyPickerOpen} kind="customer"
        kinds={['customer', 'employee', 'supplier']}
        excludeTypes={['plumber']}
        date={returnDate} onDateChange={(d) => setReturnDate(d)}
        onPick={handlePartyPicked}
        onCancel={() => { setNewStep(null); setPartyPickerOpen(false); }} />

      <TreasuryGate {...treasuryGate} />

      <WarehouseGate
        open={newStep === 'warehouse' && !viewOnly && !editingSourceId}
        title="إلى أي مخزن يدخل هذا المرتجع؟"
        subtitle=""
        value={docWarehouseId}
        onChange={(v) => setDocWarehouseId(v as number)}
        warehouses={warehouses}
        onCancel={() => { setDocWarehouseId(null); setNewStep('party'); setPartyPickerOpen(true); }}
        onOk={() => { setNewStep(null); setCreateVisible(true); }}
      />
    </>
  );

  const screen = createVisible ? (
      <div className="sale-doc" style={{ flex: '1 0 auto' }}>
        <div className="sale-card sale-head">
          <div className="sale-head-row">
            <Button size="small" icon={<ArrowRightOutlined />} onClick={() => closeCreate()}>رجوع</Button>
            <span className="sale-title">
              {viewReturn
                ? <>مردود مبيعات رقم: <b dir="ltr">{viewReturn.document_number || ''}</b></>
                : (editingSourceId ? 'تعديل مردود مبيعات' : 'تسجيل مرتجع مبيعات جديد')}
            </span>
            {(viewReturn?.family || returnFamily) && (
              <Tag color={(viewReturn?.family || returnFamily) === 'أبيض' ? 'default' : 'blue'}
                style={{ fontWeight: 700, marginInlineEnd: 0 }}>
                {viewReturn?.family || returnFamily}
              </Tag>
            )}
            {viewReturn && !viewOnly && (
              <Tag color="gold" style={{ fontWeight: 600, marginInlineEnd: 0 }}>وضع التعديل</Tag>
            )}
            {viewReturn?.reversed_by && (
              <Tag color="volcano" style={{ marginInlineEnd: 0 }}>معكوس</Tag>
            )}
            <span className="sale-pager">
              <DocumentBar
                listLabel="مرتجعات المبيعات"
                listTo="/returns"
                title={viewReturn
                  ? (viewReturn.document_number || `#${viewReturn.id}`)
                  : (editingSourceId ? 'تعديل مرتجع' : 'مرتجع جديد')}
                position={viewReturn
                  ? returns.findIndex((r: any) => r.id === viewReturn.id) + 1 || null : null}
                total={viewReturn ? returns.length : null}
                onPrev={viewReturn && neighbour(-1) ? () => stepFromDraft(-1) : undefined}
                onNext={viewReturn && neighbour(1) ? () => stepFromDraft(1) : undefined}
                steps={[
                  { key: 'draft', label: 'مسودة' },
                  { key: 'posted', label: 'مرحّل', color: 'green' },
                  { key: 'reversed', label: 'معكوس', color: 'volcano' },
                ]}
                current={!viewReturn && !editingSourceId ? 'draft'
                  : (viewReturn?.reversed_by ? 'reversed' : 'posted')}
                extra={(
                  <DatePicker size="small" allowClear={false} format="YYYY-MM-DD"
                    disabled={viewOnly}
                    value={returnDate} onChange={(v) => setReturnDate(v || dayjs())} />
                )}
              />
            </span>
            <div className="sale-toolbar-row">
              <DocumentToolbar actions={returnToolbar()} variant="buttons" />
              <DocumentHistoryButton entityType="sales_return" entityId={viewReturn?.id}
                documentNumber={viewReturn?.document_number} />
              {lineGrid.control}
              <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
            </div>
          </div>
        </div>

        <Form form={createForm} layout="vertical" size="small" className="doc-form sale-form"
          onFinish={handleSubmit}>
          <div className="sale-card sale-fields">
            <Row gutter={12}>
              <Col xs={12} md={4}>
                <Form.Item label="رقم المستند">
                  <Input placeholder="رقم ورقة العميل" disabled={viewOnly} value={externalDocNumber}
                    onChange={(e) => setExternalDocNumber(e.target.value)} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6} className="sale-party">
                <Form.Item label="اسم العميل" required>
                  <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                    disabled={viewOnly}
                    placeholder="اضغط لاختيار العميل"
                    value={customerId ?? undefined}
                    onClick={() => { if (!viewOnly) setPartyPickerOpen(true); }}
                    options={customers.map((c: any) => ({ value: c.id, label: c.name }))} filterOption={searchFilter} filterSort={searchRank}/>
                </Form.Item>
              </Col>
              <Col xs={12} md={4}>
                <Form.Item label="الهاتف">
                  <Input readOnly disabled dir="ltr" placeholder="-"
                    suffix={<PhoneOutlined style={{ color: '#5b6575' }} />}
                    value={(customers.find((c: any) => c.id === customerId) as any)?.phone || ''} />
                </Form.Item>
              </Col>
              <Col xs={12} md={4}>
                <Form.Item label="المخزن" required>
                  <Select
                    showSearch
                    disabled={viewOnly}
                    placeholder="اختر المخزن المستلم"
                    value={docWarehouseId ?? undefined}
                    onChange={(v) => setDocWarehouseId(v as number)}
                    options={activeOptions(warehouses, docWarehouseId)} filterOption={searchFilter} filterSort={searchRank}/>
                </Form.Item>
              </Col>
              <Col xs={12} md={3}>
                <Form.Item label="المندوب">
                  <Select allowClear showSearch placeholder="بدون مندوب"
                    disabled={viewOnly}
                    value={repId ?? undefined} onChange={(v) => setRepId((v as number) ?? null)}
                    options={repOptions(reps, repId)} filterOption={searchFilter} filterSort={searchRank}/>
                </Form.Item>
              </Col>
              <Col xs={12} md={3}>
                <Form.Item label="الخط">
                  <Select
                    allowClear
                    disabled={viewOnly}
                    placeholder="أبيض / بولي"
                    value={returnFamily ?? undefined}
                    onChange={(v) => setReturnFamily(v ? String(v) : null)}
                    options={[
                      { value: 'أبيض', label: 'أبيض' },
                      { value: 'بولي', label: 'بولي' },
                    ]}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={12}>
              <Col xs={24} md={8}>
                <Form.Item label="ملاحظات">
                  <Input placeholder="اختياري" disabled={viewOnly} value={docNotes}
                    onChange={(e) => setDocNotes(e.target.value)} />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item label="البيان">
                  <Input placeholder="اختياري" disabled={viewOnly}
                    value={statements[0]}
                    onChange={(e) => setStatements([e.target.value, statements[1], statements[2]])} />
                </Form.Item>
              </Col>
            </Row>

            {customerId && issuedBooks.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <Row gutter={8} className="coupon-head" style={{ marginBottom: 4 }}>
                  <Col xs={24} md={12}>الدفتر المصروف له</Col>
                  <Col xs={12} md={5}>العدد الراجع</Col>
                  <Col xs={12} md={4}>الأرقام</Col>
                  <Col xs={24} md={3} />
                </Row>
                {couponRows.map((row, i) => {
                  const book = issuedBooks.find((b: any) => (
                    b.invoice_id === row.invoice_id
                    && (b.coupon_type_id ?? null) === (row.coupon_type_id ?? null)));
                  return (
                    <Row gutter={8} key={row.key} align="middle" style={{ marginBottom: 6 }}>
                      <Col xs={24} md={12}>
                        <Select showSearch style={{ width: '100%' }}
                          disabled={viewOnly}
                          value={book ? `${row.invoice_id}:${row.coupon_type_id ?? ''}` : undefined}
                          onChange={(v) => {
                            const [inv, type] = String(v).split(':');
                            const b = issuedBooks.find((x: any) => (
                              x.invoice_id === Number(inv)
                              && (x.coupon_type_id ?? null) === (type ? Number(type) : null)));
                            setCouponRows((rs) => rs.map((x) => (x.key === row.key ? {
                              ...x, invoice_id: Number(inv),
                              coupon_type_id: type ? Number(type) : null,
                              serial_from: b?.serial_from, serial_to: b?.serial_to,
                              count: b?.remaining,
                            } : x)));
                          }}
                          options={issuedBooks.map((b: any) => ({
                            value: `${b.invoice_id}:${b.coupon_type_id ?? ''}`,
                            label: `${b.document_number} — ${b.coupon_type_name || 'بدون نوع'}`
                              + ` — باقي ${b.remaining} من ${b.count}`
                              + (b.serial_from ? ` (${b.serial_from}–${b.serial_to})` : ''),
                            disabled: !b.remaining,
                          }))} filterOption={searchFilter} filterSort={searchRank}/>
                      </Col>
                      <Col xs={12} md={5}>
                        <InputNumber style={{ width: '100%' }} min={1}
                          disabled={viewOnly}
                          max={book?.remaining}
                          value={row.count}
                          onChange={(v) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                            ? { ...x, count: (v as number) ?? undefined } : x)))} />
                      </Col>
                      <Col xs={12} md={4}>
                        <span style={{ fontSize: 14, color: '#4a4a4a' }}>
                          {book?.serial_from ? `${book.serial_from}–${book.serial_to}` : '—'}
                        </span>
                      </Col>
                      <Col xs={24} md={3}>
                        <div className="coupon-actions">
                          {!viewOnly && i === couponRows.length - 1 && (
                            <Button size="small" type="primary" className="sale-green-btn"
                              icon={<PlusOutlined />} title="دفتر آخر"
                              onClick={() => setCouponRows((rs) => [...rs, blankCoupon()])} />
                          )}
                          {!viewOnly && (
                            <Button size="small" danger icon={<DeleteOutlined />} title="حذف الصف"
                              onClick={() => setCouponRows((rs) => (rs.length === 1
                                ? [blankCoupon()]
                                : rs.filter((x) => x.key !== row.key)))} />
                          )}
                        </div>
                      </Col>
                    </Row>
                  );
                })}
                {couponRows.some((r) => Number(r.count || 0) > 0) && (
                  <div className="coupon-note">
                    الإجمالي: {couponRows.reduce((t, r) => t + Number(r.count || 0), 0)} كوبون
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sale-card sale-lines">
            <div className="sale-items-bar">
              <div className="sale-items-info">
                {families.length > 1 && (
                  <Segmented
                    disabled={viewOnly}
                    value={returnFamily ?? ''}
                    onChange={(v: string | number) => setReturnFamily(String(v) || null)}
                    options={families.map((a) => ({
                      value: a.family as string,
                      label: (
                        <span style={{ fontWeight: 700 }}>
                          {a.family}
                          <span style={{ color: '#64748b', marginInlineStart: 6, fontSize: 14,
                                         fontWeight: 400 }}>
                            ({money(Number(a.balance || 0))})
                          </span>
                        </span>
                      ),
                    }))}
                  />
                )}
                <span>
                  عدد البنود الحالية: <b style={{ color: '#0f172a' }}>
                    {lines.filter((l) => l.item_id !== null).length}</b> أصناف
                </span>
              </div>
              {customerId && !viewOnly && (
                <Button data-shortcut="F2"
                  type="primary" className="sale-green-btn" icon={<ShoppingCartOutlined />}
                  style={{ fontWeight: 700 }}
                  onClick={() => setPickerOpen(true)}
                >
                  إضافة صنف للمرتجع (F2)
                </Button>
              )}
            </div>

            {!customerId ? (
              <Empty description="اختر العميل أولاً لعرض آخر أسعار الشراء تلقائياً" style={{ margin: '12px 0' }} />
            ) : (
              <>
                <ProductPickerModal
                  open={pickerOpen}
                  title="اختر الصنف المرتجع"
                  hidePurchasePrice
                  categories={productCategories}
                  categoryLabels={categoryLabels}
                  products={products}
                  activeCategory={activeCategory}
                  onCategoryChange={(c) => { setActiveCategory(c); setPanelItemId(null); }}
                  availableFor={(id) => (docWarehouseId && availability[docWarehouseId]
                    ? (availability[docWarehouseId][id] ?? 0) : null)}
                  availabilityVersion={`${docWarehouseId ?? ''}|${Object.keys(availability).join(',')}`}
                  onCancel={() => setPickerOpen(false)}
                  onPick={(id, q) => {
                    setPickerOpen(false);
                    setPanelItemId(id);
                    addPickedSequentially([id], q ? { [id]: q } : undefined, addProductById, setFocusLineKey);
                  }}
                  onPickMany={async (ids, qtys) => {
                    setPickerOpen(false);
                    await addPickedSequentially(ids, qtys, addProductById, setFocusLineKey);
                    if (ids.length) setPanelItemId(ids[ids.length - 1]);
                  }}
                />

                {lines.length === 0 && viewOnly ? (
                  <Empty description="اختر الفئة ثم الأصناف لإضافتها للمرتجع" style={{ margin: '12px 0' }} />
                ) : (
                  <div className="sale-grid-wrap">
                    <table {...lineGrid.tableProps}>
                      {lineGrid.cols}
                      <thead>{lineGrid.head}</thead>
                      <tbody>
                        {linesByCategory.map((group) => (
                          <React.Fragment key={group.category ?? '__none__'}>
                            {linesByCategory.length > 1 && (
                              <tr className="sale-group-row">
                                <td colSpan={lineGrid.count}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <Tag color="success" style={{ fontWeight: 700, fontSize: 14, padding: '0 6px', borderRadius: 4, margin: 0 }}>
                                        {group.category ? (categoryLabels[group.category] || group.category) : 'بدون فئة'}
                                      </Tag>
                                      <span style={{ color: '#64748b', fontSize: 14, fontWeight: 600 }}>({group.items.length} صنف)</span>
                                    </div>
                                    <span style={{ color: '#64748b', fontSize: 14, fontWeight: 600 }}>
                                      إجمالي الفئة: {money(group.items.reduce((s, l) => s + lineTotal(l), 0))}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {group.items.map((line) => (
                              <React.Fragment key={line.key}>
                                <tr>{lineGrid.row(line, lines.indexOf(line))}</tr>
                                {line.is_serialized && (
                                  <tr>
                                    <td colSpan={lineGrid.count}>
                                      <Input.TextArea
                                        disabled={viewOnly}
                                        size="small" rows={2}
                                        placeholder="السيريالات المرتجعة — رقم في كل سطر بعدد الكمية"
                                        value={(line.serials || []).join(SERIAL_SEP)}
                                        onChange={(e) => handleLineChange(line.key, 'serials',
                                          e.target.value.split(SERIAL_SEP)
                                            .map((x) => x.trim()).filter(Boolean))}
                                      />
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </React.Fragment>
                        ))}
                        <QuickAddRow
                          colSpan={lineGrid.count} disabled={viewOnly} items={products}
                          warehouses={warehouses} warehouseId={docWarehouseId}
                          onWarehouseChange={(w) => { setDocWarehouseId(w); loadWarehouseStock(w); }}
                          onOpenPicker={() => setPickerOpen(true)}
                          onPick={(id) => {
                            setPanelItemId(id);
                            addPickedSequentially([id], undefined, addProductById, setFocusLineKey);
                          }} />
                      </tbody>
                      <tfoot>{lineGrid.foot(lines, (
                        <>الإجماليات: <span style={{ color: '#64748b', fontWeight: 600 }}>
                          ({new Set(lines.filter((l) => l.item_id !== null).map((l) => l.item_id)).size} بنود مختلفة)
                        </span></>
                      ))}</tfoot>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          {(() => {
            const returnDiscount = grossTotal - netTotal;
            const hasParty = !!customerId && customerBalance !== null;
            const balance = customerBalance ?? 0;
            const after = balance - creditReduction;
            return (
              <>
              <div className="sale-card sale-notes">
                <div className="sale-notes-line">
                  <span>نقاط تُخصم من العميل: <b style={{ color: '#F5A11D' }}>
                    {totalPoints.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}</b></span>
                </div>
                <div className="sale-attach">
                  <DocumentAttachments docType="sales_return" docId={viewReturn?.id} title="مرفقات" />
                </div>
              </div>
              <div className="sale-bottom">
              <Row gutter={[10, 10]}>
                <Col xs={24} lg={16}>
                  <div className="sale-tiles">
                    <SummaryTile label="بعد الخصم الثابت" value={money(afterFixedTotal)} />
                    <SummaryTile label="إجمالي الأصناف المرتجعة" value={money(grossTotal)} />
                    {returnDiscount > 0.001 && (
                      <SummaryTile label={`خصم المرتجع (${discountPct}%)`}
                        value={`− ${money(returnDiscount)}`} color="#dc2626" />
                    )}
                    <SummaryTile label="صافي المرتجع" value={money(netTotal)} color="#cf4b1a" />
                    {totalReturnPoints > 0 && (
                      <SummaryTile label="النقاط المستردّة" color="#b26a00"
                        value={totalReturnPoints.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })} />
                    )}
                    {hasParty && families.map((a) => {
                      const b = Number(a.balance || 0);
                      return (
                        <SummaryTile key={a.family} label={`مديونية ${a.family}`}
                          value={money(b)} color={b > 0 ? '#dc2626' : '#16a34a'}
                          active={a.family === returnFamily} />
                      );
                    })}
                    {hasParty && families.length > 1 && (
                      <SummaryTile label="إجمالي المديونية" tone="yellow" value={money(balance)}
                        color={balance > 0 ? '#dc2626' : '#16a34a'} />
                    )}
                    {hasParty && families.length <= 1 && Math.abs(balance) > 0.001 && (
                      <SummaryTile label="حساب سابق على العميل" tone="yellow" value={money(balance)}
                        color={balance > 0 ? '#dc2626' : '#16a34a'} />
                    )}
                    {hasParty && creditReduction > 0.001 && (
                      <SummaryTile label="يُخصم من حسابه (آجل)" tone="mint"
                        value={`− ${money(creditReduction)}`} color="#16a34a" />
                    )}
                    {hasParty && (
                      <SummaryTile label="الباقي على العميل" tone={after > 0.001 ? 'rose' : 'mint'}
                        value={money(after)} color={after > 0.001 ? '#dc2626' : '#15803d'} />
                    )}
                  </div>
                </Col>

                <Col xs={24} lg={8}>
                  <div className="sale-card sale-pay">
                    <div className="sale-pay-inputs">
                      <Form.Item label="خصم على إجمالي المرتجع">
                        <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%"
                          disabled={viewOnly}
                          value={discountPct} onChange={(val) => setDiscountPct(val || 0)} />
                      </Form.Item>
                      <Form.Item label="المبلغ المسترد نقداً">
                        <InputNumber min={0} style={{ width: '100%' }}
                          className="sale-cash-input"
                          disabled={viewOnly}
                          value={cashRefund} onChange={(val) => setCashRefund(val || 0)} />
                      </Form.Item>
                    </div>
                    {!viewOnly && (
                      <div className="sale-pay-actions">
                        <Button type="primary" htmlType="submit"
                          icon={<CheckOutlined />} className="sale-green-btn sale-save-btn">
                          {editingSourceId ? 'حفظ التعديل' : 'تسجيل وحفظ مرتجع المبيعات'} (F9)
                        </Button>
                        <Button onClick={() => closeCreate()}>إلغاء</Button>
                      </div>
                    )}
                  </div>
                </Col>
              </Row>
              </div>
              </>
            );
          })()}
        </Form>

        <LoadPeriodModal
          open={loadPeriodOpen} onCancel={() => setLoadPeriodOpen(false)}
          title="تحميل مرتجعات فترة" endpoint="/api/v1/sales/returns"
          columns={[
            { title: 'المستند', key: 'document_number', width: 150 },
            { title: 'التاريخ', key: 'return_date', width: 120 },
            { title: 'العميل', key: 'customer_name' },
            { title: 'القيمة', key: 'value', width: 130, money: true },
          ]}
          onLoaded={(rows) => setReturns(rows)}
          openNewest dateKey="return_date"
          onPick={(r) => openDetail(r)} />

        <TabModal centered width={560} open={!!histModal} onCancel={() => setHistModal(null)}
          title={`سجل شراء العميل — ${histModal?.name ?? ''}`}
          footer={<Button onClick={() => setHistModal(null)}>إغلاق</Button>}>
          <Table size="small" pagination={false} rowKey="document_number"
            dataSource={histModal?.rows || []}
            locale={{ emptyText: 'لا يوجد سجل شراء لهذا الصنف' }}
            columns={[
              { title: 'الفاتورة', dataIndex: 'document_number', render: (d: string) => <Tag color="blue">{d}</Tag> },
              { title: 'التاريخ', dataIndex: 'date', render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
              { title: 'الكمية', dataIndex: 'quantity', render: (q: string) => Number(q) },
              { title: 'سعر الوحدة', dataIndex: 'unit_price', render: (v: string) => `${money(v)}` },
              { title: 'السعر الفعلي', dataIndex: 'effective_price',
                render: (v: string) => <strong style={{ color: '#6AB42D' }}>{money(v)}</strong> },
            ]} />
        </TabModal>
      </div>
  ) : null;

  const columns = [
    {
      title: 'رقم', dataIndex: 'id', key: 'id', width: 80,
      render: (id: number) => <span style={{ color: '#6b6b6b' }}>{id}</span>,
    },
    {
      title: 'التاريخ', dataIndex: 'return_date', key: 'return_date', width: 105,
      render: (v: string | null, r: ReturnRecord) => (v || String(r.created_at || '').slice(0, 10)
        || '-'),
    },
    {
      title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', ellipsis: true, width: 125,
      render: (doc: string, r: any) => (r.__isDraft
        ? <DraftTag onDelete={() => removeDraft(r.__draft.id)} />
        : <Tag color="volcano">{doc}</Tag>),
    },
    {
      title: 'الفاتورة رقم', dataIndex: 'invoice_document_number', key: 'invoice_document_number',
      width: 125,
      render: (v: string | null, r: ReturnRecord) => (v
        ? <DocRef kind="invoice" id={r.sales_invoice_id} label={v} />
        : <span style={{ color: '#555b65' }}>مستقل</span>),
    },
    {
      title: 'جهه التعامل', dataIndex: 'customer_id', key: 'customer_id', ellipsis: true,
      render: (cId: number, row: any) => (
        <a onClick={(e) => { e.stopPropagation(); navigate(`/customers/${cId}`); }}>
          {row?.customer_name || customers.find((c) => c.id === cId)?.name
            || `عميل #${cId}`}
        </a>
      ),
    },
    {
      title: 'اجمالي قبل', dataIndex: 'gross', key: 'gross', width: 115,
      align: 'left' as const, render: (v: string) => `${money(v)}`,
    },
    {
      title: 'خصم', key: 'discount_value', width: 105, align: 'left' as const,
      render: (_: any, r: ReturnRecord) =>
        `${money(Number(r.gross || 0) * (Number(r.combined_pct || 0) / 100))}`,
    },
    {
      title: 'خصم%', dataIndex: 'combined_pct', key: 'combined_pct', width: 85,
      render: (v: string) => `${Number(v || 0).toFixed(0)}%`,
    },
    {
      title: 'ض.م', dataIndex: 'tax_amount', key: 'tax_amount', width: 100,
      align: 'left' as const, render: (v: string) => `${money(v)}`,
    },
    {
      title: 'الصافى', dataIndex: 'net', key: 'net', width: 115, align: 'left' as const,
      render: (v: string) => <strong style={{ color: '#cf4b1a' }}>{money(v)}</strong>,
    },
    {
      title: 'النوع',
      dataIndex: 'family',
      key: 'family',
      width: 90,
      render: (f: string | null) => f ? <Tag color="geekblue">{f}</Tag> : '-',
    },
    {
      title: 'مندوب', dataIndex: 'rep_id', key: 'rep_id', width: 150, ellipsis: true,
      render: (v: number | null, r: any) => {
        const rep = reps.find((x) => x.id === v);
        const name = rep ? (rep.full_name || rep.username) : r?.rep_name;
        return name || <span style={{ color: '#555b65' }}>-</span>;
      },
    },
    {
      title: 'مستند رقم', dataIndex: 'external_document_number', key: 'external_document_number',
      width: 130,
      render: (v: string | null) => v ?? <span style={{ color: '#555b65' }}>-</span>,
    },
    {
      title: 'ملاحظات', dataIndex: 'notes', key: 'notes', ellipsis: true,
      render: (v: string | null) => v ?? <span style={{ color: '#555b65' }}>-</span>,
    },
    {
      title: 'تم السداد', dataIndex: 'cash_refund', key: 'cash_refund', width: 110,
      align: 'left' as const, render: (v: string) => `${money(v)}`,
    },
    {
      title: 'الباقى', dataIndex: 'credit_reduction', key: 'credit_reduction', width: 110,
      align: 'left' as const, render: (v: string) => `${money(v)}`,
    },
    {
      title: 'الإجراءات', key: 'actions', width: 140,
      render: (_: any, record: ReturnRecord) => ((record as any).__isDraft ? (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="مسح المسودّة">
            <Button type="text" danger icon={<DeleteOutlined />}
              onClick={() => removeDraft((record as any).__draft.id)} />
          </Tooltip>
        </Space>
      ) : (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="عرض المرتجع">
            <Button type="text" icon={<EyeOutlined />}
              onClick={() => openDetail(record)} />
          </Tooltip>
          <Tooltip title="طباعة">
            <Button type="text" icon={<PrinterOutlined />}
              onClick={async () => {
                try {
                  const res = await api.get(`/api/v1/sales/returns/${record.id}`);
                  const doc = returnDoc(res.data);
                  if (doc) printInvoice(doc, printOpts);
                } catch (err) {
                  message.error('تعذر تحميل بيانات الطباعة');
                }
              }} />
          </Tooltip>
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} disabled={!canWriteReturn}
              onClick={() => handleEditReturn(record)} />
          </Tooltip>
          <Tooltip title="حذف">
            <Button type="text" danger icon={<DeleteOutlined />} disabled={!canWriteReturn}
              onClick={() => {
                Modal.confirm({
                  title: 'تأكيد حذف مردود المبيعات',
                  icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
                  content: `هل أنت متأكد من حذف سند المردود رقم (${record.document_number || ''})؟`,
                  okText: 'نعم، احذف',
                  okType: 'danger',
                  cancelText: 'إلغاء',
                  onOk: async () => {
                    await handleDeleteReturn(record);
                  },
                });
              }} />
          </Tooltip>
        </Space>
      )),
    },
  ];

  const visibleColumns = returnCols.apply(columns);

  const footer = (
    <span className="sl-foot">
      <span>عدد المرتجعات الظاهرة: <b>{summary.count.toLocaleString(numeralsLocale())}</b></span>
      <span>إجمالي صافي المرتجعات: <b>{money(summary.net)}</b></span>
      <span>إجمالي الخصم من الحسابات: <b>{money(summary.credit)}</b></span>
    </span>
  );

  const list = (
    <ListPage
      icon={<RollbackOutlined />}
      title="مرتجعات المبيعات"
      actions={(<>
        <Button type="primary" className="sl-create" icon={<PlusOutlined />}
          onClick={() => { setReturnDate(dayjs()); setNewStep('party'); }}>
          تسجيل مرتجع بيع
        </Button>
        <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
        <ExportExcelButton
          name="مرتجعات المبيعات"
          rows={returns}
          tableColumns={visibleColumns}
          style={{ marginInlineStart: 0 }}
        />
        <ColumnSettings
          choices={columns.map((c: any) => ({
            key: String(c.key ?? c.dataIndex ?? ''),
            title: typeof c.title === 'string' ? c.title : '',
            locked: c.key === 'document_number',
          }))}
          hidden={returnCols.hidden}
          onChange={returnCols.setHidden}
          order={returnCols.order}
          onMove={(k, d) => returnCols.move(k, d, columns.map((c) => String(c.key ?? (c as any).dataIndex ?? '')))}
        />
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear value={search} placeholder="بحث برقم السند"
          prefix={<SearchOutlined />}
          onChange={(e) => setSearch(e.target.value)} onPressEnter={applySearch} onBlur={applySearch} />
        <Select className="sl-f-customer" allowClear showSearch placeholder="العميل"
          value={filters.customer_id} onChange={(v) => setFilter('customer_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={filterCustomerOptions} />
        <Select allowClear showSearch placeholder="المندوب"
          value={filters.rep_id} onChange={(v) => setFilter('rep_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={sortByName(reps, (r) => r.full_name || r.username)
            .map((r) => ({ value: r.id, label: r.full_name || r.username }))} />
        <Input.Search allowClear placeholder="البيان..." value={stmtText}
          onChange={(e) => { setStmtText(e.target.value); if (!e.target.value) setFilter('statement', undefined); }}
          onSearch={(v) => setFilter('statement', v.trim() || undefined)} />
        <DateRangeFilter
          className="sl-f-dates"
          value={filters.date_from && filters.date_to
            ? [dayjs(filters.date_from), dayjs(filters.date_to)] : null}
          onChange={(v) => {
            const next = {
              ...filters,
              date_from: v?.[0] ? v[0].format('YYYY-MM-DD') : undefined,
              date_to: v?.[1] ? v[1].format('YYYY-MM-DD') : undefined,
            };
            setFilters(next); fetchReturns(next);
          }}
        />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={resetFilters}>مسح</Button>
      </>)}
    >
        <Table
          className="sl-table"
          dataSource={[
            ...(drafts || []).map((d: any) => {
              const x = d.payload || {};
              const ls = (x.lines || []).filter((l: any) => l.item_id != null);
              const net = ls.reduce((t: number, l: any) =>
                t + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
              return {
                id: -d.id, __draft: d, __isDraft: true,
                document_number: 'مسودّة',
                created_at: d.updated_at,
                return_date: String(x.return_date || d.updated_at || '').slice(0, 10),
                customer_id: x.customer_id ?? null,
                net, value: net,
              } as any;
            }),
            ...returns,
          ]}
          rowClassName={(r: any) => (r.__isDraft ? 'row-draft' : '')}
          columns={visibleColumns} rowKey="id" loading={loading}
          size="small" tableLayout="fixed"
          pagination={{
            defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
            locale: { items_per_page: '' },
            showTotal: () => footer,
          }}
          onRow={(record: any) => ({
            onClick: () => (record.__isDraft ? resumeDraft(record.__draft) : openDetail(record)),
            style: { cursor: 'pointer' },
          })}
        />
    </ListPage>
  );

  const onExit = embedded?.onExit;
  useEffect(() => {
    if (onExit && !createVisible && !newStep) onExit();
  }, [onExit, createVisible, newStep]);

  if (docOpening) return <DocOpening />;
  return (
    <div style={screen
      ? { minHeight: '100%', display: 'flex', flexDirection: 'column' } : undefined}>
      {doors}
      {screen ?? (embedded ? null : list)}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFactoryBranch } from '../components/useFactoryBranch';
import { PAGE_SIZE as TABLE_PAGE_SIZE, PAGE_SIZE_OPTIONS }
  from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { customersOfRep, customerFitsRep } from '../utils/repScope';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Divider, Empty, Form, Input, Modal, Result, Row, Segmented, Select, Space, Spin, Tag,
  Tooltip, Typography, message,
} from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, PrinterOutlined, DeleteOutlined,
  EditOutlined, RollbackOutlined, EyeOutlined, ExclamationCircleOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, SearchOutlined, ClearOutlined,
  FileAddOutlined, UndoOutlined, SaveOutlined, BankOutlined, ReloadOutlined,
  PhoneOutlined, CheckOutlined, ShoppingCartOutlined, GiftOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDocReturn } from '../components/docReturn';
import DocOpening from '../components/DocOpening';
import { useOnScreen } from '../components/keyboard';
import { useOpenDocument } from '../components/DocumentLink';
import dayjs, { Dayjs } from 'dayjs';
import CostCenterField from '../components/CostCenterField';
import CostCenterSplit from '../components/CostCenterSplit';
import DocumentBar from '../components/DocumentBar';
import { api } from '../api/client';
import { statementMeta } from '../utils/statements';
import { useDraft } from '../components/useDraft';
import { combineDiscounts, netOf } from '../utils/discounts';
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice } from '../components/InvoiceDocument';
import CustomerAccountPanel from '../components/CustomerAccountPanel';
import PartyPickerModal, { Party } from '../components/PartyPickerModal';
import LoadPeriodModal from '../components/LoadPeriodModal';
import QuickAddRow from '../components/QuickAddRow';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import DocumentHistoryButton from '../components/DocumentHistory';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import ProductPickerModal from '../components/ProductPickerModal';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import ExportExcelButton from '../components/ExportExcelButton';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
import { guardQuantity } from '../components/quantityGuard';
import { useAuth } from '../components/AuthProvider';
import SummaryTile from '../components/saleDoc/SummaryTile';
import PaymentsLogPanel, { type PaymentsLogTotals } from '../components/PaymentsLogPanel';
import { useLookup, labelMap } from '../hooks/useLookup';
import { TabModal } from '../components/TabModal';
import WarehouseGate from '../components/WarehouseGate';
import DocumentAttachments from '../components/DocumentAttachments';
import TreasuryGate, { useTreasuryGate } from '../components/TreasuryGate';
import DateRangeFilter from '../components/DateRangeFilter';
import { money, numeralsLocale } from '../utils/money';
import { convertUnitPrice, dualQty, factorOf, unitSelectOptions } from '../utils/units';
import { fingerprint, verdictOnLeave } from '../utils/unsavedWork';
import { useFocusedIds, FocusedRowsBanner } from '../components/FocusedRows';
import { applyPct, combinePct } from '../utils/discounts';
import { QTY_DATA_ATTR } from '../utils/duplicateItem';
import { addPickedSequentially, type PickResult } from '../utils/pickMany';

import {
  CAP_NOTICE_MS, PAGE_SIZE, FAMILY_OPTIONS, TIER_LABELS, couponCount, blankCoupon,
  InvoiceRecord, ItemPrices, Customer, RepEmployee, Product, Warehouse, SaleLineItem,
  ItemUnit, InvoiceDetail, InvoiceFilters, CouponRow, couponRowHasContent,
} from './invoices/types';
import { afterFixedOf, buildLineColumns } from './invoices/lineColumns';
import { buildRegisterColumns } from './invoices/registerColumns';
import ReceiptModal from './vouchers/ReceiptModal';
import { useQuickVoucher, fetchVoucher, type EditableVoucher } from './vouchers/useQuickVoucher';
import { useRegisterReceipts } from './invoices/useRegisterReceipts';
import { useLiveRefresh } from '../utils/live';
import ListPage, { ListStat } from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { repOptions } from '../utils/reps';
import { activeOptions } from '../utils/active';
const ReturnsScreen = React.lazy(() => import('./Returns'));

const newUuid = (): string =>
  (globalThis.crypto as any)?.randomUUID?.()
  ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;

export default function Invoices() {
  const { options: categoryOptions } = useLookup('item_category');
  const { options: couponKindOptions } = useLookup('coupon_kind');
  const isFactory = useIsFactoryBranch();
  const categoryLabels = labelMap(categoryOptions);
  const navigate = useNavigate();
  const [filters, setFilters] = useState<InvoiceFilters>({});
  const [search, setSearch] = useState('');
  const [stmtText, setStmtText] = useState('');
  const listSearchRef = useRef<any>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [employees, setEmployees] = useState<RepEmployee[]>([]);
  const [reps, setReps] = useState<{ id: number; full_name: string }[]>([]);
  const [postingAccounts, setPostingAccounts] = useState<any[]>([]);
  const [printOpts, setPrintOpts] = useState<PrintOptions>(loadPrintOptions);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [pointValues, setPointValues] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  const [docOpening, setDocOpening] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [formTick, setFormTick] = useState(0);
  const [loadRangeOpen, setLoadRangeOpen] = useState(false);
  const [periodRows, setPeriodRows] = useState<any[] | null>(null);

  const invoiceCols = useHiddenColumns('invoices-list', [
    'revenue_account_id', 'discount_value', 'coupons', 'payment_state', 'notes',
  ]);
  const [viewInvoice, setViewInvoice] = useState<any>(null);
  const [viewReturns, setViewReturns] = useState<any[]>([]);
  const [editingInvoice, setEditingInvoice] = useState<{ id: number; voided: boolean } | null>(null);
  const [openedFingerprint, setOpenedFingerprint] = useState<string | null>(null);
  const [docCashAccountId, setDocCashAccountId] = useState<number | null>(null);

  const [createForm] = Form.useForm();

  const blankLine = (key: string, tier: string | null = null): SaleLineItem => ({
    key, category: null, item_id: null, quantity: null, unit_price: 0, tier, unit: null,
    serials: '', fixed_discount: 0, variable_discount: null, warehouse_id: null,
  });
  const [lines, setLines] = useState<SaleLineItem[]>([]);
  const [pricesCache, setPricesCache] = useState<Record<number, ItemPrices>>({});
  const [unitsCache, setUnitsCache] = useState<Record<number, ItemUnit[]>>({});
  const [customerTier, setCustomerTier] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerBalance, setCustomerBalance] = useState<number | null>(null);
  const [familyAccounts, setFamilyAccounts] = useState<
    { family: string | null; balance: string }[]>([]);
  const [invoiceFamily, setInvoiceFamily] = useState<string | null>(null);
  const FAMILIES = ['أبيض', 'بولي'];
  const families = FAMILIES.map((f) => ({
    family: f,
    balance: familyAccounts.find((a) => a.family === f)?.balance ?? '0',
  })).concat(familyAccounts.filter(
    (a) => a.family && !FAMILIES.includes(a.family)) as { family: string; balance: string }[]);
  const [customerCoupons, setCustomerCoupons] = useState<any[]>([]);
  const [panelItemId, setPanelItemId] = useState<number | null>(null);

  const { can, user } = useAuth();
  const canEditInvoice = can('sale.edit');
  const canBonus = can('sale.bonus');
  const canWriteReturn = can('return.write');
  const { ask: askTreasury, gateProps: treasuryGate } = useTreasuryGate(
    user?.role !== 'sales_rep');
  const canDeleteInvoice = can('sale.delete');


  const [couponRows, setCouponRows] = useState<CouponRow[]>(() => [blankCoupon()]);
  const invoiceRepId = Form.useWatch('rep_id', createForm) as number | undefined;
  const [repCustody, setRepCustody] = useState<
    { coupon_kind: string; available: number; ranges: string[][] }[]>([]);
  useEffect(() => {
    if (!invoiceRepId) { setRepCustody([]); return undefined; }
    let alive = true;
    api.get('/api/v1/coupon-custody/balance', { params: { rep_user_id: invoiceRepId } })
      .then((r) => { if (alive) setRepCustody(r.data || []); })
      .catch(() => { if (alive) setRepCustody([]); });
    return () => { alive = false; };
  }, [invoiceRepId]);
  const qtyRefs = useRef<Record<string, any>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;
  const onScreen = useOnScreen();
  const onScreenRef = useRef(onScreen);
  onScreenRef.current = onScreen;
  const docReturn = useDocReturn();
  const openDoc = useOpenDocument();
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);

  const [invoiceDate, setInvoiceDate] = useState<any>(dayjs());
  const [availability, setAvailability] = useState<Record<number, Record<number, number>>>({});
  const excludeDocRef = useRef<number | null>(null);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [newStep, setNewStep] = useState<null | 'date' | 'party' | 'warehouse' | 'family'>(null);
  const [party, setParty] = useState<Party | null>(null);
  const [docWarehouseId, setDocWarehouseId] = useState<number | null>(null);
  const [minPrices, setMinPrices] = useState<Record<number, number>>({});
  const [canSellBelowCost, setCanSellBelowCost] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/api/v1/items/min-prices').then((r) => {
      if (!alive) return;
      const out: Record<number, number> = {};
      Object.entries(r.data?.min_prices || {}).forEach(([k, v]) => { out[Number(k)] = Number(v); });
      setMinPrices(out);
      setCanSellBelowCost(!!r.data?.can_sell_below_cost);
    }).catch(() => {});
    return () => { alive = false; };
  }, [docWarehouseId]);
  const doorWarehouseRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const clientUuidRef = useRef<string | null>(null);
  doorWarehouseRef.current = docWarehouseId;
  const [pendingItems, setPendingItems] = useState<number[]>([]);
  const [pendingWarehouse, setPendingWarehouse] = useState<number | null>(null);
  const pendingQtys = useRef<Record<number, number>>({});
  const lineSeq = useRef(0);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [isBonus, setIsBonus] = useState(false);
  const [bonusForId, setBonusForId] = useState<number | null>(null);
  const bonusLinkedRef = useRef<{ id: number; number: string } | null>(null);
  const [bonusTargets, setBonusTargets] = useState<
    { id: number; document_number: string; invoice_date?: string | null; net: string }[]>([]);
  const [creditAmount, setCreditAmount] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [salesReturns, setSalesReturns] = useState<any[]>([]);
  const [serverSummary, setServerSummary] = useState<any>(null);
  const [docKindRaw, setDocKindFilter] = useQueryTab('all');
  const docKindFilter = docKindRaw as 'all' | 'sale' | 'return' | 'bonus' | 'receipts';
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [receiptsSlot, setReceiptsSlot] = useState<HTMLSpanElement | null>(null);
  const [receiptsTotals, setReceiptsTotals] = useState<PaymentsLogTotals | null>(null);
  const [receiptFamilies, setReceiptFamilies] = useState<Record<number, any[]>>({});
  const [receiptTarget, setReceiptTarget] = useState('');
  const [receiptsKey, setReceiptsKey] = useState(0);
  const receipt = useQuickVoucher(() => setReceiptsKey((k) => k + 1));
  const [embeddedReturn, setEmbeddedReturn] = useState(false);
  const [returnsReload, setReturnsReload] = useState(0);
  const exitEmbeddedReturn = useCallback(() => {
    setEmbeddedReturn(false);
    setReturnsReload((n) => n + 1);
  }, []);
  const [bonusInvoices, setBonusInvoices] = useState<InvoiceRecord[]>([]);

  const focus = useFocusedIds();
  const focusRef = useRef<string | null>(null);
  focusRef.current = focus.ids ? Array.from(focus.ids).join(',') : null;

  const fetchInvoices = async (override?: InvoiceFilters, opts?: { silent?: boolean }) => {
    const active = override ?? filters;
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const params: any = {};
      Object.entries(active).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      });
      const focusIds = focusRef.current;
      const [salesRes, bonusRes, returnsRes, sumRes] = await Promise.all([
        api.get('/api/v1/sales', {
          params: { ...params, kind: 'sale', limit: PAGE_SIZE, ...(focusIds ? { ids: focusIds } : {}) },
        }),
        api.get('/api/v1/sales', {
          params: { ...params, kind: 'bonus', limit: PAGE_SIZE, ...(focusIds ? { ids: focusIds } : {}) },
        }).catch(() => ({ data: [] })),
        api.get('/api/v1/sales/returns', {
          params: { ...params, payment: undefined, limit: PAGE_SIZE } })
          .catch(() => ({ data: [] })),
        api.get('/api/v1/sales/summary', {
          params: { ...params, ...(focusIds ? { ids: focusIds } : {}) },
        }).catch(() => ({ data: null })),
      ]);
      setInvoices(salesRes.data);
      setBonusInvoices(bonusRes.data || []);
      setSalesReturns(returnsRes.data || []);
      setServerSummary(sumRes.data || null);
    } catch (err: any) {
      console.error(err);
      if (!silent) message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الفواتير والمرتجعات');
    } finally {
      if (!silent) setLoading(false);
    }
  };
  useLiveRefresh(['sales'], () => fetchInvoices(undefined, { silent: true }));

  const setFilter = (key: keyof InvoiceFilters, value: any) => {
    const next = { ...filters, [key]: value };
    if (key === 'rep_id' && !customerFitsRep(customers, next.customer_id, next.rep_id)) {
      next.customer_id = undefined;
    }
    setFilters(next);
    fetchInvoices(next);
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

  const resetFilters = () => {
    setStmtText('');
    setSearch('');
    setFilters({});
    fetchInvoices({});
  };

  const registerReceipts = useRegisterReceipts({
    enabled: docKindFilter === 'all' && !focus.ids, filters, reloadKey: receiptsKey,
  });
  const receiptRows = registerReceipts.rows;

  const unifiedRecords = useMemo(() => {
    const toSaleRow = (s: any) => {
      const bonusGross = s.is_bonus ? Number(s.gross_before_line_discount || 0) : null;
      const gross = bonusGross ?? Number(s.gross || 0);
      return {
      id: s.id,
      rowKey: `sale-${s.id}`,
      doc_type: 'sale' as const,
      doc_type_label: s.is_bonus ? 'فاتورة بونص' : 'فاتورة بيع',
      document_number: s.document_number,
      original_invoice_number: null,
      external_document_number: s.external_document_number,
      statement1: s.statement1 ?? null,
      date: String(s.invoice_date || s.created_at || '').slice(0, 10),
      customer_id: s.customer_id,
      rep_id: s.rep_id,
      customer_name: s.customer_name,
      rep_name: s.rep_name,
      customer_type: s.customer_type,
      revenue_account_id: s.revenue_account_id,
      family: s.family,
      is_bonus: Boolean(s.is_bonus),
      bonus_for_number: s.bonus_for_number ?? null,
      bonus_for_invoice_id: s.bonus_for_invoice_id ?? null,
      gross,
      combined_pct: Number(s.combined_pct || 0),
      discount_value: gross - Number(s.net || 0),
      discount_base: bonusGross ?? (Number(s.gross_before_line_discount || 0) || Number(s.gross || 0)),
      net: Number(s.net || 0),
      cash_amount: Number(s.cash_amount || 0),
      credit_amount: Number(s.credit_amount || 0),
      payment_state: s.payment_state ?? null,
      payment_state_label: s.payment_state_label ?? null,
      residual: s.residual ?? null,
      ledger_entry_id: s.ledger_entry_id,
      raw: s,
      };
    };
    const saleRows = (invoices || []).filter((s: any) => !s.is_bonus).map(toSaleRow);
    const bonusRows = (bonusInvoices || []).map(toSaleRow);

    const returnRows = (salesReturns || []).map((r: any) => ({
      id: r.id,
      rowKey: `ret-${r.id}`,
      doc_type: 'return' as const,
      doc_type_label: 'مرتجع بيع',
      document_number: r.document_number,
      original_invoice_number: r.invoice_document_number,
      external_document_number: r.external_document_number,
      statement1: r.statement1 ?? null,
      date: String(r.return_date || r.created_at || '').slice(0, 10),
      customer_id: r.customer_id,
      rep_id: r.rep_id,
      customer_name: r.customer_name,
      rep_name: r.rep_name,
      customer_type: r.customer_type,
      revenue_account_id: null,
      family: r.family || null,
      gross: Number(r.gross || 0),
      combined_pct: Number(r.combined_pct || 0),
      discount_value: Number(r.gross || 0) - Number(r.net || 0),
      discount_base: Number(r.gross || 0),
      net: Number(r.net || 0),
      cash_amount: Number(r.cash_refund || 0),
      credit_amount: Number(r.credit_reduction || 0),
      ledger_entry_id: r.ledger_entry_id,
      raw: r,
    }));

    let combined: any[] = [];
    if (docKindFilter === 'all') {
      combined = [...saleRows, ...bonusRows, ...returnRows, ...receiptRows];
    } else if (docKindFilter === 'sale') {
      combined = saleRows;
    } else if (docKindFilter === 'bonus') {
      combined = bonusRows;
    } else if (docKindFilter === 'receipts') {
      combined = [];
    } else {
      combined = returnRows;
    }

    return combined.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
  }, [invoices, bonusInvoices, salesReturns, receiptRows, docKindFilter]);

  const focusKey = focusRef.current ?? '';
  useEffect(() => { fetchInvoices(); /* eslint-disable-next-line */ }, [focusKey]);
  useEffect(() => { if (returnsReload) fetchInvoices(); /* eslint-disable-next-line */ }, [returnsReload]);

  const focusedRecords = useMemo(
    () => focus.filter(unifiedRecords, (r: any) => r.id),
    [focus, unifiedRecords],
  );

  const summary = useMemo(() => {
    const totalSalesCount = (invoices || []).length;
    const totalReturnsCount = (salesReturns || []).length;
    const totalSalesNet = (invoices || []).reduce((s: number, i: any) => s + Number(i.net || 0), 0);
    const totalReturnsNet = (salesReturns || []).reduce((s: number, r: any) => s + Number(r.net || 0), 0);
    const netSales = totalSalesNet - totalReturnsNet;
    const totalCredit = (invoices || []).reduce((s: number, i: any) => s + Number(i.credit_amount || 0), 0)
      - (salesReturns || []).reduce((s: number, r: any) => s + Number(r.credit_reduction || 0), 0);

    const bonusGross = (bonusInvoices || []).reduce(
      (t: number, i: any) => t + Number(i.gross_before_line_discount || 0), 0);
    const sumOf = (list: any[], get: (x: any) => any) =>
      (list || []).reduce((t: number, x: any) => t + Number(get(x) || 0), 0);
    const localGross = sumOf(invoices, (i) => i.gross_before_line_discount || i.gross);

    const s = serverSummary;
    return {
      totalBonusCount: s?.bonus_count != null ? Number(s.bonus_count) : (bonusInvoices || []).length,
      totalBonusGross: s?.bonus_gross != null ? Number(s.bonus_gross) : bonusGross,
      totalSalesCount: s ? Number(s.sales_count) : totalSalesCount,
      totalReturnsCount: s ? Number(s.returns_count) : totalReturnsCount,
      totalSalesNet: s ? Number(s.sales_net) : totalSalesNet,
      totalReturnsNet: s ? Number(s.returns_net) : totalReturnsNet,
      netSales: s ? Number(s.net_sales) : netSales,
      totalCredit: s ? Number(s.credit_outstanding) : totalCredit,
      salesGross: s?.sales_gross != null ? Number(s.sales_gross) : localGross,
      salesDiscount: s?.sales_discount != null ? Number(s.sales_discount) : localGross - totalSalesNet,
      salesCash: s?.sales_cash != null ? Number(s.sales_cash) : sumOf(invoices, (i) => i.cash_amount),
      salesCredit: s?.sales_credit != null ? Number(s.sales_credit) : sumOf(invoices, (i) => i.credit_amount),
      returnsCash: s?.returns_cash != null ? Number(s.returns_cash) : sumOf(salesReturns, (r) => r.cash_refund),
      returnsCredit: s?.returns_credit != null ? Number(s.returns_credit)
        : sumOf(salesReturns, (r) => r.credit_reduction),
      partial: !s,
      filteredCount: unifiedRecords.length,
    };
  }, [invoices, bonusInvoices, salesReturns, unifiedRecords, serverSummary]);

  const loadLookups = async () => {
    try {
      const [custRes, prodRes, whRes, ptRes, empRes, userRes, acctRes,
        brRes] = await Promise.all([
        api.get('/api/v1/customers/options', { params: { limit: 20000 } }),
        api.get('/api/v1/items?kind=product'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/products/point-values'),
        api.get('/api/v1/employees'),
        api.get('/api/v1/users'),
        api.get('/api/v1/accounts?postable_only=true').catch(() => ({ data: [] })),
        api.get('/api/v1/branches').catch(() => ({ data: [] })),
      ]);
      setCustomers(custRes.data);
      setProducts(prodRes.data);
      setWarehouses(whRes.data);
      setEmployees(empRes.data);
      setReps(userRes.data.filter((u: any) => u.role === 'sales_rep'));
      setPostingAccounts(acctRes.data || []);
      setBranches(brRes.data || []);
      const pts: Record<number, number> = {};
      (ptRes.data || []).forEach((r: any) => { pts[r.item_id] = parseFloat(r.point_value) || 0; });
      setPointValues(pts);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل قوايم الشاشة');
    }
  };

  useEffect(() => {
    loadLookups();
  }, []);

  const productCategories = React.useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [products]);

  const linesByCategory = React.useMemo(
    () => (lines.length ? [{ category: null as string | null, items: lines as SaleLineItem[] }] : []),
    [lines]);

  const defaultFixedDiscount = (itemId: number | null, fresh?: ItemPrices): number => {
    const cust = customers.find((c) => c.id === selectedCustomerId);
    if (cust?.discount_pct != null && cust.discount_pct !== '') {
      return parseFloat(cust.discount_pct) || 0;
    }
    const tier = customerTier;
    const cached = fresh ?? (itemId ? pricesCache[itemId] : undefined);
    if (tier && cached?.discounts?.[tier]) return cached.discounts[tier];
    const prod = products.find((p) => p.id === itemId);
    return prod?.default_discount_pct ? parseFloat(prod.default_discount_pct) : 0;
  };

  const lineDiscountPct = (l: SaleLineItem) =>
    Math.min(99.99, combinePct(l.fixed_discount, l.variable_discount));

  const checkedQuantity = (l: SaleLineItem) => guardQuantity({
    value: l.quantity,
    available: l.warehouse_id
      ? availableFor(l.item_id, l.unit, l.warehouse_id) : undefined,
    itemName: l.item_id ? productName(l.item_id) : null,
  }, null);

  const saleLineNet = (l: SaleLineItem) => lineTotal(l);

  const saleUnitOptions = (itemId: number | null) => unitSelectOptions(unitsCache[itemId || 0]);

  const availabilityHint = (l: SaleLineItem): string | null => {
    if (!l.item_id) return null;
    const units = unitsCache[l.item_id];
    if (!units || !units.some((u) => !u.is_base)) return null;
    const wh = lineWarehouse(l);
    if (!wh || !availability[wh]) return null;
    return `المتاح ${dualQty(availability[wh][l.item_id] ?? 0, units)}`;
  };

  const advanceFrom = (key: string) => {
    const idx = lines.findIndex((l) => l.key === key);
    const next = idx >= 0 ? lines[idx + 1] : undefined;
    if (next) { setFocusLineKey(next.key); return; }
    setPickerOpen(true);
  };

  const lineTotal = (l: SaleLineItem) => (isBonus
    ? applyPct(Number(l.quantity || 0) * l.unit_price, l.fixed_discount)
    : applyPct(Number(l.quantity || 0) * l.unit_price, l.fixed_discount, l.variable_discount));

  const linePoints = (l: SaleLineItem) =>
    (l.item_id ? (pointValues[l.item_id] || 0) : 0) * (l.quantity || 0);

  const grossTotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const afterFixedTotal = lines.reduce((sum, line) => sum + afterFixedOf(line), 0);
  const netTotal = isBonus ? 0 : netOf(grossTotal, discountPct);

  const totalPoints = lines.reduce((sum, line) => sum + linePoints(line), 0);

  useEffect(() => {
    const cash = parseFloat(cashAmount.toString()) || 0;
    setCreditAmount(parseFloat((netTotal - cash).toFixed(2)));
  }, [cashAmount, netTotal, discountPct]);

  const resetDocument = (opts?: { keepUrl?: boolean }) => {
    clientUuidRef.current = null;
    setViewOnly(false);
    setViewInvoice(null);
    if (opts?.keepUrl) { closedDocRef.current = docInUrl.current; docInUrl.current = null; }
    else clearDocParam();
    setViewReturns([]);
    setEditingInvoice(null);
    setOpenedFingerprint(null);
    setDocCashAccountId(null);
    setLines([]);
    setCouponRows([blankCoupon()]);
    setCustomerCoupons([]);
    setActiveCategory(null);
    setPanelItemId(null);
    setFocusLineKey(null);
    setCashAmount(0);
    setCreditAmount(0);
    setDiscountPct(0);
    setIsBonus(false);
    setBonusForId(null);
    setBonusTargets([]);
    bonusLinkedRef.current = null;
    setSelectedCustomerId(null);
    setCustomerTier(null);
    setCustomerBalance(null);
    setFamilyAccounts([]);
    setInvoiceFamily(null);
    setAvailability({});
    excludeDocRef.current = null;
    setParty(null);
    setDocWarehouseId(null);
    setPendingItems([]);
    pendingQtys.current = {};
    setPendingWarehouse(null);
    setPickerOpen(false);
    setPartyPickerOpen(false);
    setNewStep(null);
    setInvoiceDate(dayjs());
    createForm.resetFields();
  };

  const fingerprintOf = (v: {
    lines: SaleLineItem[]; discountPct: any; cashAmount: any; invoiceDate: any;
    family: any; couponRows: any[]; form: any;
  }) => fingerprint({
    lines: v.lines.map((l) => ({
      item_id: l.item_id, quantity: l.quantity, unit_price: l.unit_price,
      fixed_discount: l.fixed_discount, variable_discount: l.variable_discount,
      warehouse_id: l.warehouse_id, unit: l.unit, tier: l.tier, serials: l.serials,
    })),
    discountPct: v.discountPct,
    cashAmount: v.cashAmount,
    invoiceDate: v.invoiceDate ? dayjs(v.invoiceDate).format('YYYY-MM-DD') : null,
    family: v.family,
    coupons: (v.couponRows || []).map((c: any) => ({
      coupon_kind: c.coupon_kind, count: c.count,
      serial_from: c.serial_from, serial_to: c.serial_to,
    })),
    form: {
      customer_id: v.form?.customer_id, rep_id: v.form?.rep_id,
      external_document_number: v.form?.external_document_number,
      notes: v.form?.notes, cost_center_id: v.form?.cost_center_id,
      cost_center_distribution: v.form?.cost_center_distribution,
      statement1: v.form?.statement1, statement2: v.form?.statement2,
      statement3: v.form?.statement3,
    },
  });

  const currentFingerprint = () => fingerprintOf({
    lines, discountPct, cashAmount, invoiceDate, family: invoiceFamily,
    couponRows, form: createForm.getFieldsValue(),
  });

  const draftPayload = useMemo(() => ({
    lines: lines.map((l) => ({
      item_id: l.item_id, quantity: l.quantity, unit_price: l.unit_price,
      fixed_discount: l.fixed_discount, variable_discount: l.variable_discount,
      warehouse_id: l.warehouse_id, unit: l.unit, tier: l.tier, serials: l.serials,
    })),
    discountPct,
    cashAmount,
    invoice_date: invoiceDate ? dayjs(invoiceDate).format('YYYY-MM-DD') : null,
    family: invoiceFamily,
    couponRows,
    form: createForm.getFieldsValue(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lines, discountPct, cashAmount, invoiceDate, invoiceFamily, couponRows, formTick]);

  const {
    drafts, discard: discardDraft, adopt: adoptDraft, remove: removeDraft,
  } = useDraft({
    kind: 'sale',
    payload: draftPayload,
    paused: Boolean(viewOnly || editingInvoice),
    isEmpty: (x: any) => !x?.form?.customer_id
      && !(x?.lines || []).some((l: any) => l.item_id != null),
    title: (x: any) => {
      const n = (x?.lines || []).filter((l: any) => l.item_id != null).length;
      return `فاتورة بيع — ${n} صنف`;
    },
  });

  const resumeDraft = (d: any) => {
    const x = d.payload || {};
    adoptDraft(d.id);
    setEditingInvoice(null);
    setViewOnly(false);
    if (x.invoice_date) setInvoiceDate(dayjs(x.invoice_date));
    setDiscountPct(Number(x.discountPct) || 0);
    setCashAmount(Number(x.cashAmount) || 0);
    setInvoiceFamily(x.family ?? null);
    if (Array.isArray(x.couponRows) && x.couponRows.length) setCouponRows(x.couponRows);
    createForm.setFieldsValue(x.form || {});
    setLines((x.lines || []).map((l: any, i: number) => ({ ...l, key: String(i + 1) })));
    setCreateVisible(true);
  };

  const finishClose = (stay = false) => {
    if (!stay && docReturn.origin()) {
      resetDocument({ keepUrl: true });
      setCreateVisible(false);
      if (!docReturn.leave()) clearDocParam();
      return;
    }
    resetDocument();
    setCreateVisible(false);
  };

  const closeCreate = (opts?: { stay?: boolean }) => {
    const leave = () => finishClose(opts?.stay === true);
    const verdict = verdictOnLeave({
      readOnly: viewOnly,
      savedDocument: editingInvoice != null,
      now: currentFingerprint(),
      whenOpened: openedFingerprint,
      hasWork: lines.length > 0 || selectedCustomerId != null || Number(cashAmount || 0) > 0,
    });
    if (verdict === 'silent') { leave(); return; }
    Modal.confirm({
      title: verdict === 'confirm-edit' ? 'تسيب التعديل؟' : 'تسيب المستند؟',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: verdict === 'confirm-edit'
        ? 'التعديلات اللي عملتها مااتحفظتش. الفاتورة نفسها هتفضل زي ما هي.'
        : lines.length
          ? `فيه ${lines.length} صنف بإجمالي ${money(netTotal)} — هيروحوا ومش هيرجعوا.`
          : 'اللي كتبته هيروح ومش هيرجع.',
      okText: verdict === 'confirm-edit' ? 'اخرج من غير حفظ' : 'اخرج واسيبه',
      okButtonProps: { danger: true },
      cancelText: verdict === 'confirm-edit' ? 'أرجع أكمّل' : 'أكمّل المستند',
      onOk: leave,
    });
  };

  const addProductByIdWith = async (
    itemId: number, warehouseId: number, qty: number | null = null,
  ): Promise<PickResult> => {
    const fresh = await fetchPrices(itemId);
    const existing = lines.find((x) => x.item_id === itemId);
    if (existing) {
      if (qty) {
        const wh = lineWarehouse(existing);
        const total = pickedQty(existing.key, itemId, existing.unit, wh,
          Number(existing.quantity || 0) + qty);
        setLines((prev) => prev.map((x) => (x.key === existing.key ? { ...x, quantity: total } : x)));
        message.info(`«${productName(itemId)}» موجود بالفعل — اتزوّدت كميته`);
      } else {
        message.info(`«${productName(itemId)}» موجود بالفعل — عدّل الكمية من السطر`);
      }
      return { dup: itemId };
    }
    const prod = products.find((p) => p.id === itemId);
    const tier = customerTier || 'consumer';
    const l = blankLine(`${Date.now()}-${++lineSeq.current}`, tier);
    l.warehouse_id = warehouseId;
    l.category = prod?.category ?? null;
    l.item_id = itemId;
    l.unit_price = resolvePrice(itemId, tier, null, fresh);
    l.fixed_discount = defaultFixedDiscount(itemId, fresh);
    if (qty) l.quantity = pickedQty(l.key, itemId, null, warehouseId, qty);
    setLines((prev) => [...prev, l]);
    return l.quantity == null ? { needsQty: l.key } : null;
  };

  const addProductById = async (itemId: number, qty: number | null = null): Promise<PickResult> => {
    if (!itemId) return null;
    if (docWarehouseId === null) {
      if (qty) pendingQtys.current[itemId] = qty;
      setPendingItems((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
      setPendingWarehouse((prev) => prev ?? warehouses[0]?.id ?? null);
      return null;
    }
    return addProductByIdWith(itemId, docWarehouseId, qty);
  };

  const pickedQty = (key: string, itemId: number, unit: string | null,
                     wh: number | null, q: number): number | null => {
    if (!wh || !availability[wh]) return q;
    const stock = availableFor(itemId, unit, wh);
    if (q <= stock) return q;
    announceQuantityCap(key, productName(itemId),
      warehouses.find((w) => w.id === wh)?.name ?? 'المخزن', stock, unit);
    return stock > 0 ? stock : null;
  };

  const handleRemoveLine = (key: string) => {
    setLines(lines.filter((l) => l.key !== key));
  };

  const unitFactor = (itemId: number, unit: string | null): number => (
    factorOf(unitsCache[itemId], unit));

  const belowCost = (l: SaleLineItem): boolean => {
    if (isBonus || !l.item_id) return false;
    const base = minPrices[l.item_id];
    if (!base) return false;
    if (l.unit && !(unitsCache[l.item_id] || []).some((u) => u.name === l.unit)) return false;
    const min = Math.round(base * unitFactor(l.item_id, l.unit) * 100) / 100;
    const net = Math.round(netOf(l.unit_price || 0, lineDiscountPct(l)) * 100) / 100;
    return net < min - 0.0001;
  };

  const resolvePrice = (itemId: number, tier: string | null, unit: string | null,
                        fresh?: ItemPrices): number => {
    const c = fresh ?? pricesCache[itemId];
    let base: number;
    if (!c) {
      const prod = products.find((p) => p.id === itemId);
      base = prod?.sale_price ? parseFloat(prod.sale_price) : 0;
    } else {
      base = (tier && c.tiers[tier] != null) ? c.tiers[tier] : (c.base ?? 0);
    }
    return Math.round(base * unitFactor(itemId, unit) * 100) / 100;
  };

  const fetchPrices = async (itemId: number): Promise<ItemPrices | undefined> => {
    let fresh: ItemPrices | undefined = pricesCache[itemId];
    if (!pricesCache[itemId]) {
      try {
        const res = await api.get(`/api/v1/items/${itemId}/prices`);
        const tiers: Record<string, number> = {};
        const discounts: Record<string, number> = {};
        (res.data.tiers || []).forEach((t: any) => {
          tiers[t.tier] = parseFloat(t.price);
          discounts[t.tier] = parseFloat(t.discount_pct ?? 0) || 0;
        });
        const entry: ItemPrices = {
          base: res.data.base_sale_price ? parseFloat(res.data.base_sale_price) : null,
          tiers,
          discounts,
        };
        setPricesCache((prev) => ({ ...prev, [itemId]: entry }));
        fresh = entry;
      } catch (err) { console.error(err); }
    }
    await fetchUnits(itemId);
    return fresh;
  };

  const unitsRequestedRef = useRef<Set<number>>(new Set());
  const fetchUnits = async (itemId: number) => {
    if (unitsCache[itemId] || unitsRequestedRef.current.has(itemId)) return;
    unitsRequestedRef.current.add(itemId);
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({ name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
    } catch (err) {
      unitsRequestedRef.current.delete(itemId);
      console.error(err);
    }
  };
  useEffect(() => {
    lines.forEach((l) => { if (l.item_id) fetchUnits(l.item_id); });
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const capNoticeRef = useRef<Record<string, number>>({});
  const capModalOpenRef = useRef(false);

  const announceQuantityCap = (
    lineKey: string, itemName: string, storeName: string, stock: number, unit: string | null,
  ) => {
    const now = Date.now();
    const seen = capNoticeRef.current;
    Object.keys(seen).forEach((k) => { if (now - seen[k] > CAP_NOTICE_MS) delete seen[k]; });
    const sig = `${lineKey}|${storeName}|${stock}`;
    const repeated = seen[sig] !== undefined;
    seen[sig] = now;
    if (repeated) return;
    const u = unit ? ` ${unit}` : '';
    const n = stock.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 });
    if (capModalOpenRef.current) return;
    capModalOpenRef.current = true;
    Modal.warning({
      title: stock > 0 ? 'الكمية أكبر من المتاح' : 'مفيش رصيد',
      okText: 'تمام',
      centered: true,
      content: (
        <div style={{ lineHeight: 1.9 }}>
          {stock > 0 ? (
            <>
              المتاح <b style={{ color: '#cf4b1a' }}>{n}{u}</b> فقط من{' '}
              <b>«{itemName}»</b> في <b>{storeName}</b>.
              <div style={{ marginTop: 6, color: '#6b6b6b' }}>الكمية اتظبطت على المتاح.</div>
            </>
          ) : (
            <>
              مفيش رصيد من <b>«{itemName}»</b> في <b>{storeName}</b>.
              <div style={{ marginTop: 6, color: '#6b6b6b' }}>الكمية اتشالت.</div>
            </>
          )}
        </div>
      ),
      afterClose: () => { capModalOpenRef.current = false; },
    });
  };

  const handleLineChange = async (key: string, field: keyof SaleLineItem, value: any) => {
    const fresh = field === 'item_id' && value ? await fetchPrices(value) : undefined;
    if (field === 'warehouse_id' && value) await loadWarehouseStock(value);

    if (field === 'quantity' && value != null) {
      const line = lines.find((l) => l.key === key);
      if (line?.item_id && lineWarehouse(line)) {
        const stock = availableFor(line.item_id, line.unit, lineWarehouse(line));
        if (Number(value) > stock) {
          const name = productName(line.item_id);
          const store = warehouses.find((w) => w.id === lineWarehouse(line))?.name ?? 'المخزن';
          announceQuantityCap(key, name, store, stock, line.unit);
          value = stock;
        }
      }
    }

    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const updated = { ...l, [field]: value };
        if (field === 'category') {
          updated.item_id = null;
          updated.unit = null;
          updated.unit_price = 0;
          updated.fixed_discount = 0;
        } else if (field === 'item_id') {
          updated.tier = l.tier || customerTier || 'consumer';
          updated.unit = null;
          updated.unit_price = resolvePrice(value, updated.tier, null);
          const prod = products.find((p) => p.id === value);
          updated.fixed_discount = defaultFixedDiscount(value as number, fresh);
        } else if (field === 'unit' && l.item_id) {
          updated.unit_price = convertUnitPrice(l.unit_price || 0,
            unitFactor(l.item_id, l.unit), unitFactor(l.item_id, updated.unit));
        } else if (field === 'tier' && l.item_id) {
          updated.unit_price = resolvePrice(l.item_id, updated.tier, updated.unit);
        }
        return updated;
      })
    );
  };

  useEffect(() => {
    if (!createVisible) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (pickerOpen || partyPickerOpen || newStep) return;
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
  }, [createVisible, pickerOpen, partyPickerOpen, newStep]);

  useEffect(() => {
    if (newStep !== 'family' || !invoiceFamily) return;
    const allowed = familyChoices().map((o) => o.value);
    if (!allowed.includes(invoiceFamily)) setInvoiceFamily(null);
  }, [newStep, families.length]);

  const handlePartyPicked = (picked: Party) => {
    setParty(picked);
    setPartyPickerOpen(false);
    if (newStep === 'party') { setNewStep('warehouse'); setCreateVisible(true); }
    createForm.setFieldsValue({ customer_id: picked.id });
    setCustomers((prev) => (prev.some((c) => c.id === picked.id) ? prev : [
      ...prev, { id: picked.id, name: picked.name, default_price_tier: null } as Customer,
    ]));
    onCustomerChange(picked.id);
  };

  const loadWarehouseStock = async (warehouseId: number, force = false) => {
    if (!warehouseId) return;
    if (!force && availability[warehouseId]) return;
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: {
          location_kind: 'warehouse', location_id: warehouseId, only_available: false,
          ...(excludeDocRef.current
            ? { exclude_doc_type: 'sale', exclude_doc_id: excludeDocRef.current } : {}),
        },
      });
      const map: Record<number, number> = {};
      (res.data || []).forEach((r: any) => { map[r.item_id] = Number(r.on_hand || 0); });
      setAvailability((prev) => ({ ...prev, [warehouseId]: map }));
    } catch (err) { console.error(err); }
  };

  const onWarehouseChange = async (warehouseId: number) => {
    setDocWarehouseId(warehouseId);
    await loadWarehouseStock(warehouseId);
  };

  const afterWarehouseStep = (): null | 'family' => (isFactory ? null : 'family');

  const familyChoices = (): { value: string; label: string }[] => (
    families.length > 1
      ? families.map((a) => ({ value: a.family as string, label: a.family as string }))
      : FAMILY_OPTIONS
  );

  const lineWarehouse = (l: SaleLineItem): number | null => l.warehouse_id ?? docWarehouseId;

  const availableFor = (itemId: number | null, unit: string | null,
                        warehouseId: number | null): number => {
    if (!itemId || !warehouseId) return 0;
    const base = availability[warehouseId]?.[itemId] ?? 0;
    const f = unitFactor(itemId, unit) || 1;
    if (f === 1) return base;
    return Math.floor((base / f) * 1000 + 1e-6) / 1000;
  };

  const lineQuantityCheck = (line: SaleLineItem) => {
    const wh = lineWarehouse(line);
    return {
      value: line.quantity,
      available: wh ? availableFor(line.item_id, line.unit, wh) : undefined,
      itemName: products.find((p) => p.id === line.item_id)?.name,
      unit: line.unit,
    };
  };

  const storeOfRep = (repId: number | null | undefined): number | null => {
    if (!repId) return null;
    return employees.find((e) => e.user_id === repId)?.warehouse_id ?? null;
  };

  const onCustomerChange = (customerId: number) => {
    const c = customers.find((x) => x.id === customerId);
    const tier = c?.default_price_tier ?? null;
    setCustomerTier(tier);
    if (c?.rep_id) {
      createForm.setFieldsValue({ rep_id: c.rep_id });
      const store = storeOfRep(c.rep_id);
      if (store && !docWarehouseId) {
        setDocWarehouseId(store);
        loadWarehouseStock(store);
      }
    }
    setSelectedCustomerId(customerId);
    setCustomerBalance(null);
    setCustomerCoupons([]);
    api.get(`/api/v1/customers/${customerId}/accounts`)
      .then((res) => {
        const rows = res.data?.accounts || [];
        setFamilyAccounts(rows);
        setCustomerBalance(Number(res.data?.total_balance || 0));
        const named = rows.filter((a: any) => a.family);
        setInvoiceFamily((prev) => prev ?? (named.length === 1 ? named[0].family : null));
      })
      .catch((err) => { console.error(err); setFamilyAccounts([]); setCustomerBalance(null); });
    api.get('/api/v1/coupons', { params: { customer_id: customerId, status_filter: 'issued' } })
      .then((res) => setCustomerCoupons(res.data || []))
      .catch(() => setCustomerCoupons([]));
    setLines((prev) => prev.map((l) => l.item_id
      ? { ...l, tier: tier || 'consumer', unit_price: resolvePrice(l.item_id, tier || 'consumer', l.unit) }
      : { ...l, tier }));
  };

  const handleCreateSubmit = async (values: any) => {
    const validLines = lines.filter((l) => l.item_id !== null);
    const validCoupons = couponRows.filter(couponRowHasContent);
    if (validLines.length === 0 && validCoupons.length === 0) {
      message.error('يرجى إضافة منتج أو تسجيل كوبونات لحفظ الفاتورة!');
      return;
    }
    const noQty = validLines.find((l) => !Number(l.quantity));
    if (noQty) {
      message.error(`«${productName(noQty.item_id as number)}»: اكتب الكمية.`);
      setFocusLineKey(noQty.key);
      return;
    }

    const wanted = new Map<string, number>();
    validLines.forEach((l) => {
      const key = `${lineWarehouse(l)}:${l.item_id}`;
      wanted.set(key, (wanted.get(key) ?? 0) + Number(l.quantity || 0));
    });
    const short = validLines.find((l) => {
      const asked = wanted.get(`${lineWarehouse(l)}:${l.item_id}`) ?? 0;
      return asked > availableFor(l.item_id, l.unit, lineWarehouse(l));
    });
    if (short) {
      const prod = products.find((p) => p.id === short.item_id);
      const wh = warehouses.find((w) => w.id === lineWarehouse(short));
      const asked = wanted.get(`${lineWarehouse(short)}:${short.item_id}`) ?? 0;
      message.error(
        `«${prod?.name ?? 'الصنف'}»: المطلوب ${asked} يتجاوز المتاح في «${wh?.name ?? 'المخزن'}» `
        + `(${availableFor(short.item_id, short.unit, lineWarehouse(short))
          .toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })})`,
      );
      return;
    }

    const parseSerials = (s: string) => s.split(/[\s,\n]+/).map((x) => x.trim()).filter(Boolean);
    for (const l of validLines) {
      const prod = products.find((p) => p.id === l.item_id);
      if (prod?.is_serialized) {
        const ser = parseSerials(l.serials);
        if (ser.length !== Number(l.quantity || 0)) {
          message.error(`«${prod.name}»: عدد الأرقام التسلسلية يجب أن يساوي الكمية (${l.quantity})`);
          return;
        }
      }
    }

    const underCost = validLines.filter(belowCost);
    if (underCost.length && !canSellBelowCost) {
      Modal.error({
        title: 'سعر البيع أقل من سعر الشراء',
        content: (
          <div>
            <div>الأصناف دي صافي سعرها أقل من سعر الشراء:</div>
            <ul style={{ margin: '6px 0', paddingInlineStart: 18 }}>
              {[...new Set(underCost.map((l) => productName(l.item_id as number)))]
                .map((n) => <li key={n}>{n}</li>)}
            </ul>
            <div>ارفع السعر أو قلّل الخصم — البيع تحت سعر الشراء محتاج صلاحية «البيع تحت سعر التكلفة».</div>
          </div>
        ),
        okText: 'تمام',
      });
      setFocusLineKey(underCost[0].key);
      return;
    }

    askTreasury(
      {
        amount: Number(cashAmount) || 0,
        direction: 'in',
        family: invoiceFamily,
        docLabel: 'فاتورة البيع',
        preselect: docCashAccountId,
      },
      async (cashAccountId) => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
          const editingId = editingInvoice?.id;
          const send = editingId
            ? (b: any) => api.put(`/api/v1/sales/${editingId}`, b)
            : (b: any) => api.post('/api/v1/sales', b);
          if (!editingId && !clientUuidRef.current) clientUuidRef.current = newUuid();
          await send({
            client_uuid: editingId ? undefined : clientUuidRef.current,
            customer_id: values.customer_id,
            rep_id: values.rep_id ?? null,
            origin: {
              location_kind: 'warehouse',
              location_id: validLines[0]?.warehouse_id ?? docWarehouseId ?? warehouses[0]?.id ?? 1,
            },
            variable_discount_pct: isBonus ? 0 : discountPct,
            cash_amount: isBonus ? 0 : cashAmount,
            is_bonus: isBonus,
            bonus_for_invoice_id: isBonus ? bonusForId : null,
            credit_amount: undefined,
            lines: validLines.map((l) => {
              const prod = products.find((p) => p.id === l.item_id);
              return {
                item_id: l.item_id,
                quantity: Number(l.quantity || 0),
                tier: l.tier,
                unit: l.unit,
                unit_price: l.unit_price.toFixed(2),
                discount_pct: combinePct(l.fixed_discount, l.variable_discount).toFixed(2),
                fixed_discount_pct: Number(l.fixed_discount || 0).toFixed(2),
                variable_discount_pct: (isBonus ? 0 : Number(l.variable_discount || 0)).toFixed(2),
                serials: prod?.is_serialized ? parseSerials(l.serials) : null,
                warehouse_id: l.warehouse_id ?? undefined,
              };
            }),
            external_document_number: values.external_document_number || undefined,
            cost_center_id: values.cost_center_id ?? null,
            cost_center_distribution: values.cost_center_distribution ?? null,
            invoice_date: (invoiceDate || dayjs()).format('YYYY-MM-DD'),
            coupons: couponRows
              .filter(couponRowHasContent)
              .map((r) => ({
                coupon_kind: r.coupon_kind ?? null,
                count: couponCount(r.serial_from, r.serial_to),
                serial_from: r.serial_from || null,
                serial_to: r.serial_to || null,
              })),
            notes: values.notes || undefined,
            statement1: values.statement1 || undefined,
            statement2: values.statement2 || undefined,
            statement3: values.statement3 || undefined,
            family: invoiceFamily,
            cash_account_id: cashAccountId ?? undefined,
          });

          message.success(editingInvoice
            ? 'اتعدّلت الفاتورة واترحّلت من جديد' : 'تم تسجيل فاتورة البيع بنجاح');
          discardDraft();
          finishClose();
          fetchInvoices();
        } catch (err: any) {
          console.error(err);
          message.error(err?.response?.data?.detail?.message || 'تعذر حفظ الفاتورة');
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      },
    );
  };

  const handleDeleteInvoice = async (record: InvoiceRecord) => {
    try {
      await api.delete(`/api/v1/sales/${record.id}`);
      message.success('تم حذف الفاتورة بنجاح');
      fetchInvoices();
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleDeleteReturn = async (record: any) => {
    try {
      await api.delete(`/api/v1/sales/returns/${record.id}`);
      message.success('تم حذف سند المرتجع بنجاح');
      fetchInvoices();
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleEditInvoice = async (record: InvoiceRecord) => {
    await openDetail(record);
    if (!canEditInvoice) {
      message.warning('ليس لديك صلاحية تعديل الفواتير');
      return;
    }
    setViewOnly(false);
    message.info(`الفاتورة ${record.document_number} مفتوحة الآن للتعديل`);
  };

  const docInUrl = useRef<number | null>(null);
  const closedDocRef = useRef<number | null>(null);
  const closeOnBackRef = useRef<(() => void) | null>(null);
  const writeDocParam = useCallback((id: number) => {
    docInUrl.current = id;
    if (!onScreenRef.current) return;
    const next = new URLSearchParams(paramsRef.current);
    const already = next.get('doc') === String(id);
    next.set('doc', String(id));
    next.delete('edit'); next.delete('id'); next.delete('back');
    setSearchParams(next, { replace: already });
  }, [setSearchParams]);
  const clearDocParam = useCallback(() => {
    closedDocRef.current = docInUrl.current
      ?? (Number(paramsRef.current.get('doc') || paramsRef.current.get('edit')) || null);
    docInUrl.current = null;
    if (!onScreenRef.current) return;
    const next = new URLSearchParams(paramsRef.current);
    if (!next.has('doc') && !next.has('edit') && !next.has('id') && !next.has('ret')) return;
    next.delete('doc'); next.delete('edit'); next.delete('id'); next.delete('back');
    next.delete('ret');
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);

  closeOnBackRef.current = () => { resetDocument(); setCreateVisible(false); };

  const pendingIntent = useRef<{ id: number; mode: 'view' | 'edit' } | null>(null);

  useEffect(() => {
    const doc = searchParams.get('doc');
    const edit = searchParams.get('edit');
    const id = searchParams.get('id');
    if (!doc && !edit && !id) closedDocRef.current = null;
    if (doc && Number(doc) === docInUrl.current) return;
    if (!doc && !edit && !id && docInUrl.current !== null) {
      docInUrl.current = null;
      closeOnBackRef.current?.();
      return;
    }
    if (doc || edit || id) {
      pendingIntent.current = { id: Number(doc || edit || id), mode: edit ? 'edit' : 'view' };
      if (doc && !edit && !id) docInUrl.current = Number(doc);
      if ((edit || id || searchParams.has('back')) && onScreenRef.current) {
        const next = new URLSearchParams(searchParams);
        next.delete('edit'); next.delete('id'); next.delete('back');
        setSearchParams(next, { replace: true });
      }
    }
    const wanted = pendingIntent.current;
    if (!wanted) return;
    pendingIntent.current = null;
    const target = invoices.find((i) => i.id === wanted.id) || ({ id: wanted.id } as InvoiceRecord);
    if (wanted.mode === 'view') openDetail(target);
    else handleEditInvoice(target);
  }, [searchParams, invoices]);

  const neighbour = (step: number) => {
    if (!viewInvoice) return null;
    const rows = periodRows ?? (viewInvoice.is_bonus ? bonusInvoices : invoices);
    const at = rows.findIndex((r: any) => r.id === viewInvoice.id);
    if (at < 0) return null;
    return rows[at + step] ?? null;
  };

  const printMeta = (inv: any): [string, string][] | undefined => {
    const meta: [string, string][] = [];
    if (inv.external_document_number) meta.push(['رقم المستند', inv.external_document_number]);
    meta.push(...statementMeta(inv));
    const rows: any[] = inv.coupons ?? [];
    const named = rows.filter(
      (c) => c.coupon_kind || c.coupon_type_name || c.serial_from || c.serial_to);
    if (named.length) {
      for (const c of named) {
        const kind = c.coupon_kind || c.coupon_type_name || 'كوبونات';
        const n = c.count ?? couponCount(c.serial_from, c.serial_to);
        const range = c.serial_from && c.serial_to
          ? `من ${c.serial_from} إلى ${c.serial_to}`
          : (c.serial_from || c.serial_to || '');
        meta.push([kind, [n ? `${n} كوبون` : '', range].filter(Boolean).join(' — ')]);
      }
    } else if (inv.coupon_serial_from) {
      const count = inv.coupon_count ? `${inv.coupon_count} — ` : '';
      meta.push(['الكوبونات',
        `${count}من ${inv.coupon_serial_from} إلى ${inv.coupon_serial_to}`]);
    }
    return meta.length ? meta : undefined;
  };

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `صنف #${id}`;

  const lineColumns = buildLineColumns({
    viewOnly, warehouses, totalPoints, pointValues, productName, saleUnitOptions,
    availabilityHint,
    saleLineNet, linePoints, checkedQuantity, handleLineChange, handleRemoveLine,
    advanceFrom, setDocWarehouseId, setPanelItemId, hidePoints: isFactory, isBonus,
    productCode: (id) => products.find((p) => p.id === id)?.code,
    belowCost, canSellBelowCost,
  });
  const lineGrid = useEntryGrid('invoice-lines-grid', lineColumns);

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

function couponsTotal(inv: any): number {
  const rows: any[] = inv?.coupons ?? [];
  if (rows.length) {
    return rows.reduce(
      (t, c) => t + (c.count ?? couponCount(c.serial_from, c.serial_to) ?? 0), 0);
  }
  return inv?.coupon_count ?? couponCount(inv?.coupon_serial_from, inv?.coupon_serial_to) ?? 0;
}

  const couponRange = (() => {
    const serials = customerCoupons.map((c) => c.serial).filter(Boolean).sort();
    return { from: serials[0] ?? '—', to: serials[serials.length - 1] ?? '—' };
  })();

  const lineCategory = (l: SaleLineItem): string => {
    const raw = products.find((p) => p.id === l.item_id)?.category;
    return raw ? (categoryLabels[raw] || raw) : '';
  };

  const openDetail = async (record: InvoiceRecord) => {
    try {
      setLoading(true);
      if (!createVisible) setDocOpening(true);
      const [detRes, retRes] = await Promise.all([
        api.get(`/api/v1/sales/${record.id}`),
        api.get(`/api/v1/sales/${record.id}/returns`).catch(() => ({ data: [] })),
      ]);
      const det = detRes.data;
      const rets = retRes.data || [];
      const returned = rets.reduce((t: number, r: any) => t + Number(r.value ?? r.net ?? 0), 0);
      const alreadyVoid = returned > 0 && Math.abs(returned - Number(det.net || 0)) < 0.01;

      const loadedInvoice = { ...record, ...det };
      setViewInvoice(loadedInvoice);
      writeDocParam(record.id);
      setViewReturns(rets);
      setEditingInvoice({ id: record.id, voided: alreadyVoid });
      setViewOnly(true);

      const refilled: SaleLineItem[] = (det.lines || []).map((l: any, idx: number) => {
        const product = products.find((p) => p.id === l.item_id);
        return {
          key: `${Date.now()}-${idx}`,
          item_id: l.item_id,
          category: product?.category ?? null,
          tier: l.price_tier ?? null,
          unit: l.unit ?? null,
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unit_price) || 0,
          serials: '',
          fixed_discount: l.fixed_discount_pct != null
            ? Number(l.fixed_discount_pct)
            : Number(l.discount_pct) || 0,
          variable_discount: l.variable_discount_pct != null
            ? Number(l.variable_discount_pct)
            : 0,
          warehouse_id: l.warehouse_id ?? null,
        } as SaleLineItem;
      });

      setLines(refilled);
      const first = (det.lines || [])[0];

      excludeDocRef.current = record.id;
      setAvailability({});
      const stores = new Set<number>(
        (refilled.map((l) => l.warehouse_id).filter(Boolean) as number[]));
      if (first?.warehouse_id) stores.add(first.warehouse_id);
      await Promise.all([...stores].map((w) => loadWarehouseStock(w, true)));

      setDiscountPct(Number(det.variable_discount_pct ?? det.discount_pct ?? 0));
      setCashAmount(Number(det.cash_amount) || 0);
      setIsBonus(Boolean(det.is_bonus));
      setBonusForId(det.bonus_for_invoice_id ?? null);
      bonusLinkedRef.current = det.bonus_for_invoice_id && det.bonus_for_number
        ? { id: det.bonus_for_invoice_id, number: det.bonus_for_number } : null;
      setInvoiceDate(dayjs(det.invoice_date || det.created_at || undefined));
      setInvoiceFamily(det.family || null);
      createForm.setFieldsValue({
        customer_id: det.customer_id,
        rep_id: det.rep_id,
        external_document_number: det.external_document_number,
        notes: det.notes,
        cost_center_id: (det as any).cost_center_id ?? null,
        cost_center_distribution: (det as any).cost_center_distribution ?? null,
        statement1: det.statement1,
        statement2: det.statement2,
        statement3: det.statement3,
      });

      setDocCashAccountId(det.cash_account_id ?? null);
      setSelectedCustomerId(det.customer_id);

      const cName = (det as any).customer_name;
      if (det.customer_id && cName) {
        setCustomers((prev) => (prev.some((c) => c.id === det.customer_id)
          ? prev : [...prev, { id: det.customer_id, name: cName } as any]));
      }
      const rName = (det as any).rep_name;
      if (det.rep_id && rName) {
        setReps((prev: any[]) => (prev.some((r) => r.id === det.rep_id)
          ? prev : [...prev, { id: det.rep_id, full_name: rName, username: rName }]));
      }
      if (first?.warehouse_id) setDocWarehouseId(first.warehouse_id);

      if (det.customer_id) {
        api.get(`/api/v1/customers/${det.customer_id}/accounts`)
          .then((res) => {
            const rows = res.data?.accounts || [];
            setFamilyAccounts(rows);
            setCustomerBalance(Number(res.data?.total_balance || 0));
          })
          .catch(() => {});
      }

      const couponSrc = det.coupons ?? det.coupon_rows;
      const loadedCoupons = (couponSrc && couponSrc.length)
        ? couponSrc.map((cr: any) => ({
          key: cr.id || String(Math.random()),
          coupon_kind: cr.coupon_kind,
          count: cr.count,
          serial_from: cr.serial_from,
          serial_to: cr.serial_to,
        }))
        : (det.coupon_serial_from || det.coupon_serial_to)
          ? [{
            key: '1',
            coupon_kind: det.coupon_kind || undefined,
            count: det.coupon_count,
            serial_from: det.coupon_serial_from,
            serial_to: det.coupon_serial_to,
          }]
          : [blankCoupon()];
      setCouponRows(loadedCoupons);

      setOpenedFingerprint(fingerprintOf({
        lines: refilled,
        discountPct: Number(det.variable_discount_pct ?? det.discount_pct ?? 0),
        cashAmount: Number(det.cash_amount) || 0,
        invoiceDate: dayjs(det.invoice_date || det.created_at || undefined),
        family: det.family || null,
        couponRows: loadedCoupons,
        form: {
          customer_id: det.customer_id,
          rep_id: det.rep_id,
          external_document_number: det.external_document_number,
          notes: det.notes,
          cost_center_id: (det as any).cost_center_id ?? null,
          cost_center_distribution: (det as any).cost_center_distribution ?? null,
          statement1: det.statement1,
          statement2: det.statement2,
          statement3: det.statement3,
        },
      }));

      setCreateVisible(true);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر فتح الفاتورة');
      if (docInUrl.current === record.id) clearDocParam();
    } finally {
      setLoading(false);
      setDocOpening(false);
    }
  };

  useEffect(() => {
    if (!isBonus || !selectedCustomerId) { setBonusTargets([]); return; }
    let alive = true;
    api.get('/api/v1/sales', { params: { customer_id: selectedCustomerId, kind: 'sale', limit: 100 } })
      .then((res) => {
        if (!alive) return;
        const rows = (Array.isArray(res.data) ? res.data : res.data?.items ?? [])
          .filter((r: any) => r.id !== editingInvoice?.id);
        const opts = rows.map((r: any) => ({
          id: r.id, document_number: r.document_number,
          invoice_date: r.invoice_date, net: r.net,
        }));
        const linked = bonusLinkedRef.current;
        if (linked && !opts.some((o: any) => o.id === linked.id)) {
          opts.push({ id: linked.id, document_number: linked.number, invoice_date: null, net: '0' });
        }
        setBonusTargets(opts);
      })
      .catch(() => { if (alive) setBonusTargets([]); });
    return () => { alive = false; };
  }, [isBonus, selectedCustomerId, editingInvoice?.id]);

  const invoiceDoc = (inv: any): InvoiceDoc | null => {
    if (!inv) return null;
    const customer = customers.find((c) => c.id === inv.customer_id);
    const bonusValue = inv.is_bonus
      ? (inv.lines || []).reduce((s: number, l: any) =>
        s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0)
      : null;
    return {
      kind: 'sale',
      isBonus: Boolean(inv.is_bonus),
      document_number: inv.document_number,
      date: (inv as any).invoice_date ?? (inv as any).created_at ?? null,
      partyLabel: 'العميل',
      partyName: customer?.name ?? `#${inv.customer_id}`,
      partyPhone: (customer as any)?.phone ?? null,
      partyAddress: (customer as any)?.address ?? null,
      partyId: inv.customer_id ?? null,
      branchName: branches.find((b) => b.id === (customer as any)?.branch_id)?.name ?? null,
      repName: reps.find((r) => r.id === inv.rep_id)?.full_name ?? null,
      partyAccount: (() => {
        const a = postingAccounts.find((x: any) => x.id === inv.revenue_account_id);
        return a ? (a.name || a.code || null) : null;
      })(),
      gross: bonusValue ?? inv.gross,
      discountPct: inv.combined_pct,
      net: inv.net,
      tax: (inv as any).tax_amount ?? 0,
      cash: Math.min(Number(inv.cash_amount || 0), Number(inv.net || 0) + Number(inv.tax_amount || 0)),
      credit: Math.max(0, Number(inv.credit_amount || 0)),
      entryId: (inv as any).ledger_entry_id ?? null,
      priorBalance: (inv as any).prior_balance ?? null,
      family: (inv as any).family ?? null,
      otherFamily: (inv as any).other_family ?? null,
      otherFamilyBalance: (inv as any).other_family_balance ?? null,
      totalPoints: (inv.lines || []).reduce(
        (s: number, l: any) => s + (pointValues[l.item_id] || 0) * Number(l.quantity || 0), 0),
      extraMeta: [
        ...(inv.is_bonus && inv.bonus_for_number
          ? [['على طلب بيع', inv.bonus_for_number] as [string, string]] : []),
        ...(printMeta(inv) ?? []),
      ],
      lines: (inv.lines || []).map((l: any) => ({
        name: productName(l.item_id),
        itemId: l.item_id,
        quantity: l.quantity,
        unit: l.unit || unitsCache[l.item_id]?.find((u) => u.is_base)?.name
          || products.find((p) => p.id === l.item_id)?.unit_of_measure || null,
        unit_price: l.unit_price,
        discount_pct: l.discount_pct,
        points: (pointValues[l.item_id] || 0) * Number(l.quantity || 0),
        line_total: l.line_total,
        warehouse: warehouses.find((w) => w.id === l.warehouse_id)?.name ?? null,
      })),
    };
  };

  const columns = buildRegisterColumns({
    customers, reps, postingAccounts, filters, printOpts, navigate, openDetail,
    openReturn: (rid: number) => openDoc('return', rid),
    invoiceDoc, canEditInvoice, canDeleteInvoice, handleEditInvoice, handleDeleteInvoice,
    handleDeleteReturn,
    onDeleteDraft: (id: number) => removeDraft(id),
    canWriteVoucher: can('voucher.write'),
    onViewReceipt: registerReceipts.view,
    onEditReceipt: (r: any) => { fetchVoucher(r.id).then((v) => editReceipt(v)).catch(() => {}); },
    onDeleteReceipt: registerReceipts.remove,
  });

  const visibleColumns = invoiceCols.apply(columns);

  const bonusColumns = (() => {
    const pick = (key: string) => columns.find((c: any) => c.key === key);
    const linked = {
      title: 'على فاتورة',
      dataIndex: 'bonus_for_number',
      key: 'bonus_for_number',
      width: 130,
      render: (num: string | null, r: any) => (num && r.bonus_for_invoice_id
        ? <a onClick={(e) => { e.stopPropagation(); openDetail({ id: r.bonus_for_invoice_id } as InvoiceRecord); }}>
            <Tag color="blue" style={{ cursor: 'pointer' }}>{num}</Tag>
          </a>
        : (num || '-')),
    };
    const gross = pick('gross');
    return [
      pick('doc_type'), pick('document_number'), pick('date'), pick('customer_id'),
      pick('rep_id'), linked,
      gross && { ...gross, title: 'القيمة قبل الخصم', width: 130 },
      pick('net'), pick('statement1'), pick('actions'),
    ].filter(Boolean) as any[];
  })();
  const tableColumns = docKindFilter === 'bonus' ? bonusColumns : visibleColumns;

  const stepFromDraft = (index: number) => {
    const target = invoices[index];
    if (!target) return;
    closeCreate({ stay: true });
    openDetail(target);
  };

  const startNew = (opts?: { bonus?: boolean }) => {
    const go = () => {
      resetDocument();
      if (opts?.bonus) { setIsBonus(true); setBonusForId(null); setCashAmount(0); }
      setCreateVisible(true);
      setNewStep('party');
      setPartyPickerOpen(true);
    };
    const verdict = verdictOnLeave({
      readOnly: viewOnly,
      savedDocument: editingInvoice != null,
      now: currentFingerprint(),
      whenOpened: openedFingerprint,
      hasWork: lines.length > 0 || selectedCustomerId != null || Number(cashAmount || 0) > 0,
    });
    if (verdict === 'silent') { go(); return; }
    Modal.confirm({
      title: 'تبدأ فاتورة جديدة؟',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: verdict === 'confirm-edit'
        ? 'التعديلات اللي عملتها مااتحفظتش. الفاتورة نفسها هتفضل زي ما هي.'
        : 'الفاتورة اللي على الشاشة مااتحفظتش وهتروح.',
      okText: 'ابدأ جديدة', cancelText: 'أكمّل اللي فاتح', onOk: go,
    });
  };

  const docToolbar = (): ToolbarAction[] => {
    const isSaved = Boolean(viewInvoice || editingInvoice);
    const lineCount = lines.filter((l) => l.item_id !== null).length;
    const couponCountVal = couponRows.filter(couponRowHasContent).length;
    const hasContent = lineCount > 0 || couponCountVal > 0;
    return [
      {
        key: 'new',
        label: 'جديد',
        shortcut: 'F2',
        primary: true,
        icon: <FileAddOutlined />,
        onClick: () => startNew(),
      },
      {
        key: 'edit',
        label: 'تعديل',
        icon: <EditOutlined />,
        disabled: !isSaved || !viewOnly,
        onClick: () => {
          setViewOnly(false);
          message.info(`الفاتورة ${viewInvoice?.document_number || ''} مفتوحة الآن للتعديل`);
        },
      },
      {
        key: 'undo',
        label: 'تراجع',
        icon: <UndoOutlined />,
        onClick: () => {
          if (!viewOnly && viewInvoice) {
            openDetail(viewInvoice);
          } else {
            closeCreate();
          }
        },
      },
      {
        key: 'save',
        label: 'حفظ',
        shortcut: 'F9',
        icon: <SaveOutlined />,
        disabled: viewOnly || !hasContent || loading || saving,
        onClick: () => { createForm.submit(); },
      },
      {
        key: 'search',
        label: 'بحث',
        shortcut: 'F3',
        icon: <SearchOutlined />,
        disabled: viewOnly,
        onClick: () => setPickerOpen(true),
      },
      {
        key: 'prev',
        label: 'السابق',
        icon: <ArrowRightOutlined />,
        disabled: !isSaved ? invoices.length === 0 : !neighbour(1),
        onClick: () => {
          if (isSaved) {
            const n = neighbour(1);
            if (n) openDetail(n);
          } else {
            stepFromDraft(0);
          }
        },
      },
      {
        key: 'next',
        label: 'التالى',
        icon: <ArrowLeftOutlined />,
        disabled: !isSaved || !neighbour(-1),
        onClick: () => {
          const n = neighbour(-1);
          if (n) openDetail(n);
        },
      },
      {
        key: 'delete',
        label: 'حذف',
        shortcut: 'F8',
        icon: <DeleteOutlined />,
        danger: true,
        disabled: isSaved ? (!canDeleteInvoice || Boolean(editingInvoice?.voided)) : lineCount === 0,
        onClick: () => {
          if (isSaved && (viewInvoice || editingInvoice)) {
            const inv = viewInvoice || editingInvoice;
            Modal.confirm({
              title: 'حذف الفاتورة',
              content: `هل أنت متأكد من حذف الفاتورة ${inv.document_number || ''}؟`,
              okText: 'نعم، احذف',
              okType: 'danger',
              cancelText: 'تراجع',
              onOk: async () => {
                await handleDeleteInvoice(inv);
                closeCreate();
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
        disabled: !isSaved,
        onClick: () => {
          const doc = invoiceDoc(viewInvoice || editingInvoice);
          if (doc) printInvoice(doc, printOpts);
        },
      },
      {
        key: 'accounts',
        label: 'حسابات',
        icon: <BankOutlined />,
        disabled: !selectedCustomerId,
        onClick: () => selectedCustomerId && navigate(`/customers/${selectedCustomerId}`),
      },
      {
        key: 'reload',
        label: 'تحميل',
        icon: <ReloadOutlined />,
        onClick: () => setLoadRangeOpen(true),
      },
    ];
  };

  const partyPicker = (
    <PartyPickerModal
      open={partyPickerOpen || newStep === 'party'} kind="customer"
      kinds={['customer', 'employee']}
      excludeTypes={['plumber']} variant="cards" contextLabel={isBonus ? 'فاتورة بونص' : 'طلب بيع مباشر'}
      date={invoiceDate} onDateChange={(d) => setInvoiceDate(d)}
      onPick={handlePartyPicked}
      onCancel={() => {
        setPartyPickerOpen(false);
        if (newStep === 'party') {
          if (createForm.getFieldValue('customer_id')) { setNewStep('warehouse'); return; }
          setCreateVisible(false);
        }
        setNewStep(null);
      }} />
  );

  const urlDocWanted = Number(searchParams.get('doc') || searchParams.get('edit')
    || searchParams.get('id')) || null;
  const urlDocFresh = urlDocWanted != null && urlDocWanted !== docInUrl.current
    && urlDocWanted !== closedDocRef.current && onScreen;
  if (!createVisible && (docOpening || urlDocFresh)) return <DocOpening />;

  if (createVisible) {
    const showCouponBlock = !isFactory
      && !(viewOnly && !couponRows.some((r) => r.serial_from || r.coupon_kind));
    return (
      <div className="sale-doc">
      {partyPicker}
      <div className="sale-card sale-head">
        <div className="sale-head-row">
          <Button size="small" icon={<ArrowRightOutlined />} onClick={() => closeCreate()}>رجوع</Button>
          <span className="sale-title">
            {viewInvoice
              ? <>{isBonus ? 'فاتورة بونص' : 'طلب بيع'} رقم: <b dir="ltr">{viewInvoice.document_number || ''}</b></>
              : editingInvoice
                ? `تعديل ${isBonus ? 'فاتورة بونص' : 'طلب بيع'} #${editingInvoice.id}`
                : isBonus ? 'تسجيل فاتورة بونص جديدة' : 'تسجيل طلب بيع جديد'}
          </span>
          {((viewInvoice as any)?.family || invoiceFamily) && (
            <Tag color={((viewInvoice as any)?.family || invoiceFamily) === 'أبيض'
              ? 'default' : 'blue'}
              style={{ fontWeight: 700, marginInlineEnd: 0 }}>
              {(viewInvoice as any)?.family || invoiceFamily}
            </Tag>
          )}
          {viewInvoice && !viewOnly && (
            <Tag color="gold" style={{ fontWeight: 600, marginInlineEnd: 0 }}>وضع التعديل</Tag>
          )}
          {editingInvoice?.voided && (
            <Tag color="volcano" style={{ marginInlineEnd: 0 }}>مردود / ملغي</Tag>
          )}
          <span className="sale-pager">
            <DocumentBar
              listLabel="فواتير البيع"
              listTo="/invoices"
              title={viewInvoice
                ? (viewInvoice.document_number || `#${viewInvoice.id}`)
                : editingInvoice
                  ? `تعديل #${editingInvoice.id}`
                  : 'فاتورة جديدة'}
              position={viewInvoice
                ? (periodRows ?? invoices).findIndex((r: any) => r.id === viewInvoice.id) + 1 || null
                : null}
              total={viewInvoice ? (periodRows ?? invoices).length : null}
              onPrev={viewInvoice && neighbour(1)
                ? () => { const n = neighbour(1); if (n) openDetail(n); } : undefined}
              onNext={viewInvoice && neighbour(-1)
                ? () => { const n = neighbour(-1); if (n) openDetail(n); } : undefined}
              steps={[
                { key: 'draft', label: 'مسودة' },
                { key: 'posted', label: 'مرحّل', color: 'green' },
                { key: 'voided', label: 'مردود / ملغي', color: 'volcano' },
              ]}
              current={!viewInvoice && !editingInvoice
                ? 'draft'
                : (viewInvoice || editingInvoice)?.voided ? 'voided' : 'posted'}
              extra={(
                <DatePicker size="small"
                  value={invoiceDate} allowClear={false} format="YYYY-MM-DD"
                  disabled={viewOnly}
                  onChange={(v) => setInvoiceDate(v || dayjs())}
                />
              )}
            />
          </span>
          <div className="sale-toolbar-row">
            <DocumentToolbar actions={docToolbar()} variant="buttons" />
            <DocumentHistoryButton entityType="sales_invoice"
              entityId={viewInvoice?.id ?? editingInvoice?.id}
              documentNumber={viewInvoice?.document_number} />
            {lineGrid.control}
          </div>
        </div>
      </div>

        <Form form={createForm} layout="vertical" size="small" className="doc-form sale-form"
          onValuesChange={() => setFormTick((n) => n + 1)}
          onFinish={handleCreateSubmit} requiredMark={false}>
          <div className="sale-card sale-fields">
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item label="نوع المستند">
                <Select value={isBonus ? 'bonus' : 'sale'} disabled={viewOnly || (!canBonus && !isBonus)}
                  onChange={(v) => {
                    setIsBonus(v === 'bonus'); setBonusForId(null);
                    if (v === 'bonus') setCashAmount(0); else setDiscountPct(0);
                  }}
                  options={[
                    { value: 'sale', label: 'طلب بيع' },
                    ...(canBonus || isBonus ? [{ value: 'bonus', label: 'فاتورة بونص' }] : []),
                  ]}
                  style={{ fontWeight: 700 }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="external_document_number" label="رقم ف. العميل">
                <Input placeholder="اختياري" disabled={viewOnly} />
              </Form.Item>
            </Col>
            {isBonus && (
              <Col xs={24} md={8}>
                <Form.Item label="على فاتورة بيع (اختياري)"
                  help={!selectedCustomerId ? 'اختار العميل الأول' : undefined}>
                  <Select showSearch allowClear disabled={viewOnly || !selectedCustomerId}
                    placeholder="من غير ربط — على أكتر من فاتورة"
                    value={bonusForId ?? undefined}
                    onChange={(v) => setBonusForId(v ?? null)}
                    optionFilterProp="label"
                    options={bonusTargets.map((t) => ({
                      value: t.id,
                      label: `${t.document_number} — ${t.invoice_date ?? ''} — ${money(t.net)}`,
                    }))} />
                </Form.Item>
              </Col>
            )}
            <Col xs={24} md={6} className="sale-party">
              <Form.Item
                name="customer_id"
                label={<>اسم العميل <span style={{ color: '#ef4444' }}>*</span></>}
                rules={[{ required: true, message: 'يرجى اختيار العميل!' }]}
              >
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  placeholder="اضغط لاختيار العميل"
                  disabled={viewOnly}
                  onClick={() => !viewOnly && setPartyPickerOpen(true)}
                  options={customers.map((c) => ({
                    value: c.id,
                    label: `${c.name}${c.default_price_tier ? ` — ${TIER_LABELS[c.default_price_tier]}` : ''}`,
                  }))} filterOption={searchFilter} filterSort={searchRank}/>
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="الهاتف">
                <Input readOnly disabled dir="ltr" placeholder="-"
                  suffix={<PhoneOutlined style={{ color: '#5b6575' }} />}
                  value={(customers.find((c) => c.id === selectedCustomerId) as any)?.phone || ''} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="المخزن" required>
                <Select
                  showSearch
                  placeholder="اختر المخزن للبيع منه"
                  disabled={viewOnly}
                  value={docWarehouseId ?? undefined}
                  onChange={(v) => onWarehouseChange(v as number)}
                  options={activeOptions(warehouses, docWarehouseId)} filterOption={searchFilter} filterSort={searchRank}/>
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="rep_id" label="المندوب">
                <Select allowClear showSearch placeholder="من العميل"
                  disabled={viewOnly}
                  onChange={(v) => {
                    const store = storeOfRep(v as number);
                    if (store) onWarehouseChange(store);
                  }}
                  options={repOptions(reps, invoiceRepId)} filterOption={searchFilter} filterSort={searchRank}/>
              </Form.Item>
            </Col>
            {!isFactory && families.length <= 1 && (
            <Col xs={12} md={4}>
              <Form.Item label="الخط">
                <Select
                  allowClear
                  placeholder="أبيض / بولي"
                  disabled={viewOnly}
                  value={invoiceFamily ?? undefined}
                  onChange={(v) => setInvoiceFamily(v ? String(v) : null)}
                  options={FAMILY_OPTIONS}
                />
              </Form.Item>
            </Col>
            )}
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={5}>
              <Form.Item label="مركز التكلفة">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="cost_center_id" noStyle>
                    <CostCenterField />
                  </Form.Item>
                  <Form.Item name="cost_center_distribution" noStyle>
                    <CostCenterSplit size="small" disabled={viewOnly} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col xs={24} md={showCouponBlock ? 6 : 11}>
              <Form.Item name="statement1" label="البيان">
                <Input placeholder="اختياري — بيتطبع على الفاتورة وبيتدوّر بيه" disabled={viewOnly} />
              </Form.Item>
            </Col>
            <Col xs={24} md={showCouponBlock ? 4 : 8}>
              <Form.Item name="notes" label="ملاحظات الفاتورة">
                <Input placeholder="اختياري" disabled={viewOnly} />
              </Form.Item>
            </Col>

            {showCouponBlock && (
            <Col xs={24} md={9}>
              <div className="coupon-grid">
                <div className="coupon-row coupon-head">
                  <span>فئة الكوبون</span><span>العدد</span><span>من رقم</span><span>إلى رقم</span><span />
                </div>
                {couponRows.map((row, i) => (
                  <div className="coupon-row" key={row.key}>
                    <Select allowClear showSearch style={{ width: '100%' }}
                      disabled={viewOnly}
                      placeholder="عادي / فضي / ذهبي"
                      value={row.coupon_kind}
                      onChange={(v) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                        ? { ...x, coupon_kind: v as string } : x)))}
                      options={couponKindOptions.map((k) => ({ value: k.value, label: k.label }))} filterOption={searchFilter} filterSort={searchRank}/>
                    <InputNumber style={{ width: '100%' }} disabled
                      value={couponCount(row.serial_from, row.serial_to) ?? undefined} />
                    <Input value={row.serial_from || ''} disabled={viewOnly}
                      onChange={(e) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                        ? { ...x, serial_from: e.target.value } : x)))} />
                    <Input value={row.serial_to || ''} disabled={viewOnly}
                      onChange={(e) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                        ? { ...x, serial_to: e.target.value } : x)))} />
                    <div className="coupon-actions">
                      {!viewOnly && (
                        <>
                          {i === couponRows.length - 1 && (
                            <Button size="small" type="primary" className="sale-green-btn"
                              icon={<PlusOutlined />} title="نوع كوبون تاني"
                              onClick={() => setCouponRows((rs) => [...rs, blankCoupon()])} />
                          )}
                          <Button size="small" danger icon={<DeleteOutlined />} title="امسح الصف"
                            onClick={() => setCouponRows((rs) => (rs.length === 1
                              ? [blankCoupon()]
                              : rs.filter((x) => x.key !== row.key)))} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {couponRows.some((r) => couponCount(r.serial_from, r.serial_to)) && (
                  <div className="coupon-note">
                    الإجمالي: {couponRows.reduce(
                      (t, r) => t + (couponCount(r.serial_from, r.serial_to) ?? 0), 0)} كوبون
                  </div>
                )}
                {repCustody.length > 0 && (
                  <div className="coupon-note">
                    عهدة المندوب:{' '}
                    {repCustody.map((b) => `${b.coupon_kind} ${b.available}${b.ranges.length
                      ? ` (${b.ranges.map(([a, z]) => (a === z ? a : `${a}–${z}`)).join('، ')})`
                      : ' — خلصت'}`).join(' · ')}
                  </div>
                )}
              </div>
            </Col>
            )}
          </Row>
          </div>

          <div className="sale-card sale-lines">
          <div className="sale-items-bar">
            <div className="sale-items-info">
              {!isFactory && families.length > 1 && (
                <Segmented
                  disabled={viewOnly}
                  value={invoiceFamily ?? ''}
                  onChange={(v: string | number) => setInvoiceFamily(String(v) || null)}
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
            {!viewOnly && (
              <Button type="primary" className="sale-green-btn" icon={<ShoppingCartOutlined />}
                style={{ fontWeight: 700 }}
                onClick={() => setPickerOpen(true)}
              >
                إضافة صنف للفاتورة (Enter)
              </Button>
            )}
          </div>

          <TabModal
            open={pendingItems.length > 0}
            title={pendingItems.length > 1
              ? `الأصناف دي (${pendingItems.length}) من أنهي مخزن؟`
              : 'الفاتورة دي من أنهي مخزن؟'}
            okText="تمام" cancelText="إلغاء"
            okButtonProps={{ disabled: pendingWarehouse === null }}
            onCancel={() => { pendingQtys.current = {}; setPendingItems([]); }}
            onOk={async () => {
              const wh = pendingWarehouse;
              const items = pendingItems;
              if (wh === null || items.length === 0) return;
              const typed = pendingQtys.current;
              pendingQtys.current = {};
              setPendingItems([]);
              setDocWarehouseId(wh);
              await loadWarehouseStock(wh);
              await addPickedSequentially(items, typed,
                (id, q) => addProductByIdWith(id, wh, q), setFocusLineKey);
            }}
            destroyOnHidden
          >
            <Select
              style={{ width: '100%' }} size="large" showSearch
              placeholder="اختر المخزن"
              value={pendingWarehouse ?? undefined}
              onChange={(v) => setPendingWarehouse(v as number)}
              options={activeOptions(warehouses, pendingWarehouse)} filterOption={searchFilter} filterSort={searchRank}/>
            <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 15 }}>
              هيثبت لكل أصناف الفاتورة. تقدر تغيّر مخزن أي سطر من عمود «المخزن».
            </div>
          </TabModal>

          <ProductPickerModal
            variant="cards" warehouseName={warehouses.find((w) => w.id === docWarehouseId)?.name} priceTier={customerTier || 'consumer'} priceTierLabel={TIER_LABELS[customerTier || 'consumer']}
            open={pickerOpen}
            categories={productCategories}
            categoryLabels={categoryLabels}
            products={products}
            activeCategory={activeCategory}
            onCategoryChange={(c) => { setActiveCategory(c); setPanelItemId(null); }}
            availableFor={(id) => (docWarehouseId === null || !availability[docWarehouseId]
              ? null : availableFor(id, null, docWarehouseId))}
            availabilityVersion={`${docWarehouseId ?? ''}|${Object.keys(availability).join(',')}`}
            disableOutOfStock
            hidePurchasePrice
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
            <Empty description="اختر الفئة ثم المنتجات لإضافتها للفاتورة"
              style={{ margin: '12px 0' }} />
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
                                إجمالي الفئة: {money(group.items.reduce((s, l) => s + saleLineNet(l), 0))}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {group.items.map((line, idx) => (
                        <tr key={line.key}>{lineGrid.row(line, idx)}</tr>
                      ))}
                    </React.Fragment>
                  ))}
                  <QuickAddRow
                    colSpan={lineGrid.count} disabled={viewOnly}
                    items={products}
                    warehouses={warehouses} warehouseId={docWarehouseId}
                    onWarehouseChange={async (w) => { setDocWarehouseId(w); await loadWarehouseStock(w); }}
                    availableFor={(id) => (docWarehouseId === null || !availability[docWarehouseId]
                      ? null : availableFor(id, null, docWarehouseId))}
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
          </div>

          {viewReturns.length > 0 && (
            <div className="sale-card">
              <Divider orientation="right">المرتجعات المسجلة على هذه الفاتورة</Divider>
              <Table
                size="small" pagination={false} rowKey="id"
                dataSource={viewReturns}
                columns={[
                  { title: 'سند المرتجع', dataIndex: 'document_number', render: (d: string) => <Tag color="volcano">{d}</Tag> },
                  { title: 'القيمة', dataIndex: 'value', render: (v: string) => `${money(v)}` },
                  { title: 'ردّ نقدي', dataIndex: 'cash_refund', render: (v: string) => `${money(v)}` },
                  { title: 'خصم آجل', dataIndex: 'credit_reduction', render: (v: string) => `${money(v)}` },
                ]}
              />
            </div>
          )}

          {(() => {
            const invoiceDiscount = grossTotal - netTotal;
            const hasParty = !!selectedCustomerId && customerBalance !== null;
            const balance = customerBalance ?? 0;
            const due = balance + netTotal - cashAmount;
            return (
              <>
              <div className="sale-card sale-notes">
                <div className="sale-notes-line">
                  {!isFactory && (
                    <span>النقاط المكتسبة: <b style={{ color: '#2563eb' }}>
                      {totalPoints.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}</b></span>
                  )}
                  {hasParty && (
                    <span>كوبونات سابقة للعميل:{' '}
                      {customerCoupons.length
                        ? <b style={{ color: '#F5A11D' }}>
                            {customerCoupons.length} — من {couponRange.from} إلى {couponRange.to}</b>
                        : <b>لا يوجد</b>}
                    </span>
                  )}
                  {creditAmount < -0.001 && (
                    <span>يُسدَّد من المديونية السابقة:{' '}
                      <b style={{ color: '#16a34a' }}>{money(Math.abs(creditAmount))}</b></span>
                  )}
                  {creditAmount > 0.001 && (
                    <span>آجل على هذه الفاتورة:{' '}
                      <b style={{ color: '#dc2626' }}>{money(creditAmount)}</b></span>
                  )}
                </div>
                <div className="sale-attach">
                  <DocumentAttachments docType="sales_invoice" docId={viewInvoice?.id} title="مرفقات" />
                </div>
              </div>
              <div className="sale-bottom">
              <Row gutter={[10, 10]}>
                <Col xs={24} lg={16}>
                  <div className="sale-tiles">
                    <SummaryTile label="بعد الخصم الثابت" value={money(afterFixedTotal)} />
                    <SummaryTile label="إجمالي الأصناف" value={money(grossTotal)} />
                    {invoiceDiscount > 0.001 && (
                      <SummaryTile label={`خصم الفاتورة (${isBonus ? 100 : discountPct}%)`}
                        value={`− ${money(invoiceDiscount)}`} color="#dc2626" />
                    )}
                    <SummaryTile label="صافي الفاتورة" value={money(netTotal)} color="#16a34a" />
                    {hasParty && families.map((a) => {
                      const b = Number(a.balance || 0);
                      return (
                        <SummaryTile key={a.family} label={`مديونية ${a.family}`}
                          value={money(b)} color={b > 0 ? '#dc2626' : '#16a34a'}
                          active={a.family === invoiceFamily} />
                      );
                    })}
                    {hasParty && (
                      <SummaryTile label="إجمالي المديونية" tone="yellow" value={money(balance)}
                        color={balance > 0 ? '#dc2626' : '#16a34a'} />
                    )}
                    {hasParty && (
                      <SummaryTile label="الباقي على العميل" tone={due > 0.001 ? 'rose' : 'mint'}
                        value={money(due)} color={due > 0.001 ? '#dc2626' : '#15803d'} />
                    )}
                  </div>
                </Col>

                <Col xs={24} lg={8}>
                  <div className="sale-card sale-pay">
                    <div className="sale-pay-inputs">
                    <Form.Item label="خصم على إجمالي الفاتورة">
                      <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%"
                        disabled={viewOnly}
                        value={isBonus ? 100 : discountPct} onChange={(val) => {
                          const v = Number(val || 0);
                          if (v >= 100 && !isBonus) {
                            if (!canBonus) { message.error('ليس لديك صلاحية «إصدار فاتورة بونص».'); return; }
                            setIsBonus(true); setBonusForId(null); setCashAmount(0);
                            message.info('خصم ١٠٠٪ = فاتورة بونص');
                            return;
                          }
                          if (v < 100 && isBonus) { setIsBonus(false); setBonusForId(null); }
                          setDiscountPct(v >= 100 ? 0 : v);
                        }} />
                    </Form.Item>
                    <Form.Item label="المبلغ المدفوع نقداً">
                      <InputNumber min={0} style={{ width: '100%' }}
                        className="sale-cash-input"
                        disabled={viewOnly || isBonus}
                        value={isBonus ? 0 : cashAmount} onChange={(val) => setCashAmount(val || 0)} />
                    </Form.Item>
                    </div>
                    {!viewOnly && (
                      <div className="sale-pay-actions">
                        <Button type="primary" htmlType="submit" loading={saving}
                          icon={<CheckOutlined />} className="sale-green-btn sale-save-btn">
                          {editingInvoice ? 'حفظ تعديلات الفاتورة' : 'تسجيل وحفظ فاتورة البيع'} (F9)
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

        <TreasuryGate {...treasuryGate} />

        <LoadPeriodModal
          open={loadRangeOpen} onCancel={() => setLoadRangeOpen(false)}
          title="تحميل فواتير فترة" endpoint="/api/v1/sales"
          columns={[
            { title: 'المستند', key: 'document_number', width: 150 },
            { title: 'التاريخ', key: 'invoice_date', width: 120 },
            { title: 'العميل', key: 'customer_name' },
            { title: 'الإجمالي', key: 'total', width: 130, money: true },
          ]}
          onLoaded={(rows) => { setInvoices(rows); setPeriodRows(rows); }}
          openNewest dateKey="invoice_date"
          onPick={(r) => openDetail(r)} />

        <WarehouseGate
          open={newStep === 'warehouse' && !viewOnly && !editingInvoice}
          title="الفاتورة دي هتتصرف من أنهي مخزن؟"
          value={docWarehouseId}
          onChange={(v) => { doorWarehouseRef.current = v as number; onWarehouseChange(v as number); }}
          warehouses={warehouses}
          onCancel={() => { setDocWarehouseId(null); setNewStep('party'); setPartyPickerOpen(true); }}
          onOk={() => setNewStep(afterWarehouseStep())}
        />

        <TabModal
          open={newStep === 'family' && !viewOnly && !editingInvoice}
          title="الفاتورة على أنهي حساب؟"
          okText="ابدأ الفاتورة" cancelText="رجوع"
          okButtonProps={{ disabled: !invoiceFamily }}
          onCancel={() => setNewStep('warehouse')}
          onOk={() => setNewStep(null)}
        >
          <div
            tabIndex={-1}
            ref={(el) => { el?.focus(); }}
            style={{ outline: 'none' }}
            onKeyDown={(e) => {
              const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];
              if (keys.includes(e.key)) {
                e.preventDefault();
                const list = familyChoices().map((o) => o.value);
                const at = list.indexOf(invoiceFamily ?? '');
                const step = (e.key === 'ArrowLeft' || e.key === 'ArrowDown') ? 1 : -1;
                setInvoiceFamily(at < 0 ? list[0] : list[(at + step + list.length) % list.length]);
                return;
              }
              if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
              if (!invoiceFamily) return;
              e.preventDefault();
              setNewStep(null);
            }}
          >
            <Segmented
              block
              size="large"
              value={invoiceFamily ?? ''}
              onChange={(v: string | number) => setInvoiceFamily(String(v) || null)}
              options={familyChoices().map((o) => {
                const acc = families.find((a) => a.family === o.value);
                return {
                  value: o.value,
                  label: (
                    <span style={{ fontWeight: 700 }}>
                      {o.label}
                      {families.length > 1 && acc ? (
                        <span style={{ color: '#5a6b5a', marginInlineStart: 8, fontSize: 15,
                                       fontWeight: 400 }}>
                          ({money(Number(acc.balance || 0))})
                        </span>
                      ) : null}
                    </span>
                  ),
                };
              })}
            />
            <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 15 }}>
              بيتغيّر من خانة «نوع الفاتورة» في الترويسة في أي وقت.
            </div>
          </div>
        </TabModal>
      </div>
    );
  }

  if (embeddedReturn) {
    return (
      <React.Suspense fallback={<div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>}>
        <ReturnsScreen embedded={{ onExit: exitEmbeddedReturn }} />
      </React.Suspense>
    );
  }

  type DocKind = typeof docKindFilter;

  const openReceipt = () => { setReceiptTarget(''); receipt.show(); };

  const editReceipt = (v: EditableVoucher) => {
    const cid = v.customer_id;
    setReceiptTarget(v.family || '__total__');
    if (cid && !receiptFamilies[cid]) {
      api.get(`/api/v1/customers/${cid}/accounts`)
        .then((r) => setReceiptFamilies((prev) => ({
          ...prev, [cid]: (r.data?.accounts || []).filter((a: any) => a.family),
        })))
        .catch(() => setReceiptFamilies((prev) => ({ ...prev, [cid]: [] })));
    }
    receipt.edit(v);
  };

  const startNewReturn = () => setEmbeddedReturn(true);

  const kindTabs: { key: DocKind; label: string; dot?: string; count?: number }[] = [
    { key: 'all', label: 'الكل',
      count: summary.totalSalesCount + summary.totalReturnsCount + summary.totalBonusCount
        + registerReceipts.totals.count },
    { key: 'sale', label: 'فواتير المبيعات', dot: '#52c41a', count: summary.totalSalesCount },
    { key: 'return', label: 'مرتجعات المبيعات', dot: '#eb2f96', count: summary.totalReturnsCount },
    { key: 'bonus', label: 'فواتير البونص', dot: '#fa8c16', count: summary.totalBonusCount },
    { key: 'receipts', label: 'سندات القبض', dot: '#1677ff' },
  ];

  const newSale = { label: 'تسجيل طلب بيع جديد', icon: <PlusOutlined />, onCreate: () => startNew(), visible: true };
  const createByKind: Record<DocKind, { label: string; icon: React.ReactNode; onCreate: () => void; visible: boolean }> = {
    all: newSale,
    sale: newSale,
    bonus: { label: 'تسجيل فاتورة بونص جديدة', icon: <GiftOutlined />,
      onCreate: () => startNew({ bonus: true }), visible: canBonus },
    return: { label: 'تسجيل مرتجع بيع جديد', icon: <RollbackOutlined />,
      onCreate: startNewReturn, visible: canWriteReturn },
    receipts: { label: 'سند قبض جديد', icon: <BankOutlined />, onCreate: openReceipt, visible: true },
  };
  const create = createByKind[docKindFilter];

  const tabCount = focus.ids
    ? focusedRecords.length
    : (kindTabs.find((t) => t.key === docKindFilter)?.count ?? focusedRecords.length);
  const footer = (
    <span className="sl-foot">
      <span>إجمالي السجلات: <b>{tabCount.toLocaleString(numeralsLocale())}</b> مستند</span>
      <span>المحدد: <b>{selectedKeys.length.toLocaleString(numeralsLocale())}</b></span>
    </span>
  );

  const fmtCount = (n: number) => n.toLocaleString(numeralsLocale());
  const partialHint = summary.partial ? '(المعروض)' : undefined;
  const showCollections = !focus.ids && !filters.payment;
  const rt = receiptsTotals;
  const summaryByKind: Record<DocKind, React.ReactNode> = {
    all: (<>
      <ListStat label="عدد المستندات" value={fmtCount(kindTabs[0].count ?? 0)} />
      <ListStat label="إجمالي المبيعات" value={money(summary.totalSalesNet)} tone="pos" hint={partialHint} />
      <ListStat label="المرتجعات" value={money(summary.totalReturnsNet)} tone="neg" hint={partialHint} />
      <ListStat label="صافي المبيعات" value={money(summary.netSales)} tone="strong" hint={partialHint} />
      <ListStat label="البونص (قبل الخصم)" value={money(summary.totalBonusGross)} tone="warn" hint={partialHint} />
      {showCollections && (
        <ListStat label="التحصيلات (سندات مستقلة)" value={money(registerReceipts.totals.total)} tone="info" />
      )}
    </>),
    sale: (<>
      <ListStat label="عدد الفواتير" value={fmtCount(summary.totalSalesCount)} />
      <ListStat label="الإجمالي قبل الخصم" value={money(summary.salesGross)} hint={partialHint} />
      <ListStat label="الخصم" value={money(summary.salesDiscount)} tone="neg" hint={partialHint} />
      <ListStat label="الصافي" value={money(summary.totalSalesNet)} tone="pos" hint={partialHint} />
      <ListStat label="النقدي" value={money(summary.salesCash)} tone="info" hint={partialHint} />
      <ListStat label="الآجل" value={money(summary.salesCredit)} tone="warn" hint={partialHint} />
    </>),
    return: (<>
      <ListStat label="عدد المرتجعات" value={fmtCount(summary.totalReturnsCount)} />
      <ListStat label="قيمة المرتجعات" value={money(summary.totalReturnsNet)} tone="neg" hint={partialHint} />
      <ListStat label="رد نقدي" value={money(summary.returnsCash)} hint={partialHint} />
      <ListStat label="خصم من الآجل" value={money(summary.returnsCredit)} hint={partialHint} />
    </>),
    bonus: (<>
      <ListStat label="عدد فواتير البونص" value={fmtCount(summary.totalBonusCount)} />
      <ListStat label="إجمالي البونص قبل الخصم" value={money(summary.totalBonusGross)} tone="warn" hint={partialHint} />
    </>),
    receipts: (<>
      <ListStat label="عدد السندات" value={rt ? fmtCount(rt.count) : '…'} />
      <ListStat label="مقبوض على الفواتير" value={rt ? money(rt.onInvoice) : '…'} />
      <ListStat label="دفعات مستقلة" value={rt ? money(rt.payments) : '…'} />
      <ListStat label="الإجمالي" value={rt ? money(rt.total) : '…'} tone="info" />
    </>),
  };

  return (
    <>
    <ListPage<DocKind>
      icon={<ShoppingCartOutlined />}
      title="المبيعات" muted="(سجل الفواتير والمرتجعات)"
      subtitle="إدارة ومتابعة حركات البيع، المرتجعات وسندات القبض النقدية"
      tabs={kindTabs} activeTab={docKindFilter}
      onTabChange={(k) => { setDocKindFilter(k); setSelectedKeys([]); setReceiptsTotals(null); }}
      summary={summaryByKind[docKindFilter]}
      actions={(<>
          {create.visible && (
            <Button type="primary" icon={create.icon} className="sl-create" onClick={create.onCreate}>
              {create.label}
            </Button>
          )}
          <PrintOptionsMenu value={printOpts} onChange={setPrintOpts}
                hideKeys={['logo', 'companyName']} />
          {docKindFilter === 'receipts' && <span ref={setReceiptsSlot} className="sl-slot" />}
          {docKindFilter !== 'receipts' && (<>
            <ExportExcelButton
              name={docKindFilter === 'bonus' ? 'فواتير البونص' : 'سجل الفواتير والمرتجعات'}
              rows={unifiedRecords}
              tableColumns={tableColumns}
              style={{ marginInlineStart: 0 }}
            />
            <ColumnSettings
              choices={columns.map((c: any) => ({
                key: String(c.key ?? c.dataIndex ?? ''),
                title: typeof c.title === 'string' ? c.title : 'إجراءات',
                locked: c.key === 'document_number' || c.key === 'doc_type',
              }))}
              hidden={invoiceCols.hidden}
              onChange={invoiceCols.setHidden}
              order={invoiceCols.order}
              onMove={(k, d) => invoiceCols.move(k, d, columns.map((c) => String(c.key ?? (c as any).dataIndex ?? '')))}
            />
          </>)}
      </>)}
      filters={(<>
        <Input
          className="sl-f-search"
          allowClear
          ref={listSearchRef}
          value={search}
          placeholder="بحث برقم المستند، الفاتورة أو العميل..."
          prefix={<SearchOutlined />}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={applySearch}
          onBlur={applySearch}
        />
        <Select className="sl-f-customer" allowClear showSearch placeholder="جميع العملاء (جهة التعامل)"
          value={filters.customer_id}
          onChange={(v) => setFilter('customer_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={filterCustomerOptions} />
        <Select className="sl-f-rep" allowClear showSearch placeholder="جميع المناديب"
          value={filters.rep_id}
          onChange={(v) => setFilter('rep_id', v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={sortByName(reps, (r) => r.full_name)
            .map((r) => ({ value: r.id, label: r.full_name }))} />
        <Select className="sl-f-family" allowClear placeholder="نوع الفاتورة"
          value={filters.family}
          onChange={(v) => setFilter('family', v)}
          options={FAMILY_OPTIONS} />
        <Input.Search className="sl-f-statement" allowClear placeholder="البيان..." value={stmtText}
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
            setFilters(next);
            fetchInvoices(next);
          }}
        />
        <Select className="sl-f-payment" allowClear placeholder="طريقة السداد"
          value={filters.payment}
          onChange={(v) => setFilter('payment', v)}
          options={[
            { value: 'cash', label: 'نقدي بالكامل' },
            { value: 'credit', label: 'آجل بالكامل' },
            { value: 'partial', label: 'جزئي (نقدي + آجل)' },
          ]} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={resetFilters}>مسح</Button>
      </>)}
    >
        {docKindFilter === 'receipts' ? (
          <PaymentsLogPanel key={receiptsKey} kind="receipts"
            partyId={filters.customer_id} repId={filters.rep_id}
            dateFrom={filters.date_from} dateTo={filters.date_to}
            onOpenInvoice={(id) => openDetail({ id } as InvoiceRecord)}
            onEditInvoice={canEditInvoice ? (id, r) => handleEditInvoice(
              { id, document_number: r.document_number } as InvoiceRecord) : undefined}
            onDeleteInvoice={canDeleteInvoice ? (id, r) => handleDeleteInvoice(
              { id, document_number: r.document_number } as InvoiceRecord) : undefined}
            onEditVoucher={editReceipt}
            onTotals={setReceiptsTotals}
            controlSlot={receiptsSlot} />
        ) : (<>
        <FocusedRowsBanner focus={focus} total={unifiedRecords.length} noun="فاتورة"
                           shown={focusedRecords.length} />
        <Table
          className="sl-table"
          dataSource={[
            ...(drafts || []).map((d: any) => {
              const x = d.payload || {};
              const ls = (x.lines || []).filter((l: any) => l.item_id != null);
              return {
                rowKey: `draft-${d.id}`, id: -d.id, __draft: d, __isDraft: true,
                doc_type: 'sale',
                document_number: 'مسودّة',
                invoice_date: String(x.invoice_date || d.updated_at || '').slice(0, 10),
                created_at: d.updated_at,
                customer_id: x?.form?.customer_id ?? null,
                rep_id: x?.form?.rep_id ?? null,
                lines_count: ls.length,
              } as any;
            }),
            ...focusedRecords,
          ]}
          columns={tableColumns}
          size="small"
          tableLayout="fixed"
          rowKey="rowKey"
          rowClassName={(r: any) => (r.__isDraft ? 'row-draft' : '')}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys),
            getCheckboxProps: (r: any) => ({ disabled: Boolean(r.__isDraft) }),
            columnWidth: 36,
          }}
          loading={loading}
          pagination={{
            defaultPageSize: TABLE_PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
            locale: { items_per_page: '' },
            showTotal: () => footer,
          }}
          onRow={(record: any) => ({
            onClick: (e) => {
              if ((e.target as HTMLElement).closest?.('.ant-table-selection-column')) return;
              if (record.__isDraft) { resumeDraft(record.__draft); return; }
              if (record.doc_type === 'sale') {
                openDetail(record.raw);
              } else if (record.doc_type === 'receipt') {
                registerReceipts.view(record);
              } else {
                openDoc('return', record.id);
              }
            },
            style: { cursor: 'pointer' },
          })}
        />
        </>)}
    </ListPage>

      <ReceiptModal
        open={receipt.open} onCancel={receipt.close}
        form={receipt.form} posting={receipt.posting} submit={receipt.submit}
        customers={customers} treasuries={receipt.treasuries} methodOptions={receipt.methodOptions}
        families={receiptFamilies} setFamilies={setReceiptFamilies}
        target={receiptTarget} setTarget={setReceiptTarget}
        reps={reps as any}
        editing={receipt.editing} treasuryOptional={receipt.custodyEdit}
      />
      {registerReceipts.modal}

      {partyPicker}

    </>
  );
}

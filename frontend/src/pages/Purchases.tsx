import React, { useEffect, useMemo, useRef, useState } from 'react';

import PaymentsLogPanel, { type PaymentsLogTotals } from '../components/PaymentsLogPanel';
import { useQueryTab } from '../components/useQueryTab';
import PaymentModal from './vouchers/PaymentModal';
import { useQuickVoucher } from './vouchers/useQuickVoucher';
import DraftTag from '../components/DraftTag';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Alert, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Result,
  Row, Select, Space, Table, Tag, Tooltip, message, DatePicker, Spin } from 'antd';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import {
  PlusOutlined, DeleteOutlined, EyeOutlined, RollbackOutlined,
  PrinterOutlined, FileAddOutlined, EditOutlined, UndoOutlined, SaveOutlined,
  ArrowLeftOutlined, ArrowRightOutlined, SearchOutlined, BankOutlined, ReloadOutlined,
  ExclamationCircleOutlined, CheckOutlined, PhoneOutlined, ShoppingCartOutlined,
  ShoppingOutlined, ClearOutlined, DownOutlined, UpOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useDocRoute, type DocMode } from '../components/useDocRoute';
import DocOpening from '../components/DocOpening';
import { useOpenDocument } from '../components/DocumentLink';
import dayjs, { Dayjs } from 'dayjs';
import CostCenterField from '../components/CostCenterField';
import CostCenterSplit from '../components/CostCenterSplit';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
import DocumentAttachments from '../components/DocumentAttachments';
import SummaryTile from '../components/saleDoc/SummaryTile';
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice }
  from '../components/InvoiceDocument';
import DocumentBar from '../components/DocumentBar';
import LoadPeriodModal from '../components/LoadPeriodModal';
import QuickAddRow from '../components/QuickAddRow';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import DocumentHistoryButton from '../components/DocumentHistory';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import { useListFilter } from '../components/ListToolbar';
import ListPage, { ListStat } from '../components/ListPage';
import ExportExcelButton from '../components/ExportExcelButton';
import DateRangeFilter from '../components/DateRangeFilter';
import { matchesStatement, statementMeta, statementText } from '../utils/statements';
import { useDraft } from '../components/useDraft';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import PartyPickerModal, { Party } from '../components/PartyPickerModal';
import ProductPickerModal from '../components/ProductPickerModal';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useLookup, labelMap } from '../hooks/useLookup';
import { TabModal } from '../components/TabModal';
import WarehouseGate from '../components/WarehouseGate';
import TreasuryGate, { useTreasuryGate } from '../components/TreasuryGate';
import { money, numeralsLocale } from '../utils/money';
import { convertUnitPrice, factorOf, unitSelectOptions } from '../utils/units';
import { fingerprint, verdictOnLeave } from '../utils/unsavedWork';
import { applyPct, combinePct, splitLineDiscount } from '../utils/discounts';
import { QTY_DATA_ATTR, flashExistingItem } from '../utils/duplicateItem';

import { useLiveRefresh } from '../utils/live';

const PurchaseReturnsScreen = React.lazy(() => import('./PurchaseReturns'));
const fmtMoney = money;

interface Supplier {
  id: number;
  name: string;
  code: string;
}

interface Warehouse {
  id: number;
  name: string;
  warehouse_type: string;
}

interface RawMaterial {
  id: number;
  code: string;
  name: string;
  unit_of_measure: string;
  purchase_price: string | null;
  sale_price?: string | null;
  consumer_price?: string | null;
  category?: string | null;
  purchase_discount_pct?: string | null;
}

interface PurchaseItem {
  key: string;
  item_id: number | null;
  quantity: number | null;
  unit_price: number;
  unit: string | null;
  discount_pct: number | null;
  fixed_discount_pct: number | null;
  warehouse_id: number | null;
}

interface ItemUnit { name: string; factor: number; is_base: boolean; }

interface PurchaseRecord {
  kind: 'purchase' | 'return';
  id: number;
  document_number: string;
  supplier_id: number;
  supplier_name: string;
  total: string;
  cash_amount: string | null;
  credit_amount: string | null;
  created_at: string;
  purchase_date: string | null;
  external_document_number: string | null;
  notes: string | null;
  branch_id: number | null;
  branch_name: string | null;
  expense_account_id: number | null;
  expense_account_name: string | null;
  parent_id?: number;
  parent_document_number?: string | null;
  gross: string | null;
  discount_amount: string | null;
  combined_pct: string | null;
  tax_amount: string | null;
  tax_pct: string | null;
  net: string | null;
  statement1?: string | null;
  statement2?: string | null;
  statement3?: string | null;
}

interface PurchaseDetailLine {
  item_id: number;
  quantity: string;
  unit_price: string;
  line_total: string;
  unit: string | null;
}

interface PurchaseDetailReturn {
  id: number;
  document_number: string;
  value: string;
  created_at: string;
}

interface PurchaseDetail extends PurchaseRecord {
  location_kind: string;
  location_id: number;
  lines: PurchaseDetailLine[];
  returns: PurchaseDetailReturn[];
}

const fmtDate = (v: string) => (v ? String(v).slice(0, 10) : '-');

export default function Purchases() {
  const navigate = useNavigate();
  const openDoc = useOpenDocument();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [stickyWarehouseId, setStickyWarehouseId] = useState<number | null>(null);
  const [availability, setAvailability] = useState<Record<number, Record<number, number>>>({});
  const [pendingItems, setPendingItems] = useState<number[]>([]);
  const [pendingWarehouse, setPendingWarehouse] = useState<number | null>(null);
  const [items, setItems] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [panelItemId, setPanelItemId] = useState<number | null>(null);
  const listSearchRef = useRef<any>(null);

  const [form] = Form.useForm();
  const watchedSupplierId = Form.useWatch('supplier_id', form);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([
    { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, fixed_discount_pct: null, warehouse_id: null },
  ]);
  const [unitsCache, setUnitsCache] = useState<Record<number, ItemUnit[]>>({});

  const [variableDiscount, setVariableDiscount] = useState<number>(0);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState<number>(0);
  const { ask: askTreasury, gateProps: treasuryGate } = useTreasuryGate();

  const [docResult, setDocResult] = useState<any>(null);

  const [createVisible, setCreateVisible] = useState(false);
  const [embeddedReturn, setEmbeddedReturn] = useState(false);
  const [listTab, setListTab] = useQueryTab('all');
  const paymentsTab = listTab === 'payments';
  const [paymentsKey, setPaymentsKey] = useState(0);
  const [paymentsSlot, setPaymentsSlot] = useState<HTMLSpanElement | null>(null);
  const [paymentsTotals, setPaymentsTotals] = useState<PaymentsLogTotals | null>(null);
  const payment = useQuickVoucher(() => setPaymentsKey((k) => k + 1));
  const [formTick, setFormTick] = useState(0);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [printOpts, setPrintOpts] = useState<PrintOptions>(loadPrintOptions);
  const [focusRowKey, setFocusRowKey] = useState<string | null>(null);
  const [newStep, setNewStep] = useState<null | 'party' | 'warehouse'>(null);
  const [purchaseDate, setPurchaseDate] = useState<Dayjs>(dayjs());
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    if (stickyWarehouseId) {
      loadWarehouseStock(stickyWarehouseId);
    }
  }, [stickyWarehouseId, pickerOpen]);
  const qtyRefs = useRef<Record<string, any>>({});
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const landedRef = useRef<string>('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const itemRefs = useRef<Record<string, any>>({});
  const [listLoading, setListLoading] = useState(false);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [viewPurchase, setViewPurchase] = useState<PurchaseDetail | null>(null);
  const [loadPeriodOpen, setLoadPeriodOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openedFingerprint, setOpenedFingerprint] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [preview, setPreview] = useState<PurchaseDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [branches, setBranches] = useState<any[]>([]);
  const [party, setParty] = useState<Party | null>(null);
  const lineWarehouses = warehouses;
  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(console.error);
  }, []);

  const purchasesFilter = useListFilter(purchases, {
    search: (p) => [p.document_number, p.supplier_name, p.external_document_number, p.notes,
      p.statement1, p.statement2, p.statement3],
    filters: {
      kind: (p, v) => p.kind === v,
      supplier_id: (p, v) => p.supplier_id === v,
      branch_id: (p, v) => p.branch_id === v,
      document_number: (p, v) => (p.document_number || '').includes(String(v)),
      external_document_number: (p, v) => (p.external_document_number || '')
        .toLowerCase().includes(String(v).toLowerCase()),
      notes: (p, v) => (p.notes || '').toLowerCase().includes(String(v).toLowerCase()),
      statement: (p, v) => matchesStatement(p, v),
    },
    dateOf: (p) => p.purchase_date || p.created_at,
  });

  const itemName = useMemo(() => {
    const m = new Map<number, RawMaterial>();
    items.forEach((i) => m.set(i.id, i));
    return (id: number) => m.get(id)?.name ?? `صنف #${id}`;
  }, [items]);

  const fetchPurchases = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setListLoading(true);
    try {
      const [inv, ret] = await Promise.all([
        api.get('/api/v1/purchases'),
        api.get('/api/v1/purchases/returns').catch(() => ({ data: [] })),
      ]);
      const invoices: PurchaseRecord[] = (inv.data || []).map((r: any) => ({
        ...r, kind: 'purchase' as const,
      }));
      const returns: PurchaseRecord[] = (ret.data || []).map((r: any) => ({
        kind: 'return' as const,
        id: r.id,
        document_number: r.document_number,
        supplier_id: r.supplier_id ?? 0,
        supplier_name: r.supplier_name ?? '',
        purchase_date: r.return_date ?? null,
        created_at: r.created_at,
        notes: r.notes ?? null,
        total: r.value || r.total || '0',
        gross: r.gross || r.value || '0',
        discount_amount: r.discount_amount || '0',
        combined_pct: r.combined_pct || '0',
        tax_amount: r.tax_amount || '0',
        tax_pct: r.tax_pct || '0',
        net: r.value || r.total || '0',
        cash_amount: r.cash_refund || '0',
        credit_amount: r.credit_reduction || '0',
        external_document_number: r.external_document_number || null,
        branch_id: r.branch_id || null,
        branch_name: r.branch_name || null,
        expense_account_id: null,
        expense_account_name: null,
        parent_id: r.purchase_invoice_id,
        parent_document_number: r.purchase_document_number ?? null,
        statement1: r.statement1 ?? null,
        statement2: r.statement2 ?? null,
        statement3: r.statement3 ?? null,
      }));
      setPurchases([...invoices, ...returns]);
    } catch (err: any) {
      console.error(err);
      if (!silent) message.error(err?.response?.data?.detail?.message || 'تعذر تحميل سجل المشتريات');
    } finally {
      if (!silent) setListLoading(false);
    }
  };
  useLiveRefresh(['purchases'], () => fetchPurchases({ silent: true }));

  const purchasesSummary = useMemo(() => {
    const invoicesList = (purchases || []).filter((p) => p.kind === 'purchase');
    const returnsList = (purchases || []).filter((p) => p.kind === 'return');
    const totalPurchasesNet = invoicesList.reduce((s, p) => s + Number(p.net || p.total || 0), 0);
    const totalReturnsNet = returnsList.reduce((s, p) => s + Number(p.net || p.total || 0), 0);
    const netPurchases = totalPurchasesNet - totalReturnsNet;
    const totalCredit = invoicesList.reduce((s, p) => s + Number(p.credit_amount || 0), 0)
      - returnsList.reduce((s, p) => s + Number(p.credit_amount || 0), 0);

    return {
      totalPurchasesCount: invoicesList.length,
      totalReturnsCount: returnsList.length,
      totalPurchasesNet,
      totalReturnsNet,
      netPurchases,
      totalCredit,
    };
  }, [purchases]);

  const routeRows = useMemo(
    () => purchases.filter((p) => p.kind === 'purchase'), [purchases]);

  const { markOpen, markClosed, opening: docOpening } = useDocRoute<PurchaseRecord>({
    rows: routeRows,
    openId: createVisible && editingId != null ? editingId : null,
    open: (row, mode) => { void openDetail(row, mode); },
    close: () => closeCreate(),
    loading: listLoading,
    fetchOne: async (id) => ({ id, kind: 'purchase' } as PurchaseRecord),
  });

  const loadDocument = async (id: number): Promise<PurchaseDetail | null> => {
    try {
      const res = await api.get(`/api/v1/purchases/${id}`);
      return res.data;
    } catch (err) {
      console.error(err);
      message.error('تعذر تحميل الفاتورة');
      return null;
    }
  };

  const openDetail = async (record: PurchaseRecord, mode: DocMode = 'view') => {
    markOpen(record.id, mode);
    try {
      const res = await api.get(`/api/v1/purchases/${record.id}`);
      const det: PurchaseDetail = res.data;
      setViewPurchase(det);
      setEditingId(det.id);
      setViewOnly(true);
      form.setFieldsValue({
        supplier_id: det.supplier_id,
        external_document_number: (det as any).external_document_number || '',
        notes: (det as any).notes || '',
        cost_center_id: (det as any).cost_center_id ?? null,
        cost_center_distribution: (det as any).cost_center_distribution ?? null,
        statement1: det.statement1 || '',
        statement2: det.statement2 || '',
        statement3: det.statement3 || '',
      });
      setPurchaseDate((det as any).purchase_date
        ? dayjs((det as any).purchase_date)
        : ((det as any).created_at ? dayjs((det as any).created_at) : dayjs()));
      const loadedItems: PurchaseItem[] = (det.lines || []).map((l: any, i: number) => ({
        key: `${Date.now()}-${i}`,
        item_id: l.item_id,
        quantity: Number(l.quantity) || null,
        unit_price: Number(l.unit_price) || 0,
        unit: l.unit ?? null,
        ...splitLineDiscount(l),
        warehouse_id: l.line_location_id ?? det.location_id ?? null,
      }));
      setPurchaseItems(loadedItems);
      setStickyWarehouseId(((det.lines || [])[0] as any)?.line_location_id ?? (det as any).location_id ?? null);
      [...new Set((det.lines || []).map((l: any) => l.item_id))].forEach((id) => fetchUnits(id as number));
      setCashAmount(Number(det.cash_amount) || 0);
      setCreditAmount(Number(det.credit_amount) || 0);
      setVariableDiscount(Number((det as any).variable_discount_pct) || 0);
      setOpenedFingerprint(fingerprintOf({
        items: loadedItems,
        variableDiscount: Number((det as any).variable_discount_pct) || 0,
        cashAmount: Number(det.cash_amount) || 0,
        creditAmount: Number(det.credit_amount) || 0,
        purchaseDate: (det as any).purchase_date
          ? dayjs((det as any).purchase_date)
          : ((det as any).created_at ? dayjs((det as any).created_at) : dayjs()),
        form: {
          supplier_id: det.supplier_id,
          external_document_number: (det as any).external_document_number || '',
          notes: (det as any).notes || '',
          cost_center_id: (det as any).cost_center_id ?? null,
          cost_center_distribution: (det as any).cost_center_distribution ?? null,
          statement1: det.statement1 || '',
          statement2: det.statement2 || '',
          statement3: det.statement3 || '',
        },
      }));
      setCreateVisible(true);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر فتح الفاتورة');
    }
  };

  const listKb = useTableKeyboard<PurchaseRecord>({
    rows: purchasesFilter.filtered, rowKey: (r) => `${r.kind}-${r.id}`,
    onOpen: (r) => openRow(r),
  });

  const purchaseDoc = (p: PurchaseDetail | null): InvoiceDoc | null => {
    if (!p) return null;
    const supplier = suppliers.find((s) => s.id === p.supplier_id);
    return {
      kind: 'purchase',
      document_number: p.document_number,
      date: p.created_at,
      partyLabel: 'المورد',
      partyName: p.supplier_name || supplier?.name || `#${p.supplier_id}`,
      partyPhone: (supplier as any)?.phone ?? null,
      gross: p.total,
      net: p.total,
      cash: p.cash_amount ?? 0,
      credit: p.credit_amount ?? 0,
      lines: (p.lines || []).map((l) => ({
        name: itemName(l.item_id),
        quantity: l.quantity,
        unit: (l as any).unit,
        unit_price: l.unit_price,
        line_total: l.line_total,
      })),
      extraMeta: [['موقع الاستلام',
        `${p.location_kind === 'warehouse' ? 'مستودع' : p.location_kind} #${p.location_id}`],
        ...statementMeta(p)],
    };
  };

  const loadLookups = async () => {
    setLoading(true);
    try {
      const [supRes, whRes, itemsRes] = await Promise.all([
        api.get('/api/v1/suppliers'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/items'),
      ]);
      setSuppliers(supRes.data);
      setWarehouses(whRes.data);
      setItems(itemsRes.data.filter((i: any) => i.active !== false));
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل قوائم الشاشة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLookups();
    fetchPurchases();
  }, []);

  useEffect(() => {
    if (!focusLineKey || pickerOpen) return undefined;
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-qty-key="${focusLineKey}"]`);
      if (el && document.activeElement === el) { setFocusLineKey(null); return; }
      el?.focus(); el?.select();
      if (++frames < 40) raf = requestAnimationFrame(tryFocus);
      else setFocusLineKey(null);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [focusLineKey, pickerOpen, purchaseItems]);

  useEffect(() => {
    if (!landedRef.current) return;
    setFocusLineKey(landedRef.current);
    landedRef.current = '';
  }, [purchaseItems]);

  const itemCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((p: any) => { if (p.category) set.add(p.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [items]);

  const linesByCategory = useMemo(
    () => (purchaseItems.length ? [{ category: null as string | null, items: purchaseItems as PurchaseItem[] }] : []),
    [purchaseItems]);

  const handleAddItem = (focusIt = false) => {
    const newKey = Date.now().toString();
    setPurchaseItems([
      ...purchaseItems,
      { key: newKey, item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, fixed_discount_pct: null, warehouse_id: null },
    ]);
    if (focusIt) setFocusRowKey(newKey);
  };

  useEffect(() => {
    if (!focusRowKey) return undefined;
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const inside = document.activeElement?.closest?.(`[data-item-key="${focusRowKey}"]`);
      if (inside) { setFocusRowKey(null); return; }
      itemRefs.current[focusRowKey]?.focus?.();
      if (++frames < 40) raf = requestAnimationFrame(tryFocus);
      else setFocusRowKey(null);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [focusRowKey, purchaseItems.length]);

  const unitOptions = (itemId: number | null) => unitSelectOptions(unitsCache[itemId || 0]);

  const [purchaseDisc, setPurchaseDisc] = useState<{
    poly_pct: number; white_pct: number; groups: Record<string, string>;
  } | null>(null);
  useEffect(() => {
    api.get('/api/v1/settings/purchase-discounts')
      .then((r) => setPurchaseDisc({
        poly_pct: Number(r.data.poly_pct), white_pct: Number(r.data.white_pct),
        groups: r.data.groups || {},
      }))
      .catch(() => {});
  }, []);
  const discGroupOf = (itemId: number | null) => {
    const cat = items.find((i) => i.id === itemId)?.category;
    return cat ? purchaseDisc?.groups[cat] ?? null : null;
  };
  const ownFixedDisc = (itemId: number | null): number | null => {
    const v = items.find((i) => i.id === itemId)?.purchase_discount_pct;
    return v !== null && v !== undefined && v !== '' ? Number(v) : null;
  };
  const defaultFixedDisc = (itemId: number | null): number | null => {
    const own = ownFixedDisc(itemId);
    if (own !== null) return own;
    const g = discGroupOf(itemId);
    if (!g || !purchaseDisc) return null;
    return g === 'poly' ? purchaseDisc.poly_pct : purchaseDisc.white_pct;
  };
  const rememberFixedDisc = (itemId: number | null, pct: number | null) => {
    if (ownFixedDisc(itemId) !== null) return;
    const g = discGroupOf(itemId);
    if (!g || pct == null || !purchaseDisc) return;
    const current = g === 'poly' ? purchaseDisc.poly_pct : purchaseDisc.white_pct;
    if (Math.abs(current - pct) < 0.001) return;
    setPurchaseDisc({ ...purchaseDisc, [g === 'poly' ? 'poly_pct' : 'white_pct']: pct });
    api.put('/api/v1/settings/purchase-discounts', { group: g, pct })
      .then(() => message.success(`خصم ${g === 'poly' ? 'البولي' : 'الأبيض والجوان'} أصبح ${pct}% للفواتير القادمة`))
      .catch(() => {});
  };

  const fetchUnits = async (itemId: number) => {
    if (unitsCache[itemId]) return;
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({
        name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
    } catch (err) { console.error(err); }
  };

  const handleRemoveItem = (key: string) => {
    setPurchaseItems((prev) => {
      if (prev.length === 1) {
        message.warning('يجب إضافة صنف واحد على الأقل للفاتورة');
        return prev;
      }
      return prev.filter((i) => i.key !== key);
    });
  };

  const handleItemChange = (key: string, field: keyof PurchaseItem, value: any) => {
    setPurchaseItems((prev) => prev.map((item) => {
      if (item.key === key) {
        let updatedItem = { ...item, [field]: value };
        if (field === 'item_id') {
          const selected = items.find((i) => i.id === value);
          let p = selected?.purchase_price ? parseFloat(selected.purchase_price) : 0;
          if (!p && selected?.sale_price) p = parseFloat(selected.sale_price);
          updatedItem.unit_price = p;
          updatedItem.unit = null;
          updatedItem.fixed_discount_pct = defaultFixedDisc(value);
          updatedItem.warehouse_id = updatedItem.warehouse_id ?? stickyWarehouseId ?? lineWarehouses[0]?.id ?? null;
          if (value) fetchUnits(value);
        } else if (field === 'unit' && item.item_id) {
          const units = unitsCache[item.item_id];
          updatedItem.unit_price = convertUnitPrice(item.unit_price || 0,
            factorOf(units, item.unit), factorOf(units, value));
        }
        return updatedItem;
      }
      return item;
    }));
  };

  const lineTotal = (it: PurchaseItem) =>
    applyPct(Number(it.quantity || 0) * (it.unit_price || 0),
             it.fixed_discount_pct, it.discount_pct);

  const grossTotal = purchaseItems.reduce((sum, it) => sum + lineTotal(it), 0);
  const invoiceTotal = grossTotal * (1 - (variableDiscount || 0) / 100);

  const handleSplitBalance = () => {
    const cash = parseFloat(cashAmount.toString()) || 0;
    const credit = Math.max(0, invoiceTotal - cash);
    setCreditAmount(parseFloat(credit.toFixed(2)));
  };

  useEffect(() => {
    handleSplitBalance();
  }, [cashAmount, invoiceTotal]);

  const purchaseToolbar = (): ToolbarAction[] => {
    const typed = purchaseItems.filter((i) => i.item_id !== null).length;
    const invoicesInList = purchasesFilter.filtered.filter((r) => r.kind === 'purchase');
    const isSaved = Boolean(editingId && viewPurchase);
    const stepDoc = (step: number) => {
      if (!invoicesInList.length) return;
      const at = invoicesInList.findIndex(
        (r) => r.id === (editingId ?? (docResult?.id as number | undefined) ?? null));
      const target = at >= 0 ? invoicesInList[at + step]
        : (step > 0 ? invoicesInList[0] : invoicesInList[invoicesInList.length - 1]);
      if (target) { closeCreate({ keepUrl: true }); openDetail(target); }
    };
    return [
      {
        key: 'new',
        label: 'جديد',
        shortcut: 'F2',
        icon: <FileAddOutlined />,
        primary: true,
        onClick: () => {
          form.resetFields();
          setPurchaseItems([
            { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
              discount_pct: null, fixed_discount_pct: null, warehouse_id: null }
          ]);
          setPurchaseDate(dayjs());
          setDetail(null);
          setDocResult(null);
          setEditingId(null);
          setViewPurchase(null);
          setViewOnly(false);
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
          message.info('الفاتورة مفتوحة الآن للتعديل');
        },
      },
      {
        key: 'undo',
        label: 'تراجع',
        icon: <UndoOutlined />,
        onClick: () => {
          if (!viewOnly && editingId) {
            openDetail({ id: editingId } as PurchaseRecord);
          } else if (purchaseItems.some((l) => l.item_id !== null)) {
            closeCreate();
          } else {
            setPurchaseItems([
              { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
                discount_pct: null, fixed_discount_pct: null, warehouse_id: null }
            ]);
          }
        },
      },
      {
        key: 'save',
        label: 'حفظ',
        shortcut: 'F9',
        icon: <SaveOutlined />,
        disabled: viewOnly || typed === 0,
        onClick: () => form.submit(),
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
        disabled: invoicesInList.length === 0,
        onClick: () => stepDoc(-1),
      },
      {
        key: 'next',
        label: 'التالى',
        icon: <ArrowLeftOutlined />,
        disabled: invoicesInList.length === 0,
        onClick: () => stepDoc(1),
      },
      {
        key: 'delete',
        label: 'حذف',
        shortcut: 'F8',
        icon: <DeleteOutlined />,
        danger: true,
        disabled: isSaved ? false : typed === 0,
        onClick: () => {
          if (isSaved && viewPurchase) {
            Modal.confirm({
              title: 'تأكيد حذف فاتورة الشراء',
              icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
              content: `هل أنت متأكد من حذف فاتورة الشراء ${viewPurchase.document_number || ''}؟`,
              okText: 'نعم، احذف',
              okType: 'danger',
              cancelText: 'إلغاء',
              onOk: async () => {
                try {
                  await api.delete(`/api/v1/purchases/${viewPurchase.id}`);
                  message.success('تم حذف الفاتورة بنجاح');
                  closeCreate();
                  fetchPurchases();
                } catch (err: any) {
                  console.error(err);
                }
              },
            });
          } else {
            setPurchaseItems([
              { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
                discount_pct: null, fixed_discount_pct: null, warehouse_id: null }
            ]);
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
          if (viewPurchase) {
            const doc = purchaseDoc(viewPurchase);
            if (doc) printInvoice(doc, printOpts);
          }
        },
      },
      {
        key: 'accounts',
        label: 'حسابات',
        icon: <BankOutlined />,
        disabled: !viewPurchase?.supplier_id && !party?.id && !form.getFieldValue('supplier_id'),
        onClick: () => {
          const sid = viewPurchase?.supplier_id ?? party?.id ?? (form.getFieldValue('supplier_id') as number | undefined);
          if (sid) navigate(`/suppliers/${sid}`);
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

  const detailReturnColumns = [
    { title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', render: (d: string) => <Tag color="volcano">{d}</Tag> },
    { title: 'القيمة', dataIndex: 'value', key: 'value', render: (v: string) => `${fmtMoney(v)}` },
    { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', render: (v: string) => fmtDate(v) },
  ];

  const editPosted = async (det: PurchaseDetail) => {
    setEditingId(det.id);
    form.setFieldsValue({
      supplier_id: det.supplier_id,
      warehouse_id: det.location_id ?? undefined,
      statement1: det.statement1 || '',
      statement2: det.statement2 || '',
      statement3: det.statement3 || '',
    });
    setPurchaseDate((det as any).purchase_date
      ? dayjs((det as any).purchase_date) : dayjs());
    const loadedItems: PurchaseItem[] = (det.lines || []).map((l: any, i: number) => ({
      key: `${Date.now()}-${i}`,
      item_id: l.item_id,
      quantity: Number(l.quantity) || null,
      unit_price: Number(l.unit_price) || 0,
      unit: l.unit ?? null,
      ...splitLineDiscount(l),
      warehouse_id: l.line_location_id ?? det.location_id ?? null,
    }));
    setPurchaseItems(loadedItems);
    setStickyWarehouseId(
      ((det.lines || [])[0] as any)?.line_location_id ?? (det as any).location_id ?? null);
    [...new Set((det.lines || []).map((l: any) => l.item_id))]
      .forEach((id) => fetchUnits(id as number));
    setVariableDiscount(Number((det as any).variable_discount_pct) || 0);
    setCashAmount(Number(det.cash_amount) || 0);
    setCreditAmount(Number(det.credit_amount) || 0);
    setDetail(null);
    setOpenedFingerprint(fingerprintOf({
      items: loadedItems,
      variableDiscount: Number((det as any).variable_discount_pct) || 0,
      cashAmount: Number(det.cash_amount) || 0,
      creditAmount: Number(det.credit_amount) || 0,
      purchaseDate: (det as any).purchase_date ? dayjs((det as any).purchase_date) : dayjs(),
      form: {
        supplier_id: det.supplier_id,
        warehouse_id: det.location_id ?? undefined,
        statement1: det.statement1 || '',
        statement2: det.statement2 || '',
        statement3: det.statement3 || '',
      },
    }));
    setCreateVisible(true);
  };

  const handleSaveAndPost = async () => {
    await form.validateFields();
    if (purchaseItems.filter((i) => i.item_id !== null).length === 0) {
      message.error('يرجى إضافة صنف واحد على الأقل!');
      return;
    }
    setSubmitLoading(true);
    try {
      await handleSubmit(form.getFieldsValue());
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر ترحيل فاتورة الشراء');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleSubmit = async (values: any) => {
    const validLines = purchaseItems.filter((i) => i.item_id !== null);
    if (validLines.length === 0) {
      message.error('يرجى إضافة صنف واحد صالح على الأقل!');
      return;
    }
    const homeless = validLines.find((l) => l.warehouse_id == null);
    if (homeless) {
      message.error(`«${itemName(homeless.item_id as number)}»: اختر مخزن الاستلام.`);
      return;
    }
    const noQty = validLines.find((l) => !Number(l.quantity));
    if (noQty) {
      const name = items.find((i) => i.id === noQty.item_id)?.name ?? 'الصنف';
      message.error(`«${name}»: اكتب الكمية.`);
      return;
    }

    askTreasury(
      {
        amount: Number(cashAmount) || 0,
        direction: 'out',
        docLabel: 'فاتورة الشراء',
      },
      async (cashAccountId) => {
        setSubmitLoading(true);
        try {
          const payload = {
            supplier_id: values.supplier_id,
            location: {
              location_kind: 'warehouse',
              location_id: validLines[0].warehouse_id,
            },
            cash_amount: cashAmount,
            credit_amount: null,
            cash_account_id: cashAccountId ?? undefined,
            variable_discount_pct: variableDiscount || 0,
            external_document_number: values.external_document_number || null,
            cost_center_id: values.cost_center_id ?? null,
            cost_center_distribution: values.cost_center_distribution ?? null,
            expense_account_id: null,
            notes: values.notes || null,
            statement1: values.statement1 || null,
            statement2: values.statement2 || null,
            statement3: values.statement3 || null,
            lines: validLines.map((l) => ({
              item_id: l.item_id,
              quantity: Number(l.quantity || 0),
              unit_price: l.unit_price,
              unit: l.unit,
              discount_pct: combinePct(l.fixed_discount_pct, l.discount_pct) || null,
              fixed_discount_pct: l.fixed_discount_pct ?? null,
              variable_discount_pct: l.discount_pct ?? null,
              warehouse_id: l.warehouse_id,
            })),
            purchase_date: purchaseDate.format('YYYY-MM-DD'),
          };

          const res = editingId !== null
            ? await api.put(`/api/v1/purchases/${editingId}`, payload)
            : await api.post('/api/v1/purchases', payload);
          message.success(editingId !== null
            ? `تم حفظ الفاتورة ${res.data?.document_number ?? ''}`
            : `تم تسجيل فاتورة الشراء ${res.data?.document_number ?? ''} بنجاح`);
          markClosed();
          setCreateVisible(false);
          setDetail(null);
          setDocResult(null);
          setNewStep(null);
          setOpenedFingerprint(null);
          setEditingId(null);
          form.resetFields();
          setPurchaseItems([{ key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
            discount_pct: null, fixed_discount_pct: null, warehouse_id: null }]);
          setCashAmount(0);
          setCreditAmount(0);
          discardDraft();
          fetchPurchases();
        } catch (err: any) {
          console.error(err);
          message.error(err?.response?.data?.detail?.message || 'تعذر ترحيل فاتورة الشراء');
        } finally {
          setSubmitLoading(false);
        }
      },
    );
  };

  const handlePartyPicked = (picked: Party) => {
    setPartyPickerOpen(false);
    setParty(picked);
    form.setFieldsValue({ supplier_id: picked.id });
    setSuppliers((prev) => (prev.some((x) => x.id === picked.id)
      ? prev : [...prev, { id: picked.id, name: picked.name, code: '' } as any]));
    if (newStep === 'party') {
      setNewStep('warehouse');
    }
  };

  const addProductById = async (itemId: number, qty: number | null = null) => {
    if (!itemId) return;
    addProducts([itemId], qty ? { [itemId]: qty } : undefined);
  };

  const addProducts = (ids: number[], qtys?: Record<number, number>) => {
    const wh = stickyWarehouseId ?? lineWarehouses[0]?.id;
    if (wh && ids.length) addProductsWith(ids, wh, qtys);
  };

  const addProductsWith = (ids: number[], warehouseId: number, qtys?: Record<number, number>) => {
    const priceOf = (itemId: number) => {
      const selected = items.find((i) => i.id === itemId);
      const p = selected?.purchase_price ? parseFloat(selected.purchase_price) : 0;
      return !p && selected?.sale_price ? parseFloat(selected.sale_price) : p;
    };
    const dups = ids.filter((id) => purchaseItems.some((l) => l.item_id === id));
    dups.forEach((id) => message.info(qtys?.[id]
      ? `«${itemName(id)}» موجود بالفعل — تمت زيادة كميته`
      : `«${itemName(id)}» موجود بالفعل — عدّل الكمية من السطر`));
    const fresh = ids.filter((id) => !dups.includes(id));
    if (!fresh.length && dups.length) flashExistingItem(dups[0]);
    if (!fresh.length && !dups.some((id) => qtys?.[id])) return;

    setPurchaseItems((prev) => {
      let next = prev;
      let first = '';
      ids.forEach((itemId) => {
        const q = qtys?.[itemId] ?? null;
        const existing = next.find((l) => l.item_id === itemId);
        if (existing) {
          if (q) {
            next = next.map((l) => (l.key === existing.key
              ? { ...l, quantity: Number(l.quantity || 0) + q } : l));
          }
          return;
        }
        const blank = next.find((l) => l.item_id === null);
        if (blank) {
          next = next.map((l) => (l.key === blank.key
            ? { ...l, item_id: itemId, unit_price: priceOf(itemId), unit: null,
                quantity: q ?? l.quantity,
                fixed_discount_pct: defaultFixedDisc(itemId),
                warehouse_id: l.warehouse_id ?? warehouseId } : l));
          if (!first && !(q ?? blank.quantity)) first = blank.key;
          return;
        }
        const key = `${Date.now()}-${itemId}`;
        if (!first && !q) first = key;
        next = [...next, {
          key, item_id: itemId, quantity: q, unit_price: priceOf(itemId), unit: null,
          fixed_discount_pct: defaultFixedDisc(itemId),
          discount_pct: null, warehouse_id: warehouseId,
        }];
      });
      landedRef.current = first;
      return next;
    });

    if (fresh.length) setPanelItemId(fresh[fresh.length - 1]);
    fresh.forEach((id) => fetchUnits(id));
  };

  const handleProductPicked = (item: any) => {
    setPickerOpen(false);
    addProductById(item.id);
  };

  const advanceFrom = (key: string) => {
    const idx = purchaseItems.findIndex((l) => l.key === key);
    const next = idx >= 0 ? purchaseItems[idx + 1] : undefined;
    if (next) { setFocusLineKey(next.key); return; }
    setPickerOpen(true);
  };

  const fingerprintOf = (v: {
    items: PurchaseItem[]; variableDiscount: any; cashAmount: any; creditAmount: any;
    purchaseDate: any; form: any;
  }) => fingerprint({
    lines: v.items
      .filter((l) => l.item_id !== null)
      .map((l) => ({
        item_id: l.item_id, quantity: l.quantity, unit_price: l.unit_price,
        unit: l.unit, discount_pct: l.discount_pct,
        fixed_discount_pct: l.fixed_discount_pct, warehouse_id: l.warehouse_id,
      })),
    variableDiscount: v.variableDiscount,
    cashAmount: v.cashAmount,
    creditAmount: v.creditAmount,
    purchaseDate: v.purchaseDate ? dayjs(v.purchaseDate).format('YYYY-MM-DD') : null,
    form: {
      supplier_id: v.form?.supplier_id,
      warehouse_id: v.form?.warehouse_id,
      external_document_number: v.form?.external_document_number,
      notes: v.form?.notes,
      cost_center_id: v.form?.cost_center_id,
      cost_center_distribution: v.form?.cost_center_distribution,
      statement1: v.form?.statement1 || '',
      statement2: v.form?.statement2 || '',
      statement3: v.form?.statement3 || '',
    },
  });

  const currentFingerprint = () => fingerprintOf({
    items: purchaseItems, variableDiscount, cashAmount, creditAmount, purchaseDate,
    form: form.getFieldsValue(),
  });

  const draftPayload = useMemo(() => ({
    lines: purchaseItems
      .filter((l) => l.item_id !== null)
      .map((l) => ({
        item_id: l.item_id, quantity: l.quantity, unit_price: l.unit_price,
        unit: l.unit, discount_pct: l.discount_pct,
        fixed_discount_pct: l.fixed_discount_pct, warehouse_id: l.warehouse_id,
      })),
    variableDiscount,
    cashAmount,
    purchase_date: purchaseDate ? dayjs(purchaseDate).format('YYYY-MM-DD') : null,
    form: form.getFieldsValue(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [purchaseItems, variableDiscount, cashAmount, purchaseDate, formTick]);

  const {
    drafts, savedAt: draftSavedAt, discard: discardDraft, adopt: adoptDraft,
    remove: removeDraft,
  } = useDraft({
    kind: 'purchase',
    payload: draftPayload,
    paused: Boolean(viewOnly || editingId),
    isEmpty: (x: any) => !x?.form?.supplier_id
      && !(x?.lines || []).some((l: any) => l.item_id != null),
    title: (x: any) => `فاتورة شراء — ${(x?.lines || []).length} صنف`,
  });

  const resumeDraft = (d: any) => {
    const x = d.payload || {};
    adoptDraft(d.id);
    setEditingId(null);
    setViewOnly(false);
    setDocResult(null);
    setDetail(null);
    if (x.purchase_date) setPurchaseDate(dayjs(x.purchase_date));
    setVariableDiscount(x.variableDiscount ?? 0);
    setCashAmount(Number(x.cashAmount) || 0);
    form.setFieldsValue(x.form || {});
    const lines = (x.lines || []).map((l: any, i: number) => ({
      key: String(i + 1),
      item_id: l.item_id ?? null,
      quantity: l.quantity ?? null,
      unit_price: l.unit_price ?? 0,
      unit: l.unit ?? null,
      discount_pct: l.discount_pct ?? null,
      fixed_discount_pct: l.fixed_discount_pct ?? null,
      warehouse_id: l.warehouse_id ?? null,
    }));
    setPurchaseItems(lines.length ? lines : [{
      key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
      discount_pct: null, fixed_discount_pct: null, warehouse_id: null }]);
    setCreateVisible(true);
  };

  const closeCreate = (opts?: { keepUrl?: boolean; stay?: boolean }) => {
    const keepUrl = opts?.keepUrl === true;
    const leave = () => {
      if (!keepUrl) markClosed({ stay: opts?.stay === true });
      setCreateVisible(false);
      setDetail(null);
      setDocResult(null);
      setNewStep(null);
      setEditingId(null);
      setOpenedFingerprint(null);
    };
    const typed = purchaseItems.filter((l) => l.item_id !== null);
    const verdict = verdictOnLeave({
      readOnly: viewOnly,
      savedDocument: editingId != null,
      now: currentFingerprint(),
      whenOpened: openedFingerprint,
      hasWork: typed.length > 0
        || form.getFieldValue('supplier_id') != null
        || Number(cashAmount || 0) > 0,
    });
    if (verdict === 'silent') { leave(); return; }
    Modal.confirm({
      title: verdict === 'confirm-edit' ? 'ترك التعديل؟' : 'ترك المستند؟',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: verdict === 'confirm-edit'
        ? 'لم يتم حفظ التعديلات. ستبقى الفاتورة كما هي.'
        : typed.length
          ? `يوجد ${typed.length} صنف مُدخل — سيتم فقدانها نهائياً.`
          : 'سيتم فقدان ما أدخلته نهائياً.',
      okText: verdict === 'confirm-edit' ? 'خروج بدون حفظ' : 'خروج وترك المستند',
      okButtonProps: { danger: true },
      cancelText: verdict === 'confirm-edit' ? 'متابعة التعديل' : 'متابعة المستند',
      onOk: leave,
      onCancel: () => { if (!keepUrl && editingId != null) markOpen(editingId); },
    });
  };

  const lineColumns: EntryColumn<PurchaseItem>[] = [
    { key: 'idx', title: '#', width: 32, locked: true,
      cellStyle: { color: '#6b6b6b', textAlign: 'center' }, cell: (_l, i) => i + 1 },
    { key: 'warehouse', title: 'المخزن', width: 130,
      cell: (line) => (
        <Select showSearch size="small" style={{ width: '100%' }} placeholder="مخزن الاستلام"
          disabled={viewOnly}
          value={line.warehouse_id ?? undefined}
          onChange={(val) => {
            handleItemChange(line.key, 'warehouse_id', val ?? null);
            setStickyWarehouseId(val ?? null);
          }}
          options={sortByName(lineWarehouses, (w: any) => w.name).map((w: any) => ({
            value: w.id,
            label: `${w.name} (${w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})`,
          }))} filterOption={searchFilter} filterSort={searchRank} />
      ) },
    { key: 'item', title: 'الصنف', width: 210, minWidth: 120, locked: true,
      cell: (line) => {
        const itemObj = line.item_id ? items.find((i) => i.id === line.item_id) : null;
        const name = line.item_id ? itemName(line.item_id) : 'اختر الصنف';
        return (
          <div>
            <b className="eg-ellipsis" title={name} style={{ fontSize: 15 }}>{name}</b>
            {itemObj?.purchase_price && Number(itemObj.purchase_price) > 0 ? (
              <div style={{ fontSize: 14, color: '#1677ff', marginTop: 1 }}>
                شراء: {fmtMoney(itemObj.purchase_price)}
              </div>
            ) : itemObj?.sale_price && Number(itemObj.sale_price) > 0 ? (
              <div style={{ fontSize: 14, color: '#52c41a', marginTop: 1 }}>
                بيع: {fmtMoney(itemObj.sale_price)}
              </div>
            ) : null}
          </div>
        );
      } },
    { key: 'unit', title: 'الوحدة', width: 80,
      cell: (line) => (
        <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
          disabled={viewOnly}
          value={line.unit ?? '__base__'}
          onChange={(val) => handleItemChange(
            line.key, 'unit', val === '__base__' ? null : val)}
          options={unitOptions(line.item_id)} />
      ) },
    { key: 'qty', title: 'الكمية', width: 90, locked: true,
      cellProps: (line) => (line.item_id != null
        ? { [QTY_DATA_ATTR]: line.item_id } as any : {}),
      cell: (line) => (
        <InputNumber size="small" style={{ width: '100%' }} min={0.001} step={1}
          disabled={viewOnly}
          placeholder="الكمية" value={line.quantity ?? undefined}
          data-qty-key={line.key} data-grid-col="qty" keyboard={false}
          onChange={(val) => handleItemChange(line.key, 'quantity', val ?? null)}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ),
      footer: (rows) => rows.reduce((n, l) => n + Number(l.quantity || 0), 0)
        .toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 }) },
    { key: 'price', title: 'سعر الوحدة', width: 100,
      cell: (line) => (
        <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="السعر" value={line.unit_price} data-price-key={line.key}
          onChange={(val) => handleItemChange(line.key, 'unit_price', val || 0)}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ),
      footer: () => null },
    { key: 'gross', width: 100, title: 'اجمالي قبل',
      cellStyle: { whiteSpace: 'nowrap' },
      cell: (line) => fmtMoney(Number(line.quantity || 0) * (line.unit_price || 0)),
      footer: (rows) => fmtMoney(rows.reduce(
        (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0)) },
    { key: 'disc_var', title: 'خصم متغير %', width: 70,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="متغير" value={line.discount_pct ?? undefined} data-disc-key={line.key}
          onChange={(val) => handleItemChange(line.key, 'discount_pct', val ?? null)}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ),
      footer: () => null },
    { key: 'disc_fixed', title: 'خصم ثابت %', width: 70,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="ثابت" value={line.fixed_discount_pct ?? undefined}
          onChange={(val) => handleItemChange(line.key, 'fixed_discount_pct', val ?? null)}
          onBlur={() => rememberFixedDisc(line.item_id, line.fixed_discount_pct)}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ),
      footer: () => null },
    { key: 'total', width: 110, title: 'الإجمالي', locked: true,
      cellStyle: { fontWeight: 700, whiteSpace: 'nowrap' },
      cell: (line) => fmtMoney(lineTotal(line)),
      footer: () => fmtMoney(grossTotal) },
    { key: 'actions', title: '', label: 'حذف السطر', width: 50, minWidth: 40, locked: true,
      cell: (line) => (viewOnly ? null : (
        <Button size="small" danger type="text" icon={<DeleteOutlined />}
          onClick={() => handleRemoveItem(line.key)} />
      )),
      footer: () => null },
  ];
  const lineGrid = useEntryGrid('purchase-lines', lineColumns);

  const createContent = docResult ? (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <Card style={{ width: 600 }}>
        <Result
          status="success"
          title="تم تسجيل فاتورة الشراء بنجاح"
          subTitle={`رقم مستند الفاتورة: ${docResult.document_number} | رقم قيد اليومية: ${docResult.ledger_entry_id || 'لا يوجد'}`}
          extra={[
            <Button type="primary" key="new" onClick={() => setDocResult(null)}>
              تسجيل فاتورة جديدة
            </Button>,
          ]}
        />
      </Card>
    </div>
  ) : (
    <div className="sale-doc">
      <div className="sale-card sale-head">
        <div className="sale-head-row">
          <Button size="small" icon={<ArrowRightOutlined />}
            onClick={() => closeCreate()}>رجوع</Button>
          <span className="sale-title">
            {viewPurchase
              ? <>فاتورة شراء رقم: <b dir="ltr">{viewPurchase.document_number || ''}</b></>
              : editingId !== null
                ? `تعديل فاتورة شراء #${editingId}`
                : 'تسجيل فاتورة شراء جديدة'}
          </span>
          {viewPurchase && !viewOnly && (
            <Tag color="gold" style={{ fontWeight: 600, marginInlineEnd: 0 }}>وضع التعديل</Tag>
          )}
          <span className="sale-pager">
            <DocumentBar
              listLabel="فواتير الشراء"
              listTo="/purchases"
              title={viewPurchase
                ? (viewPurchase.document_number || `#${viewPurchase.id}`)
                : (editingId ? `تعديل #${editingId}` : 'فاتورة شراء جديدة')}
              position={viewPurchase
                ? purchases.findIndex((r: any) => r.id === viewPurchase.id) + 1 || null : null}
              total={viewPurchase ? purchases.length : null}
              steps={[
                { key: 'draft', label: 'مسودة' },
                { key: 'posted', label: 'مرحّل', color: 'green' },
                { key: 'reversed', label: 'معكوس', color: 'volcano' },
              ]}
              current={!viewPurchase && !editingId ? 'draft'
                : ((viewPurchase as any)?.reversed_by ? 'reversed' : 'posted')}
              extra={(
                <DatePicker size="small"
                  disabled={viewOnly}
                  value={purchaseDate} allowClear={false} format="YYYY-MM-DD"
                  onChange={(v: Dayjs | null) => setPurchaseDate(v || dayjs())}
                />
              )}
            />
          </span>
          <div className="sale-toolbar-row">
            <DocumentToolbar actions={purchaseToolbar()} variant="buttons" />
            <DocumentHistoryButton entityType="purchase_invoice"
              entityId={editingId ?? viewPurchase?.id}
              documentNumber={viewPurchase?.document_number} />
            {lineGrid.control}
            <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
          </div>
        </div>
      </div>

      <Form form={form} layout="vertical" size="small" className="doc-form sale-form"
        onValuesChange={() => setFormTick((n) => n + 1)}
        onFinish={handleSubmit} requiredMark={false}>
          <div className="sale-card sale-fields">
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item name="external_document_number" label="رقم المستند">
                <Input placeholder="رقم فاتورة المورد" disabled={viewOnly} />
              </Form.Item>
            </Col>
            <Col xs={24} md={7} className="sale-party">
              <Form.Item name="supplier_id"
                label={<>المورد <span style={{ color: '#ef4444' }}>*</span></>}
                rules={[{ required: true, message: 'يرجى اختيار المورد!' }]}>
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  disabled={viewOnly}
                  placeholder="اضغط لاختيار المورد"
                  onClick={() => { if (!viewOnly) setPartyPickerOpen(true); }}
                  options={sortByName(suppliers, (sp) => sp.name).map((sp) => ({
                    value: sp.id, label: sp.name, search: sp.code || '' }))} filterOption={searchFilter} filterSort={searchRank}/>
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="الهاتف">
                <Input readOnly disabled dir="ltr" placeholder="-"
                  suffix={<PhoneOutlined style={{ color: '#5b6575' }} />}
                  value={(suppliers.find((sp) => sp.id === watchedSupplierId) as any)?.phone || ''} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item label="المخزن">
                <Select showSearch
                  disabled={viewOnly}
                  placeholder="اختر المخزن الافتراضي"
                  value={stickyWarehouseId ?? undefined}
                  onChange={(val) => setStickyWarehouseId(val ?? null)}
                  options={sortByName(lineWarehouses, (w: any) => w.name).map((w: any) => ({
                    value: w.id,
                    label: `${w.name} (${w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})`,
                  }))} filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="notes" label="ملاحظات">
                <Input placeholder="اختياري" disabled={viewOnly} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={6}>
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
            {([1, 2, 3] as const).map((n) => (
              <Col xs={24} md={6} key={n}>
                <Form.Item name={`statement${n}`} label={`بيان ${n}`}>
                  <Input placeholder="اختياري" disabled={viewOnly} />
                </Form.Item>
              </Col>
            ))}
          </Row>
          </div>

          <div className="sale-card sale-lines">
          <div className="sale-items-bar">
            <div className="sale-items-info">
              <span>
                عدد البنود الحالية: <b style={{ color: '#0f172a' }}>
                  {purchaseItems.filter((l) => l.item_id !== null).length}</b> أصناف
              </span>
            </div>
            {!viewOnly && (
              <Button data-shortcut="F2"
                type="primary" className="sale-green-btn" icon={<ShoppingCartOutlined />}
                style={{ fontWeight: 700 }}
                onClick={() => setPickerOpen(true)}
              >
                إضافة صنف للفاتورة (Enter أو F2)
              </Button>
            )}
          </div>

          {purchaseItems.length === 0 && viewOnly ? (
            <Empty description="اختر الفئة ثم الأصناف لإضافتها للفاتورة"
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
                                إجمالي الفئة: {fmtMoney(group.items.reduce((s, l) => s + lineTotal(l), 0))}
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
                    colSpan={lineGrid.count} disabled={viewOnly} items={items as any}
                    warehouses={lineWarehouses} warehouseId={stickyWarehouseId}
                    onWarehouseChange={(w) => { setStickyWarehouseId(w); loadWarehouseStock(w); }}
                    onOpenPicker={() => setPickerOpen(true)}
                    onPick={(id) => addProductById(id, null)} />
                </tbody>
                <tfoot>{lineGrid.foot(purchaseItems)}</tfoot>
              </table>
            </div>
          )}
          </div>

          <div className="sale-card sale-notes">
            {creditAmount > 0.001 && (
              <div className="sale-notes-line">
                <span>آجل على هذه الفاتورة:{' '}
                  <b style={{ color: '#dc2626' }}>{money(creditAmount)}</b></span>
              </div>
            )}
            <div className="sale-attach">
              <DocumentAttachments docType="purchase_invoice" docId={viewPurchase?.id} title="مرفقات" />
            </div>
          </div>

          <div className="sale-bottom">
          <Row gutter={[10, 10]}>
            <Col xs={24} lg={16}>
              <div className="sale-tiles">
                <SummaryTile label="إجمالي الأصناف" value={money(grossTotal)} />
                {variableDiscount > 0.001 && (
                  <SummaryTile label={`خصم الفاتورة (${variableDiscount}%)`}
                    value={`− ${money(grossTotal - invoiceTotal)}`} color="#dc2626" />
                )}
                <SummaryTile label="صافي الفاتورة" value={money(invoiceTotal)} color="#16a34a" />
                {(Number(cashAmount) || 0) - invoiceTotal > 0.001 ? (
                  <SummaryTile label="دفعة مقدّمة للمورد" tone="mint" color="#15803d"
                    value={money((Number(cashAmount) || 0) - invoiceTotal)} />
                ) : (
                  <SummaryTile label="الباقي للمورد" tone={creditAmount > 0.001 ? 'rose' : 'mint'}
                    value={money(creditAmount)} color={creditAmount > 0.001 ? '#dc2626' : '#15803d'} />
                )}
              </div>
            </Col>

            <Col xs={24} lg={8}>
              <div className="sale-card sale-pay">
                <div className="sale-pay-inputs">
                <Form.Item label="خصم على الفاتورة %">
                  <InputNumber style={{ width: '100%' }} min={0} max={99.99} step={0.5}
                    disabled={viewOnly}
                    addonAfter="%" value={variableDiscount}
                    onChange={(val) => setVariableDiscount(val || 0)} />
                </Form.Item>
                <Form.Item label="المبلغ المدفوع نقداً">
                  <InputNumber style={{ width: '100%' }} min={0}
                    className="sale-cash-input"
                    disabled={viewOnly}
                    value={cashAmount} onChange={(val) => setCashAmount(val || 0)} />
                </Form.Item>
                </div>
                {!viewOnly && (
                  <div className="sale-pay-actions">
                    <Button type="primary" htmlType="submit" loading={submitLoading}
                      icon={<CheckOutlined />} className="sale-green-btn sale-save-btn">
                      {editingId !== null ? 'حفظ التعديل' : 'تسجيل وترحيل فاتورة الشراء'} (F9)
                    </Button>
                    <Button onClick={() => closeCreate()}>إلغاء</Button>
                  </div>
                )}
              </div>
            </Col>
          </Row>
          </div>
      </Form>

      <LoadPeriodModal
        open={loadPeriodOpen} onCancel={() => setLoadPeriodOpen(false)}
        title="تحميل فواتير شراء فترة" endpoint="/api/v1/purchases"
        columns={[
          { title: 'المستند', key: 'document_number', width: 150 },
          { title: 'التاريخ', key: 'purchase_date', width: 120 },
          { title: 'المورد', key: 'supplier_name' },
          { title: 'الإجمالي', key: 'total', width: 130, money: true },
        ]}
        onLoaded={(rows) => setPurchases(rows.map((r: any) => ({ ...r, kind: 'purchase' as const })))}
        openNewest dateKey="purchase_date"
        onPick={(r) => openDetail(r)} />
    </div>
  );

  const openRow = async (row: PurchaseRecord) => {
    if (row.kind === 'return') {
      openDoc('purchase_return', row.id);
      return;
    }
    openDetail(row);
  };

  const openPrint = async (row: PurchaseRecord) => {
    setPreviewLoading(true);
    const doc = await loadDocument(row.id);
    setPreviewLoading(false);
    if (doc) setPreview(doc);
  };

  const listColumns = [
    {
      title: 'نوع المستند',
      dataIndex: 'kind',
      key: 'kind',
      width: 100,
      filters: [{ text: 'فاتورة شراء', value: 'purchase' }, { text: 'مردود شراء', value: 'return' }],
      onFilter: (v: any, r: PurchaseRecord) => r.kind === v,
      render: (v: string) => (v === 'return'
        ? <Tag color="orange" style={{ fontWeight: 600 }}>مردود شراء</Tag>
        : <Tag color="blue" style={{ fontWeight: 600 }}>فاتورة شراء</Tag>),
    },
    {
      title: 'رقم المستند',
      dataIndex: 'document_number',
      key: 'document_number',
      width: 140,
      ...textColumn(purchases, (r: PurchaseRecord) => r.document_number),
      render: (doc: string, r: any) => (
        <Space direction="vertical" size={0}>
          {r.__isDraft
            ? <DraftTag onDelete={() => removeDraft(r.__draft.id)} />
            : <Tag color={r.kind === 'purchase' ? 'blue' : 'orange'}>{doc}</Tag>}
          {r.parent_document_number && (
            <span style={{ fontSize: 14, color: '#555b65' }}>عن: {r.parent_document_number}</span>
          )}
        </Space>
      ),
    },
    { title: 'التاريخ', dataIndex: 'purchase_date', key: 'purchase_date', width: 110,
      ...dateColumn<PurchaseRecord>((r) => r.purchase_date || r.created_at),
      defaultSortOrder: 'descend' as const,
      render: (v: string | null, r: PurchaseRecord) => fmtDate(v || r.created_at) },
    { title: 'الفاتورة رقم', dataIndex: 'external_document_number',
      key: 'external_document_number', ellipsis: true, width: 130,
      ...textColumn(purchases, (r: PurchaseRecord) => r.external_document_number),
      render: (v: string | null) => v || '-' },
    { title: 'جهة التعامل', dataIndex: 'supplier_name', key: 'supplier_name', ellipsis: true, width: 190,
      ...textColumn(purchases, (r: PurchaseRecord) => r.supplier_name),
      render: (v: string) => <b>{v}</b> },
    { title: 'الفرع', dataIndex: 'branch_name', key: 'branch_name', ellipsis: true, width: 110,
      ...textColumn(purchases, (r: PurchaseRecord) => r.branch_name),
      render: (v: string | null) => v || '-' },
    { title: 'الحساب الفرعي', dataIndex: 'expense_account_name', key: 'expense_account_name', ellipsis: true, width: 150,
      ...textColumn(purchases, (r: PurchaseRecord) => r.expense_account_name),
      render: (v: string | null) => v || '-' },
    { title: 'اجمالي قبل', dataIndex: 'gross', key: 'gross', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.gross),
      render: (v: string | null) => (v === null ? '-' : `${fmtMoney(v)}`) },
    { title: 'خصم فاتورة', dataIndex: 'discount_amount', key: 'discount_amount', width: 115,
      align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.discount_amount),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)}` : '-') },
    { title: 'خصم فاتورة %', dataIndex: 'combined_pct', key: 'combined_pct', width: 110,
      align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.combined_pct),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)}%` : '-') },
    { title: 'الضرائب', dataIndex: 'tax_amount', key: 'tax_amount', width: 110, align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.tax_amount),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)}` : '-') },
    { title: 'الضرائب %', dataIndex: 'tax_pct', key: 'tax_pct', width: 100, align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.tax_pct),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)}%` : '-') },
    {
      title: 'الصافي',
      dataIndex: 'net',
      key: 'net', width: 120,
      align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.net),
      render: (v: string | null, r: PurchaseRecord) => (v === null ? '-' : (
        <strong style={{ color: r.kind === 'purchase' ? '#0958d9' : '#d46b08' }}>
          {r.kind === 'return' ? '-' : ''}{fmtMoney(v)}
        </strong>
      )),
    },
    { title: 'الاجمالي', dataIndex: 'total', key: 'total', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.total),
      render: (val: string) => <strong style={{ color: '#6AB42D' }}>{fmtMoney(val)}</strong> },
    { title: 'تم السداد', dataIndex: 'cash_amount', key: 'cash_amount', width: 115, align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.cash_amount),
      render: (val: string | null) => (val === null ? '-' : `${fmtMoney(val)}`) },
    { title: 'الباقي', dataIndex: 'credit_amount', key: 'credit_amount', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.credit_amount),
      render: (val: string | null) => (val === null ? '-' : Number(val)
        ? <b style={{ color: '#cf1322' }}>{fmtMoney(val)}</b>
        : `${fmtMoney(val)}`) },
    { title: 'ملاحظات', dataIndex: 'notes', key: 'notes', width: 170, ellipsis: true,
      ...textColumn(purchases, (r: PurchaseRecord) => r.notes),
      render: (v: string | null) => v || '-' },
    { title: 'البيان', dataIndex: 'statement1', key: 'statement1', width: 180, ellipsis: true,
      ...textColumn(purchases, (r: PurchaseRecord) => statementText(r)),
      render: (_: any, r: PurchaseRecord) => statementText(r) || '-' },
    {
      title: 'الإجراءات',
      key: 'actions',
      width: 130,
      render: (_: any, record: PurchaseRecord) => ((record as any).__isDraft ? (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="مسح المسودّة">
            <Button type="text" danger icon={<DeleteOutlined />}
              onClick={() => removeDraft((record as any).__draft.id)} />
          </Tooltip>
        </Space>
      ) : (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="عرض الفاتورة">
            <Button type="text" icon={<EyeOutlined />} onClick={() => openRow(record)} />
          </Tooltip>
          <Tooltip title="طباعة">
            <Button type="text" icon={<PrinterOutlined />}
              onClick={() => {
                if (record.kind === 'return') {
                  if (record.parent_id) openPrint({ ...record, id: record.parent_id });
                } else {
                  openPrint(record);
                }
              }} />
          </Tooltip>
          {record.kind === 'purchase' && (
            <Tooltip title="تعديل">
              <Button type="text" icon={<EditOutlined />} onClick={async () => {
                await openDetail(record);
                setViewOnly(false);
              }} />
            </Tooltip>
          )}
          <Tooltip title="حذف">
            <Button type="text" danger icon={<DeleteOutlined />} onClick={() => {
              Modal.confirm({
                title: record.kind === 'return' ? 'تأكيد حذف مردود الشراء' : 'تأكيد حذف فاتورة الشراء',
                icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
                content: `هل أنت متأكد من حذف ${record.kind === 'return' ? 'مردود الشراء' : 'فاتورة الشراء'} رقم (${record.document_number})؟`,
                okText: 'نعم، احذف',
                okType: 'danger',
                cancelText: 'إلغاء',
                onOk: async () => {
                  try {
                    const endpoint = record.kind === 'return'
                      ? `/api/v1/purchases/returns/${record.id}`
                      : `/api/v1/purchases/${record.id}`;
                    await api.delete(endpoint);
                    message.success('تم الحذف بنجاح');
                    fetchPurchases();
                  } catch (err: any) {
                    console.error(err);
                  }
                },
              });
            }} />
          </Tooltip>
        </Space>
      )),
    },
  ];

  const listCols = useTableColumns('purchase-list', listColumns, {
    defaultHidden: ['gross', 'combined_pct', 'tax_pct', 'expense_account_name', 'notes',
      'statement1'],
  });
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  useScreenShortcuts({ onSearch: () => { listSearchRef.current?.focus?.(); } }, !createVisible && !embeddedReturn);

  const kindTab = (purchasesFilter.values.kind || 'all') as 'all' | 'purchase' | 'return';
  const lastKind = useRef(kindTab);
  useEffect(() => {
    if (listTab === 'purchase' || listTab === 'return') purchasesFilter.setValue('kind', listTab);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (kindTab === lastKind.current) return;
    lastKind.current = kindTab;
    if (!paymentsTab && kindTab !== listTab) setListTab(kindTab);
  }, [kindTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const supplierIds = purchasesFilter.values.supplier_id as number[] | undefined;
  const kindTabs = [
    { key: 'all' as const, label: 'الكل',
      count: purchasesSummary.totalPurchasesCount + purchasesSummary.totalReturnsCount },
    { key: 'purchase' as const, label: 'فواتير المشتريات', dot: '#0958d9',
      count: purchasesSummary.totalPurchasesCount },
    { key: 'return' as const, label: 'مردودات المشتريات', dot: '#d46b08',
      count: purchasesSummary.totalReturnsCount },
    { key: 'payments' as const, label: 'سندات الصرف', dot: '#cf1322' },
  ];
  const moreActive = ['document_number', 'external_document_number', 'notes', 'statement']
    .some((k) => !!purchasesFilter.values[k]);
  const moreOpen = showMoreFilters || moreActive;
  const textFilter = (key: string, placeholder: string) => (
    <Input key={key} allowClear placeholder={placeholder}
      value={purchasesFilter.values[key] ?? undefined}
      onChange={(e) => purchasesFilter.setValue(key, e.target.value || undefined)} />
  );
  const shownCount = purchasesFilter.filtered.length;
  const listFooter = (
    <span className="sl-foot">
      <span>
        إجمالي السجلات: <b>{shownCount.toLocaleString(numeralsLocale())}</b>
        {shownCount < purchases.length && <> من {purchases.length.toLocaleString(numeralsLocale())}</>} مستند
      </span>
    </span>
  );

  const fmtCount = (n: number) => n.toLocaleString(numeralsLocale());
  const shownInv = purchasesFilter.filtered.filter((r) => r.kind === 'purchase');
  const shownRet = purchasesFilter.filtered.filter((r) => r.kind === 'return');
  const sumOf = (list: PurchaseRecord[], get: (r: PurchaseRecord) => any) =>
    list.reduce((t, r) => t + Number(get(r) || 0), 0);
  const invNet = sumOf(shownInv, (r) => r.net || r.total);
  const retNet = sumOf(shownRet, (r) => r.net || r.total);
  const invCash = sumOf(shownInv, (r) => r.cash_amount);
  const invCredit = sumOf(shownInv, (r) => r.credit_amount);
  const pt = paymentsTotals;
  const listSummary = paymentsTab ? (<>
    <ListStat label="عدد السندات" value={pt ? fmtCount(pt.count) : '…'} />
    <ListStat label="مدفوع على الفواتير" value={pt ? money(pt.onInvoice) : '…'} />
    <ListStat label="دفعات مستقلة" value={pt ? money(pt.payments) : '…'} />
    <ListStat label="الإجمالي" value={pt ? money(pt.total) : '…'} tone="neg" />
  </>) : kindTab === 'purchase' ? (<>
    <ListStat label="عدد الفواتير" value={fmtCount(shownInv.length)} />
    <ListStat label="الإجمالي قبل الخصم" value={money(sumOf(shownInv, (r) => r.gross))} />
    <ListStat label="الخصم" value={money(sumOf(shownInv, (r) => r.discount_amount))} tone="pos" />
    <ListStat label="الصافي" value={money(invNet)} tone="info" />
    <ListStat label="النقدي" value={money(invCash)} />
    <ListStat label="الآجل" value={money(invCredit)} tone="warn" />
  </>) : kindTab === 'return' ? (<>
    <ListStat label="عدد المردودات" value={fmtCount(shownRet.length)} />
    <ListStat label="قيمة المردودات" value={money(retNet)} tone="warn" />
  </>) : (<>
    <ListStat label="عدد المستندات" value={fmtCount(shownCount)} />
    <ListStat label="المشتريات" value={money(invNet)} tone="info" />
    <ListStat label="المردودات" value={money(retNet)} tone="warn" />
    <ListStat label="صافي المشتريات" value={money(invNet - retNet)} tone="strong" />
    <ListStat label="المدفوع نقداً" value={money(invCash)} />
    <ListStat label="المستحق للموردين" value={money(invCredit - sumOf(shownRet, (r) => r.credit_amount))}
      tone="neg" />
  </>);

  const listContent = (
    <ListPage<'all' | 'purchase' | 'return' | 'payments'>
      icon={<ShoppingOutlined />}
      title="المشتريات" muted="(سجل فواتير الشراء والمردودات)"
      tabs={kindTabs} activeTab={paymentsTab ? 'payments' : kindTab}
      summary={listSummary}
      onTabChange={(k) => {
        setListTab(k);
        setPaymentsTotals(null);
        if (k !== 'payments') purchasesFilter.setValue('kind', k === 'all' ? undefined : k);
      }}
      actions={(<>
        {paymentsTab ? (
          <Button type="primary" icon={<PlusOutlined />} className="sl-create"
            onClick={payment.show}>
            سند صرف جديد
          </Button>
        ) : kindTab === 'return' ? (
          <Button type="primary" icon={<PlusOutlined />} className="sl-create"
            onClick={() => setEmbeddedReturn(true)}>
            تسجيل مردود شراء
          </Button>
        ) : (
        <Button type="primary" icon={<PlusOutlined />} className="sl-create"
          onClick={() => {
            form.resetFields();
            setPurchaseItems([{ key: '1', item_id: null, quantity: null, unit_price: 0,
              unit: null, discount_pct: null, fixed_discount_pct: null, warehouse_id: null }]);
            setPurchaseDate(dayjs());
            setDetail(null);
            setDocResult(null);
            setEditingId(null);
            setNewStep('party');
          }}>
          تسجيل فاتورة شراء
        </Button>
        )}
        <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
        {paymentsTab ? <span ref={setPaymentsSlot} className="sl-slot" /> : (<>
          <ExportExcelButton name="المشتريات" rows={purchasesFilter.filtered}
            tableColumns={listCols.columns as any} style={{ marginInlineStart: 0 }} />
          {listCols.control}
        </>)}
      </>)}
      filters={(<>
        <Input
          className="sl-f-search"
          allowClear
          ref={listSearchRef}
          value={purchasesFilter.query}
          placeholder="بحث برقم المستند أو المورد أو رقم فاتورته أو الملاحظات أو البيان"
          prefix={<SearchOutlined />}
          onChange={(e) => purchasesFilter.setQuery(e.target.value)}
        />
        <Select className="sl-f-customer" allowClear showSearch mode="multiple"
          maxTagCount="responsive" placeholder="جميع الموردين"
          value={purchasesFilter.values.supplier_id ?? undefined}
          onChange={(v: any[]) => purchasesFilter.setValue('supplier_id', v?.length ? v : undefined)}
          filterOption={searchFilter} filterSort={searchRank}
          options={sortByName(suppliers, (s) => s.name).map((s) => ({ value: s.id, label: s.name }))} />
        <Select allowClear showSearch mode="multiple" maxTagCount="responsive"
          placeholder="جميع الفروع"
          value={purchasesFilter.values.branch_id ?? undefined}
          onChange={(v: any[]) => purchasesFilter.setValue('branch_id', v?.length ? v : undefined)}
          filterOption={searchFilter} filterSort={searchRank}
          options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
        <DateRangeFilter className="sl-f-dates"
          value={purchasesFilter.range ?? null}
          onChange={(v) => purchasesFilter.setRange(v)} />
        {moreOpen && (<>
          {textFilter('document_number', 'مستند رقم')}
          {textFilter('external_document_number', 'الفاتورة رقم')}
          {textFilter('notes', 'ملاحظات')}
          {textFilter('statement', 'البيان')}
        </>)}
        <Button className="sl-f-clear" type="link"
          icon={moreOpen ? <UpOutlined /> : <DownOutlined />}
          onClick={() => setShowMoreFilters((v) => !v)}>
          فلاتر أكثر
        </Button>
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={purchasesFilter.reset}>مسح</Button>
      </>)}
    >
      {paymentsTab ? (
        <PaymentsLogPanel key={paymentsKey} kind="payments"
          partyId={supplierIds?.length === 1 ? supplierIds[0] : undefined}
          dateFrom={purchasesFilter.range?.[0]?.format('YYYY-MM-DD')}
          dateTo={purchasesFilter.range?.[1]?.format('YYYY-MM-DD')}
          onOpenInvoice={(id) => openDetail({ id } as PurchaseRecord)}
          onEditInvoice={async (id) => {
            await openDetail({ id } as PurchaseRecord, 'edit');
            setViewOnly(false);
          }}
          onDeleteInvoice={async (id) => {
            await api.delete(`/api/v1/purchases/${id}`);
            message.success('تم الحذف بنجاح');
            fetchPurchases({ silent: true });
          }}
          onEditVoucher={payment.edit}
          onTotals={setPaymentsTotals}
          controlSlot={paymentsSlot} />
      ) : (
      <Table
        {...listKb.tableProps}
        onRow={(r: any) => {
          const base = (listKb.tableProps.onRow?.(r) ?? {}) as any;
          if (!r.__isDraft) return base;
          return {
            ...base,
            onClick: () => resumeDraft(r.__draft),
            style: { ...(base.style || {}), cursor: 'pointer' },
          };
        }}
        rowClassName={(r: any) => (r.__isDraft ? 'row-draft' : '')}
        className="sl-table"
        size="small"
        dataSource={[
          ...(drafts || []).map((d: any) => {
            const x = d.payload || {};
            const ls = (x.lines || []).filter((l: any) => l.item_id != null);
            return {
              kind: 'purchase', id: -d.id, __draft: d, __isDraft: true,
              document_number: 'مسودّة',
              purchase_date: String(x.purchase_date || d.updated_at || '').slice(0, 10),
              created_at: d.updated_at,
              supplier_id: x?.form?.supplier_id ?? null,
              lines_count: ls.length,
            } as any;
          }),
          ...purchasesFilter.filtered,
        ]}
        columns={listCols.columns}
        rowKey={(r: PurchaseRecord) => `${r.kind}-${r.id}`}
        loading={listLoading}
        tableLayout="fixed"
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
          locale: { items_per_page: '' },
          showTotal: () => listFooter,
        }}
        locale={{ emptyText: 'لا توجد عمليات شراء بعد' }}
        summary={(rows) => {
          const list = rows as readonly PurchaseRecord[];
          if (!list.length) return null;
          const sum = (get: (r: PurchaseRecord) => any) =>
            list.reduce((n, r) => n + Number(get(r) || 0), 0);
          const MONEY: Record<string, ((r: PurchaseRecord) => any) | undefined> = {
            gross: (r) => r.gross,
            discount_amount: (r) => r.discount_amount,
            tax_amount: (r) => r.tax_amount,
            net: (r) => r.net,
            total: (r) => r.total,
            cash_amount: (r) => r.cash_amount,
            credit_amount: (r) => r.credit_amount,
          };
          return (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: '#f6faf3', fontWeight: 700 }}>
                {(listCols.columns as any[]).map((col, i) => {
                  const key = String(col.key ?? col.dataIndex ?? i);
                  const get = MONEY[key];
                  return (
                    <Table.Summary.Cell key={key} index={i}
                      align={get ? ('left' as const) : undefined}>
                      {i === 0 ? `${list.length} فاتورة`
                        : get ? `${fmtMoney(sum(get))}` : ''}
                    </Table.Summary.Cell>
                  );
                })}
              </Table.Summary.Row>
            </Table.Summary>
          );
        }}
      />
      )}
    </ListPage>
  );

  const detailLineColumns = [
    { title: 'الصنف', key: 'item', render: (_: any, r: PurchaseDetailLine) => itemName(r.item_id) },
    { title: 'الوحدة', dataIndex: 'unit', key: 'unit', render: (u: string | null) => u || 'الأساسية' },
    { title: 'الكمية', dataIndex: 'quantity', key: 'quantity', render: (q: string) => Number(q) },
    { title: 'سعر الوحدة', dataIndex: 'unit_price', key: 'unit_price', render: (v: string) => `${fmtMoney(v)}` },
    { title: 'الإجمالي', dataIndex: 'line_total', key: 'line_total', render: (v: string) => `${fmtMoney(v)}` },
  ];

  const doors = (
    <>
      <PartyPickerModal contextLabel="فاتورة شراء"
        open={partyPickerOpen || newStep === 'party'} kind="supplier"
        kinds={['supplier', 'customer']}
        date={purchaseDate} onDateChange={(d) => setPurchaseDate(d)}
        onPick={handlePartyPicked}
        onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }} />

      <TabModal
        open={!!preview} onCancel={() => setPreview(null)} width={900} centered
        destroyOnHidden
        title={preview ? `فاتورة شراء ${preview.document_number}` : 'معاينة'}
        footer={(
          <Space>
            <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
            <Button type="primary" icon={<PrinterOutlined />}
              onClick={() => {
                const doc = purchaseDoc(preview);
                if (doc) printInvoice(doc, printOpts);
              }}>
              طباعة
            </Button>
            <Button onClick={() => setPreview(null)}>إغلاق</Button>
          </Space>
        )}
      >
        {preview ? <InvoiceDocument doc={purchaseDoc(preview)!} /> : null}
      </TabModal>

      <TreasuryGate {...treasuryGate} />

      <WarehouseGate
        open={newStep === 'warehouse' && !viewOnly && editingId === null}
        title="إلى أي مخزن تدخل هذه الشحنة؟"
        subtitle=""
        value={stickyWarehouseId}
        onChange={(v) => setStickyWarehouseId(v as number)}
        warehouses={lineWarehouses}
        onCancel={() => { setStickyWarehouseId(null); setNewStep('party'); setPartyPickerOpen(true); }}
        onOk={() => { setNewStep(null); setCreateVisible(true); }}
      />

      <ProductPickerModal
        open={pickerOpen}
        title="اختر الصنف المشترى"
        categories={itemCategories}
        categoryLabels={categoryLabels}
        products={items as any}
        activeCategory={activeCategory}
        onCategoryChange={(c) => { setActiveCategory(c); setPanelItemId(null); }}
        availableFor={(id) => (stickyWarehouseId && availability[stickyWarehouseId]
          ? (availability[stickyWarehouseId][id] ?? 0) : null)}
        availabilityVersion={`${stickyWarehouseId ?? ''}|${Object.keys(availability).join(',')}`}
        onCancel={() => setPickerOpen(false)}
        onPick={(id, q) => {
          setPickerOpen(false);
          addProductById(id, q ?? null);
        }}
        onPickMany={(ids, qtys) => {
          setPickerOpen(false);
          addProducts(ids, qtys);
        }} />

    </>
  );

  if (docOpening) return <DocOpening />;
  return (
    <div style={createVisible || embeddedReturn ? { height: '100%' } : undefined}>
      {doors}
      <PaymentModal
        open={payment.open} onCancel={payment.close}
        form={payment.form} posting={payment.posting} submit={payment.submit}
        suppliers={suppliers as any} treasuries={payment.treasuries}
        methodOptions={payment.methodOptions} editing={payment.editing} />
      {embeddedReturn ? (
        <React.Suspense fallback={<div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>}>
          <PurchaseReturnsScreen embedded={{
            onExit: () => { setEmbeddedReturn(false); fetchPurchases({ silent: true }); },
          }} />
        </React.Suspense>
      ) : createVisible ? createContent : listContent}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, InputNumber, Modal, Row,
  Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SearchOutlined, ClearOutlined, HistoryOutlined,
  FileAddOutlined, EditOutlined, UndoOutlined, SaveOutlined, PrinterOutlined,
  ArrowLeftOutlined, ArrowRightOutlined, BankOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ItemStockPanel from '../components/ItemStockPanel';
import ProductPickerModal from '../components/ProductPickerModal';
import PartyPickerModal, { Party } from '../components/PartyPickerModal';
import TotalsLadder from '../components/TotalsLadder';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice } from '../components/InvoiceDocument';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import { DocRef } from '../components/DocumentLink';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import CustomerAccountPanel from '../components/CustomerAccountPanel';
import { useLookup, labelMap } from '../hooks/useLookup';

/**
 * مرتجعات المبيعات — a full "return like a sale, reversed" screen: pick a customer, then the goods
 * they're bringing back; the items go back INTO stock and the money is credited to the customer.
 * On picking a customer + product it shows what the customer last paid for that item (and their
 * purchase history) and auto-fills that price as the refund price.
 */

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

interface Customer { id: number; name: string; phone?: string | null; }
interface Product {
  id: number; name: string; sale_price: string | null; is_serialized: boolean; category: string | null;
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
  /** null = «not typed yet» — same rule as the sale: a box that opens at 1 makes «5» into «15»
   *  for anybody who types over it without clearing first. */
  quantity: number | null;
  unit_price: number;
  discount: number;   // per-line discount %
  warehouse_id: number | null;   // (030) this line comes back into its own warehouse
}

interface Filters {
  q?: string; customer_id?: number; date_from?: string; date_to?: string;
}

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Returns() {
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const navigate = useNavigate();

  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState('');
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  // `DocumentLink` has always claimed it could open a return in its own screen; this screen never
  // read the id, so «افتح المستند» landed on the list and left the reader to find the row again.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingDoc = useRef<number | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [pointValues, setPointValues] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  // The sale opens as a run of doors — التاريخ, then العميل, then the page. The client asked for
  // the return to be the same document worked the same way, and a screen that opens differently is
  // the one place the habit breaks.
  const [newStep, setNewStep] = useState<null | 'date' | 'party'>(null);
  // Also opened from inside the document to change the party mid-return, exactly as the sale does.
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [returnDate, setReturnDate] = useState<Dayjs>(dayjs());
  // (031) The document fields. `sales_return` has carried these columns since 030 and the payload
  // dropped every one of them, so no return ever written could have them filled.
  const [repId, setRepId] = useState<number | null>(null);
  const [externalDocNumber, setExternalDocNumber] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [statements, setStatements] = useState<[string, string, string]>(['', '', '']);
  const [reps, setReps] = useState<any[]>([]);
  // Needed to answer «which store does this rep work out of» — the link is on the employee.
  const [employees, setEmployees] = useState<any[]>([]);
  /** الكوبونات الراجعة. Unlike the sale, this is NOT a free set of boxes: a customer can only
   *  bring back what he was handed, so the screen loads his books first and each row picks one.
   *  Validating after the fact would mean telling him at the end of the document that half of it
   *  cannot be saved, while he is still at the counter. */
  const [issuedBooks, setIssuedBooks] = useState<any[]>([]);
  const [couponRows, setCouponRows] = useState<
    { key: string; invoice_id?: number; coupon_type_id?: number | null; count?: number;
      serial_from?: string; serial_to?: string }[]>([]);
  const [createForm] = Form.useForm();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [lines, setLines] = useState<ReturnLineItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // The item the side stock panel is showing — on a return it answers "where should this go
  // back to", which is the same question the invoice asks in reverse.
  const [panelItemId, setPanelItemId] = useState<number | null>(null);
  // Same as the invoice: the picker is a window, and the caret lands in the quantity of the line
  // it just added. A return is typed at the same counter under the same pressure, so it should
  // not be the one screen that still needs a mouse between every line.
  const [pickerOpen, setPickerOpen] = useState(false);
  const qtyRefs = useRef<Record<string, any>>({});
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const [cashRefund, setCashRefund] = useState<number>(0);
  const [creditReduction, setCreditReduction] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [customerBalance, setCustomerBalance] = useState<number | null>(null);
  // The document's warehouse — the default each line falls back to when it has none of its own.
  const [docWarehouseId, setDocWarehouseId] = useState<number | null>(null);
  // The customer's purchase history per item — drives the last-price autofill + the info popover.
  const [lastInfo, setLastInfo] = useState<Record<number, LastInfo>>({});

  const [detailVisible, setDetailVisible] = useState(false);
  const [viewReturn, setViewReturn] = useState<any>(null);
  const [printOpts, setPrintOpts] = useState<PrintOptions>(loadPrintOptions);
  // All of their columns exist; these start hidden. A returns list is read for «who, when, how
  // much came back and what it cost us» — the rest are there when a question needs them.
  const returnCols = useHiddenColumns('returns-list', [
    'id', 'gross', 'discount_value', 'combined_pct', 'tax_amount',
    'rep_id', 'external_document_number', 'notes',
  ]);
  // Purchase-history popup for a line's "آخر سعر شراء" tag.
  const [histModal, setHistModal] = useState<{ name: string; rows: HistRow[] } | null>(null);

  const fetchReturns = async (override?: Filters) => {
    setLoading(true);
    try {
      const f = override ?? filters;
      const params: any = {};
      if (f.q) params.q = f.q;
      if (f.customer_id) params.customer_id = f.customer_id;
      if (f.date_from) params.date_from = f.date_from;
      if (f.date_to) params.date_to = f.date_to;
      const res = await api.get('/api/v1/sales/returns', { params });
      setReturns(res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const loadLookups = async () => {
    try {
      const [custRes, prodRes, whRes, ptRes, repRes, empRes] = await Promise.all([
        api.get('/api/v1/customers'),
        api.get('/api/v1/items?kind=product'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/products/point-values'),
        // Same source the sale uses: a rep IS a user with the sales_rep role.
        api.get('/api/v1/users?role=sales_rep').catch(() => ({ data: [] })),
        api.get('/api/v1/employees').catch(() => ({ data: [] })),
      ]);
      setCustomers(custRes.data);
      setProducts(prodRes.data);
      setWarehouses(whRes.data);
      setReps(repRes.data || []);
      setEmployees(empRes.data || []);
      const pts: Record<number, number> = {};
      (ptRes.data || []).forEach((r: any) => { pts[r.item_id] = parseFloat(r.point_value) || 0; });
      setPointValues(pts);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchReturns(); loadLookups(); }, []);

  const setFilter = (key: keyof Filters, value: any) => {
    const next = { ...filters, [key]: value };
    setFilters(next); fetchReturns(next);
  };
  const applySearch = () => setFilter('q', search.trim() || undefined);
  const resetFilters = () => { setSearch(''); setFilters({}); fetchReturns({}); };

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

  const linesByCategory = useMemo(() => {
    const groups: { category: string | null; items: ReturnLineItem[] }[] = [];
    lines.forEach((l) => {
      let g = groups.find((x) => x.category === (l.category ?? null));
      if (!g) { g = { category: l.category ?? null, items: [] }; groups.push(g); }
      g.items.push(l);
    });
    return groups;
  }, [lines]);

  const lineTotal = (l: ReturnLineItem) =>
    Number(l.quantity || 0) * l.unit_price * (1 - Math.min(99.99, l.discount || 0) / 100);
  const linePoints = (l: ReturnLineItem) =>
    (l.item_id ? (pointValues[l.item_id] || 0) : 0) * (l.quantity || 0);

  const grossTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const netTotal = grossTotal * (1 - discountPct / 100);
  const totalPoints = lines.reduce((s, l) => s + linePoints(l), 0);

  // Default the refund to a credit against the customer's account (cash stays 0 → full credit).
  useEffect(() => {
    const credit = Math.max(0, netTotal - (parseFloat(cashRefund.toString()) || 0));
    setCreditReduction(parseFloat(credit.toFixed(2)));
  }, [cashRefund, netTotal]);

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `صنف #${id}`;

  const closeCreate = () => {
    setCreateVisible(false);
    setLines([]); setActiveCategory(null); setCashRefund(0); setDiscountPct(0);
    setCustomerId(null); setLastInfo({}); setCustomerBalance(null); setDocWarehouseId(null);
    // The document fields go back to blank with everything else — a paper number left over from
    // the last return would be written onto the next one without anybody typing it.
    setRepId(null); setExternalDocNumber(''); setDocNotes(''); setStatements(['', '', '']);
    setCouponRows([]); setIssuedBooks([]);
    setReturnDate(dayjs());
    createForm.resetFields();
  };

  /** الباب التاني: العميل. Mid-return this only swaps the party; during the opening run it is the
   *  second door and hands over to the page — the same sequence, in the same order, as the sale. */
  const handlePartyPicked = (picked: Party) => {
    setPartyPickerOpen(false);
    if (newStep === 'party') { setNewStep(null); setCreateVisible(true); }
    createForm.setFieldsValue({ customer_id: picked.id });
    // A customer created inside the picker is not in the loaded list yet, so the field would
    // render a bare id until the next reload.
    setCustomers((prev) => (prev.some((c: any) => c.id === picked.id)
      ? prev : [...prev, { id: picked.id, name: picked.name } as any]));
    onCustomerChange(picked.id);
  };

  /** Which store a rep works out of. A rep IS a user; the link lives on their employee record. */
  const storeOfRep = (repId: number | null | undefined): number | null => {
    if (!repId) return null;
    return employees.find((e: any) => e.user_id === repId)?.warehouse_id ?? null;
  };

  const onCustomerChange = (cId: number) => {
    setCustomerId(cId);
    const c = customers.find((x: any) => x.id === cId);
    // Same chain as the sale: the customer fills in his rep, and the rep fills in his store.
    // Both are DEFAULTS, not locks — a rep on leave and a van that ran out are ordinary days, and
    // a field that refuses them is a field people work around by putting the document on the
    // wrong customer. Filled only when empty, so re-picking never undoes a store chosen on purpose.
    if ((c as any)?.rep_id) setRepId((c as any).rep_id);
    // Where this customer's returns actually came back to last time beats where his rep's van is:
    // it is a fact about him, learned from a return somebody already wrote, rather than a guess
    // from the round he happens to be on. His rep's store is the fallback for a customer who has
    // never had one.
    const remembered = (c as any)?.default_return_warehouse_id ?? null;
    const store = remembered ?? storeOfRep((c as any)?.rep_id);
    if (store && !createForm.getFieldValue('warehouse_id')) {
      createForm.setFieldsValue({ warehouse_id: store });
      setDocWarehouseId(store);
    }
    // A different customer means different purchase prices — start the lines fresh.
    setLines([]); setLastInfo({}); setActiveCategory(null);
    setCustomerBalance(null);
    api.get(`/api/v1/customers/${cId}/account`)
      .then((res) => setCustomerBalance(Number(res.data.balance || 0)))
      .catch((err) => console.error(err));
    // What he was actually given. A different customer holds different books, so the rows go
    // with him rather than surviving into somebody else's return.
    setCouponRows([]);
    api.get(`/api/v1/coupon-receipts/issued-to/${cId}`)
      .then((res) => setIssuedBooks(res.data || []))
      .catch(() => setIssuedBooks([]));
  };

  // Fetch what THIS customer last paid for the item, and its short purchase history.
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

  const addProductById = async (itemId: number) => {
    if (!itemId || !customerId) return;
    const prod = products.find((p) => p.id === itemId);
    if (prod?.is_serialized) {
      message.warning('الأصناف ذات الأرقام التسلسلية تُرتجع من فاتورتها الأصلية.');
      return;
    }
    const info = await fetchLastInfo(itemId);
    // Auto-select the last price the customer paid; fall back to the product's list price.
    const price = info.last_price != null
      ? parseFloat(info.last_price)
      : (prod?.sale_price ? parseFloat(prod.sale_price) : 0);
    const existing = lines.find((x) => x.item_id === itemId);
    if (existing) {
      setLines((prev) => prev.map((x) => (x.key === existing.key
        ? { ...x, quantity: Number(x.quantity || 0) + 1 } : x)));
      // Focus the line that just changed, not a new one — the eye follows the number that moved.
      setFocusLineKey(existing.key);
    } else {
      const key = Date.now().toString();
      setLines((prev) => [...prev, {
        key, category: prod?.category ?? null, item_id: itemId,
        quantity: null, unit_price: price, discount: 0, warehouse_id: null,
      }]);
      setFocusLineKey(key);
    }
  };

  // The caret goes to the new line's quantity — the same rule, and the same three traps, as the
  // sale. Wait for the picker to be GONE (an open modal traps focus by design), then keep asking
  // per frame until the box actually has it, finding the box by attribute because antd's ref
  // hands back a wrapper and cannot answer «did it land?».
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

  /** On the open return, Enter opens the item picker — the next thing anybody does is add a line. */
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

  /** شريط أدوات المستند on the return, the same row in the same order. */
  /** The row beside the one open, in the order the list is currently showing — the same rule the
   *  sale's arrows follow, so التالى means the same thing on both screens. */
  const neighbour = (step: number) => {
    if (!viewReturn) return null;
    const at = returns.findIndex((r) => r.id === viewReturn.id);
    if (at < 0) return null;
    return returns[at + step] ?? null;
  };

  /** Stepping away from a half-typed return asks first — the sale does, and losing typed lines
   *  to an arrow key is the same loss whichever document it happened on. */
  const stepFromDraft = (step: number) => {
    const target = neighbour(step);
    if (!target) return;
    const typed = lines.filter((l) => l.item_id !== null).length;
    const go = () => { closeCreate(); openDetail(target); };
    if (typed === 0) { go(); return; }
    Modal.confirm({
      title: 'سيبان المرتجع ده؟',
      content: `المرتجع اللي بتكتبه فيه ${typed} صنف ولسه ماتحفظش. لو مشيت دلوقتي هيضيع.`,
      okText: 'سيبه وامشي', cancelText: 'ارجع للمرتجع',
      okButtonProps: { danger: true },
      onOk: go,
    });
  };

  const returnToolbar = (): ToolbarAction[] => {
    const typed = lines.filter((l) => l.item_id !== null).length;
    return [
      { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
        onClick: () => { createForm.resetFields(); setLines([]);
          setReturnDate(dayjs()); setNewStep('date'); } },
      { key: 'edit', label: 'تعديل', icon: <EditOutlined />, disabled: true },
      { key: 'undo', label: 'تراجع', icon: <UndoOutlined />, disabled: typed === 0,
        onClick: () => setLines([]) },
      { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
        disabled: typed === 0, onClick: () => createForm.submit() },
      { key: 'next', label: 'التالى', icon: <ArrowLeftOutlined />,
        disabled: returns.length === 0, onClick: () => stepFromDraft(1) },
      { key: 'search', label: 'بحث', shortcut: 'F3', icon: <SearchOutlined />,
        onClick: () => setPickerOpen(true) },
      { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />,
        disabled: returns.length === 0, onClick: () => stepFromDraft(-1) },
      { key: 'delete', label: 'حذف', shortcut: 'F8', icon: <DeleteOutlined />, danger: true,
        disabled: typed === 0, onClick: () => setLines([]) },
      { key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />, disabled: true },
      { key: 'accounts', label: 'حسابات', icon: <BankOutlined />, disabled: true },
      { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />, onClick: () => loadLookups() },
    ];
  };

  const handleSubmit = (values: any) => {
    if (!customerId) { message.warning('يرجى اختيار العميل'); return; }
    const valid = lines.filter((l) => l.item_id !== null && Number(l.quantity || 0) > 0);
    if (valid.length === 0) { message.warning('أضف صنفاً واحداً على الأقل للمرتجع'); return; }
    const cash = parseFloat(cashRefund.toString()) || 0;
    if (cash + creditReduction - netTotal > 0.01 || netTotal - (cash + creditReduction) > 0.01) {
      message.error('مجموع المسترد نقداً + الخصم من الحساب يجب أن يساوي صافي المرتجع');
      return;
    }
    showReversalConfirm({
      title: 'تأكيد تسجيل مرتجع المبيعات',
      content: `سيتم إرجاع ${valid.length} صنف إلى المخزن وتسوية مبلغ ${money(netTotal)} ج.م لحساب العميل. متابعة؟`,
      onOk: async () => {
        try {
          const res = await api.post('/api/v1/sales/returns', {
            customer_id: customerId,
            origin: { location_kind: 'warehouse', location_id: values.warehouse_id },
            variable_discount_pct: discountPct,
            cash_refund: cash,
            credit_reduction: creditReduction,
            rep_id: repId ?? undefined,
            external_document_number: externalDocNumber || undefined,
            notes: docNotes || undefined,
            statement1: statements[0] || undefined,
            statement2: statements[1] || undefined,
            statement3: statements[2] || undefined,
            return_date: returnDate.format('YYYY-MM-DD'),
            // Only the rows that name a book and a count — an empty row is somebody who clicked
            // «إضافة» and changed their mind, not a coupon.
            returned_coupons: couponRows
              .filter((r) => r.serial_from && r.count)
              .map((r) => ({ serial_from: r.serial_from, serial_to: r.serial_to, count: r.count })),
            lines: valid.map((l) => ({
              item_id: l.item_id, quantity: Number(l.quantity || 0), unit_price: l.unit_price,
              discount_pct: l.discount || 0,
              // (030) only when the line differs from the document's warehouse
              warehouse_id: l.warehouse_id ?? undefined,
            })),
          });
          message.success(`تم تسجيل المرتجع بنجاح. رقم السند: ${res.data.document_number}`);
          closeCreate();
          fetchReturns();
        } catch (err) { console.error(err); }
      },
    });
  };

  const returnDoc = (r: any): InvoiceDoc | null => {
    if (!r) return null;
    const customer = customers.find((c) => c.id === r.customer_id);
    return {
      kind: 'sale_return',
      document_number: r.document_number,
      date: r.created_at ?? null,
      partyLabel: 'العميل',
      partyName: customer?.name ?? `#${r.customer_id}`,
      partyPhone: customer?.phone ?? null,
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
        unit: l.unit,
        unit_price: l.unit_price,
        discount_pct: l.discount_pct,
        points: (pointValues[l.item_id] || 0) * Number(l.quantity || 0),
        line_total: l.line_total,
        warehouse: warehouses.find((w) => w.id === l.warehouse_id)?.name ?? null,
      })),
    };
  };

  const openDetail = async (record: ReturnRecord) => {
    try {
      const res = await api.get(`/api/v1/sales/returns/${record.id}`);
      setViewReturn(res.data);
      setDetailVisible(true);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    const doc = searchParams.get('doc');
    if (doc) {
      pendingDoc.current = Number(doc);
      // Cleared at once so a refresh, or coming back to this tab later, cannot replay it.
      setSearchParams({}, { replace: true });
    }
    const wanted = pendingDoc.current;
    if (!wanted || !returns.length) return;
    // Consuming the ref is the once-only guard.
    pendingDoc.current = null;
    const target = returns.find((r) => r.id === wanted);
    if (target) openDetail(target);
    // Saying so beats a silent no-op, which reads as a broken link.
    else message.warning(`المرتجع رقم ${wanted} مش في القائمة`);
  }, [searchParams, returns]);

  // --- The full create page --------------------------------------------------------------------
  /** الباب الأول: التاريخ. Declared once and rendered in BOTH branches — the create page is an
   *  early return, so a door that lived only in the list branch unmounted the moment it opened
   *  the page behind it, leaving a dialog on screen that no state could close. */
  const doors = (
    <>
      <PartyPickerModal
        open={partyPickerOpen || newStep === 'party'} kind="customer"
        onPick={handlePartyPicked}
        onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }} />

      <Modal
        open={newStep === 'date'}
        title="تاريخ المرتجع"
        okText="التالي" cancelText="إلغاء"
        onCancel={() => setNewStep(null)}
        onOk={() => setNewStep('party')}
        destroyOnHidden
      >
        <div onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); setNewStep('party'); }
        }}>
          <DatePicker
            style={{ width: '100%' }} size="large" allowClear={false} autoFocus
            value={returnDate} onChange={(v) => setReturnDate(v || dayjs())}
            format="YYYY-MM-DD"
          />
        </div>
        <div style={{ marginTop: 10, color: '#8a8a8a', fontSize: 13 }}>
          ده يوم رجوع البضاعة، مش يوم ما اتكتب السند — والقيد المحاسبي بياخد نفس اليوم.
        </div>
      </Modal>
    </>
  );

  if (createVisible) {
    return (
      <div>
        {doors}
        <Card title="تسجيل مرتجع مبيعات جديد"
          extra={<PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />}>
          {/* Same eleven verbs in the same eleven places as the sale — a return is the sale read
              backwards, and the hand should not have to relearn the row for it. */}
          <DocumentToolbar actions={returnToolbar()} />
          <Form form={createForm} layout="vertical" onFinish={handleSubmit}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="العميل" required style={{ marginBottom: 8 }}>
                  {/* The same picker the second door opens — a searchable window with inline
                      create, not a plain dropdown. Changing the party mid-return goes through
                      the same place it was first chosen, so there is one way to answer «مين». */}
                  <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                    placeholder="اضغط لاختيار العميل"
                    value={customerId ?? undefined}
                    onClick={() => setPartyPickerOpen(true)}
                    options={customers.map((c: any) => ({ value: c.id, label: c.name }))} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="warehouse_id" label="مستودع استلام المرتجع (الافتراضي للسطور)"
                  rules={[{ required: true, message: 'يرجى اختيار المستودع!' }]}>
                  <Select placeholder="اختر المستودع الذي ترجع إليه البضاعة"
                    onChange={(v) => setDocWarehouseId(v as number)}>
                    {warehouses.map((w) => (
                      <Select.Option key={w.id} value={w.id}>{w.name}</Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            {/* (031) The document fields, the same set and the same order as the sale. They have
                been columns on `sales_return` since 030 with nothing able to fill them. */}
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item label="مندوب" style={{ marginBottom: 12 }}>
                  <Select allowClear showSearch optionFilterProp="label" placeholder="بدون مندوب"
                    value={repId ?? undefined} onChange={(v) => setRepId((v as number) ?? null)}
                    options={reps.map((r) => ({ value: r.id, label: r.full_name || r.username }))} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item label="مستند رقم" style={{ marginBottom: 12 }}
                  help="ورقة العميل — بتتسجّل جنب رقمنا، مش بدله">
                  <Input value={externalDocNumber}
                    onChange={(e) => setExternalDocNumber(e.target.value)} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="ملاحظات" style={{ marginBottom: 12 }}>
                  <Input value={docNotes} onChange={(e) => setDocNotes(e.target.value)} />
                </Form.Item>
              </Col>
            </Row>

            {/* الكوبونات الراجعة — bound to what this customer was actually handed.
                The sale offers free boxes because it is CREATING books; a return is receiving
                them back, and a coupon nobody issued to him is not his to return. Each row picks
                one of his books, and the count cannot exceed what is still out on it. */}
            {customerId && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>الكوبونات الراجعة</span>
                  <Button size="small" icon={<PlusOutlined />} disabled={!issuedBooks.length}
                    onClick={() => setCouponRows((r) => [...r, { key: String(Date.now()) }])}>
                    إضافة
                  </Button>
                  <span style={{ fontSize: 12, color: '#8a8a8a' }}>
                    {!issuedBooks.length
                      ? 'العميل ده مااستلمش كوبونات، فمفيش حاجة ترجع.'
                      : couponRows.length === 0
                        ? `عنده ${issuedBooks.length} دفتر — سيبها فاضية لو مفيش كوبونات راجعة.`
                        : `الإجمالي: ${couponRows.reduce((t, r) => t + Number(r.count || 0), 0)} كوبون`}
                  </span>
                </div>
                {couponRows.map((row) => {
                  const book = issuedBooks.find((b: any) => (
                    b.invoice_id === row.invoice_id
                    && (b.coupon_type_id ?? null) === (row.coupon_type_id ?? null)));
                  return (
                    <Row gutter={8} key={row.key} align="middle" style={{ marginBottom: 6 }}>
                      <Col xs={24} md={12}>
                        <Select showSearch style={{ width: '100%' }} optionFilterProp="label"
                          placeholder="اختر الدفتر اللي اتصرف له"
                          value={book ? `${row.invoice_id}:${row.coupon_type_id ?? ''}` : undefined}
                          onChange={(v) => {
                            const [inv, type] = String(v).split(':');
                            const b = issuedBooks.find((x: any) => (
                              x.invoice_id === Number(inv)
                              && (x.coupon_type_id ?? null) === (type ? Number(type) : null)));
                            setCouponRows((rs) => rs.map((x) => (x.key === row.key ? {
                              ...x, invoice_id: Number(inv),
                              coupon_type_id: type ? Number(type) : null,
                              // The range comes from the book, not from typing — it is the thing
                              // being returned, and retyping it is how a digit gets dropped.
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
                          }))} />
                      </Col>
                      <Col xs={12} md={5}>
                        <InputNumber style={{ width: '100%' }} min={1} placeholder="العدد الراجع"
                          max={book?.remaining}
                          value={row.count}
                          onChange={(v) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                            ? { ...x, count: (v as number) ?? undefined } : x)))} />
                      </Col>
                      <Col xs={12} md={4}>
                        <span style={{ fontSize: 12, color: '#8a8a8a' }}>
                          {book?.serial_from ? `${book.serial_from}–${book.serial_to}` : '—'}
                        </span>
                      </Col>
                      <Col xs={24} md={3}>
                        <Button type="text" danger icon={<DeleteOutlined />}
                          onClick={() => setCouponRows((rs) => rs.filter((x) => x.key !== row.key))} />
                      </Col>
                    </Row>
                  );
                })}
              </div>
            )}

            <Row gutter={12}>
              {[0, 1, 2].map((i) => (
                <Col span={8} key={i}>
                  <Form.Item label={`بيان ${['أول', 'تاني', 'تالت'][i]}`} style={{ marginBottom: 12 }}>
                    <Input value={statements[i]} onChange={(e) => {
                      const next = [...statements] as [string, string, string];
                      next[i] = e.target.value;
                      setStatements(next);
                    }} />
                  </Form.Item>
                </Col>
              ))}
            </Row>

            <Divider orientation="right" style={{ fontWeight: 700 }}>الأصناف المرتجعة</Divider>

            {!customerId ? (
              <Empty description="اختر العميل أولاً لعرض آخر أسعار الشراء تلقائياً" style={{ margin: '12px 0' }} />
            ) : (
              <>
                <Row gutter={16}>
                <Col xs={24} lg={18}>
                <Button data-shortcut="F2"
                  type="primary" danger size="large" icon={<PlusOutlined />} block
                  style={{ marginBottom: 14, height: 46 }}
                  onClick={() => setPickerOpen(true)}
                >
                  إضافة صنف للمرتجع
                </Button>

                <ProductPickerModal
                  open={pickerOpen}
                  title="اختر الصنف المرتجع"
                  categories={productCategories}
                  categoryLabels={categoryLabels}
                  products={products}
                  activeCategory={activeCategory}
                  onCategoryChange={(c) => { setActiveCategory(c); setPanelItemId(null); }}
                  onCancel={() => setPickerOpen(false)}
                  onPick={(id) => {
                    setPickerOpen(false);
                    setPanelItemId(id);
                    addProductById(id);
                  }}
                  onPickMany={async (ids) => {
                    setPickerOpen(false);
                    for (const id of ids) await addProductById(id);
                    if (ids.length) setPanelItemId(ids[ids.length - 1]);
                  }}
                />

                {lines.length === 0 ? (
                  <Empty description="اختر الفئة ثم الأصناف لإضافتها للمرتجع" style={{ margin: '12px 0' }} />
                ) : (
                  linesByCategory.map((group) => (
                    <div key={group.category ?? '__none__'}
                      style={{ border: '1px solid #e6efe3', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                      <div style={{ background: '#fdf3ee', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag color="volcano" style={{ fontWeight: 700, margin: 0 }}>
                          {group.category ? (categoryLabels[group.category] || group.category) : 'بدون فئة'}
                        </Tag>
                        <span style={{ color: '#8a8a8a', fontSize: 12 }}>{group.items.length} صنف</span>
                      </div>

                      <Row gutter={8} style={{ padding: '6px 12px 0', color: '#8a8a8a', fontSize: 12 }}>
                        <Col md={5}>الصنف</Col>
                        <Col md={3}>المخزن</Col>
                        <Col md={3}>آخر سعر شراء</Col>
                        <Col md={2}>الكمية</Col>
                        <Col md={3}>سعر الإرجاع</Col>
                        <Col md={2}>خصم %</Col>
                        <Col md={2} style={{ textAlign: 'center' }}>النقاط</Col>
                        <Col md={3} style={{ textAlign: 'center' }}>الإجمالي</Col>
                        <Col md={1} />
                      </Row>

                      {group.items.map((line) => {
                        const info = line.item_id ? lastInfo[line.item_id] : undefined;
                        const last = info?.last_price;
                        return (
                          <div key={line.key} style={{ padding: '4px 12px 6px', borderTop: '1px solid #f5efec' }}>
                            <Row gutter={8} align="middle">
                              <Col md={5} xs={24}><b>{productName(line.item_id as number)}</b></Col>
                              <Col md={3} xs={12}>
                                {/* (030) Goods may come back into a different warehouse per line. */}
                                <Select size="small" style={{ width: '100%' }}
                                  placeholder="المخزن"
                                  value={line.warehouse_id ?? docWarehouseId ?? undefined}
                                  onChange={(val) => handleLineChange(line.key, 'warehouse_id', val)}
                                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                              </Col>
                              <Col md={3} xs={12}>
                                {last != null ? (
                                  <Tag color="green" style={{ cursor: 'pointer' }}
                                    onClick={() => setHistModal({
                                      name: productName(line.item_id as number),
                                      rows: info?.history || [],
                                    })}>
                                    <HistoryOutlined /> {money(last)} ج.م
                                  </Tag>
                                ) : (
                                  <Tag>لم يشترِه من قبل</Tag>
                                )}
                              </Col>
                              <Col md={2} xs={8}>
                                <InputNumber size="small" min={0.001} style={{ width: '100%' }}
                                  ref={(el) => { qtyRefs.current[line.key] = el; }}
                                  data-qty-key={line.key}
                                  data-grid-col="qty" keyboard={false}
                                  placeholder="الكمية"
                                  value={line.quantity ?? undefined}
                                  onChange={(val) => handleLineChange(line.key, 'quantity', val ?? null)}
                                  // Enter means «this line is done» — straight back to the picker.
                                  // preventDefault so the global «Enter moves to the next field»
                                  // does not run after this and drag the caret off the new line.
                                  onPressEnter={(e) => { e.preventDefault(); setPickerOpen(true); }} />
                              </Col>
                              <Col md={3} xs={8}>
                                <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
                                  value={line.unit_price}
                                  onChange={(val) => handleLineChange(line.key, 'unit_price', val || 0)} />
                              </Col>
                              <Col md={2} xs={8}>
                                <InputNumber size="small" min={0} max={100} step={0.5} style={{ width: '100%' }}
                                  value={line.discount}
                                  onChange={(val) => handleLineChange(line.key, 'discount', val || 0)} />
                              </Col>
                              <Col md={2} xs={12} style={{ textAlign: 'center' }}>
                                <span style={{ color: '#F5A11D', fontWeight: 600 }}>
                                  {linePoints(line).toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
                                </span>
                              </Col>
                              <Col md={3} xs={12} style={{ textAlign: 'center' }}>
                                <b style={{ color: '#cf4b1a' }}>{lineTotal(line).toFixed(2)}</b>
                              </Col>
                              <Col md={1} xs={4} style={{ textAlign: 'center' }}>
                                <Button type="text" size="small" danger icon={<DeleteOutlined />}
                                  onClick={() => handleRemoveLine(line.key)} />
                              </Col>
                            </Row>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                </Col>
                <Col xs={24} lg={6}>
                  <ItemStockPanel itemId={panelItemId} category={activeCategory}
                    products={products} onPickItem={(id) => setPanelItemId(id)} />
                </Col>
                </Row>
              </>
            )}

            {/* Same ladder as the invoice, mirrored: a return gives money back instead of
                taking it, so the bottom line is what the customer still owes AFTER it. */}
            {(() => {
              const returnDiscount = grossTotal - netTotal;
              const hasParty = !!customerId && customerBalance !== null;
              const balance = customerBalance ?? 0;
              const after = balance - creditReduction;
              return (
                <TotalsLadder
                  tone="return"
                  inputs={(
                    <>
                      <Form.Item label="خصم على إجمالي المرتجع" style={{ marginBottom: 12 }}>
                        <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%"
                          value={discountPct} onChange={(val) => setDiscountPct(val || 0)} />
                      </Form.Item>
                      <Form.Item label="المبلغ المسترد نقداً" style={{ marginBottom: 0 }}
                        help="الباقي بيتخصم من حساب العميل">
                        <InputNumber min={0} style={{ width: '100%' }} addonAfter="ج.م"
                          value={cashRefund} onChange={(val) => setCashRefund(val || 0)} />
                      </Form.Item>
                    </>
                  )}
                  rows={[
                    { label: 'إجمالي الأصناف المرتجعة', value: grossTotal.toFixed(2) },
                    { label: `خصم المرتجع (${discountPct}%)`,
                      value: `− ${returnDiscount.toFixed(2)}`, color: '#cf1322',
                      show: returnDiscount > 0.001 },
                    { label: 'صافي المرتجع', value: netTotal.toFixed(2),
                      strong: true, color: '#cf4b1a', rule: true },
                    { label: 'حساب سابق على العميل', value: money(balance),
                      color: balance > 0 ? '#cf1322' : '#6AB42D',
                      show: hasParty && Math.abs(balance) > 0.001 },
                    { label: 'يُخصم من حسابه (آجل)', value: `− ${money(creditReduction)}`,
                      color: '#6AB42D', show: hasParty && creditReduction > 0.001 },
                    { label: 'الباقي على العميل', value: money(after), big: true, rule: true,
                      color: after > 0.001 ? '#cf1322' : '#6AB42D', show: hasParty },
                  ]}
                  notes={[
                    <>نقاط تُخصم من العميل: <b style={{ color: '#F5A11D' }}>
                      {totalPoints.toLocaleString('ar-EG', { maximumFractionDigits: 3 })}</b></>,
                    cashRefund > 0.001 ? (
                      <>مسترد نقداً: <b style={{ color: '#cf4b1a' }}>{money(cashRefund)} ج.م</b></>
                    ) : null,
                  ]}
                />
              );
            })()}

            <Form.Item style={{ marginTop: 20, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Space>
                  <Button type="primary" danger size="large" htmlType="submit">
                    تسجيل وحفظ مرتجع المبيعات
                  </Button>
                  <Button size="large" onClick={closeCreate}>إلغاء</Button>
                </Space>
              </div>
            </Form.Item>
          </Form>
        </Card>

        <Modal centered width={560} open={!!histModal} onCancel={() => setHistModal(null)}
          title={`سجل شراء العميل — ${histModal?.name ?? ''}`}
          footer={<Button onClick={() => setHistModal(null)}>إغلاق</Button>}>
          <Table size="small" pagination={false} rowKey="document_number"
            dataSource={histModal?.rows || []}
            locale={{ emptyText: 'لا يوجد سجل شراء لهذا الصنف' }}
            columns={[
              { title: 'الفاتورة', dataIndex: 'document_number', render: (d: string) => <Tag color="blue">{d}</Tag> },
              { title: 'التاريخ', dataIndex: 'date', render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
              { title: 'الكمية', dataIndex: 'quantity', render: (q: string) => Number(q) },
              { title: 'سعر الوحدة', dataIndex: 'unit_price', render: (v: string) => `${money(v)} ج.م` },
              { title: 'السعر الفعلي', dataIndex: 'effective_price',
                render: (v: string) => <strong style={{ color: '#6AB42D' }}>{money(v)} ج.م</strong> },
            ]} />
        </Modal>
      </div>
    );
  }

  // --- The list --------------------------------------------------------------------------------
  // Their مردود مبيعات list, in their order:
  //   `رقم · التاريخ · مستند رقم · الفاتورة رقم · الحساب الفرعي · جهه التعامل · مندوب · اجمالي قبل ·
  //    خصم · خصم% · ض.م · ض.م % · الاجمالي · مصروفات · الصافى · تم السداد · الباقى ·
  //    مصروفات تشغيل · ملاحظات · مراكز التكلفة`
  //
  // Same treatment as the sales list: everything we can answer honestly, in their order and under
  // their wording, with the ones a returns list is not usually read for starting hidden.
  //
  // (031) Four of the columns previously left out now have a source: the document fields were
  // always columns on `sales_return` and the payload dropped them, so nothing could fill them.
  // That is fixed, so مستند رقم · مندوب · ملاحظات are here — and التاريخ is the return's own day
  // rather than the day the row was typed.
  //
  // Still left out because a return genuinely does not carry them: الحساب الفرعي (the posting
  // account is stored but this list has no room for a fourth identifier) · مصروفات · مصروفات
  // تشغيل · مراكز التكلفة.
  const columns = [
    {
      title: 'رقم', dataIndex: 'id', key: 'id', width: 80,
      render: (id: number) => <span style={{ color: '#8a8a8a' }}>{id}</span>,
    },
    {
      // The day the goods came back, falling back to when the row was written for returns
      // recorded before the document carried its own date.
      title: 'التاريخ', dataIndex: 'return_date', key: 'return_date', width: 105,
      render: (v: string | null, r: ReturnRecord) => (v || String(r.created_at || '').slice(0, 10)
        || '-'),
    },
    {
      title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', width: 125,
      render: (doc: string) => <Tag color="volcano">{doc}</Tag>,
    },
    {
      // Which sale this undoes. The link was always stored and never shown.
      title: 'الفاتورة رقم', dataIndex: 'invoice_document_number', key: 'invoice_document_number',
      width: 125,
      // Opens the sale it undoes. The column exists to answer «which one?», and a number you
      // cannot follow leaves that answered only halfway.
      render: (v: string | null, r: ReturnRecord) => (v
        ? <DocRef kind="invoice" id={r.sales_invoice_id} label={v} />
        : <span style={{ color: '#bbb' }}>مستقل</span>),
    },
    {
      title: 'جهه التعامل', dataIndex: 'customer_id', key: 'customer_id', ellipsis: true,
      render: (cId: number) => (
        <a onClick={(e) => { e.stopPropagation(); navigate(`/customers/${cId}`); }}>
          {customers.find((c) => c.id === cId)?.name ?? `عميل #${cId}`}
        </a>
      ),
    },
    {
      title: 'اجمالي قبل', dataIndex: 'gross', key: 'gross', width: 115,
      align: 'left' as const, render: (v: string) => `${money(v)} ج.م`,
    },
    {
      title: 'خصم', key: 'discount_value', width: 105, align: 'left' as const,
      // Derived from the two beside it, so it can never disagree with them.
      render: (_: any, r: ReturnRecord) =>
        `${money(Number(r.gross || 0) * (Number(r.combined_pct || 0) / 100))} ج.م`,
    },
    {
      title: 'خصم%', dataIndex: 'combined_pct', key: 'combined_pct', width: 85,
      render: (v: string) => `${Number(v || 0).toFixed(0)}%`,
    },
    {
      title: 'ض.م', dataIndex: 'tax_amount', key: 'tax_amount', width: 100,
      align: 'left' as const, render: (v: string) => `${money(v)} ج.م`,
    },
    {
      title: 'الصافى', dataIndex: 'net', key: 'net', width: 115, align: 'left' as const,
      render: (v: string) => <strong style={{ color: '#cf4b1a' }}>{money(v)} ج.م</strong>,
    },
    {
      title: 'مندوب', dataIndex: 'rep_id', key: 'rep_id', width: 150, ellipsis: true,
      render: (v: number | null) => {
        const rep = reps.find((r) => r.id === v);
        return rep ? (rep.full_name || rep.username) : <span style={{ color: '#bbb' }}>-</span>;
      },
    },
    {
      title: 'مستند رقم', dataIndex: 'external_document_number', key: 'external_document_number',
      width: 130,
      render: (v: string | null) => v ?? <span style={{ color: '#bbb' }}>-</span>,
    },
    {
      title: 'ملاحظات', dataIndex: 'notes', key: 'notes', ellipsis: true,
      render: (v: string | null) => v ?? <span style={{ color: '#bbb' }}>-</span>,
    },
    {
      title: 'تم السداد', dataIndex: 'cash_refund', key: 'cash_refund', width: 110,
      align: 'left' as const, render: (v: string) => `${money(v)} ج.م`,
    },
    {
      title: 'الباقى', dataIndex: 'credit_reduction', key: 'credit_reduction', width: 110,
      align: 'left' as const, render: (v: string) => `${money(v)} ج.م`,
    },
  ];

  return (
    <div>
      <Card
        title="مرتجعات المبيعات"
        extra={
          <Space>
            <ColumnSettings
              choices={columns.map((c: any) => ({
                key: String(c.key ?? c.dataIndex ?? ''),
                title: typeof c.title === 'string' ? c.title : '',
                // The document number is how a return is named out loud; hiding it would leave a
                // table nobody can refer to.
                locked: c.key === 'document_number',
              }))}
              hidden={returnCols.hidden}
              onChange={returnCols.setHidden}
            />
            <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
            <Button type="primary" danger icon={<PlusOutlined />}
              // Through the same doors as the toolbar's «جديد» and as the sale: التاريخ first.
              // Two ways into one document that open differently is how a habit stops transferring.
              onClick={() => { setReturnDate(dayjs()); setNewStep('date'); }}>
              تسجيل مرتجع بيع
            </Button>
          </Space>
        }
      >
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={6}>
            <Input allowClear value={search} placeholder="بحث برقم السند" prefix={<SearchOutlined />}
              onChange={(e) => setSearch(e.target.value)} onPressEnter={applySearch} onBlur={applySearch} />
          </Col>
          <Col xs={24} md={6}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="العميل"
              value={filters.customer_id} onChange={(v) => setFilter('customer_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={customers.map((c) => ({ value: c.id, label: c.name }))} />
          </Col>
          <Col xs={16} md={8}>
            <DatePicker.RangePicker style={{ width: '100%' }}
              value={filters.date_from && filters.date_to
                ? [dayjs(filters.date_from), dayjs(filters.date_to)] : null}
              onChange={(v) => {
                const next = {
                  ...filters,
                  date_from: v?.[0] ? v[0].format('YYYY-MM-DD') : undefined,
                  date_to: v?.[1] ? v[1].format('YYYY-MM-DD') : undefined,
                };
                setFilters(next); fetchReturns(next);
              }} />
          </Col>
          <Col xs={8} md={4}>
            <Button icon={<ClearOutlined />} onClick={resetFilters} block>مسح</Button>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}><Card size="small"><Statistic title="عدد المرتجعات الظاهرة" value={summary.count} /></Card></Col>
          <Col xs={24} md={8}><Card size="small"><Statistic title="إجمالي صافي المرتجعات" value={money(summary.net)} suffix="ج.م" /></Card></Col>
          <Col xs={24} md={8}><Card size="small"><Statistic title="إجمالي الخصم من الحسابات" value={money(summary.credit)} suffix="ج.م" /></Card></Col>
        </Row>

        <Table
          dataSource={returns} columns={returnCols.apply(columns)} rowKey="id" loading={loading}
          size="middle" tableLayout="fixed"
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
          onRow={(record) => ({ onClick: () => openDetail(record), style: { cursor: 'pointer' } })}
        />
      </Card>

      {doors}

      <Modal centered title={`تفاصيل المرتجع ${viewReturn?.document_number ?? ''}`} width={680}
        open={detailVisible} onCancel={() => setDetailVisible(false)} destroyOnHidden
        footer={invoiceFooter(returnDoc(viewReturn), () => setDetailVisible(false))}>
        {viewReturn && (
          <>
            {/* The sale carries the toolbar into its detail view; the return did not, so التالى
                and السابق — the whole point of which is walking a register you already have open —
                were unreachable from the one place a person actually walks it. */}
            <DocumentToolbar actions={[
              { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
                onClick: () => { setDetailVisible(false); setReturnDate(dayjs());
                  setNewStep('date'); } },
              { key: 'edit', label: 'تعديل', icon: <EditOutlined />, disabled: true },
              { key: 'undo', label: 'تراجع', icon: <UndoOutlined />, disabled: true },
              { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />, disabled: true },
              { key: 'next', label: 'التالى', icon: <ArrowLeftOutlined />,
                disabled: !neighbour(1),
                onClick: () => { const n = neighbour(1); if (n) openDetail(n); } },
              { key: 'search', label: 'بحث', shortcut: 'F3', icon: <SearchOutlined />,
                onClick: () => setDetailVisible(false) },
              { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />,
                disabled: !neighbour(-1),
                onClick: () => { const p = neighbour(-1); if (p) openDetail(p); } },
              { key: 'delete', label: 'حذف', shortcut: 'F8', icon: <DeleteOutlined />,
                danger: true, disabled: true },
              { key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />,
                onClick: () => printInvoice(returnDoc(viewReturn)!, printOpts) },
              { key: 'accounts', label: 'حسابات', icon: <BankOutlined />, disabled: true },
              { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />,
                onClick: () => fetchReturns() },
            ]} />
            <InvoiceDocument doc={returnDoc(viewReturn)!}
              onItemClick={(id) => { setDetailVisible(false); navigate(`/catalog/${id}`); }}
              onPartyClick={(id) => { setDetailVisible(false); navigate(`/customers/${id}`); }} />
            {viewReturn.customer_id && (
              <CustomerAccountPanel customerId={viewReturn.customer_id} />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

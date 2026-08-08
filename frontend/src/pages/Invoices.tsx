import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Descriptions, Divider, Empty, Form, Input, InputNumber, Modal, Popconfirm, Result, Row, Segmented, Select, Space, Statistic, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  PlusOutlined, RollbackOutlined, FileTextOutlined, PrinterOutlined, DeleteOutlined,
  EditOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, SearchOutlined, ClearOutlined,
  FileAddOutlined, UndoOutlined, SaveOutlined, BankOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice } from '../components/InvoiceDocument';
import CustomerAccountPanel from '../components/CustomerAccountPanel';
import PartyPickerModal, { Party } from '../components/PartyPickerModal';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import ItemStockPanel from '../components/ItemStockPanel';
import ProductPickerModal from '../components/ProductPickerModal';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import { useAuth } from '../components/AuthProvider';
import TotalsLadder from '../components/TotalsLadder';
import { useLookup, labelMap } from '../hooks/useLookup';

interface InvoiceRecord {
  id: number;
  document_number: string;
  customer_id: number;
  gross: string;
  combined_pct: string;
  net: string;
  cash_amount: string;
  credit_amount: string;
  ledger_entry_id: number;
}

interface Customer {
  id: number;
  name: string;
  default_price_tier: string | null;
  // Every customer has exactly one rep, required since 001. It is the first link in the chain
  // that lets choosing a customer fill in who is selling and which store the goods leave from.
  rep_id: number;
}

/** An employee — the payroll record. `warehouse_id` is the store this person works out of, and
 *  `user_id` is the login they sell under. Together they turn a customer's rep into a store. */
interface RepEmployee {
  id: number;
  name: string;
  warehouse_id: number | null;
  user_id: number | null;
}

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TIER_LABELS: Record<string, string> = {
  commercial: 'تجاري',
  semi_commercial: 'نصف تجاري',
  wholesale: 'جملة',
  semi_wholesale: 'نصف جملة',
  consumer: 'مستهلك',
};

interface Product {
  id: number;
  code: string;
  name: string;
  sale_price: string | null;
  is_serialized: boolean;
  category: string | null;
  default_discount_pct: string | null;   // the item's own fixed discount
}

interface Warehouse {
  id: number;
  name: string;
}

interface SaleLineItem {
  key: string;
  category: string | null;         // chosen first; filters the item list
  item_id: number | null;
  /** null = «not typed yet». A quantity box that starts at 1 makes «5» into «15» for anybody who
   *  types without clearing it first, and the invoice is out by ten with nothing looking wrong. */
  quantity: number | null;
  unit_price: number;
  tier: string | null;
  unit: string | null;
  serials: string;
  fixed_discount: number;          // the item's own fixed discount (auto)
  variable_discount: number | null;  // a typed extra discount on this line; null until typed
  warehouse_id: number | null;     // (030) this line is served from its own warehouse
}

interface ItemUnit { name: string; factor: number; is_base: boolean; }

interface InvoiceDetail {
  id: number;
  lines: Array<{
    item_id: number;
    quantity: string;
    unit_price: string;
    line_total: string;
  }>;
}

interface InvoiceFilters {
  q?: string;
  customer_id?: number;
  date_from?: string;
  date_to?: string;
  payment?: string;   // cash | credit | partial
}

/**
 * كام كوبون بين رقمين — محسوبة، مش متكتوبة.
 *
 * The count was a field somebody typed beside «من ٥٠» and «إلى ١٠٠». Two ways to say one thing,
 * and they disagree the first time anybody edits the range and forgets the number — after which
 * the invoice claims a book size the serials do not support, and the receipt screen refuses
 * coupons the customer is holding.
 *
 * Inclusive: 50→100 is fifty-one coupons, because the customer is handed both of them.
 *
 * Serial numbers here are digits, sometimes with a prefix («A-1050»). Only the trailing digits are
 * compared, and when the two ends do not share a prefix — or either is not a number — the answer
 * is null rather than a guess. A wrong count is worse than no count: it posts.
 */
export function couponCount(from?: string | null, to?: string | null): number | null {
  const f = String(from ?? '').trim();
  const t = String(to ?? '').trim();
  if (!f || !t) return null;
  const split = (v: string) => {
    const m = v.match(/^(.*?)(\d+)$/);
    return m ? { prefix: m[1], n: Number(m[2]) } : null;
  };
  const a = split(f);
  const b = split(t);
  if (!a || !b || a.prefix !== b.prefix) return null;
  if (b.n < a.n) return null;      // «من ١٠٠ إلى ٥٠» is a typo, not a range of -49
  return b.n - a.n + 1;
}

export default function Invoices() {
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const navigate = useNavigate();
  const [filters, setFilters] = useState<InvoiceFilters>({});
  const [search, setSearch] = useState('');
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [employees, setEmployees] = useState<RepEmployee[]>([]);
  const [reps, setReps] = useState<{ id: number; full_name: string }[]>([]);
  // Only to put a NAME on «الحساب الفرعي» in the list — the id alone tells a reader nothing.
  const [postingAccounts, setPostingAccounts] = useState<any[]>([]);
  // مفاتيح الطباعة — read once from the browser they are saved in, and passed to every print
  // from this screen so the switches and the paper never disagree.
  const [printOpts, setPrintOpts] = useState<PrintOptions>(loadPrintOptions);
  // Only to NAME the branch on the printed head — the customer carries its id.
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [pointValues, setPointValues] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);

  // Drawers
  const [createVisible, setCreateVisible] = useState(false);
  const [returnVisible, setReturnVisible] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);

  // Standalone invoice detail/view (separate from the return wizard)
  // Each user hides the columns they never read; the choice is theirs alone and per screen.
  // All of their columns exist; these start hidden. A sales list is read for «who, when, how much,
  // how much is still owed» — the paper trail and the two expense figures are there when a question
  // needs them, and «حدد الأعمدة» turns any of them on for good.
  const invoiceCols = useHiddenColumns('invoices-list', [
    // Theirs carries a row number AND the invoice number. Ours is the invoice number people
    // actually say out loud, so the bare sequence starts hidden rather than spending width on a
    // second identifier for the same row.
    'id',
    'external_document_number', 'revenue_account_id', 'gross', 'discount_value',
    'combined_pct', 'notes',
  ]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<any>(null);
  const [viewReturns, setViewReturns] = useState<any[]>([]);

  // Forms
  const [createForm] = Form.useForm();
  const [returnForm] = Form.useForm();

  // Create invoice dynamic lines
  const blankLine = (key: string, tier: string | null = null): SaleLineItem => ({
    key, category: null, item_id: null, quantity: null, unit_price: 0, tier, unit: null,
    serials: '', fixed_discount: 0, variable_discount: null, warehouse_id: null,
  });
  const [lines, setLines] = useState<SaleLineItem[]>([]);
  // Cache of each item's tier prices, so the line price follows the chosen tier (matches backend).
  const [pricesCache, setPricesCache] = useState<Record<number, { base: number | null; tiers: Record<string, number> }>>({});
  const [unitsCache, setUnitsCache] = useState<Record<number, ItemUnit[]>>({});
  const [customerTier, setCustomerTier] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerBalance, setCustomerBalance] = useState<number | null>(null);
  /**
   * حسابات العميل — واحد لكل خط منتجات.
   *
   * A customer the client sells both lines to holds two receivable accounts at two commissions.
   * The invoice has to say which one it is on, because that is the balance it moves.
   */
  const [familyAccounts, setFamilyAccounts] = useState<
    { family: string | null; balance: string }[]>([]);
  const [invoiceFamily, setInvoiceFamily] = useState<string | null>(null);
  const families = familyAccounts.filter((a) => a.family);
  // Coupons already issued to this customer and not yet redeemed — the counter reads out their
  // serial range when handing them over.
  const [customerCoupons, setCustomerCoupons] = useState<any[]>([]);
  // The item the side stock panel is showing. Follows whatever the user last touched — the
  // product they picked, or a line they clicked — so the panel answers the question they are
  // asking right now without them having to ask it twice.
  const [panelItemId, setPanelItemId] = useState<number | null>(null);
  /** الكوبونات المصروفة مع الفاتورة — a row per KIND, because a counter handing out a hundred
   *  gold and fifty silver was previously given one range to put both in and had to choose which
   *  of the two to record. */
  /**
   * اعدادات الأعمدة لسطور الفاتورة.
   *
   * The grid has to serve a salesman who only wants «الصنف · الكمية · السعر» and a manager who
   * wants the discounts and the points. Rather than argue about which columns are the right ones,
   * each person turns off the ones they never read — the same per-browser preference the registers
   * already use.
   *
   * الصنف · الكمية · الإجمالي are locked: a line without them is not a line you can check.
   */
  // Asked of the server's capability list, not of a role name copied into this file. Reopening
  // and voiding a posted invoice are separate rights from writing one, and the endpoint enforces
  // exactly these two strings — so the button and the gate cannot come to disagree.
  const { can } = useAuth();
  const canEditInvoice = can('sale.edit');
  const canDeleteInvoice = can('sale.delete');

  const lineCols = useHiddenColumns('invoice-lines');
  const showCol = (key: string) => !lineCols.hidden.includes(key);

  const [couponRows, setCouponRows] = useState<
    { key: string; coupon_type_id?: number; count?: number; serial_from?: string;
      serial_to?: string }[]
  >([]);
  const [couponTypes, setCouponTypes] = useState<{ id: number; name: string }[]>([]);
  // The day the sale happened, asked for before the form opens. It is not always today — a rep
  // comes back from a round, a branch catches up on a backlog — and it dates the ledger entry
  // as well as the document, so it has to be settled before anything is typed rather than
  // remembered at the end.
  // Keyboard path for a fast counter: pick product -> land in its quantity -> Enter -> back to
  // the product picker for the next one. Without it the salesman reaches for the mouse between
  // every single line, which is most of what makes entering a twenty-line invoice slow.
  const qtyRefs = useRef<Record<string, any>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  // A document arriving from somewhere else — a customer's file, an item's history, a report.
  // The link carries only the intent; the acting lives here, where it already is and where it is
  // already guarded, so no second screen learns how to reverse an invoice.
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);

  const [invoiceDate, setInvoiceDate] = useState<any>(dayjs());
  // On-hand per WAREHOUSE per item: `{ [warehouseId]: { [itemId]: qty } }`. Since 030 each line may
  // be served from a different warehouse, so a single item-keyed map would answer the wrong
  // question. Stock can never go negative, so the form shows what is available and caps the
  // quantity rather than letting the user build a basket the server will refuse.
  const [availability, setAvailability] = useState<Record<number, Record<number, number>>>({});
  // (030) the party picker + what it filled into the document header
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  /**
   * Opening a sale is a sequence of doors, one question behind each: التاريخ، then العميل، and
   * then the invoice itself.
   *
   * The store used to be a third door and is not any more: it follows from the customer — his rep,
   * and the rep's van — so asking was asking a question whose answer was already on screen. It is
   * still a field on the document, changeable when the goods really do leave from somewhere else.
   *
   * Asked one at a time rather than on one crowded dialog because that is how the person doing it
   * thinks — each answer is settled and gone before the next is put. It also means every step can
   * be answered with Enter and nothing else, which is the point of the whole keyboard pass: from
   * the button to the first product without touching the mouse.
   */
  const [newStep, setNewStep] = useState<null | 'date' | 'party'>(null);
  const [party, setParty] = useState<Party | null>(null);
  // The document's warehouse — the default every line falls back to when it has none of its own.
  const [docWarehouseId, setDocWarehouseId] = useState<number | null>(null);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  // The category products are picked from — chosen once, stays until changed.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Return quantities tracking
  const [returnQtys, setReturnQtys] = useState<Record<number, number>>({});

  // Filtering happens on the server so it covers ALL invoices, not just the loaded page.
  const fetchInvoices = async (override?: InvoiceFilters) => {
    const active = override ?? filters;
    setLoading(true);
    try {
      const params: any = {};
      Object.entries(active).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      });
      const res = await api.get('/api/v1/sales', { params });
      setInvoices(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const setFilter = (key: keyof InvoiceFilters, value: any) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    fetchInvoices(next);
  };

  const applySearch = () => setFilter('q', search.trim() || undefined);

  const resetFilters = () => {
    setSearch('');
    setFilters({});
    fetchInvoices({});
  };

  // Live summary of whatever the current filter returned.
  const summary = useMemo(() => {
    const net = invoices.reduce((s, i) => s + Number(i.net || 0), 0);
    const credit = invoices.reduce((s, i) => s + Number(i.credit_amount || 0), 0);
    return { count: invoices.length, net, credit };
  }, [invoices]);

  const loadLookups = async () => {
    try {
      const [custRes, prodRes, whRes, ptRes, empRes, userRes, acctRes, ctRes,
        brRes] = await Promise.all([
        api.get('/api/v1/customers'),
        api.get('/api/v1/items?kind=product'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/products/point-values'),
        api.get('/api/v1/employees', { params: { active: true } }),
        api.get('/api/v1/users'),
        api.get('/api/v1/accounts?postable_only=true').catch(() => ({ data: [] })),
        api.get('/api/v1/loyalty/coupon-types').catch(() => ({ data: [] })),
        api.get('/api/v1/branches').catch(() => ({ data: [] })),
      ]);
      setCustomers(custRes.data);
      setProducts(prodRes.data);
      setWarehouses(whRes.data);
      setEmployees(empRes.data);
      setReps(userRes.data.filter((u: any) => u.role === 'sales_rep'));
      setPostingAccounts(acctRes.data || []);
      setCouponTypes(ctRes.data || []);
      setBranches(brRes.data || []);
      const pts: Record<number, number> = {};
      (ptRes.data || []).forEach((r: any) => { pts[r.item_id] = parseFloat(r.point_value) || 0; });
      setPointValues(pts);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchInvoices();
    loadLookups();
  }, []);

  // Product categories (of sellable products) for the category picker.
  const productCategories = React.useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [products]);

  // Added products grouped by category, in first-appearance order.
  const linesByCategory = React.useMemo(() => {
    const groups: { category: string | null; items: SaleLineItem[] }[] = [];
    lines.forEach((l) => {
      let g = groups.find((x) => x.category === (l.category ?? null));
      if (!g) { g = { category: l.category ?? null, items: [] }; groups.push(g); }
      g.items.push(l);
    });
    return groups;
  }, [lines]);

  // A line's amount AFTER its own (fixed + variable) discount.
  const lineTotal = (l: SaleLineItem) => {
    const disc = Math.min(99.99, (l.fixed_discount || 0) + (l.variable_discount || 0));
    return Number(l.quantity || 0) * l.unit_price * (1 - disc / 100);
  };

  // Loyalty points a line earns = the product's point value × quantity.
  const linePoints = (l: SaleLineItem) =>
    (l.item_id ? (pointValues[l.item_id] || 0) : 0) * (l.quantity || 0);

  // Invoice computations: per-line discounts first, then the invoice-total discount.
  const grossTotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const netTotal = grossTotal * (1 - discountPct / 100);
  const totalPoints = lines.reduce((sum, line) => sum + linePoints(line), 0);

  // credit = net − cash, SIGNED: positive → the remainder is added to the customer's account;
  // negative → the customer overpaid and the surplus settles his prior balance (028).
  useEffect(() => {
    const cash = parseFloat(cashAmount.toString()) || 0;
    setCreditAmount(parseFloat((netTotal - cash).toFixed(2)));
  }, [cashAmount, netTotal, discountPct]);

  // Close the create page and clear it, so reopening starts fresh.
  const closeCreate = () => {
    setCreateVisible(false);
    setLines([]);
    setActiveCategory(null);
    setCashAmount(0);
    setDiscountPct(0);
    setSelectedCustomerId(null);
    setCustomerBalance(null);
    setFamilyAccounts([]);
    setInvoiceFamily(null);
    setCustomerCoupons([]);
    setCouponRows([]);
    setAvailability({});
    setParty(null);
    setDocWarehouseId(null);
    createForm.resetFields();
  };

  // Type a product name → it's added to the invoice immediately (POS-style, fastest path).
  const addProductById = async (itemId: number) => {
    if (!itemId) return;
    await fetchPrices(itemId);
    const prod = products.find((p) => p.id === itemId);
    const tier = customerTier || 'consumer';
    const l = blankLine(Date.now().toString(), tier);
    l.category = prod?.category ?? null;
    l.item_id = itemId;
    l.unit_price = resolvePrice(itemId, tier, null);
    l.fixed_discount = prod?.default_discount_pct ? parseFloat(prod.default_discount_pct) : 0;
    // If the same product is already on the invoice, just bump its quantity.
    const existing = lines.find((x) => x.item_id === itemId);
    if (existing) {
      setLines((prev) => prev.map((x) => (x.key === existing.key
        ? { ...x, quantity: Number(x.quantity || 0) + 1 } : x)));
      // Focus the line that just changed, not a new one — the eye should follow the number
      // that moved.
      setFocusLineKey(existing.key);
    } else {
      setLines((prev) => [...prev, l]);
      setFocusLineKey(l.key);
    }
  };

  const handleRemoveLine = (key: string) => {
    setLines(lines.filter((l) => l.key !== key));
  };

  const unitFactor = (itemId: number, unit: string | null): number => {
    if (!unit) return 1;
    const u = (unitsCache[itemId] || []).find((x) => x.name === unit);
    return u ? u.factor : 1;
  };

  // Resolve a line's price = base-tier price × unit factor (matches the backend, 007+008).
  const resolvePrice = (itemId: number, tier: string | null, unit: string | null): number => {
    const c = pricesCache[itemId];
    let base: number;
    if (!c) {
      const prod = products.find((p) => p.id === itemId);
      base = prod?.sale_price ? parseFloat(prod.sale_price) : 0;
    } else {
      base = (tier && c.tiers[tier] != null) ? c.tiers[tier] : (c.base ?? 0);
    }
    return base * unitFactor(itemId, unit);
  };

  const fetchPrices = async (itemId: number) => {
    if (!pricesCache[itemId]) {
      try {
        const res = await api.get(`/api/v1/items/${itemId}/prices`);
        const tiers: Record<string, number> = {};
        (res.data.tiers || []).forEach((t: any) => { tiers[t.tier] = parseFloat(t.price); });
        setPricesCache((prev) => ({ ...prev, [itemId]: { base: res.data.base_sale_price ? parseFloat(res.data.base_sale_price) : null, tiers } }));
      } catch (err) { console.error(err); }
    }
    if (!unitsCache[itemId]) {
      try {
        const res = await api.get(`/api/v1/items/${itemId}/units`);
        setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({ name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
      } catch (err) { console.error(err); }
    }
  };

  const handleLineChange = async (key: string, field: keyof SaleLineItem, value: any) => {
    if (field === 'item_id' && value) await fetchPrices(value);
    // (030) A line moved to another warehouse needs THAT warehouse's stock to cap against.
    if (field === 'warehouse_id' && value) await loadWarehouseStock(value);

    // A quantity bigger than the store holds is refused AS IT IS TYPED, not at save.
    //
    // The check already existed on submit, and the server enforces it too — but by then the
    // invoice is written and the person is told a basket they spent five minutes on cannot be
    // posted. Saying it at the box, on the line, while the wrong number is still under the
    // cursor, is the difference between a correction and a rewrite.
    //
    // It caps rather than reverts: typing 40 against a stock of 12 means «all of it», and putting
    // 12 there is what the person would have typed had they known. Reverting to the old value
    // would leave them guessing what the ceiling is.
    if (field === 'quantity' && value != null) {
      const line = lines.find((l) => l.key === key);
      // Only when a store is actually chosen. «No store picked yet» reads as zero on hand, and
      // capping against that would refuse every quantity on the invoice while telling the person
      // the goods are out of stock — which is a different sentence from «you have not said where
      // they leave from», and sends them looking in the wrong place. The store is required at
      // save, and that is where its absence gets named.
      if (line?.item_id && lineWarehouse(line)) {
        const stock = availableFor(line.item_id, line.unit, lineWarehouse(line));
        if (Number(value) > stock) {
          const name = productName(line.item_id);
          const store = warehouses.find((w) => w.id === lineWarehouse(line))?.name ?? 'المخزن';
          message.warning(stock > 0
            ? `«${name}»: المتاح في ${store} هو ${stock} — اتسجّلت ${stock}.`
            : `«${name}»: مفيش رصيد في ${store}.`);
          value = stock;
        }
      }
    }

    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const updated = { ...l, [field]: value };
        if (field === 'category') {
          // New category → clear the chosen item so the list re-filters.
          updated.item_id = null;
          updated.unit = null;
          updated.unit_price = 0;
          updated.fixed_discount = 0;
        } else if (field === 'item_id') {
          updated.tier = l.tier || customerTier || 'consumer';
          updated.unit = null;  // default to base
          updated.unit_price = resolvePrice(value, updated.tier, null);
          // The item's own fixed discount is applied automatically.
          const prod = products.find((p) => p.id === value);
          updated.fixed_discount = prod?.default_discount_pct
            ? parseFloat(prod.default_discount_pct) : 0;
        } else if ((field === 'tier' || field === 'unit') && l.item_id) {
          updated.unit_price = resolvePrice(l.item_id, updated.tier, updated.unit);
        }
        return updated;
      })
    );
  };

  /**
   * On the open invoice, Enter opens the product picker.
   *
   * The last door of the sequence leaves you on the document with nothing selected, and the next
   * thing anybody does is add a line — so Enter does that instead of nothing. It stays out of the
   * way while you are inside a field, where Enter already means «next field», and while any other
   * dialog is open, where it means whatever that dialog says.
   */
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

  /** Chosen from the picker (existing or just-created) — fills the form and the header strip. */
  const handlePartyPicked = (picked: Party) => {
    setParty(picked);
    setPartyPickerOpen(false);
    // Mid-invoice this only swaps the party — nothing restarts. During the opening sequence it is
    // the second door, so it hands over to the third rather than opening the document.
    // The customer is the last question. His rep fills in المندوب and the rep's store fills in
    // المستودع, so the document opens knowing all three.
    if (newStep === 'party') { setNewStep(null); setCreateVisible(true); }
    createForm.setFieldsValue({ customer_id: picked.id });
    // A brand-new customer isn't in the loaded list yet; add it so the field renders its name.
    setCustomers((prev) => (prev.some((c) => c.id === picked.id) ? prev : [
      ...prev, { id: picked.id, name: picked.name, default_price_tier: null } as Customer,
    ]));
    onCustomerChange(picked.id);
  };

  /** Load and cache what one warehouse holds. Called for the document's warehouse and for any
   *  warehouse a line is switched to, so each line can be capped against the right stock. */
  const loadWarehouseStock = async (warehouseId: number) => {
    if (!warehouseId || availability[warehouseId]) return;
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: { location_kind: 'warehouse', location_id: warehouseId, only_available: false },
      });
      const map: Record<number, number> = {};
      (res.data || []).forEach((r: any) => { map[r.item_id] = Number(r.on_hand || 0); });
      setAvailability((prev) => ({ ...prev, [warehouseId]: map }));
    } catch (err) { console.error(err); }
  };

  const onWarehouseChange = async (warehouseId: number) => {
    setDocWarehouseId(warehouseId);
    // Lines still pointing at no warehouse of their own follow the document.
    await loadWarehouseStock(warehouseId);
  };

  /** The warehouse a line actually draws from: its own, else the document's. */
  const lineWarehouse = (l: SaleLineItem): number | null => l.warehouse_id ?? docWarehouseId;

  /** On-hand for an item in a given warehouse, expressed in the line's unit (0 when unknown). */
  const availableFor = (itemId: number | null, unit: string | null,
                        warehouseId: number | null): number => {
    if (!itemId || !warehouseId) return 0;
    const base = availability[warehouseId]?.[itemId] ?? 0;
    const f = unitFactor(itemId, unit) || 1;
    return f > 0 ? base / f : base;
  };

  /** The store a rep sells out of, found through his employee record.
   *
   *  customer → rep (a login) → employee (by `user_id`) → store. The store lives on the employee
   *  and nowhere else, so this walk is the only honest way to it; copying it onto the user would
   *  give two answers that eventually disagree.
   */
  const storeOfRep = (repId: number | null | undefined): number | null => {
    if (!repId) return null;
    return employees.find((e) => e.user_id === repId)?.warehouse_id ?? null;
  };

  const onCustomerChange = (customerId: number) => {
    const c = customers.find((x) => x.id === customerId);
    const tier = c?.default_price_tier ?? null;
    setCustomerTier(tier);
    // Choosing the customer fills in his rep, and the rep fills in his store. Both are DEFAULTS,
    // not locks: a rep on leave and a van that ran out are ordinary days, and a field that
    // refuses them is a field people work around by putting the sale on the wrong customer.
    //
    // Only filled when empty, so re-picking a customer never silently undoes a store somebody
    // chose on purpose.
    if (c?.rep_id) {
      createForm.setFieldsValue({ rep_id: c.rep_id });
      const store = storeOfRep(c.rep_id);
      if (store && !createForm.getFieldValue('warehouse_id')) {
        createForm.setFieldsValue({ warehouse_id: store });
        onWarehouseChange(store);
      }
    }
    setSelectedCustomerId(customerId);
    setCustomerBalance(null);
    setCustomerCoupons([]);
    // `/accounts` answers for both kinds of customer: one row for somebody who was never split,
    // one per line for somebody who was. `/account` refuses outright for the second, which is
    // correct of it and useless here.
    api.get(`/api/v1/customers/${customerId}/accounts`)
      .then((res) => {
        const rows = res.data?.accounts || [];
        setFamilyAccounts(rows);
        setCustomerBalance(Number(res.data?.total_balance || 0));
        // Pre-picked only when there is nothing to pick: one line means no question to ask. With
        // two, it stays empty on purpose — choosing for him is choosing which balance moves.
        const named = rows.filter((a: any) => a.family);
        setInvoiceFamily(named.length === 1 ? named[0].family : null);
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
    const totalSplit = cashAmount + creditAmount;
    if (Math.abs(totalSplit - netTotal) > 0.01) {
      message.error('مجموع المدفوع والآجل يجب أن يساوي صافي الفاتورة!');
      return;
    }

    const validLines = lines.filter((l) => l.item_id !== null);
    if (validLines.length === 0) {
      message.error('يرجى إضافة منتج واحد صالح على الأقل!');
      return;
    }
    // The quantity box starts empty on purpose, so «forgot to type it» is a real state and has
    // to be caught here rather than posted as a zero-quantity line nobody meant to write.
    const noQty = validLines.find((l) => !Number(l.quantity));
    if (noQty) {
      message.error(`«${productName(noQty.item_id as number)}»: اكتب الكمية.`);
      setFocusLineKey(noQty.key);
      return;
    }

    // Never sell more than a warehouse holds. Checked on the SUM per (item × warehouse), because
    // two lines of 3 against a stock of 5 each look affordable alone — the server applies the
    // same rule, this just says so before the basket is lost.
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
          .toLocaleString('ar-EG', { maximumFractionDigits: 3 })})`,
      );
      return;
    }

    // Serialized lines: serial count must equal the quantity.
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

    try {
      await api.post('/api/v1/sales', {
        customer_id: values.customer_id,
        // Who sold it. Recorded on the document so a commission report and a rep's own list of
        // invoices do not have to re-derive it from whoever owns the customer today.
        rep_id: values.rep_id ?? null,
        origin: {
          location_kind: 'warehouse',
          location_id: values.warehouse_id,
        },
        variable_discount_pct: discountPct,
        cash_amount: cashAmount,
        credit_amount: creditAmount,
        lines: validLines.map((l) => {
          const prod = products.find((p) => p.id === l.item_id);
          return {
            item_id: l.item_id,
            quantity: Number(l.quantity || 0),
            tier: l.tier,
            unit: l.unit,
            unit_price: l.unit_price.toFixed(2),
            // Combined per-line discount: the item's fixed + the typed variable.
            discount_pct: ((l.fixed_discount || 0) + (l.variable_discount || 0)).toFixed(2),
            serials: prod?.is_serialized ? parseSerials(l.serials) : null,
            // (030) Only sent when it differs from the document's, so the server keeps its
            // "fall back to the document" behaviour for everything else.
            warehouse_id: l.warehouse_id ?? undefined,
          };
        }),
        // (030) document fields
        external_document_number: values.external_document_number || undefined,
        invoice_date: (invoiceDate || dayjs()).format('YYYY-MM-DD'),
        // Coupons handed over with this invoice, as the serial range off the book. Kept on the
        // invoice because that is what proves which coupons were his when they come back in.
        coupons: couponRows
          .filter((r) => r.coupon_type_id || r.serial_from || r.serial_to)
          .map((r) => ({
            coupon_type_id: r.coupon_type_id ?? null,
            // Sent as the range implies it. Sending a separately-typed number was how an invoice
            // came to claim a book size its serials do not support.
            count: couponCount(r.serial_from, r.serial_to),
            serial_from: r.serial_from || null,
            serial_to: r.serial_to || null,
          })),
        notes: values.notes || undefined,
        // Which of his accounts this invoice posts to. Null for a customer who has only one.
        family: invoiceFamily,
      });

      message.success('تم تسجيل فاتورة البيع بنجاح');
      setCreateVisible(false);
      createForm.resetFields();
      setLines([]);
      setActiveCategory(null);
      setCashAmount(0);
      setDiscountPct(0);
      fetchInvoices();
    } catch (err) {
      console.error(err);
    }
  };

  // Process returns wizard
  const openReturnWizard = async (record: InvoiceRecord) => {
    setSelectedInvoice(record);
    setReturnQtys({});
    try {
      const res = await api.get(`/api/v1/sales/${record.id}`);
      setInvoiceDetail(res.data);
      setReturnVisible(true);
    } catch (err) {
      console.error(err);
    }
  };

  /**
   * حذف الفاتورة — a posted invoice is reversed, never erased.
   *
   * It moved stock, booked a ledger entry and put a debt on the customer; deleting the row would
   * leave all three behind with nothing to explain them. A full return undoes exactly what the
   * invoice did, and both documents stay visible, which is what makes the books answerable.
   */
  /**
   * عكس الفاتورة بالكامل — للتعديل أو للإلغاء.
   *
   * Through `/reverse`, not `/returns`. A customer return is a real business event that belongs in
   * مردودات المبيعات; the shop reopening its own invoice is a correction that merely happens to be
   * implemented the same way. Sending both through one door counted our mistakes as his returns —
   * and let anyone who could take a return void any invoice ever posted.
   *
   * The reason travels with the request because the SERVER decides the right, not this screen.
   */
  const reverseInvoice = async (
    record: InvoiceRecord, reason: 'edit' | 'delete',
  ): Promise<boolean> => {
    try {
      await api.post(`/api/v1/sales/${record.id}/reverse`, { reason });
      return true;
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message
        || 'تعذر عكس الفاتورة — لو الأصناف اتباعت أو اتحوّلت بعدها، رجّعها الأول.');
      return false;
    }
  };

  const handleDeleteInvoice = async (record: InvoiceRecord) => {
    if (await reverseInvoice(record, 'delete')) {
      message.success('اتعكست الفاتورة بالكامل');
      fetchInvoices();
    }
  };

  /**
   * تعديل الفاتورة — reverse it, then reopen its contents as a fresh invoice to correct and post.
   *
   * The customer sees "edit"; the books see a return and a new sale, which is the only version of
   * editing that cannot rewrite a month that has already been reported on.
   */
  /**
   * فتح فاتورة مرحّلة للتعديل.
   *
   * A posted invoice cannot be altered in place — the ledger is append-only — so «تعديل» REVERSES
   * it with a full return and reopens the form on what it held. That is a real posting, and since
   * opening an invoice now goes straight here, it is one click away.
   *
   * So it asks first. It did not before, when «تعديل» was a second button somebody had to aim at;
   * with the row itself leading here, an unconfirmed reversal would be a mis-click that posts a
   * return against a customer.
   */
  const handleEditInvoice = async (record: InvoiceRecord) => {
    let det: any;
    try {
      det = (await api.get(`/api/v1/sales/${record.id}`)).data;
    } catch {
      message.error('تعذر قراءة الفاتورة');
      return;
    }
    const ok = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `تعديل ${record.document_number}؟`,
        content: 'الفاتورة المرحّلة ماتتعدلش في مكانها: هيتعمل لها مرتجع كامل وتتفتح من جديد '
          + 'للتعديل، وترحّل تاني لما تحفظ. الرصيد والمخزون بيرجعوا زي ما كانوا قبلها.',
        okText: 'اعكسها وافتحها', cancelText: 'سيبها زي ما هي',
        okButtonProps: { danger: true },
        onOk: () => resolve(true), onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    if (!(await reverseInvoice(record, 'edit'))) return;

    message.success('اتعكست الفاتورة — عدّل وارحّل من جديد');
    fetchInvoices();

    // Refill the form from what the invoice actually held, line by line.
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
        // The invoice stored ONE combined discount; it comes back as the fixed part so the
        // number the user sees is the number the line actually carried.
        fixed_discount: Number(l.discount_pct) || 0,
        variable_discount: 0,
        warehouse_id: l.warehouse_id ?? null,
      } as SaleLineItem;
    });

    setCreateVisible(true);
    setLines(refilled);
    setDiscountPct(0);
    setCashAmount(Number(det.cash_amount) || 0);
    createForm.setFieldsValue({ customer_id: det.customer_id });
    onCustomerChange(det.customer_id);
    const first = (det.lines || [])[0];
    if (first?.warehouse_id) setDocWarehouseId(first.warehouse_id);
  };

  // A deep link (`?doc=5` / `?edit=5`) is captured into a ref the moment it is seen, and acted on
  // as soon as the list can satisfy it. One effect on both dependencies, because the two arrive in
  // either order: on a cold open the parameter is there before the list has loaded, and on a repeat
  // click the list is already loaded and only the parameter changes. Splitting them into an effect
  // per dependency broke the second case — the list never changed, so nothing ever fired, and
  // clicking the same statement line a second time did nothing.
  const pendingIntent = useRef<{ id: number; mode: 'view' | 'edit' } | null>(null);

  useEffect(() => {
    const doc = searchParams.get('doc');
    const edit = searchParams.get('edit');
    if (doc || edit) {
      pendingIntent.current = { id: Number(doc || edit), mode: doc ? 'view' : 'edit' };
      // Cleared immediately so a refresh, or returning to this tab later, cannot replay it.
      setSearchParams({}, { replace: true });
    }
    const wanted = pendingIntent.current;
    if (!wanted || !invoices.length) return;
    // Consuming the ref IS the once-only guard, so a re-render cannot fire the same intent twice —
    // which for an edit would mean reversing an invoice a second time. It used to be guarded by
    // remembering the intent's *value*, which quietly made a link work only once per session.
    pendingIntent.current = null;
    const target = invoices.find((i) => i.id === wanted.id);
    if (!target) {
      // Saying so beats a silent no-op, which the user cannot tell apart from a broken link.
      message.warning('المستند مش في القائمة المعروضة — وسّع الفلتر أو ابحث برقمه.');
      return;
    }
    if (wanted.mode === 'view') openDetail(target);
    else handleEditInvoice(target);
  }, [searchParams, invoices]);

  /** The toolbar over a SAVED invoice. Here التالى/السابق are what they are on their screen:
   *  a step to the neighbouring document, in the order the list is currently showing. */
  const viewToolbar = (): ToolbarAction[] => [
    { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
      onClick: () => { setDetailVisible(false); setInvoiceDate(dayjs()); setNewStep('date'); } },
    { key: 'edit', label: 'تعديل', icon: <EditOutlined />,
      disabled: !canEditInvoice,
      onClick: () => { if (viewInvoice) { setDetailVisible(false); handleEditInvoice(viewInvoice); } } },
    { key: 'undo', label: 'تراجع', icon: <UndoOutlined />, disabled: true },
    { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />, disabled: true },
    { key: 'next', label: 'التالى', icon: <ArrowLeftOutlined />,
      disabled: !neighbour(1),
      onClick: () => { const n = neighbour(1); if (n) openDetail(n); } },
    { key: 'search', label: 'بحث', shortcut: 'F3', icon: <SearchOutlined />,
      onClick: () => setDetailVisible(false) },
    { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />,
      disabled: !neighbour(-1),
      onClick: () => { const n = neighbour(-1); if (n) openDetail(n); } },
    { key: 'delete', label: 'حذف', shortcut: 'F8', icon: <DeleteOutlined />, danger: true,
      disabled: !canDeleteInvoice,
      onClick: () => { if (viewInvoice) { setDetailVisible(false); handleDeleteInvoice(viewInvoice); } } },
    { key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />,
      // The document, on the letterhead, through مفاتيح الطباعة — not the browser printing the
      // screen it happens to be showing.
      onClick: () => { const doc = invoiceDoc(viewInvoice); if (doc) printInvoice(doc, printOpts); } },
    { key: 'accounts', label: 'حسابات', icon: <BankOutlined />,
      disabled: !viewInvoice?.customer_id,
      onClick: () => viewInvoice?.customer_id && navigate(`/customers/${viewInvoice.customer_id}`) },
    { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />,
      onClick: () => { if (viewInvoice) openDetail(viewInvoice); } },
  ];

  /** The invoice `step` places away in the list as currently filtered, or null at the ends. */
  const neighbour = (step: number) => {
    if (!viewInvoice) return null;
    // The list itself is the order — the server already returns it filtered and sorted, and the
    // table renders it unchanged, so the arrows walk exactly what the user is looking at.
    const rows = invoices;
    const at = rows.findIndex((r: any) => r.id === viewInvoice.id);
    if (at < 0) return null;
    return rows[at + step] ?? null;
  };

  /** Extra header lines on the printed invoice: the paper number, and the coupon range if the
   *  sale issued any — the customer's own proof of which serials are his. */
  const printMeta = (inv: any): [string, string][] | undefined => {
    const meta: [string, string][] = [];
    if (inv.external_document_number) meta.push(['رقم المستند', inv.external_document_number]);
    if (inv.coupon_serial_from) {
      const count = inv.coupon_count ? `${inv.coupon_count} — ` : '';
      meta.push(['الكوبونات',
        `${count}من ${inv.coupon_serial_from} إلى ${inv.coupon_serial_to}`]);
    }
    return meta.length ? meta : undefined;
  };

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `صنف #${id}`;

  // The row does not exist until React has painted it, so the caret is moved on the next tick
  // rather than inside the handler that created it.
  useEffect(() => {
    if (!focusLineKey) return undefined;
    // Wait for the picker to be GONE before reaching for the caret. An open modal traps focus by
    // design, so a `focus()` fired while it is still closing is not lost to a race — it is refused
    // outright. Waiting is the difference between «usually works» and «works».
    if (pickerOpen) return undefined;
    // Keep asking for the caret until it actually arrives.
    //
    // One attempt is not enough: the picker is still closing when the line appears, its own
    // search box still holds focus, and a single `focus()` fired into that moment is simply
    // overwritten. Rather than guess a delay long enough to be safe — which is a delay long
    // enough to be felt — this retries each frame and stops the moment the box has it. In
    // practice that is one or two frames; the cap is only there so a line that never renders
    // cannot leave a loop running.
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      // Found by a data attribute rather than through the component ref: antd's InputNumber ref
      // hands back a wrapper, so there is no way to ASK whether the caret arrived — and without
      // that question this loop cannot know when to stop.
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

  /** How many coupons this invoice hands over — derived only when both serials are plain
   *  numbers, since a lettered book cannot be subtracted into a count anyone could check. */
  // Only the billed ones move money the customer owes; the operating ones are ours to bear.


  /** First and last serial of the customer's outstanding coupons, sorted so the range is real. */
  const couponRange = (() => {
    const serials = customerCoupons.map((c) => c.serial).filter(Boolean).sort();
    return { from: serials[0] ?? '—', to: serials[serials.length - 1] ?? '—' };
  })();

  /** The category the item belongs to, labelled the way the settings list labels it. */
  const lineCategory = (l: SaleLineItem): string => {
    const raw = products.find((p) => p.id === l.item_id)?.category;
    return raw ? (categoryLabels[raw] || raw) : '';
  };

  // Open a read-only detail view: invoice header + lines + its returns.
  const openDetail = async (record: InvoiceRecord) => {
    try {
      const [detRes, retRes] = await Promise.all([
        api.get(`/api/v1/sales/${record.id}`),
        api.get(`/api/v1/sales/${record.id}/returns`),
      ]);
      setViewInvoice({ ...record, ...detRes.data });
      setViewReturns(retRes.data);
      setDetailVisible(true);
    } catch (err) {
      console.error(err);
    }
  };

  // Map a loaded invoice onto the shared invoice document (same shape drives screen + print).
  const invoiceDoc = (inv: any): InvoiceDoc | null => {
    if (!inv) return null;
    const customer = customers.find((c) => c.id === inv.customer_id);
    return {
      kind: 'sale',
      document_number: inv.document_number,
      date: (inv as any).created_at ?? null,
      partyLabel: 'العميل',
      partyName: customer?.name ?? `#${inv.customer_id}`,
      partyPhone: (customer as any)?.phone ?? null,
      partyAddress: (customer as any)?.address ?? null,
      partyId: inv.customer_id ?? null,
      // Only meaningful when the matching switch is on; the document carries them either way so
      // flipping a switch does not need the invoice reloaded.
      branchName: branches.find((b) => b.id === (customer as any)?.branch_id)?.name ?? null,
      repName: reps.find((r) => r.id === inv.rep_id)?.full_name ?? null,
      partyAccount: (() => {
        const a = postingAccounts.find((x: any) => x.id === inv.revenue_account_id);
        return a ? (a.name || a.code || null) : null;
      })(),
      gross: inv.gross,
      discountPct: inv.combined_pct,
      net: inv.net,
      tax: (inv as any).tax_amount ?? 0,
      // On an overpaid invoice the surplus settles prior debt (a payment on account), so on THIS
      // document show only what applied to it: cash ≤ payable and never a negative "remaining".
      cash: Math.min(Number(inv.cash_amount || 0), Number(inv.net || 0) + Number(inv.tax_amount || 0)),
      credit: Math.max(0, Number(inv.credit_amount || 0)),
      entryId: (inv as any).ledger_entry_id ?? null,
      totalPoints: (inv.lines || []).reduce(
        (s: number, l: any) => s + (pointValues[l.item_id] || 0) * Number(l.quantity || 0), 0),
      // (030) The paper number belongs on the printed document — it is how the customer's own
      // filing refers to this sale.
      extraMeta: printMeta(inv),
      lines: (inv.lines || []).map((l: any) => ({
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

  const handleReturnSubmit = () => {
    if (!selectedInvoice || !invoiceDetail) return;
    const linesToReturn = Object.entries(returnQtys)
      .filter(([_, qty]) => qty > 0)
      .map(([itemId, qty]) => ({
        item_id: parseInt(itemId, 10),
        quantity: qty,
      }));

    if (linesToReturn.length === 0) {
      message.warning('يرجى تحديد كميات مرتجعة أكبر من الصفر للأصناف المعنية');
      return;
    }

    showReversalConfirm({
      title: 'تأكيد إرجاع أصناف الفاتورة',
      content: `هل أنت متأكد من حفظ مرتجعات الفاتورة "${selectedInvoice.document_number}"؟ سيتم توليد سند مرتجع وعكس الرصيد المالي المقابل للعميل فوراً.`,
      onOk: async () => {
        try {
          const res = await api.post(`/api/v1/sales/${selectedInvoice.id}/returns`, {
            lines: linesToReturn,
          });
          message.success(`تم تسجيل المرتجع بنجاح. رقم السند: ${res.data.document_number}`);
          setReturnVisible(false);
          fetchInvoices();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Their invoice list, in their order:
  //   `رقم · التاريخ · نوع · مستند رقم · الفاتورة رقم · الحساب الفرعي · جهه التعامل · مندوب ·
  //    اجمالي قبل · خصم · خصم% · ض.م · ض.م % · الاجمالي · الصافى · تم السداد · الباقى ·
  //    ملاحظات · مراكز التكلفة`
  //    Their «مصروفات» and «مصروفات تشغيل» are deliberately absent: the section that fed them was
  //    removed at the client's request, so those columns could only ever read 0.00.
  //
  // Twenty-one columns is more than any screen shows at once, and theirs does not show them all
  // either — it has «حدد الأعمدة» for exactly this. So all of them exist here, in their order and
  // under their names, and the ones a sales list is not usually read for start hidden. Turning one
  // on is a click, and the choice is remembered.
  //
  // Three of theirs have no honest source here and are left out rather than faked:
  //   **نوع** — theirs mixes sales and returns in one list; ours are separate screens, so every
  //   row here would read «فاتورة بيع» and the column would carry no information.
  //   **ض.م · ض.م %** — VAT is held per price tier on the item, not as a figure on the document.
  //   **مراكز التكلفة** — the cost centre is a dimension on ledger entries, not on the invoice.
  const columns = [
    {
      title: 'رقم',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      render: (id: number) => <span style={{ color: '#8a8a8a' }}>{id}</span>,
    },
    {
      title: 'التاريخ',
      dataIndex: 'invoice_date',
      key: 'invoice_date',
      width: 95,
      // Falls back to when it was typed, for the invoices written before the date existed.
      render: (d: string, r: any) => String(d || r.created_at || '').slice(0, 10) || '-',
    },
    {
      title: 'مستند رقم',
      dataIndex: 'external_document_number',
      key: 'external_document_number',
      width: 120,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'الفاتورة رقم',
      dataIndex: 'document_number',
      key: 'document_number',
      width: 115,
      // The whole row is clickable (see the table's onRow); just show the number.
      render: (doc: string) => <Tag color="blue">{doc}</Tag>,
    },
    {
      title: 'الحساب الفرعي',
      dataIndex: 'revenue_account_id',
      key: 'revenue_account_id',
      width: 150,
      ellipsis: true,
      render: (id: number | null) => {
        if (!id) return <span style={{ color: '#bbb' }}>الافتراضي</span>;
        const a = postingAccounts.find((x: any) => x.id === id);
        return a ? (a.name || a.code || `#${id}`) : `#${id}`;
      },
    },
    {
      title: 'جهه التعامل',
      dataIndex: 'customer_id',
      key: 'customer_id',
      ellipsis: true,
      // The customer's name opens their file — from a list of invoices the next question is
      // almost always «العميل ده عليه إيه؟», and that answer lives one screen away.
      render: (cId: number) => {
        const c = customers.find((cust) => cust.id === cId);
        return (
          <a onClick={(e) => { e.stopPropagation(); navigate(`/customers/${cId}`); }}>
            {c ? c.name : `عميل #${cId}`}
          </a>
        );
      },
    },
    {
      title: 'مندوب',
      dataIndex: 'rep_id',
      key: 'rep_id',
      width: 95,
      ellipsis: true,
      render: (id: number | null) => reps.find((r) => r.id === id)?.full_name || '-',
    },
    {
      title: 'اجمالي قبل',
      dataIndex: 'gross',
      key: 'gross',
      width: 120,
      align: 'left' as const,
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'خصم',
      key: 'discount_value',
      width: 110,
      align: 'left' as const,
      // The money, not the rate — derived from the two figures beside it so it can never disagree
      // with them, which is what a stored third copy eventually does.
      render: (_: any, r: InvoiceRecord) => {
        const cut = Number(r.gross || 0) * (Number(r.combined_pct || 0) / 100);
        return `${cut.toFixed(2)} ج.م`;
      },
    },
    {
      title: 'خصم%',
      dataIndex: 'combined_pct',
      key: 'combined_pct',
      width: 90,
      render: (val: string) => `${parseFloat(val).toFixed(0)}%`,
    },
    {
      title: 'الصافى',
      dataIndex: 'net',
      key: 'net',
      width: 110,
      align: 'left' as const,
      render: (val: string) => <strong style={{ color: '#6AB42D' }}>{parseFloat(val).toFixed(2)} ج.م</strong>,
    },
    {
      title: 'تم السداد',
      dataIndex: 'cash_amount',
      key: 'cash_amount',
      width: 100,
      align: 'left' as const,
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'الباقى',
      dataIndex: 'credit_amount',
      key: 'credit_amount',
      width: 100,
      align: 'left' as const,
      render: (val: string) => {
        const n = parseFloat(val);
        return <span style={{ color: n > 0 ? '#cf1322' : undefined }}>{n.toFixed(2)} ج.م</span>;
      },
    },
    {
      title: 'ملاحظات',
      dataIndex: 'notes',
      key: 'notes',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      // Icons, like the row icons on their own lists. Four words apiece cost more width than
      // «الصافى» and «الباقى» together — and those are the two numbers the list exists for.
      render: (_: any, record: InvoiceRecord) => (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          {/* Loads the lines first, then prints — the list row alone has no line detail. */}
          <Tooltip title="طباعة">
            <Button type="text" icon={<PrinterOutlined />}
              onClick={async () => { await openDetail(record); }} />
          </Tooltip>
          <Tooltip title="إرجاع الفاتورة">
            <Button type="text" icon={<RollbackOutlined />}
              onClick={() => openReturnWizard(record)} />
          </Tooltip>
          {/* No Popconfirm here: `handleEditInvoice` asks for itself, so the question is put once
              wherever editing is reached from — this button, the toolbar, or a document link on
              another screen. Two confirmations for one action teach people to click through both. */}
          {canEditInvoice && (
            <Tooltip title="تعديل">
              <Button type="text" icon={<EditOutlined />}
                onClick={() => handleEditInvoice(record)} />
            </Tooltip>
          )}
          {canDeleteInvoice && (
            <Popconfirm
              title="حذف الفاتورة؟"
              description="الفاتورة المرحّلة بتتعكس مش بتتمسح — المخزون والقيد والمديونية بيرجعوا زي ما كانوا، والمستندين بيفضلوا ظاهرين."
              okText="عكس الفاتورة" cancelText="إلغاء"
              onConfirm={() => handleDeleteInvoice(record)}
            >
              <Tooltip title="حذف">
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // The create form is a full inner page (not a modal) — a big invoice form reads better on a
  // full page than boxed inside a scrolling modal.
  /**
   * Walking into the register from an unsaved draft.
   *
   * Their system is always ON a document and steps between them; ours can be on one that does not
   * exist yet, and there is no «next» from a thing with no place in the order. So these open the
   * newest saved invoice — and ASK first when the draft has lines on it, because stepping away is
   * one key and losing an hour of typing to it is not a trade anybody agreed to.
   */
  const stepFromDraft = (index: number) => {
    const target = invoices[index];
    if (!target) return;
    const typed = lines.filter((l) => l.item_id !== null).length;
    const go = () => { closeCreate(); openDetail(target); };
    if (typed === 0) { go(); return; }
    Modal.confirm({
      title: 'سيبان الفاتورة دي؟',
      content: `الفاتورة اللي بتكتبها فيها ${typed} صنف ولسه ماتحفظتش. لو مشيت دلوقتي هتضيع.`,
      okText: 'سيبها وامشي', cancelText: 'ارجع للفاتورة',
      okButtonProps: { danger: true },
      onOk: go,
    });
  };

  /**
   * The toolbar over the document — the row of verbs their old system puts there.
   *
   * Every entry is wired to something that already exists on this screen, and the ones that have
   * no meaning yet on the open document are shown DISABLED rather than dropped, so the positions
   * stay where the hand expects them. Each carries its F-key, because the toolbar and the keyboard
   * are the same commands and neither should teach a different set.
   */
  const docToolbar = (): ToolbarAction[] => {
    const lineCount = lines.filter((l) => l.item_id !== null).length;
    return [
      { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
        onClick: () => { closeCreate(); setInvoiceDate(dayjs()); setNewStep('date'); } },
      { key: 'edit', label: 'تعديل', icon: <EditOutlined />,
        // The open document IS the editable one; on a saved invoice this is «reverse and reopen».
        disabled: true },
      { key: 'undo', label: 'تراجع', icon: <UndoOutlined />,
        disabled: lineCount === 0,
        onClick: () => { setLines([]); setActiveCategory(null); } },
      { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
        disabled: lineCount === 0,
        onClick: () => createForm.submit() },
      { key: 'next', label: 'التالى', icon: <ArrowLeftOutlined />,
        disabled: invoices.length === 0,
        onClick: () => stepFromDraft(0) },
      { key: 'search', label: 'بحث', shortcut: 'F3', icon: <SearchOutlined />,
        onClick: () => setPickerOpen(true) },
      { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />,
        disabled: invoices.length === 0,
        onClick: () => stepFromDraft(1) },
      { key: 'delete', label: 'حذف', shortcut: 'F8', icon: <DeleteOutlined />, danger: true,
        disabled: lineCount === 0,
        onClick: () => { setLines([]); } },
      { key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />,
        // Nothing to print until it is saved — a document that does not exist has no paper.
        disabled: true },
      { key: 'accounts', label: 'حسابات', icon: <BankOutlined />,
        disabled: !selectedCustomerId,
        onClick: () => selectedCustomerId && navigate(`/customers/${selectedCustomerId}`) },
      { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />, onClick: () => loadLookups() },
    ];
  };

  if (createVisible) {
    return (
      <div>
      <Card
          title={
            <Space>
              <Button type="text" icon={<ArrowRightOutlined />}
                onClick={closeCreate}>رجوع</Button>
              <Typography.Text strong style={{ fontSize: 16 }}>
                تسجيل فاتورة بيع جديدة
              </Typography.Text>
              {/* Kept visible and changeable: the person typing should see the day they are
                  writing into, especially when it is not today. */}
              <DatePicker
                value={invoiceDate} allowClear={false} format="YYYY-MM-DD"
                onChange={(v) => setInvoiceDate(v || dayjs())}
              />
            </Space>
          }
        >
        <DocumentToolbar actions={docToolbar()} />
        <Form form={createForm} layout="vertical" onFinish={handleCreateSubmit} requiredMark={false}>
          <Row gutter={16}>
            <Col span={12}>
              {/* Picked from a searchable modal that can also create the customer on the spot,
                  so a new walk-in never costs the half-entered invoice. */}
              <Form.Item
                name="customer_id"
                label="العميل المشتري"
                rules={[{ required: true, message: 'يرجى اختيار العميل!' }]}
                style={{ marginBottom: 8 }}
              >
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  placeholder="اضغط لاختيار العميل"
                  onClick={() => setPartyPickerOpen(true)}
                  options={customers.map((c) => ({
                    value: c.id,
                    label: `${c.name}${c.default_price_tier ? ` — ${TIER_LABELS[c.default_price_tier]}` : ''}`,
                  }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              {/* Filled from the customer, and changeable. A rep on leave is an ordinary day. */}
              <Form.Item name="rep_id" label="المندوب">
                <Select allowClear showSearch placeholder="من العميل"
                  optionFilterProp="label"
                  onChange={(v) => {
                    const store = storeOfRep(v as number);
                    if (store) {
                      createForm.setFieldsValue({ warehouse_id: store });
                      onWarehouseChange(store);
                    }
                  }}
                  options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="warehouse_id"
                label="مستودع الصرف والتسليم"
                rules={[{ required: true, message: 'يرجى اختيار مستودع الصرف!' }]}
              >
                <Select placeholder="من المندوب" onChange={onWarehouseChange}>
                  {warehouses.map((w) => (
                    <Select.Option key={w.id} value={w.id}>
                      {w.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* (030) The paper trail: the customer's own invoice number and any free note. */}
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="external_document_number" label="رقم المستند (الورقي)"
                style={{ marginBottom: 8 }}>
                <Input placeholder="اختياري — رقم فاتورة العميل الورقية" />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="notes" label="ملاحظات" style={{ marginBottom: 8 }}>
                <Input placeholder="اختياري" />
              </Form.Item>
            </Col>
          </Row>

          {/* الكوبونات المصروفة — one row per kind, added and removed freely.
              It used to be a single range, which recorded THAT coupons were handed over and never
              WHICH: a hundred gold and fifty silver had one pair of boxes between them. The serial
              range stays on each row because that is what the returns app checks a returned serial
              against; the kind is what lets the books say what was given. */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>الكوبونات المصروفة</span>
              <Button size="small" icon={<PlusOutlined />}
                onClick={() => setCouponRows((r) => [...r, { key: String(Date.now()) }])}>
                إضافة نوع
              </Button>
              <span style={{ fontSize: 12, color: '#8a8a8a' }}>
                {couponRows.length === 0
                  ? 'سيبها فاضية لو الفاتورة من غير كوبونات.'
                  : `الإجمالي: ${couponRows.reduce(
                    (t, r) => t + (couponCount(r.serial_from, r.serial_to) ?? 0), 0)} كوبون`}
              </span>
            </div>
            {couponRows.map((row) => (
              <Row gutter={8} key={row.key} align="middle" style={{ marginBottom: 6 }}>
                <Col xs={24} md={7}>
                  <Select allowClear showSearch style={{ width: '100%' }}
                    placeholder="نوع الكوبون" optionFilterProp="label"
                    value={row.coupon_type_id}
                    onChange={(v) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                      ? { ...x, coupon_type_id: v as number } : x)))}
                    options={couponTypes.map((t) => ({ value: t.id, label: t.name }))} />
                </Col>
                <Col xs={8} md={4}>
                  {/* Derived from the range, never typed. Read-only rather than hidden: the
                      number is what the person is checking against the book in their hand. */}
                  <InputNumber style={{ width: '100%' }} placeholder="العدد" disabled
                    value={couponCount(row.serial_from, row.serial_to) ?? undefined} />
                </Col>
                <Col xs={8} md={5}>
                  <Input placeholder="من رقم" value={row.serial_from || ''}
                    onChange={(e) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                      ? { ...x, serial_from: e.target.value } : x)))} />
                </Col>
                <Col xs={8} md={5}>
                  <Input placeholder="إلى رقم" value={row.serial_to || ''}
                    onChange={(e) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                      ? { ...x, serial_to: e.target.value } : x)))} />
                </Col>
                <Col xs={24} md={3}>
                  <Button type="text" danger icon={<DeleteOutlined />}
                    onClick={() => setCouponRows((rs) => rs.filter((x) => x.key !== row.key))} />
                </Col>
              </Row>
            ))}
          </div>

          {/* (030) The party's standing at a glance — what he owes, and how to reach him. */}
          {party && (
            <Row gutter={12} style={{
              marginBottom: 14, padding: '10px 14px', borderRadius: 10,
              background: '#f6faf3', border: '1px solid #e6efe3',
            }}>
              <Col xs={12} md={6}>
                <div style={{ fontSize: 12, color: '#8a8a8a' }}>العميل</div>
                <b>{party.name}</b>
              </Col>
              <Col xs={12} md={6}>
                <div style={{ fontSize: 12, color: '#8a8a8a' }}>الحالي (رصيده)</div>
                <b style={{ color: Number(customerBalance ?? 0) > 0 ? '#cf1322' : '#6AB42D' }}>
                  {money(customerBalance ?? 0)} ج.م
                </b>
              </Col>
              <Col xs={12} md={6}>
                <div style={{ fontSize: 12, color: '#8a8a8a' }}>الهاتف</div>
                <b>{party.phone || '-'}</b>
              </Col>
              <Col xs={12} md={6}>
                <div style={{ fontSize: 12, color: '#8a8a8a' }}>العنوان</div>
                <b>{party.address || '-'}</b>
              </Col>

              {/* نوع الفاتورة. Shown only when the customer HAS more than one line, because for
                  everybody else it is a question with a single possible answer. Left empty rather
                  than pre-picked: choosing for him is choosing which balance the invoice moves. */}
              {families.length > 1 && (
                <Col xs={24} style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: '#8a8a8a', marginBottom: 4 }}>
                    نوع الفاتورة — بتترحّل على أنهي حساب؟
                  </div>
                  <Segmented
                    value={invoiceFamily ?? ''}
                    onChange={(v: string | number) => setInvoiceFamily(String(v) || null)}
                    options={families.map((a) => ({
                      value: a.family as string,
                      label: (
                        <span>
                          {a.family}
                          <span style={{ color: '#8a8a8a', marginInlineStart: 6, fontSize: 12 }}>
                            ({money(Number(a.balance || 0))})
                          </span>
                        </span>
                      ),
                    }))}
                  />
                  {!invoiceFamily && (
                    <div style={{ color: '#cf4b1a', fontSize: 12, marginTop: 4 }}>
                      اختار النوع الأول — الفاتورة هتترحّل على الحساب ده.
                    </div>
                  )}
                </Col>
              )}
            </Row>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Divider orientation="right" style={{ fontWeight: 700, flex: 1 }}>
              المنتجات المباعة
            </Divider>
            {/* Each person turns off the columns they never read. الصنف · الكمية · الإجمالي are
                locked — a line without them is not a line anybody can check. */}
            <ColumnSettings
              choices={[
                { key: 'product', title: 'المنتج', locked: true },
                { key: 'warehouse', title: 'المخزن' },
                { key: 'category', title: 'الفئة' },
                { key: 'tier', title: 'فئة السعر' },
                { key: 'quantity', title: 'الكمية', locked: true },
                { key: 'unit_price', title: 'سعر الوحدة' },
                { key: 'fixed_discount', title: 'خصم ثابت %' },
                { key: 'variable_discount', title: 'خصم متغير %' },
                { key: 'total', title: 'الإجمالي', locked: true },
                { key: 'points', title: 'النقاط' },
              ]}
              hidden={lineCols.hidden}
              onChange={lineCols.setHidden}
            />
          </div>

          {/* Products on the right, the stock panel pinned beside them: picking a category or a
              product answers "do we have it, and where" without leaving the half-typed invoice. */}
          <Row gutter={16}>
          <Col xs={24} lg={18}>

          {/* One button, one window. As two inline dropdowns this cost a click to open, a
              scroll to find and a click to choose — twice per line, all day. */}
          <Button data-shortcut="F2"
            type="primary" size="large" icon={<PlusOutlined />} block
            style={{ marginBottom: 14, height: 46 }}
            onClick={() => setPickerOpen(true)}
          >
            إضافة صنف للفاتورة
          </Button>

          <ProductPickerModal
            open={pickerOpen}
            categories={productCategories}
            categoryLabels={categoryLabels}
            products={products}
            activeCategory={activeCategory}
            onCategoryChange={(c) => { setActiveCategory(c); setPanelItemId(null); }}
            availableFor={(id) => availableFor(id, null, docWarehouseId)}
            onCancel={() => setPickerOpen(false)}
            onPick={(id) => {
              setPickerOpen(false);
              setPanelItemId(id);
              addProductById(id);
            }}
            onPickMany={async (ids) => {
              setPickerOpen(false);
              // Sequentially: each add reads the lines it is appending to, so firing them at once
              // would have every one of them see the list as it was before any were added.
              for (const id of ids) await addProductById(id);
              if (ids.length) setPanelItemId(ids[ids.length - 1]);
            }}
          />

          {lines.length === 0 ? (
            <Empty description="اختر الفئة ثم المنتجات لإضافتها للفاتورة" style={{ margin: '12px 0' }} />
          ) : (
            linesByCategory.map((group) => (
              <div key={group.category ?? '__none__'}
                style={{ border: '1px solid #e6efe3', borderRadius: 10, overflow: 'hidden',
                         marginBottom: 12 }}>
                {/* Category header. */}
                <div style={{ background: '#f2f9f3', padding: '8px 12px', display: 'flex',
                              alignItems: 'center', gap: 8 }}>
                  <Tag color="green" style={{ fontWeight: 700, margin: 0 }}>
                    {group.category ? (categoryLabels[group.category] || group.category) : 'بدون فئة'}
                  </Tag>
                  <span style={{ color: '#8a8a8a', fontSize: 12 }}>{group.items.length} صنف</span>
                </div>

                {/* Column headers. */}
                <Row gutter={8} style={{ padding: '6px 12px 0', color: '#8a8a8a', fontSize: 12 }}>
                  <Col md={4}>المنتج</Col>
                  {showCol('warehouse') && <Col md={3}>المخزن</Col>}
                  {showCol('category') && <Col md={2}>الفئة</Col>}
                  {showCol('tier') && <Col md={2}>فئة السعر</Col>}
                  <Col md={2}>الكمية</Col>
                  {showCol('unit_price') && <Col md={2}>سعر الوحدة</Col>}
                  {showCol('fixed_discount') && <Col md={2}>خصم ثابت %</Col>}
                  {showCol('variable_discount') && <Col md={2}>خصم متغير %</Col>}
                  <Col md={2} style={{ textAlign: 'center' }}>الإجمالي</Col>
                  {showCol('points') && <Col md={2} style={{ textAlign: 'center' }}>النقاط</Col>}
                  <Col md={1} />
                </Row>

                {group.items.map((line) => {
                  const serialized = line.item_id
                    && products.find((p) => p.id === line.item_id)?.is_serialized;
                  return (
                    <div key={line.key}
                      style={{ padding: '4px 12px 6px', borderTop: '1px solid #f0f5ee' }}>
                      <Row gutter={8} align="middle">
                        <Col md={4} xs={24}>
                          {/* Click the name to point the stock panel at this line's item. */}
                          <b style={{ cursor: 'pointer' }}
                            onClick={() => setPanelItemId(line.item_id as number)}>
                            {productName(line.item_id as number)}
                          </b>
                          {/* Stock never goes negative — show the ceiling right where it binds,
                              for THIS line's warehouse. */}
                          <span style={{
                            marginInlineStart: 8, fontSize: 12,
                            color: availableFor(line.item_id, line.unit, lineWarehouse(line)) > 0
                              ? '#6AB42D' : '#cf1322',
                          }}>
                            (المتاح: {availableFor(line.item_id, line.unit, lineWarehouse(line))
                              .toLocaleString('ar-EG', { maximumFractionDigits: 3 })})
                          </span>
                        </Col>
                        {showCol('warehouse') && (
                        <Col md={3} xs={12}>
                          {/* (030) Each line may be served from a different warehouse. */}
                          <Select size="small" style={{ width: '100%' }}
                            value={lineWarehouse(line) ?? undefined}
                            placeholder="المخزن"
                            onChange={(val) => handleLineChange(line.key, 'warehouse_id', val)}
                            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                        </Col>
                        )}
                        {showCol('category') && (
                        <Col md={2} xs={12}>
                          {/* The category the item is sold out of — read from the item itself, so
                              it always matches the catalogue rather than being typed per line. */}
                          <Tag color="green" style={{ margin: 0, width: '100%',
                            textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {lineCategory(line) || '—'}
                          </Tag>
                        </Col>
                        )}
                        {showCol('tier') && (
                        <Col md={2} xs={12}>
                          <Select size="small" style={{ width: '100%' }} value={line.tier ?? undefined}
                            onChange={(val) => handleLineChange(line.key, 'tier', val)}>
                            {Object.entries(TIER_LABELS).map(([k, l]) => (
                              <Select.Option key={k} value={k}>{l}</Select.Option>
                            ))}
                          </Select>
                        </Col>
                        )}
                        <Col md={2} xs={8}>
                          {/* 0.001, not 1. Quantities are stored to three decimals and the item
                              catalogue has units with factors — نص متر, ٢٫٥ كيلو. The return
                              screen and the transfer already allow those, so a floor of 1 here
                              meant a thing could be given back and moved between stores in a
                              fraction and never sold in one. */}
                          <InputNumber size="small" min={0.001} style={{ width: '100%' }}
                            ref={(el) => { qtyRefs.current[line.key] = el; }}
                            data-qty-key={line.key}
                            data-grid-col="qty" keyboard={false}
                            max={availableFor(line.item_id, line.unit, lineWarehouse(line)) || undefined}
                            status={Number(line.quantity || 0)
                              > availableFor(line.item_id, line.unit, lineWarehouse(line))
                              ? 'error' : undefined}
                            placeholder="الكمية"
                            value={line.quantity ?? undefined}
                            // Clearing it leaves it EMPTY rather than snapping back to 1 — the
                            // box has to be blankable for «type over it» to mean anything.
                            onChange={(val) => handleLineChange(line.key, 'quantity', val ?? null)}
                            // Enter means «this line is done» — straight back to the picker for
                            // the next product, so a whole invoice is: pick, type a quantity,
                            // Enter, pick, type, Enter, without ever leaving the keyboard.
                            //
                            // preventDefault is what makes the loop hold: the global «Enter moves
                            // to the next field» listens on the window and would otherwise run
                            // after this and drag the caret off to the next input, so the picker
                            // opened onto a cursor that had already wandered.
                            onPressEnter={(e) => { e.preventDefault(); setPickerOpen(true); }} />
                        </Col>
                        {showCol('unit_price') && (
                        <Col md={2} xs={8}>
                          <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
                            value={line.unit_price}
                            onChange={(val) => handleLineChange(line.key, 'unit_price', val || 0)} />
                        </Col>
                        )}
                        {showCol('fixed_discount') && (
                        <Col md={2} xs={8}>
                          {/* Prefilled from the item's own discount, but editable — the
                              salesman on the counter is the one who knows when it does not
                              apply. Combined with the variable discount it is still capped
                              below 100%, because a line can never be given away twice. */}
                          <InputNumber size="small" min={0} max={100} step={0.5}
                            style={{ width: '100%' }} value={line.fixed_discount}
                            onChange={(val) => handleLineChange(
                              line.key, 'fixed_discount', val || 0)} />
                        </Col>
                        )}
                        {showCol('variable_discount') && (
                        <Col md={2} xs={8}>
                          <InputNumber size="small" min={0} max={100} step={0.5} style={{ width: '100%' }}
                            placeholder="0"
                            value={line.variable_discount ?? undefined}
                            onChange={(val) => handleLineChange(line.key, 'variable_discount', val ?? null)} />
                        </Col>
                        )}
                        <Col md={2} xs={12} style={{ textAlign: 'center' }}>
                          <b style={{ color: '#6AB42D' }}>{lineTotal(line).toFixed(2)}</b>
                        </Col>
                        {showCol('points') && (
                        <Col md={2} xs={12} style={{ textAlign: 'center' }}>
                          <span style={{ color: '#F5A11D', fontWeight: 600 }}>
                            {linePoints(line).toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
                          </span>
                        </Col>
                        )}
                        <Col md={1} xs={4} style={{ textAlign: 'center' }}>
                          <Button type="text" size="small" danger icon={<DeleteOutlined />}
                            onClick={() => handleRemoveLine(line.key)} />
                        </Col>
                      </Row>
                      {serialized && (
                        <Input size="small" style={{ marginTop: 6 }}
                          placeholder="أرقام تسلسلية مفصولة بمسافة/فاصلة (يجب أن يساوي عددها الكمية)"
                          value={line.serials}
                          onChange={(e) => handleLineChange(line.key, 'serials', e.target.value)} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}

          </Col>
          <Col xs={24} lg={6}>
            <ItemStockPanel
              itemId={panelItemId}
              category={activeCategory}
              products={products}
              onPickItem={(id) => setPanelItemId(id)}
            />
          </Col>
          </Row>

          {/* Totals + payment — see TotalsLadder for why this is one ladder and not a strip. */}
          {(() => {
            const invoiceDiscount = grossTotal - netTotal;
            const hasParty = !!selectedCustomerId && customerBalance !== null;
            const balance = customerBalance ?? 0;
            const due = balance + netTotal - cashAmount;
            return (
              <TotalsLadder
                tone="sale"
                inputs={(
                  <>
                    <Form.Item label="خصم على إجمالي الفاتورة" style={{ marginBottom: 12 }}>
                      <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%"
                        value={discountPct} onChange={(val) => setDiscountPct(val || 0)} />
                    </Form.Item>
                    <Form.Item label="المبلغ المدفوع نقداً" style={{ marginBottom: 0 }}
                      help={hasParty ? 'ممكن يزيد عن الفاتورة فيسدّد المديونية القديمة' : undefined}>
                      <InputNumber min={0} style={{ width: '100%' }} addonAfter="ج.م"
                        value={cashAmount} onChange={(val) => setCashAmount(val || 0)} />
                    </Form.Item>
                  </>
                )}
                rows={[
                  { label: 'إجمالي الأصناف', value: grossTotal.toFixed(2) },
                  { label: `خصم الفاتورة (${discountPct}%)`,
                    value: `− ${invoiceDiscount.toFixed(2)}`, color: '#cf1322',
                    show: invoiceDiscount > 0.001 },
                  { label: 'صافي الفاتورة', value: netTotal.toFixed(2),
                    strong: true, color: '#6AB42D', rule: true },
                  // One line per product family, the chosen one tinted, then the whole debt.
                  // Three similar numbers in a column with nothing marking which one this invoice
                  // moves is three numbers nobody reads.
                  ...families.map((a) => ({
                    label: `مديونية ${a.family}`,
                    value: money(Number(a.balance || 0)),
                    color: Number(a.balance || 0) > 0 ? '#cf1322' : '#6AB42D',
                    highlight: a.family === invoiceFamily,
                    show: hasParty,
                  })),
                  { label: 'إجمالي المديونية', value: money(balance), strong: true,
                    color: balance > 0 ? '#cf1322' : '#6AB42D',
                    rule: families.length > 1,
                    show: hasParty && families.length > 1 },
                  { label: 'حساب سابق على العميل', value: money(balance),
                    color: balance > 0 ? '#cf1322' : '#6AB42D',
                    // Only for a customer with no split — otherwise it restates the total above.
                    show: hasParty && families.length <= 1 && Math.abs(balance) > 0.001 },
                  { label: 'المدفوع نقداً', value: `− ${money(cashAmount)}`, color: '#6AB42D',
                    show: hasParty && cashAmount > 0.001 },
                  { label: 'الباقي على العميل', value: money(due), big: true, rule: true,
                    color: due > 0.001 ? '#cf1322' : '#6AB42D', show: hasParty },
                ]}
                notes={[
                  <>النقاط: <b style={{ color: '#F5A11D' }}>
                    {totalPoints.toLocaleString('ar-EG', { maximumFractionDigits: 3 })}</b></>,
                  creditAmount < -0.001 ? (
                    <>يسدّد من المديونية القديمة:{' '}
                      <b style={{ color: '#6AB42D' }}>{money(Math.abs(creditAmount))} ج.م</b></>
                  ) : null,
                  creditAmount > 0.001 ? (
                    <>آجل على الفاتورة دي:{' '}
                      <b style={{ color: '#cf1322' }}>{money(creditAmount)} ج.م</b></>
                  ) : null,
                  hasParty ? (
                    <>الكوبونات:{' '}
                      {customerCoupons.length
                        ? <b style={{ color: '#F5A11D' }}>
                            {customerCoupons.length} — من {couponRange.from} إلى {couponRange.to}</b>
                        : <b>لا يوجد</b>}
                    </>
                  ) : null,
                ]}
              />
            );
          })()}

          <Form.Item style={{ marginTop: 20, marginBottom: 0 }}>
            {/* Aligned to the physical left of the page (flex-end under RTL). */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Space>
                <Button type="primary" size="large" htmlType="submit">
                  تسجيل وحفظ فاتورة البيع
                </Button>
                <Button size="large" onClick={closeCreate}>إلغاء</Button>
              </Space>
            </div>
          </Form.Item>
        </Form>
        </Card>

        <PartyPickerModal
          open={partyPickerOpen} kind="customer"
          onPick={handlePartyPicked} onCancel={() => setPartyPickerOpen(false)}
          date={createVisible ? undefined : invoiceDate}
          onDateChange={setInvoiceDate} />
      </div>
    );
  }

  return (
    <div>
      <Card
        title="الفواتير (سجل فواتير المبيعات)"
        extra={(
          <Space>
            <ColumnSettings
              choices={columns.map((c: any) => ({
                key: String(c.key ?? c.dataIndex ?? ''),
                title: typeof c.title === 'string' ? c.title : 'إجراءات',
                // The number is how a row is identified out loud; hiding it would leave a table
                // nobody can refer to.
                locked: c.key === 'document_number',
              }))}
              hidden={invoiceCols.hidden}
              onChange={invoiceCols.setHidden}
            />
            <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
            <Button type="primary" icon={<PlusOutlined />}
              onClick={() => { setInvoiceDate(dayjs()); setNewStep('date'); }}>
              تسجيل فاتورة بيع
            </Button>
          </Space>
        )}
      >
        {/* --- Search + filters (server-side, so they cover every invoice) --- */}
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={6}>
            <Input
              allowClear
              value={search}
              placeholder="بحث برقم الفاتورة"
              prefix={<SearchOutlined />}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={applySearch}
              onBlur={applySearch}
            />
          </Col>
          <Col xs={24} md={6}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="العميل"
              value={filters.customer_id}
              onChange={(v) => setFilter('customer_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={customers.map((c) => ({ value: c.id, label: c.name }))} />
          </Col>
          <Col xs={12} md={6}>
            <DatePicker.RangePicker style={{ width: '100%' }}
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
              }} />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear style={{ width: '100%' }} placeholder="طريقة السداد"
              value={filters.payment}
              onChange={(v) => setFilter('payment', v)}
              options={[
                { value: 'cash', label: 'نقدي بالكامل' },
                { value: 'credit', label: 'آجل بالكامل' },
                { value: 'partial', label: 'جزئي (نقدي + آجل)' },
              ]} />
          </Col>
          <Col xs={24} md={2}>
            <Button icon={<ClearOutlined />} onClick={resetFilters} block>مسح</Button>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="عدد الفواتير الظاهرة" value={summary.count} /></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="إجمالي صافي المبيعات" value={money(summary.net)} suffix="ج.م" />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="إجمالي المتبقي آجل" value={money(summary.credit)} suffix="ج.م"
                valueStyle={{ color: summary.credit > 0 ? '#cf1322' : undefined }} />
            </Card>
          </Col>
        </Row>

        <Table
          dataSource={invoices}
          columns={invoiceCols.apply(columns)}
          tableLayout="fixed"
          rowKey="id"
          loading={loading}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
          // The whole row opens the invoice details.
          onRow={(record) => ({
            onClick: () => openDetail(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* Return Invoice Drawer */}
      <Modal footer={null} centered
        title={`مرتجع مبيعات للفاتورة: ${selectedInvoice?.document_number || ''}`}
        width={500}
        onCancel={() => setReturnVisible(false)}
        open={returnVisible}
        destroyOnHidden
      >
        <div style={{ marginBottom: 20 }}>
          <p>يرجى إدخال الكميات المراد إرجاعها من كل صنف مباع. سيتم حساب قيمة المرتجعات المالية تلقائياً بالخلفية وعكس قيد اليومية المقابل.</p>
        </div>

        {invoiceDetail?.lines.map((line) => {
          const prod = products.find((p) => p.id === line.item_id);
          return (
            <div key={line.item_id} style={{ marginBottom: 20, padding: 12, border: '1px solid #f0f0f0', borderRadius: 8 }}>
              <h4>{prod ? prod.name : `منتج #${line.item_id}`}</h4>
              <Row gutter={16}>
                <Col span={12}>
                  <span>الكمية المشتراة بالفاتورة: </span>
                  <strong>{line.quantity} وحدات</strong>
                </Col>
                <Col span={12}>
                  <Form.Item label="الكمية المرتجعة" style={{ marginBottom: 0 }}>
                    <InputNumber
                      min={0}
                      max={parseFloat(line.quantity)}
                      value={returnQtys[line.item_id] || 0}
                      onChange={(val) => setReturnQtys({ ...returnQtys, [line.item_id]: val || 0 })}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </div>
          );
        })}

        <div style={{ marginTop: 30 }}>
          <Space>
            <Button type="primary" danger onClick={handleReturnSubmit}>
              تأكيد وحفظ المرتجع
            </Button>
            <Button onClick={() => setReturnVisible(false)}>إلغاء</Button>
          </Space>
        </div>
      </Modal>

      {/* Invoice detail / view */}
      <Modal centered
        title={(
          <Space>
            {/* Stepping between neighbours moved into the toolbar below, under التالى/السابق —
                the same verbs their old screen puts there. Two sets of arrows for one action is
                one set too many, and the toolbar is the one that keeps its place on every
                document. */}
            <span>{`تفاصيل الفاتورة ${viewInvoice?.document_number ?? ''}`}</span>
          </Space>
        )}
        width={640}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        destroyOnHidden
        footer={invoiceFooter(invoiceDoc(viewInvoice), () => setDetailVisible(false))}
      >
        {viewInvoice && <DocumentToolbar actions={viewToolbar()} />}
        {viewInvoice && (
          <>
            <InvoiceDocument doc={invoiceDoc(viewInvoice)!}
              onItemClick={(id) => { setDetailVisible(false); navigate(`/catalog/${id}`); }}
              onPartyClick={(id) => { setDetailVisible(false); navigate(`/customers/${id}`); }} />

            <Divider orientation="right">المرتجعات</Divider>
            <Table
              size="small" pagination={false} rowKey="id"
              dataSource={viewReturns}
              locale={{ emptyText: 'لا يوجد مرتجعات على هذه الفاتورة' }}
              columns={[
                { title: 'سند المرتجع', dataIndex: 'document_number', render: (d: string) => <Tag color="volcano">{d}</Tag> },
                { title: 'القيمة', dataIndex: 'value', render: (v: string) => `${parseFloat(v).toFixed(2)} ج.م` },
                { title: 'ردّ نقدي', dataIndex: 'cash_refund', render: (v: string) => `${parseFloat(v).toFixed(2)} ج.م` },
                { title: 'خصم آجل', dataIndex: 'credit_reduction', render: (v: string) => `${parseFloat(v).toFixed(2)} ج.م` },
              ]}
            />

            {viewInvoice.customer_id && (
              <CustomerAccountPanel customerId={viewInvoice.customer_id} />
            )}
          </>
        )}
      </Modal>

      {/* The one step that opens a document: who it is for, and when. It lives in BOTH views —
          the create view renders its own copy for changing the party mid-invoice — and only one
          of the two is ever mounted, because the create view returns early. */}
      <PartyPickerModal
        open={partyPickerOpen || newStep === 'party'} kind="customer"
        onPick={handlePartyPicked}
        onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }} />

      {/* الباب الأول: التاريخ. It lands on the ledger entry as well as the invoice, so it is
          settled before anything is priced rather than after. */}
      <Modal
        open={newStep === 'date'}
        title="تاريخ الفاتورة"
        okText="التالي"
        cancelText="إلغاء"
        onCancel={() => setNewStep(null)}
        onOk={() => setNewStep('party')}
        destroyOnHidden
      >
        {/* Enter on the date is «done, next» — the DatePicker has no onPressEnter of its own,
            so the key is caught on the wrapper. */}
        <div onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setNewStep('party'); } }}>
          <DatePicker
            style={{ width: '100%' }} size="large" allowClear={false} autoFocus
            value={invoiceDate} onChange={(v) => setInvoiceDate(v || dayjs())}
            format="YYYY-MM-DD"
          />
        </div>
        <div style={{ marginTop: 10, color: '#8a8a8a', fontSize: 13 }}>
          التاريخ ده بيتسجّل على الفاتورة وعلى قيدها المحاسبي — يعني الفاتورة والدفاتر بيقعوا
          في نفس اليوم.
        </div>
      </Modal>

    </div>
  );
}

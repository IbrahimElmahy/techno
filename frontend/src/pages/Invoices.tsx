import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Descriptions, Divider, Empty, Form, Input, InputNumber, Modal, Popconfirm, Result, Row, Select, Space, Statistic, Table, Tag, Typography, message,
} from 'antd';
import {
  PlusOutlined, RollbackOutlined, FileTextOutlined, PrinterOutlined, DeleteOutlined,
  EditOutlined,
  ArrowRightOutlined, SearchOutlined, ClearOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import InvoiceDocument, { InvoiceDoc, invoiceFooter } from '../components/InvoiceDocument';
import CustomerAccountPanel from '../components/CustomerAccountPanel';
import PartyPickerModal, { Party } from '../components/PartyPickerModal';
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
  quantity: number;
  unit_price: number;
  tier: string | null;
  unit: string | null;
  serials: string;
  fixed_discount: number;          // the item's own fixed discount (auto)
  variable_discount: number;       // a typed extra discount on this line
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
  const [pointValues, setPointValues] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);

  // Drawers
  const [createVisible, setCreateVisible] = useState(false);
  const [returnVisible, setReturnVisible] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);

  // Standalone invoice detail/view (separate from the return wizard)
  const [detailVisible, setDetailVisible] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<any>(null);
  const [viewReturns, setViewReturns] = useState<any[]>([]);

  // Forms
  const [createForm] = Form.useForm();
  const [returnForm] = Form.useForm();

  // Create invoice dynamic lines
  const blankLine = (key: string, tier: string | null = null): SaleLineItem => ({
    key, category: null, item_id: null, quantity: 1, unit_price: 0, tier, unit: null,
    serials: '', fixed_discount: 0, variable_discount: 0, warehouse_id: null,
  });
  const [lines, setLines] = useState<SaleLineItem[]>([]);
  // Cache of each item's tier prices, so the line price follows the chosen tier (matches backend).
  const [pricesCache, setPricesCache] = useState<Record<number, { base: number | null; tiers: Record<string, number> }>>({});
  const [unitsCache, setUnitsCache] = useState<Record<number, ItemUnit[]>>({});
  const [customerTier, setCustomerTier] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerBalance, setCustomerBalance] = useState<number | null>(null);
  // Coupons already issued to this customer and not yet redeemed — the counter reads out their
  // serial range when handing them over.
  const [customerCoupons, setCustomerCoupons] = useState<any[]>([]);
  // On-hand per WAREHOUSE per item: `{ [warehouseId]: { [itemId]: qty } }`. Since 030 each line may
  // be served from a different warehouse, so a single item-keyed map would answer the wrong
  // question. Stock can never go negative, so the form shows what is available and caps the
  // quantity rather than letting the user build a basket the server will refuse.
  const [availability, setAvailability] = useState<Record<number, Record<number, number>>>({});
  // (030) the party picker + what it filled into the document header
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
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
      const [custRes, prodRes, whRes, ptRes] = await Promise.all([
        api.get('/api/v1/customers'),
        api.get('/api/v1/items?kind=product'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/products/point-values'),
      ]);
      setCustomers(custRes.data);
      setProducts(prodRes.data);
      setWarehouses(whRes.data);
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
    return l.quantity * l.unit_price * (1 - disc / 100);
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
    setCustomerCoupons([]);
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
        ? { ...x, quantity: x.quantity + 1 } : x)));
    } else {
      setLines((prev) => [...prev, l]);
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

  /** Chosen from the picker (existing or just-created) — fills the form and the header strip. */
  const handlePartyPicked = (picked: Party) => {
    setParty(picked);
    setPartyPickerOpen(false);
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

  const onCustomerChange = (customerId: number) => {
    const c = customers.find((x) => x.id === customerId);
    const tier = c?.default_price_tier ?? null;
    setCustomerTier(tier);
    setSelectedCustomerId(customerId);
    setCustomerBalance(null);
    setCustomerCoupons([]);
    api.get(`/api/v1/customers/${customerId}/account`)
      .then((res) => setCustomerBalance(Number(res.data.balance || 0)))
      .catch((err) => console.error(err));
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

    // Never sell more than a warehouse holds. Checked on the SUM per (item × warehouse), because
    // two lines of 3 against a stock of 5 each look affordable alone — the server applies the
    // same rule, this just says so before the basket is lost.
    const wanted = new Map<string, number>();
    validLines.forEach((l) => {
      const key = `${lineWarehouse(l)}:${l.item_id}`;
      wanted.set(key, (wanted.get(key) ?? 0) + l.quantity);
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
        if (ser.length !== l.quantity) {
          message.error(`«${prod.name}»: عدد الأرقام التسلسلية يجب أن يساوي الكمية (${l.quantity})`);
          return;
        }
      }
    }

    try {
      await api.post('/api/v1/sales', {
        customer_id: values.customer_id,
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
            quantity: l.quantity,
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
        notes: values.notes || undefined,
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
  const reverseInvoice = async (record: InvoiceRecord): Promise<boolean> => {
    try {
      const det = await api.get(`/api/v1/sales/${record.id}`);
      const lines = (det.data.lines || []).map((l: any) => ({
        item_id: l.item_id, quantity: String(l.quantity),
      }));
      if (!lines.length) { message.error('الفاتورة من غير سطور'); return false; }
      await api.post(`/api/v1/sales/${record.id}/returns`, { lines });
      return true;
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message
        || 'تعذر عكس الفاتورة — لو الأصناف اتباعت أو اتحوّلت بعدها، رجّعها الأول.');
      return false;
    }
  };

  const handleDeleteInvoice = async (record: InvoiceRecord) => {
    if (await reverseInvoice(record)) {
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
  const handleEditInvoice = async (record: InvoiceRecord) => {
    let det: any;
    try {
      det = (await api.get(`/api/v1/sales/${record.id}`)).data;
    } catch {
      message.error('تعذر قراءة الفاتورة');
      return;
    }
    if (!(await reverseInvoice(record))) return;

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

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? `صنف #${id}`;

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
      partyId: inv.customer_id ?? null,
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
      extraMeta: (inv as any).external_document_number
        ? ([['رقم المستند', (inv as any).external_document_number]] as [string, string][])
        : undefined,
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

  const columns = [
    {
      title: 'رقم الفاتورة',
      dataIndex: 'document_number',
      key: 'document_number',
      // The whole row is clickable (see the table's onRow); just show the number.
      render: (doc: string) => <Tag color="blue">{doc}</Tag>,
    },
    {
      title: 'العميل',
      dataIndex: 'customer_id',
      key: 'customer_id',
      render: (cId: number) => {
        const c = customers.find((cust) => cust.id === cId);
        return c ? c.name : `عميل #${cId}`;
      },
    },
    {
      title: 'القيمة الإجمالية (Gross)',
      dataIndex: 'gross',
      key: 'gross',
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'نسبة الخصم المدمج',
      dataIndex: 'combined_pct',
      key: 'combined_pct',
      render: (val: string) => `${parseFloat(val).toFixed(0)}%`,
    },
    {
      title: 'الصافي المطلوب (Net)',
      dataIndex: 'net',
      key: 'net',
      render: (val: string) => <strong style={{ color: '#6AB42D' }}>{parseFloat(val).toFixed(2)} ج.م</strong>,
    },
    {
      title: 'المدفوع نقداً',
      dataIndex: 'cash_amount',
      key: 'cash_amount',
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'المتبقي آجل',
      dataIndex: 'credit_amount',
      key: 'credit_amount',
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: InvoiceRecord) => (
        <Space size="middle" onClick={(e) => e.stopPropagation()}>
          {/* Loads the lines first, then prints — the list row alone has no line detail. */}
          <Button type="link" icon={<PrinterOutlined />}
            onClick={async () => { await openDetail(record); }}>
            طباعة
          </Button>
          <Button
            type="dashed"
            icon={<RollbackOutlined />}
            onClick={() => openReturnWizard(record)}
          >
            إرجاع الفاتورة
          </Button>
          <Popconfirm
            title="تعديل الفاتورة؟"
            description="هيتعمل مرتجع كامل للفاتورة، وتتفتح بنفس أصنافها عشان تعدّل وترحّل من جديد."
            okText="تعديل" cancelText="إلغاء"
            onConfirm={() => handleEditInvoice(record)}
          >
            <Button type="link" icon={<EditOutlined />}>تعديل</Button>
          </Popconfirm>
          <Popconfirm
            title="حذف الفاتورة؟"
            description="الفاتورة المرحّلة بتتعكس مش بتتمسح — المخزون والقيد والمديونية بيرجعوا زي ما كانوا، والمستندين بيفضلوا ظاهرين."
            okText="عكس الفاتورة" cancelText="إلغاء"
            onConfirm={() => handleDeleteInvoice(record)}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>حذف</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // The create form is a full inner page (not a modal) — a big invoice form reads better on a
  // full page than boxed inside a scrolling modal.
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
            </Space>
          }
        >
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
            <Col span={12}>
              <Form.Item
                name="warehouse_id"
                label="مستودع الصرف والتسليم"
                rules={[{ required: true, message: 'يرجى اختيار مستودع الصرف!' }]}
              >
                <Select placeholder="اختر المستودع" onChange={onWarehouseChange}>
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
            </Row>
          )}

          <Divider orientation="right" style={{ fontWeight: 700 }}>المنتجات المباعة</Divider>

          {/* Choose a category once (keeps the product list short), then pick products from it —
              each pick adds it instantly. Switch category to add from another. */}
          <Row gutter={12} style={{ marginBottom: 14 }}>
            <Col xs={24} md={7}>
              <Select showSearch style={{ width: '100%' }} size="large"
                placeholder="١) اختر الفئة" value={activeCategory ?? undefined}
                optionFilterProp="label"
                onChange={(val) => setActiveCategory(val ?? null)}
                options={productCategories.map((c) => ({ value: c, label: categoryLabels[c] || c }))} />
            </Col>
            <Col xs={24} md={17}>
              <Select showSearch value={null} size="large" style={{ width: '100%' }}
                disabled={!activeCategory}
                placeholder={activeCategory ? '٢) اختر منتجاً من الفئة لإضافته' : 'اختر الفئة أولاً'}
                optionFilterProp="label"
                onChange={(val) => { if (val) addProductById(val as number); }}
                options={products
                  .filter((p) => p.category === activeCategory)
                  .map((p) => ({ value: p.id, label: p.name }))} />
            </Col>
          </Row>

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
                  <Col md={3}>المخزن</Col>
                  <Col md={2}>الفئة</Col>
                  <Col md={2}>فئة السعر</Col>
                  <Col md={2}>الكمية</Col>
                  <Col md={2}>سعر الوحدة</Col>
                  <Col md={2}>خصم ثابت %</Col>
                  <Col md={2}>خصم متغير %</Col>
                  <Col md={2} style={{ textAlign: 'center' }}>الإجمالي</Col>
                  <Col md={2} style={{ textAlign: 'center' }}>النقاط</Col>
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
                          <b>{productName(line.item_id as number)}</b>
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
                        <Col md={3} xs={12}>
                          {/* (030) Each line may be served from a different warehouse. */}
                          <Select size="small" style={{ width: '100%' }}
                            value={lineWarehouse(line) ?? undefined}
                            placeholder="المخزن"
                            onChange={(val) => handleLineChange(line.key, 'warehouse_id', val)}
                            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                        </Col>
                        <Col md={2} xs={12}>
                          {/* The category the item is sold out of — read from the item itself, so
                              it always matches the catalogue rather than being typed per line. */}
                          <Tag color="green" style={{ margin: 0, width: '100%',
                            textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {lineCategory(line) || '—'}
                          </Tag>
                        </Col>
                        <Col md={2} xs={12}>
                          <Select size="small" style={{ width: '100%' }} value={line.tier ?? undefined}
                            onChange={(val) => handleLineChange(line.key, 'tier', val)}>
                            {Object.entries(TIER_LABELS).map(([k, l]) => (
                              <Select.Option key={k} value={k}>{l}</Select.Option>
                            ))}
                          </Select>
                        </Col>
                        <Col md={2} xs={8}>
                          <InputNumber size="small" min={1} style={{ width: '100%' }}
                            max={availableFor(line.item_id, line.unit, lineWarehouse(line)) || undefined}
                            status={line.quantity
                              > availableFor(line.item_id, line.unit, lineWarehouse(line))
                              ? 'error' : undefined}
                            value={line.quantity}
                            onChange={(val) => handleLineChange(line.key, 'quantity', val || 1)} />
                        </Col>
                        <Col md={2} xs={8}>
                          <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
                            value={line.unit_price}
                            onChange={(val) => handleLineChange(line.key, 'unit_price', val || 0)} />
                        </Col>
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
                        <Col md={2} xs={8}>
                          <InputNumber size="small" min={0} max={100} step={0.5} style={{ width: '100%' }}
                            value={line.variable_discount}
                            onChange={(val) => handleLineChange(line.key, 'variable_discount', val || 0)} />
                        </Col>
                        <Col md={2} xs={12} style={{ textAlign: 'center' }}>
                          <b style={{ color: '#6AB42D' }}>{lineTotal(line).toFixed(2)}</b>
                        </Col>
                        <Col md={2} xs={12} style={{ textAlign: 'center' }}>
                          <span style={{ color: '#F5A11D', fontWeight: 600 }}>
                            {linePoints(line).toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
                          </span>
                        </Col>
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

          {/* Totals + payment — a single summary strip. */}
          <div style={{
            background: '#f6faf3', border: '1px solid #e6efe3', borderRadius: 10, padding: 16,
          }}>
            <Row gutter={[16, 8]} align="bottom">
              <Col xs={12} md={5}>
                <Form.Item label="خصم على إجمالي الفاتورة" style={{ marginBottom: 0 }}>
                  <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter="%"
                    value={discountPct} onChange={(val) => setDiscountPct(val || 0)} />
                </Form.Item>
              </Col>
              <Col xs={12} md={5}>
                <Form.Item label="المبلغ المدفوع نقداً" style={{ marginBottom: 0 }}
                  help={selectedCustomerId && customerBalance !== null
                    ? 'يمكن أن يزيد عن قيمة الفاتورة لسداد المديونية القديمة' : undefined}>
                  <InputNumber min={0} style={{ width: '100%' }} addonAfter="ج.م"
                    value={cashAmount} onChange={(val) => setCashAmount(val || 0)} />
                </Form.Item>
              </Col>
              <Col xs={12} md={5}>
                {creditAmount >= 0 ? (
                  <Form.Item label="المتبقي آجل على الفاتورة" style={{ marginBottom: 0 }}>
                    <InputNumber disabled style={{ width: '100%' }} addonAfter="ج.م" value={creditAmount} />
                  </Form.Item>
                ) : (
                  <Form.Item label="سداد من المديونية القديمة" style={{ marginBottom: 0 }}>
                    <InputNumber disabled addonAfter="ج.م" value={Math.abs(creditAmount)}
                      style={{ width: '100%' }} />
                  </Form.Item>
                )}
              </Col>
              <Col xs={12} md={9}>
                <div style={{
                  display: 'flex', gap: 24, justifyContent: 'flex-end', flexWrap: 'wrap',
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#8a8a8a' }}>الإجمالي قبل خصم الفاتورة</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{grossTotal.toFixed(2)} ج.م</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#8a8a8a' }}>إجمالي نقاط الفاتورة</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#F5A11D' }}>
                      {totalPoints.toLocaleString('ar-EG', { maximumFractionDigits: 3 })} نقطة
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: '#8a8a8a' }}>الصافي المطلوب</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#6AB42D' }}>
                      {netTotal.toFixed(2)} ج.م
                    </div>
                  </div>
                </div>
              </Col>
            </Row>

            {selectedCustomerId && customerBalance !== null && (
              <>
                <Divider style={{ margin: '14px 0' }} />
                {/* The customer's whole position after this invoice, read left to right the way
                    the counter reads it: what he owed, what this invoice adds, what he paid,
                    what is left. The paid amount reduces the WHOLE account, not just this
                    invoice — an overpayment settles the old debt rather than sitting as credit. */}
                <Row gutter={[16, 8]} justify="end" style={{ textAlign: 'center' }}>
                  <Col xs={12} md={4}>
                    <div style={{ fontSize: 12, color: '#8a8a8a' }}>حساب سابق</div>
                    <div style={{ fontSize: 16, fontWeight: 600,
                      color: customerBalance > 0.001 ? '#cf1322' : '#6AB42D' }}>
                      {money(customerBalance)} ج.م
                    </div>
                  </Col>
                  <Col xs={12} md={4}>
                    <div style={{ fontSize: 12, color: '#8a8a8a' }}>إجمالي الفاتورة</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{money(netTotal)} ج.م</div>
                  </Col>
                  <Col xs={12} md={4}>
                    <div style={{ fontSize: 12, color: '#8a8a8a' }}>المدفوع</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#6AB42D' }}>
                      {money(cashAmount)} ج.م
                    </div>
                  </Col>
                  <Col xs={12} md={5}>
                    <div style={{ fontSize: 12, color: '#8a8a8a' }}>الباقي</div>
                    <div style={{ fontSize: 22, fontWeight: 800,
                      color: (customerBalance + netTotal - cashAmount) > 0.001 ? '#cf1322' : '#6AB42D' }}>
                      {money(customerBalance + netTotal - cashAmount)} ج.م
                    </div>
                  </Col>
                  <Col xs={24} md={7}>
                    <div style={{ fontSize: 12, color: '#8a8a8a' }}>الكوبونات المصروفة</div>
                    {customerCoupons.length ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 600, color: '#F5A11D' }}>
                          مباع عدد {customerCoupons.length}
                        </div>
                        <div style={{ fontSize: 12, color: '#8a8a8a' }}>
                          من <b>{couponRange.from}</b> إلى <b>{couponRange.to}</b>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 14, color: '#b0b0b0' }}>لا توجد كوبونات</div>
                    )}
                  </Col>
                </Row>
              </>
            )}
          </div>

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
          onPick={handlePartyPicked} onCancel={() => setPartyPickerOpen(false)} />
      </div>
    );
  }

  return (
    <div>
      <Card
        title="الفواتير (سجل فواتير المبيعات)"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>
            تسجيل فاتورة بيع
          </Button>
        }
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
          columns={columns}
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
        title={`تفاصيل الفاتورة ${viewInvoice?.document_number ?? ''}`}
        width={640}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        destroyOnHidden
        footer={invoiceFooter(invoiceDoc(viewInvoice), () => setDetailVisible(false))}
      >
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
    </div>
  );
}

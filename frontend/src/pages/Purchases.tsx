import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, InputNumber, Modal, Result, Row, Select, Space, Table, Tag, Typography, message, DatePicker,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, FileDoneOutlined, EyeOutlined,
  PrinterOutlined, FileAddOutlined, EditOutlined, UndoOutlined, SaveOutlined,
  ArrowLeftOutlined, ArrowRightOutlined, SearchOutlined, BankOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import ItemStockPanel from '../components/ItemStockPanel';
import TotalsLadder from '../components/TotalsLadder';
import InvoiceDocument, { InvoiceDoc, invoiceFooter } from '../components/InvoiceDocument';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import PartyPickerModal, { Party } from '../components/PartyPickerModal';
import ProductPickerModal from '../components/ProductPickerModal';
import { useTableKeyboard } from '../components/keyboard';
import { useLookup, labelMap } from '../hooks/useLookup';
import { TabModal } from '../components/TabModal';

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
}

interface PurchaseItem {
  key: string;
  item_id: number | null;
  /** null = «not typed yet». A box that opens at 1 turns «5» into «15» for anybody who types
   *  without clearing it first, and the document is out by ten with nothing looking wrong. */
  quantity: number | null;
  unit_price: number;
  unit: string | null;
  /** خصم السطر. null = مفيش خصم متفق عليه — مش صفر.
   *  Stored on the line rather than taken off the price, so «اتفقنا على عشرة في المية» can be read
   *  back off the document instead of being inferred from a number that looks odd. */
  discount_pct: number | null;
  /** المخزن اللي السطر ده بيتستلم فيه. null = مخزن المستند.
   *  One purchase can be split across stores — the server has carried this since 030 and the
   *  screen simply never offered it. */
  warehouse_id: number | null;
}

interface ItemUnit { name: string; factor: number; is_base: boolean; }

interface PurchaseRecord {
  id: number;
  document_number: string;
  supplier_id: number;
  supplier_name: string;
  total: string;
  cash_amount: string;
  credit_amount: string;
  created_at: string;
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

const fmtMoney = (v: string | number) =>
  Number(v).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString('ar-EG');
};

export default function Purchases() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [reps, setReps] = useState<{ id: number; full_name: string }[]>([]);
  const [items, setItems] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  // The item the side stock panel is showing — a buyer about to reorder wants to see what the
  // branches are already sitting on before committing to a quantity.
  const [panelItemId, setPanelItemId] = useState<number | null>(null);
  // Same contract as the sales screen: a link elsewhere names a document, this screen opens it.
  const [searchParams, setSearchParams] = useSearchParams();
  const handledIntent = useRef<string | null>(null);

  // Form state
  const [form] = Form.useForm();
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([
    { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, warehouse_id: null },
  ]);
  const [unitsCache, setUnitsCache] = useState<Record<number, ItemUnit[]>>({});

  // Payment splits
  /** خصم الفاتورة المتغيّر. الثابت بيتقرا من الإعدادات على السيرفر زي البيع. */
  const [variableDiscount, setVariableDiscount] = useState<number>(0);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState<number>(0);

  // Document creation result
  const [docResult, setDocResult] = useState<any>(null);

  // Active tab + purchases history list
  /**
   * السجل هو الصفحة، والكتابة بتحل محله — نفس تركيب شاشة البيع بالظبط.
   *
   * It was a two-tab screen: «فاتورة جديدة» and «سجل المشتريات» side by side, so the record was a
   * place you switched to and the blank form was what the screen opened on. The sale is the other
   * way round and it is the right way round: what somebody opens a documents screen for is almost
   * always to look something up, and writing a new one is a deliberate act that starts with a
   * button. Two screens for the same job that disagree about which is the front door cost the
   * person a pause every time they switch.
   */
  const [createVisible, setCreateVisible] = useState(false);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [printOpts, setPrintOpts] = useState<PrintOptions>(loadPrintOptions);
  /** The row whose item box should take the caret next — the purchase's version of the sale's
   *  «pick, type a quantity, Enter, pick again». There is no picker window here, so Enter on a
   *  quantity opens the NEXT LINE and lands on its item box. */
  const [focusRowKey, setFocusRowKey] = useState<string | null>(null);
  // The sale opens as a run of doors — التاريخ, then the party, then the page. The purchase is the
  // same document from the other side, so it opens the same way. No coupons and no points: those
  // are things a SALE hands out, and a purchase has neither to give.
  const [newStep, setNewStep] = useState<null | 'date' | 'party'>(null);
  const [purchaseDate, setPurchaseDate] = useState<Dayjs>(dayjs());
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  // The picker window, so a line is added by typing rather than by hunting a dropdown — the same
  // round trip the sale and the return use.
  const [pickerOpen, setPickerOpen] = useState(false);
  const qtyRefs = useRef<Record<string, any>>({});
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  // antd's Select will not take focus through its inner input reliably — it exposes `focus()` on
  // its own ref, and that is the only handle that works.
  const itemRefs = useRef<Record<string, any>>({});
  const [listLoading, setListLoading] = useState(false);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);

  const purchasesFilter = useListFilter(purchases, {
    search: (p) => [p.document_number, p.supplier_name],
    filters: {
      supplier_id: (p, v) => p.supplier_id === v,
    },
    dateOf: (p) => p.created_at,
  });

  const itemName = useMemo(() => {
    const m = new Map<number, RawMaterial>();
    items.forEach((i) => m.set(i.id, i));
    return (id: number) => m.get(id)?.name ?? `صنف #${id}`;
  }, [items]);

  const fetchPurchases = async () => {
    setListLoading(true);
    try {
      const res = await api.get('/api/v1/purchases');
      setPurchases(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    const docId = searchParams.get('doc');
    if (!docId || handledIntent.current === docId) return;
    const target = purchases.find((p) => p.id === Number(docId));
    if (!target) return;
    handledIntent.current = docId;
    setSearchParams({}, { replace: true });
    openDetail(target);
  }, [searchParams, purchases]);

  /**
   * فتح فاتورة شراء — على نفس الصفحة اللي بتتكتب فيها.
   *
   * It used to open in a modal over the list: a second shape for the same document, so looking at
   * yesterday's invoice landed somewhere that looked nothing like where it was typed.
   */
  const openDetail = async (record: PurchaseRecord) => {
    setCreateVisible(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await api.get(`/api/v1/purchases/${record.id}`);
      setDetail(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setDetailLoading(false);
    }
  };

  // السطر يفتح الفاتورة — بالماوس وبالكيبورد، ونفس الدالة للاتنين.
  const listKb = useTableKeyboard<PurchaseRecord>({
    rows: purchasesFilter.filtered, rowKey: (r) => r.id, onOpen: openDetail,
  });

  // Same document shape as the sales invoice — one look, one print path for both sides.
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
      net: p.total,           // purchases carry no invoice-level discount today
      cash: p.cash_amount,
      credit: p.credit_amount,
      lines: (p.lines || []).map((l) => ({
        name: itemName(l.item_id),
        quantity: l.quantity,
        unit: (l as any).unit,
        unit_price: l.unit_price,
        line_total: l.line_total,
      })),
      extraMeta: [['موقع الاستلام',
        `${p.location_kind === 'warehouse' ? 'مستودع' : p.location_kind} #${p.location_id}`]],
    };
  };

  const loadLookups = async () => {
    setLoading(true);
    try {
      const [supRes, whRes, itemsRes, userRes] = await Promise.all([
        api.get('/api/v1/suppliers'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/items'),  // purchases accept raw materials AND products (resale)
        // Reps are optional on a purchase, so a failure here must not take the screen down with it.
        api.get('/api/v1/users').catch(() => ({ data: [] })),
      ]);
      setSuppliers(supRes.data);
      setReps((userRes.data || []).filter((u: any) => u.role === 'sales_rep'));
      // Filter out central/branch warehouses
      setWarehouses(whRes.data);
      setItems(itemsRes.data.filter((i: any) => i.active !== false));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLookups();
    fetchPurchases();
  }, []);

  // Keep asking until the caret lands in the new line's quantity. One attempt lands in whatever
  // the browser is doing that frame, and antd's ref cannot answer «did it arrive?» — so the box is
  // found by attribute and checked against document.activeElement.
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

  /** The categories the picker groups by — taken from what is actually in the list, so a heading
   *  never appears for a category with nothing under it. */
  const itemCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((p: any) => { if (p.category) set.add(p.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [items]);

  const handleAddItem = (focusIt = false) => {
    const newKey = Date.now().toString();
    setPurchaseItems([
      ...purchaseItems,
      { key: newKey, item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, warehouse_id: null },
    ]);
    if (focusIt) setFocusRowKey(newKey);
  };

  // Keep asking for the caret until it arrives — one attempt lands in whatever the browser is
  // doing that frame. Found by attribute because antd's Select ref cannot answer «did it land?».
  useEffect(() => {
    if (!focusRowKey) return undefined;
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      // Asked through the component's own ref, and CHECKED against the DOM: the wrapper carries
      // the row key, so «did the caret land inside this row's box?» is answerable.
      const inside = document.activeElement?.closest?.(`[data-item-key="${focusRowKey}"]`);
      if (inside) { setFocusRowKey(null); return; }
      itemRefs.current[focusRowKey]?.focus?.();
      if (++frames < 40) raf = requestAnimationFrame(tryFocus);
      else setFocusRowKey(null);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [focusRowKey, purchaseItems.length]);

  const fetchUnits = async (itemId: number) => {
    if (unitsCache[itemId]) return;
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({
        name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
    } catch (err) { console.error(err); }
  };

  const handleRemoveItem = (key: string) => {
    if (purchaseItems.length === 1) {
      message.warning('يجب إضافة صنف واحد على الأقل للفاتورة');
      return;
    }
    setPurchaseItems(purchaseItems.filter((i) => i.key !== key));
  };

  const handleItemChange = (key: string, field: keyof PurchaseItem, value: any) => {
    const updated = purchaseItems.map((item) => {
      if (item.key === key) {
        let updatedItem = { ...item, [field]: value };
        // Auto-fill price if item changes
        if (field === 'item_id') {
          const selected = items.find((i) => i.id === value);
          updatedItem.unit_price = selected?.purchase_price ? parseFloat(selected.purchase_price) : 0;
          updatedItem.unit = null;
          if (value) fetchUnits(value);
        }
        return updatedItem;
      }
      return item;
    });
    setPurchaseItems(updated);
  };

  // نفس ترتيب فاتورة البيع: خصم السطر ينزل على سطره، السطور تتجمع، وخصم الفاتورة ينزل على
  // المجموع مرة واحدة. الشاشة بتحسبه محلياً عشان المشتري يشوف الرقم وهو بيكتب — والسيرفر هو
  // اللي بيحسبه الحسبة النهائية، فلو اختلفوا الفاتورة بتترفض بدل ما تعدّي بالرقم الغلط.
  const lineTotal = (it: PurchaseItem) => {
    const before = Number(it.quantity || 0) * (it.unit_price || 0);
    const disc = it.discount_pct ?? 0;
    return before * (1 - disc / 100);
  };

  const grossTotal = purchaseItems.reduce((sum, it) => sum + lineTotal(it), 0);
  const invoiceTotal = grossTotal * (1 - (variableDiscount || 0) / 100);

  const handleSplitBalance = () => {
    // Automatically fill credit with remaining total
    const cash = parseFloat(cashAmount.toString()) || 0;
    const credit = Math.max(0, invoiceTotal - cash);
    setCreditAmount(parseFloat(credit.toFixed(2)));
  };

  useEffect(() => {
    handleSplitBalance();
  }, [cashAmount, invoiceTotal]);

  /** شريط أدوات المستند — wired to what a purchase actually has. The rest keep their positions
   *  greyed rather than vanishing, so the row does not shift under a practised hand. */
  const purchaseToolbar = (): ToolbarAction[] => {
    const typed = purchaseItems.filter((i) => i.item_id !== null).length;
    return [
      { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
        onClick: () => { form.resetFields(); setPurchaseItems([
          { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, warehouse_id: null }]);
          setPurchaseDate(dayjs()); setDetail(null); setDocResult(null);
          setNewStep('date'); } },
      { key: 'edit', label: 'تعديل', icon: <EditOutlined />, disabled: true },
      { key: 'undo', label: 'تراجع', icon: <UndoOutlined />, disabled: typed === 0,
        onClick: () => setPurchaseItems([
          { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, warehouse_id: null }]) },
      { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
        disabled: typed === 0, onClick: () => form.submit() },
      { key: 'next', label: 'التالى', icon: <ArrowLeftOutlined />, disabled: true },
      { key: 'search', label: 'بحث', shortcut: 'F3', icon: <SearchOutlined />, disabled: true },
      { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />, disabled: true },
      { key: 'delete', label: 'حذف', shortcut: 'F8', icon: <DeleteOutlined />, danger: true,
        disabled: typed === 0,
        onClick: () => setPurchaseItems([
          { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, warehouse_id: null }]) },
      { key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />, disabled: true },
      { key: 'accounts', label: 'حسابات', icon: <BankOutlined />, disabled: true },
      { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />, onClick: () => loadLookups() },
    ];
  };

  const detailReturnColumns = [
    { title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', render: (d: string) => <Tag color="volcano">{d}</Tag> },
    { title: 'القيمة', dataIndex: 'value', key: 'value', render: (v: string) => `${fmtMoney(v)} ج.م` },
    { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', render: (v: string) => fmtDate(v) },
  ];

  /**
   * تعديل فاتورة شراء مرحّلة — مرتجع كامل، وتفتح تاني بمحتواها.
   *
   * Same mechanism the sale uses, and for the same reason: the goods are on the shelf and the
   * ledger is append-only, so there is nothing on the row to overwrite. Through `/reverse` rather
   * than `/returns`, so the returns register does not count the company's own typing mistakes as
   * goods sent back to a supplier.
   */
  const editPosted = async (det: PurchaseDetail) => {
    const ok = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `تعديل ${det.document_number}؟`,
        content: 'الفاتورة المرحّلة ماتتعدلش في مكانها: هيتعمل لها مرتجع كامل وتتفتح من جديد '
          + 'للتعديل، وترحّل تاني لما تحفظ. المخزون والحساب بيرجعوا زي ما كانوا قبلها.',
        okText: 'اعكسها وافتحها', cancelText: 'سيبها زي ما هي',
        okButtonProps: { danger: true },
        onOk: () => resolve(true), onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await api.post(`/api/v1/purchases/${det.id}/reverse`, { reason: 'edit' });
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر عكس الفاتورة');
      return;
    }
    message.success('اتعكست الفاتورة — عدّل ورحّل من جديد');

    // Refill from what the invoice actually held, line by line.
    form.setFieldsValue({
      supplier_id: det.supplier_id,
      warehouse_id: det.location_id ?? undefined,
    });
    setPurchaseDate((det as any).purchase_date
      ? dayjs((det as any).purchase_date) : dayjs());
    setPurchaseItems((det.lines || []).map((l: any, i: number) => ({
      key: `${Date.now()}-${i}`,
      item_id: l.item_id,
      quantity: Number(l.quantity) || null,
      unit_price: Number(l.unit_price) || 0,
      unit: l.unit ?? null,
      // The discount is a fact about the deal, so reopening has to bring it back — rebuilding the
      // line without it would quietly re-price the invoice on save.
      discount_pct: l.discount_pct == null ? null : Number(l.discount_pct),
      warehouse_id: l.line_location_id ?? null,
    })));
    setVariableDiscount(Number((det as any).variable_discount_pct) || 0);
    setCashAmount(Number(det.cash_amount) || 0);
    setCreditAmount(Number(det.credit_amount) || 0);
    setDetail(null);
    fetchPurchases();
  };

  const handleSubmit = async (values: any) => {
    const totalSplit = cashAmount + creditAmount;
    if (Math.abs(totalSplit - invoiceTotal) > 0.01) {
      message.error('عذراً، يجب أن يتطابق مجموع المدفوع النقدي والآجل مع إجمالي الفاتورة!');
      return;
    }

    const validLines = purchaseItems.filter((i) => i.item_id !== null);
    if (validLines.length === 0) {
      message.error('يرجى إضافة صنف واحد صالح على الأقل!');
      return;
    }
    // The quantity box starts empty on purpose, so «forgot to type it» is a real state and has to
    // be caught rather than posted as whatever the default happened to be.
    const noQty = validLines.find((l) => !Number(l.quantity));
    if (noQty) {
      const name = items.find((i) => i.id === noQty.item_id)?.name ?? 'الصنف';
      message.error(`«${name}»: اكتب الكمية.`);
      return;
    }

    setSubmitLoading(true);
    try {
      const payload = {
        supplier_id: values.supplier_id,
        location: {
          location_kind: 'warehouse',
          location_id: values.warehouse_id,
        },
        cash_amount: cashAmount,
        credit_amount: creditAmount,
        variable_discount_pct: variableDiscount || 0,
        rep_id: values.rep_id ?? null,
        external_document_number: values.external_document_number || null,
        notes: values.notes || null,
        statement1: values.statement1 || null,
        statement2: values.statement2 || null,
        statement3: values.statement3 || null,
        lines: validLines.map((l) => ({
          item_id: l.item_id,
          quantity: Number(l.quantity || 0),
          unit_price: l.unit_price,
          unit: l.unit,
          discount_pct: l.discount_pct,
          warehouse_id: l.warehouse_id,
        })),
        // The day the goods were received, taken from the first door — not the day this row was
        // typed, which is what `created_at` would have recorded.
        purchase_date: purchaseDate.format('YYYY-MM-DD'),
      };

      const res = await api.post('/api/v1/purchases', payload);
      setDocResult(res.data);
      message.success('تم تسجيل فاتورة الشراء بنجاح');
      form.resetFields();
      setPurchaseItems([{ key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
        discount_pct: null, warehouse_id: null }]);
      setCashAmount(0);
      setCreditAmount(0);
      fetchPurchases();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitLoading(false);
    }
  };

  /** الباب التاني: المورد. Mid-document this only swaps the party; during the opening run it is
   *  the second door and hands over to the page — the same order the sale opens in. */
  const handlePartyPicked = (picked: Party) => {
    setPartyPickerOpen(false);
    // الباب الأخير بيسلّم للصفحة نفسها — التاريخ، وبعده المورد، وبعده الفاتورة بتفتح.
    if (newStep === 'party') { setNewStep(null); setCreateVisible(true); }
    form.setFieldsValue({ supplier_id: picked.id });
    // A supplier created inside the picker is not in the loaded list yet, so the field would show
    // a bare id until the next reload.
    setSuppliers((prev) => (prev.some((x) => x.id === picked.id)
      ? prev : [...prev, { id: picked.id, name: picked.name, code: '' } as any]));
  };

  /** A picked product becomes a line, and the caret lands in its quantity — so the next thing
   *  typed is the number, not a hunt for the box. Same loop as the sale and the return. */
  /** الصنف اللي على الفاتورة بالفعل بتزيد كميته بدل ما يتكرّر سطر — زي شاشة البيع بالظبط. */
  const addProductById = async (itemId: number) => {
    if (!itemId) return;
    const existing = purchaseItems.find((l) => l.item_id === itemId);
    if (existing) {
      setPurchaseItems((prev) => prev.map((l) => (l.key === existing.key
        ? { ...l, quantity: Number(l.quantity || 0) + 1 } : l)));
      // العين تتبع الرقم اللي اتحرك، مش سطر جديد.
      setPanelItemId(itemId);
      setFocusLineKey(existing.key);
      return;
    }
    // Reuse a blank row rather than leaving an empty line above the real one.
    const blank = purchaseItems.find((l) => l.item_id === null);
    const key = blank ? blank.key : `${Date.now()}-${itemId}`;
    if (!blank) {
      setPurchaseItems((prev) => [...prev,
        { key, item_id: null, quantity: null, unit_price: 0, unit: null,
          discount_pct: null, warehouse_id: null }]);
    }
    setPanelItemId(itemId);
    // Through the same handler the dropdown uses, so the purchase price and the unit list are
    // filled in one place rather than two that can drift.
    setTimeout(() => handleItemChange(key, 'item_id', itemId), 0);
    setFocusLineKey(key);
  };

  const handleProductPicked = (item: any) => {
    setPickerOpen(false);
    addProductById(item.id);
  };

  /** سطور الفاتورة متجمّعة بالفئة — نفس عرض شاشة البيع. */
  const linesByCategory = React.useMemo(() => {
    const groups: { category: string | null; items: PurchaseItem[] }[] = [];
    purchaseItems.forEach((l) => {
      const category = (items.find((i: any) => i.id === l.item_id) as any)?.category ?? null;
      let g = groups.find((x) => x.category === category);
      if (!g) { g = { category, items: [] }; groups.push(g); }
      g.items.push(l);
    });
    return groups;
  }, [purchaseItems, items]);



  /** رجوع للسجل — والشاشة بترجع فاضية عشان الفاتورة الجاية تبدأ من نضيف. */
  const closeCreate = () => {
    setCreateVisible(false);
    setDetail(null);
    setDocResult(null);
    setNewStep(null);
  };

  const createContent = docResult ? (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <Card style={{ width: 600 }}>
        <Result
          status="success"
          title="تم تسجيل فاتورة الشراء بنجاح"
          subTitle={`رقم مستند الفاتورة: ${docResult.document_number} | رقم قيد اليومية: ${docResult.ledger_entry_id || 'لا يوجد'}`}
          extra={[
            // F2 على «إضافة صنف» مش هنا — زي شاشة البيع بالظبط. الزرار ده بيتضغط مرة
            // واحدة بعد الحفظ؛ زرار إضافة الصنف بيتضغط خمستاشر مرة في الفاتورة الواحدة،
            // وهو اللي يستاهل المفتاح.
            <Button type="primary" key="new" onClick={() => setDocResult(null)}>
              تسجيل فاتورة جديدة
            </Button>,
          ]}
        />
      </Card>
    </div>
  ) : detail ? (
    /* فاتورة مرحّلة — نفس الصفحة، بس مقفولة، ومنها التعديل.
       A posted purchase cannot be altered in place: the goods are on the shelf and the ledger is
       append-only. «تعديل» reverses it in full and reopens the form on what it held. */
    <Card
      title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setDetail(null)}>رجوع</Button>
          <span>{`فاتورة شراء ${detail.document_number}`}</span>
        </Space>
      )}
      extra={<PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />}
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="الفاتورة دي اتّرحّلت خلاص"
        description="البضاعة دخلت المخزن والقيد اتكتب، فالفاتورة ماتتغيّرش في مكانها. «تعديل الفاتورة» بيعملها مرتجع كامل ويفتحها تاني بمحتواها عشان تصحّح وترحّل من جديد — والتلاتة بيفضلوا في السجل."
      />
      <InvoiceDocument doc={purchaseDoc(detail)!} />

      <Divider orientation="right">المرتجعات</Divider>
      <Table
        dataSource={detail.returns} columns={detailReturnColumns} rowKey="id"
        pagination={false} size="small"
        locale={{ emptyText: 'لا توجد مرتجعات على هذه الفاتورة' }}
      />

      <div style={{
        marginTop: 16, padding: 16, borderRadius: 10,
        background: '#f6faf3', border: '1px solid #e6efe3',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        flexWrap: 'wrap',
      }}>
        <Button type="primary" size="large" icon={<EditOutlined />}
          onClick={() => editPosted(detail)}>
          تعديل الفاتورة
        </Button>
        <Button size="large" onClick={() => setDetail(null)}>إغلاق</Button>
      </div>
    </Card>
  ) : (
    <Card title={(
      <Space>
        <Button type="text" icon={<ArrowRightOutlined />} onClick={closeCreate}>رجوع</Button>
        <Typography.Text strong style={{ fontSize: 16 }}>فاتورة شراء جديدة</Typography.Text>
        {/* ظاهر وقابل للتغيير: اللي بيكتب لازم يشوف اليوم اللي بيكتب فيه، خصوصاً لما
            مايكونش النهاردة. */}
        <DatePicker
          value={purchaseDate} allowClear={false} format="YYYY-MM-DD"
          onChange={(v: Dayjs | null) => setPurchaseDate(v || dayjs())}
        />
      </Space>
    )}
      extra={<PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />}>
      {/* The same strip of verbs the sale carries, in the same places — a purchase is the same
          job from the other side, and a hand that has learned one row should not have to learn
          a second. */}
      <DocumentToolbar actions={purchaseToolbar()} />
      <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="supplier_id"
                label="المورد"
                rules={[{ required: true, message: 'يرجى اختيار المورد!' }]}
              >
                {/* The same window the second door opens — searchable, with inline create.
                    Changing the supplier mid-document goes through the same place it was first
                    chosen, so there is one way to answer «مين». */}
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  placeholder="اضغط لاختيار المورد"
                  onClick={() => setPartyPickerOpen(true)}
                  options={suppliers.map((sp) => ({
                    value: sp.id, label: sp.code ? `${sp.name} (${sp.code})` : sp.name }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="warehouse_id"
                label="مستودع الاستلام"
                rules={[{ required: true, message: 'يرجى اختيار مستودع الاستلام!' }]}
              >
                <Select placeholder="اختر المستودع لاستلام المواد الخام">
                  {warehouses.map((w) => (
                    <Select.Option key={w.id} value={w.id}>
                      {w.name} ({w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* حقول المستند — الثلاثة دول السيرفر مستنيهم من 030 والشاشة مكانتش بتبعتهم. */}
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="rep_id" label="المندوب" style={{ marginBottom: 8 }}>
                <Select allowClear showSearch optionFilterProp="label"
                  placeholder="اختياري — مين استلم الشحنة"
                  options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="external_document_number" label="رقم المستند (الورقي)"
                style={{ marginBottom: 8 }}>
                <Input placeholder="اختياري — رقم فاتورة المورد الورقية" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="notes" label="ملاحظات" style={{ marginBottom: 8 }}>
                <Input placeholder="اختياري" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            {([1, 2, 3] as const).map((n) => (
              <Col xs={24} md={8} key={n}>
                <Form.Item name={`statement${n}`} label={`بيان ${n}`}
                  style={{ marginBottom: 8 }}>
                  <Input placeholder="اختياري" />
                </Form.Item>
              </Col>
            ))}
          </Row>

          <Divider orientation="right">أصناف الفاتورة</Divider>

          <Row gutter={16}>
            <Col xs={24} lg={18}>
              {/* الزرار فوق السطور، كبير، وF2 عليه — نفس شاشة البيع.
                  It used to be a small dashed button UNDERNEATH the table, which on an invoice of
                  fifteen lines is a scroll to find and a click to choose, twice per line, all day.
                  Above the lines it is always in the same place. */}
              <Button data-shortcut="F2"
                type="primary" size="large" icon={<PlusOutlined />} block
                style={{ marginBottom: 14, height: 46 }}
                onClick={() => setPickerOpen(true)}
              >
                إضافة صنف للفاتورة
              </Button>

              {purchaseItems.length === 0 ? (
                <Empty description="اختر الفئة ثم الأصناف لإضافتها للفاتورة"
                  style={{ margin: '12px 0' }} />
              ) : (
                linesByCategory.map((group) => (
                  <div key={group.category ?? '__none__'}
                    style={{ border: '1px solid #e6efe3', borderRadius: 10, overflow: 'hidden',
                             marginBottom: 12 }}>
                    <div style={{ background: '#f2f9f3', padding: '8px 12px', display: 'flex',
                                  alignItems: 'center', gap: 8 }}>
                      <Tag color="green" style={{ fontWeight: 700, margin: 0 }}>
                        {group.category
                          ? (categoryLabels[group.category] || group.category)
                          : 'بدون فئة'}
                      </Tag>
                      <span style={{ color: '#8a8a8a', fontSize: 12 }}>
                        {group.items.length} صنف
                      </span>
                    </div>

                    {group.items.map((line) => (
                      <div key={line.key}
                        style={{ padding: '4px 12px 6px', borderTop: '1px solid #f0f5ee' }}>
                        <Row gutter={8} align="middle">
                          <Col md={5} xs={24}>
                            {/* الضغط على الاسم بيوجّه لوحة المخزون للصنف ده. */}
                            <b style={{ cursor: 'pointer' }}
                              onClick={() => setPanelItemId(line.item_id)}>
                              {line.item_id ? itemName(line.item_id) : 'اختر الصنف'}
                            </b>
                          </Col>
                          <Col md={3} xs={12}>
                            <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
                              value={line.unit ?? '__base__'}
                              onChange={(val) => handleItemChange(
                                line.key, 'unit', val === '__base__' ? null : val)}>
                              {(unitsCache[line.item_id || 0] || []).map((u) => (
                                <Select.Option key={u.name}
                                  value={u.is_base ? '__base__' : u.name}>
                                  {u.name}{u.is_base ? '' : ` (×${u.factor})`}
                                </Select.Option>
                              ))}
                            </Select>
                          </Col>
                          <Col md={3} xs={8}>
                            {/* فاضية معناها «مااتكتبتش». صندوق بيفتح على ١ بيحوّل «٥» لـ«١٥»
                                لأي حد يكتب من غير ما يمسح الأول. */}
                            <InputNumber size="small" style={{ width: '100%' }} min={0.001}
                              step={1} placeholder="الكمية"
                              value={line.quantity ?? undefined}
                              data-qty-key={line.key}
                              data-grid-col="qty" keyboard={false}
                              onChange={(val) => handleItemChange(line.key, 'quantity', val ?? null)}
                              // Enter معناها «السطر ده خلص» — البوباب بيفتح للصنف اللي بعده،
                              // فالفاتورة كلها: اختار، اكتب كمية، Enter، اختار… من غير ما
                              // الإيد تسيب الكيبورد.
                              onPressEnter={(e) => {
                                e.preventDefault();
                                if (Number(line.quantity || 0) > 0) setPickerOpen(true);
                              }} />
                          </Col>
                          <Col md={4} xs={8}>
                            <InputNumber size="small" min={0} step={0.01}
                              style={{ width: '100%' }} placeholder="سعر الوحدة"
                              value={line.unit_price}
                              onChange={(val) => handleItemChange(
                                line.key, 'unit_price', val || 0)} />
                          </Col>
                          <Col md={3} xs={8}>
                            {/* فاضي = مفيش خصم متفق عليه، مش صفر. */}
                            <InputNumber size="small" min={0} max={99.99} step={0.5}
                              style={{ width: '100%' }} placeholder="خصم %"
                              value={line.discount_pct ?? undefined}
                              onChange={(val) => handleItemChange(
                                line.key, 'discount_pct', val ?? null)} />
                          </Col>
                          <Col md={4} xs={12}>
                            {/* فاضي = مخزن المستند. الفاتورة الواحدة ممكن تتوزّع على أكتر
                                من مخزن. */}
                            <Select size="small" style={{ width: '100%' }} allowClear
                              placeholder="مخزن المستند"
                              value={line.warehouse_id ?? undefined}
                              onChange={(val) => handleItemChange(
                                line.key, 'warehouse_id', val ?? null)}
                              options={warehouses.map((w: any) => ({
                                value: w.id, label: w.name }))} />
                          </Col>
                          <Col md={2} xs={12} style={{ textAlign: 'end' }}>
                            <Button size="small" danger type="text" icon={<DeleteOutlined />}
                              onClick={() => setPurchaseItems(
                                (prev) => prev.filter((x) => x.key !== line.key))} />
                          </Col>
                        </Row>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </Col>
            <Col xs={24} lg={6}>
              {/* Same panel the sales invoice uses — the question is identical on both sides. */}
              <ItemStockPanel itemId={panelItemId} products={items}
                onPickItem={(id) => setPanelItemId(id)} />
            </Col>
          </Row>

          <Divider />

          {/* Same ladder as the sales screens — the supplier side of the identical question:
              what the goods cost, what we paid now, what we still owe him. */}
          <TotalsLadder
            tone="sale"
            inputs={(
              <>
                <Form.Item label="خصم على الفاتورة %" style={{ marginBottom: 12 }}
                  help="بينزل على مجموع السطور بعد خصم كل سطر — زي فاتورة البيع">
                  <InputNumber style={{ width: '100%' }} min={0} max={99.99} step={0.5}
                    addonAfter="%" value={variableDiscount}
                    onChange={(val) => setVariableDiscount(val || 0)} />
                </Form.Item>
                <Form.Item label="المبلغ المدفوع نقداً" style={{ marginBottom: 0 }}
                  help="الباقي بيتسجّل آجل على حساب المورد">
                  <InputNumber style={{ width: '100%' }} min={0} addonAfter="ج.م"
                    value={cashAmount} onChange={(val) => setCashAmount(val || 0)} />
                </Form.Item>
              </>
            )}
            rows={[
              // The gross only earns a line when a discount actually moved it — otherwise it says
              // the same number twice and the reader has to work out that nothing happened.
              { label: 'إجمالي السطور', value: grossTotal.toFixed(2),
                show: variableDiscount > 0.001 },
              { label: `خصم الفاتورة ${variableDiscount}%`,
                value: `− ${(grossTotal - invoiceTotal).toFixed(2)}`,
                color: '#cf1322', show: variableDiscount > 0.001 },
              { label: 'إجمالي أصناف الفاتورة', value: invoiceTotal.toFixed(2),
                strong: true, color: '#6AB42D' },
              { label: 'المدفوع نقداً', value: `− ${cashAmount.toFixed(2)}`,
                color: '#6AB42D', show: cashAmount > 0.001 },
              { label: 'المتبقي آجل على المورد', value: creditAmount.toFixed(2),
                big: true, rule: true,
                color: creditAmount > 0.001 ? '#cf1322' : '#6AB42D' },
            ]}
          />

          <Form.Item style={{ marginTop: 24, textAlign: 'left' }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<FileDoneOutlined />}
              size="large"
              loading={submitLoading}
            >
              تسجيل وترحيل فاتورة الشراء
            </Button>
          </Form.Item>
      </Form>
    </Card>
  );

  const listColumns = [
    {
      title: 'رقم المستند',
      dataIndex: 'document_number',
      key: 'document_number',
      render: (doc: string) => <Tag color="blue">{doc}</Tag>,
    },
    {
      title: 'المورد',
      dataIndex: 'supplier_name',
      key: 'supplier_name',
      render: (name: string, record: PurchaseRecord) => (
        <a onClick={(e) => { e.stopPropagation(); navigate(`/suppliers/${record.supplier_id}`); }}>
          {name || `مورد #${record.supplier_id}`}
        </a>
      ),
    },
    {
      title: 'الإجمالي',
      dataIndex: 'total',
      key: 'total',
      render: (val: string) => <strong style={{ color: '#6AB42D' }}>{fmtMoney(val)} ج.م</strong>,
    },
    {
      title: 'نقدي',
      dataIndex: 'cash_amount',
      key: 'cash_amount',
      render: (val: string) => `${fmtMoney(val)} ج.م`,
    },
    {
      title: 'آجل',
      dataIndex: 'credit_amount',
      key: 'credit_amount',
      render: (val: string) => `${fmtMoney(val)} ج.م`,
    },
    {
      title: 'التاريخ',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => fmtDate(val),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: PurchaseRecord) => (
        <Space size="middle">
          <Button type="dashed" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
            عرض
          </Button>
          {/* Opens the invoice (loading its lines) so it can be printed from there. */}
          <Button type="link" icon={<PrinterOutlined />} onClick={() => openDetail(record)}>
            طباعة
          </Button>
        </Space>
      ),
    },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const listCols = useTableColumns('purchase-list', listColumns);

  const listContent = (
    <Card
      title="المشتريات (سجل فواتير الشراء)"
      extra={(
        <Space>
          {listCols.control}
          <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
          {/* من غير F2 — المفتاح بتاع «إضافة صنف» جوّه الفاتورة، زي شاشة البيع بالظبط.
              المحرك بيقرا الملف كله، فزرارين بيدّعوا نفس المفتاح مابيبقاش واضح مين هيترد عليه. */}
          <Button type="primary" icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setPurchaseItems([{ key: '1', item_id: null, quantity: null, unit_price: 0,
                unit: null, discount_pct: null, warehouse_id: null }]);
              setPurchaseDate(dayjs());
              setDetail(null);
              setDocResult(null);
              setNewStep('date');
            }}>
            تسجيل فاتورة شراء
          </Button>
        </Space>
      )}
    >
      <ListToolbar
        searchPlaceholder="بحث برقم المستند أو اسم المورد"
        query={purchasesFilter.query} onQueryChange={purchasesFilter.setQuery}
        values={purchasesFilter.values} onValueChange={purchasesFilter.setValue}
        showDateRange range={purchasesFilter.range} onRangeChange={purchasesFilter.setRange}
        onReset={purchasesFilter.reset}
        total={purchases.length} shown={purchasesFilter.filtered.length}
        filters={[
          { key: 'supplier_id', placeholder: 'المورد',
            options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
        ]}
      />
      <Table
        {...listKb.tableProps}
        dataSource={purchasesFilter.filtered}
        columns={listCols.columns}
        rowKey="id"
        loading={listLoading}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
        locale={{ emptyText: 'لا يوجد فواتير شراء بعد' }}
      />
    </Card>
  );

  const detailLineColumns = [
    { title: 'الصنف', key: 'item', render: (_: any, r: PurchaseDetailLine) => itemName(r.item_id) },
    { title: 'الوحدة', dataIndex: 'unit', key: 'unit', render: (u: string | null) => u || 'الأساسية' },
    { title: 'الكمية', dataIndex: 'quantity', key: 'quantity', render: (q: string) => Number(q) },
    { title: 'سعر الوحدة', dataIndex: 'unit_price', key: 'unit_price', render: (v: string) => `${fmtMoney(v)} ج.م` },
    { title: 'الإجمالي', dataIndex: 'line_total', key: 'line_total', render: (v: string) => `${fmtMoney(v)} ج.م` },
  ];


  /** The opening run — التاريخ then المورد — and the product window. No coupons and no points:
   *  those are what a SALE hands out, and a purchase has neither to give. Everything else is the
   *  sale's flow, because a person who has learned one of these screens has learned both. */
  const doors = (
    <>
      <PartyPickerModal
        open={partyPickerOpen || newStep === 'party'} kind="supplier"
        onPick={handlePartyPicked}
        onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }} />

      <ProductPickerModal
        open={pickerOpen}
        title="اختر الصنف المشترى"
        categories={itemCategories}
        categoryLabels={categoryLabels}
        products={items as any}
        activeCategory={activeCategory}
        onCategoryChange={(c) => { setActiveCategory(c); setPanelItemId(null); }}
        onCancel={() => setPickerOpen(false)}
        onPick={(id) => {
          setPickerOpen(false);
          addProductById(id);
        }}
        onPickMany={async (ids) => {
          setPickerOpen(false);
          // بالترتيب: كل إضافة بتقرا السطور اللي بتتضاف عليها، فلو اتنفّذوا مع بعض كل واحد
          // فيهم هيشوف القايمة زي ما كانت قبل أي إضافة.
          for (const id of ids) await addProductById(id);
        }} />

      <TabModal
        open={newStep === 'date'}
        title="تاريخ فاتورة الشراء"
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
            value={purchaseDate} onChange={(v: Dayjs | null) => setPurchaseDate(v || dayjs())}
            format="YYYY-MM-DD"
          />
        </div>
        <div style={{ marginTop: 10, color: '#8a8a8a', fontSize: 13 }}>
          ده يوم استلام البضاعة، مش يوم ما اتكتبت الفاتورة.
        </div>
      </TabModal>
    </>
  );

  if (createVisible) {
    return <div>{doors}{createContent}</div>;
  }

  return <div>{doors}{listContent}</div>;
}

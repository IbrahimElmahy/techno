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
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice }
  from '../components/InvoiceDocument';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
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
  /**
   * فاتورة ولا مرتجع.
   *
   * السجل بقى لكل عمليات الشرا. المرتجع مستند أنحف من الفاتورة — مفيهوش خصم ولا ضرايب ولا
   * سداد نقدي: البضاعة بترجع للمورد واللي عليه بينقص بقيمتها. فأعمدة الفاتورة اللي مالهاش
   * معنى عنده بتفضل **فاضية** مش أصفار: صفر معناه «اتحسبت وطلعت صفر»، والفراغ معناه «السؤال
   * ده مالوش لازمة على المستند ده».
   */
  kind: 'purchase' | 'return';
  id: number;
  document_number: string;
  supplier_id: number;
  supplier_name: string;
  total: string;
  cash_amount: string | null;
  credit_amount: string | null;
  created_at: string;
  // الأعمدة اللي السجل بيعرضها. أربعة منهم (`gross` و`combined_pct` و`net` و`tax_amount`) كانوا
  // في عقد السيرفر من زمان وبيرجعوا أصفار — الـendpoint مكانش بيمرّرهم.
  purchase_date: string | null;
  external_document_number: string | null;
  notes: string | null;
  branch_id: number | null;
  branch_name: string | null;
  expense_account_id: number | null;
  expense_account_name: string | null;
  /** المستند اللي المرتجع طالع منه — بيفتحه لما السطر يتضغط. */
  parent_id?: number;
  parent_document_number?: string | null;
  gross: string | null;
  discount_amount: string | null;
  combined_pct: string | null;
  tax_amount: string | null;
  tax_pct: string | null;
  net: string | null;
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

  /**
   * آخر مخزن اتختار على سطر — بيتورّث للسطور اللي بعده.
   *
   * The document used to carry its own «مستودع الاستلام» at the top and every line could override
   * it, which meant answering the same question in two places for the ordinary shipment that all
   * goes to one store. The top field is gone: the FIRST line's warehouse is the document's, and
   * every line after it starts on the same one — so the common case is one choice for the whole
   * invoice, and a line that genuinely landed somewhere else is still one dropdown away.
   *
   * Changing it applies to the lines added AFTER, not to the ones already typed. Rewriting a line
   * somebody has already entered because a later line went elsewhere is the kind of silent change
   * that gets found out at the stocktake.
   */
  const [stickyWarehouseId, setStickyWarehouseId] = useState<number | null>(null);
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
  /** السطر اللي آخر صنف نزل فيه — بيتكتب جوّا تحديث الحالة عشان يعرف مين السطر فعلاً. */
  const landedRef = useRef<string>('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  // antd's Select will not take focus through its inner input reliably — it exposes `focus()` on
  // its own ref, and that is the only handle that works.
  const itemRefs = useRef<Record<string, any>>({});
  const [listLoading, setListLoading] = useState(false);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  /** الفاتورة اللي معروضة في بوباب الطباعة — معاينة، مش صفحة. */
  const [preview, setPreview] = useState<PurchaseDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  /**
   * فلاتر السجل — نفس اللي في الشاشة اللي العميل شغّال عليها.
   *
   * التاريخ · مستند رقم · الفاتورة رقم · الفرع · المورد · ملاحظات. كان فيه خانة بحث واحدة
   * والمورد وبس، فـ«هات الفاتورة اللي رقمها عند المورد كذا» مكانش ليها طريق غير التقليب.
   *
   * الفلترة بتحصل في المتصفح على قايمة محمّلة — يعني بتتحرّك مع كل حرف، من غير زرار «عرض» ولا
   * رحلة للسيرفر. ده اللي طلبه: الفلتر يتغيّر والبيانات تتعرض على طول.
   *
   * `dateOf` بقى `purchase_date` — يوم ما البضاعة وصلت — و`created_at` بيقع عليه بس لما تكون
   * الفاتورة قديمة ومالهاش تاريخ مسجّل. فلتر بيقيس يوم الكتابة بيرمي فاتورة أول الشهر اتسجّلت
   * آخره، واللي بيدوّر عليها بيفتكرها مش موجودة.
   */
  // الفروع — فلتر في السجل وحقل في الفاتورة. بتتحمّل مرة مع باقي القوايم.
  const [branches, setBranches] = useState<any[]>([]);
  /** حسابات الترحيل — «الحساب» في ترويسة الفاتورة، وهو اللي القيد بينزل عليه. */
  const [postAccounts, setPostAccounts] = useState<any[]>([]);
  /** المورد المختار بتفاصيله — العنوان والتليفون والرصيد بيتعرضوا في الترويسة. */
  const [party, setParty] = useState<Party | null>(null);
  /**
   * فرع الترويسة — بيضيّق مخازن السطور، مابيتحفظش على المستند.
   *
   * السيرفر مافيهوش عمود فرع على فاتورة الشرا: الفرع بيتعرف من المخزن اللي البضاعة نزلت فيه.
   * فبدل ما تبقى خانة بتتكتب وتروح في اللا حاجة، بتعمل الحاجة الوحيدة اللي ليها معنى — تقصر
   * قايمة المخازن على بتاعة الفرع ده، فاللي شغّال على فرع مابيشوفش مخازن غيره.
   */
  const [headerBranchId, setHeaderBranchId] = useState<number | undefined>();
  const lineWarehouses = useMemo(
    () => (headerBranchId
      ? warehouses.filter((w: any) => w.branch_id === headerBranchId)
      : warehouses),
    [warehouses, headerBranchId],
  );
  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(console.error);
    api.get('/api/v1/accounts', { params: { postable_only: true, active: true } })
      .then((r) => setPostAccounts(r.data || [])).catch(console.error);
  }, []);

  const purchasesFilter = useListFilter(purchases, {
    search: (p) => [p.document_number, p.supplier_name, p.external_document_number, p.notes],
    filters: {
      kind: (p, v) => p.kind === v,
      supplier_id: (p, v) => p.supplier_id === v,
      branch_id: (p, v) => p.branch_id === v,
      document_number: (p, v) => (p.document_number || '').includes(String(v)),
      external_document_number: (p, v) => (p.external_document_number || '')
        .toLowerCase().includes(String(v).toLowerCase()),
      notes: (p, v) => (p.notes || '').toLowerCase().includes(String(v).toLowerCase()),
    },
    dateOf: (p) => p.purchase_date || p.created_at,
  });

  const itemName = useMemo(() => {
    const m = new Map<number, RawMaterial>();
    items.forEach((i) => m.set(i.id, i));
    return (id: number) => m.get(id)?.name ?? `صنف #${id}`;
  }, [items]);

  /**
   * السجل بيقرا **كل عمليات الشرا** — الفواتير والمرتجعات في قايمة واحدة.
   *
   * كانوا شاشتين. و«المورد ده اتعامل معاه إيه الشهر ده» سؤال بيتجاوب من الاتنين مع بعض: فاتورة
   * بعشرة آلاف ومرتجع بألفين معناهم تمنية، واللي شايف الفاتورة بس شايف رقم مش صح.
   *
   * المرتجع بيتسطّح لنفس شكل الصف: أعمدة الفاتورة اللي مالهاش معنى عنده بتفضل `null` — فاضية
   * في العرض — بدل أصفار. صفر معناه «اتحسبت وطلعت صفر»؛ الفراغ معناه «السؤال ده مالوش لازمة
   * على المستند ده»، وده الفرق اللي بيمنع حد يجمع عمود ويطلعله رقم مالوش أصل.
   */
  const fetchPurchases = async () => {
    setListLoading(true);
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
        // قيمة البضاعة الراجعة. بتنزل في «الاجمالي» عشان تتجمع مع الفواتير في نفس العمود.
        total: r.value,
        external_document_number: null,
        branch_id: null, branch_name: null,
        expense_account_id: null, expense_account_name: null,
        gross: null, discount_amount: null, combined_pct: null,
        tax_amount: null, tax_pct: null, net: null,
        cash_amount: null, credit_amount: null,
        parent_id: r.purchase_invoice_id,
        parent_document_number: r.purchase_document_number ?? null,
      }));
      setPurchases([...invoices, ...returns]);
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
  /** بيجيب المستند من السيرفر — الطريق الوحيد لتفاصيل فاتورة. */
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
    // نفس وجهة زرار «عرض» — الكيبورد والماوس مايوصلوش لمكانين مختلفين من نفس السطر.
    // والمفتاح شايل النوع: فاتورة ومرتجع ممكن يكون ليهم نفس الـid.
    // `openRow` معرّفة تحت — بتتنادى داخل دالة عشان الترتيب مايفرقش.
    rows: purchasesFilter.filtered, rowKey: (r) => `${r.kind}-${r.id}`,
    onOpen: (r) => openRow(r),
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
      // المستند المطبوع دايماً فاتورة — الأعمدة اللي بتفضل فاضية على المرتجع بتتقرا صفر هنا.
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
        `${p.location_kind === 'warehouse' ? 'مستودع' : p.location_kind} #${p.location_id}`]],
    };
  };

  const loadLookups = async () => {
    setLoading(true);
    try {
      // مفيش استعلام مستخدمين — كان بس عشان قايمة المناديب، والمندوب اتشال من الشرا.
      const [supRes, whRes, itemsRes] = await Promise.all([
        api.get('/api/v1/suppliers'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/items'),  // purchases accept raw materials AND products (resale)
      ]);
      setSuppliers(supRes.data);
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

  // العين تروح للسطر اللي الصنف نزل فيه — بعد ما السطور تستقر، لأن مين هو السطر ده مايتقررش غير
  // جوّا التحديث نفسه (سطر فاضي اتعبّى؟ صنف مكرر زادت كميته؟ سطر جديد اتضاف؟).
  useEffect(() => {
    if (!landedRef.current) return;
    setFocusLineKey(landedRef.current);
    landedRef.current = '';
  }, [purchaseItems]);

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
    // من `prev` زي الباقي — الحذف اللي بيبني من نسخة قديمة بيرمي أي سطر اتضاف بعد آخر رندر.
    setPurchaseItems((prev) => {
      if (prev.length === 1) {
        message.warning('يجب إضافة صنف واحد على الأقل للفاتورة');
        return prev;
      }
      return prev.filter((i) => i.key !== key);
    });
  };

  // بتحدّث من الحالة الحالية (`prev`) مش من النسخة اللي الدالة اتقفلت عليها.
  //
  // القراءة من `purchaseItems` هنا كانت بتكتب فوق أي سطر اتضاف بعد آخر رندر وتشيله — وده كان
  // بيخلّي الفاتورة مش بتقبل أكتر من صنف. تفاصيل السيناريو فوق `addProductById`.
  const handleItemChange = (key: string, field: keyof PurchaseItem, value: any) => {
    setPurchaseItems((prev) => prev.map((item) => {
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
    }));
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
    // من غير تأكيد — اتشال بطلب صاحب النظام بعد ما شافه.
    //
    // اللي بيحصل لسه هو هو: الفاتورة المرحّلة ماتتعدلش في مكانها، فبيتعمل لها عكس كامل
    // وتتفتح من جديد، والمخزون والحساب بيرجعوا زي ما كانوا. الفرق إن ده بيحصل على طول.
    // وحمايات السيرفر كلها مكانها: الفترة المقفولة بترفض، والعكس بيتسجّل كقيد مضاد مش مسح.
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
      warehouse_id: l.line_location_id ?? det.location_id ?? null,
    })));
    // الفاتورة اللي بتتفتح للتعديل بتيجي بمخزنها — فالسطر الجاي يبدأ عليه مش على فاضي.
    setStickyWarehouseId(
      ((det.lines || [])[0] as any)?.line_location_id ?? (det as any).location_id ?? null);
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
    // مخزن المستند بقى مخزن أول سطر، فسطر من غير مخزن مالوش مكان ينزل فيه. الرفض بيسمّي
    // الصنف عشان اللي بيقرا يلاقيه في فاتورة فيها خمستاشر سطر.
    const homeless = validLines.find((l) => l.warehouse_id == null);
    if (homeless) {
      message.error(`«${itemName(homeless.item_id as number)}»: اختار مخزن الاستلام.`);
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
        // مخزن المستند بقى مخزن أول سطر. السيرفر لسه محتاج مكان على المستند (٠٣٠)، والسطر
        // اللي نزل مخزن تاني شايل مخزنه بنفسه — فالاتنين متسقين من غير ما حد يتسأل مرتين.
        location: {
          location_kind: 'warehouse',
          location_id: validLines[0].warehouse_id,
        },
        cash_amount: cashAmount,
        credit_amount: creditAmount,
        variable_discount_pct: variableDiscount || 0,
        external_document_number: values.external_document_number || null,
        // «الحساب» — الحساب اللي القيد بينزل عليه. الحقل كان موجود في السيرفر من ٠٣٠ والشاشة
        // مكانتش بتبعته خالص، فكل فاتورة كانت بتترحّل على الافتراضي مهما كان قصد الكاتب.
        expense_account_id: values.expense_account_id ?? null,
        // `branch_id` مش في العقد عن قصد — مفيش عمود ليه على المستند، والفرع بيتعرف من المخزن.
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
    // بيانات المورد بتتعرض على الفاتورة — العنوان والتليفون والرصيد الحالي. كانوا بيتشافوا في
    // شاشة المورد بس، فاللي بيكتب فاتورة ومحتاج يتأكد إنه المورد الصح كان بيسيب الشاشة.
    setParty(picked);
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
  /**
   * يضيف صنف للفاتورة — في تحديث واحد بيقرا السطور اللي موجودة فعلاً.
   *
   * كانت بتتعمل على مرحلتين: سطر فاضي يتضاف، وبعدين `handleItemChange` تحطّ الصنف جوّاه بـ
   * `setTimeout`. والتانية كانت بتبني المصفوفة من `purchaseItems` بتاعة الرندر اللي الدالة اتعرّفت فيه —
   * مفهاش السطر اللي لسه اتضاف — فكانت بتكتب فوقه وتشيله.
   *
   * الصنف الأول كان بيعدّي لأنه بينزل في السطر الفاضي الموجود من بدري، فمافيش سطر بيتضاف والنسختين
   * بيطلعوا واحد. والتاني كان بيختفي. وعشان كده الفاتورة كانت مش بتقبل أكتر من صنف.
   *
   * دلوقتي الإضافة والتعبية حاجة واحدة جوّا `setPurchaseItems`، فاللوب اللي بيضيف عشرة أصناف مرة
   * واحدة بيشتغل برضه — كل دورة بتبني على اللي قبلها مش على اللي كان موجود قبل اللوب.
   */
  const addProductById = async (itemId: number) => {
    if (!itemId) return;
    const selected = items.find((i) => i.id === itemId);
    const price = selected?.purchase_price ? parseFloat(selected.purchase_price) : 0;

    setPurchaseItems((prev) => {
      const existing = prev.find((l) => l.item_id === itemId);
      if (existing) {
        // العين تتبع الرقم اللي اتحرك، مش سطر جديد.
        landedRef.current = existing.key;
        return prev.map((l) => (l.key === existing.key
          ? { ...l, quantity: Number(l.quantity || 0) + 1 } : l));
      }
      // Reuse a blank row rather than leaving an empty line above the real one.
      const blank = prev.find((l) => l.item_id === null);
      if (blank) {
        landedRef.current = blank.key;
        return prev.map((l) => (l.key === blank.key
          ? { ...l, item_id: itemId, unit_price: price, unit: null,
              warehouse_id: l.warehouse_id ?? stickyWarehouseId } : l));
      }
      const key = `${Date.now()}-${itemId}`;
      landedRef.current = key;
      return [...prev, {
        key, item_id: itemId, quantity: null, unit_price: price, unit: null,
        // بيرث آخر مخزن اتختار — الشحنة العادية كلها بتنزل مخزن واحد.
        discount_pct: null, warehouse_id: stickyWarehouseId,
      }];
    });

    setPanelItemId(itemId);
    fetchUnits(itemId);
  };

  const handleProductPicked = (item: any) => {
    setPickerOpen(false);
    addProductById(item.id);
  };

  /** فئة الصنف كنص جاهز للعرض — سطر صغير تحت الاسم بدل ترويسة مجموعة. */
  const lineCategory = (line: PurchaseItem): string | null => {
    const cat = (items.find((i: any) => i.id === line.item_id) as any)?.category;
    return cat ? (categoryLabels[cat] || cat) : null;
  };

  /**
   * Enter معناها «السطر ده خلص» — ننتقل للسطر اللي بعده، وآخر سطر بيفتح بوباب الأصناف.
   *
   * الإيد مابتسيبش الكيبورد: اكتب الكمية، Enter، اكتب اللي بعدها، Enter… ولما تخلص السطور
   * البوباب بيفتح لصنف جديد. من غير كده كل سطر محتاج ماوس عشان توصل للخانة اللي بعدها.
   */
  const advanceFrom = (key: string) => {
    const idx = purchaseItems.findIndex((l) => l.key === key);
    const next = idx >= 0 ? purchaseItems[idx + 1] : undefined;
    if (next) { setFocusLineKey(next.key); return; }
    setPickerOpen(true);
  };



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
          {/*
            * ترويسة الفاتورة بترتيب الشاشة اللي العميل شغّال عليها:
            *
            *   التاريخ · الفرع · الحساب · مستند رقم
            *   مورد · الحالي · العنوان · الهاتف
            *   ملاحظات · بيان ١ · بيان ٢ · بيان ٣
            *
            * «الحساب» كان **موجود في السيرفر ومفيش خانة ليه في الشاشة** — `expense_account_id`
            * متعرّف على المستند من ٠٣٠ وبيسوق القيد، ومحدش كان يقدر يحدّده وهو بيكتب الفاتورة.
            *
            * وبيانات المورد (الرصيد والعنوان والتليفون) بتتعرض للقراءة: اللي بيكتب فاتورة
            * ومحتاج يتأكد إنه المورد الصح كان لازم يسيب الشاشة ويفتح ملفه.
            */}
          <Row gutter={16}>
            <Col xs={12} md={6}>
              <Form.Item label="التاريخ" style={{ marginBottom: 8 }}>
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  value={purchaseDate}
                  onChange={(v: Dayjs | null) => setPurchaseDate(v || dayjs())} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="branch_id" label="الفرع" style={{ marginBottom: 8 }}>
                <Select allowClear placeholder="كل الفروع"
                  onChange={(v) => setHeaderBranchId(v ?? undefined)}
                  options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={7}>
              {/* الحساب اللي الشرا بيترحّل عليه. فاضي = الحساب الافتراضي بتاع المشتريات. */}
              <Form.Item name="expense_account_id" label="الحساب" style={{ marginBottom: 8 }}>
                <Select allowClear showSearch optionFilterProp="label"
                  placeholder="حساب المشتريات الافتراضي"
                  options={postAccounts.map((a: any) => ({
                    value: a.id,
                    label: a.code ? `${a.code} ${a.name ?? ''}` : (a.name ?? `#${a.id}`) }))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item name="external_document_number" label="مستند رقم"
                style={{ marginBottom: 8 }}>
                <Input placeholder="رقم فاتورة المورد" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="supplier_id" label="مورد"
                rules={[{ required: true, message: 'يرجى اختيار المورد!' }]}
                style={{ marginBottom: 8 }}>
                {/* The same window the first door opens — searchable, with inline create.
                    Changing the supplier mid-document goes through the same place it was first
                    chosen, so there is one way to answer «مين». */}
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  placeholder="اضغط لاختيار المورد"
                  onClick={() => setPartyPickerOpen(true)}
                  options={suppliers.map((sp) => ({
                    value: sp.id, label: sp.code ? `${sp.name} (${sp.code})` : sp.name }))} />
              </Form.Item>
            </Col>
            <Col xs={8} md={4}>
              <Form.Item label="الحالي" style={{ marginBottom: 8 }}>
                {/* رصيد المورد قبل الفاتورة دي — للقراءة، مش خانة تتكتب. */}
                <Input readOnly value={party?.balance != null ? fmtMoney(party.balance) : ''} />
              </Form.Item>
            </Col>
            <Col xs={16} md={7}>
              <Form.Item label="العنوان" style={{ marginBottom: 8 }}>
                <Input readOnly value={party?.address ?? ''} />
              </Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item label="الهاتف" style={{ marginBottom: 8 }}>
                <Input readOnly value={party?.phone ?? ''} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item name="notes" label="ملاحظات" style={{ marginBottom: 8 }}>
                <Input placeholder="اختياري" />
              </Form.Item>
            </Col>
            {([1, 2, 3] as const).map((n) => (
              <Col xs={24} md={6} key={n}>
                <Form.Item name={`statement${n}`} label={`بيان ${n}`}
                  style={{ marginBottom: 8 }}>
                  <Input placeholder="اختياري" />
                </Form.Item>
              </Col>
            ))}
          </Row>

          <Divider orientation="right">أصناف الفاتورة</Divider>

          <Row gutter={16}>
            <Col xs={24}>
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

              {/*
                * سطور الفاتورة كجدول مضغوط — نفس شكل الشاشة اللي العميل شغّال عليها.
                *
                * كانت كروت متجمّعة بالفئة: كل سطر بياخد مساحة كبيرة، وعنوان فئة فوق كل مجموعة،
                * وفاتورة خمستاشر صنف بتبقى صفحتين تمرير. الجدول بيقول نفس الحاجات في سطر واحد
                * وبعنوان أعمدة مرة واحدة فوق، فالعين بتقارن الكميات والأسعار رأسياً بدل ما
                * تدوّر عليها جوّا كل كارت.
                *
                * الفئة بقت سطر صغير تحت اسم الصنف بدل ما تكون ترويسة مجموعة — نفس المعلومة من
                * غير ما تكسر الجدول لمجموعات وتمنع المقارنة الرأسية.
                *
                * مفيش عمود باركود، ومفيش بحث بيه — اتشال من النظام بطلب العميل.
                */}
              {purchaseItems.length === 0 ? (
                <Empty description="اختر الفئة ثم الأصناف لإضافتها للفاتورة"
                  style={{ margin: '12px 0' }} />
              ) : (
                <div style={{ border: '1px solid #e6efe3', borderRadius: 10,
                              overflowX: 'auto' }}>
                  <table className="entry-grid">
                    <thead>
                      <tr>
                        <th style={{ width: 34 }}>#</th>
                        <th style={{ minWidth: 150 }}>المخزن</th>
                        <th style={{ minWidth: 170 }}>الصنف</th>
                        <th style={{ minWidth: 96 }}>الوحدة</th>
                        <th style={{ minWidth: 84 }}>الكمية</th>
                        <th style={{ minWidth: 100 }}>سعر الوحدة</th>
                        <th style={{ minWidth: 100 }}>اجمالي قبل</th>
                        <th style={{ minWidth: 90 }}>خصم</th>
                        <th style={{ minWidth: 78 }}>خصم %</th>
                        <th style={{ minWidth: 100 }}>الإجمالي</th>
                        <th style={{ width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseItems.map((line, idx) => (
                        <tr key={line.key}>
                          <td style={{ color: '#8a8a8a' }}>{idx + 1}</td>
                          <td>
                            {/* المخزن أول عمود عن قصد: هو أول حاجة بتتحدّد في السطر، وبيثبت
                                للسطور اللي بعده لغاية ما يتغيّر. */}
                            <Select size="small" style={{ width: '100%' }}
                              placeholder="مخزن الاستلام"
                              value={line.warehouse_id ?? undefined}
                              onChange={(val) => {
                                handleItemChange(line.key, 'warehouse_id', val ?? null);
                                setStickyWarehouseId(val ?? null);
                              }}
                              options={lineWarehouses.map((w: any) => ({
                                value: w.id,
                                label: `${w.name} (${w.warehouse_type === 'central'
                                  ? 'مركزي' : 'فرعي'})`,
                              }))} />
                          </td>
                          <td>
                            {/* الضغط على الاسم بيوجّه لوحة المخزون للصنف ده. */}
                            <b style={{ cursor: 'pointer' }}
                              onClick={() => setPanelItemId(line.item_id)}>
                              {line.item_id ? itemName(line.item_id) : 'اختر الصنف'}
                            </b>
                            {lineCategory(line) ? (
                              <div style={{ color: '#8a8a8a', fontSize: 11 }}>
                                {lineCategory(line)}
                              </div>
                            ) : null}
                          </td>
                          <td>
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
                          </td>
                          <td>
                            {/* فاضية معناها «مااتكتبتش». صندوق بيفتح على ١ بيحوّل «٥» لـ«١٥»
                                لأي حد يكتب من غير ما يمسح الأول. */}
                            <InputNumber size="small" style={{ width: '100%' }} min={0.001}
                              step={1} placeholder="الكمية"
                              value={line.quantity ?? undefined}
                              data-qty-key={line.key}
                              data-grid-col="qty" keyboard={false}
                              onChange={(val) => handleItemChange(line.key, 'quantity', val ?? null)}
                              onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
                          </td>
                          <td>
                            <InputNumber size="small" min={0} step={0.01}
                              style={{ width: '100%' }} placeholder="سعر الوحدة"
                              value={line.unit_price}
                              data-price-key={line.key}
                              onChange={(val) => handleItemChange(
                                line.key, 'unit_price', val || 0)}
                              onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {/* قبل الخصم — الكمية × السعر. مشتق، فمفيش رقمين يختلفوا. */}
                            {fmtMoney(Number(line.quantity || 0) * (line.unit_price || 0))}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {/* «١٠٪» مابتقولش كام اتخصم — والمشتري بيراجع بالجنيه. */}
                            {line.discount_pct
                              ? fmtMoney(Number(line.quantity || 0) * (line.unit_price || 0)
                                  * (line.discount_pct / 100))
                              : '-'}
                          </td>
                          <td>
                            {/* فاضي = مفيش خصم متفق عليه، مش صفر. */}
                            <InputNumber size="small" min={0} max={99.99} step={0.5}
                              style={{ width: '100%' }} placeholder="خصم %"
                              value={line.discount_pct ?? undefined}
                              data-disc-key={line.key}
                              onChange={(val) => handleItemChange(
                                line.key, 'discount_pct', val ?? null)}
                              onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
                          </td>
                          <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {fmtMoney(lineTotal(line))}
                          </td>
                          <td>
                            <Button size="small" danger type="text" icon={<DeleteOutlined />}
                              onClick={() => handleRemoveItem(line.key)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/*
                      * صف الإجمالي تحت السطور — زي الشاشة اللي العميل شغّال عليها.
                      *
                      * «الفاتورة دي كام قطعة وبكام» سؤال بيتسأل وانت بتكتب، والإجابة كانت تحت في
                      * سلّم الإجماليات بعد تمرير. هنا في آخر الجدول، جنب الأرقام اللي جمّعته.
                      */}
                    <tfoot>
                      <tr>
                        <td colSpan={4} style={{ fontWeight: 700 }}>الإجمالي</td>
                        <td style={{ fontWeight: 700 }}>
                          {purchaseItems.reduce((n, l) => n + Number(l.quantity || 0), 0)
                            .toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
                        </td>
                        <td />
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {fmtMoney(purchaseItems.reduce(
                            (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0))}
                        </td>
                        <td colSpan={2} />
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {fmtMoney(grossTotal)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Col>
          </Row>

          <Divider />

          {/* Same ladder as the sales screens — the supplier side of the identical question:
              what the goods cost, what we paid now, what we still owe him. */}
          <Row gutter={16}>
            <Col xs={24} lg={8}>
              {/* Same panel the sales invoice uses — the question is identical on both sides.
                  نزلت هنا عشان السطور تاخد عرض الصفحة: «الصنف ده عندي منه كام» سؤال بيتسأل مرة
                  كل شوية، مش مع كل سطر، فمكانه جنب الإجماليات مش واكل ربع مساحة الكتابة. */}
              <ItemStockPanel itemId={panelItemId} products={items}
                onPickItem={(id) => setPanelItemId(id)} />
            </Col>
            <Col xs={24} lg={16}>
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
            /* بنفس أسماء الشريط اللي تحت الفاتورة في الشاشة اللي العميل شغّال عليها:
               اجمالي قبل · خصم فاتورة · خصم فاتورة % · الاجمالي · المدفوع · الباقي.
               «اجمالي قبل» بيتعرض دايماً دلوقتي — الشريط عنده بيوريه حتى وهو مساوي للإجمالي،
               لأن اللي بيراجع بيقرا الشريط من فوق لتحت وسطر ناقص بيخلّيه يعدّ. */
            rows={[
              { label: 'اجمالي قبل', value: grossTotal.toFixed(2) },
              { label: 'خصم فاتورة',
                value: `− ${(grossTotal - invoiceTotal).toFixed(2)}`,
                color: '#cf1322', show: variableDiscount > 0.001 },
              { label: 'خصم فاتورة %', value: `${variableDiscount}%`,
                show: variableDiscount > 0.001 },
              { label: 'الاجمالي', value: invoiceTotal.toFixed(2),
                strong: true, color: '#6AB42D' },
              { label: 'المدفوع', value: `− ${cashAmount.toFixed(2)}`,
                color: '#6AB42D', show: cashAmount > 0.001 },
              { label: 'الباقي', value: creditAmount.toFixed(2),
                big: true, rule: true,
                color: creditAmount > 0.001 ? '#cf1322' : '#6AB42D' },
            ]}
          />
            </Col>
          </Row>

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

  /**
   * «عرض» بيفتح الفاتورة للتعديل على طول — صفحة واحدة مش اتنين.
   *
   * كان بيفتح صفحة عرض مقفولة، وفيها زرار «تعديل الفاتورة» بيفتح صفحة تانية. اللي بيضغط على
   * سطر في السجل تسعة من عشرة بيكون عايز يعدّل، فالصفحة اللي في النص كانت خطوة بتتعدّى.
   *
   * التأكيد اللي جوّه `editPosted` فاضل، وده مش صفحة تالتة: الفاتورة المرحّلة ماتتعدلش في
   * مكانها — بيتعمل لها عكس كامل وتتفتح من جديد. حاجة بتغيّر المخزون والدفاتر لازم حد يقول
   * «أيوة» قبلها، والسطر اللي اتضغط بالغلط في قايمة مايعكسش مستند في صمت.
   *
   * والمرتجع مالوش شاشة تعديل هنا، فبيفتح **معاينة** فاتورته بدل ما يودّي لمكان مايعملش حاجة.
   */
  const openRow = async (row: PurchaseRecord) => {
    if (row.kind === 'return') {
      if (row.parent_id) openPrint({ ...row, id: row.parent_id });
      return;
    }
    setDetailLoading(true);
    const doc = await loadDocument(row.id);
    setDetailLoading(false);
    if (doc) editPosted(doc);
  };

  /** بوباب بيعرض الفاتورة زي ما هتتطبع — ومنه الطباعة. */
  const openPrint = async (row: PurchaseRecord) => {
    setPreviewLoading(true);
    const doc = await loadDocument(row.id);
    setPreviewLoading(false);
    if (doc) setPreview(doc);
  };

  /**
   * أعمدة السجل — نفس اللي في الشاشة اللي العميل شغّال عليها، وكل واحد بيتفلتر ويتترتب.
   *
   * كان فيه ستة أعمدة، والفلترة كلها من شريط فوق الجدول. شريط الفلاتر بيجاوب «هات فواتير المورد
   * ده» كويس، ومابيجاوبش «هات اللي الباقي عليها فوق الألف» ولا «رتّبهم بالأكبر خصماً» — ودول
   * أسئلة بتتسأل على السجل كل يوم.
   *
   * فالفلترة نزلت على الأعمدة نفسها: `textColumn` بيدّي قايمة بالقيم الموجودة، `numberColumn`
   * بيدّي مدى من/إلى، و`dateColumn` بيدّي مدى تواريخ — وكلهم بيترتبوا. والفلاتر بتتجمّع: تقدر
   * تضيّق على فرع وحساب ومدى مبلغ في نفس الوقت.
   *
   * خيارات الفلتر بتتبني من `purchases` كلها مش من المعروض، عشان القايمة ما تضيقش تحت إيد اللي
   * بيفلتر وتخليه يفتكر إن القيمة مش موجودة أصلاً.
   *
   * والترتيب الافتراضي **من الأحدث**: السجل بيتفتح عشان تشوف آخر اللي اتسجّل، مش أول فاتورة
   * اتكتبت في النظام.
   */
  const listColumns = [
    { title: 'النوع', dataIndex: 'kind', key: 'kind', fixed: 'left' as const, width: 86,
      filters: [{ text: 'فاتورة', value: 'purchase' }, { text: 'مرتجع', value: 'return' }],
      onFilter: (v: any, r: PurchaseRecord) => r.kind === v,
      render: (v: string) => (v === 'return'
        ? <Tag color="orange">مرتجع</Tag>
        : <Tag color="green">فاتورة</Tag>) },
    { title: 'مستند رقم', dataIndex: 'document_number', key: 'document_number',
      fixed: 'left' as const, width: 130,
      ...textColumn(purchases, (r: PurchaseRecord) => r.document_number),
      render: (doc: string) => <Tag color="blue">{doc}</Tag> },
    { title: 'التاريخ', dataIndex: 'purchase_date', key: 'purchase_date',
      // يوم ما البضاعة وصلت. `created_at` يوم ما الصف اتكتب — سؤال تاني، ومحدش بيسأله.
      ...dateColumn<PurchaseRecord>((r) => r.purchase_date || r.created_at),
      defaultSortOrder: 'descend' as const,
      render: (v: string | null, r: PurchaseRecord) => fmtDate(v || r.created_at) },
    { title: 'الفاتورة رقم', dataIndex: 'external_document_number',
      key: 'external_document_number',
      ...textColumn(purchases, (r: PurchaseRecord) => r.external_document_number),
      render: (v: string | null) => v || '-' },
    { title: 'جهة التعامل', dataIndex: 'supplier_name', key: 'supplier_name',
      ...textColumn(purchases, (r: PurchaseRecord) => r.supplier_name),
      render: (v: string) => <b>{v}</b> },
    { title: 'الفرع', dataIndex: 'branch_name', key: 'branch_name',
      ...textColumn(purchases, (r: PurchaseRecord) => r.branch_name),
      render: (v: string | null) => v || '-' },
    { title: 'الحساب الفرعي', dataIndex: 'expense_account_name', key: 'expense_account_name',
      ...textColumn(purchases, (r: PurchaseRecord) => r.expense_account_name),
      render: (v: string | null) => v || '-' },
    { title: 'اجمالي قبل', dataIndex: 'gross', key: 'gross', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.gross),
      // فاضي على المرتجع — مالوش «اجمالي قبل خصم»، والصفر كان هيتقري كأنه رقم محسوب.
      render: (v: string | null) => (v === null ? '-' : `${fmtMoney(v)} ج.م`) },
    { title: 'خصم فاتورة', dataIndex: 'discount_amount', key: 'discount_amount',
      align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.discount_amount),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)} ج.م` : '-') },
    { title: 'خصم فاتورة %', dataIndex: 'combined_pct', key: 'combined_pct',
      align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.combined_pct),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)}%` : '-') },
    { title: 'الضرائب', dataIndex: 'tax_amount', key: 'tax_amount', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.tax_amount),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)} ج.م` : '-') },
    { title: 'الضرائب %', dataIndex: 'tax_pct', key: 'tax_pct', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.tax_pct),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)}%` : '-') },
    { title: 'الصافي', dataIndex: 'net', key: 'net', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.net),
      render: (v: string | null) => (v === null ? '-' : `${fmtMoney(v)} ج.م`) },
    { title: 'الاجمالي', dataIndex: 'total', key: 'total', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.total),
      render: (val: string) => <strong style={{ color: '#6AB42D' }}>{fmtMoney(val)} ج.م</strong> },
    { title: 'تم السداد', dataIndex: 'cash_amount', key: 'cash_amount', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.cash_amount),
      render: (val: string | null) => (val === null ? '-' : `${fmtMoney(val)} ج.م`) },
    { title: 'الباقي', dataIndex: 'credit_amount', key: 'credit_amount', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.credit_amount),
      // الباقي هو اللي لسه على الشركة — أحمر لما يكون فيه رقم، مش لون واحد للكل.
      render: (val: string | null) => (val === null ? '-' : Number(val)
        ? <b style={{ color: '#cf1322' }}>{fmtMoney(val)} ج.م</b>
        : `${fmtMoney(val)} ج.م`) },
    { title: 'ملاحظات', dataIndex: 'notes', key: 'notes',
      ...textColumn(purchases, (r: PurchaseRecord) => r.notes),
      render: (v: string | null) => v || '-' },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: PurchaseRecord) => (
        <Space size="middle">
          <Button type="dashed" icon={<EyeOutlined />} onClick={() => openRow(record)}>
            عرض
          </Button>
          {/* الطباعة بتفتح معاينة في بوباب — الورقة بتتشاف قبل ما تطلع من الطابعة، ومن غير
              ما اللي بيطبع يسيب السجل. */}
          <Button type="link" icon={<PrinterOutlined />}
            onClick={() => openPrint(record.kind === 'return' && record.parent_id
              ? { ...record, id: record.parent_id } : record)}>
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
      title="سجل عمليات الشراء — فواتير ومرتجعات"
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
              setNewStep('party');
            }}>
            تسجيل فاتورة شراء
          </Button>
        </Space>
      )}
    >
      {/* الأعرض بيتحدد عشان الصف الأول يملا ٢٤ بالظبط: بحث ٥ + مستند ٣ + فاتورة ٣ + فرع ٤ +
          مورد ٤ + ملاحظات ٥. من غير كده الفلاتر بتلف وتسيب فراغ في نص الشريط. */}
      <ListToolbar
        searchSpan={5}
        searchPlaceholder="بحث برقم المستند أو المورد أو رقم فاتورته أو الملاحظات"
        query={purchasesFilter.query} onQueryChange={purchasesFilter.setQuery}
        values={purchasesFilter.values} onValueChange={purchasesFilter.setValue}
        showDateRange range={purchasesFilter.range} onRangeChange={purchasesFilter.setRange}
        onReset={purchasesFilter.reset}
        total={purchases.length} shown={purchasesFilter.filtered.length}
        filters={[
          // الصف الأول: بحث ٥ + فرع ٤ + مورد ٤ + تاريخ ٦ + «فلاتر أكثر» ٣ + مسح ٢ + عدّاد ٢ = ٢٦
          // على شاشة عريضة، وبيتلمّ على ٢٤ بإن العدّاد والمسح أيقونة بس.
          { key: 'kind', placeholder: 'النوع', span: 3,
            options: [{ value: 'purchase', label: 'فواتير' },
              { value: 'return', label: 'مرتجعات' }] },
          { key: 'branch_id', placeholder: 'الفرع', span: 4,
            options: branches.map((b: any) => ({ value: b.id, label: b.name })) },
          { key: 'supplier_id', placeholder: 'المورد', span: 4,
            options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
          // تحت الطيّة: بيتسألوا كل شوية، ولهم فلتر على العمود نفسه كمان.
          { key: 'document_number', placeholder: 'مستند رقم', kind: 'text',
            advanced: true, span: 5 },
          { key: 'external_document_number', placeholder: 'الفاتورة رقم', kind: 'text',
            advanced: true, span: 5 },
          { key: 'notes', placeholder: 'ملاحظات', kind: 'text', advanced: true, span: 6 },
        ]}
      />
      {/*
        * سبعتاشر عمود عايزين مساحة — `max-content` بيدّي كل عمود عرضه الطبيعي والجدول بيتمرّر
        * أفقياً، بدل ما antd تعصر الأرقام في عرض الشاشة وتلفّ «١٢٬٥٠٠٫٠٠ ج.م» على سطرين.
        *
        * و«مستند رقم» مثبّت: وانت بتمرّر لتحت الشمال عشان تشوف الباقي والضرايب، لازم تفضل عارف
        * إنت في سطر مين. من غيره بتعدّ السطور بصباعك على الشاشة.
        */}
      <Table
        {...listKb.tableProps}
        size="small"
        dataSource={purchasesFilter.filtered}
        columns={listCols.columns}
        // فاتورة ومرتجع ممكن يكون ليهم نفس الـid — المفتاح لازم يشيل النوع كمان.
        rowKey={(r: PurchaseRecord) => `${r.kind}-${r.id}`}
        loading={listLoading}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
        locale={{ emptyText: 'لا يوجد عمليات شراء بعد' }}
        summary={(rows) => {
          /*
           * إجمالي المعروض — على اللي الفلاتر سابته، مش على كل السجل.
           *
           * «الشهر ده اشترينا بكام» سؤال بيتسأل **بعد** ما تحط فلتر، وإجمالي بيوصف السجل كله
           * بيبان كأنه إجابة السؤال وهو مش هو.
           *
           * الخلايا بتتبني من الأعمدة **المعروضة** مش من ترتيب ثابت: `useTableColumns` بيخلّي
           * الواحد يخفي عمود ويرتّب الباقي، فصف إجماليات بمواضع محفوظة كان هيحط مجموع «الباقي»
           * تحت عنوان «الضرائب» أول ما حد يخفي عمود — رقم صح تحت اسم غلط، وده أوحش من مفيش رقم.
           */
          const list = rows as readonly PurchaseRecord[];
          if (!list.length) return null;
          const sum = (get: (r: PurchaseRecord) => any) =>
            list.reduce((n, r) => n + Number(get(r) || 0), 0);
          // القيمة نفسها `| undefined`: من غير كده الفهرسة بترجّع دالة مؤكدة، والشرط تحت
          // بيبان دايماً صح مهما كان المفتاح مش موجود.
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
                        : get ? `${fmtMoney(sum(get))} ج.م` : ''}
                    </Table.Summary.Cell>
                  );
                })}
              </Table.Summary.Row>
            </Table.Summary>
          );
        }}
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
      {/*
        * باب واحد بيفتح الفاتورة — الفرع والتاريخ والتصنيف والبحث والقايمة، كلهم في بوباب واحد.
        *
        * كان خطوتين: بوباب بيسأل التاريخ وبعده بوباب بيسأل المورد. سؤالين هما نفس القرار —
        * «الفاتورة دي لمين وامتى» — واتنين لازم تقفلهم قبل ما تكتب أول سطر.
        *
        * `kinds` بيدّي تصنيف جوّه البوباب، فاللي بيدوّر على اسم ومش لاقيه في الموردين يبص في
        * العملاء من غير ما يقفل ويفتح تاني.
        */}
      <PartyPickerModal
        open={partyPickerOpen || newStep === 'party'} kind="supplier"
        kinds={['supplier', 'customer']}
        date={purchaseDate} onDateChange={(d) => setPurchaseDate(d)}
        onPick={handlePartyPicked}
        onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }} />

      {/*
        * معاينة الفاتورة قبل الطباعة — في بوباب، مش صفحة.
        *
        * زرار الطباعة كان بيفتح صفحة العرض وسايب اللي بيطبع يدوّر على زرار الطباعة جوّاها،
        * وبعدين يرجع للسجل. الورقة اللي هتطلع بتتشاف هنا، والطباعة من نفس المكان، والسجل
        * فاضل تحت البوباب زي ما هو.
        */}
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

    </>
  );

  if (createVisible) {
    return <div>{doors}{createContent}</div>;
  }

  return <div>{doors}{listContent}</div>;
}

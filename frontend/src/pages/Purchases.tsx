import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, Modal, Result,
  Row, Segmented, Select, Space, Statistic, Table, Tag, Tooltip, Typography, message, DatePicker,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import {
  PlusOutlined, DeleteOutlined, FileDoneOutlined, EyeOutlined, RollbackOutlined,
  PrinterOutlined, FileAddOutlined, EditOutlined, UndoOutlined, SaveOutlined,
  ArrowLeftOutlined, ArrowRightOutlined, SearchOutlined, BankOutlined, ReloadOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
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
import WarehouseGate from '../components/WarehouseGate';
import TreasuryGate, { useTreasuryGate } from '../components/TreasuryGate';
import { money } from '../utils/money';
import { QTY_DATA_ATTR, flashExistingItem } from '../utils/duplicateItem';

/** الاسم القديم في الشاشة دي — نفس الدالة. */
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
  /** الخصم المتغيّر — اللي اتفق عليه في الصفقة دي. */
  discount_pct: number | null;
  /** والثابت — اللي عليه اتفاق دايم مع المورد. الاتنين بيتجمعوا وقت الإرسال، زي البيع. */
  fixed_discount_pct: number | null;
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
  const [availability, setAvailability] = useState<Record<number, Record<number, number>>>({});
  /**
   * الأصناف المستنية المخزن — نفس بوباب فاتورة البيع والمرتجع.
   *
   * السؤال هنا «البضاعة دي داخلة أنهي مخزن»، ولازم يتسأل: الشرا بيدخّل بضاعة على مخزن
   * بعينه، والسطر اللي نزل من غير مخزن بيبقى شحنة داخلة مكان محدش قاله. كان بيتحل بإن
   * الواحد يفتح قايمة المخزن في كل سطر — دلوقتي سؤال واحد بيثبت لكل الشحنة.
   *
   * وبيتجمّعوا في طابور لأن «اختار كذا صنف مرة واحدة» بينده الإضافة لكل صنف: لو كل واحد
   * مسح اللي قبله كان هينزل صنف واحد والباقي يضيع في السكوت.
   */
  const [pendingItems, setPendingItems] = useState<number[]>([]);
  const [pendingWarehouse, setPendingWarehouse] = useState<number | null>(null);
  const [items, setItems] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  // The item the side stock panel is showing — a buyer about to reorder wants to see what the
  // branches are already sitting on before committing to a quantity.
  /** الصنف اللي بوباب الاختيار واقف عليه — بيغذّي لوحة الرصيد اللي جوّه البوباب نفسه.
   *  لوحة الرصيد اللي كانت تحت الفاتورة اتشالت: كانت فاضية وواخدة تلت العرض. */
  const [panelItemId, setPanelItemId] = useState<number | null>(null);
  // Same contract as the sales screen: a link elsewhere names a document, this screen opens it.
  const [searchParams, setSearchParams] = useSearchParams();
  /**
   * خانة البحث في السجل — عشان زرار «بحث» يوصلها.
   *
   * الزرار كان بيقفل المعاينة وبس. ده بيوصّل للسجل فعلاً، بس الزرار مكتوب عليه «بحث»
   * ومعاه F3، واللي بيدوسه بيستنى خانة تستنى كتابة — فبيلاقي نفسه في قايمة والمؤشر مش
   * في حتة.
   */
  const listSearchRef = useRef<any>(null);
  const handledIntent = useRef<string | null>(null);

  // Form state
  const [form] = Form.useForm();
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([
    { key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, fixed_discount_pct: null, warehouse_id: null },
  ]);
  const [unitsCache, setUnitsCache] = useState<Record<number, ItemUnit[]>>({});

  // Payment splits
  /** خصم الفاتورة المتغيّر. الثابت بيتقرا من الإعدادات على السيرفر زي البيع. */
  const [variableDiscount, setVariableDiscount] = useState<number>(0);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState<number>(0);
  // بوباب الخزنة قبل الحفظ (أمر ٠٠٩ بند ٤). الشرا من المكتب، فمافيش استثناء للمندوب.
  const { ask: askTreasury, gateProps: treasuryGate } = useTreasuryGate();

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
  const [newStep, setNewStep] = useState<null | 'party' | 'warehouse'>(null);
  const [purchaseDate, setPurchaseDate] = useState<Dayjs>(dayjs());
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  // The picker window, so a line is added by typing rather than by hunting a dropdown — the same
  // round trip the sale and the return use.
  const [pickerOpen, setPickerOpen] = useState(false);

  /**
   * رصيد المخزن المختار — بيتجاب من جديد كل ما الشباك يتفتح.
   *
   * كان فيه حارس `if (availability[wh]) return;` بيمنع الجلب لو المخزن اتقرا قبل كده.
   * والنتيجة إن الأرقام بتتجمّد أول مرة وتفضل كده طول الجلسة: تكتب فاتورة تطلّع خمسة،
   * تفتح الشباك تاني، يقولك الرقم القديم — والشباك ده اتعمل عشان يقول المتاح دلوقتي.
   *
   * والنداء بيتعمل لما الشباك يتفتح بس (الـ`useEffect` معلّق على `pickerOpen`)، فمرة
   * لكل فتحة مش مع كل حرف بيتكتب.
   */
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
  const [viewOnly, setViewOnly] = useState(false);
  const [viewPurchase, setViewPurchase] = useState<PurchaseDetail | null>(null);
  /**
   * الفاتورة اللي بتتعدّل دلوقتي — لسه مرحّلة، والعكس هيحصل وقت الحفظ.
   *
   * `null` معناها «فاتورة جديدة». الرقم معناه «دي فاتورة موجودة اتفتحت للتعديل»، واللي
   * بيفرّق بينهم هو إن الحفظ بيعكس القديمة الأول.
   */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
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
  /** المورد المختار بتفاصيله — العنوان والتليفون والرصيد بيتعرضوا في الترويسة. */
  const [party, setParty] = useState<Party | null>(null);
  /**
   * فرع الترويسة — بيضيّق مخازن السطور، مابيتحفظش على المستند.
   *
   * السيرفر مافيهوش عمود فرع على فاتورة الشرا: الفرع بيتعرف من المخزن اللي البضاعة نزلت فيه.
   * فبدل ما تبقى خانة بتتكتب وتروح في اللا حاجة، بتعمل الحاجة الوحيدة اللي ليها معنى — تقصر
   * قايمة المخازن على بتاعة الفرع ده، فاللي شغّال على فرع مابيشوفش مخازن غيره.
   */
  // خانة الفرع اتشالت من الترويسة، فقايمة مخازن السطر بقت كل المخازن.
  const lineWarehouses = warehouses;
  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(console.error);
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
      }));
      setPurchases([...invoices, ...returns]);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل سجل المشتريات');
    } finally {
      setListLoading(false);
    }
  };

  // Live summary for Purchases, Returns, and Net Purchases
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

  /**
   * `?doc=` بيفتح للعرض، و`?edit=` بيفتح للتعديل.
   *
   * الشاشة دي عندها تعديل فعلاً (`editPosted`)، بس الروابط اللي جاية من كشف الحساب
   * والتقارير كانت بتفتحها للعرض بس — فاللي بيدوس على رقم فاتورة عشان يصلّحها كان
   * بيوصل لشاشة بتفرّجه عليها. الفرق بين الاتنين هو نية اللي ضغط، والرابط هو اللي
   * بيقولها.
   */
  useEffect(() => {
    const docId = searchParams.get('doc') || searchParams.get('edit');
    const wantsEdit = !!searchParams.get('edit');
    if (!docId || handledIntent.current === docId) return;
    handledIntent.current = docId;
    setSearchParams({}, { replace: true });
    const target = purchases.find((p) => p.id === Number(docId)) || ({ id: Number(docId), kind: 'purchase' } as PurchaseRecord);
    if (wantsEdit) openRow(target);
    else openDetail(target);
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
      });
      setPurchaseDate((det as any).purchase_date
        ? dayjs((det as any).purchase_date)
        : ((det as any).created_at ? dayjs((det as any).created_at) : dayjs()));
      setPurchaseItems((det.lines || []).map((l: any, i: number) => ({
        key: `${Date.now()}-${i}`,
        item_id: l.item_id,
        quantity: Number(l.quantity) || null,
        unit_price: Number(l.unit_price) || 0,
        unit: l.unit ?? null,
        discount_pct: l.discount_pct == null ? null : Number(l.discount_pct),
        fixed_discount_pct: null,
        warehouse_id: l.line_location_id ?? det.location_id ?? null,
      })));
      setStickyWarehouseId(((det.lines || [])[0] as any)?.line_location_id ?? (det as any).location_id ?? null);
      [...new Set((det.lines || []).map((l: any) => l.item_id))].forEach((id) => fetchUnits(id as number));
      setCashAmount(Number(det.cash_amount) || 0);
      setCreditAmount(Number(det.credit_amount) || 0);
      setVariableDiscount(Number((det as any).variable_discount_pct) || 0);
      setCreateVisible(true);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر فتح الفاتورة');
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
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل قوايم الشاشة');
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

  const linesByCategory = useMemo(() => {
    const groups: { category: string | null; items: PurchaseItem[] }[] = [];
    purchaseItems.forEach((l) => {
      const cat = (l.item_id ? items.find((i) => i.id === l.item_id)?.category : null) || null;
      let g = groups.find((x) => x.category === cat);
      if (!g) { g = { category: cat, items: [] }; groups.push(g); }
      g.items.push(l);
    });
    return groups;
  }, [purchaseItems, items]);

  const handleAddItem = (focusIt = false) => {
    const newKey = Date.now().toString();
    setPurchaseItems([
      ...purchaseItems,
      { key: newKey, item_id: null, quantity: null, unit_price: 0, unit: null,
    discount_pct: null, fixed_discount_pct: null, warehouse_id: null },
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

  /**
   * خيارات الوحدة لصنف — وفيها **دايماً** خيار الوحدة الأساسية.
   *
   * `__base__` قيمة داخلية معناها «الوحدة الأساسية بتاعة الصنف»، بتتخزّن `null` على السطر.
   * وantd لما تلاقي قيمة مالهاش خيار مطابق بتعرض القيمة نفسها — فكانت بتكتب `__base__`
   * بالإنجليزي في خانة عربية.
   *
   * وده كان بيحصل كل ما قايمة وحدات الصنف ماتكونش وصلت لسه: فاتورة بتتفتح للتعديل بتملا
   * سطورها فوراً، والوحدات بتيجي بعدها بنداء تاني. فالخيار الوحيد بقى مضمون إنه موجود من
   * غير انتظار، واسمه اسم الوحدة الحقيقي لما تعرف، و«الأساسية» لغاية ما تعرف.
   */
  const unitOptions = (itemId: number | null) => {
    const units = unitsCache[itemId || 0] || [];
    const base = units.find((u) => u.is_base);
    return [
      { value: '__base__', label: base?.name || 'الأساسية' },
      ...units.filter((u) => !u.is_base)
        .map((u) => ({ value: u.name, label: `${u.name} (×${u.factor})` })),
    ];
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
          let p = selected?.purchase_price ? parseFloat(selected.purchase_price) : 0;
          if (!p && selected?.sale_price) p = parseFloat(selected.sale_price);
          updatedItem.unit_price = p;
          updatedItem.unit = null;
          updatedItem.warehouse_id = updatedItem.warehouse_id ?? stickyWarehouseId ?? lineWarehouses[0]?.id ?? null;
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
    const disc = Math.min(99.99, (it.discount_pct ?? 0) + (it.fixed_discount_pct ?? 0));
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
    const invoicesInList = purchasesFilter.filtered.filter((r) => r.kind === 'purchase');
    const isSaved = Boolean(editingId && viewPurchase);
    const stepDoc = (step: number) => {
      if (!invoicesInList.length) return;
      const at = invoicesInList.findIndex(
        (r) => r.id === (editingId ?? (docResult?.id as number | undefined) ?? null));
      const target = at >= 0 ? invoicesInList[at + step]
        : (step > 0 ? invoicesInList[0] : invoicesInList[invoicesInList.length - 1]);
      if (target) { closeCreate(); openDetail(target); }
    };
    return [
      {
        key: 'new',
        label: 'جديد',
        shortcut: 'F2',
        icon: <FileAddOutlined />,
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
        // «تراجع» بيرجّع المستند، مش بيقفل الحقول وبس.
        //
        // كان بيعمل `setViewOnly(true)` على طول: الحقول تتقفل واللي اتكتب ومااتحفظش يفضل
        // ظاهر — مقفول ومقروء، يعني بنفس شكل المحفوظ بالظبط. فاللي غيّر كمية من ١٠ لـ٣
        // وضغط تراجع بيفضل قدامه ٣ وإجمالي مالوش وجود، ومافيش حاجة على الشاشة بتقول إن ده
        // مش اللي في القاعدة. إعادة تحميل المستند هي الحاجة الوحيدة اللي بترجّع الأرقام.
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
        key: 'next',
        label: 'التالى',
        icon: <ArrowLeftOutlined />,
        disabled: invoicesInList.length === 0,
        onClick: () => stepDoc(1),
      },
      {
        key: 'search',
        label: 'بحث',
        shortcut: 'F3',
        icon: <SearchOutlined />,
        onClick: () => {
          if (viewOnly) {
            closeCreate();
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
        onClick: () => {
          if (isSaved && viewPurchase) openDetail({ id: viewPurchase.id } as any);
          else loadLookups();
        },
      },
    ];
  };

  const detailReturnColumns = [
    { title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', render: (d: string) => <Tag color="volcano">{d}</Tag> },
    { title: 'القيمة', dataIndex: 'value', key: 'value', render: (v: string) => `${fmtMoney(v)} ج.م` },
    { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', render: (v: string) => fmtDate(v) },
  ];

  /**
   * فتح فاتورة مرحّلة للتعديل — **من غير ما يتغيّر أي حاجة لحد ما تحفظ**.
   *
   * كانت بتتعكس أول ما تتفتح. والعكس بيطلّع البضاعة من المخزن، فلو الأصناف اتباعت أو اتحوّلت
   * بعد الشرا، الرصيد مايكفيش والعكس بيقع — فالنتيجة إنك **مش قادر تفتح الفاتورة أصلاً**،
   * ومش عشان فيها غلط، عشان مجرد الفتح كان بيحاول يحرّك مخزون.
   *
   * دلوقتي الفتح قراية بس: الشاشة بتتملّى بمحتوى الفاتورة وخلاص. والعكس بيحصل **لما تدوس
   * حفظ** — وهي اللحظة اللي فعلاً محتاجة تبديل: الفاتورة القديمة تتعكس والجديدة تترحّل.
   *
   * يعني لو فتحت وغيّرت رأيك وقفلت، مافيش حاجة اتحركت. ولو الرصيد فعلاً مايكفيش، الرسالة
   * بتيجي وانت بتحفظ — وهي وقتها بتقول حاجة صح: التبديل ده مش ممكن دلوقتي.
   */
  const editPosted = async (det: PurchaseDetail) => {
    setEditingId(det.id);
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
      discount_pct: l.discount_pct == null ? null : Number(l.discount_pct),
      fixed_discount_pct: null,
      warehouse_id: l.line_location_id ?? det.location_id ?? null,
    })));
    setStickyWarehouseId(
      ((det.lines || [])[0] as any)?.line_location_id ?? (det as any).location_id ?? null);
    [...new Set((det.lines || []).map((l: any) => l.item_id))]
      .forEach((id) => fetchUnits(id as number));
    setVariableDiscount(Number((det as any).variable_discount_pct) || 0);
    setCashAmount(Number(det.cash_amount) || 0);
    setCreditAmount(Number(det.credit_amount) || 0);
    setDetail(null);
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

    // بوباب الخزنة (أمر ٠٠٩ بند ٤): فاتورة الشرا **بتخصم** من الخزنة. الحفظ بيتم بعد
    // الاختيار، والرجوع مابيحفظش. كله آجل (نقدي بصفر) ⇒ مافيش فلوس بتتحرّك، فمافيش سؤال.
    //
    // والسؤال قبل `setSubmitLoading(true)` عن قصد: لو اتفتح البوباب واترجع، الزرار كان
    // هيفضل بيلف على الفاضي.
    askTreasury(
      {
        amount: Number(cashAmount) || 0,
        direction: 'out',
        docLabel: 'فاتورة الشراء',
      },
      async (cashAccountId) => {
        setSubmitLoading(true);
        try {
          // الفاتورة اللي اتفتحت للتعديل بتتعكس **دلوقتي** — مش وقت الفتح.
          //
          // العكس بيطلّع البضاعة من المخزن. لو حصل وقت الفتح، أي فاتورة أصنافها اتباعت بقت مش
          // قابلة للفتح أصلاً: الرصيد مايكفي فالعكس بيقع، ومجرد إنك عايز تبص عليها كان بيفشل.
          //
          // هنا هو في مكانه: التبديل بيحصل مرة واحدة — القديمة تتعكس والجديدة تترحّل. ولو الرصيد
          // فعلاً مايكفيش، الرسالة بتيجي وهي بتقول حاجة صح، والفاتورة القديمة بتفضل زي ما هي.
          //
          // **والفاتورة اللي اترجّعت بالكامل بتعدّي.** لو المردودات أكلت قيمتها كلها، مفيش
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
            // (٠٠٩) الخزنة اللي البوباب سأل عنها — الشرا **بيخصم** منها. `undefined` =
            // مااتسألش (نقدي بصفر أو مافيش صناديق) والسيرفر بيقرر زي ما هو بيعمل دلوقتي.
            cash_account_id: cashAccountId ?? undefined,
            variable_discount_pct: variableDiscount || 0,
            external_document_number: values.external_document_number || null,
            // «الحساب» — الحساب اللي القيد بينزل عليه. الحقل كان موجود في السيرفر من ٠٣٠ والشاشة
            // مكانتش بتبعته خالص، فكل فاتورة كانت بتترحّل على الافتراضي مهما كان قصد الكاتب.
            // خانة «الحساب» اتشالت من الترويسة — القيد بينزل على حساب المشتريات الافتراضي.
            expense_account_id: null,
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
              // الاتنين بيتجمعوا — سطر الفاتورة في السيرفر بيشيل خصم واحد، زي البيع بالظبط.
              discount_pct: (l.discount_pct ?? 0) + (l.fixed_discount_pct ?? 0) || null,
              warehouse_id: l.warehouse_id,
            })),
            // The day the goods were received, taken from the first door — not the day this row was
            // typed, which is what `created_at` would have recorded.
            purchase_date: purchaseDate.format('YYYY-MM-DD'),
          };

          // التعديل بيروح للفاتورة نفسها — بنفس رقمها، من غير مردود ولا قيد عكسي.
          const res = editingId !== null
            ? await api.put(`/api/v1/purchases/${editingId}`, payload)
            : await api.post('/api/v1/purchases', payload);
          setDocResult(res.data);
          message.success(editingId !== null
            ? 'تم حفظ الفاتورة' : 'تم تسجيل فاتورة الشراء بنجاح');
          setEditingId(null);
          form.resetFields();
          setPurchaseItems([{ key: '1', item_id: null, quantity: null, unit_price: 0, unit: null,
            discount_pct: null, fixed_discount_pct: null, warehouse_id: null }]);
          setCashAmount(0);
          setCreditAmount(0);
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

  /** الباب التاني: المورد. Mid-document this only swaps the party; during the opening run it is
   *  the second door and hands over to the warehouse door — the same order the sale opens in. */
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

  /** A picked product becomes a line, and the caret lands in its quantity. */
  const addProductById = async (itemId: number) => {
    if (!itemId) return;
    const wh = stickyWarehouseId ?? lineWarehouses[0]?.id;
    if (wh) {
      await addProductByIdWith(itemId, wh);
    }
  };

  /**
   * نفس الإضافة بمخزن **صريح**.
   *
   * `setStickyWarehouseId` مابيغيّرش القيمة في نفس اللفّة، فالندهة اللي بعده على طول
   * بتقرا `null` وتنزّل السطر من غير مخزن — وهي المشكلة اللي البوباب اتعمل عشانها.
   */
  const addProductByIdWith = async (itemId: number, warehouseId: number) => {
    const selected = items.find((i) => i.id === itemId);
    let price = selected?.purchase_price ? parseFloat(selected.purchase_price) : 0;
    if (!price && selected?.sale_price) price = parseFloat(selected.sale_price);

    if (purchaseItems.some((l) => l.item_id === itemId)) {
      flashExistingItem(itemId);
      message.info(`«${itemName(itemId)}» موجود بالفعل — عدّل الكمية من السطر`);
      return;
    }

    setPurchaseItems((prev) => {
      const existing = prev.find((l) => l.item_id === itemId);
      if (existing) {
        return prev;
      }
      // Reuse a blank row rather than leaving an empty line above the real one.
      const blank = prev.find((l) => l.item_id === null);
      if (blank) {
        landedRef.current = blank.key;
        return prev.map((l) => (l.key === blank.key
          ? { ...l, item_id: itemId, unit_price: price, unit: null,
              warehouse_id: l.warehouse_id ?? warehouseId } : l));
      }
      const key = `${Date.now()}-${itemId}`;
      landedRef.current = key;
      return [...prev, {
        key, item_id: itemId, quantity: null, unit_price: price, unit: null,
        fixed_discount_pct: null,
        // بيرث المخزن اللي اتسأل عنه — الشحنة العادية كلها بتنزل مخزن واحد.
        discount_pct: null, warehouse_id: warehouseId,
      }];
    });

    setPanelItemId(itemId);
    fetchUnits(itemId);
  };

  const handleProductPicked = (item: any) => {
    setPickerOpen(false);
    addProductById(item.id);
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
    // الرجوع من غير حفظ مابيغيّرش حاجة — الفاتورة اللي كانت مفتوحة للتعديل فاضلة زي ما هي،
    // لأن العكس بيحصل وقت الحفظ. تصفير الحالة هنا بيمنع إن أول حفظ بعد كده يعكسها بالغلط.
    setEditingId(null);
  };

  /**
   * أعمدة شبكة سطور الفاتورة كبيانات — عشان تتخفي وتترتّب.
   *
   * كانت `<thead>` والخلايا و`<tfoot>` مكتوبين بالإيد في نفس الترتيب. ده معناه إن الأعمدة
   * مالهاش وجود كقايمة، فمافيش حاجة تخفي عمود ولا تحرّكه — وصف الإجماليات كان معلّق على
   * `colSpan={4}` بتعليق بيحذّر إن الرقم ده لازم يتغيّر مع أي عمود بيتزوّد أو بيتشال.
   * دلوقتي كل عمود شايل خليته وإجماليه، فالاتنين بيتحركوا معاه.
   */
  const lineColumns: EntryColumn<PurchaseItem>[] = [
    { key: 'idx', title: '#', width: 28, locked: true,
      cellStyle: { color: '#6b6b6b', textAlign: 'center' }, cell: (_l, i) => i + 1 },
    { key: 'warehouse', title: 'المخزن', minWidth: 120,
      cell: (line) => (
        <Select size="small" style={{ width: '100%' }} placeholder="مخزن الاستلام"
          disabled={viewOnly}
          value={line.warehouse_id ?? undefined}
          onChange={(val) => {
            handleItemChange(line.key, 'warehouse_id', val ?? null);
            setStickyWarehouseId(val ?? null);
          }}
          options={lineWarehouses.map((w: any) => ({
            value: w.id,
            label: `${w.name} (${w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})`,
          }))} />
      ) },
    { key: 'item', title: 'الصنف', minWidth: 170, locked: true,
      cell: (line) => {
        const itemObj = line.item_id ? items.find((i) => i.id === line.item_id) : null;
        return (
          <div>
            <b style={{ fontSize: 13 }}>{line.item_id ? itemName(line.item_id) : 'اختر الصنف'}</b>
            {itemObj?.purchase_price && Number(itemObj.purchase_price) > 0 ? (
              <div style={{ fontSize: 10, color: '#1677ff', marginTop: 1 }}>
                شراء: {fmtMoney(itemObj.purchase_price)} ج.م
              </div>
            ) : itemObj?.sale_price && Number(itemObj.sale_price) > 0 ? (
              <div style={{ fontSize: 10, color: '#52c41a', marginTop: 1 }}>
                بيع: {fmtMoney(itemObj.sale_price)} ج.م
              </div>
            ) : null}
          </div>
        );
      } },
    { key: 'unit', title: 'الوحدة', minWidth: 80,
      cell: (line) => (
        <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
          disabled={viewOnly}
          value={line.unit ?? '__base__'}
          onChange={(val) => handleItemChange(
            line.key, 'unit', val === '__base__' ? null : val)}
          options={unitOptions(line.item_id)} />
      ) },
    { key: 'qty', title: 'الكمية', minWidth: 70, locked: true,
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
        .toLocaleString('ar-EG', { maximumFractionDigits: 3 }) },
    { key: 'price', title: 'سعر الوحدة', minWidth: 80,
      cell: (line) => (
        <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="السعر" value={line.unit_price} data-price-key={line.key}
          onChange={(val) => handleItemChange(line.key, 'unit_price', val || 0)}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ),
      footer: () => null },
    { key: 'gross', width: 115, title: 'اجمالي قبل', minWidth: 85,
      cellStyle: { whiteSpace: 'nowrap' },
      cell: (line) => fmtMoney(Number(line.quantity || 0) * (line.unit_price || 0)),
      footer: (rows) => fmtMoney(rows.reduce(
        (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0)) },
    { key: 'disc_var', title: 'خصم متغير %', minWidth: 75,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="متغير" value={line.discount_pct ?? undefined} data-disc-key={line.key}
          onChange={(val) => handleItemChange(line.key, 'discount_pct', val ?? null)}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ),
      footer: () => null },
    { key: 'disc_fixed', title: 'خصم ثابت %', minWidth: 75,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="ثابت" value={line.fixed_discount_pct ?? undefined}
          onChange={(val) => handleItemChange(line.key, 'fixed_discount_pct', val ?? null)}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ),
      footer: () => null },
    { key: 'total', width: 120, title: 'الإجمالي', minWidth: 90, locked: true,
      cellStyle: { fontWeight: 700, whiteSpace: 'nowrap' },
      cell: (line) => fmtMoney(lineTotal(line)),
      footer: () => fmtMoney(grossTotal) },
    { key: 'actions', title: '', label: 'حذف السطر', width: 32, locked: true,
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
    <Card title={(
      <Space>
        <Button type="text" icon={<ArrowRightOutlined />} onClick={closeCreate}>رجوع</Button>
        <Typography.Text strong style={{ fontSize: 16 }}>
          {viewPurchase ? `فاتورة شراء ${viewPurchase.document_number}` : (editingId !== null ? 'تعديل فاتورة شراء' : 'فاتورة شراء جديدة')}
        </Typography.Text>
        <DatePicker
          disabled={viewOnly}
          value={purchaseDate} allowClear={false} format="YYYY-MM-DD"
          onChange={(v: Dayjs | null) => setPurchaseDate(v || dayjs())}
        />
      </Space>
    )}
      extra={<PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />}>
      <DocumentToolbar actions={purchaseToolbar()} />
      <Form form={form} layout="vertical" size="small" className="doc-form"
        onFinish={handleSubmit} requiredMark={false}>
          <Row gutter={16}>
            <Col xs={12} md={5}>
              <Form.Item label="التاريخ" style={{ marginBottom: 8 }}>
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  disabled={viewOnly}
                  value={purchaseDate}
                  onChange={(v: Dayjs | null) => setPurchaseDate(v || dayjs())} />
              </Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item name="supplier_id" label="المورد"
                rules={[{ required: true, message: 'يرجى اختيار المورد!' }]}
                style={{ marginBottom: 8 }}>
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  disabled={viewOnly}
                  placeholder="اضغط لاختيار المورد"
                  onClick={() => { if (!viewOnly) setPartyPickerOpen(true); }}
                  options={suppliers.map((sp) => ({
                    value: sp.id, label: sp.code ? `${sp.name} (${sp.code})` : sp.name }))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="المخزن الافتراضي" style={{ marginBottom: 8 }}>
                <Select
                  disabled={viewOnly}
                  placeholder="اختر المخزن الافتراضي"
                  value={stickyWarehouseId ?? undefined}
                  onChange={(val) => setStickyWarehouseId(val ?? null)}
                  options={lineWarehouses.map((w: any) => ({
                    value: w.id,
                    label: `${w.name} (${w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="external_document_number" label="المستند"
                style={{ marginBottom: 8 }}>
                <Input placeholder="رقم فاتورة المورد" disabled={viewOnly} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item name="notes" label="ملاحظات" style={{ marginBottom: 8 }}>
                <Input placeholder="اختياري" disabled={viewOnly} />
              </Form.Item>
            </Col>
            {([1, 2, 3] as const).map((n) => (
              <Col xs={24} md={6} key={n}>
                <Form.Item name={`statement${n}`} label={`بيان ${n}`}
                  style={{ marginBottom: 8 }}>
                  <Input placeholder="اختياري" disabled={viewOnly} />
                </Form.Item>
              </Col>
            ))}
          </Row>

          <Divider style={{ margin: '10px 0' }} />

          <Row gutter={16}>
            <Col xs={24}>
              {!viewOnly && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 2 }}>
                  <Button data-shortcut="F2"
                    type="primary" icon={<PlusOutlined />}
                    style={{ flex: 1, height: 32, fontSize: 13, fontWeight: 700, borderRadius: 6, background: '#1677ff', borderColor: '#1677ff' }}
                    onClick={() => setPickerOpen(true)}
                  >
                    إضافة صنف للفاتورة (Enter أو F2)
                  </Button>
                  <div style={{ flexShrink: 0 }}>{lineGrid.control}</div>
                </div>
              )}

              {purchaseItems.length === 0 ? (
                <Empty description="اختر الفئة ثم الأصناف لإضافتها للفاتورة"
                  style={{ margin: '12px 0' }} />
              ) : (
                <div style={{ border: '1px solid #e6efe3', borderRadius: 10,
                              overflowX: 'auto' }}>
                  <table className="entry-grid">
                    <thead>{lineGrid.head}</thead>
                    <tbody>
                      {linesByCategory.map((group) => (
                        <React.Fragment key={group.category ?? '__none__'}>
                          {linesByCategory.length > 1 && (
                            <tr style={{ background: '#f6faf3', borderTop: '1.5px solid #1677ff', borderBottom: '1px solid #e2ede0' }}>
                              <td colSpan={20} style={{ padding: '1px 8px', background: '#f6faf3' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Tag color="blue" style={{ fontWeight: 700, fontSize: 11, padding: '0 6px', borderRadius: 3, margin: 0 }}>
                                      {group.category ? (categoryLabels[group.category] || group.category) : 'بدون فئة'}
                                    </Tag>
                                    <span style={{ color: '#555', fontSize: 11, fontWeight: 600 }}>({group.items.length} صنف)</span>
                                  </div>
                                  <span style={{ color: '#666', fontSize: 11, fontWeight: 600 }}>
                                    إجمالي الفئة: {fmtMoney(group.items.reduce((s, l) => s + lineTotal(l), 0))} ج.م
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
                    </tbody>
                    <tfoot>{lineGrid.foot(purchaseItems)}</tfoot>
                  </table>
                </div>
              )}
            </Col>
          </Row>

          <Divider />

          <TotalsLadder
            tone="sale"
            inputs={(
              <>
                <Form.Item label="خصم على الفاتورة %" style={{ marginBottom: 12 }}
                  help="يُطبَّق على مجموع السطور بعد خصم كل سطر — كفاتورة البيع">
                  <InputNumber style={{ width: '100%' }} min={0} max={99.99} step={0.5}
                    disabled={viewOnly}
                    addonAfter="%" value={variableDiscount}
                    onChange={(val) => setVariableDiscount(val || 0)} />
                </Form.Item>
                <Form.Item label="المبلغ المدفوع نقداً" style={{ marginBottom: 0 }}
                  help="الباقي بيتسجّل آجل على حساب المورد">
                  <InputNumber style={{ width: '100%' }} min={0} addonAfter="ج.م"
                    disabled={viewOnly}
                    value={cashAmount} onChange={(val) => setCashAmount(val || 0)} />
                </Form.Item>
              </>
            )}
            rows={[
              { label: 'اجمالي قبل', value: money(grossTotal) },
              { label: 'خصم فاتورة',
                value: `− ${money(grossTotal - invoiceTotal)}`,
                color: '#cf1322', show: variableDiscount > 0.001 },
              { label: 'خصم فاتورة %', value: `${variableDiscount}%`,
                show: variableDiscount > 0.001 },
              { label: 'الاجمالي', value: money(invoiceTotal),
                strong: true, color: '#6AB42D' },
              { label: 'المدفوع', value: `− ${money(cashAmount)}`,
                color: '#6AB42D', show: cashAmount > 0.001 },
              { label: 'الباقي', value: money(creditAmount),
                big: true, rule: true,
                color: creditAmount > 0.001 ? '#cf1322' : '#6AB42D' },
            ]}
          />

          {!viewOnly && (
            <Form.Item style={{ marginTop: 24, textAlign: 'left' }}>
              <Button
                type="primary"
                htmlType="submit"
                icon={<FileDoneOutlined />}
                size="large"
                loading={submitLoading}
              >
                {editingId !== null ? 'حفظ التعديل' : 'تسجيل وترحيل فاتورة الشراء'}
              </Button>
            </Form.Item>
          )}
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
      navigate(`/purchase-returns?doc=${row.id}`);
      return;
    }
    openDetail(row);
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
      render: (doc: string, r: PurchaseRecord) => (
        <Space direction="vertical" size={0}>
          <Tag color={r.kind === 'purchase' ? 'blue' : 'orange'}>{doc}</Tag>
          {r.parent_document_number && (
            <span style={{ fontSize: 11, color: '#8c8c8c' }}>عن: {r.parent_document_number}</span>
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
      render: (v: string | null) => (v === null ? '-' : `${fmtMoney(v)} ج.م`) },
    { title: 'خصم فاتورة', dataIndex: 'discount_amount', key: 'discount_amount', width: 115,
      align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.discount_amount),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)} ج.م` : '-') },
    { title: 'خصم فاتورة %', dataIndex: 'combined_pct', key: 'combined_pct', width: 110,
      align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.combined_pct),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)}%` : '-') },
    { title: 'الضرائب', dataIndex: 'tax_amount', key: 'tax_amount', width: 110, align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.tax_amount),
      render: (v: string) => (Number(v) ? `${fmtMoney(v)} ج.م` : '-') },
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
          {r.kind === 'return' ? '-' : ''}{fmtMoney(v)} ج.م
        </strong>
      )),
    },
    { title: 'الاجمالي', dataIndex: 'total', key: 'total', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.total),
      render: (val: string) => <strong style={{ color: '#6AB42D' }}>{fmtMoney(val)} ج.م</strong> },
    { title: 'تم السداد', dataIndex: 'cash_amount', key: 'cash_amount', width: 115, align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.cash_amount),
      render: (val: string | null) => (val === null ? '-' : `${fmtMoney(val)} ج.م`) },
    { title: 'الباقي', dataIndex: 'credit_amount', key: 'credit_amount', align: 'left' as const,
      ...numberColumn<PurchaseRecord>((r) => r.credit_amount),
      render: (val: string | null) => (val === null ? '-' : Number(val)
        ? <b style={{ color: '#cf1322' }}>{fmtMoney(val)} ج.م</b>
        : `${fmtMoney(val)} ج.م`) },
    { title: 'ملاحظات', dataIndex: 'notes', key: 'notes', width: 170, ellipsis: true,
      ...textColumn(purchases, (r: PurchaseRecord) => r.notes),
      render: (v: string | null) => v || '-' },
    {
      title: 'الإجراءات',
      key: 'actions',
      width: 130,
      render: (_: any, record: PurchaseRecord) => (
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
      ),
    },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  /** الأعمدة الثانوية مخفية افتراضياً — متاحة كلها من زرار «الأعمدة».
   *
   *  الجدول `tableLayout: fixed` ومن غير تمرير أفقي عن قصد، فمجموع عروض الأعمدة لما
   *  يعدّي عرض الشاشة المتصفح بيضغطهم بالنسبة — والضغط بيوصل لحد إن العنوان العربي
   *  يتلف حرف في السطر ويبقى عمود من حروف مركّبة فوق بعض. ١٧ عمود × متوسط ١٢٠px
   *  بيعدّوا ٢٠٠٠px، والشاشة العادية أقل من كده.
   *
   *  المخفي هنا نسب ومشتقات (الخصم % والضريبة % والإجمالي قبل الخصم) — بتتحسب من
   *  أعمدة معروضة أصلاً، فاللي محتاجها بيفتحها واللي مش محتاجها بيقرا جدول مقروء. */
  const listCols = useTableColumns('purchase-list', listColumns, {
    defaultHidden: ['gross', 'combined_pct', 'tax_pct', 'expense_account_name', 'notes'],
    export: { name: 'المشتريات', rows: purchasesFilter.filtered },
  });

  const listContent = (
    <Card
      title="المشتريات (سجل الفواتير والمردودات)"
      extra={(
        <Space>
          {listCols.control}
          <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
          <Button type="primary" icon={<PlusOutlined />}
            style={{ fontWeight: 600 }}
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
        </Space>
      )}
    >
      {/* --- Summary Statistics --- */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small" style={{ borderRadius: 8, borderColor: '#91caff', backgroundColor: '#e6f4ff' }}>
            <Statistic
              title="إجمالي فواتير المشتريات"
              value={money(purchasesSummary.totalPurchasesNet)}
              suffix="ج.م"
              prefix={<Tag color="blue">{purchasesSummary.totalPurchasesCount} فاتورة</Tag>}
              valueStyle={{ color: '#0958d9', fontWeight: 'bold' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" style={{ borderRadius: 8, borderColor: '#ffd591', backgroundColor: '#fff7e6' }}>
            <Statistic
              title="إجمالي مردودات المشتريات"
              value={money(purchasesSummary.totalReturnsNet)}
              suffix="ج.م"
              prefix={<Tag color="orange">{purchasesSummary.totalReturnsCount} مردود</Tag>}
              valueStyle={{ color: '#d46b08', fontWeight: 'bold' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" style={{ borderRadius: 8, borderColor: '#d9f7be', backgroundColor: '#f6ffed' }}>
            <Statistic
              title="صافي المشتريات الفعلي"
              value={money(purchasesSummary.netPurchases)}
              suffix="ج.م"
              valueStyle={{ color: '#389e0d', fontWeight: 'bold' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" style={{ borderRadius: 8, borderColor: '#ffa39e', backgroundColor: '#fff1f0' }}>
            <Statistic
              title="إجمالي المستحق للموردين"
              value={money(purchasesSummary.totalCredit)}
              suffix="ج.م"
              valueStyle={{ color: '#cf1322', fontWeight: 'bold' }}
            />
          </Card>
        </Col>
      </Row>

      {/* --- Quick Tabs / Segmented --- */}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          size="middle"
          value={purchasesFilter.values.kind || 'all'}
          onChange={(v: any) => purchasesFilter.setValue('kind', v === 'all' ? undefined : v)}
          options={[
            { label: <span>الكل ({purchasesSummary.totalPurchasesCount + purchasesSummary.totalReturnsCount})</span>, value: 'all' },
            { label: <span style={{ color: '#0958d9', fontWeight: 600 }}>🔵 فواتير المشتريات ({purchasesSummary.totalPurchasesCount})</span>, value: 'purchase' },
            { label: <span style={{ color: '#d46b08', fontWeight: 600 }}>🟠 مردودات المشتريات ({purchasesSummary.totalReturnsCount})</span>, value: 'return' },
          ]}
        />
      </div>

      <ListToolbar
        searchRef={listSearchRef}
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
        // نفس قاعدة باقي السجلات: كل عمود بمقاسه، والزيادة بتتمرّر — مش بتتوزّع على
        // عمود واحد فتطلع فراغ في نص الجدول.
        tableLayout="fixed"
        // من غير `scroll` أفقي — الشاشة مالهاش يمين وشمال.
        //
        // مع `tableLayout: fixed` وكل عمود له عرض، المتصفح بيوزّع الفرق على الأعمدة كلها
        // بالنسبة: زادت تتفرد شوية، قلّت تتضغط شوية. اللي كان بيكسّر الشكل هو عمود من غير
        // عرض — الفاضي كله كان بينزل عليه لوحده فيطلع شريط أبيض في نص الجدول.
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

      <TreasuryGate {...treasuryGate} />

      {/*
        * الباب التالت: **المخزن**.
        *
        * بيختار المخزن الافتراضي للسطور الجديدة.
        */}
      <WarehouseGate
        open={newStep === 'warehouse' && !viewOnly && editingId === null}
        title="الشحنة دي داخلة أنهي مخزن؟"
        subtitle="ده المخزن الافتراضي للسطور الجديدة. تقدر تغيّر مخزن أي سطر من عمود «المخزن»."
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
        availableFor={(id) => (stickyWarehouseId ? (availability[stickyWarehouseId]?.[id] ?? 0) : null)}
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

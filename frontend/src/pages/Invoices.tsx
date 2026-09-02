import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Divider, Empty, Form, Input, Modal, Result, Row, Segmented, Select, Space, Statistic, Table, Tag,
  Tooltip, Typography, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, PrinterOutlined, DeleteOutlined,
  EditOutlined, RollbackOutlined, EyeOutlined, ExclamationCircleOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, SearchOutlined, ClearOutlined,
  FileAddOutlined, UndoOutlined, SaveOutlined, BankOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice } from '../components/InvoiceDocument';
import CustomerAccountPanel from '../components/CustomerAccountPanel';
import PartyPickerModal, { Party } from '../components/PartyPickerModal';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import ProductPickerModal from '../components/ProductPickerModal';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import ExportExcelButton from '../components/ExportExcelButton';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
import { guardQuantity } from '../components/quantityGuard';
import { useAuth } from '../components/AuthProvider';
import TotalsLadder from '../components/TotalsLadder';
import { useLookup, labelMap } from '../hooks/useLookup';
import { TabModal } from '../components/TabModal';
import WarehouseGate from '../components/WarehouseGate';
import TreasuryGate, { useTreasuryGate } from '../components/TreasuryGate';
import DateRangeFilter from '../components/DateRangeFilter';
import { money } from '../utils/money';
import { QTY_DATA_ATTR, flashExistingItem } from '../utils/duplicateItem';

/** نافذة كتم تكرار تحذير قص الكمية — بالملي ثانية. */
const CAP_NOTICE_MS = 3000;

// حجم الصفحة في شاشة الفواتير. الكشف كله بقى 6163 فاتورة بعد نقل داتا a5،
// و«اعرض كل حاجة» بقى معناه 2.9 ميجا في كل فتحة. الفلترة والبحث على السيرفر
// فالصفحة دي مش بتخفي حاجة عن اللي بيدوّر.
const PAGE_SIZE = 300;

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

/** أسعار صنف واحد بفئاته وخصوماته. */
interface ItemPrices {
  base: number | null;
  tiers: Record<string, number>;
  discounts: Record<string, number>;
}

interface Customer {
  id: number;
  name: string;
  default_price_tier: string | null;
  /** خصم العميل نفسه — بيسبق خصم الصنف. شوف `defaultFixedDiscount`. */
  discount_pct: string | null;
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


/**
 * «نوع الفاتورة» — خط المنتجات: أبيض ولا بولي.
 *
 * القايمة دي كانت مكتوبة بإيدها في تلات حتت: خانة الترويسة، وفلتر الكشف، وعمود الكشف.
 * تلات نسخ لحاجة واحدة معناها إن اللي هيضيف خط رابع هيلاقي الشاشة بتقول حاجتين مختلفتين
 * على حسب إنت بتبص من فين. فبقت مصدر واحد، والبوّابة الجديدة بتقرا منه هي كمان بدل ما
 * تعمل نسخة رابعة.
 */
const FAMILY_OPTIONS = [
  { value: 'أبيض', label: 'أبيض' },
  { value: 'بولي', label: 'بولي' },
];

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
  rep_id?: number;
  family?: string;
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

/** الكوبونات المصروفة مع الفاتورة — صف لكل نوع، مش صف واحد للكل.
 *
 * كان مدى واحد بيسجّل إن كوبونات اتسلّمت من غير ما يقول أنهي كوبونات: مية دهبي وخمسين
 * فضي بينهم خانتين. المدى فضل على كل صف لأنه هو اللي تطبيق المرتجعات بيراجع عليه الرقم
 * الراجع؛ والنوع هو اللي بيخلّي الدفاتر تقدر تقول اتصرف إيه. */
interface CouponRow {
  key: string;
  // فئة الدفتر — عادي/فضي/ذهبي/ماسي. دي اللي بتحدد الكوبون مع رقمه، مش «كتالوج
  // الكوبونات» اللي هو عروض استبدال النقاط.
  coupon_kind?: string;
  coupon_type_id?: number;
  count?: number;
  serial_from?: string;
  serial_to?: string;
}

/** صف فاضي جديد. بيتعمل واحد من دول أول ما الفاتورة تتفتح، عشان الخانات تبقى قدام
 *  الواحد على طول من غير ما يدوس «إضافة» الأول. */
function blankCoupon(): CouponRow {
  return { key: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}` };
}

export default function Invoices() {
  const { options: categoryOptions } = useLookup('item_category');
  // فئات الورق اللي بيتسلّم للعميل. مصدر واحد: قائمة «فئات الكوبونات» في الإعدادات.
  const { options: couponKindOptions } = useLookup('coupon_kind');
  const categoryLabels = labelMap(categoryOptions);
  const navigate = useNavigate();
  const [filters, setFilters] = useState<InvoiceFilters>({});
  const [search, setSearch] = useState('');
  /**
   * خانة البحث في السجل — عشان زرار «بحث» يوصلها.
   *
   * الزرار في شريط المستند المعروض كان بيقفل المعاينة وبس. ده بيوصّلك للسجل فعلاً، بس
   * الزرار مكتوب عليه «بحث» ومعاه F3، واللي بيدوسه بيستنى خانة تستنى كتابة — فبيلاقي
   * نفسه في قايمة والمؤشر مش في حتة. القفل بيفضل جزء من الحركة، والفرق إن المؤشر
   * بينتهي في الخانة.
   */
  const listSearchRef = useRef<any>(null);
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
  const [viewOnly, setViewOnly] = useState(false);

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
  const [viewInvoice, setViewInvoice] = useState<any>(null);
  const [viewReturns, setViewReturns] = useState<any[]>([]);
  const [editingInvoice, setEditingInvoice] = useState<{ id: number; voided: boolean } | null>(null);

  // Forms
  const [createForm] = Form.useForm();

  // Create invoice dynamic lines
  const blankLine = (key: string, tier: string | null = null): SaleLineItem => ({
    key, category: null, item_id: null, quantity: null, unit_price: 0, tier, unit: null,
    serials: '', fixed_discount: 0, variable_discount: null, warehouse_id: null,
  });
  const [lines, setLines] = useState<SaleLineItem[]>([]);
  // Cache of each item's tier prices, so the line price follows the chosen tier (matches backend).
  /**
   * أسعار الصنف — وخصوماته كمان.
   *
   * `discounts` مش زيادة: خصم الصنف في النظام ده متسجّل **لكل فئة سعر** (شاشة الأصناف
   * فيها عمود خصم جنب كل فئة). الكاش كان بياخد السعر ويرمي الخصم، فالخصم اللي حد قعد
   * كتبه في الشاشة دي مكانش بيوصل الفاتورة لا عرضاً ولا حساباً.
   */
  const [pricesCache, setPricesCache] = useState<Record<number, ItemPrices>>({});
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
  // الخطين دايماً بيتعرضوا — مش الموجود بس.
  //
  // العميل اللي عنده حساب «بولي» بس كان بيتعرض بسطر عام «حساب سابق على العميل»، فالرقم
  // بيبان من غير ما يقول هو على أنهي خط؛ واللي بيبص بيسأل «طب دي مديونية إيه؟». والخط
  // اللي مالوش حساب رصيده **صفر** — ودي جملة صحيحة عن الفلوس، مش سطر ناقص.
  const FAMILIES = ['أبيض', 'بولي'];
  const families = FAMILIES.map((f) => ({
    family: f,
    balance: familyAccounts.find((a) => a.family === f)?.balance ?? '0',
  })).concat(familyAccounts.filter(
    (a) => a.family && !FAMILIES.includes(a.family)) as { family: string; balance: string }[]);
  // Coupons already issued to this customer and not yet redeemed — the counter reads out their
  // serial range when handing them over.
  const [customerCoupons, setCustomerCoupons] = useState<any[]>([]);
  // The item the side stock panel is showing. Follows whatever the user last touched — the
  // product they picked, or a line they clicked — so the panel answers the question they are
  // asking right now without them having to ask it twice.
  const [panelItemId, setPanelItemId] = useState<number | null>(null);

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
  const { can, user } = useAuth();
  const canEditInvoice = can('sale.edit');
  // بوباب الخزنة قبل الحفظ. المندوب مابيتسألش — صندوق خطه بيتحدد لوحده (أمر ٠٠٩ بند ٥)،
  // والسؤال هنا للمكتب اللي قدامه أكتر من صندوق.
  const { ask: askTreasury, gateProps: treasuryGate } = useTreasuryGate(
    user?.role !== 'sales_rep');
  const canDeleteInvoice = can('sale.delete');


  const [couponRows, setCouponRows] = useState<CouponRow[]>(() => [blankCoupon()]);
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
  /**
   * وبعد العميل بابين كمان: **المخزن** وبعده **نوع الفاتورة**.
   *
   * الاتنين كانوا خانتين في الترويسة بيتعدّى عليهم اللي مستعجل من غير ما يملاهم — والمخزن
   * من غير إجابة معناه إن كل سطر بيقرا متاح صفر، ونوع الفاتورة من غير إجابة معناه فاتورة
   * مش على خط. فبقوا سؤالين لازم يتقفلوا قبل أول سطر، زي التاريخ والعميل بالظبط.
   *
   * الخانتين في الترويسة زي ما هما وبيتغيّروا في أي وقت بعد كده — الباب بيسأل مرة، مش بيقفل
   * على حد. و«رجوع» في كل باب بيرجّع للسؤال اللي قبله، فاللي جاوب غلط مايبقاش محبوس.
   */
  const [newStep, setNewStep] = useState<null | 'date' | 'party' | 'warehouse' | 'family'>(null);
  const [party, setParty] = useState<Party | null>(null);
  // The document's warehouse — the default every line falls back to when it has none of its own.
  const [docWarehouseId, setDocWarehouseId] = useState<number | null>(null);
  /**
   * نفس القيمة، بس مقروءة في نفس اللحظة.
   *
   * الـEnter اللي بيختار المخزن من القايمة بيطلع لحارس الباب في **نفس** الحدث — قبل أي رندر —
   * فالحارس لو قرا الـstate هيلاقيها لسه فاضية ويسيب المستخدم يدوس Enter مرتين على غير لزوم.
   * الـref بتتكتب جوّه `onChange` نفسه، فالحارس بيقرا اللي المستخدم لسه مختاره.
   */
  const doorWarehouseRef = useRef<number | null>(null);
  doorWarehouseRef.current = docWarehouseId;
  /**
   * الصنف اللي مستني المخزن يتحدّد قبل ما ينزل السطر.
   *
   * كل سطر بيقيس المتاح على مخزنه، ومن غير مخزن الإجابة بتطلع صفر — «مافيش حاجة متاحة من
   * مكان مش محدّد» صح كحسبة وغلط كجملة. النتيجة إن الفاتورة كانت بتفتح وكل الكميات صفر
   * والبضاعة موجودة، والواحد يفضل يبص على أرقام مالهاش معنى.
   *
   * فالمخزن بيتسأل **مرة واحدة**، أول صنف، وبيثبت لباقي سطور الفاتورة. اللي عايز يوزّع
   * الفاتورة على أكتر من مخزن بيغيّر مخزن السطر من عموده زي ما هو.
   */
  const [pendingItems, setPendingItems] = useState<number[]>([]);
  const [pendingWarehouse, setPendingWarehouse] = useState<number | null>(null);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditAmount, setCreditAmount] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  // The category products are picked from — chosen once, stays until changed.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Sales returns list for the unified sales register
  const [salesReturns, setSalesReturns] = useState<any[]>([]);
  // إجماليات الكشف كله زي ما السيرفر حسبها — مش مجموع الصفحة اللي ظاهرة.
  const [serverSummary, setServerSummary] = useState<any>(null);
  const [docKindFilter, setDocKindFilter] = useState<'all' | 'sale' | 'return'>('all');

  // Filtering happens on the server so it covers ALL invoices, not just the loaded page.
  const fetchInvoices = async (override?: InvoiceFilters) => {
    const active = override ?? filters;
    setLoading(true);
    try {
      const params: any = {};
      Object.entries(active).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      });
      // صفحة واحدة مش الكشف كله: 6163 فاتورة = 2.9 ميجا و47 ثانية على الشبكة، والمهلة
      // 30 ثانية — فالشاشة كانت بتفصل وتقول «فشل الاتصال». الإجماليات جاية من السيرفر
      // عشان تفضل على الكشف كله مش على الصفحة.
      const [salesRes, returnsRes, sumRes] = await Promise.all([
        api.get('/api/v1/sales', { params: { ...params, limit: PAGE_SIZE } }),
        api.get('/api/v1/sales/returns', { params: { limit: PAGE_SIZE } })
          .catch(() => ({ data: [] })),
        api.get('/api/v1/sales/summary', { params }).catch(() => ({ data: null })),
      ]);
      setInvoices(salesRes.data);
      setSalesReturns(returnsRes.data || []);
      setServerSummary(sumRes.data || null);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الفواتير والمرتجعات');
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

  // Unified list merging sales and sales returns
  const unifiedRecords = useMemo(() => {
    const saleRows = (invoices || []).map((s: any) => ({
      id: s.id,
      rowKey: `sale-${s.id}`,
      doc_type: 'sale' as const,
      document_number: s.document_number,
      original_invoice_number: null,
      external_document_number: s.external_document_number,
      date: String(s.invoice_date || s.created_at || '').slice(0, 10),
      customer_id: s.customer_id,
      rep_id: s.rep_id,
      // الأسماء والتصنيف جايين مع الصف من السيرفر. الصف الموحّد بينسخ الحقول
      // بالاسم، فاللي مش مكتوب هنا بيوصل للجدول فاضي مهما كان الرد كامل — وده
      // اللي كان بيخلّي «النوع» فاضي والأسماء تستنى كشف العملاء يتحمّل.
      customer_name: s.customer_name,
      rep_name: s.rep_name,
      customer_type: s.customer_type,
      revenue_account_id: s.revenue_account_id,
      family: s.family,
      gross: Number(s.gross || 0),
      combined_pct: Number(s.combined_pct || 0),
      discount_value: Number(s.gross || 0) * (Number(s.combined_pct || 0) / 100),
      net: Number(s.net || 0),
      cash_amount: Number(s.cash_amount || 0),
      credit_amount: Number(s.credit_amount || 0),
      ledger_entry_id: s.ledger_entry_id,
      raw: s,
    }));

    const returnRows = (salesReturns || []).map((r: any) => ({
      id: r.id,
      rowKey: `ret-${r.id}`,
      doc_type: 'return' as const,
      document_number: r.document_number,
      original_invoice_number: r.invoice_document_number,
      external_document_number: r.external_document_number,
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
      discount_value: Number(r.gross || 0) * (Number(r.combined_pct || 0) / 100),
      net: Number(r.net || 0),
      cash_amount: Number(r.cash_refund || 0),
      credit_amount: Number(r.credit_reduction || 0),
      ledger_entry_id: r.ledger_entry_id,
      raw: r,
    }));

    let combined: any[] = [];
    if (docKindFilter === 'all') {
      combined = [...saleRows, ...returnRows];
    } else if (docKindFilter === 'sale') {
      combined = saleRows;
    } else {
      combined = returnRows;
    }

    return combined.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
  }, [invoices, salesReturns, docKindFilter]);

  // Live summary of sales, returns, and net sales
  const summary = useMemo(() => {
    const totalSalesCount = (invoices || []).length;
    const totalReturnsCount = (salesReturns || []).length;
    const totalSalesNet = (invoices || []).reduce((s: number, i: any) => s + Number(i.net || 0), 0);
    const totalReturnsNet = (salesReturns || []).reduce((s: number, r: any) => s + Number(r.net || 0), 0);
    const netSales = totalSalesNet - totalReturnsNet;
    const totalCredit = (invoices || []).reduce((s: number, i: any) => s + Number(i.credit_amount || 0), 0)
      - (salesReturns || []).reduce((s: number, r: any) => s + Number(r.credit_reduction || 0), 0);

    // السيرفر بيحسب على الكشف كله؛ الجمع المحلي فاضل كخطة بديلة لو النداء وقع.
    const s = serverSummary;
    return {
      totalSalesCount: s ? Number(s.sales_count) : totalSalesCount,
      totalReturnsCount: s ? Number(s.returns_count) : totalReturnsCount,
      totalSalesNet: s ? Number(s.sales_net) : totalSalesNet,
      totalReturnsNet: s ? Number(s.returns_net) : totalReturnsNet,
      netSales: s ? Number(s.net_sales) : netSales,
      totalCredit: s ? Number(s.credit_outstanding) : totalCredit,
      filteredCount: unifiedRecords.length,
    };
  }, [invoices, salesReturns, unifiedRecords, serverSummary]);

  const loadLookups = async () => {
    try {
      const [custRes, prodRes, whRes, ptRes, empRes, userRes, acctRes,
        brRes] = await Promise.all([
        api.get('/api/v1/customers/options', { params: { limit: 2000 } }),
        api.get('/api/v1/items?kind=product'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/products/point-values'),
        api.get('/api/v1/employees', { params: { active: true } }),
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

  /**
   * خصم السطر كنسبة واحدة — الثابت بتاع الصنف زائد اللي اتكتب، بحد ٩٩٫٩٩.
   *
   * الجدول بيعرض النسبة دي وقيمتها بالجنيه في عمودين، زي فاتورة الشرا: «١٠٪» مابتقولش
   * كام اتخصم، والمراجعة بتحصل بالجنيه.
   */
  /**
   * الخصم الثابت اللي السطر بيفتح عليه.
   *
   * **خصم العميل بيسبق خصم الصنف** — ودي مش تفضيلة، دي نفس الأولوية اللي السيرفر
   * بيحسب بيها لما السطر ييجي من غير خصم (`sales_service`):
   *
   *     خصم السطر  ←  خصم العميل  ←  خصم الصنف
   *
   * والشاشة كانت بتاخد خصم الصنف على طول وتتجاهل خصم العميل. وعشان الشاشة **بتبعت**
   * الخصم صريح في كل سطر، السيرفر مكانش بيوصله دوره أصلاً — فالعميل اللي متسجّل عليه
   * خصم خاص كان بياخد خصم الصنف وخلاص، والخصم اللي حد قعد سجّله عليه مابيتحسبش ولا مرة.
   */
  const defaultFixedDiscount = (itemId: number | null, fresh?: ItemPrices): number => {
    // ١) خصم العميل نفسه — اتسجّل على الشخص، فهو أخص من أي حاجة على الصنف.
    const cust = customers.find((c) => c.id === selectedCustomerId);
    if (cust?.discount_pct != null && cust.discount_pct !== '') {
      return parseFloat(cust.discount_pct) || 0;
    }
    // ٢) خصم فئة السعر بتاعته — «تاجر» مابياخدش زي «مستهلك»، وده مكتوب جنب سعر الفئة.
    const tier = customerTier;
    const cached = fresh ?? (itemId ? pricesCache[itemId] : undefined);
    if (tier && cached?.discounts?.[tier]) return cached.discounts[tier];
    // ٣) وأخيراً خصم الصنف العام.
    const prod = products.find((p) => p.id === itemId);
    return prod?.default_discount_pct ? parseFloat(prod.default_discount_pct) : 0;
  };

  const lineDiscountPct = (l: SaleLineItem) =>
    Math.min(99.99, (l.fixed_discount || 0) + (l.variable_discount || 0));

  /**
   * الكمية بعد ما الحارس يقيسها على المتاح.
   *
   * مكتوبة مرة عشان الخروج من الخانة وEnter يقيسوا نفس القياس. لو اتكتبت مرتين، أول تعديل
   * على واحدة منهم بيخلّي الطريقين بيقيسوا حاجتين مختلفتين — واللي بيكمّل بالكيبورد مش
   * بيخرج من الخانة أصلاً، فطريقه هو اللي كان هيفضل من غير حراسة.
   */
  const checkedQuantity = (l: SaleLineItem) => guardQuantity({
    value: l.quantity,
    // من غير مخزن مافيش «متاح» — والحارس بيفرّق بين «مش معروف» وصفر.
    available: l.warehouse_id
      ? availableFor(l.item_id, l.unit, l.warehouse_id) : undefined,
    itemName: l.item_id ? productName(l.item_id) : null,
  }, null);

  /** صافي السطر — نفس `lineTotal`، باسم بيقول إنه اللي بيتعرض في العمود الأخير. */
  const saleLineNet = (l: SaleLineItem) => lineTotal(l);

  /**
   * خيارات الوحدة — وفيها **دايماً** خيار الوحدة الأساسية.
   */
  const saleUnitOptions = (itemId: number | null) => {
    const units = unitsCache[itemId || 0] || [];
    const base = units.find((u) => u.is_base);
    return [
      { value: '__base__', label: base?.name || 'الأساسية' },
      ...units.filter((u) => !u.is_base)
        .map((u) => ({ value: u.name, label: `${u.name} (×${u.factor})` })),
    ];
  };

  /**
   * Enter معناها «السطر ده خلص» — ننتقل للسطر اللي بعده، وآخر سطر بيفتح بوباب الأصناف.
   */
  const advanceFrom = (key: string) => {
    const idx = lines.findIndex((l) => l.key === key);
    const next = idx >= 0 ? lines[idx + 1] : undefined;
    if (next) { setFocusLineKey(next.key); return; }
    setPickerOpen(true);
  };

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

  /**
   * أعمدة شبكة سطور الفاتورة كبيانات — بأبعاد متناسقة ومساحات مريحة.
   */
  const lineColumns: EntryColumn<SaleLineItem>[] = [
    { key: 'idx', title: '#', width: 28, locked: true,
      cellStyle: { color: '#6b6b6b', textAlign: 'center' }, cell: (_l, i) => i + 1 },
    // المخزن بيتغيّر من السطر — بالإيد، ولوحده أبداً.
    //
    // تغييره هنا بيغيّر مخزن الفاتورة كمان، فالأصناف اللي بتتضاف بعده بتنزل على نفس
    // المخزن من غير ما تتقال تاني. السطور اللي اتكتبت قبل كده بتفضل مكانها: اللي اتقال
    // مرة مايتغيّرش من ورا اللي كتبه.
    { key: 'warehouse', title: 'المخزن', minWidth: 120,
      cell: (line) => (
        viewOnly ? (
          <span style={{ fontSize: 12 }}>{warehouses.find((w) => w.id === line.warehouse_id)?.name || '-'}</span>
        ) : (
          <Select size="small" style={{ width: '100%' }} placeholder="المخزن"
            value={line.warehouse_id ?? undefined}
            onChange={(v) => {
              handleLineChange(line.key, 'warehouse_id', v ?? null);
              if (v != null) setDocWarehouseId(v as number);
            }}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
        )
      ) },
    { key: 'item', title: 'الصنف', minWidth: 170, locked: true,
      cell: (line) => (
        <b style={{ cursor: 'pointer', fontSize: 13 }} onClick={() => setPanelItemId(line.item_id)}>
          {line.item_id ? productName(line.item_id) : 'اختر الصنف'}
        </b>
      ) },
    { key: 'unit', title: 'الوحدة', minWidth: 80,
      cell: (line) => (
        viewOnly ? (
          <span style={{ fontSize: 12 }}>{line.unit || 'أساسية'}</span>
        ) : (
          <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
            value={line.unit ?? '__base__'}
            onChange={(v) => handleLineChange(line.key, 'unit', v === '__base__' ? null : v)}
            options={saleUnitOptions(line.item_id)} />
        )
      ) },
    { key: 'quantity', title: 'الكمية', minWidth: 70, locked: true,
      cellProps: (line) => (line.item_id != null
        ? { [QTY_DATA_ATTR]: line.item_id } as any : {}),
      cell: (line) => (
        viewOnly ? (
          <b>{Number(line.quantity || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 })}</b>
        ) : (
          <InputNumber size="small" style={{ width: '100%' }} min={0.001}
            data-qty-key={line.key} data-grid-col="qty" keyboard={false}
            placeholder="الكمية" value={line.quantity ?? undefined}
            onChange={(val) => handleLineChange(line.key, 'quantity', val ?? null)}
            onBlur={() => handleLineChange(line.key, 'quantity', checkedQuantity(line))}
            onPressEnter={(e) => {
              e.preventDefault();
              handleLineChange(line.key, 'quantity', checkedQuantity(line));
              advanceFrom(line.key);
            }} />
        )
      ),
      footer: (rows) => rows.reduce((n, l) => n + Number(l.quantity || 0), 0)
        .toLocaleString('ar-EG', { maximumFractionDigits: 3 }) },
    { key: 'unit_price', title: 'سعر الوحدة', minWidth: 80,
      cell: (line) => (
        viewOnly ? (
          <span>{money(line.unit_price)} ج.م</span>
        ) : (
          <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
            placeholder="السعر" value={line.unit_price}
            onChange={(v) => handleLineChange(line.key, 'unit_price', v || 0)}
            onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
        )
      ),
      footer: () => null },
    { key: 'gross', title: 'اجمالي قبل', minWidth: 85,
      cellStyle: { whiteSpace: 'nowrap' },
      cell: (line) => money(Number(line.quantity || 0) * (line.unit_price || 0)),
      footer: (rows) => money(rows.reduce(
        (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0)) },
    { key: 'variable_discount', title: 'خصم متغير %', minWidth: 75,
      cell: (line) => (
        viewOnly ? (
          <span>{line.variable_discount != null ? `${line.variable_discount}%` : '-'}</span>
        ) : (
          <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
            placeholder="متغير" value={line.variable_discount ?? undefined}
            onChange={(v) => handleLineChange(line.key, 'variable_discount', (v as number) ?? null)}
            onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
        )
      ),
      footer: () => null },
    { key: 'fixed_discount', title: 'خصم ثابت %', minWidth: 75,
      cell: (line) => (
        viewOnly ? (
          <span>{line.fixed_discount ? `${line.fixed_discount}%` : '-'}</span>
        ) : (
          <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
            placeholder="ثابت" value={line.fixed_discount ?? undefined}
            onChange={(v) => handleLineChange(line.key, 'fixed_discount', (v as number) ?? 0)}
            onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
        )
      ),
      footer: () => null },
    { key: 'total', title: 'الإجمالي', minWidth: 90, locked: true,
      cellStyle: { fontWeight: 700, whiteSpace: 'nowrap' },
      cell: (line) => money(saleLineNet(line)),
      footer: (rows) => money(rows.reduce((n, l) => n + saleLineNet(l), 0)) },
    { key: 'points', title: 'النقاط', minWidth: 65,
      cellStyle: { whiteSpace: 'nowrap', color: '#b26a00' },
      // «مالوش نقط» و«لسه ماكتبتش الكمية» كانوا شكلهم واحد: شرطة. النقط = نقطة الصنف
      // × الكمية، فسطر لسه كميته فاضية بيطلع صفر — واللي بيبص بيفتكر إن الصنف مالوش
      // نقط أصلاً ويسأل ليه.
      cell: (line) => {
        const v = linePoints(line);
        if (v) return v.toLocaleString('ar-EG', { maximumFractionDigits: 3 });
        const per = line.item_id ? (pointValues[line.item_id] || 0) : 0;
        if (per > 0) {
          return (
            <span style={{ color: '#b0b0b0' }} title={`${per} نقطة للوحدة`}>
              × {per.toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
            </span>
          );
        }
        return '-';
      },
      footer: () => (
        <span style={{ color: '#b26a00' }}>
          {totalPoints.toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
        </span>
      ) },
    { key: 'actions', title: '', label: 'حذف السطر', width: 32, locked: true,
      cell: (line) => (
        viewOnly ? null : (
          <Button size="small" danger type="text" icon={<DeleteOutlined />}
            onClick={() => handleRemoveLine(line.key)} />
        )
      ),
      footer: () => null },
  ];
  const lineGrid = useEntryGrid('invoice-lines-grid', lineColumns);

  const totalPoints = lines.reduce((sum, line) => sum + linePoints(line), 0);

  // credit = net − cash, SIGNED: positive → the remainder is added to the customer's account;
  // negative → the customer overpaid and the surplus settles his prior balance (028).
  useEffect(() => {
    const cash = parseFloat(cashAmount.toString()) || 0;
    setCreditAmount(parseFloat((netTotal - cash).toFixed(2)));
  }, [cashAmount, netTotal, discountPct]);

  /**
   * تفضية **كل** اللي بيخص مستند واحد — المكان الوحيد اللي بيحصل فيه ده.
   *
   * الحالة كانت بتتفضّى في تلات أماكن مختلفة (القفل، «جديد»، وبعد الحفظ) وكل واحد فيهم
   * بينسى حاجة غير التاني: الحفظ كان بيفضّي السطور وينسى **صفوف الكوبونات**، وزرار «تسجيل
   * فاتورة بيع» في الشاشة الرئيسية مكانش بيفضّي أي حاجة أصلاً. النتيجة اللي شافها المستخدم:
   * يقفل فاتورة ويفتح واحدة جديدة فيلاقي كوبونات اللي قبلها مكتوبة قدامه — ويحفظها وهو مش
   * واخد باله إنها مش بتاعته.
   *
   * فبقت دالة واحدة، وكل مدخل «مستند جديد» بيعدّي عليها. أي حالة جديدة تخص المستند تتحط
   * هنا وبس — كده مافيش مدخل بينساها.
   *
   * ⚠️ الدالة دي **مش** للمستند القديم اللي بيتفتح للعرض أو التعديل: `openDetail` بيملا
   * الحالة من المستند نفسه.
   *
   * بتسيب `newStep` على `null` وبتقفل المناتق — اللي بيفتح مستند جديد بيبدأ دورة الأبواب
   * من أول خطوة بنفسه بعد النداء.
   */
  const resetDocument = () => {
    setViewOnly(false);
    setViewInvoice(null);
    setViewReturns([]);
    setEditingInvoice(null);
    setLines([]);
    setCouponRows([blankCoupon()]);
    setCustomerCoupons([]);
    setActiveCategory(null);
    setPanelItemId(null);
    setFocusLineKey(null);
    setCashAmount(0);
    setCreditAmount(0);
    setDiscountPct(0);
    setSelectedCustomerId(null);
    setCustomerTier(null);
    setCustomerBalance(null);
    setFamilyAccounts([]);
    setInvoiceFamily(null);
    setAvailability({});
    setParty(null);
    setDocWarehouseId(null);
    setPendingItems([]);
    setPendingWarehouse(null);
    setPickerOpen(false);
    setPartyPickerOpen(false);
    setNewStep(null);
    setInvoiceDate(dayjs());
    createForm.resetFields();
  };

  // Close the create page and clear it, so reopening starts fresh.
  const closeCreate = () => {
    resetDocument();
    setCreateVisible(false);
  };

  // Type a product name → it's added to the invoice immediately (POS-style, fastest path).
  /**
   * نفس `addProductById` بمخزن **صريح**.
   *
   * ضروري لأن `setDocWarehouseId` مابيغيّرش القيمة في نفس اللفّة — لو ندهنا الدالة العادية
   * بعده على طول، هتقرا `docWarehouseId` القديمة (null) وتنزل السطر من غير مخزن، وهي دي
   * المشكلة اللي بنحلها أصلاً.
   */
  /**
   * أنهي مخزن ينزل عليه السطر: المخزن المختار، وبس.
   *
   * مافيش تدوير أوتوماتيكي على مخزن تاني فيه الصنف. اللي عايز يصرف من مخزن غير ده بيغيّره
   * من عمود «المخزن» على السطر، واللي بعده بينزل على اللي هو اختاره.
   */
  const addProductByIdWith = async (itemId: number, warehouseId: number) => {
    const fresh = await fetchPrices(itemId);
    const prod = products.find((p) => p.id === itemId);
    const tier = customerTier || 'consumer';
    const l = blankLine(Date.now().toString(), tier);
    // يثبت على المخزن المختار فقط ولا يتم تغييره تلقائياً
    l.warehouse_id = warehouseId;
    l.category = prod?.category ?? null;
    l.item_id = itemId;
    l.unit_price = resolvePrice(itemId, tier, null, fresh);
    l.fixed_discount = defaultFixedDiscount(itemId, fresh);
    const existing = lines.find((x) => x.item_id === itemId);
    if (existing) {
      flashExistingItem(itemId);
      message.info(`«${productName(itemId)}» موجود بالفعل — عدّل الكمية من السطر`);
      return;
    }
    setLines((prev) => [...prev, l]);
    setFocusLineKey(l.key);
  };

  const addProductById = async (itemId: number) => {
    if (!itemId) return;
    if (docWarehouseId === null) {
      setPendingItems((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
      setPendingWarehouse((prev) => prev ?? warehouses[0]?.id ?? null);
      return;
    }
    const fresh = await fetchPrices(itemId);
    const prod = products.find((p) => p.id === itemId);
    const tier = customerTier || 'consumer';
    const l = blankLine(Date.now().toString(), tier);
    // يثبت على مخزن الفاتورة المختار فقط
    l.warehouse_id = docWarehouseId;
    l.category = prod?.category ?? null;
    l.item_id = itemId;
    l.unit_price = resolvePrice(itemId, tier, null, fresh);
    l.fixed_discount = defaultFixedDiscount(itemId, fresh);
    const existing = lines.find((x) => x.item_id === itemId);
    if (existing) {
      flashExistingItem(itemId);
      message.info(`«${productName(itemId)}» موجود بالفعل — عدّل الكمية من السطر`);
      return;
    }
    setLines((prev) => [...prev, l]);
    setFocusLineKey(l.key);
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
  const resolvePrice = (itemId: number, tier: string | null, unit: string | null,
                        fresh?: ItemPrices): number => {
    // `fresh` هي اللي لسه راجعة من السيرفر — بتكسب الكاش لأن الكاش لسه ما اتحدّثش.
    const c = fresh ?? pricesCache[itemId];
    let base: number;
    if (!c) {
      const prod = products.find((p) => p.id === itemId);
      base = prod?.sale_price ? parseFloat(prod.sale_price) : 0;
    } else {
      base = (tier && c.tiers[tier] != null) ? c.tiers[tier] : (c.base ?? 0);
    }
    return base * unitFactor(itemId, unit);
  };

  /**
   * بتجيب أسعار الصنف **وبترجّعها**.
   *
   * الرجوع ده مش رفاهية: `setPricesCache` مابيغيّرش الكاش في نفس اللفّة، واللي بينده
   * `fetchPrices` محتاج الأسعار **حالاً** عشان يسعّر السطر اللي بيضيفه. فأول إضافة لصنف
   * كانت بتقرا كاش فاضي — السعر بيرجع لسعر الصنف الأساسي بدل سعر فئة العميل، والخصم
   * بيطلع صفر. وبيتظبطوا لوحدهم لو الصنف اتضاف تاني، وده اللي بيخلّي المشكلة تبان
   * «بتحصل أحياناً».
   */
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
    if (!unitsCache[itemId]) {
      try {
        const res = await api.get(`/api/v1/items/${itemId}/units`);
        setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({ name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
      } catch (err) { console.error(err); }
    }
    return fresh;
  };

  /**
   * تحذير القص — مرة واحدة لكل محاولة، مش لكل ضغطة زرار.
   *
   * القص بيحصل على كل `onChange`: اللي بيكتب «١٠٠» بيعدّي على «١» و«١٠» و«١٠٠»، واللي
   * ماسك سهم الزيادة بيبعت عشرات التغييرات في تانية واحدة. رسالة على كل واحدة فيهم
   * بتبني برج إشعارات فوق الفاتورة، والنتيجة إن محدش بيقرا ولا واحدة — وهي بالظبط
   * الرسالة اللي كان لازم تتقرا.
   *
   * فالبصمة (سطر × مخزن × رصيد) بتتقال مرة، وأي محاولة تانية بنفس البصمة جوّه النافذة
   * بتجدّد الوقت من غير ما تطلّع رسالة. يعني ضغط متواصل = رسالة واحدة، ووقفة وبعدها
   * محاولة جديدة = رسالة جديدة، لأنها بقت خبر تاني مش تكرار.
   */
  const capNoticeRef = useRef<Record<string, number>>({});
  /** شبّاك واحد في المرة — من غيره الضغط المتواصل بيكوّم شبابيك فوق بعض. */
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
    const n = stock.toLocaleString('ar-EG', { maximumFractionDigits: 3 });
    // شبّاك بيتقفل بضغطة، مش رسالة بتعدّي لوحدها.
    //
    // القص بيغيّر رقم اللي بيكتب تحت إيده. التوست بيروح بعد تلات ثواني — واللي بيكتب
    // بسرعة بيلاقي الرقم اتغيّر ومايعرفش ليه، وده كان البلاغ الأصلي. الشبّاك بيوقّف
    // الإيد لحظة ويخلّي الرقم الجديد قرار متشاف مش مفاجأة.
    //
    // الاسم والمخزن جوّه النص عن قصد: الفاتورة فيها سطور كتير.
    if (capModalOpenRef.current) return;   // واحد بس في المرة — مايتكوّمش
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
          updated.fixed_discount = defaultFixedDiscount(value as number, fresh);
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

  /**
   * العميل اللي حساباته وصلت متأخرة: الخيارات بتتبدّل تحت إيد اللي بيختار.
   *
   * الباب بيفتح دايماً — «نوع الفاتورة» سؤال عن خط المنتجات، وله معنى حتى للعميل
   * اللي عنده حساب واحد. اللي بيتغيّر لما الحسابات توصل هو **مصدر الخيارات**:
   * حسابات العميل لو مقسوم، وأبيض/بولي لو لأ (`familyChoices`).
   *
   * وكان هنا حارس بيقفل الباب لما الحسابات تبقى واحد أو أقل. ده اتحط عشان السيرفر
   * كان بيرفض خط مالوش حساب مطابق، والرفض بقى مرفوع من `receivable_account`:
   * الخط بيتقبل كلافتة على المستند لما يكون فيه حساب واحد بس. الحارس فضل مكانه
   * بعد التصليح فكان بيقفل الباب على أغلب العملاء — ده اللي خلّى البوباب يختفي.
   */
  useEffect(() => {
    // الاختيار اللي بقى مش موجود في الخيارات الجديدة بيتفضّى — مايتسابش مشاور على
    // حساب مش بتاع العميل ده.
    if (newStep !== 'family' || !invoiceFamily) return;
    const allowed = familyChoices().map((o) => o.value);
    if (!allowed.includes(invoiceFamily)) setInvoiceFamily(null);
  }, [newStep, families.length]);

  /** Chosen from the picker (existing or just-created) — fills the form and the header strip. */
  const handlePartyPicked = (picked: Party) => {
    setParty(picked);
    setPartyPickerOpen(false);
    // Mid-invoice this only swaps the party — nothing restarts. During the opening sequence it is
    // the second door, so it hands over to the third rather than opening the document.
    // The customer is the last question. His rep fills in المندوب and the rep's store fills in
    // المستودع, so the document opens knowing all three.
    //
    // الصفحة بتتفتح ورا الباب مش بعده: الاختيار بينزل في الترويسة قدام اللي بيختار وهو
    // لسه في الدورة، فيشوف اللي قاله بدل ما يستنى لحد ما تخلص عشان يتأكد.
    if (newStep === 'party') { setNewStep('warehouse'); setCreateVisible(true); }
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

  /**
   * الباب اللي بعد المخزن — ولا ولا حاجة.
   *
   * «نوع الفاتورة» سؤال عن حساب العميل، فمابيتسألش غير لما يكون عنده أكتر من حساب فعلاً.
   * العميل العادي عنده واحد بس، والدورة بتخلص عند المخزن وتفتح المستند على طول.
   */
  const afterWarehouseStep = (): null | 'family' => 'family';

  /** خيارات باب «نوع الفاتورة».
   *
   *  العميل المقسوم (أكتر من حساب) بيتسأل عن حساباته هو — الاختيار بيحدد الرصيد اللي
   *  هيتحرّك. والعميل العادي بيتسأل عن خط المنتجات (أبيض/بولي) وده بيتكتب على المستند
   *  بس: حسابه واحد ومافيش رصيد تاني يروح له. الفرق ده هو اللي بيخلّي السؤال ينفع
   *  يتسأل للاتنين من غير ما فاتورة تترفض بعد ما تتكتب. */
  const familyChoices = (): { value: string; label: string }[] => (
    families.length > 1
      ? families.map((a) => ({ value: a.family as string, label: a.family as string }))
      : FAMILY_OPTIONS
  );

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

  /**
   * اللي الحارس بيتأكد منه على سطر البيع.
   *
   * The availability is passed as `undefined` — «not known» — until the line has a warehouse.
   * `availableFor` answers 0 for a line with no store, which is true as arithmetic and false as a
   * statement: nothing is available from nowhere. Handing that to the guard made it refuse every
   * quantity typed before a store was picked, and tell the person «المتاح ٠» about an item sitting
   * on a shelf. The save still checks, and so does the server.
   */
  const lineQuantityCheck = (line: SaleLineItem) => {
    const wh = lineWarehouse(line);
    return {
      value: line.quantity,
      available: wh ? availableFor(line.item_id, line.unit, wh) : undefined,
      itemName: products.find((p) => p.id === line.item_id)?.name,
      unit: line.unit,
    };
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
      // مخزن المندوب بقى المخزن الافتراضي للسطور — الترويسة مافيهاش خانة مخزن، والسطر
      // بيبدأ عليه ويتغيّر لو حبيت.
      const store = storeOfRep(c.rep_id);
      if (store && !docWarehouseId) {
        setDocWarehouseId(store);
        loadWarehouseStock(store);
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
        // مابيكتبش على اختيار المستخدم. الطلب ده بيتبعت في نفس اللحظة اللي باب
        // «نوع الفاتورة» بيتفتح فيها، فالرد المتأخر كان بيمسح اللي اختاره لسه.
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
    // مافيش فحص على «النقدي + الآجل = الصافي» هنا.
    //
    // الشاشة بتعرف صافي السطور بس؛ المستحق الحقيقي فيه الضريبة ومصروفات العميل، وده
    // السيرفر اللي بيحسبه. فالفحص هنا كان بيقارن رقمين مختلفين ويرفض فواتير سليمة —
    // وأول ما تتحط ضريبة أو مصروف على العميل تقع الفاتورة من غير سبب مفهوم.
    //
    // الآجل بيتبعت للسيرفر، وهو بيتأكد منه — ولو اتساب فاضي بيحسبه من المستحق ناقص النقدي.

    const validLines = lines.filter((l) => l.item_id !== null);
    const validCoupons = couponRows.filter(
      (r) => Boolean(r.coupon_kind || r.serial_from || r.serial_to));
    if (validLines.length === 0 && validCoupons.length === 0) {
      message.error('يرجى إضافة منتج أو تسجيل كوبونات لحفظ الفاتورة!');
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

    // بوباب الخزنة (أمر ٠٠٩ بند ٤): فاتورة البيع **بتضيف** للخزنة، والاقتراح صندوق خط
    // الفاتورة. الحفظ بيتم بعد الاختيار — والرجوع مابيحفظش. نقدي بصفر (كله آجل) يعني
    // مافيش فلوس بتتحرّك، فالبوباب مابيظهرش والحفظ بيعدّي على طول.
    askTreasury(
      {
        amount: Number(cashAmount) || 0,
        direction: 'in',
        family: invoiceFamily,
        docLabel: 'فاتورة البيع',
      },
      async (cashAccountId) => {
        try {
          // التعديل بيروح للفاتورة نفسها. كان بيعكسها الأول وبعدين يكتب واحدة جديدة، فتصليح
          // سعر كان بيسيب وراه مرتجع محدش رجّعه ورقم فاتورة جديد على الورقة اللي في إيد
          // العميل. دلوقتي الفاتورة بتتحفظ في مكانها زي أي شاشة تعديل.
          const editingId = editingInvoice?.id;
          const send = editingId
            ? (b: any) => api.put(`/api/v1/sales/${editingId}`, b)
            : (b: any) => api.post('/api/v1/sales', b);
          await send({
            customer_id: values.customer_id,
            // Who sold it. Recorded on the document so a commission report and a rep's own list of
            // invoices do not have to re-derive it from whoever owns the customer today.
            rep_id: values.rep_id ?? null,
            origin: {
              location_kind: 'warehouse',
              location_id: validLines[0]?.warehouse_id ?? docWarehouseId ?? warehouses[0]?.id ?? 1,
            },
            variable_discount_pct: discountPct,
            cash_amount: cashAmount,
            // مش متبعوت عن قصد: السيرفر بيحسبه من المستحق (اللي فيه الضريبة والمصروفات)
            // ناقص النقدي. اللي على الشاشة تقدير للعرض، والحقيقة عند اللي بيرحّل.
            credit_amount: undefined,
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
              .filter((r) => r.coupon_kind || r.serial_from || r.serial_to)
              .map((r) => ({
                coupon_kind: r.coupon_kind ?? null,
                // Sent as the range implies it. Sending a separately-typed number was how an invoice
                // came to claim a book size its serials do not support.
                count: couponCount(r.serial_from, r.serial_to),
                serial_from: r.serial_from || null,
                serial_to: r.serial_to || null,
              })),
            notes: values.notes || undefined,
            statement1: values.statement1 || undefined,
            statement2: values.statement2 || undefined,
            statement3: values.statement3 || undefined,
            // Which of his accounts this invoice posts to. Null for a customer who has only one.
            family: invoiceFamily,
            // (٠٠٩) الخزنة اللي البوباب سأل عنها. `undefined` = مااتسألش أصلاً — نقدي بصفر
            // أو مافيش صناديق — والسيرفر بيقرر زي ما هو بيعمل دلوقتي.
            cash_account_id: cashAccountId ?? undefined,
          });

          message.success(editingInvoice
            ? 'اتعدّلت الفاتورة واترحّلت من جديد' : 'تم تسجيل فاتورة البيع بنجاح');
          // تفضية كاملة بعد الحفظ. كانت تفضية بالإيد بتشيل السطور والخصم والنقدي وتسيب
          // **صفوف الكوبونات** والعميل والمخزن ونوع الفاتورة مكانهم — فأول فاتورة بعدها
          // بتفتح وفيها كوبونات فاتورة غيرها.
          closeCreate();
          fetchInvoices();
        } catch (err: any) {
          console.error(err);
          message.error(err?.response?.data?.detail?.message || 'تعذر حفظ الفاتورة');
        }
      },
    );
  };

  /**
   * حذف الفاتورة — بتتمسح هي وأثرها.
   *
   * كانت بتتعكس: يتكتب مرتجع بأصنافها وقيد مضاد بمبلغها، وتفضل في السجل ومعاها مستند
   * تاني بيشرح إنها اتلغت. ده أسلوب دفتر أستاذ محاسبي، والشركة مش بتشتغل بيه — الفاتورة
   * الغلط بتتمسح، وخلاص. السيرفر بيشيل الحركة المخزنية والقيد والنقاط ويرجّع السيريالات
   * والدفعات (شوف `document_edit_service`).
   */
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

  /**
   * تعديل فاتورة مرحّلة — بتتفتح في المحرّر بمحتواها، من غير أي حركة على الدفاتر.
   *
   * المستند المرحّل مابيتعدلش في مكانه، فالحفظ هو اللي بيعكس القديمة ويرحّل الجديدة مكانها —
   * وبسؤال صريح قبل العكس. اللي فتح وغيّر رأيه وقفل، سيب المخزون والقيد زي ما هم.
   */
  const handleEditInvoice = async (record: InvoiceRecord) => {
    await openDetail(record);
    if (!canEditInvoice) {
      message.warning('ليس لديك صلاحية تعديل الفواتير');
      return;
    }
    setViewOnly(false);
    message.info(`الفاتورة ${record.document_number} مفتوحة الآن للتعديل`);
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
    const id = searchParams.get('id');
    if (doc || edit || id) {
      pendingIntent.current = { id: Number(doc || edit || id), mode: edit ? 'edit' : 'view' };
      // Cleared immediately so a refresh, or returning to this tab later, cannot replay it.
      setSearchParams({}, { replace: true });
    }
    const wanted = pendingIntent.current;
    if (!wanted) return;
    pendingIntent.current = null;
    const target = invoices.find((i) => i.id === wanted.id) || ({ id: wanted.id } as InvoiceRecord);
    if (wanted.mode === 'view') openDetail(target);
    else handleEditInvoice(target);
  }, [searchParams, invoices]);



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

  // Open a read-only detail view inside the full document page: invoice header + lines + its returns.
  const openDetail = async (record: InvoiceRecord) => {
    try {
      setLoading(true);
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
      setViewReturns(rets);
      setEditingInvoice({ id: record.id, voided: alreadyVoid });
      setViewOnly(true);

      // Refill lines
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
          fixed_discount: Number(l.discount_pct) || 0,
          variable_discount: 0,
          warehouse_id: l.warehouse_id ?? null,
        } as SaleLineItem;
      });

      setLines(refilled);
      setDiscountPct(Number(det.variable_discount_pct ?? det.discount_pct ?? 0));
      setCashAmount(Number(det.cash_amount) || 0);
      setInvoiceDate(dayjs(det.invoice_date || det.created_at || undefined));
      setInvoiceFamily(det.family || null);
      createForm.setFieldsValue({
        customer_id: det.customer_id,
        rep_id: det.rep_id,
        external_document_number: det.external_document_number,
        notes: det.notes,
        statement1: det.statement1,
        statement2: det.statement2,
        statement3: det.statement3,
      });

      setSelectedCustomerId(det.customer_id);
      const first = (det.lines || [])[0];
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

      // Coupons
      //
      // **الحقل اسمه `coupons` مش `coupon_rows`.** السيرفر بيرجّعه كده من الأول
      // (`SalesInvoiceDetail.coupons`)، والشاشة كانت بتقرا اسم مالوش وجود — فبيطلع
      // `undefined` على طول، وبتقع على الشكل القديم (`coupon_serial_from`) وهو فاضي
      // في أي فاتورة اتكتبت بصفوف، وتنتهي بصف فاضي.
      //
      // والأثر مش شكلي: اللي بيفتح الفاتورة للتعديل بيشوف الكوبونات مش موجودة، فلو
      // حفظ التعديل بيمسحها من المستند — والدفتر اللي في إيد العميل يبقى ملوش أثر،
      // فالورقة الراجعة بعد شهر بتترفض. `coupon_rows` سايبة كمان عشان لو رد قديم
      // متكاش في مكان تاني.
      const couponSrc = det.coupons ?? det.coupon_rows;
      if (couponSrc && couponSrc.length) {
        setCouponRows(couponSrc.map((cr: any) => ({
          key: cr.id || String(Math.random()),
          coupon_kind: cr.coupon_kind,
          count: cr.count,
          serial_from: cr.serial_from,
          serial_to: cr.serial_to,
        })));
      } else if (det.coupon_serial_from || det.coupon_serial_to) {
        setCouponRows([{
          key: '1',
          coupon_kind: det.coupon_kind || undefined,
          count: det.coupon_count,
          serial_from: det.coupon_serial_from,
          serial_to: det.coupon_serial_to,
        }]);
      } else {
        setCouponRows([blankCoupon()]);
      }

      setCreateVisible(true);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر فتح الفاتورة');
    } finally {
      setLoading(false);
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
      title: 'نوع المستند',
      dataIndex: 'doc_type',
      key: 'doc_type',
      width: 100,
      render: (t: string) => t === 'sale'
        ? <Tag color="green" style={{ fontWeight: 600 }}>فاتورة بيع</Tag>
        : <Tag color="magenta" style={{ fontWeight: 600 }}>مرتجع بيع</Tag>,
    },
    {
      title: 'رقم',
      dataIndex: 'id',
      key: 'id',
      width: 70,
      render: (id: number) => <span style={{ color: '#6b6b6b' }}>{id}</span>,
    },
    {
      title: 'التاريخ',
      dataIndex: 'date',
      key: 'date',
      width: 95,
      sorter: (a: any, b: any) => (a.date || '').localeCompare(b.date || ''),
      render: (d: string) => d || '-',
    },
    {
      title: 'مستند رقم',
      dataIndex: 'external_document_number',
      key: 'external_document_number', ellipsis: true,
      width: 120,
      sorter: (a: any, b: any) => (a.external_document_number || '').localeCompare(b.external_document_number || ''),
      render: (v: string | null) => v || '-',
    },
    {
      title: 'رقم المستند',
      dataIndex: 'document_number',
      key: 'document_number', ellipsis: true,
      width: 130,
      sorter: (a: any, b: any) => (a.document_number || '').localeCompare(b.document_number || ''),
      render: (doc: string, r: any) => (
        <Space direction="vertical" size={0}>
          <Tag color={r.doc_type === 'sale' ? 'blue' : 'volcano'}>{doc}</Tag>
          {r.original_invoice_number && (
            <span style={{ fontSize: 11, color: '#8c8c8c' }}>عن: {r.original_invoice_number}</span>
          )}
        </Space>
      ),
    },
    {
      title: 'الحساب الفرعي',
      dataIndex: 'revenue_account_id',
      key: 'revenue_account_id',
      width: 140,
      ellipsis: true,
      render: (id: number | null) => {
        if (!id) return <span style={{ color: '#8c8c8c' }}>الافتراضي</span>;
        const a = postingAccounts.find((x: any) => x.id === id);
        return a ? (a.name || a.code || `#${id}`) : `#${id}`;
      },
    },
    {
      title: 'جهه التعامل',
      dataIndex: 'customer_id',
      key: 'customer_id',
      width: 190,
      ellipsis: true,
      sorter: (a: any, b: any) => {
        const cA = a.customer_name || customers.find((c) => c.id === a.customer_id)?.name || '';
        const cB = b.customer_name || customers.find((c) => c.id === b.customer_id)?.name || '';
        return cA.localeCompare(cB);
      },
      render: (cId: number, row: any) => {
        // الاسم جاي مع الصف؛ الكشف المحلي فاضل كخطة بديلة للصفوف القديمة.
        const name = row.customer_name || customers.find((cust) => cust.id === cId)?.name;
        return (
          <a onClick={(e) => { e.stopPropagation(); navigate(`/customers/${cId}`); }}>
            {name || `عميل #${cId}`}
          </a>
        );
      },
    },
    {
      // عائلة الفاتورة — أبيض ولا بولي. عمود لوحده جنب «النوع» لأنهم بيجاوبوا سؤالين:
      // ده بيقول الفاتورة على أنهي خط، و«النوع» بيقول العميل ده إيه.
      title: 'نوع الفاتورة',
      dataIndex: 'family',
      key: 'family',
      width: 100,
      sorter: (a: any, b: any) => (a.family || '').localeCompare(b.family || ''),
      render: (f: string | null) =>
        f ? <Tag color={f === 'بولي' ? 'purple' : 'default'}>{f}</Tag> : '-',
    },
    {
      // «النوع» = تصنيف العميل (تاجر/سباك/معرض)، مش عائلة الفاتورة.
      title: 'النوع',
      dataIndex: 'customer_type',
      key: 'customer_type',
      width: 90,
      sorter: (a: any, b: any) =>
        (a.customer_type || '').localeCompare(b.customer_type || ''),
      render: (t: string | null) => t ? <Tag color="geekblue">{t}</Tag> : '-',
    },
    {
      title: 'مندوب',
      dataIndex: 'rep_id',
      key: 'rep_id',
      width: 95,
      ellipsis: true,
      render: (id: number | null, row: any) =>
        row.rep_name || reps.find((r) => r.id === id)?.full_name || '-',
    },
    {
      title: 'اجمالي قبل',
      dataIndex: 'gross',
      key: 'gross',
      width: 115,
      align: 'left' as const,
      sorter: (a: any, b: any) => a.gross - b.gross,
      render: (val: number) => `${money(val)} ج.م`,
    },
    {
      title: 'خصم',
      dataIndex: 'discount_value',
      key: 'discount_value',
      width: 105,
      align: 'left' as const,
      sorter: (a: any, b: any) => a.discount_value - b.discount_value,
      render: (val: number) => `${money(val)} ج.م`,
    },
    {
      title: 'خصم%',
      dataIndex: 'combined_pct',
      key: 'combined_pct',
      width: 80,
      sorter: (a: any, b: any) => a.combined_pct - b.combined_pct,
      render: (val: number) => `${Number(val || 0).toFixed(0)}%`,
    },
    {
      title: 'الصافى',
      dataIndex: 'net',
      key: 'net',
      width: 115,
      align: 'left' as const,
      sorter: (a: any, b: any) => a.net - b.net,
      render: (val: number, r: any) => (
        <strong style={{ color: r.doc_type === 'sale' ? '#237804' : '#c41d7f' }}>
          {r.doc_type === 'return' ? '-' : ''}{money(val)} ج.م
        </strong>
      ),
    },
    {
      title: 'تم السداد',
      dataIndex: 'cash_amount',
      key: 'cash_amount',
      width: 100,
      align: 'left' as const,
      sorter: (a: any, b: any) => a.cash_amount - b.cash_amount,
      render: (val: number) => `${money(val)} ج.م`,
    },
    {
      title: 'الباقى',
      dataIndex: 'credit_amount',
      key: 'credit_amount',
      width: 100,
      align: 'left' as const,
      sorter: (a: any, b: any) => a.credit_amount - b.credit_amount,
      render: (val: number) => {
        const n = Number(val || 0);
        return <span style={{ color: n > 0 ? '#cf1322' : undefined, fontWeight: n > 0 ? 600 : undefined }}>{money(n)} ج.م</span>;
      },
    },
    {
      title: 'ملاحظات',
      dataIndex: 'notes',
      key: 'notes',
      width: 170,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      // العمود كان بلا اسم وبلا تثبيت، وسط جدول أعمدته مامتقاسّهاش الفاضي كله. النتيجة
      // كانت شريط أبيض في نص السجل والأيقونات سايبة فيه — نفس السجلات التانية بتسمّيه
      // وبتثبّته على الحافة، فالإيد بتلاقيه في نفس المكان في كل شاشة.
      title: 'الإجراءات',
      key: 'actions',
      width: 130,
      // Icons, like the row icons on their own lists. Four words apiece cost more width than
      // «الصافى» and «الباقى» together — and those are the two numbers the list exists for.
      render: (_: any, record: any) => {
        const isSale = record.doc_type === 'sale';
        return (
          <Space size={2} onClick={(e) => e.stopPropagation()}>
            <Tooltip title={isSale ? 'عرض الفاتورة' : 'عرض المرتجع'}>
              <Button type="text" icon={<EyeOutlined />}
                onClick={() => {
                  if (isSale) {
                    openDetail(record.raw || record);
                  } else {
                    navigate(`/returns?id=${record.id}`);
                  }
                }} />
            </Tooltip>
            {isSale && (
              <Tooltip title="طباعة">
                <Button type="text" icon={<PrinterOutlined />}
                  onClick={async () => {
                    const detRes = await api.get(`/api/v1/sales/${record.id}`).catch(() => null);
                    if (detRes?.data) {
                      const doc = invoiceDoc({ ...record, ...detRes.data });
                      if (doc) printInvoice(doc, printOpts);
                    }
                  }} />
              </Tooltip>
            )}
            {isSale && canEditInvoice && (
              <Tooltip title="تعديل">
                <Button type="text" icon={<EditOutlined />}
                  onClick={() => handleEditInvoice(record.raw || record)} />
              </Tooltip>
            )}
            {canDeleteInvoice && (
              <Tooltip title="حذف">
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    Modal.confirm({
                      title: isSale ? 'تأكيد حذف فاتورة البيع' : 'تأكيد حذف سند المرتجع',
                      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
                      content: (
                        <div>
                          <p>هل أنت متأكد من حذف {isSale ? 'فاتورة البيع' : 'سند المرتجع'} رقم: <b>{record.document_number}</b>؟</p>
                          <p style={{ color: '#8c8c8c', fontSize: 13 }}>سيتم حذف المستند بالكامل وإلغاء أثره المحاسبي والمخزني.</p>
                        </div>
                      ),
                      okText: 'نعم، احذف',
                      okType: 'danger',
                      cancelText: 'إلغاء',
                      onOk: async () => {
                        if (isSale) {
                          await handleDeleteInvoice(record.raw || record);
                        } else {
                          await handleDeleteReturn(record.raw || record);
                        }
                      },
                    });
                  }}
                />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  // الأعمدة بعد الإخفاء والترتيب، محسوبة مرة واحدة: الجدول بيرسمها والتصدير بيكتبها، ولازم
  // يبقوا نفس القايمة — لو كل واحد نادى `apply` لوحده، ملف بيطلع بأعمدة غير اللي على الشاشة
  // يبقى مسألة وقت.
  const visibleColumns = invoiceCols.apply(columns);

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
    // بيمشي على طول — التأكيدات اتشالت من النظام بطلب صاحبه، ودي منهم.
    //
    // كانت بتسأل لما يكون في المستند سطور اتكتبت ولسه ماتحفظتش. اللي بيدوس «التالي» أو
    // «السابق» وهو في نص كتابة بيسيب اللي كتبه، وده بقى قراره من غير وقفة.
    closeCreate();
    openDetail(target);
  };

  const startNew = () => {
    // التفضية الأول، وبعدين أول باب في الدورة.
    resetDocument();
    setCreateVisible(true);
    setNewStep('party');
    setPartyPickerOpen(true);
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
    const isSaved = Boolean(viewInvoice || editingInvoice);
    const lineCount = lines.filter((l) => l.item_id !== null).length;
    const couponCountVal = couponRows.filter((r) => Boolean(r.coupon_type_id || r.serial_from || r.serial_to)).length;
    const hasContent = lineCount > 0 || couponCountVal > 0;
    return [
      {
        key: 'new',
        label: 'جديد',
        shortcut: 'F2',
        icon: <FileAddOutlined />,
        onClick: startNew,
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
        // «تراجع» بيرجّع المستند، مش بيقفل الحقول وبس.
        //
        // كان بيعمل `setViewOnly(true)` على طول: الحقول تتقفل واللي اتكتب ومااتحفظش يفضل
        // ظاهر — مقفول ومقروء، يعني بنفس شكل المحفوظ بالظبط. فاللي غيّر كمية من ١٠ لـ٣
        // وضغط تراجع بيفضل قدامه ٣ وإجمالي مالوش وجود، ومافيش حاجة على الشاشة بتقول إن ده
        // مش اللي في القاعدة. إعادة تحميل المستند هي الحاجة الوحيدة اللي بترجّع الأرقام.
        onClick: () => {
          if (!viewOnly && viewInvoice) {
            openDetail(viewInvoice);   // بيقرا من السيرفر وبيقفل على المحفوظ
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
        disabled: viewOnly || !hasContent || loading,
        onClick: () => { createForm.submit(); },
      },
      {
        key: 'next',
        label: 'التالى',
        icon: <ArrowLeftOutlined />,
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
        disabled: !isSaved ? invoices.length === 0 : !neighbour(-1),
        onClick: () => {
          if (isSaved) {
            const n = neighbour(-1);
            if (n) openDetail(n);
          } else {
            stepFromDraft(1);
          }
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
        onClick: () => {
          if (isSaved && viewInvoice) openDetail(viewInvoice);
          else loadLookups();
        },
      },
    ];
  };

  if (createVisible) {
    return (
      <div>
      <Card
          title={
            <Space wrap>
              <Button type="text" icon={<ArrowRightOutlined />}
                onClick={closeCreate}>رجوع</Button>
              <Typography.Text strong style={{ fontSize: 16 }}>
                {viewInvoice
                  ? `فاتورة بيع رقم: ${viewInvoice.document_number || ''}`
                  : editingInvoice
                    ? `تعديل فاتورة بيع #${editingInvoice.id}`
                    : 'تسجيل فاتورة بيع جديدة'}
              </Typography.Text>
              {viewInvoice && !viewOnly && (
                <Tag color="orange" style={{ fontWeight: 600 }}>وضع التعديل</Tag>
              )}
              {editingInvoice?.voided && (
                <Tag color="volcano">مردود / ملغي</Tag>
              )}
              <DatePicker
                value={invoiceDate} allowClear={false} format="YYYY-MM-DD"
                disabled={viewOnly}
                onChange={(v) => setInvoiceDate(v || dayjs())}
              />
            </Space>
          }
        >
        <DocumentToolbar actions={docToolbar()} />
        {/* `doc-form` بيضغط المسافات ويغمّق الأسماء — نفس فاتورة الشرا. */}
        <Form form={createForm} layout="vertical" size="small" className="doc-form"
          onFinish={handleCreateSubmit} requiredMark={false}>
          {/*
            * ترويسة المستند: **التاريخ ← العميل ← المندوب ← المستند** — بترتيب ما بيتسأل.
            *
            * الفاتورة بتبدأ بيوم وطرف، وبعدين مين بيبيعله، وآخر حاجة رقم ورقته. الترتيب ده
            * هو اللي الإيد بتمشي عليه، والقفز بين خانات مش مترتبة بترتيب السؤال هو اللي
            * بيخلّي الواحد يرجع لورا كل شوية.
            */}
          <Row gutter={16}>
            <Col xs={12} md={4}>
              <Form.Item label="نوع المستند" style={{ marginBottom: 8 }}>
                <Input value="فاتورة بيع" readOnly style={{ fontWeight: 700, color: '#2b6cb0', background: '#ebf8ff', textAlign: 'center' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="التاريخ" style={{ marginBottom: 8 }}>
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  disabled={viewOnly}
                  value={invoiceDate} onChange={(v) => setInvoiceDate(v || dayjs())} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              {/* Picked from a searchable modal that can also create the customer on the spot,
                  so a new walk-in never costs the half-entered invoice. */}
              <Form.Item
                name="customer_id"
                label="اسم العميل"
                rules={[{ required: true, message: 'يرجى اختيار العميل!' }]}
                style={{ marginBottom: 8 }}
              >
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  placeholder="اضغط لاختيار العميل"
                  disabled={viewOnly}
                  onClick={() => !viewOnly && setPartyPickerOpen(true)}
                  options={customers.map((c) => ({
                    value: c.id,
                    label: `${c.name}${c.default_price_tier ? ` — ${TIER_LABELS[c.default_price_tier]}` : ''}`,
                  }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="المخزن (المخزن الذي سأبيع منه)" required style={{ marginBottom: 8 }}>
                <Select
                  showSearch
                  placeholder="اختر المخزن للبيع منه"
                  optionFilterProp="label"
                  disabled={viewOnly}
                  value={docWarehouseId ?? undefined}
                  // `onWarehouseChange` مش `setDocWarehouseId` لوحدها: الرصيد بتاع المخزن
                  // بيتجاب من السيرفر أول ما يتقال. من غيرها المخزن بيتغيّر والرصيد بيفضل
                  // فاضي، فكل صنف بيقرا صفر — والشباك بيقفل الأصناف كلها ويقول «غير متوفر»
                  // عن مخزن مليان.
                  onChange={(v) => onWarehouseChange(v as number)}
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={12} md={6}>
              {/* Filled from the customer, and changeable. A rep on leave is an ordinary day. */}
              <Form.Item name="rep_id" label="المندوب" style={{ marginBottom: 8 }}>
                <Select allowClear showSearch placeholder="من العميل"
                  optionFilterProp="label"
                  disabled={viewOnly}
                  onChange={(v) => {
                    const store = storeOfRep(v as number);
                    if (store) setDocWarehouseId(store);
                  }}
                  options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="نوع الفاتورة (الخط)" style={{ marginBottom: 8 }}>
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
            <Col xs={12} md={6}>
              <Form.Item name="external_document_number" label="رقم المستند"
                style={{ marginBottom: 8 }}>
                <Input placeholder="رقم فاتورة العميل" disabled={viewOnly} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="notes" label="ملاحظات" style={{ marginBottom: 8 }}>
                <Input placeholder="اختياري" disabled={viewOnly} />
              </Form.Item>
            </Col>
          </Row>

          {/* الكوبونات المصروفة */}
          <div style={{ marginTop: 14, marginBottom: 12 }}>
            <Row gutter={8} className="mini-head">
              <Col xs={24} md={7}>فئة الكوبون</Col>
              <Col xs={8} md={4}>العدد</Col>
              <Col xs={8} md={5}>من رقم</Col>
              <Col xs={8} md={5}>إلى رقم</Col>
              <Col xs={24} md={3} />
            </Row>
            {couponRows.map((row, i) => (
              <Row gutter={8} key={row.key} align="middle" style={{ marginBottom: 6 }}>
                <Col xs={24} md={7}>
                  <Select allowClear showSearch style={{ width: '100%' }}
                    optionFilterProp="label"
                    disabled={viewOnly}
                    placeholder="عادي / فضي / ذهبي"
                    value={row.coupon_kind}
                    onChange={(v) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                      ? { ...x, coupon_kind: v as string } : x)))}
                    options={couponKindOptions.map((k) => ({ value: k.value, label: k.label }))} />
                </Col>
                <Col xs={8} md={4}>
                  <InputNumber style={{ width: '100%' }} disabled
                    value={couponCount(row.serial_from, row.serial_to) ?? undefined} />
                </Col>
                <Col xs={8} md={5}>
                  <Input value={row.serial_from || ''} disabled={viewOnly}
                    onChange={(e) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                      ? { ...x, serial_from: e.target.value } : x)))} />
                </Col>
                <Col xs={8} md={5}>
                  <Input value={row.serial_to || ''} disabled={viewOnly}
                    onChange={(e) => setCouponRows((rs) => rs.map((x) => (x.key === row.key
                      ? { ...x, serial_to: e.target.value } : x)))} />
                </Col>
                <Col xs={24} md={3}>
                  {!viewOnly && (
                    <>
                      {i === couponRows.length - 1 && (
                        <Button size="small" icon={<PlusOutlined />} title="نوع كوبون تاني"
                          onClick={() => setCouponRows((rs) => [...rs, blankCoupon()])} />
                      )}
                      <Button type="text" danger icon={<DeleteOutlined />} title="امسح الصف"
                        onClick={() => setCouponRows((rs) => (rs.length === 1
                          ? [blankCoupon()]
                          : rs.filter((x) => x.key !== row.key)))} />
                    </>
                  )}
                </Col>
              </Row>
            ))}
            {couponRows.some((r) => couponCount(r.serial_from, r.serial_to)) && (
              <div style={{ fontSize: 12, color: '#4a4a4a' }}>
                الإجمالي: {couponRows.reduce(
                  (t, r) => t + (couponCount(r.serial_from, r.serial_to) ?? 0), 0)} كوبون
              </div>
            )}
          </div>

          {families.length > 1 && (
            <div style={{ marginBottom: 10 }}>
              <Segmented
                block
                size="large"
                disabled={viewOnly}
                value={invoiceFamily ?? ''}
                onChange={(v: string | number) => setInvoiceFamily(String(v) || null)}
                options={families.map((a) => ({
                  value: a.family as string,
                  label: (
                    <span style={{ fontWeight: 700 }}>
                      {a.family}
                      <span style={{ color: '#5a6b5a', marginInlineStart: 8, fontSize: 13,
                                     fontWeight: 400 }}>
                        ({money(Number(a.balance || 0))})
                      </span>
                    </span>
                  ),
                }))}
              />
            </div>
          )}

          <Row gutter={16}>
          <Col xs={24}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 2 }}>
            {!viewOnly && (
              <Button data-shortcut="F2"
                type="primary" icon={<PlusOutlined />}
                style={{ flex: 1, height: 32, fontSize: 13, fontWeight: 700, borderRadius: 6, background: '#6AB42D', borderColor: '#6AB42D' }}
                onClick={() => setPickerOpen(true)}
              >
                إضافة صنف للفاتورة (Enter أو F2)
              </Button>
            )}
            <div style={{ flexShrink: 0 }}>{lineGrid.control}</div>
          </div>

          {/*
            * «الفاتورة دي من أنهي مخزن؟» — سؤال واحد، أول صنف، وبيثبت بعده.
            *
            * مش خانة في الترويسة عن قصد: الترويسة اتشالت منها خانة المخزن بطلب صاحب النظام،
            * والسؤال هنا بيتسأل في اللحظة اللي محتاجينه فيها فعلاً — أول ما حد يضيف صنف.
            */}
          <TabModal
            open={pendingItems.length > 0}
            title={pendingItems.length > 1
              ? `الأصناف دي (${pendingItems.length}) من أنهي مخزن؟`
              : 'الفاتورة دي من أنهي مخزن؟'}
            okText="تمام" cancelText="إلغاء"
            okButtonProps={{ disabled: pendingWarehouse === null }}
            onCancel={() => setPendingItems([])}
            onOk={async () => {
              const wh = pendingWarehouse;
              const items = pendingItems;
              if (wh === null || items.length === 0) return;
              setPendingItems([]);
              setDocWarehouseId(wh);
              await loadWarehouseStock(wh);
              // واحد ورا التاني: كل إضافة بتقرا السطور اللي بتضيف عليها، فلو اتنفّذوا مع بعض
              // كل واحد فيهم هيشوف القايمة زي ما كانت قبل أي إضافة.
              for (const id of items) await addProductByIdWith(id, wh);
            }}
            destroyOnHidden
          >
            <Select
              style={{ width: '100%' }} size="large" showSearch optionFilterProp="label"
              placeholder="اختر المخزن"
              value={pendingWarehouse ?? undefined}
              onChange={(v) => setPendingWarehouse(v as number)}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
            <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
              هيثبت لكل أصناف الفاتورة. تقدر تغيّر مخزن أي سطر من عمود «المخزن».
            </div>
          </TabModal>

          <ProductPickerModal
            open={pickerOpen}
            categories={productCategories}
            categoryLabels={categoryLabels}
            products={products}
            activeCategory={activeCategory}
            onCategoryChange={(c) => { setActiveCategory(c); setPanelItemId(null); }}
            availableFor={(id) => (docWarehouseId === null
              ? null : availableFor(id, null, docWarehouseId))}
            disableOutOfStock
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

          {/*
            * سطور الفاتورة كجدول مضغوط — نفس جدول فاتورة الشرا بالظبط.
            *
            * كانت كروت متجمّعة بالفئة: كل سطر بياخد مساحة كبيرة، وترويسة فئة فوق كل مجموعة،
            * وفاتورة خمستاشر صنف بتبقى صفحتين تمرير. وأهم من المساحة إن الكميات والأسعار
            * مكانش ليها عمود تتقارن فيه رأسياً — واللي بيراجع فاتورة طويلة بيقارن رأسياً.
            *
            * الشاشتين بقوا نفس المستند من الناحيتين، فاللي اتعلّم إيده على واحدة اتعلّم التانية.
            */}
          {lines.length === 0 ? (
            <Empty description="اختر الفئة ثم المنتجات لإضافتها للفاتورة"
              style={{ margin: '12px 0' }} />
          ) : (
            <div style={{ border: '1px solid #e6efe3', borderRadius: 10, overflowX: 'auto' }}>
              <table className="entry-grid">
                <thead>{lineGrid.head}</thead>
                <tbody>
                  {linesByCategory.map((group) => (
                    <React.Fragment key={group.category ?? '__none__'}>
                      {linesByCategory.length > 1 && (
                        <tr style={{ background: '#f6faf3', borderTop: '1.5px solid #6AB42D', borderBottom: '1px solid #e2ede0' }}>
                          <td colSpan={20} style={{ padding: '1px 8px', background: '#f6faf3' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Tag color="success" style={{ fontWeight: 700, fontSize: 11, padding: '0 6px', borderRadius: 3, margin: 0 }}>
                                  {group.category ? (categoryLabels[group.category] || group.category) : 'بدون فئة'}
                                </Tag>
                                <span style={{ color: '#555', fontSize: 11, fontWeight: 600 }}>({group.items.length} صنف)</span>
                              </div>
                              <span style={{ color: '#666', fontSize: 11, fontWeight: 600 }}>
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
                </tbody>
                <tfoot>{lineGrid.foot(lines)}</tfoot>
              </table>
            </div>
          )}

          </Col>
          </Row>

          {/*
            * لوحة «رصيد الصنف في المخازن» اتشالت بطلب صاحب النظام — زي ما اتشالت من فاتورة الشرا.
            *
            * كانت صندوق كبير مكتوب فيه «اختر فئة أو صنف عشان تشوف رصيده» وطالع الصفحة لتحت من
            * غير ما يقول حاجة. ورصيد الصنف بيتشاف جوّه بوباب اختيار الصنف — وهو المكان اللي
            * السؤال بيتسأل فيه فعلاً وانت بتقول هاخد منه كام.
            */}
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
                        disabled={viewOnly}
                        value={discountPct} onChange={(val) => setDiscountPct(val || 0)} />
                    </Form.Item>
                    <Form.Item label="المبلغ المدفوع نقداً" style={{ marginBottom: 0 }}
                      help={hasParty ? 'ممكن يزيد عن الفاتورة فيسدّد المديونية القديمة' : undefined}>
                      <InputNumber min={0} style={{ width: '100%' }} addonAfter="ج.م"
                        disabled={viewOnly}
                        value={cashAmount} onChange={(val) => setCashAmount(val || 0)} />
                    </Form.Item>
                  </>
                )}
                rows={[
                  { label: 'إجمالي الأصناف', value: money(grossTotal) },
                  { label: `خصم الفاتورة (${discountPct}%)`,
                    value: `− ${money(invoiceDiscount)}`, color: '#cf1322',
                    show: invoiceDiscount > 0.001 },
                  { label: 'صافي الفاتورة', value: money(netTotal),
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
                    rule: true, show: hasParty },
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

          {!viewOnly && (
            <Form.Item style={{ marginTop: 20, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Space>
                  <Button type="primary" htmlType="submit">
                    {editingInvoice ? 'حفظ تعديلات الفاتورة' : 'تسجيل وحفظ فاتورة البيع'}
                  </Button>
                  <Button onClick={closeCreate}>إلغاء</Button>
                </Space>
              </div>
            </Form.Item>
          )}

          {viewReturns.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <Divider orientation="right">المرتجعات المسجلة على هذه الفاتورة</Divider>
              <Table
                size="small" pagination={false} rowKey="id"
                dataSource={viewReturns}
                columns={[
                  { title: 'سند المرتجع', dataIndex: 'document_number', render: (d: string) => <Tag color="volcano">{d}</Tag> },
                  { title: 'القيمة', dataIndex: 'value', render: (v: string) => `${money(v)} ج.م` },
                  { title: 'ردّ نقدي', dataIndex: 'cash_refund', render: (v: string) => `${money(v)} ج.م` },
                  { title: 'خصم آجل', dataIndex: 'credit_reduction', render: (v: string) => `${money(v)} ج.م` },
                ]}
              />
            </div>
          )}
        </Form>
        </Card>

        <PartyPickerModal
          open={partyPickerOpen} kind="customer"
          onPick={handlePartyPicked}
          // `setNewStep(null)` مش زيادة: من غيرها الإلغاء بيقفل الشباك ويسيب الدورة واقفة على
          // خطوة «العميل» — والمستند مفتوح قدامك بس Enter مش بيفتح منتقي الأصناف لأن الحارس
          // شايف إن فيه خطوة لسه شغالة.
          onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }}
          date={createVisible ? undefined : invoiceDate}
          onDateChange={setInvoiceDate} />

        <TreasuryGate {...treasuryGate} />

        {/*
          * الباب التالت: **المخزن**.
          *
          * بيختار المخزن **الافتراضي للسطور الجديدة** — مش مخزن المستند. المخزن على السطر
          * (سبيك ٠٣٠) وبيفضل كده: الفاتورة الواحدة ممكن تتصرف من أكتر من مخزن، واللي عايز
          * كده بيغيّر مخزن أي سطر من عموده بعدين. الباب بيجاوب على «أغلب السطور من فين».
          *
          * القيمة مربوطة بنفس خانة الترويسة، فاللي بيتقال هنا بيبان هناك على طول، والعكس.
          * و`onWarehouseChange` مش `setDocWarehouseId` لوحدها عشان رصيد المخزن يتجاب معاه —
          * من غيره كل صنف بيقرا صفر والمنتقي بيقفل بضاعة موجودة.
          */}
        <WarehouseGate
          open={newStep === 'warehouse' && !viewOnly && !editingInvoice}
          title="الفاتورة دي هتتصرف من أنهي مخزن؟"
          value={docWarehouseId}
          onChange={(v) => { doorWarehouseRef.current = v as number; onWarehouseChange(v as number); }}
          warehouses={warehouses}
          onCancel={() => { setDocWarehouseId(null); setNewStep('party'); setPartyPickerOpen(true); }}
          onOk={() => setNewStep(afterWarehouseStep())}
        />

        {/*
          * الباب الرابع: **نوع الفاتورة** — الخط اللي الفاتورة عليه.
          *
          * القايمة جاية من **حسابات العميل نفسه** (`families`)، مش من `FAMILY_OPTIONS`.
          * الفرق ده مش تجميل: السؤال الحقيقي هو «الفاتورة هتتحرّك على أنهي حساب»، و«أبيض»
          * و«بولي» موجودين كحسابات بس للعملا اللي `customer_merge_service` قسمهم. العميل
          * العادي عنده حساب واحد بـ`family = null` — فلو الباب عرض عليه «أبيض» واختارها،
          * السيرفر بيرد `العميل مالوش حساب لـ«أبيض»` بعد ما البايع كتب الفاتورة كلها.
          *
          * وعشان كده الباب مابيظهرش أصلاً إلا لما يكون فيه أكتر من حساب (`afterWarehouseStep`،
          * والحارس اللي بيقفله لو الحسابات وصلت متأخرة) — وحساب واحد باسم بيتحطّ لوحده في
          * `onCustomerChange`. سؤال مالوش غير إجابة واحدة مش سؤال.
          */}
        <TabModal
          open={newStep === 'family' && !viewOnly && !editingInvoice}
          title="الفاتورة على أنهي حساب؟"
          okText="ابدأ الفاتورة" cancelText="رجوع"
          okButtonProps={{ disabled: !invoiceFamily }}
          onCancel={() => setNewStep('warehouse')}
          onOk={() => setNewStep(null)}
        >
          {/*
            * زي باب المخزن: الشباك بياخد الكيبورد أول ما يفتح (`tabIndex` + تركيز)، ←→/↑↓
            * بيلفّوا على الحسابات، وEnter بيأكّد. الأسهم متعملة بإيدنا مش مسيبة لـ`Segmented`
            * عشان تنقّل الراديو بالأسهم بيعتمد على تفاصيل جوّه antd، والدورة دي مالهاش بديل
            * بالماوس في نص الفاتورة.
            */}
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
                // الرصيد بيظهر جنب الاسم للعميل المقسوم بس — عنده حساب لكل خط ورصيده
                // بيفرق. العميل العادي حسابه واحد، فرصيده جنب الخيارين هيبقى نفس
                // الرقم مرتين وبيوحي إن الاختيار بيحرّك حاجة وهو مش بيحركها.
                const acc = families.find((a) => a.family === o.value);
                return {
                  value: o.value,
                  label: (
                    <span style={{ fontWeight: 700 }}>
                      {o.label}
                      {families.length > 1 && acc ? (
                        <span style={{ color: '#5a6b5a', marginInlineStart: 8, fontSize: 13,
                                       fontWeight: 400 }}>
                          ({money(Number(acc.balance || 0))})
                        </span>
                      ) : null}
                    </span>
                  ),
                };
              })}
            />
            <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
              بيتغيّر من خانة «نوع الفاتورة» في الترويسة في أي وقت.
            </div>
          </div>
        </TabModal>
      </div>
    );
  }

  return (
    <div>
      <Card
        title="المبيعات (سجل الفواتير والمرتجعات)"
        extra={(
          <Space>
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
            {/* جوّه `Space`، فالمسافة الافتراضية بتتشال — الـ`Space` بيباعد لوحده. */}
            <ExportExcelButton
              name="سجل الفواتير والمرتجعات"
              rows={unifiedRecords}
              tableColumns={visibleColumns}
              style={{ marginInlineStart: 0 }}
            />
            <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
            <Button type="primary" icon={<PlusOutlined />}
              style={{ fontWeight: 600 }}
              // نفس تفضية «جديد» بالظبط. الزرار ده كان بيفتح الدورة على الحالة اللي
              // سايبها المستند اللي قبله — ودي كانت أقصر طريق لكوبونات فاتورة غلط.
              onClick={() => { resetDocument(); setNewStep('party'); }}>
              تسجيل فاتورة بيع
            </Button>
          </Space>
        )}
      >
        {/* --- Summary Statistics --- */}
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, borderColor: '#d9f7be', backgroundColor: '#f6ffed' }}>
              <Statistic
                title="إجمالي فواتير المبيعات"
                value={money(summary.totalSalesNet)}
                suffix="ج.م"
                prefix={<Tag color="green">{summary.totalSalesCount} فاتورة</Tag>}
                valueStyle={{ color: '#389e0d', fontWeight: 'bold' }}
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, borderColor: '#ffd6e7', backgroundColor: '#fff0f6' }}>
              <Statistic
                title="إجمالي مرتجعات المبيعات"
                value={money(summary.totalReturnsNet)}
                suffix="ج.م"
                prefix={<Tag color="magenta">{summary.totalReturnsCount} مرتجع</Tag>}
                valueStyle={{ color: '#eb2f96', fontWeight: 'bold' }}
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, borderColor: '#91caff', backgroundColor: '#e6f4ff' }}>
              <Statistic
                title="صافي المبيعات الفعلي"
                value={money(summary.netSales)}
                suffix="ج.م"
                valueStyle={{ color: '#0958d9', fontWeight: 'bold' }}
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, borderColor: '#ffa39e', backgroundColor: '#fff1f0' }}>
              <Statistic
                title="المتبقي آجل على العملاء"
                value={money(summary.totalCredit)}
                suffix="ج.م"
                valueStyle={{ color: '#cf1322', fontWeight: 'bold' }}
              />
            </Card>
          </Col>
        </Row>

        {/* --- Filter Segmented Tabs --- */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <Segmented
            size="middle"
            value={docKindFilter}
            onChange={(v: any) => setDocKindFilter(v)}
            options={[
              { label: <span>الكل ({summary.totalSalesCount + summary.totalReturnsCount})</span>, value: 'all' },
              { label: <span style={{ color: '#389e0d', fontWeight: 600 }}>🟢 فواتير المبيعات ({summary.totalSalesCount})</span>, value: 'sale' },
              { label: <span style={{ color: '#eb2f96', fontWeight: 600 }}>🔴 مرتجعات المبيعات ({summary.totalReturnsCount})</span>, value: 'return' },
            ]}
          />
        </div>

        {/* --- Search + filters (server-side, so they cover every invoice) --- */}
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} md={5}>
            <Input
              allowClear
              ref={listSearchRef}
              value={search}
              placeholder="بحث برقم المستند أو الفاتورة"
              prefix={<SearchOutlined />}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={applySearch}
              onBlur={applySearch}
            />
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="العميل"
              value={filters.customer_id}
              onChange={(v) => setFilter('customer_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={customers.map((c) => ({ value: c.id, label: c.name }))} />
          </Col>
          <Col xs={12} sm={12} md={3}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="المندوب"
              value={filters.rep_id}
              onChange={(v) => setFilter('rep_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
          </Col>
          <Col xs={12} sm={12} md={3}>
            <Select allowClear style={{ width: '100%' }} placeholder="نوع الفاتورة"
              value={filters.family}
              onChange={(v) => setFilter('family', v)}
              options={FAMILY_OPTIONS} />
          </Col>
          <Col xs={12} sm={12} md={4}>
            <DateRangeFilter
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
          </Col>
          <Col xs={12} sm={12} md={3}>
            <Select allowClear style={{ width: '100%' }} placeholder="طريقة السداد"
              value={filters.payment}
              onChange={(v) => setFilter('payment', v)}
              options={[
                { value: 'cash', label: 'نقدي بالكامل' },
                { value: 'credit', label: 'آجل بالكامل' },
                { value: 'partial', label: 'جزئي (نقدي + آجل)' },
              ]} />
          </Col>
          <Col xs={24} sm={24} md={2}>
            <Button icon={<ClearOutlined />} onClick={resetFilters} block>مسح</Button>
          </Col>
        </Row>

        <Table
          dataSource={unifiedRecords}
          columns={visibleColumns}
          size="small"
          tableLayout="fixed"
          // من غير `scroll` أفقي — الشاشة مالهاش يمين وشمال.
          //
          // مع `tableLayout: fixed` وكل عمود له عرض، المتصفح بيوزّع الفرق على الأعمدة كلها
          // بالنسبة: زادت تتفرد شوية، قلّت تتضغط شوية. اللي كان بيكسّر الشكل هو عمود من غير
          // عرض — الفاضي كله كان بينزل عليه لوحده فيطلع شريط أبيض في نص الجدول.
          rowKey="rowKey"
          loading={loading}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
          onRow={(record: any) => ({
            onClick: () => {
              if (record.doc_type === 'sale') {
                openDetail(record.raw);
              } else {
                navigate(`/returns?id=${record.id}`);
              }
            },
            style: { cursor: 'pointer' },
          })}
        />
      </Card>



      {/*
        * باب واحد بيفتح الفاتورة — الفرع والتاريخ والتصنيف والبحث والقايمة في نافذة واحدة.
        *
        * كان خطوتين: نافذة بتسأل التاريخ وبعدها نافذة بتسأل العميل. سؤالين هما نفس القرار —
        * «الفاتورة دي لمين وامتى» — واتنين لازم تقفلهم قبل ما تكتب أول سطر.
        *
        * نفس اللي اتعمل في فاتورة الشرا، عشان اللي اتعلّم إيده على واحدة مايتعلّمش من الأول
        * على التانية. و`kinds` بيدّي تصنيف جوّه الباب، فاللي بيدوّر على اسم ومش لاقيه في
        * العملاء بيبص في الموردين من غير ما يقفل ويفتح تاني.
        */}
      <PartyPickerModal
        open={partyPickerOpen || newStep === 'party'} kind="customer"
        kinds={['customer', 'supplier']}
        date={invoiceDate} onDateChange={(d) => setInvoiceDate(d)}
        onPick={handlePartyPicked}
        onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }} />

    </div>
  );
}

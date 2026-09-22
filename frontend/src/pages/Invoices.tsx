import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFactoryBranch } from '../components/useFactoryBranch';
// **باسم مستعار عن قصد.** الملف ده عنده `PAGE_SIZE` بمعنى تاني خالص —
// حد الجلب من الـAPI، مش عدد صفوف الجدول.
import { PAGE_SIZE as TABLE_PAGE_SIZE, PAGE_SIZE_OPTIONS }
  from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
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
import dayjs, { Dayjs } from 'dayjs';
import CostCenterField from '../components/CostCenterField';
import CostCenterSplit from '../components/CostCenterSplit';
import DocumentBar from '../components/DocumentBar';
import { api } from '../api/client';
import { useDraft } from '../components/useDraft';
import { combineDiscounts, netOf } from '../utils/discounts';
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
import DocumentAttachments from '../components/DocumentAttachments';
import TreasuryGate, { useTreasuryGate } from '../components/TreasuryGate';
import DateRangeFilter from '../components/DateRangeFilter';
import { money, numeralsLocale } from '../utils/money';
import { fingerprint, verdictOnLeave } from '../utils/unsavedWork';
import { useFocusedIds, FocusedRowsBanner } from '../components/FocusedRows';
import { applyPct, combinePct } from '../utils/discounts';
import { QTY_DATA_ATTR, flashExistingItem } from '../utils/duplicateItem';

// الأنواع والثوابت وبنّائي الأعمدة اتفصلوا — الشاشة كانت ٣١٢٠ سطر.
import {
  CAP_NOTICE_MS, PAGE_SIZE, FAMILY_OPTIONS, TIER_LABELS, couponCount, blankCoupon,
  InvoiceRecord, ItemPrices, Customer, RepEmployee, Product, Warehouse, SaleLineItem,
  ItemUnit, InvoiceDetail, InvoiceFilters, CouponRow, couponRowHasContent,
} from './invoices/types';
import { buildLineColumns } from './invoices/lineColumns';
import { buildRegisterColumns } from './invoices/registerColumns';
import StatsRow from '../components/StatsRow';
export default function Invoices() {
  const { options: categoryOptions } = useLookup('item_category');
  // فئات الورق اللي بيتسلّم للعميل. مصدر واحد: قائمة «فئات الكوبونات» في الإعدادات.
  const { options: couponKindOptions } = useLookup('coupon_kind');
  /**
   * **فرع المصنع مافيهوش كوبونات ولا نقاط ولا خط.**
   *
   * الكوبونات والنقاط والخط (أبيض/بولي) أدوات بيع التجزئة للتجار. المصنع بيبيع خام
   * وتشغيل لجهات، فالخانات دي بتفضل فاضية على كل ورقة — بتاخد مكان وبتخلّي اللي
   * بيكتب يعدّي عليها كل مرة عشان يتأكد إنها مش مطلوبة. الشرح في `useFactoryBranch`.
   */
  const isFactory = useIsFactoryBranch();
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
  /** عدّاد بيتزوّد مع كل تغيير في حقول `Form` — حقول antd مش state، فالـ`useMemo`
   *  اللي بيبني حمولة المسودّة مايشوفش تغيّرها من غيره: العميل يتغيّر والمسودّة تفضل
   *  على اللي قبله. */
  const [formTick, setFormTick] = useState(0);
  /**
   * **بوباب «تحميل»: فترة، والأسهم بتمشي جوّاها.**
   *
   * الزرار كان بيعمل حاجة واحدة — يعيد تحميل المستند المفتوح. واللي بيراجع شهر
   * كامل مالوش طريقة يقول «وَرّيني فواتير سبتمبر وأنا أعدّي عليها»: لازم يرجع
   * للكشف، يظبّط الفلتر، يفتح أول واحدة، وكل مرة يرجع تاني.
   *
   * دلوقت بيسأل عن فترة، بيحمّلها في نفس القايمة اللي «السابق» و«التالى»
   * بيمشوا عليها (`invoices`)، وبيفتح أول فاتورة فيها — فالتنقل بيبقى جوّه
   * الفترة اللي اتطلبت.
   */
  const [loadRangeOpen, setLoadRangeOpen] = useState(false);
  const [loadRange, setLoadRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [loadingRange, setLoadingRange] = useState(false);
  /**
   * **نتيجة «تحميل» بتفضل قدامك ككشف، مش بتفتح أول فاتورة وتختفي.**
   *
   * كانت بتقفل الشباك وتفتح أول فاتورة في الفترة، واللي بيدوّر على فاتورة بعينها
   * بيلاقي نفسه جوّه واحدة تانية ولازم يضرب «التالى» عشرين مرة. الكشف ده هو
   * اللي هو سأل عنه: فواتير الفترة، بيدوس على اللي عايزه.
   */
  const [periodRows, setPeriodRows] = useState<any[] | null>(null);

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
  // بصمة المستند لحظة ما اتفتح للتعديل — المرجع اللي «اتغيّر ولا لأ؟» بيتقاس عليه.
  const [openedFingerprint, setOpenedFingerprint] = useState<string | null>(null);
  // الخزنة المكتوبة على الفاتورة اللي اتفتحت للتعديل — بتتحط جاهزة في بوباب الخزنة
  // بدل ما يسأل من الأول. `null` للفاتورة الجديدة.
  const [docCashAccountId, setDocCashAccountId] = useState<number | null>(null);

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
  /** رقم الفاتورة المفتوحة للتعديل — بضاعتها بترجع للرصيد وقت العرض. الشرح في
   *  `loadWarehouseStock`. `ref` مش `state` عشان الدالة بتتنده في نفس اللفّة اللي
   *  بتتفتح فيها الفاتورة، قبل ما أي `setState` توصل. */
  const excludeDocRef = useRef<number | null>(null);
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

  // فحص النظام بيبعت أرقام الفواتير اللي فيها الخلل في الرابط. من غير ده الزرار
  // بيوديك على الكشف كله وتدوّر انت على الأربعة اللي هو عارفهم. `FocusedRows` بيشرح.
  const focus = useFocusedIds();
  // `fetchInvoices` مش معمولة بـ`useCallback`، فالمرجع أضمن من المتغيّر: بيتقرا وقت
  // النداء مش وقت التعريف.
  const focusRef = useRef<string | null>(null);
  focusRef.current = focus.ids ? Array.from(focus.ids).join(',') : null;

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
      // أرقام فحص النظام بتتبعت للسيرفر مش بتتفلتر هنا: الشاشة بتحمّل صفحة، والفلترة
      // المحلية كانت بتعرض اللي من الأربعة في الصفحة دي بس — واحدة، والتلاتة مختفيين.
      const focusIds = focusRef.current;
      const [salesRes, returnsRes, sumRes] = await Promise.all([
        api.get('/api/v1/sales', {
          params: { ...params, limit: PAGE_SIZE, ...(focusIds ? { ids: focusIds } : {}) },
        }),
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
  // فحص النظام بيبعت أرقام الفواتير اللي فيها الخلل في الرابط. من غير ده الزرار
  // بيوديك على الكشف كله وتدوّر انت على الأربعة اللي هو عارفهم. `FocusedRows` بيشرح.

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
      // الفرق نفسه، مش النسبة × الإجمالي: النسبة المجمّعة مقرّبة لمنزلتين، والطرح
      // بيدّي القرش الصح مهما كانت الخصومات. وبيشمل خصم السطور تلقائياً لأن `net`
      // محسوب بعدها — وده اللي كان بيخلّي الكشف يقول «خصم ٠» على فاتورة خصمها ٢٠٪.
      discount_value: Number(s.gross || 0) - Number(s.net || 0),
      // الأساس اللي النسبة بتتقاس عليه في عمود «خصم%» — الإجمالي **قبل** خصم السطور،
      // وإلا ٢٠٪ بتطلع ٢٥٪.
      discount_base: Number(s.gross_before_line_discount || 0) || Number(s.gross || 0),
      net: Number(s.net || 0),
      cash_amount: Number(s.cash_amount || 0),
      credit_amount: Number(s.credit_amount || 0),
      // (المرحلة ٣) الصف الموحّد بينسخ بالاسم، فاللي مش مكتوب هنا بيوصل فاضي مهما
      // كان الرد كامل — والتحصيل من دول.
      payment_state: s.payment_state ?? null,
      payment_state_label: s.payment_state_label ?? null,
      residual: s.residual ?? null,
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
      combined = [...saleRows, ...returnRows];
    } else if (docKindFilter === 'sale') {
      combined = saleRows;
    } else {
      combined = returnRows;
    }

    return combined.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
  }, [invoices, salesReturns, docKindFilter]);

  /** الكشف بعد فلتر «ودّيني على اللي فيه المشكلة» — أو هو زي ما هو لو مافيش فلتر. */
  // الأرقام اتغيّرت (دوس «اعرض الكل» أو جه من الرئيسية) ⇒ الكشف يتجاب من جديد.
  const focusKey = focusRef.current ?? '';
  useEffect(() => { fetchInvoices(); /* eslint-disable-next-line */ }, [focusKey]);

  const focusedRecords = useMemo(
    () => focus.filter(unifiedRecords, (r: any) => r.id),
    [focus, unifiedRecords],
  );

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

  /**
   * **الكشف بيتجاب من مكان واحد.** كان فيه `fetchInvoices()` هنا و`fetchInvoices()`
   * تاني في تأثير `focusKey` فوق — والاتنين بيشتغلوا عند الفتح، فكل دخلة على الشاشة
   * كانت بتنادي الكشف والمرتجعات والملخّص **مرتين**: ستة طلبات مكان تلاتة، وأبطأهم
   * (`sales/summary`) قِيس بأربع ثواني ونص. الجلب سايب لتأثير `focusKey` وحده.
   */
  useEffect(() => {
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

  // خصم بعد خصم: المتغيّر على الباقي بعد خصم الصنف، مش مجموع النسبتين.
  const lineDiscountPct = (l: SaleLineItem) =>
    Math.min(99.99, combinePct(l.fixed_discount, l.variable_discount));

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

  // A line's amount AFTER its own discounts — the variable one comes off what the
  // fixed one left, not off the list price.
  const lineTotal = (l: SaleLineItem) =>
    applyPct(Number(l.quantity || 0) * l.unit_price, l.fixed_discount, l.variable_discount);

  // Loyalty points a line earns = the product's point value × quantity.
  const linePoints = (l: SaleLineItem) =>
    (l.item_id ? (pointValues[l.item_id] || 0) : 0) * (l.quantity || 0);

  // Invoice computations: per-line discounts first, then the invoice-total discount.
  const grossTotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const netTotal = netOf(grossTotal, discountPct);

  /**
   * أعمدة شبكة سطور الفاتورة كبيانات — بأبعاد متناسقة ومساحات مريحة.
   */

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
    // العنوان بيرجع للكشف مع قفل المستند — `replace` مش `push` عشان «رجوع» مايعيدش
    // فتح اللي انت قافله لسه.
    clearDocParam();
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
    setPendingWarehouse(null);
    setPickerOpen(false);
    setPartyPickerOpen(false);
    setNewStep(null);
    setInvoiceDate(dayjs());
    createForm.resetFields();
  };

  /**
   * بصمة المستند من حقوله اللي بتتعدّل — مش كل الحالة.
   *
   * `key` بتاع السطر متولّد من `Date.now()` فبيتغيّر مع كل إعادة بناء، والرصيد والأسعار
   * المحمّلة بتتحدّث من السيرفر لوحدها. الحاجات دي لو دخلت البصمة، كل فاتورة محفوظة
   * هتبان متغيّرة أول ما تتفتح — وهي دي المشكلة اللي بنحلها.
   */
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

  /**
   * **المسودّة — الفاتورة اللي اتكتبت ولسه ما اترحّلتش.**
   *
   * الحمولة هي **نفس بصمة الفاتورة** اللي الشاشة بتقيس بيها «فيه شغل مش محفوظ؟»
   * (`fingerprintOf`) — نفس الحقول بالظبط، بما فيها الكوبونات وعيلة الفاتورة. لو
   * اتفرّقوا، الشاشة هتسأل على تغيير المسودّة مش شايلاه، أو تحفظ حاجة مش محسوبة
   * في السؤال.
   */
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
    // الفاتورة المفتوحة للعرض أو للتعديل مستند، مش مسودّة.
    paused: Boolean(viewOnly || editingInvoice),
    isEmpty: (x: any) => !x?.form?.customer_id
      && !(x?.lines || []).some((l: any) => l.item_id != null),
    title: (x: any) => {
      const n = (x?.lines || []).filter((l: any) => l.item_id != null).length;
      return `فاتورة بيع — ${n} صنف`;
    },
  });

  /** بيفتح مسودّة في الشاشة — نفس حالة الشاشة اللي اتحفظت. */
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

  // Close the create page and clear it, so reopening starts fresh.
  /**
   * «رجوع» بيسأل قبل ما الشغل يضيع.
   *
   * كان بيخرج على طول، وزرار الرجوع في ركن الشاشة جنب زراير بتتضغط كتير — والفاتورة
   * اللي اتكتبت سطر سطر بتروح بضغطة غلط من غير ولا سؤال، ومافيش مسوّدة بتتحفظ لوحدها.
   *
   * والمستند اللي بيتعرض للقراية بس (`viewOnly`) بيقفل من غير سؤال: مافيش حاجة تضيع،
   * والسؤال ساعتها عقبة مالهاش سبب.
   */
  const closeCreate = () => {
    const leave = () => {
      resetDocument();
      setCreateVisible(false);
      // المستند اتفتح من شاشة تانية ⇒ «رجوع» يرجّع لهناك، مش لكشف الفواتير.
      if (cameFromScreen.current) { cameFromScreen.current = false; navigate(-1); }
    };
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
      // الفاتورة المحفوظة مش بتضيع — اللي بيضيع هو التعديل اللي مااتحفظش. والجملة
      // القديمة («فيه ٥ صنف هيروحوا ومش هيرجعوا») كانت بتقول العكس على مستند موجود
      // على السيرفر، فاللي بيقراها بيفتكر إنه بيمسح فاتورة.
      content: verdict === 'confirm-edit'
        ? 'التعديلات اللي عملتها مااتحفظتش. الفاتورة نفسها هتفضل زي ما هي.'
        : lines.length
          ? `فيه ${lines.length} صنف بإجمالي ${money(netTotal)} ج.م — هيروحوا ومش هيرجعوا.`
          : 'اللي كتبته هيروح ومش هيرجع.',
      okText: verdict === 'confirm-edit' ? 'اخرج من غير حفظ' : 'اخرج واسيبه',
      okButtonProps: { danger: true },
      cancelText: verdict === 'confirm-edit' ? 'أرجع أكمّل' : 'أكمّل المستند',
      onOk: leave,
    });
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
    const n = stock.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 });
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
   *  warehouse a line is switched to, so each line can be capped against the right stock.
   *
   *  **والفاتورة المفتوحة للتعديل مابتتحاسبش على نفسها.** بضاعتها اتخصمت من الرصيد يوم ما
   *  اترحّلت، فالرقم اللي بيرجع من غير `exclude_doc_*` هو الرصيد **بعد** خصمها — والشاشة
   *  بتقيس الكميات المكتوبة عليه، يعني بتعامل الخمسة اللي اتباعوا على إنهم خمسة جداد
   *  محتاجين يتوفروا كمان. فاللي باع آخر خمسة مايقدرش يفتح فاتورته يصلّح سعر: الحارس
   *  بيقول «مفيش رصيد» ويقصّ الكمية لصفر، عن بضاعة الفاتورة دي نفسها هي اللي واخداها.
   *
   *  والسيرفر وقت الحفظ بيعمل نفس الحاجة بترتيب تاني — بيشيل أثر الفاتورة القديمة الأول
   *  وبعدين يقيس — فالاتنين بيقيسوا على نفس الرقم. */
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
    // Lines still pointing at no warehouse of their own follow the document.
    await loadWarehouseStock(warehouseId);
  };

  /**
   * الباب اللي بعد المخزن — ولا ولا حاجة.
   *
   * «نوع الفاتورة» سؤال عن حساب العميل، فمابيتسألش غير لما يكون عنده أكتر من حساب فعلاً.
   * العميل العادي عنده واحد بس، والدورة بتخلص عند المخزن وتفتح المستند على طول.
   */
  // وباب «نوع الفاتورة» مابيتفتحش في المصنع: الخط أداة تجزئة، والمستند هناك مالوش
  // خط. سؤال إجابته الوحيدة «مش مهم» بيتشال، مابيتسألش وبيتعدّى عليه.
  const afterWarehouseStep = (): null | 'family' => (isFactory ? null : 'family');

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
    const validCoupons = couponRows.filter(couponRowHasContent);
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
          .toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })})`,
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
        preselect: docCashAccountId,
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
                // Combined per-line discount: the typed variable applied to what the
                // item's fixed discount left — one effective rate for the server.
                discount_pct: combinePct(l.fixed_discount, l.variable_discount).toFixed(2),
                // ...والنصّين، عشان الفاتورة اللي بتتقرا تاني تفضل عارفة القسمة. من غيرهم
                // الشاشة بتحطّ الخصم كله في «خصم ثابت» وتقول «متغيّر ٠» — يعني بتنسب
                // للشركة خصم ماعملتهوش. والقاعدة بقى فيها العمودين.
                fixed_discount_pct: Number(l.fixed_discount || 0).toFixed(2),
                variable_discount_pct: Number(l.variable_discount || 0).toFixed(2),
                serials: prod?.is_serialized ? parseSerials(l.serials) : null,
                // (030) Only sent when it differs from the document's, so the server keeps its
                // "fall back to the document" behaviour for everything else.
                warehouse_id: l.warehouse_id ?? undefined,
              };
            }),
            // (030) document fields
            external_document_number: values.external_document_number || undefined,
            cost_center_id: values.cost_center_id ?? null,
            cost_center_distribution: values.cost_center_distribution ?? null,
            invoice_date: (invoiceDate || dayjs()).format('YYYY-MM-DD'),
            // Coupons handed over with this invoice, as the serial range off the book. Kept on the
            // invoice because that is what proves which coupons were his when they come back in.
            coupons: couponRows
              .filter(couponRowHasContent)
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
          // بعد ما السيرفر يرد بنجاح وبس — الفاتورة اللي اترفضت بتفضل مسودّة.
          discardDraft();
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
  /**
   * الرابط الجاي من بره بيفتح الفاتورة — مرة واحدة، والبارامتر بيتمسح بعدها.
   *
   * ⚠️ **وده مش `useDocRoute`.** جرّبت أربط الشاشة دي بيه (عشان «رجوع» يقفل الفاتورة
   * ويرجّع للكشف) ومعاه المسودّات، والشاشة طلعت **بيضا** عند العميل. الاتنين اتشالوا من
   * هنا لحد ما يبان الخطأ الحقيقي في الكونسول — شاشة مابتفتحش مش مقايضة مع أي تحسين.
   */
  /**
   * كتابة المستند في العنوان وشيله — الحتة الوحيدة اللي بتلمس `?doc=` بعد التحميل.
   *
   * `docInUrl` بيمسك آخر رقم كتبناه إحنا، وبيمنع اللفّة: الكتابة بتغيّر `searchParams`،
   * والتأثير اللي تحت بيصحى عليها، ولولا الحارس ده كان هيعتبرها طلب فتح جديد ويفتح
   * المستند تاني ويمسح البارامتر اللي لسه كاتبينه.
   */
  const docInUrl = useRef<number | null>(null);
  /**
   * قفل المستند لما «رجوع» بتاع المتصفح يشيله من العنوان.
   *
   * **مش `resetDocument` وحدها** — دي بتفضّي حالة المستند وبس، والشاشة بتفضل على صفحة
   * المستند فاضية. `setCreateVisible(false)` هو اللي بيرجّع للكشف، وده اللي `closeCreate`
   * بيعمله. غياب السطر ده خلّى الرجوع يشيل العنوان ويسيب الشاشة مكانها.
   *
   * ومافيش سؤال «تسيب المستند؟» هنا زي `closeCreate`: اللي داس رجوع خرج خلاص، والسؤال
   * بعد الخروج بيبقى متأخر. واللي اتكتب مش بيضيع — `useDraft` بيحفظه لوحده.
   *
   * والمرجع بدل الدالة عشان التأثير مايعتمدش على حاجة بتتبني كل رندر.
   */
  const closeOnBackRef = useRef<(() => void) | null>(null);
  const writeDocParam = useCallback((id: number) => {
    docInUrl.current = id;
    const next = new URLSearchParams(window.location.search);
    next.set('doc', String(id));
    next.delete('edit'); next.delete('id'); next.delete('back');
    setSearchParams(next, { replace: false });
  }, [setSearchParams]);
  const clearDocParam = useCallback(() => {
    docInUrl.current = null;
    const next = new URLSearchParams(window.location.search);
    if (!next.has('doc') && !next.has('edit') && !next.has('id')) return;
    next.delete('doc'); next.delete('edit'); next.delete('id'); next.delete('back');
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);

  closeOnBackRef.current = () => { resetDocument(); setCreateVisible(false); };

  const pendingIntent = useRef<{ id: number; mode: 'view' | 'edit' } | null>(null);
  /**
   * **جاي من شاشة تانية** — كارت صنف، كشف حساب، كارت عميل، تقرير.
   *
   * لازم تتلتقط هنا بالذات: السطر اللي تحت بيمسح البارامترات، فالعلامة بتروح معاها.
   * ولو راحت، «رجوع» بيرجّع لكشف الفواتير — شاشة اللي ضغط مالوش دعوة بيها، ولازم
   * يروح يدوّر على الصنف اللي كان فيه من الأول.
   */
  const cameFromScreen = useRef(false);

  useEffect(() => {
    const doc = searchParams.get('doc');
    const edit = searchParams.get('edit');
    const id = searchParams.get('id');
    // البارامتر اللي إحنا كاتبينه لما فتحنا المستند مش طلب فتح — تخطّيه.
    if (doc && Number(doc) === docInUrl.current) return;
    // **«رجوع» بتاع المتصفح بيقفل المستند.**
    //
    // البارامتر راح وإحنا لسه فاتحين — يبقى اللي شاله هو زرار الرجوع مش إحنا
    // (`clearDocParam` بيصفّر `docInUrl` قبل ما يلمس العنوان). من غير السطر ده العنوان
    // بيرجع للكشف والشاشة تفضل على المستند: الاتنين بيفرقوا، واللي بعده بيبقى عشوائي.
    if (!doc && !edit && !id && docInUrl.current !== null) {
      docInUrl.current = null;
      closeOnBackRef.current?.();
      return;
    }
    if (doc || edit || id) {
      pendingIntent.current = { id: Number(doc || edit || id), mode: edit ? 'edit' : 'view' };
      cameFromScreen.current = searchParams.get('back') === '1';
      // `edit`/`id`/`back` بيتمسحوا عشان مايتعادوش عند إعادة التحميل. و`doc` **بيفضل**:
      // هو اللي بيخلّي تحديث الصفحة يرجّعك لنفس المستند بدل ما يرميك على الكشف.
      const next = new URLSearchParams(window.location.search);
      next.delete('edit'); next.delete('id'); next.delete('back');
      setSearchParams(next, { replace: true });
    }
    const wanted = pendingIntent.current;
    if (!wanted) return;
    pendingIntent.current = null;
    const target = invoices.find((i) => i.id === wanted.id) || ({ id: wanted.id } as InvoiceRecord);
    if (wanted.mode === 'view') openDetail(target);
    else handleEditInvoice(target);
  }, [searchParams, invoices]);

  /** The invoice `step` places away in the list as currently filtered, or null at the ends. */
  /** بيحمّل فواتير الفترة في نفس قايمة التنقل، وبيفتح أولها. */
  const loadPeriod = async () => {
    const from = loadRange?.[0];
    const to = loadRange?.[1];
    if (!from || !to) { message.warning('اختار الفترة الأول'); return; }
    setLoadingRange(true);
    try {
      const next = {
        ...filters,
        date_from: from.format('YYYY-MM-DD'),
        date_to: to.format('YYYY-MM-DD'),
      } as InvoiceFilters;
      setFilters(next);
      const res = await api.get('/api/v1/sales', {
        params: { ...next, limit: PAGE_SIZE },
      });
      const rows = res.data || [];
      setInvoices(rows);
      if (!rows.length) {
        setPeriodRows([]);
        message.info('مافيش فواتير في الفترة دي');
        return;
      }
      // الكشف بيفضل مفتوح — الشرح عند `periodRows`.
      setPeriodRows(rows);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الفترة');
    } finally {
      setLoadingRange(false);
    }
  };

  const neighbour = (step: number) => {
    if (!viewInvoice) return null;
    // The list itself is the order — the server already returns it filtered and sorted, and the
    // table renders it unchanged, so the arrows walk exactly what the user is looking at.
    const rows = invoices;
    const at = rows.findIndex((r: any) => r.id === viewInvoice.id);
    if (at < 0) return null;
    return rows[at + step] ?? null;
  };

  /** Extra header lines on the printed invoice: the paper number, and the coupon books the sale
   *  issued — the customer's own proof of which serials are his.
   *
   *  **السطر لكل فئة، مش سطر واحد للكل.** الكوبونات بتتسجّل صف لكل فئة دفتر بمداه (وده
   *  اللي التطبيق والويب الاتنين بيبعتوه)، والورقة كانت بتقرا الشكل القديم وحده —
   *  `coupon_serial_from` على رأس الفاتورة. فاللي بيسلّم مية دهبي وخمسين فضي كانت ورقته
   *  بتطلع من غير ولا كوبون، والعميل ماسك دفاتر مالهاش إثبات إنها اتسلّمت.
   *
   *  والشكل القديم سايب تحته: فواتير اتكتبت قبل الصفوف لسه بتتطبع صح. */
  const printMeta = (inv: any): [string, string][] | undefined => {
    const meta: [string, string][] = [];
    if (inv.external_document_number) meta.push(['رقم المستند', inv.external_document_number]);
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

  // الأعمدة بتتبني هنا مش فوق: `buildLineColumns` بتنادى وقت التعريف، فلازم كل اللي
  // بتاخده يكون اتعرّف قبلها. اللي كان فوق كان بيقرا الدوال دي جوّه closures، فماكانش
  // بيلمسها غير وقت الرسم.
  const lineColumns = buildLineColumns({
    viewOnly, warehouses, totalPoints, pointValues, productName, saleUnitOptions,
    saleLineNet, linePoints, checkedQuantity, handleLineChange, handleRemoveLine,
    advanceFrom, setDocWarehouseId, setPanelItemId, hidePoints: isFactory,
  });
  const lineGrid = useEntryGrid('invoice-lines-grid', lineColumns);

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

  /** إجمالي كوبونات الفاتورة — من صفوف الفئات، وإلا من المدى القديم اللي على الرأس.
 *  العدد المكتوب أولاً، والمحسوب من المدى لو مش متكتوب. */
function couponsTotal(inv: any): number {
  const rows: any[] = inv?.coupons ?? [];
  if (rows.length) {
    return rows.reduce(
      (t, c) => t + (c.count ?? couponCount(c.serial_from, c.serial_to) ?? 0), 0);
  }
  return inv?.coupon_count ?? couponCount(inv?.coupon_serial_from, inv?.coupon_serial_to) ?? 0;
}

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
      // **المستند المفتوح بيبقى في العنوان.**
      //
      // كان بيتفتح كحالة جوّه الشاشة والعنوان يفضل `/invoices` — فتحديث الصفحة بيضيّع
      // اللي انت فاتحه، والرابط مايتبعتش لحد، وتاريخ المتصفح فيه الأقسام بس.
      //
      // ⚠️ **والكتابة في اتجاه واحد عن قصد.** فيه محاولة قبل كده تربط الشاشة دي
      // بـ`useDocRoute` (اللي بيخلّي العنوان **يقود** الشاشة) و**طلعت شاشة بيضا عند
      // العميل** فاتشالت — الشرح تحت عند `pendingIntent`. فالشاشة هنا بتكتب العنوان
      // وبس، والعنوان مابيقودش غير عند التحميل الأول. كده الفايدة اتاخدت والخطر لأ.
      writeDocParam(record.id);
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
          // القسمة اللي اتسجّلت مع السطر. `null` معناها سطر مش عارف قسمته (اتكتب قبل
          // العمود، أو اتنقل من a5) — وساعتها المجموع بيتعرض كله «ثابت» زي ما كان، لأن
          // ده اللي كان معروف عنه وقتها. التخمين إنه متغيّر بيقول على المندوب حاجة
          // ماعملهاش، والعكس بيقول على الشركة حاجة ماقالتهاش.
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

      // رصيد المخازن اللي الفاتورة دي بتصرف منها — **وهي مطروحة من الحساب**.
      //
      // الشاشة كانت بتفتح الفاتورة من غير ما تجيب رصيد أي مخزن أصلاً، فالحارس بيقرا
      // «غير معروف» على إنه صفر: كل سطر بيتقصّ على صفر وبيطلع «مفيش رصيد» — عن بضاعة
      // مكتوبة قدامه في الفاتورة. والجلب من غير `excludeDocRef` كان هيحسّن الرسالة مش
      // أكتر، لأن الرصيد ساعتها بعد خصم الفاتورة دي نفسها.
      excludeDocRef.current = record.id;
      setAvailability({});
      const stores = new Set<number>(
        (refilled.map((l) => l.warehouse_id).filter(Boolean) as number[]));
      if (first?.warehouse_id) stores.add(first.warehouse_id);
      await Promise.all([...stores].map((w) => loadWarehouseStock(w, true)));

      setDiscountPct(Number(det.variable_discount_pct ?? det.discount_pct ?? 0));
      setCashAmount(Number(det.cash_amount) || 0);
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

      // **العميل اللي بره القايمة بيتضاف للقايمة.**
      //
      // خانة العميل بتلاقي اسمها من `customers`، وهي محدودة بألفين. العميل اللي
      // ترتيبه بعد كده كانت خانته بتعرض `1706` — الرقم الخام اللي `Select` بتعرضه
      // لما مالاقيش الخيار. المستند بقى بيجيب اسمه معاه، فالاسم بيتحط في القايمة
      // أول ما المستند يتفتح. ونفس الحكاية للمندوب.
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
      // بيتبني في متغيّر الأول عشان البصمة تاخد نفس الصفوف اللي الشاشة اتعبّت بيها.
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

      // البصمة بتتاخد من القيم اللي لسه اتبنت فوق، مش من الحالة: `setLines` وإخواته
      // مابيتنفّذوش في نفس اللفّة، فقراية الحالة هنا بترجّع اللي كان قبل الفتح.
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
      // حساب العميل قبل الفاتورة، متقفّل وقت الترحيل. بيتقرا من المستند مش من رصيد
      // العميل دلوقتي — الرصيد بيتغيّر مع كل حركة، ونفس الورقة كانت هتطلع برقمين.
      priorBalance: (inv as any).prior_balance ?? null,
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
  // الأعمدة اتفصلت لملفها — تعريف بلا حالة مالوش لازمة يقعد في نص الشاشة.
  const columns = buildRegisterColumns({
    customers, reps, postingAccounts, filters, printOpts, navigate, openDetail,
    invoiceDoc, canEditInvoice, canDeleteInvoice, handleEditInvoice, handleDeleteInvoice,
    handleDeleteReturn,
    onDeleteDraft: (id: number) => removeDraft(id),
  });

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
    const couponCountVal = couponRows.filter(couponRowHasContent).length;
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
        // **الدوسة التانية بترجّع الكشف اللي اتحمّل، مش بتمسحه.** واللي عايز فترة
        // تانية بيدوس «فترة تانية» جوّه الكشف — فمحدش بيخسر تحميل بالغلط.
        onClick: () => {
          if (periodRows?.length) { setLoadRangeOpen(true); return; }
          setLoadRange(null); setPeriodRows(null); setLoadRangeOpen(true);
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
                  ? `طلب بيع رقم: ${viewInvoice.document_number || ''}`
                  : editingInvoice
                    ? `تعديل طلب بيع #${editingInvoice.id}`
                    : 'تسجيل طلب بيع جديد'}
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
        {/* شريط المستند — المسار والمكان في السجل والحالة، فوق شريط الأدوات.
            الأسهم بتمشي على نفس الترتيب المفلتر اللي المستخدم شايفه. */}
        <DocumentBar
          listLabel="فواتير البيع"
          listTo="/invoices"
          title={viewInvoice
            ? (viewInvoice.document_number || `#${viewInvoice.id}`)
            : editingInvoice
              ? `تعديل #${editingInvoice.id}`
              : 'فاتورة جديدة'}
          position={viewInvoice
            ? invoices.findIndex((r: any) => r.id === viewInvoice.id) + 1 || null
            : null}
          total={viewInvoice ? invoices.length : null}
          onPrev={viewInvoice && neighbour(-1)
            ? () => { const n = neighbour(-1); if (n) openDetail(n); } : undefined}
          onNext={viewInvoice && neighbour(1)
            ? () => { const n = neighbour(1); if (n) openDetail(n); } : undefined}
          steps={[
            { key: 'draft', label: 'مسودة' },
            { key: 'posted', label: 'مرحّل', color: 'green' },
            { key: 'voided', label: 'مردود / ملغي', color: 'volcano' },
          ]}
          current={!viewInvoice && !editingInvoice
            ? 'draft'
            : (viewInvoice || editingInvoice)?.voided ? 'voided' : 'posted'}
        />
        <DocumentToolbar actions={docToolbar()} />
        {/* `doc-form` بيضغط المسافات ويغمّق الأسماء — نفس فاتورة الشرا. */}
        <Form form={createForm} layout="vertical" size="small" className="doc-form"
          onValuesChange={() => setFormTick((n) => n + 1)}
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
                <Input value="طلب بيع" readOnly style={{ fontWeight: 700, color: '#2b6cb0', background: '#ebf8ff', textAlign: 'center' }} />
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
                  }))} filterOption={searchFilter} filterSort={searchRank}/>
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
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank}/>
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
                  options={reps.map((r) => ({ value: r.id, label: r.full_name }))} filterOption={searchFilter} filterSort={searchRank}/>
              </Form.Item>
            </Col>
            {/* الخط أداة تجزئة — مش في المصنع. الشرح فوق عند `isFactory`. */}
            {!isFactory && (
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
            )}
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
            <Col xs={12} md={6}>
              <Form.Item label="مركز التكلفة" style={{ marginBottom: 8 }}>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="cost_center_id" noStyle>
                    <CostCenterField />
                  </Form.Item>
                  <Form.Item name="cost_center_distribution" noStyle>
                    <CostCenterSplit size="middle" disabled={viewOnly} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>

          {/* الكوبونات المصروفة — مش في المصنع */}
          {!isFactory && (
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
                    options={couponKindOptions.map((k) => ({ value: k.value, label: k.label }))} filterOption={searchFilter} filterSort={searchRank}/>
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
          )}

          {!isFactory && families.length > 1 && (
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
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank}/>
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
            availableFor={(id) => (docWarehouseId === null || !availability[docWarehouseId]
              ? null : availableFor(id, null, docWarehouseId))}
            availabilityVersion={`${docWarehouseId ?? ''}|${Object.keys(availability).join(',')}`}
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
          {/* صور الورقة — الفاتورة الموقّعة وإيصال الاستلام. `viewInvoice` بيفضل `null`
              على الفاتورة الجديدة (شوف `resetDocument`)، والمكوّن بيختفي لحد ما تترحّل
              وياخد رقم يتعلّق عليه. */}
          <DocumentAttachments docType="sales_invoice" docId={viewInvoice?.id} />

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
                  isFactory ? null : (
                  <>النقاط: <b style={{ color: '#F5A11D' }}>
                    {totalPoints.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}</b></>),
                  creditAmount < -0.001 ? (
                    <>يسدّد من المديونية القديمة:{' '}
                      <b style={{ color: '#6AB42D' }}>{money(Math.abs(creditAmount))} ج.م</b></>
                  ) : null,
                  creditAmount > 0.001 ? (
                    <>آجل على الفاتورة دي:{' '}
                      <b style={{ color: '#cf1322' }}>{money(creditAmount)} ج.م</b></>
                  ) : null,
                  // «كوبونات سابقة» مش «الكوبونات»: دي اللي اتصرفت للعميل قبل كده ولسه
                  // ماترجعتش — **مش** الدفتر اللي بيتسلّم على الفاتورة دي. الاسم القديم
                  // كان واقع تحت صفوف كوبونات الفاتورة على طول، فالشاشة كانت بتقول
                  // «الإجمالي: ٥ كوبون» وتحتها «الكوبونات: لا يوجد».
                  hasParty ? (
                    <>كوبونات سابقة للعميل:{' '}
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
          // **نفس الأبواب اللي برّه بالظبط.** النسخة دي كانت بتفتح على العملاء وحدهم،
          // والنسخة اللي بتتفتح من الكشف بتفتح على العملاء والموظفين والموردين — فاللي
          // بيفتح فاتورة من جوّه مايقدرش يختار موظف، واللي اتعلّم إيده على واحدة
          // بيلاقي التانية بتقول حاجة تانية. القايمة واحدة عشان السلوك واحد.
          kinds={['customer', 'employee', 'supplier']}
          excludeTypes={['plumber']}
          onPick={handlePartyPicked}
          // `setNewStep(null)` مش زيادة: من غيرها الإلغاء بيقفل الشباك ويسيب الدورة واقفة على
          // خطوة «العميل» — والمستند مفتوح قدامك بس Enter مش بيفتح منتقي الأصناف لأن الحارس
          // شايف إن فيه خطوة لسه شغالة.
          onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }}
          date={createVisible ? undefined : invoiceDate}
          onDateChange={setInvoiceDate} />

        <TreasuryGate {...treasuryGate} />

        {/* **«تحميل»: فترة ← كشف ← تدوس على اللي عايزه.**
            كانت بتفتح أول فاتورة في الفترة وتقفل — واللي بيدوّر على واحدة بعينها
            بيلاقي نفسه جوّه غيرها. دلوقتي الكشف بيفضل قدامه، والدوسة التانية على
            «تحميل» بترجّعه بدل ما تمسحه. */}
        <TabModal
          open={loadRangeOpen}
          title={periodRows?.length
            ? `فواتير الفترة — ${periodRows.length}`
            : 'تحميل فواتير فترة'}
          width={periodRows?.length ? 760 : 520}
          confirmLoading={loadingRange}
          onCancel={() => setLoadRangeOpen(false)}
          footer={periodRows?.length ? (
            <Space>
              <Button onClick={() => { setPeriodRows(null); setLoadRange(null); }}>
                فترة تانية
              </Button>
              <Button onClick={() => setLoadRangeOpen(false)}>إغلاق</Button>
            </Space>
          ) : (
            <Space>
              <Button onClick={() => setLoadRangeOpen(false)}>إلغاء</Button>
              <Button type="primary" loading={loadingRange}
                disabled={!(loadRange?.[0] && loadRange?.[1])}
                onClick={loadPeriod}>تحميل</Button>
            </Space>
          )}
        >
          {periodRows?.length ? (
            <Table size="small" rowKey="id" dataSource={periodRows}
              pagination={{ pageSize: 10, size: 'small' }}
              onRow={(r: any) => ({
                style: { cursor: 'pointer' },
                onClick: () => { setLoadRangeOpen(false); openDetail(r); },
              })}
              columns={[
                { title: 'المستند', dataIndex: 'document_number', width: 150 },
                { title: 'التاريخ', dataIndex: 'invoice_date', width: 120 },
                { title: 'العميل', dataIndex: 'customer_name', ellipsis: true },
                { title: 'الإجمالي', dataIndex: 'total', width: 130,
                  align: 'left' as const,
                  render: (v: string) => <b>{money(v)}</b> },
              ]} />
          ) : (
            <>
              <DateRangeFilter
                value={loadRange as any}
                onChange={(v) => setLoadRange(v as any)}
              />
              <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
                هيتحمّل فواتير الفترة دي في كشف، وتدوس على اللي عايزه — و«السابق»
                و«التالى» بيمشوا بينهم بعد ما تفتح واحدة.
              </div>
            </>
          )}
        </TabModal>

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
            <PrintOptionsMenu value={printOpts} onChange={setPrintOpts}
                  hideKeys={['logo', 'companyName']} />
            <Button type="primary" icon={<PlusOutlined />}
              style={{ fontWeight: 600 }}
              // نفس تفضية «جديد» بالظبط. الزرار ده كان بيفتح الدورة على الحالة اللي
              // سايبها المستند اللي قبله — ودي كانت أقصر طريق لكوبونات فاتورة غلط.
              onClick={() => { resetDocument(); setNewStep('party'); }}>
              تسجيل طلب بيع
            </Button>
          </Space>
        )}
      >
        {/* --- Summary Statistics --- */}
        <StatsRow gutter={[12, 12]} style={{ marginBottom: 16 }}>
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
        </StatsRow>

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
              filterOption={searchFilter} filterSort={searchRank}
              options={customers.map((c) => ({ value: c.id, label: c.name }))} />
          </Col>
          <Col xs={12} sm={12} md={3}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="المندوب"
              value={filters.rep_id}
              onChange={(v) => setFilter('rep_id', v)}
              filterOption={searchFilter} filterSort={searchRank}
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

        <FocusedRowsBanner focus={focus} total={unifiedRecords.length} noun="فاتورة"
                           shown={focusedRecords.length} />
        <Table
          // المسودّات فوق، وبرّه `focusedRecords` عن قصد: ملخّص المبيعات فوق بيتبني
          // من المستندات، والمسودّة مش مستند — مايصحّش تتحسب في «صافي المبيعات».
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
          columns={visibleColumns}
          size="small"
          tableLayout="fixed"
          // من غير `scroll` أفقي — الشاشة مالهاش يمين وشمال.
          //
          // مع `tableLayout: fixed` وكل عمود له عرض، المتصفح بيوزّع الفرق على الأعمدة كلها
          // بالنسبة: زادت تتفرد شوية، قلّت تتضغط شوية. اللي كان بيكسّر الشكل هو عمود من غير
          // عرض — الفاضي كله كان بينزل عليه لوحده فيطلع شريط أبيض في نص الجدول.
          rowKey="rowKey"
          rowClassName={(r: any) => (r.__isDraft ? 'row-draft' : '')}
          loading={loading}
          pagination={{ defaultPageSize: TABLE_PAGE_SIZE, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: PAGE_SIZE_OPTIONS }}
          onRow={(record: any) => ({
            onClick: () => {
              // المسودّة مالهاش مستند يتفتح — الضغط بيستكملها.
              if (record.__isDraft) { resumeDraft(record.__draft); return; }
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
        kinds={['customer', 'employee', 'supplier']}
        excludeTypes={['plumber']}
        date={invoiceDate} onDateChange={(d) => setInvoiceDate(d)}
        onPick={handlePartyPicked}
        onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }} />

    </div>
  );
}

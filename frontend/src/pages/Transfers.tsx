import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DraftTag from '../components/DraftTag';
// **باسم مستعار عن قصد.** الملف ده عنده `PAGE_SIZE` بمعنى تاني خالص —
// حد الجلب من الـAPI، مش عدد صفوف الجدول.
import { PAGE_SIZE as TABLE_PAGE_SIZE, PAGE_SIZE_OPTIONS }
  from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Alert, Button, Col, DatePicker, Descriptions, Empty, Form, Input, Modal, Row,
  Select, Space, Tag, Tooltip, message,
} from 'antd';
// كل جدول هنا بفلتر على كل عمود — شوف `FilterTable`.
import { FilterTable as Table } from '../components/FilterTable';
import dayjs, { Dayjs } from 'dayjs';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, CheckCircleOutlined, RollbackOutlined, DeleteOutlined,
  ClearOutlined, ArrowLeftOutlined, ArrowRightOutlined, CloseCircleOutlined,
  EditOutlined, EyeOutlined, PrinterOutlined, ExclamationCircleOutlined,
  CheckOutlined, SwapOutlined, SearchOutlined, ShoppingCartOutlined, MinusOutlined, ReloadOutlined,
} from '@ant-design/icons';
import LoadPeriodModal from '../components/LoadPeriodModal';
import QuickAddRow from '../components/QuickAddRow';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useDraft } from '../components/useDraft';
import { useAuth } from '../components/AuthProvider';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';
import { guardQuantity } from '../components/quantityGuard';
import { advanceFrom } from '../components/lineKeyboard';
import { printTransfer } from '../components/TransferDocument';
import { useListFilter } from '../components/ListToolbar';
import ListPage, { type ListTab } from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import DateRangeFilter from '../components/DateRangeFilter';
import { matchesStatement } from '../utils/statements';
import ProductPickerModal from '../components/ProductPickerModal';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import { SaveOutlined, FileAddOutlined, UndoOutlined } from '@ant-design/icons';
import DocumentHistoryButton from '../components/DocumentHistory';
import { useTableKeyboard, useScreenShortcuts, useOnScreen } from '../components/keyboard';
import { useDocReturn } from '../components/docReturn';
import DocOpening from '../components/DocOpening';
import { TabModal } from '../components/TabModal';
import WarehouseGate from '../components/WarehouseGate';
import { withInactiveTag } from '../utils/active';
import DocumentAttachments from '../components/DocumentAttachments';
import { useTableColumns } from '../components/ColumnSettings';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
import { QTY_DATA_ATTR } from '../utils/duplicateItem';
import { addPickedSequentially, type PickResult } from '../utils/pickMany';

import { qty, numeralsLocale } from '../utils/money';
import { useLiveRefresh } from '../utils/live';
import SummaryTile from '../components/saleDoc/SummaryTile';
import './docs.extra.css';
// حجم الصفحة. الكشف كله بقى 1437 تحويل بـ17 ألف سطر بعد نقل داتا a5، وتحميلهم
// كلهم كان بياخد 7.6 ثانية على السيرفر نفسه قبل ما الشبكة تشوف حاجة.
const PAGE_SIZE = 300;

/**
 * تحويلات المخزون — move stock between locations.
 *
 * The form follows the order the storekeeper thinks in: FROM where, TO where, then the items —
 * picked from the same product window as the sale invoice. Because the source is known first, the
 * item picker is driven by what that location actually holds (`/stock/by-location`): an item with nothing there is never offered, and
 * each quantity is capped at what is available. The backend refuses an over-transfer regardless —
 * this only stops the user hitting that wall.
 */

interface TransferRecord {
  id: number;
  document_number: string;
  status: 'pending' | 'approved' | 'rejected' | 'reversed';
  // (031) الأصناف اللي على الإذن. A document written before lines existed has none and still shows
  // its own item/quantity, which is why this is optional rather than assumed.
  lines?: { id: number; item_id: number; quantity: string }[];
  reject_reason?: string | null;
  route: string;
  approved_by: number | null;
  item_id: number | null;
  quantity: string | null;
  source_location_kind: string | null;
  source_location_id: number | null;
  dest_location_kind: string | null;
  dest_location_id: number | null;
  created_at: string | null;
  transfer_date: string | null;
  /** «بيان» و«رقم المستند» و«ملاحظات» — سطور الكلام اللي الإذن كان عريان منها.
   *  اختيارية لأن الإذن المنقول من a5 مالوش ولا واحدة فيهم. */
  statement1?: string | null;
  external_document_number?: string | null;
  notes?: string | null;
}

interface StockRow {
  item_id: number;
  code: string | null;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  on_hand: string;
  /** المحجوز على أذونات تحويل معلّقة طالعة من نفس المصدر — مش متاح للتحويل دلوقتي. */
  pending_out?: string;
}

interface TransferLine {
  key: string;
  item_id: number;
  name: string;
  category: string | null;
  unit: string | null;
  available: number;
  /** null = «not typed yet», same as on the sale and the purchase: a box that opens at 1 turns
   *  «5» into «15» for anybody who types over it without clearing first. */
  quantity: number | null;
}

const ROUTE_LABELS: Record<string, string> = {
  central_to_branch: 'من مخزن إلى مخزن',
  central_to_rep: 'من مخزن إلى عهدة مندوب',
  rep_to_rep: 'مناقلة بين المناديب',
};

const STATUS_TAGS: Record<string, { color: string; text: string }> = {
  pending: { color: 'warning', text: 'بانتظار الاعتماد' },
  approved: { color: 'success', text: 'تم الاعتماد والشحن' },
  rejected: { color: 'error', text: 'مرفوض' },
  reversed: { color: 'default', text: 'ملغي' },
};

/** Locations are picked from one combined list; the value carries its kind. */
const locValue = (kind: string, id: number) => `${kind}:${id}`;
const parseLoc = (v: string) => {
  const [kind, id] = v.split(':');
  return { kind, id: Number(id) };
};

/** الاتجاه لوحده بيحدّد المسار — الأربع اتجاهات كلهم ليهم مسار دلوقتي. */
const routeFor = (srcKind: string, dstKind: string): string | null => {
  if (srcKind === 'warehouse' && dstKind === 'warehouse') return 'central_to_branch';
  if (srcKind === 'warehouse' && dstKind === 'custody') return 'central_to_rep';
  if (srcKind === 'custody' && dstKind === 'custody') return 'rep_to_rep';
  // المندوب بيرجّع بضاعة للمخزن. الاتجاه ده ماكانش ليه مسار، والشاشة كانت بتقول «استخدم
  // تسليم العهدة» — وتسليم العهدة بيسلّم فلوس مش بضاعة، فالبضاعة اللي في العربية ماكانش
  // ليها طريق ترجع بيه.
  if (srcKind === 'custody' && dstKind === 'warehouse') return 'rep_to_central';
  return null;
};

/** التاريخ اللي المستند بيتكلم عنه: تاريخ الحركة، وللقديم اللي مالوش واحد تاريخ تسجيله. */
const docDate = (t: { transfer_date?: string | null; created_at?: string | null }) =>
  String(t.transfer_date || t.created_at || '').slice(0, 10);

export default function Transfers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const { user, can } = useAuth();
  const canApprove = can('transfer.approve');

  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  /** «تحميل» — أذون فترة، والسابق/التالى بيمشوا جوّاها (زي فاتورة البيع، ٢٠٢٦-١٠-٠٥). */
  const [periodRows, setPeriodRows] = useState<TransferRecord[] | null>(null);
  const [loadRangeOpen, setLoadRangeOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [custodies, setCustodies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Create page
  const [createVisible, setCreateVisible] = useState(false);
  // The sale opens as a run of doors. A transfer's «who» is two places rather than one party, so
  // it asks them one at a time in the order the goods actually move: out of here, into there.
  const [newStep, setNewStep] = useState<null | 'source' | 'dest'>(null);
  // The product window, so a line is added by typing rather than by hunting a grid.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const [transferDate, setTransferDate] = useState<Dayjs>(dayjs());
  const [source, setSource] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [sourceStock, setSourceStock] = useState<StockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [lines, setLines] = useState<TransferLine[]>([]);
  /**
   * سطور الكلام على الإذن — «بيان» و«رقم المستند» و«ملاحظات».
   *
   * «رقم المستند» هو رقم الورقة اللي في إيد اللي بيحوّل، مش رقمنا: رقمنا بيتحجز عندنا
   * وهو بيفضل ماسك ورقة عليها رقم تاني، وبيدوّر بيه. فالاتنين بيتحفظوا جنب بعض.
   */
  const [statement1, setStatement1] = useState('');
  const [externalDocNumber, setExternalDocNumber] = useState('');
  const [docNotes, setDocNotes] = useState('');
  /**
   * السطور **بترتيب الإدخال، من غير تجميع بالفئة** (طلب العميل ٢٠٢٦-١٠-٠٥: «إذن التحويل
   * عايزه كله على بعضه»). كانت متجمّعة تحت ترويسة لكل فئة زي فاتورة البيع، فالصنف اللي
   * المندوب دخله أخير ممكن يطلع في النص. مجموعة واحدة ⇒ مافيش ترويسات فئات خالص.
   */
  const linesByCategory = useMemo(
    () => (lines.length ? [{ category: null as string | null, items: lines as TransferLine[] }] : []),
    [lines]);
  /** ترتيب السطور زي ما هي مرسومة — الترقيم وEnter ماشيين عليه. */
  const shownLines = useMemo(() => linesByCategory.flatMap((g) => g.items), [linesByCategory]);
  /** Enter بينقل للسطر اللي بعده، وآخر سطر بيفتح شباك الأصناف — انظر `lineKeyboard`. */
  const advance = advanceFrom(shownLines, setFocusLineKey, () => setPickerOpen(true));

  const [submitting, setSubmitting] = useState(false);

  /**
   * الإذن المفتوح للتعديل والاعتماد — نفس صفحة الإنشاء بالظبط.
   *
   * Approving used to happen in a modal that opened over the list: a read-only sheet with an
   * اعتماد button. So the screen that WRITES a permit and the screen that DECIDES on it were two
   * different things, and the person who found a wrong quantity while approving was editing it
   * through a popup that looked nothing like the form it was typed in.
   *
   * There is one document page now. It opens empty for a new permit and filled for an existing
   * one, and اعتماد / رفض sit on it — because «هل أوافق» is answered by reading the document, and
   * the place to read it is the place it was written.
   */
  const [editing, setEditing] = useState<TransferRecord | null>(null);
  const [viewOnly, setViewOnly] = useState(false);

  const fetchTransfers = async (opts?: { silent?: boolean }) => {
    // الهادي (التحديث الحي) مابيلفّش الجدول بسبينر.
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/api/v1/transfers', { params: { limit: PAGE_SIZE } });
      setTransfers(res.data);
    } catch (err) { console.error(err); } finally { if (!silent) setLoading(false); }
  };
  // تحويل اتعمل أو اتعتمد من فرع تاني ⇒ القايمة تتحدّث من غير ما حد يعمل ريفرش.
  useLiveRefresh(['transfers'], () => fetchTransfers({ silent: true }));

  const loadLookups = async () => {
    try {
      const [whRes, custRes] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/custodies'),
      ]);
      setWarehouses(whRes.data);
      setCustodies(custRes.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchTransfers(); loadLookups(); }, []);

  /** Warehouses and custodies in one list, each tagged with its kind. */
  const locationOptions = useMemo(() => ([
    {
      label: 'المخازن',
      // المخزن الموقوف مايتختارش لإذن جديد — إلا لو هو المصدر/الوجهة على الإذن المفتوح.
      options: sortByName(warehouses.filter((w) => w.active !== false
        || [source, dest].includes(locValue('warehouse', w.id))), (w) => w.name).map((w) => ({
        value: locValue('warehouse', w.id), label: withInactiveTag(w.name || `مخزن #${w.id}`, w),
      })),
    },
    // **عهد المناديب مش أماكن بضاعة.** بضاعة المندوب في مخزنه (زي a5)، والعهدة بقت صندوق
    // فلوسه — ولا عهدة في التلات فروع عليها حركة مخزون واحدة. ظهورها هنا كان بيخلّي
    // التحويل يروح لمكان مالوش وجود في الشغل (طلب العميل ٢٠٢٦-١٠-٠٧). الإذن القديم اللي
    // عليه عهدة بيفضل يعرضها.
    {
      label: 'عهد المناديب',
      options: sortByName(custodies.filter((c) => [source, dest].includes(locValue('custody', c.id))),
        (c) => c.name).map((c) => ({
        value: locValue('custody', c.id), label: c.name || `عهدة #${c.id}`,
      })),
    },
  ].filter((g) => g.options.length > 0)), [warehouses, custodies, source, dest]);

  /** نفس القايمة من غير المصدر. الاستبعاد لازم يحصل **جوّه** المجموعة — المجموعة نفسها
   *  مالهاش `value`، فالفلترة على المستوى الأعلى كانت بتعدّي كل حاجة والمصدر يفضل مختار
   *  من الوجهة. والمجموعة اللي فضلت فاضية بتتشال عشان مايبانش عنوان تحته ولا خيار. */
  const destOptions = useMemo(
    () =>
      locationOptions
        .map((g) => ({ ...g, options: g.options.filter((o) => o.value !== source) }))
        .filter((g) => g.options.length > 0),
    [locationOptions, source],
  );

  const locationName = (kind: string | null, id: number | null) => {
    if (!kind || id == null) return '-';
    const list = kind === 'warehouse' ? warehouses : custodies;
    const found = list.find((l) => l.id === id);
    return found?.name || (kind === 'warehouse' ? `مخزن #${id}` : `عهدة #${id}`);
  };

  // Declared after `locationName` so a search can match the human location names, not just ids.
  const filter = useListFilter(transfers, {
    search: (t) => [
      t.document_number, t.quantity,
      locationName(t.source_location_kind, t.source_location_id),
      locationName(t.dest_location_kind, t.dest_location_id),
      t.statement1, t.external_document_number, t.notes,
    ],
    filters: {
      status: (t, v) => t.status === v,
      route: (t, v) => t.route === v,
      statement: (t, v) => matchesStatement(t, v),
    },
    dateOf: (t) => docDate(t) || t.created_at,
  });

  const route = source && dest
    ? routeFor(parseLoc(source).kind, parseLoc(dest).kind) : null;
  const sameLocation = !!source && source === dest;

  /** What the SOURCE holds right now — the only things that can be moved out of it. */
  const loadSourceStock = async (loc: string) => {
    const { kind, id } = parseLoc(loc);
    setStockLoading(true);
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: { location_kind: kind, location_id: id, only_available: true },
      });
      setSourceStock(res.data);
    } catch (err) {
      console.error(err);
      setSourceStock([]);
    } finally { setStockLoading(false); }
  };

  const onSourceChange = (v: string) => {
    setSource(v);
    // A different source means different stock — the chosen items no longer apply.
    setLines([]); setActiveCategory(null); setSourceStock([]);
    if (v) loadSourceStock(v);
  };

  /** فئات أصناف المصدر — للشريط الجانبي في شباك الأصناف. الصنف اللي مالوش فئة بيبان
   *  تحت «كل الفئات» زي فاتورة البيع. */
  const categories = useMemo(() => {
    const set = new Set<string>();
    sourceStock.forEach((s) => { if (s.category) set.add(s.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [sourceStock]);

  /** أصناف الشباك والمتاح من كل واحد — متحسوبين مرة لكل رصيد، مش كل رندر (الشباك بيفلتر عليهم). */
  const pickerProducts = useMemo(() => sourceStock.map((r) => ({
    id: r.item_id, name: r.name, category: r.category, code: r.code,
    unit_of_measure: r.unit_of_measure,
  })), [sourceStock]);
  const availableById = useMemo(() => {
    const m: Record<number, number> = {};
    sourceStock.forEach((r) => {
      m[r.item_id] = Math.max(0, Number(r.on_hand || 0) - Number(r.pending_out || 0));
    });
    return m;
  }, [sourceStock]);
  const codeById = useMemo(() => Object.fromEntries(
    sourceStock.map((r) => [r.item_id, r.code])) as Record<number, string | null>, [sourceStock]);

  const addItem = (itemId: number, qtyTyped: number | null = null): PickResult => {
    const row = sourceStock.find((s) => s.item_id === itemId);
    if (!row) return null;
    // **المتاح = الرصيد ناقص المتعهّد عليه على أذونات معلّقة.**
    //
    // الإذن مابيحرّكش مخزون لحد الاعتماد، فالرصيد بيفضل قايل إن البضاعة موجودة. واللي
    // بيكتب الإذن التاني بيلاقيها متاحة وهي متعهّدة خلاص — الاتنين بيتحفظوا، وواحد منهم
    // بيقع على اللي بيعتمد بعدين وهو مش صاحب الغلطة. الخصم هنا بيمنع التعهّد المزدوج من
    // أوّله بدل ما يتصحّح عند الاعتماد.
    const available = Math.max(
      0, Number(row.on_hand || 0) - Number(row.pending_out || 0));
    const existing = lines.find((l) => l.item_id === itemId);
    if (existing) {
      // مكرر + كمية من الشباك ⇒ بتتزوّد على السطر، بنفس سقف `setLineQty`.
      if (qtyTyped) setLineQty(existing.key, Number(existing.quantity || 0) + qtyTyped);
      else message.info(`«${row.name}» موجود بالفعل — عدّل الكمية من السطر`);
      return { dup: itemId };
    }
    const key = `${itemId}-${lines.length}`;
    // نفس قص `setLineQty`: أكتر من المتاح بيتسجّل المتاح، ومعاه رسالة بتقول كده.
    let quantity: number | null = null;
    if (qtyTyped) {
      if (qtyTyped > available) {
        message.warning(available > 0
          ? `«${row.name}»: المتاح ${qty(available)} — اتسجّلت ${qty(available)}.`
          : `«${row.name}»: مفيش رصيد متاح في المصدر — ممنوع تحويل صنف مش موجود.`);
      }
      quantity = Math.min(available, qtyTyped) || null;
    }
    setLines((prev) => [...prev, {
      key, item_id: itemId, name: row.name,
      category: row.category, unit: row.unit_of_measure, available, quantity,
    }]);
    return quantity == null ? { needsQty: key } : null;
  };

  // Keep asking until the caret lands in the new line's quantity. One attempt lands in whatever
  // the browser is doing that frame, so it is retried and CHECKED — the same loop the sale, the
  // return and the purchase use.
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
  }, [focusLineKey, pickerOpen, lines]);

  const setLineQty = (key: string, value: number | null) => {
    const line = lines.find((l) => l.key === key);
    // Hard clamp: the form can never express more than is available — but it SAYS SO now. Silently
    // rewriting somebody's number is how a transfer of forty is sent as twelve and nobody notices
    // until the receiving store counts.
    if (line && value != null && value > line.available) {
      message.warning(line.available > 0
        ? `«${line.name}»: المتاح ${qty(line.available)} — اتسجّلت ${qty(line.available)}.`
        : `«${line.name}»: مفيش رصيد متاح في المصدر — ممنوع تحويل صنف مش موجود.`);
    }
    setLines((prev) => prev.map((l) => (l.key === key
      ? { ...l, quantity: value == null ? null : Math.max(0, Math.min(l.available, value)) } : l)));
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  /** One way in, whichever button was pressed — the list's «جديد» and the toolbar's F2. */
  const startNew = () => {
    // «جديد» بيفضل في الشاشة: الإذن اللي كان مفتوح يتشال من العنوان ومعاه الأصل (`ret`).
    clearDocParam();
    setSource(null); setDest(null); setLines([]); setCreateVisible(false);
    setViewOnly(false); setEditing(null);
    setStatement1(''); setExternalDocNumber(''); setDocNotes('');
    setNewStep('source');
  };

  /**
   * الإذن اتفتح برابط من شاشة تانية (الجرد، كارت الصنف) ⇒ القفل يرجّع هناك (`ret`)، مش
   * لكشف التحويلات. `stay` للقفل اللي مش خروج («رجوع» المتصفح شال المستند خلاص).
   * كائن مش `boolean` عشان `onClick={closeCreate}` بيبعت حدث الماوس — فالأزرار بتنده `() => closeCreate()`.
   */
  const closeCreate = (opts?: { stay?: boolean }) => {
    if (opts?.stay !== true && docReturn.origin()) {
      // تبويبنا بياخد كشفه من `leave` نفسه — مانكتبش في العنوان.
      closedDocRef.current = docInUrl.current;
      docInUrl.current = null;
      if (!docReturn.leave()) clearDocParam();
    } else {
      clearDocParam();
    }
    setCreateVisible(false); setEditing(null); setDraftQty({}); setViewOnly(false);
    setSource(null); setDest(null); setSourceStock([]); setLines([]); setActiveCategory(null);
    setStatement1(''); setExternalDocNumber(''); setDocNotes('');
  };

  /**
   * فتح إذن موجود في نفس الصفحة.
   *
   * Its route is fixed: the permit says goods leave HERE and arrive THERE, and changing that is a
   * different permit, not an edit of this one. Its lines are not — a quantity that no longer
   * matches what is on the shelf is the ordinary reason an approver hesitates, and «اعتمد أو
   * سيبه» is not how a request that is nearly right gets handled.
   */
  /**
   * `?doc=` — بيفتح إذن التحويل اللي الرابط بيشاور عليه.
   *
   * الرابط بييجي من كارت الصنف وكشفه: الحركة بتقول «تحويل» ورقم الإذن، والضغط عليه كان
   * بيوصل للقايمة واللي بيقرا يدوّر بنفسه على الرقم اللي لسه ضاغط عليه.
   */
  /**
   * الرابط الجاي من بره بيفتح الإذن — مرة واحدة، والبارامتر بيتمسح بعدها.
   *
   * الحركة في كارت الصنف وكشفه بتقول «تحويل» ورقم الإذن، والضغط عليه لازم يوصّل للإذن
   * نفسه مش للقايمة اللي هو فيها.
   *
   * ⚠️ **وده مش `useDocRoute`.** جرّبت أربط الشاشة دي بيه عشان زرار «رجوع» يقفل الإذن
   * ويرجّع للكشف — زي باقي شاشات المستندات. النتيجة إن الإذن بطّل يتفتح خالص، ومقدرتش
   * أعيد المشكلة عندي عشان أعرف السبب بالظبط. فالخُطّاف اتشال من هنا وحده: «رجوع» أنضف
   * من إن الإذن يفتح، بس إذن مابيفتحش مش مقايضة أصلاً. الشاشات التانية شغّالة بيه.
   */
  /**
   * كتابة الإذن المفتوح في العنوان وشيله.
   *
   * ⚠️ **في اتجاه واحد عن قصد** — زي شاشة الفواتير بالظبط، وللسبب اللي فوق: `useDocRoute`
   * بيخلّي العنوان **يقود** الشاشة، وهي دي اللي خلّت الإذن يبطّل يتفتح هنا. فالشاشة
   * بتكتب العنوان، والعنوان بيقود عند التحميل الأول وعند «رجوع» وبس.
   */
  const docInUrl = useRef<number | null>(null);
  /** آخر إذن اتقفل والعنوان لسه مالحقش يتنضّف — مش «رابط جديد» (الشرح عند `DocOpening` تحت). */
  const closedDocRef = useRef<number | null>(null);
  // بارامترات **التبويب ده** مش `window.location` (بتاع التبويب الظاهر)، والشاشة المخفية
  // مابتكتبش في العنوان: `setSearchParams` منها بيشدّ المستخدم لكشف التحويلات.
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;
  const onScreen = useOnScreen();
  const onScreenRef = useRef(onScreen);
  onScreenRef.current = onScreen;
  const docReturn = useDocReturn();
  const writeDocParam = useCallback((id: number) => {
    docInUrl.current = id;
    if (!onScreenRef.current) return;
    const next = new URLSearchParams(paramsRef.current);
    // العنوان شايل الإذن ده خلاص (جاي من رابط) ⇒ استبدال، مش نفس الإذن مرتين في التاريخ.
    // و`ret` بيفضل مكانه.
    const already = next.get('doc') === String(id);
    next.set('doc', String(id));
    next.delete('edit'); next.delete('back');
    setSearchParams(next, { replace: already });
  }, [setSearchParams]);
  const clearDocParam = useCallback(() => {
    closedDocRef.current = docInUrl.current
      ?? (Number(paramsRef.current.get('doc') || paramsRef.current.get('edit')) || null);
    docInUrl.current = null;
    if (!onScreenRef.current) return;
    const next = new URLSearchParams(paramsRef.current);
    if (!next.has('doc') && !next.has('edit') && !next.has('ret')) return;
    next.delete('doc'); next.delete('edit'); next.delete('back'); next.delete('ret');
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);
  /** قفل الإذن لما «رجوع» يشيله من العنوان — مش تفضية الحالة وبس: `closeCreate` هي اللي
   *  بترجّع للكشف. */
  const closeOnBackRef = useRef<(() => void) | null>(null);

  // «رجوع» المتصفح هو اللي قفل ⇒ الخطوة اتعملت خلاص، فالقفل مايروحش لحتة تانية.
  closeOnBackRef.current = () => { closeCreate({ stay: true }); };

  const pendingDoc = useRef<number | null>(null);
  const [docFetching, setDocFetching] = useState(false);
  /** الإذن اللي بيتجاب بالرقم دلوقتي — عشان صحوة التأثير التانية ماتجيبهوش مرتين. */
  const fetchingDoc = useRef<number | null>(null);
  useEffect(() => {
    const doc = searchParams.get('doc') || searchParams.get('edit');
    if (!doc) closedDocRef.current = null;
    // البارامتر اللي إحنا كاتبينه وقت الفتح مش طلب فتح. (رابط تاني لنفس الإذن بيجيب `ret`
    // جديد في العنوان، و«رجوع» بيقراه وقت الضغط — مافيش حاجة تتلقط.)
    if (doc && Number(doc) === docInUrl.current) return;
    // راح وإحنا لسه فاتحين ⇒ اللي شاله «رجوع» مش إحنا.
    if (!doc && docInUrl.current !== null) {
      docInUrl.current = null;
      closeOnBackRef.current?.();
      return;
    }
    if (doc && Number(doc) !== fetchingDoc.current) {
      pendingDoc.current = Number(doc);
      // `edit`/`back` بيتمسحوا؛ و`doc` و`ret` بيفضلوا عشان التحديث يرجّعك لنفس الإذن
      // و«رجوع» بعده للشاشة اللي جيت منها.
      if ((searchParams.has('edit') || searchParams.has('back')) && onScreenRef.current) {
        const next = new URLSearchParams(searchParams);
        next.delete('edit'); next.delete('back');
        setSearchParams(next, { replace: true });
      }
    }
    const wanted = pendingDoc.current;
    if (!wanted) return;
    pendingDoc.current = null;
    const target = transfers.find((t) => t.id === wanted);
    if (target) { openTransfer(target); return; }
    // **مش في الصفحة المحمّلة ≠ مش موجود.** القايمة بصفحات، والرابط الجاي من كارت الصنف
    // ممكن يبقى لإذن قديم برّه الصفحة. بنجيبه بالرقم — ومن غير مانستنى الكشف يتحمّل
    // (٢٠٢٦-١٠-٠٤): الاستنية دي كانت بتورّي كشف التحويلات قبل الإذن.
    fetchingDoc.current = wanted;
    setDocFetching(true);
    api.get(`/api/v1/transfers/${wanted}`)
      .then((r) => openTransfer(r.data))
      .catch(() => {
        message.warning(`إذن التحويل رقم ${wanted} مش موجود`);
        if (docInUrl.current == null) clearDocParam();
      })
      .finally(() => {
        if (fetchingDoc.current === wanted) fetchingDoc.current = null;
        setDocFetching(false);
      });
  }, [searchParams, transfers]);

  /** المسودّة — الطلب اللي اتكتب ولسه ما اتبعتش. الشرح في `useDraft`. */
  const draftPayload = useMemo(() => ({
    source, dest, lines, notes: docNotes || null,
    statement1, external_document_number: externalDocNumber,
  }), [source, dest, lines, docNotes, statement1, externalDocNumber]);

  const {
    drafts, savedAt: draftSavedAt, discard: discardDraft,
    remove: removeDraft, adopt: adoptDraft,
  } = useDraft({
    kind: 'transfer',
    payload: draftPayload,
    // الإذن الموجود (تحت الاعتماد أو معتمد) مالوش مسودّة — هو مستند عند المكتب خلاص.
    paused: Boolean(editing),
    isEmpty: (x: any) => !x.source && !(x.lines || []).length,
    title: (x: any) => {
      const from = x.source ? locationName(parseLoc(x.source).kind as any,
                                           parseLoc(x.source).id) : 'بدون مصدر';
      return `${from} — ${(x.lines || []).length} صنف`;
    },
  });

  /** بيفتح مسودّة في الشاشة — نفس حالة الشاشة اللي اتحفظت. */
  const resumeDraft = (d: any) => {
    const x = d.payload || {};
    adoptDraft(d.id);
    setEditing(null);
    setViewOnly(false);
    setNewStep(null);
    setSource(x.source ?? null);
    setDest(x.dest ?? null);
    setLines(x.lines || []);
    setStatement1(x.statement1 || '');
    setExternalDocNumber(x.external_document_number || '');
    setDocNotes(x.notes || '');
    setCreateVisible(true);
    // **ورصيد المصدر بيتجاب معاها.** `setSource` لوحدها بتحطّ المصدر من غير ما تملا
    // `sourceStock`، فالمسودّة بتتفتح بمصدر مكتوب ومنتقي أصناف فاضي — واللي بيستكمل
    // بيفتكر إن المخزن خلص. `onSourceChange` هي اللي بتجيبه عادةً، والاستكمال مش
    // بيعدّي منها.
    if (x.source) loadSourceStock(x.source);
  };

  const openTransfer = async (t: TransferRecord) => {
    writeDocParam(t.id);
    setEditing(t);
    setDraftQty({});
    /** الإذن اللي لسه تحت الاعتماد بيتفتح مفتوح لمين بيعتمد.
     *
     *  كان بيتفتح للقراءة دايماً، والمراجع لازم يدوس «تعديل» الأول عشان «رفض» وسلة الصنف
     *  يبانوا أصلاً — وهو فاتح الإذن عشان يقرّر، مش عشان يتفرّج. اللي بيقرأ من غير صلاحية
     *  اعتماد، والإذن المعتمد أو المرفوض، بيفضلوا للقراءة زي ما هما: دي بضاعة اتحركت خلاص. */
    setViewOnly(!(t.status === 'pending' && canApprove));
    setTransferDate(dayjs(t.transfer_date || t.created_at || undefined));
    // القديم المنقول مالوش الحقول دي أصلاً، فالفاضي هو الحالة الطبيعية مش الخطأ.
    setStatement1(t.statement1 || '');
    setExternalDocNumber(t.external_document_number || '');
    setDocNotes(t.notes || '');
    // A permit written before the lines table carries its item on the DOCUMENT and has no line
    // row, so there is nothing to PATCH and nothing to DELETE — and the page ended up inviting an
    // edit it could not offer: «عدّل الكميات أو شيل صنف» printed above a quantity that was plain
    // text.
    //
    // So give it the line it is missing, once, when it is opened while still pending. Nothing
    // about the permit changes: approval moves the LINES when a document has any and falls back to
    // the header only when it has none, so the same item and the same quantity move either way.
    // After this it behaves like every other permit — the quantity is a box, the item can be
    // dropped, another can be added.
    if (t.status === 'pending' && !(t.lines?.length) && t.item_id) {
      try {
        await api.post(`/api/v1/transfers/${t.id}/lines`, {
          item_id: t.item_id, quantity: String(t.quantity ?? 0),
        });
        await refreshEditing(t.id);
      } catch (err) {
        // Not fatal: the document still opens and still shows what it moves, read off the header.
        console.error(err);
      }
    }
    // A legacy permit can carry a null location; leaving the box empty is honest, and the route
    // is locked in edit mode anyway so nothing can be typed over it.
    setSource(t.source_location_kind && t.source_location_id != null
      ? locValue(t.source_location_kind, t.source_location_id) : null);
    setDest(t.dest_location_kind && t.dest_location_id != null
      ? locValue(t.dest_location_kind, t.dest_location_id) : null);
    setActiveCategory(null);
    setCreateVisible(true);
  };

  /** Re-read the document after every change, so the page shows the server's answer rather than
   *  what this screen believes it did. */
  const refreshEditing = async (id: number) => {
    try {
      const res = await api.get('/api/v1/transfers', { params: { limit: PAGE_SIZE } });
      const rows = res.data || [];
      setTransfers(rows);
      let found = rows.find((t: TransferRecord) => t.id === id) ?? null;
      // إذن قديم برّه أول صفحة (اتفتح من سجل الجرد أو كارت الصنف) ⇒ بيتجاب بالرقم. من
      // غيرها أول تعديل على سطر فيه كان بيقفل الإذن كأنه اتمسح.
      if (!found) {
        found = await api.get(`/api/v1/transfers/${id}`).then((r) => r.data).catch(() => null);
      }
      setEditing(found);
      if (!found) closeCreate();
    } catch (err) { console.error(err); }
  };

  /** المتاح دلوقتي لكل صنف في المصدر — الرصيد ناقص المتعهّد على أذونات معلّقة تانية. */
  const freshAvailability = async (): Promise<Record<number, number> | null> => {
    if (!source) return null;
    const { kind, id } = parseLoc(source);
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: {
          location_kind: kind, location_id: id, only_available: false,
          // الإذن اللي بيتعدّل دلوقتي سطوره متحسوبة في المعلّق وهي بتاعته هو — لو
          // اتخصمت عليه كمان يبقى بيتحاسب مرتين ومايقدرش يحفظ نفسه زي ما هو.
          ...(editing?.id ? { exclude_transfer_id: editing.id } : {}),
        },
      });
      const rows: StockRow[] = res.data || [];
      setSourceStock(rows.filter((r) =>
        Number(r.on_hand || 0) - Number(r.pending_out || 0) > 0));
      const map: Record<number, number> = {};
      rows.forEach((r) => {
        map[r.item_id] = Math.max(
          0, Number(r.on_hand || 0) - Number(r.pending_out || 0));
      });
      setLines((prev) => prev.map((l) => ({ ...l, available: map[l.item_id] ?? 0 })));
      return map;
    } catch (err) {
      // مقدرناش نقرا — مابنمنعش على أساس معلومة مش موجودة. السيرفر بيرفض الحركة
      // السالبة عند الاعتماد على أي حال، والحد المحلي راحة مش صحة.
      console.error(err);
      return null;
    }
  };

  /** بوباب المنع: إذن مايتكتبش بصنف مش موجود، وبيعرض يقلّل الكميات للمتاح. */
  const warnOverAvailable = (
    over: { line: TransferLine; free: number }[],
  ) => {
    Modal.confirm({
      title: 'ممنوع تحويل صنف مش موجود',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      width: 520,
      content: (
        <div>
          <div style={{ marginBottom: 8 }}>الكميات دي أكتر من المتاح في المصدر — قلّلها:</div>
          {over.map((o) => (
            <div key={o.line.key} style={{ marginBottom: 4 }}>
              • <b>{o.line.name}</b> — مطلوب {qty(Number(o.line.quantity || 0))}، المتاح{' '}
              {qty(o.free)}
              {o.free <= 0 ? ' (مفيش رصيد متاح)' : ''}
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 14, color: '#888' }}>
            المتاح هنا بعد خصم اللي متعهّد عليه على أذونات تحويل لسه مستنية الاعتماد.
          </div>
        </div>
      ),
      okText: 'قلّل للمتاح',
      cancelText: 'هعدّل بنفسي',
      onOk: () => {
        setLines((prev) => prev
          // الصنف اللي مفيش منه حاجة بيتشال — سطر بكمية صفر مايترحّلش، والتقليل لازم
          // يوصّل لإذن يتحفظ فعلاً مش لإذن يترفض برسالة تانية.
          .filter((l) => !over.some((o) => o.line.key === l.key && o.free <= 0))
          .map((l) => {
            const hit = over.find((o) => o.line.key === l.key);
            return hit ? { ...l, available: hit.free, quantity: hit.free } : l;
          }));
      },
    });
  };

  const handleSubmit = async () => {
    if (!source || !dest) { message.warning('اختر المصدر والوجهة أولاً'); return; }
    if (sameLocation) { message.error('لا يمكن التحويل إلى نفس الموقع'); return; }
    if (!route) { message.error('هذا الاتجاه غير متاح للتحويل'); return; }
    const valid = lines.filter((l) => Number(l.quantity || 0) > 0);
    if (!valid.length) { message.warning('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر'); return; }
    // **الرصيد بيتقرا من جديد قبل الحفظ — مش من اللي اتحمّل ساعة ما الشاشة اتفتحت.**
    //
    // الشاشة بتفضل مفتوحة وهو بيكتب، والرصيد بيتغيّر تحته: فاتورة بتتباع، وإذن تاني
    // بيتكتب على نفس البضاعة. الحد اللي اتحسب من نص ساعة مش حد — والإذن اللي بيعدّي
    // بيه بيقع على اللي بيعتمد بعدين، وهو مش صاحب الغلطة.
    const fresh = await freshAvailability();
    const over = valid
      .map((l) => ({ line: l, free: fresh ? (fresh[l.item_id] ?? 0) : l.available }))
      .filter((o) => Number(o.line.quantity || 0) > o.free + 1e-9);
    if (over.length) { warnOverAvailable(over); return; }

    const src = parseLoc(source);
    const dst = parseLoc(dest);
    setSubmitting(true);
    // ONE document carrying every item — not one document per item.
    //
    // This used to POST once per line, so a request to move five things produced five separate
    // permits with five numbers, each approved on its own. The storekeeper who was handed one
    // list to pick had to find and approve five documents to release it, and approving four of
    // them left a fourth-of-a-transfer nothing on the screen described. It also meant a partial
    // failure — three posted, two refused — left the request half-written with no way to see that
    // from the list.
    //
    // The document has carried lines since 031; the header's own `item_id`/`quantity` are the
    // pre-lines shape and stay for old permits. The first line seeds them so a document written
    // today reads the same way in anything that still looks at the header.
    try {
      const [first, ...rest] = valid;
      const created = await api.post('/api/v1/transfers', {
        item_id: first.item_id, quantity: Number(first.quantity || 0), route,
        source: { location_kind: src.kind, location_id: src.id },
        dest: { location_kind: dst.kind, location_id: dst.id },
        transfer_date: transferDate.format('YYYY-MM-DD'),
        statement1: statement1 || null,
        external_document_number: externalDocNumber || null,
        notes: docNotes || null,
      });
      // The header line is already on the document; add it as a real line too, so every item
      // lives in the same place and the approver's table has no special first row.
      await api.post(`/api/v1/transfers/${created.data.id}/lines`, {
        item_id: first.item_id, quantity: String(first.quantity || 0),
      });
      for (const l of rest) {
        await api.post(`/api/v1/transfers/${created.data.id}/lines`, {
          item_id: l.item_id, quantity: String(l.quantity || 0),
        });
      }
      // الاعتماد على طول لو اللي كاتب الإذن هو نفسه اللي بيقدر يعتمده.
      //
      // الإذن بيتكتب «معلّق» والاعتماد هو اللي بيحرّك البضاعة. ده صح لما الطالب حاجة
      // والمعتمد حاجة تانية؛ وهو عبث لما يكونوا نفس الشخص — الأدمن كان بيكتب الإذن،
      // الشاشة تقول «اتسجّل الطلب»، وهو يروح يبص على المخزن يلاقي مافيش حاجة اتحركت،
      // لأنه مستني موافقة نفسه. السيرفر هو اللي بيقرر — بيعتمد لو يقدر، وبيسيبه معلّق لو لأ.
      let approved = false;
      let refused: string | null = null;
      try {
        const r = await api.post(`/api/v1/transfers/${created.data.id}/self-approve`);
        approved = r.data?.status === 'approved';
      } catch (err: any) {
        // الإذن اتكتب؛ بس الرفض (رصيد مش كفاية، سيريال ناقص) بيتقال بسببه — كان بيتبلع،
        // واللي قدامه يشوف «بانتظار الاعتماد» من غير ما يعرف إن فيه حاجة لازم تتصلّح.
        refused = err?.response?.data?.detail?.message || err?.response?.data?.message || null;
      }
      if (refused) {
        message.warning(`اتسجّل طلب التحويل بس مااتعتمدش: ${refused}`, 8);
      } else {
        message.success(approved
          ? `تم اعتماد إذن التحويل بـ${valid.length} صنف واتحرّك المخزون`
          : `اتسجّل طلب التحويل بـ${valid.length} صنف — بانتظار المراجعة والاعتماد`);
      }
      // بعد ما السيرفر رد بنجاح وبس — المرفوض بيفضل مسودّة.
      discardDraft();
      closeCreate();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذّر تسجيل طلب التحويل');
      console.error(err);
    } finally {
      setSubmitting(false);
      fetchTransfers();
    }
  };

  // السطر يفتح المستند نفسه — نفس اللي زرار «اعتماد» بيعمله، بالكيبورد وبالماوس.
  const listKb = useTableKeyboard<TransferRecord>({
    rows: filter.filtered, rowKey: (t) => t.id,
    // المسودّة مش إذن — Enter عليها بيستكملها، مش بيحاول يفتحها كمستند مالوش مصدر.
    onOpen: (t: any) => (t?.__isDraft ? resumeDraft(t.__draft) : openTransfer(t)),
  });
  /**
   * أسماء الأصناف.
   *
   * This screen has never shown one — its list prints «صنف #35», which is a number nobody in the
   * warehouse knows. The review sheet cannot ask somebody to approve moving «صنف #35», so the
   * catalogue is loaded once here and both the sheet and the list read it.
   */
  const [itemNames, setItemNames] = useState<Record<number, string>>({});
  useEffect(() => {
    api.get('/api/v1/items')
      .then((r) => setItemNames(Object.fromEntries(
        (r.data || []).map((i: any) => [i.id, i.name]))))
      .catch(() => setItemNames({}));
  }, []);
  const nameOfItem = (id: number | null | undefined) =>
    (id ? itemNames[id] || `صنف #${id}` : '-');

  /**
   * أصناف الإذن — من السطور، أو من المستند نفسه لو إذن قديم.
   *
   * A transfer used to move ONE item, recorded as `item_id` + `quantity` on the document itself;
   * the lines table came later. Every permit written before that has zero line rows, so a screen
   * that reads only `lines` shows an empty document — «البيانات مش ظاهرة جوّه الإذن», which is
   * three of the four transfers on this database.
   *
   * The old review sheet had the same hole and papered over it with «إذن قديم — الصنف مكتوب على
   * المستند نفسه»: an apology in the place where the answer should be. It IS on the document, so
   * read it from there and show it. Marked `_header` because there is no line row behind it —
   * nothing to PATCH and nothing to DELETE — so those controls stay off it.
   */
  const docLines = (t: TransferRecord): any[] => {
    if (t.lines?.length) return t.lines;
    if (t.item_id) {
      return [{ id: -1, _header: true, item_id: t.item_id, quantity: t.quantity }];
    }
    return [];
  };
  const [rejectOpen, setRejectOpen] = useState(false);
  const [userNames, setUserNames] = useState<Record<number, string>>({});
  useEffect(() => {
    api.get('/api/v1/users')
      .then((r) => setUserNames(Object.fromEntries(
        (r.data || []).map((u: any) => [u.id, u.full_name || u.username]))))
      .catch(() => setUserNames({}));
  }, []);
  /**
   * المتاح في مخزن المصدر للإذن اللي بيتراجع.
   *
   * The approver is being asked «هل أوافق على نقل ده» — and cannot answer without knowing whether
   * the stock is still there. It often is not: the request was raised on Sunday and a sale took
   * the goods on Monday, and approving anyway is what the negative-stock guard then refuses at the
   * worst possible moment, after the decision felt made.
   */
  const [reviewStock, setReviewStock] = useState<Record<number, number>>({});
  useEffect(() => {
    const doc = editing;
    // **المستند من غير مصدر مابيتسألش عن رصيده.**
    //
    // النداء كان بيروح بـ`location_kind` و`location_id` فاضيين، وaxios بيشيل الفاضي من
    // العنوان — فالطلب بيوصل `?only_available=true` وبس والسيرفر بيرد 422. الشرط على
    // وجود المستند وحده ماكانش كفاية: صف مالوش مصدر أصلاً (زي صف مسودّة) بيعدّي منه.
    // ولا الإذن اللي خلص كمان — الرصيد ده بيتعرض وقت المراجعة بس.
    if (!doc || doc.status !== 'pending'
        || !doc.source_location_kind || doc.source_location_id == null) {
      setReviewStock({});
      return;
    }
    // **الإذن مايتحاسبش على نفسه، والصفر مايتشالش من القايمة.**
    //
    // `only_available` بيشيل الصنف اللي «المتاح» بتاعه صفر، و«المتاح» بيخصم الأذونات
    // المعلّقة — **والإذن ده واحد منها**. فالصنف اللي في المخزن منه ٦٨ وهذا الإذن طالب
    // ٨٠ كان بيتشال من الرد، والشاشة بتقرا الغياب صفر: «المتاح ٠» عن بضاعة موجودة
    // بالفعل، والمراجع يرفض إذن كان ينفع يعدّل كميته ويعتمده.
    //
    // الخانة دي بتقول «في المخزن كام» — فالرصيد بيتطلب كامل (`only_available: false`)
    // ومعاه `exclude_transfer_id` عشان تعهّد الإذن ده على نفسه مايتحسبش مرتين.
    api.get('/api/v1/stock/by-location', { params: {
      location_kind: doc.source_location_kind,
      location_id: doc.source_location_id,
      only_available: false,
      exclude_transfer_id: doc.id } })
      .then((r) => setReviewStock(Object.fromEntries(
        (r.data || []).map((x: any) => [x.item_id, Number(x.on_hand)]))))
      .catch(() => setReviewStock({}));
  }, [editing]);
  const [rejectReason, setRejectReason] = useState('');

  /**
   * الكمية اللي بتتكتب دلوقتي، قبل ما تترسل.
   *
   * The quantity is committed on blur rather than on every keystroke — «12» typed one digit at a
   * time would otherwise send 1 then 12, and the first of those is a real edit somebody else could
   * read. Held in state rather than read back off the input at blur time: reading the DOM made the
   * value depend on how the browser reports it, which is a thing that quietly stops being true.
   */
  const [draftQty, setDraftQty] = useState<Record<number, number>>({});

  const setReviewLineQty = async (lineId: number, quantity: number | null) => {
    if (!quantity || quantity <= 0) return;
    try {
      await api.patch(`/api/v1/transfers/lines/${lineId}`, { quantity: String(quantity) });
      if (editing) await refreshEditing(editing.id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تعديل الكمية');
    }
  };

  const removeReviewLine = async (lineId: number) => {
    try {
      await api.delete(`/api/v1/transfers/lines/${lineId}`);
      if (editing) await refreshEditing(editing.id);
      message.success('اتشال الصنف من الإذن');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حذف الصنف');
    }
  };

  /**
   * سطور الكلام على إذن مفتوح وهو لسه تحت الاعتماد — بتتحفظ لما المؤشر يسيب الخانة.
   *
   * كانت بتتكتب مرة وقت الإنشاء بس، فغلطة في البيان كانت بتفضل على الورقة لحد ما حد يلغي
   * الإذن كله ويعمله من جديد. الإذن الجديد (لسه ما اتبعتش) بيبعتهم مع الإنشاء زي ما هو.
   */
  const textsLocked = viewOnly || (!!editing && editing.status !== 'pending');
  const saveEditingText = async (
    field: 'statement1' | 'external_document_number' | 'notes', value: string,
  ) => {
    if (!editing || editing.status !== 'pending') return;
    if ((editing[field] || '') === (value || '').trim()) return;
    try {
      await api.patch(`/api/v1/transfers/${editing.id}`, { [field]: value || null });
      await refreshEditing(editing.id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ التعديل');
    }
  };

  const rejectTransfer = async () => {
    if (!editing) return;
    try {
      await api.post(`/api/v1/transfers/${editing.id}/reject`,
        { reason: rejectReason || null });
      message.success('تم رفض الإذن — لم تتحرك أي بضاعة');
      setRejectOpen(false); setRejectReason('');
      closeCreate();
      fetchTransfers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر رفض الإذن');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/api/v1/transfers/${id}/approve`);
      message.success('تمت الموافقة واعتماد التحويل بنجاح');
      closeCreate();
      fetchTransfers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر اعتماد الإذن');
    }
  };

  /**
   * تعديل إذن معتمد — بيتلغي، وبيتفتح تاني بمحتواه للتصحيح.
   *
   * الإذن المعتمد طلّع بضاعة من مخزن وحطها في تاني، فتغيير كمية عليه وهو ساكت بيسيب
   * رصيدين بيوصفوا مستند مابقاش بيقول اللي حصل. فالتعديل بيلغيه الأول: البضاعة بترجع
   * لمصدرها والإذن بيفضل في السجل مكتوب عليه إنه اتلغى، وانت بتكتب الجديد.
   *
   * كان بيتعكس — يتكتب حركتين مضادين لكل سطر ويفضل الإذن ومعاه عكسه في كارت كل صنف.
   * دلوقتي الحركة بتتشال والرصيد بيرجع لوحده، فالكارت بيقول اللي حصل مرة واحدة.
   *
   * **وبيسأل الأول.** كان بيلغي على طول بحجة إن الضغطة نفسها هي الإجابة — وده صح لما
   * الزر بيقول اللي هيحصل. بس الزر مكتوب عليه «تعديل»، وكلمة تعديل بتوعد بتغيير في
   * المكان يتراجع عنه؛ واللي بيحصل فعلاً إن المستند بيتلغي ومايرجعش. حصل مع
   * TRF-000004: ضغط تعديل، فلقى الإذن ملغي وصنفين رصيدهم بقى سالب.
   */
  const editApproved = async (t: TransferRecord) => {
    const ok = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `تعديل إذن «${t.document_number}»؟`,
        content: 'الإذن ده معتمد وبضاعته اتحركت، فمايتعدّلش في مكانه. اللي هيحصل: '
          + 'الإذن ده يتلغي والبضاعة ترجع لمصدرها، ويتفتحلك طلب جديد بنفس محتواه '
          + 'تصحّحه وترسله للاعتماد. والإذن الملغي بيفضل في السجل.',
        okText: 'ألغيه وافتح طلب جديد', okButtonProps: { danger: true },
        cancelText: 'تراجع',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await api.post(`/api/v1/transfers/${t.id}/cancel`, { reason: 'تعديل' });
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إلغاء الإذن');
      return;
    }
    message.success('تم إلغاء الإذن — عدّله وأرسله للاعتماد من جديد');
    await refillAsNew(t);
    fetchTransfers();
  };

  /**
   * بيفضّي النموذج ويملاه بمحتوى إذن موجود — **كطلب جديد، مش تعديل عليه**.
   *
   * بتتنده في حالتين: بعد إلغاء إذن معتمد عشان يتصحّح، ومن «نسخة في طلب جديد» على إذن
   * مقفول (مرفوض أو ملغي). الاتنين بيعملوا نفس الحاجة — مستند جديد بنفس المحتوى —
   * والفرق إن الأولانية بترجّع البضاعة الأول.
   */
  const refillAsNew = async (t: TransferRecord) => {
    // Refill from what it actually moved — including a legacy permit whose item is on the
    // document rather than in a lines row.
    const src = t.source_location_kind && t.source_location_id != null
      ? locValue(t.source_location_kind, t.source_location_id) : null;
    const dst = t.dest_location_kind && t.dest_location_id != null
      ? locValue(t.dest_location_kind, t.dest_location_id) : null;
    setEditing(null); setDraftQty({});
    setSource(src); setDest(dst);
    // سطور الكلام بتتنقل مع المحتوى — التصحيح مش بيبدأ من ورقة فاضية.
    setStatement1(t.statement1 || '');
    setExternalDocNumber(t.external_document_number || '');
    setDocNotes(t.notes || '');
    // Read the source's stock BEFORE building the lines: the quantity box is capped at what is
    // available, so a line built against a zero would refuse the very quantity being corrected —
    // and the reversal has just put the goods back, so the number is right there to be read.
    //
    // **والرد بيتطلب كامل** (`only_available: false`): الفلتر بيشيل الصنف اللي «المتاح»
    // بتاعه صفر — والمتاح بيخصم الأذونات المعلّقة. فالصنف المتعهّد على إذن تاني كان
    // بيختفي من الرد، والسطر بيتبني على صفر ويرفض الكمية اللي جاي يصحّحها أصلاً.
    let stock: StockRow[] = [];
    if (src) {
      const { kind, id } = parseLoc(src);
      try {
        stock = (await api.get('/api/v1/stock/by-location', { params: {
          location_kind: kind, location_id: id, only_available: false,
          exclude_transfer_id: t.id } })).data || [];
      } catch { stock = []; }
      setSourceStock(stock);
    }
    setLines(docLines(t).map((l: any, i: number) => {
      const row = stock.find((x) => x.item_id === l.item_id);
      return {
        key: `${Date.now()}-${i}`,
        item_id: l.item_id,
        name: row?.name ?? nameOfItem(l.item_id),
        category: row?.category ?? null,
        unit: null,
        available: Math.max(
          0, Number(row?.on_hand ?? 0) - Number(row?.pending_out ?? 0)),
        quantity: Number(l.quantity) || 0,
      };
    }));
    setCreateVisible(true);
  };

  /**
   * زرار «تعديل» — بيقرا الحالة كلها، مش حالتين.
   *
   * **الرفض اللي كان بيحصل:** الشرط كان `approved ? يتلغي ويتفتح جديد : يتفتح للتعديل`،
   * فأي حالة تانية — `rejected` أو `cancelled` — كانت بتقع في الـ`else` وتتفتح «للتعديل».
   * والسيرفر بيرفض أي كتابة عليها (`_pending`: «الإذن ده مش تحت الاعتماد — مايتعدلش»)،
   * فكل ضغطة حفظ أو إضافة صنف بترجع 409 والشاشة بتقول «تعذر التعديل» من غير سبب.
   *
   * **والحالة دي بتحصل في المسار العادي مش في حالة نادرة:** «تعديل» على إذن معتمد
   * بيلغيه، والإلغاء بيحطّه `rejected`. فأول ما اللي بيعدّل يضغط «تعديل» تاني على نفس
   * الإذن — وهو أول رد فعل طبيعي — بيقع في الفخ. اتقاس على اللوج: `POST /transfers/
   * 2558/lines` رجع 409 مرتين على `TRF-000003` وهو `rejected`.
   *
   * الإذن المقفول **مايتعدلش** — ده مستند اتقفل بقرار. اللي ينفع نسخة منه في طلب جديد،
   * والاتنين يفضلوا في السجل.
   */
  const openForEdit = async (t: TransferRecord) => {
    if (t.status === 'approved') {
      await editApproved(t);
      return;
    }
    if (t.status === 'pending') {
      await openTransfer(t);
      setViewOnly(false);
      message.info('إذن التحويل مفتوح الآن للتعديل');
      return;
    }
    await openTransfer(t);
    setViewOnly(true);
    Modal.confirm({
      title: 'الإذن ده مقفول',
      content: t.status === 'rejected'
        ? 'الإذن اتلغى أو اترفض، فمايتعدلش — المستند المقفول بيفضل زي ما هو في السجل. '
          + 'تحب أعمل طلب جديد بنفس محتواه؟'
        : 'الإذن ده مش تحت الاعتماد فمايتعدلش. تحب أعمل طلب جديد بنفس محتواه؟',
      okText: 'اعمل طلب جديد بمحتواه',
      cancelText: 'لأ، سيبه',
      onOk: () => refillAsNew(t),
    });
  };

  /**
   * الورقة اللي بتمشي مع البضاعة.
   *
   * A permit is not read on a screen at the moment it matters — the goods travel, and the paper
   * travels with them so the receiving store can check what turned up against what was sent, and
   * both sides sign. Built from the document that is open, so it prints exactly what is on screen.
   */
  const printOpenTransfer = (t: TransferRecord) => {
    printTransfer({
      document_number: t.document_number,
      status: t.status,
      source: locationName(t.source_location_kind, t.source_location_id),
      dest: locationName(t.dest_location_kind, t.dest_location_id),
      date: docDate(t) || null,
      approvedBy: t.approved_by ? (userNames[t.approved_by] || null) : null,
      statement1: t.statement1 || null,
      lines: docLines(t).map((l: any) => ({
        name: nameOfItem(l.item_id),
        quantity: l.quantity,
      })),
    });
  };

  /**
   * إلغاء إذن معتمد — البضاعة ترجع لمصدرها والإذن يفضل في السجل «ملغي» ومعاه السبب.
   *
   * كان «عكس»: بيكتب حركة مضادة لكل سطر، فكارت الصنف يقول إن حاجة راحت ورجعت وانت
   * بتدوّر على واحدة مااتحركتش أصلاً. دلوقتي الحركة بتتشال والرصيد بيرجع لوحده.
   */
  const handleCancel = (record: TransferRecord) => {
    Modal.confirm({
      title: 'تأكيد إلغاء إذن التحويل',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      content: `هل تريد إلغاء إذن التحويل «${record.document_number}»؟ ستعود الكميات لمخزنها الأصلي وسيبقى الإذن ملغياً.`,
      okText: 'نعم، إلغاء الإذن',
      okType: 'danger',
      cancelText: 'تراجع',
      onOk: async () => {
        try {
          await api.post(`/api/v1/transfers/${record.id}/cancel`, { reason: null });
          message.success('تم إلغاء الإذن وإرجاع الكميات بنجاح');
          fetchTransfers();
          if (editing?.id === record.id) refreshEditing(record.id);
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message || 'تعذر إلغاء الإذن');
        }
      },
    });
  };

  /** حذف الإذن — بيروح هو وحركته، مايفضلش منه أثر في السجل. */
  const handleDelete = (record: TransferRecord) => {
    Modal.confirm({
      title: 'تأكيد حذف إذن التحويل',
      icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
      content: `هل أنت متأكد من حذف إذن التحويل «${record.document_number}»؟ لو كان معتمداً، سيتم إلغاء الحركات وإرجاع الكميات لمخزنها الأصلي.`,
      okText: 'نعم، احذف',
      okType: 'danger',
      cancelText: 'إلغاء',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/transfers/${record.id}`);
          message.success('تم حذف إذن التحويل بنجاح');
          setEditing(null);
          closeCreate();
          fetchTransfers();
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message || 'تعذر مسح الإذن');
        }
      },
    });
  };

  const totalUnits = lines.reduce((s, l) => s + (l.quantity || 0), 0);

  /**
   * Enter على الإذن الجديد بيفتح شباك الأصناف — زي فاتورة البيع بالظبط.
   *
   * مابيشتغلش وانت جوّه خانة (Enter هناك معناه «اللي بعده») ولا وفيه شباك تاني مفتوح.
   */
  useEffect(() => {
    if (!createVisible || editing || viewOnly || !source) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (pickerOpen || newStep || rejectOpen) return;
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
  }, [createVisible, editing, viewOnly, source, pickerOpen, newStep, rejectOpen]);

  const doors = (
    <>
      {/* نفس شباك فاتورة البيع: كروت وفئات على الجنب واختيار أكتر من صنف بكمية لكل واحد.
          المتاح بيتقاس على المصدر، والصنف اللي مافيش منه مابيتختارش. */}
      <ProductPickerModal
        variant="cards"
        warehouseName={source ? locationName(parseLoc(source).kind, parseLoc(source).id) : null}
        open={pickerOpen}
        title="اختر الصنف المحوَّل"
        categories={categories}
        categoryLabels={categoryLabels}
        products={pickerProducts}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        availableFor={(id) => (stockLoading ? null : (availableById[id] ?? 0))}
        availabilityVersion={`${source ?? ''}|${sourceStock.length}|${stockLoading ? 1 : 0}`}
        disableOutOfStock
        hidePurchasePrice
        onCancel={() => setPickerOpen(false)}
        onPick={(id: number, q) => {
          setPickerOpen(false);
          addPickedSequentially([id], q ? { [id]: q } : undefined, addItem, setFocusLineKey);
        }}
        onPickMany={(ids, qtys) => {
          setPickerOpen(false);
          addPickedSequentially(ids, qtys, addItem, setFocusLineKey);
        }} />

      <WarehouseGate
        open={newStep === 'source' && !editing && !viewOnly}
        title="التحويل من أين؟"
        subtitle="البضاعة بتطلع من هنا — والرصيد المتاح بيتحمّل على أساسه."
        placeholder="اختر المخزن المصدر"
        value={source}
        onChange={(v) => { onSourceChange(v); }}
        warehouses={locationOptions}
        cancelText="إلغاء"
        onCancel={() => setNewStep(null)}
        onOk={() => { if (source) setNewStep('dest'); }}
        autoAdvanceIfSingle={false}
      />

      <WarehouseGate
        open={newStep === 'dest' && !editing && !viewOnly}
        title="التحويل إلى أين؟"
        subtitle="المصدر مستبعد من القايمة — تحويل لنفس المكان مش تحويل."
        placeholder="اختر المخزن الوجهة"
        value={dest}
        onChange={(v) => {
          if (v === source) {
            message.error('لا يمكن اختيار نفس المخزن كمصدر ووجهة');
            return;
          }
          setDest(v);
        }}
        warehouses={destOptions}
        okText="ابدأ"
        cancelText="رجوع"
        onCancel={() => setNewStep('source')}
        onOk={() => {
          if (!dest || dest === source) {
            message.error('يجب اختيار مخزن وجهة مختلف عن المصدر');
            return;
          }
          setNewStep(null);
          setCreateVisible(true);
        }}
      />
    </>
  );

  /**
   * سجل عمليات الإذن — مين عمل إيه وإمتى.
   *
   * What used to sit here was a review sheet: a read-only modal that opened over the list with an
   * اعتماد button on it. So the screen that WROTE a permit and the screen that DECIDED on it were
   * two different things, and an approver who found a wrong quantity fixed it through a popup that
   * looked nothing like the form it was typed in.
   *
   * The document page does both now, and the sheet is gone — two ways to approve is one way too
   * many. What survives from it is the reasoning: a decision is taken by READING the permit and
   * being able to correct it, never from a «هل أنت متأكد؟» over a document nobody has opened. And
   * there is still no delete: the way to say «مش هيتم» is to reject, which leaves the reason on
   * the document.
   */
  const rejectDialog = (
    <TabModal
      open={rejectOpen}
      title="رفض إذن التحويل"
      okText="ارفض" cancelText="تراجع"
      okButtonProps={{ danger: true }}
      onCancel={() => { setRejectOpen(false); setRejectReason(''); }}
      onOk={rejectTransfer}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="لن تتحرك أي بضاعة"
        description="الرفض ليس كـ«اعتمد ثم اعكس» — فلم ينزل شيء من الرف حتى يعود إليه." />
      <Input.TextArea rows={3} value={rejectReason} autoFocus
        placeholder="سبب الرفض — أول ما سيسأل عنه طالب التحويل"
        onChange={(e: any) => setRejectReason(e.target.value)} />
    </TabModal>
  );

  /** زي `doors` بالظبط: الشبابيك دي بتخصّ الفرعين.
   *
   *  «رفض» و«سجل العمليات» عايشين على شريط صفحة الإذن، وصفحة الإذن `return` مبكّر — والشباكين
   *  كانوا متعرّفين في الـ`return` بتاع الكشف بس. يعني الدوسة بتظبط `rejectOpen = true` وعمرها
   *  ما ترسم حاجة: زرار ميّت، مش زرار بيغلط. */
  const dialogs = (
    <>
      {rejectDialog}
      <LoadPeriodModal
        open={loadRangeOpen} onCancel={() => setLoadRangeOpen(false)}
        title="تحميل أذون تحويل فترة" endpoint="/api/v1/transfers"
        columns={[
          { title: 'الإذن', key: 'document_number', width: 150 },
          { title: 'التاريخ', key: 'transfer_date', width: 120 },
          { title: 'البيان', key: 'statement1' },
        ]}
        onLoaded={(rows) => setPeriodRows(rows as TransferRecord[])}
        openNewest dateKey="transfer_date"
        onPick={(r) => openTransfer(r as TransferRecord)} />
    </>
  );

  /** القايمة اللي السابق/التالى بيمشوا فيها — الأحدث الأول: «السابق» = الأقدم. */
  const navRows = periodRows ?? transfers;
  const neighbour = (step: number): TransferRecord | null => {
    if (!editing) return null;
    const at = navRows.findIndex((r) => r.id === editing.id);
    return at < 0 ? null : navRows[at + step] ?? null;
  };

  const transferToolbar = (): ToolbarAction[] => {
    const pending = editing?.status === 'pending';
    const isSaved = Boolean(editing);
    return [
      { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
        onClick: startNew },
      { key: 'edit', label: 'تعديل', icon: <EditOutlined />,
        disabled: !isSaved || !viewOnly,
        onClick: () => { if (editing) openForEdit(editing); } },
      { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />,
        disabled: isSaved ? !neighbour(1) : navRows.length === 0,
        onClick: () => { const n = isSaved ? neighbour(1) : navRows[0]; if (n) openTransfer(n); } },
      { key: 'next', label: 'التالى', icon: <ArrowLeftOutlined />,
        disabled: !neighbour(-1),
        onClick: () => { const n = neighbour(-1); if (n) openTransfer(n); } },
      ...(editing ? [] : [{
        key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
        onClick: handleSubmit,
        disabled: viewOnly || !source || !dest || lines.length === 0,
      } as ToolbarAction]),
      ...(editing && pending && canApprove && !viewOnly ? [
        { key: 'approve', label: 'اعتماد', icon: <CheckCircleOutlined />,
          onClick: () => handleApprove(editing.id),
          disabled: (editing.lines?.length ?? 0) === 0 && !editing.item_id },
        { key: 'reject', label: 'رفض', danger: true, icon: <CloseCircleOutlined />,
          onClick: () => setRejectOpen(true) },
      ] as ToolbarAction[] : []),
      ...(editing && editing.status === 'approved' && canApprove && !viewOnly ? [
        { key: 'cancel', label: 'إلغاء', danger: true, icon: <CloseCircleOutlined />,
          onClick: () => handleCancel(editing) },
      ] as ToolbarAction[] : []),
      ...(editing && canApprove ? [
        { key: 'delete', label: 'حذف', danger: true, icon: <DeleteOutlined />,
          onClick: () => handleDelete(editing) },
      ] as ToolbarAction[] : []),
      ...(editing ? [{
        key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />,
        onClick: () => printOpenTransfer(editing),
      } as ToolbarAction] : []),
      // «سجل العمليات» اتشال من هنا (٢٠٢٦-١٠-٠٦): زرار «السجل» جنب الشريط بيوري نفس الكلام
      // ومعاه شكل الإذن في كل نسخة.
      ...(editing ? [] : [{
        key: 'undo', label: 'تراجع', icon: <UndoOutlined />,
        onClick: () => setLines([]), disabled: lines.length === 0,
      } as ToolbarAction]),
      { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />,
        onClick: () => setLoadRangeOpen(true) },
      { key: 'close', label: 'إغلاق', shortcut: 'Esc', icon: <ArrowRightOutlined />,
        onClick: () => closeCreate() },
    ];
  };

  const columns = [
    { title: 'رقم المستند', dataIndex: 'document_number', key: 'document_number',
      sorter: (a: TransferRecord, b: TransferRecord) => (a.document_number || '').localeCompare(b.document_number || ''),
      // المسودّة مالهاش رقم — الرقم بيتحجز وقت الإرسال مش قبله.
      render: (doc: string, r: any) => (r.__isDraft
        ? <DraftTag label="مسودّة — لسه ما اتبعتتش"
                    onDelete={() => removeDraft(r.__draft.id)} />
        : <Tag color="blue">{doc}</Tag>) },
    { title: 'الصنف', dataIndex: 'item_id', key: 'item_id',
      render: (id: number | null) => nameOfItem(id) },
    { title: 'الكمية', dataIndex: 'quantity', key: 'quantity',
      sorter: (a: TransferRecord, b: TransferRecord) => Number(a.quantity || 0) - Number(b.quantity || 0),
      render: (q: string | null) => <b>{qty(q)}</b> },
    { title: 'من', key: 'src',
      render: (_: any, r: TransferRecord) => locationName(r.source_location_kind, r.source_location_id) },
    { title: 'إلى', key: 'dst',
      render: (_: any, r: TransferRecord) => locationName(r.dest_location_kind, r.dest_location_id) },
    { title: 'نوع المناقلة', dataIndex: 'route', key: 'route',
      render: (r: string) => ROUTE_LABELS[r] || r },
    { title: 'الحالة', dataIndex: 'status', key: 'status',
      sorter: (a: TransferRecord, b: TransferRecord) => (a.status || '').localeCompare(b.status || ''),
      render: (s: string) => {
        const tag = STATUS_TAGS[s] || { color: 'default', text: s };
        return <Tag color={tag.color}>{tag.text}</Tag>;
      } },
    // تاريخ الحركة، مش تاريخ الكتابة. المستند القديم مالوش واحد فبيرجع لتاريخ تسجيله.
    { title: 'التاريخ', dataIndex: 'transfer_date', key: 'transfer_date',
      sorter: (a: TransferRecord, b: TransferRecord) =>
        docDate(a).localeCompare(docDate(b)),
      render: (_: any, r: TransferRecord) => docDate(r) || '-' },
    { title: 'البيان', dataIndex: 'statement1', key: 'statement1', ellipsis: true,
      render: (v: string | null) => v || '-' },
    {
      title: 'الإجراءات', key: 'actions', width: 140, fixed: 'left' as const,
      render: (_: any, record: TransferRecord) => ((record as any).__isDraft ? (
        // **سطر المسودّة مالوش أزرار مستند.** الكشف فيه نوعين سطور، والمسودّة مالهاش
        // رقم ولا أثر — رقمها في الجدول سالب عشان يفضل فريد وسط أرقام حقيقية. فزرار
        // الحذف كان بينده السيرفر برقم مش موجود ويرجّع «المستند مش موجود»، وزرار
        // الطباعة بيجيب ورقة مافيش. الفعل الوحيد اللي ليه معنى هنا: امسح المسودّة.
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="مسح المسودّة">
            <Button type="text" danger icon={<DeleteOutlined />}
              onClick={() => removeDraft((record as any).__draft.id)} />
          </Tooltip>
        </Space>
      ) : (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="عرض إذن التحويل">
            <Button type="text" icon={<EyeOutlined />}
              onClick={() => openTransfer(record)} />
          </Tooltip>
          <Tooltip title="طباعة">
            <Button type="text" icon={<PrinterOutlined />}
              onClick={() => printOpenTransfer(record)} />
          </Tooltip>
          {canApprove && (
            <Tooltip title="تعديل">
              <Button type="text" icon={<EditOutlined />}
                onClick={() => openForEdit(record)} />
            </Tooltip>
          )}
          {canApprove && (
            <Tooltip title="حذف">
              <Button type="text" danger icon={<DeleteOutlined />}
                onClick={() => handleDelete(record)} />
            </Tooltip>
          )}
        </Space>
      )),
    },
  ];

  const docLineColumns = [
    // ترقيم السطور — نفس سبب الفاتورة: ورقة بـ٣٥ صنف مالهاش أرقام
    // مابتتقالش في التليفون ولا بتتقارن بورقة مطبوعة.
    { key: 'idx', title: '#', width: 40, align: 'center' as const,
      render: (_v: any, _r: any, i: number) => (
        <span style={{ color: '#6b6b6b' }}>{i + 1}</span>) },
    { key: 'name', title: 'الصنف', dataIndex: 'item_id',
      render: (id: number) => <b>{nameOfItem(id)}</b> },
    /**
     * «المتاح في المصدر» **للإذن اللي لسه بيتراجع وبس**.
     *
     * الرقم ده رصيد المخزن **دلوقتي**، مش وقت الإذن — وده بالظبط اللي المراجع محتاجه
     * وهو بيقرر. لكن بعد الاعتماد البضاعة تكون خرجت خلاص، فالخانة بتقول صفر بالأحمر
     * على إذن تمّ ونجح، وإدارة بتقرا الشاشة بتفهم منها «اتعمل تحويل والكمية أصلاً صفر».
     * رصيد النهارده مالوش محل على مستند اتقفل، والرصيد وقتها مش متخزّن — فالخانة بتتشال.
     */
    ...(editing?.status === 'pending' ? [{
      key: 'available', title: 'المتاح في المصدر', dataIndex: 'available',
      render: (_: any, r: any) => {
        const have = reviewStock[r.item_id] ?? 0;
        const short = Number(r.quantity || 0) > have;
        return (
          <span style={{ color: short ? '#cf1322' : '#6AB42D', fontWeight: 600 }}>
            {qty(have)}
          </span>
        );
      } }] : []),
    { key: 'quantity', title: 'الكمية المحوّلة', dataIndex: 'quantity',
      render: (v: any, r: any) => (editing?.status === 'pending' && !r._header && !viewOnly ? (
        <InputNumber size="small" min={0} step={1}
          value={draftQty[r.id] ?? Number(v)}
          style={{ width: 120 }} keyboard={false} data-grid-col="qty"
          onChange={(val) => setDraftQty(
            (d) => ({ ...d, [r.id]: Number(val) }))}
          onPressEnter={() => setReviewLineQty(r.id, guardQuantity({
            value: draftQty[r.id] ?? Number(v),
            available: reviewStock[r.item_id] ?? 0,
            itemName: nameOfItem(r.item_id),
          }, Number(v)) as number)}
          onBlur={() => setReviewLineQty(r.id, guardQuantity({
            value: draftQty[r.id] ?? Number(v),
            available: reviewStock[r.item_id] ?? 0,
            itemName: nameOfItem(r.item_id),
          }, Number(v)) as number)} />
      ) : <b>{qty(Number(v))}</b>) },
    ...(editing?.status === 'pending' && !viewOnly ? [{
      key: 'actions', title: '', width: 50,
      render: (_: any, r: any) => (r._header ? null : (
        <Popconfirm title="تشيل الصنف ده من الإذن؟" okText="شيل" cancelText="لأ"
          onConfirm={() => removeReviewLine(r.id)}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )),
    }] : []),
  ];
  // الجدول ده مابيتعرضش غير والإذن مفتوح، والهوك بيشتغل على طول — فالصفوف فاضية لغاية ما يتفتح.
  const docCols = useTableColumns('transfer-doc-lines', docLineColumns, {
    export: {
      name: editing ? `إذن تحويل ${editing.document_number}` : 'إذن تحويل',
      rows: editing ? docLines(editing) : [],
    },
  });

  /**
   * سطور الإذن الجديد — **نفس شبكة فاتورة البيع** (`entry-grid sale-grid`): ترويسة كحلي،
   * الاسم وتحته الكود، والكمية بـ− و+. الأعمدة بتاعة التحويل (المتاح والمتبقي) مكان السعر
   * والخصم، والكمية بتعدّي على نفس حارس `setLineQty`.
   */
  const lineQtyGuard = (r: TransferLine, value: number | null = r.quantity) => guardQuantity(
    { value, available: r.available, itemName: r.name, unit: r.unit }, null);
  const draftLineColumns: EntryColumn<TransferLine>[] = [
    { key: 'idx', title: '#', width: 32, locked: true,
      cellStyle: { color: '#5b6575', textAlign: 'center' }, cell: (_l, i) => i + 1 },
    { key: 'item', title: 'اسم الصنف والوصف', width: 220, minWidth: 120, locked: true,
      cell: (r) => {
        const code = codeById[r.item_id];
        return (
          <div style={{ lineHeight: 1.25 }}>
            <div className="eg-ellipsis" title={r.name} style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{r.name}</div>
            {code ? (
              <div dir="ltr" style={{ fontSize: 14, color: '#5b6575', fontWeight: 500, textAlign: 'end' }}>
                {code}
              </div>
            ) : null}
          </div>
        );
      } },
    { key: 'unit', title: 'الوحدة', width: 80,
      cellStyle: { textAlign: 'center' },
      cell: (r) => <span style={{ fontSize: 14 }}>{r.unit || 'أساسية'}</span> },
    { key: 'available', title: 'المتاح في المصدر', width: 100,
      cellStyle: { textAlign: 'center', whiteSpace: 'nowrap', color: '#6AB42D', fontWeight: 600 },
      cell: (r) => qty(r.available) },
    { key: 'quantity', title: 'الكمية', width: 114, locked: true,
      cellStyle: { textAlign: 'center' },
      cellProps: (r) => ({ [QTY_DATA_ATTR]: r.item_id } as any),
      cell: (r) => (
        // − [الكمية] + — الزرارين برّه التاب عشان Enter يفضل ماشي من سطر لسطر، و«+» بيعدّي
        // على نفس سقف المتاح.
        <div className="qty-stepper">
          <button type="button" tabIndex={-1} className="qty-step" title="قلّل واحد"
            disabled={Number(r.quantity || 0) <= 1}
            onClick={() => {
              const q = Number(r.quantity || 0);
              if (q > 1) setLineQty(r.key, q - 1);
            }}><MinusOutlined /></button>
          <InputNumber size="small" style={{ width: 54 }}
            data-qty-key={r.key} data-grid-col="qty" keyboard={false} controls={false}
            placeholder="الكمية" value={r.quantity ?? undefined}
            onChange={(val) => setLineQty(r.key, val == null ? null : Number(val))}
            onBlur={() => setLineQty(r.key, lineQtyGuard(r))}
            onPressEnter={(e) => {
              e.preventDefault();
              const kept = lineQtyGuard(r);
              setLineQty(r.key, kept);
              if (kept !== null) advance(r.key);
            }} />
          <button type="button" tabIndex={-1} className="qty-step" title="زوّد واحد"
            onClick={() => setLineQty(r.key, Number(r.quantity || 0) + 1)}>
            <PlusOutlined /></button>
        </div>
      ),
      footer: (rows) => qty(rows.reduce((n, l) => n + Number(l.quantity || 0), 0)) },
    { key: 'remaining', title: 'المتبقي بعد التحويل', width: 110,
      cellStyle: { textAlign: 'center', whiteSpace: 'nowrap', color: '#475569' },
      cell: (r) => qty(r.available - Number(r.quantity || 0)) },
    { key: 'actions', title: 'إجراء', label: 'حذف السطر', width: 50, minWidth: 40, locked: true,
      cellStyle: { textAlign: 'center' },
      cell: (r) => (
        <Button size="small" danger type="text" icon={<DeleteOutlined />} title="امسح السطر"
          onClick={() => removeLine(r.key)} />
      ),
      footer: () => null },
  ];
  const lineGrid = useEntryGrid('transfer-lines-grid', draftLineColumns);

  const tableCols = useTableColumns('transfer-requests', columns, {
    export: { name: 'التحويلات', rows: filter.filtered },
  });

  const screen = createVisible ? (
      // **شكل فاتورة البيع الجديد** (٢٠٢٦-١٠-٠١): كروت بيضا على رمادي — الترويسة والأدوات،
      // خانات الإذن، الأصناف، وتحت الملخص والأزرار مثبّتين. الشكل بس: نفس الحالة والأوامر.
      <div className="sale-doc">
        <div className="sale-card sale-head">
          <div className="sale-head-row">
            <Button size="small" icon={<ArrowRightOutlined />} onClick={() => closeCreate()}>رجوع</Button>
            <span className="sale-title">
              {editing
                ? <>إذن تحويل <b dir="ltr">{editing.document_number}</b></>
                : 'طلب تحويل مخزني جديد'}
            </span>
            {editing && (
              <Tag color={(STATUS_TAGS[editing.status] || {}).color} style={{ marginInlineEnd: 0 }}>
                {(STATUS_TAGS[editing.status] || {}).text || editing.status}
              </Tag>
            )}
            {/* المستند الجديد: «مسودة» — المحفوظ بيقول حالته الحقيقية في الشارة اللي قبلها. */}
            {!editing && <Tag color="blue" style={{ marginInlineEnd: 0 }}>مسودة</Tag>}
            {editing && navRows.some((r) => r.id === editing.id) && (
              <Tag style={{ marginInlineEnd: 0 }}>
                {navRows.findIndex((r) => r.id === editing.id) + 1} / {navRows.length}
              </Tag>
            )}
            {/* الأدوات و«الأعمدة» في نفس سطر العنوان على الشمال — زي فاتورة البيع. */}
            <div className="sale-toolbar-row">
              <DocumentToolbar actions={transferToolbar()} variant="buttons" />
              <DocumentHistoryButton entityType="stock_transfer" entityId={editing?.id}
                documentNumber={editing?.document_number} />
              {editing ? docCols.control : lineGrid.control}
            </div>
          </div>
        </div>

        <div className="sale-form">
          {editing && editing.status === 'pending' && !viewOnly && (
            <Alert type="info" showIcon
              message={canApprove
                ? 'هذا الإذن ما زال بانتظار الاعتماد'
                : 'هذا الإذن ما زال بانتظار اعتماد مدير المخزن'}
              description={canApprove
                ? 'عدّل الكميات أو احذف صنفاً عند الحاجة، ثم اعتمد أو ارفض من الأعلى. ولم تتحرك أي بضاعة حتى الآن.'
                : 'يمكنك عرضه ومراجعته — أما الاعتماد فمن صلاحية مدير المخزن.'} />
          )}
          {editing && editing.status !== 'pending' && !viewOnly && (
            <Alert type="warning" showIcon
              message={{
                approved: 'الإذن ده اتعتمد واتشحن',
                rejected: 'الإذن ده اترفض',
                reversed: 'الإذن ده اتلغى',
              }[editing.status] ?? 'الإذن ده مقفول'}
              description={{
                approved: 'الاعتماد رحَّل حركات على مخزنين، فلا يُعدَّل الإذن في مكانه. و«تعديل الإذن» يلغيه ويفتح طلباً جديداً بمحتواه لتصحّحه وترسله للاعتماد من جديد — وتبقى الثلاثة في السجل.',
                // المرفوض والملغي **مش نفس الحاجة**، وكانوا بيتعرضوا بنفس الجملة.
                // المرفوض حد بصّ على طلب ومشّاهوش، فمافيش بضاعة اتحركت. والملغي راح
                // ورجع فعلاً — واللي بيقرا «لم تتحرك أي بضاعة» على إذن رجّع بضاعته
                // بيدوّر على حركة في كارت الصنف ويلاقيها ومايفهمش.
                rejected: 'الإذن المرفوض لم تتحرك فيه أي بضاعة. وإن كنت ما زلت بحاجة إليه، أنشئ طلباً جديداً.',
                reversed: 'الإذن ده كان معتمداً وبضاعته اتحركت، وبالإلغاء رجعت لمصدرها. بيفضل في السجل عشان الحركتين يفضلوا مفهومين.',
              }[editing.status] ?? ''}
              action={editing.reject_reason
                ? <span>{editing.status === 'reversed' ? 'سبب الإلغاء: ' : 'سبب الرفض: '}
                    <b>{editing.reject_reason}</b></span> : undefined} />
          )}

          {/* **الترويسة في سطرين** — زي فاتورة البيع (٢٠٢٦-١٠-٠١): رقم المستند ← التاريخ ←
              من ← إلى، وتحتهم البيان والملاحظات. الكلام بيتحفظ لما المؤشر يسيب الخانة والإذن
              لسه تحت الاعتماد، وبعد الاعتماد بيتقفل زي التاريخ والمصدر. */}
          <div className="sale-card sale-fields">
          <Form layout="vertical" size="small" className="doc-form" component={false}>
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item label="رقم المستند">
                <Input placeholder="رقم الإذن الورقي" disabled={textsLocked}
                  maxLength={40}
                  value={externalDocNumber} onChange={(e) => setExternalDocNumber(e.target.value)}
                  onBlur={() => saveEditingText('external_document_number', externalDocNumber)} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="التاريخ">
                <DatePicker style={{ width: '100%' }}
                  disabled={!!editing || viewOnly}
                  value={transferDate} onChange={(v) => setTransferDate(v || dayjs())} format="YYYY-MM-DD" allowClear={false} />
              </Form.Item>
            </Col>
            {/* المصدر والوجهة هما الخانتين الأساسيتين — بإطار أخضر زي خانة العميل. */}
            <Col xs={24} md={8} className="sale-party">
              <Form.Item label="من (المصدر)">
                <Select showSearch style={{ width: '100%' }}
                  placeholder="اختر المخزن المصدر"
                  disabled={!!editing || viewOnly}
                  value={source ?? undefined} onChange={onSourceChange}
                  options={locationOptions} filterOption={searchFilter} filterSort={searchRank}/>
              </Form.Item>
            </Col>
            <Col xs={24} md={8} className="sale-party">
              <Form.Item label="إلى (الوجهة)">
                <Select showSearch style={{ width: '100%' }}
                  placeholder="اختر المخزن الوجهة"
                  disabled={!!editing || viewOnly}
                  value={dest ?? undefined} onChange={(v) => setDest(v)}
                  options={locationOptions} filterOption={searchFilter} filterSort={searchRank}/>
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="البيان">
                <Input placeholder="اختياري" disabled={textsLocked} maxLength={200}
                  value={statement1} onChange={(e) => setStatement1(e.target.value)}
                  onBlur={() => saveEditingText('statement1', statement1)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="ملاحظات">
                <Input placeholder="اختياري" disabled={textsLocked} maxLength={500}
                  value={docNotes} onChange={(e) => setDocNotes(e.target.value)}
                  onBlur={() => saveEditingText('notes', docNotes)} />
              </Form.Item>
            </Col>
          </Row>
          </Form>

          {source && dest && sameLocation && (
            <Alert style={{ marginTop: 4 }} type="error" showIcon
              message="المصدر والوجهة نفس الموقع — اختر وجهة مختلفة" />
          )}
          {source && dest && !sameLocation && !route && (
            <Alert style={{ marginTop: 4 }} type="warning" showIcon
              message="التحويل من عهدة مندوب إلى مخزن غير متاح من هذه الشاشة"
              description="استخدم شاشة تسليم عهدة المندوب لإرجاع البضاعة إلى المخزن." />
          )}
          {route && !sameLocation && (
            <Alert style={{ marginTop: 4 }} type="success" showIcon
              message={`نوع التحويل: ${ROUTE_LABELS[route]}`} />
          )}
          </div>

          <div className="sale-card sale-lines">
          {/* شريط الأصناف زي فاتورة البيع: عدد البنود والمسار يمين، وزرار الإضافة شمال. */}
          <div className="sale-items-bar">
            <div className="sale-items-info">
              {editing && <b style={{ color: '#0f172a', fontSize: 15 }}>أصناف الإذن</b>}
              <span>
                عدد البنود الحالية: <b style={{ color: '#0f172a' }}>
                  {editing ? docLines(editing).length : lines.length}</b> أصناف
              </span>
              {source && dest && route && !sameLocation && (
                <span>
                  {locationName(parseLoc(source).kind, parseLoc(source).id)}
                  {' ← '}
                  {locationName(parseLoc(dest).kind, parseLoc(dest).id)}
                </span>
              )}
            </div>
            {!editing && !viewOnly && (
              <Button type="primary" className="sale-green-btn" icon={<ShoppingCartOutlined />}
                style={{ fontWeight: 700 }}
                disabled={!source || stockLoading}
                onClick={() => setPickerOpen(true)}
              >
                إضافة صنف للإذن (Enter)
              </Button>
            )}
          </div>

          {/* السطور المحفوظة — بتتعدّل على السيرفر على طول.
              A saved permit's lines are rows in the database, not a draft: changing a quantity or
              dropping an item IS the edit, and it is what an approver does while deciding. A
              closed permit is read-only — approval already moved goods across two warehouses. */}
          {editing && (
            <div className="sale-grid-wrap">
              <Table
                className="sale-grid" size="small" rowKey="id" pagination={false}
                dataSource={docLines(editing)}
                locale={{ emptyText: 'لا توجد أصناف على الإذن — ارفضه بدلاً من اعتماده' }}
                columns={docCols.columns}
              />
            </div>
          )}

          {/* سطور الإذن الجديد — نفس جدول فاتورة البيع. والفاضي بيقول الخطوة الجاية. */}
          {editing ? null : (lines.length > 0 || (source && !viewOnly && !stockLoading && sourceStock.length > 0)) ? (
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
                                إجمالي الفئة: {qty(group.items.reduce((n, l) => n + Number(l.quantity || 0), 0))}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {group.items.map((line) => (
                        <tr key={line.key}>{lineGrid.row(line, shownLines.indexOf(line))}</tr>
                      ))}
                    </React.Fragment>
                  ))}
                  {/* السطر الزيادة: الصنف على طول من المصدر (٢٠٢٦-١٠-٠٥). */}
                  <QuickAddRow
                    colSpan={lineGrid.count} disabled={viewOnly || !source} items={pickerProducts}
                    availableFor={(id) => (stockLoading ? null : (availableById[id] ?? 0))}
                    onOpenPicker={() => setPickerOpen(true)}
                    onPick={(id) => addPickedSequentially([id], undefined, addItem, setFocusLineKey)} />
                </tbody>
                <tfoot>{lineGrid.foot(lines, (
                  <>الإجماليات: <span style={{ color: '#64748b', fontWeight: 600 }}>
                    ({lines.length} بنود مختلفة)
                  </span></>
                ))}</tfoot>
              </table>
            </div>
          ) : !source ? (
            <Empty description="اختر المصدر أولاً لعرض الأصناف المتاحة فيه" style={{ margin: '12px 0' }} />
          ) : stockLoading ? (
            <Empty description="جارٍ تحميل أرصدة المصدر..." style={{ margin: '12px 0' }} />
          ) : sourceStock.length === 0 ? (
            <Alert type="info" showIcon message="لا توجد أي أصناف برصيد متاح في هذا الموقع" />
          ) : (
            <Empty description="اختر الفئة ثم الأصناف لإضافتها للإذن" style={{ margin: '12px 0' }} />
          )}
          </div>

          {/* صور الورقة — إذن التحويل الموقّع عليه وإيصال الاستلام. المكوّن بيختفي على الإذن
              الجديد لحد ما يترحّل وياخد رقم يتعلّق عليه — فالكارت كمان. */}
          {editing && (
            <div className="sale-card sale-notes">
              <div className="sale-attach">
                <DocumentAttachments docType="stock_transfer" docId={editing.id} title="مرفقات" />
              </div>
            </div>
          )}

          {/* الملخص والأزرار مثبّتين في آخر الشاشة — زي فاتورة البيع. */}
          <div className="sale-bottom">
            <Row gutter={[10, 10]}>
              <Col xs={24} lg={16}>
                <div className="sale-tiles">
                  <SummaryTile label="عدد الأصناف"
                    value={editing ? docLines(editing).length : lines.length} />
                  <SummaryTile label="إجمالي الكميات" color="#16a34a"
                    value={qty(editing
                      ? docLines(editing).reduce(
                        (t: number, l: any) => t + Number(l.quantity || 0), 0)
                      : totalUnits)} />
                </div>
              </Col>
              <Col xs={24} lg={8}>
                <div className="sale-card sale-pay">
                  <div className="sale-pay-actions is-wrap">
                    {viewOnly ? (
                      <Button onClick={() => closeCreate()}>إغلاق</Button>
                    ) : editing ? (
                      <>
                        {editing.status === 'pending' && canApprove && (
                          <>
                            <Button type="primary" icon={<CheckCircleOutlined />}
                              className="sale-green-btn sale-save-btn"
                              disabled={(editing.lines?.length ?? 0) === 0 && !editing.item_id}
                              onClick={() => handleApprove(editing.id)}>
                              اعتماد الإذن
                            </Button>
                            <Button danger onClick={() => setRejectOpen(true)}>رفض</Button>
                          </>
                        )}
                        {editing.status === 'approved' && canApprove && (
                          <>
                            <Button type="primary" icon={<EditOutlined />}
                              className="sale-green-btn sale-save-btn"
                              onClick={() => editApproved(editing)}>
                              تعديل الإذن
                            </Button>
                            <Button danger icon={<CloseCircleOutlined />}
                              onClick={() => handleCancel(editing)}>إلغاء</Button>
                            <Button danger icon={<DeleteOutlined />}
                              onClick={() => handleDelete(editing)}>حذف</Button>
                          </>
                        )}
                        <Button onClick={() => closeCreate()}>إغلاق</Button>
                      </>
                    ) : (
                      <>
                        <Button type="primary" loading={submitting}
                          icon={<CheckOutlined />} className="sale-green-btn sale-save-btn"
                          disabled={!route || sameLocation || lines.length === 0}
                          onClick={handleSubmit}>
                          إرسال طلب التحويل
                        </Button>
                        <Button onClick={() => closeCreate()}>إلغاء</Button>
                      </>
                    )}
                  </div>
                </div>
              </Col>
            </Row>
          </div>
        </div>
      </div>
  ) : null;

  // ---------------------------------------------------------------------- list
  const summary = {
    total: transfers.length,
    pending: transfers.filter((t) => t.status === 'pending').length,
    approved: transfers.filter((t) => t.status === 'approved').length,
  };



  /**
   * **البوابات بتتركّب مرة واحدة، بره التفرّع.**
   *
   * كانت مكتوبة في الفرعين، والفرعين `return` منفصلين — فReact بيشوفهم شجرتين: أول
   * ما الفرع يتبدّل البوابة بتتفكّ وتتركّب من جديد، واللي اتفكّت بتسيب `portal` بتاع
   * antd واقف في نص أنيميشن القفل ومابيتشالش. قناع ميّت فوق الشاشة: كل حاجة مغمّقة
   * ومافيش حاجة بتترد — ودي بالظبط اللي ظهرت لمدير الفرع في «إذن الإضافة».
   *
   * التعليق القديم كان واصف نُص المشكلة («الباب بيتفكّ ساعة ما يفتح الصفحة اللي
   * وراه») وحطّ الباب في الفرعين — وده اللي بيسبّبها. الحل إن يكون مخرج واحد.
   */
  // فلتر «الحالة» بقى شرايح فوق بعدّاداتها — مكان كروت الإحصائيات. نفس قيمة الفلتر.
  const statusVal = filter.values.status;
  const activeStatusTab: string = Array.isArray(statusVal)
    ? (statusVal.length === 1 ? statusVal[0] : 'all')
    : (statusVal || 'all');
  // الشريحة في الرابط (`?tab=`، جنب `?doc=`): الرابط ← الفلتر مرة واحدة عند الفتح، وبعدها الفلتر ← الرابط.
  const [listTab, setListTab] = useQueryTab('all');
  const lastTab = useRef(activeStatusTab);
  useEffect(() => {
    if (Object.prototype.hasOwnProperty.call(STATUS_TAGS, listTab)) filter.setValue('status', listTab);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (lastTab.current === activeStatusTab) return;
    lastTab.current = activeStatusTab;
    if (activeStatusTab !== listTab) setListTab(activeStatusTab);
  }, [activeStatusTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const STATUS_DOTS: Record<string, string> = {
    pending: '#F5A11D', approved: '#6AB42D', rejected: '#f5222d', reversed: '#8c8c8c',
  };
  const statusTabs: ListTab[] = [
    { key: 'all', label: 'الكل', count: summary.total },
    ...Object.entries(STATUS_TAGS).map(([k, v]) => ({
      key: k, label: v.text, dot: STATUS_DOTS[k],
      count: transfers.filter((t) => t.status === k).length,
    })),
  ];
  // F3 للبحث — كانت جاية من `ListToolbar`، وبتشتغل على الكشف بس.
  const listSearchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => listSearchRef.current?.focus?.() }, !screen);
  const routeVal = filter.values.route;

  const list = (
    <ListPage
      icon={<SwapOutlined />}
      title="اذن تحويل مخازن" muted="(تحويلات ومناقلات المخزون)"
      subtitle="نقل البضاعة بين المخازن، واعتماد الطلبات"
      tabs={statusTabs} activeTab={activeStatusTab}
      onTabChange={(k) => filter.setValue('status', k === 'all' ? undefined : k)}
      actions={(<>
        <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
          onClick={startNew}>
          طلب تحويل مخزني
        </Button>
        {tableCols.control}
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={listSearchRef}
          value={filter.query} placeholder="بحث برقم المستند أو الموقع أو البيان"
          prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        <Select allowClear mode="multiple" maxTagCount="responsive" placeholder="نوع المناقلة"
          value={routeVal === undefined || routeVal === null || routeVal === ''
            ? undefined : (Array.isArray(routeVal) ? routeVal : [routeVal])}
          onChange={(v) => filter.setValue('route', Array.isArray(v) && !v.length ? undefined : v)}
          options={Object.entries(ROUTE_LABELS).map(([k, v]) => ({ value: k, label: v }))} />
        <Input allowClear placeholder="البيان"
          value={filter.values.statement ?? undefined}
          onChange={(e) => filter.setValue('statement', e.target.value || undefined)} />
        <DateRangeFilter className="sl-f-dates"
          value={filter.range ?? null} onChange={(v) => filter.setRange(v)} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
        <Table
          {...listKb.tableProps}
          className="sl-table"
          size="small"
          // المسودّات فوق، وبرّه `filter.filtered`: المسودّة مش إذن.
          dataSource={[
            ...(drafts || []).map((d: any) => {
              const x = d.payload || {};
              return {
                id: -d.id, __draft: d, __isDraft: true,
                document_number: 'مسودّة',
                status: 'draft',
                created_at: d.updated_at,
                transfer_date: String(d.updated_at || '').slice(0, 10),
                quantity: (x.lines || []).reduce(
                  (t: number, l: any) => t + Number(l.quantity || 0), 0),
              } as any;
            }),
            ...filter.filtered,
          ]}
          // **بيتركّبوا فوق بتوع لوحة المفاتيح، مش بيدهسوهم.**
          //
          // `listKb.tableProps` بيوفّر `onRow` و`rowClassName` — و`onRow` بتاعه هو اللي
          // بيفتح الإذن بالضغط وبالكيبورد. تعريف تاني بعد الـspread بيشيله، فالكشف
          // بيفضل شكله تمام والضغط على أي سطر مابيعملش حاجة.
          rowClassName={(r: any) => [
            r.__isDraft ? 'row-draft' : '',
            listKb.tableProps.rowClassName?.(r) ?? '',
          ].filter(Boolean).join(' ')}
          onRow={(r: any) => {
            const base = (listKb.tableProps.onRow?.(r) ?? {}) as any;
            if (!r.__isDraft) return base;
            // المسودّة مالهاش مستند يتفتح — الضغط بيستكملها.
            return {
              ...base,
              onClick: () => resumeDraft(r.__draft),
              style: { ...(base.style || {}), cursor: 'pointer' },
            };
          }}
          columns={tableCols.columns} rowKey="id" loading={loading}
          pagination={{ defaultPageSize: TABLE_PAGE_SIZE, showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS, locale: { items_per_page: '' },
            showTotal: () => (
              <span className="sl-foot">
                <span>إجمالي المستندات: <b>{summary.total.toLocaleString(numeralsLocale())}</b></span>
                {filter.filtered.length < summary.total && (
                  <span>المعروض: <b>{filter.filtered.length.toLocaleString(numeralsLocale())}</b></span>
                )}
                <span>بانتظار الاعتماد: <b>{summary.pending.toLocaleString(numeralsLocale())}</b></span>
                <span>معتمدة: <b className="is-pos">{summary.approved.toLocaleString(numeralsLocale())}</b></span>
              </span>
            ) }}
        />
    </ListPage>
  );

  /*
   * إذن جاي من شاشة تانية (الجرد، كارت الصنف) ⇒ مكان الكشف فاضي لحد ما يفتح، بدل ما كشف
   * التحويلات يبان جزء من الثانية. الرسمة الأولى بتتعرف من العنوان نفسه.
   */
  const urlDoc = Number(searchParams.get('doc') || searchParams.get('edit')) || null;
  const opening = !createVisible && (docFetching || (urlDoc != null
    && urlDoc !== docInUrl.current && urlDoc !== closedDocRef.current && onScreen));

  return (
    // بطول الشاشة — صفحة الإذن عشان الملخص والأزرار يقعدوا في آخرها، والكشف عشان الرمادي يغطّي الصفحة.
    <div style={{ height: '100%' }}>
      {dialogs}
      {doors}
      {screen ?? (opening ? <DocOpening /> : list)}
    </div>
  );
}

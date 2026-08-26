import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, Row, Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, CheckCircleOutlined, RollbackOutlined, DeleteOutlined,
  ClearOutlined, ArrowLeftOutlined, CloseCircleOutlined, FileSearchOutlined, EditOutlined,
  PrinterOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';
import { guardQuantity } from '../components/quantityGuard';
import { advanceFrom } from '../components/lineKeyboard';
import { printTransfer } from '../components/TransferDocument';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import ProductPickerModal from '../components/ProductPickerModal';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import { SaveOutlined, FileAddOutlined, UndoOutlined } from '@ant-design/icons';
import DocumentAuditModal from '../components/DocumentAuditModal';
import { useTableKeyboard } from '../components/keyboard';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import { QTY_DATA_ATTR, flashExistingItem } from '../utils/duplicateItem';

/**
 * تحويلات المخزون — move stock between locations.
 *
 * The form follows the order the storekeeper thinks in: FROM where, TO where, then the category,
 * then the items. Because the source is known first, the item picker is driven by what that
 * location actually holds (`/stock/by-location`): an item with nothing there is never offered, and
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
}

interface StockRow {
  item_id: number;
  code: string | null;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  on_hand: string;
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

const qty = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

/** Bucket for items that carry no category, so they stay reachable in the category-first flow. */
const NO_CATEGORY = '__none__';

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

export default function Transfers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const { user } = useAuth();
  const canApprove = ['system_admin', 'branch_manager'].includes(user?.role || '');

  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
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
  const [source, setSource] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [sourceStock, setSourceStock] = useState<StockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [lines, setLines] = useState<TransferLine[]>([]);
  /** Enter بينقل للسطر اللي بعده، وآخر سطر بيفتح شباك الأصناف — انظر `lineKeyboard`. */
  const advance = advanceFrom(lines, setFocusLineKey, () => setPickerOpen(true));

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

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/transfers');
      setTransfers(res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

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
      options: warehouses.map((w) => ({
        value: locValue('warehouse', w.id), label: w.name || `مخزن #${w.id}`,
      })),
    },
    {
      label: 'عهد المناديب',
      options: custodies.map((c) => ({
        value: locValue('custody', c.id), label: c.name || `عهدة #${c.id}`,
      })),
    },
  ]), [warehouses, custodies]);

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
    ],
    filters: {
      status: (t, v) => t.status === v,
      route: (t, v) => t.route === v,
    },
    dateOf: (t) => t.created_at,
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

  /** Categories present in the source's stock. Items with no category are still reachable through
   *  a "بدون فئة" bucket — otherwise stock that exists could never be transferred. */
  const categories = useMemo(() => {
    const set = new Set<string>();
    let hasUncategorised = false;
    sourceStock.forEach((s) => {
      if (s.category) set.add(s.category); else hasUncategorised = true;
    });
    const list = [...set].sort((a, b) => a.localeCompare(b, 'ar'))
      .map((c) => ({ value: c, label: categoryLabels[c] || c }));
    return hasUncategorised ? [...list, { value: NO_CATEGORY, label: 'بدون فئة' }] : list;
  }, [sourceStock, categoryLabels]);

  const addItem = (itemId: number) => {
    const row = sourceStock.find((s) => s.item_id === itemId);
    if (!row) return;
    const available = Number(row.on_hand || 0);
    const existing = lines.find((l) => l.item_id === itemId);
    if (existing) {
      flashExistingItem(itemId);
      message.info(`«${row.name}» موجود بالفعل — عدّل الكمية من السطر`);
      return;
    }
    const key = `${itemId}-${lines.length}`;
    setLines((prev) => [...prev, {
      key, item_id: itemId, name: row.name,
      category: row.category, unit: row.unit_of_measure, available, quantity: null,
    }]);
    setFocusLineKey(key);
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
        : `«${line.name}»: مفيش رصيد في المخزن المصدر.`);
    }
    setLines((prev) => prev.map((l) => (l.key === key
      ? { ...l, quantity: value == null ? null : Math.max(0, Math.min(l.available, value)) } : l)));
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  /** One way in, whichever button was pressed — the list's «جديد» and the toolbar's F2. */
  const startNew = () => {
    setSource(null); setDest(null); setLines([]); setCreateVisible(false); setNewStep('source');
  };

  const closeCreate = () => {
    setCreateVisible(false); setEditing(null); setDraftQty({});
    setSource(null); setDest(null); setSourceStock([]); setLines([]); setActiveCategory(null);
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
  const pendingDoc = useRef<number | null>(null);
  useEffect(() => {
    const doc = searchParams.get('doc') || searchParams.get('edit');
    if (doc) { pendingDoc.current = Number(doc); setSearchParams({}, { replace: true }); }
    const wanted = pendingDoc.current;
    if (!wanted || !transfers.length) return;
    pendingDoc.current = null;
    const target = transfers.find((t) => t.id === wanted);
    if (target) openTransfer(target);
    else message.warning(`إذن التحويل رقم ${wanted} مش في القائمة المعروضة`);
  }, [searchParams, transfers]);

  const openTransfer = async (t: TransferRecord) => {
    setEditing(t);
    setDraftQty({});
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
      const res = await api.get('/api/v1/transfers');
      const rows = res.data || [];
      setTransfers(rows);
      const found = rows.find((t: TransferRecord) => t.id === id) ?? null;
      setEditing(found);
      if (!found) closeCreate();
    } catch (err) { console.error(err); }
  };

  const handleSubmit = async () => {
    if (!source || !dest) { message.warning('اختر المصدر والوجهة أولاً'); return; }
    if (sameLocation) { message.error('لا يمكن التحويل إلى نفس الموقع'); return; }
    if (!route) { message.error('الاتجاه ده مش متاح للتحويل'); return; }
    const valid = lines.filter((l) => Number(l.quantity || 0) > 0);
    if (!valid.length) { message.warning('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر'); return; }
    const over = valid.find((l) => Number(l.quantity || 0) > l.available);
    if (over) { message.error(`«${over.name}»: الكمية تتجاوز المتاح (${qty(over.available)})`); return; }

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
      try {
        const r = await api.post(`/api/v1/transfers/${created.data.id}/self-approve`);
        approved = r.data?.status === 'approved';
      } catch { /* الإذن اتكتب؛ الاعتماد هيحصل من حد تاني */ }
      message.success(approved
        ? `اتحوّل ${valid.length} صنف واتحرّك المخزون`
        : `اتسجّل طلب التحويل بـ${valid.length} صنف — مستني الاعتماد`);
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
    rows: filter.filtered, rowKey: (t) => t.id, onOpen: (t) => openTransfer(t),
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
  /** سجل عمليات الإذن — مين عمل إيه وإمتى. */
  const [auditFor, setAuditFor] = useState<number | null>(null);
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
    if (!doc) { setReviewStock({}); return; }
    api.get('/api/v1/stock/by-location', { params: {
      location_kind: doc.source_location_kind,
      location_id: doc.source_location_id, only_available: true } })
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

  const rejectTransfer = async () => {
    if (!editing) return;
    try {
      await api.post(`/api/v1/transfers/${editing.id}/reject`,
        { reason: rejectReason || null });
      message.success('اترفض الإذن — مافيش بضاعة اتحركت');
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
   * من غير تأكيد: الضغط على «تعديل» هو الإجابة، وسؤال بياخد نفس الرد كل مرة هو ضغطة
   * زيادة مش حماية.
   */
  const editApproved = async (t: TransferRecord) => {
    try {
      await api.post(`/api/v1/transfers/${t.id}/cancel`, { reason: 'تعديل' });
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إلغاء الإذن');
      return;
    }
    message.success('اتلغى الإذن — عدّل وابعته للاعتماد من جديد');

    // Refill from what it actually moved — including a legacy permit whose item is on the
    // document rather than in a lines row.
    const src = t.source_location_kind && t.source_location_id != null
      ? locValue(t.source_location_kind, t.source_location_id) : null;
    const dst = t.dest_location_kind && t.dest_location_id != null
      ? locValue(t.dest_location_kind, t.dest_location_id) : null;
    setEditing(null); setDraftQty({});
    setSource(src); setDest(dst);
    // Read the source's stock BEFORE building the lines: the quantity box is capped at what is
    // available, so a line built against a zero would refuse the very quantity being corrected —
    // and the reversal has just put the goods back, so the number is right there to be read.
    let stock: StockRow[] = [];
    if (src) {
      const { kind, id } = parseLoc(src);
      try {
        stock = (await api.get('/api/v1/stock/by-location', { params: {
          location_kind: kind, location_id: id, only_available: true } })).data || [];
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
        available: Number(row?.on_hand ?? 0),
        quantity: Number(l.quantity) || 0,
      };
    }));
    setCreateVisible(true);
    fetchTransfers();
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
      date: (t.created_at || '').slice(0, 10) || null,
      approvedBy: t.approved_by ? (userNames[t.approved_by] || null) : null,
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
    showReversalConfirm({
      title: 'إلغاء إذن التحويل',
      content: `هتلغي إذن التحويل «${record.document_number}»؟ الكميات هترجع لمخزنها الأصلي، والإذن هيفضل في السجل مكتوب عليه إنه اتلغى.`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/transfers/${record.id}/cancel`, { reason: null });
          message.success('اتلغى الإذن ورجعت الكميات');
          fetchTransfers();
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message || 'تعذر إلغاء الإذن');
        }
      },
    });
  };

  /** حذف الإذن — بيروح هو وحركته، مايفضلش منه أثر في السجل. */
  const handleDelete = (record: TransferRecord) => {
    showReversalConfirm({
      title: 'حذف إذن التحويل',
      content: `هتمسح إذن التحويل «${record.document_number}» خالص؟ لو كان معتمد، الكميات هترجع لمخزنها الأصلي.`,
      onOk: async () => {
        try {
          await api.delete(`/api/v1/transfers/${record.id}`);
          message.success('اتمسح الإذن');
          setEditing(null);
          fetchTransfers();
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message || 'تعذر مسح الإذن');
        }
      },
    });
  };

  const totalUnits = lines.reduce((s, l) => s + (l.quantity || 0), 0);

  // ---------------------------------------------------------------- create page
  /** The two doors and the product window. A transfer's «who» is two places, so it asks them one
   *  at a time in the order the goods move: out of here, into there — and only then what. */
  const doors = (
    <>
      <ProductPickerModal
        open={pickerOpen}
        title="اختر الصنف المحوَّل"
        categories={categories.map((c) => c.value)}
        categoryLabels={categoryLabels}
        products={sourceStock.map((r) => ({
          id: r.item_id, name: r.name, category: r.category })) as any}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        onCancel={() => setPickerOpen(false)}
        onPick={(id: number) => { setPickerOpen(false); addItem(id); }} />

      <TabModal
        open={newStep === 'source'}
        title="التحويل من فين؟"
        okText="التالي" cancelText="إلغاء"
        onCancel={() => setNewStep(null)}
        onOk={() => { if (source) setNewStep('dest'); }}
        okButtonProps={{ disabled: !source }}
        destroyOnHidden
      >
        <Select showSearch size="large" style={{ width: '100%' }} autoFocus
          placeholder="اختر المخزن أو العهدة المصدر" optionFilterProp="label"
          value={source ?? undefined}
          onChange={(v) => { onSourceChange(v); }}
          options={locationOptions} />
        <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
          البضاعة بتطلع من هنا — والرصيد المتاح بيتحمّل على أساسه.
        </div>
      </TabModal>

      <TabModal
        open={newStep === 'dest'}
        title="التحويل لفين؟"
        okText="ابدأ" cancelText="رجوع"
        onCancel={() => setNewStep('source')}
        onOk={() => { if (dest) { setNewStep(null); setCreateVisible(true); } }}
        okButtonProps={{ disabled: !dest }}
        destroyOnHidden
      >
        <Select showSearch size="large" style={{ width: '100%' }} autoFocus
          placeholder="اختر المخزن أو العهدة الوجهة" optionFilterProp="label"
          value={dest ?? undefined} onChange={(v) => setDest(v)}
          options={locationOptions.filter((o: any) => o.value !== source)} />
        <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
          المصدر مستبعد من القايمة — تحويل لنفس المكان مش تحويل.
        </div>
      </TabModal>
    </>
  );

  /** The same strip the sale, the return and the purchase carry — same verbs, same places, and
   *  the keys it advertises are bound by the toolbar itself. */
  const transferToolbar = (): ToolbarAction[] => {
    const pending = editing?.status === 'pending';
    return [
      { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
        onClick: startNew },
      // On a saved permit «حفظ» has nothing to save: the lines are written the moment they are
      // changed, because editing them is what the approver does while deciding.
      ...(editing ? [] : [{
        key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
        onClick: handleSubmit,
        disabled: !source || !dest || lines.length === 0,
      } as ToolbarAction]),
      // اعتماد / رفض live HERE, on the document, and only while it is still a question. This is
      // the whole point: the approver reads and fixes the permit on the page it was written on,
      // instead of deciding from a read-only sheet that opened over the list.
      ...(editing && pending && canApprove ? [
        // No shortcut, deliberately. F4 is the system-wide screen search, and approving moves
        // goods across two warehouses — a decision somebody makes once, not a keystroke worth
        // racing to.
        { key: 'approve', label: 'اعتماد', icon: <CheckCircleOutlined />,
          onClick: () => handleApprove(editing.id),
          disabled: (editing.lines?.length ?? 0) === 0 && !editing.item_id },
        { key: 'reject', label: 'رفض', danger: true, icon: <CloseCircleOutlined />,
          onClick: () => setRejectOpen(true) },
      ] as ToolbarAction[] : []),
      // الإذن المعتمد بيتصلّح بالإلغاء وإعادة الكتابة — مافيش عكس في النظام.
      ...(editing && editing.status === 'approved' && canApprove ? [
        { key: 'edit', label: 'تعديل', icon: <EditOutlined />,
          onClick: () => editApproved(editing) },
        { key: 'cancel', label: 'إلغاء', danger: true, icon: <CloseCircleOutlined />,
          onClick: () => handleCancel(editing) },
      ] as ToolbarAction[] : []),
      // والحذف على أي إذن محفوظ — المعلّق والمرفوض والمعتمد.
      ...(editing && canApprove ? [
        { key: 'delete', label: 'حذف', danger: true, icon: <DeleteOutlined />,
          onClick: () => handleDelete(editing) },
      ] as ToolbarAction[] : []),
      // Printing is offered on any saved permit, whatever its state: a pending one is the picking
      // list somebody walks to the store, and an approved one is the delivery note they sign.
      ...(editing ? [{
        key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />,
        onClick: () => printOpenTransfer(editing),
      } as ToolbarAction] : []),
      ...(editing ? [{
        key: 'log', label: 'سجل العمليات', icon: <FileSearchOutlined />,
        onClick: () => setAuditFor(editing.id),
      } as ToolbarAction] : [{
        key: 'undo', label: 'تراجع', icon: <UndoOutlined />,
        onClick: () => setLines([]), disabled: lines.length === 0,
      } as ToolbarAction]),
      { key: 'close', label: 'إغلاق', shortcut: 'Esc', icon: <ArrowLeftOutlined />,
        onClick: closeCreate },
    ];
  };

  const columns = [
    { title: 'رقم المستند', dataIndex: 'document_number', key: 'document_number',
      render: (doc: string) => <Tag color="blue">{doc}</Tag> },
    { title: 'الصنف', dataIndex: 'item_id', key: 'item_id',
      render: (id: number | null) => nameOfItem(id) },
    { title: 'الكمية', dataIndex: 'quantity', key: 'quantity',
      render: (q: string | null) => <b>{qty(q)}</b> },
    { title: 'من', key: 'src',
      render: (_: any, r: TransferRecord) => locationName(r.source_location_kind, r.source_location_id) },
    { title: 'إلى', key: 'dst',
      render: (_: any, r: TransferRecord) => locationName(r.dest_location_kind, r.dest_location_id) },
    { title: 'نوع المناقلة', dataIndex: 'route', key: 'route',
      render: (r: string) => ROUTE_LABELS[r] || r },
    { title: 'الحالة', dataIndex: 'status', key: 'status',
      render: (s: string) => {
        const tag = STATUS_TAGS[s] || { color: 'default', text: s };
        return <Tag color={tag.color}>{tag.text}</Tag>;
      } },
    { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at',
      render: (v: string | null) => (v ? String(v).slice(0, 10) : '-') },
    {
      title: 'الإجراءات', key: 'actions',
      render: (_: any, record: TransferRecord) => (
        <Space size="middle">
          {/* Opens the document — the decision is taken on the permit, not on a sheet ABOUT the
              permit. Same page it was written on, same page it is fixed on. */}
          {record.status === 'pending' && canApprove && (
            <Button type="primary" size="small" icon={<CheckCircleOutlined />}
              onClick={() => openTransfer(record)}>
              اعتماد
            </Button>
          )}
          {record.status === 'approved' && canApprove && (
            <Button type="primary" danger size="small" icon={<CloseCircleOutlined />}
              onClick={() => handleCancel(record)}>
              إلغاء
            </Button>
          )}
          {canApprove && (
            <Button danger size="small" icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}>
              حذف
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  /**
   * أعمدة سطور الإذن — بتتخفي وبتترتّب زي أي جدول تاني في النظام.
   *
   * كانت مكتوبة inline جوّه `columns={[...]}`، فمافيش حاجة تقدر توصلها. `useTableColumns`
   * هو نفس المحرك اللي القوايم بتستعمله.
   */
  /** أعمدة سطور الإذن المفتوح — نفس المحرك، وتفضيلاتها لوحدها. */
  const docLineColumns = [
                { title: 'الصنف', dataIndex: 'item_id',
                  render: (id: number) => <b>{nameOfItem(id)}</b> },
                { title: 'المتاح في المصدر',
                  render: (_: any, r: any) => {
                    // Red the moment the line asks for more than is on the shelf — the ordinary
                    // reason an approver hesitates, said before he presses اعتماد rather than by
                    // the negative-stock guard afterwards.
                    const have = reviewStock[r.item_id] ?? 0;
                    const short = Number(r.quantity || 0) > have;
                    return (
                      <span style={{ color: short ? '#cf1322' : '#6AB42D', fontWeight: 600 }}>
                        {qty(have)}
                      </span>
                    );
                  } },
                { title: 'الكمية المحوّلة', dataIndex: 'quantity',
                  render: (v: any, r: any) => (editing?.status === 'pending' && !r._header ? (
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
                ...(editing?.status === 'pending' ? [{
                  title: '', width: 50,
                  render: (_: any, r: any) => (r._header ? null : (
                    <Popconfirm title="تشيل الصنف ده من الإذن؟" okText="شيل" cancelText="لأ"
                      onConfirm={() => removeReviewLine(r.id)}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )),
                }] : []),
              ];
  const docCols = useTableColumns('transfer-doc-lines', docLineColumns);

  const draftLineColumns = [
                { title: 'الصنف', dataIndex: 'name', render: (n: string) => <b>{n}</b> },
                { title: 'الفئة', dataIndex: 'category',
                  render: (c: string | null) => (c ? <Tag>{categoryLabels[c] || c}</Tag> : '-') },
                { title: 'المتاح في المصدر', dataIndex: 'available',
                  render: (v: number, r: TransferLine) => (
                    <span style={{ color: '#6AB42D', fontWeight: 600 }}>
                      {qty(v)} {r.unit || ''}
                    </span>
                  ) },
                { title: 'الكمية المحوّلة', dataIndex: 'quantity',
                  onCell: (r: TransferLine) => ({ [QTY_DATA_ATTR]: r.item_id } as any),
                  // No `max` — see `quantityGuard`: capping silently rewrites the number
                  // somebody typed, and they never learn it was changed.
                  render: (v: number, r: TransferLine) => (
                    <InputNumber size="small" step={1} value={v}
                      style={{ width: 120 }}
                      data-qty-key={r.key}
                      data-grid-col="qty" keyboard={false}
                      onBlur={() => setLineQty(r.key, guardQuantity(
                        { value: r.quantity, available: r.available, itemName: r.name, unit: r.unit },
                        null) as number)}
                      // Enter means «this line is done» — the window opens for the next item,
                      // exactly as on the sale, the return and the purchase.
                      onPressEnter={(e) => {
                        e.preventDefault();
                        const kept = guardQuantity(
                          { value: r.quantity, available: r.available, itemName: r.name, unit: r.unit },
                          null);
                        setLineQty(r.key, kept as number);
                        // Enter بينقل للسطر اللي بعده، وآخر سطر بيفتح الشباك — كان بيفتح
                        // الشباك على طول، فاللي عنده خمس سطور مكتوبة كان لازم يرجع للماوس
                        // عشان يوصل للسطر التاني.
                        if (kept !== null) advance(r.key);
                      }}
                      onChange={(val) => setLineQty(r.key, Number(val))} />
                  ) },
                { title: 'المتبقي بعد التحويل',
                  render: (_: any, r: TransferLine) => qty(r.available - Number(r.quantity || 0)) },
                { title: '', width: 50,
                  render: (_: any, r: TransferLine) => (
                    <Button type="text" size="small" danger icon={<DeleteOutlined />}
                      onClick={() => removeLine(r.key)} />
                  ) },
              ];
  const draftCols = useTableColumns('transfer-draft-lines', draftLineColumns);

  const tableCols = useTableColumns('transfer-requests', columns);

  if (createVisible) {
    const stockOfCategory = sourceStock.filter((s) => (
      activeCategory === NO_CATEGORY ? !s.category : s.category === activeCategory));
    return (
      <div>
        {doors}
        <DocumentToolbar actions={transferToolbar()} />
        <Card title={(
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={closeCreate}>رجوع</Button>
            <span>{editing
              ? `إذن تحويل ${editing.document_number}`
              : 'طلب تحويل مخزني جديد'}</span>
            {editing && (
              <Tag color={(STATUS_TAGS[editing.status] || {}).color}>
                {(STATUS_TAGS[editing.status] || {}).text || editing.status}
              </Tag>
            )}
          </Space>
        )}>
          {/* An open permit says what happens next, on the document, before anything else. The
              approver arrives here to answer a question and should not have to infer it from
              which buttons are lit. */}
          {editing && editing.status === 'pending' && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message={canApprove
                ? 'الإذن ده لسه مستني الاعتماد'
                : 'الإذن ده لسه مستني اعتماد مدير المخزن'}
              description={canApprove
                ? 'عدّل الكميات أو شيل صنف لو محتاج، وبعدين اعتمد أو ارفض من فوق. مافيش بضاعة اتحركت لحد دلوقتي.'
                : 'تقدر تشوفه وتراجعه — الاعتماد نفسه من صلاحية مدير المخزن.'} />
          )}
          {editing && editing.status !== 'pending' && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }}
              message={editing.status === 'approved' ? 'الإذن ده اتعتمد واتشحن' : 'الإذن ده اترفض'}
              description={editing.status === 'approved'
                ? 'الاعتماد رحّل حركات على مخزنين، فالإذن مايتغيّرش في مكانه. «تعديل الإذن» بيعكسه ويفتح طلب جديد بمحتواه عشان تصحّح وتبعته للاعتماد من جديد — والتلاتة بيفضلوا في السجل.'
                : 'الإذن المرفوض مافيهوش بضاعة اتحركت. لو لسه محتاجه، اعمل طلب جديد.'}
              action={editing.reject_reason
                ? <span>سبب الرفض: <b>{editing.reject_reason}</b></span> : undefined} />
          )}

          {/* 1) من أين وإلى أين */}
          <Divider orientation="right" style={{ fontWeight: 700 }}>١) التحويل من أين إلى أين</Divider>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>من (المصدر)</div>
              <Select showSearch size="large" style={{ width: '100%' }}
                placeholder="اختر المخزن أو العهدة المصدر"
                optionFilterProp="label"
                // Fixed once the permit exists: «from here to there» IS the permit, and changing
                // it is a different one rather than an edit of this one.
                disabled={!!editing}
                value={source ?? undefined} onChange={onSourceChange}
                options={locationOptions} />
            </Col>
            <Col xs={24} md={12}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>إلى (الوجهة)</div>
              <Select showSearch size="large" style={{ width: '100%' }}
                placeholder="اختر المخزن أو العهدة الوجهة"
                optionFilterProp="label"
                disabled={!!editing}
                value={dest ?? undefined} onChange={(v) => setDest(v)}
                options={locationOptions} />
            </Col>
          </Row>

          {source && dest && sameLocation && (
            <Alert style={{ marginTop: 12 }} type="error" showIcon
              message="المصدر والوجهة نفس الموقع — اختر وجهة مختلفة" />
          )}
          {source && dest && !sameLocation && !route && (
            <Alert style={{ marginTop: 12 }} type="warning" showIcon
              message="التحويل من عهدة مندوب إلى مخزن غير متاح من هذه الشاشة"
              description="استخدم شاشة تسليم عهدة المندوب لإرجاع البضاعة إلى المخزن." />
          )}
          {route && !sameLocation && (
            <Alert style={{ marginTop: 12 }} type="success" showIcon
              message={`نوع التحويل: ${ROUTE_LABELS[route]}`} />
          )}

          {/* 2) الفئة ثم 3) الأصناف */}
          <Divider orientation="right" style={{ fontWeight: 700 }}>
            {editing ? 'أصناف الإذن' : '٢) الفئة والأصناف'}
          </Divider>
          {editing ? null : !source ? (
            <Empty description="اختر المصدر أولاً لعرض الأصناف المتاحة فيه" style={{ margin: '12px 0' }} />
          ) : stockLoading ? (
            <Empty description="جارٍ تحميل أرصدة المصدر..." style={{ margin: '12px 0' }} />
          ) : sourceStock.length === 0 ? (
            <Alert type="info" showIcon message="لا توجد أي أصناف برصيد متاح في هذا الموقع" />
          ) : (
            <Row gutter={12}>
              <Col xs={24} md={7}>
                <Select showSearch size="large" style={{ width: '100%' }}
                  placeholder="اختر الفئة" value={activeCategory ?? undefined}
                  optionFilterProp="label"
                  onChange={(v) => setActiveCategory(v ?? null)}
                  options={categories} />
              </Col>
              <Col xs={24} md={17}>
                <Select showSearch size="large" style={{ width: '100%' }} value={null}
                  disabled={!activeCategory}
                  placeholder={activeCategory ? 'اختر صنفاً لإضافته (المتاح فقط)' : 'اختر الفئة أولاً'}
                  optionFilterProp="label"
                  onChange={(v) => { if (v) addItem(v as number); }}
                  options={stockOfCategory.map((s) => ({
                    value: s.item_id,
                    label: `${s.name} — المتاح: ${qty(s.on_hand)}`,
                  }))} />
              </Col>
            </Row>
          )}

          {/* السطور المحفوظة — بتتعدّل على السيرفر على طول.
              A saved permit's lines are rows in the database, not a draft: changing a quantity or
              dropping an item IS the edit, and it is what an approver does while deciding. A
              closed permit is read-only — approval already moved goods across two warehouses. */}
          {editing && (
            <Table
              style={{ marginTop: 16 }} size="small" rowKey="id" pagination={false}
              dataSource={docLines(editing)}
              locale={{ emptyText: 'مفيش أصناف على الإذن — ارفضه بدل ما تعتمده' }}
              columns={docCols.columns}
              title={() => <div style={{ textAlign: 'left' }}>{docCols.control}</div>}
            />
          )}

          {/* Lines */}
          {!editing && lines.length > 0 && (
            <Table
              style={{ marginTop: 16 }} size="small" rowKey="key" pagination={false}
              dataSource={lines}
              columns={draftCols.columns}
              title={() => (
                <div style={{ textAlign: 'left' }}>{draftCols.control}</div>
              )}
            />
          )}

          <div style={{
            marginTop: 16, padding: 16, borderRadius: 10,
            background: '#f6faf3', border: '1px solid #e6efe3',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            flexWrap: 'wrap',
          }}>
            <Space size={32} wrap>
              <span>
                <span style={{ color: '#6b6b6b', fontSize: 12 }}>عدد الأصناف: </span>
                <b>{editing ? docLines(editing).length : lines.length}</b>
              </span>
              <span>
                <span style={{ color: '#6b6b6b', fontSize: 12 }}>إجمالي الكميات: </span>
                <b style={{ color: '#6AB42D', fontSize: 18 }}>
                  {qty(editing
                    ? docLines(editing).reduce(
                      (t: number, l: any) => t + Number(l.quantity || 0), 0)
                    : totalUnits)}
                </b>
              </span>
              {source && dest && route && !sameLocation && (
                <span style={{ fontSize: 13 }}>
                  {locationName(parseLoc(source).kind, parseLoc(source).id)}
                  {' ← '}
                  {locationName(parseLoc(dest).kind, parseLoc(dest).id)}
                </span>
              )}
            </Space>
            <Space>
              {/* The decision sits at the bottom of the document it is a decision about — the
                  same place «إرسال طلب التحويل» sits when the document is new. */}
              {editing ? (
                <>
                  {editing.status === 'pending' && canApprove && (
                    <>
                      <Button type="primary" size="large" icon={<CheckCircleOutlined />}
                        disabled={(editing.lines?.length ?? 0) === 0 && !editing.item_id}
                        onClick={() => handleApprove(editing.id)}>
                        اعتماد الإذن
                      </Button>
                      <Button danger size="large" onClick={() => setRejectOpen(true)}>رفض</Button>
                    </>
                  )}
                  {editing.status === 'approved' && canApprove && (
                    <>
                      <Button type="primary" size="large" icon={<EditOutlined />}
                        onClick={() => editApproved(editing)}>
                        تعديل الإذن
                      </Button>
                      <Button danger size="large" icon={<CloseCircleOutlined />}
                        onClick={() => handleCancel(editing)}>إلغاء</Button>
                      <Button danger size="large" icon={<DeleteOutlined />}
                        onClick={() => handleDelete(editing)}>حذف</Button>
                    </>
                  )}
                  <Button size="large" onClick={closeCreate}>إغلاق</Button>
                </>
              ) : (
                <>
                  <Button type="primary" size="large" loading={submitting}
                    disabled={!route || sameLocation || lines.length === 0}
                    onClick={handleSubmit}>
                    إرسال طلب التحويل
                  </Button>
                  <Button size="large" onClick={closeCreate}>إلغاء</Button>
                </>
              )}
            </Space>
          </div>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------------- list
  const summary = {
    total: transfers.length,
    pending: transfers.filter((t) => t.status === 'pending').length,
    approved: transfers.filter((t) => t.status === 'approved').length,
  };


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
  const auditDialog = (
    <DocumentAuditModal
      entityType="stock_transfer" entityId={auditFor}
      title="سجل عمليات إذن التحويل" userNames={userNames}
      onClose={() => setAuditFor(null)} />
  );

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
        message="مافيش بضاعة هتتحرك"
        description="الرفض مش زي «اعتمد وبعدين اعكس» — مافيش حاجة نزلت من الرف عشان ترجع تاني." />
      <Input.TextArea rows={3} value={rejectReason} autoFocus
        placeholder="سبب الرفض — أول سؤال هيسأله اللي طلب التحويل"
        onChange={(e: any) => setRejectReason(e.target.value)} />
    </TabModal>
  );

  return (
    <div>
      {rejectDialog}
      {auditDialog}
      {/* The doors belong to BOTH branches. The create page is an early return, so a door declared
          only there unmounts at the instant it opens the page behind it — which is how the return
          ended up with a dialog on screen that no state could close. */}
      {doors}
      <Card
        title="إدارة تحويلات ومناقلات المخزون"
        extra={
          <Space>
            {tableCols.control}
            <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
              onClick={startNew}>
              طلب تحويل مخزني
            </Button>
          </Space>
        }
      >
        <ListToolbar
          searchPlaceholder="بحث برقم المستند أو الموقع"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          showDateRange range={filter.range} onRangeChange={filter.setRange}
          onReset={filter.reset}
          total={transfers.length} shown={filter.filtered.length}
          filters={[
            { key: 'status', placeholder: 'الحالة',
              options: Object.entries(STATUS_TAGS).map(([k, v]) => ({ value: k, label: v.text })) },
            { key: 'route', placeholder: 'نوع المناقلة',
              options: Object.entries(ROUTE_LABELS).map(([k, v]) => ({ value: k, label: v })) },
          ]}
        />

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="إجمالي المستندات" value={summary.total} /></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="بانتظار الاعتماد" value={summary.pending}
                valueStyle={{ color: summary.pending ? '#F5A11D' : undefined }} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="معتمدة" value={summary.approved} valueStyle={{ color: '#6AB42D' }} />
            </Card>
          </Col>
        </Row>

        <Table
          {...listKb.tableProps}
          dataSource={filter.filtered} columns={tableCols.columns} rowKey="id" loading={loading}
          pagination={{ defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
        />
      </Card>
    </div>
  );
}

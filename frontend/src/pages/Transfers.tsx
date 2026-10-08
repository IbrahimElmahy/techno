import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DraftTag from '../components/DraftTag';
import { PAGE_SIZE as TABLE_PAGE_SIZE, PAGE_SIZE_OPTIONS }
  from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Alert, Button, Col, DatePicker, Descriptions, Empty, Form, Input, Modal, Row,
  Select, Space, Tag, Tooltip, message,
} from 'antd';
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
const PAGE_SIZE = 300;

interface TransferRecord {
  id: number;
  document_number: string;
  status: 'pending' | 'approved' | 'rejected' | 'reversed';
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
  pending_out?: string;
}

interface TransferLine {
  key: string;
  item_id: number;
  name: string;
  category: string | null;
  unit: string | null;
  available: number;
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

const locValue = (kind: string, id: number) => `${kind}:${id}`;
const parseLoc = (v: string) => {
  const [kind, id] = v.split(':');
  return { kind, id: Number(id) };
};

const routeFor = (srcKind: string, dstKind: string): string | null => {
  if (srcKind === 'warehouse' && dstKind === 'warehouse') return 'central_to_branch';
  if (srcKind === 'warehouse' && dstKind === 'custody') return 'central_to_rep';
  if (srcKind === 'custody' && dstKind === 'custody') return 'rep_to_rep';
  if (srcKind === 'custody' && dstKind === 'warehouse') return 'rep_to_central';
  return null;
};

const docDate = (t: { transfer_date?: string | null; created_at?: string | null }) =>
  String(t.transfer_date || t.created_at || '').slice(0, 10);

export default function Transfers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const { user, can } = useAuth();
  const canApprove = can('transfer.approve');

  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [periodRows, setPeriodRows] = useState<TransferRecord[] | null>(null);
  const [loadRangeOpen, setLoadRangeOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [custodies, setCustodies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  const [newStep, setNewStep] = useState<null | 'source' | 'dest'>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const [transferDate, setTransferDate] = useState<Dayjs>(dayjs());
  const [source, setSource] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [sourceStock, setSourceStock] = useState<StockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [statement1, setStatement1] = useState('');
  const [externalDocNumber, setExternalDocNumber] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const linesByCategory = useMemo(
    () => (lines.length ? [{ category: null as string | null, items: lines as TransferLine[] }] : []),
    [lines]);
  const shownLines = useMemo(() => linesByCategory.flatMap((g) => g.items), [linesByCategory]);
  const advance = advanceFrom(shownLines, setFocusLineKey, () => setPickerOpen(true));

  const [submitting, setSubmitting] = useState(false);

  const [editing, setEditing] = useState<TransferRecord | null>(null);
  const [viewOnly, setViewOnly] = useState(false);

  const fetchTransfers = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/api/v1/transfers', { params: { limit: PAGE_SIZE } });
      setTransfers(res.data);
    } catch (err) { console.error(err); } finally { if (!silent) setLoading(false); }
  };
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

  const locationOptions = useMemo(() => ([
    {
      label: 'المخازن',
      options: sortByName(warehouses.filter((w) => w.active !== false
        || [source, dest].includes(locValue('warehouse', w.id))), (w) => w.name).map((w) => ({
        value: locValue('warehouse', w.id), label: withInactiveTag(w.name || `مخزن #${w.id}`, w),
      })),
    },
    {
      label: 'عهد المناديب',
      options: sortByName(custodies.filter((c) => [source, dest].includes(locValue('custody', c.id))),
        (c) => c.name).map((c) => ({
        value: locValue('custody', c.id), label: c.name || `عهدة #${c.id}`,
      })),
    },
  ].filter((g) => g.options.length > 0)), [warehouses, custodies, source, dest]);

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
    setLines([]); setActiveCategory(null); setSourceStock([]);
    if (v) loadSourceStock(v);
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    sourceStock.forEach((s) => { if (s.category) set.add(s.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [sourceStock]);

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
    const available = Math.max(
      0, Number(row.on_hand || 0) - Number(row.pending_out || 0));
    const existing = lines.find((l) => l.item_id === itemId);
    if (existing) {
      if (qtyTyped) setLineQty(existing.key, Number(existing.quantity || 0) + qtyTyped);
      else message.info(`«${row.name}» موجود بالفعل`);
      return { dup: itemId };
    }
    const key = `${itemId}-${lines.length}`;
    let quantity: number | null = null;
    if (qtyTyped) {
      if (qtyTyped > available) {
        message.warning(available > 0
          ? `«${row.name}»: المتاح ${qty(available)} — تم تسجيل ${qty(available)}.`
          : `«${row.name}»: لا يوجد رصيد متاح في المصدر.`);
      }
      quantity = Math.min(available, qtyTyped) || null;
    }
    setLines((prev) => [...prev, {
      key, item_id: itemId, name: row.name,
      category: row.category, unit: row.unit_of_measure, available, quantity,
    }]);
    return quantity == null ? { needsQty: key } : null;
  };

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
    if (line && value != null && value > line.available) {
      message.warning(line.available > 0
        ? `«${line.name}»: المتاح ${qty(line.available)} — تم تسجيل ${qty(line.available)}.`
        : `«${line.name}»: لا يوجد رصيد متاح في المصدر.`);
    }
    setLines((prev) => prev.map((l) => (l.key === key
      ? { ...l, quantity: value == null ? null : Math.max(0, Math.min(l.available, value)) } : l)));
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const startNew = () => {
    clearDocParam();
    setSource(null); setDest(null); setLines([]); setCreateVisible(false);
    setViewOnly(false); setEditing(null);
    setStatement1(''); setExternalDocNumber(''); setDocNotes('');
    setNewStep('source');
  };

  const closeCreate = (opts?: { stay?: boolean }) => {
    if (opts?.stay !== true && docReturn.origin()) {
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

  const docInUrl = useRef<number | null>(null);
  const closedDocRef = useRef<number | null>(null);
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
  const closeOnBackRef = useRef<(() => void) | null>(null);

  closeOnBackRef.current = () => { closeCreate({ stay: true }); };

  const pendingDoc = useRef<number | null>(null);
  const [docFetching, setDocFetching] = useState(false);
  const fetchingDoc = useRef<number | null>(null);
  useEffect(() => {
    const doc = searchParams.get('doc') || searchParams.get('edit');
    if (!doc) closedDocRef.current = null;
    if (doc && Number(doc) === docInUrl.current) return;
    if (!doc && docInUrl.current !== null) {
      docInUrl.current = null;
      closeOnBackRef.current?.();
      return;
    }
    if (doc && Number(doc) !== fetchingDoc.current) {
      pendingDoc.current = Number(doc);
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
    fetchingDoc.current = wanted;
    setDocFetching(true);
    api.get(`/api/v1/transfers/${wanted}`)
      .then((r) => openTransfer(r.data))
      .catch(() => {
        message.warning(`إذن التحويل رقم ${wanted} غير موجود`);
        if (docInUrl.current == null) clearDocParam();
      })
      .finally(() => {
        if (fetchingDoc.current === wanted) fetchingDoc.current = null;
        setDocFetching(false);
      });
  }, [searchParams, transfers]);

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
    paused: Boolean(editing),
    isEmpty: (x: any) => !x.source && !(x.lines || []).length,
    title: (x: any) => {
      const from = x.source ? locationName(parseLoc(x.source).kind as any,
                                           parseLoc(x.source).id) : 'بدون مصدر';
      return `${from} — ${(x.lines || []).length} صنف`;
    },
  });

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
    if (x.source) loadSourceStock(x.source);
  };

  const openTransfer = async (t: TransferRecord) => {
    writeDocParam(t.id);
    setEditing(t);
    setDraftQty({});
    setViewOnly(!(t.status === 'pending' && canApprove));
    setTransferDate(dayjs(t.transfer_date || t.created_at || undefined));
    setStatement1(t.statement1 || '');
    setExternalDocNumber(t.external_document_number || '');
    setDocNotes(t.notes || '');
    if (t.status === 'pending' && !(t.lines?.length) && t.item_id) {
      try {
        await api.post(`/api/v1/transfers/${t.id}/lines`, {
          item_id: t.item_id, quantity: String(t.quantity ?? 0),
        });
        await refreshEditing(t.id);
      } catch (err) {
        console.error(err);
      }
    }
    setSource(t.source_location_kind && t.source_location_id != null
      ? locValue(t.source_location_kind, t.source_location_id) : null);
    setDest(t.dest_location_kind && t.dest_location_id != null
      ? locValue(t.dest_location_kind, t.dest_location_id) : null);
    setActiveCategory(null);
    setCreateVisible(true);
  };

  const refreshEditing = async (id: number) => {
    try {
      const res = await api.get('/api/v1/transfers', { params: { limit: PAGE_SIZE } });
      const rows = res.data || [];
      setTransfers(rows);
      let found = rows.find((t: TransferRecord) => t.id === id) ?? null;
      if (!found) {
        found = await api.get(`/api/v1/transfers/${id}`).then((r) => r.data).catch(() => null);
      }
      setEditing(found);
      if (!found) closeCreate();
    } catch (err) { console.error(err); }
  };

  const freshAvailability = async (): Promise<Record<number, number> | null> => {
    if (!source) return null;
    const { kind, id } = parseLoc(source);
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: {
          location_kind: kind, location_id: id, only_available: false,
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
      console.error(err);
      return null;
    }
  };

  const warnOverAvailable = (
    over: { line: TransferLine; free: number }[],
  ) => {
    Modal.confirm({
      title: 'لا يمكن تحويل كمية غير متاحة',
      icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
      width: 520,
      content: (
        <div>
          <div style={{ marginBottom: 8 }}>هذه الكميات أكبر من المتاح في المصدر:</div>
          {over.map((o) => (
            <div key={o.line.key} style={{ marginBottom: 4 }}>
              • <b>{o.line.name}</b> — مطلوب {qty(Number(o.line.quantity || 0))}، المتاح{' '}
              {qty(o.free)}
              {o.free <= 0 ? ' (لا يوجد رصيد متاح)' : ''}
            </div>
          ))}
        </div>
      ),
      okText: 'تخفيض إلى المتاح',
      cancelText: 'تعديل يدوي',
      onOk: () => {
        setLines((prev) => prev
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
    const fresh = await freshAvailability();
    const over = valid
      .map((l) => ({ line: l, free: fresh ? (fresh[l.item_id] ?? 0) : l.available }))
      .filter((o) => Number(o.line.quantity || 0) > o.free + 1e-9);
    if (over.length) { warnOverAvailable(over); return; }

    const src = parseLoc(source);
    const dst = parseLoc(dest);
    setSubmitting(true);
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
      await api.post(`/api/v1/transfers/${created.data.id}/lines`, {
        item_id: first.item_id, quantity: String(first.quantity || 0),
      });
      for (const l of rest) {
        await api.post(`/api/v1/transfers/${created.data.id}/lines`, {
          item_id: l.item_id, quantity: String(l.quantity || 0),
        });
      }
      let approved = false;
      let refused: string | null = null;
      try {
        const r = await api.post(`/api/v1/transfers/${created.data.id}/self-approve`);
        approved = r.data?.status === 'approved';
      } catch (err: any) {
        refused = err?.response?.data?.detail?.message || err?.response?.data?.message || null;
      }
      if (refused) {
        message.warning(`تم تسجيل طلب التحويل ولم يُعتمد: ${refused}`, 8);
      } else {
        message.success(approved
          ? `تم اعتماد إذن التحويل بـ${valid.length} صنف وتم تحريك المخزون`
          : `تم تسجيل طلب التحويل بـ${valid.length} صنف — بانتظار المراجعة والاعتماد`);
      }
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

  const listKb = useTableKeyboard<TransferRecord>({
    rows: filter.filtered, rowKey: (t) => t.id,
    onOpen: (t: any) => (t?.__isDraft ? resumeDraft(t.__draft) : openTransfer(t)),
  });
  const [itemNames, setItemNames] = useState<Record<number, string>>({});
  useEffect(() => {
    api.get('/api/v1/items')
      .then((r) => setItemNames(Object.fromEntries(
        (r.data || []).map((i: any) => [i.id, i.name]))))
      .catch(() => setItemNames({}));
  }, []);
  const nameOfItem = (id: number | null | undefined) =>
    (id ? itemNames[id] || `صنف #${id}` : '-');

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
  const [reviewStock, setReviewStock] = useState<Record<number, number>>({});
  useEffect(() => {
    const doc = editing;
    if (!doc || doc.status !== 'pending'
        || !doc.source_location_kind || doc.source_location_id == null) {
      setReviewStock({});
      return;
    }
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
      message.success('تم حذف الصنف من الإذن');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حذف الصنف');
    }
  };

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

  const editApproved = async (t: TransferRecord) => {
    const ok = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `تعديل إذن «${t.document_number}»؟`,
        content: 'هذا الإذن معتمد وقد تحركت بضاعته، فلا يمكن تعديله في مكانه. '
          + 'سيُلغى الإذن وتعود البضاعة إلى مصدرها، ويُفتح طلب جديد بالمحتوى نفسه '
          + 'لتصحيحه وإرساله للاعتماد. ويبقى الإذن الملغي في السجل.',
        okText: 'إلغاء وفتح طلب جديد', okButtonProps: { danger: true },
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
    message.success('تم إلغاء الإذن');
    await refillAsNew(t);
    fetchTransfers();
  };

  const refillAsNew = async (t: TransferRecord) => {
    const src = t.source_location_kind && t.source_location_id != null
      ? locValue(t.source_location_kind, t.source_location_id) : null;
    const dst = t.dest_location_kind && t.dest_location_id != null
      ? locValue(t.dest_location_kind, t.dest_location_id) : null;
    setEditing(null); setDraftQty({});
    setSource(src); setDest(dst);
    setStatement1(t.statement1 || '');
    setExternalDocNumber(t.external_document_number || '');
    setDocNotes(t.notes || '');
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
      title: 'هذا الإذن مغلق',
      content: t.status === 'rejected'
        ? 'هذا الإذن ملغى أو مرفوض فلا يمكن تعديله. '
          + 'هل تريد إنشاء طلب جديد بالمحتوى نفسه؟'
        : 'هذا الإذن ليس قيد الاعتماد فلا يمكن تعديله. هل تريد إنشاء طلب جديد بالمحتوى نفسه؟',
      okText: 'إنشاء طلب جديد بمحتواه',
      cancelText: 'لا',
      onOk: () => refillAsNew(t),
    });
  };

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
        subtitle=""
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
        subtitle=""
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

  const rejectDialog = (
    <TabModal
      open={rejectOpen}
      title="رفض إذن التحويل"
      okText="رفض" cancelText="تراجع"
      okButtonProps={{ danger: true }}
      onCancel={() => { setRejectOpen(false); setRejectReason(''); }}
      onOk={rejectTransfer}
      destroyOnHidden
    >
      <Input.TextArea rows={3} value={rejectReason} autoFocus
        placeholder="سبب الرفض"
        onChange={(e: any) => setRejectReason(e.target.value)} />
    </TabModal>
  );

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
      render: (doc: string, r: any) => (r.__isDraft
        ? <DraftTag label="مسودة — لم تُرسل بعد"
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
    { title: 'التاريخ', dataIndex: 'transfer_date', key: 'transfer_date',
      sorter: (a: TransferRecord, b: TransferRecord) =>
        docDate(a).localeCompare(docDate(b)),
      render: (_: any, r: TransferRecord) => docDate(r) || '-' },
    { title: 'البيان', dataIndex: 'statement1', key: 'statement1', ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'رقم المستند الورقي', dataIndex: 'external_document_number', key: 'external_document_number',
      ellipsis: true, width: 130, render: (v: string | null) => v || '-' },
    {
      title: 'الإجراءات', key: 'actions', width: 140, fixed: 'left' as const,
      render: (_: any, record: TransferRecord) => ((record as any).__isDraft ? (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="حذف المسودة">
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
    { key: 'idx', title: '#', width: 40, align: 'center' as const,
      render: (_v: any, _r: any, i: number) => (
        <span style={{ color: '#6b6b6b' }}>{i + 1}</span>) },
    { key: 'name', title: 'الصنف', dataIndex: 'item_id',
      render: (id: number) => <b>{nameOfItem(id)}</b> },
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
        <Popconfirm title="حذف هذا الصنف من الإذن؟" okText="حذف" cancelText="لا"
          onConfirm={() => removeReviewLine(r.id)}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )),
    }] : []),
  ];
  const docCols = useTableColumns('transfer-doc-lines', docLineColumns, {
    export: {
      name: editing ? `إذن تحويل ${editing.document_number}` : 'إذن تحويل',
      rows: editing ? docLines(editing) : [],
    },
  });

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
        <div className="qty-stepper">
          <button type="button" tabIndex={-1} className="qty-step" title="إنقاص واحد"
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
          <button type="button" tabIndex={-1} className="qty-step" title="زيادة واحد"
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
        <Button size="small" danger type="text" icon={<DeleteOutlined />} title="حذف السطر"
          onClick={() => removeLine(r.key)} />
      ),
      footer: () => null },
  ];
  const lineGrid = useEntryGrid('transfer-lines-grid', draftLineColumns);

  const tableCols = useTableColumns('transfer-requests', columns, {
    export: { name: 'التحويلات', rows: filter.filtered },
  });

  const screen = createVisible ? (
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
            {!editing && <Tag color="blue" style={{ marginInlineEnd: 0 }}>مسودة</Tag>}
            {editing && navRows.some((r) => r.id === editing.id) && (
              <Tag style={{ marginInlineEnd: 0 }}>
                {navRows.findIndex((r) => r.id === editing.id) + 1} / {navRows.length}
              </Tag>
            )}
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
                : 'هذا الإذن ما زال بانتظار اعتماد مدير المخزن'} />
          )}
          {editing && editing.status !== 'pending' && !viewOnly && (
            <Alert type="warning" showIcon
              message={{
                approved: 'تم اعتماد هذا الإذن وشحنه',
                rejected: 'تم رفض هذا الإذن',
                reversed: 'تم إلغاء هذا الإذن',
              }[editing.status] ?? 'هذا الإذن مغلق'}
              action={editing.reject_reason
                ? <span>{editing.status === 'reversed' ? 'سبب الإلغاء: ' : 'سبب الرفض: '}
                    <b>{editing.reject_reason}</b></span> : undefined} />
          )}

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

          {editing && (
            <div className="sale-grid-wrap">
              <Table
                className="sale-grid" size="small" rowKey="id" pagination={false}
                dataSource={docLines(editing)}
                locale={{ emptyText: 'لا توجد أصناف على الإذن' }}
                columns={docCols.columns}
              />
            </div>
          )}

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

          {editing && (
            <div className="sale-card sale-notes">
              <div className="sale-attach">
                <DocumentAttachments docType="stock_transfer" docId={editing.id} title="مرفقات" />
              </div>
            </div>
          )}

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

  const summary = {
    total: transfers.length,
    pending: transfers.filter((t) => t.status === 'pending').length,
    approved: transfers.filter((t) => t.status === 'approved').length,
  };

  const statusVal = filter.values.status;
  const activeStatusTab: string = Array.isArray(statusVal)
    ? (statusVal.length === 1 ? statusVal[0] : 'all')
    : (statusVal || 'all');
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
  const listSearchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => listSearchRef.current?.focus?.() }, !screen);
  const routeVal = filter.values.route;

  const list = (
    <ListPage
      icon={<SwapOutlined />}
      title="اذن تحويل مخازن" muted="(تحويلات ومناقلات المخزون)"
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
          rowClassName={(r: any) => [
            r.__isDraft ? 'row-draft' : '',
            listKb.tableProps.rowClassName?.(r) ?? '',
          ].filter(Boolean).join(' ')}
          onRow={(r: any) => {
            const base = (listKb.tableProps.onRow?.(r) ?? {}) as any;
            if (!r.__isDraft) return base;
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

  const urlDoc = Number(searchParams.get('doc') || searchParams.get('edit')) || null;
  const opening = !createVisible && (docFetching || (urlDoc != null
    && urlDoc !== docInUrl.current && urlDoc !== closedDocRef.current && onScreen));

  return (
    <div style={{ height: '100%' }}>
      {dialogs}
      {doors}
      {screen ?? (opening ? <DocOpening /> : list)}
    </div>
  );
}

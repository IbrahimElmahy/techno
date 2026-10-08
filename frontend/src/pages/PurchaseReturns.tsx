import React, { useEffect, useMemo, useRef, useState } from 'react';
import DraftTag from '../components/DraftTag';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, Modal, Row,
  Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import { advanceFrom, useQtyFocus } from '../components/lineKeyboard';
import {
  ArrowLeftOutlined, ArrowRightOutlined, BankOutlined, CheckOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, FileAddOutlined, PhoneOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined,
  SaveOutlined, SearchOutlined, UndoOutlined, ExclamationCircleOutlined,
  RollbackOutlined, ClearOutlined, DownOutlined, UpOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useDocRoute } from '../components/useDocRoute';
import DocOpening from '../components/DocOpening';
import { useDraft } from '../components/useDraft';
import { DocRef } from '../components/DocumentLink';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import ExportExcelButton from '../components/ExportExcelButton';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
import { guardQuantity } from '../components/quantityGuard';
import { useListFilter } from '../components/ListToolbar';
import ListPage from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { matchesStatement, statementMeta, statementText } from '../utils/statements';
import { useLookup, labelMap } from '../hooks/useLookup';
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice }
  from '../components/InvoiceDocument';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import PartyPickerModal from '../components/PartyPickerModal';
import DocumentBar from '../components/DocumentBar';
import LoadPeriodModal from '../components/LoadPeriodModal';
import QuickAddRow from '../components/QuickAddRow';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import DocumentHistoryButton from '../components/DocumentHistory';
import SummaryTile from '../components/saleDoc/SummaryTile';
import DocumentAttachments from '../components/DocumentAttachments';
import ProductPickerModal from '../components/ProductPickerModal';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import dayjs, { Dayjs } from 'dayjs';
import { TabModal } from '../components/TabModal';
import { money, numeralsLocale } from '../utils/money';
import { convertUnitPrice, factorOf, unitSelectOptions } from '../utils/units';
import { applyPct, combinePct, splitLineDiscount } from '../utils/discounts';
import { QTY_DATA_ATTR } from '../utils/duplicateItem';
import { addPickedSequentially, type PickResult } from '../utils/pickMany';
import { useLiveRefresh } from '../utils/live';
import { activeChoices, activeOptions, withInactiveTag } from '../utils/active';

interface ReturnRow {
  return_date?: string | null;
  notes?: string | null;
  id: number;
  document_number: string;
  purchase_invoice_id: number;
  purchase_document_number: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  value: string;
  created_at: string;
  statement1?: string | null;
  statement2?: string | null;
  statement3?: string | null;
  external_document_number?: string | null;
}

interface PurchaseLine {
  item_id: number; quantity: string; unit_price: string; line_total: string; unit: string | null;
}

export default function PurchaseReturns({ embedded }: { embedded?: { onExit: () => void } } = {}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWriteReturn = can('return.write');
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlight, setHighlight] = useState<number | null>(null);
  const pendingDoc = useRef<number | null>(null);
  const pendingEdit = useRef(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);

  const [creating, setCreating] = useState(false);
  const [newStep, setNewStep] = useState<null | 'party'>(embedded ? 'party' : null);
  const [externalNumber, setExternalNumber] = useState('');
  const [statements, setStatements] = useState<string[]>(['', '', '']);
  const [variableDiscount, setVariableDiscount] = useState(0);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);

  const [supplierFilter, setSupplierFilter] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<number[]>([]);
  const [pendingWarehouse, setPendingWarehouse] = useState<number | null>(null);
  const pendingQtys = useRef<Record<number, number>>({});
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  interface ReturnLineDraft {
    key: string;
    item_id: number;
    quantity: number | null;
    unit_price: number;
    discount_pct: number | null;
    fixed_discount_pct: number | null;
    unit: string | null;
    warehouse_id: number | null;
  }
  const [returnLines, setReturnLines] = useState<ReturnLineDraft[]>([]);
  const [returnDate, setReturnDate] = useState<Dayjs>(dayjs());
  const [notes, setNotes] = useState('');
  const [purchaseId, setPurchaseId] = useState<number | undefined>();
  const [viewOnly, setViewOnly] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [viewing, setViewing] = useState<any>(null);
  const [loadPeriodOpen, setLoadPeriodOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [qty, setQty] = useState<Record<number, number | null>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, p, i, w] = await Promise.all([
        api.get('/api/v1/purchases/returns'),
        api.get('/api/v1/purchases'),
        api.get('/api/v1/items'),
        api.get('/api/v1/warehouses').catch(() => ({ data: [] })),
      ]);
      setRows(r.data || []); setPurchases(p.data || []); setItems(i.data || []);
      setWarehouses(w.data || []);
    } catch {
      message.error('تعذر تحميل مردودات الشراء');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useLiveRefresh(['purchases'], () => {
    Promise.all([api.get('/api/v1/purchases/returns'), api.get('/api/v1/purchases')])
      .then(([r, p]) => { setRows(r.data || []); setPurchases(p.data || []); })
      .catch(() => {});
  });

  const [editingId, setEditingId] = useState<number | null>(null);

  const { markOpen, markClosed, opening: docOpening } = useDocRoute<ReturnRow>({
    rows,
    openId: editingId,
    open: (row, mode) => { if (mode === 'edit') editPosted(row); else openReturn(row); },
    close: () => closeDoc(),
    loading,
    fetchOne: async (id) => ({ id } as ReturnRow),
    enabled: !embedded,
  });

  const draftPayload = useMemo(() => ({
    supplier_id: supplierFilter,
    return_date: returnDate ? dayjs(returnDate).format('YYYY-MM-DD') : null,
    lines: returnLines,
    warehouseId,
    notes,
    externalNumber,
    statements,
    variableDiscount,
  }), [supplierFilter, returnDate, returnLines, warehouseId, notes,
       externalNumber, statements, variableDiscount]);

  const {
    drafts, savedAt: draftSavedAt, discard: discardDraft,
    remove: removeDraft, adopt: adoptDraft,
  } = useDraft({
    kind: 'purchase_return',
    payload: draftPayload,
    paused: Boolean(viewing || editingId),
    isEmpty: (x: any) => !x.supplier_id
      && !(x.lines || []).some((l: any) => l.item_id != null),
    title: (x: any) => {
      const n = (x.lines || []).filter((l: any) => l.item_id != null).length;
      return `مردود شرا — ${n} صنف`;
    },
  });

  const resumeDraft = (d: any) => {
    const x = d.payload || {};
    adoptDraft(d.id);
    setViewing(null);
    setEditingId(null);
    setViewOnly(false);
    setNewStep(null);
    setCreating(true);
    setSupplierFilter(x.supplier_id ?? null);
    if (x.return_date) setReturnDate(dayjs(x.return_date));
    setReturnLines(x.lines || []);
    setWarehouseId(x.warehouseId ?? null);
    setNotes(x.notes || '');
    setExternalNumber(x.externalNumber || '');
    setStatements(x.statements?.length === 3 ? x.statements : ['', '', '']);
    setVariableDiscount(Number(x.variableDiscount) || 0);
  };

  const closeDoc = () => {
    setCreating(false);
    setEditingId(null);
    setViewOnly(false);
    setViewing(null);
    markClosed();
  };

  const returnedByPurchase = useMemo(() => {
    const m: Record<number, number> = {};
    rows.forEach((r) => {
      m[r.purchase_invoice_id] = (m[r.purchase_invoice_id] || 0) + Number(r.value || 0);
    });
    return m;
  }, [rows]);

  const itemName = (id: number) => items.find((i) => i.id === id)?.name ?? `صنف #${id}`;

  const openReturn = async (row: ReturnRow) => {
    markOpen(row.id);
    setViewLoading(true);
    try {
      const res = await api.get(`/api/v1/purchases/returns/${row.id}`);
      const doc = res.data;
      setViewing(doc);
      setEditingId(doc.id);
      setReturnDate(doc.return_date ? dayjs(doc.return_date) : dayjs());
      setNotes(doc.notes || '');
      setSupplierFilter(doc.supplier_id ?? null);
      const firstWh = (doc.lines || [])[0]?.warehouse_id ?? null;
      setWarehouseId(doc.location?.location_id ?? firstWh);
      setExternalNumber(doc.external_document_number || '');
      setStatements([doc.statement1 || '', doc.statement2 || '', doc.statement3 || '']);
      setVariableDiscount(Number(doc.variable_discount_pct || 0));
      setReturnLines((doc.lines || []).map((l: any, i: number) => ({
        key: `${Date.now()}-${i}-${l.item_id}`,
        item_id: l.item_id,
        quantity: Number(l.quantity) || null,
        unit_price: Number(l.unit_price) || 0,
        ...splitLineDiscount(l),
        unit: l.unit || null,
        warehouse_id: l.warehouse_id ?? null,
      })));
      setViewOnly(true);
      setCreating(true);
    } catch {
      message.error('تعذر فتح المردود');
    } finally { setViewLoading(false); }
  };

  const [printing, setPrinting] = useState(false);
  const [printOpts, setPrintOpts] = useState<PrintOptions>(loadPrintOptions);

  const editPosted = async (row: ReturnRow) => {
    await openReturn(row);
    markOpen(row.id, 'edit');
    setViewOnly(false);
    message.info('مردود الشراء مفتوح الآن للتعديل');
  };

  const openCreate = () => {
    setPurchaseId(undefined); setDetail(null); setQty({});
    setReturnDate(dayjs()); setNotes(''); setCreating(false); setNewStep('party');
    setEditingId(null); setSupplierFilter(null); setViewing(null); setViewOnly(false);
    markClosed({ stay: true });
    setReturnLines([]); setWarehouseId(null);
    setExternalNumber(''); setStatements(['', '', '']);
    setVariableDiscount(0);
  };

  const choosePurchase = async (id: number) => {
    setPurchaseId(id); setQty({});
    try {
      const res = await api.get(`/api/v1/purchases/${id}`);
      setDetail(res.data);
    } catch {
      message.error('تعذر فتح فاتورة الشراء');
      setDetail(null);
    }
  };

  const returnToolbar = (): ToolbarAction[] => {
    const typed = returnLines.filter((l) => l.item_id && Number(l.quantity || 0) > 0).length;
    const isSaved = Boolean(editingId && viewing);
    const stepList = (step: number) => {
      if (!filter.filtered.length) return;
      const at = filter.filtered.findIndex((r) => r.id === editingId);
      const target = at >= 0 ? filter.filtered[at + step]
        : (step > 0 ? filter.filtered[0] : filter.filtered[filter.filtered.length - 1]);
      if (target) {
        openReturn(target);
      }
    };
    return [
      {
        key: 'new',
        label: 'جديد',
        shortcut: 'F2',
        primary: true,
        icon: <FileAddOutlined />,
        onClick: () => openCreate(),
      },
      {
        key: 'edit',
        label: 'تعديل',
        icon: <EditOutlined />,
        disabled: !isSaved || !viewOnly,
        onClick: () => {
          setViewOnly(false);
          message.info('مردود الشراء مفتوح الآن للتعديل');
        },
      },
      {
        key: 'undo',
        label: 'تراجع',
        icon: <UndoOutlined />,
        onClick: () => {
          if (!viewOnly && editingId) {
            openReturn({ id: editingId } as ReturnRow);
          } else if (returnLines.length > 0) {
            closeDoc();
          } else {
            setReturnLines([]);
          }
        },
      },
      {
        key: 'save',
        label: 'حفظ',
        shortcut: 'F9',
        icon: <SaveOutlined />,
        disabled: viewOnly || typed === 0,
        onClick: () => {
          submit();
        },
      },
      {
        key: 'search',
        label: 'بحث',
        shortcut: 'F3',
        icon: <SearchOutlined />,
        onClick: () => {
          if (viewOnly) {
            setCreating(false);
            setViewOnly(false);
            setViewing(null);
          } else {
            setPickerOpen(true);
          }
        },
      },
      {
        key: 'prev',
        label: 'السابق',
        icon: <ArrowRightOutlined />,
        disabled: filter.filtered.length === 0,
        onClick: () => stepList(-1),
      },
      {
        key: 'next',
        label: 'التالى',
        icon: <ArrowLeftOutlined />,
        disabled: filter.filtered.length === 0,
        onClick: () => stepList(1),
      },
      {
        key: 'delete',
        label: 'حذف',
        shortcut: 'F8',
        icon: <DeleteOutlined />,
        danger: true,
        disabled: isSaved ? false : typed === 0,
        onClick: () => {
          if (isSaved && viewing) {
            Modal.confirm({
              title: 'تأكيد حذف مردود الشراء',
              icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
              content: `هل أنت متأكد من حذف سند مردود الشراء رقم (${viewing.document_number || ''})؟`,
              okText: 'نعم، احذف',
              okType: 'danger',
              cancelText: 'إلغاء',
              onOk: async () => {
                try {
                  await api.delete(`/api/v1/purchases/returns/${viewing.id}`);
                  message.success('تم حذف مردود الشراء بنجاح');
                  setCreating(false);
                  setViewOnly(false);
                  setViewing(null);
                  load();
                } catch (err: any) {
                  message.error(err?.response?.data?.detail?.message || 'تعذر حذف مردود الشراء');
                }
              },
            });
          } else {
            setReturnLines([]);
          }
        },
      },
      {
        key: 'print',
        label: 'طباعة',
        shortcut: 'F7',
        icon: <PrinterOutlined />,
        disabled: !isSaved || printing,
        onClick: async () => {
          setPrinting(true);
          try {
            const doc = returnDoc(viewing);
            if (doc) printInvoice(doc, printOpts);
          } catch (err: any) {
            message.error(err?.response?.data?.detail?.message || 'تعذر طباعة المردود');
          } finally {
            setPrinting(false);
          }
        },
      },
      {
        key: 'accounts',
        label: 'حسابات',
        icon: <BankOutlined />,
        disabled: !supplierFilter,
        onClick: () => supplierFilter && navigate(`/suppliers/${supplierFilter}`),
      },
      {
        key: 'reload',
        label: 'تحميل',
        icon: <ReloadOutlined />,
        onClick: () => setLoadPeriodOpen(true),
      },
    ];
  };

  const [unitsCache, setUnitsCache] = useState<Record<number, any[]>>({});
  const unitsRequestedRef = useRef<Set<number>>(new Set());
  const fetchUnits = async (itemId: number) => {
    if (unitsCache[itemId] || unitsRequestedRef.current.has(itemId)) return;
    unitsRequestedRef.current.add(itemId);
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({
        name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
    } catch {
      unitsRequestedRef.current.delete(itemId);
    }
  };
  useEffect(() => {
    returnLines.forEach((l) => { if (l.item_id) fetchUnits(l.item_id); });
  }, [returnLines]); // eslint-disable-line react-hooks/exhaustive-deps
  const unitOptions = (itemId: number | null) => unitSelectOptions(unitsCache[itemId || 0]);

  const lineNet = (l: ReturnLineDraft) =>
    applyPct(Number(l.quantity || 0) * (l.unit_price || 0),
             l.fixed_discount_pct, l.discount_pct);
  const grossTotal = returnLines.reduce((n, l) => n + lineNet(l), 0);

  const [onHand, setOnHand] = useState<Record<number, number>>({});
  const [availability, setAvailability] = useState<Record<number, Record<number, number>>>({});

  const loadWarehouseStock = async (wh: number) => {
    if (!wh) return;
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: {
          location_kind: 'warehouse', location_id: wh, only_available: false,
          ...(editingId ? { exclude_doc_type: 'purchase_return', exclude_doc_id: editingId } : {}),
        },
      });
      const map: Record<number, number> = {};
      (res.data || []).forEach((r: any) => { map[r.item_id] = Number(r.on_hand || 0); });
      setAvailability((prev) => ({ ...prev, [wh]: map }));
      setOnHand(map);
    } catch (err) { console.error(err); }
  };

  const fetchOnHand = async (_itemId: number, wh: number) => {
    if (wh) await loadWarehouseStock(wh);
  };

  useEffect(() => {
    if (warehouseId) {
      loadWarehouseStock(warehouseId);
    }
  }, [warehouseId, pickerOpen, editingId]);

  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);

  const itemCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i: any) => { if (i.category) set.add(i.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [items]);

  const linesByCategory = useMemo(
    () => (returnLines.length ? [{ category: null as string | null, items: returnLines as ReturnLineDraft[] }] : []),
    [returnLines]);

  const addReturnLine = async (itemId: number, qty: number | null = null): Promise<PickResult> => {
    if (!itemId) return null;
    if (warehouseId === null) {
      if (qty) pendingQtys.current[itemId] = qty;
      setPendingItems((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
      setPendingWarehouse((prev) => prev ?? warehouses[0]?.id ?? null);
      return null;
    }
    return addReturnLineWith(itemId, warehouseId, qty);
  };

  const pickedQty = (itemId: number, wh: number, q: number, previous: number | null) =>
    guardQuantity({
      value: q,
      available: availability[wh] ? availability[wh][itemId] : undefined,
      itemName: itemName(itemId),
    }, previous);

  useQtyFocus(focusLineKey, setFocusLineKey, pickerOpen, returnLines);
  const advance = advanceFrom(returnLines, setFocusLineKey, () => setPickerOpen(true));

  const addReturnLineWith = async (
    itemId: number, wh: number, qty: number | null = null,
  ): Promise<PickResult> => {
    const product = items.find((i: any) => i.id === itemId) as any;
    let price = product?.purchase_price ? parseFloat(product.purchase_price) : 0;
    let disc: number | null = null;
    try {
      const r = await api.get(`/api/v1/items/${itemId}/return-price`);
      if (Number(r.data?.unit_price) > 0) price = Number(r.data.unit_price);
      if (Number(r.data?.discount_pct) > 0) disc = Number(r.data.discount_pct);
    } catch {}
    const dup = returnLines.find((l) => l.item_id === itemId);
    if (dup) {
      if (qty) {
        const lineWh = dup.warehouse_id ?? wh;
        const total = pickedQty(itemId, lineWh, Number(dup.quantity || 0) + qty, dup.quantity);
        setReturnLines((prev) => prev.map((l) => (l.key === dup.key ? { ...l, quantity: total } : l)));
        message.info(`«${itemName(itemId)}» موجود بالفعل — اتزوّدت كميته`);
      } else {
        message.info(`«${itemName(itemId)}» موجود بالفعل — عدّل الكمية من السطر`);
      }
      return { dup: itemId };
    }
    const key = `${Date.now()}-${itemId}`;
    const quantity = qty ? pickedQty(itemId, wh, qty, null) : null;
    let landed = true;
    setReturnLines((prev) => {
      const existing = prev.find((l) => l.item_id === itemId);
      if (existing) {
        landed = false;
        return prev;
      }
      return [...prev, {
        key, item_id: itemId, quantity, unit_price: price,
        discount_pct: null, fixed_discount_pct: disc, unit: null,
        warehouse_id: wh,
      }];
    });
    fetchOnHand(itemId, wh);
    fetchUnits(itemId);
    return landed && quantity == null ? { needsQty: key } : null;
  };

  const lineColumns: EntryColumn<ReturnLineDraft>[] = [
    { key: 'idx', title: '#', width: 32, locked: true,
      cellStyle: { color: '#6b6b6b', textAlign: 'center' }, cell: (_l, i) => i + 1 },
    { key: 'warehouse', title: 'المخزن', width: 130,
      cell: (line) => (
        <Select showSearch size="small" style={{ width: '100%' }} placeholder="المخزن"
          disabled={viewOnly}
          value={line.warehouse_id ?? warehouseId ?? undefined}
          onChange={(v) => {
            setReturnLines((prev) => prev.map((l) => (
              l.key === line.key ? { ...l, warehouse_id: v ?? null } : l)));
            if (v != null) setWarehouseId(v as number);
          }}
          options={sortByName(activeChoices(warehouses, [line.warehouse_id, warehouseId]),
            (w: any) => w.name).map((w: any) => ({
            value: w.id,
            label: withInactiveTag(`${w.name} (${w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})`, w),
          }))} filterOption={searchFilter} filterSort={searchRank} />
      ) },
    { key: 'item', title: 'الصنف', width: 210, minWidth: 120, locked: true,
      cell: (line) => {
        const name = line.item_id ? itemName(line.item_id) : 'اختر الصنف';
        return <b className="eg-ellipsis" title={name} style={{ fontSize: 15 }}>{name}</b>;
      } },
    { key: 'unit', title: 'الوحدة', width: 80,
      cell: (line) => (
        <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
          disabled={viewOnly}
          value={line.unit ?? '__base__'}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => {
            if (l.key !== line.key) return l;
            const unit = v === '__base__' ? null : v;
            const units = unitsCache[l.item_id || 0];
            return { ...l, unit, unit_price: convertUnitPrice(l.unit_price || 0,
              factorOf(units, l.unit), factorOf(units, unit)) };
          }))}
          options={unitOptions(line.item_id)} />
      ) },
    { key: 'qty', title: 'الكمية', width: 90, locked: true,
      cellProps: (line) => ({ [QTY_DATA_ATTR]: line.item_id } as any),
      cell: (line) => (
        <InputNumber size="small" style={{ width: '100%' }} min={0.001}
          disabled={viewOnly}
          data-qty-key={line.key} data-grid-col="qty" keyboard={false}
          placeholder="الكمية" value={line.quantity ?? undefined}
          onPressEnter={(e) => { e.preventDefault(); advance(line.key); }}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, quantity: v as number | null } : l)))}
          onBlur={() => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, quantity: guardQuantity({
              value: l.quantity,
              available: warehouseId ? onHand[l.item_id] : undefined,
              itemName: itemName(l.item_id),
            }, null) } : l)))} />
      ),
      footer: (rows) => rows.reduce((n, l) => n + Number(l.quantity || 0), 0) },
    { key: 'price', title: 'سعر الوحدة', width: 100,
      cell: (line) => (
        <InputNumber size="small" style={{ width: '100%' }} min={0} step={0.01}
          disabled={viewOnly}
          onPressEnter={(e) => { e.preventDefault(); advance(line.key); }}
          placeholder="السعر" value={line.unit_price}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, unit_price: (v as number) || 0 } : l)))} />
      ),
      footer: () => null },
    { key: 'gross', title: 'اجمالي قبل', width: 100,
      cellStyle: { whiteSpace: 'nowrap' },
      cell: (line) => money(Number(line.quantity || 0) * (line.unit_price || 0)),
      footer: (rows) => money(rows.reduce(
        (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0)) },
    { key: 'disc_var', title: 'خصم متغير %', width: 70,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="متغير" value={line.discount_pct ?? undefined}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, discount_pct: (v as number) ?? null } : l)))} />
      ),
      footer: () => null },
    { key: 'disc_fixed', title: 'خصم ثابت %', width: 70,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="ثابت" value={line.fixed_discount_pct ?? undefined}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, fixed_discount_pct: (v as number) ?? null } : l)))} />
      ),
      footer: () => null },
    { key: 'total', title: 'الإجمالي', width: 110, locked: true,
      cellStyle: { fontWeight: 700, whiteSpace: 'nowrap' },
      cell: (line) => money(lineNet(line)),
      footer: (rows) => money(rows.reduce((n, l) => n + lineNet(l), 0)) },
    { key: 'actions', title: '', label: 'حذف السطر', width: 50, minWidth: 40, locked: true,
      cell: (line) => (viewOnly ? null : (
        <Button size="small" danger type="text" icon={<DeleteOutlined />}
          onClick={() => setReturnLines((prev) => prev.filter((l) => l.key !== line.key))} />
      )),
      footer: () => null },
  ];
  const lineGrid = useEntryGrid('purchase-return-lines', lineColumns);

  const draftValue = useMemo(
    () => grossTotal * (1 - (variableDiscount || 0) / 100),
    [grossTotal, variableDiscount],
  );

  const submit = async () => {
    if (!supplierFilter) { message.warning('اختر المورد أولاً'); return; }
    if (!warehouseId) { message.warning('اختر المخزن الذي ترتجع منه البضاعة'); return; }
    const lines = returnLines
      .filter((l) => l.item_id && Number(l.quantity || 0) > 0)
      .map((l) => ({
        item_id: l.item_id,
        quantity: String(l.quantity),
        unit_price: String(l.unit_price || 0),
        discount_pct: combinePct(l.fixed_discount_pct, l.discount_pct) || null,
        fixed_discount_pct: l.fixed_discount_pct ?? null,
        variable_discount_pct: l.discount_pct ?? null,
        unit: l.unit,
        warehouse_id: l.warehouse_id ?? warehouseId,
      }));
    if (!lines.length) { message.warning('اكتب الكمية المرتجعة على صنف واحد على الأقل'); return; }
    setSaving(true);
    try {
      const body = {
        supplier_id: supplierFilter,
        location: { location_kind: 'warehouse', location_id: warehouseId },
        lines,
        return_date: returnDate.format('YYYY-MM-DD'),
        notes: notes || null,
        expense_account_id: null,
        variable_discount_pct: variableDiscount || 0,
        external_document_number: externalNumber || null,
        statement1: statements[0] || null,
        statement2: statements[1] || null,
        statement3: statements[2] || null,
      };
      if (editingId !== null) await api.put(`/api/v1/purchases/returns/${editingId}`, body);
      else await api.post('/api/v1/purchases/returns', body);
      message.success(editingId !== null ? 'تم حفظ المردود' : 'تم تسجيل مردود الشراء');
      discardDraft();
      setEditingId(null);
      setReturnLines([]);
      setCreating(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل المردود');
    } finally { setSaving(false); }
  };

  const columns = [
    {
      title: 'رقم', dataIndex: 'id', key: 'id', width: 80,
      ...numberColumn<ReturnRow>((r) => r.id),
      render: (id: number) => <span style={{ color: '#6b6b6b' }}>{id}</span>,
    },
    {
      title: 'التاريخ', dataIndex: 'return_date', key: 'return_date', width: 130,
      ...dateColumn<ReturnRow>((r) => r.return_date || r.created_at),
      defaultSortOrder: 'descend' as const,
      render: (v: string | null, r: ReturnRow) => (v ? String(v).slice(0, 10) : (
        <span style={{ color: '#6b6b6b' }} title="مردود قديم — التاريخ ده يوم التسجيل">
          {r.created_at ? `${String(r.created_at).slice(0, 10)}*` : '-'}
        </span>
      )),
    },
    {
      title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', ellipsis: true, width: 140,
      ...textColumn(rows, (r: ReturnRow) => r.document_number),
      render: (d: string, r: any) => (r.__isDraft
        ? <DraftTag onDelete={() => removeDraft(r.__draft.id)} />
        : <Tag color="volcano">{d}</Tag>),
    },
    {
      title: 'رقم المستند الورقي', dataIndex: 'external_document_number',
      key: 'external_document_number', ellipsis: true, width: 130,
      ...textColumn(rows, (r: ReturnRow) => r.external_document_number),
      render: (v: string | null) => v || '-',
    },
    {
      title: 'الفاتورة رقم', dataIndex: 'purchase_document_number', key: 'purchase_document_number',
      width: 140,
      ...textColumn(rows, (r: ReturnRow) => r.purchase_document_number),
      render: (v: string | null, r: ReturnRow) => (
        <DocRef kind="purchase" id={r.purchase_invoice_id} label={v} />
      ),
    },
    {
      title: 'جهه التعامل', dataIndex: 'supplier_name', key: 'supplier_name', ellipsis: true,
      ...textColumn(rows, (r: ReturnRow) => r.supplier_name),
      render: (v: string | null) => v ?? '-',
    },
    {
      title: 'القيمة', dataIndex: 'value', key: 'value', width: 140, align: 'left' as const,
      ...numberColumn<ReturnRow>((r) => r.value),
      render: (v: string) => <strong style={{ color: '#cf4b1a' }}>{money(v)}</strong>,
    },
    {
      title: 'ملاحظات', dataIndex: 'notes', key: 'notes', ellipsis: true,
      ...textColumn(rows, (r: ReturnRow) => r.notes),
      render: (v: string | null) => v || '-',
    },
    {
      title: 'البيان', dataIndex: 'statement1', key: 'statement1', ellipsis: true,
      ...textColumn(rows, (r: ReturnRow) => statementText(r)),
      render: (_: any, r: ReturnRow) => statementText(r) || '-',
    },
    {
      title: 'الإجراءات', key: 'actions', width: 140,
      render: (_: any, record: ReturnRow) => ((record as any).__isDraft ? (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="مسح المسودّة">
            <Button type="text" danger icon={<DeleteOutlined />}
              onClick={() => removeDraft((record as any).__draft.id)} />
          </Tooltip>
        </Space>
      ) : (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="عرض المردود">
            <Button type="text" icon={<EyeOutlined />}
              onClick={() => openReturn(record)} />
          </Tooltip>
          <Tooltip title="طباعة">
            <Button type="text" icon={<PrinterOutlined />}
              onClick={async () => {
                try {
                  const res = await api.get(`/api/v1/purchases/returns/${record.id}`);
                  const doc = returnDoc(res.data);
                  if (doc) printInvoice(doc, printOpts);
                } catch (err) {
                  message.error('تعذر تحميل بيانات الطباعة');
                }
              }} />
          </Tooltip>
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} disabled={!canWriteReturn}
              onClick={() => editPosted(record)} />
          </Tooltip>
          <Tooltip title="حذف">
            <Button type="text" danger icon={<DeleteOutlined />} disabled={!canWriteReturn}
              onClick={() => {
                Modal.confirm({
                  title: 'تأكيد حذف مردود الشراء',
                  icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
                  content: `هل أنت متأكد من حذف سند مردود الشراء رقم (${record.document_number || ''})؟`,
                  okText: 'نعم، احذف',
                  okType: 'danger',
                  cancelText: 'إلغاء',
                  onOk: async () => {
                    try {
                      await api.delete(`/api/v1/purchases/returns/${record.id}`);
                      message.success('تم حذف مردود الشراء بنجاح');
                      load();
                    } catch (err: any) {
                      message.error(err?.response?.data?.detail?.message || 'تعذر حذف مردود الشراء');
                    }
                  },
                });
              }} />
          </Tooltip>
        </Space>
      )),
    },
  ];

  const returnDoc = (r: any): InvoiceDoc | null => {
    if (!r) return null;
    return {
      kind: 'purchase',
      document_number: r.document_number,
      date: r.return_date || String(r.created_at || '').slice(0, 10),
      partyLabel: 'المورد',
      partyName: r.supplier_name || '-',
      lines: (r.lines || []).map((l: any) => ({
        name: l.item_name || itemName(l.item_id),
        quantity: l.quantity,
        unit: l.unit ?? null,
        unit_price: l.unit_price ?? 0,
        line_total: l.line_total ?? 0,
      })),
      gross: r.value,
      net: r.value,
      cash: 0,
      credit: 0,
      extraMeta: [
        ['فاتورة الشراء', r.purchase_document_number || '-'],
        ...(r.notes ? ([['ملاحظات', r.notes]] as [string, string][]) : []),
        ...statementMeta(r),
      ],
    };
  };

  const cols = useHiddenColumns('purchase-returns-list', ['id']);
  const visibleColumns = cols.apply(columns);

  const filter = useListFilter<ReturnRow>(rows, {
    search: (r) => [r.document_number, r.purchase_document_number, r.supplier_name,
      r.value, r.notes, r.statement1, r.statement2, r.statement3, r.external_document_number],
    filters: {
      supplier_id: (r, v) => r.supplier_id === v,
      document_number: (r, v) => (r.document_number || '').includes(String(v)),
      purchase_document_number: (r, v) => (r.purchase_document_number || '')
        .toLowerCase().includes(String(v).toLowerCase()),
      notes: (r, v) => (r.notes || '').toLowerCase().includes(String(v).toLowerCase()),
      statement: (r, v) => matchesStatement(r, v),
    },
    dateOf: (r) => r.return_date || r.created_at,
  });

  const [pickedSupplier, setPickedSupplier] = useState<{ value: number; label: string } | null>(null);
  const [supplierPhone, setSupplierPhone] = useState('');
  useEffect(() => {
    if (!supplierFilter) { setSupplierPhone(''); return; }
    api.get(`/api/v1/suppliers/${supplierFilter}`)
      .then((r) => setSupplierPhone(r.data?.phone || ''))
      .catch(() => setSupplierPhone(''));
  }, [supplierFilter]);
  const suppliers = useMemo(() => {
    const seen = new Map<number, string>();
    rows.forEach((r) => { if (r.supplier_id) seen.set(r.supplier_id, r.supplier_name || ''); });
    if (pickedSupplier && !seen.has(pickedSupplier.value)) {
      seen.set(pickedSupplier.value, pickedSupplier.label);
    }
    return sortByName([...seen].map(([value, label]) => ({ value, label })), (o) => o.label);
  }, [rows, pickedSupplier]);

  const kb = useTableKeyboard<ReturnRow>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: openReturn,
  });

  const listSearchRef = useRef<any>(null);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  useScreenShortcuts({ onSearch: () => { listSearchRef.current?.focus?.(); } }, !creating);

  const docOpen = creating;

  const neighbourReturn = (step: number) => {
    if (!viewing) return null;
    const at = filter.filtered.findIndex((r) => r.id === viewing.id);
    if (at < 0) return null;
    return filter.filtered[at + step] ?? null;
  };
  const prevReturn = neighbourReturn(-1);
  const nextReturn = neighbourReturn(1);

  const moreActive = ['document_number', 'purchase_document_number', 'notes', 'statement']
    .some((k) => !!filter.values[k]);
  const moreOpen = showMoreFilters || moreActive;
  const textFilter = (key: string, placeholder: string) => (
    <Input key={key} allowClear placeholder={placeholder}
      value={filter.values[key] ?? undefined}
      onChange={(e) => filter.setValue(key, e.target.value || undefined)} />
  );
  const shownTotal = filter.filtered.reduce((n, r) => n + Number(r.value || 0), 0);
  const listFooter = (
    <span className="sl-foot">
      <span>
        إجمالي السجلات: <b>{filter.filtered.length.toLocaleString(numeralsLocale())}</b>
        {filter.filtered.length < rows.length
          && <> من {rows.length.toLocaleString(numeralsLocale())}</>} مردود
      </span>
      <span>قيمة المردودات المعروضة: <b>{money(shownTotal)}</b></span>
    </span>
  );

  const onExit = embedded?.onExit;
  useEffect(() => {
    if (onExit && !creating && !newStep) onExit();
  }, [onExit, creating, newStep]);

  if (docOpening) return <DocOpening />;
  return (
    <div className={docOpen ? 'sale-doc' : undefined}>
      {!docOpen && !embedded && (
      <ListPage
        icon={<RollbackOutlined />}
        title="مردودات الشراء" muted="(سجل المردودات للموردين)"
        subtitle="البضاعة الراجعة للموردين — بتقلّل المستحق عليهم بقيمتها"
        actions={(<>
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
            onClick={openCreate}>
            تسجيل مردود شراء
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
          <ExportExcelButton
            name="مردودات الشراء"
            rows={filter.filtered}
            tableColumns={visibleColumns}
            style={{ marginInlineStart: 0 }}
          />
          <ColumnSettings
            choices={columns.map((c: any) => ({
              key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
              locked: c.key === 'document_number',
            }))}
            hidden={cols.hidden} onChange={cols.setHidden}
            order={cols.order} onMove={(k, d) => cols.move(k, d, columns.map((c) => String(c.key ?? (c as any).dataIndex ?? '')))}
          />
        </>)}
        filters={(<>
          <Input
            className="sl-f-search"
            allowClear
            ref={listSearchRef}
            value={filter.query}
            placeholder="بحث برقم السند أو الفاتورة أو المورد أو البيان"
            prefix={<SearchOutlined />}
            onChange={(e) => filter.setQuery(e.target.value)}
          />
          <Select className="sl-f-customer" allowClear showSearch mode="multiple"
            maxTagCount="responsive" placeholder="جميع الموردين"
            value={filter.values.supplier_id ?? undefined}
            onChange={(v: any[]) => filter.setValue('supplier_id', v?.length ? v : undefined)}
            filterOption={searchFilter} filterSort={searchRank}
            options={suppliers} />
          <DateRangeFilter className="sl-f-dates"
            value={filter.range ?? null}
            onChange={(v) => filter.setRange(v)} />
          {moreOpen && (<>
            {textFilter('document_number', 'رقم السند')}
            {textFilter('purchase_document_number', 'الفاتورة رقم')}
            {textFilter('notes', 'ملاحظات')}
            {textFilter('statement', 'البيان')}
          </>)}
          <Button className="sl-f-clear" type="link"
            icon={moreOpen ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setShowMoreFilters((v) => !v)}>
            فلاتر أكثر
          </Button>
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </>)}
      >
        <Table
          {...kb.tableProps}
          dataSource={[
            ...(drafts || []).map((d: any) => {
              const x = d.payload || {};
              const ls = (x.lines || []).filter((l: any) => l.item_id != null);
              const value = ls.reduce((t: number, l: any) =>
                t + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
              return {
                id: -d.id, __draft: d, __isDraft: true,
                document_number: 'مسودّة',
                created_at: d.updated_at,
                return_date: String(x.return_date || d.updated_at || '').slice(0, 10),
                supplier_id: x.supplier_id ?? null,
                value,
              } as any;
            }),
            ...filter.filtered,
          ]}
          columns={visibleColumns} rowKey="id" loading={loading}
          className="sl-table" size="small" tableLayout="fixed"
          rowClassName={(r: any) => [
            r.__isDraft ? 'row-draft' : '',
            r.id === highlight ? 'row-arrived' : '', kb.rowClassName(r),
          ].filter(Boolean).join(' ')}
          onRow={(r: any) => {
            const base = (kb.tableProps.onRow?.(r) ?? {}) as any;
            if (!r.__isDraft) return base;
            return {
              ...base,
              onClick: () => resumeDraft(r.__draft),
              style: { ...(base.style || {}), cursor: 'pointer' },
            };
          }}
          summary={(shown) => {
            const list = shown as readonly ReturnRow[];
            if (!list.length) return null;
            const total = list.reduce((n, r) => n + Number(r.value || 0), 0);
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: '#fff7f0', fontWeight: 700 }}>
                  {(visibleColumns as any[]).map((col, i) => {
                    const key = String(col.key ?? col.dataIndex ?? i);
                    return (
                      <Table.Summary.Cell key={key} index={i}
                        align={key === 'value' ? ('left' as const) : undefined}>
                        {i === 0 ? `${list.length} مردود`
                          : key === 'value' ? `${money(total)}` : ''}
                      </Table.Summary.Cell>
                    );
                  })}
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
          pagination={{
            defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
            locale: { items_per_page: '' },
            showTotal: () => listFooter,
          }}
        />
      </ListPage>
      )}

      <TabModal
        open={pendingItems.length > 0}
        title={pendingItems.length > 1
          ? `الأصناف دي (${pendingItems.length}) خارجة من أنهي مخزن؟`
          : 'البضاعة خارجة من أنهي مخزن؟'}
        okText="تمام" cancelText="إلغاء"
        okButtonProps={{ disabled: pendingWarehouse === null }}
        onCancel={() => { pendingQtys.current = {}; setPendingItems([]); }}
        onOk={async () => {
          const wh = pendingWarehouse;
          const queued = pendingItems;
          if (wh === null || queued.length === 0) return;
          const typed = pendingQtys.current;
          pendingQtys.current = {};
          setPendingItems([]);
          setWarehouseId(wh);
          await addPickedSequentially(queued, typed,
            (id, q) => addReturnLineWith(id, wh, q), setFocusLineKey);
        }}
        destroyOnHidden
      >
        <Select
          style={{ width: '100%' }} size="large" showSearch
          placeholder="اختر المخزن"
          value={pendingWarehouse ?? undefined}
          onChange={(v) => setPendingWarehouse(v as number)}
          options={activeOptions(sortByName(warehouses, (w: any) => w.name), pendingWarehouse)} filterOption={searchFilter} filterSort={searchRank}/>
        <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 15 }}>
          هيثبت لكل أصناف المردود. تقدر تغيّر مخزن أي سطر من عمود «المخزن».
        </div>
      </TabModal>

      <ProductPickerModal
        open={pickerOpen}
        title="اختر الصنف الراجع"
        categories={itemCategories}
        categoryLabels={categoryLabels}
        products={items as any}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        availableFor={(id) => (warehouseId && availability[warehouseId]
          ? (availability[warehouseId][id] ?? 0) : null)}
        availabilityVersion={`${warehouseId ?? ''}|${Object.keys(availability).join(',')}`}
        onCancel={() => setPickerOpen(false)}
        onPick={(id, q) => {
          setPickerOpen(false);
          addPickedSequentially([id], q ? { [id]: q } : undefined, addReturnLine, setFocusLineKey);
        }}
        onPickMany={(ids, qtys) => {
          setPickerOpen(false);
          addPickedSequentially(ids, qtys, addReturnLine, setFocusLineKey);
        }} />

      <PartyPickerModal contextLabel="مردود مشتريات"
        open={newStep === 'party' || partyPickerOpen} kind="supplier"
        kinds={['supplier', 'customer']}
        date={returnDate} onDateChange={(d) => setReturnDate(d)}
        onPick={(picked) => {
          setNewStep(null);
          setPartyPickerOpen(false);
          setSupplierFilter(picked.id);
          setPickedSupplier({ value: picked.id, label: picked.name });
          setCreating(true);
        }}
        onCancel={() => { setNewStep(null); setPartyPickerOpen(false); }} />

      <LoadPeriodModal
        open={loadPeriodOpen} onCancel={() => setLoadPeriodOpen(false)}
        title="تحميل مردودات شراء فترة" endpoint="/api/v1/purchases/returns"
        columns={[
          { title: 'المستند', key: 'document_number', width: 150 },
          { title: 'التاريخ', key: 'return_date', width: 120 },
          { title: 'المورد', key: 'supplier_name' },
          { title: 'القيمة', key: 'value', width: 130, money: true },
        ]}
        onLoaded={(loaded) => { setRows(loaded); filter.reset(); }}
        openNewest dateKey="return_date"
        onPick={(r) => openReturn(r)} />

      {creating && (
      <>
      <div className="sale-card sale-head">
        <div className="sale-head-row">
          <Button size="small" icon={<ArrowRightOutlined />}
            onClick={() => { setCreating(false); setViewOnly(false); setEditingId(null); setViewing(null); }}>رجوع</Button>
          <span className="sale-title">
            {viewing
              ? <>مردود شراء رقم: <b dir="ltr">{viewing.document_number || ''}</b></>
              : (editingId ? 'تعديل مردود شراء' : 'تسجيل مردود شراء جديد')}
          </span>
          {viewing && !viewOnly && (
            <Tag color="gold" style={{ fontWeight: 600, marginInlineEnd: 0 }}>وضع التعديل</Tag>
          )}
          <span className="sale-pager">
            <DocumentBar
              listLabel="مردودات الشراء"
              listTo="/purchase-returns"
              title={viewing
                ? (viewing.document_number || `#${viewing.id}`)
                : (editingId ? `تعديل #${editingId}` : 'مردود شراء جديد')}
              position={viewing
                ? filter.filtered.findIndex((r) => r.id === viewing.id) + 1 || null : null}
              total={viewing ? filter.filtered.length : null}
              onPrev={prevReturn ? () => openReturn(prevReturn) : undefined}
              onNext={nextReturn ? () => openReturn(nextReturn) : undefined}
              steps={[
                { key: 'draft', label: 'مسودة' },
                { key: 'posted', label: 'مرحّل', color: 'green' },
                { key: 'reversed', label: 'معكوس', color: 'volcano' },
              ]}
              current={!viewing && !editingId ? 'draft'
                : (viewing?.reversed_by ? 'reversed' : 'posted')}
              extra={(
                <DatePicker size="small" allowClear={false} format="YYYY-MM-DD"
                  disabled={viewOnly}
                  value={returnDate} onChange={(v: Dayjs | null) => v && setReturnDate(v)} />
              )}
            />
          </span>
          <div className="sale-toolbar-row">
            <DocumentToolbar actions={returnToolbar()} variant="buttons" />
            <DocumentHistoryButton entityType="purchase_return"
              entityId={editingId ?? viewing?.id}
              documentNumber={viewing?.document_number} />
            {lineGrid.control}
            <PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />
          </div>
        </div>
      </div>

        <Form layout="vertical" size="small" className="doc-form sale-form" requiredMark={false}>
          <div className="sale-card sale-fields">
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item label="رقم المستند">
                <Input placeholder="رقم إشعار المورد" disabled={viewOnly} value={externalNumber}
                  onChange={(e) => setExternalNumber(e.target.value)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8} className="sale-party">
              <Form.Item label={<>المورد <span style={{ color: '#ef4444' }}>*</span></>} required>
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  disabled={viewOnly}
                  placeholder="اضغط لاختيار المورد" value={supplierFilter ?? undefined}
                  onClick={() => { if (!viewOnly) setPartyPickerOpen(true); }}
                  options={suppliers} filterOption={searchFilter} filterSort={searchRank}/>
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="الهاتف">
                <Input readOnly disabled dir="ltr" placeholder="-"
                  suffix={<PhoneOutlined style={{ color: '#5b6575' }} />}
                  value={supplierPhone} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="ملاحظات">
                <Input placeholder="سبب الرجوع (مكسورة، ناقصة، غلط في الصنف…)"
                  disabled={viewOnly}
                  value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Form.Item>
            </Col>
            {([1, 2, 3] as const).map((n) => (
              <Col xs={24} md={8} key={n}>
                <Form.Item label={`بيان ${n}`}>
                  <Input placeholder="اختياري" disabled={viewOnly} value={statements[n - 1]}
                    onChange={(e) => setStatements((prev) => {
                      const next = [...prev]; next[n - 1] = e.target.value; return next;
                    })} />
                </Form.Item>
              </Col>
            ))}
          </Row>
          </div>

          <div className="sale-card sale-lines">
          <div className="sale-items-bar">
            <div className="sale-items-info">
              <span>
                عدد البنود الحالية: <b style={{ color: '#0f172a' }}>
                  {returnLines.filter((l) => l.item_id).length}</b> أصناف
              </span>
            </div>
            {!viewOnly && (
              <Button data-shortcut="F2"
                type="primary" className="sale-green-btn" icon={<PlusOutlined />}
                style={{ fontWeight: 700 }}
                onClick={() => setPickerOpen(true)}
              >
                إضافة صنف للمردود (F2)
              </Button>
            )}
          </div>

          {returnLines.length === 0 && viewOnly ? (
            <Empty description="اختر الأصناف المرتجعة" style={{ margin: '12px 0' }} />
          ) : (
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
                                إجمالي الفئة: {money(group.items.reduce((s, l) => s + lineNet(l), 0))}
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
                  <QuickAddRow
                    colSpan={lineGrid.count} disabled={viewOnly} items={items as any}
                    warehouses={warehouses} warehouseId={warehouseId}
                    onWarehouseChange={(w) => { setWarehouseId(w); loadWarehouseStock(w); }}
                    availableFor={(id) => (warehouseId && availability[warehouseId]
                      ? (availability[warehouseId][id] ?? 0) : null)}
                    onOpenPicker={() => setPickerOpen(true)}
                    onPick={(id) => addPickedSequentially([id], undefined, addReturnLine, setFocusLineKey)} />
                </tbody>
                <tfoot>{lineGrid.foot(returnLines)}</tfoot>
              </table>
            </div>
          )}
          </div>

          <div className="sale-card sale-notes">
            <div className="sale-attach">
              <DocumentAttachments docType="purchase_return" docId={editingId} title="مرفقات" />
            </div>
          </div>

          <div className="sale-bottom">
          <Row gutter={[10, 10]}>
            <Col xs={24} lg={16}>
              <div className="sale-tiles">
                <SummaryTile label="الإجمالي قبل الخصم" value={money(grossTotal)} />
                {variableDiscount > 0.001 && (
                  <SummaryTile label={`خصم المردود (${variableDiscount}%)`}
                    value={`− ${money(grossTotal - draftValue)}`} color="#dc2626" />
                )}
                <SummaryTile label="قيمة المردود" value={money(draftValue)} color="#16a34a" />
              </div>
            </Col>

            <Col xs={24} lg={8}>
              <div className="sale-card sale-pay">
                <div className="sale-pay-inputs">
                  <Form.Item label="خصم على المردود %" style={{ gridColumn: '1 / -1' }}>
                    <InputNumber style={{ width: '100%' }} min={0} max={99.99} step={0.5}
                      disabled={viewOnly}
                      addonAfter="%" value={variableDiscount}
                      onChange={(v) => setVariableDiscount((v as number) || 0)} />
                  </Form.Item>
                </div>
                {!viewOnly && (
                  <div className="sale-pay-actions">
                    <Button type="primary" loading={saving} onClick={() => submit()}
                      icon={<CheckOutlined />} className="sale-green-btn sale-save-btn">
                      {editingId !== null ? 'حفظ التعديل' : 'ترحيل المردود'} (F9)
                    </Button>
                    <Button
                      onClick={() => { setCreating(false); setEditingId(null);
                        setSupplierFilter(null); }}>إلغاء</Button>
                  </div>
                )}
              </div>
            </Col>
          </Row>
          </div>
        </Form>
      </>
      )}
    </div>
  );
}

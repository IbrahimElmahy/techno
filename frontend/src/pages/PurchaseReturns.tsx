import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Divider, Empty, Form, Input, Modal, Row,
  Select, Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import { advanceFrom, useQtyFocus } from '../components/lineKeyboard';
import {
  ArrowLeftOutlined, ArrowRightOutlined, BankOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, FileAddOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined,
  SaveOutlined, SearchOutlined, UndoOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { DocRef } from '../components/DocumentLink';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import ExportExcelButton from '../components/ExportExcelButton';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
import { guardQuantity } from '../components/quantityGuard';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useLookup, labelMap } from '../hooks/useLookup';
import InvoiceDocument, { InvoiceDoc, invoiceFooter, printInvoice }
  from '../components/InvoiceDocument';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import PartyPickerModal from '../components/PartyPickerModal';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import TotalsLadder from '../components/TotalsLadder';
import ProductPickerModal from '../components/ProductPickerModal';
import { useTableKeyboard } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import PrintOptionsMenu from '../components/PrintOptionsMenu';
import { PrintOptions, loadPrintOptions } from '../print/printOptions';
import dayjs, { Dayjs } from 'dayjs';
import { TabModal } from '../components/TabModal';
import { money } from '../utils/money';
import { QTY_DATA_ATTR, flashExistingItem } from '../utils/duplicateItem';

/**
 * مردودات شراء — goods going back to the supplier, as a register of its own.
 *
 * The returns themselves have worked for a long time, but only from inside a purchase: open the
 * invoice, return off it. That answers «what came back off THIS invoice» and never «what went back
 * to suppliers this month», which is the question a register exists for — and their menu has it as
 * its own screen (`/purchasesreturns/create`), so ours was one entry short of the map.
 *
 * A purchase return is a leaner document than a sales return: no discount, no tax, no cash
 * settlement. Goods go back and what we owe the supplier drops by their value. The columns say
 * exactly that and nothing more, rather than borrowing the sales return's shape.
 *
 * **A return is always against a purchase.** There is no standalone purchase return, and this
 * screen does not invent one — creating starts by choosing the invoice, so what goes back can only
 * be what came in, at the price it came in at. A return with no purchase behind it would be stock
 * appearing from nowhere at a price nobody agreed.
 */

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
}

interface PurchaseLine {
  item_id: number; quantity: string; unit_price: string; line_total: string; unit: string | null;
}

export default function PurchaseReturns() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWriteReturn = can('return.write');
  const [rows, setRows] = useState<ReturnRow[]>([]);
  // A purchase return is now a document with a screen, so a link to one has somewhere to land.
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlight, setHighlight] = useState<number | null>(null);
  const pendingDoc = useRef<number | null>(null);
  /** الرابط طالب تعديل مش عرض — بيتقرا مع `pendingDoc` في نفس اللحظة. */
  const pendingEdit = useRef(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);

  const [creating, setCreating] = useState(false);
  // The date is asked first, the way the sale and the sales return ask it — the day the goods
  // went back is a fact about the goods, not about when somebody got to the screen.
  const [newStep, setNewStep] = useState<null | 'party'>(null);
  /** حقول المستند — نفس اللي على فاتورة الشرا بالظبط.
   *
   * الفرع وحساب الترحيل اتشالوا مع خاناتهم: الفرع بيتعرف من المخزن، وحساب المشتريات بياخد
   * الافتراضي من السيرفر. وقايمتين كانوا بيتجابوا من السيرفر مع كل فتحة شاشة عشان خانتين
   * محدش كان بيغيّرهم — القايمتين اتشالوا معاهم. */
  const [externalNumber, setExternalNumber] = useState('');
  const [statements, setStatements] = useState<string[]>(['', '', '']);
  const [variableDiscount, setVariableDiscount] = useState(0);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);

  /** المورد اللي المردود راجع له. */
  const [supplierFilter, setSupplierFilter] = useState<number | null>(null);
  /** المخزن اللي البضاعة بتخرج منه — مفيش فاتورة تقول منين، فالمستند بيتسأل. */
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  /** الأصناف المستنية المخزن — نفس بوباب البيع والشرا والمرتجع. السؤال هنا «البضاعة
   *  خارجة من أنهي مخزن»، والسطر اللي نزل من غير مخزن بيبقى بضاعة خارجة من مكان محدش
   *  قاله. وبيتجمّعوا في طابور عشان اختيار كذا صنف مرة واحدة مايضيّعش غير الأخير. */
  /**
   * السطر اللي المؤشر رايح لخانة كميته.
   *
   * الشاشة دي كانت الوحيدة اللي مالهاش الحركة دي خالص: تختار صنف، والمؤشر يفضل مكانه،
   * فالإيد بتروح للماوس عشان تدوس على خانة الكمية — في كل سطر. باقي شاشات المستندات
   * بتحط المؤشر في الكمية على طول.
   */
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<number[]>([]);
  const [pendingWarehouse, setPendingWarehouse] = useState<number | null>(null);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  /** سطور المردود — أصناف بكمياتها وأسعارها، زي سطور الفاتورة. */
  interface ReturnLineDraft {
    key: string;
    item_id: number;
    quantity: number | null;
    unit_price: number;
    // نفس ما على سطر الفاتورة.
    /** الخصم المتغيّر — بتاع المستند ده. */
    discount_pct: number | null;
    /** والثابت — الاتفاق الدايم. الاتنين بيتجمعوا وقت الإرسال، زي البيع والشرا. */
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
  // المردود اللي مفتوح للعرض
  const [viewing, setViewing] = useState<any>(null);
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

  useEffect(() => {
    const doc = searchParams.get('doc');
    const edit = searchParams.get('edit');
    if (doc || edit) {
      pendingDoc.current = Number(doc || edit);
      pendingEdit.current = !!edit;
      setSearchParams({}, { replace: true });
    }
    const wanted = pendingDoc.current;
    if (!wanted) return;
    pendingDoc.current = null;
    const target = rows.find((r) => r.id === wanted) || ({ id: wanted } as ReturnRow);
    const wantsEdit = pendingEdit.current;
    pendingEdit.current = false;
    if (wantsEdit) editPosted(target);
    else openReturn(target);
  }, [searchParams, rows]);

  const returnedByPurchase = useMemo(() => {
    const m: Record<number, number> = {};
    rows.forEach((r) => {
      m[r.purchase_invoice_id] = (m[r.purchase_invoice_id] || 0) + Number(r.value || 0);
    });
    return m;
  }, [rows]);

  const itemName = (id: number) => items.find((i) => i.id === id)?.name ?? `صنف #${id}`;

  const openReturn = async (row: ReturnRow) => {
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
        discount_pct: Number(l.discount_pct || 0),
        fixed_discount_pct: 0,
        unit: l.unit || null,
        warehouse_id: l.warehouse_id ?? null,
      })));
      setViewOnly(true);
      setCreating(true);
    } catch {
      message.error('تعذر فتح المردود');
    } finally { setViewLoading(false); }
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printOpts, setPrintOpts] = useState<PrintOptions>(loadPrintOptions);

  const editPosted = async (row: ReturnRow) => {
    await openReturn(row);
    setViewOnly(false);
    message.info('مردود الشراء مفتوح الآن للتعديل');
  };

  const openCreate = () => {
    setPurchaseId(undefined); setDetail(null); setQty({});
    setReturnDate(dayjs()); setNotes(''); setCreating(false); setNewStep('party');
    setEditingId(null); setSupplierFilter(null); setViewing(null); setViewOnly(false);
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
        // «تراجع» بيرجّع المستند، مش بيقفل الحقول وبس.
        //
        // كان بيعمل `setViewOnly(true)` على طول: الحقول تتقفل واللي اتكتب ومااتحفظش يفضل
        // ظاهر — مقفول ومقروء، يعني بنفس شكل المحفوظ بالظبط. فاللي غيّر كمية من ١٠ لـ٣
        // وضغط تراجع بيفضل قدامه ٣ وإجمالي مالوش وجود، ومافيش حاجة على الشاشة بتقول إن ده
        // مش اللي في القاعدة. إعادة تحميل المستند هي الحاجة الوحيدة اللي بترجّع الأرقام.
        onClick: () => {
          if (!viewOnly && editingId) {
            openReturn({ id: editingId } as ReturnRow);
          } else if (returnLines.length > 0) {
            setCreating(false);
            setEditingId(null);
            setViewOnly(false);
            setViewing(null);
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
        key: 'next',
        label: 'التالى',
        icon: <ArrowLeftOutlined />,
        disabled: filter.filtered.length === 0,
        onClick: () => stepList(1),
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
        onClick: () => {
          if (isSaved && viewing) openReturn({ id: viewing.id } as any);
          else load();
        },
      },
    ];
  };

  /** وحدات الأصناف — نفس المحرك اللي في الفاتورة. */
  const [unitsCache, setUnitsCache] = useState<Record<number, any[]>>({});
  const fetchUnits = async (itemId: number) => {
    if (unitsCache[itemId]) return;
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({
        name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
    } catch { /* الوحدات مش معروفة — الخيار الأساسي لوحده كفاية */ }
  };
  /** فيها **دايماً** خيار الوحدة الأساسية — من غيره antd بتعرض المفتاح الداخلي للمستخدم. */
  const unitOptions = (itemId: number | null) => {
    const units = unitsCache[itemId || 0] || [];
    const base = units.find((u: any) => u.is_base);
    return [
      { value: '__base__', label: base?.name || 'الأساسية' },
      ...units.filter((u: any) => !u.is_base)
        .map((u: any) => ({ value: u.name, label: `${u.name} (×${u.factor})` })),
    ];
  };

  /**
   * صافي السطر — نفس ترتيب الفاتورة: خصم السطر بينزل على سطره، والسطور بتتجمع، وخصم
   * المستند بينزل على المجموع مرة واحدة.
   */
  const lineNet = (l: ReturnLineDraft) => {
    const before = Number(l.quantity || 0) * (l.unit_price || 0);
    const disc = Math.min(99.99, (l.discount_pct ?? 0) + (l.fixed_discount_pct ?? 0));
    return before * (1 - disc / 100);
  };
  const grossTotal = returnLines.reduce((n, l) => n + lineNet(l), 0);

  /** قيمة المردود — من السطور اللي اتكتبت، مش من فاتورة. */
  /**
   * رصيد كل صنف في المخزن المختار — عشان الكمية تتحرس قبل ما السيرفر يرفضها.
   *
   * المردود المستقل مالوش فاتورة تقول «اتشرى كام»، فالحد الوحيد هو اللي موجود فعلاً. السيرفر
   * بيرفض الزيادة برضه، بس الرفض هناك بييجي بعد ما الواحد كتب المستند كله — والحارس هنا
   * بيقولها عند الخانة.
   */
  const [onHand, setOnHand] = useState<Record<number, number>>({});
  const [availability, setAvailability] = useState<Record<number, Record<number, number>>>({});

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
  const loadWarehouseStock = async (wh: number) => {
    if (!wh) return;
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: { location_kind: 'warehouse', location_id: wh, only_available: false },
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
  }, [warehouseId, pickerOpen]);

  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);

  /** فئات الأصناف اللي البوباب بيجمّع بيها — من اللي في القايمة فعلاً. */
  const itemCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i: any) => { if (i.category) set.add(i.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [items]);

  const linesByCategory = useMemo(() => {
    const groups: { category: string | null; items: ReturnLineDraft[] }[] = [];
    returnLines.forEach((l) => {
      const cat = (l.item_id ? items.find((i: any) => i.id === l.item_id)?.category : null) || null;
      let g = groups.find((x) => x.category === cat);
      if (!g) { g = { category: cat, items: [] }; groups.push(g); }
      g.items.push(l);
    });
    return groups;
  }, [returnLines, items]);

  /**
   * إضافة صنف للمردود — الصنف اللي موجود بتزيد كميته بدل ما يتكرّر سطر.
   *
   * كل التحديث من `prev`: اللي بيختار عشر أصناف مرة واحدة بيعمل عشر إضافات ورا بعض، ولو
   * واحدة قرت نسخة قديمة من السطور بتكتب فوق اللي قبلها.
   */
  const addReturnLine = (itemId: number) => {
    if (!itemId) return;
    // مافيش مخزن للمردود لسه؟ نسأل مرة واحدة قبل ما السطر ينزل.
    if (warehouseId === null) {
      setPendingItems((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
      setPendingWarehouse((prev) => prev ?? warehouses[0]?.id ?? null);
      return;
    }
    addReturnLineWith(itemId, warehouseId);
  };

  useQtyFocus(focusLineKey, setFocusLineKey, pickerOpen, returnLines);
  /** Enter بينقل للسطر اللي بعده، وآخر سطر بيفتح شباك الأصناف. */
  const advance = advanceFrom(returnLines, setFocusLineKey, () => setPickerOpen(true));

  /**
   * نفس الإضافة بمخزن **صريح** — `setWarehouseId` مابيغيّرش القيمة في نفس اللفّة.
   *
   * السعر والخصم بيتملّوا من السيرفر: **آخر سعر شراء** للصنف، ولو عمره ما اتشرى فسعره
   * الحالي. `purchase_price` اللي على الكتالوج هو سعر إرشادي بيتكتب مرة وبيقدم؛ آخر سعر
   * شراء هو اللي البضاعة دي دخلت بيه فعلاً، وهو الرقم اللي بيخلّي المخزون والحساب يقفلوا
   * على نفس المبلغ لما ترجع.
   */
  const addReturnLineWith = async (itemId: number, wh: number) => {
    const product = items.find((i: any) => i.id === itemId) as any;
    let price = product?.purchase_price ? parseFloat(product.purchase_price) : 0;
    let disc: number | null = null;
    try {
      const r = await api.get(`/api/v1/items/${itemId}/return-price`);
      if (Number(r.data?.unit_price) > 0) price = Number(r.data.unit_price);
      if (Number(r.data?.discount_pct) > 0) disc = Number(r.data.discount_pct);
    } catch { /* الكتالوج بيفضل الاحتياطي */ }
    if (returnLines.some((l) => l.item_id === itemId)) {
      flashExistingItem(itemId);
      message.info(`«${itemName(itemId)}» موجود بالفعل — عدّل الكمية من السطر`);
      return;
    }
    // المفتاح بيتحسب هنا مش جوّه `setState` — عشان التركيز يروح للسطر ده بالظبط.
    // لو اتحسب جوّه، الكود اللي بره مايعرفوش، والمؤشر بيدوّر على سطر مالوش وجود.
    const key = `${Date.now()}-${itemId}`;
    let landed = key;
    setReturnLines((prev) => {
      const existing = prev.find((l) => l.item_id === itemId);
      if (existing) {
        landed = '';
        return prev;
      }
      return [...prev, {
        key, item_id: itemId, quantity: null, unit_price: price,
        discount_pct: null, fixed_discount_pct: disc, unit: null,
        warehouse_id: wh,
      }];
    });
    setFocusLineKey(landed);
    fetchOnHand(itemId, wh);
    fetchUnits(itemId);
  };

  /**
   * أعمدة شبكة السطور كبيانات — عشان تتخفي وتترتّب.
   *
   * كانت مكتوبة بالإيد في `<thead>` و`<tbody>` و`<tfoot>`، وصف الإجماليات معلّق على
   * `colSpan={4}` بتعليق بيحذّر إنه لازم يتغيّر مع أي عمود بيتزوّد قبله. دلوقتي كل عمود
   * شايل خليته وإجماليه، فالاتنين بيتحركوا معاه.
   */
  const lineColumns: EntryColumn<ReturnLineDraft>[] = [
    { key: 'idx', title: '#', width: 28, locked: true,
      cellStyle: { color: '#6b6b6b', textAlign: 'center' }, cell: (_l, i) => i + 1 },
    { key: 'warehouse', title: 'المخزن', minWidth: 120,
      cell: (line) => (
        <Select size="small" style={{ width: '100%' }} placeholder="المخزن"
          disabled={viewOnly}
          value={line.warehouse_id ?? warehouseId ?? undefined}
          onChange={(v) => {
            setReturnLines((prev) => prev.map((l) => (
              l.key === line.key ? { ...l, warehouse_id: v ?? null } : l)));
            if (v != null) setWarehouseId(v as number);
          }}
          options={warehouses.map((w: any) => ({
            value: w.id,
            label: `${w.name} (${w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})`,
          }))} />
      ) },
    { key: 'item', title: 'الصنف', minWidth: 170, locked: true,
      cell: (line) => <b style={{ fontSize: 13 }}>{line.item_id ? itemName(line.item_id) : 'اختر الصنف'}</b> },
    { key: 'unit', title: 'الوحدة', minWidth: 80,
      cell: (line) => (
        <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
          disabled={viewOnly}
          value={line.unit ?? '__base__'}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, unit: v === '__base__' ? null : v } : l)))}
          options={unitOptions(line.item_id)} />
      ) },
    { key: 'qty', title: 'الكمية', minWidth: 70, locked: true,
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
    { key: 'price', title: 'سعر الوحدة', minWidth: 80,
      cell: (line) => (
        <InputNumber size="small" style={{ width: '100%' }} min={0} step={0.01}
          disabled={viewOnly}
          onPressEnter={(e) => { e.preventDefault(); advance(line.key); }}
          placeholder="السعر" value={line.unit_price}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, unit_price: (v as number) || 0 } : l)))} />
      ),
      footer: () => null },
    { key: 'gross', title: 'اجمالي قبل', minWidth: 85,
      cellStyle: { whiteSpace: 'nowrap' },
      cell: (line) => money(Number(line.quantity || 0) * (line.unit_price || 0)),
      footer: (rows) => money(rows.reduce(
        (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0)) },
    { key: 'disc_var', title: 'خصم متغير %', minWidth: 75,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="متغير" value={line.discount_pct ?? undefined}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, discount_pct: (v as number) ?? null } : l)))} />
      ),
      footer: () => null },
    { key: 'disc_fixed', title: 'خصم ثابت %', minWidth: 75,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5} style={{ width: '100%' }}
          disabled={viewOnly}
          placeholder="ثابت" value={line.fixed_discount_pct ?? undefined}
          onChange={(v) => setReturnLines((prev) => prev.map((l) => (
            l.key === line.key ? { ...l, fixed_discount_pct: (v as number) ?? null } : l)))} />
      ),
      footer: () => null },
    { key: 'total', title: 'الإجمالي', minWidth: 90, locked: true,
      cellStyle: { fontWeight: 700, whiteSpace: 'nowrap' },
      cell: (line) => money(lineNet(line)),
      footer: (rows) => money(rows.reduce((n, l) => n + lineNet(l), 0)) },
    { key: 'actions', title: '', label: 'حذف السطر', width: 32, locked: true,
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
        // الاتنين بيتجمعوا — سطر المردود في السيرفر بيشيل خصم واحد.
        discount_pct: ((l.discount_pct ?? 0) + (l.fixed_discount_pct ?? 0)) || null,
        unit: l.unit,
        warehouse_id: l.warehouse_id ?? warehouseId,
      }));
    if (!lines.length) { message.warning('اكتب الكمية المرتجعة على صنف واحد على الأقل'); return; }
    setSaving(true);
    try {
      // التعديل بيروح للمردود نفسه بنفس رقمه. كان بيتعكس الأول ويتكتب مردود جديد، فتصليح
      // كمية كان بيسيب وراه قيد مضاد في كشف المورد ورقم سند جديد على ورق قديم.
      const body = {
        supplier_id: supplierFilter,
        location: { location_kind: 'warehouse', location_id: warehouseId },
        lines,
        return_date: returnDate.format('YYYY-MM-DD'),
        notes: notes || null,
        // نفس حقول مستند الفاتورة.
        // الافتراضي بتاع السيرفر — نفس فاتورة الشرا. الخانة اتشالت من الترويسة، ومحدش
        // كان بيغيّرها في المية مرة اللي بتتكتب في اليوم.
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
      setEditingId(null);
      setReturnLines([]);
      setCreating(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل المردود');
    } finally { setSaving(false); }
  };

  /**
   * أعمدة السجل — كل واحد بيتفلتر ويتترتب، زي سجل الشرا بالظبط.
   *
   * الفلترة كانت من شريط فوق الجدول: بحث والمورد وبس. «هات المردودات اللي قيمتها فوق الألف»
   * و«رتّبهم بالأكبر» أسئلة بتتسأل على عمود، مش على المستند كله.
   *
   * والترتيب الافتراضي من الأحدث — اللي بيفتح السجل عايز يشوف آخر اللي رجع.
   */
  const columns = [
    {
      title: 'رقم', dataIndex: 'id', key: 'id', width: 80,
      ...numberColumn<ReturnRow>((r) => r.id),
      render: (id: number) => <span style={{ color: '#6b6b6b' }}>{id}</span>,
    },
    {
      // The day the goods went back, falling back to when the row was typed for returns recorded
      // before the document had a date of its own. Not silently: those rows say so.
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
      render: (d: string) => <Tag color="volcano">{d}</Tag>,
    },
    {
      title: 'الفاتورة رقم', dataIndex: 'purchase_document_number', key: 'purchase_document_number',
      width: 140,
      ...textColumn(rows, (r: ReturnRow) => r.purchase_document_number),
      // The purchase this came off, opened in the purchases screen — the register exists to answer
      // «which invoice?», and stopping at the number would leave the trip half made.
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
      render: (v: string) => <strong style={{ color: '#cf4b1a' }}>{money(v)} ج.م</strong>,
    },
    {
      title: 'ملاحظات', dataIndex: 'notes', key: 'notes', ellipsis: true,
      ...textColumn(rows, (r: ReturnRow) => r.notes),
      render: (v: string | null) => v || '-',
    },
    {
      title: 'الإجراءات', key: 'actions', width: 140,
      render: (_: any, record: ReturnRow) => (
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
      ),
    },
  ];

  /**
   * المرتجع بشكل المستند المطبوع — نفس قالب الفاتورة.
   *
   * كان مالوش ورقة: اللي عايز يبعت للمورد كشف باللي رجعله كان بيصوّر الشاشة. القالب واحد
   * للاتنين عشان الورقتين يطلعوا من نفس المطبعة — ترويسة الشركة والتذييل والخطوط مايفرقوش
   * بين مستند وتاني.
   *
   * المرتجع مافيهوش خصم ولا ضرايب، فالإجمالي والصافي واحد. و«نقدي/آجل» أصفار: المرتجع
   * بيقلّل اللي على الشركة، مش بيتقبض ولا بيتصرف على الورقة دي.
   */
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
      ],
    };
  };

  const cols = useHiddenColumns('purchase-returns-list', ['id']);
  const visibleColumns = cols.apply(columns);

  const filter = useListFilter<ReturnRow>(rows, {
    search: (r) => [r.document_number, r.purchase_document_number, r.supplier_name,
      r.value, r.notes],
    filters: {
      supplier_id: (r, v) => r.supplier_id === v,
      document_number: (r, v) => (r.document_number || '').includes(String(v)),
      purchase_document_number: (r, v) => (r.purchase_document_number || '')
        .toLowerCase().includes(String(v).toLowerCase()),
      notes: (r, v) => (r.notes || '').toLowerCase().includes(String(v).toLowerCase()),
    },
    // يوم ما البضاعة رجعت، مش يوم ما الصف اتكتب — مردود أول الشهر اتسجّل آخره كان بيقع برّه
    // المدى واللي بيدوّر عليه بيفتكره مش موجود.
    dateOf: (r) => r.return_date || r.created_at,
  });

  const suppliers = useMemo(() => {
    const seen = new Map<number, string>();
    rows.forEach((r) => { if (r.supplier_id) seen.set(r.supplier_id, r.supplier_name || ''); });
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const kb = useTableKeyboard<ReturnRow>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: openReturn,
  });

  /**
   * صفحة المستند — واحدة، سواء بتكتب مردود أو بتقرا واحد اتّرحّل.
   *
   * It used to be two Modals over the list: one to write a return, another to look at one. Two
   * shapes for the same paper, so opening yesterday's return landed nowhere near where it was
   * typed. The list simply steps aside while a document is open.
   */
  const docOpen = creating;

  return (
    <div>
      {!docOpen && (
      <Card
        title="مردودات الشراء"
        extra={
          <Space>
            <ColumnSettings
              choices={columns.map((c: any) => ({
                key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
                locked: c.key === 'document_number',
              }))}
              hidden={cols.hidden} onChange={cols.setHidden}
              order={cols.order} onMove={(k, d) => cols.move(k, d, columns.map((c) => String(c.key ?? (c as any).dataIndex ?? '')))}
            />
            <ExportExcelButton
              name="مردودات الشراء"
              rows={filter.filtered}
              tableColumns={visibleColumns}
              style={{ marginInlineStart: 0 }}
            />
            <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
            <Button data-shortcut="F2" type="primary" danger icon={<PlusOutlined />} onClick={openCreate}>
              تسجيل مردود شراء
            </Button>
          </Space>
        }
      >
        <ListToolbar
          searchPlaceholder="بحث برقم السند أو الفاتورة أو المورد"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          showDateRange range={filter.range} onRangeChange={filter.setRange}
          onReset={filter.reset} total={rows.length} shown={filter.filtered.length}
          searchSpan={6}
          filters={[
            { key: 'supplier_id', placeholder: 'المورد', span: 5, options: suppliers },
            { key: 'document_number', placeholder: 'رقم السند', kind: 'text',
              advanced: true, span: 5 },
            { key: 'purchase_document_number', placeholder: 'الفاتورة رقم', kind: 'text',
              advanced: true, span: 5 },
            { key: 'notes', placeholder: 'ملاحظات', kind: 'text', advanced: true, span: 6 },
          ]}
        />

        <Table
          {...kb.tableProps}
          dataSource={filter.filtered} columns={visibleColumns} rowKey="id" loading={loading}
          // من غير `scroll` أفقي — الشاشة مالهاش يمين وشمال.
          //
          // مع `tableLayout: fixed` وكل عمود له عرض، المتصفح بيوزّع الفرق على الأعمدة كلها
          // بالنسبة: زادت تتفرد شوية، قلّت تتضغط شوية. اللي كان بيكسّر الشكل هو عمود من غير
          // عرض — الفاضي كله كان بينزل عليه لوحده فيطلع شريط أبيض في نص الجدول.
          size="small" tableLayout="fixed"
          rowClassName={(r) => [
            r.id === highlight ? 'row-arrived' : '', kb.rowClassName(r),
          ].filter(Boolean).join(' ')}
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
                          : key === 'value' ? `${money(total)} ج.م` : ''}
                      </Table.Summary.Cell>
                    );
                  })}
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
          pagination={{
            defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>
      )}

      <TabModal
        open={pendingItems.length > 0}
        title={pendingItems.length > 1
          ? `الأصناف دي (${pendingItems.length}) خارجة من أنهي مخزن؟`
          : 'البضاعة خارجة من أنهي مخزن؟'}
        okText="تمام" cancelText="إلغاء"
        okButtonProps={{ disabled: pendingWarehouse === null }}
        onCancel={() => setPendingItems([])}
        onOk={() => {
          const wh = pendingWarehouse;
          const queued = pendingItems;
          if (wh === null || queued.length === 0) return;
          setPendingItems([]);
          setWarehouseId(wh);
          for (const id of queued) addReturnLineWith(id, wh);
        }}
        destroyOnHidden
      >
        <Select
          style={{ width: '100%' }} size="large" showSearch optionFilterProp="label"
          placeholder="اختر المخزن"
          value={pendingWarehouse ?? undefined}
          onChange={(v) => setPendingWarehouse(v as number)}
          options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))}
        />
        <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
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
        availableFor={(id) => (warehouseId ? (availability[warehouseId]?.[id] ?? 0) : null)}
        onCancel={() => setPickerOpen(false)}
        onPick={(id) => { setPickerOpen(false); addReturnLine(id); }}
        onPickMany={(ids) => { setPickerOpen(false); ids.forEach(addReturnLine); }} />

      <PartyPickerModal
        open={newStep === 'party' || partyPickerOpen} kind="supplier"
        kinds={['supplier', 'customer']}
        date={returnDate} onDateChange={(d) => setReturnDate(d)}
        onPick={(picked) => {
          setNewStep(null);
          setPartyPickerOpen(false);
          setSupplierFilter(picked.id);
          setCreating(true);
        }}
        onCancel={() => { setNewStep(null); setPartyPickerOpen(false); }} />

      {creating && (
      <Card title={(
        <Space>
          <Button type="text" icon={<ArrowRightOutlined />}
            onClick={() => { setCreating(false); setViewOnly(false); setEditingId(null); setViewing(null); }}>رجوع</Button>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {viewing ? `مردود شراء ${viewing.document_number}` : (editingId ? 'تعديل مردود شراء' : 'تسجيل مردود شراء جديد')}
          </Typography.Text>
        </Space>
      )}
      extra={<PrintOptionsMenu value={printOpts} onChange={setPrintOpts} />}>
        <DocumentToolbar actions={returnToolbar()} />

        <Form layout="vertical" size="small" className="doc-form">
          <Row gutter={16}>
            <Col xs={12} md={5}>
              <Form.Item label="التاريخ" style={{ marginBottom: 8 }}>
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  disabled={viewOnly}
                  value={returnDate} onChange={(v: Dayjs | null) => v && setReturnDate(v)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="المورد" required style={{ marginBottom: 8 }}>
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  disabled={viewOnly}
                  placeholder="اضغط لاختيار المورد" value={supplierFilter ?? undefined}
                  onClick={() => { if (!viewOnly) setPartyPickerOpen(true); }}
                  options={suppliers} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item label="المستند" style={{ marginBottom: 8 }}>
                <Input placeholder="رقم إشعار المورد" disabled={viewOnly} value={externalNumber}
                  onChange={(e) => setExternalNumber(e.target.value)} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item label="ملاحظات" style={{ marginBottom: 8 }}>
                <Input placeholder="سبب الرجوع (مكسورة، ناقصة، غلط في الصنف…)"
                  disabled={viewOnly}
                  value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Form.Item>
            </Col>
            {([1, 2, 3] as const).map((n) => (
              <Col xs={24} md={6} key={n}>
                <Form.Item label={`بيان ${n}`} style={{ marginBottom: 8 }}>
                  <Input placeholder="اختياري" disabled={viewOnly} value={statements[n - 1]}
                    onChange={(e) => setStatements((prev) => {
                      const next = [...prev]; next[n - 1] = e.target.value; return next;
                    })} />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>

        <Divider style={{ margin: '10px 0' }} />

        {!viewOnly && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 2 }}>
            <Button data-shortcut="F2"
              type="primary" danger icon={<PlusOutlined />}
              style={{ flex: 1, height: 32, fontSize: 13, fontWeight: 700, borderRadius: 6 }}
              onClick={() => setPickerOpen(true)}
            >
              إضافة صنف للمردود (F2)
            </Button>
            <div style={{ flexShrink: 0 }}>{lineGrid.control}</div>
          </div>
        )}

        {returnLines.length === 0 ? (
          <Empty description="اختر الأصناف المرتجعة" style={{ margin: '12px 0' }} />
        ) : (
          <div style={{ border: '1px solid #f3e0d8', borderRadius: 10, overflowX: 'auto' }}>
            <table className="entry-grid">
              <thead>{lineGrid.head}</thead>
              <tbody>
                {linesByCategory.map((group) => (
                  <React.Fragment key={group.category ?? '__none__'}>
                    {linesByCategory.length > 1 && (
                      <tr style={{ background: '#fdf3ee', borderTop: '1.5px solid #cf4b1a', borderBottom: '1px solid #f3e0d8' }}>
                        <td colSpan={20} style={{ padding: '1px 8px', background: '#fdf3ee' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Tag color="volcano" style={{ fontWeight: 700, fontSize: 11, padding: '0 6px', borderRadius: 3, margin: 0 }}>
                                {group.category ? (categoryLabels[group.category] || group.category) : 'بدون فئة'}
                              </Tag>
                              <span style={{ color: '#555', fontSize: 11, fontWeight: 600 }}>({group.items.length} صنف)</span>
                            </div>
                            <span style={{ color: '#666', fontSize: 11, fontWeight: 600 }}>
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
              </tbody>
              <tfoot>{lineGrid.foot(returnLines)}</tfoot>
            </table>
          </div>
        )}

        <Divider style={{ margin: '10px 0' }} />

        <TotalsLadder
          tone="sale"
          inputs={(
            <Form layout="vertical" size="small" className="doc-form">
              <Form.Item label="خصم على المردود %" style={{ marginBottom: 0 }}
                help="يُطبَّق على مجموع السطور بعد خصم كل سطر — كفاتورة الشراء">
                <InputNumber style={{ width: '100%' }} min={0} max={99.99} step={0.5}
                  disabled={viewOnly}
                  addonAfter="%" value={variableDiscount}
                  onChange={(v) => setVariableDiscount((v as number) || 0)} />
              </Form.Item>
            </Form>
          )}
          rows={[
            { label: 'اجمالي قبل', value: money(grossTotal) },
            { label: 'خصم المردود',
              value: `\u2212 ${money(grossTotal - draftValue)}`,
              color: '#cf1322', show: variableDiscount > 0.001 },
            { label: 'خصم المردود %', value: `${variableDiscount}%`,
              show: variableDiscount > 0.001 },
            { label: 'قيمة المردود', value: money(draftValue),
              big: true, rule: true, color: '#cf4b1a' },
          ]}
        />

        {!viewOnly && (
          <div style={{
            marginTop: 16, padding: 16, borderRadius: 10,
            background: '#fdf6f3', border: '1px solid #f3e0d8',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
          }}>
            <Button type="primary" danger loading={saving} onClick={() => submit()}>
              {editingId !== null ? 'حفظ التعديل' : 'ترحيل المردود'}
            </Button>
            <Button
              onClick={() => { setCreating(false); setEditingId(null);
                setSupplierFilter(null); }}>إلغاء</Button>
          </div>
        )}
      </Card>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Divider, Empty, Form, Input, InputNumber, Row, Select, Space, Table, Tag, message,
} from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, BankOutlined, DeleteOutlined, EditOutlined, EyeOutlined, FileAddOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, UndoOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { DocRef } from '../components/DocumentLink';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import { guardQuantity } from '../components/quantityGuard';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import InvoiceDocument, { InvoiceDoc, invoiceFooter }
  from '../components/InvoiceDocument';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import PartyPickerModal from '../components/PartyPickerModal';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import TotalsLadder from '../components/TotalsLadder';
import ProductPickerModal from '../components/ProductPickerModal';
import { useTableKeyboard } from '../components/keyboard';
import dayjs, { Dayjs } from 'dayjs';
import { TabModal } from '../components/TabModal';

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

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function PurchaseReturns() {
  const [rows, setRows] = useState<ReturnRow[]>([]);
  // A purchase return is now a document with a screen, so a link to one has somewhere to land.
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlight, setHighlight] = useState<number | null>(null);
  const pendingDoc = useRef<number | null>(null);
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
    discount_pct: number | null;
    unit: string | null;
    warehouse_id: number | null;
  }
  const [returnLines, setReturnLines] = useState<ReturnLineDraft[]>([]);
  const [returnDate, setReturnDate] = useState<Dayjs>(dayjs());
  const [notes, setNotes] = useState('');
  const [purchaseId, setPurchaseId] = useState<number | undefined>();
  const [detail, setDetail] = useState<any>(null);
  // المردود اللي مفتوح للعرض — غير `detail` اللي هو فاتورة الشراء بتاعة الإنشاء.
  const [viewing, setViewing] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);
  // Keyed by item, and empty until typed — a box that opens at 1 turns «5» into «15» for anybody
  // who types over it without clearing first. Same rule as every other document.
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
    if (doc) { pendingDoc.current = Number(doc); setSearchParams({}, { replace: true }); }
    const wanted = pendingDoc.current;
    if (!wanted || !rows.length) return;
    pendingDoc.current = null;
    const target = rows.find((r) => r.id === wanted);
    if (target) {
      // Marked AND opened. The mark says where on the page it is; the document says what is in it.
      setHighlight(wanted);
      setTimeout(() => setHighlight(null), 4000);
      openReturn(target);
    } else {
      message.warning(`مردود الشراء رقم ${wanted} مش في القائمة`);
    }
  }, [searchParams, rows]);

  // What each purchase has ALREADY had returned, so the screen can say what is still returnable
  // rather than letting somebody find out from a server error.
  const returnedByPurchase = useMemo(() => {
    const m: Record<number, number> = {};
    rows.forEach((r) => {
      m[r.purchase_invoice_id] = (m[r.purchase_invoice_id] || 0) + Number(r.value || 0);
    });
    return m;
  }, [rows]);

  const itemName = (id: number) => items.find((i) => i.id === id)?.name ?? `صنف #${id}`;

  /**
   * السطر يفتح المردود بسطوره.
   *
   * The row carries the value; only the lines carry «رجعنا إيه». `purchase_return_line` has held
   * them since returns were built and no screen ever asked for them, so the register could say a
   * return was worth 4,300 and never which items made it up.
   */
  const openReturn = async (row: ReturnRow) => {
    setViewing({ ...row, lines: null });
    setViewLoading(true);
    try {
      const res = await api.get(`/api/v1/purchases/returns/${row.id}`);
      setViewing(res.data);
    } catch {
      message.error('تعذر فتح المردود');
      setViewing(null);
    } finally { setViewLoading(false); }
  };

  /** المردود اللي بيتعدّل دلوقتي — لسه مرحّل، والعكس هيحصل وقت الحفظ. */
  const [editingId, setEditingId] = useState<number | null>(null);

  /**
   * فتح مردود مرحّل للتعديل — **من غير ما يتغيّر أي حاجة لحد ما تحفظ**.
   *
   * زي فاتورة الشرا بالظبط، ولنفس السبب اللي وقع فيها: لو العكس حصل وقت الفتح، أي مردود
   * بضاعته اتحركت بعد كده بيبقى مش قابل للفتح — العكس بيرجّع البضاعة للمخزن، ولو المخزن
   * اتقفل أو الفترة اتقفلت العملية بتقع، ومجرد إنك عايز تبص عليه بيفشل.
   *
   * الفتح قراية: الشاشة بتتملّى بفاتورته وبالكميات اللي كانت مترجّعة. والعكس بيحصل لما تدوس
   * «ترحيل» — القديم يتعكس والجديد يترحّل، مرة واحدة.
   */
  const editPosted = async (row: ReturnRow) => {
    let doc: any = null;
    try {
      const res = await api.get(`/api/v1/purchases/returns/${row.id}`);
      doc = res.data;
    } catch {
      message.error('تعذر فتح المردود');
      return;
    }
    setViewing(null);
    setEditingId(row.id);
    setReturnDate(doc.return_date ? dayjs(doc.return_date) : dayjs());
    setNotes(doc.notes || '');
    const filled: Record<number, number | null> = {};
    (doc.lines || []).forEach((l: any) => { filled[l.item_id] = Number(l.quantity); });
    await choosePurchase(doc.purchase_invoice_id);
    setQty(filled);
    setCreating(true);
  };

  const openCreate = () => {
    setPurchaseId(undefined); setDetail(null); setQty({});
    setReturnDate(dayjs()); setNotes(''); setCreating(false); setNewStep('party');
    setEditingId(null); setSupplierFilter(null);
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

  /**
   * شريط الأوامر — نفس صف الأفعال اللي على فاتورة الشرا.
   *
   * المستند نسخة منها بالعكس، فاللي اتعلّم إيده على واحد مايتعلّمش من الأول على التاني.
   * والأفعال اللي مالهاش معنى على المردود بتفضل ظاهرة ومقفولة، مش بتختفي: صف أفعال بيتغيّر
   * طوله من شاشة لشاشة بيخلّي الإيد تدوّر على الزرار كل مرة.
   */
  const returnToolbar = (): ToolbarAction[] => {
    const typed = returnLines.filter((l) => l.item_id && Number(l.quantity || 0) > 0).length;
    return [
      { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
        onClick: () => openCreate() },
      { key: 'edit', label: 'تعديل', icon: <EditOutlined />, disabled: true },
      { key: 'undo', label: 'تراجع', icon: <UndoOutlined />, disabled: typed === 0,
        onClick: () => setReturnLines([]) },
      { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
        disabled: typed === 0, onClick: () => submit() },
      { key: 'next', label: 'التالى', icon: <ArrowLeftOutlined />, disabled: true },
      { key: 'search', label: 'بحث', shortcut: 'F3', icon: <SearchOutlined />, disabled: true },
      { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />, disabled: true },
      { key: 'delete', label: 'حذف', shortcut: 'F8', icon: <DeleteOutlined />, danger: true,
        disabled: typed === 0, onClick: () => setReturnLines([]) },
      { key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />, disabled: true },
      { key: 'accounts', label: 'حسابات', icon: <BankOutlined />, disabled: true },
      { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />, onClick: () => load() },
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
    return before * (1 - (l.discount_pct ?? 0) / 100);
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
  const fetchOnHand = async (itemId: number, wh: number) => {
    try {
      const res = await api.get('/api/v1/stock/on-hand', { params: {
        item_id: itemId, location_kind: 'warehouse', location_id: wh } });
      setOnHand((prev) => ({ ...prev, [itemId]: Number(res.data?.on_hand ?? 0) }));
    } catch { /* الرصيد مش معروف — الحارس بيسيب الكمية والسيرفر بيقرر */ }
  };
  // تغيير المخزن بيغيّر كل الأرصدة — اللي كان متاح في مخزن مش متاح في التاني.
  useEffect(() => {
    if (!warehouseId) { setOnHand({}); return; }
    returnLines.forEach((l) => { if (l.item_id) fetchOnHand(l.item_id, warehouseId); });
  }, [warehouseId]);

  /** فئات الأصناف اللي البوباب بيجمّع بيها — من اللي في القايمة فعلاً. */
  const itemCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i: any) => { if (i.category) set.add(i.category); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [items]);

  /**
   * إضافة صنف للمردود — الصنف اللي موجود بتزيد كميته بدل ما يتكرّر سطر.
   *
   * كل التحديث من `prev`: اللي بيختار عشر أصناف مرة واحدة بيعمل عشر إضافات ورا بعض، ولو
   * واحدة قرت نسخة قديمة من السطور بتكتب فوق اللي قبلها.
   */
  const addReturnLine = (itemId: number) => {
    if (!itemId) return;
    const product = items.find((i: any) => i.id === itemId) as any;
    const price = product?.purchase_price ? parseFloat(product.purchase_price) : 0;
    setReturnLines((prev) => {
      const existing = prev.find((l) => l.item_id === itemId);
      if (existing) {
        return prev.map((l) => (l.key === existing.key
          ? { ...l, quantity: Number(l.quantity || 0) + 1 } : l));
      }
      return [...prev, {
        key: `${Date.now()}-${itemId}`, item_id: itemId, quantity: null, unit_price: price,
        discount_pct: null, unit: null, warehouse_id: warehouseId,
      }];
    });
    if (warehouseId) fetchOnHand(itemId, warehouseId);
    fetchUnits(itemId);
  };

  const draftValue = useMemo(
    () => grossTotal * (1 - (variableDiscount || 0) / 100),
    [grossTotal, variableDiscount],
  );

  const submit = async () => {
    if (!supplierFilter) { message.warning('اختار المورد الأول'); return; }
    if (!warehouseId) { message.warning('اختار المخزن اللي البضاعة راجعة منه'); return; }
    const lines = returnLines
      .filter((l) => l.item_id && Number(l.quantity || 0) > 0)
      .map((l) => ({
        item_id: l.item_id,
        quantity: String(l.quantity),
        unit_price: String(l.unit_price || 0),
        discount_pct: l.discount_pct == null ? null : String(l.discount_pct),
        unit: l.unit,
        warehouse_id: l.warehouse_id ?? warehouseId,
      }));
    if (!lines.length) { message.warning('اكتب الكمية المرتجعة على صنف واحد على الأقل'); return; }
    setSaving(true);
    try {
      // المردود اللي اتفتح للتعديل بيتعكس **دلوقتي** مش وقت الفتح — التبديل بيحصل مرة واحدة:
      // القديم يتعكس والجديد يترحّل. ولو العكس وقع، مافيش مردود جديد بيتكتب فوق القديم.
      if (editingId !== null) {
        try {
          await api.post(`/api/v1/purchases/returns/${editingId}/reverse`);
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message
            || 'تعذر عكس المردود القديم — التعديل ماتمّش');
          setSaving(false);
          return;
        }
      }
      // مستند مستقل — مفيش فاتورة في المسار.
      await api.post('/api/v1/purchases/returns', {
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
      });
      message.success(editingId !== null
        ? 'اتعدّل المردود واترحّل من جديد' : 'اتسجّل مردود الشراء');
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
      title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', width: 140,
      fixed: 'left' as const,
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
      title: 'الإجراءات', key: 'actions', width: 190,
      render: (_: any, record: ReturnRow) => (
        <Space size="middle">
          {/* زي سجل الشرا بالظبط: «عرض» بيفتح التعديل على طول، و«طباعة» بتفتح معاينة
              الورقة في بوباب فوق السجل. */}
          <Button type="dashed" size="small" icon={<EyeOutlined />}
            onClick={() => editPosted(record)}>عرض</Button>
          <Button type="link" size="small" icon={<PrinterOutlined />}
            onClick={() => openReturn(record)}>طباعة</Button>
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
  const docOpen = creating || !!viewing;

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
            // تحت «فلاتر أكثر» — بتتسأل كل شوية، ولها فلتر على العمود كمان.
            { key: 'document_number', placeholder: 'رقم السند', kind: 'text',
              advanced: true, span: 5 },
            { key: 'purchase_document_number', placeholder: 'الفاتورة رقم', kind: 'text',
              advanced: true, span: 5 },
            { key: 'notes', placeholder: 'ملاحظات', kind: 'text', advanced: true, span: 6 },
          ]}
        />

        <Table
          {...kb.tableProps}
          dataSource={filter.filtered} columns={cols.apply(columns)} rowKey="id" loading={loading}
          size="small" scroll={{ x: 'max-content' }}
          // Two marks that mean different things: «وصلت من لينك» يبهت، و«الكيبورد واقف هنا» يفضل.
          rowClassName={(r) => [
            r.id === highlight ? 'row-arrived' : '', kb.rowClassName(r),
          ].filter(Boolean).join(' ')}
          summary={(shown) => {
            /* إجمالي المعروض — على اللي الفلاتر سابته مش على السجل كله. «الشهر ده رجّعنا بكام»
               سؤال بيتسأل بعد ما تحط فلتر، وإجمالي بيوصف السجل كله بيبان كأنه إجابته.
               الخلايا بتتبني من الأعمدة المعروضة: `useHiddenColumns` بيخلّي الواحد يخفي عمود،
               وصف بمواضع ثابتة كان هيحط القيمة تحت عنوان تاني. */
            const list = shown as readonly ReturnRow[];
            if (!list.length) return null;
            const total = list.reduce((n, r) => n + Number(r.value || 0), 0);
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: '#fff7f0', fontWeight: 700 }}>
                  {(cols.apply(columns) as any[]).map((col, i) => {
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

      {/*
        * نفس الباب اللي بيفتح فاتورة الشرا — الفرع والتاريخ والتصنيف والبحث والقايمة في بوباب
        * واحد اسمه «انشاء».
        *
        * كان بوباب بيسأل التاريخ وبس، وبعده الشاشة بتفتح وتسيبك تدوّر على الفاتورة في قايمة.
        * والمردود بيبدأ من مورد قبل ما يبدأ من فاتورة: اللي بيمسك بضاعة راجعة عارف مين المورد،
        * وبيدوّر على أنهي فاتورة منه.
        *
        * فاختيار المورد هنا بيضيّق فواتير الخطوة اللي بعدها عليه — بدل قايمة بكل فواتير الشركة.
        */}
      {/* بوباب اختيار الصنف — نفس اللي في فاتورة الشرا، فاللي اتعلّم واحد اتعلّم الاتنين. */}
      <ProductPickerModal
        open={pickerOpen}
        title="اختر الصنف الراجع"
        categories={itemCategories}
        categoryLabels={{}}
        products={items as any}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
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
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setCreating(false)}>رجوع</Button>
          <span>تسجيل مردود شراء</span>
        </Space>
      )}>
        {/*
          * المستند ده **نسخة من فاتورة الشرا بالعكس**.
          *
          * نفس شريط الأوامر، ونفس الترويسة بنفس الترتيب — التاريخ · الفرع · الحساب · مستند رقم //
          * مورد · الحالي · العنوان · الهاتف // ملاحظات · بيان ١ · بيان ٢ · بيان ٣ — ونفس جدول
          * السطور، ونفس سلّم الأرقام تحت.
          *
          * اللي بالعكس حاجتين بس، وهما اللي بيخلّوه مردود: البضاعة **بتخرج** من المخزن بدل ما
          * تدخله، واللي على الشركة للمورد **بينقص** بدل ما يزيد.
          *
          * اللي بيكتب الاتنين هو نفس الشخص في نفس اليوم؛ شاشتين بشكلين لنفس المستند بتكلّفه
          * إعادة تعلّم كل مرة يبدّل.
          */}
        <DocumentToolbar actions={returnToolbar()} />

        <Form layout="vertical" size="small" className="doc-form">
          {/*
            * ترويسة المستند: **التاريخ ← المورد ← المستند** — نفس فاتورة الشرا بالظبط، لأن
            * المردود هو الفاتورة بالعكس.
            *
            * **الفرع · الحساب · الحالي · العنوان · الهاتف اتشالوا** — بنفس السبب اللي اتشالوا
            * بيه من فاتورة الشرا: بيانات المورد متسجّلة في النظام أصلاً وبتطلع على الورقة
            * المطبوعة لما تتطلب، والفرع بيتعرف من المخزن، وحساب المشتريات بياخد الافتراضي
            * من السيرفر زي الفاتورة. صفّين كاملين كانوا بيتاخدوا في حاجة مش داتا.
            */}
          <Row gutter={16}>
            <Col xs={12} md={5}>
              <Form.Item label="التاريخ" style={{ marginBottom: 8 }}>
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  value={returnDate} onChange={(v: Dayjs | null) => v && setReturnDate(v)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="المورد" required style={{ marginBottom: 8 }}>
                <Select open={false} showSearch={false} suffixIcon={<SearchOutlined />}
                  placeholder="اضغط لاختيار المورد" value={supplierFilter ?? undefined}
                  onClick={() => setPartyPickerOpen(true)}
                  options={suppliers} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item label="المستند" style={{ marginBottom: 8 }}>
                <Input placeholder="رقم إشعار المورد" value={externalNumber}
                  onChange={(e) => setExternalNumber(e.target.value)} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item label="ملاحظات" style={{ marginBottom: 8 }}>
                <Input placeholder="سبب الرجوع (مكسورة، ناقصة، غلط في الصنف…)"
                  value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Form.Item>
            </Col>
            {([1, 2, 3] as const).map((n) => (
              <Col xs={24} md={6} key={n}>
                <Form.Item label={`بيان ${n}`} style={{ marginBottom: 8 }}>
                  <Input placeholder="اختياري" value={statements[n - 1]}
                    onChange={(e) => setStatements((prev) => {
                      const next = [...prev]; next[n - 1] = e.target.value; return next;
                    })} />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>

        {/* فاصل من غير عنوان — الجدول اللي تحته أعمدته مكتوبة. */}
        <Divider style={{ margin: '10px 0' }} />

        <Button type="primary" danger icon={<PlusOutlined />} block
          style={{ marginBottom: 10, height: 38 }}
          onClick={() => setPickerOpen(true)}>
          إضافة صنف للمردود
        </Button>

        {returnLines.length === 0 ? (
          <Empty description="اختار الأصناف الراجعة" style={{ margin: '12px 0' }} />
        ) : (
          <div style={{ border: '1px solid #f3e0d8', borderRadius: 10, overflowX: 'auto' }}>
            <table className="entry-grid">
              <thead>
                {/* نفس أعمدة جدول الفاتورة بالظبط — من غير عمود اسم الصنف اللي اتشال منها. */}
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th style={{ minWidth: 150 }}>المخزن</th>
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
                {returnLines.map((line, idx) => (
                  <tr key={line.key}>
                    <td style={{ color: '#6b6b6b' }}>{idx + 1}</td>
                    <td>
                      {/* مخزن السطر — الفاتورة الواحدة ممكن تتوزّع على أكتر من مخزن، والمردود
                          لازم يقدر يطلّع كل صنف من مخزنه. */}
                      <Select size="small" style={{ width: '100%' }} placeholder="المخزن"
                        value={line.warehouse_id ?? warehouseId ?? undefined}
                        onChange={(v) => setReturnLines((prev) => prev.map((l) => (
                          l.key === line.key ? { ...l, warehouse_id: v ?? null } : l)))}
                        options={warehouses.map((w: any) => ({
                          value: w.id,
                          label: `${w.name} (${w.warehouse_type === 'central' ? 'مركزي' : 'فرعي'})`,
                        }))} />
                    </td>
                    <td>
                      <Select size="small" style={{ width: '100%' }} placeholder="الوحدة"
                        value={line.unit ?? '__base__'}
                        onChange={(v) => setReturnLines((prev) => prev.map((l) => (
                          l.key === line.key
                            ? { ...l, unit: v === '__base__' ? null : v } : l)))}
                        options={unitOptions(line.item_id)} />
                    </td>
                    <td>
                      <InputNumber size="small" style={{ width: '100%' }} min={0.001}
                        data-grid-col="qty" keyboard={false}
                        placeholder="الكمية" value={line.quantity ?? undefined}
                        onChange={(v) => setReturnLines((prev) => prev.map((l) => (
                          l.key === line.key ? { ...l, quantity: v as number | null } : l)))}
                        // المتاح بيتقاس عند الخانة، مش بعد ما المستند كله يتكتب.
                        onBlur={() => setReturnLines((prev) => prev.map((l) => (
                          l.key === line.key ? { ...l, quantity: guardQuantity({
                            value: l.quantity,
                            available: warehouseId ? onHand[l.item_id] : undefined,
                            itemName: itemName(l.item_id),
                          }, null) } : l)))} />
                    </td>
                    <td>
                      <InputNumber size="small" style={{ width: '100%' }} min={0} step={0.01}
                        placeholder="السعر" value={line.unit_price}
                        onChange={(v) => setReturnLines((prev) => prev.map((l) => (
                          l.key === line.key ? { ...l, unit_price: (v as number) || 0 } : l)))} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {money(Number(line.quantity || 0) * (line.unit_price || 0))}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {/* «١٠٪» مابتقولش كام اتخصم — والمراجعة بتحصل بالجنيه. */}
                      {line.discount_pct
                        ? money(Number(line.quantity || 0) * (line.unit_price || 0)
                            * (line.discount_pct / 100))
                        : '-'}
                    </td>
                    <td>
                      {/* فاضي = مفيش خصم متفق عليه، مش صفر. */}
                      <InputNumber size="small" min={0} max={99.99} step={0.5}
                        style={{ width: '100%' }} placeholder="خصم %"
                        value={line.discount_pct ?? undefined}
                        onChange={(v) => setReturnLines((prev) => prev.map((l) => (
                          l.key === line.key
                            ? { ...l, discount_pct: (v as number) ?? null } : l)))} />
                    </td>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {money(lineNet(line))}
                    </td>
                    <td>
                      <Button size="small" danger type="text" icon={<DeleteOutlined />}
                        onClick={() => setReturnLines((prev) =>
                          prev.filter((l) => l.key !== line.key))} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ fontWeight: 700 }}>الإجمالي</td>
                  <td style={{ fontWeight: 700 }}>
                    {returnLines.reduce((n, l) => n + Number(l.quantity || 0), 0)}
                  </td>
                  <td />
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {money(returnLines.reduce(
                      (n, l) => n + Number(l.quantity || 0) * (l.unit_price || 0), 0))}
                  </td>
                  <td colSpan={2} />
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {money(grossTotal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <Divider style={{ margin: '10px 0' }} />

        {/* نفس سلّم الفاتورة وبنفس الأسماء — اللي بالعكس إن ده بينقص من اللي على الشركة. */}
        <TotalsLadder
          tone="sale"
          inputs={(
            <Form layout="vertical" size="small" className="doc-form">
              <Form.Item label="خصم على المردود %" style={{ marginBottom: 0 }}
                help="بينزل على مجموع السطور بعد خصم كل سطر — زي فاتورة الشرا">
                <InputNumber style={{ width: '100%' }} min={0} max={99.99} step={0.5}
                  addonAfter="%" value={variableDiscount}
                  onChange={(v) => setVariableDiscount((v as number) || 0)} />
              </Form.Item>
            </Form>
          )}
          rows={[
            { label: 'اجمالي قبل', value: grossTotal.toFixed(2) },
            { label: 'خصم المردود',
              value: `\u2212 ${(grossTotal - draftValue).toFixed(2)}`,
              color: '#cf1322', show: variableDiscount > 0.001 },
            { label: 'خصم المردود %', value: `${variableDiscount}%`,
              show: variableDiscount > 0.001 },
            { label: 'قيمة المردود', value: draftValue.toFixed(2),
              big: true, rule: true, color: '#cf4b1a' },
          ]}
        />

        <div style={{
          marginTop: 16, padding: 16, borderRadius: 10,
          background: '#fdf6f3', border: '1px solid #f3e0d8',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <Button type="primary" danger loading={saving} onClick={submit}>
            ترحيل المردود
          </Button>
          {/* الرجوع من غير ترحيل مابيغيّرش حاجة — العكس بيحصل وقت الحفظ. */}
          <Button
            onClick={() => { setCreating(false); setEditingId(null);
              setSupplierFilter(null); }}>إلغاء</Button>
        </div>
      </Card>
      )}

      {/* المردود بعد ما اترحّل — نفس الصفحة، بس مقفولة.
          It moved goods back to the supplier and wrote a ledger entry, and there is no edit
          endpoint for one: the way to undo it is to buy the goods again, which is a real event
          with its own paper rather than a quiet rewrite of this one. */}
      {/*
        * المستند في بوباب — عرض ومعاينة طباعة في نفس الحتة، زي سجل الشرا بالظبط.
        *
        * كان بيحل محل السجل: تفتح مردود، السجل يختفي، وترجع تدوّر على السطر اللي كنت واقف
        * عليه. البوباب بيسيب السجل تحته زي ما هو.
        */}
      <TabModal
        open={!!viewing} onCancel={() => setViewing(null)} width={900} centered destroyOnHidden
        title={viewing ? `مردود شراء ${viewing.document_number}` : 'معاينة'}
        footer={invoiceFooter(returnDoc(viewing), () => setViewing(null))}
      >
        {viewing ? <InvoiceDocument doc={returnDoc(viewing)!} /> : null}
      </TabModal>
    </div>
  );
}

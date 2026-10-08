import React, { useEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import {
  Alert, Button, Card, Col, DatePicker, Empty, Form, Input, Row, Select,
  Space, Tag, message,
} from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  DeleteOutlined, PlusOutlined, ReloadOutlined, ArrowLeftOutlined, FileAddOutlined,
  SaveOutlined, UndoOutlined, EditOutlined, SearchOutlined, ArrowRightOutlined,
  PrinterOutlined, BankOutlined, CheckOutlined, FileTextOutlined, ClearOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { netOf, MAX_DISCOUNT_PCT } from '../utils/discounts';
import { useQueryTab } from '../components/useQueryTab';
import { useDocRoute } from '../components/useDocRoute';
import DocOpening from '../components/DocOpening';
import DocumentLink from '../components/DocumentLink';
import { useListFilter } from '../components/ListToolbar';
import ListPage from '../components/ListPage';
import ExportExcelButton from '../components/ExportExcelButton';
import DateRangeFilter from '../components/DateRangeFilter';
import { useScreenShortcuts } from '../components/keyboard';
import { matchesStatement } from '../utils/statements';
import ProductPickerModal from '../components/ProductPickerModal';
import { useLookup, labelMap } from '../hooks/useLookup';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import { useEntryGrid, type EntryColumn } from '../components/EntryGrid';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import DocumentHistoryButton from '../components/DocumentHistory';
import SummaryTile from '../components/saleDoc/SummaryTile';
import DocumentAttachments from '../components/DocumentAttachments';
import { printReport } from '../print/reportSheet';
import { QTY_DATA_ATTR } from '../utils/duplicateItem';
import { addPickedSequentially, type PickResult } from '../utils/pickMany';
import { money, numeralsLocale, qty } from '../utils/money';
import { unitSelectOptions } from '../utils/units';
import './docs.extra.css';

type Kind = 'sale' | 'purchase';

interface OrderLine {
  id: number; item_id: number; item_name: string | null;
  quantity: string; unit_price: string;
  unit: string | null; unit_factor: string | null; discount_pct: string | null;
  line_total: string; notes: string | null;
}

interface Order {
  id: number; document_number: string; kind: Kind; status: string;
  customer_id: number | null; supplier_id: number | null;
  order_date: string | null; due_date: string | null; warehouse_id: number | null;
  gross: string; variable_discount_pct: string; total: string; notes: string | null;
  statement1?: string | null;
  converted_invoice_id: number | null; converted_at: string | null;
  created_at: string | null; lines: OrderLine[];
}

interface DraftLine {
  key: number;
  item_id?: number;
  quantity?: number;
  unit_price?: number;
  unit?: string | null;
  discount_pct?: number;
}

const STATUS_LABELS: Record<string, { text: string; color?: string }> = {
  open: { text: 'مفتوح', color: 'blue' },
  converted: { text: 'تم التحويل إلى فاتورة', color: 'green' },
  cancelled: { text: 'ملغي' },
};

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Order | null>(null);

  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useQueryTab('sale', 'kind') as unknown as [Kind, (k: Kind) => void];
  const [sheetDate, setSheetDate] = useState<Dayjs>(dayjs());
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  const [discountPct, setDiscountPct] = useState(0);
  const [unitsCache, setUnitsCache] = useState<Record<number,
    { name: string; factor: number; is_base: boolean }[]>>({});
  const [notes, setNotes] = useState('');
  const [statement1, setStatement1] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusLineKey, setFocusLineKey] = useState<number | null>(null);
  const keySeq = useRef(0);
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [invoiceId, setInvoiceId] = useState<number | undefined>();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/orders');
      setOrders(res.data || []);
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الطلبات');
    } finally { setLoading(false); }
  };

  const openOrder = (o: Order) => { setCreating(false); setDetail(o); markOpen(o.id); };

  const { markOpen, markClosed, opening: docOpening } = useDocRoute<Order>({
    rows: orders,
    openId: detail?.id ?? null,
    open: (o) => openOrder(o),
    close: () => closeDoc(),
    loading,
    fetchOne: async (id) => {
      try {
        return (await api.get(`/api/v1/orders/${id}`)).data as Order;
      } catch {
        message.warning(`الطلب رقم ${id} مش موجود`);
        return null;
      }
    },
  });

  const closeDoc = () => { setDetail(null); markClosed(); };

  useEffect(() => {
    load();
    Promise.all([
      api.get('/api/v1/items'), api.get('/api/v1/customers/options', { params: { limit: 20000 } }),
      api.get('/api/v1/suppliers'),
    ]).then(([i, c, s]) => {
      setItems(i.data || []); setCustomers(c.data || []);
      setSuppliers(s.data || []);
    }).catch((err: any) => {
      console.error(err);
      message.error('تعذر تحميل بيانات الأصناف والعملاء والموردين');
    });
  }, []);

  const kindLabel = kind === 'sale' ? 'بيع' : 'شرا';
  const sheetName = `تسعيرة ${kindLabel}`;

  const partyName = (o: Order) => (o.kind === 'sale'
    ? (o as any).customer_name || customers.find((c) => c.id === o.customer_id)?.name
    : suppliers.find((s) => s.id === o.supplier_id)?.name) || '-';

  const filter = useListFilter(orders, {
    initialValues: { kind },
    search: (o) => [o.document_number, partyName(o), o.notes, o.statement1],
    filters: {
      statement: (o, v) => matchesStatement(o, v),
      kind: (o, v) => o.kind === v,
      status: (o, v) => o.status === v,
    },
    dateOf: (o) => o.order_date || o.created_at,
  });

  const storedPrice = (itemId?: number) => {
    const it = items.find((i) => i.id === itemId);
    const raw = kind === 'sale' ? it?.sale_price : it?.purchase_price;
    return Number(raw) || 0;
  };

  const storedDiscount = (itemId?: number) => {
    const it = items.find((i) => i.id === itemId);
    return Number(it?.default_discount_pct) || 0;
  };

  const lineGross = (l: DraftLine) => Number(l.quantity || 0) * Number(l.unit_price || 0);
  const lineNet = (l: DraftLine) => lineGross(l)
    * (1 - Math.min(MAX_DISCOUNT_PCT, Number(l.discount_pct || 0)) / 100);

  const lineColumns: EntryColumn<DraftLine>[] = [
    { key: 'idx', title: '#', width: 34, locked: true,
      cellStyle: { color: '#6b6b6b' },
      cell: (_l, i) => i + 1 },
    { key: 'item', title: 'الصنف', width: 220, minWidth: 120, locked: true,
      cell: (line) => {
        const name = items.find((i) => i.id === line.item_id)?.name ?? `صنف #${line.item_id}`;
        return <b className="eg-ellipsis" title={name}>{name}</b>;
      } },
    { key: 'unit', title: 'الوحدة', width: 90,
      cell: (line) => (
        <Select size="small" style={{ width: '100%' }}
          value={line.unit ?? '__base__'}
          onChange={(v) => setLines((prev) => prev.map((l) => {
            if (l.key !== line.key) return l;
            const unit = v === '__base__' ? null : v;
            const factor = (unitsCache[l.item_id || 0] || [])
              .find((u) => u.name === unit)?.factor ?? 1;
            return { ...l, unit, unit_price: Math.round(storedPrice(l.item_id) * factor * 100) / 100 };
          }))}
          options={unitOptions(line.item_id)} />
      ) },
    { key: 'qty', title: 'الكمية', width: 95, locked: true,
      cellProps: (line) => (line.item_id != null
        ? { [QTY_DATA_ATTR]: line.item_id } as any : {}),
      cell: (line) => (
        <InputNumber size="small" min={0} style={{ width: '100%' }}
          data-qty-key={line.key} data-grid-col="qty" keyboard={false}
          placeholder="الكمية" value={line.quantity}
          onChange={(q) => setLines((prev) => prev.map((l) => (l.key === line.key
            ? { ...l, quantity: q as number } : l)))}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ) },
    { key: 'price', title: 'سعر الوحدة', width: 100,
      cell: (line) => (
        <InputNumber size="small" min={0} step={0.01} style={{ width: '100%' }}
          data-grid-col="price" keyboard={false}
          placeholder="السعر" value={line.unit_price}
          onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key
            ? { ...l, unit_price: v as number } : l)))}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ) },
    { key: 'gross', title: 'اجمالي قبل', width: 100,
      cellStyle: { whiteSpace: 'nowrap' },
      cell: (line) => money(lineGross(line)) },
    { key: 'disc_value', title: 'خصم', width: 95,
      cellStyle: { whiteSpace: 'nowrap' },
      cell: (line) => money(lineGross(line) - lineNet(line)) },
    { key: 'disc_pct', title: 'خصم %', width: 70,
      cell: (line) => (
        <InputNumber size="small" min={0} max={99.99} step={0.5}
          style={{ width: '100%' }} keyboard={false} placeholder="٠"
          value={line.discount_pct}
          onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key
            ? { ...l, discount_pct: (v as number) ?? 0 } : l)))}
          onPressEnter={(e) => { e.preventDefault(); advanceFrom(line.key); }} />
      ) },
    { key: 'total', title: 'الإجمالي', width: 110, locked: true,
      cellStyle: { whiteSpace: 'nowrap', fontWeight: 700 },
      cell: (line) => money(lineNet(line)) },
    { key: 'actions', title: '', label: 'حذف السطر', width: 50, minWidth: 40, locked: true,
      cell: (line) => (
        <Button type="text" danger size="small" icon={<DeleteOutlined />}
          onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} />
      ) },
  ];
  const lineGrid = useEntryGrid('pricing-sheet-lines', lineColumns);

  const grossTotal = lines.reduce((sum, l) => sum + lineGross(l), 0);
  const netBeforeDoc = lines.reduce((sum, l) => sum + lineNet(l), 0);
  const draftTotal = netOf(netBeforeDoc, Math.min(MAX_DISCOUNT_PCT, discountPct));

  const startNew = (k: Kind) => {
    setKind(k); setLines([]); setCreating(true);
  };

  const fetchUnits = async (itemId: number) => {
    if (unitsCache[itemId]) return;
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitsCache((prev) => ({ ...prev, [itemId]: (res.data.units || []).map((u: any) => ({
        name: u.name, factor: parseFloat(u.factor), is_base: u.is_base })) }));
    } catch (err) { console.error(err); }
  };

  const unitOptions = (itemId?: number) => unitSelectOptions(unitsCache[itemId || 0]);

  const unitFactor = (l: DraftLine) => (l.unit
    ? (unitsCache[l.item_id || 0] || []).find((u) => u.name === l.unit)?.factor ?? 1
    : 1);

  const advanceFrom = (key: number) => {
    const idx = lines.findIndex((l) => l.key === key);
    const next = idx >= 0 ? lines[idx + 1] : undefined;
    if (next) { setFocusLineKey(next.key); return; }
    setPickerOpen(true);
  };

  const sheetToolbar = (): ToolbarAction[] => {
    const typed = lines.filter((l) => l.item_id).length;
    const clear = () => {
      setLines([]); setNotes(''); setStatement1(''); setDueDate(null);
      setSheetDate(dayjs()); setDiscountPct(0);
    };
    const stepList = (step: number) => {
      const rows = filter.filtered;
      if (!rows.length) return;
      const at = rows.findIndex((r) => r.id === detail?.id);
      const target = at >= 0 ? rows[at + step]
        : (step > 0 ? rows[0] : rows[rows.length - 1]);
      if (target) openOrder(target);
    };
    return [
      { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />, onClick: clear },
      { key: 'edit', label: 'تعديل', icon: <EditOutlined />, disabled: true },
      { key: 'undo', label: 'تراجع', icon: <UndoOutlined />, disabled: typed === 0,
        onClick: () => setLines([]) },
      { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
        disabled: typed === 0, onClick: submit },
      { key: 'search', label: 'بحث', shortcut: 'F3', icon: <SearchOutlined />,
        onClick: () => setPickerOpen(true) },
      { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />,
        disabled: filter.filtered.length === 0, onClick: () => stepList(-1) },
      { key: 'next', label: 'التالى', icon: <ArrowLeftOutlined />,
        disabled: filter.filtered.length === 0, onClick: () => stepList(1) },
      { key: 'delete', label: 'حذف', shortcut: 'F8', icon: <DeleteOutlined />, danger: true,
        disabled: typed === 0, onClick: clear },
      { key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />,
        disabled: typed === 0,
        onClick: () => printOrder(draftAsOrder()) },
      { key: 'accounts', label: 'حسابات', icon: <BankOutlined />, disabled: true },
      { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />, onClick: load },
    ];
  };

  const printOrder = (o: Order) => {
    const rows = o.lines.map((l, i) => ({
      no: i + 1,
      item: l.item_name ?? `صنف #${(l as any).item_id ?? ''}`,
      unit: l.unit ?? 'الأساسية',
      quantity: qty(l.quantity),
      price: money(l.unit_price),
      gross: money(Number(l.quantity || 0) * Number(l.unit_price || 0)),
      disc: Number(l.discount_pct || 0) ? `${Number(l.discount_pct)}%` : '-',
      total: money(l.line_total != null
        ? l.line_total
        : Number(l.quantity || 0) * Number(l.unit_price || 0)
          * (1 - Math.min(MAX_DISCOUNT_PCT, Number(l.discount_pct || 0)) / 100)),
    }));
    const pct = Number(o.variable_discount_pct || 0);
    printReport(
      {
        title: o.kind === 'sale' ? 'تسعيرة بيع' : 'تسعيرة شراء',
        number: o.document_number || '',
        date: o.order_date ? String(o.order_date).slice(0, 10) : undefined,
        meta: [
          ...(o.due_date
            ? [['ساري لحد', String(o.due_date).slice(0, 10)]] as [string, string][]
            : []),
          ...(o.statement1 ? [['البيان', o.statement1]] as [string, string][] : []),
          ...(o.notes ? [['ملاحظات', o.notes]] as [string, string][] : []),
        ],
        note: 'ورقة تسعير — لا تحرّك مخزوناً ولا خزينة.',
      },
      [
        { title: '#', value: 'no' },
        { title: 'الصنف', value: 'item' },
        { title: 'الوحدة', value: 'unit' },
        { title: 'الكمية', value: 'quantity', numeric: true },
        { title: 'سعر الوحدة', value: 'price', numeric: true },
        { title: 'اجمالي قبل', value: 'gross', numeric: true },
        { title: 'خصم', value: 'disc', numeric: true },
        { title: 'الإجمالي', value: 'total', numeric: true },
      ],
      rows,
      [
        { label: 'عدد الأصناف', value: String(rows.length) },
        { label: 'قبل الخصم', value: money(o.gross) },
        ...(pct > 0.001
          ? [{ label: `خصم الورقة ${pct}%`, value: money(Number(o.gross) - Number(o.total)) }]
          : []),
        { label: 'الإجمالي', value: money(o.total) },
      ],
    );
  };

  const draftAsOrder = (): Order => ({
    id: 0,
    document_number: '',
    kind,
    status: 'open',
    customer_id: null,
    supplier_id: null,
    order_date: sheetDate.format('YYYY-MM-DD'),
    due_date: dueDate ? dueDate.format('YYYY-MM-DD') : null,
    warehouse_id: null,
    gross: String(grossTotal),
    variable_discount_pct: String(discountPct || 0),
    total: String(draftTotal),
    notes: notes || null,
    statement1: statement1 || null,
    converted_invoice_id: null,
    converted_at: null,
    created_at: null,
    lines: lines.filter((l) => l.item_id).map((l) => ({
      id: l.key,
      item_id: l.item_id as number,
      item_name: items.find((it) => it.id === l.item_id)?.name ?? null,
      quantity: String(l.quantity ?? 0),
      unit_price: String(l.unit_price ?? 0),
      unit: l.unit ?? null,
      unit_factor: String(unitFactor(l)),
      discount_pct: String(l.discount_pct ?? 0),
      line_total: String(lineNet(l)),
      notes: null,
    })),
  });

  const addItem = (itemId: number, qty: number | null = null): PickResult => {
    const existing = lines.find((l) => l.item_id === itemId);
    if (existing) {
      const name = items.find((i) => i.id === itemId)?.name ?? `صنف #${itemId}`;
      if (qty) {
        setLines((prev) => prev.map((l) => (l.key === existing.key
          ? { ...l, quantity: Number(l.quantity || 0) + qty } : l)));
        message.info(`«${name}» موجود بالفعل — اتزوّدت كميته`);
      } else {
        message.info(`«${name}» موجود بالفعل — عدّل الكمية من السطر`);
      }
      return { dup: itemId };
    }
    const key = Math.max(lines[lines.length - 1]?.key ?? 0, keySeq.current) + 1;
    keySeq.current = key;
    setLines((prev) => [...prev, { key, item_id: itemId,
      ...(qty ? { quantity: qty } : {}),
      unit_price: storedPrice(itemId),
      unit: null, discount_pct: storedDiscount(itemId) }]);
    void fetchUnits(itemId);
    return qty ? null : { needsQty: key };
  };

  useEffect(() => {
    if (focusLineKey === null || pickerOpen) return undefined;
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

  const submit = async () => {
    const payload = lines
      .filter((l) => l.item_id && Number(l.quantity) > 0)
      .map((l) => ({
        item_id: l.item_id, quantity: String(l.quantity),
        unit_price: String(l.unit_price ?? 0),
        unit: l.unit ?? null,
        unit_factor: String(unitFactor(l)),
        discount_pct: String(l.discount_pct ?? 0),
      }));
    if (!payload.length) { message.warning('أضف سطراً واحداً على الأقل'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/orders', {
        kind,
        customer_id: null,
        supplier_id: null,
        warehouse_id: null,
        order_date: sheetDate.format('YYYY-MM-DD'),
        due_date: dueDate ? dueDate.format('YYYY-MM-DD') : null,
        variable_discount_pct: String(discountPct || 0),
        notes: notes || null, statement1: statement1 || null, lines: payload,
      });
      message.success('تم تسجيل الطلب');
      setCreating(false);
      setLines([]); setNotes(''); setStatement1(''); setDueDate(null); setDiscountPct(0);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ الطلب');
    } finally { setSaving(false); }
  };

  const convert = async () => {
    if (!detail || !invoiceId) { message.warning('اكتب رقم الفاتورة'); return; }
    try {
      await api.post(`/api/v1/orders/${detail.id}/convert`, { invoice_id: invoiceId });
      message.success('اتربط الطلب بالفاتورة');
      closeDoc(); setInvoiceId(undefined); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر ربط الطلب');
    }
  };

  const cancel = async (o: Order) => {
    try {
      await api.post(`/api/v1/orders/${o.id}/cancel`);
      message.success('تم إلغاء الطلب');
      closeDoc(); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إلغاء الطلب');
    }
  };

  const docOpen = creating || !!detail;

  const columns: ColumnsType<Order> = [
    { title: 'رقم الطلب', dataIndex: 'document_number',
      render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الطرف', render: (_: any, r: Order) => partyName(r) },
    { title: 'التاريخ', dataIndex: 'order_date',
      render: (d: string, r) => (d || r.created_at || '').slice(0, 10) },
    { title: 'الاستحقاق', dataIndex: 'due_date',
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'عدد الأصناف', dataIndex: 'lines',
      render: (l: OrderLine[]) => l.length },
    { title: 'البيان', dataIndex: 'statement1', ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'الإجمالي', dataIndex: 'total', align: 'left',
      render: (v: string) => <b>{money(v)}</b> },
    { title: 'الحالة', dataIndex: 'status',
      render: (s: string, r) => (
        <>
          <Tag color={STATUS_LABELS[s]?.color}>{STATUS_LABELS[s]?.text || s}</Tag>
          {r.converted_invoice_id && (
            <DocumentLink kind="invoice" id={r.converted_invoice_id} size="small"
              label={`فاتورة #${r.converted_invoice_id}`} />
          )}
        </>
      ) },
  ];

  const tableCols = useTableColumns('orders', columns);

  const listSearchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { listSearchRef.current?.focus?.(); } }, !docOpen);

  const shownTotal = filter.filtered.reduce((n, o) => n + Number(o.total || 0), 0);
  const listFooter = (
    <span className="sl-foot">
      <span>إجمالي السجلات: <b>{filter.filtered.length.toLocaleString(numeralsLocale())}</b> طلب</span>
      <span>إجمالي المعروض: <b>{money(shownTotal)}</b></span>
    </span>
  );

  if (docOpening) return <DocOpening />;
  return (
    <>
    {!docOpen && (
    <ListPage
      icon={<FileTextOutlined />}
      title={`شيت تسعير ${kindLabel}`} muted={`(سجل طلبات ال${kind === 'sale' ? 'بيع' : 'شراء'})`}
      subtitle="ورقة تسعير — لا تحرّك مخزوناً ولا خزينة. اكتب أي كمية بغض النظر عن المتاح، وعند تأكيد البيع أنشئ الفاتورة واربطها بالطلب."
      actions={(<>
        <Button type="primary" icon={<PlusOutlined />} className="sl-create"
          onClick={() => startNew(kind)}>{sheetName}</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        <ExportExcelButton name={`شيت تسعير ${kindLabel}`} rows={filter.filtered}
          tableColumns={tableCols.columns as any} style={{ marginInlineStart: 0 }} />
        {tableCols.control}
      </>)}
      filters={(<>
        <Input
          className="sl-f-search"
          allowClear
          ref={listSearchRef}
          value={filter.query}
          placeholder="بحث برقم الطلب أو الملاحظات أو البيان"
          prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)}
        />
        <Select allowClear showSearch mode="multiple" maxTagCount="responsive"
          placeholder="الحالة"
          value={filter.values.status ?? undefined}
          onChange={(v: any[]) => filter.setValue('status', v?.length ? v : undefined)}
          options={[
            { value: 'open', label: 'مفتوح' },
            { value: 'converted', label: 'تم التحويل' },
            { value: 'cancelled', label: 'ملغي' }]} />
        <Input allowClear placeholder="البيان"
          value={filter.values.statement ?? undefined}
          onChange={(e) => filter.setValue('statement', e.target.value || undefined)} />
        <DateRangeFilter className="sl-f-dates"
          value={filter.range ?? null}
          onChange={(v) => filter.setRange(v)} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table<Order>
        className="sl-table"
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        onRow={(r) => ({ onClick: () => openOrder(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد طلبات' }}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true,
          locale: { items_per_page: '' },
          showTotal: () => listFooter,
        }}
        scroll={{ x: 'max-content' }}
        columns={tableCols.columns}
      />
    </ListPage>
    )}

      <ProductPickerModal
        open={pickerOpen}
        title={kind === 'sale' ? 'اختر الصنف المطلوب' : 'اختر الصنف المطلوب شراؤه'}
        hidePurchasePrice={kind === 'sale'}
        categories={[...new Set(items.map((i) => i.category).filter(Boolean))] as string[]}
        categoryLabels={categoryLabels}
        products={items}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        onCancel={() => setPickerOpen(false)}
        onPick={(id, q) => {
          setPickerOpen(false);
          addPickedSequentially([id], q ? { [id]: q } : undefined, addItem, setFocusLineKey);
        }}
        onPickMany={(ids, qtys) => {
          setPickerOpen(false);
          addPickedSequentially(ids, qtys, addItem, setFocusLineKey);
        }} />

      {creating && (
      <div className="sale-doc">
        <div className="sale-card sale-head">
          <div className="sale-head-row">
            <Button size="small" icon={<ArrowRightOutlined />}
              onClick={() => setCreating(false)}>رجوع</Button>
            <span className="sale-title">{sheetName}</span>
            <div className="sale-toolbar-row">
              <DocumentToolbar actions={sheetToolbar()} variant="buttons" />
              {lineGrid.control}
            </div>
          </div>
        </div>

        <Form layout="vertical" size="small" className="doc-form sale-form" requiredMark={false}>

          <div className="sale-card sale-fields">
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item label="التاريخ">
                <DatePicker style={{ width: '100%' }} allowClear={false} format="YYYY-MM-DD"
                  value={sheetDate} onChange={(v) => setSheetDate(v || dayjs())} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="ساري لحد">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD"
                  placeholder="اختياري" value={dueDate} onChange={setDueDate} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="ملاحظات">
                <Input placeholder="اختياري" value={notes}
                  onChange={(e) => setNotes(e.target.value)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="البيان">
                <Input placeholder="اختياري — بيتطبع على الورقة" value={statement1}
                  maxLength={200} onChange={(e) => setStatement1(e.target.value)} />
              </Form.Item>
            </Col>
          </Row>
          </div>

          <div className="sale-card sale-lines">
            <div className="sale-items-bar">
              <div className="sale-items-info">
                <span>
                  عدد البنود الحالية: <b style={{ color: '#0f172a' }}>
                    {lines.filter((l) => l.item_id).length}</b> أصناف
                </span>
              </div>
              <Button data-shortcut="F2"
                type="primary" className="sale-green-btn" icon={<PlusOutlined />}
                style={{ fontWeight: 700 }}
                onClick={() => setPickerOpen(true)}
              >
                إضافة صنف للتسعيرة
              </Button>
            </div>

            {lines.length === 0 ? (
              <Empty description="اختر الفئة ثم الأصناف المراد تسعيرها"
                style={{ margin: '12px 0' }} />
            ) : (
              <div className="sale-grid-wrap">
                <table {...lineGrid.tableProps}>
                  {lineGrid.cols}
                  <thead>{lineGrid.head}</thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <tr key={line.key}>{lineGrid.row(line, idx)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="sale-bottom">
            <Row gutter={[10, 10]}>
              <Col xs={24} lg={16}>
                <div className="sale-tiles">
                  <SummaryTile label="عدد الأصناف"
                    value={String(lines.filter((l) => l.item_id).length)} />
                  <SummaryTile label="الإجمالي قبل الخصم" value={money(grossTotal)} />
                  {grossTotal - netBeforeDoc > 0.005 && (
                    <SummaryTile label="خصم السطور" value={`− ${money(grossTotal - netBeforeDoc)}`}
                      color="#dc2626" />
                  )}
                  {netBeforeDoc - draftTotal > 0.005 && (
                    <SummaryTile label={`خصم الورقة ${discountPct}%`}
                      value={`− ${money(netBeforeDoc - draftTotal)}`} color="#dc2626" />
                  )}
                  <SummaryTile label="الإجمالي" value={money(draftTotal)} color="#16a34a"
                    tone="mint" />
                </div>
              </Col>
              <Col xs={24} lg={8}>
                <div className="sale-card sale-pay">
                  <Form.Item label="خصم على إجمالي الورقة">
                    <InputNumber min={0} max={99.99} style={{ width: '100%' }} addonAfter="%"
                      value={discountPct} onChange={(v) => setDiscountPct(v || 0)} />
                  </Form.Item>
                  <div className="sale-pay-note">ورقة تسعير — لا مخزون يتحرك ولا أموال تُقيَّد.</div>
                  <div className="sale-pay-actions">
                    <Button type="primary" loading={saving} onClick={submit}
                      icon={<CheckOutlined />} className="sale-green-btn sale-save-btn">
                      حفظ التسعيرة (F9)
                    </Button>
                    <Button onClick={() => setCreating(false)}>إلغاء</Button>
                  </div>
                </div>
              </Col>
            </Row>
          </div>
        </Form>
      </div>
      )}

      {detail && (
      <div className="sale-doc">
        <div className="sale-card sale-head">
          <div className="sale-head-row">
            <Button size="small" icon={<ArrowRightOutlined />} onClick={closeDoc}>رجوع</Button>
            <span className="sale-title">
              {detail.kind === 'sale' ? 'تسعيرة بيع' : 'تسعيرة شراء'} رقم:{' '}
              <b dir="ltr">{detail.document_number}</b>
            </span>
            <Tag color={STATUS_LABELS[detail.status]?.color} style={{ marginInlineEnd: 0 }}>
              {STATUS_LABELS[detail.status]?.text}
            </Tag>
            <div className="sale-toolbar-row">
              <Button icon={<PrinterOutlined />}
                onClick={() => printOrder(detail)}>طباعة</Button>
              <DocumentHistoryButton entityType="sales_order" entityId={detail.id}
                documentNumber={detail.document_number} />
              {detail.status === 'open' && (
                <Popconfirm title="إلغاء الطلب؟" onConfirm={() => cancel(detail)}
                  okText="إلغاء الطلب" cancelText="رجوع">
                  <Button danger>إلغاء الطلب</Button>
                </Popconfirm>
              )}
            </div>
          </div>
        </div>

        <div className="sale-form">
          <Form layout="vertical" size="small" component={false}>
          <div className="sale-card sale-fields">
            <Row gutter={12}>
              <Col xs={12} md={4}>
                <Form.Item label="النوع">
                  <Input readOnly
                    value={detail.kind === 'sale' ? 'تسعيرة بيع' : 'تسعيرة شراء'} />
                </Form.Item>
              </Col>
              <Col xs={12} md={5}>
                <Form.Item label="الطرف">
                  <Input readOnly value={partyName(detail)} />
                </Form.Item>
              </Col>
              <Col xs={12} md={4}>
                <Form.Item label="الاستحقاق">
                  <Input readOnly dir="ltr"
                    value={detail.due_date ? String(detail.due_date).slice(0, 10) : '-'} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label="البيان">
                  <Input readOnly value={detail.statement1 || '-'} />
                </Form.Item>
              </Col>
              <Col xs={24} md={5}>
                <Form.Item label="ملاحظات">
                  <Input readOnly value={detail.notes || '-'} />
                </Form.Item>
              </Col>
            </Row>
          </div>
          </Form>

          <div className="sale-card sale-lines">
            <div className="sale-items-bar">
              <div className="sale-items-info">
                <span>
                  عدد البنود: <b style={{ color: '#0f172a' }}>{detail.lines.length}</b> أصناف
                </span>
              </div>
            </div>
            <div className="sale-grid-wrap">
              <Table<OrderLine>
                className="sale-grid"
                rowKey="id" size="small" dataSource={detail.lines} pagination={false}
                columns={[
                  { title: 'الصنف', dataIndex: 'item_name' },
                  { title: 'الوحدة', dataIndex: 'unit', render: (v: string | null) => v || 'الأساسية' },
                  { title: 'الكمية', dataIndex: 'quantity', render: (v: string) => qty(v) },
                  { title: 'السعر', dataIndex: 'unit_price', render: (v: string) => money(v) },
                  { title: 'اجمالي قبل', render: (_: any, r: OrderLine) => money(
                    Number(r.quantity || 0) * Number(r.unit_price || 0)) },
                  { title: 'خصم %', dataIndex: 'discount_pct',
                    render: (v: string | null) => (Number(v || 0) ? `${Number(v)}%` : '-') },
                  { title: 'الإجمالي', dataIndex: 'line_total',
                    render: (v: string) => <b>{money(v)}</b> },
                ]}
              />
            </div>
          </div>

          {detail.status === 'open' && (
            <div className="sale-card">
              <div className="sale-items-bar">
                <span className="sale-title">ربط بفاتورة</span>
              </div>
              <Space wrap>
                <InputNumber placeholder="رقم الفاتورة" value={invoiceId}
                  onChange={(v) => setInvoiceId(v as number)} style={{ width: 160 }} />
                <Button type="primary" className="sale-green-btn" onClick={convert}>ربط</Button>
              </Space>
              <div style={{ color: '#64748b', marginTop: 8, fontSize: 14 }}>
                اعمل الفاتورة من شاشة الفواتير الأول عشان تعدّي على كل الفحوصات (التوافر
                والتكلفة والقيد)، وبعدين اربطها بالطلب هنا. الربط بيحصل مرة واحدة بس.
              </div>
            </div>
          )}

          {detail.converted_invoice_id && (
            <Alert type="success" showIcon
              message={`اتحوّل لفاتورة رقم #${detail.converted_invoice_id}`}
              action={<DocumentLink kind="invoice" id={detail.converted_invoice_id}
                size="small" allowEdit onNavigate={() => setDetail(null)} />} />
          )}

          <div className="sale-card sale-notes">
            <div className="sale-attach">
              <DocumentAttachments docType="trade_order" docId={detail.id} title="مرفقات" />
            </div>
          </div>

          <div className="sale-bottom">
            <Row gutter={[10, 10]}>
              <Col xs={24} lg={16}>
                <div className="sale-tiles">
                  <SummaryTile label="عدد الأصناف" value={String(detail.lines.length)} />
                  <SummaryTile label="قبل الخصم" value={money(detail.gross)} />
                  <SummaryTile label="خصم الورقة"
                    value={Number(detail.variable_discount_pct || 0)
                      ? `${Number(detail.variable_discount_pct)}%` : '-'} />
                  <SummaryTile label="الإجمالي" value={money(detail.total)} color="#16a34a"
                    tone="mint" />
                </div>
              </Col>
              <Col xs={24} lg={8}>
                <div className="sale-card sale-pay">
                  <div className="sale-pay-actions">
                    <Button className="sale-save-btn" onClick={closeDoc}>إغلاق</Button>
                  </div>
                </div>
              </Col>
            </Row>
          </div>
        </div>
      </div>
      )}
    </>
  );
}

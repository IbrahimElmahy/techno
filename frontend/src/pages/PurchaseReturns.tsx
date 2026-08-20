import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Card, DatePicker, Descriptions, Divider, Form, Input, InputNumber, Select,
  Space, Table, Tag, message
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, DeleteOutlined, ArrowLeftOutlined, EyeOutlined, PrinterOutlined,
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
  /** المورد اللي اتختار من الباب — بيضيّق فواتير الشرا اللي بيتختار منها. */
  const [supplierFilter, setSupplierFilter] = useState<number | null>(null);
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
      const [r, p, i] = await Promise.all([
        api.get('/api/v1/purchases/returns'),
        api.get('/api/v1/purchases'),
        api.get('/api/v1/items'),
      ]);
      setRows(r.data || []); setPurchases(p.data || []); setItems(i.data || []);
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

  const draftValue = useMemo(() => {
    if (!detail) return 0;
    return (detail.lines as PurchaseLine[]).reduce((sum, ln) => {
      const q = qty[ln.item_id];
      return sum + (q ? q * Number(ln.unit_price || 0) : 0);
    }, 0);
  }, [detail, qty]);

  const submit = async () => {
    if (!purchaseId) { message.warning('اختر فاتورة الشراء الأول'); return; }
    const lines = Object.entries(qty)
      .filter(([, q]) => q && Number(q) > 0)
      .map(([itemId, q]) => ({ item_id: Number(itemId), quantity: String(q) }));
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
      await api.post(`/api/v1/purchases/${purchaseId}/returns`, {
        lines,
        return_date: returnDate.format('YYYY-MM-DD'),
        notes: notes || null,
      });
      message.success(editingId !== null
        ? 'اتعدّل المردود واترحّل من جديد' : 'اتسجّل مردود الشراء');
      setEditingId(null);
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
      <PartyPickerModal
        open={newStep === 'party'} kind="supplier" kinds={['supplier', 'customer']}
        date={returnDate} onDateChange={(d) => setReturnDate(d)}
        onPick={(picked) => {
          setNewStep(null);
          setSupplierFilter(picked.id);
          setCreating(true);
        }}
        onCancel={() => setNewStep(null)} />

      {creating && (
      <Card title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setCreating(false)}>رجوع</Button>
          <span>تسجيل مردود شراء</span>
        </Space>
      )}>
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="المردود بيتعمل على فاتورة شراء"
          description="اختار الفاتورة الأول، وبعدها اكتب الكمية الراجعة قدام كل صنف. السعر بيتاخد من الفاتورة نفسها."
        />

        {/* نفس الضغط اللي في فاتورة الشرا — `doc-form` معرّف في `index.css`. */}
        <Form layout="vertical" size="small" className="doc-form">
          <Form.Item label="تاريخ المردود">
            <DatePicker style={{ width: '100%' }} value={returnDate}
              onChange={(v: Dayjs | null) => v && setReturnDate(v)} />
          </Form.Item>
          <Form.Item label="ملاحظات">
            <Input placeholder="سبب الرجوع (مكسورة، ناقصة، غلط في الصنف…)"
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Form.Item>
          <Form.Item label="فاتورة الشراء" required>
            <Select
              showSearch optionFilterProp="label" value={purchaseId} onChange={choosePurchase}
              placeholder="اختر فاتورة الشراء"
              // المورد اللي اتختار من الباب بيضيّق القايمة عليه — بدل كل فواتير الشركة.
              // ولو محدش اتختار (دخلت من مكان تاني) القايمة بتفضل كاملة.
              options={purchases
                .filter((p: any) => !supplierFilter || p.supplier_id === supplierFilter)
                .map((p) => {
                const back = returnedByPurchase[p.id] || 0;
                return {
                  value: p.id,
                  label: `${p.document_number} — ${p.supplier_name ?? ''} — ${money(p.total)} ج.م`
                    + (back ? ` (رجع منها ${money(back)})` : ''),
                };
                })}
            />
          </Form.Item>
        </Form>

        {detail && (
          <>
            <Divider orientation="right" style={{ marginTop: 4 }}>أصناف الفاتورة</Divider>
            <Table
              size="small" pagination={false} rowKey="item_id"
              dataSource={detail.lines as PurchaseLine[]}
              columns={[
                { title: 'الصنف', dataIndex: 'item_id', render: (id: number) => itemName(id) },
                {
                  title: 'المشترى', dataIndex: 'quantity', width: 100,
                  render: (q: string) => Number(q),
                },
                {
                  title: 'سعر الوحدة', dataIndex: 'unit_price', width: 120, align: 'left' as const,
                  render: (v: string) => `${money(v)} ج.م`,
                },
                {
                  title: 'الكمية الراجعة', width: 150,
                  // Capped by what was actually purchased — but refused, not clamped. `max`
                  // rewrote the number in silence, so somebody returning 50 of a line that only
                  // bought 8 saw «8» appear and never learned why.
                  render: (_: any, ln: PurchaseLine) => (
                    <InputNumber
                      data-grid-col="qty" keyboard={false}
                      style={{ width: '100%' }}
                      value={qty[ln.item_id] ?? null}
                      placeholder="—"
                      onChange={(v) => setQty((p) => ({ ...p, [ln.item_id]: v as number | null }))}
                      onBlur={() => setQty((p) => ({
                        ...p,
                        [ln.item_id]: guardQuantity({
                          value: p[ln.item_id],
                          available: Number(ln.quantity),
                          itemName: itemName(ln.item_id),
                        }, null),
                      }))}
                    />
                  ),
                },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}>
                    <strong>قيمة المردود</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1}>
                    <strong style={{ color: '#cf4b1a' }}>{money(draftValue)} ج.م</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
            {Object.values(qty).some((q) => q) && (
              <Button
                type="link" danger icon={<DeleteOutlined />} style={{ marginTop: 8 }}
                onClick={() => setQty({})}
              >
                تفريغ الكميات
              </Button>
            )}
          </>
        )}

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

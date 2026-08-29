import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Divider, Form, Input, Row, Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { BuildOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import { guardQuantity } from '../components/quantityGuard';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import ProductPickerModal from '../components/ProductPickerModal';
import { useTableKeyboard } from '../components/keyboard';
import { useLookup, labelMap } from '../hooks/useLookup';

/**
 * انتاج حر — production that happened without a stored recipe.
 *
 * Their `/productions/free` is a screen of its own, and its menu entry here used to land silently
 * on أوامر التصنيع, which requires a recipe. Somebody who produced something one-off had nowhere
 * to record it, and no way to tell that from having missed the button.
 *
 * It posts **one document**, the same `manufacturing_order` a recipe-driven run posts, with
 * `bom_id` left NULL. Consuming the materials through several calls and producing through another
 * would leave stock spent with nothing made whenever one of them failed — and the reversal, the
 * cost and the reports would each have to learn about a second kind of production.
 *
 * The stated quantities are what actually went in, so nothing scales them. On a recipe order «4
 * produced» multiplies the recipe; here it does not touch the numbers somebody measured.
 */

interface Item {
  id: number; code: string; name: string;
  kind: 'raw_material' | 'product'; unit_of_measure: string;
  purchase_price: string | null; active: boolean;
}

interface Order {
  id: number; document_number: string; product_id: number; bom_id: number | null;
  quantity: string; unit_cost: string; total_cost: string;
  material_cost?: string; resource_cost?: string;
  production_date?: string | null; work_order_ref?: string | null; notes?: string | null;
  reversed: boolean; is_reversal: boolean;
  consumptions: { item_id: number; quantity: string; line_cost: string }[];
}

interface DraftLine { key: number; item_id?: number; quantity?: number | null }

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function FreeProduction() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [productId, setProductId] = useState<number | undefined>();
  const [quantity, setQuantity] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [productionDate, setProductionDate] = useState<Dayjs>(dayjs());
  const [workOrderRef, setWorkOrderRef] = useState('');
  const [notes, setNotes] = useState('');
  // Every typed box opens empty. A quantity that starts at 1 turns «5» into «15» for anybody who
  // types over it without clearing first — the same rule as every other document here.
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusLineKey, setFocusLineKey] = useState<number | null>(null);
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [i, w, o] = await Promise.all([
        api.get('/api/v1/items'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/manufacturing/orders'),
      ]);
      setItems(i.data || []);
      setWarehouses(w.data || []);
      // Only the recipe-less ones — this screen is a register of free production, and mixing in
      // recipe orders would make «why is this one not in أوامر التصنيع?» a question.
      setOrders((o.data || []).filter((x: Order) => x.bom_id === null));
    } catch {
      message.error('تعذر تحميل البيانات');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const products = useMemo(() => items.filter((i) => i.kind === 'product' && i.active), [items]);
  const materials = useMemo(() => items.filter((i) => i.active), [items]);

  /** A material picked in the window becomes a line, and the caret goes to its quantity. */
  const addMaterial = (itemId: number) => {
    setPickerOpen(false);
    const key = (lines[lines.length - 1]?.key ?? 0) + 1;
    setLines((prev) => [...prev, { key, item_id: itemId }]);
    setFocusLineKey(key);
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

  const productWindow = (
    <ProductPickerModal
      open={pickerOpen}
      title="اختر الخامة المصروفة"
      categories={[...new Set(materials.map((m: any) => m.category).filter(Boolean))] as string[]}
      categoryLabels={categoryLabels}
      products={materials.filter((m) => !lines.some((l) => l.item_id === m.id))}
      activeCategory={activeCategory}
      onCategoryChange={setActiveCategory}
      onCancel={() => setPickerOpen(false)}
      onPick={addMaterial} />
  );
  const itemName = (id: number) => items.find((i) => i.id === id)?.name ?? `صنف #${id}`;
  const priceOf = (id?: number) => Number(items.find((i) => i.id === id)?.purchase_price || 0);

  // Shown before posting so the cost is not a surprise that only appears on the saved document.
  const materialCost = useMemo(
    () => lines.reduce((s, l) => s + (l.item_id && l.quantity
      ? l.quantity * priceOf(l.item_id) : 0), 0),
    [lines, items],
  );

  const reset = () => {
    setProductId(undefined); setQuantity(null); setWorkOrderRef(''); setNotes('');
    setLines([{ key: 1 }]);
  };

  const submit = async () => {
    if (!productId) { message.warning('اختر المنتج الناتج'); return; }
    if (!quantity || quantity <= 0) { message.warning('اكتب الكمية المنتجة'); return; }
    if (!warehouseId) { message.warning('اختر المخزن'); return; }
    const components = lines
      .filter((l) => l.item_id && l.quantity && l.quantity > 0)
      .map((l) => ({ item_id: l.item_id!, quantity: String(l.quantity) }));
    if (!components.length) { message.warning('اكتب خامة واحدة على الأقل بكميتها'); return; }
    const ids = components.map((c) => c.item_id);
    if (new Set(ids).size !== ids.length) {
      message.warning('لا يُكتب الصنف الواحد في أكثر من سطر — اجمع كميته في سطر واحد');
      return;
    }

    setSaving(true);
    try {
      await api.post('/api/v1/manufacturing/orders', {
        product_id: productId,
        quantity: String(quantity),
        location: { location_kind: 'warehouse', location_id: warehouseId },
        components,
        production_date: productionDate.format('YYYY-MM-DD'),
        work_order_ref: workOrderRef || null,
        notes: notes || null,
      });
      message.success('تم تسجيل الإنتاج الحر');
      reset();
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل الإنتاج');
    } finally { setSaving(false); }
  };

  const columns = [
    {
      title: 'رقم', dataIndex: 'id', key: 'id', width: 70,
      render: (id: number) => <span style={{ color: '#6b6b6b' }}>{id}</span>,
    },
    {
      title: 'التاريخ', dataIndex: 'production_date', key: 'production_date', width: 105,
      render: (v: string | null) => (v ? String(v).slice(0, 10) : '-'),
    },
    {
      title: 'رقم السند', dataIndex: 'document_number', key: 'document_number', width: 130,
      render: (d: string, r: Order) => (
        <Space size={4}>
          <Tag color="geekblue">{d}</Tag>
          {r.reversed && <Tag color="red">متراجع</Tag>}
          {r.is_reversal && <Tag color="orange">تراجع</Tag>}
        </Space>
      ),
    },
    {
      title: 'المنتج', dataIndex: 'product_id', key: 'product_id', ellipsis: true,
      render: (id: number) => (
        <a onClick={(e) => { e.stopPropagation(); navigate(`/catalog/${id}`); }}>{itemName(id)}</a>
      ),
    },
    {
      title: 'الكمية', dataIndex: 'quantity', key: 'quantity', width: 95,
      render: (q: string) => Number(q),
    },
    {
      // Their column here reads «رقم الانتاج», not «امر تشغيل» as elsewhere; this is their screen.
      title: 'رقم الانتاج', dataIndex: 'work_order_ref', key: 'work_order_ref', width: 130,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'اجمالي خامات', dataIndex: 'material_cost', key: 'material_cost', width: 125,
      align: 'left' as const, render: (v: string) => `${money(v)} ج.م`,
    },
    {
      // Labour and machine time. On a free order there is no recipe standard to read, so this is
      // zero unless the order stated resources of its own — and showing it says which it was.
      title: 'مصروفات', dataIndex: 'resource_cost', key: 'resource_cost', width: 115,
      align: 'left' as const, render: (v: string) => `${money(v)} ج.م`,
    },
    {
      title: 'اجمالي منتجات', dataIndex: 'total_cost', key: 'total_cost', width: 130,
      align: 'left' as const, render: (v: string) => <strong>{money(v)} ج.م</strong>,
    },
    {
      title: 'تكلفة الوحدة', dataIndex: 'unit_cost', key: 'unit_cost', width: 120,
      align: 'left' as const, render: (v: string) => `${money(v)} ج.م`,
    },
    {
      title: 'ملاحظات', dataIndex: 'notes', key: 'notes', ellipsis: true,
      render: (v: string | null) => v || '-',
    },
  ];

  const cols = useHiddenColumns('free-production-list', ['id', 'unit_cost', 'notes']);

  const filter = useListFilter<Order>(orders, {
    search: (o) => [o.document_number, o.work_order_ref, itemName(o.product_id)],
    dateOf: (o) => o.production_date,
  });

  // السطر يفتح تفاصيل الأمر — الخامات اللي اتصرفت وتكلفتها، اللي هي أصلاً في السطر المفرود.
  const [expanded, setExpanded] = useState<number[]>([]);
  const kb = useTableKeyboard<Order>({
    rows: filter.filtered, rowKey: (o) => o.id,
    onOpen: (o) => setExpanded((prev) => (prev.includes(o.id)
      ? prev.filter((k) => k !== o.id) : [...prev, o.id])),
  });

  return (
    <div>
      {productWindow}
      <Card
        title={<span><BuildOutlined /> إنتاج حر</span>}
        style={{ marginBottom: 16 }}
        extra={<Button onClick={reset}>تفريغ</Button>}
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="إنتاج من غير وصفة"
          description="اكتب الخامات المنصرفة فعلاً والمنتج الناتج. تُؤخذ الكميات كما هي دون أي نسب تضربها، حتى لا يتغيّر الرقم المقيس."
        />

        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Form.Item label="المنتج الناتج" required style={{ marginBottom: 0 }}>
              <Select
                showSearch optionFilterProp="label" placeholder="اختر المنتج"
                value={productId} onChange={setProductId}
                options={products.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item label="الكمية المنتجة" required style={{ marginBottom: 0 }}>
              {/* Production has no shelf to check against — it CREATES the goods. Zero and
                  negative are still refused: a negative production consumes the product it was
                  meant to make. */}
              <InputNumber
                data-grid-col="qty" keyboard={false}
                style={{ width: '100%' }} value={quantity} placeholder="—"
                onChange={(v) => setQuantity(v as number | null)}
                onBlur={() => setQuantity(guardQuantity(
                  { value: quantity, itemName: products.find((p) => p.id === productId)?.name },
                  null))}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={5}>
            <Form.Item label="المخزن" required style={{ marginBottom: 0 }}>
              <Select
                showSearch optionFilterProp="label" placeholder="اختر المخزن"
                value={warehouseId} onChange={setWarehouseId}
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item label="تاريخ الإنتاج" style={{ marginBottom: 0 }}>
              <DatePicker
                style={{ width: '100%' }} value={productionDate}
                onChange={(d) => setProductionDate(d || dayjs())} allowClear={false}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={3}>
            <Form.Item label="أمر التشغيل" style={{ marginBottom: 0 }}>
              <Input value={workOrderRef} onChange={(e) => setWorkOrderRef(e.target.value)} />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="right" style={{ marginTop: 16 }}>الخامات المصروفة</Divider>

        <Table
          size="small" pagination={false} rowKey="key" dataSource={lines}
          columns={[
            // Picked in the window, not hunted in a dropdown inside an empty row.
            {
              title: 'الصنف', width: '55%',
              render: (_: any, l: DraftLine) => (
                <span>{materials.find((m) => m.id === l.item_id)?.name ?? `صنف #${l.item_id}`}</span>
              ),
            },
            {
              title: 'الكمية', width: 150,
              render: (_: any, l: DraftLine) => (
                <InputNumber
                  data-qty-key={l.key} data-grid-col="qty2" keyboard={false}
                  onPressEnter={(e) => {
                    e.preventDefault();
                    const kept = guardQuantity({
                      value: l.quantity,
                      itemName: materials.find((m) => m.id === l.item_id)?.name,
                    }, null);
                    setLines((p) => p.map((x) => (
                      x.key === l.key ? { ...x, quantity: kept } : x)));
                    if (kept !== null) setPickerOpen(true);
                  }}
                  style={{ width: '100%' }} value={l.quantity ?? null} placeholder="—"
                  onChange={(v) => setLines((p) => p.map((x) => (
                    x.key === l.key ? { ...x, quantity: v as number | null } : x)))}
                  onBlur={() => setLines((p) => p.map((x) => (
                    x.key === l.key
                      ? { ...x, quantity: guardQuantity({
                          value: x.quantity,
                          itemName: materials.find((m) => m.id === x.item_id)?.name,
                        }, null) }
                      : x)))}
                />
              ),
            },
            {
              title: 'التكلفة', width: 130, align: 'left' as const,
              render: (_: any, l: DraftLine) => (
                <span>{money((l.quantity || 0) * priceOf(l.item_id))} ج.م</span>
              ),
            },
            {
              title: '', width: 50,
              render: (_: any, l: DraftLine) => (
                <Button
                  type="text" danger icon={<DeleteOutlined />}
                  onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                />
              ),
            },
          ]}
        />

        <Space style={{ marginTop: 12 }}>
          <Button
            icon={<PlusOutlined />}
            onClick={() => setPickerOpen(true)}
          >
            إضافة خامة
          </Button>
          <Statistic
            title="تكلفة الخامات" value={materialCost} precision={2} suffix="ج.م"
            valueStyle={{ fontSize: 18 }}
          />
          <Button type="primary" loading={saving} onClick={submit}>ترحيل الإنتاج</Button>
        </Space>
      </Card>

      <Card
        title="سجل الإنتاج الحر"
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
          </Space>
        }
      >
        <ListToolbar
          searchPlaceholder="بحث برقم السند أو المنتج أو أمر التشغيل"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          showDateRange range={filter.range} onRangeChange={filter.setRange}
          onReset={filter.reset} total={orders.length} shown={filter.filtered.length}
        />
        <Table
          {...kb.tableProps}
          dataSource={filter.filtered} columns={cols.apply(columns)} rowKey="id" loading={loading}
          size="middle" tableLayout="fixed"
          expandable={{
            expandedRowKeys: expanded,
            onExpandedRowsChange: (keys) => setExpanded(keys as number[]),
            expandedRowRender: (r: Order) => (
              <Table
                size="small" pagination={false} rowKey="item_id" dataSource={r.consumptions}
                columns={[
                  { title: 'الخامة', dataIndex: 'item_id',
                    render: (id: number) => (
                      <a onClick={() => navigate(`/catalog/${id}`)}>{itemName(id)}</a>
                    ) },
                  { title: 'المصروف', dataIndex: 'quantity', render: (q: string) => Number(q) },
                  {
                    title: 'التكلفة', dataIndex: 'line_cost', align: 'left' as const,
                    render: (v: string) => `${money(v)} ج.م`,
                  },
                ]}
              />
            ),
          }}
          pagination={{
            defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>
    </div>
  );
}

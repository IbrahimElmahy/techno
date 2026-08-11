import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, InputNumber, Popconfirm, Row,
  Select, Space, Statistic, Table, Tabs, Tag, message
} from 'antd';
import {
  PlusOutlined, RollbackOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined,
  BuildOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useQueryTab } from '../components/useQueryTab';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

interface Warehouse { id: number; name: string; }
interface Item {
  id: number; code: string; name: string;
  kind: 'raw_material' | 'product'; unit_of_measure: string;
  purchase_price: string | null; active: boolean;
}
interface Component { item_id: number; quantity: string; unit?: string | null; unit_factor?: string; }
interface AltUnit { name: string; factor: string }
type ResourceKind = 'labor' | 'machine' | 'overhead' | 'other';
interface BomResource { kind: ResourceKind; name: string; quantity: string; rate: string; }
interface OrderResource { kind: ResourceKind; name: string; quantity: string; rate: string; cost: string; }
interface Bom {
  id: number; product_id: number; name: string;
  output_quantity: string; active: boolean; components: Component[];
  resources: BomResource[];
}
interface OrderConsumption {
  item_id: number; quantity: string; unit_cost: string; line_cost: string;
  waste_quantity?: string; warehouse_id?: number | null;
}
interface Order {
  id: number; document_number: string; product_id: number; bom_id: number | null;
  quantity: string; unit_cost: string; total_cost: string;
  production_date?: string | null; branch_id?: number | null;
  work_order_ref?: string | null; notes?: string | null;
  material_cost?: string; resource_cost?: string;
  reversed: boolean; is_reversal: boolean;
  consumptions: OrderConsumption[]; resources?: OrderResource[];
}
interface Wastage {
  id: number; document_number: string; item_id: number; warehouse_id: number;
  quantity: string; unit_cost: string; total_cost: string;
  reason: string | null; is_reversal: boolean;
}

const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  labor: 'عمالة', machine: 'ماكينة', overhead: 'أعباء', other: 'أخرى',
};
const RESOURCE_KIND_OPTIONS = (Object.keys(RESOURCE_KIND_LABELS) as ResourceKind[])
  .map((k) => ({ value: k, label: RESOURCE_KIND_LABELS[k] }));

const fmtMoney = (v: string | number) =>
  Number(v).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Manufacturing() {
  // «نسب انتاج» and «انتاج حسب النسب» are two entries in their menu and two tabs here.
  const [tab, setTab] = useQueryTab('orders');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [rawMaterials, setRawMaterials] = useState<Item[]>([]);
  const [products, setProducts] = useState<Item[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [wastages, setWastages] = useState<Wastage[]>([]);
  const [loading, setLoading] = useState(false);

  const itemName = useMemo(() => {
    const m = new Map<number, Item>();
    [...rawMaterials, ...products].forEach((i) => m.set(i.id, i));
    return (id: number) => m.get(id)?.name ?? `#${id}`;
  }, [rawMaterials, products]);

  const whName = useMemo(() => {
    const m = new Map<number, Warehouse>();
    warehouses.forEach((w) => m.set(w.id, w));
    return (id: number | null | undefined) => (id == null ? '-' : m.get(id)?.name ?? `#${id}`);
  }, [warehouses]);

  const rawById = useMemo(() => {
    const m = new Map<number, Item>();
    rawMaterials.forEach((i) => m.set(i.id, i));
    return m;
  }, [rawMaterials]);

  const activeBomByProduct = useMemo(() => {
    const m = new Map<number, Bom>();
    boms.filter((b) => b.active).forEach((b) => m.set(b.product_id, b));
    return m;
  }, [boms]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [whRes, brRes, itemsRes, bomRes, orderRes, wasteRes] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/branches'),
        api.get('/api/v1/items'),
        api.get('/api/v1/manufacturing/boms'),
        api.get('/api/v1/manufacturing/orders'),
        api.get('/api/v1/wastage'),
      ]);
      setWarehouses(whRes.data);
      setBranches(brRes.data || []);
      setRawMaterials(itemsRes.data.filter((i: Item) => i.kind === 'raw_material'));
      setProducts(itemsRes.data.filter((i: Item) => i.kind === 'product'));
      setBoms(bomRes.data);
      setOrders(orderRes.data);
      setWastages(wasteRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  return (
    <Tabs
      activeKey={tab} onChange={setTab}
      items={[
        {
          key: 'orders',
          label: <span><BuildOutlined /> أوامر التصنيع</span>,
          children: (
            <OrdersTab
              orders={orders} products={products} warehouses={warehouses} branches={branches}
              rawById={rawById} itemName={itemName} whName={whName}
              activeBomByProduct={activeBomByProduct}
              loading={loading} reload={loadAll}
            />
          ),
        },
        {
          key: 'recipes',
          label: <span><ExperimentOutlined /> الوصفات (BOM)</span>,
          children: (
            <RecipesTab
              boms={boms} products={products} rawMaterials={rawMaterials}
              itemName={itemName} loading={loading} reload={loadAll}
            />
          ),
        },
        {
          key: 'wastage',
          label: <span><DeleteOutlined /> مستندات الهالك</span>,
          children: (
            <WastageTab
              wastages={wastages} warehouses={warehouses}
              rawMaterials={rawMaterials} products={products}
              itemName={itemName} whName={whName} loading={loading} reload={loadAll}
            />
          ),
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Manufacturing Orders tab
// ---------------------------------------------------------------------------
function OrdersTab({
  orders, products, warehouses, branches, rawById, itemName, whName, activeBomByProduct,
  loading, reload,
}: {
  orders: Order[]; products: Item[]; warehouses: Warehouse[];
  branches: { id: number; name: string }[];
  rawById: Map<number, Item>; itemName: (id: number) => string;
  whName: (id: number | null | undefined) => string;
  activeBomByProduct: Map<number, Bom>; loading: boolean; reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const productId = Form.useWatch('product_id', form);
  const quantity = Form.useWatch('quantity', form);

  // Only products that have an active recipe can be manufactured.
  const manufacturable = products.filter((p) => activeBomByProduct.has(p.id));
  const selectedBom = productId ? activeBomByProduct.get(productId) : undefined;

  const preview = useMemo(() => {
    if (!selectedBom || !quantity) return null;
    const scale = Number(quantity) / Number(selectedBom.output_quantity);
    let total = 0;
    const rows = selectedBom.components.map((c) => {
      // × the unit factor, same as the backend: a recipe line reading «٢ كرتونة» consumes 24
      // pieces, and a preview that showed 2 would send the storekeeper looking for the other 22.
      const consumed = Number(c.quantity) * scale * Number(c.unit_factor ?? 1);
      const unit = Number(rawById.get(c.item_id)?.purchase_price ?? 0);
      const line = consumed * unit;
      total += line;
      return { item_id: c.item_id, consumed, unit, line };
    });
    return { rows, total, unit: quantity ? total / Number(quantity) : 0 };
  }, [selectedBom, quantity, rawById]);

  const [lastResult, setLastResult] = useState<Order | null>(null);

  const filter = useListFilter(orders, {
    search: (o) => [o.document_number, itemName(o.product_id), o.work_order_ref || ''],
    filters: {
      product_id: (o, v) => o.product_id === v,
      status: (o, v) => (v === 'reversal' ? o.is_reversal
        : v === 'reversed' ? (o.reversed && !o.is_reversal)
        : !o.reversed && !o.is_reversal),
    },
  });

  // السطر يفتح تفاصيل الأمر — الخامات والتكاليف اللي جوّاه. نفس السهم اللي على الشمال بالظبط،
  // بس من غير ما حد يصطاده بالماوس.
  const [expanded, setExpanded] = useState<number[]>([]);
  const ordersKb = useTableKeyboard<Order>({
    rows: filter.filtered, rowKey: (o) => o.id,
    onOpen: (o) => setExpanded((prev) => (prev.includes(o.id)
      ? prev.filter((k) => k !== o.id) : [...prev, o.id])),
  });

  const submit = async (values: any) => {
    try {
      const wasteMap = values.waste_qty || {};
      const wastes = Object.entries(wasteMap)
        .filter(([, q]) => q != null && Number(q) > 0)
        .map(([itemId, q]) => ({ item_id: Number(itemId), quantity: q }));
      const res = await api.post('/api/v1/manufacturing/orders', {
        product_id: values.product_id,
        quantity: values.quantity,
        location: { location_kind: 'warehouse', location_id: values.warehouse_id },
        // The day production happened, not the day it was typed — the workshop closes a batch in
        // the evening and the office enters it next morning.
        production_date: values.production_date
          ? values.production_date.format('YYYY-MM-DD') : undefined,
        branch_id: values.branch_id ?? undefined,
        work_order_ref: values.work_order_ref || undefined,
        notes: values.notes || undefined,
        ...(wastes.length ? { wastes } : {}),
      });
      setLastResult(res.data);
      message.success('تم ترحيل أمر التصنيع: خُصمت الخامات وأُضيف المنتج للمخزون');
      setOpen(false);
      form.resetFields();
      reload();
    } catch (err) { console.error(err); }
  };

  const reverse = (record: Order) => {
    showReversalConfirm({
      title: 'التراجع عن أمر تصنيع',
      content: `عكس المستند "${record.document_number}" هيرجّع الخامات المستهلكة للمخزون ويشيل المنتج المُنتَج. لو المنتج اتباع أو اتصرف، العكس هيتمنع. تمام؟`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/manufacturing/orders/${record.id}/reverse`);
          message.success('تم عكس أمر التصنيع بنجاح');
          reload();
        } catch (err) { console.error(err); }
      },
    });
  };

  const columns = [
    { title: 'المستند', dataIndex: 'document_number', key: 'doc',
      render: (d: string) => <Tag color="blue">{d}</Tag> },
    // Their انتاج حسب النسب list reads التاريخ · أمر تشغيل · اجمالي خامات · مصروفات; ours now shows
    // the same, plus what it already had.
    { title: 'التاريخ', dataIndex: 'production_date', key: 'pdate', width: 110,
      render: (d: string | null) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'المنتج', key: 'product', render: (_: any, r: Order) => itemName(r.product_id) },
    { title: 'أمر التشغيل', dataIndex: 'work_order_ref', key: 'wo', width: 130,
      render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : '-') },
    { title: 'الكمية المنتجة', dataIndex: 'quantity', key: 'qty', render: (q: string) => Number(q) },
    { title: 'إجمالي الخامات', dataIndex: 'material_cost', key: 'mat',
      render: (v: string) => `${fmtMoney(v ?? 0)} ج.م` },
    { title: 'المصروفات', dataIndex: 'resource_cost', key: 'res',
      render: (v: string) => `${fmtMoney(v ?? 0)} ج.م` },
    { title: 'إجمالي التكلفة', dataIndex: 'total_cost', key: 'total',
      render: (v: string) => `${fmtMoney(v)} ج.م` },
    { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', key: 'unit',
      render: (v: string) => `${fmtMoney(v)} ج.م` },
    { title: 'الحالة', key: 'status', render: (_: any, r: Order) =>
        r.is_reversal ? <Tag color="purple">حركة عكسية</Tag>
          : r.reversed ? <Tag color="red">معكوس (ملغي)</Tag>
          : <Tag color="green">مرحّل</Tag> },
    { title: 'إجراء', key: 'action', render: (_: any, r: Order) =>
        (!r.reversed && !r.is_reversal) && (
          <Button type="link" danger icon={<RollbackOutlined />} onClick={() => reverse(r)}>
            تراجع وعكس
          </Button>
        ) },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const ordersTabCols = useTableColumns('mfg-orders', columns);

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'left' }}>
        <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          أمر تصنيع جديد
        </Button>
      </div>

      {lastResult && (
        <Card size="small" title={`تكلفة أمر التصنيع ${lastResult.document_number}`}
          style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}
          extra={<Button type="text" onClick={() => setLastResult(null)}>إخفاء</Button>}>
          <Row gutter={16}>
            <Col span={8}><Statistic title="تكلفة الخامات" value={fmtMoney(lastResult.material_cost ?? 0)} suffix="ج.م" /></Col>
            <Col span={8}><Statistic title="تكلفة الموارد" value={fmtMoney(lastResult.resource_cost ?? 0)} suffix="ج.م" /></Col>
            <Col span={8}><Statistic title="إجمالي التكلفة" value={fmtMoney(lastResult.total_cost)} suffix="ج.م" /></Col>
          </Row>
        </Card>
      )}

      <ListToolbar
        searchPlaceholder="بحث برقم المستند أو المنتج"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={orders.length} shown={filter.filtered.length}
        filters={[
          { key: 'product_id', placeholder: 'المنتج',
            options: products.map((p) => ({ value: p.id, label: p.name })) },
          { key: 'status', placeholder: 'الحالة', options: [
            { value: 'posted', label: 'مرحّل' },
            { value: 'reversed', label: 'معكوس (ملغي)' },
            { value: 'reversal', label: 'حركة عكسية' },
          ] },
        ]}
      />

      <div style={{ textAlign: 'end', marginBottom: 8 }}>{ordersTabCols.control}</div>
      <Table
        {...ordersKb.tableProps}
        rowKey="id" loading={loading} dataSource={filter.filtered} columns={ordersTabCols.columns}
        expandable={{
          expandedRowKeys: expanded,
          onExpandedRowsChange: (keys) => setExpanded(keys as number[]),
          expandedRowRender: (r: Order) => (
            <div>
              <Row gutter={16} style={{ marginBottom: 12 }}>
                <Col span={8}><Statistic title="تكلفة الخامات" value={fmtMoney(r.material_cost ?? 0)} suffix="ج.م" /></Col>
                <Col span={8}><Statistic title="تكلفة الموارد" value={fmtMoney(r.resource_cost ?? 0)} suffix="ج.م" /></Col>
                <Col span={8}><Statistic title="إجمالي التكلفة" value={fmtMoney(r.total_cost)} suffix="ج.م" /></Col>
              </Row>
              <Divider orientation="right" style={{ margin: '8px 0' }}>الخامات المستهلكة</Divider>
              <Table
                size="small" pagination={false} rowKey="item_id" dataSource={r.consumptions}
                columns={[
                  { title: 'الخامة المستهلكة', key: 'n', render: (_: any, c: OrderConsumption) => itemName(c.item_id) },
                  { title: 'الكمية', dataIndex: 'quantity', render: (q: string) => Number(q) },
                  { title: 'الهالك', dataIndex: 'waste_quantity', render: (q: string | undefined) => q ? Number(q) : '-' },
                  { title: 'المخزن', dataIndex: 'warehouse_id', render: (w: number | null | undefined) => whName(w) },
                  { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', render: (v: string) => `${fmtMoney(v)} ج.م` },
                  { title: 'إجمالي السطر', dataIndex: 'line_cost', render: (v: string) => `${fmtMoney(v)} ج.م` },
                ]}
              />
              {r.resources && r.resources.length > 0 && (
                <>
                  <Divider orientation="right" style={{ margin: '12px 0 8px' }}>موارد الإنتاج</Divider>
                  <Table
                    size="small" pagination={false} rowKey={(row) => `${row.kind}-${row.name}`}
                    dataSource={r.resources}
                    columns={[
                      { title: 'النوع', dataIndex: 'kind', render: (k: ResourceKind) => <Tag>{RESOURCE_KIND_LABELS[k] ?? k}</Tag> },
                      { title: 'البيان', dataIndex: 'name' },
                      { title: 'الكمية/الساعات', dataIndex: 'quantity', render: (q: string) => Number(q) },
                      { title: 'سعر الوحدة', dataIndex: 'rate', render: (v: string) => `${fmtMoney(v)} ج.م` },
                      { title: 'التكلفة', dataIndex: 'cost', render: (v: string) => `${fmtMoney(v)} ج.م` },
                    ]}
                  />
                </>
              )}
            </div>
          ),
        }}
        locale={{ emptyText: 'لا يوجد أوامر تصنيع بعد' }}
      />

      <TabModal centered
        title="أمر تصنيع جديد" width={560} open={open} onCancel={() => setOpen(false)}
        destroyOnHidden
        footer={<Button type="primary" onClick={() => form.submit()}>ترحيل الأمر</Button>}
      >
        {manufacturable.length === 0 ? (
          <Empty description="لا يوجد منتجات لها وصفة نشطة. أنشئ وصفة (BOM) أولاً من تبويب الوصفات." />
        ) : (
          <Form form={form} layout="vertical" onFinish={submit}>
            <Form.Item name="product_id" label="المنتج المراد تصنيعه"
              rules={[{ required: true, message: 'اختر المنتج' }]}>
              <Select placeholder="اختر منتج له وصفة"
                options={manufacturable.map((p) => ({ value: p.id, label: `${p.name} (${p.unit_of_measure})` }))} />
            </Form.Item>
            <Form.Item name="quantity" label="الكمية المطلوب إنتاجها"
              rules={[{ required: true, message: 'أدخل الكمية' }]}>
              <InputNumber min={0.001} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="warehouse_id" label="المخزن (سحب الخامات + إيداع المنتج)"
              rules={[{ required: true, message: 'اختر المخزن' }]}>
              <Select placeholder="اختر المخزن"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
            </Form.Item>

            <Divider orientation="right">بيانات المستند</Divider>
            <Form.Item name="production_date" label="تاريخ الإنتاج"
              extra="اتركه فارغاً لتاريخ اليوم">
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="branch_id" label="الفرع">
              <Select allowClear placeholder="الفرع"
                options={branches.map((b) => ({ value: b.id, label: b.name }))} />
            </Form.Item>
            <Form.Item name="work_order_ref" label="أمر التشغيل">
              <Input placeholder="رقم أمر التشغيل / الدوكيت" maxLength={60} />
            </Form.Item>
            <Form.Item name="notes" label="ملاحظات">
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>

            {selectedBom && (
              <>
                <Divider orientation="right">هالك الخامات (اختياري)</Divider>
                <p style={{ color: '#888', marginTop: 0 }}>
                  كمية إضافية تُخصم كهالك من كل خامة عند التصنيع.
                </p>
                {selectedBom.components.map((c) => (
                  <Form.Item key={c.item_id} name={['waste_qty', String(c.item_id)]}
                    label={itemName(c.item_id)} style={{ marginBottom: 8 }}>
                    <InputNumber min={0} placeholder="0" style={{ width: '100%' }} />
                  </Form.Item>
                ))}
              </>
            )}

            {preview && (
              <Card size="small" title="معاينة الخامات والتكلفة"
                style={{ marginTop: 8, background: '#fafafa' }}>
                <Table
                  size="small" pagination={false} rowKey="item_id" dataSource={preview.rows}
                  columns={[
                    { title: 'الخامة', key: 'n', render: (_: any, c: any) => itemName(c.item_id) },
                    { title: 'يُستهلك', dataIndex: 'consumed', render: (v: number) => v.toFixed(3) },
                    { title: 'تكلفة السطر', dataIndex: 'line', render: (v: number) => `${fmtMoney(v)} ج.م` },
                  ]}
                />
                <Divider style={{ margin: '12px 0' }} />
                <Row gutter={16}>
                  <Col span={12}><Statistic title="إجمالي التكلفة" value={fmtMoney(preview.total)} suffix="ج.م" /></Col>
                  <Col span={12}><Statistic title="تكلفة الوحدة" value={fmtMoney(preview.unit)} suffix="ج.م" /></Col>
                </Row>
              </Card>
            )}
          </Form>
        )}
      </TabModal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipes (BOM) tab
// ---------------------------------------------------------------------------
function RecipesTab({
  boms, products, rawMaterials, itemName, loading, reload,
}: {
  boms: Bom[]; products: Item[]; rawMaterials: Item[];
  itemName: (id: number) => string; loading: boolean; reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Bom | null>(null);
  const [form] = Form.useForm();
  // Alternate units per raw material, fetched the first time one is picked. Loading every
  // material's units up front would be a request per material to fill a dropdown most recipes
  // never open.
  const [unitOpts, setUnitOpts] = useState<Record<number, AltUnit[]>>({});
  const loadUnits = async (itemId: number) => {
    if (!itemId || unitOpts[itemId]) return;
    try {
      const r = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitOpts((prev) => ({ ...prev, [itemId]: r.data?.units || [] }));
    } catch {
      // A material with no alternate units is normal, not an error — the row then offers the
      // base unit only, which is what it always did.
      setUnitOpts((prev) => ({ ...prev, [itemId]: [] }));
    }
  };

  const filter = useListFilter(boms, {
    search: (b) => [b.name, itemName(b.product_id)],
    filters: {
      product_id: (b, v) => b.product_id === v,
      active: (b, v) => b.active === (v === 'active'),
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ output_quantity: 1, components: [{}], resources: [] });
    setOpen(true);
  };
  // A recipe is master data: the row opens it for editing, because there is nothing to «view» in a
  // recipe that its own form does not already show better.
  const bomsKb = useTableKeyboard<Bom>({
    rows: filter.filtered, rowKey: (b) => b.id, onOpen: (b) => openEdit(b),
  });
  const openEdit = (bom: Bom) => {
    setEditing(bom);
    bom.components.forEach((c) => loadUnits(c.item_id));
    form.setFieldsValue({
      product_id: bom.product_id, name: bom.name,
      output_quantity: Number(bom.output_quantity),
      components: bom.components.map((c) => ({
        item_id: c.item_id, quantity: Number(c.quantity), unit: c.unit || undefined,
      })),
      resources: (bom.resources || []).map((r) => ({
        kind: r.kind, name: r.name, quantity: Number(r.quantity), rate: Number(r.rate),
      })),
    });
    setOpen(true);
  };

  const submit = async (values: any) => {
    const resources = (values.resources || [])
      .filter((r: any) => r && r.kind && r.name)
      .map((r: any) => ({ kind: r.kind, name: r.name, quantity: r.quantity, rate: r.rate }));
    const payload = {
      product_id: values.product_id,
      name: values.name,
      output_quantity: values.output_quantity,
      components: (values.components || []).map((c: any) => ({
        item_id: c.item_id, quantity: c.quantity, unit: c.unit || null,
      })),
      resources,
    };
    try {
      if (editing) {
        await api.put(`/api/v1/manufacturing/boms/${editing.id}`, {
          name: payload.name, output_quantity: payload.output_quantity,
          components: payload.components, resources: payload.resources,
        });
        message.success('تم تحديث الوصفة');
      } else {
        await api.post('/api/v1/manufacturing/boms', payload);
        message.success('تم إنشاء الوصفة');
      }
      setOpen(false);
      reload();
    } catch (err) { console.error(err); }
  };

  const deactivate = async (bom: Bom) => {
    try {
      await api.delete(`/api/v1/manufacturing/boms/${bom.id}`);
      message.success('تم إلغاء تفعيل الوصفة');
      reload();
    } catch (err) { console.error(err); }
  };

  const columns = [
    { title: 'المنتج', key: 'product', render: (_: any, r: Bom) => itemName(r.product_id) },
    { title: 'اسم الوصفة', dataIndex: 'name', key: 'name' },
    { title: 'كمية الناتج', dataIndex: 'output_quantity', key: 'oq', render: (q: string) => Number(q) },
    { title: 'الخامات', key: 'comp',
      render: (_: any, r: Bom) => (
        <Space size={[0, 4]} wrap>
          {r.components.map((c) => (
            // Shows the unit it was written in, so «× ٢ كرتونة» never reads as «× ٢» of
            // something unstated.
            <Tag key={c.item_id}>
              {itemName(c.item_id)} × {Number(c.quantity)}{c.unit ? ` ${c.unit}` : ''}
            </Tag>
          ))}
        </Space>
      ) },
    { title: 'الحالة', dataIndex: 'active', key: 'active',
      render: (a: boolean) => a ? <Tag color="green">نشطة</Tag> : <Tag>غير نشطة</Tag> },
    { title: 'إجراءات', key: 'action', render: (_: any, r: Bom) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>تعديل</Button>
          {r.active && (
            <Popconfirm title="إلغاء تفعيل الوصفة؟" okText="نعم" cancelText="لا"
              onConfirm={() => deactivate(r)}>
              <Button type="link" danger icon={<DeleteOutlined />}>إلغاء تفعيل</Button>
            </Popconfirm>
          )}
        </Space>
      ) },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const recipesTabCols = useTableColumns('mfg-recipes', columns);

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'left' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>وصفة جديدة</Button>
      </div>

      <ListToolbar
        searchPlaceholder="بحث باسم الوصفة أو المنتج"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={boms.length} shown={filter.filtered.length}
        filters={[
          { key: 'product_id', placeholder: 'المنتج',
            options: products.map((p) => ({ value: p.id, label: p.name })) },
          { key: 'active', placeholder: 'الحالة', options: [
            { value: 'active', label: 'نشطة' },
            { value: 'inactive', label: 'غير نشطة' },
          ] },
        ]}
      />

      <div style={{ textAlign: 'end', marginBottom: 8 }}>{recipesTabCols.control}</div>
      <Table {...bomsKb.tableProps}
        rowKey="id" loading={loading} dataSource={filter.filtered} columns={recipesTabCols.columns}
        locale={{ emptyText: 'لا يوجد وصفات بعد' }} />

      <TabModal centered
        title={editing ? 'تعديل وصفة' : 'وصفة جديدة'} width={560} open={open}
        onCancel={() => setOpen(false)} destroyOnHidden
        footer={<Button type="primary" onClick={() => form.submit()}>حفظ</Button>}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="product_id" label="المنتج الناتج"
            rules={[{ required: true, message: 'اختر المنتج' }]}>
            <Select placeholder="اختر المنتج" disabled={!!editing}
              options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.unit_of_measure})` }))} />
          </Form.Item>
          <Form.Item name="name" label="اسم الوصفة" rules={[{ required: true, message: 'أدخل اسم الوصفة' }]}>
            <Input placeholder="مثال: وصفة تصنيع الطاولة" />
          </Form.Item>
          <Form.Item name="output_quantity" label="كمية الناتج من الوصفة (batch)"
            rules={[{ required: true, message: 'أدخل كمية الناتج' }]}
            tooltip="عدد وحدات المنتج اللي بتطلع من تشغيل الوصفة مرة واحدة">
            <InputNumber min={0.001} style={{ width: '100%' }} />
          </Form.Item>

          <Divider orientation="right">الخامات المستهلكة</Divider>
          <Form.List name="components">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, ...field }) => (
                  <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item {...field} name={[field.name, 'item_id']} style={{ flex: 1, marginBottom: 0 }}
                      rules={[{ required: true, message: 'اختر الخامة' }]}>
                      <Select placeholder="الخامة" style={{ minWidth: 220 }}
                        // Picking the material loads its units, and clears any unit carried over
                        // from the previous choice — a unit that belonged to another item would
                        // be rejected on save, and worse, might not be.
                        onChange={(v: number) => {
                          loadUnits(v);
                          const rows = form.getFieldValue('components') || [];
                          if (rows[field.name]) {
                            rows[field.name] = { ...rows[field.name], unit: undefined };
                            form.setFieldsValue({ components: rows });
                          }
                        }}
                        options={rawMaterials.map((r) => ({ value: r.id, label: `${r.name} (${r.unit_of_measure})` }))} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'quantity']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'الكمية' }]}>
                      <InputNumber min={0.001} placeholder="الكمية" />
                        data-grid-col="qty" keyboard={false}
                    </Form.Item>
                    {/* «الوحدة» — the recipe is written in whatever unit the workshop speaks
                        («٢ كرتونة»)، and the conversion to base units happens when the order
                        consumes, not in someone's head at the keyboard. */}
                    <Form.Item noStyle shouldUpdate>
                      {({ getFieldValue }) => {
                        const iid = getFieldValue(['components', field.name, 'item_id']);
                        const raw = rawMaterials.find((r) => r.id === iid);
                        const alts = unitOpts[iid] || [];
                        return (
                          <Form.Item {...field} name={[field.name, 'unit']}
                            style={{ marginBottom: 0 }}>
                            <Select allowClear style={{ minWidth: 130 }} disabled={!iid}
                              placeholder={raw?.unit_of_measure || 'الوحدة'}
                              options={alts.map((u) => ({
                                value: u.name,
                                label: `${u.name} (=${Number(u.factor)} ${raw?.unit_of_measure || ''})`,
                              }))} />
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                    <DeleteOutlined onClick={() => remove(field.name)} style={{ color: '#ff4d4f' }} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                  إضافة خامة
                </Button>
              </>
            )}
          </Form.List>

          <Divider orientation="right">موارد الإنتاج</Divider>
          <Form.List name="resources">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, ...field }) => (
                  <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }} wrap>
                    <Form.Item {...field} name={[field.name, 'kind']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'النوع' }]}>
                      <Select placeholder="النوع" style={{ minWidth: 110 }} options={RESOURCE_KIND_OPTIONS} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'name']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'البيان' }]}>
                      <Input placeholder="البيان (مثال: عامل تجميع)" style={{ minWidth: 160 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'quantity']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'الكمية' }]}>
                      <InputNumber min={0} placeholder="ساعات/كمية" style={{ width: 110 }} />
                        data-grid-col="hours" keyboard={false}
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'rate']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'السعر' }]}>
                      <InputNumber min={0} placeholder="سعر الوحدة" style={{ width: 110 }} />
                        data-grid-col="rate" keyboard={false}
                    </Form.Item>
                    <DeleteOutlined onClick={() => remove(field.name)} style={{ color: '#ff4d4f' }} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                  إضافة مورد
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </TabModal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wastage documents tab
// ---------------------------------------------------------------------------
function WastageTab({
  wastages, warehouses, rawMaterials, products, itemName, whName, loading, reload,
}: {
  wastages: Wastage[]; warehouses: Warehouse[]; rawMaterials: Item[]; products: Item[];
  itemName: (id: number) => string; whName: (id: number | null | undefined) => string;
  loading: boolean; reload: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const itemOptions = [...rawMaterials, ...products]
    .map((i) => ({ value: i.id, label: `${i.name} (${i.unit_of_measure})` }));

  const filter = useListFilter(wastages, {
    search: (w) => [w.document_number, itemName(w.item_id), w.reason],
    filters: {
      item_id: (w, v) => w.item_id === v,
      warehouse_id: (w, v) => w.warehouse_id === v,
      status: (w, v) => (v === 'reversal' ? w.is_reversal : !w.is_reversal),
    },
  });

  // مستند الهالك مافيهوش سطور — السطر نفسه هو المستند. فالسطر يودّي لكارت الصنف اللي اتهلك،
  // اللي هو المكان الوحيد اللي بيفسّر الحركة دي جنب باقي حركات الصنف.
  const wastageKb = useTableKeyboard<Wastage>({
    rows: filter.filtered, rowKey: (w) => w.id,
    onOpen: (w) => navigate(`/catalog/${w.item_id}`),
  });

  const openCreate = () => {
    form.resetFields();
    setOpen(true);
  };

  const submit = async (values: any) => {
    try {
      await api.post('/api/v1/wastage', {
        item_id: values.item_id,
        warehouse_id: values.warehouse_id,
        quantity: values.quantity,
        ...(values.reason ? { reason: values.reason } : {}),
      });
      message.success('تم تسجيل مستند الهالك');
      setOpen(false);
      form.resetFields();
      reload();
    } catch (err) { console.error(err); }
  };

  const reverse = (record: Wastage) => {
    showReversalConfirm({
      title: 'عكس مستند هالك',
      content: `عكس المستند "${record.document_number}" هيرجّع الكمية المهلَكة للمخزون. تمام؟`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/wastage/${record.id}/reverse`);
          message.success('تم عكس مستند الهالك بنجاح');
          reload();
        } catch (err) { console.error(err); }
      },
    });
  };

  const columns = [
    { title: 'المستند', dataIndex: 'document_number', key: 'doc',
      render: (d: string) => <Tag color="blue">{d}</Tag> },
    { title: 'الصنف', key: 'item', render: (_: any, r: Wastage) => itemName(r.item_id) },
    { title: 'المخزن', key: 'wh', render: (_: any, r: Wastage) => whName(r.warehouse_id) },
    { title: 'الكمية', dataIndex: 'quantity', key: 'qty', render: (q: string) => Number(q) },
    { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', key: 'unit',
      render: (v: string) => `${fmtMoney(v)} ج.م` },
    { title: 'إجمالي التكلفة', dataIndex: 'total_cost', key: 'total',
      render: (v: string) => `${fmtMoney(v)} ج.م` },
    { title: 'السبب', dataIndex: 'reason', key: 'reason', render: (v: string | null) => v || '-' },
    { title: 'الحالة', key: 'status', render: (_: any, r: Wastage) =>
        r.is_reversal ? <Tag color="purple">حركة عكسية</Tag> : <Tag color="green">مرحّل</Tag> },
    { title: 'إجراء', key: 'action', render: (_: any, r: Wastage) =>
        !r.is_reversal && (
          <Button type="link" danger icon={<RollbackOutlined />} onClick={() => reverse(r)}>
            تراجع وعكس
          </Button>
        ) },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const wastageTabCols = useTableColumns('mfg-wastage', columns);

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'left' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>هالك جديد</Button>
      </div>

      <ListToolbar
        searchPlaceholder="بحث برقم المستند أو الصنف أو السبب"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={wastages.length} shown={filter.filtered.length}
        filters={[
          { key: 'item_id', placeholder: 'الصنف',
            options: [...rawMaterials, ...products].map((i) => ({ value: i.id, label: i.name })) },
          { key: 'warehouse_id', placeholder: 'المخزن',
            options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
          { key: 'status', placeholder: 'الحالة', options: [
            { value: 'posted', label: 'مرحّل' },
            { value: 'reversal', label: 'حركة عكسية' },
          ] },
        ]}
      />

      <div style={{ textAlign: 'end', marginBottom: 8 }}>{wastageTabCols.control}</div>
      <Table {...wastageKb.tableProps}
        rowKey="id" loading={loading} dataSource={filter.filtered} columns={wastageTabCols.columns}
        locale={{ emptyText: 'لا يوجد مستندات هالك بعد' }} />

      <TabModal centered
        title="مستند هالك جديد" width={480} open={open} onCancel={() => setOpen(false)}
        destroyOnHidden
        footer={<Button type="primary" onClick={() => form.submit()}>حفظ</Button>}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="item_id" label="الصنف" rules={[{ required: true, message: 'اختر الصنف' }]}>
            <Select showSearch placeholder="اختر الصنف" options={itemOptions}
              filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
          </Form.Item>
          <Form.Item name="warehouse_id" label="المخزن" rules={[{ required: true, message: 'اختر المخزن' }]}>
            <Select placeholder="اختر المخزن"
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          </Form.Item>
          <Form.Item name="quantity" label="الكمية المهلَكة" rules={[{ required: true, message: 'أدخل الكمية' }]}>
            <InputNumber min={0.001} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="السبب (اختياري)">
            <Input.TextArea rows={2} placeholder="سبب الهالك" />
          </Form.Item>
        </Form>
      </TabModal>
    </div>
  );
}

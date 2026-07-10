import React, { useEffect, useMemo, useState } from 'react';
import {
  Tabs, Table, Button, Card, Select, InputNumber, Form, Drawer, Space, Tag, Divider,
  message, Row, Col, Statistic, Popconfirm, Input, Empty,
} from 'antd';
import {
  PlusOutlined, RollbackOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined,
  BuildOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';

interface Warehouse { id: number; name: string; }
interface Item {
  id: number; code: string; name: string;
  kind: 'raw_material' | 'product'; unit_of_measure: string;
  purchase_price: string | null; active: boolean;
}
interface Component { item_id: number; quantity: string; }
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
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
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
      const [whRes, itemsRes, bomRes, orderRes, wasteRes] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/items'),
        api.get('/api/v1/manufacturing/boms'),
        api.get('/api/v1/manufacturing/orders'),
        api.get('/api/v1/wastage'),
      ]);
      setWarehouses(whRes.data);
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
      defaultActiveKey="orders"
      items={[
        {
          key: 'orders',
          label: <span><BuildOutlined /> أوامر التصنيع</span>,
          children: (
            <OrdersTab
              orders={orders} products={products} warehouses={warehouses}
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
  orders, products, warehouses, rawById, itemName, whName, activeBomByProduct, loading, reload,
}: {
  orders: Order[]; products: Item[]; warehouses: Warehouse[];
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
      const consumed = Number(c.quantity) * scale;
      const unit = Number(rawById.get(c.item_id)?.purchase_price ?? 0);
      const line = consumed * unit;
      total += line;
      return { item_id: c.item_id, consumed, unit, line };
    });
    return { rows, total, unit: quantity ? total / Number(quantity) : 0 };
  }, [selectedBom, quantity, rawById]);

  const [lastResult, setLastResult] = useState<Order | null>(null);

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
    { title: 'المنتج', key: 'product', render: (_: any, r: Order) => itemName(r.product_id) },
    { title: 'الكمية المنتجة', dataIndex: 'quantity', key: 'qty', render: (q: string) => Number(q) },
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

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'left' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
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

      <Table
        rowKey="id" loading={loading} dataSource={orders} columns={columns}
        expandable={{
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

      <Drawer
        title="أمر تصنيع جديد" width={560} open={open} onClose={() => setOpen(false)}
        destroyOnClose
        extra={<Button type="primary" onClick={() => form.submit()}>ترحيل الأمر</Button>}
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
      </Drawer>
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

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ output_quantity: 1, components: [{}], resources: [] });
    setOpen(true);
  };
  const openEdit = (bom: Bom) => {
    setEditing(bom);
    form.setFieldsValue({
      product_id: bom.product_id, name: bom.name,
      output_quantity: Number(bom.output_quantity),
      components: bom.components.map((c) => ({ item_id: c.item_id, quantity: Number(c.quantity) })),
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
      components: (values.components || []).map((c: any) => ({ item_id: c.item_id, quantity: c.quantity })),
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
            <Tag key={c.item_id}>{itemName(c.item_id)} × {Number(c.quantity)}</Tag>
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

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'left' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>وصفة جديدة</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={boms} columns={columns}
        locale={{ emptyText: 'لا يوجد وصفات بعد' }} />

      <Drawer
        title={editing ? 'تعديل وصفة' : 'وصفة جديدة'} width={560} open={open}
        onClose={() => setOpen(false)} destroyOnClose
        extra={<Button type="primary" onClick={() => form.submit()}>حفظ</Button>}
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
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                    <Form.Item {...field} name={[field.name, 'item_id']} style={{ flex: 1, marginBottom: 0 }}
                      rules={[{ required: true, message: 'اختر الخامة' }]}>
                      <Select placeholder="الخامة" style={{ minWidth: 220 }}
                        options={rawMaterials.map((r) => ({ value: r.id, label: `${r.name} (${r.unit_of_measure})` }))} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'quantity']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'الكمية' }]}>
                      <InputNumber min={0.001} placeholder="الكمية" />
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
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }} wrap>
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
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'rate']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'السعر' }]}>
                      <InputNumber min={0} placeholder="سعر الوحدة" style={{ width: 110 }} />
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
      </Drawer>
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
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const itemOptions = [...rawMaterials, ...products]
    .map((i) => ({ value: i.id, label: `${i.name} (${i.unit_of_measure})` }));

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

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'left' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>هالك جديد</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={wastages} columns={columns}
        locale={{ emptyText: 'لا يوجد مستندات هالك بعد' }} />

      <Drawer
        title="مستند هالك جديد" width={480} open={open} onClose={() => setOpen(false)}
        destroyOnClose
        extra={<Button type="primary" onClick={() => form.submit()}>حفظ</Button>}
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
      </Drawer>
    </div>
  );
}

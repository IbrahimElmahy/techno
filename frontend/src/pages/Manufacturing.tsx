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
interface Bom {
  id: number; product_id: number; name: string;
  output_quantity: string; active: boolean; components: Component[];
}
interface OrderConsumption {
  item_id: number; quantity: string; unit_cost: string; line_cost: string;
}
interface Order {
  id: number; document_number: string; product_id: number; bom_id: number | null;
  quantity: string; unit_cost: string; total_cost: string;
  reversed: boolean; is_reversal: boolean; consumptions: OrderConsumption[];
}

const fmtMoney = (v: string | number) =>
  Number(v).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Manufacturing() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rawMaterials, setRawMaterials] = useState<Item[]>([]);
  const [products, setProducts] = useState<Item[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  const itemName = useMemo(() => {
    const m = new Map<number, Item>();
    [...rawMaterials, ...products].forEach((i) => m.set(i.id, i));
    return (id: number) => m.get(id)?.name ?? `#${id}`;
  }, [rawMaterials, products]);

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
      const [whRes, itemsRes, bomRes, orderRes] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/items'),
        api.get('/api/v1/manufacturing/boms'),
        api.get('/api/v1/manufacturing/orders'),
      ]);
      setWarehouses(whRes.data);
      setRawMaterials(itemsRes.data.filter((i: Item) => i.kind === 'raw_material'));
      setProducts(itemsRes.data.filter((i: Item) => i.kind === 'product'));
      setBoms(bomRes.data);
      setOrders(orderRes.data);
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
              rawById={rawById} itemName={itemName} activeBomByProduct={activeBomByProduct}
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
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Manufacturing Orders tab
// ---------------------------------------------------------------------------
function OrdersTab({
  orders, products, warehouses, rawById, itemName, activeBomByProduct, loading, reload,
}: {
  orders: Order[]; products: Item[]; warehouses: Warehouse[];
  rawById: Map<number, Item>; itemName: (id: number) => string;
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

  const submit = async (values: any) => {
    try {
      await api.post('/api/v1/manufacturing/orders', {
        product_id: values.product_id,
        quantity: values.quantity,
        location: { location_kind: 'warehouse', location_id: values.warehouse_id },
      });
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

      <Table
        rowKey="id" loading={loading} dataSource={orders} columns={columns}
        expandable={{
          expandedRowRender: (r: Order) => (
            <Table
              size="small" pagination={false} rowKey="item_id" dataSource={r.consumptions}
              columns={[
                { title: 'الخامة المستهلكة', key: 'n', render: (_: any, c: OrderConsumption) => itemName(c.item_id) },
                { title: 'الكمية', dataIndex: 'quantity', render: (q: string) => Number(q) },
                { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', render: (v: string) => `${fmtMoney(v)} ج.م` },
                { title: 'إجمالي السطر', dataIndex: 'line_cost', render: (v: string) => `${fmtMoney(v)} ج.م` },
              ]}
            />
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
    form.setFieldsValue({ output_quantity: 1, components: [{}] });
    setOpen(true);
  };
  const openEdit = (bom: Bom) => {
    setEditing(bom);
    form.setFieldsValue({
      product_id: bom.product_id, name: bom.name,
      output_quantity: Number(bom.output_quantity),
      components: bom.components.map((c) => ({ item_id: c.item_id, quantity: Number(c.quantity) })),
    });
    setOpen(true);
  };

  const submit = async (values: any) => {
    const payload = {
      product_id: values.product_id,
      name: values.name,
      output_quantity: values.output_quantity,
      components: (values.components || []).map((c: any) => ({ item_id: c.item_id, quantity: c.quantity })),
    };
    try {
      if (editing) {
        await api.put(`/api/v1/manufacturing/boms/${editing.id}`, {
          name: payload.name, output_quantity: payload.output_quantity, components: payload.components,
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
        </Form>
      </Drawer>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, InputNumber, Select, Switch, Tag, message, Modal, Row, Col } from 'antd';
import { PlusOutlined, DollarOutlined, ColumnWidthOutlined, DeleteOutlined, BarcodeOutlined, EditOutlined, StopOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';

const PRICE_TIERS: { key: string; label: string }[] = [
  { key: 'commercial', label: 'تجاري' },
  { key: 'semi_commercial', label: 'نصف تجاري' },
  { key: 'wholesale', label: 'جملة' },
  { key: 'semi_wholesale', label: 'نصف جملة' },
  { key: 'consumer', label: 'مستهلك' },
];

// Modal editor for an item's five sale price tiers (007).
const PriceTiersButton = ({ itemId, canEdit }: { itemId: number; canEdit: boolean }) => {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, number | null>>({});
  const [base, setBase] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.get(`/api/v1/items/${itemId}/prices`);
      const m: Record<string, number | null> = {};
      (res.data.tiers || []).forEach((t: any) => { m[t.tier] = parseFloat(t.price); });
      setVals(m);
      setBase(res.data.base_sale_price);
    } catch (err) { console.error(err); }
  };

  const onOpen = () => { setOpen(true); load(); };

  const onSave = async () => {
    const tiers = PRICE_TIERS
      .filter((t) => vals[t.key] != null && !Number.isNaN(vals[t.key]))
      .map((t) => ({ tier: t.key, price: Number(vals[t.key]).toFixed(2) }));
    try {
      await api.put(`/api/v1/items/${itemId}/prices`, { tiers });
      message.success('تم حفظ الأسعار');
      setOpen(false);
    } catch (err) { console.error(err); }
  };

  return (
    <>
      <Button size="small" type="link" icon={<DollarOutlined />} onClick={onOpen}>الأسعار</Button>
      <Modal title="الأطر السعرية الخمسة" open={open} onCancel={() => setOpen(false)}
        onOk={onSave} okText={canEdit ? 'حفظ' : 'إغلاق'} okButtonProps={{ disabled: !canEdit }}>
        <p style={{ color: '#888' }}>سعر البيع المرجعي (الأساس): {base ? `${base} ج.م` : '—'} — يُستخدم كبديل لأي فئة غير محددة.</p>
        {PRICE_TIERS.map((t) => (
          <Row key={t.key} gutter={8} align="middle" style={{ marginBottom: 8 }}>
            <Col span={10}>{t.label}</Col>
            <Col span={14}>
              <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonAfter="ج.م"
                disabled={!canEdit} value={vals[t.key] ?? undefined}
                onChange={(v) => setVals({ ...vals, [t.key]: v as number })} />
            </Col>
          </Row>
        ))}
      </Modal>
    </>
  );
};

interface ItemRecord {
  id: number;
  code: string;
  name: string;
  kind: 'raw_material' | 'product';
  unit_of_measure: string;
  purchase_price: string | null;
  sale_price: string | null;
  is_serialized: boolean;
  active: boolean;
}

const KIND_LABELS: Record<string, string> = {
  raw_material: 'مادة خام',
  product: 'منتج تام الصنع',
};

// Sub-component to load and edit product point values inline (thin client with auth constraints)
const ProductPoints = ({
  itemId,
  isEditable,
}: {
  itemId: number;
  isEditable: boolean;
}) => {
  const [points, setPoints] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState<number>(0);

  const fetchPoints = () => {
    api.get(`/api/v1/products/${itemId}/point-value`)
      .then((res) => {
        setPoints(res.data.point_value);
        setInputVal(res.data.point_value);
      })
      .catch(() => setPoints(0));
  };

  useEffect(() => {
    fetchPoints();
  }, [itemId]);

  const handleSave = async () => {
    if (inputVal < 0) {
      message.error('يجب أن تكون قيمة النقاط أكبر من أو تساوي الصفر');
      return;
    }
    try {
      await api.put(`/api/v1/products/${itemId}/point-value`, {
        point_value: inputVal,
      });
      setPoints(inputVal);
      setEditing(false);
      message.success('تم تحديث قيمة نقاط المنتج');
    } catch (err) {
      console.error(err);
    }
  };

  if (points === null) return <span>...</span>;

  if (editing) {
    return (
      <Space>
        <Input
          type="number"
          size="small"
          style={{ width: 80 }}
          value={inputVal}
          onChange={(e) => setInputVal(parseInt(e.target.value, 10) || 0)}
        />
        <Button size="small" type="primary" onClick={handleSave}>
          حفظ
        </Button>
        <Button size="small" onClick={() => setEditing(false)}>
          إلغاء
        </Button>
      </Space>
    );
  }

  return (
    <Space>
      <strong style={{ color: '#F5A11D' }}>{points} نقطة</strong>
      {isEditable && (
        <Button size="small" type="link" onClick={() => setEditing(true)}>
          تعديل
        </Button>
      )}
    </Space>
  );
};

// Modal editor for an item's alternate units of measure + conversion factor (008).
const ItemUnitsButton = ({ itemId, canEdit }: { itemId: number; canEdit: boolean }) => {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<string>('');
  const [rows, setRows] = useState<{ name: string; factor: number | null }[]>([]);

  const load = async () => {
    try {
      const res = await api.get(`/api/v1/items/${itemId}/units`);
      setBase(res.data.base_unit);
      setRows((res.data.units || []).filter((u: any) => !u.is_base)
        .map((u: any) => ({ name: u.name, factor: parseFloat(u.factor) })));
    } catch (err) { console.error(err); }
  };
  const onOpen = () => { setOpen(true); load(); };

  const onSave = async () => {
    const units = rows.filter((r) => r.name && r.factor && r.factor > 0)
      .map((r) => ({ name: r.name, factor: Number(r.factor).toFixed(3) }));
    try {
      await api.put(`/api/v1/items/${itemId}/units`, { units });
      message.success('تم حفظ الوحدات');
      setOpen(false);
    } catch (err) { console.error(err); }
  };

  return (
    <>
      <Button size="small" type="link" icon={<ColumnWidthOutlined />} onClick={onOpen}>الوحدات</Button>
      <Modal title="وحدات القياس ومعامل التحويل" open={open} onCancel={() => setOpen(false)}
        onOk={onSave} okText={canEdit ? 'حفظ' : 'إغلاق'} okButtonProps={{ disabled: !canEdit }}>
        <p style={{ color: '#888' }}>الوحدة الأساسية: <strong>{base}</strong> (معامل = 1). أضف وحدات أكبر بمعاملها مقابل الأساس (مثلاً: كرتونة = 12).</p>
        {rows.map((r, i) => (
          <Row key={i} gutter={8} align="middle" style={{ marginBottom: 8 }}>
            <Col span={12}>
              <Input placeholder="اسم الوحدة (كرتونة)" disabled={!canEdit} value={r.name}
                onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            </Col>
            <Col span={9}>
              <InputNumber min={0.001} step={1} style={{ width: '100%' }} addonBefore="= عدد الأساس"
                disabled={!canEdit} value={r.factor ?? undefined}
                onChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, factor: v as number } : x))} />
            </Col>
            <Col span={3}>
              <Button type="text" danger icon={<DeleteOutlined />} disabled={!canEdit}
                onClick={() => setRows(rows.filter((_, j) => j !== i))} />
            </Col>
          </Row>
        ))}
        {canEdit && (
          <Button type="dashed" block icon={<PlusOutlined />}
            onClick={() => setRows([...rows, { name: '', factor: null }])}>إضافة وحدة</Button>
        )}
      </Modal>
    </>
  );
};

// Modal to manage an item's barcodes (010), each optionally tied to a unit.
const BarcodesButton = ({ itemId, canEdit }: { itemId: number; canEdit: boolean }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ barcode: string; unit: string | null }[]>([]);
  const [units, setUnits] = useState<{ name: string; is_base: boolean }[]>([]);

  const load = async () => {
    try {
      const [bc, un] = await Promise.all([
        api.get(`/api/v1/items/${itemId}/barcodes`),
        api.get(`/api/v1/items/${itemId}/units`),
      ]);
      setRows((bc.data || []).map((b: any) => ({ barcode: b.barcode, unit: b.unit })));
      setUnits((un.data.units || []).map((u: any) => ({ name: u.name, is_base: u.is_base })));
    } catch (err) { console.error(err); }
  };
  const onOpen = () => { setOpen(true); load(); };

  const onSave = async () => {
    const barcodes = rows.filter((r) => r.barcode.trim())
      .map((r) => ({ barcode: r.barcode.trim(), unit: r.unit || null }));
    try {
      await api.put(`/api/v1/items/${itemId}/barcodes`, { barcodes });
      message.success('تم حفظ الباركود');
      setOpen(false);
    } catch (err) { console.error(err); }
  };

  return (
    <>
      <Button size="small" type="link" icon={<BarcodeOutlined />} onClick={onOpen}>الباركود</Button>
      <Modal title="الباركود" open={open} onCancel={() => setOpen(false)}
        onOk={onSave} okText={canEdit ? 'حفظ' : 'إغلاق'} okButtonProps={{ disabled: !canEdit }}>
        <p style={{ color: '#888' }}>عدّة باركودات للصنف، كل واحد يحدّد وحدته (الافتراضي: الأساسية).</p>
        {rows.map((r, i) => (
          <Row key={i} gutter={8} align="middle" style={{ marginBottom: 8 }}>
            <Col span={12}>
              <Input placeholder="الباركود" disabled={!canEdit} value={r.barcode}
                onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, barcode: e.target.value } : x))} />
            </Col>
            <Col span={9}>
              <Select style={{ width: '100%' }} placeholder="الوحدة" disabled={!canEdit}
                value={r.unit ?? '__base__'}
                onChange={(v) => setRows(rows.map((x, j) => j === i ? { ...x, unit: v === '__base__' ? null : v } : x))}>
                {units.map((u) => (
                  <Select.Option key={u.name} value={u.is_base ? '__base__' : u.name}>{u.name}</Select.Option>
                ))}
              </Select>
            </Col>
            <Col span={3}>
              <Button type="text" danger icon={<DeleteOutlined />} disabled={!canEdit}
                onClick={() => setRows(rows.filter((_, j) => j !== i))} />
            </Col>
          </Row>
        ))}
        {canEdit && (
          <Button type="dashed" block icon={<PlusOutlined />}
            onClick={() => setRows([...rows, { barcode: '', unit: null }])}>إضافة باركود</Button>
        )}
      </Modal>
    </>
  );
};

// Modal to receive serial numbers into stock + list in-stock serials (009).
const SerialsButton = ({ itemId, canEdit }: { itemId: number; canEdit: boolean }) => {
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [whId, setWhId] = useState<number | undefined>();
  const [text, setText] = useState('');
  const [inStock, setInStock] = useState<any[]>([]);

  const load = async () => {
    try {
      const [wh, ser] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get(`/api/v1/items/${itemId}/serials?status=in_stock`),
      ]);
      setWarehouses(wh.data); setInStock(ser.data);
    } catch (err) { console.error(err); }
  };
  const onOpen = () => { setOpen(true); load(); };

  const onReceive = async () => {
    const serials = text.split(/[\s,\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!whId || serials.length === 0) { message.warning('اختر المخزن وأدخل أرقاماً تسلسلية'); return; }
    try {
      await api.post(`/api/v1/items/${itemId}/serials/receive`, {
        location_kind: 'warehouse', location_id: whId, serials });
      message.success(`تم استلام ${serials.length} رقم تسلسلي`);
      setText(''); load();
    } catch (err) { console.error(err); }
  };

  return (
    <>
      <Button size="small" type="link" icon={<BarcodeOutlined />} onClick={onOpen}>السيريال</Button>
      <Modal title="الأرقام التسلسلية" open={open} onCancel={() => setOpen(false)} footer={null} width={560}>
        {canEdit && (
          <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8 }}>
            <strong>استلام أرقام تسلسلية للمخزون</strong>
            <Select style={{ width: '100%', margin: '8px 0' }} placeholder="مخزن الاستلام" value={whId}
              onChange={setWhId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
            <Input.TextArea rows={3} placeholder="أرقام تسلسلية مفصولة بمسافة أو فاصلة أو سطر"
              value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="primary" style={{ marginTop: 8 }} onClick={onReceive}>استلام</Button>
          </div>
        )}
        <strong>المتوفر بالمخزون ({inStock.length})</strong>
        <Table size="small" rowKey="id" dataSource={inStock} pagination={{ pageSize: 8 }}
          columns={[
            { title: 'الرقم التسلسلي', dataIndex: 'serial' },
            { title: 'الموقع', dataIndex: 'location_id', render: (v: number, r: any) => r.location_kind ? `${r.location_kind} #${v}` : '-' },
          ]} />
      </Modal>
    </>
  );
};

export default function Catalog() {
  const { options: kindOptions } = useLookup('item_kind');
  const { options: uomOptions } = useLookup('unit_of_measure');
  const kindLabels = labelMap(kindOptions);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<ItemRecord | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const { user } = useAuth();

  // Point editing is permitted for system_admin and after_sales_staff roles only
  const canEditPoints = ['system_admin', 'after_sales_staff'].includes(user?.role || '');
  // Tier-price editing requires catalog.write (system_admin, branch_manager, purchasing_manager).
  const canEditPrices = ['system_admin', 'branch_manager', 'purchasing_manager'].includes(user?.role || '');
  // Item-core edit/deactivate gated to the same roles allowed to create items.
  const canManageItems = ['system_admin', 'purchasing_manager'].includes(user?.role || '');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/items');
      setItems(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const onCreateItem = async (values: any) => {
    try {
      const payload = {
        name: values.name,
        kind: values.kind,
        unit_of_measure: values.unit_of_measure,
        purchase_price: values.kind === 'raw_material' ? values.purchase_price : null,
        sale_price: values.kind === 'product' ? values.sale_price : null,
      };

      await api.post('/api/v1/items', { ...payload, is_serialized: !!values.is_serialized });
      message.success('تم تسجيل الصنف في الكتالوج بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchItems();
    } catch (err) {
      console.error(err);
    }
  };

  const openEditItem = (record: ItemRecord) => {
    setEditing(record);
    editForm.setFieldsValue({
      name: record.name,
      purchase_price: record.purchase_price ?? undefined,
      sale_price: record.sale_price ?? undefined,
      is_serialized: record.is_serialized,
      active: record.active,
    });
    setEditVisible(true);
  };

  const onEditItem = async (values: any) => {
    if (!editing) return;
    try {
      const payload: any = { name: values.name, active: values.active };
      if (editing.kind === 'raw_material') payload.purchase_price = values.purchase_price;
      if (editing.kind === 'product') {
        payload.sale_price = values.sale_price;
        payload.is_serialized = !!values.is_serialized;
      }
      await api.patch(`/api/v1/items/${editing.id}`, payload);
      message.success('تم تحديث بيانات الصنف بنجاح');
      setEditVisible(false);
      setEditing(null);
      fetchItems();
    } catch (err) {
      console.error(err);
    }
  };

  const deactivateItem = (record: ItemRecord) => {
    showDeactivationConfirm({
      title: 'إلغاء تفعيل الصنف',
      content: `هل أنت متأكد من إلغاء تفعيل "${record.name}"؟ لن يظهر في اختيارات العمليات الجديدة، وتظل حركاته السابقة كما هي.`,
      onOk: async () => {
        try {
          await api.delete(`/api/v1/items/${record.id}`);
          message.success('تم إلغاء تفعيل الصنف');
          fetchItems();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const columns = [
    {
      title: 'كود الصنف',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => <Tag>{code}</Tag>,
    },
    {
      title: 'اسم الصنف',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'نوع الصنف',
      dataIndex: 'kind',
      key: 'kind',
      render: (kind: string) => (
        <Tag color={kind === 'product' ? 'green' : 'orange'}>
          {kindLabels[kind] || KIND_LABELS[kind] || kind}
        </Tag>
      ),
    },
    {
      title: 'وحدة القياس',
      dataIndex: 'unit_of_measure',
      key: 'unit_of_measure',
    },
    {
      title: 'سعر البيع المرجعي',
      dataIndex: 'sale_price',
      key: 'sale_price',
      render: (price: string | null) =>
        price ? `${parseFloat(price).toFixed(2)} ج.م` : '-',
    },
    {
      title: 'سعر الشراء المرجعي',
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      render: (price: string | null) =>
        price ? `${parseFloat(price).toFixed(2)} ج.م` : '-',
    },
    {
      title: 'الأطر السعرية',
      key: 'price_tiers',
      render: (_: any, record: ItemRecord) =>
        record.kind === 'product' ? <PriceTiersButton itemId={record.id} canEdit={canEditPrices} /> : '-',
    },
    {
      title: 'الوحدات',
      key: 'units',
      render: (_: any, record: ItemRecord) => <ItemUnitsButton itemId={record.id} canEdit={canEditPrices} />,
    },
    {
      title: 'الباركود',
      key: 'barcodes',
      render: (_: any, record: ItemRecord) => <BarcodesButton itemId={record.id} canEdit={canEditPrices} />,
    },
    {
      title: 'السيريال',
      key: 'serials',
      render: (_: any, record: ItemRecord) =>
        record.is_serialized
          ? <SerialsButton itemId={record.id} canEdit={canEditPrices} />
          : <Tag>غير مُسلسَل</Tag>,
    },
    {
      title: 'نقاط المنتج',
      key: 'points',
      render: (_: any, record: ItemRecord) => {
        if (record.kind !== 'product') return '-';
        return <ProductPoints itemId={record.id} isEditable={canEditPoints} />;
      },
    },
    {
      title: 'الحالة',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) =>
        active ? <Tag color="green">نشط</Tag> : <Tag color="red">غير نشط</Tag>,
    },
    ...(canManageItems ? [{
      title: 'إجراءات',
      key: 'actions',
      render: (_: any, record: ItemRecord) => (
        <Space>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEditItem(record)}>
            تعديل
          </Button>
          {record.active && (
            <Button size="small" type="link" danger icon={<StopOutlined />}
              onClick={() => deactivateItem(record)}>
              إلغاء تفعيل
            </Button>
          )}
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      <Card
        title="كتالوج المنتجات والمواد الخام"
        extra={
          user?.role === 'system_admin' || user?.role === 'purchasing_manager' ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerVisible(true)}>
              إضافة صنف للكتالوج
            </Button>
          ) : null
        }
      >
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Add Item Drawer */}
      <Drawer
        title="إضافة صنف جديد للكتالوج"
        width={400}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onCreateItem} requiredMark={false}>
          <Form.Item
            name="name"
            label="اسم الصنف"
            rules={[{ required: true, message: 'يرجى إدخال اسم الصنف!' }]}
          >
            <Input placeholder="مثال: ماسورة مياه 3/4 بوصة" />
          </Form.Item>

          <Form.Item
            name="kind"
            label="نوع الصنف"
            rules={[{ required: true, message: 'يرجى تحديد نوع الصنف!' }]}
          >
            <Select placeholder="اختر النوع"
              options={kindOptions.map((o) => ({ value: o.value, label: o.label }))} />
          </Form.Item>

          <Form.Item
            name="unit_of_measure"
            label="وحدة القياس"
            rules={[{ required: true, message: 'يرجى إدخال وحدة القياس!' }]}
          >
            <Select
              showSearch
              placeholder="اختر وحدة القياس (تُدار من الإعدادات)"
              options={uomOptions.map((o) => ({ value: o.value, label: o.label }))}
              filterOption={(input, option) => String(option?.label ?? '').includes(input)}
            />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.kind !== curr.kind}>
            {({ getFieldValue }) => {
              const kind = getFieldValue('kind');
              if (kind === 'product') {
                return (
                  <Form.Item
                    name="sale_price"
                    label="سعر البيع المرجعي (ج.م)"
                    rules={[{ required: true, message: 'يرجى إدخال سعر البيع!' }]}
                  >
                    <Input type="number" min={0} step="0.01" placeholder="0.00" />
                  </Form.Item>
                );
              } else if (kind === 'raw_material') {
                return (
                  <Form.Item
                    name="purchase_price"
                    label="سعر الشراء المرجعي (ج.م)"
                    rules={[{ required: true, message: 'يرجى إدخال سعر الشراء!' }]}
                  >
                    <Input type="number" min={0} step="0.01" placeholder="0.00" />
                  </Form.Item>
                );
              }
              return null;
            }}
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.kind !== curr.kind}>
            {({ getFieldValue }) => getFieldValue('kind') === 'product' ? (
              <Form.Item name="is_serialized" label="صنف بأرقام تسلسلية؟" valuePropName="checked"
                extra="عند التفعيل يلزم إدخال الأرقام التسلسلية عند الاستلام والبيع">
                <Switch checkedChildren="نعم" unCheckedChildren="لا" />
              </Form.Item>
            ) : null}
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                حفظ وإضافة
              </Button>
              <Button onClick={() => setDrawerVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>

      {/* Edit Item Drawer */}
      <Drawer
        title={`تعديل الصنف: ${editing?.name ?? ''}`}
        width={400}
        onClose={() => { setEditVisible(false); setEditing(null); }}
        open={editVisible}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={onEditItem} requiredMark={false}>
          <Form.Item name="name" label="اسم الصنف"
            rules={[{ required: true, message: 'يرجى إدخال اسم الصنف!' }]}>
            <Input />
          </Form.Item>

          {editing?.kind === 'product' && (
            <Form.Item name="sale_price" label="سعر البيع المرجعي (ج.م)">
              <Input type="number" min={0} step="0.01" placeholder="0.00" />
            </Form.Item>
          )}
          {editing?.kind === 'raw_material' && (
            <Form.Item name="purchase_price" label="سعر الشراء المرجعي (ج.م)">
              <Input type="number" min={0} step="0.01" placeholder="0.00" />
            </Form.Item>
          )}
          {editing?.kind === 'product' && (
            <Form.Item name="is_serialized" label="صنف بأرقام تسلسلية؟" valuePropName="checked">
              <Switch checkedChildren="نعم" unCheckedChildren="لا" />
            </Form.Item>
          )}

          <Form.Item name="active" label="الحالة" valuePropName="checked">
            <Switch checkedChildren="نشط" unCheckedChildren="غير نشط" />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">حفظ التعديلات</Button>
              <Button onClick={() => { setEditVisible(false); setEditing(null); }}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

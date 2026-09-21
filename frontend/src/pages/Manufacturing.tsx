import React, { useEffect, useMemo, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { PAGE_SIZE_OPTIONS } from '../utils/pagination';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, Row, Select, Space, Statistic, Steps, Table, Tabs, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, RollbackOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined,
  BuildOutlined, PlayCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useQueryTab } from '../components/useQueryTab';
import { useDocRoute } from '../components/useDocRoute';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

import StatsRow from '../components/StatsRow';
import { numeralsLocale } from '../utils/money';
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
  Number(v).toLocaleString(numeralsLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Manufacturing() {
  // «نسب انتاج» and «انتاج حسب النسب» are two entries in their menu and two tabs here.
  const [tab, setTab] = useQueryTab('orders');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [rawMaterials, setRawMaterials] = useState<Item[]>([]);
  const [products, setProducts] = useState<Item[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
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

  const loadAll = async () => {
    setLoading(true);
    try {
      // `‎/manufacturing/orders` اتشال من هنا مع تبويبه: الجدول فاضي في الشركة كلها
      // (صفر صف)، والنداء كان بيتعمل مع كل فتحة للشاشة على حاجة محدش بيقراها.
      const [whRes, brRes, itemsRes, bomRes, wasteRes] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/branches'),
        api.get('/api/v1/items'),
        api.get('/api/v1/manufacturing/boms'),
        api.get('/api/v1/wastage'),
      ]);
      setWarehouses(whRes.data);
      setBranches(brRes.data || []);
      setRawMaterials(itemsRes.data.filter((i: Item) => i.kind === 'raw_material'));
      setProducts(itemsRes.data.filter((i: Item) => i.kind === 'product'));
      setBoms(bomRes.data);
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
          // الشاشة المطلوبة: أمر تشغيل واحد بسطور منتجات وسطور خامات. القديمة (منتج
          // واحد للأمر) اتنقلت لتبويب جنبها — تلات فروع شغّالة عليها دلوقتي، وشيلها
          // معناه إن شغلهم يقف في نفس اليوم.
          key: 'orders',
          label: <span><BuildOutlined /> أوامر التشغيل</span>,
          children: (
            <ProductionOrdersTab
              products={products} rawMaterials={rawMaterials} warehouses={warehouses}
              branches={branches} boms={boms} itemName={itemName} whName={whName}
              active={tab === 'orders'}
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
  const recipesTabCols = useTableColumns('mfg-recipes', columns, {
    export: { name: 'الوصفات', rows: filter.filtered },
  });

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
            tooltip="عدد وحدات المنتج الناتجة من تشغيل الوصفة مرة واحدة">
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
  const wastageTabCols = useTableColumns('mfg-wastage', columns, {
    export: { name: 'مستندات الهالك', rows: filter.filtered },
  });

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
              filterOption={searchFilter} filterSort={searchRank} />
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

// ---------------------------------------------------------------------------
// أوامر التشغيل (032) — الورقة اللي بتطلّع كذا منتج من كذا خامة
// ---------------------------------------------------------------------------
/**
 * الشاشة القديمة كانت بتعرض `ManufacturingOrder` — **منتج واحد لكل أمر**. وأمر المصنع
 * بيطلّع أربعة، فالصفحة كانت بتوري حاجة تانية غير اللي في إيد الورشة.
 *
 * هنا الورقة بشكلها: ترويسة، جدول منتجات، إجماليات، جدول خامات — وكل خامة **منسوبة
 * للمنتج بتاعها**، فتكلفة المنتج = مجموع خاماته + مصاريفه من غير أي توزيع بنسب.
 *
 * **وأهم عمود في الشاشة هو «الفرق».** كل سطر شايل «المفروض» (من الوصفة وقت فتح الأمر)
 * و«اللي حصل»، والفرق بينهم هو الفاقد أو الزيادة. ده الرقم اللي المصنع بيسأل عليه
 * ومافيش شاشة تانية بتقوله: الحركة بتقول اتصرف كام، والوصفة بتقول المفروض كام، ومحدش
 * بيحطهم على نفس السطر.
 *
 * **والحركة مابتحصلش إلا عند التنفيذ.** المسودة تتعدّل وتتمسح براحتها، وماحدش بيخصم
 * مخزون على ورقة لسه بتتكتب.
 *
 * **مافيش معاينة تكلفة في الفورم.** التكلفة بتتجمّد من متوسط التكلفة على السيرفر وقت
 * التنفيذ، والواجهة عندها `purchase_price` وهو رقم تاني — فمعاينة بيه كانت هتقول رقم
 * والورقة تطلع برقم غيره.
 */
type POState = 'draft' | 'confirmed' | 'in_progress' | 'done' | 'reversed';

interface POMaterial {
  id: number; product_line_id: number | null; item_id: number; warehouse_id: number | null;
  planned_quantity: string; quantity: string; unit: string | null;
  unit_cost: string; line_cost: string; waste_quantity: string;
}
interface POProduct {
  id: number; item_id: number; warehouse_id: number | null;
  planned_quantity: string; quantity: string; unit: string | null; bom_id: number | null;
  material_cost: string; expense_amount: string; total_cost: string; unit_cost: string;
}
interface ProductionOrder {
  id: number; document_number: string; production_date: string | null;
  branch_id: number | null; external_document_number: string | null;
  statement1: string | null; notes: string | null; state: POState; reviewed: boolean;
  material_cost: string; expense_amount: string; total_cost: string;
  planned_quantity: string; product_quantity: string; material_quantity: string;
  imported_from: string | null; reversed: boolean; is_reversal: boolean;
  products: POProduct[]; materials: POMaterial[];
}

const PO_STATE_TAG: Record<POState, { color: string; label: string }> = {
  draft: { color: 'default', label: 'مسودة' },
  confirmed: { color: 'blue', label: 'مؤكد' },
  in_progress: { color: 'processing', label: 'شغّال' },
  done: { color: 'green', label: 'منفّذ' },
  reversed: { color: 'red', label: 'معكوس' },
};

/** خط سير الورقة — نفس ترتيب `ProductionState` على السيرفر. */
const PO_FLOW: POState[] = ['draft', 'confirmed', 'in_progress', 'done'];

/**
 * شريط الحالة فوق الورقة — **اللي بيفتح أمر شغل لازم يعرف هو فين قبل ما يقرا رقم**.
 *
 * الحالة كانت وسم واحد في آخر عمود في الكشف، فاللي بيفتح الورقة مايعرفش إيه اللي
 * فات وإيه اللي جاي — ولا إن «مؤكد» قدامها خطوة تانية أصلاً. الشريط بيقول التلاتة
 * مع بعض: اللي عدّى، اللي إحنا فيه، واللي ناقص.
 *
 * والمعكوس مش مرحلة في الخط — هو نهاية تانية خالص — فبيتقال لوحده.
 */
function POFlow({ state }: { state: POState }) {
  if (state === 'reversed') {
    return (
      <Tag color="red" style={{ marginInlineEnd: 0 }}>
        اتعكس — الحركات المرآة اتكتبت والسطور فضلت في السجل
      </Tag>
    );
  }
  const at = PO_FLOW.indexOf(state);
  return (
    <Steps
      size="small" current={at < 0 ? 0 : at}
      status={state === 'done' ? 'finish' : 'process'}
      items={PO_FLOW.map((k) => ({ title: PO_STATE_TAG[k].label }))}
      style={{ maxWidth: 560 }}
    />
  );
}

const num = (v: string | number) => Number(v).toLocaleString(numeralsLocale());

/**
 * الفرق بين المفروض واللي حصل. **الصفر في «المفروض» معناه مافيش خطة متسجّلة** — زي
 * الأوامر المنقولة من a5، المصدر فيه اللي اتصرف بس — فبنقول «—» بدل ما نعرض الكمية
 * كلها على إنها فاقد.
 */
function Variance({ planned, actual }: { planned: string; actual: string }) {
  const p = Number(planned);
  if (!p) return <span style={{ color: '#aaa' }}>—</span>;
  const d = Number(actual) - p;
  if (!d) return <Tag color="green">مطابق</Tag>;
  return (
    <Tag color={d > 0 ? 'red' : 'blue'}>
      {d > 0 ? '+' : ''}{num(d.toFixed(3))}
    </Tag>
  );
}

/** سطر في الفورم — مفتاح محلي عشان الحذف مايلخبطش الصفوف. */
interface DraftMaterial {
  key: number; item_id?: number; warehouse_id?: number;
  planned_quantity?: number | null; quantity?: number | null; waste_quantity?: number | null;
}
interface DraftProduct {
  key: number; item_id?: number; warehouse_id?: number;
  planned_quantity?: number | null; quantity?: number | null;
  bom_id?: number | null; expense_amount?: number | null; materials: DraftMaterial[];
  /**
   * **اللي كاتب الورقة لمس الخامات بإيده ولا لأ؟**
   *
   * الوصفة بتفجّر الخامات لوحدها أول ما تختار المنتج، وبتتحدّث لما تغيّر الكمية — بس
   * بعد ما حد يعدّل سطر بإيده، **التحديث التلقائي بيقف**. من غير الشرط ده، واحد بيزوّد
   * خامة برّه الوصفة أو بيظبّط كمية وبعدين بيصلّح رقم المنتج بيلاقي شغله اتمسح.
   *
   * وبيرجع `false` لما يدوس «طلّع الوصفة» صراحةً — ده طلبه إن الورقة ترجع للوصفة.
   */
  materialsTouched?: boolean;
}

let poSeq = 1;
const newPOMaterial = (): DraftMaterial => ({ key: poSeq++ });
const newPOProduct = (): DraftProduct => ({ key: poSeq++, materials: [] });

/** رقم ورقة الأمر المنقول — بأرقام المستخدم، **من غير فاصلة آلاف**.
 *
 * `num` بتعدّي على `toLocaleString`، فرقم الأمر ٣٥٣٧ كان بيطلع «٣٬٥٣٧» — وده رقم
 * مقروء ككمية مش كمستند، واللي بيطابقه على الورقة بيقف عند الفاصلة. فالتحويل هنا
 * على الخانة لوحدها.
 *
 * وبيرجع الرقم زي ما هو لو مش أرقام (حد كتب «أمر ٣٧/ب»)، و«—» لو فاضي: `Number('')`
 * بيطلع صفر، والأمر اللي مالوش ورقة كان هيبان «أمر شغل ٠» وكأن ده رقمه.
 */
const poPaper = (r: { external_document_number: string | null }) => {
  const v = (r.external_document_number || '').trim();
  if (!v) return '—';
  if (numeralsLocale() !== 'ar-EG') return v;
  return v.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
};

function ProductionOrdersTab({
  products, rawMaterials, warehouses, branches, boms, itemName, whName, active,
}: {
  products: Item[]; rawMaterials: Item[]; warehouses: Warehouse[];
  branches: { id: number; name: string }[]; boms: Bom[];
  itemName: (id: number) => string;
  whName: (id: number | null | undefined) => string;
  /** التبويب ده هو الظاهر دلوقتي — بيتمرّر لـ`useDocRoute` كـ`enabled`.
   *
   *  antd بتسيب أي تبويب اتفتح مرة شغّال ومخفي بعدها، فخُطّافه بيفضل بيسمع العنوان
   *  ويقفل مستند تبويب تاني على «رجوع». المخفي بيسكت. */
  active: boolean;
}) {
  const [rows, setRows] = useState<ProductionOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<POState | undefined>();
  const [scope, setScope] = useState<'all' | 'ours' | 'imported'>('all');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // --- الورقة اللي بتتكتب ---
  const [productionDate, setProductionDate] = useState<any>(null);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [externalRef, setExternalRef] = useState('');
  const [statement, setStatement] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftProduct[]>([]);
  // التبويب المفتوح جوّه الفورم. بيرجع لـ«الشغل» مع كل فتح — ده اللي حد فاتح الورقة
  // عايزه، والبيان والملاحظات بيتكتبوا مرة.
  const [formTab, setFormTab] = useState('work');

  const allItems = useMemo(() => [...products, ...rawMaterials], [products, rawMaterials]);
  const itemOptions = (list: Item[]) =>
    list.map((i) => ({ value: i.id, label: `${i.code} — ${i.name}` }));
  const whOptions = warehouses.map((w) => ({ value: w.id, label: w.name }));

  const branchName = useMemo(() => {
    const m = new Map(branches.map((b) => [b.id, b.name]));
    return (id: number | null) => (id == null ? '-' : m.get(id) ?? `#${id}`);
  }, [branches]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/manufacturing/production-orders', {
        params: {
          limit: pageSize, offset: (page - 1) * pageSize,
          ...(query.trim() ? { search: query.trim() } : {}),
          ...(stateFilter ? { state: stateFilter } : {}),
          ...(scope === 'all' ? {} : { imported: scope === 'imported' }),
        },
      });
      setRows(res.data?.rows ?? []);
      setTotal(res.data?.total ?? 0);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  // الترقيم على السيرفر — المنقول لوحده بالآلاف، وتحميله كله عشان نعرض خمسين بيرجّع
  // ميجابايتات في كل فتحة للشاشة.
  useEffect(() => { load(); }, [page, pageSize, stateFilter, scope]);

  const resetForm = () => {
    setEditingId(null); setProductionDate(null); setBranchId(undefined);
    setExternalRef(''); setStatement(''); setNotes(''); setLines([]); setFormTab('work');
  };

  const openNew = () => { resetForm(); setLines([newPOProduct()]); setOpen(true); };

  /**
   * أمر التشغيل المفتوح جزء من العنوان — الشرح في `useDocRoute`.
   *
   * **والتبويب ده وحده هو اللي بيقرا `?doc=`.** الشاشة خمس تبويبات، وantd بتسيب أي
   * تبويب اتفتح مرة شغّال ومخفي بعدها — يعني لو اتنين منهم بيسمعوا نفس البارامتر،
   * الرقم الواحد هيتفسّر مرتين في مساحتين مختلفتين، وواحد فيهم هيفتح مستند مش بتاعه
   * أو يوقع وهو بيقرا صف ناقص. فـ«أوامر التشغيل» — المستند الأساسي في الشاشة — بياخد
   * البارامتر، والباقي زي ما هو.
   *
   * وبيتجاب بالرقم من السيرفر مش من الصفحة المحمّلة: `openEdit` بيقرا `r.products`
   * و`r.materials` سطر سطر، وصف ناقص فيهم بيفضّي الشاشة.
   */
  const { markOpen, markClosed } = useDocRoute<ProductionOrder>({
    rows,
    enabled: active,
    openId: open && editingId != null ? editingId : null,
    open: (r) => openEdit(r),
    close: () => closeEditor(),
    loading,
    fetchOne: async (id) => {
      try {
        return (await api.get(
          `/api/v1/manufacturing/production-orders/${id}`)).data as ProductionOrder;
      } catch {
        message.warning(`أمر التشغيل رقم ${id} مش موجود`);
        return null;
      }
    },
  });

  /** بيقفل ورقة الأمر ويرجّع للكشف — والعنوان بيتنضّف معاها. */
  const closeEditor = () => { setOpen(false); resetForm(); markClosed(); };

  const openEdit = (r: ProductionOrder) => {
    markOpen(r.id, 'edit');
    setEditingId(r.id);
    setProductionDate(r.production_date ? dayjs(r.production_date) : null);
    setBranchId(r.branch_id ?? undefined);
    setExternalRef(r.external_document_number || '');
    setStatement(r.statement1 || '');
    setNotes(r.notes || '');
    setLines(r.products.map((p) => ({
      key: poSeq++, item_id: p.item_id, warehouse_id: p.warehouse_id ?? undefined,
      planned_quantity: Number(p.planned_quantity), quantity: Number(p.quantity),
      bom_id: p.bom_id, expense_amount: Number(p.expense_amount),
      // **الورقة المفتوحة للتعديل خاماتها محسومة.** هي اللي اتسجّل فعلاً — يمكن
      // اتعدّلت بإيد وقت الشغل — فالتفجير التلقائي مايلمسهاش. من غير السطر ده، أول
      // تصليح في كمية المنتج كان هيمسح كل اللي اتسجّل ويرجّعه لأرقام الوصفة.
      materialsTouched: true,
      materials: r.materials.filter((m) => m.product_line_id === p.id).map((m) => ({
        key: poSeq++, item_id: m.item_id, warehouse_id: m.warehouse_id ?? undefined,
        planned_quantity: Number(m.planned_quantity), quantity: Number(m.quantity),
        waste_quantity: Number(m.waste_quantity),
      })),
    })));
    setOpen(true);
  };

  /**
   * تعديل سطر منتج. `recompute` معناها «ده تغيير الوصفة بتتبعه» — المنتج أو الوصفة
   * أو الكمية أو المخزن — فالخامات بتتفجّر من الوصفة بعده، إلا لو حد لمسها بإيده.
   */
  const patchLine = (
    key: number, patch: Partial<DraftProduct>, recompute: false | 'qty' | 'product' = false,
  ) =>
    setLines((p) => p.map((x) => {
      if (x.key !== key) return x;
      const next = { ...x, ...patch };
      return recompute ? withRecipe(next, recompute === 'product') : next;
    }));
  const patchMaterial = (lineKey: number, matKey: number, patch: Partial<DraftMaterial>) =>
    setLines((p) => p.map((x) => (x.key === lineKey
      ? {
        ...x,
        // أول لمسة بإيد بتوقف التحديث التلقائي من الوصفة — الشرح عند `materialsTouched`.
        materialsTouched: true,
        materials: x.materials.map((y) => (y.key === matKey ? { ...y, ...patch } : y)),
      }
      : x)));

  /**
   * خامات سطر المنتج من وصفته، مضروبة في الكمية — أو `null` لو مافيش وصفة أو كمية.
   *
   * **ده «المفروض»**، والمصروف بيتفتح بنفس الرقم عشان اللي مابيغيّرهوش يبقى قال
   * «اتصرف زي الوصفة» صراحةً مش سابه فاضي.
   *
   * ومخزن الخامة بييجي من مخزن الإنتاج لو الوصفة مش قايلة حاجة: الحالة الغالبة إن
   * الاتنين مكان واحد، والخانة الفاضية كانت بتوقف الحفظ برسالة «الصنف محتاج مخزن».
   */
  const recipeMaterials = (ln: DraftProduct): DraftMaterial[] | null => {
    const bom = boms.find((b) => b.id === ln.bom_id)
      ?? boms.find((b) => b.active && b.product_id === ln.item_id);
    if (!bom) return null;
    const qty = Number(ln.planned_quantity ?? ln.quantity ?? 0);
    if (!qty) return null;
    const scale = qty / Number(bom.output_quantity || 1);
    return bom.components.map((c) => {
      // × معامل الوحدة زي الباك-إند بالظبط: سطر وصفة «٢ كرتونة» بيصرف ٢٤ قطعة،
      // ومعاينة بتقول ٢ بتبعت أمين المخزن يدوّر على الـ٢٢ الباقيين.
      const q = Number(c.quantity) * scale * Number(c.unit_factor ?? 1);
      return {
        key: poSeq++, item_id: c.item_id, planned_quantity: q, quantity: q,
        warehouse_id: ln.warehouse_id,
      };
    });
  };

  /**
   * **الوصفة بتتفجّر لوحدها.** اختيار المنتج أو تغيير الكمية بيعيد بناء الخامات من
   * غير ما حد يدوس حاجة — ده الغرض من الوصفة أصلاً، والزرار اللي كان لازم تفتكره
   * كان بيخلّي أمر يتكتب من غير خامات وينكسر عند الحفظ.
   *
   * وبيسكت خالص لو اللي كاتب الورقة لمس الخامات بإيده. الشرح عند `materialsTouched`.
   *
   * **و`seedQty` بتحط كمية مبدئية لما تكون فاضية** — وده اللي بيخلّي اختيار المنتج
   * لوحده يوري حاجة. من غيرها، اللي بيختار منتج له وصفة كان بيلاقي «خاماته» فاضية
   * ويفتكر إن الوصفة مش شغّالة، وهي بس مستنية رقم. الكمية بتبقى ناتج الوصفة (وحدة
   * في كل وصفات المصنع)، وأول ما يكتب الكمية الحقيقية كل حاجة بتتظبط بالنسبة.
   *
   * وبتتحط وقت تغيير المنتج أو الوصفة بس — مش مع كل تغيير في الكمية. لو اتحطت هناك
   * كمان، اللي بيمسح الرقم عشان يكتب غيره كان هيلاقي «١» بترجع تحت إيده وهو بيكتب.
   */
  const withRecipe = (ln: DraftProduct, seedQty = false): DraftProduct => {
    if (ln.materialsTouched) return ln;
    let next = ln;
    if (seedQty && !Number(next.planned_quantity) && !Number(next.quantity)) {
      const bom = boms.find((b) => b.id === next.bom_id)
        ?? boms.find((b) => b.active && b.product_id === next.item_id);
      if (bom) {
        const q = Number(bom.output_quantity) || 1;
        next = { ...next, planned_quantity: q, quantity: q };
      }
    }
    const rows = recipeMaterials(next);
    return rows ? { ...next, materials: rows } : next;
  };

  /** زر «طلّع الوصفة» — طلب صريح، فبيتجاهل اللمس وبيرجّع السطر للوصفة. */
  const fillFromRecipe = (key: number) => {
    setLines((prev) => prev.map((ln) => {
      if (ln.key !== key) return ln;
      const rows = recipeMaterials(ln);
      if (!rows) {
        const hasBom = boms.some((b) => b.product_id === ln.item_id);
        message.info(hasBom ? 'اكتب الكمية الأول' : 'المنتج ده مالوش وصفة');
        return ln;
      }
      const bom = boms.find((b) => b.id === ln.bom_id)
        ?? boms.find((b) => b.active && b.product_id === ln.item_id);
      return { ...ln, bom_id: bom?.id ?? ln.bom_id ?? null, materials: rows,
               materialsTouched: false };
    }));
  };

  const payload = () => ({
    production_date: productionDate ? productionDate.format('YYYY-MM-DD') : undefined,
    branch_id: branchId ?? undefined,
    external_document_number: externalRef || undefined,
    statement1: statement || undefined,
    notes: notes || undefined,
    products: lines.map((ln) => ({
      item_id: ln.item_id, quantity: ln.quantity,
      planned_quantity: ln.planned_quantity ?? ln.quantity,
      warehouse_id: ln.warehouse_id ?? undefined,
      bom_id: ln.bom_id ?? undefined,
      expense_amount: ln.expense_amount ?? 0,
      materials: ln.materials.filter((m) => m.item_id && m.quantity).map((m) => ({
        item_id: m.item_id, quantity: m.quantity,
        planned_quantity: m.planned_quantity ?? m.quantity,
        warehouse_id: m.warehouse_id ?? undefined,
        waste_quantity: m.waste_quantity ?? 0,
      })),
    })),
  });

  const submit = async () => {
    if (!lines.length) { message.warning('ضيف منتج واحد على الأقل'); return; }
    for (const ln of lines) {
      if (!ln.item_id || !ln.quantity) { message.warning('كل سطر منتج محتاج صنف وكمية'); return; }
    }
    setSaving(true);
    try {
      if (editingId) await api.put(`/api/v1/manufacturing/production-orders/${editingId}`, payload());
      else await api.post('/api/v1/manufacturing/production-orders', payload());
      message.success(editingId ? 'اتحفظت المسودة' : 'اتفتح أمر تشغيل كمسودة — مافيش حركة مخزون لسه');
      closeEditor(); setPage(1); load();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const act = async (r: ProductionOrder, verb: 'confirm' | 'start' | 'execute', done: string) => {
    try {
      await api.post(`/api/v1/manufacturing/production-orders/${r.id}/${verb}`);
      message.success(done);
      load();
    } catch (err) { console.error(err); }
  };

  const reverse = (r: ProductionOrder) => {
    showReversalConfirm({
      title: 'التراجع عن أمر تشغيل',
      content: `عكس «${r.document_number}» هيرجّع الخامات للمخزن ويشيل الإنتاج، وهيفضل في السجل كحركة عكسية مش مسح. لو الإنتاج اتباع أو اتصرف، العكس هيتمنع. تمام؟`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/manufacturing/production-orders/${r.id}/reverse`);
          message.success('تم عكس أمر التشغيل');
          load();
        } catch (err) { console.error(err); }
      },
    });
  };

  const removeDraft = async (r: ProductionOrder) => {
    try {
      await api.delete(`/api/v1/manufacturing/production-orders/${r.id}`);
      message.success('اتمسحت المسودة');
      load();
    } catch (err) { console.error(err); }
  };

  const noMoney = (r: ProductionOrder, v: string) =>
    (r.imported_from || r.state !== 'done' ? '—' : `${fmtMoney(v)} ج.م`);

  const columns = [
    // **المستند هو ورقة صاحبه، مش الرقم اللي وّلدناه.**
    //
    // الأمر المنقول بياخد عندنا `WO-A5-FC-MFG-3537` — بادئة فرع وكلمة `MFG` حطّيناهم
    // إحنا عشان نرقّم العمليات، ومالهمش وجود في a5. والورقة اللي في إيد المصنع مكتوب
    // عليها **«أمر شغل ٣٥٣٧»**، وده اللي بيدوّر بيه اللي واقف في الورشة. فالكشف كان
    // بيوري رقمين الاتنين من عندنا ومافيش فيهم اللي هو ماسكه.
    //
    // ورقمنا بيفضل مكانه في القاعدة — هو مفتاح المستند والروابط ماشية بيه — بس
    // مابيتعرضش: اللي بيقرا الكشف عايز يطابقه على الورق.
    { title: 'المستند', key: 'doc',
      render: (_: any, r: ProductionOrder) => (
        r.imported_from
          ? <Tag color="gold">أمر شغل {poPaper(r)}</Tag>
          : <Tag color="blue">{r.document_number}</Tag>
      ) },
    { title: 'التاريخ', dataIndex: 'production_date', key: 'date', width: 115,
      render: (d: string | null) => d || '-' },
    // ورقة صاحبها للأوامر اللي بتتكتب بإيد؛ المنقول ورقته ظاهرة في عمود المستند نفسه.
    { title: 'رقم الورقة', dataIndex: 'external_document_number', key: 'ext', width: 125,
      render: (v: string | null, r: ProductionOrder) => (r.imported_from ? '—' : v || '-') },
    { title: 'الفرع', key: 'branch', width: 120,
      render: (_: any, r: ProductionOrder) => branchName(r.branch_id) },
    { title: 'المنتجات', key: 'np', width: 85,
      render: (_: any, r: ProductionOrder) => r.products.length },
    // **المخطّط واللي طلع في خانة واحدة.** ده السؤال اللي الورقة موجودة عشانه، وكان
    // لازم تفتح صف الأمر عشان تشوفه. المنقول من a5 مالوش خطة متسجّلة فبيقول الكمية بس.
    { title: 'المخطّط / اللي طلع', key: 'pq', width: 170,
      render: (_: any, r: ProductionOrder) => (
        Number(r.planned_quantity) ? (
          <Space size={6}>
            <span style={{ opacity: 0.6 }}>{num(r.planned_quantity)}</span>
            <span style={{ opacity: 0.45 }}>←</span>
            <strong>{num(r.product_quantity)}</strong>
            <Variance planned={r.planned_quantity} actual={r.product_quantity} />
          </Space>
        ) : <strong>{num(r.product_quantity)}</strong>
      ) },
    { title: 'كمية الخامات', dataIndex: 'material_quantity', key: 'mq', width: 120,
      render: (q: string) => num(q) },
    { title: 'قيمة الخامات', dataIndex: 'material_cost', key: 'mc', width: 125,
      render: (v: string, r: ProductionOrder) => noMoney(r, v) },
    { title: 'مصاريف', dataIndex: 'expense_amount', key: 'ex', width: 105,
      render: (v: string, r: ProductionOrder) => noMoney(r, v) },
    { title: 'الإجمالي', dataIndex: 'total_cost', key: 'tc', width: 120,
      render: (v: string, r: ProductionOrder) => noMoney(r, v) },
    { title: 'الحالة', key: 'state', width: 150,
      render: (_: any, r: ProductionOrder) => (
        <Space size={4}>
          <Tag color={PO_STATE_TAG[r.state].color}>{PO_STATE_TAG[r.state].label}</Tag>
          {r.imported_from && <Tag color="gold">منقول</Tag>}
          {r.is_reversal && <Tag color="purple">حركة عكسية</Tag>}
        </Space>
      ) },
    { title: 'إجراء', key: 'action', width: 230,
      render: (_: any, r: ProductionOrder) => {
        if (r.imported_from || r.is_reversal) return null;
        return (
          <Space size={2}>
            {r.state === 'draft' && (
              <>
                <Button type="link" size="small" icon={<EditOutlined />}
                  onClick={() => openEdit(r)}>تعديل</Button>
                <Button type="link" size="small"
                  onClick={() => act(r, 'confirm', 'اتأكد الأمر — لسه مافيش حركة مخزون')}>
                  تأكيد
                </Button>
                <Popconfirm title="تمسح المسودة؟" onConfirm={() => removeDraft(r)}>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </>
            )}
            {r.state === 'confirmed' && (
              <>
                <Button type="link" size="small" icon={<EditOutlined />}
                  onClick={() => openEdit(r)}>تعديل</Button>
                {/* **الخطوة الطبيعية من المؤكد هي «ابدأ»، مش «رحّل».** فهي `primary`
                    والترحيل بيفضل موجود لواحد بيسجّل تشغيلة خلصت خلاص. */}
                <Button type="link" size="small" icon={<PlayCircleOutlined />}
                  onClick={() => act(r, 'start', 'الأمر بقى شغّال — سجّل الكميات وهي بتحصل')}>
                  ابدأ التشغيل
                </Button>
                <Button type="link" size="small"
                  onClick={() => act(r, 'execute', 'اتنفّذ الأمر: اتصرفت الخامات واتضاف الإنتاج')}>
                  تنفيذ وترحيل
                </Button>
              </>
            )}
            {r.state === 'in_progress' && (
              <>
                <Button type="link" size="small" icon={<EditOutlined />}
                  onClick={() => openEdit(r)}>سجّل اللي حصل</Button>
                <Button type="link" size="small"
                  onClick={() => act(r, 'execute', 'اتنفّذ الأمر: اتصرفت الخامات واتضاف الإنتاج')}>
                  إقفال وترحيل
                </Button>
              </>
            )}
            {r.state === 'done' && (
              <Button type="link" size="small" danger icon={<RollbackOutlined />}
                onClick={() => reverse(r)}>تراجع وعكس</Button>
            )}
          </Space>
        );
      } },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, textAlign: 'left' }}>
        <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={openNew}>
          أمر تشغيل جديد
        </Button>
      </div>

      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search allowClear style={{ width: 300 }}
          placeholder="بحث برقم المستند أو رقم الورقة"
          value={query} onChange={(e) => setQuery(e.target.value)}
          onSearch={() => { setPage(1); load(); }} />
        <Select allowClear style={{ width: 160 }} placeholder="الحالة" value={stateFilter}
          onChange={(v) => { setStateFilter(v); setPage(1); }}
          options={(Object.keys(PO_STATE_TAG) as POState[]).map((k) => ({
            value: k, label: PO_STATE_TAG[k].label }))} />
        <Select style={{ width: 180 }} value={scope}
          onChange={(v) => { setScope(v); setPage(1); }}
          options={[
            { value: 'all', label: 'الكل' },
            { value: 'ours', label: 'المكتوب عندنا' },
            { value: 'imported', label: 'المنقول من a5' },
          ]} />
      </Space>

      <Table
        rowKey="id" loading={loading} dataSource={rows} columns={columns}
        pagination={{
          current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          onChange: (p, s) => { setPage(p); setPageSize(s); },
        }}
        expandable={{
          expandedRowRender: (r: ProductionOrder) => (
            <div>
              {/* **شريط الحالة فوق الورقة، قبل أي جدول.** اللي بيفتح أمر شغل أول سؤال
                  عنده «هو فين؟» — والإجابة كانت وسم في آخر عمود في الكشف ورا عشر خانات
                  أرقام. والأمر المنقول مالوش خط سير عندنا: هو خلص في a5 قبل ما يوصلنا. */}
              <div style={{ marginBottom: 14 }}>
                {r.imported_from
                  ? <Tag color="gold">منقول من a5 — خلص في نظامهم، مالوش خط سير عندنا</Tag>
                  : <POFlow state={r.state} />}
              </div>
              <Divider orientation="right" style={{ margin: '4px 0 8px' }}>الإنتاج التام</Divider>
              <Table size="small" pagination={false} rowKey="id" dataSource={r.products}
                columns={[
                  { title: 'الصنف', key: 'n', render: (_: any, p: POProduct) => itemName(p.item_id) },
                  { title: 'المخزن', dataIndex: 'warehouse_id', render: (w: number | null) => whName(w) },
                  { title: 'المفروض', dataIndex: 'planned_quantity',
                    render: (q: string) => (Number(q) ? num(q) : '—') },
                  { title: 'اللي طلع', dataIndex: 'quantity', render: (q: string) => num(q) },
                  { title: 'الفرق', key: 'v',
                    render: (_: any, p: POProduct) => (
                      <Variance planned={p.planned_quantity} actual={p.quantity} />) },
                  { title: 'قيمة الخامات', dataIndex: 'material_cost',
                    render: (v: string) => noMoney(r, v) },
                  { title: 'مصاريف', dataIndex: 'expense_amount',
                    render: (v: string) => noMoney(r, v) },
                  { title: 'الإجمالي', dataIndex: 'total_cost', render: (v: string) => noMoney(r, v) },
                  { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', render: (v: string) => noMoney(r, v) },
                ]} />

              <StatsRow gutter={16} style={{ margin: '12px 0' }}>
                <Col span={6}><Statistic title="كمية المنتج" value={num(r.product_quantity)} /></Col>
                <Col span={6}><Statistic title="كمية الخامات" value={num(r.material_quantity)} /></Col>
                <Col span={6}><Statistic title="قيمة الخامات" value={noMoney(r, r.material_cost)} /></Col>
                <Col span={6}><Statistic title="مصاريف" value={noMoney(r, r.expense_amount)} /></Col>
              </StatsRow>

              <Divider orientation="right" style={{ margin: '4px 0 8px' }}>الخامات</Divider>
              <Table size="small" pagination={false} rowKey="id" dataSource={r.materials}
                columns={[
                  { title: 'الصنف', key: 'n', render: (_: any, m: POMaterial) => itemName(m.item_id) },
                  { title: 'للمنتج', key: 'p',
                    render: (_: any, m: POMaterial) => {
                      const p = r.products.find((x) => x.id === m.product_line_id);
                      // المنقول مافيهوش نسبة — المصدر مابيقولش أنهي خامة راحت لأنهي منتج.
                      return p ? itemName(p.item_id) : '—';
                    } },
                  { title: 'المخزن', dataIndex: 'warehouse_id', render: (w: number | null) => whName(w) },
                  { title: 'المفروض', dataIndex: 'planned_quantity',
                    render: (q: string) => (Number(q) ? num(q) : '—') },
                  { title: 'اللي اتصرف', dataIndex: 'quantity', render: (q: string) => num(q) },
                  { title: 'الفرق', key: 'v',
                    render: (_: any, m: POMaterial) => (
                      <Variance planned={m.planned_quantity} actual={m.quantity} />) },
                  { title: 'الهالك', dataIndex: 'waste_quantity',
                    render: (q: string) => (Number(q) ? num(q) : '-') },
                  { title: 'متوسط', dataIndex: 'unit_cost', render: (v: string) => noMoney(r, v) },
                  { title: 'الإجمالي', dataIndex: 'line_cost', render: (v: string) => noMoney(r, v) },
                ]} />

              {r.imported_from && (
                <p style={{ color: '#ad6800', marginTop: 12 }}>
                  الأمر ده اتلمّ من حركة منقولة من a5. تصدير a5 مافيهوش عمود تكلفة ولا كمية
                  مخطّطة، فالتكلفة والفرق مابيتعرضوش بدل ما يتخمّنوا — والخامات مش منسوبة
                  لمنتج لنفس السبب.
                </p>
              )}
              {r.state !== 'done' && !r.imported_from && (
                <p style={{ color: '#888', marginTop: 12 }}>
                  الأمر لسه ماترحّلش — مافيش أي حركة مخزون عليه، والتكلفة بتتحسب وقت التنفيذ.
                </p>
              )}
              {(r.statement1 || r.notes) && (
                <p style={{ color: '#888', marginTop: 8 }}>{r.statement1} {r.notes}</p>
              )}
            </div>
          ),
        }}
        locale={{ emptyText: 'مافيش أوامر تشغيل' }}
      />

      <TabModal centered title={editingId ? 'تعديل مسودة أمر تشغيل' : 'أمر تشغيل جديد'}
        width={1050} open={open} onCancel={closeEditor} destroyOnHidden
        footer={
          <Space>
            <Button onClick={() => setLines((p) => [...p, newPOProduct()])}>+ منتج</Button>
            <Button type="primary" loading={saving} onClick={submit}>
              {editingId ? 'حفظ المسودة' : 'فتح الأمر كمسودة'}
            </Button>
          </Space>
        }>
        {/* **الترويسة فوق ثابتة، والشغل جوّه تبويبات.**
            الورقة كانت عمود واحد طويل: بيانات المستند، وبعدها كل منتج بخاماته، وبعدها
            الملاحظات. اللي بيكتب تشغيلة فيها تلات منتجات كان بينزل ويطلع في المودال
            عشان يشوف التاريخ اللي كتبه. دلوقتي التاريخ والفرع والورقة فوق دايماً،
            والباقي في تبويبين: **الشغل** (المنتجات وخاماتها) و**بيانات المستند**
            (البيان والملاحظات) — اللي بيتكتب مرة، بره طريق اللي بيتكتب كل سطر. */}
        <Row gutter={12} style={{
          position: 'sticky', top: 0, zIndex: 2, paddingBottom: 12, marginBottom: 4,
          // خلفية صريحة: العنصر اللاصق بيعوم فوق المحتوى، و`inherit` بيسيبه شفاف
          // فالسطور بتعدّي من وراه وهي بتتزحلق. النظام فاتح بس (مافيش `darkAlgorithm`).
          background: '#fff',
        }}>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>تاريخ الإنتاج</div>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD"
              value={productionDate} onChange={setProductionDate} placeholder="النهارده" />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>الفرع</div>
            <Select allowClear style={{ width: '100%' }} value={branchId} onChange={setBranchId}
              options={branches.map((b) => ({ value: b.id, label: b.name }))} placeholder="الفرع" />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>رقم الورقة</div>
            <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)}
              maxLength={40} placeholder="رقم الورقة اللي في إيدك" />
          </Col>
        </Row>

        <Tabs
          activeKey={formTab} onChange={setFormTab}
          items={[
            {
              key: 'work',
              label: `الشغل (${lines.length})`,
              children: <>{lines.map((ln, idx) => (
          <Card key={ln.key} size="small" style={{ marginTop: 12 }} title={`منتج ${idx + 1}`}
            extra={lines.length > 1 && (
              <Button type="text" danger icon={<DeleteOutlined />}
                onClick={() => setLines((p) => p.filter((x) => x.key !== ln.key))} />
            )}>
            <Row gutter={8}>
              <Col span={7}>
                <Select showSearch style={{ width: '100%' }} placeholder="المنتج"
                  value={ln.item_id} options={itemOptions(products)}
                  filterOption={searchFilter} filterSort={searchRank}
                  onChange={(v) => patchLine(ln.key, {
                    item_id: v,
                    bom_id: boms.find((b) => b.active && b.product_id === v)?.id ?? null,
                  }, 'product')} />
              </Col>
              <Col span={5}>
                {/* نسخ الوصفة البديلة (A/B/C عند a5) = وصفات متعددة لنفس المنتج. */}
                <Select allowClear style={{ width: '100%' }} placeholder="الوصفة"
                  value={ln.bom_id ?? undefined}
                  options={boms.filter((b) => b.product_id === ln.item_id)
                    .map((b) => ({ value: b.id, label: b.active ? b.name : `${b.name} (قديمة)` }))}
                  onChange={(v) => patchLine(ln.key, { bom_id: v ?? null }, 'product')} />
              </Col>
              <Col span={4}>
                <Select style={{ width: '100%' }} placeholder="مخزن الإنتاج" value={ln.warehouse_id}
                  options={whOptions}
                  onChange={(v) => patchLine(ln.key, { warehouse_id: v }, 'qty')} />
              </Col>
              <Col span={3}>
                <InputNumber style={{ width: '100%' }} min={0.001} placeholder="المفروض"
                  value={ln.planned_quantity as any}
                  onChange={(v) => patchLine(ln.key, {
                    planned_quantity: v as any,
                    // اللي طلع بيتفتح على نفس الرقم — اللي مايغيّرهوش يبقى قال «طلع زي
                    // المفروض» صراحةً، مش سابه فاضي.
                    quantity: ln.quantity == null ? (v as any) : ln.quantity,
                  }, 'qty')} />
              </Col>
              <Col span={3}>
                <InputNumber style={{ width: '100%' }} min={0.001} placeholder="اللي طلع"
                  value={ln.quantity as any}
                  onChange={(v) => patchLine(ln.key, { quantity: v as any })} />
              </Col>
              <Col span={2}>
                <Button block size="small" onClick={() => fillFromRecipe(ln.key)}>وصفة</Button>
              </Col>
            </Row>
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={7}>
                <InputNumber style={{ width: '100%' }} min={0} placeholder="مصاريف السطر"
                  value={ln.expense_amount as any}
                  onChange={(v) => patchLine(ln.key, { expense_amount: v as any })} />
              </Col>
            </Row>

            <Divider orientation="right" style={{ margin: '12px 0 8px' }}>خاماته</Divider>
            {ln.materials.map((m) => (
              <Row gutter={8} key={m.key} style={{ marginBottom: 6 }}>
                <Col span={7}>
                  <Select showSearch style={{ width: '100%' }} placeholder="الخامة"
                    value={m.item_id} options={itemOptions(allItems)}
                    filterOption={searchFilter} filterSort={searchRank}
                    onChange={(v) => patchMaterial(ln.key, m.key, { item_id: v })} />
                </Col>
                <Col span={5}>
                  <Select style={{ width: '100%' }} placeholder="مخزن الخامة" value={m.warehouse_id}
                    options={whOptions}
                    onChange={(v) => patchMaterial(ln.key, m.key, { warehouse_id: v })} />
                </Col>
                <Col span={3}>
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="المفروض"
                    value={m.planned_quantity as any}
                    onChange={(v) => patchMaterial(ln.key, m.key, {
                      planned_quantity: v as any,
                      quantity: m.quantity == null ? (v as any) : m.quantity,
                    })} />
                </Col>
                <Col span={3}>
                  <InputNumber style={{ width: '100%' }} min={0.001} placeholder="اتصرف"
                    value={m.quantity as any}
                    onChange={(v) => patchMaterial(ln.key, m.key, { quantity: v as any })} />
                </Col>
                <Col span={3}>
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="هالك"
                    value={m.waste_quantity as any}
                    onChange={(v) => patchMaterial(ln.key, m.key, { waste_quantity: v as any })} />
                </Col>
                <Col span={3}>
                  {/* الفرق بيبان وانت بتكتب — الرقم ده هو اللي المصنع بيسأل عليه. */}
                  <Variance planned={String(m.planned_quantity ?? 0)}
                    actual={String(m.quantity ?? 0)} />
                  <Button type="text" danger size="small" icon={<DeleteOutlined />}
                    onClick={() => patchLine(ln.key, {
                      materialsTouched: true,
                      materials: ln.materials.filter((y) => y.key !== m.key) })} />
                </Col>
              </Row>
            ))}
            {/* زيادة أو مسح خامة بإيد = لمسة، فالتحديث التلقائي من الوصفة بيقف بعدها. */}
            <Button size="small" onClick={() => patchLine(ln.key, {
              materialsTouched: true,
              materials: [...ln.materials, newPOMaterial()] })}>+ خامة</Button>
          </Card>
              ))}</>,
            },
            {
              key: 'doc',
              label: 'بيانات المستند',
              children: (
                <div style={{ paddingTop: 8 }}>
                  <div style={{ marginBottom: 4 }}>البيان</div>
                  <Input value={statement} maxLength={200}
                    onChange={(e) => setStatement(e.target.value)}
                    placeholder="سطر واحد بيتطبع على الورقة" />
                  <div style={{ margin: '12px 0 4px' }}>ملاحظات</div>
                  <Input.TextArea rows={4} maxLength={500} value={notes}
                    onChange={(e) => setNotes(e.target.value)} />
                </div>
              ),
            },
          ]}
        />
      </TabModal>
    </div>
  );
}

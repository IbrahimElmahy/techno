import React, { useEffect, useMemo, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { printWorkOrder, type WorkOrderStage } from '../print/workOrderSheet';
import { PAGE_SIZE_OPTIONS } from '../utils/pagination';
import {
  Alert, Button, Card, Col, DatePicker, Divider, Empty, Form, Input, Modal, Row, Select, Space, Statistic, Steps, Table, Tabs, Tag, Tooltip, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, RollbackOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined,
  BuildOutlined, PlayCircleOutlined, PrinterOutlined, DownloadOutlined, UndoOutlined,
  CheckOutlined, InboxOutlined,
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
type Stage = 'production' | 'quality';

/** مرحلة صرف الخامة — إذن لكل واحدة، بيروح لناس مختلفين في وقتين مختلفين. */
const STAGES: { value: Stage; label: string; short: string; color: string }[] = [
  { value: 'production', label: 'تصنيع — بتدخل الماكينة', short: 'تصنيع', color: 'green' },
  { value: 'quality', label: 'جودة — بتتحط على المنتج بعد ما يطلع', short: 'جودة', color: 'gold' },
];
const stageOf = (v?: string | null): Stage => (v === 'quality' ? 'quality' : 'production');
const stageLabel = (v?: string | null) => STAGES.find((x) => x.value === stageOf(v))!.short;

interface Component {
  item_id: number; quantity: string; unit?: string | null; unit_factor?: string;
  stage?: string | null;
}
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

  /**
   * وحدة الصنف — **الرقم لوحده مش كمية**.
   *
   * «٥٠» في ورقة تصنيع ممكن تكون خمسين قطعة أو خمسين كيلو، والفرق بينهم هو الفرق بين
   * تشغيلة صح وتشغيلة غلط. الشاشة كانت بتكتب الرقم مجرّد في كل مكان، واللي بيقرا
   * بيفتح كارت الصنف عشان يعرف هو بيعدّ إيه.
   *
   * وبتيجي من الصنف نفسه، مش من السطر: سطر الأمر عنده `unit` (الوحدة اللي اتكتب
   * بيها) بس الكميات كلها متخزّنة بالوحدة الأساسية بعد الضرب في المعامل — فعرض وحدة
   * السطر جنب رقم أساسي بيقول حاجة غلط.
   */
  const itemCode = useMemo(() => {
    const m = new Map<number, string>();
    [...rawMaterials, ...products].forEach((i) => m.set(i.id, i.code || ''));
    return (id: number) => m.get(id) || '';
  }, [rawMaterials, products]);

  const itemUnit = useMemo(() => {
    const m = new Map<number, string>();
    [...rawMaterials, ...products].forEach((i) => m.set(i.id, i.unit_of_measure || ''));
    return (id: number) => m.get(id) || '';
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
              branches={branches} boms={boms} itemName={itemName} itemUnit={itemUnit}
              itemCode={itemCode} whName={whName} active={tab === 'orders'}
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
    form.setFieldsValue({
      output_quantity: 1, components: [{ stage: 'production' }], resources: [],
    });
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
        stage: stageOf(c.stage),
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
        stage: c.stage || 'production',
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
                        // **كل الأصناف، مش «الخامات» بس.** كتالوج العميل كله `product`
                        // (٢٬٧٤١ صنف — نقل a5 نقلهم كده)، فالقايمة المفلترة كانت بتطلع
                        // فاضية والوصفة المفتوحة بتوري رقم الصنف بدل اسمه.
                        options={[...rawMaterials, ...products].map((r) => ({
                          value: r.id, label: `${r.name} (${r.unit_of_measure})`,
                          search: r.code || '' }))} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'quantity']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'الكمية' }]}>
                      <InputNumber min={0.001} placeholder="الكمية"
                        data-grid-col="qty" keyboard={false} />
                    </Form.Item>
                    {/* «الوحدة» — the recipe is written in whatever unit the workshop speaks
                        («٢ كرتونة»)، and the conversion to base units happens when the order
                        consumes, not in someone's head at the keyboard. */}
                    <Form.Item noStyle shouldUpdate>
                      {({ getFieldValue }) => {
                        const iid = getFieldValue(['components', field.name, 'item_id']);
                        const raw = [...rawMaterials, ...products].find((r) => r.id === iid);
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
                    {/* **المرحلة** — إمتى الخامة دي بتتصرف. الخام بيتصرف أول ما الأمر
                        يبدأ ويروح للمكن؛ الكرتون والأكياس بإذن تاني بعد ما المنتج يطلع.
                        وهي على الوصفة مش على الأمر لأن الفرق ده بتاع المنتج نفسه:
                        الكرتونة دايماً بتتحط بعد الإنتاج، مش حسب رأي اللي فاتح الورقة. */}
                    <Form.Item {...field} name={[field.name, 'stage']}
                      style={{ marginBottom: 0 }} initialValue="production">
                      <Select style={{ minWidth: 200 }}
                        options={STAGES.map((x) => ({ value: x.value, label: x.label }))} />
                    </Form.Item>
                    <DeleteOutlined onClick={() => remove(field.name)} style={{ color: '#ff4d4f' }} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ stage: 'production' })} block
                  icon={<PlusOutlined />}>
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
                      <InputNumber min={0} placeholder="ساعات/كمية" style={{ width: 110 }}
                        data-grid-col="hours" keyboard={false} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'rate']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'السعر' }]}>
                      <InputNumber min={0} placeholder="سعر الوحدة" style={{ width: 110 }}
                        data-grid-col="rate" keyboard={false} />
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
  stage?: string | null;
  /** اتصرف من المخزن ولا لسه. ده اللي بيحدّد الخطوة الجاية، مش حالة الأمر. */
  issued?: boolean;
}
interface POReceipt {
  id: number; product_line_id: number; quantity: string;
  receipt_date: string | null; notes: string | null;
}
interface POProduct {
  id: number; item_id: number; warehouse_id: number | null;
  /** اللي اتستلم من السطر ده لحد دلوقتي — مجموع الدفعات. */
  received_quantity?: string;
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
  receipts?: POReceipt[];
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

/** كمية ومعاها وحدتها. الوحدة أصغر وأخفت — الرقم هو اللي بيتقرا، وهي بتقول بيعدّ إيه. */
function Qty({ value, unit }: { value: string | number; unit?: string }) {
  return (
    <span>
      {num(value)}
      {unit ? <span style={{ fontSize: '0.85em', opacity: 0.6 }}>{' '}{unit}</span> : null}
    </span>
  );
}

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
  key: number; item_id?: number; warehouse_id?: number; stage?: Stage;
  /** حد غيّر المرحلة بإيده على السطر ده؟ ساعتها بس بتتبعت للسيرفر. */
  stageTouched?: boolean;
  planned_quantity?: number | null; quantity?: number | null; waste_quantity?: number | null;
  /**
   * **حد اختار مخزن الخامة دي بإيده؟**
   *
   * من غير العلامة دي مافيش طريقة نفرّق بين مخزن النظام حطّه لوحده ومخزن الراجل
   * قصده. `materialsTouched` على مستوى سطر المنتج كله — يعني تعديل كمية خامة واحدة
   * كان هيجمّد مخازن الخمسة، والعكس: إعادة الاختيار التلقائي كانت هتمسح اختياره.
   */
  warehouseTouched?: boolean;
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
  /**
   * **اللي كاتب الورقة كتب في «اللي طلع» بإيده ولا لأ؟**
   *
   * «اللي طلع» بيمشي ورا «المفروض» لحد ما حد يكتب فيه — عشان اللي مايغيّرهوش يبقى
   * قال «طلع زي ما اتخطّط» صراحةً. وكان بيتحط مرة واحدة بس (`quantity == null`)،
   * فاللي بيمسح الكمية ويكتب غيرها كان بيسيب «اللي طلع» على الرقم القديم — أو فاضي،
   * والحفظ يترفض «الكمية لازم تكون أكبر من صفر» وهو شايف رقم قدامه في «المفروض».
   */
  quantityTouched?: boolean;
}

let poSeq = 1;
const newPOMaterial = (): DraftMaterial => ({ key: poSeq++, stage: 'production' });
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
  products, rawMaterials, warehouses, branches, boms: propBoms, itemName, itemUnit,
  itemCode, whName, active,
}: {
  products: Item[]; rawMaterials: Item[]; warehouses: Warehouse[];
  branches: { id: number; name: string }[]; boms: Bom[];
  itemName: (id: number) => string;
  itemUnit: (id: number) => string;
  itemCode: (id: number) => string;
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
  // الأمر اللي بيتقفل دلوقتي، ومعاه اللي طلع لكل سطر منتج.
  const [closing, setClosing] = useState<ProductionOrder | null>(null);
  const [outputs, setOutputs] = useState<Record<number, number | null>>({});
  const [waste, setWaste] = useState<Record<number, number | null>>({});
  /**
   * **شاشة الاستلام** — الأمر اللي شغّال والدفعة اللي وصلت النهارده.
   *
   * منفصلة عن الإقفال عن قصد: الإقفال بيقول «الشغل خلص واللي طلع كله كده»،
   * والاستلام بيقول «وصل الجزء ده النهارده» والأمر لسه شغّال. جمعهم في شاشة واحدة
   * كان معناه إن اللي بيستلم دفعة بيقفل الورقة عليها.
   */
  const [receiving, setReceiving] = useState<ProductionOrder | null>(null);
  const [received, setReceived] = useState<Record<number, number | null>>({});
  const [receiptDate, setReceiptDate] = useState<any>(null);
  /**
   * **الخامة دي موجودة فين وبكام** — `صنف → [{مخزن، رصيد}]` مرتّبة بالأكبر.
   *
   * الورقة بتتكتب على خطة، والصرف بيحصل وقت «ابدأ» — فالمخزن الغلط مابيبانش غلط إلا
   * بعد ما الورقة تكون اتكتبت واتأكدت. الكشف ده بيخلّي الشاشة تختار المخزن اللي فيه
   * البضاعة فعلاً وتوري المتاح جنب كل خامة، بدل ما المصنع يكتشف عند الضغطة الأخيرة.
   */
  const [stock, setStock] = useState<Map<number, { wh: number; qty: number }[]>>(new Map());
  /**
   * **نسخة طازة من الوصفات مع كل فتحة للورقة.**
   *
   * اللي جاي في الـprops اتحمّل لما الشاشة اتفتحت. تبويب مفتوح من ساعة بيفضل
   * شايف الوصفة القديمة، والورقة اللي بتتكتب منه بتوري مراحل غلط. السيرفر
   * بيصلّحها وقت الحفظ، بس اللي قدام الشاشة يستاهل يشوف الصح وهو بيكتب.
   */
  const [freshBoms, setFreshBoms] = useState<Bom[] | null>(null);
  const boms = freshBoms ?? propBoms;

  const allItems = useMemo(() => [...products, ...rawMaterials], [products, rawMaterials]);
  const itemOptions = (list: Item[]) =>
    // الكود مش بيتعرض، بيتبحث بيه — الشرح في `utils/itemLabel`.
    list.map((i) => ({ value: i.id, label: i.name, search: i.code || '' }));
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

  /** الوصفات بتتجدّد مع كل فتحة — الشرح عند `freshBoms`. */
  const refreshBoms = () => {
    api.get('/api/v1/manufacturing/boms')
      .then((r) => setFreshBoms(r.data))
      .catch(() => { /* النسخة اللي في الإيد بتكفّي للعرض */ });
  };

  const openNew = () => {
    resetForm(); setLines([newPOProduct()]); refreshBoms(); setOpen(true);
  };

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
    refreshBoms();
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
      // والكمية اللي طلعت كذلك: هي رقم مسجّل، مايمشيش ورا «المفروض» لو حد ظبّطه.
      quantityTouched: true,
      // **الورقة المفتوحة للتعديل خاماتها محسومة.** هي اللي اتسجّل فعلاً — يمكن
      // اتعدّلت بإيد وقت الشغل — فالتفجير التلقائي مايلمسهاش. من غير السطر ده، أول
      // تصليح في كمية المنتج كان هيمسح كل اللي اتسجّل ويرجّعه لأرقام الوصفة.
      materialsTouched: true,
      materials: r.materials.filter((m) => m.product_line_id === p.id).map((m) => ({
        key: poSeq++, item_id: m.item_id, warehouse_id: m.warehouse_id ?? undefined,
        planned_quantity: Number(m.planned_quantity), quantity: Number(m.quantity),
        waste_quantity: Number(m.waste_quantity), stage: stageOf(m.stage),
        // الورقة المحفوظة مرحلتها اتسجّلت خلاص — بتتبعت زي ما هي مش بتتقرا تاني.
        stageTouched: true,
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
        materials: x.materials.map((y) => (y.key === matKey
          ? { ...y, ...patch,
              // اختيار المخزن بإيد بيتقفل عليه — الشرح عند `warehouseTouched`.
              ...('warehouse_id' in patch ? { warehouseTouched: true } : {}),
              ...('stage' in patch ? { stageTouched: true } : {}) }
          : y)),
      }
      : x)));

  /**
   * **بيجيب أرصدة خامات الورقة، وبيرجّع كل خامة لمخزنها لما الرصيد يوصل.**
   *
   * الأرصدة بتتحمّل بعد ما السطر يتكتب (نداء شبكة)، فالتفجير اللي حصل قبلها اختار
   * مخزن المنتج لأنه ماكانش يعرف حاجة تانية. ده بيصلّحه لما الرد يوصل — وبيسيب أي
   * مخزن حد اختاره بإيده زي ما هو.
   */
  useEffect(() => {
    if (!open) return;
    const ids = lines.flatMap((ln) => ln.materials.map((m) => m.item_id))
      .filter((i): i is number => !!i);
    if (ids.length) loadStock(ids);
    setLines((prev) => {
      let changed = false;
      const next = prev.map((ln) => {
        const mats = ln.materials.map((m) => {
          if (m.warehouseTouched || !m.item_id || !stock.has(m.item_id)) return m;
          const need = Number(m.planned_quantity ?? 0);
          // **المخزن اللي شايل الكمية مابيتلمسش.** الورقة القديمة بتتفتح بمخازنها
          // المحفوظة، وإعادة اختيار عمياء كانت هتزحلق اختيار صح اتعمل بقصد. اللي
          // بيتصلّح هو اللي فيه أقل من المطلوب — ودي هي اللي بتوقع عند «ابدأ».
          const have = availableIn(m.item_id, m.warehouse_id);
          if (m.warehouse_id && have != null && have >= need) return m;
          const wh = bestWarehouse(m.item_id, need, ln.warehouse_id);
          if (wh === m.warehouse_id) return m;
          changed = true;
          return { ...m, warehouse_id: wh };
        });
        return changed ? { ...ln, materials: mats } : ln;
      });
      return changed ? next : prev;
    });
  }, [open, lines, stock]);

  /** بيجيب أرصدة الأصناف دي لو لسه مش عندنا. بيسكت لو كلها متحمّلة. */
  const loadStock = async (ids: number[]) => {
    const want = [...new Set(ids.filter((i) => i && !stock.has(i)))];
    if (!want.length) return;
    try {
      const res = await api.get('/api/v1/stock/by-item',
                                { params: { item_ids: want.join(',') } });
      setStock((prev) => {
        const next = new Map(prev);
        // الصنف اللي اتسأل عنه ومالوش صف = مافيش منه حاجة في أي مخزن. لازم يتسجّل
        // كقايمة فاضية، وإلا هنفضل نساله عليه كل مرة والشاشة تقول «متاح —» بدل «٠».
        want.forEach((i) => next.set(i, []));
        (res.data as { item_id: number; location_id: number; on_hand: string }[])
          .forEach((r) => next.set(r.item_id,
                                   [...(next.get(r.item_id) ?? []),
                                    { wh: r.location_id, qty: Number(r.on_hand) }]));
        next.forEach((v) => v.sort((a, b) => b.qty - a.qty));
        return next;
      });
    } catch { /* الرصيد تحسين للعرض — فشله مايوقفش كتابة الورقة */ }
  };

  /**
   * **الخامات اللي مخزنها مش شايلها** — الورقة دي هتقف عند «ابدأ» بسببها.
   *
   * بتتحسب من نفس الأرقام اللي السيرفر هيقيس عليها، فاللي الشاشة بتحذّر منه هو
   * بالظبط اللي هيترفض. واللي لسه رصيده مش متحمّل مابيدخلش — تحذير من غير رقم
   * بيخلّي اللي بيقراه يشك في الرقم اللي بعده.
   */
  const shortages = useMemo(() => {
    const out: { name: string; wh: string; need: number; have: number; unit: string;
                 stage: Stage }[] = [];
    lines.forEach((ln) => ln.materials.forEach((m) => {
      if (!m.item_id) return;
      const need = Number(m.planned_quantity ?? 0);
      if (!need) return;
      const rows = stock.get(m.item_id);
      if (!rows) return;
      const have = m.warehouse_id
        ? (rows.find((r) => r.wh === m.warehouse_id)?.qty ?? 0)
        : 0;
      if (have >= need) return;
      out.push({ name: itemName(m.item_id), wh: whName(m.warehouse_id),
                 need, have, unit: itemUnit(m.item_id), stage: stageOf(m.stage) });
    }));
    return out;
    // الأسماء في المصفوفة عن قصد: الكشف اتكوّن وهو لسه مالقاش أسماء الأصناف
    // والمخازن (الورقة بتتفتح من الرابط قبل ما القوايم توصل)، فكان بيقول «#3042 في
    // #77» — رقم مالوش معنى لحد بيقرا تحذير عن بضاعة ناقصة.
  }, [lines, stock, itemName, whName, itemUnit]);

  /** رصيد الخامة في مخزن معيّن، أو `null` لو لسه مش متحمّل. */
  const availableIn = (itemId?: number, wh?: number | null): number | null => {
    if (!itemId || !wh) return null;
    const rows = stock.get(itemId);
    if (!rows) return null;
    return rows.find((r) => r.wh === wh)?.qty ?? 0;
  };

  /**
   * **المخزن اللي الخامة دي تتصرف منه فعلاً.**
   *
   * أول مخزن فيه الكمية المطلوبة؛ وإلا اللي فيه الأكتر (عشان اللي بيكتب يشوف رقم
   * قريب ويقرّر)؛ وإلا مخزن المنتج زي الأول.
   *
   * قبل كده كانت الخامات كلها بتاخد مخزن المنتج — والنتيجة أمر ٢٠٦: منتج مخزنه
   * «مخزن الخامات»، وأربع خامات من خمسة مالهمش فيه ولا وحدة، والصرف وقع عند «ابدأ».
   */
  const bestWarehouse = (itemId?: number, need = 0, fallback?: number) => {
    const rows = itemId ? stock.get(itemId) : undefined;
    if (!rows?.length) return fallback;
    return (rows.find((r) => r.qty >= need) ?? rows[0]).wh;
  };

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
        warehouse_id: bestWarehouse(c.item_id, q, ln.warehouse_id),
        stage: stageOf(c.stage),
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
      item_id: ln.item_id,
      // الفتح بيبعت المخطّط بس — السيرفر بيفتح «اللي طلع» عليه، والإقفال بيستبدله.
      planned_quantity: ln.planned_quantity,
      warehouse_id: ln.warehouse_id ?? undefined,
      bom_id: ln.bom_id ?? undefined,
      expense_amount: ln.expense_amount ?? 0,
      // **الفلترة على المخطّط مش على المصروف.** «اتصرف» مابقاش خانة في الورقة،
      // فالخامة اللي حد زوّدها بإيده مالهاش `quantity` — والفلترة القديمة كانت
      // بتسقّطها في صمت، والأمر يتحفظ من غيرها.
      materials: ln.materials
        .filter((m) => m.item_id && (m.planned_quantity ?? m.quantity))
        .map((m) => ({
          item_id: m.item_id,
          planned_quantity: m.planned_quantity ?? m.quantity,
          warehouse_id: m.warehouse_id ?? undefined,
          // **المرحلة بتتبعت لو حد غيّرها بإيده بس.** الشاشة عندها نسخة من
          // الوصفات اتحمّلت لما اتفتحت، وأي ورقة بتتكتب منها بعد ما الوصفة
          // تتعدّل بتحمل النسخة القديمة لطول عمرها. السيرفر بيقراها من الوصفة
          // اللي عنده — والسطر اللي حد قصده بيغلبها.
          ...(m.stageTouched ? { stage: stageOf(m.stage) } : {}),
        })),
    })),
  });

  const submit = async () => {
    if (!lines.length) { message.warning('ضيف منتج واحد على الأقل'); return; }
    for (const ln of lines) {
      // على المخطّط: «اللي طلع» مابقاش في الورقة، والتحقق عليه كان بيمنع حفظ أي
      // منتج مالوش وصفة — لأن الرقم ده مابيتحطش غير لما الوصفة تتفجّر.
      if (!ln.item_id || !ln.planned_quantity) {
        message.warning('كل سطر منتج محتاج صنف وكمية'); return;
      }
      if (!ln.materials.some((m) => m.item_id && (m.planned_quantity ?? m.quantity))) {
        message.warning(`«${itemName(ln.item_id)}» مالوش خامات — اختار وصفة أو ضيفها بإيدك`);
        return;
      }
    }
    setSaving(true);
    try {
      if (editingId) await api.put(`/api/v1/manufacturing/production-orders/${editingId}`, payload());
      else await api.post('/api/v1/manufacturing/production-orders', payload());
      message.success(editingId ? 'اتحفظت المسودة' : 'اتفتح أمر تشغيل كمسودة — مافيش حركة مخزون لسه');
      closeEditor(); setPage(1); load();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  /** ورقة الورشة — الشرح في `print/workOrderSheet`. */
  const printOrder = (r: ProductionOrder, stage: WorkOrderStage = 'production') =>
    printWorkOrder(r, { itemName, itemCode, itemUnit, whName, branchName }, stage);

  /** خامات الجودة اللي لسه ما اتصرفتش — هي اللي بتقرّر الزرار يبان ولا لأ. */
  const qualityPending = (r: ProductionOrder) =>
    r.materials.filter((m) => stageOf(m.stage) === 'quality' && !m.issued).length;

  const act = async (
    r: ProductionOrder, verb: 'confirm' | 'start' | 'execute' | 'issue-quality', done: string,
  ) => {
    try {
      const res = await api.post(
        `/api/v1/manufacturing/production-orders/${r.id}/${verb}`);
      message.success(done);
      load();
      // **التأكيد بيعرض الطباعة على طول.** ده وقتها بالظبط: الأرقام اتراجعت،
      // والخطوة اللي بعدها إن حد في الورشة يمسك ورقة. وبتتطبع من رد السيرفر مش من
      // الصف القديم — الحالة اتغيّرت لسه.
      // **كل صرف له ورقته.** التأكيد بيعرض إذن التصنيع (اللي بيروح للمكن)، وصرف
      // الجودة بيعرض إذن التعبئة. ودي وقتهم بالظبط — الورقة بتتطبع وهي لسه هي
      // اللي هتتنفّذ.
      if (verb === 'confirm' || verb === 'issue-quality') {
        const fresh = (res?.data ?? r) as ProductionOrder;
        const quality = verb === 'issue-quality';
        Modal.confirm({
          title: quality ? 'اتصرفت مواد التعبئة' : 'الأمر اتأكد',
          content: quality
            ? 'تطبع إذن الجودة وتديه للتعبئة؟'
            : 'تطبع إذن التشغيل وتديه للورشة؟',
          okText: 'اطبع', cancelText: 'بعدين',
          onOk: () => printOrder(fresh, quality ? 'quality' : 'production'),
        });
      }
    } catch (err) { console.error(err); }
  };

  /**
   * **الإقفال بيسأل عن اللي طلع فعلاً.** الخامة اتصرفت وقت البدء والورقة عارفة
   * المخطّط؛ الرقم الوحيد اللي لسه ناقص هو اللي خرج من الماكينة — وده اللي بيتكتب
   * هنا، وعليه بتتقسّم التكلفة.
   *
   * وبيتفتح على المخطّط: اللي طلع زي ما اتخطّط بيدوس «إقفال» على طول.
   */
  const openClose = (r: ProductionOrder) => {
    // **بيفتح على اللي اتستلم لو فيه دفعات** — ده الرقم اللي حصل فعلاً، والمخطّط
    // بقى تخمين قديم جنبه. واللي مااستلمش حاجة بيفتح على المخطّط زي الأول.
    setOutputs(Object.fromEntries(r.products.map((p) => [p.id,
      Number(p.received_quantity) > 0
        ? Number(p.received_quantity)
        : (Number(p.planned_quantity) || Number(p.quantity))])));
    // الهالك بيفتح على اللي متسجّل (صفر في الغالب) — اللي مافيش عنده هالك بيسيبه.
    setWaste(Object.fromEntries(r.materials.map((m) => [m.id, Number(m.waste_quantity) || null])));
    setClosing(r);
  };

  const submitClose = async () => {
    if (!closing) return;
    const bad = closing.products.find((p) => !Number(outputs[p.id]));
    if (bad) { message.error(`اكتب اللي طلع من «${itemName(bad.item_id)}»`); return; }
    try {
      await api.post(`/api/v1/manufacturing/production-orders/${closing.id}/execute`,
        { outputs, waste: Object.fromEntries(
          Object.entries(waste).filter(([, v]) => Number(v) > 0)) });
      message.success('اتقفل الأمر: الإنتاج اتضاف للمخزن والتكلفة اتحسبت');
      setClosing(null);
      load();
    } catch (err) { console.error(err); }
  };

  /** بيفتح شاشة الاستلام على الباقي — الرقم اللي الغالب إنه هيتكتب. */
  const openReceive = (r: ProductionOrder) => {
    setReceived(Object.fromEntries(r.products.map((p) => {
      const left = Number(p.planned_quantity) - Number(p.received_quantity || 0);
      return [p.id, left > 0 ? left : null];
    })));
    setReceiptDate(dayjs());
    setReceiving(r);
  };

  const undoReceipt = async (rc: POReceipt) => {
    if (!receiving) return;
    try {
      const res = await api.delete(
        `/api/v1/manufacturing/production-orders/${receiving.id}/receipts/${rc.id}`);
      message.success('اتعكست الدفعة — الكمية خرجت من المخزن');
      setReceiving(res.data as ProductionOrder);
      load();
    } catch (err) { console.error(err); }
  };

  const submitReceive = async () => {
    if (!receiving) return;
    const quantities = Object.fromEntries(
      Object.entries(received).filter(([, v]) => Number(v) > 0));
    if (!Object.keys(quantities).length) {
      message.warning('اكتب الكمية اللي استلمتها'); return;
    }
    try {
      await api.post(`/api/v1/manufacturing/production-orders/${receiving.id}/receive`, {
        quantities,
        receipt_date: receiptDate ? receiptDate.format('YYYY-MM-DD') : undefined,
      });
      message.success('اتسجّل الاستلام — البضاعة دخلت المخزن');
      setReceiving(null);
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

  /**
   * الفلوس بتتعرض لما تكون موجودة فعلاً.
   *
   * **والمنقول من a5 بقى عنده تكلفة.** كانت بتتخبّى لأن تصدير التصنيع الأصلي مافيهوش
   * عمود تكلفة، والصفر كان هيتقري «إنتاج مجاني». دلوقتي `exp_mfg_cost.sql` بيجيب
   * أرقام a5 نفسها — التكلفة اللي المصنع اشتغل بيها ساعتها — فاللي عنده رقم بيوريه،
   * واللي لسه بصفر بيفضل «—» بدل ما يقول إن التشغيلة ماكلفتش حاجة.
   */
  const noMoney = (r: ProductionOrder, v: string) =>
    (r.state !== 'done' || !Number(v) ? '—' : `${fmtMoney(v)} ج.م`);

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
      render: (_: any, r: ProductionOrder) => {
        // وحدة المنتج الأول — الورقة اللي فيها أكتر من منتج بوحدات مختلفة مجموعها
        // مالوش وحدة واحدة، فبتتساب بدل ما نكتب وحدة غلط على رقم مجمّع.
        const u = r.products.length === 1 ? itemUnit(r.products[0].item_id) : '';
        return Number(r.planned_quantity) ? (
          <Space size={6}>
            <span style={{ opacity: 0.6 }}>{num(r.planned_quantity)}</span>
            <span style={{ opacity: 0.45 }}>←</span>
            <strong><Qty value={r.product_quantity} unit={u} /></strong>
            <Variance planned={r.planned_quantity} actual={r.product_quantity} />
          </Space>
        ) : <strong><Qty value={r.product_quantity} unit={u} /></strong>;
      } },
    { title: 'كمية الخامات', dataIndex: 'material_quantity', key: 'mq', width: 120,
      render: (_: any, r: ProductionOrder) => {
        const us = new Set(r.materials.map((m) => itemUnit(m.item_id)).filter(Boolean));
        return <Qty value={r.material_quantity} unit={us.size === 1 ? [...us][0] : ''} />;
      } },
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
    /**
     * **أيقونات، مش جمل.**
     *
     * العمود كان فيه لحد ستة أزرار بنص كامل («اصرف مواد الجودة»، «سجّل اللي طلع
     * واقفل») فبياخد تلت عرض الشاشة ويلف على سطرين — والكشف اللي المفروض يوري حالة
     * الشغل بيبقى نصه أزرار. كل إجراء بقى أيقونة واحدة باسمها في التلميح.
     *
     * **والاستلام والإقفال بقوا باب واحد**: الاتنين بيسألوا نفس السؤال («طلع كام؟»)
     * ويختلفوا في «خلصنا ولا لسه» — وزرارين جنب بعض كان بيخلّي اللي عايز يسجّل دفعة
     * يدوس «إقفال» ويقفل الورقة عليها.
     */
    { title: 'إجراء', key: 'action', width: 150, align: 'center' as const,
      render: (_: any, r: ProductionOrder) => {
        if (r.imported_from || r.is_reversal) return null;
        const icon = (
          title: string, node: React.ReactNode, onClick: () => void,
          danger = false, primary = false,
        ) => (
          <Tooltip title={title}>
            <Button type={primary ? 'primary' : 'text'} size="small" danger={danger}
              icon={node} onClick={onClick} />
          </Tooltip>
        );
        return (
          <Space size={0}>
            {r.state === 'draft' && (
              <>
                {icon('تعديل', <EditOutlined />, () => openEdit(r))}
                {icon('تأكيد', <CheckOutlined />,
                  () => act(r, 'confirm', 'اتأكد الأمر — لسه مافيش حركة مخزون'))}
                <Popconfirm title="تمسح المسودة؟" onConfirm={() => removeDraft(r)}>
                  <Tooltip title="مسح المسودة">
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Tooltip>
                </Popconfirm>
              </>
            )}
            {r.state === 'confirmed' && icon('تعديل', <EditOutlined />, () => openEdit(r))}
            {r.state !== 'draft'
              && icon('طباعة إذن التشغيل', <PrinterOutlined />,
                      () => printOrder(r, 'production'))}
            {/* إذن الجودة بيبان بعد ما موادها تتصرف — قبلها الورقة لسه مش حقيقية. */}
            {r.state !== 'draft' && qualityPending(r) === 0
              && r.materials.some((m) => stageOf(m.stage) === 'quality')
              && icon('طباعة إذن الجودة', <PrinterOutlined style={{ color: '#d48806' }} />,
                      () => printOrder(r, 'quality'))}
            {r.state === 'confirmed'
              && icon('اصرف الخامات وابدأ', <PlayCircleOutlined />,
                      () => act(r, 'start', 'اتصرفت الخامات — الأمر بقى شغّال'), false, true)}
            {/* **صرف الجودة خطوة لوحدها** — بتبان لما الأمر يبقى شغّال ولسه فيه مواد
                تعبئة ما اتصرفتش. أول ما تتصرف الأيقونة بتختفي ومكانها طباعة إذنها. */}
            {r.state === 'in_progress' && qualityPending(r) > 0
              && icon(`اصرف مواد الجودة (${num(qualityPending(r))})`,
                      <ExperimentOutlined style={{ color: '#d48806' }} />,
                      () => act(r, 'issue-quality', 'اتصرفت مواد التعبئة'))}
            {(r.state === 'in_progress' || r.state === 'confirmed')
              && icon(r.state === 'in_progress'
                        ? 'الاستلام والإقفال' : 'صرف وإقفال مرة واحدة',
                      <InboxOutlined />, () => openReceive(r), false,
                      r.state === 'in_progress')}
            {(r.state === 'done' || r.state === 'in_progress')
              && icon('تراجع وعكس', <RollbackOutlined />, () => reverse(r), true)}
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
                  { title: 'الوحدة', key: 'u', width: 80,
                    render: (_: any, p: POProduct) => itemUnit(p.item_id) || '—' },
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
                <Col span={6}><Statistic title="كمية المنتج" value={num(r.product_quantity)}
                  suffix={r.products.length === 1 ? itemUnit(r.products[0].item_id) : ''} /></Col>
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
                  { title: 'الوحدة', key: 'u', width: 80,
                    render: (_: any, m: POMaterial) => itemUnit(m.item_id) || '—' },
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
                  الأمر ده اتلمّ من حركة منقولة من a5، وحركته اترحّلت في نظامهم — فهو
                  للقراءة بس. والتكلفة اللي ظاهرة هي **تكلفة a5 وقتها**، مش محسوبة
                  بمتوسط النهارده. المصدر مافيهوش كمية مخطّطة ولا بيقول أنهي خامة راحت
                  لأنهي منتج، فالفرق والنسبة مابيتعرضوش بدل ما يتخمّنوا.
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
              children: <>
          {shortages.length > 0 && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }}
              // **الرسالة بتقول الأمر هيقف فين بالظبط.** خامة تصنيع ناقصة بتوقف
              // «ابدأ»، ومادة تعبئة ناقصة بتوقف «اصرف مواد الجودة» — والاتنين
              // خطوتين مختلفتين في وقتين مختلفين، فتحذير واحد لهم كان بيوري
              // اللي بيبدأ النهارده مشكلة مالهاش دعوة بيه.
              message={(() => {
                const prod = shortages.filter((x) => x.stage === 'production').length;
                const qual = shortages.length - prod;
                const parts: string[] = [];
                if (prod) parts.push(`${num(prod)} خامة تصنيع — الأمر هيقف عند «ابدأ»`);
                if (qual) parts.push(`${num(qual)} مادة تعبئة — هتقف عند «اصرف مواد الجودة»`);
                return `مش كفاية في مخزنها: ${parts.join(' · ')}`;
              })()}
              description={(
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {shortages.map((sh, i) => (
                    <li key={i}>
                      <Tag color={sh.stage === 'quality' ? 'gold' : 'green'}>
                        {stageLabel(sh.stage)}
                      </Tag>
                      «{sh.name}» في {sh.wh} — متاح {num(sh.have.toFixed(3))} {sh.unit}
                      {' '}والمطلوب {num(sh.need.toFixed(3))}
                      {' '}(<b>ناقص {num((sh.need - sh.have).toFixed(3))}</b>)
                    </li>
                  ))}
                </ul>
              )} />
          )}
          {lines.map((ln, idx) => (
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
              {/* **الورقة بتتفتح على خطة بس.** «اللي طلع» مش خانة هنا: وقت فتح الأمر
                  محدش يعرف هيطلع كام، والرقمين جنب بعض كانوا بيتكتبوا نفس الرقم مرتين
                  فالفرق يطلع صفر على طول ورقم الإنتاج يضيع. بيتكتب عند الإقفال. */}
              <Col span={4}>
                {/* الوحدة جنب الخانة — اللي بيكتب «٥٠» لازم يشوف هو بيكتب قطع ولا كيلو. */}
                <InputNumber style={{ width: '100%' }} min={0.001} placeholder="الكمية المطلوبة"
                  addonAfter={ln.item_id ? itemUnit(ln.item_id) || undefined : undefined}
                  value={ln.planned_quantity as any}
                  onChange={(v) => patchLine(ln.key, { planned_quantity: v as any }, 'qty')} />
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

            {/* **المرحلتين مفصولتين، مش عمود جوّه جدول واحد.**
                الكشف الواحد بيخلّي اللي بيكتب يعدّ خامات هتخرج في وقتين مختلفين على
                إنها طلب واحد، وبيقرا رقم إجمالي مالوش معنى. والقسمين هنا بيوروا
                بالظبط الورقتين اللي هيتطبعوا: إذن للمكن وإذن للتعبئة. */}
            {STAGES.map((st) => {
              const rows = ln.materials.filter((m) => (m.stage ?? 'production') === st.value);
              // القسم اللي مالوش سطور بيتعرض بزرار الإضافة بس — عشان اللي عايز
              // يزوّد مادة تعبئة على منتج مالوش يلاقي مكانها.
              return (
                <div key={st.value} style={{ marginTop: 10 }}>
                  <Divider orientation="right" style={{ margin: '10px 0 8px' }}>
                    <Tag color={st.color}>{st.short}</Tag>
                    {st.value === 'production' ? 'خامات بتدخل الماكينة' : 'مواد بتتحط بعد الإنتاج'}
                    {rows.length > 0 && (
                      <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                        {' '}· {num(rows.length)}
                      </span>
                    )}
                  </Divider>
                  {rows.map((m) => (
                    <Row gutter={8} key={m.key} style={{ marginBottom: 6 }}>
                      <Col span={8}>
                        <Select showSearch style={{ width: '100%' }} placeholder="الخامة"
                          value={m.item_id} options={itemOptions(allItems)}
                          filterOption={searchFilter} filterSort={searchRank}
                          onChange={(v) => patchMaterial(ln.key, m.key, { item_id: v })} />
                      </Col>
                      <Col span={5}>
                        <Select style={{ width: '100%' }} placeholder="تتصرف من"
                          value={m.warehouse_id} options={whOptions}
                          onChange={(v) => patchMaterial(ln.key, m.key, { warehouse_id: v })} />
                      </Col>
                      <Col span={4}>
                        <InputNumber style={{ width: '100%' }} min={0} placeholder="المطلوب"
                          addonAfter={m.item_id ? itemUnit(m.item_id) || undefined : undefined}
                          value={m.planned_quantity as any}
                          onChange={(v) => patchMaterial(ln.key, m.key, {
                            planned_quantity: v as any,
                            quantity: m.quantity == null ? (v as any) : m.quantity,
                          })} />
                      </Col>
                      {/* **المتاح في المخزن ده** — الرقم اللي كان بيتعرف بعد فوات
                          الأوان: الصرف بيحصل عند «ابدأ»، فالنقص كان بيبان بعد ما
                          الورقة تتكتب وتتأكد. */}
                      <Col span={4}>
                        {(() => {
                          const have = availableIn(m.item_id, m.warehouse_id);
                          const need = Number(m.planned_quantity ?? 0);
                          if (have == null) return null;
                          return (
                            <span style={{ fontSize: 12, lineHeight: '32px',
                                           color: have < need ? '#cf1322' : '#8c8c8c',
                                           fontWeight: have < need ? 600 : 400 }}>
                              متاح {num(have.toFixed(3))} {m.item_id ? itemUnit(m.item_id) : ''}
                              {have < need && ` · ناقص ${num((need - have).toFixed(3))}`}
                            </span>
                          );
                        })()}
                      </Col>
                      <Col span={3}>
                        {/* نقل السطر للمرحلة التانية — أسهل من مسحه وكتابته تاني. */}
                        <Button type="text" size="small" style={{ fontSize: 12 }}
                          onClick={() => patchMaterial(ln.key, m.key, {
                            stage: st.value === 'production' ? 'quality' : 'production' })}>
                          ← {st.value === 'production' ? 'جودة' : 'تصنيع'}
                        </Button>
                        <Button type="text" danger size="small" icon={<DeleteOutlined />}
                          onClick={() => patchLine(ln.key, {
                            materialsTouched: true,
                            materials: ln.materials.filter((y) => y.key !== m.key) })} />
                      </Col>
                    </Row>
                  ))}
                  {/* زيادة أو مسح خامة بإيد = لمسة، فالتحديث التلقائي من الوصفة بيقف. */}
                  <Button size="small" onClick={() => patchLine(ln.key, {
                    materialsTouched: true,
                    materials: [...ln.materials,
                                { ...newPOMaterial(), stage: st.value, stageTouched: true }],
                  })}>
                    + {st.value === 'production' ? 'خامة تصنيع' : 'مادة تعبئة'}
                  </Button>
                </div>
              );
            })}
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

      {/**
        * **باب واحد: الاستلام والإقفال.**
        *
        * الاتنين بيسألوا نفس السؤال — «طلع كام؟» — ويختلفوا في حاجة واحدة: «خلصنا ولا
        * لسه». شاشتين منفصلتين كانت بتخلّي اللي عايز يسجّل دفعة يدوس «إقفال» ويقفل
        * الورقة على دفعة من أربعة.
        *
        * وسجل الدفعات جوّه معاهم، لأنه الجواب على السؤال اللي بيتسأل قبل الاتنين:
        * «أنا واصلني كام لحد دلوقتي؟».
        */}
      <TabModal centered open={receiving != null} onCancel={() => setReceiving(null)}
        title={receiving
          ? `${receiving.document_number} — الاستلام والإقفال`
          : ''}
        width={760} destroyOnHidden footer={null}>
        {receiving && (() => {
          const totalGot = receiving.products.reduce(
            (a, p) => a + Number(p.received_quantity || 0), 0);
          const totalPlan = receiving.products.reduce(
            (a, p) => a + Number(p.planned_quantity), 0);
          return (
            <>
              <Alert type="info" showIcon style={{ marginBottom: 12 }}
                message={totalGot > 0
                  ? `اتستلم ${num(totalGot)} من ${num(totalPlan)} — الباقي ${num(totalPlan - totalGot)}`
                  : `لسه مااستلمتش حاجة. المخطّط ${num(totalPlan)}`} />
              <Tabs defaultActiveKey={receiving.state === 'in_progress' ? 'take' : 'close'}
                items={[
                  ...(receiving.state === 'in_progress' ? [{
                    key: 'take',
                    label: `استلام دفعة${receiving.receipts?.length
                      ? ` (${num(receiving.receipts.length)})` : ''}`,
                    children: (
                      <>
                        <Row gutter={8} align="middle" style={{ marginBottom: 14 }}>
                          <Col span={6}>تاريخ الاستلام</Col>
                          <Col span={10}>
                            {/* **يوم الاستلام، مش يوم الإدخال.** الورشة بتقفل تشغيلة
                                بالليل والمكتب بيدخّلها الصبح. */}
                            <DatePicker style={{ width: '100%' }} value={receiptDate}
                              onChange={setReceiptDate} allowClear={false} />
                          </Col>
                        </Row>
                        {receiving.products.map((p) => {
                          const plan = Number(p.planned_quantity);
                          const got = Number(p.received_quantity || 0);
                          const now = Number(received[p.id] || 0);
                          const after = got + now;
                          return (
                            <Row key={p.id} gutter={8} align="middle"
                              style={{ marginBottom: 12 }}>
                              <Col span={9}>
                                <div style={{ fontWeight: 600 }}>{itemName(p.item_id)}</div>
                                <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                  المطلوب <Qty value={p.planned_quantity}
                                    unit={itemUnit(p.item_id)} />
                                  {got > 0 && <> · اتستلم <b>{num(got)}</b></>}
                                </div>
                              </Col>
                              <Col span={6}>
                                <InputNumber style={{ width: '100%' }} min={0}
                                  placeholder="اللي وصل"
                                  addonAfter={itemUnit(p.item_id) || undefined}
                                  value={received[p.id] as any}
                                  onChange={(v) => setReceived(
                                    (x) => ({ ...x, [p.id]: v as any }))} />
                              </Col>
                              {/* **الإجمالي بعد الدفعة دي، والفرق عن المخطّط.** الزيادة
                                  والنقص الاتنين مسموحين — اللي طلع هو اللي طلع. */}
                              <Col span={9} style={{ fontSize: 12 }}>
                                {now > 0 ? (
                                  <>
                                    الإجمالي <b>{num(after)}</b> {itemUnit(p.item_id)}
                                    {after > plan && (
                                      <Tag color="gold" style={{ marginInlineStart: 6 }}>
                                        زيادة {num(after - plan)}
                                      </Tag>
                                    )}
                                    {after < plan && (
                                      <Tag style={{ marginInlineStart: 6 }}>
                                        باقي {num(plan - after)}
                                      </Tag>
                                    )}
                                  </>
                                ) : (
                                  <span style={{ color: '#8c8c8c' }}>
                                    {plan - got > 0
                                      ? `الباقي ${num(plan - got)}` : 'اتستلم بالكامل'}
                                  </span>
                                )}
                              </Col>
                            </Row>
                          );
                        })}
                        <div style={{ textAlign: 'left', marginTop: 8 }}>
                          <Button type="primary" icon={<DownloadOutlined />}
                            onClick={submitReceive}>سجّل الاستلام</Button>
                        </div>

                        {!!receiving.receipts?.length && (
                          <>
                            <Divider orientation="right" style={{ margin: '16px 0 8px' }}>
                              سجل الدفعات
                            </Divider>
                            <Table size="small" pagination={false} rowKey="id"
                              dataSource={receiving.receipts}
                              columns={[
                                { title: 'التاريخ', dataIndex: 'receipt_date', width: 110,
                                  render: (v: string | null) => v || '-' },
                                { title: 'المنتج', key: 'it',
                                  render: (_: any, rc: POReceipt) => {
                                    const ln = receiving.products.find(
                                      (x) => x.id === rc.product_line_id);
                                    return ln ? itemName(ln.item_id) : '-';
                                  } },
                                { title: 'الكمية', dataIndex: 'quantity', width: 110,
                                  align: 'center' as const,
                                  render: (v: string, rc: POReceipt) => {
                                    const ln = receiving.products.find(
                                      (x) => x.id === rc.product_line_id);
                                    return <b>{num(v)} {ln ? itemUnit(ln.item_id) : ''}</b>;
                                  } },
                                /* **دفعة غلط لازم يبقى ليها طريقة.** اللي سجّل ٥٠٠ وهو
                                   قاصد ٥٠ كان لازم يعكس الأمر كله — فيرجّع خامات اتصرفت
                                   فعلاً ودفعات صح. */
                                { title: '', key: 'x', width: 44, align: 'center' as const,
                                  render: (_: any, rc: POReceipt) => (
                                    <Popconfirm title="تعكس الدفعة دي؟"
                                      onConfirm={() => undoReceipt(rc)}>
                                      <Tooltip title="عكس الدفعة">
                                        <Button type="text" danger size="small"
                                          icon={<UndoOutlined />} />
                                      </Tooltip>
                                    </Popconfirm>
                                  ) },
                              ]} />
                          </>
                        )}
                      </>
                    ),
                  }] : []),
                  {
                    key: 'close',
                    label: 'إقفال الأمر',
                    children: (
                      <>
                        {/* **الرقم هنا هو الإجمالي اللي طلع، مش الباقي.** اللي استلم
                            دفعات بيلاقيه مكتوب — والفرق بينه وبين المستلم هو اللي
                            بيتحرّك دلوقتي. */}
                        {receiving.products.map((p) => (
                          <Row key={p.id} gutter={8} align="middle"
                            style={{ marginBottom: 10 }}>
                            <Col span={10}>
                              <div style={{ fontWeight: 600 }}>{itemName(p.item_id)}</div>
                              <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                المطلوب <Qty value={p.planned_quantity}
                                  unit={itemUnit(p.item_id)} />
                              </div>
                            </Col>
                            <Col span={7}>
                              <InputNumber style={{ width: '100%' }} min={0.001}
                                placeholder="إجمالي اللي طلع"
                                addonAfter={itemUnit(p.item_id) || undefined}
                                value={outputs[p.id] as any}
                                onChange={(v) => setOutputs(
                                  (o) => ({ ...o, [p.id]: v as any }))} />
                            </Col>
                            <Col span={7}>
                              <Variance planned={String(p.planned_quantity)}
                                actual={String(outputs[p.id] ?? 0)} />
                            </Col>
                          </Row>
                        ))}
                        {/* **والهالك هنا كمان.** محدش يعرف هيبوظ كام وهو بيخطّط؛ وهو
                            جزء من الخامة اللي خرجت خلاص — مش خصم زيادة. */}
                        {receiving.materials.length > 0 && (
                          <>
                            <Divider orientation="right" style={{ margin: '14px 0 10px' }}>
                              الهالك من الخامات
                            </Divider>
                            {receiving.materials.map((m) => (
                              <Row key={m.id} gutter={8} align="middle"
                                style={{ marginBottom: 8 }}>
                                <Col span={10}>
                                  {itemName(m.item_id)}
                                  <Tag color={stageOf(m.stage) === 'quality' ? 'gold' : 'green'}
                                    style={{ marginInlineStart: 6 }}>
                                    {stageLabel(m.stage)}
                                  </Tag>
                                </Col>
                                <Col span={7} style={{ opacity: 0.65, fontSize: 12 }}>
                                  اتصرف <Qty value={m.quantity} unit={itemUnit(m.item_id)} />
                                </Col>
                                <Col span={7}>
                                  <InputNumber style={{ width: '100%' }} min={0}
                                    max={Number(m.quantity)} placeholder="هالك"
                                    addonAfter={itemUnit(m.item_id) || undefined}
                                    value={waste[m.id] as any}
                                    onChange={(v) => setWaste(
                                      (w) => ({ ...w, [m.id]: v as any }))} />
                                </Col>
                              </Row>
                            ))}
                          </>
                        )}
                        <p style={{ color: '#888', marginTop: 12 }}>
                          {receiving.state === 'in_progress'
                            ? 'الخامات اتصرفت خلاص وقت البدء — الإقفال بيضيف الباقي للمخزن ويحسب التكلفة.'
                            : 'الأمر ده ماصرفش خاماته لسه — الإقفال هيصرفها ويضيف الإنتاج مرة واحدة.'}
                        </p>
                        <div style={{ textAlign: 'left' }}>
                          <Button type="primary" onClick={submitClose}>إقفال وترحيل</Button>
                        </div>
                      </>
                    ),
                  },
                ]} />
            </>
          );
        })()}
      </TabModal>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { printWorkOrder, type WorkOrderStage } from '../print/workOrderSheet';
import { PAGE_SIZE_OPTIONS } from '../utils/pagination';
import {
  Alert, Button, Card, Col, DatePicker, Divider, Empty, Form, Input, Modal, Row, Select, Space, Steps, Table, Tabs, Tag, Tooltip, message,
} from 'antd';
import { Statistic } from '../components/Statistic';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, RollbackOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined,
  BuildOutlined, PlayCircleOutlined, PrinterOutlined, DownloadOutlined, UndoOutlined,
  CheckOutlined, InboxOutlined, ClearOutlined, SearchOutlined,
} from '@ant-design/icons';
import ListPage from '../components/ListPage';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import DocumentHistoryButton from '../components/DocumentHistory';
import { useQueryTab } from '../components/useQueryTab';
import { useDocRoute } from '../components/useDocRoute';
import DocOpening from '../components/DocOpening';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import { useListFilter } from '../components/ListToolbar';
import { matchesStatement } from '../utils/statements';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

import StatsRow from '../components/StatsRow';
import { numeralsLocale } from '../utils/money';
import { activeOptions } from '../utils/active';
interface Warehouse { id: number; name: string; branch_id?: number | null; }
interface BranchRef { id: number; name: string; is_factory?: boolean; }
interface Item {
  id: number; code: string; name: string;
  kind: 'raw_material' | 'product'; unit_of_measure: string;
  purchase_price: string | null; active: boolean;
}
type Stage = 'production' | 'quality';

const STAGES: { value: Stage; label: string; short: string; color: string }[] = [
  { value: 'production', label: 'تصنيع — تدخل الماكينة', short: 'تصنيع', color: 'green' },
  { value: 'quality', label: 'جودة — توضع على المنتج بعد خروجه', short: 'جودة', color: 'gold' },
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
  statement1?: string | null;
}

const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  labor: 'عمالة', machine: 'ماكينة', overhead: 'أعباء', other: 'أخرى',
};
const RESOURCE_KIND_OPTIONS = (Object.keys(RESOURCE_KIND_LABELS) as ResourceKind[])
  .map((k) => ({ value: k, label: RESOURCE_KIND_LABELS[k] }));

const fmtMoney = (v: string | number) =>
  Number(v).toLocaleString(numeralsLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Manufacturing() {
  const [tab, setTab] = useQueryTab('orders');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<BranchRef[]>([]);
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

  const [ordersTotal, setOrdersTotal] = useState<number | null>(null);

  const header: SectionHeader = {
    tabs: [
      { key: 'orders', label: 'أوامر التشغيل', count: ordersTotal },
      { key: 'recipes', label: 'نسب إنتاج', count: boms.length },
      { key: 'wastage', label: 'مستندات الهالك', count: wastages.length },
    ],
    activeTab: tab as Section,
    onTabChange: setTab,
  };

  const [visited, setVisited] = useState<Set<string>>(() => new Set([tab]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);
  const pane = (key: Section, node: React.ReactNode) => (
    visited.has(key) || tab === key
      ? <div key={key} style={{ display: tab === key ? 'contents' : 'none' }}>{node}</div>
      : null
  );

  return (
    <>
      {pane('orders', (
        <ProductionOrdersTab
          header={header} onTotal={setOrdersTotal}
          products={products} rawMaterials={rawMaterials} warehouses={warehouses}
          branches={branches} boms={boms} itemName={itemName} itemUnit={itemUnit}
          itemCode={itemCode} whName={whName} active={tab === 'orders'}
        />
      ))}
      {pane('recipes', (
        <RecipesTab
          header={header}
          boms={boms} products={products} rawMaterials={rawMaterials}
          itemName={itemName} loading={loading} reload={loadAll}
        />
      ))}
      {pane('wastage', (
        <WastageTab
          header={header}
          wastages={wastages} warehouses={warehouses}
          rawMaterials={rawMaterials} products={products}
          itemName={itemName} whName={whName} loading={loading} reload={loadAll}
        />
      ))}
    </>
  );
}

type Section = 'orders' | 'recipes' | 'wastage';
interface SectionHeader {
  tabs: { key: Section; label: string; count?: number | null }[];
  activeTab: Section;
  onTabChange: (k: Section) => void;
}

const footOf = (shown: number, total: number, noun: string) => (
  <span className="sl-foot">
    <span>المعروض: <b>{shown.toLocaleString(numeralsLocale())}</b>
      {' '}من {total.toLocaleString(numeralsLocale())} {noun}</span>
  </span>
);

function RecipesTab({
  header, boms, products, rawMaterials, itemName, loading, reload,
}: {
  header: SectionHeader;
  boms: Bom[]; products: Item[]; rawMaterials: Item[];
  itemName: (id: number) => string; loading: boolean; reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Bom | null>(null);
  const [form] = Form.useForm();
  const [unitOpts, setUnitOpts] = useState<Record<number, AltUnit[]>>({});
  const loadUnits = async (itemId: number) => {
    if (!itemId || unitOpts[itemId]) return;
    try {
      const r = await api.get(`/api/v1/items/${itemId}/units`);
      setUnitOpts((prev) => ({ ...prev, [itemId]: r.data?.units || [] }));
    } catch {
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
        message.success('تم تحديث نسب الإنتاج');
      } else {
        await api.post('/api/v1/manufacturing/boms', payload);
        message.success('تم إضافة نسب الإنتاج');
      }
      setOpen(false);
      reload();
    } catch (err) { console.error(err); }
  };

  const deactivate = async (bom: Bom) => {
    try {
      await api.delete(`/api/v1/manufacturing/boms/${bom.id}`);
      message.success('تم إلغاء تفعيل نسب الإنتاج');
      reload();
    } catch (err) { console.error(err); }
  };

  const columns = [
    { title: 'المنتج', key: 'product', render: (_: any, r: Bom) => itemName(r.product_id) },
    { title: 'الاسم', dataIndex: 'name', key: 'name' },
    { title: 'كمية الناتج', dataIndex: 'output_quantity', key: 'oq', render: (q: string) => Number(q) },
    { title: 'الخامات', key: 'comp',
      render: (_: any, r: Bom) => (
        <Space size={[0, 4]} wrap>
          {r.components.map((c) => (
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
            <Popconfirm title="إلغاء تفعيل نسب الإنتاج؟" okText="نعم" cancelText="لا"
              onConfirm={() => deactivate(r)}>
              <Button type="link" danger icon={<DeleteOutlined />}>إلغاء تفعيل</Button>
            </Popconfirm>
          )}
        </Space>
      ) },
  ];

  const recipesTabCols = useTableColumns('mfg-recipes', columns, {
    export: { name: 'نسب إنتاج', rows: filter.filtered },
  });

  const searchRef = React.useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } },
    header.activeTab === 'recipes');

  return (
    <>
    <ListPage<Section>
      icon={<BuildOutlined />}
      title="نسب إنتاج"
      tabs={header.tabs} activeTab={header.activeTab} onTabChange={header.onTabChange}
      actions={(<>
        <Button type="primary" icon={<PlusOutlined />} className="sl-create" onClick={openCreate}>
          إضافة نسب إنتاج
        </Button>
        {recipesTabCols.control}
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={searchRef}
          prefix={<SearchOutlined />} placeholder="بحث بالاسم أو المنتج"
          value={filter.query} onChange={(e) => filter.setQuery(e.target.value)} />
        <Select allowClear showSearch mode="multiple" maxTagCount="responsive" placeholder="المنتج"
          value={filter.values.product_id} onChange={(v) => filter.setValue('product_id', v)}
          options={products.map((p) => ({ value: p.id, label: p.name }))}
          filterOption={searchFilter} filterSort={searchRank} />
        <Select allowClear mode="multiple" maxTagCount="responsive" placeholder="الحالة"
          value={filter.values.active} onChange={(v) => filter.setValue('active', v)}
          options={[
            { value: 'active', label: 'نشطة' },
            { value: 'inactive', label: 'غير نشطة' },
          ]} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table {...bomsKb.tableProps}
        className="sl-table" size="small"
        rowKey="id" loading={loading} dataSource={filter.filtered} columns={recipesTabCols.columns}
        pagination={{
          showSizeChanger: true, locale: { items_per_page: '' },
          showTotal: () => footOf(filter.filtered.length, boms.length, 'منتج'),
        }}
        locale={{ emptyText: 'لا توجد وصفات بعد' }} />
    </ListPage>

      <TabModal centered
        title={editing ? 'تعديل نسب إنتاج' : 'نسب إنتاج جديدة'} width={560} open={open}
        onCancel={() => setOpen(false)} destroyOnHidden
        footer={<Button type="primary" onClick={() => form.submit()}>حفظ</Button>}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="product_id" label="المنتج الناتج"
            rules={[{ required: true, message: 'اختر المنتج' }]}>
            <Select showSearch placeholder="اختر المنتج" disabled={!!editing}
              options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.unit_of_measure})` }))} filterOption={searchFilter} filterSort={searchRank} />
          </Form.Item>
          <Form.Item name="name" label="الاسم" rules={[{ required: true, message: 'اكتب الاسم' }]}>
            <Input placeholder="مثال: نسب كوع ٢ بوصة" />
          </Form.Item>
          <Form.Item name="output_quantity" label="الكمية الناتجة"
            rules={[{ required: true, message: 'أدخل كمية الناتج' }]}>
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
                      <Select showSearch placeholder="الخامة" style={{ minWidth: 220 }}
                        onChange={(v: number) => {
                          loadUnits(v);
                          const rows = form.getFieldValue('components') || [];
                          if (rows[field.name]) {
                            rows[field.name] = { ...rows[field.name], unit: undefined };
                            form.setFieldsValue({ components: rows });
                          }
                        }}
                        options={[...rawMaterials, ...products].map((r) => ({
                          value: r.id, label: `${r.name} (${r.unit_of_measure})`,
                          search: r.code || '' }))} filterOption={searchFilter} filterSort={searchRank} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'quantity']} style={{ marginBottom: 0 }}
                      rules={[{ required: true, message: 'الكمية' }]}>
                      <InputNumber min={0.001} placeholder="الكمية"
                        data-grid-col="qty" keyboard={false} />
                    </Form.Item>
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
    </>
  );
}

function WastageTab({
  header, wastages, warehouses, rawMaterials, products, itemName, whName, loading, reload,
}: {
  header: SectionHeader;
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
    search: (w) => [w.document_number, itemName(w.item_id), w.reason, w.statement1],
    filters: {
      statement: (w, v) => matchesStatement(w, v),
      item_id: (w, v) => w.item_id === v,
      warehouse_id: (w, v) => w.warehouse_id === v,
      status: (w, v) => (v === 'reversal' ? w.is_reversal : !w.is_reversal),
    },
  });

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
        ...(values.statement1 ? { statement1: values.statement1 } : {}),
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
      content: `سيؤدي عكس المستند "${record.document_number}" إلى إرجاع الكمية المهلَكة إلى المخزون. هل تريد المتابعة؟`,
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
      render: (v: string) => `${fmtMoney(v)}` },
    { title: 'إجمالي التكلفة', dataIndex: 'total_cost', key: 'total',
      render: (v: string) => `${fmtMoney(v)}` },
    { title: 'السبب', dataIndex: 'reason', key: 'reason', render: (v: string | null) => v || '-' },
    { title: 'البيان', dataIndex: 'statement1', key: 'statement1', ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'الحالة', key: 'status', render: (_: any, r: Wastage) =>
        r.is_reversal ? <Tag color="purple">حركة عكسية</Tag> : <Tag color="green">مرحّل</Tag> },
    { title: 'إجراء', key: 'action', render: (_: any, r: Wastage) =>
        !r.is_reversal && (
          <Button type="link" danger icon={<RollbackOutlined />} onClick={() => reverse(r)}>
            تراجع وعكس
          </Button>
        ) },
  ];

  const wastageTabCols = useTableColumns('mfg-wastage', columns, {
    export: { name: 'مستندات الهالك', rows: filter.filtered },
  });

  const searchRef = React.useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } },
    header.activeTab === 'wastage');

  return (
    <>
    <ListPage<Section>
      icon={<BuildOutlined />}
      title="عمليات التصنيع" muted="(مستندات الهالك)"
      tabs={header.tabs} activeTab={header.activeTab} onTabChange={header.onTabChange}
      actions={(<>
        <Button type="primary" icon={<PlusOutlined />} className="sl-create" onClick={openCreate}>
          هالك جديد
        </Button>
        {wastageTabCols.control}
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={searchRef}
          prefix={<SearchOutlined />} placeholder="بحث برقم المستند أو الصنف أو السبب أو البيان"
          value={filter.query} onChange={(e) => filter.setQuery(e.target.value)} />
        <Select allowClear showSearch mode="multiple" maxTagCount="responsive" placeholder="الصنف"
          value={filter.values.item_id} onChange={(v) => filter.setValue('item_id', v)}
          options={[...rawMaterials, ...products].map((i) => ({ value: i.id, label: i.name }))}
          filterOption={searchFilter} filterSort={searchRank} />
        <Select allowClear showSearch mode="multiple" maxTagCount="responsive" placeholder="المخزن"
          value={filter.values.warehouse_id} onChange={(v) => filter.setValue('warehouse_id', v)}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          filterOption={searchFilter} filterSort={searchRank} />
        <Select allowClear mode="multiple" maxTagCount="responsive" placeholder="الحالة"
          value={filter.values.status} onChange={(v) => filter.setValue('status', v)}
          options={[
            { value: 'posted', label: 'مرحّل' },
            { value: 'reversal', label: 'حركة عكسية' },
          ]} />
        <Input allowClear placeholder="البيان"
          value={filter.values.statement ?? undefined}
          onChange={(e) => filter.setValue('statement', e.target.value || undefined)} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table {...wastageKb.tableProps}
        className="sl-table" size="small"
        rowKey="id" loading={loading} dataSource={filter.filtered} columns={wastageTabCols.columns}
        pagination={{
          showSizeChanger: true, locale: { items_per_page: '' },
          showTotal: () => footOf(filter.filtered.length, wastages.length, 'مستند'),
        }}
        locale={{ emptyText: 'لا توجد مستندات هالك بعد' }} />
    </ListPage>

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
            <Select showSearch placeholder="اختر المخزن"
              options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank} />
          </Form.Item>
          <Form.Item name="quantity" label="الكمية المهلَكة" rules={[{ required: true, message: 'أدخل الكمية' }]}>
            <InputNumber min={0.001} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="السبب (اختياري)">
            <Input.TextArea rows={2} placeholder="سبب الهالك" />
          </Form.Item>
          <Form.Item name="statement1" label="البيان">
            <Input placeholder="اختياري" maxLength={200} />
          </Form.Item>
        </Form>
      </TabModal>
    </>
  );
}

type POState = 'draft' | 'confirmed' | 'in_progress' | 'done' | 'reversed';

interface POMaterial {
  id: number; product_line_id: number | null; item_id: number; warehouse_id: number | null;
  planned_quantity: string; quantity: string; unit: string | null;
  unit_cost: string; line_cost: string; waste_quantity: string;
  stage?: string | null;
  issued?: boolean;
}
interface POReceipt {
  id: number; product_line_id: number; quantity: string;
  receipt_date: string | null; notes: string | null;
}
interface POProduct {
  id: number; item_id: number; warehouse_id: number | null;
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
  in_progress: { color: 'processing', label: 'قيد التنفيذ' },
  done: { color: 'green', label: 'منفّذ' },
  reversed: { color: 'red', label: 'معكوس' },
};

const PO_FLOW: POState[] = ['draft', 'confirmed', 'in_progress', 'done'];

function POFlow({ state }: { state: POState }) {
  if (state === 'reversed') {
    return (
      <Tag color="red" style={{ marginInlineEnd: 0 }}>
        معكوس — سُجِّلت الحركات العكسية وبقيت السطور في السجل
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

function Qty({ value, unit }: { value: string | number; unit?: string }) {
  return (
    <span>
      {num(value)}
      {unit ? <span style={{ fontSize: '0.85em', opacity: 0.6 }}>{' '}{unit}</span> : null}
    </span>
  );
}

function Variance({ planned, actual }: { planned: string; actual: string }) {
  const p = Number(planned);
  if (!p) return <span style={{ color: '#5b6575' }}>—</span>;
  const d = Number(actual) - p;
  if (!d) return <Tag color="green">مطابق</Tag>;
  return (
    <Tag color={d > 0 ? 'red' : 'blue'}>
      {d > 0 ? '+' : ''}{num(d.toFixed(3))}
    </Tag>
  );
}

interface DraftMaterial {
  key: number; item_id?: number; warehouse_id?: number; stage?: Stage;
  stageTouched?: boolean;
  planned_quantity?: number | null; quantity?: number | null; waste_quantity?: number | null;
  warehouseTouched?: boolean;
}
interface DraftProduct {
  key: number; item_id?: number; warehouse_id?: number;
  planned_quantity?: number | null; quantity?: number | null;
  bom_id?: number | null; expense_amount?: number | null; materials: DraftMaterial[];
  materialsTouched?: boolean;
  quantityTouched?: boolean;
}

let poSeq = 1;
const newPOMaterial = (): DraftMaterial => ({ key: poSeq++, stage: 'production' });
const newPOProduct = (): DraftProduct => ({ key: poSeq++, materials: [] });

const poPaper = (r: { external_document_number: string | null }) => {
  const v = (r.external_document_number || '').trim();
  if (!v) return '—';
  if (numeralsLocale() !== 'ar-EG') return v;
  return v.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
};

function ProductionOrdersTab({
  header, onTotal, products, rawMaterials, warehouses, branches, boms: propBoms, itemName, itemUnit,
  itemCode, whName, active,
}: {
  header: SectionHeader;
  onTotal: (n: number) => void;
  products: Item[]; rawMaterials: Item[]; warehouses: Warehouse[];
  branches: BranchRef[]; boms: Bom[];
  itemName: (id: number) => string;
  itemUnit: (id: number) => string;
  itemCode: (id: number) => string;
  whName: (id: number | null | undefined) => string;
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

  const [productionDate, setProductionDate] = useState<any>(null);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [externalRef, setExternalRef] = useState('');
  const [statement, setStatement] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftProduct[]>([]);
  const [formTab, setFormTab] = useState('work');
  const [closing, setClosing] = useState<ProductionOrder | null>(null);
  const [outputs, setOutputs] = useState<Record<number, number | null>>({});
  const [waste, setWaste] = useState<Record<number, number | null>>({});
  const [receiving, setReceiving] = useState<ProductionOrder | null>(null);
  const [received, setReceived] = useState<Record<number, number | null>>({});
  const [receiptDate, setReceiptDate] = useState<any>(null);
  const [stock, setStock] = useState<Map<number, { wh: number; qty: number }[]>>(new Map());
  const [freshBoms, setFreshBoms] = useState<Bom[] | null>(null);
  const boms = freshBoms ?? propBoms;

  const allItems = useMemo(() => [...products, ...rawMaterials], [products, rawMaterials]);
  const itemOptions = (list: Item[]) =>
    list.map((i) => ({ value: i.id, label: i.name, search: i.code || '' }));
  const factoryBranches = useMemo(() => branches.filter((b) => b.is_factory), [branches]);
  const branchChoices = factoryBranches.length ? factoryBranches : branches;
  const soleFactory = factoryBranches.length === 1 ? factoryBranches[0].id : undefined;
  const orderBranch = branchId ?? soleFactory;
  const allowedWh = useMemo(() => {
    if (!factoryBranches.length) return null;
    const ok = new Set(factoryBranches.map((b) => b.id));
    return new Set(warehouses
      .filter((w) => w.branch_id != null && (orderBranch != null
        ? w.branch_id === orderBranch : ok.has(w.branch_id)))
      .map((w) => w.id));
  }, [factoryBranches, warehouses, orderBranch]);
  const usedWh = lines.flatMap((l) => [l.warehouse_id, ...l.materials.map((m) => m.warehouse_id)]);
  const whOptions = activeOptions(sortByName(
    allowedWh ? warehouses.filter((w) => allowedWh.has(w.id)) : warehouses, (w) => w.name,
  ), usedWh);

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
      onTotal(res.data?.total ?? 0);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [page, pageSize, stateFilter, scope]);

  const resetForm = () => {
    setEditingId(null); setProductionDate(null); setBranchId(undefined);
    setExternalRef(''); setStatement(''); setNotes(''); setLines([]); setFormTab('work');
  };

  const refreshBoms = () => {
    api.get('/api/v1/manufacturing/boms')
      .then((r) => setFreshBoms(r.data))
      .catch(() => {});
  };

  const openNew = () => {
    resetForm(); setBranchId(soleFactory); setLines([newPOProduct()]); refreshBoms(); setOpen(true);
  };

  const { markOpen, markClosed, opening: docOpening } = useDocRoute<ProductionOrder>({
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
        message.warning(`أمر التشغيل رقم ${id} غير موجود`);
        return null;
      }
    },
  });

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
      quantityTouched: true,
      materialsTouched: true,
      materials: r.materials.filter((m) => m.product_line_id === p.id).map((m) => ({
        key: poSeq++, item_id: m.item_id, warehouse_id: m.warehouse_id ?? undefined,
        planned_quantity: Number(m.planned_quantity), quantity: Number(m.quantity),
        waste_quantity: Number(m.waste_quantity), stage: stageOf(m.stage),
        stageTouched: true,
      })),
    })));
    setOpen(true);
  };

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
        materialsTouched: true,
        materials: x.materials.map((y) => (y.key === matKey
          ? { ...y, ...patch,
              ...('warehouse_id' in patch ? { warehouseTouched: true } : {}),
              ...('stage' in patch ? { stageTouched: true } : {}) }
          : y)),
      }
      : x)));

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

  const loadStock = async (ids: number[]) => {
    const want = [...new Set(ids.filter((i) => i && !stock.has(i)))];
    if (!want.length) return;
    try {
      const res = await api.get('/api/v1/stock/by-item',
                                { params: { item_ids: want.join(',') } });
      setStock((prev) => {
        const next = new Map(prev);
        want.forEach((i) => next.set(i, []));
        (res.data as { item_id: number; location_id: number; on_hand: string }[])
          .forEach((r) => next.set(r.item_id,
                                   [...(next.get(r.item_id) ?? []),
                                    { wh: r.location_id, qty: Number(r.on_hand) }]));
        next.forEach((v) => v.sort((a, b) => b.qty - a.qty));
        return next;
      });
    } catch {}
  };

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
  }, [lines, stock, itemName, whName, itemUnit]);

  const availableIn = (itemId?: number, wh?: number | null): number | null => {
    if (!itemId || !wh) return null;
    const rows = stock.get(itemId);
    if (!rows) return null;
    return rows.find((r) => r.wh === wh)?.qty ?? 0;
  };

  const bestWarehouse = (itemId?: number, need = 0, fallback?: number) => {
    const rows = (itemId ? stock.get(itemId) : undefined)
      ?.filter((r) => !allowedWh || allowedWh.has(r.wh));
    if (!rows?.length) return fallback;
    return (rows.find((r) => r.qty >= need) ?? rows[0]).wh;
  };

  const recipeMaterials = (ln: DraftProduct): DraftMaterial[] | null => {
    const bom = boms.find((b) => b.id === ln.bom_id)
      ?? boms.find((b) => b.active && b.product_id === ln.item_id);
    if (!bom) return null;
    const qty = Number(ln.planned_quantity ?? ln.quantity ?? 0);
    if (!qty) return null;
    const scale = qty / Number(bom.output_quantity || 1);
    return bom.components.map((c) => {
      const q = Number(c.quantity) * scale * Number(c.unit_factor ?? 1);
      return {
        key: poSeq++, item_id: c.item_id, planned_quantity: q, quantity: q,
        warehouse_id: bestWarehouse(c.item_id, q, ln.warehouse_id),
        stage: stageOf(c.stage),
      };
    });
  };

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

  const fillFromRecipe = (key: number) => {
    setLines((prev) => prev.map((ln) => {
      if (ln.key !== key) return ln;
      const rows = recipeMaterials(ln);
      if (!rows) {
        const hasBom = boms.some((b) => b.product_id === ln.item_id);
        message.info(hasBom ? 'أدخل الكمية أولاً' : 'لا توجد وصفة لهذا المنتج');
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
    branch_id: orderBranch ?? undefined,
    external_document_number: externalRef || undefined,
    statement1: statement || undefined,
    notes: notes || undefined,
    products: lines.map((ln) => ({
      item_id: ln.item_id,
      planned_quantity: ln.planned_quantity,
      warehouse_id: ln.warehouse_id ?? undefined,
      bom_id: ln.bom_id ?? undefined,
      expense_amount: ln.expense_amount ?? 0,
      materials: ln.materials
        .filter((m) => m.item_id && (m.planned_quantity ?? m.quantity))
        .map((m) => ({
          item_id: m.item_id,
          planned_quantity: m.planned_quantity ?? m.quantity,
          warehouse_id: m.warehouse_id ?? undefined,
          ...(m.stageTouched ? { stage: stageOf(m.stage) } : {}),
        })),
    })),
  });

  const submit = async () => {
    if (!lines.length) { message.warning('أضف منتجاً واحداً على الأقل'); return; }
    for (const ln of lines) {
      if (!ln.item_id || !ln.planned_quantity) {
        message.warning('كل سطر منتج يحتاج إلى صنف وكمية'); return;
      }
      if (!ln.materials.some((m) => m.item_id && (m.planned_quantity ?? m.quantity))) {
        message.warning(`«${itemName(ln.item_id)}» ليس له خامات — اختر وصفة أو أضفها يدوياً`);
        return;
      }
    }
    setSaving(true);
    try {
      if (editingId) await api.put(`/api/v1/manufacturing/production-orders/${editingId}`, payload());
      else await api.post('/api/v1/manufacturing/production-orders', payload());
      message.success(editingId ? 'تم حفظ المسودة' : 'تم فتح أمر تشغيل كمسودة — لا توجد حركة مخزون بعد');
      closeEditor(); setPage(1); load();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const printOrder = (r: ProductionOrder, stage: WorkOrderStage = 'production') =>
    printWorkOrder(r, { itemName, itemCode, itemUnit, whName, branchName }, stage);

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
      if (verb === 'confirm' || verb === 'issue-quality') {
        const fresh = (res?.data ?? r) as ProductionOrder;
        const quality = verb === 'issue-quality';
        Modal.confirm({
          title: quality ? 'تم صرف مواد التعبئة' : 'تم تأكيد الأمر',
          content: quality
            ? 'هل تريد طباعة إذن الجودة وتسليمه للتعبئة؟'
            : 'هل تريد طباعة إذن التشغيل وتسليمه للورشة؟',
          okText: 'طباعة', cancelText: 'لاحقاً',
          onOk: () => printOrder(fresh, quality ? 'quality' : 'production'),
        });
      }
    } catch (err: any) {
      if (err?.response?.status === 409) {
        Modal.error({
          title: 'تعذّر تنفيذ الأمر', width: 560,
          content: <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>{err?.response?.data?.detail?.message}</div>,
          okText: 'حسناً',
        });
      }
    }
  };

  const openClose = (r: ProductionOrder) => {
    setOutputs(Object.fromEntries(r.products.map((p) => [p.id,
      Number(p.received_quantity) > 0
        ? Number(p.received_quantity)
        : (Number(p.planned_quantity) || Number(p.quantity))])));
    setWaste(Object.fromEntries(r.materials.map((m) => [m.id, Number(m.waste_quantity) || null])));
    setClosing(r);
  };

  const submitClose = async () => {
    if (!closing) return;
    const bad = closing.products.find((p) => !Number(outputs[p.id]));
    if (bad) { message.error(`أدخل الكمية الناتجة من «${itemName(bad.item_id)}»`); return; }
    try {
      await api.post(`/api/v1/manufacturing/production-orders/${closing.id}/execute`,
        { outputs, waste: Object.fromEntries(
          Object.entries(waste).filter(([, v]) => Number(v) > 0)) });
      message.success('تم إقفال الأمر: أُضيف الإنتاج إلى المخزن وحُسبت التكلفة');
      setClosing(null);
      load();
    } catch (err) { console.error(err); }
  };

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
      message.success('تم عكس الدفعة — خرجت الكمية من المخزن');
      setReceiving(res.data as ProductionOrder);
      load();
    } catch (err) { console.error(err); }
  };

  const submitReceive = async () => {
    if (!receiving) return;
    const quantities = Object.fromEntries(
      Object.entries(received).filter(([, v]) => Number(v) > 0));
    if (!Object.keys(quantities).length) {
      message.warning('أدخل الكمية المستلمة'); return;
    }
    try {
      await api.post(`/api/v1/manufacturing/production-orders/${receiving.id}/receive`, {
        quantities,
        receipt_date: receiptDate ? receiptDate.format('YYYY-MM-DD') : undefined,
      });
      message.success('تم تسجيل الاستلام — دخلت البضاعة المخزن');
      setReceiving(null);
      load();
    } catch (err) { console.error(err); }
  };

  const reverse = (r: ProductionOrder) => {
    showReversalConfirm({
      title: 'التراجع عن أمر تشغيل',
      content: `سيؤدي عكس «${r.document_number}» إلى إرجاع الخامات إلى المخزن وإلغاء الإنتاج، وسيبقى في السجل كحركة عكسية لا كحذف. وإذا كان الإنتاج قد بيع أو صُرف فسيُمنع العكس. هل تريد المتابعة؟`,
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
      message.success('تم حذف المسودة');
      load();
    } catch (err) { console.error(err); }
  };

  const noMoney = (r: ProductionOrder, v: string) =>
    (r.state !== 'done' || !Number(v) ? '—' : `${fmtMoney(v)}`);

  const columns = [
    { title: 'المستند', key: 'doc',
      render: (_: any, r: ProductionOrder) => (
        r.imported_from
          ? <Tag color="gold">أمر تشغيل {poPaper(r)}</Tag>
          : <Tag color="blue">{r.document_number}</Tag>
      ) },
    { title: 'التاريخ', dataIndex: 'production_date', key: 'date', width: 115,
      render: (d: string | null) => d || '-' },
    { title: 'رقم الورقة', dataIndex: 'external_document_number', key: 'ext', width: 125,
      render: (v: string | null, r: ProductionOrder) => (r.imported_from ? '—' : v || '-') },
    { title: 'الفرع', key: 'branch', width: 120,
      render: (_: any, r: ProductionOrder) => branchName(r.branch_id) },
    { title: 'المنتجات', key: 'np', width: 85,
      render: (_: any, r: ProductionOrder) => r.products.length },
    { title: 'المخطّط / الناتج', key: 'pq', width: 170,
      render: (_: any, r: ProductionOrder) => {
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
    { title: 'البيان', dataIndex: 'statement1', key: 'st', width: 160, ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'الحالة', key: 'state', width: 150,
      render: (_: any, r: ProductionOrder) => (
        <Space size={4}>
          <Tag color={PO_STATE_TAG[r.state].color}>{PO_STATE_TAG[r.state].label}</Tag>
          {r.imported_from && <Tag color="gold">منقول</Tag>}
          {r.is_reversal && <Tag color="purple">حركة عكسية</Tag>}
        </Space>
      ) },
    { title: 'إجراء', key: 'action', width: 180, align: 'center' as const,
      render: (_: any, r: ProductionOrder) => {
        const history = (
          <DocumentHistoryButton iconOnly entityType="production_order" entityId={r.id}
            documentNumber={r.document_number} />
        );
        if (r.imported_from || r.is_reversal) return history;
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
            {history}
            {r.state === 'draft' && (
              <>
                {icon('تعديل', <EditOutlined />, () => openEdit(r))}
                {icon('تأكيد', <CheckOutlined />,
                  () => act(r, 'confirm', 'تم تأكيد الأمر — لا توجد حركة مخزون بعد'))}
                <Popconfirm title="هل تريد حذف المسودة؟" onConfirm={() => removeDraft(r)}>
                  <Tooltip title="حذف المسودة">
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Tooltip>
                </Popconfirm>
              </>
            )}
            {r.state === 'confirmed' && icon('تعديل', <EditOutlined />, () => openEdit(r))}
            {r.state !== 'draft'
              && icon('طباعة إذن التشغيل', <PrinterOutlined />,
                      () => printOrder(r, 'production'))}
            {r.state !== 'draft' && qualityPending(r) === 0
              && r.materials.some((m) => stageOf(m.stage) === 'quality')
              && icon('طباعة إذن الجودة', <PrinterOutlined style={{ color: '#d48806' }} />,
                      () => printOrder(r, 'quality'))}
            {r.state === 'confirmed'
              && icon('اصرف الخامات وابدأ', <PlayCircleOutlined />,
                      () => act(r, 'start', 'تم صرف الخامات — الأمر قيد التنفيذ'), false, true)}
            {r.state === 'in_progress' && qualityPending(r) > 0
              && icon(`اصرف مواد الجودة (${num(qualityPending(r))})`,
                      <ExperimentOutlined style={{ color: '#d48806' }} />,
                      () => act(r, 'issue-quality', 'تم صرف مواد التعبئة'))}
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
  const ordersTabCols = useTableColumns('mfg-production-orders', columns);

  if (docOpening) return <DocOpening />;
  return (
    <>
    <ListPage<Section>
      icon={<BuildOutlined />}
      title="عمليات التصنيع" muted="(أوامر التشغيل)"
      tabs={header.tabs} activeTab={header.activeTab} onTabChange={header.onTabChange}
      actions={(<>
        <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
          onClick={openNew}>
          أمر تشغيل جديد
        </Button>
        {ordersTabCols.control}
      </>)}
      filters={(<>
        <Input.Search className="sl-f-search" allowClear
          placeholder="بحث برقم المستند أو رقم الورقة أو البيان"
          value={query} onChange={(e) => setQuery(e.target.value)}
          onSearch={() => { setPage(1); load(); }} />
        <Select allowClear placeholder="الحالة" value={stateFilter}
          onChange={(v) => { setStateFilter(v); setPage(1); }}
          options={(Object.keys(PO_STATE_TAG) as POState[]).map((k) => ({
            value: k, label: PO_STATE_TAG[k].label }))} />
        <Select value={scope}
          onChange={(v) => { setScope(v); setPage(1); }}
          options={[
            { value: 'all', label: 'الكل' },
            { value: 'ours', label: 'المُدخل في النظام' },
            { value: 'imported', label: 'المنقول من a5' },
          ]} />
      </>)}
    >
      <Table
        className="sl-table" size="small"
        rowKey="id" loading={loading} dataSource={rows} columns={ordersTabCols.columns}
        pagination={{
          current: page, pageSize, total, showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          locale: { items_per_page: '' },
          showTotal: (t) => (
            <span className="sl-foot">
              <span>إجمالي الأوامر: <b>{t.toLocaleString(numeralsLocale())}</b></span>
            </span>
          ),
          onChange: (p, s) => { setPage(p); setPageSize(s); },
        }}
        expandable={{
          expandedRowRender: (r: ProductionOrder) => (
            <div>
              <div style={{ marginBottom: 14 }}>
                {r.imported_from
                  ? <Tag color="gold">منقول من a5 — اكتمل في نظامهم، وليس له مسار هنا</Tag>
                  : <POFlow state={r.state} />}
              </div>
              <Divider orientation="right" style={{ margin: '4px 0 8px' }}>الإنتاج التام</Divider>
              <Table size="small" pagination={false} rowKey="id" dataSource={r.products}
                columns={[
                  { title: 'الصنف', key: 'n', render: (_: any, p: POProduct) => itemName(p.item_id) },
                  { title: 'المخزن', dataIndex: 'warehouse_id', render: (w: number | null) => whName(w) },
                  { title: 'الوحدة', key: 'u', width: 80,
                    render: (_: any, p: POProduct) => itemUnit(p.item_id) || '—' },
                  { title: 'المخطّط', dataIndex: 'planned_quantity',
                    render: (q: string) => (Number(q) ? num(q) : '—') },
                  { title: 'الناتج', dataIndex: 'quantity', render: (q: string) => num(q) },
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
                      return p ? itemName(p.item_id) : '—';
                    } },
                  { title: 'المخزن', dataIndex: 'warehouse_id', render: (w: number | null) => whName(w) },
                  { title: 'الوحدة', key: 'u', width: 80,
                    render: (_: any, m: POMaterial) => itemUnit(m.item_id) || '—' },
                  { title: 'المخطّط', dataIndex: 'planned_quantity',
                    render: (q: string) => (Number(q) ? num(q) : '—') },
                  { title: 'المصروف', dataIndex: 'quantity', render: (q: string) => num(q) },
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
                  هذا الأمر مُجمَّع من حركة منقولة من a5، وقد رُحِّلت حركته في نظامهم، لذا فهو
                  للقراءة فقط. والتكلفة الظاهرة هي **تكلفة a5 في حينها**، وليست محسوبة
                  بمتوسط اليوم. ولا يتضمن المصدر كمية مخطّطة ولا يحدد الخامة الخاصة بكل
                  منتج، لذا لا يُعرض الفرق والنسبة.
                </p>
              )}
              {r.state !== 'done' && !r.imported_from && (
                <p style={{ color: '#888', marginTop: 12 }}>
                  لم يُرحَّل الأمر بعد — لا توجد أي حركة مخزون عليه، وتُحتسب التكلفة عند التنفيذ.
                </p>
              )}
              {r.statement1 && (
                <p style={{ marginTop: 8 }}><b>البيان:</b> {r.statement1}</p>
              )}
              {r.notes && (
                <p style={{ color: '#888', marginTop: 4 }}><b>ملاحظات:</b> {r.notes}</p>
              )}
            </div>
          ),
        }}
        locale={{ emptyText: 'لا توجد أوامر تشغيل' }}
      />
    </ListPage>

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
        <Row gutter={12} style={{
          position: 'sticky', top: 0, zIndex: 2, paddingBottom: 12, marginBottom: 4,
          background: '#fff',
        }}>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>تاريخ الإنتاج</div>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD"
              value={productionDate} onChange={setProductionDate} placeholder="اليوم" />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>الفرع</div>
            <Select allowClear={!soleFactory} disabled={!!soleFactory} style={{ width: '100%' }}
              value={orderBranch} onChange={setBranchId}
              options={branchChoices.map((b) => ({ value: b.id, label: b.name }))} placeholder="الفرع" />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>رقم الورقة</div>
            <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)}
              maxLength={40} placeholder="رقم الورقة" />
          </Col>
        </Row>

        <Tabs
          activeKey={formTab} onChange={setFormTab}
          items={[
            {
              key: 'work',
              label: `التشغيل (${lines.length})`,
              children: <>
          {shortages.length > 0 && (
            <Alert type="error" showIcon style={{ marginBottom: 12 }}
              message={(() => {
                const prod = shortages.filter((x) => x.stage === 'production').length;
                const qual = shortages.length - prod;
                const parts: string[] = [];
                if (prod) parts.push(`${num(prod)} خامة تصنيع — سيتوقف الأمر عند «ابدأ»`);
                if (qual) parts.push(`${num(qual)} مادة تعبئة — سيتوقف الأمر عند «اصرف مواد الجودة»`);
                return `الكمية غير كافية في مخزنها: ${parts.join(' · ')}`;
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
                <Select allowClear style={{ width: '100%' }} placeholder="الوصفة"
                  value={ln.bom_id ?? undefined}
                  options={boms.filter((b) => b.product_id === ln.item_id)
                    .map((b) => ({ value: b.id, label: b.active ? b.name : `${b.name} (قديمة)` }))}
                  onChange={(v) => patchLine(ln.key, { bom_id: v ?? null }, 'product')} />
              </Col>
              <Col span={4}>
                <Select showSearch style={{ width: '100%' }} placeholder="مخزن الإنتاج" value={ln.warehouse_id}
                  options={whOptions}
                  onChange={(v) => patchLine(ln.key, { warehouse_id: v }, 'qty')} filterOption={searchFilter} filterSort={searchRank} />
              </Col>
              <Col span={4}>
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

            {STAGES.map((st) => {
              const rows = ln.materials.filter((m) => (m.stage ?? 'production') === st.value);
              return (
                <div key={st.value} style={{ marginTop: 10 }}>
                  <Divider orientation="right" style={{ margin: '10px 0 8px' }}>
                    <Tag color={st.color}>{st.short}</Tag>
                    {st.value === 'production' ? 'خامات تدخل الماكينة' : 'مواد توضع بعد الإنتاج'}
                    {rows.length > 0 && (
                      <span style={{ color: '#555b65', fontSize: 14 }}>
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
                        <Select showSearch style={{ width: '100%' }} placeholder="تُصرف من"
                          value={m.warehouse_id} options={whOptions}
                          onChange={(v) => patchMaterial(ln.key, m.key, { warehouse_id: v })} filterOption={searchFilter} filterSort={searchRank} />
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
                      <Col span={4}>
                        {(() => {
                          const have = availableIn(m.item_id, m.warehouse_id);
                          const need = Number(m.planned_quantity ?? 0);
                          if (have == null) return null;
                          return (
                            <span style={{ fontSize: 14, lineHeight: '32px',
                                           color: have < need ? '#cf1322' : '#555b65',
                                           fontWeight: have < need ? 600 : 400 }}>
                              متاح {num(have.toFixed(3))} {m.item_id ? itemUnit(m.item_id) : ''}
                              {have < need && ` · ناقص ${num((need - have).toFixed(3))}`}
                            </span>
                          );
                        })()}
                      </Col>
                      <Col span={3}>
                        <Button type="text" size="small" style={{ fontSize: 14 }}
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
                    placeholder="سطر واحد يُطبع على الورقة" />
                  <div style={{ margin: '12px 0 4px' }}>ملاحظات</div>
                  <Input.TextArea rows={4} maxLength={500} value={notes}
                    onChange={(e) => setNotes(e.target.value)} />
                </div>
              ),
            },
          ]}
        />
      </TabModal>

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
                  ? `تم استلام ${num(totalGot)} من ${num(totalPlan)} — المتبقي ${num(totalPlan - totalGot)}`
                  : `لم يُستلم شيء بعد. المخطّط ${num(totalPlan)}`} />
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
                                <div style={{ fontSize: 14, color: '#555b65' }}>
                                  المطلوب <Qty value={p.planned_quantity}
                                    unit={itemUnit(p.item_id)} />
                                  {got > 0 && <> · تم استلام <b>{num(got)}</b></>}
                                </div>
                              </Col>
                              <Col span={6}>
                                <InputNumber style={{ width: '100%' }} min={0}
                                  placeholder="الكمية الواردة"
                                  addonAfter={itemUnit(p.item_id) || undefined}
                                  value={received[p.id] as any}
                                  onChange={(v) => setReceived(
                                    (x) => ({ ...x, [p.id]: v as any }))} />
                              </Col>
                              <Col span={9} style={{ fontSize: 14 }}>
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
                                        المتبقي {num(plan - after)}
                                      </Tag>
                                    )}
                                  </>
                                ) : (
                                  <span style={{ color: '#555b65' }}>
                                    {plan - got > 0
                                      ? `المتبقي ${num(plan - got)}` : 'تم الاستلام بالكامل'}
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
                                { title: '', key: 'x', width: 44, align: 'center' as const,
                                  render: (_: any, rc: POReceipt) => (
                                    <Popconfirm title="هل تريد عكس هذه الدفعة؟"
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
                        {receiving.products.map((p) => (
                          <Row key={p.id} gutter={8} align="middle"
                            style={{ marginBottom: 10 }}>
                            <Col span={10}>
                              <div style={{ fontWeight: 600 }}>{itemName(p.item_id)}</div>
                              <div style={{ fontSize: 14, color: '#555b65' }}>
                                المطلوب <Qty value={p.planned_quantity}
                                  unit={itemUnit(p.item_id)} />
                              </div>
                            </Col>
                            <Col span={7}>
                              <InputNumber style={{ width: '100%' }} min={0.001}
                                placeholder="إجمالي الناتج"
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
                                <Col span={7} style={{ opacity: 0.65, fontSize: 14 }}>
                                  المصروف <Qty value={m.quantity} unit={itemUnit(m.item_id)} />
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
    </>
  );
}

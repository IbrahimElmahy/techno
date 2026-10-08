import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { useNavigate } from 'react-router-dom';
import {
  Button, Checkbox, Col, Collapse, Divider, Empty, Form, Input, Modal, Radio, Row, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import {
  PlusOutlined, DollarOutlined, ColumnWidthOutlined, DeleteOutlined, BarcodeOutlined,
  EditOutlined, StopOutlined, SearchOutlined, ClearOutlined, AppstoreOutlined,
  UnorderedListOutlined, DownloadOutlined, UploadOutlined, InboxOutlined,
  LoadingOutlined, CheckCircleFilled,
} from '@ant-design/icons';
import { api } from '../api/client';
import { netOf } from '../utils/discounts';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';
import { useCategoryTree, categorySelectOptions } from '../hooks/useCategoryTree';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import { money, numeralsLocale } from '../utils/money';
import { dualQty, isMeterUnit, lengthUnits } from '../utils/units';

import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
const PRICE_TIERS: { key: string; label: string }[] = [
  { key: 'consumer', label: 'مستهلك' },
  { key: 'commercial', label: 'تجاري' },
  { key: 'semi_commercial', label: 'نصف تجاري' },
  { key: 'wholesale', label: 'جملة' },
  { key: 'semi_wholesale', label: 'نصف جملة' },
  { key: 'list_price', label: 'سعر القائمة' },
];

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
      <TabModal title="الأطر السعرية الخمسة" open={open} onCancel={() => setOpen(false)}
        onOk={onSave} okText={canEdit ? 'حفظ' : 'إغلاق'} okButtonProps={{ disabled: !canEdit }}>
        <p style={{ color: '#888' }}>سعر البيع المرجعي (الأساس): {base ? `${base}` : '—'}</p>
        {PRICE_TIERS.map((t) => (
          <Row key={t.key} gutter={8} align="middle" style={{ marginBottom: 8 }}>
            <Col span={10}>{t.label}</Col>
            <Col span={14}>
              <InputNumber min={0} step={0.01} style={{ width: '100%' }}
                disabled={!canEdit} value={vals[t.key] ?? undefined}
                onChange={(v) => setVals({ ...vals, [t.key]: v as number })} />
            </Col>
          </Row>
        ))}
      </TabModal>
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
  default_warehouse_id: number | null;
  category: string | null;
  consumer_price: string | null;
  tier_prices?: Record<string, string>;
  piece_name: string | null;
  pieces_per_unit: string | null;
  default_discount_pct: string | null;
  min_stock: string | null;
  max_stock: string | null;
  is_perishable: boolean;
  description: string | null;
  meters_per_piece?: string | null;
}

const isLengthRow = (base: string, name: string): boolean => (
  isMeterUnit(base) ? ['قطعة', 'قطعه'].includes((name || '').trim()) : isMeterUnit(name)
);

const InlineNumberCell = ({
  value, min, max, emptyAs, gridCol, onCommit,
}: {
  value: number | null;
  min: number;
  max?: number;
  emptyAs?: number;
  gridCol: string;
  onCommit: (v: number) => Promise<void>;
}) => {
  const [draft, setDraft] = useState<number | null>(value);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const committed = useRef<number | null>(value);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (status === 'saving') return;
    committed.current = value;
    setDraft(value);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const same = (a: number | null, b: number | null) =>
    a === b || (a !== null && b !== null && Math.abs(a - b) < 0.005);

  const commit = async () => {
    let v = draft;
    if ((v === null || v === undefined) && emptyAs !== undefined) v = emptyAs;
    if (same(v, committed.current)) { setDraft(committed.current); return; }
    if (v === null || v === undefined || Number.isNaN(v) || v < min
      || (max !== undefined && v > max)) {
      message.warning(max !== undefined
        ? `يجب أن تكون القيمة بين ${min} و${max}`
        : `يجب ألا تقل القيمة عن ${min}`);
      setDraft(committed.current);
      return;
    }
    const rounded = Math.round(v * 100) / 100;
    const previous = committed.current;
    committed.current = rounded;
    setDraft(rounded);
    setStatus('saving');
    try {
      await onCommit(rounded);
      setStatus('saved');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setStatus('idle'), 1800);
    } catch {
      committed.current = previous;
      setDraft(previous);
      setStatus('idle');
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <InputNumber
        data-grid-col={gridCol}
        size="small"
        style={{ width: '100%' }}
        min={min}
        max={max}
        precision={2}
        controls={false}
        keyboard={false}
        value={draft}
        onChange={(v) => setDraft(v === null || v === undefined || v === '' ? null : Number(v))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(committed.current);
        }}
        suffix={(
          <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center' }}>
            {status === 'saving' && <LoadingOutlined style={{ fontSize: 14 }} />}
            {status === 'saved' && <CheckCircleFilled style={{ fontSize: 14, color: '#52c41a' }} />}
          </span>
        )}
      />
    </div>
  );
};

const KIND_LABELS: Record<string, string> = {
  raw_material: 'مادة خام',
  product: 'منتج تام الصنع',
};

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
        const v = parseFloat(res.data.point_value) || 0;
        setPoints(v);
        setInputVal(v);
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
        <InputNumber
          size="small"
          min={0}
          step={0.001}
          style={{ width: 100 }}
          value={inputVal}
          onChange={(v) => setInputVal(Number(v) || 0)}
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
      .map((r) => ({ name: r.name, factor: Number(r.factor).toFixed(9) }));
    try {
      await api.put(`/api/v1/items/${itemId}/units`, { units });
      message.success('تم حفظ الوحدات');
      setOpen(false);
    } catch (err) { console.error(err); }
  };

  return (
    <>
      <Button size="small" type="link" icon={<ColumnWidthOutlined />} onClick={onOpen}>الوحدات</Button>
      <TabModal title="وحدات القياس ومعامل التحويل" open={open} onCancel={() => setOpen(false)}
        onOk={onSave} okText={canEdit ? 'حفظ' : 'إغلاق'} okButtonProps={{ disabled: !canEdit }}>
        <p style={{ color: '#888' }}>الوحدة الأساسية: <strong>{base}</strong> (معامل = 1)</p>
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
      </TabModal>
    </>
  );
};

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
      <TabModal title="الأرقام التسلسلية" open={open} onCancel={() => setOpen(false)} footer={null} width={560}>
        {canEdit && (
          <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8 }}>
            <strong>استلام أرقام تسلسلية للمخزون</strong>
            <Select showSearch style={{ width: '100%', margin: '8px 0' }} placeholder="مخزن الاستلام" value={whId}
              onChange={setWhId} options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank} />
            <Input.TextArea rows={3} placeholder="أرقام تسلسلية مفصولة بمسافة أو فاصلة أو سطر"
              value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="primary" style={{ marginTop: 8 }} onClick={onReceive}>استلام</Button>
          </div>
        )}
        <strong>المتوفر بالمخزون ({inStock.length})</strong>
        <Table size="small" rowKey="id" dataSource={inStock} pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS }}
          columns={[
            { title: 'الرقم التسلسلي', dataIndex: 'serial' },
            { title: 'الموقع', dataIndex: 'location_id', render: (v: number, r: any) => r.location_kind ? `${r.location_kind} #${v}` : '-' },
          ]} />
      </TabModal>
    </>
  );
};

export default function Catalog() {
  const { options: kindOptions } = useLookup('item_kind');
  const { options: uomOptions } = useLookup('unit_of_measure');
  const { options: categoryOptions } = useLookup('item_category');
  const { tree: categoryTree } = useCategoryTree();
  const categoryTreeOptions = useMemo(
    () => categorySelectOptions(categoryTree, categoryOptions),
    [categoryTree, categoryOptions]);
  const kindLabels = labelMap(kindOptions);
  const categoryLabels = labelMap(categoryOptions);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemRecord | null>(null);
  const [unitRows, setUnitRows] = useState<{ name: string; factor: number | null }[]>([]);
  const lengthBaseChoices = (record: ItemRecord | null) => {
    const current = (record?.unit_of_measure ?? '').trim();
    const meter = isMeterUnit(current) ? current : 'متر';
    const piece = !current || isMeterUnit(current) ? 'قطعة' : current;
    const looksMeter = isMeterUnit(current) || (record?.name ?? '').trim().startsWith('متر');
    return { meter, piece, suggested: looksMeter ? meter : piece };
  };
  const [viewRaw, setView] = useQueryTab('grouped');
  const view = (viewRaw === 'table' ? 'table' : 'grouped') as 'grouped' | 'table';
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const { can } = useAuth();

  const canEditPoints = can('product_points.write');
  const canEditPrices = can('catalog.write');
  const canManageItems = can('catalog.write');

  const [priceEditRaw, setPriceEdit] = useState(false);
  const priceEdit = priceEditRaw && view === 'table' && canEditPrices;
  const leavePriceEdit = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setPriceEdit(false);
  };
  const switchView = (k: 'grouped' | 'table') => { leavePriceEdit(); setView(k); };
  useEffect(() => { if (view !== 'table') setPriceEdit(false); }, [view]);

  const patchRow = (id: number, patch: (r: ItemRecord) => Partial<ItemRecord>) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch(r) } : r)));

  const saveTierPrice = async (r: ItemRecord, tier: string, price: number) => {
    const s = price.toFixed(2);
    await api.put(`/api/v1/items/${r.id}/prices`, { tiers: [{ tier, price: s }] });
    if (tier === 'consumer') await api.patch(`/api/v1/items/${r.id}`, { sale_price: s });
    patchRow(r.id, (row) => ({
      tier_prices: { ...(row.tier_prices ?? {}), [tier]: s },
      ...(tier === 'consumer' ? { consumer_price: s, sale_price: s } : {}),
    }));
  };

  const saveDiscount = async (r: ItemRecord, pct: number) => {
    const s = pct.toFixed(2);
    await api.patch(`/api/v1/items/${r.id}`, { default_discount_pct: s });
    patchRow(r.id, () => ({ default_discount_pct: s }));
  };

  const fetchItems = async (override?: Record<string, any>) => {
    const active = override ?? filters;
    setLoading(true);
    try {
      const params: any = {};
      Object.entries(active).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      });
      const res = await api.get('/api/v1/items', { params });
      setItems(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const setFilter = (key: string, value: any) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    fetchItems(next);
  };

  const applySearch = () => setFilter('q', search.trim() || undefined);

  const resetFilters = () => {
    setSearch('');
    setFilters({});
    fetchItems({});
  };

  const summary = useMemo(() => {
    const inStock = items.filter((i: any) => Number(i.on_hand || 0) > 0).length;
    const out = items.filter((i: any) => Number(i.on_hand || 0) === 0).length;
    return { count: items.length, inStock, out };
  }, [items]);

  useEffect(() => {
    fetchItems();
    api.get('/api/v1/warehouses')
      .then((res) => setWarehouses(res.data))
      .catch((err) => console.error(err));
  }, []);

  const onSaveItem = async (values: any) => {
    try {
      const tiers = Object.entries(values.prices || {})
        .map(([tier, row]: [string, any]) => ({
          tier,
          price: row?.price ?? 0,
          discount_pct: row?.discount_pct ?? 0,
          vat_pct: row?.vat_pct ?? 0,
        }))
        .filter((t) => Number(t.price) > 0);

      const core = {
        name: values.name,
        category: values.category ?? null,
        default_warehouse_id: values.default_warehouse_id ?? null,
        piece_name: values.piece_name || null,
        pieces_per_unit: values.pieces_per_unit ?? 1,
        description: values.description || null,
        min_stock: values.min_stock ?? null,
        max_stock: values.max_stock ?? null,
        is_serialized: !!values.is_serialized,
        is_perishable: !!values.is_perishable,
        default_discount_pct: values.default_discount_pct ?? 0,
        purchase_price: values.kind === 'raw_material' ? (values.purchase_price ?? null) : null,
        sale_price: values.prices?.consumer?.price ?? null,
      };

      const units = unitRows.filter((r) => r.name && r.factor && r.factor > 0)
        .map((r) => ({ name: r.name, factor: Number(r.factor).toFixed(9) }));
      const length = values.meters_per_piece && Number(values.meters_per_piece) > 0
        ? Number(values.meters_per_piece) : null;
      const points = values.kind === 'product' && canEditPoints
        && values.point_value !== undefined && values.point_value !== null
        ? values.point_value : undefined;

      if (editingItem) {
        await api.put(`/api/v1/items/${editingItem.id}/units`, { units });
        const relabel = length && values.length_base
          && values.length_base !== editingItem.unit_of_measure
          ? { unit_of_measure: values.length_base } : {};
        const manualLength = !length && unitRows.some((r) => r.name
          && isLengthRow(editingItem.unit_of_measure, r.name));
        await api.patch(`/api/v1/items/${editingItem.id}`, {
          ...core, ...relabel, ...(manualLength ? {} : { meters_per_piece: length }),
          active: !values.hidden,
        });
        if (tiers.length) await api.put(`/api/v1/items/${editingItem.id}/prices`, { tiers });
        if (points !== undefined) {
          await api.put(`/api/v1/products/${editingItem.id}/point-value`,
            { point_value: points });
        }
      } else {
        const created = await api.post('/api/v1/items', {
          ...core,
          kind: values.kind,
          unit_of_measure: values.unit_of_measure,
          tiers: tiers.length ? tiers : undefined,
          units: units.length ? units : undefined,
          meters_per_piece: length ?? undefined,
          point_value: points,
        });
        if (created.data?.id && values.hidden) {
          await api.patch(`/api/v1/items/${created.data.id}`, { active: false });
        }
      }

      message.success(editingItem ? 'تم تعديل الصنف' : 'تم تسجيل الصنف');
      setDrawerVisible(false);
      setEditingItem(null);
      form.resetFields();
      fetchItems();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteItem = async (record: ItemRecord) => {
    try {
      await api.delete(`/api/v1/items/${record.id}?hard=true`);
      message.success('تم حذف الصنف');
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

  const filteredItems = items;

  const grouped = useMemo(() => {
    const map = new Map<string, ItemRecord[]>();
    items.forEach((i) => {
      const key = i.category || '__none__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    });
    return [...map.entries()]
      .sort((a, b) => (a[0] === '__none__' ? 1 : b[0] === '__none__' ? -1 : a[0].localeCompare(b[0], 'ar')))
      .map(([key, rows]) => ({
        key,
        label: key === '__none__' ? 'بدون فئة' : (categoryLabels[key] || key),
        rows,
        onHand: rows.reduce((sum, r: any) => sum + Number(r.on_hand || 0), 0),
      }));
  }, [items, categoryLabels]);

  const openCreateForCategory = (category?: string) => {
    form.resetFields();
    setEditingItem(null);
    setUnitRows([]);
    if (category && category !== '__none__') form.setFieldsValue({ category });
    setDrawerVisible(true);
  };

  const openEditItem = async (record: ItemRecord) => {
    form.resetFields();
    setEditingItem(record);
    setUnitRows([]);
    setDrawerVisible(true);

    form.setFieldsValue({
      category: record.category ?? undefined,
      name: record.name,
      unit_of_measure: record.unit_of_measure,
      pieces_per_unit: record.pieces_per_unit ? Number(record.pieces_per_unit) : 1,
      piece_name: record.piece_name ?? undefined,
      kind: record.kind,
      hidden: !record.active,
      is_perishable: !!record.is_perishable,
      is_serialized: !!record.is_serialized,
      purchase_price: record.purchase_price ? Number(record.purchase_price) : undefined,
      default_discount_pct: record.default_discount_pct !== null
        && record.default_discount_pct !== undefined
        ? Number(record.default_discount_pct) : undefined,
      min_stock: record.min_stock ? Number(record.min_stock) : undefined,
      max_stock: record.max_stock ? Number(record.max_stock) : undefined,
      default_warehouse_id: record.default_warehouse_id ?? undefined,
      description: record.description ?? undefined,
      meters_per_piece: record.meters_per_piece ? Number(record.meters_per_piece) : undefined,
      length_base: lengthBaseChoices(record).suggested,
    });

    try {
      const prices = await api.get(`/api/v1/items/${record.id}/prices`);
      const byTier: any = {};
      (prices.data?.tiers || []).forEach((t: any) => {
        byTier[t.tier] = {
          price: t.price !== null ? Number(t.price) : undefined,
          discount_pct: t.discount_pct !== null ? Number(t.discount_pct) : undefined,
          vat_pct: t.vat_pct !== null ? Number(t.vat_pct) : undefined,
        };
      });
      form.setFieldsValue({ prices: byTier });
    } catch (err) { console.error(err); }

    try {
      const units = await api.get(`/api/v1/items/${record.id}/units`);
      setUnitRows((units.data?.units || [])
        .filter((u: any) => !u.is_base && !isLengthRow(record.unit_of_measure, u.name))
        .map((u: any) => ({ name: u.name, factor: parseFloat(u.factor) })));
    } catch (err) { console.error(err); }

    if (record.kind === 'product') {
      try {
        const pts = await api.get(`/api/v1/products/${record.id}/point-value`);
        form.setFieldsValue({ point_value: parseFloat(pts.data.point_value) || 0 });
      } catch (err) { console.error(err); }
    }
  };

  const columns = [
    {
      title: 'الفئة',
      dataIndex: 'category',
      key: 'category',
      ellipsis: true,
      render: (category: string | null) =>
        category ? <Tag color="purple">{categoryLabels[category] || category}</Tag> : '-',
    },
    {
      title: 'الاسم',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: ItemRecord) => (
        <Space size={4}>
          <span>{name}</span>
          {!record.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ),
    },
    {
      title: 'الوحدة',
      dataIndex: 'unit_of_measure',
      key: 'unit_of_measure',
      width: 75,
    },
    {
      title: 'عدد القطع',
      dataIndex: 'pieces_per_unit',
      key: 'pieces_per_unit',
      width: 85,
      render: (v: string | null) => (v ? Number(v).toLocaleString(numeralsLocale()) : '-'),
    },
    {
      title: 'القطعة',
      dataIndex: 'piece_name',
      key: 'piece_name',
      width: 80,
      render: (v: string | null) => v || '-',
    },
    ...PRICE_TIERS.map((t) => ({
      title: t.label,
      key: `tier_${t.key}`,
      width: 100,
      align: 'left' as const,
      render: (_: any, r: ItemRecord) => {
        const price = (r.tier_prices ?? {})[t.key]
          ?? (t.key === 'consumer' ? (r.consumer_price ?? r.sale_price) : undefined);
        if (priceEdit && r.kind === 'product') {
          return (
            <InlineNumberCell
              gridCol={`tier_${t.key}`} min={0}
              value={price === undefined || price === null ? null : Number(price)}
              onCommit={(v) => saveTierPrice(r, t.key, v)} />
          );
        }
        return price === undefined || price === null
          ? <span style={{ color: '#d9d9d9' }}>—</span>
          : <b>{money(price)}</b>;
      },
    })),
    {
      title: 'خصم ثابت',
      key: 'default_discount_pct',
      width: 120,
      align: 'left' as const,
      sorter: (a: ItemRecord, b: ItemRecord) =>
        Number(a.default_discount_pct || 0) - Number(b.default_discount_pct || 0),
      render: (_: any, r: ItemRecord) => {
        if (priceEdit) {
          return (
            <InlineNumberCell
              gridCol="default_discount_pct" min={0} max={100} emptyAs={0}
              value={Number(r.default_discount_pct || 0)}
              onCommit={(v) => saveDiscount(r, v)} />
          );
        }
        const pct = Number(r.default_discount_pct || 0);
        if (!pct) return <span style={{ color: '#bfbfbf' }}>—</span>;
        const price = Number(r.consumer_price ?? r.sale_price ?? 0);
        return (
          <div style={{ lineHeight: 1.35 }}>
            <Tag color="orange" style={{ marginInlineEnd: 0, fontWeight: 700 }}>
              {pct.toFixed(pct % 1 === 0 ? 0 : 2)}%
            </Tag>
            {price > 0 && (
              <div style={{ fontSize: 14, color: '#555b65' }}>
                صافي {money(netOf(price, pct))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'الرصيد',
      dataIndex: 'on_hand',
      key: 'on_hand',
      width: 90,
      align: 'left' as const,
      render: (v: string | null, r: ItemRecord) => {
        const n = Number(v || 0);
        const b = (
          <b style={{ color: n > 0 ? '#3f8600' : n < 0 ? '#cf1322' : '#6b6b6b' }}>
            {n.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
          </b>
        );
        return r.meters_per_piece && Number(r.meters_per_piece) > 0
          ? <Tooltip title={dualQty(n, lengthUnits(r.unit_of_measure, r.meters_per_piece))}>{b}</Tooltip>
          : b;
      },
      sorter: (a: any, b: any) => Number(a.on_hand || 0) - Number(b.on_hand || 0),
    },
    ...(canManageItems ? [{
      title: '',
      key: 'actions',
      width: 110,
      render: (_: any, record: ItemRecord) => (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="تعديل بيانات الصنف">
            <Button type="text" icon={<EditOutlined />} onClick={() => openEditItem(record)} />
          </Tooltip>
          {record.active && (
            <Tooltip title="إخفاء">
              <Button type="text" icon={<StopOutlined />}
                onClick={() => deactivateItem(record)} />
            </Tooltip>
          )}
          <Tooltip title="حذف">
            <Button type="text" danger icon={<DeleteOutlined />}
              onClick={() => deleteItem(record)} />
          </Tooltip>
        </Space>
      ),
    }] : []),
  ];

  const tableCols = useTableColumns('catalog-items', columns, {
    export: { name: 'الأصناف', rows: filteredItems },
  });

  const expandedRow = (record: ItemRecord) => (
    <Space size={32} wrap style={{ paddingInlineStart: 8 }}>
      <span>
        <span style={{ color: '#888' }}>تصنيف: </span>
        <Tag color={record.kind === 'product' ? 'green' : 'orange'}>
          {kindLabels[record.kind] || KIND_LABELS[record.kind] || record.kind}
        </Tag>
      </span>
      <span>
        <span style={{ color: '#888' }}>سعر الشراء المرجعي: </span>
        {record.purchase_price ? `${money(record.purchase_price)}` : '—'}
      </span>
      {record.kind === 'product' && (
        <span>
          <span style={{ color: '#888' }}>نقاط المنتج: </span>
          <ProductPoints itemId={record.id} isEditable={false} />
        </span>
      )}
      {!record.active && <Tag color="red">مخفي</Tag>}
    </Space>
  );

  const importingRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const downloadTemplate = async () => {
    try {
      const res = await api.get('/api/v1/items/import-template', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'items-import-template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {}
  };
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await api.post('/api/v1/items/import-excel', fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      const d = res.data;
      message.success(`تمت إضافة ${d.created} صنف · تم تخطي ${d.skipped} موجود`
        + (d.failed ? ` · فشل ${d.failed}` : ''));
      if (d.errors?.length) {
        Modal.warning({
          title: 'صفوف لم تُنشأ',
          width: 560,
          content: (
            <ul style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 18 }}>
              {d.errors.map((x: any, i: number) => (
                <li key={i}>صف {x.row} «{x.name}»: {x.message}</li>
              ))}
            </ul>
          ),
        });
      }
      fetchItems();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الاستيراد');
    } finally { setImporting(false); }
  };

  const footer = (
    <span className="sl-foot">
      <span>عدد الأصناف الظاهرة: <b>{summary.count.toLocaleString(numeralsLocale())}</b></span>
      <span>متوفرة: <b className="is-pos">{summary.inStock.toLocaleString(numeralsLocale())}</b></span>
      <span>برصيد صفر: <b>{summary.out.toLocaleString(numeralsLocale())}</b></span>
    </span>
  );

  return (
    <>
      <input ref={importingRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={onImportFile} />
      <ListPage<'grouped' | 'table'>
        icon={<InboxOutlined />}
        title="الأصناف" muted="(كتالوج المنتجات)"
          tabs={[
          { key: 'grouped', label: <><AppstoreOutlined /> مجمّع بالفئات</> },
          { key: 'table', label: <><UnorderedListOutlined /> جدول واحد</> },
        ]}
        activeTab={view}
        onTabChange={switchView}
        actions={(<>
          {canEditPrices && view === 'table' && (
            <Button icon={<EditOutlined />} type={priceEdit ? 'primary' : 'default'}
              onClick={() => (priceEdit ? leavePriceEdit() : setPriceEdit(true))}>
              {priceEdit ? 'إنهاء التعديل' : 'تعديل الأسعار والخصم'}
            </Button>
          )}
          {canManageItems && (
            <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
              onClick={() => openCreateForCategory()}>
              إضافة صنف للكتالوج
            </Button>
          )}
          {canManageItems && (
            <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>تنزيل القالب</Button>
          )}
          {canManageItems && (
            <Button icon={<UploadOutlined />} loading={importing} onClick={() => importingRef.current?.click()}>
              استيراد Excel
            </Button>
          )}
          {tableCols.control}
        </>)}
        filters={(<>
          <Input.Search
            className="sl-f-search"
            allowClear
            value={search}
            placeholder="بحث بالاسم أو الكود أو الفئة"
            prefix={<SearchOutlined />}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => setFilter('q', v.trim() || undefined)}
            onBlur={applySearch}
          />
          <Select allowClear placeholder="النوع"
            value={filters.kind}
            onChange={(v) => setFilter('kind', v)}
            options={[
              { value: 'product', label: 'منتج تام' },
              { value: 'raw_material', label: 'مادة خام' },
            ]} />
          <Select allowClear showSearch placeholder="الفئة"
            value={filters.category}
            onChange={(v) => setFilter('category', v)}
            options={categoryTreeOptions} filterOption={searchFilter} filterSort={searchRank} />
          <Select allowClear showSearch placeholder="المخزن الافتراضي"
            value={filters.warehouse_id}
            onChange={(v) => setFilter('warehouse_id', v)}
            filterOption={searchFilter} filterSort={searchRank}
            options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} />
          <Select allowClear placeholder="حالة المخزون"
            value={filters.stock_filter}
            onChange={(v) => setFilter('stock_filter', v)}
            options={[
              { value: 'in_stock', label: 'متوفر' },
              { value: 'out_of_stock', label: 'رصيد صفر' },
              { value: 'negative', label: 'رصيد سالب' },
            ]} />
          <Select allowClear placeholder="الحالة"
            value={filters.active}
            onChange={(v) => setFilter('active', v)}
            options={[{ value: true, label: 'نشط' }, { value: false, label: 'معطل' }]} />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={resetFilters}>مسح</Button>
        </>)}
      >
        {view === 'table' ? (
          <Table
            className="sl-table"
            dataSource={filteredItems}
            columns={tableCols.columns}
            rowKey="id"
            loading={loading}
            size="small"
            tableLayout="fixed"
            expandable={{ expandedRowRender: expandedRow }}
            pagination={{
              defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
              locale: { items_per_page: '' },
              showTotal: () => footer,
            }}
            onRow={(record) => (priceEdit ? {} : {
              onClick: () => navigate(`/catalog/${record.id}`),
              style: { cursor: 'pointer' },
            })}
          />
        ) : grouped.length === 0 ? (
          <Empty description="لا توجد أصناف مطابقة" style={{ padding: '24px 0' }} />
        ) : (<>
          <Collapse
            ghost
            style={{ marginTop: 4 }}
            defaultActiveKey={grouped.length <= 3 ? grouped.map((g) => g.key) : []}
            items={grouped.map((g) => ({
              key: g.key,
              label: (
                <Space>
                  <strong>{g.label}</strong>
                  <Tag color="blue">{g.rows.length} صنف</Tag>
                  <Tag color={g.onHand > 0 ? 'green' : 'default'}>
                    الرصيد: {g.onHand.toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 })}
                  </Tag>
                </Space>
              ),
              extra: canManageItems ? (
                <Button
                  size="small"
                  type="link"
                  icon={<PlusOutlined />}
                  onClick={(e) => { e.stopPropagation(); openCreateForCategory(g.key); }}
                >
                  إضافة صنف لهذه الفئة
                </Button>
              ) : null,
              children: (
                <Table
                  className="sl-table"
                  dataSource={g.rows}
                  columns={tableCols.columns}
                  rowKey="id"
                  size="small"
                  loading={loading}
                  tableLayout="fixed"
                  expandable={{ expandedRowRender: expandedRow }}
                  pagination={g.rows.length > 10
                    ? { defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
                        locale: { items_per_page: '' } }
                    : false}
                  onRow={(record) => ({
                    onClick: () => navigate(`/catalog/${record.id}`),
                    style: { cursor: 'pointer' },
                  })}
                />
              ),
            }))}
          />
          <div style={{ padding: '10px 4px', borderTop: '1px solid #f1f5f9' }}>{footer}</div>
        </>)}
      </ListPage>

      <TabModal footer={null} centered
        title={editingItem ? `تعديل بيانات الصنف — ${editingItem.name}` : 'صنف جديد'}
        width={860}
        onCancel={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onSaveItem} requiredMark={false}
          initialValues={{ pieces_per_unit: 1, kind: 'product' }}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="category" label="الفئة">
                <Select allowClear showSearch placeholder="اختر الفئة"
                  options={categoryTreeOptions}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="name" label="الاسم"
                rules={[{ required: true, message: 'اكتب اسم الصنف' }]}>
                <Input placeholder="مثال: ماسورة مياه ٣/٤ بوصة" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="unit_of_measure" label="اسم الوحدة"
                rules={[{ required: true, message: 'اختر الوحدة' }]}>
                <Select showSearch placeholder="الوحدة" disabled={!!editingItem}
                  options={uomOptions.map((o) => ({ value: o.value, label: o.label }))}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="pieces_per_unit" label="عدد القطع">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="piece_name" label="اسم القطعة">
                <Input placeholder="قطعة" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12} align="bottom">
            <Col span={8}>
              <Form.Item name="meters_per_piece" label="طول القطعة بالمتر">
                <InputNumber min={0} step={0.5} style={{ width: '100%' }}
                  addonBefore="القطعة =" addonAfter="متر" placeholder="مثلاً 3" />
              </Form.Item>
            </Col>
            <Form.Item noStyle shouldUpdate={(a, b) => a.meters_per_piece !== b.meters_per_piece
              || a.unit_of_measure !== b.unit_of_measure || a.length_base !== b.length_base}>
              {({ getFieldValue }) => {
                const n = Number(getFieldValue('meters_per_piece') || 0);
                if (!(n > 0)) return null;
                if (!editingItem) {
                  const base = getFieldValue('unit_of_measure') || '';
                  return (
                    <Col span={16} style={{ color: '#64748b', paddingBottom: 30 }}>
                      {isMeterUnit(base)
                        ? `المخزون بالمتر — البيع بالقطعة يخصم ${n} متر للقطعة.`
                        : `المخزون بـ«${base || 'القطعة'}» — البيع بالمتر يخصم 1÷${n} قطعة للمتر.`}
                    </Col>
                  );
                }
                const ch = lengthBaseChoices(editingItem);
                const chosen = getFieldValue('length_base') || ch.suggested;
                const onHand = Number((editingItem as ItemRecord & { on_hand?: string }).on_hand || 0);
                return (
                  <Col span={16}>
                    <Form.Item name="length_base" label="وحدة تسجيل رصيد هذا الصنف">
                      <Radio.Group optionType="button" buttonStyle="solid"
                        options={[{ value: ch.meter, label: 'متر' }, { value: ch.piece, label: ch.piece }]} />
                    </Form.Item>
                    {chosen !== editingItem.unit_of_measure ? (
                      <div style={{ color: '#b45309', marginTop: -16, marginBottom: 12, fontSize: 13 }}>
                        ستتغيّر الوحدة الأساسية من «{editingItem.unit_of_measure}» إلى «{chosen}» — الاسم فقط،
                        ولن يُحوَّل الرصيد ({dualQty(onHand, lengthUnits(chosen, n))}).
                      </div>
                    ) : null}
                  </Col>
                );
              }}
            </Form.Item>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="kind" label="تصنيف" rules={[{ required: true }]}>
                <Select disabled={!!editingItem}
                  options={kindOptions.map((o) => ({ value: o.value, label: o.label }))} />
              </Form.Item>
            </Col>
            <Form.Item noStyle shouldUpdate={(a, b) => a.kind !== b.kind}>
              {({ getFieldValue }) => (getFieldValue('kind') === 'raw_material' ? (
                <Col span={8}>
                  <Form.Item name="purchase_price" label="سعر الشراء المرجعي">
                    <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="0.00" />
                  </Form.Item>
                </Col>
              ) : canEditPoints ? (
                <Col span={8}>
                  <Form.Item name="point_value" label="نقاط المنتج">
                    <InputNumber min={0} step={0.001} style={{ width: '100%' }} placeholder="0" />
                  </Form.Item>
                </Col>
              ) : null)}
            </Form.Item>
            <Col span={8}>
              <Form.Item name="default_discount_pct" label="خصم الصنف %">
                <InputNumber min={0} max={99.99} step={0.01} style={{ width: '100%' }}
                  placeholder="0" />
              </Form.Item>
            </Col>
          </Row>

          <Space size={24} style={{ marginBottom: 16 }}>
            <Form.Item name="hidden" valuePropName="checked" noStyle>
              <Checkbox>مخفي</Checkbox>
            </Form.Item>
            <Form.Item name="is_perishable" valuePropName="checked" noStyle>
              <Checkbox>يستخدم صلاحية</Checkbox>
            </Form.Item>
            <Form.Item name="is_serialized" valuePropName="checked" noStyle>
              <Checkbox>يستخدم الرقم التسلسلي</Checkbox>
            </Form.Item>
          </Space>

          <Divider orientation="right" style={{ margin: '8px 0' }}>الأسعار</Divider>
          <Row gutter={8} style={{ marginBottom: 4, color: '#888' }}>
            <Col span={4} />
            <Col span={5}>السعر</Col>
            <Col span={5}>خصم</Col>
            <Col span={5}>ض.م</Col>
            <Col span={5}>السعر الصافي</Col>
          </Row>
          {PRICE_TIERS.map((tier) => (
            <Row gutter={8} key={tier.key} align="middle" style={{ marginBottom: 6 }}>
              <Col span={4}>{tier.label}</Col>
              <Col span={5}>
                <Form.Item name={['prices', tier.key, 'price']} style={{ marginBottom: 0 }}>
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="0" />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name={['prices', tier.key, 'discount_pct']} style={{ marginBottom: 0 }}>
                  <InputNumber min={0} max={100} step={0.01} style={{ width: '100%' }} placeholder="0" />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name={['prices', tier.key, 'vat_pct']} style={{ marginBottom: 0 }}>
                  <InputNumber min={0} max={100} step={0.01} style={{ width: '100%' }} placeholder="0" />
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item shouldUpdate style={{ marginBottom: 0 }}>
                  {({ getFieldValue }) => {
                    const row = getFieldValue(['prices', tier.key]) || {};
                    const price = Number(row.price || 0);
                    const net = netOf(price, row.discount_pct)
                      * (1 + Number(row.vat_pct || 0) / 100);
                    return (
                      <InputNumber value={Number(net.toFixed(2))} disabled
                        style={{ width: '100%' }} />
                    );
                  }}
                </Form.Item>
              </Col>
            </Row>
          ))}

          <Divider orientation="right" style={{ margin: '12px 0 8px' }}>
            وحدات القياس البديلة
          </Divider>
          {unitRows.map((r, i) => (
            <Row key={i} gutter={8} align="middle" style={{ marginBottom: 8 }}>
              <Col span={10}>
                <Input placeholder="اسم الوحدة (كرتونة)" value={r.name}
                  onChange={(e) => setUnitRows(unitRows.map((x, j) => (
                    j === i ? { ...x, name: e.target.value } : x)))} />
              </Col>
              <Col span={10}>
                <InputNumber min={0.001} step={1} style={{ width: '100%' }}
                  addonBefore="= عدد الأساس" value={r.factor ?? undefined}
                  onChange={(v) => setUnitRows(unitRows.map((x, j) => (
                    j === i ? { ...x, factor: v as number } : x)))} />
              </Col>
              <Col span={4}>
                <Button type="text" danger icon={<DeleteOutlined />}
                  onClick={() => setUnitRows(unitRows.filter((_, j) => j !== i))} />
              </Col>
            </Row>
          ))}
          <Button type="dashed" block icon={<PlusOutlined />} style={{ marginBottom: 8 }}
            onClick={() => setUnitRows([...unitRows, { name: '', factor: null }])}>
            إضافة وحدة
          </Button>

          <Row gutter={12} style={{ marginTop: 16 }}>
            <Col span={6}>
              <Form.Item name="min_stock" label="حد إعادة الطلب">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="max_stock" label="الحد الأقصى">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="default_warehouse_id" label="المخزن الافتراضي">
                <Select showSearch allowClear placeholder="اختياري"
                  options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="وصف">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>

          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setDrawerVisible(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

    </>
  );
}

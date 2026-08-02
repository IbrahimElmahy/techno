import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Checkbox, Col, Collapse, Divider, Empty, Form, Input, InputNumber, Modal, Row,
  Segmented, Select,
  Space, Statistic, Table, Tag, Tooltip, message,
} from 'antd';
import {
  PlusOutlined, DollarOutlined, ColumnWidthOutlined, DeleteOutlined, BarcodeOutlined,
  EditOutlined, StopOutlined, SearchOutlined, ClearOutlined, AppstoreOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';

// The five negotiated tiers plus the published list price, in the order and wording their form
// uses. Order is not cosmetic: whoever fills this in reads down a column on paper, and a different
// order means checking every line instead of typing six numbers. The labels are theirs too — «نص
// تجاري» is what the salesmen say, and renaming it to «نصف تجاري» makes them stop to translate.
const PRICE_TIERS: { key: string; label: string }[] = [
  { key: 'consumer', label: 'مستهلك' },
  { key: 'commercial', label: 'تجاري' },
  { key: 'semi_commercial', label: 'نص تجاري' },
  { key: 'wholesale', label: 'جمله' },
  { key: 'semi_wholesale', label: 'نص جمله' },
  { key: 'list_price', label: 'سعر اللسنة' },
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
  default_warehouse_id: number | null;
  category: string | null;
  consumer_price: string | null;
  piece_name: string | null;
  pieces_per_unit: string | null;
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
        // Points are fractional (v4) and come back as a decimal string, e.g. "0.167".
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
          // Fractional point values (v4): e.g. 6 pieces = 1 point -> 0.167.
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
        <Table size="small" rowKey="id" dataSource={inStock} pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
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
  const { options: categoryOptions } = useLookup('item_category');
  const kindLabels = labelMap(kindOptions);
  const categoryLabels = labelMap(categoryOptions);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [view, setView] = useState<'grouped' | 'table'>('grouped');
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const { user } = useAuth();

  // Point editing is permitted for system_admin and after_sales_staff roles only
  const canEditPoints = ['system_admin', 'after_sales_staff'].includes(user?.role || '');
  // Tier-price editing requires catalog.write (system_admin, branch_manager, purchasing_manager).
  const canEditPrices = ['system_admin', 'branch_manager', 'purchasing_manager'].includes(user?.role || '');
  // Item-core edit/deactivate gated to the same roles allowed to create items.
  const canManageItems = ['system_admin', 'purchasing_manager'].includes(user?.role || '');

  // Filtering happens on the server so it covers ALL items, not just the loaded page.
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

  // Live summary of whatever the current filter returned.
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

  const onCreateItem = async (values: any) => {
    try {
      const tiers = Object.entries(values.prices || {})
        .map(([tier, row]: [string, any]) => ({
          tier,
          price: row?.price ?? 0,
          discount_pct: row?.discount_pct ?? 0,
          vat_pct: row?.vat_pct ?? 0,
        }))
        // A tier left blank is a tier the item is not sold at, not a tier priced at zero — sending
        // it as zero would let it be sold for nothing.
        .filter((t) => Number(t.price) > 0);

      const payload = {
        name: values.name,
        kind: values.kind,
        unit_of_measure: values.unit_of_measure,
        category: values.category ?? null,
        default_warehouse_id: values.default_warehouse_id ?? null,
        piece_name: values.piece_name || null,
        pieces_per_unit: values.pieces_per_unit ?? 1,
        description: values.description || null,
        min_stock: values.min_stock ?? null,
        is_serialized: !!values.is_serialized,
        is_perishable: !!values.is_perishable,
        // The consumer price doubles as the reference sale price the rest of the system reads.
        sale_price: values.prices?.consumer?.price ?? null,
      };

      const created = await api.post('/api/v1/items', payload);
      const itemId = created.data?.id;
      if (itemId && tiers.length) {
        await api.put(`/api/v1/items/${itemId}/prices`, { tiers });
      }
      // «مخفي» is a state an item is put into, not one it is born in, so it is a separate edit.
      if (itemId && values.hidden) {
        await api.patch(`/api/v1/items/${itemId}`, { active: false });
      }
      message.success('اتسجّل الصنف');
      setDrawerVisible(false);
      form.resetFields();
      fetchItems();
    } catch (err) {
      console.error(err);
    }
  };



  // Permanent delete. The server refuses when the item has any movement, invoice line or
  // recipe reference, and tells the user to deactivate instead.
  const deleteItem = (record: ItemRecord) => {
    Modal.confirm({
      title: 'حذف الصنف نهائياً',
      content: `سيتم حذف الصنف "${record.name}" نهائياً. لا يمكن الحذف إذا كانت عليه أي حركة أو ظهر في أي فاتورة — عندها استخدم «إلغاء التفعيل».`,
      okText: 'حذف نهائي',
      okButtonProps: { danger: true },
      cancelText: 'إلغاء',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/items/${record.id}?hard=true`);
          message.success('تم حذف الصنف');
          fetchItems();
        } catch (err) {
          console.error(err);
        }
      },
    });
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

  // Client-side category filter over the already-loaded items.
  const filteredItems = items;   // filtering now happens on the server

  // Items grouped by category for the accordion view. Items with no category land in a
  // «بدون فئة» group instead of disappearing.
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

  // «إضافة صنف» from inside a category pre-fills that category.
  const openCreateForCategory = (category?: string) => {
    form.resetFields();
    if (category && category !== '__none__') form.setFieldsValue({ category });
    setDrawerVisible(true);
  };

  // Their columns, in their order, less باركود — the client asked for barcodes out of the system,
  // so its absence here is a decision rather than a column still to be added.
  // `رقم · الفئه · الاسم · الوحدة · عدد القطع ·
  // القطعة · مستهلك` — and then ours after them. Somebody scanning this list for a price reads
  // along a row they already know the shape of; reordering it is the difference between reading
  // and searching. What we have and they don't keeps its place at the end rather than being
  // dropped — تصنيف، سعر الشراء and نقاط المنتج moved into the expanded row, «مخفي» became a tag
  // on the name, and the actions became icons. All eight of theirs stay on screen and the table
  // fits without dragging sideways, which is the only way the price is ever beside the name you
  // looked it up by.
  const columns = [
    {
      title: 'رقم',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      render: (code: string) => <Tag>{code}</Tag>,
    },
    {
      title: 'الفئه',
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
      render: (v: string | null) => (v ? Number(v).toLocaleString('ar-EG') : '-'),
    },
    {
      title: 'القطعة',
      dataIndex: 'piece_name',
      key: 'piece_name',
      width: 80,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'مستهلك',
      key: 'consumer_price',
      width: 105,
      // The tier row is what gets charged; where an item has none, 007's own rule falls the sale
      // back to `sale_price`, so that is the number shown — a blank here would claim the item
      // cannot be sold to a walk-in when it can.
      render: (_: any, r: ItemRecord) => {
        const price = r.consumer_price ?? r.sale_price;
        return price ? `${parseFloat(price).toFixed(2)} ج.م` : '-';
      },
    },
    // ---- ours, kept after theirs ----
    {
      title: 'الرصيد',
      dataIndex: 'on_hand',
      key: 'on_hand',
      width: 90,
      align: 'left' as const,
      // The unit is already its own column two along, so repeating it here only bought width.
      render: (v: string | null) => {
        const n = Number(v || 0);
        return (
          <b style={{ color: n > 0 ? '#3f8600' : n < 0 ? '#cf1322' : '#999' }}>
            {n.toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
          </b>
        );
      },
      sorter: (a: any, b: any) => Number(a.on_hand || 0) - Number(b.on_hand || 0),
    },
    ...(canManageItems ? [{
      title: '',
      key: 'actions',
      width: 80,
      render: (_: any, record: ItemRecord) => (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
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

  // Ours that used to be columns. «نقاط المنتج» in particular belongs here rather than in the
  // grid: it fetched once per visible row, so a page of 200 items fired 200 requests to fill a
  // column most people never read. Expanded, it is fetched for the one row actually opened.
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
        {record.purchase_price ? `${parseFloat(record.purchase_price).toFixed(2)} ج.م` : '—'}
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

  return (
    <div>
      <Card
        title="الأصناف"
        extra={
          user?.role === 'system_admin' || user?.role === 'purchasing_manager' ? (
            <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => openCreateForCategory()}>
              إضافة صنف للكتالوج
            </Button>
          ) : null
        }
      >
        {/* --- Search + filters (server-side, so they cover every item) --- */}
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={7}>
            <Input
              allowClear
              value={search}
              placeholder="بحث بالاسم أو الكود أو الفئة"
              prefix={<SearchOutlined />}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={applySearch}
              onBlur={applySearch}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear style={{ width: '100%' }} placeholder="النوع"
              value={filters.kind}
              onChange={(v) => setFilter('kind', v)}
              options={[
                { value: 'product', label: 'منتج تام' },
                { value: 'raw_material', label: 'مادة خام' },
              ]} />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear style={{ width: '100%' }} placeholder="الفئة"
              value={filters.category}
              onChange={(v) => setFilter('category', v)}
              options={categoryOptions.map((o) => ({ value: o.value, label: o.label }))} />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="المخزن الافتراضي"
              value={filters.warehouse_id}
              onChange={(v) => setFilter('warehouse_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          </Col>
          <Col xs={12} md={5}>
            <Select allowClear style={{ width: '100%' }} placeholder="حالة المخزون"
              value={filters.stock_filter}
              onChange={(v) => setFilter('stock_filter', v)}
              options={[
                { value: 'in_stock', label: 'متوفر' },
                { value: 'out_of_stock', label: 'رصيد صفر' },
                { value: 'negative', label: 'رصيد سالب' },
              ]} />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear style={{ width: '100%' }} placeholder="الحالة"
              value={filters.active}
              onChange={(v) => setFilter('active', v)}
              options={[{ value: true, label: 'نشط' }, { value: false, label: 'معطل' }]} />
          </Col>
          <Col xs={24} md={6}>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>بحث</Button>
              <Button icon={<ClearOutlined />} onClick={resetFilters}>مسح الفلاتر</Button>
            </Space>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="عدد الأصناف الظاهرة" value={summary.count} /></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="أصناف متوفرة" value={summary.inStock} /></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="أصناف برصيد صفر" value={summary.out} /></Card>
          </Col>
        </Row>

        <Segmented
          style={{ marginBottom: 12 }}
          value={view}
          onChange={(v) => setView(v as 'grouped' | 'table')}
          options={[
            { value: 'grouped', label: 'مجمّع بالفئات', icon: <AppstoreOutlined /> },
            { value: 'table', label: 'جدول واحد', icon: <UnorderedListOutlined /> },
          ]}
        />

        {view === 'table' ? (
          <Table
            dataSource={filteredItems}
            columns={columns}
            rowKey="id"
            loading={loading}
            size="middle"
            tableLayout="fixed"
            expandable={{ expandedRowRender: expandedRow }}
            pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
            // The whole row opens the product file.
            onRow={(record) => ({
              onClick: () => navigate(`/catalog/${record.id}`),
              style: { cursor: 'pointer' },
            })}
          />
        ) : grouped.length === 0 ? (
          <Empty description="لا توجد أصناف مطابقة" />
        ) : (
          <Collapse
            defaultActiveKey={grouped.length <= 3 ? grouped.map((g) => g.key) : []}
            items={grouped.map((g) => ({
              key: g.key,
              label: (
                <Space>
                  <strong>{g.label}</strong>
                  <Tag color="blue">{g.rows.length} صنف</Tag>
                  <Tag color={g.onHand > 0 ? 'green' : 'default'}>
                    الرصيد: {g.onHand.toLocaleString('ar-EG', { maximumFractionDigits: 3 })}
                  </Tag>
                </Space>
              ),
              extra: canManageItems ? (
                <Button
                  size="small"
                  type="link"
                  icon={<PlusOutlined />}
                  // Don't let the click toggle the panel open/closed.
                  onClick={(e) => { e.stopPropagation(); openCreateForCategory(g.key); }}
                >
                  إضافة صنف لهذه الفئة
                </Button>
              ) : null,
              children: (
                <Table
                  dataSource={g.rows}
                  columns={columns}
                  rowKey="id"
                  size="small"
                  loading={loading}
                  tableLayout="fixed"
                  expandable={{ expandedRowRender: expandedRow }}
                  pagination={g.rows.length > 10
                    ? { defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }
                    : false}
                  onRow={(record) => ({
                    onClick: () => navigate(`/catalog/${record.id}`),
                    style: { cursor: 'pointer' },
                  })}
                />
              ),
            }))}
          />
        )}
      </Card>

      {/* صنف جديد — laid out field for field against their الأصناف form: the same groups in the
          same order, because someone entering a hundred items a week does it by muscle memory, and
          a reordered form makes every one of them slower. */}
      <Modal footer={null} centered
        title="صنف جديد"
        width={860}
        onCancel={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onCreateItem} requiredMark={false}
          initialValues={{ pieces_per_unit: 1, kind: 'product' }}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="category" label="الفئه">
                <Select allowClear showSearch placeholder="اختر الفئة"
                  options={categoryOptions.map((o) => ({ value: o.value, label: o.label }))}
                  filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="name" label="الاسم"
                rules={[{ required: true, message: 'اكتب اسم الصنف' }]}>
                <Input placeholder="مثال: ماسورة مياه ٣/٤ بوصة" />
              </Form.Item>
            </Col>
          </Row>

          {/* اسم الوحدة · عدد القطع · اسم القطعة — the packing, their triple, in their order. */}
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="unit_of_measure" label="اسم الوحدة"
                rules={[{ required: true, message: 'اختر الوحدة' }]}>
                <Select showSearch placeholder="وحده"
                  options={uomOptions.map((o) => ({ value: o.value, label: o.label }))}
                  filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="pieces_per_unit" label="عدد القطع">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="piece_name" label="اسم القطعة">
                <Input placeholder="قطعه" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="kind" label="تصنيف" rules={[{ required: true }]}>
                <Select options={kindOptions.map((o) => ({ value: o.value, label: o.label }))} />
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
              <Checkbox>يستخدم سيريال نمبر</Checkbox>
            </Form.Item>
          </Space>

          {/* Six tiers down, four columns across, in their order. «السعر الصافي» is computed and
              read-only: it is the price after its own discount and VAT — the number actually quoted
              — and letting it be typed is how it stops agreeing with the three fields beside it. */}
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
                    const net = price * (1 - Number(row.discount_pct || 0) / 100)
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

          <Row gutter={12} style={{ marginTop: 16 }}>
            <Col span={8}>
              <Form.Item name="min_stock" label="حد اعادة الطلب">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="default_warehouse_id" label="المخزن الافتراضي">
                <Select allowClear placeholder="اختياري"
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
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
      </Modal>

    </div>
  );
}

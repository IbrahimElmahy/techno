import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Divider, Empty, Form, InputNumber, Modal, Row, Select, Space, Statistic,
  Table, Tag, message,
} from 'antd';
import {
  PlusOutlined, CheckCircleOutlined, RollbackOutlined, DeleteOutlined,
  ClearOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';
import ListToolbar, { useListFilter } from '../components/ListToolbar';

/**
 * تحويلات المخزون — move stock between locations.
 *
 * The form follows the order the storekeeper thinks in: FROM where, TO where, then the category,
 * then the items. Because the source is known first, the item picker is driven by what that
 * location actually holds (`/stock/by-location`): an item with nothing there is never offered, and
 * each quantity is capped at what is available. The backend refuses an over-transfer regardless —
 * this only stops the user hitting that wall.
 */

interface TransferRecord {
  id: number;
  document_number: string;
  status: 'pending' | 'approved' | 'rejected' | 'reversed';
  route: string;
  approved_by: number | null;
  item_id: number | null;
  quantity: string | null;
  source_location_kind: string | null;
  source_location_id: number | null;
  dest_location_kind: string | null;
  dest_location_id: number | null;
  created_at: string | null;
}

interface StockRow {
  item_id: number;
  code: string | null;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  on_hand: string;
}

interface TransferLine {
  key: string;
  item_id: number;
  name: string;
  category: string | null;
  unit: string | null;
  available: number;
  /** null = «not typed yet», same as on the sale and the purchase: a box that opens at 1 turns
   *  «5» into «15» for anybody who types over it without clearing first. */
  quantity: number | null;
}

const ROUTE_LABELS: Record<string, string> = {
  central_to_branch: 'من مخزن إلى مخزن',
  central_to_rep: 'من مخزن إلى عهدة مندوب',
  rep_to_rep: 'مناقلة بين المناديب',
};

const STATUS_TAGS: Record<string, { color: string; text: string }> = {
  pending: { color: 'warning', text: 'بانتظار الاعتماد' },
  approved: { color: 'success', text: 'تم الاعتماد والشحن' },
  rejected: { color: 'error', text: 'مرفوض' },
  reversed: { color: 'default', text: 'ملغي ومعكوس' },
};

const qty = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

/** Bucket for items that carry no category, so they stay reachable in the category-first flow. */
const NO_CATEGORY = '__none__';

/** Locations are picked from one combined list; the value carries its kind. */
const locValue = (kind: string, id: number) => `${kind}:${id}`;
const parseLoc = (v: string) => {
  const [kind, id] = v.split(':');
  return { kind, id: Number(id) };
};

/** The backend supports three routes; the direction alone determines which one applies. */
const routeFor = (srcKind: string, dstKind: string): string | null => {
  if (srcKind === 'warehouse' && dstKind === 'warehouse') return 'central_to_branch';
  if (srcKind === 'warehouse' && dstKind === 'custody') return 'central_to_rep';
  if (srcKind === 'custody' && dstKind === 'custody') return 'rep_to_rep';
  return null;   // custody → warehouse has no route yet
};

export default function Transfers() {
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const { user } = useAuth();
  const canApprove = ['system_admin', 'branch_manager'].includes(user?.role || '');

  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [custodies, setCustodies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Create page
  const [createVisible, setCreateVisible] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [sourceStock, setSourceStock] = useState<StockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/transfers');
      setTransfers(res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const loadLookups = async () => {
    try {
      const [whRes, custRes] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/custodies'),
      ]);
      setWarehouses(whRes.data);
      setCustodies(custRes.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchTransfers(); loadLookups(); }, []);

  /** Warehouses and custodies in one list, each tagged with its kind. */
  const locationOptions = useMemo(() => ([
    {
      label: 'المخازن',
      options: warehouses.map((w) => ({
        value: locValue('warehouse', w.id), label: w.name || `مخزن #${w.id}`,
      })),
    },
    {
      label: 'عهد المناديب',
      options: custodies.map((c) => ({
        value: locValue('custody', c.id), label: c.name || `عهدة #${c.id}`,
      })),
    },
  ]), [warehouses, custodies]);

  const locationName = (kind: string | null, id: number | null) => {
    if (!kind || id == null) return '-';
    const list = kind === 'warehouse' ? warehouses : custodies;
    const found = list.find((l) => l.id === id);
    return found?.name || (kind === 'warehouse' ? `مخزن #${id}` : `عهدة #${id}`);
  };

  // Declared after `locationName` so a search can match the human location names, not just ids.
  const filter = useListFilter(transfers, {
    search: (t) => [
      t.document_number, t.quantity,
      locationName(t.source_location_kind, t.source_location_id),
      locationName(t.dest_location_kind, t.dest_location_id),
    ],
    filters: {
      status: (t, v) => t.status === v,
      route: (t, v) => t.route === v,
    },
    dateOf: (t) => t.created_at,
  });

  const route = source && dest
    ? routeFor(parseLoc(source).kind, parseLoc(dest).kind) : null;
  const sameLocation = !!source && source === dest;

  /** What the SOURCE holds right now — the only things that can be moved out of it. */
  const loadSourceStock = async (loc: string) => {
    const { kind, id } = parseLoc(loc);
    setStockLoading(true);
    try {
      const res = await api.get('/api/v1/stock/by-location', {
        params: { location_kind: kind, location_id: id, only_available: true },
      });
      setSourceStock(res.data);
    } catch (err) {
      console.error(err);
      setSourceStock([]);
    } finally { setStockLoading(false); }
  };

  const onSourceChange = (v: string) => {
    setSource(v);
    // A different source means different stock — the chosen items no longer apply.
    setLines([]); setActiveCategory(null); setSourceStock([]);
    if (v) loadSourceStock(v);
  };

  /** Categories present in the source's stock. Items with no category are still reachable through
   *  a "بدون فئة" bucket — otherwise stock that exists could never be transferred. */
  const categories = useMemo(() => {
    const set = new Set<string>();
    let hasUncategorised = false;
    sourceStock.forEach((s) => {
      if (s.category) set.add(s.category); else hasUncategorised = true;
    });
    const list = [...set].sort((a, b) => a.localeCompare(b, 'ar'))
      .map((c) => ({ value: c, label: categoryLabels[c] || c }));
    return hasUncategorised ? [...list, { value: NO_CATEGORY, label: 'بدون فئة' }] : list;
  }, [sourceStock, categoryLabels]);

  const addItem = (itemId: number) => {
    const row = sourceStock.find((s) => s.item_id === itemId);
    if (!row) return;
    const available = Number(row.on_hand || 0);
    const existing = lines.find((l) => l.item_id === itemId);
    if (existing) {
      // Bump by one, but never past what the source holds.
      setLines((prev) => prev.map((l) => (l.item_id === itemId
        ? { ...l, quantity: Math.min(l.available, Number(l.quantity || 0) + 1) } : l)));
      return;
    }
    setLines((prev) => [...prev, {
      key: `${itemId}-${prev.length}`, item_id: itemId, name: row.name,
      category: row.category, unit: row.unit_of_measure, available, quantity: null,
    }]);
  };

  const setLineQty = (key: string, value: number | null) => {
    const line = lines.find((l) => l.key === key);
    // Hard clamp: the form can never express more than is available — but it SAYS SO now. Silently
    // rewriting somebody's number is how a transfer of forty is sent as twelve and nobody notices
    // until the receiving store counts.
    if (line && value != null && value > line.available) {
      message.warning(line.available > 0
        ? `«${line.name}»: المتاح ${qty(line.available)} — اتسجّلت ${qty(line.available)}.`
        : `«${line.name}»: مفيش رصيد في المخزن المصدر.`);
    }
    setLines((prev) => prev.map((l) => (l.key === key
      ? { ...l, quantity: value == null ? null : Math.max(0, Math.min(l.available, value)) } : l)));
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const closeCreate = () => {
    setCreateVisible(false);
    setSource(null); setDest(null); setSourceStock([]); setLines([]); setActiveCategory(null);
  };

  const handleSubmit = async () => {
    if (!source || !dest) { message.warning('اختر المصدر والوجهة أولاً'); return; }
    if (sameLocation) { message.error('لا يمكن التحويل إلى نفس الموقع'); return; }
    if (!route) {
      message.error('التحويل من عهدة مندوب إلى مخزن غير متاح حالياً — استخدم تسليم العهدة');
      return;
    }
    const valid = lines.filter((l) => Number(l.quantity || 0) > 0);
    if (!valid.length) { message.warning('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر'); return; }
    const over = valid.find((l) => Number(l.quantity || 0) > l.available);
    if (over) { message.error(`«${over.name}»: الكمية تتجاوز المتاح (${qty(over.available)})`); return; }

    const src = parseLoc(source);
    const dst = parseLoc(dest);
    setSubmitting(true);
    // One transfer document per item (each is approved on its own), so report per line.
    const failed: string[] = [];
    let ok = 0;
    for (const l of valid) {
      try {
        await api.post('/api/v1/transfers', {
          item_id: l.item_id, quantity: Number(l.quantity || 0), route,
          source: { location_kind: src.kind, location_id: src.id },
          dest: { location_kind: dst.kind, location_id: dst.id },
        });
        ok += 1;
      } catch (err) {
        console.error(err);
        failed.push(l.name);
      }
    }
    setSubmitting(false);
    if (ok) message.success(`تم تسجيل ${ok} طلب تحويل بنجاح`);
    if (failed.length) message.error(`تعذّر تحويل: ${failed.join('، ')}`);
    if (ok && !failed.length) closeCreate();
    fetchTransfers();
  };

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/api/v1/transfers/${id}/approve`);
      message.success('تمت الموافقة واعتماد التحويل بنجاح');
      fetchTransfers();
    } catch (err) { console.error(err); }
  };

  const handleReverse = (record: TransferRecord) => {
    showReversalConfirm({
      title: 'عكس عملية التحويل المخزني',
      content: `هل أنت متأكد من إلغاء وعكس مستند التحويل "${record.document_number}"؟ سيتم توليد حركة مخزنية عكسية لإرجاع الكميات لمصدرها.`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/transfers/${record.id}/reverse`);
          message.success('تم عكس وإلغاء التحويل بنجاح');
          fetchTransfers();
        } catch (err) { console.error(err); }
      },
    });
  };

  const totalUnits = lines.reduce((s, l) => s + (l.quantity || 0), 0);

  // ---------------------------------------------------------------- create page
  if (createVisible) {
    const stockOfCategory = sourceStock.filter((s) => (
      activeCategory === NO_CATEGORY ? !s.category : s.category === activeCategory));
    return (
      <div>
        <Card title={(
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={closeCreate}>رجوع</Button>
            <span>طلب تحويل مخزني جديد</span>
          </Space>
        )}>
          {/* 1) من أين وإلى أين */}
          <Divider orientation="right" style={{ fontWeight: 700 }}>١) التحويل من أين إلى أين</Divider>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>من (المصدر)</div>
              <Select showSearch size="large" style={{ width: '100%' }}
                placeholder="اختر المخزن أو العهدة المصدر"
                optionFilterProp="label"
                value={source ?? undefined} onChange={onSourceChange}
                options={locationOptions} />
            </Col>
            <Col xs={24} md={12}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>إلى (الوجهة)</div>
              <Select showSearch size="large" style={{ width: '100%' }}
                placeholder="اختر المخزن أو العهدة الوجهة"
                optionFilterProp="label"
                value={dest ?? undefined} onChange={(v) => setDest(v)}
                options={locationOptions} />
            </Col>
          </Row>

          {source && dest && sameLocation && (
            <Alert style={{ marginTop: 12 }} type="error" showIcon
              message="المصدر والوجهة نفس الموقع — اختر وجهة مختلفة" />
          )}
          {source && dest && !sameLocation && !route && (
            <Alert style={{ marginTop: 12 }} type="warning" showIcon
              message="التحويل من عهدة مندوب إلى مخزن غير متاح من هذه الشاشة"
              description="استخدم شاشة تسليم عهدة المندوب لإرجاع البضاعة إلى المخزن." />
          )}
          {route && !sameLocation && (
            <Alert style={{ marginTop: 12 }} type="success" showIcon
              message={`نوع التحويل: ${ROUTE_LABELS[route]}`} />
          )}

          {/* 2) الفئة ثم 3) الأصناف */}
          <Divider orientation="right" style={{ fontWeight: 700 }}>٢) الفئة والأصناف</Divider>
          {!source ? (
            <Empty description="اختر المصدر أولاً لعرض الأصناف المتاحة فيه" style={{ margin: '12px 0' }} />
          ) : stockLoading ? (
            <Empty description="جارٍ تحميل أرصدة المصدر..." style={{ margin: '12px 0' }} />
          ) : sourceStock.length === 0 ? (
            <Alert type="info" showIcon message="لا توجد أي أصناف برصيد متاح في هذا الموقع" />
          ) : (
            <Row gutter={12}>
              <Col xs={24} md={7}>
                <Select showSearch size="large" style={{ width: '100%' }}
                  placeholder="اختر الفئة" value={activeCategory ?? undefined}
                  optionFilterProp="label"
                  onChange={(v) => setActiveCategory(v ?? null)}
                  options={categories} />
              </Col>
              <Col xs={24} md={17}>
                <Select showSearch size="large" style={{ width: '100%' }} value={null}
                  disabled={!activeCategory}
                  placeholder={activeCategory ? 'اختر صنفاً لإضافته (المتاح فقط)' : 'اختر الفئة أولاً'}
                  optionFilterProp="label"
                  onChange={(v) => { if (v) addItem(v as number); }}
                  options={stockOfCategory.map((s) => ({
                    value: s.item_id,
                    label: `${s.name} — المتاح: ${qty(s.on_hand)}`,
                  }))} />
              </Col>
            </Row>
          )}

          {/* Lines */}
          {lines.length > 0 && (
            <Table
              style={{ marginTop: 16 }} size="small" rowKey="key" pagination={false}
              dataSource={lines}
              columns={[
                { title: 'الصنف', dataIndex: 'name', render: (n: string) => <b>{n}</b> },
                { title: 'الفئة', dataIndex: 'category',
                  render: (c: string | null) => (c ? <Tag>{categoryLabels[c] || c}</Tag> : '-') },
                { title: 'المتاح في المصدر', dataIndex: 'available',
                  render: (v: number, r: TransferLine) => (
                    <span style={{ color: '#6AB42D', fontWeight: 600 }}>
                      {qty(v)} {r.unit || ''}
                    </span>
                  ) },
                { title: 'الكمية المحوّلة', dataIndex: 'quantity',
                  render: (v: number, r: TransferLine) => (
                    <InputNumber size="small" min={0} max={r.available} step={1} value={v}
                      style={{ width: 120 }}
                      onChange={(val) => setLineQty(r.key, Number(val))} />
                  ) },
                { title: 'المتبقي بعد التحويل',
                  render: (_: any, r: TransferLine) => qty(r.available - Number(r.quantity || 0)) },
                { title: '', width: 50,
                  render: (_: any, r: TransferLine) => (
                    <Button type="text" size="small" danger icon={<DeleteOutlined />}
                      onClick={() => removeLine(r.key)} />
                  ) },
              ]}
            />
          )}

          <div style={{
            marginTop: 16, padding: 16, borderRadius: 10,
            background: '#f6faf3', border: '1px solid #e6efe3',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            flexWrap: 'wrap',
          }}>
            <Space size={32} wrap>
              <span>
                <span style={{ color: '#8a8a8a', fontSize: 12 }}>عدد الأصناف: </span>
                <b>{lines.length}</b>
              </span>
              <span>
                <span style={{ color: '#8a8a8a', fontSize: 12 }}>إجمالي الكميات: </span>
                <b style={{ color: '#6AB42D', fontSize: 18 }}>{qty(totalUnits)}</b>
              </span>
              {source && dest && route && !sameLocation && (
                <span style={{ fontSize: 13 }}>
                  {locationName(parseLoc(source).kind, parseLoc(source).id)}
                  {' ← '}
                  {locationName(parseLoc(dest).kind, parseLoc(dest).id)}
                </span>
              )}
            </Space>
            <Space>
              <Button type="primary" size="large" loading={submitting}
                disabled={!route || sameLocation || lines.length === 0}
                onClick={handleSubmit}>
                إرسال طلب التحويل
              </Button>
              <Button size="large" onClick={closeCreate}>إلغاء</Button>
            </Space>
          </div>
        </Card>
      </div>
    );
  }

  // ---------------------------------------------------------------------- list
  const summary = {
    total: transfers.length,
    pending: transfers.filter((t) => t.status === 'pending').length,
    approved: transfers.filter((t) => t.status === 'approved').length,
  };

  const columns = [
    { title: 'رقم المستند', dataIndex: 'document_number', key: 'document_number',
      render: (doc: string) => <Tag color="blue">{doc}</Tag> },
    { title: 'الصنف', dataIndex: 'item_id', key: 'item_id',
      render: (id: number | null) => (id ? `صنف #${id}` : '-') },
    { title: 'الكمية', dataIndex: 'quantity', key: 'quantity',
      render: (q: string | null) => <b>{qty(q)}</b> },
    { title: 'من', key: 'src',
      render: (_: any, r: TransferRecord) => locationName(r.source_location_kind, r.source_location_id) },
    { title: 'إلى', key: 'dst',
      render: (_: any, r: TransferRecord) => locationName(r.dest_location_kind, r.dest_location_id) },
    { title: 'نوع المناقلة', dataIndex: 'route', key: 'route',
      render: (r: string) => ROUTE_LABELS[r] || r },
    { title: 'الحالة', dataIndex: 'status', key: 'status',
      render: (s: string) => {
        const tag = STATUS_TAGS[s] || { color: 'default', text: s };
        return <Tag color={tag.color}>{tag.text}</Tag>;
      } },
    { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at',
      render: (v: string | null) => (v ? String(v).slice(0, 10) : '-') },
    {
      title: 'الإجراءات', key: 'actions',
      render: (_: any, record: TransferRecord) => (
        <Space size="middle">
          {record.status === 'pending' && canApprove && (
            <Button type="primary" size="small" icon={<CheckCircleOutlined />}
              onClick={() => handleApprove(record.id)}>
              اعتماد
            </Button>
          )}
          {record.status === 'approved' && canApprove && (
            <Button type="primary" danger size="small" icon={<RollbackOutlined />}
              onClick={() => handleReverse(record)}>
              عكس
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="إدارة تحويلات ومناقلات المخزون"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>
            طلب تحويل مخزني
          </Button>
        }
      >
        <ListToolbar
          searchPlaceholder="بحث برقم المستند أو الموقع"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          showDateRange range={filter.range} onRangeChange={filter.setRange}
          onReset={filter.reset}
          total={transfers.length} shown={filter.filtered.length}
          filters={[
            { key: 'status', placeholder: 'الحالة',
              options: Object.entries(STATUS_TAGS).map(([k, v]) => ({ value: k, label: v.text })) },
            { key: 'route', placeholder: 'نوع المناقلة',
              options: Object.entries(ROUTE_LABELS).map(([k, v]) => ({ value: k, label: v })) },
          ]}
        />

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="إجمالي المستندات" value={summary.total} /></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="بانتظار الاعتماد" value={summary.pending}
                valueStyle={{ color: summary.pending ? '#F5A11D' : undefined }} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="معتمدة" value={summary.approved} valueStyle={{ color: '#6AB42D' }} />
            </Card>
          </Col>
        </Row>

        <Table
          dataSource={filter.filtered} columns={columns} rowKey="id" loading={loading}
          pagination={{ defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
        />
      </Card>
    </div>
  );
}

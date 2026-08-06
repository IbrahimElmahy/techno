import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, InputNumber, Modal,
  Popconfirm, Row, Select, Space, Statistic,
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
import ProductPickerModal from '../components/ProductPickerModal';
import DocumentToolbar, { ToolbarAction } from '../components/DocumentToolbar';
import { SaveOutlined, FileAddOutlined, UndoOutlined } from '@ant-design/icons';

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
  // (031) الأصناف اللي على الإذن. A document written before lines existed has none and still shows
  // its own item/quantity, which is why this is optional rather than assumed.
  lines?: { id: number; item_id: number; quantity: string }[];
  reject_reason?: string | null;
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
  // The sale opens as a run of doors. A transfer's «who» is two places rather than one party, so
  // it asks them one at a time in the order the goods actually move: out of here, into there.
  const [newStep, setNewStep] = useState<null | 'source' | 'dest'>(null);
  // The product window, so a line is added by typing rather than by hunting a grid.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
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
    const key = `${itemId}-${lines.length}`;
    setLines((prev) => [...prev, {
      key, item_id: itemId, name: row.name,
      category: row.category, unit: row.unit_of_measure, available, quantity: null,
    }]);
    setFocusLineKey(key);
  };

  // Keep asking until the caret lands in the new line's quantity. One attempt lands in whatever
  // the browser is doing that frame, so it is retried and CHECKED — the same loop the sale, the
  // return and the purchase use.
  useEffect(() => {
    if (!focusLineKey || pickerOpen) return undefined;
    let frames = 0;
    let raf = 0;
    const tryFocus = () => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-qty-key="${focusLineKey}"]`);
      if (el && document.activeElement === el) { setFocusLineKey(null); return; }
      el?.focus(); el?.select();
      if (++frames < 40) raf = requestAnimationFrame(tryFocus);
      else setFocusLineKey(null);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [focusLineKey, pickerOpen, lines]);

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

  /** One way in, whichever button was pressed — the list's «جديد» and the toolbar's F2. */
  const startNew = () => {
    setSource(null); setDest(null); setLines([]); setCreateVisible(false); setNewStep('source');
  };

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

  /**
   * إذن التحويل المفتوح للمراجعة — ودي الشاشة اللي «اعتماد» بيوصّل لها.
   *
   * Approving used to be a button on a row: one click, stock moved, and the approver never saw
   * what he was approving. A transfer is a request from somebody to somebody, and the person who
   * answers it has to be able to read it first — and to change it, because «اعتمد أو سيبه» is not
   * how a request that is nearly right gets handled.
   */
  const [reviewing, setReviewing] = useState<TransferRecord | null>(null);
  /**
   * أسماء الأصناف.
   *
   * This screen has never shown one — its list prints «صنف #35», which is a number nobody in the
   * warehouse knows. The review sheet cannot ask somebody to approve moving «صنف #35», so the
   * catalogue is loaded once here and both the sheet and the list read it.
   */
  const [itemNames, setItemNames] = useState<Record<number, string>>({});
  useEffect(() => {
    api.get('/api/v1/items')
      .then((r) => setItemNames(Object.fromEntries(
        (r.data || []).map((i: any) => [i.id, i.name]))))
      .catch(() => setItemNames({}));
  }, []);
  const nameOfItem = (id: number | null | undefined) =>
    (id ? itemNames[id] || `صنف #${id}` : '-');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  /** Re-read the document after every decision, so the sheet always shows the server's answer
   *  rather than what this screen believes it did. */
  const refreshReviewed = async (id: number) => {
    try {
      const res = await api.get('/api/v1/transfers');
      const rows = res.data || [];
      setTransfers(rows);
      setReviewing(rows.find((t: TransferRecord) => t.id === id) ?? null);
    } catch (err) { console.error(err); }
  };

  const setReviewLineQty = async (lineId: number, quantity: number | null) => {
    if (!quantity || quantity <= 0) return;
    try {
      await api.patch(`/api/v1/transfers/lines/${lineId}`, { quantity: String(quantity) });
      if (reviewing) await refreshReviewed(reviewing.id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تعديل الكمية');
    }
  };

  const removeReviewLine = async (lineId: number) => {
    try {
      await api.delete(`/api/v1/transfers/lines/${lineId}`);
      if (reviewing) await refreshReviewed(reviewing.id);
      message.success('اتشال الصنف من الإذن');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حذف الصنف');
    }
  };

  const rejectTransfer = async () => {
    if (!reviewing) return;
    try {
      await api.post(`/api/v1/transfers/${reviewing.id}/reject`,
        { reason: rejectReason || null });
      message.success('اترفض الإذن — مافيش بضاعة اتحركت');
      setRejectOpen(false); setRejectReason(''); setReviewing(null);
      fetchTransfers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر رفض الإذن');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/api/v1/transfers/${id}/approve`);
      message.success('تمت الموافقة واعتماد التحويل بنجاح');
      setReviewing(null);
      fetchTransfers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر اعتماد الإذن');
    }
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
  /** The two doors and the product window. A transfer's «who» is two places, so it asks them one
   *  at a time in the order the goods move: out of here, into there — and only then what. */
  const doors = (
    <>
      <ProductPickerModal
        open={pickerOpen}
        title="اختر الصنف المحوَّل"
        categories={categories.map((c) => c.value)}
        categoryLabels={categoryLabels}
        products={sourceStock.map((r) => ({
          id: r.item_id, name: r.name, category: r.category })) as any}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        onCancel={() => setPickerOpen(false)}
        onPick={(id: number) => { setPickerOpen(false); addItem(id); }} />

      <Modal
        open={newStep === 'source'}
        title="التحويل من فين؟"
        okText="التالي" cancelText="إلغاء"
        onCancel={() => setNewStep(null)}
        onOk={() => { if (source) setNewStep('dest'); }}
        okButtonProps={{ disabled: !source }}
        destroyOnHidden
      >
        <Select showSearch size="large" style={{ width: '100%' }} autoFocus
          placeholder="اختر المخزن أو العهدة المصدر" optionFilterProp="label"
          value={source ?? undefined}
          onChange={(v) => { onSourceChange(v); }}
          options={locationOptions} />
        <div style={{ marginTop: 10, color: '#8a8a8a', fontSize: 13 }}>
          البضاعة بتطلع من هنا — والرصيد المتاح بيتحمّل على أساسه.
        </div>
      </Modal>

      <Modal
        open={newStep === 'dest'}
        title="التحويل لفين؟"
        okText="ابدأ" cancelText="رجوع"
        onCancel={() => setNewStep('source')}
        onOk={() => { if (dest) { setNewStep(null); setCreateVisible(true); } }}
        okButtonProps={{ disabled: !dest }}
        destroyOnHidden
      >
        <Select showSearch size="large" style={{ width: '100%' }} autoFocus
          placeholder="اختر المخزن أو العهدة الوجهة" optionFilterProp="label"
          value={dest ?? undefined} onChange={(v) => setDest(v)}
          options={locationOptions.filter((o: any) => o.value !== source)} />
        <div style={{ marginTop: 10, color: '#8a8a8a', fontSize: 13 }}>
          المصدر مستبعد من القايمة — تحويل لنفس المكان مش تحويل.
        </div>
      </Modal>
    </>
  );

  /** The same strip the sale, the return and the purchase carry — same verbs, same places, and
   *  the keys it advertises are bound by the toolbar itself. */
  const transferToolbar = (): ToolbarAction[] => [
    { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />,
      onClick: startNew },
    { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
      onClick: handleSubmit, disabled: !source || !dest || lines.length === 0 },
    { key: 'undo', label: 'تراجع', icon: <UndoOutlined />,
      onClick: () => setLines([]), disabled: lines.length === 0 },
    { key: 'close', label: 'إغلاق', shortcut: 'Esc', icon: <ArrowLeftOutlined />,
      onClick: closeCreate },
  ];

  if (createVisible) {
    const stockOfCategory = sourceStock.filter((s) => (
      activeCategory === NO_CATEGORY ? !s.category : s.category === activeCategory));
    return (
      <div>
        {doors}
        <DocumentToolbar actions={transferToolbar()} />
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
                      data-qty-key={r.key}
                      data-grid-col="qty" keyboard={false}
                      // Enter means «this line is done» — the window opens for the next item,
                      // exactly as on the sale, the return and the purchase.
                      onPressEnter={(e) => { e.preventDefault(); setPickerOpen(true); }}
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
      render: (id: number | null) => nameOfItem(id) },
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
              onClick={() => setReviewing(record)}>
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

  /**
   * ورقة المراجعة — الإذن نفسه، وكل قرار عليه.
   *
   * Deliberately NOT a confirm dialog. «هل أنت متأكد؟» over a document nobody has read is a
   * question with no information in it; this shows what is being moved, from where to where, and
   * lets the approver fix a quantity or drop an item before he answers.
   *
   * There is no delete button. The request is somebody's ask and somebody may have to answer for
   * it — the way to say «مش هيتم» is to reject it, which leaves the reason on the document.
   */
  const reviewSheet = (
    <Modal
      open={!!reviewing}
      onCancel={() => setReviewing(null)}
      width={760}
      destroyOnHidden
      title={reviewing ? `إذن تحويل ${reviewing.document_number}` : ''}
      footer={reviewing && reviewing.status === 'pending' ? [
        <Button key="close" onClick={() => setReviewing(null)}>إغلاق</Button>,
        <Button key="reject" danger onClick={() => setRejectOpen(true)}>رفض</Button>,
        <Button key="ok" type="primary" icon={<CheckCircleOutlined />}
          disabled={(reviewing.lines?.length ?? 0) === 0 && !reviewing.item_id}
          onClick={() => handleApprove(reviewing.id)}>اعتماد</Button>,
      ] : [<Button key="close" onClick={() => setReviewing(null)}>إغلاق</Button>]}
    >
      {reviewing && (
        <>
          <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="من">
              {locationName(reviewing.source_location_kind, reviewing.source_location_id)}
            </Descriptions.Item>
            <Descriptions.Item label="إلى">
              {locationName(reviewing.dest_location_kind, reviewing.dest_location_id)}
            </Descriptions.Item>
            <Descriptions.Item label="نوع المناقلة">
              {ROUTE_LABELS[reviewing.route] || reviewing.route}
            </Descriptions.Item>
            <Descriptions.Item label="الحالة">
              <Tag color={(STATUS_TAGS[reviewing.status] || {}).color}>
                {(STATUS_TAGS[reviewing.status] || {}).text || reviewing.status}
              </Tag>
            </Descriptions.Item>
            {reviewing.reject_reason && (
              <Descriptions.Item label="سبب الرفض" span={2}>
                {reviewing.reject_reason}
              </Descriptions.Item>
            )}
          </Descriptions>

          {reviewing.status !== 'pending' && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message="الإذن ده اتقفل خلاص"
              description="الإذن اللي اتعمد أو اترفض مايتعدلش — الاعتماد رحّل حركات على مخزنين، وتعديل الكمية بعدها بيسيب الأرصدة بتوصف مستند مابقاش بيقول اللي حصل." />
          )}

          <Table
            size="small" rowKey="id" pagination={false}
            dataSource={reviewing.lines ?? []}
            locale={{ emptyText: reviewing.item_id
              ? 'إذن قديم — الصنف مكتوب على المستند نفسه'
              : 'مفيش أصناف على الإذن — ارفضه بدل ما تعتمده' }}
            columns={[
              { title: 'الصنف', dataIndex: 'item_id',
                // The item's own name, from the catalogue the picker already loaded.
                render: (id: number) => nameOfItem(id) },
              { title: 'الكمية', dataIndex: 'quantity', width: 150,
                render: (q: string, r: any) => (reviewing.status === 'pending' ? (
                  <InputNumber size="small" min={0.001} step={1} defaultValue={Number(q)}
                    style={{ width: 120 }} data-grid-col="qty" keyboard={false}
                    onBlur={(e) => setReviewLineQty(r.id, Number((e.target as any).value))} />
                ) : <b>{qty(q)}</b>) },
              ...(reviewing.status === 'pending' ? [{
                title: '', width: 60,
                render: (_: any, r: any) => (
                  <Popconfirm title="تشيل الصنف ده من الإذن؟"
                    okText="شيله" cancelText="سيبه"
                    onConfirm={() => removeReviewLine(r.id)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                ),
              }] : []),
            ]}
          />
        </>
      )}
    </Modal>
  );

  const rejectDialog = (
    <Modal
      open={rejectOpen}
      title="رفض إذن التحويل"
      okText="ارفض" cancelText="تراجع"
      okButtonProps={{ danger: true }}
      onCancel={() => { setRejectOpen(false); setRejectReason(''); }}
      onOk={rejectTransfer}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="مافيش بضاعة هتتحرك"
        description="الرفض مش زي «اعتمد وبعدين اعكس» — مافيش حاجة نزلت من الرف عشان ترجع تاني." />
      <Input.TextArea rows={3} value={rejectReason} autoFocus
        placeholder="سبب الرفض — أول سؤال هيسأله اللي طلب التحويل"
        onChange={(e: any) => setRejectReason(e.target.value)} />
    </Modal>
  );

  return (
    <div>
      {reviewSheet}
      {rejectDialog}
      {/* The doors belong to BOTH branches. The create page is an early return, so a door declared
          only there unmounts at the instant it opens the page behind it — which is how the return
          ended up with a dialog on screen that no state could close. */}
      {doors}
      <Card
        title="إدارة تحويلات ومناقلات المخزون"
        extra={
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
            onClick={startNew}>
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

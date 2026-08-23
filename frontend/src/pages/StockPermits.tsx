import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Form, Input, Row, Segmented, Select, Space, Table, Tabs, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { advanceFrom } from '../components/lineKeyboard';
import { Popconfirm } from '../components/noConfirm';
import {
  DeleteOutlined, PlusOutlined, ReloadOutlined, RollbackOutlined, ArrowLeftOutlined,
  EditOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useQueryTab } from '../components/useQueryTab';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import ProductPickerModal from '../components/ProductPickerModal';
import { useLookup, labelMap } from '../hooks/useLookup';
import { guardQuantity } from '../components/quantityGuard';
import { TabModal } from '../components/TabModal';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';

/**
 * إذن إضافة / إذن صرف — stock in and out for reasons that are not a trade.
 *
 * Recording a count adjustment or a workshop return as an invoice would put movements that were
 * never traded into the sales figures. A permit is the honest document for them.
 *
 * A receipt asks for the cost (only the person adding the stock knows what it was worth); an
 * issue does not, because stock going out is worth what it cost us, not what someone types.
 */

type Kind = 'receipt' | 'issue' | 'opening';

/** «بضاعة أول المدة» behaves like a receipt — same direction, same typed cost — and is labelled
 *  separately so «إمتى بدأنا؟» stays answerable and a stock-as-of-date report for a day before
 *  go-live does not show goods the system was not yet keeping. */
const KIND_LABEL: Record<Kind, string> = {
  receipt: 'إضافة', issue: 'صرف', opening: 'أول المدة',
};
const KIND_COLOR: Record<Kind, string> = {
  receipt: 'green', issue: 'red', opening: 'blue',
};

interface PermitLine {
  id: number; item_id: number; item_name: string | null;
  quantity: string; unit_cost: string; line_cost: string;
}

interface Permit {
  id: number; document_number: string; kind: Kind;
  warehouse_id: number; warehouse_name: string | null;
  permit_date: string | null; reason: string | null; notes: string | null;
  total_cost: string; is_reversal: boolean; reversed_by: number | null;
  created_at: string | null; lines: PermitLine[];
}

interface DraftLine { key: number; item_id?: number; quantity?: number; unit_cost?: number }

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function StockPermits() {
  const [permits, setPermits] = useState<Permit[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * الإذن المفتوح — نفس صفحة الإنشاء بالظبط.
   *
   * A permit used to have two surfaces: a modal to write one and a drawer to look at one. So the
   * screen that CREATED the document and the screen that SHOWED it were different shapes, and
   * «افتحه وشوف» landed somewhere that looked nothing like where it was typed.
   *
   * One page now, filled or empty. A posted permit is read-only on it and says why — the
   * movements are already on the shelf, and a permit is create-or-reverse by design (there is no
   * edit endpoint, deliberately: editing one would leave stock describing a document that no
   * longer says what happened).
   */
  const [detail, setDetail] = useState<Permit | null>(null);

  const [creating, setCreating] = useState(false);
  // «أول المدة» is a screen of its own in their menu. Here it is one of three permit kinds, so
  // that entry opens this screen with the kind already chosen rather than on إذن إضافة.
  const [kind, setKind] = useQueryTab('receipt', 'kind') as unknown as [Kind, (k: Kind) => void];
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [permitDate, setPermitDate] = useState<Dayjs>(dayjs());
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  // The doors. «إيه نوع الإذن» is already answered by the tab that opened this, so the one thing
  // left to ask before the lines is which store — and an issue cannot even list its items until
  // that is known.
  const [newStep, setNewStep] = useState<null | 'warehouse'>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusLineKey, setFocusLineKey] = useState<number | null>(null);
  /** Enter بينقل للسطر اللي بعده، وآخر سطر بيفتح شباك الأصناف —
   *  انظر `lineKeyboard`. كان بيفتح الشباك على طول، فاللي عنده سطور مكتوبة
   *  كان لازم يرجع للماوس عشان يوصل لأي سطر منهم. */
  const advance = advanceFrom(lines, setFocusLineKey, () => setPickerOpen(true));

  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [available, setAvailable] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/stock/permits');
      setPermits(res.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    Promise.all([api.get('/api/v1/items'), api.get('/api/v1/warehouses')])
      .then(([i, w]) => { setItems(i.data || []); setWarehouses(w.data || []); })
      .catch(console.error);
  }, []);

  // An issue may only offer what the store actually holds — the API refuses the rest anyway,
  // but a picker that offers stock you do not have is a trap, not a feature.
  useEffect(() => {
    if (kind !== 'issue' || !warehouseId) { setAvailable({}); return; }
    api.get('/api/v1/stock/by-location', { params: {
      location_kind: 'warehouse', location_id: warehouseId, only_available: true } })
      .then((r) => {
        const map: Record<number, number> = {};
        (r.data || []).forEach((row: any) => { map[row.item_id] = Number(row.on_hand); });
        setAvailable(map);
      })
      .catch(console.error);
  }, [kind, warehouseId]);

  // «أول المدة» is their own screen, so the entry must show أذون أول المدة — not the whole permits
  // list with the right kind waiting inside a modal nobody has opened yet.
  const filter = useListFilter(permits, {
    initialValues: kind === 'opening' ? { kind: 'opening' } : {},
    search: (p) => [p.document_number, p.reason, p.warehouse_name],
    filters: { kind: (p, v) => p.kind === v },
    dateOf: (p) => p.created_at,
  });

  const resetDraft = () => {
    setLines([]); setReason(''); setNotes('');
    setPermitDate(dayjs()); setWarehouseId(undefined);
  };

  /** One way in, from the list button or from F2 — the store first, then the lines. */
  const startNew = () => { resetDraft(); setDetail(null); setCreating(false); setNewStep('warehouse'); };

  /** Open a posted permit on the same page it would have been written on. */
  const openPermit = (p: Permit) => { setCreating(false); setDetail(p); };

  /** Leave the document, whichever kind it was. */
  const closeDoc = () => { setCreating(false); setDetail(null); resetDraft(); };

  /** An item picked in the window becomes a line, and the caret goes to its quantity. */
  const addItem = (itemId: number) => {
    setPickerOpen(false);
    const key = (lines[lines.length - 1]?.key ?? 0) + 1;
    setLines((prev) => [...prev, { key, item_id: itemId }]);
    setFocusLineKey(key);
  };

  // Keep asking until the caret lands, and CHECK — one attempt lands in whatever the browser is
  // doing that frame. Same loop as the sale, the return, the purchase and the transfer.
  useEffect(() => {
    if (focusLineKey === null || pickerOpen) return undefined;
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

  const submit = async () => {
    if (!warehouseId) { message.warning('اختر المخزن'); return; }
    const payload = lines
      .filter((l) => l.item_id && Number(l.quantity) > 0)
      .map((l) => ({
        item_id: l.item_id, quantity: String(l.quantity),
        ...(kind !== 'issue' && l.unit_cost !== undefined
          ? { unit_cost: String(l.unit_cost) } : {}),
      }));
    if (!payload.length) { message.warning('أضف سطراً واحداً على الأقل'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/stock/permits', {
        kind, warehouse_id: warehouseId, lines: payload,
        reason: reason || null, notes: notes || null,
        permit_date: permitDate.format('YYYY-MM-DD'),
      });
      message.success(kind === 'issue' ? 'اتسجّل إذن الصرف'
        : kind === 'opening' ? 'اتسجّلت بضاعة أول المدة' : 'اتسجّل إذن الإضافة');
      setCreating(false); resetDraft(); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ الإذن');
    } finally { setSaving(false); }
  };

  /**
   * تعديل إذن مترحّل — يتعكس، ويتفتح تاني بمحتواه للتصحيح.
   *
   * A posted permit cannot be altered in place: it moved goods, and rewriting a quantity would
   * leave the shelf describing a document that no longer says what happened. So «تعديل» means what
   * it means on a posted invoice — reverse it in full, and reopen the form on exactly what it
   * held. Both papers stay in the record: the original, its reversal, and the corrected one.
   *
   * No confirmation: pressing تعديل IS the answer. What protects the record is that the reversal
   * is a posting with its own document — the original, its reversal and the correction all stay.
   */
  const editPosted = async (p: Permit) => {
    try {
      await api.post(`/api/v1/stock/permits/${p.id}/reverse`);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر عكس الإذن');
      return;
    }
    message.success('اتعكس الإذن — عدّل ورحّل من جديد');
    // Refill from what it actually held, so the correction starts from the document rather than
    // from a blank form somebody has to retype.
    setKind(p.kind);
    setWarehouseId(p.warehouse_id);
    setPermitDate(p.permit_date ? dayjs(p.permit_date) : dayjs());
    setReason(p.reason || '');
    setNotes(p.notes || '');
    setLines(p.lines.map((l, i) => ({
      key: i + 1,
      item_id: l.item_id,
      quantity: Number(l.quantity),
      ...(p.kind !== 'issue' ? { unit_cost: Number(l.unit_cost) } : {}),
    })));
    setDetail(null);
    setCreating(true);
    load();
  };

  const reverse = async (p: Permit) => {
    try {
      await api.post(`/api/v1/stock/permits/${p.id}/reverse`);
      message.success('اتعكس الإذن');
      closeDoc(); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر عكس الإذن');
    }
  };

  const draftTotal = lines.reduce(
    (sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);

  /** Items this permit may name. An issue can only send out what is actually in the store, so its
   *  window shows that store's stock; a receipt is bringing goods in and may name anything. */
  const pickable = (kind === 'issue' && warehouseId
    ? items.filter((i) => available[i.id] > 0) : items)
    .filter((i) => !lines.some((l) => l.item_id === i.id));

  const categories = [...new Set(pickable.map((i) => i.category).filter(Boolean))] as string[];

  const doors = (
    <>
      <ProductPickerModal
        open={pickerOpen}
        title={kind === 'issue' ? 'اختر الصنف المصروف' : 'اختر الصنف المضاف'}
        categories={categories}
        categoryLabels={categoryLabels}
        products={pickable}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        availableFor={(id: number) => (kind === 'issue' ? available[id] ?? null : null)}
        onCancel={() => setPickerOpen(false)}
        onPick={addItem} />

      <TabModal
        open={newStep === 'warehouse'}
        title={kind === 'issue' ? 'الصرف من أي مخزن؟' : 'الإضافة لأي مخزن؟'}
        okText="التالي" cancelText="إلغاء"
        onCancel={() => setNewStep(null)}
        onOk={() => { if (warehouseId) { setNewStep(null); setCreating(true); } }}
        okButtonProps={{ disabled: !warehouseId }}
        destroyOnHidden
      >
        <Select showSearch size="large" style={{ width: '100%' }} autoFocus
          optionFilterProp="label" placeholder="اختر المخزن"
          value={warehouseId} onChange={setWarehouseId}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
        <div style={{ marginTop: 10, color: '#6b6b6b', fontSize: 13 }}>
          {kind === 'issue'
            ? 'الأصناف اللي هتظهر بعد كده هي المتاح في المخزن ده بس.'
            : 'البضاعة هتدخل على المخزن ده.'}
        </div>
      </TabModal>
    </>
  );

  const createForm = (
    <>
      <Segmented
        block value={kind} onChange={(v) => { setKind(v as Kind); setLines([]); }}
        style={{ marginBottom: 12 }}
        options={[
          { value: 'receipt', label: 'إذن إضافة (دخول للمخزن)' },
          { value: 'issue', label: 'إذن صرف (خروج من المخزن)' },
          { value: 'opening', label: 'بضاعة أول المدة' },
        ]}
      />

      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Select
            style={{ width: '100%' }} placeholder="المخزن" value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </Col>
        <Col xs={24} md={8}>
          <DatePicker style={{ width: '100%' }} value={permitDate}
            onChange={(v) => v && setPermitDate(v)} placeholder="تاريخ الإذن" />
        </Col>
        <Col xs={24} md={8}>
          <Input placeholder="السبب (جرد، مرتجع ورشة، عينة…)" value={reason}
            onChange={(e) => setReason(e.target.value)} />
        </Col>
      </Row>

      <Table<DraftLine>
        size="small" rowKey="key" dataSource={lines} pagination={false}
        style={{ marginBottom: 12 }}
        columns={[
          // Picked in the window, not hunted in a dropdown — the line already knows its item by
          // the time it exists, so there is no half-written row to read past.
          { title: 'الصنف', dataIndex: 'item_id', width: '40%',
            render: (v: any) => {
              const it = items.find((i) => i.id === v);
              return (
                <span>
                  {it?.name ?? `صنف #${v}`}
                  {kind === 'issue' && available[v] !== undefined && (
                    <span style={{ color: '#6b6b6b' }}>{` — متاح ${qty(available[v])}`}</span>
                  )}
                </span>
              );
            } },
          { title: 'الكمية', dataIndex: 'quantity', width: 140,
            render: (v, r) => (
              <InputNumber
                style={{ width: '100%' }} value={v}
                data-qty-key={r.key} data-grid-col="qty" keyboard={false}
                // An issue takes goods OUT, so it is capped by what the store holds; a receipt
                // brings them in and has no ceiling. Both refuse zero and negatives.
                onBlur={() => setLines((prev) => prev.map((l) => (l.key === r.key
                  ? { ...l, quantity: guardQuantity({
                      value: l.quantity,
                      available: kind === 'issue' && l.item_id ? available[l.item_id] : undefined,
                      itemName: items.find((i) => i.id === l.item_id)?.name,
                    }, null) as number }
                  : l)))}
                onPressEnter={(e) => {
                  e.preventDefault();
                  const line = lines.find((l) => l.key === r.key);
                  const kept = guardQuantity({
                    value: line?.quantity,
                    available: kind === 'issue' && r.item_id ? available[r.item_id] : undefined,
                    itemName: items.find((i) => i.id === r.item_id)?.name,
                  }, null);
                  setLines((prev) => prev.map((l) => (l.key === r.key
                    ? { ...l, quantity: kept as number } : l)));
                  advance(r.key)
                }}
                onChange={(q) => setLines((prev) => prev.map((l) => (l.key === r.key
                  ? { ...l, quantity: q as number } : l)))}
              />
            ) },
          ...(kind !== 'issue' ? [{
            title: 'تكلفة الوحدة', dataIndex: 'unit_cost', width: 160,
            render: (v: any, r: DraftLine) => (
              <InputNumber
                min={0} style={{ width: '100%' }} value={v} placeholder="من التكلفة الحالية"
                data-grid-col="cost" keyboard={false}
                onChange={(c) => setLines((prev) => prev.map((l) => (l.key === r.key
                  ? { ...l, unit_cost: c as number } : l)))}
              />
            ) }] : []),
          // The last line may go now: a permit starts with NO lines and gets them from the
          // window, so «one must remain» would be protecting a row nothing put there.
          { title: '', width: 50,
            render: (_: any, r: DraftLine) => (
              <Button type="text" danger icon={<DeleteOutlined />}
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== r.key))} />
            ) },
        ]}
        footer={() => (
          <Space>
            <Button icon={<PlusOutlined />} size="small" onClick={() => setPickerOpen(true)}>
              إضافة صنف
            </Button>
            {kind !== 'issue' && (
              <span>إجمالي التكلفة: <b>{money(draftTotal)}</b></span>
            )}
          </Space>
        )}
      />

      <Input.TextArea rows={2} placeholder="ملاحظات" value={notes}
        onChange={(e) => setNotes(e.target.value)} />

      <Alert
        type="info" showIcon style={{ marginTop: 12 }}
        message={kind === 'issue'
          ? 'الصرف من المتاح فقط — ممنوع أي رصيد سالب.'
          : 'لو سِبت التكلفة فاضية هتتاخد من تكلفة الصنف الحالية.'}
      />

      <div style={{
        marginTop: 16, padding: 16, borderRadius: 10,
        background: '#f6faf3', border: '1px solid #e6efe3',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        flexWrap: 'wrap',
      }}>
        <Space size={32} wrap>
          <span>
            <span style={{ color: '#6b6b6b', fontSize: 12 }}>عدد الأصناف: </span>
            <b>{lines.length}</b>
          </span>
          {kind !== 'issue' && (
            <span>
              <span style={{ color: '#6b6b6b', fontSize: 12 }}>إجمالي التكلفة: </span>
              <b style={{ color: '#6AB42D', fontSize: 18 }}>{money(draftTotal)}</b>
            </span>
          )}
        </Space>
        <Space>
          <Button type="primary" size="large" loading={saving} onClick={submit}
            disabled={!warehouseId || lines.length === 0}>
            ترحيل الإذن
          </Button>
          <Button size="large" onClick={closeDoc}>إلغاء</Button>
        </Space>
      </div>
    </>
  );

  /**
   * الإذن بعد الترحيل — نفس الصفحة، بس مقفولة.
   *
   * There is no edit endpoint for a permit and that is deliberate: posting it moved goods, and
   * changing a quantity afterwards would leave the shelf describing a document that no longer
   * says what happened. The way to undo one is to reverse it, which writes the opposite movements
   * and leaves both papers behind.
   */
  const postedDoc = detail && (
    <>
      <Alert
        type={detail.reversed_by ? 'warning' : 'info'} showIcon style={{ marginBottom: 12 }}
        message={detail.reversed_by ? 'الإذن ده اتعكس' : 'الإذن ده اتّرحّل خلاص'}
        description={detail.reversed_by
          ? 'اتعمله إذن عكسي رجّع المخزون زي ما كان — الاتنين موجودين في القايمة.'
          : 'البضاعة اتحركت على المخزن فعلاً، فالإذن مايتغيّرش في مكانه. «تعديل الإذن» بيعكسه ويفتحه تاني بمحتواه عشان تصحّح وترحّل من جديد — والتلاتة بيفضلوا في السجل.'}
      />
      <Descriptions column={2} size="small" bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="النوع">
          <Tag color={KIND_COLOR[detail.kind]}>{KIND_LABEL[detail.kind] || detail.kind}</Tag>
          {detail.is_reversal && <Tag color="orange">عكسي</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="المخزن">{detail.warehouse_name}</Descriptions.Item>
        <Descriptions.Item label="التاريخ">
          {(detail.permit_date || detail.created_at || '').slice(0, 10)}
        </Descriptions.Item>
        <Descriptions.Item label="إجمالي التكلفة">
          <b>{money(detail.total_cost)}</b>
        </Descriptions.Item>
        <Descriptions.Item label="السبب" span={2}>{detail.reason || '-'}</Descriptions.Item>
        <Descriptions.Item label="ملاحظات" span={2}>{detail.notes || '-'}</Descriptions.Item>
      </Descriptions>
      <Table<PermitLine>
        rowKey="id" size="small" dataSource={detail.lines} pagination={false}
        columns={[
          { title: 'الصنف', dataIndex: 'item_name' },
          { title: 'الكمية', dataIndex: 'quantity', render: (v: string) => qty(v) },
          { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', render: (v: string) => money(v) },
          { title: 'الإجمالي', dataIndex: 'line_cost',
            render: (v: string) => <b>{money(v)}</b> },
        ]}
      />

      <div style={{
        marginTop: 16, padding: 16, borderRadius: 10,
        background: '#f6faf3', border: '1px solid #e6efe3',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        flexWrap: 'wrap',
      }}>
        <Space size={32} wrap>
          <span>
            <span style={{ color: '#6b6b6b', fontSize: 12 }}>عدد الأصناف: </span>
            <b>{detail.lines.length}</b>
          </span>
          <span>
            <span style={{ color: '#6b6b6b', fontSize: 12 }}>إجمالي التكلفة: </span>
            <b style={{ color: '#6AB42D', fontSize: 18 }}>{money(detail.total_cost)}</b>
          </span>
        </Space>
        <Space>
          {!detail.is_reversal && !detail.reversed_by && (
            <>
              <Button type="primary" size="large" icon={<EditOutlined />}
                onClick={() => editPosted(detail)}>
                تعديل الإذن
              </Button>
              <Popconfirm title="عكس الإذن؟" description="هيترجّع المخزون زي ما كان."
                onConfirm={() => reverse(detail)} okText="عكس" cancelText="إلغاء">
                <Button danger size="large" icon={<RollbackOutlined />}>عكس الإذن</Button>
              </Popconfirm>
            </>
          )}
          <Button size="large" onClick={closeDoc}>إغلاق</Button>
        </Space>
      </div>
    </>
  );

  const columns: ColumnsType<Permit> = [
    { title: 'رقم الإذن', dataIndex: 'document_number',
      render: (v: string) => <Tag>{v}</Tag> },
    { title: 'النوع', dataIndex: 'kind',
      render: (k: Kind, r) => (
        <>
          <Tag color={KIND_COLOR[k]}>{KIND_LABEL[k] || k}</Tag>
          {r.is_reversal && <Tag color="orange">عكسي</Tag>}
          {r.reversed_by && <Tag color="default">اتعكس</Tag>}
        </>
      ) },
    { title: 'التاريخ', dataIndex: 'permit_date',
      render: (d: string, r) => (d || r.created_at || '').slice(0, 10) },
    { title: 'المخزن', dataIndex: 'warehouse_name' },
    { title: 'عدد الأصناف', dataIndex: 'lines',
      render: (l: PermitLine[]) => l.length },
    { title: 'السبب', dataIndex: 'reason', render: (v: string) => v || '-' },
    { title: 'التكلفة', dataIndex: 'total_cost', align: 'left',
      render: (v: string) => <b>{money(v)}</b> },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('stock-permits', columns);

  // The document page — the SAME page whether it is being written or being read. This is the
  // whole point: «افتح الإذن» lands where «اعمل إذن» lands, so nothing has to be relearned to
  // look at what you typed yesterday.
  if (creating || detail) {
    return (
      <div>
        {doors}
        <Card title={(
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={closeDoc}>رجوع</Button>
            <span>{detail
              ? `${KIND_LABEL[detail.kind] || detail.kind} — ${detail.document_number}`
              : kind === 'issue' ? 'إذن صرف مخزني'
                : kind === 'opening' ? 'بضاعة أول المدة' : 'إذن إضافة مخزني'}</span>
            {detail?.reversed_by && <Tag color="default">اتعكس</Tag>}
          </Space>
        )}>
          {detail ? postedDoc : createForm}
        </Card>
      </div>
    );
  }


  return (
    <Card
      title="أذونات المخزن"
      extra={(
        <Space>
          {tableCols.control}
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
            onClick={() => { setKind('receipt'); startNew(); }}>إذن إضافة</Button>
          <Button icon={<PlusOutlined />}
            onClick={() => { setKind('issue'); startNew(); }}>إذن صرف</Button>
          <Button icon={<PlusOutlined />}
            onClick={() => { setKind('opening'); setCreating(true); }}>بضاعة أول المدة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      {doors}

      <ListToolbar
        searchPlaceholder="بحث برقم الإذن أو السبب"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        showDateRange range={filter.range} onRangeChange={filter.setRange}
        onReset={filter.reset} total={permits.length} shown={filter.filtered.length}
        filters={[{ key: 'kind', placeholder: 'نوع الإذن', options: [
          { value: 'receipt', label: 'إذن إضافة' },
          { value: 'issue', label: 'إذن صرف' },
          { value: 'opening', label: 'بضاعة أول المدة' },
        ] }]}
      />

      <Table<Permit>
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        onRow={(r) => ({ onClick: () => openPermit(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد أذونات' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={tableCols.columns}
      />

    </Card>
  );
}

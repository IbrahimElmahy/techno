import React, { useEffect, useMemo, useRef, useState } from 'react';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { money, qty, numeralsLocale } from '../utils/money';
import DocumentBar from '../components/DocumentBar';
import DraftTag from '../components/DraftTag';
import { PAGE_SIZE } from '../utils/pagination';
import {
  Alert, Button, Col, DatePicker, Form, Input, Modal, Row, Segmented, Select, Space, Tabs, Tag,
  Tooltip, message,
} from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import { advanceFrom } from '../components/lineKeyboard';
import { Popconfirm } from '../components/noConfirm';
import {
  DeleteOutlined, PlusOutlined, ReloadOutlined, RollbackOutlined, ArrowRightOutlined,
  EditOutlined, PrinterOutlined, CheckOutlined, FileTextOutlined, SearchOutlined, ClearOutlined,
  ArrowLeftOutlined, EyeOutlined, FileAddOutlined, SaveOutlined, UndoOutlined,
} from '@ant-design/icons';
import DocumentToolbar, { type ToolbarAction } from '../components/DocumentToolbar';
import DocumentHistoryButton from '../components/DocumentHistory';
import LoadPeriodModal from '../components/LoadPeriodModal';
import QuickAddRow from '../components/QuickAddRow';
import { printPermit } from '../print/permitSheet';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useDocRoute } from '../components/useDocRoute';
import DocOpening from '../components/DocOpening';
import { useDraft } from '../components/useDraft';
import { useQueryTab } from '../components/useQueryTab';
import { useListFilter } from '../components/ListToolbar';
import ListPage, { type ListTab } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useScreenShortcuts } from '../components/keyboard';
import { matchesStatement } from '../utils/statements';
import ProductPickerModal from '../components/ProductPickerModal';
import { addPickedSequentially, type PickResult } from '../utils/pickMany';
import { useLookup, labelMap } from '../hooks/useLookup';
import { guardQuantity } from '../components/quantityGuard';
import { TabModal } from '../components/TabModal';
import WarehouseGate from '../components/WarehouseGate';
import DocumentAttachments from '../components/DocumentAttachments';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import { useLiveRefresh } from '../utils/live';
import SummaryTile from '../components/saleDoc/SummaryTile';
import './docs.extra.css';
import { activeOptions } from '../utils/active';

type Kind = 'receipt' | 'issue' | 'opening';
type KindTab = Kind | 'all';

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
  statement1?: string | null; external_document_number?: string | null;
  total_cost: string; is_reversal: boolean; reversed_by: number | null;
  created_at: string | null; lines: PermitLine[];
}

interface DraftLine { key: number; item_id?: number; quantity?: number; unit_cost?: number }


export default function StockPermits() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [permits, setPermits] = useState<Permit[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Permit | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [periodRows, setPeriodRows] = useState<Permit[] | null>(null);
  const [loadRangeOpen, setLoadRangeOpen] = useState(false);

  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useQueryTab('receipt', 'kind') as unknown as [Kind, (k: Kind) => void];
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [permitDate, setPermitDate] = useState<Dayjs>(dayjs());
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [statement1, setStatement1] = useState('');
  const [externalDocNumber, setExternalDocNumber] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [newStep, setNewStep] = useState<null | 'warehouse'>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusLineKey, setFocusLineKey] = useState<number | null>(null);
  const keySeq = useRef(0);
  const advance = advanceFrom(lines, setFocusLineKey, () => setPickerOpen(true));

  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [available, setAvailable] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/api/v1/stock/permits');
      setPermits(res.data || []);
    } catch (err) { console.error(err); } finally { if (!silent) setLoading(false); }
  };
  useLiveRefresh(['stock'], () => load({ silent: true }));

  useEffect(() => {
    load();
    Promise.all([api.get('/api/v1/items'), api.get('/api/v1/warehouses')])
      .then(([i, w]) => { setItems(i.data || []); setWarehouses(w.data || []); })
      .catch(console.error);
  }, []);

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

  const filter = useListFilter(permits, {
    initialValues: kind === 'opening' ? { kind: 'opening' } : {},
    search: (p) => [p.document_number, p.reason, p.warehouse_name, p.statement1,
      p.external_document_number, p.notes],
    filters: {
      kind: (p, v) => p.kind === v,
      statement: (p, v) => matchesStatement(p, v),
    },
    dateOf: (p) => p.permit_date || p.created_at,
  });

  const draftPayload = useMemo(() => ({
    kind, warehouseId, lines, reason, notes,
    statement1, external_document_number: externalDocNumber,
    permit_date: permitDate ? dayjs(permitDate).format('YYYY-MM-DD') : null,
  }), [kind, warehouseId, lines, reason, notes, statement1, externalDocNumber, permitDate]);

  const {
    drafts, savedAt: draftSavedAt, discard: discardDraft,
    remove: removeDraft, adopt: adoptDraft,
  } = useDraft({
    kind: 'stock_permit',
    payload: draftPayload,
    paused: Boolean(detail),
    isEmpty: (x: any) => !x.warehouseId
      && !(x.lines || []).some((l: any) => l.item_id != null),
    title: (x: any) => {
      const n = (x.lines || []).filter((l: any) => l.item_id != null).length;
      const label = x.kind === 'issue' ? 'إذن صرف'
        : x.kind === 'opening' ? 'أول المدة' : 'إذن إضافة';
      return `${label} — ${n} صنف`;
    },
  });

  const resumeDraft = (d: any) => {
    const x = d.payload || {};
    adoptDraft(d.id);
    setDetail(null);
    setNewStep(null);
    if (x.kind) setKind(x.kind);
    setWarehouseId(x.warehouseId ?? undefined);
    setLines(x.lines || []);
    setReason(x.reason || '');
    setNotes(x.notes || '');
    setStatement1(x.statement1 || '');
    setExternalDocNumber(x.external_document_number || '');
    if (x.permit_date) setPermitDate(dayjs(x.permit_date));
    setCreating(true);
  };

  const resetDraft = () => {
    setEditingId(null);
    setLines([]); setReason(''); setNotes('');
    setStatement1(''); setExternalDocNumber('');
    setPermitDate(dayjs()); setWarehouseId(undefined);
  };

  const startNew = () => { resetDraft(); setDetail(null); setCreating(false); setNewStep('warehouse'); };

  const openPermit = (p: Permit) => { setCreating(false); setDetail(p); markOpen(p.id); };

  const { markOpen, markClosed, opening: docOpening } = useDocRoute<Permit>({
    rows: permits,
    openId: detail?.id ?? null,
    open: (x) => openPermit(x),
    close: () => closeDoc(),
    loading,
    fetchOne: async (id) => {
      try {
        return (await api.get(`/api/v1/stock/permits/${id}`)).data as Permit;
      } catch {
        message.warning(`الإذن رقم ${id} غير موجود`);
        return null;
      }
    },
  });

  const closeDoc = () => {
    setCreating(false); setDetail(null); resetDraft(); markClosed();
  };

  const addItem = (itemId: number, qty: number | null = null): PickResult => {
    const key = Math.max(lines[lines.length - 1]?.key ?? 0, keySeq.current) + 1;
    keySeq.current = key;
    const quantity = qty ? guardQuantity({
      value: qty,
      available: kind === 'issue' ? available[itemId] : undefined,
      itemName: items.find((i) => i.id === itemId)?.name,
    }, null) : null;
    setLines((prev) => [...prev, { key, item_id: itemId, ...(quantity ? { quantity } : {}) }]);
    return quantity ? null : { needsQty: key };
  };

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
      const body = {
        kind, warehouse_id: warehouseId, lines: payload,
        reason: reason || null, notes: notes || null,
        statement1: statement1 || null,
        external_document_number: externalDocNumber || null,
        permit_date: permitDate.format('YYYY-MM-DD'),
      };
      if (editingId) {
        await api.put(`/api/v1/stock/permits/${editingId}`, body);
        message.success('تم تعديل الإذن');
      } else {
        await api.post('/api/v1/stock/permits', body);
        message.success(kind === 'issue' ? 'تم تسجيل إذن الصرف'
          : kind === 'opening' ? 'تم تسجيل بضاعة أول المدة' : 'تم تسجيل إذن الإضافة');
      }
      discardDraft();
      setCreating(false); resetDraft(); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ الإذن');
    } finally { setSaving(false); }
  };

  const editPosted = (p: Permit) => {
    setEditingId(p.id);
    setKind(p.kind);
    setWarehouseId(p.warehouse_id);
    setPermitDate(p.permit_date ? dayjs(p.permit_date) : dayjs());
    setReason(p.reason || '');
    setNotes(p.notes || '');
    setStatement1(p.statement1 || '');
    setExternalDocNumber(p.external_document_number || '');
    setLines(p.lines.map((l, i) => ({
      key: i + 1,
      item_id: l.item_id,
      quantity: Number(l.quantity),
      ...(p.kind !== 'issue' ? { unit_cost: Number(l.unit_cost) } : {}),
    })));
    setDetail(null);
    setCreating(true);
  };

  const deletePermit = (p: Permit) => {
    Modal.confirm({
      title: 'حذف الإذن',
      content: `هل أنت متأكد من حذف الإذن ${p.document_number}؟ ستُزال حركته من المخزن.`,
      okText: 'نعم، احذف', okType: 'danger', cancelText: 'تراجع',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/stock/permits/${p.id}`);
          message.success('تم حذف الإذن');
          setPeriodRows((rows) => (rows ? rows.filter((r) => r.id !== p.id) : rows));
          if (detail?.id === p.id) closeDoc();
          load();
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message || 'تعذر حذف الإذن');
        }
      },
    });
  };

  const navRows = (periodRows ?? permits) as Permit[];
  const neighbour = (step: number): Permit | null => {
    if (!detail) return null;
    const at = navRows.findIndex((r) => r.id === detail.id);
    return at < 0 ? null : navRows[at + step] ?? null;
  };

  const reverse = async (p: Permit) => {
    try {
      await api.post(`/api/v1/stock/permits/${p.id}/reverse`);
      message.success('تم عكس الإذن');
      closeDoc(); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر عكس الإذن');
    }
  };

  const draftTotal = lines.reduce(
    (sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);

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
        onPick={(id, q) => {
          setPickerOpen(false);
          addPickedSequentially([id], q ? { [id]: q } : undefined, addItem, setFocusLineKey);
        }}
        onPickMany={(ids, qtys) => {
          setPickerOpen(false);
          addPickedSequentially(ids, qtys, addItem, setFocusLineKey);
        }} />

      <WarehouseGate
        open={newStep === 'warehouse' && !detail}
        title={kind === 'issue' ? 'الصرف من أي مخزن؟' : (kind === 'opening' ? 'بضاعة أول المدة في أي مخزن؟' : 'الإضافة إلى أي مخزن؟')}
        subtitle=""
        value={warehouseId}
        onChange={setWarehouseId}
        warehouses={warehouses}
        cancelText="إلغاء"
        onCancel={() => setNewStep(null)}
        onOk={() => { if (warehouseId) { setNewStep(null); setCreating(true); } }}
      />
    </>
  );

  const createForm = (
    <div className="sale-form">
      <div className="sale-card sale-fields">
      <Segmented
        block value={kind} onChange={(v) => { setKind(v as Kind); setLines([]); }}
        disabled={!!editingId}
        style={{ marginBottom: 10 }}
        options={[
          { value: 'receipt', label: 'إذن إضافة (دخول للمخزن)' },
          { value: 'issue', label: 'إذن صرف (خروج من المخزن)' },
          { value: 'opening', label: 'بضاعة أول المدة' },
        ]}
      />

      <Form layout="vertical" size="small" className="doc-form" component={false}>
      <Row gutter={12}>
        <Col xs={12} md={4}>
          <Form.Item label="رقم المستند">
            <Input placeholder="رقم الإذن الورقي" value={externalDocNumber}
              onChange={(e) => setExternalDocNumber(e.target.value)} />
          </Form.Item>
        </Col>
        <Col xs={12} md={4}>
          <Form.Item label="التاريخ">
            <DatePicker style={{ width: '100%' }} value={permitDate}
              onChange={(v) => v && setPermitDate(v)} placeholder="تاريخ الإذن" />
          </Form.Item>
        </Col>
        <Col xs={24} md={6} className="sale-party">
          <Form.Item label="المخزن">
            <Select showSearch
              style={{ width: '100%' }} placeholder="المخزن" value={warehouseId}
              onChange={setWarehouseId}
              options={activeOptions(sortByName(warehouses, (w) => w.name), warehouseId)} filterOption={searchFilter} filterSort={searchRank} />
          </Form.Item>
        </Col>
        <Col xs={24} md={5}>
          <Form.Item label="السبب">
            <Input placeholder="جرد، مرتجع ورشة، عينة…" value={reason}
              onChange={(e) => setReason(e.target.value)} />
          </Form.Item>
        </Col>
        <Col xs={24} md={5}>
          <Form.Item label="البيان">
            <Input placeholder="اختياري" value={statement1} maxLength={200}
              onChange={(e) => setStatement1(e.target.value)} />
          </Form.Item>
        </Col>
      </Row>
      </Form>
      </div>

      <div className="sale-card sale-lines">
        <div className="sale-items-bar">
          <div className="sale-items-info">
            <span>
              عدد البنود الحالية: <b style={{ color: '#0f172a' }}>{lines.length}</b> أصناف
            </span>
          </div>
          <Button type="primary" className="sale-green-btn" icon={<PlusOutlined />}
            style={{ fontWeight: 700 }} onClick={() => setPickerOpen(true)}>
            إضافة صنف
          </Button>
        </div>
      <div className="sale-grid-wrap">
      <Table<DraftLine> autoFilters={false}
        className="sale-grid"
        size="small" rowKey="key" dataSource={lines} pagination={false}
        columns={[
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
          { title: '', width: 50,
            render: (_: any, r: DraftLine) => (
              <Button type="text" danger icon={<DeleteOutlined />}
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== r.key))} />
            ) },
        ]}
      />
      </div>
      <QuickAddRow asDiv colSpan={1} items={pickable}
        warehouses={warehouses} warehouseId={warehouseId ?? null}
        onWarehouseChange={(w) => setWarehouseId(w)}
        availableFor={kind === 'issue' && warehouseId ? ((id) => available[id] ?? 0) : undefined}
        onOpenPicker={() => setPickerOpen(true)}
        onPick={(id) => addPickedSequentially([id], undefined, addItem, setFocusLineKey)} />
      </div>

      <div className="sale-card sale-notes">
        <Input.TextArea rows={2} placeholder="ملاحظات" value={notes}
          onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="sale-bottom">
        <Row gutter={[10, 10]}>
          <Col xs={24} lg={16}>
            <div className="sale-tiles">
              <SummaryTile label="عدد الأصناف" value={lines.length} />
              {kind !== 'issue' && (
                <SummaryTile label="إجمالي التكلفة" value={money(draftTotal)} color="#16a34a" />
              )}
            </div>
          </Col>
          <Col xs={24} lg={8}>
            <div className="sale-card sale-pay">
              <div className="sale-pay-actions">
                <Button type="primary" loading={saving} onClick={submit}
                  icon={<CheckOutlined />} className="sale-green-btn sale-save-btn"
                  disabled={!warehouseId || lines.length === 0}>
                  ترحيل الإذن
                </Button>
                <Button onClick={closeDoc}>إلغاء</Button>
              </div>
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );

  const postedDoc = detail && (
    <div className="sale-form">
      <Alert
        type={detail.reversed_by ? 'warning' : 'info'} showIcon
        message={detail.reversed_by ? 'تم عكس هذا الإذن' : 'هذا الإذن مُرحَّل'}
        description={detail.reversed_by
          ? 'أُنشئ له إذن عكسي أعاد المخزون إلى ما كان عليه.'
          : undefined}
      />
      <div className="sale-card sale-fields">
      <Form layout="vertical" size="small" component={false}>
        <Row gutter={12}>
          <Col xs={12} md={4}>
            <Form.Item label="النوع">
              <div style={{ minHeight: 28, display: 'flex', alignItems: 'center' }}>
                <Tag color={KIND_COLOR[detail.kind]}>{KIND_LABEL[detail.kind] || detail.kind}</Tag>
                {detail.is_reversal && <Tag color="orange">عكسي</Tag>}
              </div>
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item label="رقم المستند">
              <Input readOnly value={detail.external_document_number || '-'} />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item label="التاريخ">
              <Input readOnly dir="ltr"
                value={(detail.permit_date || detail.created_at || '').slice(0, 10)} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6} className="sale-party">
            <Form.Item label="المخزن">
              <Input readOnly value={detail.warehouse_name || ''} />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item label="السبب">
              <Input readOnly value={detail.reason || '-'} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="البيان">
              <Input readOnly value={detail.statement1 || '-'} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ملاحظات">
              <Input readOnly value={detail.notes || '-'} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      </div>

      <div className="sale-card sale-lines">
        <div className="sale-items-bar">
          <div className="sale-items-info">
            <span>
              عدد البنود: <b style={{ color: '#0f172a' }}>{detail.lines.length}</b> أصناف
            </span>
          </div>
        </div>
        <div className="sale-grid-wrap">
          <Table<PermitLine>
            className="sale-grid"
            rowKey="id" size="small" dataSource={detail.lines} pagination={false}
            columns={[
              { title: 'الصنف', dataIndex: 'item_name' },
              { title: 'الكمية', dataIndex: 'quantity', render: (v: string) => qty(v) },
              { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', render: (v: string) => money(v) },
              { title: 'الإجمالي', dataIndex: 'line_cost',
                render: (v: string) => <b>{money(v)}</b> },
            ]}
          />
        </div>
      </div>

      <div className="sale-card sale-notes">
        <div className="sale-attach">
          <DocumentAttachments docType="stock_permit" docId={detail.id} title="مرفقات" />
        </div>
      </div>

      <div className="sale-bottom">
        <Row gutter={[10, 10]}>
          <Col xs={24} lg={16}>
            <div className="sale-tiles">
              <SummaryTile label="عدد الأصناف" value={detail.lines.length} />
              <SummaryTile label="إجمالي التكلفة" value={money(detail.total_cost)}
                color="#16a34a" />
            </div>
          </Col>
          <Col xs={24} lg={8}>
            <div className="sale-card sale-pay">
              <div className="sale-pay-actions is-wrap">
                {!detail.is_reversal && !detail.reversed_by && (
                  <>
                    <Button type="primary" icon={<EditOutlined />}
                      className="sale-green-btn sale-save-btn"
                      onClick={() => editPosted(detail)}>
                      تعديل الإذن
                    </Button>
                    <Popconfirm title="عكس الإذن؟" description="سيعود المخزون إلى ما كان عليه."
                      onConfirm={() => reverse(detail)} okText="عكس" cancelText="إلغاء">
                      <Button icon={<RollbackOutlined />}>عكس الإذن</Button>
                    </Popconfirm>
                  </>
                )}
                <Button danger icon={<DeleteOutlined />} onClick={() => deletePermit(detail)}>حذف</Button>
                <Button icon={<PrinterOutlined />}
                  onClick={() => printPermit(detail)}>طباعة</Button>
                <Button onClick={closeDoc}>إغلاق</Button>
              </div>
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );

  const locked = !!detail && (detail.is_reversal || !!detail.reversed_by);
  const permitToolbar = (): ToolbarAction[] => [
    { key: 'new', label: 'جديد', shortcut: 'F2', icon: <FileAddOutlined />, primary: true,
      onClick: () => startNew() },
    { key: 'edit', label: 'تعديل', icon: <EditOutlined />,
      disabled: !detail || locked, onClick: () => detail && editPosted(detail) },
    { key: 'undo', label: 'تراجع', icon: <UndoOutlined />,
      disabled: !creating || lines.length === 0, onClick: () => setLines([]) },
    { key: 'save', label: 'حفظ', shortcut: 'F9', icon: <SaveOutlined />,
      disabled: !creating || !warehouseId || lines.length === 0 || saving, onClick: submit },
    { key: 'prev', label: 'السابق', icon: <ArrowRightOutlined />,
      disabled: !detail ? navRows.length === 0 || creating : !neighbour(1),
      onClick: () => {
        const n = detail ? neighbour(1) : navRows[0];
        if (n) openPermit(n);
      } },
    { key: 'next', label: 'التالي', icon: <ArrowLeftOutlined />,
      disabled: !neighbour(-1), onClick: () => { const n = neighbour(-1); if (n) openPermit(n); } },
    { key: 'delete', label: 'حذف', shortcut: 'F8', icon: <DeleteOutlined />, danger: true,
      disabled: !detail, onClick: () => detail && deletePermit(detail) },
    { key: 'print', label: 'طباعة', shortcut: 'F7', icon: <PrinterOutlined />,
      disabled: !detail, onClick: () => detail && printPermit(detail) },
    { key: 'reload', label: 'تحميل', icon: <ReloadOutlined />,
      onClick: () => setLoadRangeOpen(true) },
  ];

  const columns: ColumnsType<Permit> = [
    { title: 'رقم الإذن', dataIndex: 'document_number',
      render: (v: string, r: any) => (r.__isDraft
        ? <DraftTag onDelete={() => removeDraft(r.__draft.id)} />
        : <Tag>{v}</Tag>) },
    { title: 'النوع', dataIndex: 'kind',
      render: (k: Kind, r) => (
        <>
          <Tag color={KIND_COLOR[k]}>{KIND_LABEL[k] || k}</Tag>
          {r.is_reversal && <Tag color="orange">عكسي</Tag>}
          {r.reversed_by && <Tag color="default">معكوس</Tag>}
        </>
      ) },
    { title: 'التاريخ', dataIndex: 'permit_date',
      render: (d: string, r) => (d || r.created_at || '').slice(0, 10) },
    { title: 'المخزن', dataIndex: 'warehouse_name' },
    { title: 'عدد الأصناف', dataIndex: 'lines',
      render: (l?: PermitLine[]) => (l ? l.length : 0) },
    { title: 'السبب', dataIndex: 'reason', render: (v: string) => v || '-' },
    { title: 'البيان', dataIndex: 'statement1', ellipsis: true,
      render: (v: string | null) => v || '-' },
    { title: 'رقم المستند الورقي', dataIndex: 'external_document_number', ellipsis: true,
      render: (v: string | null | undefined) => v || '-' },
    { title: 'التكلفة', dataIndex: 'total_cost', align: 'left',
      render: (v: string) => <b>{money(v)}</b> },
    { title: 'الإجراءات', key: 'actions', width: 130, align: 'center',
      render: (_: unknown, r: any) => (r.__isDraft ? null : (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="عرض">
            <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openPermit(r)} />
          </Tooltip>
          <Tooltip title={r.is_reversal || r.reversed_by ? 'لا يمكن تعديل إذن معكوس' : 'تعديل'}>
            <Button type="text" size="small" icon={<EditOutlined />}
              disabled={r.is_reversal || !!r.reversed_by} onClick={() => editPosted(r)} />
          </Tooltip>
          <Tooltip title="حذف">
            <Button type="text" size="small" danger icon={<DeleteOutlined />}
              onClick={() => deletePermit(r)} />
          </Tooltip>
        </Space>
      )) },
  ];

  const tableCols = useTableColumns('stock-permits', columns, {
    export: { name: 'أذونات المخزن', rows: filter.filtered },
  });

  const kindVal = filter.values.kind;
  const activeKindTab: KindTab = Array.isArray(kindVal)
    ? (kindVal.length === 1 ? kindVal[0] : 'all')
    : (kindVal || 'all');
  const kindCount = (k: Kind) => permits.filter((p) => p.kind === k).length;
  const kindTabs: ListTab<KindTab>[] = [
    { key: 'all', label: 'الكل', count: permits.length },
    { key: 'receipt', label: 'إذن إضافة', dot: '#52c41a', count: kindCount('receipt') },
    { key: 'issue', label: 'إذن صرف', dot: '#f5222d', count: kindCount('issue') },
    { key: 'opening', label: 'بضاعة أول المدة', dot: '#1677ff', count: kindCount('opening') },
  ];
  const listSearchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => listSearchRef.current?.focus?.() }, !(creating || detail));

  const screen = (creating || detail) ? (
      <div className="sale-doc">
        <div className="sale-card sale-head">
          <div className="sale-head-row">
            <Button size="small" icon={<ArrowRightOutlined />} onClick={closeDoc}>رجوع</Button>
            <span className="sale-title">{detail
              ? <>{KIND_LABEL[detail.kind] || detail.kind} — <b dir="ltr">{detail.document_number}</b></>
              : editingId ? 'تعديل إذن'
                : kind === 'issue' ? 'إذن صرف مخزني'
                  : kind === 'opening' ? 'بضاعة أول المدة' : 'إذن إضافة مخزني'}</span>
            <DocumentToolbar actions={permitToolbar()} variant="buttons" />
            <DocumentHistoryButton entityType="stock_permit"
              entityId={detail?.id ?? editingId} documentNumber={detail?.document_number} />
            {detail?.reversed_by && <Tag color="default" style={{ marginInlineEnd: 0 }}>معكوس</Tag>}
            {detail && (
              <span className="sale-pager">
                <DocumentBar
                  listLabel="أذون المخزن"
                  listTo="/stock-permits"
                  title={detail.document_number || `#${detail.id}`}
                  position={navRows.findIndex((r) => r.id === detail.id) + 1 || null}
                  total={navRows.length}
                  onPrev={neighbour(1) ? () => { const n = neighbour(1); if (n) openPermit(n); } : undefined}
                  onNext={neighbour(-1) ? () => { const n = neighbour(-1); if (n) openPermit(n); } : undefined}
                  steps={[
                    { key: 'draft', label: 'مسودة' },
                    { key: 'posted', label: 'مرحّل', color: 'green' },
                    { key: 'reversed', label: 'معكوس', color: 'volcano' },
                  ]}
                  current={detail.reversed_by ? 'reversed' : 'posted'}
                />
              </span>
            )}
          </div>
        </div>
        {detail ? postedDoc : createForm}
      </div>
  ) : (
    <ListPage<KindTab>
      icon={<FileTextOutlined />}
      title="أذونات المخزن" muted="(إضافة · صرف · أول المدة)"
      tabs={kindTabs} activeTab={activeKindTab}
      onTabChange={(k) => filter.setValue('kind', k === 'all' ? undefined : k)}
      actions={(<>
        <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
          onClick={() => { setKind('receipt'); startNew(); }}>إذن إضافة</Button>
        <Button icon={<PlusOutlined />}
          onClick={() => { setKind('issue'); startNew(); }}>إذن صرف</Button>
        <Button icon={<PlusOutlined />}
          onClick={() => { setKind('opening'); setCreating(true); }}>بضاعة أول المدة</Button>
        <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
        {tableCols.control}
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={listSearchRef}
          value={filter.query} placeholder="بحث برقم الإذن أو السبب أو البيان"
          prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        <Input allowClear placeholder="البيان"
          value={filter.values.statement ?? undefined}
          onChange={(e) => filter.setValue('statement', e.target.value || undefined)} />
        <DateRangeFilter className="sl-f-dates"
          value={filter.range ?? null} onChange={(v) => filter.setRange(v)} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table<Permit>
        className="sl-table"
        rowKey="id" size="small" loading={loading}
        dataSource={[
          ...(drafts || []).map((d: any) => {
            const x = d.payload || {};
            return {
              id: -d.id, __draft: d, __isDraft: true,
              document_number: 'مسودّة',
              kind: x.kind || 'receipt',
              created_at: d.updated_at,
              warehouse_name: null,
              lines: (x.lines || []).filter((l: any) => l.item_id != null),
              permit_date: String(x.permit_date || d.updated_at || '').slice(0, 10),
              reason: x.reason || null,
              total_cost: 0,
            } as any;
          }),
          ...filter.filtered,
        ]}
        rowClassName={(r: any) => (r.__isDraft ? 'row-draft' : '')}
        onRow={(r: any) => ({
          onClick: () => (r.__isDraft ? resumeDraft(r.__draft) : openPermit(r)),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: 'لا توجد أذونات' }}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true, locale: { items_per_page: '' },
          showTotal: () => (
            <span className="sl-foot">
              <span>إجمالي الأذون: <b>{permits.length.toLocaleString(numeralsLocale())}</b></span>
              {filter.filtered.length < permits.length && (
                <span>المعروض: <b>{filter.filtered.length.toLocaleString(numeralsLocale())}</b></span>
              )}
            </span>
          ),
        }}
        columns={tableCols.columns}
      />
    </ListPage>
  );

  if (docOpening) return <DocOpening />;
  return (
    <>
      {doors}
      {screen}
      <LoadPeriodModal
        open={loadRangeOpen} onCancel={() => setLoadRangeOpen(false)}
        title="تحميل أذونات فترة" endpoint="/api/v1/stock/permits"
        columns={[
          { title: 'الإذن', key: 'document_number', width: 150 },
          { title: 'التاريخ', key: 'permit_date', width: 120 },
          { title: 'المخزن', key: 'warehouse_name' },
          { title: 'التكلفة', key: 'total_cost', width: 130, money: true },
        ]}
        onLoaded={(rows) => setPeriodRows(rows as Permit[])}
        openNewest dateKey="permit_date"
        onPick={(r) => openPermit(r as Permit)} />
    </>
  );
}

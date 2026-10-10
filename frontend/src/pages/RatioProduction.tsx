import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Col, DatePicker, Form, Input, Modal, Row, Select, Space, Table, Tag, message,
} from 'antd';
import {
  ArrowRightOutlined, BuildOutlined, ClearOutlined, DeleteOutlined, PlusOutlined,
  ReloadOutlined, RollbackOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { InputNumber } from '../components/NumberInput';
import ListPage from '../components/ListPage';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import { api } from '../api/client';
import DocumentHistoryButton from '../components/DocumentHistory';
import { useListFilter } from '../components/ListToolbar';
import { matchesStatement } from '../utils/statements';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { money, numeralsLocale, qty as fmtQty } from '../utils/money';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { activeOptions } from '../utils/active';

interface Item { id: number; name: string; unit_of_measure?: string | null; purchase_price?: string | null; active: boolean }
interface Wh { id: number; name: string; branch_id?: number | null }
interface MatLine { key: number; item_id: number; quantity: number | null; warehouse_id?: number }
interface ProdLine {
  key: number; product_id?: number; quantity: number | null; warehouse_id?: number;
  bom_id?: number | null; materials: MatLine[]; loading?: boolean; noRecipe?: boolean;
}
interface POProduct { id: number; item_id: number; warehouse_id: number | null; quantity: string; total_cost: string; unit_cost: string }
interface POMaterial { id: number; product_line_id: number | null; item_id: number; warehouse_id: number | null; quantity: string; line_cost: string }
interface PO {
  id: number; document_number: string; production_date: string | null; state: string;
  external_document_number: string | null; paper_number?: string | null; statement1: string | null; notes: string | null;
  total_cost: string; expense_amount: string; product_quantity: string; imported_from: string | null;
  reversed: boolean; is_reversal: boolean; products: POProduct[]; materials: POMaterial[];
}

function unitText(q: number | null | undefined, unit?: string | null): string {
  if (q == null) return '';
  const u = (unit || '').trim();
  if (/كجم|كيلو/.test(u)) {
    const whole = Math.trunc(q);
    const grams = Math.round((q - whole) * 1000);
    return grams ? `${whole} كجم ${grams} جم` : `${whole} كجم`;
  }
  return `${fmtQty(q)} ${u}`.trim();
}

const shortDoc = (d: string) => (d || '').replace(/^WO-A5-(?:[A-Z]+-)?MFG-/, 'WO-');

export default function RatioProduction() {
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Wh[]>([]);
  const [recipeProducts, setRecipeProducts] = useState<Set<number>>(new Set());
  const [orders, setOrders] = useState<PO[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);

  const [date, setDate] = useState<Dayjs>(dayjs());
  const [outWh, setOutWh] = useState<number | undefined>();
  const [docNo, setDocNo] = useState('');
  const [paperNo, setPaperNo] = useState('');
  const [statement, setStatement] = useState('');
  const [lines, setLines] = useState<ProdLine[]>([]);
  const seq = useRef(0);
  const nextKey = () => { seq.current += 1; return seq.current; };
  const [stock, setStock] = useState<Record<number, Record<number, number>>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [i, w, b, boms, o] = await Promise.all([
        api.get('/api/v1/items'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/branches'),
        api.get('/api/v1/manufacturing/boms'),
        api.get('/api/v1/manufacturing/production-orders'),
      ]);
      setItems(i.data || []);
      const factory = new Set<number>((b.data || [])
        .filter((x: { is_factory?: boolean }) => x.is_factory).map((x: { id: number }) => Number(x.id)));
      const all: Wh[] = w.data || [];
      setWarehouses(factory.size ? all.filter((x) => x.branch_id != null && factory.has(Number(x.branch_id))) : all);
      setRecipeProducts(new Set((boms.data || []).filter((x: { active: boolean }) => x.active)
        .map((x: { product_id: number }) => x.product_id)));
      setOrders((o.data || []).filter((x: PO) => x.state === 'done' || x.reversed || x.is_reversal));
    } catch {
      message.error('تعذر تحميل البيانات');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const itemOf = (id?: number) => items.find((x) => x.id === id);
  const whName = (id?: number | null) => warehouses.find((x) => x.id === id)?.name ?? '-';
  const products = useMemo(() => items.filter((x) => x.active && recipeProducts.has(x.id)), [items, recipeProducts]);
  const whOptions = useMemo(() => activeOptions(sortByName(warehouses, (w) => w.name),
    [outWh, ...lines.flatMap((l) => [l.warehouse_id, ...l.materials.map((m) => m.warehouse_id)])]),
  [warehouses, outWh, lines]);

  const ensureStock = async (whId?: number) => {
    if (!whId || stock[whId]) return;
    try {
      const r = await api.get('/api/v1/stock/by-location', {
        params: { location_kind: 'warehouse', location_id: whId, only_available: false } });
      const m: Record<number, number> = {};
      (r.data || []).forEach((row: { item_id: number; on_hand: string }) => { m[row.item_id] = Number(row.on_hand); });
      setStock((p) => ({ ...p, [whId]: m }));
    } catch {}
  };

  const plan = async (key: number, productId?: number, quantity?: number | null) => {
    if (!productId || !quantity || quantity <= 0) {
      setLines((p) => p.map((l) => (l.key === key ? { ...l, materials: [], noRecipe: false } : l)));
      return;
    }
    setLines((p) => p.map((l) => (l.key === key ? { ...l, loading: true } : l)));
    try {
      const r = await api.get('/api/v1/manufacturing/recipe-plan', { params: { product_id: productId, quantity } });
      const mats: { item_id: number; quantity: string; warehouse_id: number | null }[] = r.data.materials || [];
      setLines((p) => p.map((l) => {
        if (l.key !== key) return l;
        const kept = new Map(l.materials.map((m) => [m.item_id, m.warehouse_id]));
        return {
          ...l, loading: false, bom_id: r.data.bom_id, noRecipe: !mats.length,
          materials: mats.map((m) => ({
            key: nextKey(), item_id: m.item_id, quantity: Number(m.quantity),
            warehouse_id: kept.get(m.item_id) ?? m.warehouse_id ?? undefined,
          })),
        };
      }));
      mats.forEach((m) => { if (m.warehouse_id) ensureStock(m.warehouse_id); });
    } catch (e: any) {
      setLines((p) => p.map((l) => (l.key === key ? { ...l, loading: false } : l)));
      message.error(e?.response?.data?.detail?.message || 'تعذر حساب الخامات');
    }
  };

  const setLine = (key: number, patch: Partial<ProdLine>) => setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setMat = (lk: number, mk: number, patch: Partial<MatLine>) => setLines((p) => p.map((l) => (
    l.key !== lk ? l : { ...l, materials: l.materials.map((m) => (m.key === mk ? { ...m, ...patch } : m)) })));

  const addProduct = () => setLines((p) => [...p, { key: nextKey(), quantity: null, materials: [] }]);
  const reset = () => { setLines([{ key: nextKey(), quantity: null, materials: [] }]); setDocNo(''); setPaperNo(''); setStatement(''); };
  const openEntry = () => {
    reset(); setDate(dayjs()); setEntryOpen(true);
    api.get('/api/v1/manufacturing/production-orders/next-number')
      .then((r) => setDocNo((cur) => cur || r.data?.next || '')).catch(() => {});
  };

  const matRows = lines.flatMap((l) => l.materials.map((m) => ({ ...m, lineKey: l.key, product_id: l.product_id })));
  const estCost = matRows.reduce((s, m) => s + (m.quantity || 0) * Number(itemOf(m.item_id)?.purchase_price || 0), 0);

  const submit = async () => {
    if (!outWh) { message.warning('اختر مخزن الإنتاج التام'); return; }
    const filled = lines.filter((l) => l.product_id);
    if (!filled.length) { message.warning('أدخل منتجاً واحداً على الأقل'); return; }
    for (const l of filled) {
      const name = itemOf(l.product_id)?.name;
      if (!l.quantity || l.quantity <= 0) { message.warning(`أدخل كمية «${name}»`); return; }
      if (!l.materials.length) { message.warning(`«${name}» ليست له نسب إنتاج — أنشئ له نسب إنتاج أولاً`); return; }
      const bad = l.materials.find((m) => !m.warehouse_id || !m.quantity || m.quantity <= 0);
      if (bad) { message.warning(`الخامة «${itemOf(bad.item_id)?.name}» تحتاج إلى كمية ومخزن`); return; }
    }
    setSaving(true);
    try {
      await api.post('/api/v1/manufacturing/production-orders', {
        production_date: date.format('YYYY-MM-DD'),
        external_document_number: docNo || null,
        paper_number: paperNo || null,
        statement1: statement || null,
        execute: true,
        products: filled.map((l) => ({
          item_id: l.product_id, quantity: String(l.quantity), planned_quantity: String(l.quantity),
          warehouse_id: l.warehouse_id || outWh, bom_id: l.bom_id ?? null,
          materials: l.materials.map((m) => ({
            item_id: m.item_id, quantity: String(m.quantity), planned_quantity: String(m.quantity),
            warehouse_id: m.warehouse_id,
          })),
        })),
      });
      message.success('تم تسجيل الإنتاج وصرف الخامات');
      setEntryOpen(false);
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail?.message || 'تعذر حفظ الإنتاج';
      Modal.error({
        title: 'لم يُسجَّل الإنتاج',
        width: 560,
        content: <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9 }}>{msg}</div>,
        okText: 'حسناً',
      });
    } finally { setSaving(false); }
  };

  const reverse = (o: PO) => Modal.confirm({
    title: `تراجع عن ${shortDoc(o.document_number)}؟`,
    content: 'ستُعاد الخامات إلى مخازنها ويُخصم الإنتاج بقيد عكسي، ويبقى الأصل في السجل.',
    okText: 'تراجع', cancelText: 'لا', okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await api.post(`/api/v1/manufacturing/production-orders/${o.id}/reverse`);
        message.success('تم التراجع'); setViewId(null); load();
      } catch (e: any) { message.error(e?.response?.data?.detail?.message || 'تعذر التراجع'); }
    },
  });

  const filter = useListFilter<PO>(orders, {
    search: (o) => [o.document_number, o.external_document_number, o.paper_number, o.statement1,
      ...o.products.map((p) => itemOf(p.item_id)?.name)],
    filters: { statement: (o, v) => matchesStatement(o, v) },
    dateOf: (o) => o.production_date,
  });
  const searchRef = useRef<any>(null);

  const listColumns = [
    { title: 'التاريخ', dataIndex: 'production_date', key: 'd', width: 105, render: (v: string | null) => (v ? v.slice(0, 10) : '-') },
    { title: 'رقم الانتاج', dataIndex: 'external_document_number', key: 'x', width: 100,
      render: (v: string | null) => (v ? <b>{v}</b> : '-') },
    { title: 'رقم المستند الورقي', dataIndex: 'paper_number', key: 'pp', width: 120, render: (v: string | null) => v || '-' },
    { title: 'الحالة', key: 'st', width: 90,
      render: (_: unknown, r: PO) => (
        <Space size={2} wrap>
          {r.reversed && <Tag color="red">متراجع</Tag>}
          {r.is_reversal && <Tag color="orange">تراجع</Tag>}
        </Space>) },
    { title: 'مستند النظام', dataIndex: 'document_number', key: 'n', width: 120, ellipsis: true,
      render: (d: string) => <span style={{ fontSize: 12, color: '#64748b' }}>{shortDoc(d)}</span> },
    { title: 'المنتجات', key: 'p', ellipsis: true,
      render: (_: unknown, r: PO) => r.products.map((p) => `${itemOf(p.item_id)?.name ?? p.item_id} (${fmtQty(Number(p.quantity))})`).join(' · ') },
    { title: 'اجمالي خامات', key: 'm', width: 120, align: 'left' as const,
      render: (_: unknown, r: PO) => money(r.materials.reduce((t, m) => t + Number(m.line_cost || 0), 0)) },
    { title: 'مصروفات', dataIndex: 'expense_amount', key: 'e', width: 100, align: 'left' as const, render: (v: string) => money(v || 0) },
    { title: 'اجمالي منتجات', dataIndex: 'total_cost', key: 'c', width: 130, align: 'left' as const, render: (v: string) => <b>{money(v)}</b> },
    { title: 'ملاحظات', dataIndex: 'statement1', key: 's', ellipsis: true, render: (v: string | null) => v || '-' },
    { title: '', key: 'a', width: 80,
      render: (_: unknown, r: PO) => (
        <Space size={0} onClick={(e) => e.stopPropagation()}>
          <DocumentHistoryButton iconOnly entityType="production_order" entityId={r.id}
            documentNumber={r.document_number} />
          {r.state === 'done' && !r.reversed && !r.is_reversal && (
            <Button size="small" type="text" danger icon={<RollbackOutlined />} title="تراجع" onClick={(e) => { e.stopPropagation(); reverse(r); }} />
          )}
        </Space>
      ) },
  ];
  const listCols = useTableColumns('ratio-production-list', listColumns);

  if (entryOpen) {
    return (
      <div className="sale-doc">
        <div className="sale-card sale-head">
          <div className="sale-head-row">
            <Button size="small" icon={<ArrowRightOutlined />} onClick={() => setEntryOpen(false)}>رجوع للسجل</Button>
            <span className="sale-title"><BuildOutlined /> انتاج حسب النسب</span>
            <div className="sale-toolbar-row">
              <Button onClick={reset}>تفريغ</Button>
              <Button type="primary" loading={saving} onClick={submit}>حفظ وترحيل</Button>
            </div>
          </div>
        </div>
        <div className="sale-form">
          <div className="sale-card">
            <Row gutter={[12, 12]}>
              <Col xs={12} md={4}>
                <Form.Item label="التاريخ" style={{ marginBottom: 0 }}>
                  <DatePicker style={{ width: '100%' }} value={date} allowClear={false} onChange={(d) => setDate(d || dayjs())} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item label="مخزن الإنتاج التام" required style={{ marginBottom: 0 }}>
                  <Select showSearch placeholder="اختر المخزن" value={outWh} onChange={setOutWh}
                    options={whOptions} filterOption={searchFilter} filterSort={searchRank} />
                </Form.Item>
              </Col>
              <Col xs={12} md={4}>
                <Form.Item label="رقم الانتاج" style={{ marginBottom: 0 }}>
                  <Input value={docNo} maxLength={40} onChange={(e) => setDocNo(e.target.value)} />
                </Form.Item>
              </Col>
              <Col xs={12} md={4}>
                <Form.Item label="رقم المستند الورقي" style={{ marginBottom: 0 }}>
                  <Input value={paperNo} maxLength={40} placeholder="اختياري" onChange={(e) => setPaperNo(e.target.value)} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item label="ملاحظات" style={{ marginBottom: 0 }}>
                  <Input value={statement} maxLength={200} placeholder="اختياري" onChange={(e) => setStatement(e.target.value)} />
                </Form.Item>
              </Col>
            </Row>
          </div>

          <div className="sale-card">
            <div style={{ fontWeight: 800, marginBottom: 8 }}>المنتجات</div>
            <Table size="small" pagination={false} rowKey="key" dataSource={lines}
              columns={[
                { title: 'المنتج', width: '45%', render: (_: unknown, l: ProdLine) => (
                  <Select showSearch style={{ width: '100%' }} placeholder="اختر منتجاً له نسب إنتاج"
                    value={l.product_id} filterOption={searchFilter} filterSort={searchRank}
                    options={products.map((p) => ({ value: p.id, label: p.name }))}
                    onChange={(v: number) => { setLine(l.key, { product_id: v, materials: [] }); plan(l.key, v, l.quantity); }} />) },
                { title: 'الكمية', width: 140, render: (_: unknown, l: ProdLine) => (
                  <InputNumber style={{ width: '100%' }} value={l.quantity} placeholder="—" keyboard={false}
                    onChange={(v) => setLine(l.key, { quantity: v as number | null })}
                    onBlur={() => plan(l.key, l.product_id, l.quantity)}
                    onPressEnter={() => plan(l.key, l.product_id, l.quantity)} />) },
                { title: 'مخزن الإنتاج', width: 200, render: (_: unknown, l: ProdLine) => (
                  <Select allowClear style={{ width: '100%' }} placeholder={outWh ? whName(outWh) : 'مخزن المستند'}
                    value={l.warehouse_id} options={whOptions} onChange={(v: number) => setLine(l.key, { warehouse_id: v })} />) },
                { title: '', width: 160, render: (_: unknown, l: ProdLine) => (
                  l.loading ? <Tag>جارٍ حساب الخامات…</Tag>
                    : l.noRecipe ? <Tag color="red">بلا نسب</Tag>
                      : l.materials.length ? <Tag color="green">{l.materials.length} خامة</Tag> : null) },
                { title: '', width: 50, render: (_: unknown, l: ProdLine) => (
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} />) },
              ]} />
            <Button style={{ marginTop: 10 }} icon={<PlusOutlined />} onClick={addProduct}>منتج آخر</Button>
          </div>

          <div className="sale-card">
            <div style={{ fontWeight: 800, marginBottom: 8 }}>الخامات المصروفة (من النسب)</div>
            <Table size="small" pagination={false} rowKey="key" dataSource={matRows}
              locale={{ emptyText: 'لا توجد خامات' }}
              columns={[
                { title: 'المنتج', width: '22%', render: (_: unknown, m: any) => <span style={{ color: '#475569' }}>{itemOf(m.product_id)?.name}</span> },
                { title: 'الخامة', width: '24%', render: (_: unknown, m: any) => <b>{itemOf(m.item_id)?.name ?? m.item_id}</b> },
                { title: 'الكمية', width: 200, render: (_: unknown, m: any) => (
                  <div>
                    <InputNumber style={{ width: '100%' }} value={m.quantity} keyboard={false}
                      onChange={(v) => setMat(m.lineKey, m.key, { quantity: v as number | null })} />
                    <div style={{ fontSize: 12, color: '#64748b' }}>{unitText(m.quantity, itemOf(m.item_id)?.unit_of_measure)}</div>
                  </div>) },
                { title: 'المخزن', width: 200, render: (_: unknown, m: any) => (
                  <Select style={{ width: '100%' }} placeholder="اختر المخزن" value={m.warehouse_id} options={whOptions}
                    onChange={(v: number) => { setMat(m.lineKey, m.key, { warehouse_id: v }); ensureStock(v); }} />) },
                { title: 'المتاح في المخزن', width: 130, render: (_: unknown, m: any) => {
                  const have = m.warehouse_id ? stock[m.warehouse_id]?.[m.item_id] : undefined;
                  if (have == null) return '-';
                  const short = (m.quantity || 0) > have;
                  return <span style={{ color: short ? '#dc2626' : '#16a34a', fontWeight: 700 }}>{fmtQty(have)}</span>;
                } },
              ]} />
            <div style={{ marginTop: 10, display: 'flex', gap: 16, alignItems: 'center' }}>
              <span>تكلفة تقديرية للخامات: <b>{money(estCost)}</b></span>
              <Button type="primary" loading={saving} onClick={submit} style={{ marginInlineStart: 'auto' }}>حفظ وترحيل</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const viewing = viewId != null ? orders.find((o) => o.id === viewId) : undefined;
  if (viewing) {
    const list = filter.filtered;
    const idx = list.findIndex((o) => o.id === viewing.id);
    const prev = idx > 0 ? list[idx - 1] : undefined;
    const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : undefined;
    const matTotal = viewing.materials.reduce((t, m) => t + Number(m.line_cost || 0), 0);
    const field = (label: string, value: React.ReactNode) => (
      <Col xs={12} md={4}>
        <div style={{ fontSize: 13, color: '#64748b' }}>{label}</div>
        <div style={{ fontWeight: 700, minHeight: 24 }}>{value || '-'}</div>
      </Col>
    );
    return (
      <div className="sale-doc">
        <div className="sale-card sale-head">
          <div className="sale-head-row">
            <Button size="small" icon={<ArrowRightOutlined />} onClick={() => setViewId(null)}>رجوع للسجل</Button>
            <span className="sale-title"><BuildOutlined /> اذن انتاج {viewing.external_document_number || shortDoc(viewing.document_number)}</span>
            {viewing.reversed && <Tag color="red">متراجع</Tag>}
            {viewing.is_reversal && <Tag color="orange">تراجع</Tag>}
            <div className="sale-toolbar-row">
              <Button disabled={!prev} onClick={() => prev && setViewId(prev.id)}>السابق</Button>
              <Button disabled={!next} onClick={() => next && setViewId(next.id)}>التالي</Button>
              <DocumentHistoryButton entityType="production_order" entityId={viewing.id}
                documentNumber={viewing.document_number} />
              {viewing.state === 'done' && !viewing.reversed && !viewing.is_reversal && (
                <Button danger icon={<RollbackOutlined />} onClick={() => reverse(viewing)}>تراجع</Button>
              )}
            </div>
          </div>
        </div>
        <div className="sale-form">
          <div className="sale-card">
            <Row gutter={[12, 12]}>
              {field('التاريخ', viewing.production_date ? viewing.production_date.slice(0, 10) : '')}
              {field('رقم الانتاج', viewing.external_document_number)}
              {field('رقم المستند الورقي', viewing.paper_number)}
              {field('مستند النظام', shortDoc(viewing.document_number))}
              <Col xs={24} md={8}>
                <div style={{ fontSize: 13, color: '#64748b' }}>ملاحظات</div>
                <div style={{ fontWeight: 700, minHeight: 24 }}>{viewing.statement1 || '-'}</div>
              </Col>
            </Row>
          </div>

          <div className="sale-card">
            <div style={{ fontWeight: 800, marginBottom: 8 }}>المنتجات</div>
            <Table size="small" pagination={false} rowKey="id" dataSource={viewing.products}
              columns={[
                { title: '#', width: 50, render: (_: unknown, __: unknown, i: number) => i + 1 },
                { title: 'المنتج', render: (_: unknown, x: POProduct) => <b>{itemOf(x.item_id)?.name ?? x.item_id}</b> },
                { title: 'الكمية', width: 180, render: (_: unknown, x: POProduct) => unitText(Number(x.quantity), itemOf(x.item_id)?.unit_of_measure) },
                { title: 'مخزن الإنتاج', width: 200, render: (_: unknown, x: POProduct) => whName(x.warehouse_id) },
                { title: 'تكلفة الوحدة', width: 130, align: 'left' as const, render: (_: unknown, x: POProduct) => money(x.unit_cost) },
                { title: 'الإجمالي', width: 140, align: 'left' as const, render: (_: unknown, x: POProduct) => <b>{money(x.total_cost)}</b> },
              ]} />
          </div>

          <div className="sale-card">
            <div style={{ fontWeight: 800, marginBottom: 8 }}>الخامات المصروفة</div>
            <Table size="small" pagination={false} rowKey="id" dataSource={viewing.materials}
              locale={{ emptyText: 'لا توجد خامات' }}
              columns={[
                { title: '#', width: 50, render: (_: unknown, __: unknown, i: number) => i + 1 },
                { title: 'المنتج', width: '24%', render: (_: unknown, m: POMaterial) => {
                  const p = viewing.products.find((x) => x.id === m.product_line_id);
                  return <span style={{ color: '#475569' }}>{p ? itemOf(p.item_id)?.name : '-'}</span>;
                } },
                { title: 'الخامة', render: (_: unknown, m: POMaterial) => <b>{itemOf(m.item_id)?.name ?? m.item_id}</b> },
                { title: 'الكمية', width: 180, render: (_: unknown, m: POMaterial) => unitText(Number(m.quantity), itemOf(m.item_id)?.unit_of_measure) },
                { title: 'المخزن', width: 200, render: (_: unknown, m: POMaterial) => whName(m.warehouse_id) },
                { title: 'التكلفة', width: 140, align: 'left' as const, render: (_: unknown, m: POMaterial) => money(m.line_cost) },
              ]} />
            <div style={{ marginTop: 10, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <span>اجمالي خامات: <b>{money(matTotal)}</b></span>
              <span>مصروفات: <b>{money(viewing.expense_amount || 0)}</b></span>
              <span>اجمالي منتجات: <b>{money(viewing.total_cost)}</b></span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ListPage
      icon={<BuildOutlined />} title="انتاج حسب النسب"
      actions={(<>
        <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create" onClick={openEntry}>انتاج جديد</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        {listCols.control}
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={searchRef} prefix={<SearchOutlined />}
          placeholder="بحث بالرقم أو المنتج أو الملاحظات" value={filter.query} onChange={(e) => filter.setQuery(e.target.value)} />
        <DateRangeFilter className="sl-f-dates" value={filter.range} onChange={filter.setRange} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table className="sl-table" size="small" rowKey="id" loading={loading} tableLayout="fixed"
        dataSource={filter.filtered} columns={listCols.columns}
        onRow={(r: PO) => ({ onClick: () => setViewId(r.id), style: { cursor: 'pointer' } })}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
          locale: { items_per_page: '' },
          showTotal: () => (
            <span className="sl-foot">
              <span>المعروض: <b>{filter.filtered.length.toLocaleString(numeralsLocale())}</b></span>
              <span>تكلفة الإنتاج المعروض: <b>{money(filter.filtered.reduce((t, o) => t + Number(o.total_cost || 0), 0))}</b></span>
            </span>),
        }} />
    </ListPage>
  );
}

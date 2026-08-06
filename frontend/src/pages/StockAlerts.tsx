import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Row, Select, Statistic, Table, Tabs, Tag, message, Space,
} from 'antd';
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { DocRef, useOpenDocument } from '../components/DocumentLink';
import { useQueryTab } from '../components/useQueryTab';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import { useNavigate } from 'react-router-dom';

/**
 * تنبيهات المخزون — the two questions a stock manager asks that a balance list cannot answer:
 * what do I need to buy (below the reorder level), and what is about to go bad.
 *
 * Both are planning views. The limits behind the first are advisory by design: they warn, they
 * never block a sale — only running out of stock does that.
 */

interface ReorderRow {
  item_id: number;
  code: string | null;
  name: string;
  unit_of_measure: string | null;
  on_hand: string;
  min_stock: string | null;
  max_stock: string | null;
  shortfall: string | null;
  excess: string | null;
  flag: 'below_min' | 'above_max';
}

interface BatchMove {
  id: number; item_id: number; item_name: string | null; expiry_date: string;
  kind: 'received' | 'consumed' | 'relocated_out' | 'relocated_in' | 'returned';
  location_kind: string; location_id: number; location_name: string | null;
  quantity: string; document_type: string | null; document_id: number | null; created_at: string;
}

const MOVE_KIND: Record<BatchMove['kind'], { text: string; color: string }> = {
  received: { text: 'استلام', color: 'green' },
  consumed: { text: 'صرف بالبيع', color: 'volcano' },
  relocated_out: { text: 'خرج بتحويل', color: 'blue' },
  relocated_in: { text: 'دخل بتحويل', color: 'cyan' },
  returned: { text: 'مرتجع', color: 'gold' },
};

const MOVE_DOC: Record<string, string> = {
  sales_invoice: 'فاتورة بيع',
  transfer: 'إذن تحويل',
  batch_receive: 'استلام تشغيلة',
};

interface BatchRow {
  batch_id: number;
  item_id: number;
  code: string | null;
  name: string;
  location_kind: string;
  location_id: number;
  expiry_date: string;
  quantity: string;
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function StockAlerts() {
  // «كميات انتهاء الصلاحية» is their own screen; ours is the second tab here.
  const [tab, setTab] = useQueryTab('reorder');
  // «حركات انتهاء الصلاحية» — where each lot went, beside «كميات انتهاء الصلاحية» which is what
  // is left of it. Two of their screens, and the second only answers half the question.
  const navigate = useNavigate();
  const [moves, setMoves] = useState<BatchMove[]>([]);
  const [movesLoading, setMovesLoading] = useState(false);
  const [tracedLot, setTracedLot] = useState<{ item_id: number; expiry: string } | null>(null);
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [summary, setSummary] = useState({ below_min: 0, above_max: 0 });
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // Default horizon: what expires within the next month — the window a buyer can still act on.
  const [before, setBefore] = useState<Dayjs>(dayjs().add(30, 'day'));
  const [warehouseId, setWarehouseId] = useState<number | undefined>();

  const loadReorder = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/reorder');
      setReorder(res.data.rows || []);
      setSummary({ below_min: res.data.below_min || 0, above_max: res.data.above_max || 0 });
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const loadBatches = async () => {
    setLoading(true);
    try {
      const params: any = { before: before.format('YYYY-MM-DD') };
      if (warehouseId) { params.location_kind = 'warehouse'; params.location_id = warehouseId; }
      const res = await api.get('/api/v1/stock/batches/expiring', { params });
      setBatches(res.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const loadMoves = async () => {
    setMovesLoading(true);
    try {
      const params: any = {};
      if (tracedLot) { params.item_id = tracedLot.item_id; params.expiry_date = tracedLot.expiry; }
      const res = await api.get('/api/v1/stock/batches/movements', { params });
      setMoves(res.data || []);
    } catch (err) { console.error(err); } finally { setMovesLoading(false); }
  };

  // Following one lot is a fresh query, not a client-side filter: a recall asks about a lot that
  // may have emptied months ago, and the loaded page only holds the last thousand rows.
  useEffect(() => { if (tab === 'movements') loadMoves(); }, [tab, tracedLot]);

  useEffect(() => {
    loadReorder();
    api.get('/api/v1/warehouses').then((r) => setWarehouses(r.data)).catch(console.error);
  }, []);
  useEffect(() => { loadBatches(); }, [before, warehouseId]);

  const reorderFilter = useListFilter(reorder, {
    search: (r) => [r.code, r.name],
    filters: { flag: (r, v) => r.flag === v },
  });
  const batchFilter = useListFilter(batches, { search: (b) => [b.code, b.name] });

  const warehouseName = (id: number) =>
    warehouses.find((w) => w.id === id)?.name ?? `#${id}`;

  const openDoc = useOpenDocument();
  // «الصنف ده تحت الأدنى» — الخطوة اللي بعدها دايماً هي فتح ملف الصنف عشان تشوف حركته وتقرّر
  // تشتري كام، فالسطر بيوصّلك هناك على طول.
  const reorderKb = useTableKeyboard<ReorderRow>({
    rows: reorderFilter.filtered, rowKey: (r) => r.item_id,
    onOpen: (r) => navigate(`/catalog/${r.item_id}`),
  });
  // والتشغيلة اللي هتنتهي: السطر يفتح أثرها — «دي راحت فين» هو سؤال الاسترجاع نفسه.
  const batchKb = useTableKeyboard<BatchRow>({
    rows: batchFilter.filtered, rowKey: (r) => r.batch_id,
    onOpen: (r) => setTracedLot({ item_id: r.item_id, expiry: r.expiry_date }),
  });
  const movesKb = useTableKeyboard<BatchMove>({
    rows: moves, rowKey: (r) => r.id,
    onOpen: (r) => { if (r.document_type === 'sales_invoice') openDoc('invoice', r.document_id); },
  });

  return (
    <Tabs
      activeKey={tab} onChange={setTab}
      items={[
        {
          key: 'reorder',
          label: `حد إعادة الطلب (${reorder.length})`,
          children: (
            <Card title="الأصناف خارج حدودها المخزنية"
              extra={<Button icon={<ReloadOutlined />} onClick={loadReorder}>تحديث</Button>}>
              <Alert type="info" showIcon style={{ marginBottom: 12 }}
                message="الحدود إرشادية للتخطيط فقط — لا تمنع أي عملية بيع."
                description="الصنف يظهر هنا لو رصيده الكلي نزل تحت الحد الأدنى أو تعدّى الحد الأقصى." />

              <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col xs={24} md={12}>
                  <Card size="small">
                    <Statistic title="تحت الحد الأدنى (تحتاج شراء)" value={summary.below_min}
                      valueStyle={{ color: summary.below_min ? '#cf1322' : undefined }} />
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small">
                    <Statistic title="فوق الحد الأقصى (تكدّس)" value={summary.above_max}
                      valueStyle={{ color: summary.above_max ? '#F5A11D' : undefined }} />
                  </Card>
                </Col>
              </Row>

              <ListToolbar
                searchPlaceholder="بحث بالصنف أو الكود"
                query={reorderFilter.query} onQueryChange={reorderFilter.setQuery}
                values={reorderFilter.values} onValueChange={reorderFilter.setValue}
                onReset={reorderFilter.reset}
                total={reorder.length} shown={reorderFilter.filtered.length}
                filters={[{ key: 'flag', placeholder: 'الحالة', options: [
                  { value: 'below_min', label: 'تحت الحد الأدنى' },
                  { value: 'above_max', label: 'فوق الحد الأقصى' },
                ] }]}
              />

              <Table
                {...reorderKb.tableProps}
                rowKey="item_id" size="small" loading={loading}
                dataSource={reorderFilter.filtered}
                locale={{ emptyText: 'كل الأصناف داخل حدودها' }}
                pagination={{ defaultPageSize: 20, showSizeChanger: true }}
                columns={[
                  { title: 'الكود', dataIndex: 'code', render: (c: string) => <Tag>{c}</Tag> },
                  { title: 'الصنف', dataIndex: 'name', render: (n: string) => <b>{n}</b> },
                  { title: 'الرصيد الحالي', dataIndex: 'on_hand',
                    render: (v: string, r: ReorderRow) => (
                      <span style={{ fontWeight: 600,
                        color: r.flag === 'below_min' ? '#cf1322' : '#F5A11D' }}>
                        {qty(v)} {r.unit_of_measure || ''}
                      </span>
                    ) },
                  { title: 'الحد الأدنى', dataIndex: 'min_stock', render: (v: string) => (v ? qty(v) : '-') },
                  { title: 'الحد الأقصى', dataIndex: 'max_stock', render: (v: string) => (v ? qty(v) : '-') },
                  { title: 'المطلوب شراؤه', dataIndex: 'shortfall',
                    render: (v: string | null) => (v
                      ? <b style={{ color: '#cf1322' }}>{qty(v)}</b> : '-') },
                  { title: 'الزائد', dataIndex: 'excess',
                    render: (v: string | null) => (v
                      ? <b style={{ color: '#F5A11D' }}>{qty(v)}</b> : '-') },
                  { title: 'الحالة', dataIndex: 'flag',
                    render: (f: string) => (f === 'below_min'
                      ? <Tag color="red">تحت الأدنى</Tag>
                      : <Tag color="orange">فوق الأقصى</Tag>) },
                ]}
              />
            </Card>
          ),
        },
        {
          key: 'expiring',
          label: `قرب انتهاء الصلاحية (${batches.length})`,
          children: (
            <Card title="تشغيلات قاربت على الانتهاء"
              extra={<Button icon={<ReloadOutlined />} onClick={loadBatches}>تحديث</Button>}>
              <Row gutter={8} style={{ marginBottom: 12 }}>
                <Col xs={24} md={8}>
                  <DatePicker style={{ width: '100%' }} value={before}
                    onChange={(v) => v && setBefore(v)}
                    // Everything expiring on or before this date.
                    placeholder="تنتهي قبل تاريخ" />
                </Col>
                <Col xs={24} md={8}>
                  <Select allowClear style={{ width: '100%' }} placeholder="كل المخازن"
                    value={warehouseId} onChange={(v) => setWarehouseId(v)}
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                </Col>
              </Row>

              <ListToolbar
                searchPlaceholder="بحث بالصنف أو الكود"
                query={batchFilter.query} onQueryChange={batchFilter.setQuery}
                onReset={batchFilter.reset}
                total={batches.length} shown={batchFilter.filtered.length}
                searchSpan={10}
              />

              <Table
                {...batchKb.tableProps}
                rowKey="batch_id" size="small" loading={loading}
                dataSource={batchFilter.filtered}
                locale={{ emptyText: 'لا توجد تشغيلات تنتهي قبل هذا التاريخ' }}
                pagination={{ defaultPageSize: 20, showSizeChanger: true }}
                columns={[
                  { title: 'الكود', dataIndex: 'code', render: (c: string) => <Tag>{c}</Tag> },
                  { title: 'الصنف', dataIndex: 'name', render: (n: string) => <b>{n}</b> },
                  { title: 'المخزن', dataIndex: 'location_id',
                    render: (id: number, r: BatchRow) => (r.location_kind === 'warehouse'
                      ? warehouseName(id) : `عهدة #${id}`) },
                  { title: 'تاريخ الانتهاء', dataIndex: 'expiry_date',
                    render: (d: string) => {
                      const days = dayjs(d).diff(dayjs(), 'day');
                      const colour = days < 0 ? 'red' : days <= 7 ? 'volcano' : 'orange';
                      return (
                        <span>
                          <Tag color={colour}>{d}</Tag>
                          <span style={{ fontSize: 12, color: '#8a8a8a' }}>
                            {days < 0 ? `منتهية منذ ${Math.abs(days)} يوم` : `باقي ${days} يوم`}
                          </span>
                        </span>
                      );
                    } },
                  { title: 'الكمية المتبقية', dataIndex: 'quantity',
                    render: (v: string) => <b style={{ color: '#6AB42D' }}>{qty(v)}</b> },
                ]}
              />
            </Card>
          ),
        },
        {
          key: 'movements',
          label: 'حركات انتهاء الصلاحية',
          children: (
            <Card
              title={tracedLot
                ? `حركة التشغيلة المنتهية ${tracedLot.expiry}`
                : 'حركات التشغيلات'}
              extra={(
                <Space>
                  {tracedLot && <Button onClick={() => setTracedLot(null)}>عرض الكل</Button>}
                  <Button icon={<ReloadOutlined />} onClick={loadMoves}>تحديث</Button>
                </Space>
              )}
            >
              <Table
                {...movesKb.tableProps}
                rowKey="id" size="small" loading={movesLoading} dataSource={moves}
                tableLayout="fixed"
                locale={{
                  emptyText: (
                    // Lots received before this trail existed have none, and saying so beats an
                    // empty table that reads like a fault.
                    'مفيش حركات مسجّلة. التشغيلات اللي دخلت قبل ما السجل ده يتعمل مالهاش أثر.'
                  ),
                }}
                pagination={{ defaultPageSize: 20, showSizeChanger: true,
                  showTotal: (t) => `الإجمالي: ${t}` }}
                columns={[
                  { title: 'التاريخ', dataIndex: 'created_at', width: 150,
                    render: (v: string) => String(v).slice(0, 16) },
                  { title: 'الصنف', dataIndex: 'item_name', ellipsis: true,
                    render: (n: string | null, r: BatchMove) => n ?? `صنف #${r.item_id}` },
                  { title: 'تاريخ الانتهاء', dataIndex: 'expiry_date', width: 150,
                    render: (d: string, r: BatchMove) => (
                      <a onClick={() => setTracedLot({ item_id: r.item_id, expiry: d })}>
                        <Tag color={dayjs(d).isBefore(dayjs()) ? 'red' : 'orange'}>{d}</Tag>
                      </a>
                    ) },
                  { title: 'الحركة', dataIndex: 'kind', width: 130,
                    render: (k: BatchMove['kind']) => (
                      <Tag color={MOVE_KIND[k].color}>{MOVE_KIND[k].text}</Tag>
                    ) },
                  { title: 'المخزن', dataIndex: 'location_name', width: 170,
                    render: (v: string | null) => v ?? '-' },
                  { title: 'الكمية', dataIndex: 'quantity', width: 100, align: 'left' as const,
                    render: (v: string) => <b>{qty(v)}</b> },
                  { title: 'المستند', key: 'doc', width: 185,
                    render: (_: any, r: BatchMove) => {
                      if (!r.document_type) return '-';
                      const label = `${MOVE_DOC[r.document_type] ?? r.document_type}`
                        + (r.document_id ? ` #${r.document_id}` : '');
                      // A recall follows the lot to the sale that took it; the transfer and the
                      // receipt have no single-document screen, so they stay plain.
                      return r.document_type === 'sales_invoice'
                        ? <DocRef kind="invoice" id={r.document_id} label={label} />
                        : <span>{label}</span>;
                    } },
                ]}
              />
            </Card>
          ),
        },
      ]}
    />
  );
}

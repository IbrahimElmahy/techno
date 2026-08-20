import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, ReloadOutlined, StopOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import { DocRef } from '../components/DocumentLink';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import ProductPickerModal from '../components/ProductPickerModal';
import PartyPickerModal from '../components/PartyPickerModal';
import { useTableKeyboard } from '../components/keyboard';
import { useLookup, labelMap } from '../hooks/useLookup';

/**
 * حجز عملاء — stock held for a customer without being sold to them yet.
 *
 * The only document here whose entire effect is on a different screen. It moves nothing, owes
 * nothing and bills nothing; all it does is stop somebody else taking the goods. So the screen is
 * mostly a register — the enforcement lives in the sale and the transfer, which now refuse what is
 * spoken for and say so in those words rather than «out of stock».
 *
 * Every hold has a last day. A promise with no end holds stock forever and whoever made it has
 * left by the time anyone notices, so the form will not open without one and expiry is decided by
 * comparing the date rather than by anyone remembering to release it.
 */

interface Row {
  id: number; document_number: string;
  customer_id: number; customer_name: string | null;
  item_id: number; item_name: string | null;
  location_kind: string; location_id: number; location_name: string | null;
  quantity: string; expires_on: string;
  status: 'active' | 'converted' | 'cancelled';
  holding: boolean;
  sales_invoice_id: number | null; notes: string | null; created_at: string;
}

interface Availability {
  on_hand: string; reserved_for_others: string; available: string;
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function Reservations() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  // A reservation is one customer holding one item, so the doors are exactly those two questions
  // in that order — and both are answered in the same windows the documents use.
  const [newStep, setNewStep] = useState<null | 'customer'>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [itemId, setItemId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  // Empty until typed — the same rule as every other document here.
  const [quantity, setQuantity] = useState<number | null>(null);
  const [expiresOn, setExpiresOn] = useState<Dayjs>(dayjs().add(7, 'day'));
  const [notes, setNotes] = useState('');
  const [avail, setAvail] = useState<Availability | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, c, i, w] = await Promise.all([
        api.get('/api/v1/reservations'),
        api.get('/api/v1/customers'),
        api.get('/api/v1/items'),
        api.get('/api/v1/warehouses'),
      ]);
      setRows(r.data || []); setCustomers(c.data || []);
      setItems(i.data || []); setWarehouses(w.data || []);
    } catch {
      message.error('تعذر تحميل الحجوزات');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // What is free BEFORE the person types a number, so a refusal is not the first they hear of it.
  useEffect(() => {
    if (!itemId || !warehouseId) { setAvail(null); return; }
    const params: any = { item_id: itemId, location_kind: 'warehouse', location_id: warehouseId };
    if (customerId) params.for_customer_id = customerId;
    api.get('/api/v1/reservations/availability', { params })
      .then((r) => setAvail(r.data)).catch(() => setAvail(null));
  }, [itemId, warehouseId, customerId]);

  const openCreate = () => {
    setCustomerId(undefined); setItemId(undefined); setWarehouseId(undefined);
    setQuantity(null); setExpiresOn(dayjs().add(7, 'day')); setNotes(''); setAvail(null);
    // «مين» first, in a door of its own — a hold is held FOR somebody, and that is the fact the
    // rest of the form is about.
    setCreating(false); setNewStep('customer');
  };

  const submit = async () => {
    if (!customerId) { message.warning('اختر العميل'); return; }
    if (!itemId) { message.warning('اختر الصنف'); return; }
    if (!warehouseId) { message.warning('اختر المخزن'); return; }
    if (!quantity || quantity <= 0) { message.warning('اكتب الكمية المحجوزة'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/reservations', {
        customer_id: customerId, item_id: itemId,
        location: { location_kind: 'warehouse', location_id: warehouseId },
        quantity: String(quantity), expires_on: expiresOn.format('YYYY-MM-DD'),
        notes: notes || null,
      });
      message.success('اتسجّل الحجز');
      setCreating(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل الحجز');
    } finally { setSaving(false); }
  };

  const cancel = async (id: number) => {
    try {
      await api.post(`/api/v1/reservations/${id}/cancel`);
      message.success('اتلغى الحجز والرصيد رجع متاح');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إلغاء الحجز');
    }
  };

  /**
   * الحجز مفتوح.
   *
   * Two things the API has always returned and no column showed: `notes` — the reason the hold was
   * put on, which is the whole context when somebody asks why stock is not sellable — and
   * `sales_invoice_id`, the invoice it turned into. «اتحوّل لفاتورة» with no way to reach the
   * invoice is a dead end at exactly the point somebody wants to check the price it went out at.
   */
  const [viewing, setViewing] = useState<Row | null>(null);

  const holdingCount = rows.filter((r) => r.holding).length;
  const holdingQty = rows.filter((r) => r.holding)
    .reduce((s, r) => s + Number(r.quantity || 0), 0);

  const columns = [
    {
      title: 'رقم', dataIndex: 'id', key: 'id', width: 70,
      render: (v: number) => <span style={{ color: '#6b6b6b' }}>{v}</span>,
    },
    {
      title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', width: 105,
      render: (v: string) => String(v).slice(0, 10),
    },
    {
      title: 'رقم الحجز', dataIndex: 'document_number', key: 'document_number', width: 130,
      render: (v: string) => <Tag color="purple">{v}</Tag>,
    },
    {
      title: 'العميل', dataIndex: 'customer_name', key: 'customer_name', ellipsis: true,
      // A hold is read alongside «what else does this customer owe» often enough that the name
      // should carry you to their file rather than being a label.
      render: (v: string | null, r: Row) => (
        <a onClick={(e) => { e.stopPropagation(); navigate(`/customers/${r.customer_id}`); }}>
          {v ?? `عميل #${r.customer_id}`}
        </a>
      ),
    },
    {
      title: 'الصنف', dataIndex: 'item_name', key: 'item_name', ellipsis: true,
      render: (v: string | null, r: Row) => (
        <a onClick={(e) => { e.stopPropagation(); navigate(`/catalog/${r.item_id}`); }}>
          {v ?? `صنف #${r.item_id}`}
        </a>
      ),
    },
    {
      title: 'المخزن', dataIndex: 'location_name', key: 'location_name', width: 160,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: 'الكمية', dataIndex: 'quantity', key: 'quantity', width: 100,
      render: (v: string) => <b>{qty(v)}</b>,
    },
    {
      title: 'ينتهي في', dataIndex: 'expires_on', key: 'expires_on', width: 145,
      render: (v: string, r: Row) => {
        const days = dayjs(v).diff(dayjs(), 'day');
        if (r.status !== 'active') return <span style={{ color: '#8c8c8c' }}>{v}</span>;
        return (
          <span>
            <Tag color={days < 0 ? 'default' : days <= 2 ? 'volcano' : 'blue'}>{v}</Tag>
            <span style={{ fontSize: 12, color: '#6b6b6b' }}>
              {days < 0 ? 'انتهى' : `باقي ${days} يوم`}
            </span>
          </span>
        );
      },
    },
    {
      title: 'الحالة', key: 'status', width: 130,
      render: (_: any, r: Row) => {
        if (r.status === 'converted') {
          return <Tag color="green">اتحوّل لفاتورة</Tag>;
        }
        if (r.status === 'cancelled') return <Tag>ملغي</Tag>;
        // «active» and «holding» are not the same thing once the date has passed, and the column
        // people act on has to be the second one.
        return r.holding ? <Tag color="purple">حاجز</Tag> : <Tag color="default">منتهي</Tag>;
      },
    },
    {
      title: '', key: 'actions', width: 110,
      render: (_: any, r: Row) => (r.status === 'active' ? (
        <Popconfirm title="إلغاء الحجز؟" description="الرصيد هيرجع متاح للبيع فوراً."
          okText="إلغاء الحجز" cancelText="رجوع" onConfirm={() => cancel(r.id)}>
          <Button type="text" danger size="small" icon={<StopOutlined />}>إلغاء</Button>
        </Popconfirm>
      ) : null),
    },
  ];

  const cols = useHiddenColumns('reservations-list', ['id']);
  const filter = useListFilter<Row>(rows, {
    search: (r) => [r.document_number, r.customer_name, r.item_name],
    filters: {
      holding: (r, v) => (v === 'yes' ? r.holding : !r.holding),
      customer_id: (r, v) => r.customer_id === v,
    },
    dateOf: (r) => r.created_at,
  });
  const kb = useTableKeyboard<Row>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: setViewing,
  });

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name })), [customers],
  );

  /**
   * صفحة المستند — واحدة، سواء بتكتب حجز أو بتقرا واحد.
   *
   * Written in one Modal and read in another: two shapes for one document. The list steps aside
   * while a document is open.
   */
  const docOpen = creating || !!viewing;

  return (
    <div>
      {!docOpen && (
      <Card
        title="حجز عملاء"
        extra={
          <Space>
            <ColumnSettings
              choices={columns.filter((c: any) => c.key !== 'actions').map((c: any) => ({
                key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
                locked: c.key === 'document_number',
              }))}
              hidden={cols.hidden} onChange={cols.setHidden}
              order={cols.order} onMove={(k, d) => cols.move(k, d, columns.map((c) => String(c.key ?? (c as any).dataIndex ?? '')))}
            />
            <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
            <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={openCreate}>حجز جديد</Button>
          </Space>
        }
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="الحجز بيمسك الرصيد من غير ما يبيعه"
          description="الكمية المحجوزة مابقتش متاحة لعميل تاني ولا للتحويل لمخزن تاني، لغاية ما الحجز يتحوّل لفاتورة أو يتلغي أو ينتهي تاريخه."
        />

        <Space size="large" style={{ marginBottom: 12 }}>
          <Statistic title="حجوزات ماسكة رصيد" value={holdingCount} />
          <Statistic title="إجمالي الكمية المحجوزة" value={holdingQty} precision={3} />
        </Space>

        <ListToolbar
          searchPlaceholder="بحث برقم الحجز أو العميل أو الصنف"
          query={filter.query} onQueryChange={filter.setQuery}
          values={filter.values} onValueChange={filter.setValue}
          showDateRange range={filter.range} onRangeChange={filter.setRange}
          onReset={filter.reset} total={rows.length} shown={filter.filtered.length}
          filters={[
            { key: 'holding', placeholder: 'ماسك رصيد؟', span: 5, options: [
              { value: 'yes', label: 'ماسك' }, { value: 'no', label: 'مش ماسك' }] },
            { key: 'customer_id', placeholder: 'العميل', span: 6, options: customerOptions },
          ]}
        />

        <Table
          {...kb.tableProps}
          dataSource={filter.filtered} columns={cols.apply(columns)} rowKey="id" loading={loading}
          size="middle" tableLayout="fixed"
          locale={{ emptyText: 'مفيش حجوزات' }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true,
            showTotal: (t) => `الإجمالي: ${t}` }}
        />
      </Card>
      )}

      <PartyPickerModal
        open={newStep === 'customer' || customerPickerOpen} kind="customer"
        onPick={(party) => {
          setCustomerId(party.id); setCustomerPickerOpen(false);
          if (newStep === 'customer') { setNewStep(null); setCreating(true); }
        }}
        onCancel={() => { setCustomerPickerOpen(false); setNewStep(null); }} />

      <ProductPickerModal
        open={itemPickerOpen}
        title="اختر الصنف المحجوز"
        categories={[...new Set(items.map((i: any) => i.category).filter(Boolean))] as string[]}
        categoryLabels={categoryLabels}
        products={items}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        onCancel={() => setItemPickerOpen(false)}
        onPick={(id: number) => { setItemId(id); setItemPickerOpen(false); }} />

      {creating && (
      <Card title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setCreating(false)}>رجوع</Button>
          <span>حجز جديد</span>
        </Space>
      )}>
        <Form layout="vertical">
          <Row gutter={12}>
            <Col span={24}>
              {/* Both fields open the same windows the doors opened — one way to answer each
                  question, not two that can behave differently. */}
              <Form.Item label="العميل" required style={{ marginBottom: 12 }}>
                <Select showSearch optionFilterProp="label" placeholder="اختر العميل"
                  value={customerId} open={false} onClick={() => setCustomerPickerOpen(true)}
                  onChange={setCustomerId} options={customerOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="الصنف" required style={{ marginBottom: 12 }}>
                <Select showSearch optionFilterProp="label" placeholder="اختر الصنف"
                  value={itemId} open={false} onClick={() => setItemPickerOpen(true)}
                  onChange={setItemId}
                  options={items.map((i) => ({ value: i.id, label: i.name }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="المخزن" required style={{ marginBottom: 12 }}>
                <Select showSearch optionFilterProp="label" placeholder="اختر المخزن"
                  value={warehouseId} onChange={setWarehouseId}
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
              </Form.Item>
            </Col>
          </Row>

          {avail && (
            <Alert
              type={Number(avail.available) > 0 ? 'success' : 'warning'}
              style={{ marginBottom: 12 }}
              message={`المتاح للحجز: ${qty(avail.available)}`}
              description={Number(avail.reserved_for_others) > 0
                ? `الرصيد ${qty(avail.on_hand)}، منه ${qty(avail.reserved_for_others)} محجوزة لعملاء تانيين.`
                : `الرصيد ${qty(avail.on_hand)}، مفيش منه حاجة محجوزة.`}
            />
          )}

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="الكمية" required style={{ marginBottom: 12 }}>
                <InputNumber style={{ width: '100%' }} min={0} value={quantity} placeholder="—"
                  onChange={(v) => setQuantity(v as number | null)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="ينتهي في" required style={{ marginBottom: 12 }}
                help="بعد اليوم ده الرصيد بيرجع متاح لوحده">
                <DatePicker style={{ width: '100%' }} value={expiresOn} allowClear={false}
                  disabledDate={(d) => d && d < dayjs().startOf('day')}
                  onChange={(d) => setExpiresOn(d || dayjs().add(7, 'day'))} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="ملاحظات" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Form.Item>
        </Form>

        <div style={{
          marginTop: 16, padding: 16, borderRadius: 10,
          background: '#f6faf3', border: '1px solid #e6efe3',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <Button type="primary" size="large" loading={saving} onClick={submit}>تسجيل الحجز</Button>
          <Button size="large" onClick={() => setCreating(false)}>إلغاء</Button>
        </div>
      </Card>
      )}

      {/* الحجز مفتوح — نفس الصفحة، بكل اللي عليه مش بس أعمدة القايمة.
          A reservation holds stock back; it posts nothing. So the only decision on it is whether
          it still stands, and cancelling it releases the stock the same minute. */}
      {viewing && (
      <Card
        title={(
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />}
              onClick={() => setViewing(null)}>رجوع</Button>
            <span>{`حجز ${viewing.document_number}`}</span>
          </Space>
        )}
        extra={viewing.status === 'active' && (
          <Popconfirm title="إلغاء الحجز؟"
            description="الرصيد هيرجع متاح للبيع فوراً."
            okText="إلغاء الحجز" cancelText="رجوع"
            onConfirm={() => { cancel(viewing.id); setViewing(null); }}>
            <Button danger icon={<StopOutlined />}>إلغاء الحجز</Button>
          </Popconfirm>
        )}
      >
        {viewing && (
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="التاريخ">
              {String(viewing.created_at || '').slice(0, 10)}
            </Descriptions.Item>
            <Descriptions.Item label="ينتهي في">{viewing.expires_on}</Descriptions.Item>
            <Descriptions.Item label="العميل">
              <a onClick={() => navigate(`/customers/${viewing.customer_id}`)}>
                {viewing.customer_name ?? `عميل #${viewing.customer_id}`}
              </a>
            </Descriptions.Item>
            <Descriptions.Item label="الصنف">
              <a onClick={() => navigate(`/catalog/${viewing.item_id}`)}>
                {viewing.item_name ?? `صنف #${viewing.item_id}`}
              </a>
            </Descriptions.Item>
            <Descriptions.Item label="المخزن">{viewing.location_name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="الكمية"><b>{qty(viewing.quantity)}</b></Descriptions.Item>
            <Descriptions.Item label="الحالة">
              {viewing.status === 'converted' ? <Tag color="green">اتحوّل لفاتورة</Tag>
                : viewing.status === 'cancelled' ? <Tag>ملغي</Tag>
                  : viewing.holding ? <Tag color="purple">حاجز</Tag>
                    : <Tag>منتهي</Tag>}
            </Descriptions.Item>
            {/* The invoice it became. Returned by the API since holds were built and shown by
                nothing — «اتحوّل لفاتورة» was a label with no way to reach the فاتورة. */}
            <Descriptions.Item label="الفاتورة">
              {viewing.sales_invoice_id
                ? <DocRef kind="invoice" id={viewing.sales_invoice_id} label={null} />
                : <span style={{ color: '#8c8c8c' }}>-</span>}
            </Descriptions.Item>
            <Descriptions.Item label="ملاحظات" span={2}>
              {viewing.notes || <span style={{ color: '#8c8c8c' }}>-</span>}
            </Descriptions.Item>
          </Descriptions>
        )}

        <div style={{ marginTop: 16, textAlign: 'left' }}>
          <Button size="large" onClick={() => setViewing(null)}>إغلاق</Button>
        </div>
      </Card>
      )}
    </div>
  );
}

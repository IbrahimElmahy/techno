import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Drawer, Input, InputNumber, Modal,
  Popconfirm, Row, Segmented, Select, Space, Table, Tag, message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useQueryTab } from '../components/useQueryTab';
import DocumentLink from '../components/DocumentLink';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import ProductPickerModal from '../components/ProductPickerModal';
import PartyPickerModal from '../components/PartyPickerModal';
import { useLookup, labelMap } from '../hooks/useLookup';

/**
 * طلبات البيع والشراء — the paperwork that exists before the trade.
 *
 * An order moves no stock, owes no money and reserves nothing, which is precisely why it can be
 * written for goods that have not arrived yet. It becomes an invoice at most once: converting a
 * second time would double the sale, so the screen stamps the link and then refuses.
 */

type Kind = 'sale' | 'purchase';

interface OrderLine {
  id: number; item_id: number; item_name: string | null;
  quantity: string; unit_price: string; line_total: string; notes: string | null;
}

interface Order {
  id: number; document_number: string; kind: Kind; status: string;
  customer_id: number | null; supplier_id: number | null;
  order_date: string | null; due_date: string | null; warehouse_id: number | null;
  total: string; notes: string | null;
  converted_invoice_id: number | null; converted_at: string | null;
  created_at: string | null; lines: OrderLine[];
}

interface DraftLine { key: number; item_id?: number; quantity?: number; unit_price?: number }

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

const STATUS_LABELS: Record<string, { text: string; color?: string }> = {
  open: { text: 'مفتوح', color: 'blue' },
  converted: { text: 'اتحوّل لفاتورة', color: 'green' },
  cancelled: { text: 'ملغي' },
};

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Order | null>(null);

  const [creating, setCreating] = useState(false);
  // «طلب بيع» and «طلب شراء» are two entries in their menu and one screen here.
  const [kind, setKind] = useQueryTab('sale', 'kind') as unknown as [Kind, (k: Kind) => void];
  const [partyId, setPartyId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [dueDate, setDueDate] = useState<Dayjs | null>(null);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  // The doors, in the order the paper form asks: which kind of order, then who, then what.
  const [newStep, setNewStep] = useState<null | 'party'>(null);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusLineKey, setFocusLineKey] = useState<number | null>(null);
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [invoiceId, setInvoiceId] = useState<number | undefined>();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/orders');
      setOrders(res.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    Promise.all([
      api.get('/api/v1/items'), api.get('/api/v1/customers'),
      api.get('/api/v1/suppliers'), api.get('/api/v1/warehouses'),
    ]).then(([i, c, s, w]) => {
      setItems(i.data || []); setCustomers(c.data || []);
      setSuppliers(s.data || []); setWarehouses(w.data || []);
    }).catch(console.error);
  }, []);

  useEffect(() => { setPartyId(undefined); }, [kind]);

  const filter = useListFilter(orders, {
    // «طلب بيع» and «طلب شراء» are two screens in their menu. The kind belongs on the list, not
    // only inside the create dialog — an entry that shows both kinds is not the screen it names.
    initialValues: { kind },
    search: (o) => [o.document_number, o.notes],
    filters: {
      kind: (o, v) => o.kind === v,
      status: (o, v) => o.status === v,
    },
    dateOf: (o) => o.created_at,
  });

  const partyName = (o: Order) => (o.kind === 'sale'
    ? customers.find((c) => c.id === o.customer_id)?.name
    : suppliers.find((s) => s.id === o.supplier_id)?.name) || '-';

  const draftTotal = lines.reduce(
    (sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);

  /** One way in — the list buttons and F2 both come through here. */
  const startNew = (k: Kind) => {
    setKind(k); setPartyId(undefined); setLines([]); setCreating(false); setNewStep('party');
  };

  const addItem = (itemId: number) => {
    setPickerOpen(false);
    const key = (lines[lines.length - 1]?.key ?? 0) + 1;
    const it = items.find((i) => i.id === itemId);
    // An order is a price quoted in advance, so the line opens on the item's own price rather
    // than empty — the person is confirming a number, not inventing one.
    setLines((prev) => [...prev, { key, item_id: itemId,
      unit_price: Number(kind === 'sale' ? it?.sale_price_1 : it?.purchase_price) || undefined }]);
    setFocusLineKey(key);
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
    if (!partyId) { message.warning(kind === 'sale' ? 'اختر العميل' : 'اختر المورد'); return; }
    const payload = lines
      .filter((l) => l.item_id && Number(l.quantity) > 0)
      .map((l) => ({
        item_id: l.item_id, quantity: String(l.quantity),
        unit_price: String(l.unit_price ?? 0),
      }));
    if (!payload.length) { message.warning('أضف سطراً واحداً على الأقل'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/orders', {
        kind,
        customer_id: kind === 'sale' ? partyId : null,
        supplier_id: kind === 'purchase' ? partyId : null,
        warehouse_id: warehouseId ?? null,
        order_date: dayjs().format('YYYY-MM-DD'),
        due_date: dueDate ? dueDate.format('YYYY-MM-DD') : null,
        notes: notes || null, lines: payload,
      });
      message.success('اتسجّل الطلب');
      setCreating(false);
      setLines([{ key: 1 }]); setNotes(''); setDueDate(null); setWarehouseId(undefined);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ الطلب');
    } finally { setSaving(false); }
  };

  const convert = async () => {
    if (!detail || !invoiceId) { message.warning('اكتب رقم الفاتورة'); return; }
    try {
      await api.post(`/api/v1/orders/${detail.id}/convert`, { invoice_id: invoiceId });
      message.success('اتربط الطلب بالفاتورة');
      setDetail(null); setInvoiceId(undefined); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر ربط الطلب');
    }
  };

  const cancel = async (o: Order) => {
    try {
      await api.post(`/api/v1/orders/${o.id}/cancel`);
      message.success('اتلغى الطلب');
      setDetail(null); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إلغاء الطلب');
    }
  };

  return (
    <Card
      title="طلبات البيع والشراء"
      extra={(
        <Space>
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
            onClick={() => startNew('sale')}>طلب بيع</Button>
          <Button icon={<PlusOutlined />}
            onClick={() => startNew('purchase')}>طلب شراء</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="الطلب ما بيحرّكش مخزون ولا بيسجّل مديونية."
        description="ده مستند قبل البيع — ينفع يتكتب لبضاعة لسه ما وصلتش، ولما يتأكد بتعمل الفاتورة وتربطها بيه."
      />

      <ListToolbar
        searchPlaceholder="بحث برقم الطلب أو الملاحظات"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        showDateRange range={filter.range} onRangeChange={filter.setRange}
        onReset={filter.reset} total={orders.length} shown={filter.filtered.length}
        filters={[
          { key: 'kind', placeholder: 'النوع', options: [
            { value: 'sale', label: 'طلب بيع' }, { value: 'purchase', label: 'طلب شراء' }] },
          { key: 'status', placeholder: 'الحالة', options: [
            { value: 'open', label: 'مفتوح' },
            { value: 'converted', label: 'اتحوّل' },
            { value: 'cancelled', label: 'ملغي' }] },
        ]}
      />

      <Table<Order>
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد طلبات' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: 'رقم الطلب', dataIndex: 'document_number',
            render: (v: string) => <Tag>{v}</Tag> },
          { title: 'النوع', dataIndex: 'kind',
            render: (k: Kind) => (k === 'sale'
              ? <Tag color="green">بيع</Tag> : <Tag color="purple">شراء</Tag>) },
          { title: 'الطرف', render: (_: any, r: Order) => partyName(r) },
          { title: 'التاريخ', dataIndex: 'order_date',
            render: (d: string, r) => (d || r.created_at || '').slice(0, 10) },
          { title: 'الاستحقاق', dataIndex: 'due_date',
            render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
          { title: 'عدد الأصناف', dataIndex: 'lines',
            render: (l: OrderLine[]) => l.length },
          { title: 'الإجمالي', dataIndex: 'total', align: 'left',
            render: (v: string) => <b>{money(v)}</b> },
          { title: 'الحالة', dataIndex: 'status',
            render: (s: string, r) => (
              <>
                <Tag color={STATUS_LABELS[s]?.color}>{STATUS_LABELS[s]?.text || s}</Tag>
                {r.converted_invoice_id && (
                  <DocumentLink kind="invoice" id={r.converted_invoice_id} size="small"
                    label={`فاتورة #${r.converted_invoice_id}`} />
                )}
              </>
            ) },
        ]}
      />

      {/* The doors and the window. Declared once and rendered here, above the create modal, so
          neither can unmount the other by opening. */}
      <PartyPickerModal
        open={newStep === 'party' || partyPickerOpen}
        kind={kind === 'sale' ? 'customer' : 'supplier'}
        onPick={(party) => {
          setPartyId(party.id); setPartyPickerOpen(false);
          if (newStep === 'party') { setNewStep(null); setCreating(true); }
        }}
        onCancel={() => { setPartyPickerOpen(false); setNewStep(null); }} />

      <ProductPickerModal
        open={pickerOpen}
        title={kind === 'sale' ? 'اختر الصنف المطلوب' : 'اختر الصنف المطلوب شراؤه'}
        categories={[...new Set(items.map((i) => i.category).filter(Boolean))] as string[]}
        categoryLabels={categoryLabels}
        products={items.filter((i) => !lines.some((l) => l.item_id === i.id))}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        onCancel={() => setPickerOpen(false)}
        onPick={addItem} />

      <Modal
        open={creating} onCancel={() => setCreating(false)} onOk={submit}
        confirmLoading={saving} width={840} destroyOnHidden
        title={kind === 'sale' ? 'طلب بيع جديد' : 'طلب شراء جديد'}
        okText="حفظ الطلب" cancelText="إلغاء"
      >
        {/* Changing the kind asks «مين» again rather than keeping the answer. A customer is not a
            supplier, and `submit` sends the party under whichever field the kind chose — so a
            silently kept party would have been dropped on save with nothing said. */}
        <Segmented
          block value={kind}
          onChange={(v) => { setKind(v as Kind); setPartyId(undefined); setLines([]);
            setNewStep('party'); }}
          style={{ marginBottom: 12 }}
          options={[
            { value: 'sale', label: 'طلب بيع (عميل)' },
            { value: 'purchase', label: 'طلب شراء (مورد)' },
          ]}
        />

        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            {/* The field opens the same window the door opened, so there is one way to answer
                «مين» — the way it was first answered. */}
            <Select
              showSearch optionFilterProp="label" style={{ width: '100%' }}
              placeholder={kind === 'sale' ? 'العميل' : 'المورد'}
              value={partyId} open={false}
              onClick={() => setPartyPickerOpen(true)}
              onChange={setPartyId}
              options={(kind === 'sale' ? customers : suppliers)
                .map((p) => ({ value: p.id, label: p.name }))}
            />
          </Col>
          <Col xs={24} md={8}>
            <Select allowClear style={{ width: '100%' }} placeholder="المخزن (اختياري)"
              value={warehouseId} onChange={setWarehouseId}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          </Col>
          <Col xs={24} md={8}>
            <DatePicker style={{ width: '100%' }} value={dueDate} onChange={setDueDate}
              placeholder="تاريخ الاستحقاق" />
          </Col>
        </Row>

        <Table<DraftLine>
          size="small" rowKey="key" dataSource={lines} pagination={false}
          style={{ marginBottom: 12 }}
          columns={[
            // Picked in the window; the line knows its item before it exists.
            { title: 'الصنف', dataIndex: 'item_id', width: '45%',
              render: (v: any) => items.find((i) => i.id === v)?.name ?? `صنف #${v}` },
            { title: 'الكمية', dataIndex: 'quantity', width: 130,
              render: (v, r) => (
                <InputNumber min={0} style={{ width: '100%' }} value={v}
                  data-qty-key={r.key} data-grid-col="qty" keyboard={false}
                  onPressEnter={(e) => { e.preventDefault(); setPickerOpen(true); }}
                  onChange={(q) => setLines((prev) => prev.map((l) => (l.key === r.key
                    ? { ...l, quantity: q as number } : l)))} />
              ) },
            { title: 'السعر', dataIndex: 'unit_price', width: 140,
              render: (v, r) => (
                <InputNumber min={0} style={{ width: '100%' }} value={v}
                  data-grid-col="price" keyboard={false}
                  onChange={(p) => setLines((prev) => prev.map((l) => (l.key === r.key
                    ? { ...l, unit_price: p as number } : l)))} />
              ) },
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
              <span>الإجمالي: <b>{money(draftTotal)}</b></span>
            </Space>
          )}
        />

        <Input.TextArea rows={2} placeholder="ملاحظات" value={notes}
          onChange={(e) => setNotes(e.target.value)} />
      </Modal>

      <Drawer
        open={!!detail} onClose={() => setDetail(null)} width={640}
        title={detail?.document_number}
        extra={detail?.status === 'open' && (
          <Popconfirm title="إلغاء الطلب؟" onConfirm={() => cancel(detail)}
            okText="إلغاء الطلب" cancelText="رجوع">
            <Button danger>إلغاء الطلب</Button>
          </Popconfirm>
        )}
      >
        {detail && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="النوع">
                {detail.kind === 'sale' ? 'طلب بيع' : 'طلب شراء'}
              </Descriptions.Item>
              <Descriptions.Item label="الطرف">{partyName(detail)}</Descriptions.Item>
              <Descriptions.Item label="الاستحقاق">
                {detail.due_date ? String(detail.due_date).slice(0, 10) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="الإجمالي"><b>{money(detail.total)}</b></Descriptions.Item>
              <Descriptions.Item label="الحالة">
                <Tag color={STATUS_LABELS[detail.status]?.color}>
                  {STATUS_LABELS[detail.status]?.text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="ملاحظات">{detail.notes || '-'}</Descriptions.Item>
            </Descriptions>

            <Table<OrderLine>
              rowKey="id" size="small" dataSource={detail.lines} pagination={false}
              style={{ marginBottom: 12 }}
              columns={[
                { title: 'الصنف', dataIndex: 'item_name' },
                { title: 'الكمية', dataIndex: 'quantity', render: (v: string) => qty(v) },
                { title: 'السعر', dataIndex: 'unit_price', render: (v: string) => money(v) },
                { title: 'الإجمالي', dataIndex: 'line_total',
                  render: (v: string) => <b>{money(v)}</b> },
              ]}
            />

            {detail.status === 'open' && (
              <Card size="small" title="ربط بفاتورة">
                <Space wrap>
                  <InputNumber placeholder="رقم الفاتورة" value={invoiceId}
                    onChange={(v) => setInvoiceId(v as number)} style={{ width: 160 }} />
                  <Button type="primary" onClick={convert}>ربط</Button>
                </Space>
                <div style={{ color: '#888', marginTop: 8 }}>
                  اعمل الفاتورة من شاشة الفواتير الأول عشان تعدّي على كل الفحوصات (التوافر
                  والتكلفة والقيد)، وبعدين اربطها بالطلب هنا. الربط بيحصل مرة واحدة بس.
                </div>
              </Card>
            )}

            {detail.converted_invoice_id && (
              <Alert type="success" showIcon
                message={`اتحوّل لفاتورة رقم #${detail.converted_invoice_id}`}
                action={<DocumentLink kind="invoice" id={detail.converted_invoice_id}
                  size="small" allowEdit onNavigate={() => setDetail(null)} />} />
            )}
          </>
        )}
      </Drawer>
    </Card>
  );
}

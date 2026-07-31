import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Modal,
  Popconfirm, Row, Segmented, Select, Space, Table, Tabs, Tag, message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useQueryTab } from '../components/useQueryTab';
import ListToolbar, { useListFilter } from '../components/ListToolbar';

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
  const [detail, setDetail] = useState<Permit | null>(null);

  const [creating, setCreating] = useState(false);
  // «أول المدة» is a screen of its own in their menu. Here it is one of three permit kinds, so
  // that entry opens this screen with the kind already chosen rather than on إذن إضافة.
  const [kind, setKind] = useQueryTab('receipt') as unknown as [Kind, (k: Kind) => void];
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [permitDate, setPermitDate] = useState<Dayjs>(dayjs());
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1 }]);
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
    setLines([{ key: 1 }]); setReason(''); setNotes('');
    setPermitDate(dayjs()); setWarehouseId(undefined);
  };

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

  const reverse = async (p: Permit) => {
    try {
      await api.post(`/api/v1/stock/permits/${p.id}/reverse`);
      message.success('اتعكس الإذن');
      setDetail(null); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر عكس الإذن');
    }
  };

  const draftTotal = lines.reduce(
    (sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);

  const createForm = (
    <Modal
      open={creating} onCancel={() => setCreating(false)} onOk={submit}
      confirmLoading={saving} width={860} destroyOnHidden
      title={kind === 'issue' ? 'إذن صرف مخزني'
        : kind === 'opening' ? 'بضاعة أول المدة' : 'إذن إضافة مخزني'}
      okText="ترحيل الإذن" cancelText="إلغاء"
    >
      <Segmented
        block value={kind} onChange={(v) => { setKind(v as Kind); setLines([{ key: 1 }]); }}
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
          { title: 'الصنف', dataIndex: 'item_id', width: '40%',
            render: (v, r) => (
              <Select
                showSearch optionFilterProp="label" style={{ width: '100%' }}
                placeholder="اختر الصنف" value={v}
                onChange={(id) => setLines((prev) => prev.map((l) => (l.key === r.key
                  ? { ...l, item_id: id } : l)))}
                options={(kind === 'issue' && warehouseId
                  ? items.filter((i) => available[i.id] > 0) : items)
                  .map((i) => ({
                    value: i.id,
                    label: kind === 'issue' && available[i.id] !== undefined
                      ? `${i.name} — متاح ${qty(available[i.id])}` : i.name,
                  }))}
              />
            ) },
          { title: 'الكمية', dataIndex: 'quantity', width: 140,
            render: (v, r) => (
              <InputNumber
                min={0} style={{ width: '100%' }} value={v}
                max={kind === 'issue' && r.item_id ? available[r.item_id] : undefined}
                onChange={(q) => setLines((prev) => prev.map((l) => (l.key === r.key
                  ? { ...l, quantity: q as number } : l)))}
              />
            ) },
          ...(kind !== 'issue' ? [{
            title: 'تكلفة الوحدة', dataIndex: 'unit_cost', width: 160,
            render: (v: any, r: DraftLine) => (
              <InputNumber
                min={0} style={{ width: '100%' }} value={v} placeholder="من التكلفة الحالية"
                onChange={(c) => setLines((prev) => prev.map((l) => (l.key === r.key
                  ? { ...l, unit_cost: c as number } : l)))}
              />
            ) }] : []),
          { title: '', width: 50,
            render: (_: any, r: DraftLine) => (
              <Button type="text" danger icon={<DeleteOutlined />}
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== r.key))} />
            ) },
        ]}
        footer={() => (
          <Space>
            <Button icon={<PlusOutlined />} size="small"
              onClick={() => setLines((prev) => [
                ...prev, { key: Math.max(...prev.map((l) => l.key)) + 1 }])}>
              سطر جديد
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
    </Modal>
  );

  return (
    <Card
      title="أذونات المخزن"
      extra={(
        <Space>
          <Button type="primary" icon={<PlusOutlined />}
            onClick={() => { setKind('receipt'); setCreating(true); }}>إذن إضافة</Button>
          <Button icon={<PlusOutlined />}
            onClick={() => { setKind('issue'); setCreating(true); }}>إذن صرف</Button>
          <Button icon={<PlusOutlined />}
            onClick={() => { setKind('opening'); setCreating(true); }}>بضاعة أول المدة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      {createForm}

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
        onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد أذونات' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
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
        ]}
      />

      <Drawer
        open={!!detail} onClose={() => setDetail(null)} width={640}
        title={detail?.document_number}
        extra={detail && !detail.is_reversal && !detail.reversed_by && (
          <Popconfirm title="عكس الإذن؟" description="هيترجّع المخزون زي ما كان."
            onConfirm={() => reverse(detail)} okText="عكس" cancelText="إلغاء">
            <Button danger icon={<RollbackOutlined />}>عكس الإذن</Button>
          </Popconfirm>
        )}
      >
        {detail && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="النوع">
                {detail.kind === 'receipt' ? 'إذن إضافة' : 'إذن صرف'}
              </Descriptions.Item>
              <Descriptions.Item label="المخزن">{detail.warehouse_name}</Descriptions.Item>
              <Descriptions.Item label="التاريخ">
                {(detail.permit_date || detail.created_at || '').slice(0, 10)}
              </Descriptions.Item>
              <Descriptions.Item label="السبب">{detail.reason || '-'}</Descriptions.Item>
              <Descriptions.Item label="ملاحظات">{detail.notes || '-'}</Descriptions.Item>
              <Descriptions.Item label="إجمالي التكلفة">
                <b>{money(detail.total_cost)}</b>
              </Descriptions.Item>
            </Descriptions>
            <Table<PermitLine>
              rowKey="id" size="small" dataSource={detail.lines} pagination={false}
              columns={[
                { title: 'الصنف', dataIndex: 'item_name' },
                { title: 'الكمية', dataIndex: 'quantity', render: (v: string) => qty(v) },
                { title: 'تكلفة الوحدة', dataIndex: 'unit_cost',
                  render: (v: string) => money(v) },
                { title: 'الإجمالي', dataIndex: 'line_cost',
                  render: (v: string) => <b>{money(v)}</b> },
              ]}
            />
          </>
        )}
      </Drawer>
    </Card>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Empty, Input, Row, Segmented, Select,
  Space, Statistic, Table, Tabs, Tag, Typography, message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { InputNumber } from '../components/NumberInput';
import {
  DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DocumentLink from '../components/DocumentLink';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useLookup } from '../hooks/useLookup';

type Status = 'valid' | 'unknown' | 'received' | 'checking' | 'pending';

interface Entry {
  serial: string;
  status: Status;
  customerId?: number | null;
  customerName?: string | null;
  documentNumber?: string | null;
}

interface Receipt {
  id: number;
  document_number: string;
  customer_id: number | null;
  rep_user_id: number | null;
  received_date: string | null;
  coupon_count: number;
  notes: string | null;
  lines: { id: number; serial: string; sales_invoice_id: number }[];
}

const FALLBACK_KINDS = [
  { value: 'عادي', label: 'عادي' },
  { value: 'فضي', label: 'فضي' },
  { value: 'ذهبي', label: 'ذهبي' },
  { value: 'ماسي', label: 'ماسي' },
];

export default function CouponReceipts() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rangeFrom, setRangeFrom] = useState<number | null>(null);
  const [rangeTo, setRangeTo] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customers, setCustomers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const [receivedDate, setReceivedDate] = useState<Dayjs>(dayjs());
  const [kind, setKind] = useState<string>('عادي');
  const [value, setValue] = useState<number | null>(null);
  const [customerType, setCustomerType] = useState<string>('plumber');

  const { options: kindLookup } = useLookup('coupon_kind');
  const kindOptions = kindLookup.length ? kindLookup.map((o) => ({ value: o.value, label: o.label })) : FALLBACK_KINDS;
  useEffect(() => {
    if (kindLookup.length && !kindLookup.some((o) => o.value === kind)) {
      setKind(kindLookup[0].value);
    }
  }, [kindLookup, kind]);
  const kindLabel = (k: string) => kindOptions.find((o) => o.value === k)?.label ?? k;

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Receipt | null>(null);

  const clientUuid = useRef<string>(crypto.randomUUID());

  const loadReceipts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/coupon-receipts');
      setReceipts(res.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => {
    loadReceipts();
    api.get('/api/v1/customers').then((r) => setCustomers(r.data || [])).catch(console.error);
  }, []);

  const customerName = (id: number | null) =>
    customers.find((c) => c.id === id)?.name ?? (id ? `عميل #${id}` : '-');

  const addSerial = async (raw: string) => {
    const serial = String(raw).trim();
    if (!serial) return;
    if (entries.some((e) => e.serial === serial)) {
      message.warning('الكوبون ده مضاف بالفعل');
      return;
    }
    setEntries((prev) => [{ serial, status: 'checking' }, ...prev]);
    try {
      const res = await api.get('/api/v1/coupon-receipts/check', { params: { serial } });
      const d = res.data;
      setEntries((prev) => prev.map((e) => (e.serial === serial ? {
        serial,
        status: (d.status as Status) || 'unknown',
        customerId: d.customer_id,
        customerName: d.customer_name,
        documentNumber: d.document_number,
      } : e)));
      if (d.status === 'valid' && !customerId && d.customer_id) setCustomerId(d.customer_id);
      if (d.status === 'unknown') message.warning(`الكوبون ${serial} مش متصرّف من النظام`);
      if (d.status === 'received') message.warning(`الكوبون ${serial} اتستلم قبل كده`);
      if (customerId && d.status === 'valid' && d.customer_id && d.customer_id !== customerId) {
        message.warning(`الكوبون ${serial} متصرّف لعميل تاني`);
      }
    } catch (err: any) {
      setEntries((prev) => prev.map((e) => (e.serial === serial ? { ...e, status: 'pending' } : e)));
      message.warning(`الكوبون ${serial} هيتراجع مع الحفظ (${err?.message || 'انقطاع'})`);
    }
  };

  const addRange = async () => {
    if (rangeFrom === null || rangeTo === null) { message.warning('النطاق لازم يكون أرقام'); return; }
    if (rangeTo < rangeFrom) { message.warning('رقم النهاية أصغر من البداية'); return; }
    if (rangeTo - rangeFrom + 1 > 2000) { message.warning('النطاق كبير — أقصى ٢٠٠٠ كوبون في المرة'); return; }
    const from = rangeFrom; const to = rangeTo;
    setRangeFrom(null); setRangeTo(null);
    for (let n = from; n <= to; n += 1) {
      await addSerial(String(n));
    }
  };

  const good = entries.filter((e) => e.status === 'valid');
  const rejects = entries.filter((e) => e.status === 'unknown' || e.status === 'received');
  const offline = entries.filter((e) => e.status === 'pending' || e.status === 'checking');
  const counted = [...good, ...offline];
  const mismatched = customerId
    ? good.filter((e) => e.customerId && e.customerId !== customerId)
    : [];
  const totalValue = (value ?? 0) * counted.length;

  const save = async () => {
    if (!entries.length) { message.warning('مافيش كوبونات'); return; }
    if (rejects.length) { message.warning('شيل الكوبونات المرفوضة الأول'); return; }
    if (mismatched.length) { message.warning('فيه كوبونات لعميل تاني'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/coupon-receipts', {
        serials: counted.map((e) => e.serial),
        customer_id: customerId ?? null,
        notes: notes.trim() || null,
        client_uuid: clientUuid.current,
        received_date: receivedDate.format('YYYY-MM-DD'),
        declared_kind: kind,
        declared_value: value,
        customer_type: customerType,
      });
      message.success('اتسجّل الاستلام واترفع للسيرفر');
      setEntries([]); setNotes(''); setCustomerId(undefined);
      setValue(null); setKind(kindOptions[0]?.value ?? 'عادي'); setCustomerType('plumber');
      setReceivedDate(dayjs());
      clientUuid.current = crypto.randomUUID();
      loadReceipts();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل الاستلام');
    } finally { setSaving(false); }
  };

  const filter = useListFilter(receipts, {
    search: (r) => [r.document_number, r.notes,
      ...r.lines.map((l) => l.serial)],
  });

  const statusChip = (e: Entry) => {
    switch (e.status) {
      case 'valid':
        return <Tag color="green">{e.customerName || 'سليم'}</Tag>;
      case 'unknown':
        return <Tag color="red">مش متصرّف من النظام</Tag>;
      case 'received':
        return <Tag color="orange">اتستلم قبل كده</Tag>;
      case 'checking':
        return <Tag>بيتراجع…</Tag>;
      default:
        return <Tag color="geekblue">هيتراجع مع المزامنة</Tag>;
    }
  };

  const listColumns = [
    { title: 'رقم المستند', dataIndex: 'document_number',
      render: (v: string) => <Tag>{v}</Tag> },
    { title: 'العميل', dataIndex: 'customer_id',
      render: (id: number | null) => customerName(id) },
    { title: 'التاريخ', dataIndex: 'received_date',
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'عدد الكوبونات', dataIndex: 'coupon_count',
      render: (v: number) => <b style={{ color: '#F5A11D' }}>{v}</b> },
    { title: 'ملاحظات', dataIndex: 'notes', render: (v: string) => v || '-' },
  ];

  const listCols = useTableColumns('coupon-receipts', listColumns);

  // Read-only on purpose: a receipt is the act that spends coupons — un-spending one by editing
  // the paper would leave the system counting a coupon the customer already handed over.

  const receiveTab = (
    <Card
      title="تسجيل استلام جديد"
      extra={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { setEntries([]); setNotes(''); setCustomerId(undefined); }}>
            تفريغ
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving}
            disabled={!counted.length || !!rejects.length || !!mismatched.length}
            onClick={save}>
            تسجيل الاستلام
          </Button>
        </Space>
      )}
    >
      <Row gutter={[8, 8]}>
        <Col xs={24} md={5}>
          <DatePicker
            style={{ width: '100%' }} allowClear={false} format="YYYY/MM/DD"
            placeholder="تاريخ الاستلام"
            value={receivedDate} onChange={(d) => d && setReceivedDate(d)}
            disabledDate={(d) => d.isAfter(dayjs().add(1, 'day'), 'day')}
          />
        </Col>
        <Col xs={12} md={5}>
          <Select style={{ width: '100%' }} placeholder="نوع الكوبون" value={kind}
            onChange={setKind}
            options={kindOptions} />
        </Col>
        <Col xs={12} md={5}>
          <InputNumber
            style={{ width: '100%' }} placeholder="قيمة الكوبون" min={0}
            addonAfter="ج.م" value={value} onChange={(v) => setValue(v as number | null)}
          />
        </Col>
        <Col xs={24} md={9}>
          <Segmented
            style={{ width: '100%', display: 'flex' }}
            value={customerType} onChange={(v) => setCustomerType(v as string)}
            options={[
              { value: 'plumber', label: 'سباك' },
              { value: 'merchant', label: 'تاجر' },
            ]}
          />
        </Col>
      </Row>

      <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
        <Col xs={24} md={8}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="العميل — بيتحدد لوحده من أول كوبون سليم"
            value={customerId} onChange={setCustomerId}
            options={customers.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Col>
        <Col xs={8} md={4}>
          <InputNumber
            style={{ width: '100%' }} placeholder="من رقم" precision={0}
            value={rangeFrom} onChange={(v) => setRangeFrom(v as number | null)}
            onPressEnter={addRange}
          />
        </Col>
        <Col xs={8} md={4}>
          <InputNumber
            style={{ width: '100%' }} placeholder="إلى رقم" precision={0}
            value={rangeTo} onChange={(v) => setRangeTo(v as number | null)}
            onPressEnter={addRange}
          />
        </Col>
        <Col xs={8} md={4}>
          <Button type="primary" icon={<PlusOutlined />} onClick={addRange} block>
            إضافة النطاق
          </Button>
        </Col>
      </Row>

      {customerId != null && (
        <Alert type="success" showIcon={false} style={{ marginTop: 8 }}
          message={`العميل: ${customerName(customerId)}`} />
      )}

      <Table<Entry>
        rowKey="serial" size="small" dataSource={entries} pagination={false}
        locale={{ emptyText: 'مافيش كوبونات مضافة' }}
        scroll={{ y: 320 }} style={{ marginTop: 12 }}
        columns={[
          { title: 'رقم الكوبون', dataIndex: 'serial',
            render: (v: string) => <b>{v}</b> },
          { title: 'الحالة', dataIndex: 'status',
            render: (_: any, r: Entry) => statusChip(r) },
          { title: 'الفاتورة', dataIndex: 'documentNumber',
            render: (v: string) => (v ? <Tag>{v}</Tag> : '-') },
          { title: '', width: 50,
            render: (_: any, r: Entry) => (
              <Button type="text" danger icon={<DeleteOutlined />}
                onClick={() => setEntries((prev) =>
                  prev.filter((e) => e.serial !== r.serial))} />
            ) },
        ]}
      />

      {counted.length > 0 && (
        <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
          <Col xs={8} md={5}>
            <Card size="small">
              <Statistic title="نوع الكوبون" value={kindLabel(kind)} />
            </Card>
          </Col>
          <Col xs={8} md={5}>
            <Card size="small">
              <Statistic title="عدد الكوبونات" value={counted.length} />
            </Card>
          </Col>
          <Col xs={8} md={5}>
            <Card size="small">
              <Statistic title="الإجمالي" value={totalValue.toFixed(2)} suffix="ج.م"
                valueStyle={{ color: totalValue > 0 ? '#6AB42D' : undefined }} />
            </Card>
          </Col>
        </Row>
      )}

      <Input.TextArea rows={2} placeholder="ملاحظات (اختياري)" value={notes}
        style={{ marginTop: 12 }} onChange={(e) => setNotes(e.target.value)} />

      {rejects.length > 0 && (
        <Alert type="error" showIcon style={{ marginTop: 12 }}
          message={`فيه ${rejects.length} كوبون مرفوض`}
          description="شيلهم من القائمة الأول — الكوبون الواحد الغلط بيرفض الاستلام كله." />
      )}
      {mismatched.length > 0 && (
        <Alert type="warning" showIcon style={{ marginTop: 12 }}
          message="فيه كوبونات متصرّفة لعميل تاني"
          description="الاستلام الواحد لعميل واحد؛ اعمل استلام منفصل للباقي." />
      )}

      <div style={{ marginTop: 12 }}>
        <Typography.Text strong type={rejects.length ? 'danger' : 'success'}>
          مقبول {good.length}
          {offline.length > 0 ? ` · بانتظار الاتصال ${offline.length}` : ''}
          {rejects.length ? ' · فيه مرفوض' : ''}
        </Typography.Text>
      </div>
    </Card>
  );

  const detailBody = detail && (
    <>
      <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label="رقم المستند">
          <Tag>{detail.document_number}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="العميل">
          {customerName(detail.customer_id)}
        </Descriptions.Item>
        <Descriptions.Item label="التاريخ">
          {detail.received_date ? String(detail.received_date).slice(0, 10) : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="العدد">{detail.coupon_count}</Descriptions.Item>
        <Descriptions.Item label="ملاحظات" span={2}>{detail.notes || '-'}</Descriptions.Item>
      </Descriptions>
      {detail.lines.length ? (
        <Table
          rowKey="id" size="small" dataSource={detail.lines} pagination={false}
          columns={[
            { title: 'رقم الكوبون', dataIndex: 'serial',
              render: (v: string) => <b>{v}</b> },
            { title: 'من فاتورة', dataIndex: 'sales_invoice_id',
              render: (v: number) => (v
                ? <DocumentLink kind="invoice" id={v} size="small" label={`#${v}`}
                    onNavigate={() => setDetail(null)} />
                : <Tag>غير معروفة</Tag>) },
          ]}
        />
      ) : <Empty description="لا توجد سطور" />}
    </>
  );

  const historyTab = detail ? (
    <Card
      title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setDetail(null)}>رجوع</Button>
          <span>{detail.document_number}</span>
        </Space>
      )}
      extra={(
        <Button onClick={() => setDetail(null)}>إغلاق</Button>
      )}
    >
      {detailBody}
    </Card>
  ) : (
    <Card size="small" title="سجل الاستلامات"
      extra={(
        <Space>
          {listCols.control}
          <Button icon={<ReloadOutlined />} onClick={loadReceipts}>تحديث</Button>
        </Space>
      )}>
      <ListToolbar
        searchPlaceholder="بحث برقم المستند أو رقم كوبون"
        query={filter.query} onQueryChange={filter.setQuery} onReset={filter.reset}
        total={receipts.length} shown={filter.filtered.length} searchSpan={10}
      />
      <Table<Receipt>
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        onRow={(r) => ({ onClick: () => setDetail(r), style: { cursor: 'pointer' } })}
        locale={{ emptyText: 'لا توجد استلامات' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={listCols.columns}
      />
    </Card>
  );

  return (
    <Card title="استلام الكوبونات">
      <Tabs items={[
        { key: 'receive', label: 'استلام كوبونات', children: receiveTab },
        { key: 'history', label: `السجل (${receipts.length})`, children: historyTab },
      ]} />
    </Card>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Card, Col, Descriptions, Drawer, Empty, Input, InputNumber, Row, Select, Space,
  Statistic, Table, Tabs, Tag, message,
} from 'antd';
import {
  DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DocumentLink from '../components/DocumentLink';
import ListToolbar, { useListFilter } from '../components/ListToolbar';

/**
 * استلام الكوبونات من العملاء — the counter's version of what the rep does at the door.
 *
 * A coupon is a piece of paper with a number on it, and the number alone proves nothing: anyone
 * can write one. It only counts if it falls inside the serial range issued on a real invoice to
 * that customer. So each serial is checked AS IT IS TYPED, not when the handover is saved — the
 * cashier finds out a coupon is bad while the customer is still at the counter, which is the only
 * moment that information is worth anything.
 *
 * The screen never accepts a coupon on its own authority: the server re-checks every serial when
 * the receipt is posted, and one bad coupon fails the whole handover rather than taking the good
 * ones — a half-accepted handover is worse than a rejected one, because the customer walks away
 * believing all of it went through.
 */

type Status = 'valid' | 'unknown' | 'received' | 'checking';

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

const STATUS_TAG: Record<Status, { color?: string; text: string }> = {
  valid: { color: 'green', text: 'سليم' },
  unknown: { color: 'red', text: 'مش متصرّف' },
  received: { color: 'orange', text: 'اتستلم قبل كده' },
  checking: { text: 'بيتراجع…' },
};

export default function CouponReceipts() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [serial, setSerial] = useState('');
  const [rangeFrom, setRangeFrom] = useState<number | null>(null);
  const [rangeTo, setRangeTo] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customers, setCustomers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Receipt | null>(null);

  const serialInput = useRef<any>(null);

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

  /** Check one serial with the server and fold the answer into the list. */
  const addSerial = async (raw: string) => {
    const value = String(raw).trim();
    if (!value) return;
    if (entries.some((e) => e.serial === value)) {
      message.warning('الكوبون ده مضاف بالفعل');
      return;
    }
    setEntries((prev) => [{ serial: value, status: 'checking' }, ...prev]);
    setSerial('');
    serialInput.current?.focus?.();
    try {
      const res = await api.get('/api/v1/coupon-receipts/check', { params: { serial: value } });
      const d = res.data;
      setEntries((prev) => prev.map((e) => (e.serial === value ? {
        serial: value,
        status: (d.status as Status) || 'unknown',
        customerId: d.customer_id,
        customerName: d.customer_name,
        documentNumber: d.document_number,
      } : e)));
      // The first good coupon settles whose handover this is; the rest have to agree, because a
      // receipt credited to the wrong customer is worse than no receipt at all.
      if (d.status === 'valid' && !customerId && d.customer_id) setCustomerId(d.customer_id);
      if (d.status === 'unknown') message.error(`الكوبون ${value} مش متصرّف من النظام`);
      if (d.status === 'received') message.warning(`الكوبون ${value} اتستلم قبل كده`);
    } catch (err: any) {
      setEntries((prev) => prev.filter((e) => e.serial !== value));
      message.error(err?.response?.data?.detail?.message || 'تعذر مراجعة الكوبون');
    }
  };

  const addRange = async () => {
    if (rangeFrom === null || rangeTo === null) { message.warning('اكتب النطاق'); return; }
    if (rangeTo < rangeFrom) { message.warning('رقم النهاية أصغر من البداية'); return; }
    if (rangeTo - rangeFrom + 1 > 100) { message.warning('أقصى ١٠٠ كوبون في المرة'); return; }
    const from = rangeFrom; const to = rangeTo;
    setRangeFrom(null); setRangeTo(null);
    for (let n = from; n <= to; n += 1) {
      // Sequential on purpose: a hundred parallel checks would hammer the server and the answers
      // would land out of order, which reads as chaos on the screen.
      await addSerial(String(n));
    }
  };

  const rejects = entries.filter((e) => e.status === 'unknown' || e.status === 'received');
  const good = entries.filter((e) => e.status === 'valid');
  const mismatched = customerId
    ? good.filter((e) => e.customerId && e.customerId !== customerId)
    : [];

  const save = async () => {
    if (!good.length) { message.warning('مافيش كوبونات مقبولة'); return; }
    if (rejects.length) { message.warning('شيل الكوبونات المرفوضة الأول'); return; }
    if (mismatched.length) { message.warning('فيه كوبونات لعميل تاني'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/coupon-receipts', {
        serials: good.map((e) => e.serial),
        customer_id: customerId ?? null,
        notes: notes || null,
      });
      message.success('اتسجّل الاستلام');
      setEntries([]); setNotes(''); setCustomerId(undefined);
      loadReceipts();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تسجيل الاستلام');
    } finally { setSaving(false); }
  };

  const filter = useListFilter(receipts, {
    search: (r) => [r.document_number, r.notes,
      ...r.lines.map((l) => l.serial)],
  });

  const receiveTab = (
    <Row gutter={16}>
      <Col xs={24} lg={14}>
        <Card size="small" title="الكوبونات المستلمة">
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={24} md={10}>
              <Input
                ref={serialInput} autoFocus size="large" value={serial}
                placeholder="رقم الكوبون — اكتبه واضغط Enter"
                onChange={(e) => setSerial(e.target.value)}
                onPressEnter={() => addSerial(serial)}
              />
            </Col>
            <Col xs={8} md={4}>
              <InputNumber style={{ width: '100%' }} size="large" placeholder="من"
                value={rangeFrom} onChange={(v) => setRangeFrom(v as number)} />
            </Col>
            <Col xs={8} md={4}>
              <InputNumber style={{ width: '100%' }} size="large" placeholder="إلى"
                value={rangeTo} onChange={(v) => setRangeTo(v as number)} />
            </Col>
            <Col xs={8} md={6}>
              <Button size="large" icon={<PlusOutlined />} onClick={addRange} block>
                إضافة نطاق
              </Button>
            </Col>
          </Row>

          <Table<Entry>
            rowKey="serial" size="small" dataSource={entries} pagination={false}
            locale={{ emptyText: 'اكتب رقم كوبون عشان تبدأ' }}
            scroll={{ y: 320 }}
            columns={[
              { title: 'رقم الكوبون', dataIndex: 'serial',
                render: (v: string) => <b>{v}</b> },
              { title: 'الحالة', dataIndex: 'status',
                render: (s: Status) => (
                  <Tag color={STATUS_TAG[s].color}>{STATUS_TAG[s].text}</Tag>) },
              { title: 'العميل', dataIndex: 'customerName',
                render: (v: string, r) => (r.status === 'valid' ? (v || '-') : '-') },
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
        </Card>
      </Col>

      <Col xs={24} lg={10}>
        <Card size="small" title="تسجيل الاستلام">
          <Row gutter={[8, 8]}>
            <Col xs={12}>
              <Card size="small">
                <Statistic title="مقبول" value={good.length}
                  valueStyle={{ color: '#6AB42D' }} />
              </Card>
            </Col>
            <Col xs={12}>
              <Card size="small">
                <Statistic title="مرفوض" value={rejects.length}
                  valueStyle={{ color: rejects.length ? '#cf1322' : undefined }} />
              </Card>
            </Col>
          </Row>

          <div style={{ marginTop: 12 }}>
            <Select
              allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
              placeholder="العميل (بيتحدد لوحده من أول كوبون سليم)"
              value={customerId} onChange={setCustomerId}
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          <Input.TextArea rows={2} placeholder="ملاحظات" value={notes}
            style={{ marginTop: 8 }} onChange={(e) => setNotes(e.target.value)} />

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

          <Button
            type="primary" size="large" block icon={<SaveOutlined />}
            style={{ marginTop: 12 }} loading={saving}
            disabled={!good.length || !!rejects.length || !!mismatched.length}
            onClick={save}
          >
            تسجيل استلام {good.length || ''} كوبون
          </Button>

          <Alert type="info" showIcon style={{ marginTop: 12 }}
            message="كل رقم بيتراجع على السيرفر أول ما تكتبه."
            description="الكوبون بيتقبل بس لو واقع في نطاق اتصرف على فاتورة حقيقية للعميل ده، ولسه ما اتستلمش قبل كده." />
        </Card>
      </Col>
    </Row>
  );

  /** جسم الاستلام — اللي كان جوّه الدرج. */
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

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const listCols = useTableColumns('coupon-receipts', listColumns);

  const detailBody = (
    <>
        {detail && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="العميل">
                {customerName(detail.customer_id)}
              </Descriptions.Item>
              <Descriptions.Item label="التاريخ">
                {detail.received_date ? String(detail.received_date).slice(0, 10) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="العدد">{detail.coupon_count}</Descriptions.Item>
              <Descriptions.Item label="ملاحظات">{detail.notes || '-'}</Descriptions.Item>
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
        )}
    </>
  );

  /**
   * الاستلام المفتوح — نفس الصفحة، مش درج جانبي.
   *
   * A receipt was written on the «استلام كوبونات» tab and read in a Drawer over the history: two
   * shapes for one document. The history steps aside while one is open.
   *
   * It is read-only, and there is nothing to soften about that: receiving a coupon is the act that
   * makes it spent, and un-spending one by editing the paper that took it in would leave a coupon
   * the system thinks is free and the customer has already handed over.
   */
  const historyTab = detail ? (
    <Card
      title={(
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />}
            onClick={() => setDetail(null)}>رجوع</Button>
          <span>{detail.document_number}</span>
        </Space>
      )}
    >
      {detailBody}
      <div style={{ marginTop: 16, textAlign: 'left' }}>
        <Button size="large" onClick={() => setDetail(null)}>إغلاق</Button>
      </div>
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
    <Tabs items={[
      { key: 'receive', label: 'استلام كوبونات', children: receiveTab },
      { key: 'history', label: `السجل (${receipts.length})`, children: historyTab },
    ]} />
  );
}

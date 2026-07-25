import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Table, Descriptions, Statistic, Row, Col, Card, Tag, Spin,
  DatePicker, Space, Button, Empty, Typography, Modal,
} from 'antd';
import { ReloadOutlined, ArrowRightOutlined, EditOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useLookup, labelMap } from '../hooks/useLookup';
import InvoiceDocument, { invoiceFooter } from '../components/InvoiceDocument';
import VoucherDocument, { voucherFooter } from '../components/VoucherDocument';
import CustomerEditModal from '../components/CustomerEditModal';

/**
 * ملف العميل (Customer 360) — a full inner page (not a side drawer) reached by clicking a
 * customer, with a back arrow. Shows everything tied to him: balance, account statement,
 * invoices, returns, receipts, cheques, visits and loyalty points.
 */

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DocRow {
  id: number;
  document_number: string;
  doc_date: string | null;
  amount: string;
  detail: string;
}

interface ProfileData {
  customer: any;
  account_id: number | null;
  balance: string;
  points_balance: string;
  total_sales: string;
  total_returns: string;
  total_receipts: string;
  invoice_count: number;
  last_invoice_date: string | null;
  invoices: DocRow[];
  returns: DocRow[];
  receipts: DocRow[];
  cheques: any[];
  coupons: any[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'تحت التحصيل', settled: 'محصّل', bounced: 'مرتد', cancelled: 'ملغي',
  issued: 'صادر', redeemed: 'مستخدم', draft: 'مسودة', approved: 'معتمد', rejected: 'مرفوض',
};

const docColumns = (amountTitle: string) => [
  { title: 'رقم المستند', dataIndex: 'document_number', key: 'doc' },
  {
    title: 'التاريخ', dataIndex: 'doc_date', key: 'date',
    render: (d: string | null) => (d ? d.slice(0, 10) : '-'),
  },
  {
    title: amountTitle, dataIndex: 'amount', key: 'amount',
    render: (v: string) => <b>{money(v)} ج.م</b>,
  },
  { title: 'تفاصيل', dataIndex: 'detail', key: 'detail' },
];

export default function CustomerProfile() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const { options: typeOptions } = useLookup('customer_type');
  const typeLabels = labelMap(typeOptions);
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statement, setStatement] = useState<any>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [record, setRecord] = useState<any>(null);          // the record popup
  const [recordLoading, setRecordLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const load = async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/customers/${customerId}/profile`);
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadStatement = async (reset = false) => {
    if (!customerId) return;
    const params: any = {};
    if (range && !reset) {
      params.date_from = range[0].format('YYYY-MM-DD');
      params.date_to = range[1].format('YYYY-MM-DD');
    }
    try {
      const res = await api.get(`/api/v1/customers/${customerId}/statement`, { params });
      // One entry can touch this account twice, so stamp a stable row key here.
      setStatement({
        ...res.data,
        lines: (res.data.lines || []).map((l: any, i: number) => ({ ...l, _key: `${l.entry_id}-${i}` })),
      });
    } catch (err) {
      setStatement(null); // no ledger account yet — the tab shows an empty state
    }
  };

  useEffect(() => {
    load();
    loadStatement(true);
  }, [customerId]);

  const c = data?.customer;
  const balance = Number(data?.balance || 0);

  // Any row in any tab opens the same popup; the server returns a render-ready shape
  // (fields + optional line table) so one component covers every document kind.
  const openRecord = async (kind: string, id: number) => {
    setRecordLoading(true);
    setRecord({ title: 'جارٍ التحميل…', fields: [], lines: [], line_columns: [] });
    try {
      const res = await api.get(`/api/v1/customers/${customerId}/records/${kind}/${id}`);
      setRecord(res.data);
    } catch (err) {
      setRecord(null);
    } finally {
      setRecordLoading(false);
    }
  };

  // Clicking a row anywhere in the file opens that record.
  const rowProps = (kind: string) => (r: any) => ({
    onClick: () => openRecord(kind, kind === 'entry' ? r.entry_id : r.id),
    style: { cursor: 'pointer' },
  });

  return (
    <div>
      <Card
        title={
          <Space>
            <Button type="text" icon={<ArrowRightOutlined />} onClick={() => navigate('/customers')}>
              رجوع
            </Button>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {c ? `ملف العميل: ${c.name} (${c.code})` : 'ملف العميل'}
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            <Button type="primary" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
              تعديل البيانات
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => { load(); loadStatement(); }}>
              تحديث
            </Button>
          </Space>
        }
      >
        {loading && !data ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
        ) : !data ? (
          <Empty description="لا توجد بيانات" />
        ) : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="الرصيد المستحق (الذمة)"
                    value={money(data.balance)}
                    suffix="ج.م"
                    valueStyle={{
                      color: balance > 0 ? '#cf1322' : balance < 0 ? '#1677ff' : '#3f8600',
                    }}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي المبيعات" value={money(data.total_sales)} suffix="ج.م" />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي التحصيلات" value={money(data.total_receipts)} suffix="ج.م" />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="رصيد النقاط" value={Number(data.points_balance || 0)} />
                </Card>
              </Col>
            </Row>

            <Tabs
              items={[
                {
                  key: 'overview',
                  label: 'نظرة عامة',
                  children: (
                    <Descriptions bordered column={2} size="small">
                      <Descriptions.Item label="الكود">{c.code}</Descriptions.Item>
                      <Descriptions.Item label="الاسم">{c.name}</Descriptions.Item>
                      <Descriptions.Item label="التصنيف">
                        {typeLabels[c.customer_type] || c.customer_type}
                      </Descriptions.Item>
                      <Descriptions.Item label="الحالة">
                        {c.active ? <Tag color="green">نشط</Tag> : <Tag color="red">معطل</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="الهاتف">{c.phone || '-'}</Descriptions.Item>
                      <Descriptions.Item label="أرقام إضافية">
                        {(c.phones || []).join('، ') || '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="المركز">{c.markaz || '-'}</Descriptions.Item>
                      <Descriptions.Item label="العنوان">{c.address || '-'}</Descriptions.Item>
                      <Descriptions.Item label="عدد الفواتير">{data.invoice_count}</Descriptions.Item>
                      <Descriptions.Item label="آخر فاتورة">
                        {data.last_invoice_date ? data.last_invoice_date.slice(0, 10) : '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="إجمالي المرتجعات">
                        {money(data.total_returns)} ج.م
                      </Descriptions.Item>
                      <Descriptions.Item label="رقم الحساب بالدفتر">
                        {data.account_id ?? '-'}
                      </Descriptions.Item>
                    </Descriptions>
                  ),
                },
                {
                  key: 'statement',
                  label: 'كشف الحساب',
                  children: (
                    <>
                      <Space style={{ marginBottom: 12 }} wrap>
                        <DatePicker.RangePicker
                          value={range as any}
                          onChange={(v) => setRange(v as any)}
                        />
                        <Button type="primary" onClick={() => loadStatement()}>عرض</Button>
                        <Button onClick={() => { setRange(null); loadStatement(true); }}>
                          كل الفترات
                        </Button>
                      </Space>
                      {!statement ? (
                        <Empty description="لا يوجد حساب دفتري لهذا العميل" />
                      ) : (
                        <>
                          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                            <Col xs={12} md={6}>
                              <Card size="small">
                                <Statistic title="رصيد أول المدة"
                                  value={money(statement.opening_balance)} suffix="ج.م" />
                              </Card>
                            </Col>
                            <Col xs={12} md={6}>
                              <Card size="small">
                                <Statistic title="إجمالي مدين"
                                  value={money(statement.total_debit)} suffix="ج.م" />
                              </Card>
                            </Col>
                            <Col xs={12} md={6}>
                              <Card size="small">
                                <Statistic title="إجمالي دائن"
                                  value={money(statement.total_credit)} suffix="ج.م" />
                              </Card>
                            </Col>
                            <Col xs={12} md={6}>
                              <Card size="small">
                                <Statistic title="رصيد آخر المدة"
                                  value={money(statement.closing_balance)} suffix="ج.م" />
                              </Card>
                            </Col>
                          </Row>
                          <Table
                            size="small"
                            rowKey="_key"
                            dataSource={statement.lines} onRow={rowProps('entry')}
                            pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                            scroll={{ x: true }}
                            columns={[
                              { title: 'التاريخ', dataIndex: 'entry_date', key: 'd',
                                render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
                              { title: 'النوع', dataIndex: 'entry_type', key: 't' },
                              { title: 'البيان', dataIndex: 'description', key: 'desc' },
                              { title: 'مدين', dataIndex: 'debit', key: 'dr',
                                render: (v: string) => money(v) },
                              { title: 'دائن', dataIndex: 'credit', key: 'cr',
                                render: (v: string) => money(v) },
                              { title: 'الرصيد', dataIndex: 'balance', key: 'bal',
                                render: (v: string) => <b>{money(v)}</b> },
                            ]}
                          />
                        </>
                      )}
                    </>
                  ),
                },
                {
                  key: 'invoices',
                  label: `فواتير البيع (${data.invoices.length})`,
                  children: (
                    <Table size="small" rowKey="id" dataSource={data.invoices} onRow={rowProps('invoice')}
                      columns={docColumns('الإجمالي')} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                      scroll={{ x: true }} />
                  ),
                },
                {
                  key: 'returns',
                  label: `المرتجعات (${data.returns.length})`,
                  children: (
                    <Table size="small" rowKey="id" dataSource={data.returns} onRow={rowProps('return')}
                      columns={docColumns('قيمة المرتجع')} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                      scroll={{ x: true }} />
                  ),
                },
                {
                  key: 'receipts',
                  label: `سندات القبض (${data.receipts.length})`,
                  children: (
                    <Table size="small" rowKey="id" dataSource={data.receipts} onRow={rowProps('receipt')}
                      columns={docColumns('المحصّل')} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                      scroll={{ x: true }} />
                  ),
                },
                {
                  key: 'cheques',
                  label: `الشيكات (${data.cheques.length})`,
                  children: (
                    <Table size="small" rowKey="id" dataSource={data.cheques} onRow={rowProps('cheque')}
                      pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }} scroll={{ x: true }}
                      columns={[
                        { title: 'رقم الشيك', dataIndex: 'cheque_number', key: 'n' },
                        { title: 'البنك', dataIndex: 'bank_name', key: 'b',
                          render: (v: string) => v || '-' },
                        { title: 'القيمة', dataIndex: 'amount', key: 'a',
                          render: (v: string) => <b>{money(v)} ج.م</b> },
                        { title: 'الاستحقاق', dataIndex: 'due_date', key: 'd' },
                        { title: 'الحالة', dataIndex: 'status', key: 's',
                          render: (s: string) => <Tag>{STATUS_LABELS[s] || s}</Tag> },
                      ]} />
                  ),
                },
                {
                  key: 'coupons',
                  label: `الكوبونات (${data.coupons.length})`,
                  children: (
                    <Table size="small" rowKey="id" dataSource={data.coupons} onRow={rowProps('coupon')}
                      pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100', '200'] }} scroll={{ x: true }}
                      columns={[
                        { title: 'السريال', dataIndex: 'serial', key: 's' },
                        { title: 'القيمة', dataIndex: 'value', key: 'v',
                          render: (v: string) => `${money(v)} ج.م` },
                        { title: 'النقاط المستهلكة', dataIndex: 'points_consumed', key: 'p' },
                        { title: 'الحالة', dataIndex: 'status', key: 'st',
                          render: (s: string) => <Tag>{STATUS_LABELS[s] || s}</Tag> },
                      ]} />
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>

      {/* One popup for every document kind — the server returns fields + optional lines. */}
      <Modal
        open={record !== null}
        title={record?.title || 'تفاصيل المستند'}
        onCancel={() => setRecord(null)}
        footer={record?.doc
          ? invoiceFooter(record.doc, () => setRecord(null))
          : record?.voucher
            ? voucherFooter(record.voucher, () => setRecord(null))
            : <Button onClick={() => setRecord(null)}>إغلاق</Button>}
        width={820}
        centered
        destroyOnHidden
      >
        {recordLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : !record ? null : record.doc ? (
          // Invoices and vouchers get their real branded sheet; the rest the generic layout.
          <InvoiceDocument doc={record.doc} />
        ) : record.voucher ? (
          <VoucherDocument doc={record.voucher} />
        ) : (
          <>
            <Descriptions bordered column={2} size="small">
              {(record.fields || []).map((f: any) => (
                <Descriptions.Item key={f.label} label={f.label}>{f.value}</Descriptions.Item>
              ))}
            </Descriptions>
            {(record.lines || []).length > 0 && (
              <Table
                style={{ marginTop: 16 }}
                size="small"
                rowKey={(_r, i) => String(i)}
                dataSource={(record.lines || []).map((row: string[], i: number) => ({
                  _i: i,
                  ...Object.fromEntries(row.map((v, j) => [`c${j}`, v])),
                }))}
                columns={(record.line_columns || []).map((t: string, j: number) => ({
                  title: t, dataIndex: `c${j}`, key: `c${j}`,
                }))}
                pagination={false}
                scroll={{ x: true }}
              />
            )}
          </>
        )}
      </Modal>

      <CustomerEditModal
        customer={data?.customer}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import {
  useNavigate, useParams } from 'react-router-dom';
import {
  Tabs, Table, Descriptions,
  Statistic, Row, Col, Card, Tag, Spin, DatePicker, Space, Button, Empty, Typography
} from 'antd';
import { ReloadOutlined, ArrowRightOutlined, EditOutlined, FileTextOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import { api } from '../api/client';
import InvoiceDocument, { invoiceFooter } from '../components/InvoiceDocument';
import VoucherDocument, { voucherFooter } from '../components/VoucherDocument';
import SupplierEditModal from '../components/SupplierEditModal';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import DocumentLink from '../components/DocumentLink';
import { entryTypeLabel } from '../components/labels';
import { useOpenDocument } from '../components/DocumentLink';
import { TabModal } from '../components/TabModal';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableColumns } from '../components/ColumnSettings';

/**
 * ملف المورد (Supplier 360) — the mirror of the customer file: balance, account statement,
 * purchase invoices, returns, payment vouchers and cheques, each row opening in a popup.
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
  supplier: any;
  account_id: number | null;
  balance: string;
  total_purchases: string;
  total_returns: string;
  total_payments: string;
  invoice_count: number;
  last_invoice_date: string | null;
  purchases: DocRow[];
  returns: DocRow[];
  payments: DocRow[];
  cheques: any[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'تحت الدفع', settled: 'مصروف', bounced: 'مرتد', cancelled: 'ملغي',
};

/** Only the statuses the rows actually carry are offered, labelled in Arabic. */
const statusOptions = (rows: any[]) =>
  Array.from(new Set((rows || []).map((r) => r.status).filter(Boolean)))
    .map((s: any) => ({ value: s, label: STATUS_LABELS[s] || String(s) }));

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

/** Which screen owns each row kind in this file. Rows the owning screen cannot act on are
 *  simply not linked, rather than linked to somewhere that would refuse them. */
const LINKABLE: Record<string, 'invoice' | 'return' | 'purchase' | 'purchase_return'> = {
  invoice: 'invoice',
  return: 'return',
  purchase: 'purchase',
  purchase_return: 'purchase_return',
};

export default function SupplierProfile() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statement, setStatement] = useState<any>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [record, setRecord] = useState<any>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  // What the open popup is showing — the footer needs it to link onwards.
  const [recordRef, setRecordRef] = useState<{ kind: string; id: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // Each tab searches on its own list.
  const stmtFilter = useListFilter<any>(statement?.lines || [], {
    search: (l) => [l.entry_type, l.description, l.debit, l.credit, l.balance],
    filters: { entry_type: (l, v) => l.entry_type === v },
  });
  const purchasesFilter = useListFilter<DocRow>(data?.purchases || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const returnsFilter = useListFilter<DocRow>(data?.returns || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const paymentsFilter = useListFilter<DocRow>(data?.payments || [], {
    search: (r) => [r.document_number, r.detail, r.amount],
    dateOf: (r) => r.doc_date,
  });
  const chequesFilter = useListFilter<any>(data?.cheques || [], {
    search: (r) => [r.cheque_number, r.bank_name, r.amount],
    filters: { status: (r, v) => r.status === v },
    dateOf: (r) => r.due_date,
  });

  const load = async () => {
    if (!supplierId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/v1/suppliers/${supplierId}/profile`);
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadStatement = async (reset = false) => {
    if (!supplierId) return;
    const params: any = {};
    if (range && !reset) {
      params.date_from = range[0].format('YYYY-MM-DD');
      params.date_to = range[1].format('YYYY-MM-DD');
    }
    try {
      const res = await api.get(`/api/v1/suppliers/${supplierId}/statement`, { params });
      setStatement({
        ...res.data,
        lines: (res.data.lines || []).map((l: any, i: number) => ({ ...l, _key: `${l.entry_id}-${i}` })),
      });
    } catch (err) {
      setStatement(null);
    }
  };

  useEffect(() => { load(); }, [supplierId]);

  // كشف الحساب بيتقرا مع أي تغيير في الفلتر — مفيش زرار «عرض».
  //
  // كان الفلتر بيتغيّر والأرقام القديمة فاضلة على الشاشة لغاية ما حد يدوس «عرض». ده بيتقري
  // كأنه عطل: اللي بيغيّر الفترة بيشوف أرقام الفترة القديمة، فيا بيصدّقها — وده النص الخطر —
  // يا بيدوس الزرار ويستغرب كان لازمته إيه.
  //
  // `range` بيبدأ `null`، فأول تحميل بيبعت من غير تواريخ — نفس اللي كان بيعمله `loadStatement(true)`.
  // وزرار «تحديث» فاضل: إعادة قراءة **نفس** الفلتر بعد ما حد تاني رحّل حاجة حاجة حقيقية.
  useEffect(() => { loadStatement(); }, [supplierId, range]);

  const openRecord = async (kind: string, id: number) => {
    setRecordRef({ kind, id });
    setRecordLoading(true);
    setRecord({ title: 'جارٍ التحميل…', fields: [], lines: [], line_columns: [] });
    try {
      const res = await api.get(`/api/v1/suppliers/${supplierId}/records/${kind}/${id}`);
      setRecord(res.data);
    } catch (err) {
      setRecord(null);
    } finally {
      setRecordLoading(false);
    }
  };

  /**
   * الضغط على سطر في كشف الحساب يفتح المستند نفسه.
   *
   * Same change as the customer's file, for the same reason: the row opened a read-only sheet, and
   * somebody clicking a purchase on a supplier's statement is asking to work on it. The statement
   * has carried `doc_kind` and `doc_id` all along and this screen threw them away.
   *
   * A line with no document behind it still opens the sheet — there is nowhere else for it to go.
   */
  const openDoc = useOpenDocument();

  const rowProps = (kind: string) => (r: any) => ({
    onClick: () => {
      if (kind === 'entry' && r.doc_kind && r.doc_id) { openDoc(r.doc_kind, r.doc_id); return; }
      openRecord(kind, kind === 'entry' ? r.entry_id : r.id);
    },
    style: { cursor: 'pointer' },
  });

  const s = data?.supplier;
  const balance = Number(data?.balance || 0);

  const columns = [
    { title: 'التاريخ', dataIndex: 'entry_date', key: 'd',
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'النوع', dataIndex: 'entry_type', key: 't',
      render: (t: string) => entryTypeLabel(t) },
    { title: 'البيان', dataIndex: 'description', key: 'desc' },
    { title: 'الرصيد قبل', dataIndex: 'balance_before', key: 'bb',
      render: (v: string) => (
        <span style={{ color: '#6b6b6b' }}>{money(v)}</span>) },
    { title: 'مدين', dataIndex: 'debit', key: 'dr',
      render: (v: string) => money(v) },
    { title: 'دائن', dataIndex: 'credit', key: 'cr',
      render: (v: string) => money(v) },
    { title: 'الرصيد بعد', dataIndex: 'balance', key: 'bal',
      render: (v: string) => <b>{money(v)}</b> },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('supplier-ledger', columns);

  return (
    <div>
      <Card
        title={
          <Space>
            <Button type="text" icon={<ArrowRightOutlined />} onClick={() => navigate('/suppliers')}>
              رجوع
            </Button>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {s ? `ملف المورد: ${s.name} (${s.code})` : 'ملف المورد'}
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            {tableCols.control}
            <Button type="primary" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
              تعديل البيانات
            </Button>
            <Button icon={<FileTextOutlined />} disabled={!data?.account_id}
              onClick={() => navigate(`/account-statement?account=${data?.account_id}`)}>
              كشف الحساب التفصيلي
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
                    title="الرصيد المستحق للمورد"
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
                  <Statistic title="إجمالي المشتريات" value={money(data.total_purchases)} suffix="ج.م" />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي المدفوعات" value={money(data.total_payments)} suffix="ج.م" />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic title="إجمالي المرتجعات" value={money(data.total_returns)} suffix="ج.م" />
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
                      <Descriptions.Item label="الكود">{s.code}</Descriptions.Item>
                      <Descriptions.Item label="الاسم">{s.name}</Descriptions.Item>
                      <Descriptions.Item label="الحالة">
                        {s.active ? <Tag color="green">نشط</Tag> : <Tag color="red">معطل</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="الهاتف">{s.phone || '-'}</Descriptions.Item>
                      <Descriptions.Item label="أرقام إضافية">
                        {(s.phones || []).join('، ') || '-'}
                      </Descriptions.Item>
                      <Descriptions.Item label="العنوان">{s.address || '-'}</Descriptions.Item>
                      <Descriptions.Item label="عدد الفواتير">{data.invoice_count}</Descriptions.Item>
                      <Descriptions.Item label="آخر فاتورة">
                        {data.last_invoice_date ? data.last_invoice_date.slice(0, 10) : '-'}
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
                        <div style={{ width: 280 }}>
                          <DateRangeFilter value={range as any}
                            onChange={(v) => setRange(v as any)} />
                        </div>
                        <Button onClick={() => setRange(null)}>
                          كل الفترات
                        </Button>
                      </Space>
                      {!statement ? (
                        <Empty description="لا يوجد حساب دفتري لهذا المورد" />
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
                          <ListToolbar
                            searchPlaceholder="بحث في البيان أو المبلغ"
                            searchSpan={8}
                            query={stmtFilter.query} onQueryChange={stmtFilter.setQuery}
                            values={stmtFilter.values} onValueChange={stmtFilter.setValue}
                            onReset={stmtFilter.reset}
                            total={statement.lines.length} shown={stmtFilter.filtered.length}
                            filters={[
                              { key: 'entry_type', placeholder: 'النوع',
                                // The choices are named too. A column that reads «فاتورة بيع»
                                // over a filter offering `sale` is the same bug half-fixed.
                                options: Array.from(new Set(
                                  (statement.lines || []).map((l: any) => l.entry_type).filter(Boolean),
                                )).map((v: any) => ({ value: v, label: entryTypeLabel(String(v)) })) },
                            ]}
                          />
                          <Table
                            size="small" rowKey="_key" dataSource={stmtFilter.filtered}
                            onRow={rowProps('entry')} scroll={{ x: true }}
                            pagination={{ defaultPageSize: 20, showSizeChanger: true,
                              pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                            columns={tableCols.columns}
                          />
                        </>
                      )}
                    </>
                  ),
                },
                {
                  key: 'purchases',
                  label: `فواتير الشراء (${data.purchases.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم الفاتورة أو التفاصيل"
                        searchSpan={8} showDateRange
                        query={purchasesFilter.query} onQueryChange={purchasesFilter.setQuery}
                        range={purchasesFilter.range} onRangeChange={purchasesFilter.setRange}
                        onReset={purchasesFilter.reset}
                        total={data.purchases.length} shown={purchasesFilter.filtered.length}
                      />
                      <Table size="small" rowKey="id" dataSource={purchasesFilter.filtered}
                        columns={docColumns('الإجمالي')} onRow={rowProps('purchase')}
                        scroll={{ x: true }}
                        pagination={{ defaultPageSize: 10, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }} />
                    </>
                  ),
                },
                {
                  key: 'returns',
                  label: `المرتجعات (${data.returns.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم المستند أو التفاصيل"
                        searchSpan={8} showDateRange
                        query={returnsFilter.query} onQueryChange={returnsFilter.setQuery}
                        range={returnsFilter.range} onRangeChange={returnsFilter.setRange}
                        onReset={returnsFilter.reset}
                        total={data.returns.length} shown={returnsFilter.filtered.length}
                      />
                      <Table size="small" rowKey="id" dataSource={returnsFilter.filtered}
                        columns={docColumns('قيمة المرتجع')} onRow={rowProps('return')}
                        scroll={{ x: true }}
                        pagination={{ defaultPageSize: 10, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }} />
                    </>
                  ),
                },
                {
                  key: 'payments',
                  label: `سندات الصرف (${data.payments.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم السند أو التفاصيل"
                        searchSpan={8} showDateRange
                        query={paymentsFilter.query} onQueryChange={paymentsFilter.setQuery}
                        range={paymentsFilter.range} onRangeChange={paymentsFilter.setRange}
                        onReset={paymentsFilter.reset}
                        total={data.payments.length} shown={paymentsFilter.filtered.length}
                      />
                      <Table size="small" rowKey="id" dataSource={paymentsFilter.filtered}
                        columns={docColumns('المدفوع')} onRow={rowProps('payment')}
                        scroll={{ x: true }}
                        pagination={{ defaultPageSize: 10, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }} />
                    </>
                  ),
                },
                {
                  key: 'cheques',
                  label: `الشيكات (${data.cheques.length})`,
                  children: (
                    <>
                      <ListToolbar
                        searchPlaceholder="بحث برقم الشيك أو البنك"
                        searchSpan={8} showDateRange
                        query={chequesFilter.query} onQueryChange={chequesFilter.setQuery}
                        values={chequesFilter.values} onValueChange={chequesFilter.setValue}
                        range={chequesFilter.range} onRangeChange={chequesFilter.setRange}
                        onReset={chequesFilter.reset}
                        total={data.cheques.length} shown={chequesFilter.filtered.length}
                        filters={[
                          { key: 'status', placeholder: 'الحالة', options: statusOptions(data.cheques) },
                        ]}
                      />
                      <Table size="small" rowKey="id" dataSource={chequesFilter.filtered}
                        onRow={rowProps('cheque')} scroll={{ x: true }}
                        pagination={{ defaultPageSize: 10, showSizeChanger: true,
                          pageSizeOptions: ['10', '20', '50', '100', '200'] }}
                        columns={[
                          { title: 'رقم الشيك', dataIndex: 'cheque_number', key: 'n' },
                          { title: 'البنك', dataIndex: 'bank_name', key: 'b',
                            render: (v: string) => v || '-' },
                          { title: 'القيمة', dataIndex: 'amount', key: 'a',
                            render: (v: string) => <b>{money(v)} ج.م</b> },
                          { title: 'الاستحقاق', dataIndex: 'due_date', key: 'd' },
                          { title: 'الحالة', dataIndex: 'status', key: 's',
                            render: (v: string) => <Tag>{STATUS_LABELS[v] || v}</Tag> },
                        ]} />
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>

      {/* One popup for every document kind. */}
      <TabModal
        open={record !== null}
        title={record?.title || 'تفاصيل المستند'}
        onCancel={() => setRecord(null)}
        footer={(
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            {/* The row is no longer a dead end: from here the document opens in the screen that
                owns it, where editing and reversing already live. */}
            <span>
              {recordRef && LINKABLE[recordRef.kind] && (
                <DocumentLink
                  kind={LINKABLE[recordRef.kind]}
                  id={recordRef.id}
                  allowEdit={recordRef.kind === 'invoice'}
                  onNavigate={() => setRecord(null)}
                />
              )}
            </span>
            <span>
              {record?.doc
                ? invoiceFooter(record.doc, () => setRecord(null))
                : record?.voucher
                  ? voucherFooter(record.voucher, () => setRecord(null))
                  : <Button onClick={() => setRecord(null)}>إغلاق</Button>}
            </span>
          </Space>
        )}
        width={820}
        centered
        destroyOnHidden
      >
        {recordLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : !record ? null : record.doc ? (
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
                rowKey="_i"
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
      </TabModal>

      <SupplierEditModal
        supplier={data?.supplier}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

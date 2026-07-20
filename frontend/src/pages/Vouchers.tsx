import React, { useCallback, useEffect, useState } from 'react';
import {
  Card,
  Tabs,
  Table,
  Form,
  Select,
  InputNumber,
  DatePicker,
  Input,
  Button,
  Space,
  Tag,
  Statistic,
  Row,
  Col,
  Popconfirm,
  message,
  Descriptions,
} from 'antd';
import {
  DollarOutlined,
  ExportOutlined,
  SwapOutlined,
  FileSearchOutlined,
  UndoOutlined,
  PrinterOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useLookup } from '../hooks/useLookup';

interface VoucherRecord {
  id: number;
  document_number: string;
  kind: 'receipt' | 'payment' | 'rep_handover';
  amount: string;
  customer_id: number | null;
  supplier_id: number | null;
  rep_user_id: number | null;
  voucher_date: string;
  payment_method: string | null;
  reference: string | null;
  description: string | null;
  is_reversal: boolean;
}

interface StatementLine {
  entry_id: number;
  entry_date: string;
  entry_type: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

interface StatementData {
  account_id: number;
  opening_balance: string;
  closing_balance: string;
  total_debit: string;
  total_credit: string;
  lines: StatementLine[];
}

interface Party {
  id: number;
  name: string;
}
interface UserRecord {
  id: number;
  full_name: string | null;
  username: string;
  role?: string;
}

const KIND_LABEL: Record<string, string> = {
  receipt: 'سند قبض',
  payment: 'سند صرف',
  rep_handover: 'توريد مندوب',
};
const KIND_COLOR: Record<string, string> = {
  receipt: 'green',
  payment: 'red',
  rep_handover: 'blue',
};

const money = (v: string | number) =>
  Number(v).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ENTRY_TYPE_LABEL: Record<string, string> = {
  opening_balance: 'رصيد افتتاحي',
  sale: 'فاتورة بيع',
  sale_return: 'مرتجع بيع',
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع شراء',
  receipt: 'سند قبض',
  payment: 'سند صرف',
  rep_handover: 'توريد مندوب',
  journal: 'قيد يومية',
  reversal: 'عكس قيد',
  coupon_redeem: 'استبدال كوبون',
};

const Vouchers: React.FC = () => {
  const [vouchers, setVouchers] = useState<VoucherRecord[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [reps, setReps] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [kindFilter, setKindFilter] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ]);
  const { options: methodOptions } = useLookup('payment_method');

  // كشف الحساب
  const [stKind, setStKind] = useState<'customer' | 'supplier' | 'rep'>('customer');
  const [stParty, setStParty] = useState<number | undefined>(undefined);
  const [stRange, setStRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [statement, setStatement] = useState<StatementData | null>(null);
  const [stLoading, setStLoading] = useState(false);

  const [receiptForm] = Form.useForm();
  const [paymentForm] = Form.useForm();
  const [handoverForm] = Form.useForm();

  const loadVouchers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (kindFilter) params.kind = kindFilter;
      if (range?.[0]) params.date_from = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.date_to = range[1].format('YYYY-MM-DD');
      const { data } = await api.get<VoucherRecord[]>('/api/v1/vouchers', { params });
      setVouchers(data);
    } catch {
      /* the interceptor already surfaced the error */
    } finally {
      setLoading(false);
    }
  }, [kindFilter, range]);

  useEffect(() => {
    loadVouchers();
  }, [loadVouchers]);

  useEffect(() => {
    api.get<Party[]>('/api/v1/customers').then((r) => setCustomers(r.data)).catch(() => {});
    api.get<Party[]>('/api/v1/suppliers').then((r) => setSuppliers(r.data)).catch(() => {});
    api
      .get<UserRecord[]>('/api/v1/users')
      .then((r) => setReps(r.data.filter((u) => u.role === 'sales_rep')))
      .catch(() => {});
  }, []);

  const partyName = (v: VoucherRecord) => {
    if (v.customer_id) return customers.find((c) => c.id === v.customer_id)?.name || `#${v.customer_id}`;
    if (v.supplier_id) return suppliers.find((s) => s.id === v.supplier_id)?.name || `#${v.supplier_id}`;
    if (v.rep_user_id) {
      const u = reps.find((r) => r.id === v.rep_user_id);
      return u ? u.full_name || u.username : `#${v.rep_user_id}`;
    }
    return '—';
  };

  const submit = async (path: string, values: any, form: any, okMsg: string) => {
    setPosting(true);
    try {
      const payload: any = { ...values, amount: String(values.amount) };
      if (values.voucher_date) payload.voucher_date = values.voucher_date.format('YYYY-MM-DD');
      await api.post(path, payload);
      message.success(okMsg);
      form.resetFields();
      loadVouchers();
      if (statement) loadStatement();
    } catch {
      /* interceptor shows the server's Arabic message */
    } finally {
      setPosting(false);
    }
  };

  const reverseVoucher = async (id: number) => {
    try {
      await api.post(`/api/v1/vouchers/${id}/reverse`);
      message.success('تم عكس السند ✔');
      loadVouchers();
    } catch {
      /* interceptor */
    }
  };

  const loadStatement = async () => {
    if (!stParty) {
      message.warning('اختر الطرف الأول');
      return;
    }
    setStLoading(true);
    try {
      const base =
        stKind === 'customer'
          ? `/api/v1/customers/${stParty}/statement`
          : stKind === 'supplier'
            ? `/api/v1/suppliers/${stParty}/statement`
            : `/api/v1/reps/${stParty}/cash-statement`;
      const params: Record<string, string> = {};
      if (stRange?.[0]) params.date_from = stRange[0].format('YYYY-MM-DD');
      if (stRange?.[1]) params.date_to = stRange[1].format('YYYY-MM-DD');
      const { data } = await api.get<StatementData>(base, { params });
      setStatement(data);
    } catch {
      setStatement(null);
    } finally {
      setStLoading(false);
    }
  };

  const stPartyOptions =
    stKind === 'customer'
      ? customers.map((c) => ({ value: c.id, label: c.name }))
      : stKind === 'supplier'
        ? suppliers.map((s) => ({ value: s.id, label: s.name }))
        : reps.map((r) => ({ value: r.id, label: r.full_name || r.username }));

  const stPartyLabel = stPartyOptions.find((o) => o.value === stParty)?.label || '';

  const printStatement = () => {
    if (!statement) return;
    const title =
      stKind === 'customer' ? 'كشف حساب عميل' : stKind === 'supplier' ? 'كشف حساب مورد' : 'كشف عهدة مندوب';
    const rows = statement.lines
      .map(
        (l) =>
          `<tr><td>${l.entry_date}</td><td>${ENTRY_TYPE_LABEL[l.entry_type] || l.entry_type}</td><td>${l.description || ''}</td><td>${money(l.debit)}</td><td>${money(l.credit)}</td><td>${money(l.balance)}</td></tr>`
      )
      .join('');
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title>
<style>
 body{font-family:'Segoe UI',Tahoma,sans-serif;padding:26px;color:#12303f}
 h1{color:#0e4c6d;font-size:22px;margin:0 0 4px}
 .sub{color:#5b7686;font-size:13px;margin-bottom:16px}
 table{width:100%;border-collapse:collapse;margin-top:12px}
 th{background:#0e4c6d;color:#fff;padding:8px;font-size:13px}
 td{border:1px solid #d5e2ea;padding:6px 8px;font-size:13px;text-align:center}
 tfoot td{font-weight:800;background:#f2f7fa}
 .open{margin-top:10px;font-weight:700}
 @media print{body{padding:0}}
</style></head><body>
 <h1>تكنو ثيرم — ${title}</h1>
 <div class="sub">${stPartyLabel} • ${stRange?.[0] ? stRange[0].format('YYYY-MM-DD') : 'من البداية'} إلى ${stRange?.[1] ? stRange[1].format('YYYY-MM-DD') : 'اليوم'}</div>
 <div class="open">رصيد أول المدة: ${money(statement.opening_balance)}</div>
 <table>
  <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6">لا توجد حركة</td></tr>'}</tbody>
  <tfoot><tr><td colspan="3">الإجمالي</td><td>${money(statement.total_debit)}</td><td>${money(statement.total_credit)}</td><td>${money(statement.closing_balance)}</td></tr></tfoot>
 </table>
 <script>window.onload=function(){window.print()}</script>
</body></html>`;
    const win = window.open('', '_blank', 'width=1000,height=900');
    if (!win) {
      message.error('اسمح بفتح النوافذ المنبثقة للطباعة');
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const voucherColumns = [
    { title: 'رقم السند', dataIndex: 'document_number', width: 120 },
    {
      title: 'النوع',
      dataIndex: 'kind',
      width: 110,
      render: (v: string) => <Tag color={KIND_COLOR[v]}>{KIND_LABEL[v]}</Tag>,
    },
    { title: 'التاريخ', dataIndex: 'voucher_date', width: 110 },
    { title: 'الطرف', width: 180, render: (_: any, r: VoucherRecord) => partyName(r) },
    {
      title: 'المبلغ',
      dataIndex: 'amount',
      width: 120,
      align: 'left' as const,
      render: (v: string) => <b>{money(v)}</b>,
    },
    { title: 'طريقة الدفع', dataIndex: 'payment_method', width: 110 },
    { title: 'المرجع', dataIndex: 'reference', width: 120 },
    { title: 'البيان', dataIndex: 'description' },
    {
      title: '',
      width: 110,
      render: (_: any, r: VoucherRecord) =>
        r.is_reversal ? (
          <Tag>عكسي</Tag>
        ) : (
          <Popconfirm
            title="عكس السند؟"
            description="هيتم عكس القيد وإرجاع الرصيد كما كان."
            okText="عكس"
            cancelText="إلغاء"
            okButtonProps={{ danger: true }}
            onConfirm={() => reverseVoucher(r.id)}
          >
            <Button size="small" danger icon={<UndoOutlined />}>
              عكس
            </Button>
          </Popconfirm>
        ),
    },
  ];

  const totals = {
    receipts: vouchers.filter((v) => v.kind === 'receipt' && !v.is_reversal)
      .reduce((s, v) => s + Number(v.amount), 0),
    payments: vouchers.filter((v) => v.kind === 'payment' && !v.is_reversal)
      .reduce((s, v) => s + Number(v.amount), 0),
    handovers: vouchers.filter((v) => v.kind === 'rep_handover' && !v.is_reversal)
      .reduce((s, v) => s + Number(v.amount), 0),
  };

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="إجمالي التحصيل"
              value={totals.receipts}
              precision={2}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#2e9e6b' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="إجمالي المدفوعات"
              value={totals.payments}
              precision={2}
              prefix={<ExportOutlined />}
              valueStyle={{ color: '#d64545' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="توريدات المناديب"
              value={totals.handovers}
              precision={2}
              prefix={<SwapOutlined />}
              valueStyle={{ color: '#0e4c6d' }}
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="receipt"
        items={[
          {
            key: 'receipt',
            label: 'سند قبض',
            children: (
              <Card title="تحصيل من عميل">
                <Form
                  form={receiptForm}
                  layout="inline"
                  onFinish={(v) =>
                    submit('/api/v1/vouchers/receipts', v, receiptForm, 'تم تسجيل سند القبض ✔')
                  }
                >
                  <Form.Item name="customer_id" label="العميل" rules={[{ required: true, message: 'اختر العميل' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      style={{ width: 240 }}
                      placeholder="اختر العميل"
                      options={customers.map((c) => ({ value: c.id, label: c.name }))}
                    />
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
                  </Form.Item>
                  <Form.Item name="payment_method" label="طريقة الدفع">
                    <Select
                      allowClear
                      style={{ width: 130 }}
                      options={methodOptions.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </Form.Item>
                  <Form.Item name="reference" label="المرجع">
                    <Input placeholder="رقم الإيصال" style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="description" label="البيان">
                    <Input placeholder="اختياري" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تسجيل السند
                    </Button>
                  </Form.Item>
                </Form>
              </Card>
            ),
          },
          {
            key: 'payment',
            label: 'سند صرف',
            children: (
              <Card title="دفع لمورد">
                <Form
                  form={paymentForm}
                  layout="inline"
                  onFinish={(v) =>
                    submit('/api/v1/vouchers/payments', v, paymentForm, 'تم تسجيل سند الصرف ✔')
                  }
                >
                  <Form.Item name="supplier_id" label="المورد" rules={[{ required: true, message: 'اختر المورد' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      style={{ width: 240 }}
                      placeholder="اختر المورد"
                      options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
                  </Form.Item>
                  <Form.Item name="payment_method" label="طريقة الدفع">
                    <Select
                      allowClear
                      style={{ width: 130 }}
                      options={methodOptions.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </Form.Item>
                  <Form.Item name="reference" label="المرجع">
                    <Input placeholder="رقم الشيك/الإيصال" style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item name="description" label="البيان">
                    <Input placeholder="اختياري" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تسجيل السند
                    </Button>
                  </Form.Item>
                </Form>
              </Card>
            ),
          },
          {
            key: 'handover',
            label: 'توريد مندوب',
            children: (
              <Card title="استلام نقدية من عهدة مندوب">
                <Form
                  form={handoverForm}
                  layout="inline"
                  onFinish={(v) =>
                    submit('/api/v1/vouchers/handovers', v, handoverForm, 'تم تسجيل التوريد ✔')
                  }
                >
                  <Form.Item name="rep_user_id" label="المندوب" rules={[{ required: true, message: 'اختر المندوب' }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      style={{ width: 240 }}
                      placeholder="اختر المندوب"
                      options={reps.map((r) => ({ value: r.id, label: r.full_name || r.username }))}
                    />
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
                  </Form.Item>
                  <Form.Item name="reference" label="المرجع">
                    <Input placeholder="رقم الإيصال" style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="description" label="البيان">
                    <Input placeholder="اختياري" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تسجيل التوريد
                    </Button>
                  </Form.Item>
                </Form>
              </Card>
            ),
          },
          {
            key: 'statement',
            label: 'كشف حساب',
            children: (
              <Card
                title="كشف حساب"
                extra={
                  statement && (
                    <Button icon={<PrinterOutlined />} onClick={printStatement}>
                      طباعة
                    </Button>
                  )
                }
              >
                <Space wrap style={{ marginBottom: 16 }}>
                  <Select
                    value={stKind}
                    style={{ width: 130 }}
                    onChange={(v) => {
                      setStKind(v);
                      setStParty(undefined);
                      setStatement(null);
                    }}
                    options={[
                      { value: 'customer', label: 'عميل' },
                      { value: 'supplier', label: 'مورد' },
                      { value: 'rep', label: 'عهدة مندوب' },
                    ]}
                  />
                  <Select
                    showSearch
                    optionFilterProp="label"
                    style={{ width: 240 }}
                    placeholder="اختر الطرف"
                    value={stParty}
                    onChange={setStParty}
                    options={stPartyOptions}
                  />
                  <DatePicker.RangePicker value={stRange as any} onChange={(v) => setStRange(v as any)} />
                  <Button type="primary" icon={<FileSearchOutlined />} onClick={loadStatement}>
                    عرض الكشف
                  </Button>
                </Space>

                {statement && (
                  <>
                    <Descriptions bordered size="small" column={4} style={{ marginBottom: 12 }}>
                      <Descriptions.Item label="رصيد أول المدة">
                        {money(statement.opening_balance)}
                      </Descriptions.Item>
                      <Descriptions.Item label="إجمالي مدين">{money(statement.total_debit)}</Descriptions.Item>
                      <Descriptions.Item label="إجمالي دائن">{money(statement.total_credit)}</Descriptions.Item>
                      <Descriptions.Item label="الرصيد النهائي">
                        <b style={{ color: Number(statement.closing_balance) > 0 ? '#d64545' : '#2e9e6b' }}>
                          {money(statement.closing_balance)}
                        </b>
                      </Descriptions.Item>
                    </Descriptions>
                    <Table<StatementLine>
                      rowKey={(r) => `${r.entry_id}-${r.entry_date}-${r.debit}-${r.credit}`}
                      loading={stLoading}
                      dataSource={statement.lines}
                      pagination={{ pageSize: 25 }}
                      size="small"
                      columns={[
                        { title: 'التاريخ', dataIndex: 'entry_date', width: 110 },
                        {
                          title: 'النوع',
                          dataIndex: 'entry_type',
                          width: 120,
                          render: (v: string) => ENTRY_TYPE_LABEL[v] || v,
                        },
                        { title: 'البيان', dataIndex: 'description' },
                        {
                          title: 'مدين',
                          dataIndex: 'debit',
                          width: 110,
                          align: 'left' as const,
                          render: (v: string) => (Number(v) ? money(v) : ''),
                        },
                        {
                          title: 'دائن',
                          dataIndex: 'credit',
                          width: 110,
                          align: 'left' as const,
                          render: (v: string) => (Number(v) ? money(v) : ''),
                        },
                        {
                          title: 'الرصيد',
                          dataIndex: 'balance',
                          width: 120,
                          align: 'left' as const,
                          render: (v: string) => <b>{money(v)}</b>,
                        },
                      ]}
                    />
                  </>
                )}
              </Card>
            ),
          },
        ]}
      />

      <Card
        title="سجل السندات"
        style={{ marginTop: 16 }}
        extra={
          <Space wrap>
            <Select
              placeholder="نوع السند"
              allowClear
              style={{ width: 140 }}
              value={kindFilter}
              onChange={setKindFilter}
              options={[
                { value: 'receipt', label: 'سند قبض' },
                { value: 'payment', label: 'سند صرف' },
                { value: 'rep_handover', label: 'توريد مندوب' },
              ]}
            />
            <DatePicker.RangePicker value={range as any} onChange={(v) => setRange(v as any)} />
            <Button onClick={loadVouchers}>تحديث</Button>
          </Space>
        }
      >
        <Table<VoucherRecord>
          rowKey="id"
          loading={loading}
          dataSource={vouchers}
          columns={voucherColumns}
          pagination={{ pageSize: 20, showTotal: (t) => `إجمالي ${t}` }}
          size="small"
        />
      </Card>
    </div>
  );
};

export default Vouchers;

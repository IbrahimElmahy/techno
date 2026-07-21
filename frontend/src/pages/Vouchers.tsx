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
  Alert,
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

  const [treasuries, setTreasuries] = useState<any[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<any[]>([]);
  const [cheques, setCheques] = useState<any[]>([]);
  const [periodLock, setPeriodLock] = useState<string | null>(null);

  const [receiptForm] = Form.useForm();
  const [paymentForm] = Form.useForm();
  const [handoverForm] = Form.useForm();
  const [expenseForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [treasuryForm] = Form.useForm();
  const [chequeForm] = Form.useForm();

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

  const loadTreasuries = useCallback(async () => {
    try {
      const { data } = await api.get<any[]>('/api/v1/treasuries');
      setTreasuries(data);
    } catch {
      /* interceptor */
    }
  }, []);

  const loadCheques = useCallback(async () => {
    try {
      const { data } = await api.get<any[]>('/api/v1/cheques');
      setCheques(data);
    } catch {
      /* interceptor */
    }
  }, []);

  useEffect(() => {
    loadTreasuries();
    loadCheques();
    api
      .get<any[]>('/api/v1/accounts')
      .then((r) => setExpenseAccounts(r.data.filter((a) => a.nature === 'expense' && a.is_postable)))
      .catch(() => {});
    api
      .get<{ locked_through: string | null }>('/api/v1/period-lock')
      .then((r) => setPeriodLock(r.data.locked_through))
      .catch(() => {});
  }, [loadTreasuries, loadCheques]);

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
      loadTreasuries();
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

      {periodLock && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`الفترة مقفلة حتى ${periodLock} — أي سند بتاريخ أقدم أو مساوٍ هيترفض.`}
        />
      )}

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
                  <Form.Item name="treasury_id" label="الخزينة">
                    <Select
                      allowClear
                      style={{ width: 170 }}
                      placeholder="الافتراضية"
                      options={treasuries.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))}
                    />
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
                  <Form.Item name="treasury_id" label="الخزينة">
                    <Select
                      allowClear
                      style={{ width: 170 }}
                      placeholder="الافتراضية"
                      options={treasuries.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))}
                    />
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
            key: 'expense',
            label: 'سند مصروف',
            children: (
              <Card title="صرف مصروف من الخزينة">
                <Form
                  form={expenseForm}
                  layout="inline"
                  onFinish={(v) =>
                    submit('/api/v1/vouchers/expenses', v, expenseForm, 'تم تسجيل سند المصروف ✔')
                  }
                >
                  <Form.Item
                    name="expense_account_id"
                    label="حساب المصروف"
                    rules={[{ required: true, message: 'اختر حساب المصروف' }]}
                  >
                    <Select
                      showSearch
                      optionFilterProp="label"
                      style={{ width: 240 }}
                      placeholder="إيجار / مرتبات / بنزين…"
                      options={expenseAccounts.map((a) => ({ value: a.id, label: a.name || a.code }))}
                    />
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="treasury_id" label="الخزينة">
                    <Select
                      allowClear
                      style={{ width: 170 }}
                      placeholder="الافتراضية"
                      options={treasuries.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))}
                    />
                  </Form.Item>
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
                  </Form.Item>
                  <Form.Item name="description" label="البيان">
                    <Input placeholder="اختياري" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تسجيل المصروف
                    </Button>
                  </Form.Item>
                </Form>
                {expenseAccounts.length === 0 && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginTop: 12 }}
                    message="مفيش حسابات مصروفات"
                    description="أضف حساب مصروف من شجرة الحسابات (طبيعة: مصروفات) عشان تقدر تصرف عليه."
                  />
                )}
              </Card>
            ),
          },
          {
            key: 'transfer',
            label: 'تحويل بين الخزائن',
            children: (
              <Card title="تحويل نقدية بين خزينتين">
                <Form
                  form={transferForm}
                  layout="inline"
                  onFinish={(v) =>
                    submit('/api/v1/vouchers/transfers', v, transferForm, 'تم تسجيل التحويل ✔')
                  }
                >
                  <Form.Item name="from_treasury_id" label="من" rules={[{ required: true, message: 'اختر الخزينة' }]}>
                    <Select
                      style={{ width: 200 }}
                      options={treasuries
                        .filter((t) => t.active)
                        .map((t) => ({ value: t.id, label: `${t.name} (${money(t.balance)})` }))}
                    />
                  </Form.Item>
                  <Form.Item name="to_treasury_id" label="إلى" rules={[{ required: true, message: 'اختر الخزينة' }]}>
                    <Select
                      style={{ width: 200 }}
                      options={treasuries.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))}
                    />
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item name="voucher_date" label="التاريخ" initialValue={dayjs()}>
                    <DatePicker />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تحويل
                    </Button>
                  </Form.Item>
                </Form>

                <Table
                  rowKey="id"
                  size="small"
                  style={{ marginTop: 20 }}
                  title={() => 'الخزائن'}
                  dataSource={treasuries}
                  pagination={false}
                  columns={[
                    { title: 'الخزينة', dataIndex: 'name' },
                    {
                      title: 'النوع',
                      dataIndex: 'kind',
                      width: 100,
                      render: (v: string) => (
                        <Tag color={v === 'bank' ? 'purple' : 'gold'}>{v === 'bank' ? 'بنك' : 'نقدية'}</Tag>
                      ),
                    },
                    { title: 'البنك', dataIndex: 'bank_name', width: 140 },
                    {
                      title: 'الرصيد',
                      dataIndex: 'balance',
                      width: 150,
                      align: 'left' as const,
                      render: (v: string) => <b>{money(v)}</b>,
                    },
                    {
                      title: '',
                      width: 110,
                      render: (_: any, t: any) =>
                        t.is_default ? <Tag color="blue">الافتراضية</Tag> : t.active ? null : <Tag>موقوفة</Tag>,
                    },
                  ]}
                />

                <Form
                  form={treasuryForm}
                  layout="inline"
                  style={{ marginTop: 16 }}
                  onFinish={async (v) => {
                    setPosting(true);
                    try {
                      await api.post('/api/v1/treasuries', v);
                      message.success('تم إنشاء الخزينة ✔');
                      treasuryForm.resetFields();
                      loadTreasuries();
                    } catch {
                      /* interceptor */
                    } finally {
                      setPosting(false);
                    }
                  }}
                >
                  <Form.Item name="name" label="خزينة جديدة" rules={[{ required: true, message: 'اكتب الاسم' }]}>
                    <Input placeholder="اسم الخزينة" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item name="kind" label="النوع" initialValue="cash">
                    <Select
                      style={{ width: 120 }}
                      options={[
                        { value: 'cash', label: 'نقدية' },
                        { value: 'bank', label: 'بنك' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="bank_name" label="البنك">
                    <Input placeholder="اختياري" style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item>
                    <Button htmlType="submit" loading={posting}>
                      إضافة
                    </Button>
                  </Form.Item>
                </Form>
              </Card>
            ),
          },
          {
            key: 'cheques',
            label: 'الشيكات',
            children: (
              <Card title="الشيكات">
                <Form
                  form={chequeForm}
                  layout="inline"
                  onFinish={async (v) => {
                    setPosting(true);
                    try {
                      await api.post('/api/v1/cheques', {
                        ...v,
                        amount: String(v.amount),
                        due_date: v.due_date.format('YYYY-MM-DD'),
                      });
                      message.success('تم تسجيل الشيك ✔');
                      chequeForm.resetFields();
                      loadCheques();
                    } catch {
                      /* interceptor */
                    } finally {
                      setPosting(false);
                    }
                  }}
                >
                  <Form.Item name="direction" label="النوع" initialValue="incoming" rules={[{ required: true }]}>
                    <Select
                      style={{ width: 130 }}
                      options={[
                        { value: 'incoming', label: 'وارد من عميل' },
                        { value: 'outgoing', label: 'صادر لمورد' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate>
                    {({ getFieldValue }) =>
                      getFieldValue('direction') === 'outgoing' ? (
                        <Form.Item name="supplier_id" label="المورد" rules={[{ required: true, message: 'اختر المورد' }]}>
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ width: 200 }}
                            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                          />
                        </Form.Item>
                      ) : (
                        <Form.Item name="customer_id" label="العميل" rules={[{ required: true, message: 'اختر العميل' }]}>
                          <Select
                            showSearch
                            optionFilterProp="label"
                            style={{ width: 200 }}
                            options={customers.map((c) => ({ value: c.id, label: c.name }))}
                          />
                        </Form.Item>
                      )
                    }
                  </Form.Item>
                  <Form.Item name="cheque_number" label="رقم الشيك" rules={[{ required: true, message: 'أدخل الرقم' }]}>
                    <Input style={{ width: 120 }} />
                  </Form.Item>
                  <Form.Item name="bank_name" label="البنك">
                    <Input style={{ width: 130 }} />
                  </Form.Item>
                  <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                    <InputNumber min={0.01} step={0.01} style={{ width: 130 }} />
                  </Form.Item>
                  <Form.Item name="due_date" label="الاستحقاق" rules={[{ required: true, message: 'أدخل التاريخ' }]}>
                    <DatePicker />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={posting}>
                      تسجيل الشيك
                    </Button>
                  </Form.Item>
                </Form>

                <Table
                  rowKey="id"
                  size="small"
                  style={{ marginTop: 20 }}
                  dataSource={cheques}
                  pagination={{ pageSize: 15 }}
                  columns={[
                    { title: 'المستند', dataIndex: 'document_number', width: 120 },
                    {
                      title: 'النوع',
                      dataIndex: 'direction',
                      width: 110,
                      render: (v: string) => (
                        <Tag color={v === 'incoming' ? 'green' : 'red'}>{v === 'incoming' ? 'وارد' : 'صادر'}</Tag>
                      ),
                    },
                    { title: 'رقم الشيك', dataIndex: 'cheque_number', width: 110 },
                    { title: 'البنك', dataIndex: 'bank_name', width: 120 },
                    {
                      title: 'المبلغ',
                      dataIndex: 'amount',
                      width: 130,
                      align: 'left' as const,
                      render: (v: string) => <b>{money(v)}</b>,
                    },
                    { title: 'الاستحقاق', dataIndex: 'due_date', width: 110 },
                    {
                      title: 'الحالة',
                      dataIndex: 'status',
                      width: 120,
                      render: (v: string) => {
                        const map: Record<string, [string, string]> = {
                          pending: ['orange', 'تحت التحصيل'],
                          settled: ['green', 'تم'],
                          bounced: ['red', 'مرتد'],
                          cancelled: ['default', 'ملغي'],
                        };
                        const [color, label] = map[v] || ['default', v];
                        return <Tag color={color}>{label}</Tag>;
                      },
                    },
                    {
                      title: '',
                      width: 240,
                      render: (_: any, c: any) =>
                        c.status === 'settled' ? (
                          <Popconfirm
                            title="عكس التحصيل؟"
                            description="القيمة هترجع للحساب الوسيط وتخرج من الخزينة، والشيك يرجع تحت التحصيل."
                            okText="عكس"
                            cancelText="إلغاء"
                            okButtonProps={{ danger: true }}
                            onConfirm={async () => {
                              try {
                                await api.post(`/api/v1/cheques/${c.id}/unsettle`);
                                message.success('تم عكس التحصيل — الشيك رجع تحت التحصيل');
                                loadCheques();
                                loadTreasuries();
                              } catch {
                                /* interceptor */
                              }
                            }}
                          >
                            <Button size="small" icon={<UndoOutlined />}>
                              {c.direction === 'incoming' ? 'عكس التحصيل' : 'عكس الصرف'}
                            </Button>
                          </Popconfirm>
                        ) : c.status !== 'pending' ? null : (
                          <Space>
                            <Button
                              size="small"
                              type="primary"
                              onClick={async () => {
                                try {
                                  await api.post(`/api/v1/cheques/${c.id}/settle`, {});
                                  message.success(c.direction === 'incoming' ? 'تم التحصيل ✔' : 'تم الصرف ✔');
                                  loadCheques();
                                  loadTreasuries();
                                } catch {
                                  /* interceptor */
                                }
                              }}
                            >
                              {c.direction === 'incoming' ? 'تحصيل' : 'صرف'}
                            </Button>
                            {c.direction === 'incoming' && (
                              <Popconfirm
                                title="ارتداد الشيك؟"
                                description="الدين هيرجع على العميل."
                                okText="ارتداد"
                                cancelText="إلغاء"
                                okButtonProps={{ danger: true }}
                                onConfirm={async () => {
                                  try {
                                    await api.post(`/api/v1/cheques/${c.id}/bounce`);
                                    message.success('تم تسجيل الارتداد');
                                    loadCheques();
                                  } catch {
                                    /* interceptor */
                                  }
                                }}
                              >
                                <Button size="small" danger>
                                  ارتداد
                                </Button>
                              </Popconfirm>
                            )}
                          </Space>
                        ),
                    },
                  ]}
                />
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

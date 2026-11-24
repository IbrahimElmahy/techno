import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, DatePicker, Form, InputNumber, Modal, Space, Table, Tag, Tooltip, message,
} from 'antd';
import { PrinterOutlined, ReloadOutlined, SettingOutlined, WalletOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ExportExcelButton from '../components/ExportExcelButton';
import ShareButton from '../components/ShareButton';
import { money } from '../utils/money';
import { printReport, printMoney } from '../print/reportSheet';

interface Row {
  rep_user_id: number;
  rep_name: string;
  sales: string;
  returns: string;
  net_sales: string;
  collected: string;
  opening_debt: string;
  debt: string;
  credit: string;
  credit_source: 'rep' | 'customers';
  debt_after_credit: string;
  allowed_debt: string;
  excess: string;
  penalty: string;
  collection_rate: string | null;
  dso: string | null;
}

interface Report {
  allowed_debt_pct: string;
  penalty_per_thousand: string;
  days: number;
  rows: Row[];
}

interface CustomerCredit {
  customer_id: number;
  name: string;
  monthly_credit: string | null;
}

const num = (v: unknown) => Number(v || 0);
const pctText = (v: string | null) => (v == null ? '-' : `${num(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}٪`);

export default function RepEfficiency() {
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm] = Form.useForm();
  const [creditRep, setCreditRep] = useState<Row | null>(null);
  const [repAllowance, setRepAllowance] = useState<number | null>(null);
  const [customers, setCustomers] = useState<CustomerCredit[]>([]);
  const [creditLoading, setCreditLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/rep-efficiency', {
        params: { year: month.year(), month: month.month() + 1 },
      });
      setReport(res.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
    } finally { setLoading(false); }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const rows = report?.rows || [];
  const pct = report ? num(report.allowed_debt_pct) : 25;

  const totals = useMemo(() => {
    const sum = (k: keyof Row) => rows.reduce((s, r) => s + num(r[k]), 0);
    return {
      sales: sum('sales'), returns: sum('returns'), net_sales: sum('net_sales'),
      collected: sum('collected'), opening_debt: sum('opening_debt'), debt: sum('debt'),
      credit: sum('credit'), debt_after_credit: sum('debt_after_credit'),
      allowed_debt: sum('allowed_debt'), excess: sum('excess'), penalty: sum('penalty'),
    };
  }, [rows]);

  const openCredits = async (r: Row) => {
    setCreditRep(r);
    setCreditLoading(true);
    try {
      const res = await api.get(`/api/v1/rep-efficiency/reps/${r.rep_user_id}/customers`);
      setRepAllowance(res.data.credit_allowance == null ? null : num(res.data.credit_allowance));
      setCustomers(res.data.customers || []);
    } catch {
      message.error('تعذر تحميل عملاء المندوب');
    } finally { setCreditLoading(false); }
  };

  const saveRepAllowance = async (v: number | null) => {
    if (!creditRep) return;
    try {
      await api.put(`/api/v1/rep-efficiency/reps/${creditRep.rep_user_id}/credit`, { amount: v });
      setRepAllowance(v);
      message.success('تم الحفظ');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
    }
  };

  const saveCustomerCredit = async (c: CustomerCredit, v: number | null) => {
    if (num(c.monthly_credit) === num(v)) return;
    try {
      await api.put(`/api/v1/rep-efficiency/customers/${c.customer_id}/credit`, { amount: v });
      setCustomers((prev) => prev.map((x) => (x.customer_id === c.customer_id
        ? { ...x, monthly_credit: v ? String(v) : null } : x)));
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
    }
  };

  const openSettings = () => {
    settingsForm.setFieldsValue({
      allowed_debt_pct: report ? num(report.allowed_debt_pct) : 25,
      penalty_per_thousand: report ? num(report.penalty_per_thousand) : 20,
    });
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    const v = await settingsForm.validateFields();
    try {
      await api.put('/api/v1/rep-efficiency/settings', v);
      setSettingsOpen(false);
      message.success('تم الحفظ');
      void load();
    } catch (err: any) {
      message.error(err?.response?.status === 403 ? 'لا تملك صلاحية تعديل الإعدادات'
        : err?.response?.data?.detail?.message || 'تعذر الحفظ');
    }
  };

  const m = (v: unknown) => money(v);
  const columns = [
    { title: 'المندوب', dataIndex: 'rep_name', fixed: 'left' as const, width: 170 },
    { title: 'المبيعات', dataIndex: 'sales', render: m },
    { title: 'المرتجعات', dataIndex: 'returns', render: m },
    { title: 'صافي المبيعات', dataIndex: 'net_sales', render: m },
    { title: 'التحصيل', dataIndex: 'collected', render: m },
    { title: 'نسبة التحصيل', dataIndex: 'collection_rate', render: pctText },
    { title: 'مديونية أول الشهر', dataIndex: 'opening_debt', render: m },
    { title: 'المديونية', dataIndex: 'debt', render: m },
    {
      title: 'الإئتمان', dataIndex: 'credit',
      render: (v: string, r: Row) => (
        <Space size={4}>
          <span>{m(v)}</span>
          <Tooltip title="الإئتمان">
            <Button size="small" type="text" icon={<WalletOutlined />} onClick={() => openCredits(r)} />
          </Tooltip>
        </Space>
      ),
    },
    { title: 'المديونية بعد الإئتمان', dataIndex: 'debt_after_credit', render: m },
    { title: `المسموح (${pct}٪ من المبيعات)`, dataIndex: 'allowed_debt', render: m },
    {
      title: 'الزيادة', dataIndex: 'excess',
      render: (v: string) => (num(v) > 0 ? <Tag color="red">{m(v)}</Tag> : <Tag color="green">{m(0)}</Tag>),
    },
    {
      title: 'الجزاء', dataIndex: 'penalty',
      render: (v: string) => <b style={{ color: num(v) > 0 ? '#cf1322' : undefined }}>{m(v)}</b>,
    },
    { title: 'أيام التحصيل', dataIndex: 'dso', render: (v: string | null) => (v == null ? '-' : num(v).toFixed(0)) },
  ];

  const printIt = () => printReport<Row>(
    {
      title: 'تقرير الكفاءات',
      meta: [
        ['الشهر', month.format('YYYY/MM')],
        ['المديونية المسموحة', `${pct}% من صافي المبيعات`],
        ['الجزاء', `${report ? num(report.penalty_per_thousand) : 20} لكل 1000 زيادة`],
      ],
      compact: true,
    },
    [
      { title: 'المندوب', value: 'rep_name' },
      { title: 'صافي المبيعات', value: (r) => printMoney(r.net_sales), numeric: true },
      { title: 'التحصيل', value: (r) => printMoney(r.collected), numeric: true },
      { title: 'نسبة التحصيل', value: (r) => pctText(r.collection_rate), center: true },
      { title: 'المديونية', value: (r) => printMoney(r.debt), numeric: true },
      { title: 'الإئتمان', value: (r) => printMoney(r.credit), numeric: true },
      { title: 'بعد الإئتمان', value: (r) => printMoney(r.debt_after_credit), numeric: true },
      { title: 'المسموح', value: (r) => printMoney(r.allowed_debt), numeric: true },
      { title: 'الزيادة', value: (r) => printMoney(r.excess), numeric: true },
      { title: 'الجزاء', value: (r) => printMoney(r.penalty), numeric: true },
    ],
    rows,
    [
      { label: 'إجمالي صافي المبيعات', value: printMoney(totals.net_sales) },
      { label: 'إجمالي التحصيل', value: printMoney(totals.collected) },
      { label: 'إجمالي الجزاءات', value: printMoney(totals.penalty) },
    ],
  );

  const creditTotal = customers.reduce((s, c) => s + num(c.monthly_credit), 0);

  return (
    <Card
      title="تقرير الكفاءات"
      extra={(
        <Space wrap>
          <DatePicker picker="month" value={month} allowClear={false} format="YYYY/MM"
            onChange={(d) => d && setMonth(d.startOf('month'))} />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>تحديث</Button>
          <Button icon={<SettingOutlined />} onClick={openSettings}>الإعدادات</Button>
          <Button icon={<PrinterOutlined />} onClick={printIt} disabled={!rows.length}>طباعة</Button>
          <ShareButton run={printIt} disabled={!rows.length} />
          <ExportExcelButton name={`تقرير الكفاءات ${month.format('YYYY-MM')}`} rows={rows}
            tableColumns={columns as any} />
        </Space>
      )}
    >
      <Table<Row>
        rowKey="rep_user_id"
        size="small"
        loading={loading}
        dataSource={rows}
        columns={columns as any}
        pagination={false}
        scroll={{ x: 1900 }}
        summary={() => (rows.length ? (
          <Table.Summary fixed>
            <Table.Summary.Row style={{ fontWeight: 700, background: '#f6faf3' }}>
              <Table.Summary.Cell index={0}>الإجمالي</Table.Summary.Cell>
              <Table.Summary.Cell index={1}>{m(totals.sales)}</Table.Summary.Cell>
              <Table.Summary.Cell index={2}>{m(totals.returns)}</Table.Summary.Cell>
              <Table.Summary.Cell index={3}>{m(totals.net_sales)}</Table.Summary.Cell>
              <Table.Summary.Cell index={4}>{m(totals.collected)}</Table.Summary.Cell>
              <Table.Summary.Cell index={5}>
                {pctText(totals.opening_debt + totals.net_sales > 0
                  ? String((totals.collected / (totals.opening_debt + totals.net_sales)) * 100) : null)}
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6}>{m(totals.opening_debt)}</Table.Summary.Cell>
              <Table.Summary.Cell index={7}>{m(totals.debt)}</Table.Summary.Cell>
              <Table.Summary.Cell index={8}>{m(totals.credit)}</Table.Summary.Cell>
              <Table.Summary.Cell index={9}>{m(totals.debt_after_credit)}</Table.Summary.Cell>
              <Table.Summary.Cell index={10}>{m(totals.allowed_debt)}</Table.Summary.Cell>
              <Table.Summary.Cell index={11}>{m(totals.excess)}</Table.Summary.Cell>
              <Table.Summary.Cell index={12}>{m(totals.penalty)}</Table.Summary.Cell>
              <Table.Summary.Cell index={13} />
            </Table.Summary.Row>
          </Table.Summary>
        ) : null)}
      />

      <Modal title="إعدادات تقرير الكفاءات" open={settingsOpen} okText="حفظ" cancelText="إلغاء"
        onOk={() => void saveSettings()} onCancel={() => setSettingsOpen(false)} destroyOnClose>
        <Form form={settingsForm} layout="vertical">
          <Form.Item name="allowed_debt_pct" label="المديونية المسموحة (٪ من صافي المبيعات)"
            rules={[{ required: true }]}>
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="penalty_per_thousand" label="الجزاء لكل 1000 زيادة"
            rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={creditRep ? `الإئتمان — ${creditRep.rep_name}` : ''} open={!!creditRep}
        footer={<Button onClick={() => { setCreditRep(null); void load(); }}>إغلاق</Button>}
        onCancel={() => { setCreditRep(null); void load(); }} width={640} destroyOnClose>
        <Space style={{ marginBottom: 12 }} wrap>
          <span>إئتمان المندوب</span>
          <InputNumber min={0} value={repAllowance ?? undefined} style={{ width: 180 }}
            placeholder={money(creditTotal)}
            onBlur={(e) => {
              const raw = e.target.value.replace(/[^\d.]/g, '');
              const v = raw === '' ? null : Number(raw);
              if (v !== repAllowance) void saveRepAllowance(v);
            }} />
          <span>إجمالي إئتمان العملاء: <b>{money(creditTotal)}</b></span>
        </Space>
        <Table<CustomerCredit>
          rowKey="customer_id" size="small" loading={creditLoading}
          dataSource={customers} pagination={false} scroll={{ y: 420 }}
          columns={[
            { title: 'العميل', dataIndex: 'name' },
            {
              title: 'الإئتمان الشهري', dataIndex: 'monthly_credit', width: 200,
              render: (v: string | null, c) => (
                <InputNumber min={0} defaultValue={v == null ? undefined : num(v)} style={{ width: '100%' }}
                  onBlur={(e) => {
                    const raw = e.target.value.replace(/[^\d.]/g, '');
                    void saveCustomerCredit(c, raw === '' ? null : Number(raw));
                  }} />
              ),
            },
          ]}
        />
      </Modal>
    </Card>
  );
}

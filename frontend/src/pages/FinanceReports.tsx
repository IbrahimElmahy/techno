import React, { useCallback, useEffect, useState } from 'react';
import {
  Card,
  Tabs,
  Table,
  DatePicker,
  Select,
  Space,
  Button,
  Statistic,
  Row,
  Col,
  Tag,
  Descriptions,
  Alert,
  message,
} from 'antd';
import { ReloadOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';

interface ReportLine {
  account_id: number;
  code: string | null;
  name: string | null;
  amount: string;
}

interface IncomeStatement {
  income: ReportLine[];
  expenses: ReportLine[];
  total_income: string;
  total_expenses: string;
  net_profit: string;
}

interface BalanceSheet {
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  total_assets: string;
  total_liabilities: string;
  total_equity: string;
  net_profit: string;
  balanced: boolean;
}

interface AgingRow {
  party_id: number;
  party_name: string;
  total: string;
  buckets: Record<string, string>;
}

interface VatReturn {
  rate_pct: string;
  output_tax: string;
  input_tax: string;
  net_payable: string;
}

interface CommissionRow {
  rep_user_id: number;
  rep_name: string;
  basis: string;
  rate_pct: string;
  base_amount: string;
  commission: string;
}

const money = (v: string | number) =>
  Number(v).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BUCKETS = ['0-30', '31-60', '61-90', '90+'];

const FinanceReports: React.FC = () => {
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>([
    dayjs().startOf('year'),
    dayjs(),
  ]);
  const [income, setIncome] = useState<IncomeStatement | null>(null);
  const [sheet, setSheet] = useState<BalanceSheet | null>(null);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [agingParty, setAgingParty] = useState<'customers' | 'suppliers'>('customers');
  const [vat, setVat] = useState<VatReturn | null>(null);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const params = useCallback(() => {
    const p: Record<string, string> = {};
    if (range?.[0]) p.date_from = range[0].format('YYYY-MM-DD');
    if (range?.[1]) p.date_to = range[1].format('YYYY-MM-DD');
    return p;
  }, [range]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const p = params();
      const [i, b, a, v, c] = await Promise.all([
        api.get<IncomeStatement>('/api/v1/reports/income-statement', { params: p }),
        api.get<BalanceSheet>('/api/v1/reports/balance-sheet', {
          params: p.date_to ? { as_of: p.date_to } : {},
        }),
        api.get<AgingRow[]>('/api/v1/reports/aging', { params: { party: agingParty } }),
        api.get<VatReturn>('/api/v1/reports/vat-return', { params: p }),
        api.get<CommissionRow[]>('/api/v1/reports/commissions', { params: p }),
      ]);
      setIncome(i.data);
      setSheet(b.data);
      setAging(a.data);
      setVat(v.data);
      setCommissions(c.data);
    } catch {
      /* the interceptor surfaces the message */
    } finally {
      setLoading(false);
    }
  }, [params, agingParty]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const printBlock = (title: string, bodyHtml: string) => {
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title>
<style>
 body{font-family:'Segoe UI',Tahoma,sans-serif;padding:26px;color:#12303f}
 h1{color:#0e4c6d;font-size:21px;margin:0 0 4px}
 .sub{color:#5b7686;font-size:13px;margin-bottom:14px}
 table{width:100%;border-collapse:collapse;margin-top:10px}
 th{background:#0e4c6d;color:#fff;padding:7px;font-size:13px}
 td{border:1px solid #d5e2ea;padding:6px 8px;font-size:13px}
 td.num{text-align:left}
 tfoot td{font-weight:800;background:#f2f7fa}
 @media print{body{padding:0}}
</style></head><body>
<h1>تكنو ثيرم — ${title}</h1>
<div class="sub">${range?.[0] ? range[0].format('YYYY-MM-DD') : 'من البداية'} إلى ${range?.[1] ? range[1].format('YYYY-MM-DD') : 'اليوم'}</div>
${bodyHtml}
<script>window.onload=function(){window.print()}</script></body></html>`;
    const win = window.open('', '_blank', 'width=1000,height=900');
    if (!win) {
      message.error('اسمح بفتح النوافذ المنبثقة للطباعة');
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const linesTable = (rows: ReportLine[]) =>
    `<table><thead><tr><th>الحساب</th><th>القيمة</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${r.name || r.code || r.account_id}</td><td class="num">${money(r.amount)}</td></tr>`).join('') ||
      '<tr><td colspan="2">لا توجد حركة</td></tr>'
    }</tbody></table>`;

  const amountCol = {
    title: 'القيمة',
    dataIndex: 'amount',
    width: 160,
    align: 'left' as const,
    render: (v: string) => money(v),
  };
  const nameCol = {
    title: 'الحساب',
    render: (_: any, r: ReportLine) => r.name || r.code || `#${r.account_id}`,
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <DatePicker.RangePicker value={range as any} onChange={(v) => setRange(v as any)} />
        <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>
          تحديث
        </Button>
      </Space>

      <Tabs
        defaultActiveKey="income"
        items={[
          {
            key: 'income',
            label: 'قائمة الدخل',
            children: (
              <Card
                title="قائمة الدخل"
                extra={
                  income && (
                    <Button
                      icon={<PrinterOutlined />}
                      onClick={() =>
                        printBlock(
                          'قائمة الدخل',
                          `<h3>الإيرادات</h3>${linesTable(income.income)}
                           <h3>المصروفات</h3>${linesTable(income.expenses)}
                           <table><tfoot>
                            <tr><td>إجمالي الإيرادات</td><td class="num">${money(income.total_income)}</td></tr>
                            <tr><td>إجمالي المصروفات</td><td class="num">${money(income.total_expenses)}</td></tr>
                            <tr><td>صافي الربح</td><td class="num">${money(income.net_profit)}</td></tr>
                           </tfoot></table>`
                        )
                      }
                    >
                      طباعة
                    </Button>
                  )
                }
              >
                {income && (
                  <>
                    <Row gutter={16} style={{ marginBottom: 16 }}>
                      <Col span={8}>
                        <Card size="small">
                          <Statistic title="الإيرادات" value={Number(income.total_income)} precision={2} valueStyle={{ color: '#2e9e6b' }} />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small">
                          <Statistic title="المصروفات" value={Number(income.total_expenses)} precision={2} valueStyle={{ color: '#d64545' }} />
                        </Card>
                      </Col>
                      <Col span={8}>
                        <Card size="small">
                          <Statistic
                            title="صافي الربح"
                            value={Number(income.net_profit)}
                            precision={2}
                            valueStyle={{ color: Number(income.net_profit) >= 0 ? '#0e4c6d' : '#d64545' }}
                          />
                        </Card>
                      </Col>
                    </Row>
                    <Table rowKey="account_id" size="small" pagination={false} title={() => 'الإيرادات'} dataSource={income.income} columns={[nameCol, amountCol]} />
                    <Table
                      rowKey="account_id"
                      size="small"
                      pagination={false}
                      style={{ marginTop: 16 }}
                      title={() => 'المصروفات'}
                      dataSource={income.expenses}
                      columns={[nameCol, amountCol]}
                    />
                  </>
                )}
              </Card>
            ),
          },
          {
            key: 'sheet',
            label: 'الميزانية',
            children: (
              <Card title="المركز المالي (الميزانية)">
                {sheet && (
                  <>
                    {!sheet.balanced && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message="الميزانية غير متوازنة — راجع القيود اليدوية."
                      />
                    )}
                    <Descriptions bordered size="small" column={4} style={{ marginBottom: 12 }}>
                      <Descriptions.Item label="الأصول">{money(sheet.total_assets)}</Descriptions.Item>
                      <Descriptions.Item label="الالتزامات">{money(sheet.total_liabilities)}</Descriptions.Item>
                      <Descriptions.Item label="حقوق الملكية">{money(sheet.total_equity)}</Descriptions.Item>
                      <Descriptions.Item label="أرباح الفترة">{money(sheet.net_profit)}</Descriptions.Item>
                    </Descriptions>
                    <Table rowKey="account_id" size="small" pagination={false} title={() => 'الأصول'} dataSource={sheet.assets} columns={[nameCol, amountCol]} />
                    <Table rowKey="account_id" size="small" pagination={false} style={{ marginTop: 16 }} title={() => 'الالتزامات'} dataSource={sheet.liabilities} columns={[nameCol, amountCol]} />
                    <Table rowKey="account_id" size="small" pagination={false} style={{ marginTop: 16 }} title={() => 'حقوق الملكية'} dataSource={sheet.equity} columns={[nameCol, amountCol]} />
                  </>
                )}
              </Card>
            ),
          },
          {
            key: 'aging',
            label: 'أعمار الديون',
            children: (
              <Card
                title="أعمار الديون"
                extra={
                  <Select
                    value={agingParty}
                    style={{ width: 140 }}
                    onChange={(v) => setAgingParty(v)}
                    options={[
                      { value: 'customers', label: 'العملاء' },
                      { value: 'suppliers', label: 'الموردين' },
                    ]}
                  />
                }
              >
                <Table<AgingRow>
                  rowKey="party_id"
                  size="small"
                  loading={loading}
                  dataSource={aging}
                  pagination={{ pageSize: 20, showTotal: (t) => `إجمالي ${t}` }}
                  columns={[
                    { title: agingParty === 'customers' ? 'العميل' : 'المورد', dataIndex: 'party_name' },
                    ...BUCKETS.map((b) => ({
                      title: b === '90+' ? 'أكثر من 90 يوم' : `${b} يوم`,
                      dataIndex: ['buckets', b],
                      width: 130,
                      align: 'left' as const,
                      render: (v: string) => (Number(v) ? money(v) : ''),
                    })),
                    {
                      title: 'الإجمالي',
                      dataIndex: 'total',
                      width: 140,
                      align: 'left' as const,
                      render: (v: string) => <b>{money(v)}</b>,
                    },
                  ]}
                  summary={(rows) => {
                    const sum = rows.reduce((s, r) => s + Number(r.total), 0);
                    return (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={5}>
                          <b>الإجمالي العام</b>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5}>
                          <b>{money(sum)}</b>
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    );
                  }}
                />
              </Card>
            ),
          },
          {
            key: 'vat',
            label: 'الإقرار الضريبي',
            children: (
              <Card title="ضريبة القيمة المضافة">
                {vat && Number(vat.rate_pct) === 0 && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="الضريبة غير مفعّلة"
                    description="النسبة الحالية صفر — فعّلها من إعدادات المبيعات لتُحتسب على الفواتير الجديدة."
                  />
                )}
                {vat && (
                  <Row gutter={16}>
                    <Col span={6}>
                      <Card size="small">
                        <Statistic title="النسبة" value={Number(vat.rate_pct)} suffix="%" />
                      </Card>
                    </Col>
                    <Col span={6}>
                      <Card size="small">
                        <Statistic title="ضريبة المبيعات" value={Number(vat.output_tax)} precision={2} />
                      </Card>
                    </Col>
                    <Col span={6}>
                      <Card size="small">
                        <Statistic title="ضريبة المشتريات" value={Number(vat.input_tax)} precision={2} />
                      </Card>
                    </Col>
                    <Col span={6}>
                      <Card size="small">
                        <Statistic
                          title="المستحق للمصلحة"
                          value={Number(vat.net_payable)}
                          precision={2}
                          valueStyle={{ color: '#0e4c6d' }}
                        />
                      </Card>
                    </Col>
                  </Row>
                )}
              </Card>
            ),
          },
          {
            key: 'commissions',
            label: 'عمولات المناديب',
            children: (
              <Card title="عمولات المناديب">
                <Table<CommissionRow>
                  rowKey="rep_user_id"
                  size="small"
                  loading={loading}
                  dataSource={commissions}
                  pagination={false}
                  columns={[
                    { title: 'المندوب', dataIndex: 'rep_name' },
                    {
                      title: 'الأساس',
                      dataIndex: 'basis',
                      width: 130,
                      render: (v: string) => (
                        <Tag color={v === 'collection' ? 'green' : 'blue'}>
                          {v === 'collection' ? 'على التحصيل' : 'على المبيعات'}
                        </Tag>
                      ),
                    },
                    { title: 'النسبة', dataIndex: 'rate_pct', width: 90, render: (v: string) => `${Number(v)}%` },
                    {
                      title: 'الأساس المحتسب',
                      dataIndex: 'base_amount',
                      width: 160,
                      align: 'left' as const,
                      render: (v: string) => money(v),
                    },
                    {
                      title: 'العمولة',
                      dataIndex: 'commission',
                      width: 150,
                      align: 'left' as const,
                      render: (v: string) => <b>{money(v)}</b>,
                    },
                  ]}
                  summary={(rows) => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={4}>
                        <b>الإجمالي</b>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4}>
                        <b>{money(rows.reduce((s, r) => s + Number(r.commission), 0))}</b>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};

export default FinanceReports;

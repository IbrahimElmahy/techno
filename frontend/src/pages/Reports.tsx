import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Button, Space, DatePicker, Select, Divider } from 'antd';
import { FileExcelOutlined, FilePdfOutlined, AreaChartOutlined, DollarOutlined, ShoppingCartOutlined, BankOutlined } from '@ant-design/icons';
import { api, getApiBaseURL } from '../api/client';
import type { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

interface ReportSummary {
  sales_gross: number;
  sales_net: number;
  purchases_total: number;
  treasury_balance: number;
}

export default function Reports() {
  const [summary, setSummary] = useState<ReportSummary>({
    sales_gross: 0,
    sales_net: 0,
    purchases_total: 0,
    treasury_balance: 0,
  });
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  // Lookups for filters
  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      const from = dateRange?.[0];
      const to = dateRange?.[1];
      if (from) params.date_from = from.format('YYYY-MM-DD');
      if (to) params.date_to = to.format('YYYY-MM-DD');
      const res = await api.get('/api/v1/reports/summary', { params });
      setSummary(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadLookups = async () => {
    try {
      const [usersRes, custRes, supRes] = await Promise.all([
        api.get('/api/v1/users'),
        api.get('/api/v1/customers'),
        api.get('/api/v1/suppliers'),
      ]);
      setReps(usersRes.data.filter((u: any) => u.role === 'sales_rep'));
      setCustomers(custRes.data);
      setSuppliers(supRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchSummary();
    loadLookups();
  }, []);

  const handleExport = (reportType: string) => {
    // Generate full URL and trigger native browser file download
    const token = localStorage.getItem('token');
    const baseUrl = getApiBaseURL();
    const downloadUrl = `${baseUrl}/api/v1/reports/export?report_type=${reportType}&token=${token}`;
    
    // Create temp anchor to download
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `report_${reportType}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div>
      <Card title="لوحة التحكم والتقارير الإدارية الموحدة">
        <Space size="middle" style={{ marginBottom: 24, flexWrap: 'wrap' }}>
          <div>
            <span style={{ marginLeft: 8 }}>تحديد الفترة الزمنية:</span>
            <RangePicker
              style={{ width: 250 }}
              value={dateRange as any}
              onChange={(vals) => setDateRange(vals as [Dayjs | null, Dayjs | null] | null)}
            />
          </div>

          <div>
            <span style={{ marginLeft: 8 }}>المندوب:</span>
            <Select placeholder="اختر المندوب" style={{ width: 150 }} allowClear>
              {reps.map((r) => (
                <Select.Option key={r.id} value={r.id}>
                  {r.full_name}
                </Select.Option>
              ))}
            </Select>
          </div>

          <div>
            <span style={{ marginLeft: 8 }}>العميل:</span>
            <Select placeholder="اختر العميل" style={{ width: 150 }} allowClear>
              {customers.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name}
                </Select.Option>
              ))}
            </Select>
          </div>

          <div>
            <span style={{ marginLeft: 8 }}>المورد:</span>
            <Select placeholder="اختر المورد" style={{ width: 150 }} allowClear>
              {suppliers.map((s) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.name}
                </Select.Option>
              ))}
            </Select>
          </div>

          <Button type="primary" icon={<AreaChartOutlined />} onClick={fetchSummary} loading={loading}>
            تطبيق التصفية
          </Button>
        </Space>

        <Divider />

        <Row gutter={16}>
          <Col span={6}>
            <Card>
              <Statistic
                title="إجمالي المبيعات (قبل الخصم)"
                value={summary.sales_gross}
                precision={2}
                valueStyle={{ color: '#888' }}
                prefix={<DollarOutlined />}
                suffix="ج.م"
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="صافي إيراد المبيعات (Net)"
                value={summary.sales_net}
                precision={2}
                valueStyle={{ color: '#3f8600' }}
                prefix={<DollarOutlined />}
                suffix="ج.م"
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="إجمالي المشتريات المصروفة"
                value={summary.purchases_total}
                precision={2}
                valueStyle={{ color: '#cf1322' }}
                prefix={<ShoppingCartOutlined />}
                suffix="ج.م"
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="السيولة المتوفرة بالخزينة"
                value={summary.treasury_balance}
                precision={2}
                valueStyle={{ color: '#1d39c4' }}
                prefix={<BankOutlined />}
                suffix="ج.م"
              />
            </Card>
          </Col>
        </Row>

        <Divider orientation="right">تصدير التقارير الإدارية (Excel / CSV)</Divider>

        <Space size="large">
          <Card hoverable style={{ width: 220, textAlign: 'center' }}>
            <h4>تقرير المبيعات التفصيلي</h4>
            <p style={{ color: '#888', fontSize: '12px' }}>يشمل المبيعات والخصومات والمدفوع والآجل لكل عميل</p>
            <Button
              type="primary"
              icon={<FileExcelOutlined />}
              onClick={() => handleExport('sales')}
              style={{ backgroundColor: '#107c41', borderColor: '#107c41' }}
            >
              تصدير لملف إكسيل
            </Button>
          </Card>

          <Card hoverable style={{ width: 220, textAlign: 'center' }}>
            <h4>تقرير المشتريات الإجمالي</h4>
            <p style={{ color: '#888', fontSize: '12px' }}>تفاصيل الفواتير المستلمة والمستحقات الموردين المالية</p>
            <Button
              type="primary"
              icon={<FileExcelOutlined />}
              onClick={() => handleExport('purchases')}
              style={{ backgroundColor: '#107c41', borderColor: '#107c41' }}
            >
              تصدير لملف إكسيل
            </Button>
          </Card>

          <Card hoverable style={{ width: 220, textAlign: 'center' }}>
            <h4>تقرير أرصدة الحسابات</h4>
            <p style={{ color: '#888', fontSize: '12px' }}>ملخص الأرصدة المتوازنة للسيولة وحسابات المندوبين</p>
            <Button
              type="primary"
              icon={<FileExcelOutlined />}
              onClick={() => handleExport('treasury')}
              style={{ backgroundColor: '#107c41', borderColor: '#107c41' }}
            >
              تصدير لملف إكسيل
            </Button>
          </Card>
        </Space>
      </Card>
    </div>
  );
}

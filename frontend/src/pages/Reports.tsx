import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Button, Space, DatePicker, Select, Divider, Table, Tag, Input } from 'antd';
import { FileExcelOutlined, FilePdfOutlined, AreaChartOutlined, DollarOutlined, ShoppingCartOutlined, BankOutlined, WarningOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { api, getApiBaseURL } from '../api/client';

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

  // Lookups for filters
  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  // Stock planning (011): reorder + expiring-batches reports.
  const [reorder, setReorder] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [expBefore, setExpBefore] = useState('');

  const fetchReorder = async () => {
    try {
      const res = await api.get('/api/v1/stock/reorder');
      setReorder(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchExpiring = async () => {
    if (!expBefore) return;
    try {
      const res = await api.get('/api/v1/stock/expiring', { params: { before: expBefore } });
      setExpiring(res.data);
    } catch (err) { console.error(err); }
  };

  // Credit controls (012): exposure + overdue.
  const [exposure, setExposure] = useState<any[]>([]);
  const [overdue, setOverdue] = useState<any[]>([]);
  const [overdueAsOf, setOverdueAsOf] = useState('');

  const fetchExposure = async () => {
    try {
      const res = await api.get('/api/v1/reports/credit-exposure');
      setExposure(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchOverdue = async () => {
    try {
      const res = await api.get('/api/v1/reports/overdue',
        overdueAsOf ? { params: { as_of: overdueAsOf } } : undefined);
      setOverdue(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/summary');
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
    fetchReorder();
    fetchExposure();
    fetchOverdue();
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
            <RangePicker style={{ width: 250 }} />
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

        <Divider orientation="right">تخطيط المخزون (الحدود والصلاحية)</Divider>

        <Row gutter={16}>
          <Col span={12}>
            <Card size="small" title={<span><WarningOutlined /> أصناف تحتاج إعادة طلب (تحت/فوق الحد)</span>}
              extra={<Button size="small" onClick={fetchReorder}>تحديث</Button>}>
              <Table size="small" rowKey="item_id" dataSource={reorder} pagination={{ pageSize: 6 }}
                locale={{ emptyText: 'لا توجد أصناف خارج الحدود' }}
                columns={[
                  { title: 'الكود', dataIndex: 'code' },
                  { title: 'الصنف', dataIndex: 'name' },
                  { title: 'المتوفر', dataIndex: 'on_hand', render: (v: string) => parseFloat(v).toFixed(3) },
                  { title: 'الأدنى', dataIndex: 'min_stock', render: (v: string | null) => v ? parseFloat(v).toFixed(3) : '—' },
                  { title: 'الأقصى', dataIndex: 'max_stock', render: (v: string | null) => v ? parseFloat(v).toFixed(3) : '—' },
                  { title: 'الحالة', dataIndex: 'flag', render: (f: string) =>
                    f === 'below_min' ? <Tag color="red">تحت الحد الأدنى</Tag> : <Tag color="orange">فوق الحد الأقصى</Tag> },
                ]} />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" title={<span><ClockCircleOutlined /> دفعات قاربت الانتهاء</span>}
              extra={
                <Space>
                  <Input type="date" size="small" style={{ width: 150 }}
                    value={expBefore} onChange={(e) => setExpBefore(e.target.value)} />
                  <Button size="small" type="primary" onClick={fetchExpiring}>عرض</Button>
                </Space>
              }>
              <Table size="small" rowKey="id" dataSource={expiring} pagination={{ pageSize: 6 }}
                locale={{ emptyText: 'اختر تاريخاً واعرض الدفعات المنتهية قبله' }}
                columns={[
                  { title: 'الصنف #', dataIndex: 'item_id' },
                  { title: 'تاريخ الصلاحية', dataIndex: 'expiry_date' },
                  { title: 'الكمية', dataIndex: 'quantity', render: (v: string) => parseFloat(v).toFixed(3) },
                  { title: 'الموقع', dataIndex: 'location_id', render: (v: number, r: any) => `${r.location_kind} #${v}` },
                ]} />
            </Card>
          </Col>
        </Row>

        <Divider orientation="right">الائتمان والمديونية</Divider>

        <Row gutter={16}>
          <Col span={12}>
            <Card size="small" title={<span><DollarOutlined /> تعرّض العملاء الائتماني</span>}
              extra={<Button size="small" onClick={fetchExposure}>تحديث</Button>}>
              <Table size="small" rowKey="customer_id" dataSource={exposure} pagination={{ pageSize: 6 }}
                locale={{ emptyText: 'لا يوجد عملاء بحد ائتمان' }}
                columns={[
                  { title: 'الكود', dataIndex: 'code' },
                  { title: 'العميل', dataIndex: 'name' },
                  { title: 'الحد', dataIndex: 'credit_limit', render: (v: string) => parseFloat(v).toLocaleString('ar-EG') },
                  { title: 'المديونية', dataIndex: 'outstanding', render: (v: string) => parseFloat(v).toLocaleString('ar-EG') },
                  { title: 'المتاح', dataIndex: 'available', render: (v: string) => parseFloat(v).toLocaleString('ar-EG') },
                  { title: 'الحالة', dataIndex: 'over_limit', render: (o: boolean) =>
                    o ? <Tag color="red">تجاوز الحد</Tag> : <Tag color="green">ضمن الحد</Tag> },
                ]} />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" title={<span><WarningOutlined /> فواتير آجلة متأخرة</span>}
              extra={
                <Space>
                  <Input type="date" size="small" style={{ width: 150 }}
                    value={overdueAsOf} onChange={(e) => setOverdueAsOf(e.target.value)} />
                  <Button size="small" type="primary" onClick={fetchOverdue}>عرض</Button>
                </Space>
              }>
              <Table size="small" rowKey="invoice_id" dataSource={overdue} pagination={{ pageSize: 6 }}
                locale={{ emptyText: 'لا توجد فواتير متأخرة' }}
                columns={[
                  { title: 'الفاتورة', dataIndex: 'document_number' },
                  { title: 'العميل', dataIndex: 'customer_name' },
                  { title: 'الاستحقاق', dataIndex: 'due_date' },
                  { title: 'المديونية', dataIndex: 'outstanding', render: (v: string) => parseFloat(v).toLocaleString('ar-EG') },
                ]} />
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

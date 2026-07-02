import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, InputNumber, Select, Tag, message, Row, Col } from 'antd';
import { UserAddOutlined, SwapOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';

interface CustomerRecord {
  id: number;
  code: string;
  name: string;
  customer_type: 'trader' | 'plumber' | 'other';
  phone: string | null;
  rep_id: number;
  territory_id: number;
  default_price_tier: string | null;
  credit_limit: string | null;
  max_due_term_days: number | null;
  active: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  trader: 'تاجر / موزع',
  plumber: 'فني سباكة',
  other: 'آخر',
};

const TIER_LABELS: Record<string, string> = {
  commercial: 'تجاري',
  semi_commercial: 'نصف تجاري',
  wholesale: 'جملة',
  semi_wholesale: 'نصف جملة',
  consumer: 'مستهلك',
};

// Sub-component to fetch and render customer ledger balance dynamically per row (thin client)
const CustomerBalance = ({ customerId }: { customerId: number }) => {
  const [balance, setBalance] = useState<string>('...');
  
  useEffect(() => {
    api.get(`/api/v1/customers/${customerId}/account`)
      .then((res) => {
        setBalance(parseFloat(res.data.balance).toLocaleString('ar-EG', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }));
      })
      .catch(() => setBalance('خطأ'));
  }, [customerId]);

  return <span style={{ fontWeight: 'bold' }}>{balance} ج.م</span>;
};

export default function Customers() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [reassignVisible, setReassignVisible] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  
  const [form] = Form.useForm();
  const [reassignForm] = Form.useForm();
  const { user: currentUser } = useAuth();

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/customers');
      setCustomers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLookups = async () => {
    try {
      const [usersRes, territoriesRes] = await Promise.all([
        api.get('/api/v1/users'),
        api.get('/api/v1/territories'),
      ]);
      setReps(usersRes.data.filter((u: any) => u.role === 'sales_rep'));
      setTerritories(territoriesRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchLookups();
  }, []);

  const onCreateCustomer = async (values: any) => {
    try {
      await api.post('/api/v1/customers', values);
      message.success('تم تسجيل العميل بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchCustomers();
    } catch (err) {
      console.error(err);
    }
  };

  const onReassign = async (values: any) => {
    if (!selectedCustomer) return;
    try {
      await api.post(`/api/v1/customers/${selectedCustomer.id}/reassign`, {
        new_rep_id: values.new_rep_id,
        new_territory_id: values.new_territory_id,
      });
      message.success('تمت إعادة تعيين العميل والمندوب بنجاح');
      setReassignVisible(false);
      reassignForm.resetFields();
      fetchCustomers();
    } catch (err) {
      console.error(err);
    }
  };

  const columns = [
    {
      title: 'كود العميل',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => <Tag color="blue">{code}</Tag>,
    },
    {
      title: 'اسم العميل',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'نوع العميل',
      dataIndex: 'customer_type',
      key: 'customer_type',
      render: (type: string) => TYPE_LABELS[type] || type,
    },
    {
      title: 'رقم الهاتف',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone: string | null) => phone || '-',
    },
    {
      title: 'المندوب المسؤول',
      dataIndex: 'rep_id',
      key: 'rep_id',
      render: (repId: number) => {
        const rep = reps.find((r) => r.id === repId);
        return rep ? rep.full_name : `مندوب #${repId}`;
      },
    },
    {
      title: 'المنطقة',
      dataIndex: 'territory_id',
      key: 'territory_id',
      render: (tId: number) => {
        const territory = territories.find((t) => t.id === tId);
        return territory ? territory.name : `منطقة #${tId}`;
      },
    },
    {
      title: 'الفئة السعرية',
      dataIndex: 'default_price_tier',
      key: 'default_price_tier',
      render: (t: string | null) => t ? <Tag color="geekblue">{TIER_LABELS[t] || t}</Tag> : <Tag>مستهلك (افتراضي)</Tag>,
    },
    {
      title: 'حد الائتمان',
      dataIndex: 'credit_limit',
      key: 'credit_limit',
      render: (v: string | null, r: CustomerRecord) => (
        <span>
          {v ? `${parseFloat(v).toLocaleString('ar-EG')} ج.م` : <Tag>غير محدود</Tag>}
          {r.max_due_term_days != null && <Tag color="purple" style={{ marginRight: 4 }}>{r.max_due_term_days} يوم</Tag>}
        </span>
      ),
    },
    {
      title: 'رصيد المديونية (الذمة)',
      key: 'balance',
      render: (_: any, record: CustomerRecord) => <CustomerBalance customerId={record.id} />,
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: CustomerRecord) => (
        <Space size="middle">
          <Button
            type="dashed"
            icon={<SwapOutlined />}
            onClick={() => {
              setSelectedCustomer(record);
              reassignForm.setFieldsValue({
                new_rep_id: record.rep_id,
                new_territory_id: record.territory_id,
              });
              setReassignVisible(true);
            }}
          >
            إعادة تعيين
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="إدارة حسابات العملاء والذمم"
        extra={
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setDrawerVisible(true)}>
            إضافة عميل
          </Button>
        }
      >
        <Table
          dataSource={customers}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Add Customer Drawer */}
      <Drawer
        title="إضافة عميل جديد"
        width={450}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onCreateCustomer} requiredMark={false}>
          <Form.Item
            name="name"
            label="اسم العميل (الكامل)"
            rules={[{ required: true, message: 'يرجى إدخال اسم العميل!' }]}
          >
            <Input placeholder="مثال: شركة النور للسباكة" />
          </Form.Item>

          <Form.Item
            name="customer_type"
            label="تصنيف العميل"
            rules={[{ required: true, message: 'يرجى تحديد نوع العميل!' }]}
          >
            <Select placeholder="اختر تصنيف العميل">
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <Select.Option key={key} value={key}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="phone"
            label="رقم الهاتف"
          >
            <Input placeholder="مثال: 01000000000" />
          </Form.Item>

          <Form.Item
            name="rep_id"
            label="مندوب المبيعات المسؤول"
            rules={[{ required: true, message: 'يرجى تحديد المندوب!' }]}
          >
            <Select placeholder="اختر المندوب لمتابعة العميل">
              {reps.map((r) => (
                <Select.Option key={r.id} value={r.id}>
                  {r.full_name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="territory_id"
            label="المنطقة الجغرافية"
            rules={[{ required: true, message: 'يرجى تحديد المنطقة!' }]}
          >
            <Select placeholder="اختر المنطقة">
              {territories.map((t) => (
                <Select.Option key={t.id} value={t.id}>
                  {t.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="default_price_tier" label="الفئة السعرية الافتراضية"
            extra="تُستخدم تلقائياً على فواتير هذا العميل (الافتراضي: مستهلك)">
            <Select allowClear placeholder="مستهلك (افتراضي)">
              {Object.entries(TIER_LABELS).map(([k, l]) => (
                <Select.Option key={k} value={k}>{l}</Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Row gutter={8}>
            <Col span={12}>
              <Form.Item name="credit_limit" label="حد الائتمان (ج.م)"
                extra="أقصى رصيد آجل مسموح — فارغ = غير محدود">
                <InputNumber min={0} step={100} style={{ width: '100%' }} placeholder="غير محدود" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="max_due_term_days" label="أقصى أجل سداد (يوم)"
                extra="فارغ = بدون حد">
                <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="بدون حد" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                تسجيل العميل
              </Button>
              <Button onClick={() => setDrawerVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>

      {/* Reassign Rep/Territory Side Drawer */}
      <Drawer
        title={`إعادة تعيين العميل: ${selectedCustomer?.name || ''}`}
        width={450}
        onClose={() => setReassignVisible(false)}
        open={reassignVisible}
        destroyOnHidden
      >
        <Form form={reassignForm} layout="vertical" onFinish={onReassign}>
          <Form.Item
            name="new_rep_id"
            label="المندوب المسؤول الجديد"
            rules={[{ required: true, message: 'يرجى تحديد المندوب الجديد!' }]}
          >
            <Select placeholder="اختر المندوب">
              {reps.map((r) => (
                <Select.Option key={r.id} value={r.id}>
                  {r.full_name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="new_territory_id"
            label="المنطقة الجغرافية الجديدة"
            rules={[{ required: true, message: 'يرجى تحديد المنطقة الجديدة!' }]}
          >
            <Select placeholder="اختر المنطقة">
              {territories.map((t) => (
                <Select.Option key={t.id} value={t.id}>
                  {t.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                حفظ التعديلات
              </Button>
              <Button onClick={() => setReassignVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

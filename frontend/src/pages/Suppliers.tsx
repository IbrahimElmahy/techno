import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api/client';

interface SupplierRecord {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  active: boolean;
}

// Sub-component to fetch and render supplier ledger balance dynamically per row (thin client)
const SupplierBalance = ({ supplierId }: { supplierId: number }) => {
  const [balance, setBalance] = useState<string>('...');

  useEffect(() => {
    api.get(`/api/v1/suppliers/${supplierId}/account`)
      .then((res) => {
        setBalance(parseFloat(res.data.balance).toLocaleString('ar-EG', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }));
      })
      .catch(() => setBalance('خطأ'));
  }, [supplierId]);

  return <span style={{ fontWeight: 'bold' }}>{balance} ج.م</span>;
};

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [form] = Form.useForm();

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/suppliers');
      setSuppliers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const onCreateSupplier = async (values: any) => {
    try {
      await api.post('/api/v1/suppliers', values);
      message.success('تم تسجيل المورد بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchSuppliers();
    } catch (err) {
      console.error(err);
    }
  };

  const columns = [
    {
      title: 'كود المورد',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => <Tag color="orange">{code}</Tag>,
    },
    {
      title: 'اسم المورد',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'رقم الهاتف',
      dataIndex: 'phone',
      key: 'phone',
      render: (phone: string | null) => phone || '-',
    },
    {
      title: 'الحالة',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'red'}>{active ? 'نشط' : 'معطل'}</Tag>
      ),
    },
    {
      title: 'الرصيد الدائن',
      key: 'balance',
      render: (_: any, record: SupplierRecord) => <SupplierBalance supplierId={record.id} />,
    },
  ];

  return (
    <div>
      <Card
        title="إدارة حسابات الموردين والمدفوعات"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerVisible(true)}>
            إضافة مورد
          </Button>
        }
      >
        <Table
          dataSource={suppliers}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Add Supplier Drawer */}
      <Drawer
        title="إضافة مورد جديد"
        width={400}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onCreateSupplier} requiredMark={false}>
          <Form.Item
            name="name"
            label="اسم جهة التوريد / المورد"
            rules={[{ required: true, message: 'يرجى إدخال اسم المورد!' }]}
          >
            <Input placeholder="مثال: مصنع النصر للأنابيب" />
          </Form.Item>

          <Form.Item
            name="phone"
            label="رقم الهاتف"
          >
            <Input placeholder="مثال: 02-23456789" />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                تسجيل المورد
              </Button>
              <Button onClick={() => setDrawerVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

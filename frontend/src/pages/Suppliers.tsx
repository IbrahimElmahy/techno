import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';

interface SupplierRecord {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  phones: string[] | null;
  active: boolean;
}

// Dynamic list of EXTRA phone numbers (the primary `phone` field stays separate).
const ExtraPhonesList = () => (
  <Form.List name="phones">
    {(fields, { add, remove }) => (
      <>
        <div style={{ marginBottom: 8 }}>أرقام هاتف إضافية</div>
        {fields.map((field) => (
          <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
            <Form.Item {...field} style={{ marginBottom: 0, flex: 1 }}>
              <Input placeholder="مثال: 01000000000" style={{ width: 280 }} />
            </Form.Item>
            <MinusCircleOutlined onClick={() => remove(field.name)} />
          </Space>
        ))}
        <Form.Item style={{ marginBottom: 16 }}>
          <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>
            إضافة رقم
          </Button>
        </Form.Item>
      </>
    )}
  </Form.List>
);

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
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<SupplierRecord | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

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

  // Form.List rows can be blank/undefined; only send real numbers.
  const cleanPhones = (phones: any): string[] =>
    (phones || []).map((p: any) => (p || '').trim()).filter(Boolean);

  const onCreateSupplier = async (values: any) => {
    try {
      await api.post('/api/v1/suppliers', {
        ...values,
        address: values.address ?? null,
        phones: cleanPhones(values.phones),
      });
      message.success('تم تسجيل المورد بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchSuppliers();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (record: SupplierRecord) => {
    setEditing(record);
    editForm.setFieldsValue({
      name: record.name,
      phone: record.phone,
      address: record.address ?? undefined,
      phones: record.phones ?? [],
    });
    setEditVisible(true);
  };

  const onEditSupplier = async (values: any) => {
    if (!editing) return;
    try {
      await api.patch(`/api/v1/suppliers/${editing.id}`, {
        name: values.name,
        phone: values.phone,
        address: values.address ?? null,
        phones: cleanPhones(values.phones),
      });
      message.success('تم تحديث بيانات المورد بنجاح');
      setEditVisible(false);
      setEditing(null);
      editForm.resetFields();
      fetchSuppliers();
    } catch (err) {
      console.error(err);
    }
  };

  const onDeactivate = (record: SupplierRecord) => {
    showDeactivationConfirm({
      title: 'إلغاء تفعيل المورد',
      content: `هل أنت متأكد من إلغاء تفعيل المورد "${record.name}"؟`,
      onOk: async () => {
        try {
          await api.delete(`/api/v1/suppliers/${record.id}`);
          message.success('تم إلغاء تفعيل المورد');
          fetchSuppliers();
        } catch (err) {
          console.error(err);
        }
      },
    });
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
      render: (phone: string | null, record: SupplierRecord) => (
        <Space size={4}>
          <span>{phone || '-'}</span>
          {record.phones && record.phones.length > 0 && (
            <Tag color="blue" title={record.phones.join('، ')}>
              +{record.phones.length}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'العنوان',
      dataIndex: 'address',
      key: 'address',
      render: (address: string | null) => address || '-',
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
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: SupplierRecord) => (
        <Space size="middle">
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            تعديل
          </Button>
          {record.active && (
            <Button type="link" danger onClick={() => onDeactivate(record)}>
              إلغاء تفعيل
            </Button>
          )}
        </Space>
      ),
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

          <ExtraPhonesList />

          <Form.Item name="address" label="العنوان">
            <Input.TextArea rows={3} placeholder="مثال: 15 شارع الجمهورية، وسط البلد، القاهرة" />
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

      {/* Edit Supplier Drawer */}
      <Drawer
        title="تعديل بيانات المورد"
        width={400}
        onClose={() => setEditVisible(false)}
        open={editVisible}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" onFinish={onEditSupplier} requiredMark={false}>
          <Form.Item
            name="name"
            label="اسم جهة التوريد / المورد"
            rules={[{ required: true, message: 'يرجى إدخال اسم المورد!' }]}
          >
            <Input placeholder="مثال: مصنع النصر للأنابيب" />
          </Form.Item>

          <Form.Item name="phone" label="رقم الهاتف">
            <Input placeholder="مثال: 02-23456789" />
          </Form.Item>

          <ExtraPhonesList />

          <Form.Item name="address" label="العنوان">
            <Input.TextArea rows={3} placeholder="مثال: 15 شارع الجمهورية، وسط البلد، القاهرة" />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                حفظ التعديلات
              </Button>
              <Button onClick={() => setEditVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

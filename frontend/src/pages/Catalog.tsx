import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, Select, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';

interface ItemRecord {
  id: number;
  code: string;
  name: string;
  kind: 'raw_material' | 'product';
  unit_of_measure: string;
  purchase_price: string | null;
  sale_price: string | null;
  active: boolean;
}

const KIND_LABELS: Record<string, string> = {
  raw_material: 'مادة خام',
  product: 'منتج تام الصنع',
};

// Sub-component to load and edit product point values inline (thin client with auth constraints)
const ProductPoints = ({
  itemId,
  isEditable,
}: {
  itemId: number;
  isEditable: boolean;
}) => {
  const [points, setPoints] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState<number>(0);

  const fetchPoints = () => {
    api.get(`/api/v1/products/${itemId}/point-value`)
      .then((res) => {
        setPoints(res.data.point_value);
        setInputVal(res.data.point_value);
      })
      .catch(() => setPoints(0));
  };

  useEffect(() => {
    fetchPoints();
  }, [itemId]);

  const handleSave = async () => {
    if (inputVal < 0) {
      message.error('يجب أن تكون قيمة النقاط أكبر من أو تساوي الصفر');
      return;
    }
    try {
      await api.put(`/api/v1/products/${itemId}/point-value`, {
        point_value: inputVal,
      });
      setPoints(inputVal);
      setEditing(false);
      message.success('تم تحديث قيمة نقاط المنتج');
    } catch (err) {
      console.error(err);
    }
  };

  if (points === null) return <span>...</span>;

  if (editing) {
    return (
      <Space>
        <Input
          type="number"
          size="small"
          style={{ width: 80 }}
          value={inputVal}
          onChange={(e) => setInputVal(parseInt(e.target.value, 10) || 0)}
        />
        <Button size="small" type="primary" onClick={handleSave}>
          حفظ
        </Button>
        <Button size="small" onClick={() => setEditing(false)}>
          إلغاء
        </Button>
      </Space>
    );
  }

  return (
    <Space>
      <strong style={{ color: '#F5A11D' }}>{points} نقطة</strong>
      {isEditable && (
        <Button size="small" type="link" onClick={() => setEditing(true)}>
          تعديل
        </Button>
      )}
    </Space>
  );
};

export default function Catalog() {
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [form] = Form.useForm();
  const { user } = useAuth();

  // Point editing is permitted for system_admin and after_sales_staff roles only
  const canEditPoints = ['system_admin', 'after_sales_staff'].includes(user?.role || '');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/items');
      setItems(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const onCreateItem = async (values: any) => {
    try {
      const payload = {
        name: values.name,
        kind: values.kind,
        unit_of_measure: values.unit_of_measure,
        purchase_price: values.kind === 'raw_material' ? values.purchase_price : null,
        sale_price: values.kind === 'product' ? values.sale_price : null,
      };

      await api.post('/api/v1/items', payload);
      message.success('تم تسجيل الصنف في الكتالوج بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchItems();
    } catch (err) {
      console.error(err);
    }
  };

  const columns = [
    {
      title: 'كود الصنف',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => <Tag>{code}</Tag>,
    },
    {
      title: 'اسم الصنف',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'نوع الصنف',
      dataIndex: 'kind',
      key: 'kind',
      render: (kind: string) => (
        <Tag color={kind === 'product' ? 'green' : 'orange'}>
          {KIND_LABELS[kind] || kind}
        </Tag>
      ),
    },
    {
      title: 'وحدة القياس',
      dataIndex: 'unit_of_measure',
      key: 'unit_of_measure',
    },
    {
      title: 'سعر البيع المرجعي',
      dataIndex: 'sale_price',
      key: 'sale_price',
      render: (price: string | null) =>
        price ? `${parseFloat(price).toFixed(2)} ج.م` : '-',
    },
    {
      title: 'سعر الشراء المرجعي',
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      render: (price: string | null) =>
        price ? `${parseFloat(price).toFixed(2)} ج.م` : '-',
    },
    {
      title: 'نقاط المنتج',
      key: 'points',
      render: (_: any, record: ItemRecord) => {
        if (record.kind !== 'product') return '-';
        return <ProductPoints itemId={record.id} isEditable={canEditPoints} />;
      },
    },
  ];

  return (
    <div>
      <Card
        title="كتالوج المنتجات والمواد الخام"
        extra={
          user?.role === 'system_admin' || user?.role === 'purchasing_manager' ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerVisible(true)}>
              إضافة صنف للكتالوج
            </Button>
          ) : null
        }
      >
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Add Item Drawer */}
      <Drawer
        title="إضافة صنف جديد للكتالوج"
        width={400}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onCreateItem} requiredMark={false}>
          <Form.Item
            name="name"
            label="اسم الصنف"
            rules={[{ required: true, message: 'يرجى إدخال اسم الصنف!' }]}
          >
            <Input placeholder="مثال: ماسورة مياه 3/4 بوصة" />
          </Form.Item>

          <Form.Item
            name="kind"
            label="نوع الصنف"
            rules={[{ required: true, message: 'يرجى تحديد نوع الصنف!' }]}
          >
            <Select placeholder="اختر النوع">
              {Object.entries(KIND_LABELS).map(([key, label]) => (
                <Select.Option key={key} value={key}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="unit_of_measure"
            label="وحدة القياس"
            rules={[{ required: true, message: 'يرجى إدخال وحدة القياس!' }]}
          >
            <Input placeholder="مثال: متر، كرتونة، قطعة" />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.kind !== curr.kind}>
            {({ getFieldValue }) => {
              const kind = getFieldValue('kind');
              if (kind === 'product') {
                return (
                  <Form.Item
                    name="sale_price"
                    label="سعر البيع المرجعي (ج.م)"
                    rules={[{ required: true, message: 'يرجى إدخال سعر البيع!' }]}
                  >
                    <Input type="number" min={0} step="0.01" placeholder="0.00" />
                  </Form.Item>
                );
              } else if (kind === 'raw_material') {
                return (
                  <Form.Item
                    name="purchase_price"
                    label="سعر الشراء المرجعي (ج.م)"
                    rules={[{ required: true, message: 'يرجى إدخال سعر الشراء!' }]}
                  >
                    <Input type="number" min={0} step="0.01" placeholder="0.00" />
                  </Form.Item>
                );
              }
              return null;
            }}
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                حفظ وإضافة
              </Button>
              <Button onClick={() => setDrawerVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

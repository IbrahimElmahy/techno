import React, { useEffect, useState } from 'react';
import { Form, InputNumber, Button, Card, Select, Row, Col, Space, Divider, Table, Tag, message } from 'antd';
import { PlayCircleOutlined, CheckCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';

interface Warehouse {
  id: number;
  name: string;
}

interface Item {
  id: number;
  code: string;
  name: string;
  kind: 'raw_material' | 'product';
  unit_of_measure: string;
}

interface LocalActivity {
  id: number;
  document_number: string;
  op_type: 'consume' | 'produce';
  itemName: string;
  quantity: number;
  warehouseName: string;
  reversed: boolean;
}

export default function Manufacturing() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rawMaterials, setRawMaterials] = useState<Item[]>([]);
  const [finishedProducts, setFinishedProducts] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  // Stock status states
  const [consumeStock, setConsumeStock] = useState<number | null>(null);

  // Forms
  const [consumeForm] = Form.useForm();
  const [produceForm] = Form.useForm();

  // Local session history log
  const [activities, setActivities] = useState<LocalActivity[]>([]);

  // Selected values for stock check
  const consumeWarehouse = Form.useWatch('warehouse_id', consumeForm);
  const consumeItem = Form.useWatch('item_id', consumeForm);

  const loadLookups = async () => {
    setLoading(true);
    try {
      const [whRes, itemsRes] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/items'),
      ]);
      setWarehouses(whRes.data);
      setRawMaterials(itemsRes.data.filter((i: Item) => i.kind === 'raw_material'));
      setFinishedProducts(itemsRes.data.filter((i: Item) => i.kind === 'product'));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLookups();
  }, []);

  // Fetch live stock when consume inputs change
  useEffect(() => {
    if (consumeWarehouse && consumeItem) {
      api.get('/api/v1/stock/on-hand', {
        params: {
          item_id: consumeItem,
          location_kind: 'warehouse',
          location_id: consumeWarehouse,
        },
      })
        .then((res) => {
          setConsumeStock(parseFloat(res.data.on_hand));
        })
        .catch(() => {
          setConsumeStock(0);
        });
    } else {
      setConsumeStock(null);
    }
  }, [consumeWarehouse, consumeItem]);

  const handleConsumeSubmit = async (values: any) => {
    if (consumeStock !== null && values.quantity > consumeStock) {
      message.error('الكمية المطلوبة تتجاوز الرصيد المتوفر في المخزن!');
      return;
    }

    try {
      const res = await api.post('/api/v1/manufacturing/consume', {
        item_id: values.item_id,
        location: {
          location_kind: 'warehouse',
          location_id: values.warehouse_id,
        },
        quantity: values.quantity,
      });

      const selectedItem = rawMaterials.find((i) => i.id === values.item_id);
      const selectedWh = warehouses.find((w) => w.id === values.warehouse_id);

      const activity: LocalActivity = {
        id: res.data.id,
        document_number: res.data.document_number,
        op_type: 'consume',
        itemName: selectedItem ? selectedItem.name : `مادة #${values.item_id}`,
        quantity: values.quantity,
        warehouseName: selectedWh ? selectedWh.name : `مخزن #${values.warehouse_id}`,
        reversed: false,
      };

      setActivities([activity, ...activities]);
      message.success('تم تسجيل استهلاك المواد الخام بنجاح');
      consumeForm.resetFields();
      setConsumeStock(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleProduceSubmit = async (values: any) => {
    try {
      const res = await api.post('/api/v1/manufacturing/produce', {
        item_id: values.item_id,
        location: {
          location_kind: 'warehouse',
          location_id: values.warehouse_id,
        },
        quantity: values.quantity,
      });

      const selectedItem = finishedProducts.find((i) => i.id === values.item_id);
      const selectedWh = warehouses.find((w) => w.id === values.warehouse_id);

      const activity: LocalActivity = {
        id: res.data.id,
        document_number: res.data.document_number,
        op_type: 'produce',
        itemName: selectedItem ? selectedItem.name : `منتج #${values.item_id}`,
        quantity: values.quantity,
        warehouseName: selectedWh ? selectedWh.name : `مخزن #${values.warehouse_id}`,
        reversed: false,
      };

      setActivities([activity, ...activities]);
      message.success('تم تسجيل إدخال المنتج التام بنجاح');
      produceForm.resetFields();
    } catch (err) {
      console.error(err);
    }
  };

  const handleReverse = (record: LocalActivity) => {
    showReversalConfirm({
      title: 'التراجع عن حركة تصنيع',
      content: `هل أنت متأكد من التراجع وعكس حركة المستند "${record.document_number}"؟ سيتم توليد حركة عكسية وتعديل المخزون المقابل تلقائياً.`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/manufacturing/${record.id}/reverse`);
          message.success('تم إلغاء وعكس الحركة بنجاح');
          setActivities(
            activities.map((a) => (a.id === record.id ? { ...a, reversed: true } : a))
          );
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const columns = [
    {
      title: 'رقم المستند',
      dataIndex: 'document_number',
      key: 'document_number',
      render: (doc: string) => <Tag color="blue">{doc}</Tag>,
    },
    {
      title: 'العملية',
      dataIndex: 'op_type',
      key: 'op_type',
      render: (type: string) =>
        type === 'consume' ? (
          <Tag color="volcano">استهلاك مواد خام</Tag>
        ) : (
          <Tag color="green">استلام منتج تام</Tag>
        ),
    },
    {
      title: 'الصنف المجرى عليه',
      dataIndex: 'itemName',
      key: 'itemName',
    },
    {
      title: 'الكمية',
      dataIndex: 'quantity',
      key: 'quantity',
    },
    {
      title: 'المستودع',
      dataIndex: 'warehouseName',
      key: 'warehouseName',
    },
    {
      title: 'حالة الحركة',
      key: 'status',
      render: (_: any, record: LocalActivity) =>
        record.reversed ? (
          <Tag color="red">معكوسة (ملغية)</Tag>
        ) : (
          <Tag color="cyan">مرحلة</Tag>
        ),
    },
    {
      title: 'تراجع',
      key: 'actions',
      render: (_: any, record: LocalActivity) =>
        !record.reversed && (
          <Button
            type="link"
            danger
            icon={<RollbackOutlined />}
            onClick={() => handleReverse(record)}
          >
            تراجع وعكس
          </Button>
        ),
    },
  ];

  return (
    <div>
      <Row gutter={24}>
        <Col span={12}>
          <Card
            title="استهلاك مواد أولية للتصنيع"
            styles={{ header: { borderBottom: '2px solid #F5A11D' } }}
            extra={<Button type="primary">أمر تصنيع جديد</Button>}
          >
            <Form form={consumeForm} layout="vertical" onFinish={handleConsumeSubmit}>
              <Form.Item
                name="warehouse_id"
                label="مستودع سحب المواد الخام"
                rules={[{ required: true, message: 'يرجى اختيار المستودع!' }]}
              >
                <Select placeholder="اختر مستودع السحب">
                  {warehouses.map((w) => (
                    <Select.Option key={w.id} value={w.id}>
                      {w.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="item_id"
                label="الخامة الأولية"
                rules={[{ required: true, message: 'يرجى اختيار الخامة!' }]}
              >
                <Select placeholder="اختر الخامة المستهلكة">
                  {rawMaterials.map((r) => (
                    <Select.Option key={r.id} value={r.id}>
                      {r.name} ({r.unit_of_measure})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              {consumeStock !== null && (
                <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fff7e6', borderRadius: 4 }}>
                  <span>الرصيد المتاح حالياً في المخزن المحدد: </span>
                  <strong style={{ color: consumeStock > 0 ? '#6AB42D' : '#ff4d4f' }}>
                    {consumeStock} وحدات
                  </strong>
                </div>
              )}

              <Form.Item
                name="quantity"
                label="الكمية المستهلكة"
                rules={[{ required: true, message: 'يرجى إدخال الكمية!' }]}
              >
                <InputNumber min={0.01} style={{ width: '100%' }} />
              </Form.Item>

              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" danger icon={<PlayCircleOutlined />} block>
                  تسجيل حرق واستهلاك الخامات
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="استلام إنتاج مصنع تام الصنع" styles={{ header: { borderBottom: '2px solid #6AB42D' } }}>
            <Form form={produceForm} layout="vertical" onFinish={handleProduceSubmit}>
              <Form.Item
                name="warehouse_id"
                label="مستودع إدخال المنتج النهائي"
                rules={[{ required: true, message: 'يرجى اختيار المستودع!' }]}
              >
                <Select placeholder="اختر مستودع التخزين">
                  {warehouses.map((w) => (
                    <Select.Option key={w.id} value={w.id}>
                      {w.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="item_id"
                label="المنتج النهائي"
                rules={[{ required: true, message: 'يرجى اختيار المنتج!' }]}
              >
                <Select placeholder="اختر المنتج المستلم">
                  {finishedProducts.map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      {p.name} ({p.unit_of_measure})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="quantity"
                label="الكمية المنتجة"
                rules={[{ required: true, message: 'يرجى إدخال كمية الإنتاج!' }]}
              >
                <InputNumber min={0.01} style={{ width: '100%' }} />
              </Form.Item>

              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />} block>
                  إيداع واستلام إنتاج تام الصنع
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>

      <Divider orientation="right">حركات التشغيل في الجلسة الحالية</Divider>

      <Table
        dataSource={activities}
        columns={columns}
        rowKey="document_number"
        pagination={{ pageSize: 5 }}
        locale={{ emptyText: 'لا يوجد حركات تصنيع مسجلة في الجلسة الحالية' }}
      />
    </div>
  );
}

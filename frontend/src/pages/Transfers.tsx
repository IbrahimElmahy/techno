import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, InputNumber, Select, Tag, message, Divider, Row, Col } from 'antd';
import { PlusOutlined, CheckCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showReversalConfirm } from '../components/ConfirmationDialog';

interface TransferRecord {
  id: number;
  document_number: string;
  status: 'pending' | 'approved' | 'rejected' | 'reversed';
  route: 'central_to_branch' | 'central_to_rep' | 'rep_to_rep';
  approved_by: number | null;
}

const ROUTE_LABELS: Record<string, string> = {
  central_to_branch: 'من المستودع المركزي إلى الفرعي',
  central_to_rep: 'من المستودع المركزي إلى المندوب',
  rep_to_rep: 'مناقلة بين المناديب',
};

const STATUS_TAGS: Record<string, { color: string; text: string }> = {
  pending: { color: 'warning', text: 'بانتظار الاعتماد' },
  approved: { color: 'success', text: 'تم الاعتماد والشحن' },
  rejected: { color: 'error', text: 'مرفوض' },
  reversed: { color: 'default', text: 'ملغي ومعكوس' },
};

export default function Transfers() {
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [custodies, setCustodies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  
  const [form] = Form.useForm();
  const { user } = useAuth();

  const canApprove = ['system_admin', 'branch_manager'].includes(user?.role || '');

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/transfers');
      setTransfers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadLookups = async () => {
    try {
      const [itemsRes, whRes, custRes] = await Promise.all([
        api.get('/api/v1/items'),
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/custodies'),
      ]);
      setItems(itemsRes.data);
      setWarehouses(whRes.data);
      setCustodies(custRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchTransfers();
    loadLookups();
  }, []);

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/api/v1/transfers/${id}/approve`);
      message.success('تمت الموافقة واعتماد التحويل بنجاح');
      fetchTransfers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleReverse = (record: TransferRecord) => {
    showReversalConfirm({
      title: 'عكس عملية التحويل المخزني',
      content: `هل أنت متأكد من إلغاء وعكس مستند التحويل "${record.document_number}"؟ سيتم توليد حركة مخزنية عكسية لإرجاع كميات المخزون لمصدرها.`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/transfers/${record.id}/reverse`);
          message.success('تم عكس وإلغاء التحويل بنجاح');
          fetchTransfers();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const onInitiate = async (values: any) => {
    try {
      const payload = {
        item_id: values.item_id,
        quantity: values.quantity,
        route: values.route,
        source: {
          location_kind: values.source_kind,
          location_id: values.source_id,
        },
        dest: {
          location_kind: values.dest_kind,
          location_id: values.dest_id,
        },
      };

      await api.post('/api/v1/transfers', payload);
      message.success('تم تسجيل طلب التحويل بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchTransfers();
    } catch (err) {
      console.error(err);
    }
  };

  const columns = [
    {
      title: 'رقم المستند',
      dataIndex: 'document_number',
      key: 'document_number',
      render: (doc: string) => <Tag color="blue">{doc}</Tag>,
    },
    {
      title: 'نوع المناقلة (المسار)',
      dataIndex: 'route',
      key: 'route',
      render: (route: string) => ROUTE_LABELS[route] || route,
    },
    {
      title: 'الحالة',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const tag = STATUS_TAGS[status] || { color: 'default', text: status };
        return <Tag color={tag.color}>{tag.text}</Tag>;
      },
    },
    {
      title: 'كود المعتمد',
      dataIndex: 'approved_by',
      key: 'approved_by',
      render: (approver: number | null) => (approver ? `مستخدم #${approver}` : '-'),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: TransferRecord) => (
        <Space size="middle">
          {record.status === 'pending' && canApprove && (
            <Button
              type="primary"
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => handleApprove(record.id)}
            >
              اعتماد وقبول
            </Button>
          )}
          {record.status === 'approved' && canApprove && (
            <Button
              type="primary"
              danger
              size="small"
              icon={<RollbackOutlined />}
              onClick={() => handleReverse(record)}
            >
              إلغاء وعكس
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="إدارة تحويلات ومناقلات المخزون"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerVisible(true)}>
            طلب تحويل مخزني
          </Button>
        }
      >
        <Table
          dataSource={transfers}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Initiate Transfer Drawer */}
      <Drawer
        title="طلب تحويل مخزني جديد"
        width={450}
        onClose={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onInitiate} requiredMark={false}>
          <Form.Item
            name="item_id"
            label="الصنف المطلوب تحويله"
            rules={[{ required: true, message: 'يرجى تحديد الصنف!' }]}
          >
            <Select placeholder="اختر الصنف من الكتالوج">
              {items.map((i) => (
                <Select.Option key={i.id} value={i.id}>
                  {i.name} ({i.code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="quantity"
            label="الكمية المطلوبة"
            rules={[{ required: true, message: 'يرجى إدخال الكمية!' }]}
          >
            <InputNumber min={0.01} style={{ width: '100%' }} placeholder="ادخل الكمية" />
          </Form.Item>

          <Form.Item
            name="route"
            label="مسار التحويل"
            rules={[{ required: true, message: 'يرجى تحديد مسار التحويل!' }]}
          >
            <Select placeholder="اختر مسار التحويل">
              {Object.entries(ROUTE_LABELS).map(([key, label]) => (
                <Select.Option key={key} value={key}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Divider orientation="right">المصدر (من أين)</Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="source_kind"
                label="نوع الموقع"
                rules={[{ required: true, message: 'حدد نوع موقع المصدر!' }]}
              >
                <Select placeholder="نوع الموقع">
                  <Select.Option value="warehouse">مستودع (Warehouse)</Select.Option>
                  <Select.Option value="custody">عهدة مندوب (Custody)</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                noStyle
                shouldUpdate={(prev, curr) => prev.source_kind !== curr.source_kind}
              >
                {({ getFieldValue }) => {
                  const kind = getFieldValue('source_kind');
                  const list = kind === 'warehouse' ? warehouses : custodies;
                  const label = kind === 'warehouse' ? 'المستودع' : 'عهدة المندوب';
                  return (
                    <Form.Item
                      name="source_id"
                      label={label}
                      rules={[{ required: true, message: 'حدد موقع المصدر!' }]}
                    >
                      <Select placeholder={`اختر ${label}`}>
                        {list.map((loc) => (
                          <Select.Option key={loc.id} value={loc.id}>
                            {loc.name || `عهدة #${loc.id}`}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="right">الوجهة (إلى أين)</Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="dest_kind"
                label="نوع الموقع"
                rules={[{ required: true, message: 'حدد نوع موقع الوجهة!' }]}
              >
                <Select placeholder="نوع الموقع">
                  <Select.Option value="warehouse">مستودع (Warehouse)</Select.Option>
                  <Select.Option value="custody">عهدة مندوب (Custody)</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                noStyle
                shouldUpdate={(prev, curr) => prev.dest_kind !== curr.dest_kind}
              >
                {({ getFieldValue }) => {
                  const kind = getFieldValue('dest_kind');
                  const list = kind === 'warehouse' ? warehouses : custodies;
                  const label = kind === 'warehouse' ? 'المستودع' : 'عهدة المندوب';
                  return (
                    <Form.Item
                      name="dest_id"
                      label={label}
                      rules={[{ required: true, message: 'حدد موقع الوجهة!' }]}
                    >
                      <Select placeholder={`اختر ${label}`}>
                        {list.map((loc) => (
                          <Select.Option key={loc.id} value={loc.id}>
                            {loc.name || `عهدة #${loc.id}`}
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                إرسال طلب التحويل
              </Button>
              <Button onClick={() => setDrawerVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

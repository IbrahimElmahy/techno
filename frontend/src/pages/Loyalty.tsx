import React, { useEffect, useState } from 'react';
import { Table, Button, Space, Card, Drawer, Form, Input, InputNumber, Select, Tag, message, Row, Col, Divider, Tabs, Modal } from 'antd';
import { PlusOutlined, SettingOutlined, SwapOutlined, GiftOutlined, CheckCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { showReversalConfirm } from '../components/ConfirmationDialog';

interface CouponType {
  id: number;
  name: string;
  kind: 'money' | 'gift_money_off';
  point_cost: number;
  value: string;
  active: boolean;
}

interface Customer {
  id: number;
  name: string;
}

interface Coupon {
  id: number;
  serial: string;
  customer_id: number;
  kind: string;
  value: string;
  points_consumed: number;
  status: 'pending' | 'redeemed' | 'reversed';
}

const STATUS_TAGS: Record<string, { color: string; text: string }> = {
  pending: { color: 'warning', text: 'صالح للاستخدام' },
  redeemed: { color: 'success', text: 'تم الاسترداد' },
  reversed: { color: 'default', text: 'ملغي ومعكوس' },
};

export default function Loyalty() {
  const [activeTab, setActiveTab] = useState('settings');
  const [couponTypes, setCouponTypes] = useState<CouponType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(false);

  // Drawers & Modals
  const [typeVisible, setTypeVisible] = useState(false);
  const [convertVisible, setConvertVisible] = useState(false);
  const [redeemVisible, setRedeemVisible] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null);

  // Forms
  const [typeForm] = Form.useForm();
  const [convertForm] = Form.useForm();
  const [redeemForm] = Form.useForm();

  // Dynamic balance load
  const [customerPoints, setCustomerPoints] = useState<number | null>(null);
  const selectedCustomer = Form.useWatch('customer_id', convertForm);

  const fetchCouponTypes = async () => {
    try {
      const res = await api.get('/api/v1/loyalty/coupon-types');
      setCouponTypes(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchCoupons = async () => {
    try {
      const res = await api.get('/api/v1/coupons');
      setCoupons(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadLookups = async () => {
    try {
      const res = await api.get('/api/v1/customers');
      setCustomers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchCouponTypes(), fetchCoupons(), loadLookups()]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Fetch live points balance when customer selected
  useEffect(() => {
    if (selectedCustomer) {
      api.get(`/api/v1/customers/${selectedCustomer}/points`)
        .then((res) => {
          setCustomerPoints(res.data.balance);
        })
        .catch(() => setCustomerPoints(0));
    } else {
      setCustomerPoints(null);
    }
  }, [selectedCustomer]);

  const onCreateCouponType = async (values: any) => {
    try {
      await api.post('/api/v1/loyalty/coupon-types', {
        name: values.name,
        kind: values.kind,
        point_cost: values.point_cost,
        value: values.value,
      });
      message.success('تمت إضافة نوع الكوبون بنجاح');
      setTypeVisible(false);
      typeForm.resetFields();
      fetchCouponTypes();
    } catch (err) {
      console.error(err);
    }
  };

  const handleConvertPoints = async (values: any) => {
    const selectedType = couponTypes.find((t) => t.id === values.coupon_type_id);
    if (!selectedType) return;

    if (customerPoints !== null && customerPoints < selectedType.point_cost) {
      message.error('نقاط العميل غير كافية لإنشاء هذا الكوبون!');
      return;
    }

    try {
      const res = await api.post(`/api/v1/customers/${values.customer_id}/points/convert`, {
        coupon_type_ids: [values.coupon_type_id],
      });

      const generated = res.data[0];
      Modal.success({
        title: 'تم تحويل النقاط بنجاح',
        content: (
          <div style={{ direction: 'rtl', marginTop: 16 }}>
            <p>تم استهلاك النقاط وتوليد كوبون خصم جديد:</p>
            <p><strong>كود الكوبون: </strong> <Tag color="purple" style={{ fontSize: 16, padding: '4px 8px' }}>{generated.serial}</Tag></p>
            <p><strong>قيمة الكوبون: </strong> {parseFloat(generated.value).toFixed(2)} ج.م</p>
          </div>
        ),
        okText: 'موافق',
      });

      setConvertVisible(false);
      convertForm.resetFields();
      setCustomerPoints(null);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRedeem = async (values: any) => {
    if (!selectedCoupon) return;
    try {
      await api.post(`/api/v1/coupons/${selectedCoupon.id}/redeem`, {
        mode: values.mode,
        sales_invoice_id: values.sales_invoice_id || null,
        item_id: values.item_id || null,
        location_kind: values.location_kind || null,
        location_id: values.location_id || null,
        quantity: values.quantity || null,
      });
      message.success('تم استرداد وقبول الكوبون بنجاح');
      setRedeemVisible(false);
      redeemForm.resetFields();
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleReverseRedemption = (record: Coupon) => {
    showReversalConfirm({
      title: 'إلغاء استرداد كوبون ترويجي',
      content: `هل أنت متأكد من إلغاء عملية استرداد الكوبون "${record.serial}"؟ سيتم توليد قيد عكسي مالي وإرجاع الكوبون لحالة الصلاحية.`,
      onOk: async () => {
        try {
          await api.post(`/api/v1/coupons/${record.id}/redemption/reverse`);
          message.success('تم إلغاء استرداد الكوبون وعكسه بنجاح');
          fetchData();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Columns definitions
  const typeColumns = [
    { title: 'اسم الكوبون الترويجي', dataIndex: 'name', key: 'name' },
    {
      title: 'نوع الكوبون',
      dataIndex: 'kind',
      key: 'kind',
      render: (kind: string) => (kind === 'money' ? 'رصيد مالي للعميل' : 'خصم إضافي للفواتير'),
    },
    {
      title: 'تكلفة النقاط المطلوبة',
      dataIndex: 'point_cost',
      key: 'point_cost',
      render: (cost: number) => <strong style={{ color: '#F5A11D' }}>{cost} نقطة</strong>,
    },
    {
      title: 'القيمة المالية المستفادة',
      dataIndex: 'value',
      key: 'value',
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'حالة العرض',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'red'}>{active ? 'متاح للتحويل' : 'موقف'}</Tag>
      ),
    },
  ];

  const couponColumns = [
    { title: 'الرقم التسلسلي الكوبون', dataIndex: 'serial', key: 'serial', render: (s: string) => <Tag color="purple">{s}</Tag> },
    {
      title: 'العميل المستفيد',
      dataIndex: 'customer_id',
      key: 'customer_id',
      render: (cId: number) => {
        const c = customers.find((cust) => cust.id === cId);
        return c ? c.name : `عميل #${cId}`;
      },
    },
    {
      title: 'القيمة',
      dataIndex: 'value',
      key: 'value',
      render: (val: string) => `${parseFloat(val).toFixed(2)} ج.م`,
    },
    {
      title: 'النقاط المستهلكة',
      dataIndex: 'points_consumed',
      key: 'points_consumed',
    },
    {
      title: 'حالة الكوبون',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const tag = STATUS_TAGS[status] || { color: 'default', text: status };
        return <Tag color={tag.color}>{tag.text}</Tag>;
      },
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: Coupon) => (
        <Space size="middle">
          {record.status === 'pending' && (
            <Button
              type="primary"
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => {
                setSelectedCoupon(record);
                redeemForm.setFieldsValue({ mode: 'money' });
                setRedeemVisible(true);
              }}
            >
              استرداد الكوبون
            </Button>
          )}
          {record.status === 'redeemed' && (
            <Button
              type="primary"
              danger
              size="small"
              icon={<RollbackOutlined />}
              onClick={() => handleReverseRedemption(record)}
            >
              إلغاء وعكس الاسترداد
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const items = [
    {
      key: 'settings',
      label: 'كتالوج الكوبونات',
      children: (
        <div>
          <div style={{ marginBottom: 16, textAlign: 'left' }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setTypeVisible(true)}>
              إضافة نوع كوبون
            </Button>
          </div>
          <Table dataSource={couponTypes} columns={typeColumns} rowKey="id" loading={loading} pagination={false} />
        </div>
      ),
    },
    {
      key: 'coupons',
      label: 'سجل الكوبونات المصدرة وعمليات الاسترداد',
      children: (
        <div>
          <div style={{ marginBottom: 16, textAlign: 'left' }}>
            <Button type="dashed" icon={<SwapOutlined />} onClick={() => setConvertVisible(true)}>
              تحويل نقاط يدوي لعميل
            </Button>
          </div>
          <Table dataSource={coupons} columns={couponColumns} rowKey="id" loading={loading} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <Card title="إعدادات برنامج الولاء (ولاء العملاء)">
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={items} />
      </Card>

      {/* Create Coupon Type Settings Drawer */}
      <Drawer
        title="إضافة نوع كوبون ترويجي جديد"
        width={400}
        onClose={() => setTypeVisible(false)}
        open={typeVisible}
        destroyOnHidden
      >
        <Form form={typeForm} layout="vertical" onFinish={onCreateCouponType} requiredMark={false}>
          <Form.Item
            name="name"
            label="اسم الكوبون الترويجي"
            rules={[{ required: true, message: 'يرجى إدخال اسم الكوبون الترويجي!' }]}
          >
            <Input placeholder="مثال: كوبون سباك متميز 50" />
          </Form.Item>

          <Form.Item
            name="kind"
            label="نوع منفعة الكوبون"
            rules={[{ required: true, message: 'حدد نوع المنفعة!' }]}
          >
            <Select placeholder="اختر الفائدة">
              <Select.Option value="money">إضافة رصيد لحساب العميل (Money)</Select.Option>
              <Select.Option value="gift_money_off">خصم إضافي مباشر من فاتورة البيع (Discount)</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="point_cost"
            label="تكلفة التحويل بالنقاط"
            rules={[{ required: true, message: 'يرجى تحديد تكلفة النقاط!' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="value"
            label="القيمة المالية المستفادة (ج.م)"
            rules={[{ required: true, message: 'يرجى إدخال القيمة المالية!' }]}
          >
            <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                حفظ وإضافة
              </Button>
              <Button onClick={() => setTypeVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>

      {/* Manual Points Conversion Drawer */}
      <Drawer
        title="تحويل نقاط العميل يدويًا"
        width={400}
        onClose={() => setConvertVisible(false)}
        open={convertVisible}
        destroyOnHidden
      >
        <Form form={convertForm} layout="vertical" onFinish={handleConvertPoints} requiredMark={false}>
          <Form.Item
            name="customer_id"
            label="العميل المراد تحويل نقاطه"
            rules={[{ required: true, message: 'يرجى اختيار العميل!' }]}
          >
            <Select placeholder="اختر العميل">
              {customers.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          {customerPoints !== null && (
            <div style={{ marginBottom: 16, padding: '8px 12px', background: '#e6f7ff', borderRadius: 4 }}>
              <span>إجمالي نقاط العميل الحالية: </span>
              <strong style={{ color: '#0050b3' }}>{customerPoints} نقطة</strong>
            </div>
          )}

          <Form.Item
            name="coupon_type_id"
            label="الكوبون الترويجي المراد إصداره"
            rules={[{ required: true, message: 'يرجى تحديد الكوبون!' }]}
          >
            <Select placeholder="اختر الكوبون للإصدار">
              {couponTypes
                .filter((t) => t.active)
                .map((t) => (
                  <Select.Option key={t.id} value={t.id}>
                    {t.name} (يكلف {t.point_cost} نقطة - يعطي {parseFloat(t.value).toFixed(2)} ج.م)
                  </Select.Option>
                ))}
            </Select>
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<GiftOutlined />}>
                تحويل وإصدار الكوبون
              </Button>
              <Button onClick={() => setConvertVisible(false)}>إلغاء</Button>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>

      {/* Redeem Coupon Modal */}
      <Modal
        title={`استرداد الكوبون: ${selectedCoupon?.serial || ''}`}
        open={redeemVisible}
        onCancel={() => setRedeemVisible(false)}
        onOk={() => redeemForm.submit()}
        okText="تأكيد الاسترداد"
        cancelText="إلغاء"
        destroyOnHidden
      >
        <Form form={redeemForm} layout="vertical" onFinish={handleRedeem}>
          <Form.Item
            name="mode"
            label="طريقة الاسترداد (Mode)"
            rules={[{ required: true }]}
          >
            <Select placeholder="اختر طريقة الاسترداد">
              <Select.Option value="money">إضافة لرصيد حساب العميل المالي (Money)</Select.Option>
              <Select.Option value="gift_money_off">خصم مباشر من قيمة فاتورة مبيعات محددة (Discount)</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.mode !== curr.mode}>
            {({ getFieldValue }) => {
              const mode = getFieldValue('mode');
              if (mode === 'gift_money_off') {
                return (
                  <Form.Item
                    name="sales_invoice_id"
                    label="رقم فاتورة المبيعات لتطبيق الخصم عليها"
                    rules={[{ required: true, message: 'يرجى إدخال كود فاتورة المبيعات!' }]}
                  >
                    <InputNumber placeholder="مثال: 5" style={{ width: '100%' }} />
                  </Form.Item>
                );
              }
              return null;
            }}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

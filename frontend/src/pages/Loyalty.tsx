import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, Divider, Form, Input, Modal, Row, Select, Space, Table, Tabs, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import {
  PlusOutlined, SettingOutlined, SwapOutlined, GiftOutlined,
  CheckCircleOutlined, RollbackOutlined, EditOutlined, StopOutlined, DeleteOutlined
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { showReversalConfirm, showDeactivationConfirm } from '../components/ConfirmationDialog';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, choiceColumn } from '../components/gridColumns';
import { TabModal } from '../components/TabModal';
import { money } from '../utils/money';
import CouponStatsOverview from '../components/CouponStatsOverview';

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

const KIND_LABELS: Record<string, string> = {
  money: 'رصيد مالي للعميل',
  gift_money_off: 'خصم إضافي للفواتير',
};

const STATUS_TAGS: Record<string, { color: string; text: string }> = {
  pending: { color: 'warning', text: 'صالح للاستخدام' },
  redeemed: { color: 'success', text: 'تم الاسترداد' },
  reversed: { color: 'default', text: 'ملغي ومعكوس' },
};

export default function Loyalty() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'settings';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [couponTypes, setCouponTypes] = useState<CouponType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponKinds, setCouponKinds] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Kind modal (فئات الكوبونات)
  const [kindModalVisible, setKindModalVisible] = useState(false);
  const [kindForm] = Form.useForm();
  const [editingKind, setEditingKind] = useState<any>(null);

  // Drawers & Modals
  const [typeVisible, setTypeVisible] = useState(false);
  const [convertVisible, setConvertVisible] = useState(false);
  const [redeemVisible, setRedeemVisible] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null);

  // Edit coupon type
  const [editTypeVisible, setEditTypeVisible] = useState(false);
  const [editingType, setEditingType] = useState<CouponType | null>(null);

  // Forms
  const [typeForm] = Form.useForm();
  const [editTypeForm] = Form.useForm();
  const [convertForm] = Form.useForm();
  const [redeemForm] = Form.useForm();

  // Dynamic balance load
  const [customerPoints, setCustomerPoints] = useState<number | null>(null);
  const selectedCustomer = Form.useWatch('customer_id', convertForm);

  const customerName = (id: number) => customers.find((c) => c.id === id)?.name || '';

  const typeFilter = useListFilter(couponTypes, {
    search: (t) => [t.name, KIND_LABELS[t.kind], t.point_cost, t.value],
    filters: {
      kind: (t, v) => t.kind === v,
      active: (t, v) => t.active === (v === 'active'),
    },
  });

  const couponFilter = useListFilter(coupons, {
    search: (c) => [c.serial, customerName(c.customer_id), c.value, c.points_consumed],
    filters: {
      status: (c, v) => c.status === v,
      customer_id: (c, v) => c.customer_id === v,
    },
  });

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

  const fetchCouponKinds = async () => {
    try {
      const res = await api.get('/api/v1/settings/lookups?category=coupon_kind');
      setCouponKinds(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const onSaveCouponKind = async (values: any) => {
    try {
      if (editingKind) {
        await api.patch(`/api/v1/settings/lookups/${editingKind.id}`, {
          label: values.label,
          active: values.active !== undefined ? values.active : true,
        });
        message.success('تم تعديل فئة الكوبون بنجاح');
      } else {
        await api.post('/api/v1/settings/lookups', {
          category: 'coupon_kind',
          value: values.value || values.label,
          label: values.label,
        });
        message.success('تمت إضافة فئة الكوبون بنجاح');
      }
      setKindModalVisible(false);
      kindForm.resetFields();
      setEditingKind(null);
      fetchCouponKinds();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر حفظ فئة الكوبون');
    }
  };

  const onDeleteCouponKind = (record: any) => {
    Modal.confirm({
      title: 'حذف فئة الكوبون',
      content: `هل أنت متأكد من حذف فئة الكوبون "${record.label}"؟`,
      okText: 'حذف',
      okType: 'danger',
      cancelText: 'إلغاء',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/settings/lookups/${record.id}`);
          message.success('تم حذف فئة الكوبون');
          fetchCouponKinds();
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message || 'تعذر حذف فئة الكوبون');
        }
      },
    });
  };

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchCouponTypes(), fetchCoupons(), loadLookups(), fetchCouponKinds()]);
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

  const openEditType = (record: CouponType) => {
    setEditingType(record);
    editTypeForm.setFieldsValue({
      name: record.name,
      point_cost: record.point_cost,
      value: parseFloat(record.value),
      active: record.active,
    });
    setEditTypeVisible(true);
  };

  const onEditCouponType = async (values: any) => {
    if (!editingType) return;
    try {
      await api.patch(`/api/v1/loyalty/coupon-types/${editingType.id}`, {
        name: values.name,
        point_cost: values.point_cost,
        value: values.value,
        active: values.active,
      });
      message.success('تم تعديل نوع الكوبون بنجاح');
      setEditTypeVisible(false);
      editTypeForm.resetFields();
      setEditingType(null);
      fetchCouponTypes();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleCouponTypeActive = (record: CouponType) => {
    const activate = !record.active;
    const doToggle = async () => {
      try {
        await api.patch(`/api/v1/loyalty/coupon-types/${record.id}`, { active: activate });
        message.success(activate ? 'تم تفعيل نوع الكوبون' : 'تم إيقاف نوع الكوبون');
        fetchCouponTypes();
      } catch (err) {
        console.error(err);
      }
    };
    if (activate) {
      doToggle();
    } else {
      showDeactivationConfirm({
        title: 'إيقاف نوع الكوبون',
        content: `هل أنت متأكد من إيقاف نوع الكوبون "${record.name}"؟ لن يكون متاحًا لتحويل النقاط بعد ذلك.`,
        onOk: doToggle,
      });
    }
  };

  const onDeleteCouponType = (record: CouponType) => {
    Modal.confirm({
      title: 'حذف نوع الكوبون',
      content: `هل أنت متأكد من حذف نوع الكوبون "${record.name}" نهائياً؟`,
      okText: 'حذف',
      okType: 'danger',
      cancelText: 'إلغاء',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/loyalty/coupon-types/${record.id}`);
          message.success('تم حذف نوع الكوبون بنجاح');
          fetchCouponTypes();
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message || 'تعذر حذف نوع الكوبون');
        }
      },
    });
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
            <p><strong>قيمة الكوبون: </strong> {money(generated.value)} ج.م</p>
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
  // نوع الكوبون بيانات أساسية: السطر يفتح تعديله. والكوبون المصروف بيخص عميل، فالسطر يفتح ملفه —
  // «الكوبون ده بتاع مين» بيتسأل أكتر من «الكوبون ده قيمته كام».
  const typeKb = useTableKeyboard<CouponType>({
    rows: typeFilter.filtered, rowKey: (r) => r.id, onOpen: (r) => openEditType(r),
  });
  const couponKb = useTableKeyboard<any>({
    rows: couponFilter.filtered, rowKey: (r) => r.id,
    onOpen: (r) => navigate(`/customers/${r.customer_id}`),
  });

  const typeColumns = [
    { title: 'اسم الكوبون الترويجي', dataIndex: 'name', key: 'name',
      ...textColumn(couponTypes, (r: CouponType) => r.name) },
    {
      title: 'نوع الكوبون',
      dataIndex: 'kind',
      key: 'kind',
      ...choiceColumn<CouponType>(
        [{ text: 'رصيد مالي للعميل', value: 'money' },
         { text: 'خصم إضافي للفواتير', value: 'discount' }],
        (r, v) => (v === 'money' ? r.kind === 'money' : r.kind !== 'money')),
      render: (kind: string) => (kind === 'money' ? 'رصيد مالي للعميل' : 'خصم إضافي للفواتير'),
    },
    {
      title: 'تكلفة النقاط المطلوبة',
      dataIndex: 'point_cost',
      key: 'point_cost',
      ...numberColumn<CouponType>((r) => r.point_cost),
      render: (cost: number) => <strong style={{ color: '#F5A11D' }}>{cost} نقطة</strong>,
    },
    {
      title: 'القيمة المالية المستفادة',
      dataIndex: 'value',
      key: 'value',
      ...numberColumn<CouponType>((r) => r.value),
      render: (val: string) => `${money(val)} ج.م`,
    },
    {
      title: 'حالة العرض',
      dataIndex: 'active',
      key: 'active',
      ...choiceColumn<CouponType>(
        [{ text: 'متاح للتحويل', value: 'yes' }, { text: 'موقف', value: 'no' }],
        (r, v) => (v === 'yes' ? !!r.active : !r.active)),
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'red'}>{active ? 'متاح للتحويل' : 'موقف'}</Tag>
      ),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      render: (_: any, record: CouponType) => (
        <Space size="middle">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditType(record)}>
            تعديل
          </Button>
          {record.active ? (
            <Button size="small" danger icon={<StopOutlined />} onClick={() => toggleCouponTypeActive(record)}>
              إلغاء تفعيل
            </Button>
          ) : (
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => toggleCouponTypeActive(record)}>
              تفعيل
            </Button>
          )}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDeleteCouponType(record)}>
            حذف
          </Button>
        </Space>
      ),
    },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const typeCols = useTableColumns('loyalty-coupon-types', typeColumns);

  const couponColumns = [
    { title: 'الرقم التسلسلي الكوبون', dataIndex: 'serial', key: 'serial',
      ...textColumn(coupons, (r: any) => r.serial),
      render: (s: string) => <Tag color="purple">{s}</Tag> },
    {
      title: 'العميل المستفيد',
      dataIndex: 'customer_id',
      key: 'customer_id',
      ...textColumn(coupons, (r: any) => (customers.find((c) => c.id === r.customer_id)?.name
        ?? `عميل #${r.customer_id}`)),
      render: (cId: number) => {
        const c = customers.find((cust) => cust.id === cId);
        return c ? c.name : `عميل #${cId}`;
      },
    },
    {
      title: 'القيمة',
      dataIndex: 'value',
      key: 'value',
      ...numberColumn<any>((r) => r.value),
      render: (val: string) => `${money(val)} ج.م`,
    },
    {
      title: 'النقاط المستهلكة',
      dataIndex: 'points_consumed',
      key: 'points_consumed',
      ...numberColumn<any>((r) => r.points_consumed),
    },
    {
      title: 'حالة الكوبون',
      dataIndex: 'status',
      key: 'status',
      ...textColumn(coupons, (r: any) => (STATUS_TAGS[r.status]?.text ?? r.status)),
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

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const couponCols = useTableColumns('loyalty-coupons', couponColumns);

  const items = [
    {
      key: 'kinds',
      label: `فئات الكوبونات — الورق (${couponKinds.length})`,
      children: (
        <div>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ color: '#595959' }}>
              فئة الورقة اللي بتتسلّم للعميل على الفاتورة (عادي / فضي / ذهبي / ماسي). الفئة مع رقم الكوبون هما هويته: «٥ ذهبي» غير «٥ فضي».
            </span>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingKind(null);
                kindForm.resetFields();
                kindForm.setFieldsValue({ active: true });
                setKindModalVisible(true);
              }}
            >
              إضافة فئة كوبون جديدة
            </Button>
          </div>
          <Table
            size="small"
            dataSource={couponKinds}
            rowKey="id"
            loading={loading}
            pagination={false}
            columns={[
              { title: 'اسم الفئة / النوع', dataIndex: 'label', key: 'label',
                render: (l: string) => <Tag color="blue" style={{ fontSize: 13, padding: '2px 8px' }}>{l}</Tag> },
              { title: 'القيمة المرجعية', dataIndex: 'value', key: 'value' },
              { title: 'الحالة', dataIndex: 'active', key: 'active',
                render: (active: boolean) => (
                  <Tag color={active ? 'green' : 'red'}>{active ? 'نشط' : 'معطل'}</Tag>
                ) },
              {
                title: 'الإجراءات',
                key: 'actions',
                render: (_: any, record: any) => (
                  <Space size="middle">
                    <Button size="small" icon={<EditOutlined />} onClick={() => {
                      setEditingKind(record);
                      kindForm.setFieldsValue({ label: record.label, value: record.value, active: record.active });
                      setKindModalVisible(true);
                    }}>
                      تعديل
                    </Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDeleteCouponKind(record)}>
                      حذف
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      ),
    },
  ];

  const totalCouponsCount = coupons.length;
  const totalCouponsValue = coupons.reduce((s, c) => s + Number(c.value || 0), 0);

  // الإحصائية على فئات الورق — دي الحاجة الوحيدة اللي للكوبون فئة فيها.
  const kindStats = useMemo(() => {
    if (couponKinds.length > 0) {
      return couponKinds.map((k) => {
        const matching = coupons.filter((c) => c.kind === k.value);
        return {
          key: k.value,
          label: k.label,
          count: matching.length,
          value: matching.reduce((s, c) => s + Number(c.value || 0), 0),
          onClick: () => {
            couponFilter.setQuery(k.label);
            setActiveTab('coupons');
          },
        };
      });
    }
    return [
      {
        key: 'money',
        label: 'رصيد مالي',
        count: coupons.filter((c) => c.kind === 'money' || !c.kind).length,
        value: coupons.filter((c) => c.kind === 'money' || !c.kind).reduce((s, c) => s + Number(c.value || 0), 0),
      },
      {
        key: 'discount',
        label: 'خصم فواتير',
        count: coupons.filter((c) => c.kind === 'gift_money_off' || c.kind === 'discount').length,
        value: coupons.filter((c) => c.kind === 'gift_money_off' || c.kind === 'discount').reduce((s, c) => s + Number(c.value || 0), 0),
      },
    ];
  }, [couponKinds, coupons]);

  return (
    <div>
      <Card title="الكوبونات والنقاط">
        <CouponStatsOverview
          totalCount={totalCouponsCount}
          totalValue={totalCouponsValue}
          kinds={kindStats}
          kindsTitle="أنواع الكوبونات وتوزيع الأعداد"
        />
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={items} />
      </Card>

      {/* Create Coupon Type Settings Drawer */}
      <TabModal footer={null} centered
        title="إضافة نوع كوبون ترويجي جديد"
        width={400}
        onCancel={() => setTypeVisible(false)}
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
      </TabModal>

      {/* Edit Coupon Type Drawer */}
      <TabModal footer={null} centered
        title="تعديل نوع الكوبون الترويجي"
        width={400}
        onCancel={() => {
          setEditTypeVisible(false);
          setEditingType(null);
        }}
        open={editTypeVisible}
        destroyOnHidden
      >
        <Form form={editTypeForm} layout="vertical" onFinish={onEditCouponType} requiredMark={false}>
          <Form.Item
            name="name"
            label="اسم الكوبون الترويجي"
            rules={[{ required: true, message: 'يرجى إدخال اسم الكوبون الترويجي!' }]}
          >
            <Input placeholder="مثال: كوبون سباك متميز 50" />
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

          <Form.Item name="active" label="حالة العرض">
            <Select>
              <Select.Option value={true}>متاح للتحويل</Select.Option>
              <Select.Option value={false}>موقف</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                حفظ التعديلات
              </Button>
              <Button
                onClick={() => {
                  setEditTypeVisible(false);
                  setEditingType(null);
                }}
              >
                إلغاء
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </TabModal>

      {/* Manual Points Conversion Drawer */}
      <TabModal footer={null} centered
        title="تحويل نقاط العميل يدويًا"
        width={400}
        onCancel={() => setConvertVisible(false)}
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
                    {t.name} (يكلف {t.point_cost} نقطة - يعطي {money(t.value)} ج.م)
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
      </TabModal>

      {/* Redeem Coupon Modal */}
      <TabModal
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
      </TabModal>

      {/* Add / Edit Coupon Kind Modal */}
      <TabModal
        title={editingKind ? `تعديل فئة الكوبون: ${editingKind.label}` : 'إضافة فئة كوبون جديدة'}
        open={kindModalVisible}
        onCancel={() => {
          setKindModalVisible(false);
          setEditingKind(null);
          kindForm.resetFields();
        }}
        footer={null}
        destroyOnHidden
      >
        <Form form={kindForm} layout="vertical" onFinish={onSaveCouponKind} requiredMark={false}>
          <Form.Item
            name="label"
            label="اسم الفئة / النوع (مثال: عادي، فضي، ذهبي، ماسي)"
            rules={[{ required: true, message: 'يرجى إدخال اسم الفئة!' }]}
          >
            <Input placeholder="اسم الفئة" />
          </Form.Item>

          <Form.Item
            name="value"
            label="القيمة المرجعية (اختياري - تُترك فارغة لاستخدام الاسم)"
          >
            <Input placeholder="كود أو قيمة الفئة" />
          </Form.Item>

          {editingKind && (
            <Form.Item name="active" label="الحالة">
              <Select>
                <Select.Option value={true}>نشط</Select.Option>
                <Select.Option value={false}>معطل</Select.Option>
              </Select>
            </Form.Item>
          )}

          <Form.Item style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingKind ? 'حفظ التعديلات' : 'إضافة الفئة'}
              </Button>
              <Button onClick={() => {
                setKindModalVisible(false);
                setEditingKind(null);
                kindForm.resetFields();
              }}>
                إلغاء
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </TabModal>
    </div>
  );
}

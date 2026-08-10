import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Checkbox, Col, Divider, Form, Input, InputNumber, Modal, Row, Select, Space,
  Statistic, Table, Tag, Tooltip, message,
} from 'antd';
import {
  UserAddOutlined, PlusOutlined, MinusCircleOutlined, EyeOutlined, StopOutlined,
  SearchOutlined, ClearOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';
import { useNavigate } from 'react-router-dom';
import { TabModal } from '../components/TabModal';

interface CustomerRecord {
  id: number;
  code: string;
  name: string;
  customer_type: string; // admin-configurable via Settings (013)
  phone: string | null;
  phones: string[] | null;
  governorate_id: number | null;
  markaz: string | null;
  address: string | null;
  rep_id: number;
  territory_id: number;
  default_price_tier: string | null;
  active: boolean;
  balance?: string | null;   // receivable balance, sent with the list (one grouped query)
  // Card fields read off their العملاء form (031).
  branch_id: number | null;
  email: string | null;
  tax_number: string | null;
  commercial_register: string | null;
  discount_pct: string | null;
  vat_pct: string | null;
  is_cash: boolean;
}

interface Filters {
  q?: string;
  customer_type?: string;
  rep_id?: number;
  territory_id?: number;
  governorate_id?: number;
  active?: boolean;
  balance_filter?: string;
}

interface Governorate {
  id: number;
  name: string;
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

// Dynamic list of EXTRA phone numbers (the primary `phone` field stays separate).
const ExtraPhonesList = () => (
  <Form.List name="phones">
    {(fields, { add, remove }) => (
      <>
        <div style={{ marginBottom: 8 }}>أرقام هاتف إضافية</div>
        {fields.map((field) => (
          <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
            <Form.Item {...field} style={{ marginBottom: 0, flex: 1 }}>
              <Input placeholder="مثال: 01000000000" style={{ width: 330 }} />
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

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The list endpoint now carries each customer's balance (one grouped query on the server),
// so the grid no longer fires a request per row.
const CustomerBalance = ({ value }: { value?: string | null }) => {
  const n = Number(value || 0);
  const color = n > 0 ? '#cf1322' : n < 0 ? '#1677ff' : undefined;
  return <span style={{ fontWeight: 'bold', color }}>{money(n)} ج.م</span>;
};

export default function Customers() {
  const { options: typeOptions } = useLookup('customer_type');
  const typeLabels = labelMap(typeOptions);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [governorates, setGovernorates] = useState<Governorate[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState('');           // typed text, applied on Enter/button
  const navigate = useNavigate();

  const [form] = Form.useForm();
  const { user: currentUser } = useAuth();

  // Filtering happens on the server so it covers ALL customers, not just the loaded page.
  const fetchCustomers = async (override?: Filters) => {
    const active = override ?? filters;
    setLoading(true);
    try {
      const params: any = {};
      Object.entries(active).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      });
      const res = await api.get('/api/v1/customers', { params });
      setCustomers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const setFilter = (key: keyof Filters, value: any) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    fetchCustomers(next);
  };

  const applySearch = () => setFilter('q', search.trim() || undefined);

  const resetFilters = () => {
    setSearch('');
    setFilters({});
    fetchCustomers({});
  };

  // Live summary of whatever the current filter returned.
  const summary = useMemo(() => {
    const total = customers.reduce((s, c) => s + Number(c.balance || 0), 0);
    const debtors = customers.filter((c) => Number(c.balance || 0) > 0).length;
    return { count: customers.length, total, debtors };
  }, [customers]);

  const fetchLookups = async () => {
    try {
      const [usersRes, territoriesRes, governoratesRes, branchesRes] = await Promise.all([
        api.get('/api/v1/users'),
        api.get('/api/v1/territories'),
        api.get('/api/v1/governorates'),
        api.get('/api/v1/branches'),
      ]);
      setReps(usersRes.data.filter((u: any) => u.role === 'sales_rep'));
      setTerritories(territoriesRes.data);
      setGovernorates(governoratesRes.data);
      setBranches(branchesRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchLookups();
  }, []);

  // Form.List rows can be blank/undefined; only send real numbers.
  const cleanPhones = (phones: any): string[] =>
    (phones || []).map((p: any) => (p || '').trim()).filter(Boolean);

  const onCreateCustomer = async (values: any) => {
    try {
      const { hidden, ...rest } = values;
      const created = await api.post('/api/v1/customers', {
        ...rest,
        governorate_id: values.governorate_id ?? null,
        markaz: values.markaz ?? null,
        address: values.address ?? null,
        // Left blank stays blank, not zero: «مفيش اتفاق» and «الاتفاق صفر» are different facts,
        // and the server keeps them apart only if the screen does too.
        discount_pct: values.discount_pct ?? null,
        vat_pct: values.vat_pct ?? null,
        is_cash: !!values.is_cash,
        phones: cleanPhones(values.phones),
      });
      // «مخفي» is a state a customer is put into, not one he is born in, so it is a separate edit.
      if (hidden && created.data?.id) {
        await api.patch(`/api/v1/customers/${created.data.id}`, { active: false });
      }
      message.success('تم تسجيل العميل بنجاح');
      setDrawerVisible(false);
      form.resetFields();
      fetchCustomers();
    } catch (err) {
      console.error(err);
    }
  };



  const onDeactivate = (record: CustomerRecord) => {
    showDeactivationConfirm({
      title: 'إلغاء تفعيل العميل',
      content: `هل أنت متأكد من إلغاء تفعيل العميل "${record.name}"؟`,
      onOk: async () => {
        try {
          await api.delete(`/api/v1/customers/${record.id}`);
          message.success('تم إلغاء تفعيل العميل');
          fetchCustomers();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Permanent delete. The server refuses when the customer has any movement (invoices,
  // receipts, ledger lines…) and tells the user to deactivate instead.
  const onDelete = (record: CustomerRecord) => {
    Modal.confirm({
      title: 'حذف العميل نهائياً',
      content: `سيتم حذف العميل "${record.name}" نهائياً. لا يمكن الحذف إذا كانت عليه أي حركة — عندها استخدم «إلغاء التفعيل».`,
      okText: 'حذف نهائي',
      okButtonProps: { danger: true },
      cancelText: 'إلغاء',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/customers/${record.id}?hard=true`);
          message.success('تم حذف العميل');
          fetchCustomers();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Their seven columns, in their order — `رقم · الفرع · الاسم · الهاتف · مندوب · محافظه ·
  // مدينة` — plus the balance, and that is the whole table. It fits the screen, which is the
  // point: a list you have to drag sideways to read is one where the number you came for is
  // never on screen beside the name you looked it up by.
  //
  // What we have and they do not has NOT been dropped — تصنيف، المنطقة and الفئة السعرية moved
  // into the expanded row, «مخفي» is a tag on the name, and the actions became the three icons
  // their own rows use. Nothing left the screen; it stopped costing a column.
  const columns = [
    {
      title: 'رقم',
      dataIndex: 'code',
      key: 'code',
      width: 110,
      render: (code: string) => <Tag color="blue">{code}</Tag>,
    },
    {
      title: 'الفرع',
      dataIndex: 'branch_id',
      key: 'branch_id',
      ellipsis: true,
      render: (bId: number | null) => {
        const branch = branches.find((b) => b.id === bId);
        return branch ? branch.name : '-';
      },
    },
    {
      title: 'الاسم',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: CustomerRecord) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{name}</span>
          {!record.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ),
    },
    {
      title: 'الهاتف',
      dataIndex: 'phone',
      key: 'phone',
      width: 125,
      render: (phone: string | null) => phone || '-',
    },
    {
      title: 'مندوب',
      dataIndex: 'rep_id',
      key: 'rep_id',
      ellipsis: true,
      render: (repId: number) => {
        const rep = reps.find((r) => r.id === repId);
        return rep ? rep.full_name : `مندوب #${repId}`;
      },
    },
    {
      title: 'محافظه',
      dataIndex: 'governorate_id',
      key: 'governorate_id',
      ellipsis: true,
      render: (gId: number | null) => {
        const gov = governorates.find((g) => g.id === gId);
        return gov ? gov.name : '-';
      },
    },
    {
      title: 'مدينة',
      dataIndex: 'markaz',
      key: 'markaz',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'الرصيد',
      key: 'balance',
      width: 130,
      align: 'left' as const,
      render: (_: any, record: CustomerRecord) => <CustomerBalance value={record.balance} />,
      sorter: (a: CustomerRecord, b: CustomerRecord) =>
        Number(a.balance || 0) - Number(b.balance || 0),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      // Icons, like their rows use — three of them in the width two words used to take. Row
      // clicks open the customer file, so the buttons must not bubble up to it.
      render: (_: any, record: CustomerRecord) => (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="عرض الملف">
            <Button type="text" icon={<EyeOutlined />}
              onClick={() => navigate(`/customers/${record.id}`)} />
          </Tooltip>
          {record.active && (
            <Tooltip title="إخفاء">
              <Button type="text" icon={<StopOutlined />} onClick={() => onDeactivate(record)} />
            </Tooltip>
          )}
          <Tooltip title="حذف">
            <Button type="text" danger icon={<DeleteOutlined />}
              onClick={() => onDelete(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // The three of ours that used to be columns. Opening a row costs one click and gives them back
  // in full, rather than making every row narrower for everyone who never looks at them.
  const expandedRow = (record: CustomerRecord) => (
    <Space size={32} wrap style={{ paddingInlineStart: 8 }}>
      <span>
        <span style={{ color: '#888' }}>تصنيف: </span>
        {typeLabels[record.customer_type] || TYPE_LABELS[record.customer_type]
          || record.customer_type}
      </span>
      <span>
        <span style={{ color: '#888' }}>المنطقة: </span>
        {territories.find((t) => t.id === record.territory_id)?.name
          || `منطقة #${record.territory_id}`}
      </span>
      <span>
        <span style={{ color: '#888' }}>الفئة السعرية: </span>
        {record.default_price_tier
          ? <Tag color="geekblue">{TIER_LABELS[record.default_price_tier]
              || record.default_price_tier}</Tag>
          : <Tag>مستهلك (افتراضي)</Tag>}
      </span>
      {record.address && (
        <span><span style={{ color: '#888' }}>العنوان: </span>{record.address}</span>
      )}
    </Space>
  );

  return (
    <div>
      <Card
        title="العملاء"
        extra={
          <Button data-shortcut="F2" type="primary" icon={<UserAddOutlined />}
            onClick={() => setDrawerVisible(true)}>
            إضافة عميل
          </Button>
        }
      >
        {/* --- Search + filters (server-side, so they cover every customer) --- */}
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={7}>
            <Input
              allowClear
              value={search}
              placeholder="بحث بالاسم أو الكود أو الهاتف أو العنوان"
              prefix={<SearchOutlined />}
              onChange={(e) => setSearch(e.target.value)}
              onPressEnter={applySearch}
              onBlur={applySearch}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear style={{ width: '100%' }} placeholder="التصنيف"
              value={filters.customer_type}
              onChange={(v) => setFilter('customer_type', v)}
              options={typeOptions.map((o) => ({ value: o.value, label: o.label }))} />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="المندوب"
              value={filters.rep_id}
              onChange={(v) => setFilter('rep_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={reps.map((r) => ({ value: r.id, label: r.full_name }))} />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="المحافظة"
              value={filters.governorate_id}
              onChange={(v) => setFilter('governorate_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={governorates.map((g) => ({ value: g.id, label: g.name }))} />
          </Col>
          <Col xs={12} md={5}>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder="المنطقة"
              value={filters.territory_id}
              onChange={(v) => setFilter('territory_id', v)}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)}
              options={territories.map((t) => ({ value: t.id, label: t.name }))} />
          </Col>
          <Col xs={12} md={5}>
            <Select allowClear style={{ width: '100%' }} placeholder="حالة الذمة"
              value={filters.balance_filter}
              onChange={(v) => setFilter('balance_filter', v)}
              options={[
                { value: 'debtors', label: 'عليه مديونية' },
                { value: 'settled', label: 'مسدّد بالكامل' },
                { value: 'credit', label: 'له رصيد (دائن)' },
              ]} />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear style={{ width: '100%' }} placeholder="الحالة"
              value={filters.active as any}
              onChange={(v) => setFilter('active', v)}
              options={[
                { value: true, label: 'نشط' },
                { value: false, label: 'معطل' },
              ]} />
          </Col>
          <Col xs={24} md={5}>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>بحث</Button>
              <Button icon={<ClearOutlined />} onClick={resetFilters}>مسح الفلاتر</Button>
            </Space>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="عدد العملاء الظاهرين" value={summary.count} /></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="إجمالي المديونية" value={money(summary.total)} suffix="ج.م"
                valueStyle={{ color: summary.total > 0 ? '#cf1322' : undefined }} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="عملاء عليهم مديونية" value={summary.debtors} /></Card>
          </Col>
        </Row>

        <Table
          dataSource={customers}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          tableLayout="fixed"
          expandable={{ expandedRowRender: expandedRow }}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}` }}
          // The whole row opens the customer file — no dedicated button needed.
          onRow={(record) => ({
            onClick: () => navigate(`/customers/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* عميل جديد — laid out field for field against their العملاء form: the same groups, three
          to a row, in their order. Whoever registers customers off a paper application reads down
          it in that order, and a form that asks in a different one turns typing into searching. */}
      <TabModal footer={null} centered
        title="عميل جديد"
        width={860}
        onCancel={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onCreateCustomer} requiredMark={false}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="branch_id" label="الفرع">
                <Select allowClear showSearch placeholder="اختر الفرع"
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                  filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="rep_id" label="مندوب"
                rules={[{ required: true, message: 'يرجى تحديد المندوب!' }]}>
                <Select showSearch placeholder="اختر المندوب"
                  options={reps.map((r) => ({ value: r.id, label: r.full_name }))}
                  filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="default_price_tier" label="السعر الافتراضي"
                extra="تُستخدم تلقائياً على فواتيره (الافتراضي: مستهلك)">
                <Select allowClear placeholder="مستهلك (افتراضي)"
                  options={Object.entries(TIER_LABELS).map(([k, l]) => ({ value: k, label: l }))} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="name" label="الاسم"
                rules={[{ required: true, message: 'يرجى إدخال اسم العميل!' }]}>
                <Input placeholder="مثال: شركة النور للسباكة" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="email" label="البريد الالكترونى"
                rules={[{ type: 'email', message: 'بريد غير صحيح' }]}>
                <Input placeholder="nour@example.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="tax_number" label="رقم الضريبي">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="commercial_register" label="السجل التجاري">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="address" label="العنوان">
                <Input placeholder="مثال: 22 شارع سعد زغلول، بجوار مسجد النور" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="phone" label="الهاتف">
                <Input placeholder="مثال: 01000000000" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="customer_type" label="تصنيف"
                rules={[{ required: true, message: 'يرجى تحديد نوع العميل!' }]}>
                <Select placeholder="اختر التصنيف"
                  options={typeOptions.map((o) => ({ value: o.value, label: o.label }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="governorate_id" label="محافظات">
                <Select allowClear showSearch placeholder="اختر المحافظة"
                  options={governorates.map((g) => ({ value: g.id, label: g.name }))}
                  filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="markaz" label="مدن">
                <Input placeholder="مثال: دمنهور" />
              </Form.Item>
            </Col>
          </Row>

          {/* خصم and ض.م are left EMPTY by default, not zero: empty means nothing was agreed and
              the item's own rate applies, zero means an agreed rate of nothing. Pre-filling them
              with 0 would silently turn every customer into one who negotiated a zero rate. */}
          <Row gutter={12}>
            <Col span={4}>
              {/* His rate REPLACES the item's rather than adding to it: a dealer on 20% against
                  an item that gives 10% is on twenty, not twenty-eight. Empty is what makes that
                  readable — «مفيش اتفاق» and «اتفقنا على صفر» are different instructions. */}
              <Form.Item name="discount_pct" label="خصم %"
                tooltip="لو محدد، بيحل محل خصم الصنف — مش بيتزود عليه. سيبه فاضي والصنف ياخد خصمه."
                extra="فاضي = مفيش اتفاق">
                <InputNumber min={0} max={100} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="vat_pct" label="ض.م">
                <InputNumber min={0} max={100} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Space size={24} style={{ marginTop: 30 }}>
                <Form.Item name="is_cash" valuePropName="checked" noStyle>
                  <Checkbox>نقدي</Checkbox>
                </Form.Item>
                <Form.Item name="hidden" valuePropName="checked" noStyle>
                  <Checkbox>مخفي</Checkbox>
                </Form.Item>
              </Space>
            </Col>
          </Row>

          {/* Ours, kept after theirs: their form has no territory and no room for a second
              number, and dropping either would lose data we already hold. */}
          <Divider orientation="right" style={{ margin: '8px 0' }}>إضافات تكنو ثيرم</Divider>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="territory_id" label="المنطقة الجغرافية"
                rules={[{ required: true, message: 'يرجى تحديد المنطقة!' }]}>
                <Select showSearch placeholder="اختر المنطقة"
                  options={territories.map((t) => ({ value: t.id, label: t.name }))}
                  filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <ExtraPhonesList />
            </Col>
          </Row>

          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setDrawerVisible(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>


    </div>
  );
}

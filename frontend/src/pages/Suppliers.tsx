import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Checkbox, Col, Divider, Form, Input, Modal, Row, Select, Space, Statistic,
  Table, Tag, Tooltip, message,
} from 'antd';
import {
  PlusOutlined, MinusCircleOutlined, EyeOutlined, StopOutlined,
  SearchOutlined, ClearOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';
import { TabModal } from '../components/TabModal';

interface SupplierRecord {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  phones: string[] | null;
  active: boolean;
  balance?: string | null;   // payable balance, sent with the list (one grouped query)
  branch_id: number | null;
  governorate_id: number | null;
  markaz: string | null;
  // Card fields read off their الموردين form (031).
  supplier_type: string | null;
  email: string | null;
  tax_number: string | null;
  commercial_register: string | null;
  is_cash: boolean;
}

interface Filters {
  q?: string;
  active?: boolean;
  balance_filter?: string;
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

const money = (v: any) =>
  Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The list endpoint now carries each supplier's balance (one grouped query on the server),
// so the grid no longer fires a request per row.
const SupplierBalance = ({ value }: { value?: string | null }) => {
  const n = Number(value || 0);
  const color = n > 0 ? '#cf1322' : n < 0 ? '#1677ff' : undefined;
  return <span style={{ fontWeight: 'bold', color }}>{money(n)} ج.م</span>;
};

export default function Suppliers() {
  const { options: typeOptions } = useLookup('supplier_type');
  const typeLabels = labelMap(typeOptions);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [governorates, setGovernorates] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [form] = Form.useForm();
  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  // Filtering happens on the server so it covers ALL suppliers, not just the loaded page.
  const fetchSuppliers = async (override?: Filters) => {
    const active = override ?? filters;
    setLoading(true);
    try {
      const params: any = {};
      Object.entries(active).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params[k] = v;
      });
      const res = await api.get('/api/v1/suppliers', { params });
      setSuppliers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const setFilter = (key: keyof Filters, value: any) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    fetchSuppliers(next);
  };

  const applySearch = () => setFilter('q', search.trim() || undefined);

  const resetFilters = () => {
    setSearch('');
    setFilters({});
    fetchSuppliers({});
  };

  // Live summary of whatever the current filter returned.
  const summary = useMemo(() => {
    const total = suppliers.reduce((s, x) => s + Number(x.balance || 0), 0);
    const due = suppliers.filter((x) => Number(x.balance || 0) > 0).length;
    return { count: suppliers.length, total, due };
  }, [suppliers]);

  // الفرع and محافظه are columns on their list, so the names have to be on hand to render it.
  const fetchLookups = async () => {
    try {
      const [branchesRes, governoratesRes] = await Promise.all([
        api.get('/api/v1/branches'),
        api.get('/api/v1/governorates'),
      ]);
      setBranches(branchesRes.data);
      setGovernorates(governoratesRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchSuppliers();
    fetchLookups();
  }, []);

  // Form.List rows can be blank/undefined; only send real numbers.
  const cleanPhones = (phones: any): string[] =>
    (phones || []).map((p: any) => (p || '').trim()).filter(Boolean);

  const onCreateSupplier = async (values: any) => {
    try {
      const { hidden, ...rest } = values;
      const created = await api.post('/api/v1/suppliers', {
        ...rest,
        address: values.address ?? null,
        is_cash: !!values.is_cash,
        phones: cleanPhones(values.phones),
      });
      // «مخفي» is a state a supplier is put into, not one he is born in, so it is a separate edit.
      if (hidden && created.data?.id) {
        await api.patch(`/api/v1/suppliers/${created.data.id}`, { active: false });
      }
      message.success('تم تسجيل المورد بنجاح');
      setDrawerVisible(false);
      form.resetFields();
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

  // Permanent delete. The server refuses when the supplier has any movement.
  const onDelete = (record: SupplierRecord) => {
    Modal.confirm({
      title: 'حذف المورد نهائياً',
      content: `سيتم حذف المورد "${record.name}" نهائياً. لا يمكن الحذف إذا كانت عليه أي حركة — عندها استخدم «إلغاء التفعيل».`,
      okText: 'حذف نهائي',
      okButtonProps: { danger: true },
      cancelText: 'إلغاء',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/suppliers/${record.id}?hard=true`);
          message.success('تم حذف المورد');
          fetchSuppliers();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Their six columns, in their order — `رقم · الفرع · الاسم · الهاتف · محافظه · مدينة` — plus
  // the balance, and that is the whole table. Same shape as their العملاء list minus the rep,
  // which a supplier has no equivalent of, and it fits the screen for the same reason that one
  // does: تصنيف and العنوان moved into the expanded row, «مخفي» is a tag on the name, and the
  // actions are the three icons their own rows use.
  const columns = [
    {
      title: 'رقم',
      dataIndex: 'code',
      key: 'code',
      width: 110,
      render: (code: string) => <Tag color="orange">{code}</Tag>,
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
      render: (name: string, record: SupplierRecord) => (
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
      width: 140,
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
      title: 'الرصيد الدائن',
      key: 'balance',
      width: 140,
      align: 'left' as const,
      render: (_: any, record: SupplierRecord) => <SupplierBalance value={record.balance} />,
      sorter: (a: SupplierRecord, b: SupplierRecord) =>
        Number(a.balance || 0) - Number(b.balance || 0),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      // Row clicks open the supplier file, so the buttons must not bubble up to it.
      render: (_: any, record: SupplierRecord) => (
        <Space size={2} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="عرض الملف">
            <Button type="text" icon={<EyeOutlined />}
              onClick={() => navigate(`/suppliers/${record.id}`)} />
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

  // Ours, given back in full one click away rather than made narrower for everyone.
  const expandedRow = (record: SupplierRecord) => (
    <Space size={32} wrap style={{ paddingInlineStart: 8 }}>
      <span>
        <span style={{ color: '#888' }}>تصنيف: </span>
        {record.supplier_type ? (typeLabels[record.supplier_type] || record.supplier_type) : '—'}
      </span>
      <span><span style={{ color: '#888' }}>العنوان: </span>{record.address || '—'}</span>
      {record.email && (
        <span><span style={{ color: '#888' }}>البريد: </span>{record.email}</span>
      )}
      {record.tax_number && (
        <span><span style={{ color: '#888' }}>رقم ضريبي: </span>{record.tax_number}</span>
      )}
      {record.is_cash && <Tag color="green">نقدي</Tag>}
    </Space>
  );

  return (
    <div>
      <Card
        title="الموردين"
        extra={
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setDrawerVisible(true)}>
            إضافة مورد
          </Button>
        }
      >
        {/* --- Search + filters (server-side, so they cover every supplier) --- */}
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={9}>
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
          <Col xs={12} md={5}>
            <Select allowClear style={{ width: '100%' }} placeholder="حالة الذمة"
              value={filters.balance_filter}
              onChange={(v) => setFilter('balance_filter', v)}
              options={[
                { value: 'due', label: 'مستحق له (علينا)' },
                { value: 'settled', label: 'مسدّد بالكامل' },
                { value: 'advance', label: 'دفعنا مقدماً (له علينا سالب)' },
              ]} />
          </Col>
          <Col xs={12} md={4}>
            <Select allowClear style={{ width: '100%' }} placeholder="الحالة"
              value={filters.active as any}
              onChange={(v) => setFilter('active', v)}
              options={[{ value: true, label: 'نشط' }, { value: false, label: 'معطل' }]} />
          </Col>
          <Col xs={24} md={6}>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={applySearch}>بحث</Button>
              <Button icon={<ClearOutlined />} onClick={resetFilters}>مسح الفلاتر</Button>
            </Space>
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="عدد الموردين الظاهرين" value={summary.count} /></Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small">
              <Statistic title="إجمالي المستحق للموردين" value={money(summary.total)} suffix="ج.م"
                valueStyle={{ color: summary.total > 0 ? '#cf1322' : undefined }} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small"><Statistic title="موردين لهم مستحقات" value={summary.due} /></Card>
          </Col>
        </Row>

        <Table
          dataSource={suppliers}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          tableLayout="fixed"
          expandable={{ expandedRowRender: expandedRow }}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
          // The whole row opens the supplier file.
          onRow={(record) => ({
            onClick: () => navigate(`/suppliers/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* مورد جديد — laid out field for field against their الموردين form: the same groups, three
          to a row, in their order. Note what their form does NOT have — no خصم, no ض.م, no default
          price tier, all three of which their customer form does. That asymmetry is theirs, and
          adding the three here would invent a negotiation this relationship is not run on. */}
      <TabModal footer={null} centered
        title="مورد جديد"
        width={860}
        onCancel={() => setDrawerVisible(false)}
        open={drawerVisible}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={onCreateSupplier} requiredMark={false}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="branch_id" label="الفرع">
                <Select allowClear showSearch placeholder="اختر الفرع"
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                  filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="name" label="الاسم"
                rules={[{ required: true, message: 'يرجى إدخال اسم المورد!' }]}>
                <Input placeholder="مثال: مصنع النصر للأنابيب" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="email" label="البريد الالكترونى"
                rules={[{ type: 'email', message: 'بريد غير صحيح' }]}>
                <Input placeholder="sales@example.com" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="tax_number" label="رقم الضريبي">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="commercial_register" label="السجل التجاري">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="address" label="العنوان">
                <Input placeholder="مثال: 15 شارع الجمهورية، وسط البلد" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="phone" label="الهاتف">
                <Input placeholder="مثال: 02-23456789" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="supplier_type" label="تصنيف">
                <Select allowClear placeholder="اختر التصنيف"
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
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="markaz" label="مدن">
                <Input placeholder="مثال: دمنهور" />
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

          {/* Ours, kept after theirs: their form has no room for a second number. */}
          <Divider orientation="right" style={{ margin: '8px 0' }}>إضافات تكنو ثيرم</Divider>
          <ExtraPhonesList />

          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setDrawerVisible(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, Form, Input, Modal, Row, Select, Space, Statistic, Switch, Table, Tag, message,
} from 'antd';
import {
  PlusOutlined, MinusCircleOutlined, SearchOutlined, ClearOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
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
  balance?: string | null;   // payable balance, sent with the list (one grouped query)
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
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
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
      render: (name: string) => <span style={{ fontWeight: 600 }}>{name}</span>,
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
      render: (_: any, record: SupplierRecord) => <SupplierBalance value={record.balance} />,
      sorter: (a: SupplierRecord, b: SupplierRecord) =>
        Number(a.balance || 0) - Number(b.balance || 0),
    },
    {
      title: 'الإجراءات',
      key: 'actions',
      // Row clicks open the supplier file, so the buttons must not bubble up to it.
      render: (_: any, record: SupplierRecord) => (
        <Space size="middle" onClick={(e) => e.stopPropagation()}>
          {record.active && (
            <Button type="link" onClick={() => onDeactivate(record)}>
              إلغاء تفعيل
            </Button>
          )}
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => onDelete(record)}>
            حذف
          </Button>
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
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `الإجمالي: ${t}`, pageSizeOptions: ['10', '20', '50', '100', '200'] }}
          // The whole row opens the supplier file.
          onRow={(record) => ({
            onClick: () => navigate(`/suppliers/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* Add Supplier Drawer */}
      <Modal footer={null} centered
        title="إضافة مورد جديد"
        width={400}
        onCancel={() => setDrawerVisible(false)}
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
      </Modal>

    </div>
  );
}

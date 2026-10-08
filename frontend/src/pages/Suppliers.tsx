import React, { useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Button, Card, Checkbox, Col, Divider, Form, Input, Modal, Row, Select, Space,
  Table, Tag, Tooltip, message,
} from 'antd';
import {
  PlusOutlined, MinusCircleOutlined, EyeOutlined, StopOutlined,
  SearchOutlined, ClearOutlined, DeleteOutlined, ShopOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { useLookup, labelMap } from '../hooks/useLookup';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import ListPage from '../components/ListPage';
import ExportExcelButton from '../components/ExportExcelButton';
import { money, numeralsLocale } from '../utils/money';
import { activeOptions } from '../utils/active';

interface SupplierRecord {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  phones: string[] | null;
  active: boolean;
  balance?: string | null;
  branch_id: number | null;
  governorate_id: number | null;
  markaz: string | null;
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

const SupplierBalance = ({ value }: { value?: string | null }) => {
  const n = Number(value || 0);
  const color = n > 0 ? '#cf1322' : n < 0 ? '#1677ff' : undefined;
  return <span style={{ fontWeight: 'bold', color }}>{money(n)}</span>;
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

  const summary = useMemo(() => {
    const total = suppliers.reduce((s, x) => s + Number(x.balance || 0), 0);
    const due = suppliers.filter((x) => Number(x.balance || 0) > 0).length;
    return { count: suppliers.length, total, due };
  }, [suppliers]);

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

  const onDelete = async (record: SupplierRecord) => {
    try {
      await api.delete(`/api/v1/suppliers/${record.id}?hard=true`);
      message.success('تم حذف المورد');
      fetchSuppliers();
    } catch (err) {
      console.error(err);
    }
  };

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

  const tableCols = useTableColumns('suppliers', columns);

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

  const footer = (
    <span className="sl-foot">
      <span>عدد الموردين الظاهرين: <b>{summary.count.toLocaleString(numeralsLocale())}</b></span>
      <span>
        إجمالي المستحق للموردين:{' '}
        <b className={summary.total > 0 ? 'is-neg' : undefined}>{money(summary.total)}</b>
      </span>
      <span>موردين لهم مستحقات: <b>{summary.due.toLocaleString(numeralsLocale())}</b></span>
    </span>
  );

  return (
    <>
      <ListPage
        icon={<ShopOutlined />}
        title="الموردين" muted="(دليل الموردين وأرصدتهم)"
        actions={(<>
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
            onClick={() => setDrawerVisible(true)}>
            إضافة مورد
          </Button>
          <ExportExcelButton name="الموردين" rows={suppliers}
            tableColumns={tableCols.columns as any} style={{ marginInlineStart: 0 }} />
          {tableCols.control}
        </>)}
        filters={(<>
          <Input
            className="sl-f-search"
            allowClear
            value={search}
            placeholder="بحث بالاسم أو الكود أو الهاتف أو العنوان"
            prefix={<SearchOutlined />}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={applySearch}
            onBlur={applySearch}
          />
          <Select allowClear placeholder="حالة الذمة"
            value={filters.balance_filter}
            onChange={(v) => setFilter('balance_filter', v)}
            options={[
              { value: 'due', label: 'مستحق له (علينا)' },
              { value: 'settled', label: 'مسدّد بالكامل' },
              { value: 'advance', label: 'دفعنا مقدماً (له علينا سالب)' },
            ]} />
          <Select allowClear placeholder="الحالة"
            value={filters.active as any}
            onChange={(v) => setFilter('active', v)}
            options={[{ value: true, label: 'نشط' }, { value: false, label: 'معطل' }]} />
          <Button className="sl-f-clear" icon={<SearchOutlined />} onClick={applySearch}>بحث</Button>
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={resetFilters}>مسح</Button>
        </>)}
      >
        <Table
          className="sl-table"
          dataSource={suppliers}
          columns={tableCols.columns}
          rowKey="id"
          loading={loading}
          size="small"
          tableLayout="fixed"
          expandable={{ expandedRowRender: expandedRow }}
          pagination={{
            defaultPageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS,
            locale: { items_per_page: '' },
            showTotal: () => footer,
          }}
          onRow={(record) => ({
            onClick: () => navigate(`/suppliers/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </ListPage>

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
                  options={activeOptions(branches)}
                  filterOption={searchFilter} filterSort={searchRank} />
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
                  filterOption={searchFilter} filterSort={searchRank} />
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

          <Divider orientation="right" style={{ margin: '8px 0' }}>إضافات تكنو ثيرم</Divider>
          <ExtraPhonesList />

          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setDrawerVisible(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

    </>
  );
}

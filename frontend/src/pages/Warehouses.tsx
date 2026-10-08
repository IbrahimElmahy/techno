import React, { useEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Button, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, message
} from 'antd';
import {
  PlusOutlined, EditOutlined, StopOutlined, SearchOutlined, ReloadOutlined, TeamOutlined,
  DeleteOutlined, ExclamationCircleOutlined, EyeOutlined, HomeOutlined, ClearOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import ListPage from '../components/ListPage';
import { numeralsLocale } from '../utils/money';
import { activeOptions } from '../utils/active';

interface WarehouseRecord {
  id: number;
  name: string;
  warehouse_type: 'central' | 'branch';
  branch_id: number | null;
  description: string | null;
  active: boolean;
}

interface EmployeeRecord {
  id: number;
  code: string;
  name: string;
  job_title: string | null;
  warehouse_id: number | null;
  user_id: number | null;
}

interface CustomerRecord {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  rep_id: number;
}

const TYPE_LABELS: Record<string, string> = {
  central: 'مركزي',
  branch: 'فرعي',
};

export default function Warehouses() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState<WarehouseRecord[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRecord | null>(null);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [repsFor, setRepsFor] = useState<WarehouseRecord | null>(null);
  const [repsDraft, setRepsDraft] = useState<number[]>([]);
  const [customersFor, setCustomersFor] = useState<EmployeeRecord | null>(null);
  const [repCustomers, setRepCustomers] = useState<CustomerRecord[]>([]);
  const [customerSearch, setCustomerSearch] = useState<CustomerRecord[]>([]);
  const [customerDraft, setCustomerDraft] = useState<number[]>([]);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const editingBranch = Form.useWatch('branch_id', editForm) as number | undefined;

  const canWrite = can('warehouse.write');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [wh, br, emp] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/branches'),
        api.get('/api/v1/employees', { params: { active: true } }),
      ]);
      setRows(wh.data);
      setBranches(br.data);
      setEmployees(emp.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const repsOf = (warehouseId: number) =>
    employees.filter((e) => e.warehouse_id === warehouseId);

  const saveReps = async () => {
    if (!repsFor) return;
    try {
      await api.put(`/api/v1/warehouses/${repsFor.id}/reps`, { employee_ids: repsDraft });
      message.success('تم حفظ مندوبي المخزن');
      setRepsFor(null);
      await fetchAll();
    } catch (err) {
      console.error(err);
    }
  };

  const openReps = (record: WarehouseRecord) => {
    setRepsFor(record);
    setRepsDraft(repsOf(record.id).map((e) => e.id));
  };

  const openCustomers = async (emp: EmployeeRecord) => {
    setCustomersFor(emp);
    setCustomerDraft([]);
    setCustomerSearch([]);
    if (!emp.user_id) return;
    try {
      const res = await api.get('/api/v1/customers', { params: { rep_id: emp.user_id } });
      setRepCustomers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const searchCustomers = async (q: string) => {
    if (!q.trim()) { setCustomerSearch([]); return; }
    try {
      const res = await api.get('/api/v1/customers', { params: { q: q.trim() } });
      setCustomerSearch(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const saveCustomers = async () => {
    if (!customersFor?.user_id || !customerDraft.length) { setCustomersFor(null); return; }
    try {
      await api.post('/api/v1/customers/assign-rep', {
        rep_id: customersFor.user_id, customer_ids: customerDraft,
      });
      message.success(`تم إسناد ${customerDraft.length} عميل إلى المندوب`);
      setCustomersFor(null);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  useScreenShortcuts({
    onNew: canWrite ? () => setCreateOpen(true) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onClose: () => { setCreateOpen(false); },
  });


  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || '-';

  const filtered = rows.filter((w) => {
    const q = search.trim();
    if (!q) return true;
    return [String(w.id), w.name, branchName(w.branch_id), w.description || '']
      .some((v) => v.includes(q));
  });

  const onCreate = async (values: any) => {
    try {
      await api.post('/api/v1/warehouses', {
        name: values.name,
        branch_id: values.branch_id ?? null,
        description: values.description || null,
        warehouse_type: values.warehouse_type,
      });
      message.success('تم تسجيل المخزن');
      setCreateOpen(false);
      form.resetFields();
      fetchAll();
    } catch (err) {
      console.error(err);
    }
  };

  const onEdit = async (values: any) => {
    if (!editing) return;
    try {
      await api.patch(`/api/v1/warehouses/${editing.id}`, {
        name: values.name,
        branch_id: values.branch_id ?? null,
        description: values.description || null,
        warehouse_type: values.warehouse_type,
      });
      message.success('تم تعديل المخزن');
      setEditing(null);
      fetchAll();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (record: WarehouseRecord) => {
    setEditing(record);
    editForm.setFieldsValue(record);
  };

  const onDeactivate = (record: WarehouseRecord) => {
    showDeactivationConfirm({
      title: 'إخفاء المخزن',
      content: `هل أنت متأكد من إخفاء "${record.name}"؟ لن يظهر في اختيارات العمليات الجديدة، `
        + 'وتظل حركاته السابقة كما هي.',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/warehouses/${record.id}`);
          message.success('تم إخفاء المخزن');
          fetchAll();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const onActivate = async (record: WarehouseRecord) => {
    try {
      await api.patch(`/api/v1/warehouses/${record.id}`, { active: true });
      message.success(`أُعيد إظهار «${record.name}» في القوائم`);
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إظهار المخزن');
    }
  };

  const onDelete = (record: WarehouseRecord) => {
    Modal.confirm({
      title: `حذف المخزن ${record.name}`,
      icon: <ExclamationCircleOutlined />,
      okText: 'حذف نهائي',
      okButtonProps: { danger: true },
      cancelText: 'إلغاء',
      content: (
        <span>
          سيُحذف المخزن من النظام نهائياً ولا يمكن التراجع.
          <br />
          إن كانت عليه أي حركة فسيرفض النظام الحذف ويبيّن السبب، وعندها استخدم «إخفاء».
        </span>
      ),
      onOk: async () => {
        try {
          await api.delete(`/api/v1/warehouses/${record.id}`, { params: { hard: true } });
          message.success('تم حذف المخزن');
          fetchAll();
        } catch (err: any) {
          message.error(err?.response?.data?.detail?.message ?? 'تعذّر حذف المخزن', 8);
        }
      },
    });
  };

  const columns = [
    {
      title: 'رقم',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      render: (id: number) => <Tag>{id}</Tag>,
    },
    {
      title: 'الاسم',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: WarehouseRecord) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{name}</span>
          {!record.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ),
    },
    {
      title: 'الفرع',
      dataIndex: 'branch_id',
      key: 'branch_id',
      ellipsis: true,
      render: (id: number | null) => branchName(id),
    },
    {
      title: 'وصف',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'النوع',
      dataIndex: 'warehouse_type',
      key: 'warehouse_type',
      width: 100,
      render: (t: string) => (
        <Tag color={t === 'central' ? 'blue' : 'default'}>{TYPE_LABELS[t] || t}</Tag>
      ),
    },
    {
      title: 'المناديب',
      key: 'reps',
      width: 110,
      render: (_: any, record: WarehouseRecord) => {
        const n = repsOf(record.id).length;
        return n ? <Tag color="blue">{n}</Tag> : <span style={{ color: '#555b65' }}>—</span>;
      },
    },
    ...(canWrite ? [{
      title: '',
      key: 'actions',
      width: 120,
      render: (_: any, record: WarehouseRecord) => (
        <Space size={2}>
          <Tooltip title="مناديب المخزن">
            <Button type="text" icon={<TeamOutlined />} onClick={() => openReps(record)} />
          </Tooltip>
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          {record.active ? (
            <Tooltip title="إخفاء">
              <Button type="text" icon={<StopOutlined />} onClick={() => onDeactivate(record)} />
            </Tooltip>
          ) : (
            <Tooltip title="إظهار">
              <Button type="text" style={{ color: '#6AB42D' }} icon={<EyeOutlined />}
                onClick={() => onActivate(record)} />
            </Tooltip>
          )}
          <Tooltip title="حذف نهائي">
            <Button type="text" danger icon={<DeleteOutlined />}
              onClick={() => onDelete(record)} />
          </Tooltip>
        </Space>
      ),
    }] : []),
  ];

  const tableCols = useTableColumns('warehouses', columns, {
    export: { name: 'المخازن', rows: filtered },
  });

  const expandedRow = (record: WarehouseRecord) => {
    const mine = repsOf(record.id);
    if (!mine.length) {
      return <span style={{ color: '#888' }}>لا يوجد مندوبون على هذا المخزن.</span>;
    }
    return (
      <Space size={8} wrap style={{ paddingInlineStart: 8 }}>
        {mine.map((e) => (
          <Button key={e.id} size="small" type={e.user_id ? 'default' : 'text'}
            icon={<TeamOutlined />}
            disabled={!canWrite || !e.user_id}
            onClick={() => openCustomers(e)}
          >
            {e.name}
            {e.job_title ? ` · ${e.job_title}` : ''}
            {!e.user_id && ' · بدون مستخدم'}
          </Button>
        ))}
      </Space>
    );
  };

  const formFields = (
    <>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="branch_id" label="الفرع">
            <Select allowClear showSearch placeholder="اختر الفرع"
              options={activeOptions(branches, editingBranch)}
              filterOption={searchFilter} filterSort={searchRank} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="name" label="الاسم"
            rules={[{ required: true, message: 'اكتب اسم المخزن' }]}>
            <Input placeholder="مثال: مخزن السيارة أ" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="description" label="وصف">
        <Input.TextArea rows={3} maxLength={300}
          placeholder="مثال: مخزن سيارة المندوب، بضاعة الطريق" />
      </Form.Item>
      <Form.Item name="warehouse_type" label="النوع" rules={[{ required: true }]}>
        <Select options={[
          { value: 'central', label: 'مركزي' },
          { value: 'branch', label: 'فرعي' },
        ]} />
      </Form.Item>
    </>
  );

  const kb = useTableKeyboard<WarehouseRecord>({
    rows: filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  return (
    <>
      <ListPage
        icon={<HomeOutlined />}
        title="المخازن"
        actions={(<>
          {canWrite && (
            <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} className="sl-create"
              onClick={() => setCreateOpen(true)}>
              مخزن جديد
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>إعادة تحميل</Button>
          {tableCols.control}
        </>)}
        filters={(<>
          <Input className="sl-f-search" allowClear value={search}
            placeholder="بحث بالاسم أو الفرع أو الوصف"
            ref={searchRef}
            prefix={<SearchOutlined />} onChange={(e) => setSearch(e.target.value)} />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={() => setSearch('')}>مسح</Button>
        </>)}
      >
        <Table
          {...kb.tableProps}
          className="sl-table"
          dataSource={filtered}
          columns={tableCols.columns}
          rowKey="id"
          loading={loading}
          size="small"
          tableLayout="fixed"
          expandable={{ expandedRowRender: expandedRow }}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true,
            locale: { items_per_page: '' },
            showTotal: (t) => (
              <span className="sl-foot">
                <span>إجمالي المخازن: <b>{t.toLocaleString(numeralsLocale())}</b></span>
              </span>
            ) }}
        />
      </ListPage>

      <TabModal footer={null} centered title="مخزن جديد" width={640} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}
          initialValues={{ warehouse_type: 'branch' }}>
          {formFields}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

      <TabModal footer={null} centered title="تعديل المخزن" width={640} destroyOnHidden
        open={!!editing} onCancel={() => setEditing(null)}>
        <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
          {formFields}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setEditing(null)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

      <TabModal centered destroyOnHidden width={620}
        title={`مناديب المخزن — ${repsFor?.name ?? ''}`}
        open={!!repsFor}
        onCancel={() => setRepsFor(null)}
        onOk={saveReps}
        okText="حفظ"
        cancelText="تراجع"
      >
        <Select showSearch
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="اختر الموظفين"
          value={repsDraft}
          onChange={setRepsDraft}
          options={employees.map((e) => ({
            value: e.id,
            label: [
              e.name,
              e.job_title || null,
              e.warehouse_id && e.warehouse_id !== repsFor?.id
                ? `حالياً: ${rows.find((w) => w.id === e.warehouse_id)?.name ?? '—'}`
                : null,
              e.user_id ? null : 'بدون مستخدم',
            ].filter(Boolean).join(' · '),
          }))} filterOption={searchFilter} filterSort={searchRank} />
      </TabModal>

      <TabModal centered destroyOnHidden width={620}
        title={`عملاء المندوب — ${customersFor?.name ?? ''}`}
        open={!!customersFor}
        onCancel={() => setCustomersFor(null)}
        onOk={saveCustomers}
        okText="إسناد"
        okButtonProps={{ disabled: !customerDraft.length }}
        cancelText="تراجع"
      >
        {!customersFor?.user_id ? (
          <p>لا يوجد مستخدم لهذا الموظف، فلا يمكن إسناد عملاء إليه. اربطه بمستخدم من شاشة الموظفين أولاً.</p>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <strong>عملاؤه حالياً ({repCustomers.length})</strong>
              <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 8 }}>
                {repCustomers.length === 0
                  ? <span style={{ color: '#888' }}>لم يُسند إليه عملاء بعد.</span>
                  : (
                    <Space size={4} wrap>
                      {repCustomers.map((c) => (
                        <Tag key={c.id}>{c.name}</Tag>
                      ))}
                    </Space>
                  )}
              </div>
            </div>
            <strong>إضافة عملاء</strong>
            <Select
              mode="multiple"
              style={{ width: '100%', marginTop: 8 }}
              placeholder="ابحث بالاسم أو الكود أو الهاتف"
              value={customerDraft}
              onChange={setCustomerDraft}
              onSearch={searchCustomers}
              filterOption={false}
              notFoundContent={null}
              options={customerSearch.map((c) => ({
                value: c.id,
                label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}`
                  + (c.rep_id === customersFor?.user_id ? ' · مُسند إليه بالفعل' : ''),
                disabled: c.rep_id === customersFor?.user_id,
              }))}
            />
          </>
        )}
      </TabModal>
    </>
  );
}

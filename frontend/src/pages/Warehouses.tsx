import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Card, Col, Form, Input, Row, Select, Space, Table, Tag, Tooltip, message
} from 'antd';
import {
  PlusOutlined, EditOutlined, StopOutlined, SearchOutlined, ReloadOutlined, TeamOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

/** المخازن — their `/stores`, its own screen at last.
 *
 * This one carried no missing fields: `Warehouse` already had name, branch and description. What
 * it was missing was a door. It lived as the third tab of `/org`, which meant anyone arriving from
 * their system looked for المخازن in the menu, found a page called «الهيكل التنظيمي», and had to
 * be told where to click. A menu entry is a screen — that is the whole of this change.
 */

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
  // NULL means on the payroll with no login. Such a person can hold stock but can own no
  // customers, because «المندوب» on a customer is a login — so the screen says so rather than
  // offering a name that silently serves no one.
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
  const { user } = useAuth();
  const [rows, setRows] = useState<WarehouseRecord[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRecord | null>(null);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  // The store whose reps are being edited, and the ids picked so far. Held as a draft so closing
  // without saving changes nothing — assigning reps moves them off other stores, which is not a
  // thing to do one careless click at a time.
  const [repsFor, setRepsFor] = useState<WarehouseRecord | null>(null);
  const [repsDraft, setRepsDraft] = useState<number[]>([]);
  // The rep whose customers are being edited: his current ones, the search results to pick from,
  // and the picks not yet saved.
  const [customersFor, setCustomersFor] = useState<EmployeeRecord | null>(null);
  const [repCustomers, setRepCustomers] = useState<CustomerRecord[]>([]);
  const [customerSearch, setCustomerSearch] = useState<CustomerRecord[]>([]);
  const [customerDraft, setCustomerDraft] = useState<number[]>([]);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const canWrite = ['system_admin', 'branch_manager'].includes(user?.role || '');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [wh, br, emp] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/branches'),
        // Reps come from الموظفين, not from logins: the payroll is where who-drives-which-van is
        // already recorded, and `employee.warehouse_id` has held that answer all along.
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

  // Saving the list is also how somebody comes off it — the endpoint owns the set. Naming an
  // employee here MOVES him: one person, one store, so whatever store he was on stops being his.
  const saveReps = async () => {
    if (!repsFor) return;
    try {
      await api.put(`/api/v1/warehouses/${repsFor.id}/reps`, { employee_ids: repsDraft });
      message.success('اتحفظ مناديب المخزن');
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

  // ---- عملاء المندوب ----------------------------------------------------------------
  // The third rung of the ladder the whole screen is: store → its reps → their customers.

  const openCustomers = async (emp: EmployeeRecord) => {
    setCustomersFor(emp);
    setCustomerDraft([]);
    setCustomerSearch([]);
    if (!emp.user_id) return;   // no login, no customers — the modal says so instead
    try {
      const res = await api.get('/api/v1/customers', { params: { rep_id: emp.user_id } });
      setRepCustomers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  // Searched on the server rather than loading every customer: a rep's own list is short, but the
  // list he might be given from is the whole book.
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
      message.success(`اتسند ${customerDraft.length} عميل للمندوب`);
      setCustomersFor(null);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // F2 opens the form, F3 jumps to search, Esc closes — the same keys on every screen, so the
  // habit carries from one to the next instead of being relearned per page.
  useScreenShortcuts({
    onNew: canWrite ? () => setCreateOpen(true) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onClose: () => { setCreateOpen(false); },
  });


  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || '-';

  // Search is over the loaded list: a company has tens of stores, not thousands, so a round trip
  // per keystroke would buy nothing.
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
        // Their form has no type. Ours does, and it drives real behaviour, so it is asked for
        // rather than guessed — but it sits after their three fields, not among them.
        warehouse_type: values.warehouse_type,
      });
      message.success('اتسجّل المخزن');
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
      message.success('اتعدّل المخزن');
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

  // Their four columns, in their order: `رقم · الاسم · الفرع · وصف`.
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
    // Ours: the type genuinely branches logic, so it stays on the row rather than in a fold.
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
        return n ? <Tag color="blue">{n}</Tag> : <span style={{ color: '#bbb' }}>—</span>;
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
          {record.active && (
            <Tooltip title="إخفاء">
              <Button type="text" icon={<StopOutlined />} onClick={() => onDeactivate(record)} />
            </Tooltip>
          )}
        </Space>
      ),
    }] : []),
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('warehouses', columns);

  // Opening a store shows who works out of it — the answer to «مين بيبيع من المخزن ده».
  const expandedRow = (record: WarehouseRecord) => {
    const mine = repsOf(record.id);
    if (!mine.length) {
      return <span style={{ color: '#888' }}>مفيش مناديب على المخزن ده.</span>;
    }
    return (
      <Space size={8} wrap style={{ paddingInlineStart: 8 }}>
        {mine.map((e) => (
          <Button key={e.id} size="small" type={e.user_id ? 'default' : 'text'}
            icon={<TeamOutlined />}
            // Clicking a rep opens his customers — the third rung of the ladder this screen is:
            // store → its reps → their customers.
            disabled={!canWrite || !e.user_id}
            onClick={() => openCustomers(e)}
          >
            {e.name}
            {e.job_title ? ` · ${e.job_title}` : ''}
            {/* No login means no customer can point at him — say it here rather than let
                somebody wonder why he never appears on an invoice. */}
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
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
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

  // السطر يفتح التعديل — البيانات الأساسية مافيهاش «عرض» غير الفورم بتاعها نفسه.
  const kb = useTableKeyboard<WarehouseRecord>({
    rows: filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  return (
    <div>
      <Card
        title="المخازن"
        extra={
          <Space>
            {tableCols.control}
            <Button icon={<ReloadOutlined />} onClick={fetchAll}>اعادة تحميل</Button>
            {canWrite && (
              <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                مخزن جديد
              </Button>
            )}
          </Space>
        }
      >
        <Row style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Input allowClear value={search} placeholder="بحث بالاسم أو الفرع أو الوصف"
              ref={searchRef}
              prefix={<SearchOutlined />} onChange={(e) => setSearch(e.target.value)} />
          </Col>
        </Row>

        <Table
          {...kb.tableProps}
          dataSource={filtered}
          columns={tableCols.columns}
          rowKey="id"
          loading={loading}
          size="middle"
          tableLayout="fixed"
          expandable={{ expandedRowRender: expandedRow }}
          pagination={{ defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

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

      {/* مناديب المخزن — picked from الموظفين. Saving owns the list: whoever is ticked works out
          of this store, whoever is not comes off it. */}
      <TabModal centered destroyOnHidden width={620}
        title={`مناديب المخزن — ${repsFor?.name ?? ''}`}
        open={!!repsFor}
        onCancel={() => setRepsFor(null)}
        onOk={saveReps}
        okText="حفظ"
        cancelText="تراجع"
      >
        <p style={{ color: '#888' }}>
          الموظف له مخزن واحد — لو كان على مخزن تاني هيتنقل لهنا. وشيل العلامة معناه إنه يخرج من
          المخزن ده.
        </p>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="اختر الموظفين"
          value={repsDraft}
          onChange={setRepsDraft}
          optionFilterProp="label"
          options={employees.map((e) => ({
            value: e.id,
            // The current store is on the label so moving somebody is a visible act, not a
            // surprise discovered later on another screen.
            label: [
              e.name,
              e.job_title || null,
              e.warehouse_id && e.warehouse_id !== repsFor?.id
                ? `حالياً: ${rows.find((w) => w.id === e.warehouse_id)?.name ?? '—'}`
                : null,
              e.user_id ? null : 'بدون مستخدم',
            ].filter(Boolean).join(' · '),
          }))}
        />
      </TabModal>

      {/* عملاء المندوب — who this rep may work with and sell to. */}
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
          <p>الموظف ده مالوش مستخدم، فمش ممكن يتسند له عملاء. اربطه بمستخدم من شاشة الموظفين الأول.</p>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <strong>عملاؤه حالياً ({repCustomers.length})</strong>
              <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 8 }}>
                {repCustomers.length === 0
                  ? <span style={{ color: '#888' }}>لسه مفيش عملاء مسندين له.</span>
                  : (
                    <Space size={4} wrap>
                      {repCustomers.map((c) => (
                        <Tag key={c.id}>{c.name}</Tag>
                      ))}
                    </Space>
                  )}
              </div>
            </div>
            {/* A customer always has exactly one rep, so this adds — and adding TAKES the customer
                from whoever had him. Moving him back is the same act from the other rep's side,
                which is why there is no «remove» here that would leave a customer with nobody. */}
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
                label: `${c.name} · ${c.code}${c.phone ? ` · ${c.phone}` : ''}`
                  + (c.rep_id === customersFor?.user_id ? ' · عنده بالفعل' : ''),
                disabled: c.rep_id === customersFor?.user_id,
              }))}
            />
            <p style={{ color: '#888', marginTop: 8 }}>
              العميل له مندوب واحد — إسناده هنا معناه إنه بيخرج من عند مندوبه القديم.
            </p>
          </>
        )}
      </TabModal>
    </div>
  );
}

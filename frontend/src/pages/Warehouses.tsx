import React, { useEffect, useState } from 'react';
import {
  Button, Card, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import {
  PlusOutlined, EditOutlined, StopOutlined, SearchOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';

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
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRecord | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const canWrite = ['system_admin', 'branch_manager'].includes(user?.role || '');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [wh, br] = await Promise.all([
        api.get('/api/v1/warehouses'),
        api.get('/api/v1/branches'),
      ]);
      setRows(wh.data);
      setBranches(br.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

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
    ...(canWrite ? [{
      title: '',
      key: 'actions',
      width: 90,
      render: (_: any, record: WarehouseRecord) => (
        <Space size={2}>
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

  return (
    <div>
      <Card
        title="المخازن"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchAll}>اعادة تحميل</Button>
            {canWrite && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                مخزن جديد
              </Button>
            )}
          </Space>
        }
      >
        <Row style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Input allowClear value={search} placeholder="بحث بالاسم أو الفرع أو الوصف"
              prefix={<SearchOutlined />} onChange={(e) => setSearch(e.target.value)} />
          </Col>
        </Row>

        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          tableLayout="fixed"
          pagination={{ defaultPageSize: 10, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

      <Modal footer={null} centered title="مخزن جديد" width={640} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}
          initialValues={{ warehouse_type: 'branch' }}>
          {formFields}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </Modal>

      <Modal footer={null} centered title="تعديل المخزن" width={640} destroyOnHidden
        open={!!editing} onCancel={() => setEditing(null)}>
        <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
          {formFields}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setEditing(null)}>تراجع</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}

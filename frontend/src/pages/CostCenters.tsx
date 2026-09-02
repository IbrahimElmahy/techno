import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Card, Col, Form, Input, Row, Select, Space, Table, Tag, Tooltip, message
} from 'antd';
import {
  PlusOutlined, StopOutlined, SearchOutlined, ReloadOutlined, EditOutlined, CheckOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import { CostCenter } from '../utils/accounts';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

export default function CostCenters() {
  const { user } = useAuth();
  const [rows, setRows] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const canWrite = ['system_admin', 'accountant'].includes(user?.role || '');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/cost-centers');
      setRows(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useScreenShortcuts({
    onNew: canWrite ? () => setCreateOpen(true) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onClose: () => { setCreateOpen(false); setEditing(null); },
  });


  const parentName = (id: number | null) => {
    if (!id) return '-';
    const p = rows.find((c) => c.id === id);
    return p ? p.name : `#${id}`;
  };

  const filtered = rows.filter((c) => {
    const q = search.trim();
    if (!q) return true;
    return [c.code, c.name, parentName(c.parent_id)].some((v) => (v || '').includes(q));
  });

  const onCreate = async (v: any) => {
    try {
      await api.post('/api/v1/cost-centers', {
        code: v.code, name: v.name, parent_id: v.parent_id ?? null,
      });
      message.success('تم تسجيل مركز التكلفة');
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [editForm] = Form.useForm();

  const openEdit = (r: CostCenter) => {
    setEditing(r);
    editForm.setFieldsValue({ name: r.name });
  };

  const onEdit = async (v: any) => {
    if (!editing) return;
    try {
      await api.patch(`/api/v1/cost-centers/${editing.id}`, { name: v.name });
      message.success('اتعدّل مركز التكلفة');
      setEditing(null);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تعديل مركز التكلفة');
    }
  };

  const onDeactivate = (r: CostCenter) => {
    showReversalConfirm({
      title: 'تعطيل مركز التكلفة',
      content: `هل تريد تعطيل «${r.name}»؟ لن يُحذف؛ تبقى الحركات التاريخية موسومة به ولا يمكن `
        + 'اختياره لقيود جديدة.',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/cost-centers/${r.id}`);
          message.success('تم التعطيل');
          load();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const onReactivate = async (r: CostCenter) => {
    try {
      await api.patch(`/api/v1/cost-centers/${r.id}`, { active: true });
      message.success('تم إعادة تنشيط مركز التكلفة');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إعادة تنشيط مركز التكلفة');
    }
  };

  const kb = useTableKeyboard<CostCenter>({
    rows: filtered, rowKey: (r) => r.id,
    onOpen: canWrite ? (r) => openEdit(r) : undefined,
  });

  const columns = [
    {
      title: 'رقم',
      dataIndex: 'code',
      key: 'code',
      width: 140,
      render: (c: string) => <Tag color="geekblue">{c}</Tag>,
    },
    {
      title: 'الاسم',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (n: string, r: CostCenter) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{n}</span>
          {!r.active && <Tag color="red">معطّل</Tag>}
        </Space>
      ),
    },
    {
      title: 'مستوي مركز التكلفة',
      dataIndex: 'level',
      key: 'level',
      width: 160,
      render: (l: number | undefined) => <Tag>{l ?? 1}</Tag>,
    },
    {
      title: 'المركز التابع له',
      dataIndex: 'parent_id',
      key: 'parent_id',
      ellipsis: true,
      render: (id: number | null) => parentName(id),
    },
    ...(canWrite ? [{
      title: '',
      key: 'actions',
      width: 92,
      render: (_: any, r: CostCenter) => (
        <Space size={0}>
          <Tooltip title="تعديل الاسم">
            <Button type="text" icon={<EditOutlined />}
              onClick={(e) => { e.stopPropagation(); openEdit(r); }} />
          </Tooltip>
          {r.active ? (
            <Tooltip title="تعطيل">
              <Button type="text" danger icon={<StopOutlined />}
                onClick={(e) => { e.stopPropagation(); onDeactivate(r); }} />
            </Tooltip>
          ) : (
            <Tooltip title="إعادة تنشيط">
              <Button type="text" icon={<CheckOutlined />}
                onClick={(e) => { e.stopPropagation(); onReactivate(r); }} />
            </Tooltip>
          )}
        </Space>
      ),
    }] : []),
  ];

  const tableCols = useTableColumns('cost-centers', columns, {
    export: { name: 'مراكز التكلفة', rows: filtered },
  });

  return (
    <div>
      <Card
        title="مراكز التكلفة"
        extra={
          <Space>
            {tableCols.control}
            <Button icon={<ReloadOutlined />} onClick={load}>اعادة تحميل</Button>
            {canWrite && (
              <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                مركز جديد
              </Button>
            )}
          </Space>
        }
      >
        <Row style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Input allowClear value={search} placeholder="بحث بالاسم أو الكود أو المركز الأب"
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
          locale={{ emptyText: 'لا توجد مراكز تكلفة' }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

      <TabModal footer={null} centered title="مركز تكلفة جديد" width={620} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item name="parent_id" label="المركز التابع له"
                extra="سيبه فاضي = مركز في المستوى الأول">
                <Select allowClear showSearch placeholder="بدون (مستوى ١)"
                  optionFilterProp="label"
                  options={rows.filter((c) => c.active).map((c) => ({
                    value: c.id, label: `${c.name} · مستوى ${c.level ?? 1}`,
                  }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="name" label="الاسم"
                rules={[{ required: true, message: 'اكتب اسم المركز' }]}>
                <Input placeholder="مثال: خط الإنتاج أ" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="code" label="الكود"
                rules={[{ required: true, message: 'اكتب كود المركز' }]}>
                <Input placeholder="مثال: CC-01" />
              </Form.Item>
            </Col>
          </Row>
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

      <TabModal footer={null} centered width={520} destroyOnHidden
        title={editing ? `تعديل «${editing.name}»` : 'تعديل مركز تكلفة'}
        open={!!editing} onCancel={() => setEditing(null)}>
        {editing && (
          <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="الكود"
                  extra="الكود لا يتغيّر — فقد سُجّلت عليه القيود.">
                  <Input value={editing.code} disabled />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="المركز التابع له"
                  extra="يُحتسب المستوى منه، فلا يتغيّر بعد الإنشاء.">
                  <Input value={parentName(editing.parent_id)} disabled />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="name" label="الاسم"
              rules={[{ required: true, message: 'اكتب اسم المركز' }]}>
              <Input placeholder="مثال: خط الإنتاج أ" />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">حفظ</Button>
              <Button onClick={() => setEditing(null)}>تراجع</Button>
            </Space>
          </Form>
        )}
      </TabModal>
    </div>
  );
}

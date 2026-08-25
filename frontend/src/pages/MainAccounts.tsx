import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Card, Col, Form, Input, Row, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import {
  APPEARS_IN_LABEL, ChartAccount, MAIN_LEVELS, NATURE_COLOR, NATURE_LABEL, egp,
} from '../utils/accounts';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import { normalizeAr } from '../components/ListToolbar';

export default function MainAccounts() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ChartAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ChartAccount | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const canWrite = ['system_admin', 'accountant'].includes(user?.role || '');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/accounts');
      setRows(res.data.filter((a: ChartAccount) => !a.is_postable));
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
    onClose: () => { setCreateOpen(false); },
  });

  const filtered = rows.filter((a) => {
    const q = normalizeAr(search);
    if (!q) return true;
    return [a.code, a.name, a.main_level, NATURE_LABEL[a.nature || '']]
      .some((v) => normalizeAr(v).includes(q));
  });

  const onCreate = async (v: any) => {
    try {
      await api.post('/api/v1/accounts', {
        code: v.code,
        name: v.name,
        nature: v.nature,
        is_postable: false,
        parent_id: v.parent_id ?? null,
        appears_in: v.appears_in ?? null,
        main_level: (Array.isArray(v.main_level) ? v.main_level[0] : v.main_level) || null,
      });
      message.success('اتسجّل الحساب الرئيسي');
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const onEdit = async (v: any) => {
    if (!editing) return;
    try {
      await api.patch(`/api/v1/accounts/${editing.id}`, {
        name: v.name,
        appears_in: v.appears_in ?? null,
        main_level: (Array.isArray(v.main_level) ? v.main_level[0] : v.main_level) || null,
      });
      message.success('اتعدّل الحساب');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const removeAccount = async (record: ChartAccount) => {
    try {
      await api.delete(`/api/v1/accounts/${record.id}`);
      message.success('اتقفل الحساب');
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (record: ChartAccount) => {
    setEditing(record);
    editForm.setFieldsValue({
      ...record,
      main_level: record.main_level ? [record.main_level] : undefined,
    });
  };

  const columns = [
    {
      title: 'رقم',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      render: (c: string | null) => c ? <Tag color="blue">{c}</Tag> : '-',
    },
    {
      title: 'الاسم',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (n: string | null, r: ChartAccount) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{n || '-'}</span>
          {r.is_system && <Tag color="purple">نظام</Tag>}
          {!r.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ),
    },
    {
      title: 'نوع الحساب',
      dataIndex: 'nature',
      key: 'nature',
      width: 120,
      render: (n: string | null) =>
        n ? <Tag color={NATURE_COLOR[n]}>{NATURE_LABEL[n]}</Tag> : '-',
    },
    {
      title: 'المستوى الرئيسي',
      dataIndex: 'main_level',
      key: 'main_level',
      ellipsis: true,
      render: (m: string | null) => m || '-',
    },
    {
      title: 'يظهر في',
      dataIndex: 'appears_in',
      key: 'appears_in',
      width: 140,
      render: (a: string | null) => (a && APPEARS_IN_LABEL[a]
        ? <Tag color="geekblue">{APPEARS_IN_LABEL[a]}</Tag>
        : <span style={{ color: '#8c8c8c' }}>حسب الطبيعة</span>),
    },
    {
      title: 'الرصيد',
      dataIndex: 'balance',
      key: 'balance',
      width: 130,
      align: 'left' as const,
      render: (b: string) => <strong>{egp(b)}</strong>,
    },
    ...(canWrite ? [{
      title: '',
      key: 'actions',
      width: 96,
      render: (_: any, record: ChartAccount) => (
        <Space size={0}>
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} disabled={record.is_system}
              onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm
            title="تقفل الحساب؟"
            description="بيتقفل مش بيتمسح — اسمه بيفضل مقروء على القيود اللي اتكتبت عليه."
            okText="اقفل" cancelText="رجوع" okButtonProps={{ danger: true }}
            onConfirm={() => removeAccount(record)}
          >
            <Tooltip title="حذف (إقفال)">
              <Button type="text" danger icon={<DeleteOutlined />}
                disabled={record.is_system || !record.active} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  const tableCols = useTableColumns('main-accounts', columns);

  const formFields = (isCreate: boolean) => (
    <>
      <Row gutter={12}>
        <Col span={16}>
          <Form.Item name="name" label="الاسم"
            rules={[{ required: true, message: 'اكتب اسم الحساب' }]}>
            <Input placeholder="مثال: مصروفات مباشرة" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="main_level" label="المستوى الرئيسي">
            <Select allowClear showSearch placeholder="اختر أو اكتب"
              options={MAIN_LEVELS.map((l) => ({ value: l, label: l }))}
              mode="tags" maxCount={1}
              filterOption={(i, o) => String(o?.label ?? '').includes(i)} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item name="appears_in" label="يظهر في"
            extra="سيبه فاضي يتبع طبيعة الحساب">
            <Select allowClear placeholder="حسب الطبيعة"
              options={Object.entries(APPEARS_IN_LABEL)
                .map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="nature" label="نوع الحساب"
            rules={[{ required: isCreate, message: 'اختر نوع الحساب' }]}>
            <Select disabled={!isCreate} placeholder="اختر النوع"
              options={Object.entries(NATURE_LABEL)
                .map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="code" label="الكود"
            rules={[{ required: isCreate, message: 'اكتب كود الحساب' }]}>
            <Input disabled={!isCreate} placeholder="مثال: 5100" />
          </Form.Item>
        </Col>
      </Row>
    </>
  );

  const kb = useTableKeyboard<ChartAccount>({
    rows: filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  return (
    <div>
      <Card
        title="الحسابات الرئيسيه"
        extra={
          <Space>
            {tableCols.control}
            <Button icon={<ReloadOutlined />} onClick={load}>اعادة تحميل</Button>
            {canWrite && (
              <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                حساب رئيسي جديد
              </Button>
            )}
          </Space>
        }
      >
        <Row style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Input allowClear value={search} placeholder="بحث بالاسم أو الكود أو المستوى"
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
          pagination={{ defaultPageSize: 20, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

      <TabModal footer={null} centered title="حساب رئيسي جديد" width={720} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}>
          {formFields(true)}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

      <TabModal footer={null} centered title="تعديل الحساب الرئيسي" width={720} destroyOnHidden
        open={!!editing} onCancel={() => setEditing(null)}>
        <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
          {formFields(false)}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setEditing(null)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>
    </div>
  );
}

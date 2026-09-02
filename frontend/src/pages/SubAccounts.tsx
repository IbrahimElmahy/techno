import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Card, Col, Collapse, Empty, Form, Input, Row, Select, Skeleton, Space, Table, Tag, Tooltip, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, ReloadOutlined,
  EyeOutlined, EyeInvisibleOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { ChartAccount, NATURE_COLOR, NATURE_LABEL, egp } from '../utils/accounts';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import { normalizeAr } from '../components/ListToolbar';

function AccountGroup({ rows, columns, onOpen }: {
  rows: ChartAccount[];
  columns: any[];
  onOpen: (r: ChartAccount) => void;
}) {
  const kb = useTableKeyboard<ChartAccount>({
    rows, rowKey: (r) => r.id, onOpen,
  });
  return (
    <Table
      {...kb.tableProps}
      dataSource={rows}
      columns={columns}
      rowKey="id"
      size="small"
      tableLayout="fixed"
      pagination={rows.length > 25
        ? { defaultPageSize: 25, showSizeChanger: true, size: 'small',
            showTotal: (t: number) => `عدد: ${t}` }
        : false}
    />
  );
}

export default function SubAccounts() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ChartAccount[]>([]);
  const [groups, setGroups] = useState<ChartAccount[]>([]);
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
      setRows(res.data.filter((a: ChartAccount) => a.is_postable));
      setGroups(res.data.filter((a: ChartAccount) => !a.is_postable));
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

  const parentName = (r: ChartAccount) => {
    if (r.owner_group) return r.owner_group;
    if (!r.parent_id) return '-';
    const g = groups.find((a) => a.id === r.parent_id);
    return g ? (g.name || `#${g.id}`) : `#${r.parent_id}`;
  };

  const accountName = (r: ChartAccount) => r.name || r.owner_name || '-';

  const filtered = rows.filter((a) => {
    const q = normalizeAr(search);
    if (!q) return true;
    return [a.code, accountName(a), parentName(a)].some((v) => normalizeAr(v).includes(q));
  });

  const onCreate = async (v: any) => {
    const parent = groups.find((g) => g.id === v.parent_id);
    try {
      await api.post('/api/v1/accounts', {
        code: v.code,
        name: v.name,
        parent_id: v.parent_id ?? null,
        nature: parent?.nature ?? v.nature,
        is_postable: true,
      });
      message.success('تم تسجيل الحساب الفرعي');
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
      await api.patch(`/api/v1/accounts/${editing.id}`, { name: v.name });
      message.success('اتعدّل الحساب');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleActive = async (record: ChartAccount) => {
    try {
      await api.patch(`/api/v1/accounts/${record.id}`, { active: !record.active });
      message.success(record.active ? 'اتخفى من القوايم' : 'رجع يظهر في القوايم');
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
    editForm.setFieldsValue(record);
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
      title: 'الحساب الرئيسي',
      key: 'parent_id',
      ellipsis: true,
      render: (_: any, r: ChartAccount) => parentName(r),
    },
    {
      title: 'الاسم',
      key: 'name',
      ellipsis: true,
      render: (_: any, r: ChartAccount) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{accountName(r)}</span>
          {r.is_system && <Tag color="purple">نظام</Tag>}
          {!r.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ),
    },
    {
      title: 'النوع',
      dataIndex: 'nature',
      key: 'nature',
      width: 110,
      render: (n: string | null) =>
        n ? <Tag color={NATURE_COLOR[n]}>{NATURE_LABEL[n]}</Tag> : '-',
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
      width: 132,
      render: (_: any, record: ChartAccount) => (
        <Space size={0}>
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} disabled={record.is_system}
              onClick={() => openEdit(record)} />
          </Tooltip>
          <Tooltip title={record.active ? 'إخفاء من قوايم الاختيار' : 'إظهار في قوايم الاختيار'}>
            <Button type="text" disabled={record.is_system}
              icon={record.active ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => toggleActive(record)} />
          </Tooltip>
          <Popconfirm
            title="تقفل الحساب؟"
            description="يُغلق ولا يُحذف — ويبقى اسمه مقروءاً على القيود المسجّلة عليه."
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

  const formFields = (isCreate: boolean) => (
    <Row gutter={12}>
      <Col span={10}>
        <Form.Item name="parent_id" label="الحسابات الرئيسيه"
          rules={[{ required: isCreate, message: 'اختر الحساب الرئيسي' }]}>
          <Select showSearch disabled={!isCreate} placeholder="اختر الحساب الرئيسي"
            optionFilterProp="label"
            options={groups.map((g) => ({
              value: g.id,
              label: `${g.name || g.id}${g.nature ? ` · ${NATURE_LABEL[g.nature]}` : ''}`,
            }))} />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item name="name" label="الاسم"
          rules={[{ required: true, message: 'اكتب اسم الحساب' }]}>
          <Input placeholder="مثال: ايجار المركز الرئيسى" />
        </Form.Item>
      </Col>
      <Col span={6}>
        <Form.Item name="code" label="الكود"
          rules={[{ required: isCreate, message: 'اكتب كود الحساب' }]}>
          <Input disabled={!isCreate} placeholder="مثال: 5101" />
        </Form.Item>
      </Col>
    </Row>
  );

  const inSection = columns.filter((c: any) => c.key !== 'parent_id');
  // الشاشة بتقسّم الصفوف على جداول جوّه كل حساب رئيسي، والملف بياخدهم كلهم مرة واحدة —
  // فالصفوف هنا هي `filtered` نفسها مش صفوف قسم واحد.
  const tableCols = useTableColumns('sub-accounts', inSection, {
    export: { name: 'الحسابات الفرعيه', rows: filtered },
  });

  const sections = useMemo(() => {
    const byName = new Map<string, ChartAccount[]>();
    for (const r of filtered) {
      const k = parentName(r);
      const list = byName.get(k);
      if (list) list.push(r); else byName.set(k, [r]);
    }
    return [...byName.entries()]
      .map(([name, items]) => ({
        name,
        items,
        total: items.reduce((s, a) => s + Number(a.balance || 0), 0),
        hidden: items.filter((a) => !a.active).length,
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [filtered, groups]);

  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const searching = search.trim().length > 0;
  const activeKeys = searching ? sections.map((s) => s.name) : openKeys;

  return (
    <div>
      <Card
        title="الحسابات الفرعيه"
        extra={
          <Space>
            {tableCols.control}
            <Button icon={<ReloadOutlined />} onClick={load}>اعادة تحميل</Button>
            {canWrite && (
              <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                حساب فرعي جديد
              </Button>
            )}
          </Space>
        }
      >
        <Row style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Input allowClear value={search} placeholder="بحث بالاسم أو الكود أو الحساب الرئيسي"
              ref={searchRef}
              prefix={<SearchOutlined />} onChange={(e) => setSearch(e.target.value)} />
          </Col>
        </Row>

        {loading && <Skeleton active paragraph={{ rows: 4 }} />}
        {!loading && !sections.length && <Empty description="لا توجد حسابات مطابقة" />}

        <Collapse
          accordion={false}
          activeKey={activeKeys}
          onChange={(k) => setOpenKeys(Array.isArray(k) ? k : [k])}
          items={sections.map((s) => ({
            key: s.name,
            label: (
              <Space size={8} wrap>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <Tag>{s.items.length}</Tag>
                <span style={{ color: '#6b6b6b', fontSize: 12 }}>الإجمالي {egp(s.total)}</span>
                {s.hidden > 0 && <Tag color="red">{s.hidden} مخفي</Tag>}
              </Space>
            ),
            children: (
              <AccountGroup rows={s.items} columns={tableCols.columns} onOpen={openEdit} />
            ),
          }))}
        />
      </Card>

      <TabModal footer={null} centered title="حساب فرعي جديد" width={720} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}>
          {formFields(true)}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

      <TabModal footer={null} centered title="تعديل الحساب الفرعي" width={720} destroyOnHidden
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

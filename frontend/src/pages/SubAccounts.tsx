import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Card, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import {
  PlusOutlined, EditOutlined, SearchOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { ChartAccount, NATURE_COLOR, NATURE_LABEL, egp } from '../utils/accounts';

/** الحسابات الفرعيه — their `/subaccounts`, its own screen.
 *
 * A sub-account is the postable leaf: the thing entries actually land on. Their list is three
 * columns — `رقم · الحساب الرئيسي · الاسم` — and their form asks two questions, because at this
 * level the only real decision is which group it belongs under.
 */

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

  // F2 opens the form, F3 jumps to search, Esc closes — the same keys on every screen, so the
  // habit carries from one to the next instead of being relearned per page.
  useScreenShortcuts({
    onNew: canWrite ? () => setCreateOpen(true) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onClose: () => { setCreateOpen(false); },
  });


  // What this account sits under. Accounts opened for a customer or a supplier are filed by
  // their kind — «العملاء», «الموردين» — which is exactly how their own subaccounts screen reads.
  const parentName = (r: ChartAccount) => {
    if (r.owner_group) return r.owner_group;
    if (!r.parent_id) return '-';
    const g = groups.find((a) => a.id === r.parent_id);
    return g ? (g.name || `#${g.id}`) : `#${r.parent_id}`;
  };

  // An owner-derived account has no name of its own; the customer's name is its name.
  const accountName = (r: ChartAccount) => r.name || r.owner_name || '-';

  const filtered = rows.filter((a) => {
    const q = search.trim();
    if (!q) return true;
    return [a.code || '', accountName(a), parentName(a)].some((v) => v.includes(q));
  });

  const onCreate = async (v: any) => {
    const parent = groups.find((g) => g.id === v.parent_id);
    try {
      await api.post('/api/v1/accounts', {
        code: v.code,
        name: v.name,
        parent_id: v.parent_id ?? null,
        // A leaf inherits its group's nature. Asking again is asking for the answer that
        // contradicts the parent, and a customer account filed under expenses is a hole in every
        // statement that reads the tree.
        nature: parent?.nature ?? v.nature,
        is_postable: true,
      });
      message.success('اتسجّل الحساب الفرعي');
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

  const openEdit = (record: ChartAccount) => {
    setEditing(record);
    editForm.setFieldsValue(record);
  };

  // Their three columns, in their order: `رقم · الحساب الرئيسي · الاسم`.
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
    // Ours: on a postable account the balance IS the account, so it stays on the row.
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
      width: 60,
      render: (_: any, record: ChartAccount) => (
        <Tooltip title="تعديل">
          <Button type="text" icon={<EditOutlined />} disabled={record.is_system}
            onClick={() => openEdit(record)} />
        </Tooltip>
      ),
    }] : []),
  ];

  // Their two fields, plus the code. Their system numbers accounts for you; ours asks, because a
  // chart of accounts code carries a scheme the accountant owns and generating one would quietly
  // break their numbering.
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

  // السطر يفتح التعديل — البيانات الأساسية مافيهاش «عرض» غير الفورم بتاعها نفسه.
  const kb = useTableKeyboard<ChartAccount>({
    rows: filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  return (
    <div>
      <Card
        title="الحسابات الفرعيه"
        extra={
          <Space>
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

        <Table
          {...kb.tableProps}
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          tableLayout="fixed"
          pagination={{ defaultPageSize: 20, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

      <Modal footer={null} centered title="حساب فرعي جديد" width={720} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}>
          {formFields(true)}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </Modal>

      <Modal footer={null} centered title="تعديل الحساب الفرعي" width={720} destroyOnHidden
        open={!!editing} onCancel={() => setEditing(null)}>
        <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
          {formFields(false)}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setEditing(null)}>تراجع</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}

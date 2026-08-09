import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Card, Col, Collapse, Empty, Form, Input, Modal, Row, Select, Skeleton, Space, Table,
  Tag, Tooltip, message,
} from 'antd';
import {
  PlusOutlined, EditOutlined, SearchOutlined, ReloadOutlined,
  EyeOutlined, EyeInvisibleOutlined,
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
 *
 * كل قسم قائمة منسدلة، لأن الليستة الواحدة كانت عشوائية.
 *
 * Every postable account in the system used to arrive as one flat paginated list: a customer, then
 * a safe, then an expense, then four hundred more customers. Sorted by nothing anybody thinks in.
 * Somebody looking for an expense account paged through customers to find it, and the shape of the
 * chart — that customers outnumber everything else forty to one — was invisible.
 *
 * They are filed under their heading now, each heading collapsed until asked for, carrying its
 * count and its total on the bar. Closed is the useful default: the answer to «فيه إيه» is the
 * list of headings, not four hundred rows. Searching opens whatever matched, because a hit hidden
 * inside a closed section is the same as no hit.
 */

/**
 * قسم واحد — جدول جوّه القائمة المنسدلة.
 *
 * Its own component because the keyboard hook is a hook: one table per section means one call per
 * section, and hooks cannot be called in a loop. Each section keeps its own cursor, so ↑↓ walk the
 * section you opened rather than the whole chart.
 */
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
      // Paged inside the section: العملاء alone can be thousands of rows, and mounting them all
      // to show a heading nobody has expanded yet is what makes the screen crawl.
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

  /**
   * إخفاء / إظهار الحساب.
   *
   * `active` was rendered as a «مخفي» tag and could not be set from anywhere, so a chart of
   * accounts only ever grew. That is what makes the expense dropdown on سند مصروف unmanageable:
   * an account opened once by mistake stays in the list of every voucher forever. Hiding rather
   * than deleting, because entries already posted to it still have to resolve to a name.
   */
  const toggleActive = async (record: ChartAccount) => {
    try {
      await api.patch(`/api/v1/accounts/${record.id}`, { active: !record.active });
      message.success(record.active ? 'اتخفى من القوايم' : 'رجع يظهر في القوايم');
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
      width: 96,
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
        </Space>
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

  // «الحساب الرئيسي» is the section heading, so repeating it on every row inside the section is
  // the same word four hundred times.
  const inSection = columns.filter((c: any) => c.key !== 'parent_id');

  /** الأقسام — كل حساب رئيسي وتحته حساباته، ومعاه العدد والإجمالي. */
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
      // Biggest first. The chart is dominated by customer accounts and pretending otherwise by
      // sorting alphabetically buries the two headings anybody actually browses.
      .sort((a, b) => b.items.length - a.items.length);
  }, [filtered, groups]);

  // A search hit inside a closed section is the same as no hit, so searching opens what matched.
  // Otherwise nothing is open: the answer to «فيه إيه» is the list of headings.
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const searching = search.trim().length > 0;
  const activeKeys = searching ? sections.map((s) => s.name) : openKeys;

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

        {loading && <Skeleton active paragraph={{ rows: 4 }} />}
        {!loading && !sections.length && <Empty description="مفيش حسابات مطابقة" />}

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
                {/* The two numbers that decide whether this section is the one you want, on the
                    bar — so the section does not have to be opened to find out. */}
                <span style={{ color: '#8a8a8a', fontSize: 12 }}>الإجمالي {egp(s.total)}</span>
                {s.hidden > 0 && <Tag color="red">{s.hidden} مخفي</Tag>}
              </Space>
            ),
            children: (
              <AccountGroup rows={s.items} columns={inSection} onOpen={openEdit} />
            ),
          }))}
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

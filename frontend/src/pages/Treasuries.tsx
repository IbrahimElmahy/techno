import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Card, Checkbox, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip,
  message,
} from 'antd';
import {
  PlusOutlined, EditOutlined, StopOutlined, SearchOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { egp } from '../utils/accounts';

/** الخزينه و البنوك — their `/payment-methods`, its own screen.
 *
 * The records existed and the API was complete; what was wrong was where the menu went. The entry
 * «الخزينه و البنوك» pointed at `/treasury`, which is the journal-entries screen — «how money
 * moved», not «what we keep it in» — while the safes themselves were a tab inside السندات. So the
 * one entry named after this data took you to a screen that never lists it.
 */

interface TreasuryRecord {
  id: number;
  name: string;
  kind: 'cash' | 'bank';
  branch_id: number | null;
  account_id: number;
  bank_name: string | null;
  account_number: string | null;
  is_default: boolean;
  active: boolean;
  balance: string;
}

const KIND_LABELS: Record<string, string> = { cash: 'خزينة', bank: 'بنك' };

export default function Treasuries() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TreasuryRecord[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TreasuryRecord | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  // Safes are office data — a rep is refused this by the API too, not just hidden from it here.
  const canWrite = ['system_admin', 'accountant', 'branch_manager'].includes(user?.role || '');

  const load = async () => {
    setLoading(true);
    try {
      const [tr, br] = await Promise.all([
        api.get('/api/v1/treasuries'),
        api.get('/api/v1/branches'),
      ]);
      setRows(tr.data);
      setBranches(br.data);
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


  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || '-';

  const filtered = rows.filter((t) => {
    const q = search.trim();
    if (!q) return true;
    return [String(t.id), t.name, KIND_LABELS[t.kind], branchName(t.branch_id),
      t.bank_name || '', t.account_number || ''].some((v) => v.includes(q));
  });

  const onCreate = async (v: any) => {
    try {
      await api.post('/api/v1/treasuries', {
        name: v.name,
        kind: v.kind,
        branch_id: v.branch_id ?? null,
        bank_name: v.bank_name || null,
        account_number: v.account_number || null,
        is_default: !!v.is_default,
      });
      message.success('اتسجّلت الخزينة');
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
      await api.patch(`/api/v1/treasuries/${editing.id}`, {
        name: v.name,
        branch_id: v.branch_id ?? null,
        bank_name: v.bank_name || null,
        account_number: v.account_number || null,
        is_default: !!v.is_default,
      });
      message.success('اتعدّلت الخزينة');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (record: TreasuryRecord) => {
    setEditing(record);
    editForm.setFieldsValue(record);
  };

  const onDeactivate = (record: TreasuryRecord) => {
    showDeactivationConfirm({
      title: 'إخفاء الخزينة',
      content: `هل أنت متأكد من إخفاء "${record.name}"؟ لن تظهر في السندات الجديدة، `
        + 'وتظل حركاتها السابقة ورصيدها كما هي.',
      onOk: async () => {
        try {
          await api.patch(`/api/v1/treasuries/${record.id}`, { active: false });
          message.success('تم إخفاء الخزينة');
          load();
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Their four columns, in their order: `رقم · الاسم · نوع · الفرع`.
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
      render: (name: string, r: TreasuryRecord) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{name}</span>
          {r.is_default && <Tag color="gold">الافتراضية</Tag>}
          {!r.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ),
    },
    {
      title: 'نوع',
      dataIndex: 'kind',
      key: 'kind',
      width: 100,
      render: (k: string) => (
        <Tag color={k === 'bank' ? 'blue' : 'default'}>{KIND_LABELS[k] || k}</Tag>
      ),
    },
    {
      title: 'الفرع',
      dataIndex: 'branch_id',
      key: 'branch_id',
      ellipsis: true,
      render: (id: number | null) => branchName(id),
    },
    // Ours: a safe with no balance beside it is a name, not an answer.
    {
      title: 'الرصيد',
      dataIndex: 'balance',
      key: 'balance',
      width: 140,
      align: 'left' as const,
      render: (b: string) => <strong>{egp(b)}</strong>,
      sorter: (a: TreasuryRecord, b: TreasuryRecord) =>
        Number(a.balance || 0) - Number(b.balance || 0),
    },
    ...(canWrite ? [{
      title: '',
      key: 'actions',
      width: 90,
      render: (_: any, record: TreasuryRecord) => (
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

  // Ours that used to have no room: the bank's own details, and which safe a document falls back
  // to when it names none.
  const expandedRow = (r: TreasuryRecord) => (
    <Space size={32} wrap style={{ paddingInlineStart: 8 }}>
      <span><span style={{ color: '#888' }}>اسم البنك: </span>{r.bank_name || '—'}</span>
      <span>
        <span style={{ color: '#888' }}>رقم الحساب: </span>
        {r.account_number
          ? <span style={{ fontFamily: 'monospace', direction: 'ltr' }}>{r.account_number}</span>
          : '—'}
      </span>
      <span><span style={{ color: '#888' }}>حساب الأستاذ: </span>#{r.account_id}</span>
      {r.is_default && <Tag color="gold">السند اللي مايسمّيش خزينة بيقع عليها</Tag>}
    </Space>
  );

  // Their three fields — الفرع · نوع · الاسم — then the bank details, which only a bank has.
  const formFields = (isCreate: boolean) => (
    <>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item name="branch_id" label="الفرع">
            <Select allowClear showSearch placeholder="اختر الفرع"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              filterOption={(input, option) => String(option?.label ?? '').includes(input)} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="kind" label="نوع" rules={[{ required: isCreate }]}>
            {/* Locked after creation: the kind decides whether the bank fields mean anything, and
                a safe that turns into a bank account halfway through its history is neither. */}
            <Select disabled={!isCreate} options={[
              { value: 'cash', label: 'خزينة' },
              { value: 'bank', label: 'بنك' },
            ]} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="name" label="الاسم"
            rules={[{ required: true, message: 'اكتب اسم الخزينة' }]}>
            <Input placeholder="مثال: صندوق السيارة أ" />
          </Form.Item>
        </Col>
      </Row>

      {/* Shown only for a bank — asking a cash box for its account number is asking for a blank. */}
      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.kind !== cur.kind}>
        {({ getFieldValue }) => (getFieldValue('kind') === 'bank' ? (
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="bank_name" label="اسم البنك">
                <Input placeholder="مثال: البنك الأهلي" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="account_number" label="رقم الحساب">
                <Input style={{ direction: 'ltr' }} />
              </Form.Item>
            </Col>
          </Row>
        ) : null)}
      </Form.Item>

      <Form.Item name="is_default" valuePropName="checked" noStyle>
        <Checkbox>الخزينة الافتراضية — السند اللي مايسمّيش خزينة بيقع عليها</Checkbox>
      </Form.Item>
    </>
  );

  return (
    <div>
      <Card
        title="الخزينه و البنوك"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>اعادة تحميل</Button>
            {canWrite && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                خزينة جديدة
              </Button>
            )}
          </Space>
        }
      >
        <Row style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Input allowClear value={search} placeholder="بحث بالاسم أو الفرع أو البنك"
              ref={searchRef}
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
          expandable={{ expandedRowRender: expandedRow }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

      <Modal footer={null} centered title="خزينة جديدة" width={720} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}
          initialValues={{ kind: 'cash' }}>
          {formFields(true)}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </Modal>

      <Modal footer={null} centered title="تعديل الخزينة" width={720} destroyOnHidden
        open={!!editing} onCancel={() => setEditing(null)}>
        <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
          {formFields(false)}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setEditing(null)}>تراجع</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}

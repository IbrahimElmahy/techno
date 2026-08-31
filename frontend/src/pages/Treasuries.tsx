import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Card, Checkbox, Col, Form, Input, Row, Segmented, Select, Space, Switch, Table, Tag,
  Tooltip, message
} from 'antd';
import {
  PlusOutlined, EditOutlined, StopOutlined, SearchOutlined, ReloadOutlined, CheckOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { egp } from '../utils/accounts';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

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

/**
 * صندوق مندوب — عهدة واحدة بخطها وحسابها ورصيدها.
 *
 * a5 بيدّي كل مندوب صندوقين — أبيض وبولي — والفلوس بتتفصل بالخط زي المديونية. الشاشة دي
 * كانت بتعرض سجلات `Treasury` بتاعتنا وبس، فالـ١٣ صندوق اللي اتنقلوا من شجرة a5 مكانوش
 * بيبانوا هنا خالص: المكتب مش شايف الصناديق اللي الفلوس بتنزل فيها فعلاً.
 */
interface RepSafe {
  custody_id: number;
  account_id: number | null;
  name: string;
  code: string;
  /** الخط زي ما هو مكتوب على العهدة — مش مستنتج من الاسم. */
  family: string | null;
  rep_id: number | null;
  rep_name: string;
  balance: string;
  active: boolean;
}

const FAMILY_FILTER = ['الكل', 'أبيض', 'بولي', 'بدون خط'] as const;

export default function Treasuries() {
  const { user } = useAuth();
  const [rows, setRows] = useState<TreasuryRecord[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<any>(null);
  const [safes, setSafes] = useState<RepSafe[]>([]);
  const [safesLoading, setSafesLoading] = useState(false);
  const [familyFilter, setFamilyFilter] = useState<string>('الكل');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TreasuryRecord | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

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

  /**
   * صناديق المناديب — العهدة بخطها ومندوبها وحسابها.
   *
   * تلات مصادر لأن مافيش واحد فيهم بيقول القصة كلها: `/custodies` بترجّع الخط والمندوب من
   * غير `account_id`، و`/custodies/{id}/balance` هي اللي بتقول الحساب والرصيد، والاسم
   * والكود («صندوق بولي السياره (ب)» / `A5S-…`) على الحساب في الشجرة.
   *
   * وطلبة الرصيد بتتنده لكل عهدة لوحدها — عشرين عهدة يعني عشرين طلبة على شاشة إعدادات
   * بتتفتح مرة في اليوم. اللي يستاهل تجميع هو السيرفر لما `/custodies` ترجّع `account_id`.
   */
  const loadSafes = async () => {
    setSafesLoading(true);
    try {
      const [cu, rp, acc] = await Promise.all([
        api.get('/api/v1/custodies').catch(() => ({ data: [] })),
        api.get('/api/v1/reps', { params: { include_inactive: true } })
          .catch(() => ({ data: [] })),
        api.get('/api/v1/accounts?postable_only=true').catch(() => ({ data: [] })),
      ]);
      const repName: Record<number, string> = {};
      (rp.data || []).forEach((r: any) => { repName[r.user_id] = r.full_name || r.username; });
      const account: Record<number, any> = {};
      (acc.data || []).forEach((a: any) => { account[a.id] = a; });
      const rows = (cu.data || []).filter((c: any) => c.holder_type === 'rep');
      const links = await Promise.all(rows.map((c: any) => api
        .get(`/api/v1/custodies/${c.id}/balance`).then((r) => r.data).catch(() => null)));
      setSafes(rows.map((c: any, i: number) => {
        const link = links[i];
        const a = link ? account[link.account_id] : null;
        return {
          custody_id: c.id,
          account_id: link ? link.account_id : null,
          // العهدة القديمة اللي اتعملت من الشاشة حسابها من غير اسم — بيتقال إنه من غير اسم،
          // مايتألّفش لها اسم من الخط.
          name: (a && a.name) || '',
          code: (a && a.code) || '',
          family: c.family ?? null,
          rep_id: c.rep_id ?? null,
          rep_name: (c.rep_id && repName[c.rep_id]) || '',
          balance: link ? String(link.balance) : '0',
          active: c.active !== false,
        } as RepSafe;
      }));
    } finally {
      setSafesLoading(false);
    }
  };

  useEffect(() => { load(); loadSafes(); }, []);

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

  /** الصناديق بعد البحث والخط. «بدون خط» عهدة من قبل التقسيم، مش نوع تالت. */
  const filteredSafes = safes.filter((s) => {
    if (familyFilter === 'أبيض' || familyFilter === 'بولي') {
      if (s.family !== familyFilter) return false;
    } else if (familyFilter === 'بدون خط' && s.family) {
      return false;
    }
    const q = search.trim();
    if (!q) return true;
    return [s.name, s.code, s.family || '', s.rep_name].some((v) => v.includes(q));
  });

  const safeColumns = [
    {
      title: 'الصندوق',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, r: RepSafe) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{name || <span style={{ color: '#8c8c8c' }}>حساب بلا اسم</span>}</span>
          {!r.active && <Tag color="red">مقفول</Tag>}
        </Space>
      ),
    },
    {
      title: 'الكود',
      dataIndex: 'code',
      key: 'code',
      width: 130,
      render: (c: string) => (c
        ? <span style={{ fontFamily: 'monospace', direction: 'ltr' }}>{c}</span> : '—'),
    },
    {
      title: 'الخط',
      dataIndex: 'family',
      key: 'family',
      width: 110,
      render: (f: string | null) => (f
        ? <Tag color={f === 'أبيض' ? 'default' : 'blue'}>{f}</Tag>
        : <span style={{ color: '#8c8c8c' }}>بدون خط</span>),
    },
    {
      title: 'المندوب',
      dataIndex: 'rep_name',
      key: 'rep_name',
      ellipsis: true,
      render: (n: string, r: RepSafe) => n || (r.rep_id ? `#${r.rep_id}` : '—'),
    },
    {
      title: 'الرصيد',
      dataIndex: 'balance',
      key: 'balance',
      width: 140,
      align: 'left' as const,
      render: (b: string) => <strong>{egp(b)}</strong>,
      sorter: (a: RepSafe, b: RepSafe) => Number(a.balance || 0) - Number(b.balance || 0),
    },
  ];

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
      message.success('تم تسجيل الخزينة');
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
        active: !!v.active,
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

  const onReactivate = async (record: TreasuryRecord) => {
    try {
      await api.patch(`/api/v1/treasuries/${record.id}`, { active: true });
      message.success('تم إعادة تنشيط الخزينة');
      load();
    } catch (err) {
      console.error(err);
    }
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
          {record.active ? (
            <Tooltip title="إخفاء">
              <Button type="text" icon={<StopOutlined />} onClick={() => onDeactivate(record)} />
            </Tooltip>
          ) : (
            <Tooltip title="إعادة تنشيط">
              <Button type="text" icon={<CheckOutlined />} onClick={() => onReactivate(record)} />
            </Tooltip>
          )}
        </Space>
      ),
    }] : []),
  ];

  const tableCols = useTableColumns('treasuries', columns);

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
      {r.is_default && <Tag color="gold">يقع عليها السند الذي لا يسمّي خزينة</Tag>}
    </Space>
  );

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
        <Checkbox>الخزينة الافتراضية — يقع عليها السند الذي لا يسمّي خزينة</Checkbox>
      </Form.Item>
    </>
  );

  const kb = useTableKeyboard<TreasuryRecord>({
    rows: filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  return (
    <div>
      <Card
        title="الخزينه و البنوك"
        extra={
          <Space>
            {tableCols.control}
            <Button icon={<ReloadOutlined />} onClick={load}>اعادة تحميل</Button>
            {canWrite && (
              <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
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
          {...kb.tableProps}
          dataSource={filtered}
          columns={tableCols.columns}
          rowKey="id"
          loading={loading}
          size="middle"
          tableLayout="fixed"
          expandable={{ expandedRowRender: expandedRow }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

      {/*
        * صناديق المناديب — الجدول التاني عن قصد، مش أعمدة زيادة على الأول.
        *
        * الاتنين مش نفس الحاجة: فوق سجلات `Treasury` اللي بتتعمل من الشاشة وليها تعديل
        * وإخفاء، وتحت عهد المناديب اللي بتتعمل مع المندوب وبتتقفل معاه. جدول واحد كان
        * هيبقى نصّه أزرار مالهاش معنى في نص الصفوف.
        */}
      <Card
        title="صناديق المناديب"
        style={{ marginTop: 16 }}
        extra={(
          <Space>
            <Segmented
              value={familyFilter}
              onChange={(v) => setFamilyFilter(String(v))}
              options={FAMILY_FILTER.map((f) => ({ value: f, label: f }))}
            />
            <Button icon={<ReloadOutlined />} onClick={loadSafes}>اعادة تحميل</Button>
          </Space>
        )}
      >
        <Table
          dataSource={filteredSafes}
          columns={safeColumns}
          rowKey="custody_id"
          loading={safesLoading}
          size="middle"
          tableLayout="fixed"
          locale={{ emptyText: 'مافيش صناديق للمناديب' }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

      <TabModal footer={null} centered title="خزينة جديدة" width={720} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}
          initialValues={{ kind: 'cash' }}>
          {formFields(true)}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

      <TabModal footer={null} centered title="تعديل الخزينة" width={720} destroyOnHidden
        open={!!editing} onCancel={() => setEditing(null)}>
        <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
          {formFields(false)}
          <Form.Item name="active" valuePropName="checked" label="الحالة">
            <Switch checkedChildren="نشطة" unCheckedChildren="مخفية" />
          </Form.Item>
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setEditing(null)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>
    </div>
  );
}

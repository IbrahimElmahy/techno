import React, { useEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Button, Checkbox, Col, Form, Input, Row, Select, Space, Switch, Table, Tag,
  Tooltip, message
} from 'antd';
import {
  PlusOutlined, EditOutlined, StopOutlined, SearchOutlined, ReloadOutlined, CheckOutlined,
  BankOutlined, ClearOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { Popconfirm } from '../components/noConfirm';
import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
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
  balance: string | null;
}

const KIND_LABELS: Record<string, string> = { cash: 'خزينة', bank: 'بنك' };

interface RepSafe {
  custody_id: number;
  account_id: number | null;
  name: string;
  code: string;
  family: string | null;
  rep_id: number | null;
  rep_name: string;
  balance: string | null;
  active: boolean;
}

const FAMILY_FILTER = ['الكل', 'أبيض', 'بولي', 'بدون خط'] as const;

export default function Treasuries() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState<TreasuryRecord[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<any>(null);
  const [safes, setSafes] = useState<RepSafe[]>([]);
  const [safesLoading, setSafesLoading] = useState(false);
  const [familyFilter, setFamilyFilter] = useState<string>('الكل');
  const [viewRaw, setView] = useQueryTab('treasuries');
  const view = (viewRaw === 'safes' ? 'safes' : 'treasuries') as 'treasuries' | 'safes';
  const [createOpen, setCreateOpen] = useState(false);
  const [safeEditing, setSafeEditing] = useState<RepSafe | 'new' | null>(null);
  const [safeForm] = Form.useForm();
  const [repList, setRepList] = useState<{ id: number; name: string; active: boolean }[]>([]);
  const [editing, setEditing] = useState<TreasuryRecord | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const canWrite = can('treasury.read') && can('ledger.post');

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
      setRepList((rp.data || []).map((r: any) => ({
        id: r.user_id, name: r.full_name || r.username, active: r.active !== false })));
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
          name: (a && a.name) || '',
          code: (a && a.code) || '',
          family: c.family ?? null,
          rep_id: c.rep_id ?? null,
          rep_name: (c.rep_id && repName[c.rep_id]) || '',
          balance: link ? String(link.balance) : null,
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
          <span style={{ fontWeight: 600 }}>{name || <span style={{ color: '#555b65' }}>حساب بلا اسم</span>}</span>
          {!r.active && <Tag color="red">مغلق</Tag>}
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
        : <span style={{ color: '#555b65' }}>بدون خط</span>),
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
      render: (b: string | null) =>
        b === null ? <span style={{ color: '#555b65' }} title="تعذرت قراءة الرصيد">—</span>
                   : <strong>{egp(b)}</strong>,
      sorter: (a: RepSafe, b: RepSafe) => Number(a.balance || 0) - Number(b.balance || 0),
    },
  ];

  const errText = (err: any, fallback: string) =>
    err?.response?.data?.detail?.message || err?.response?.data?.message || fallback;

  const openSafe = (s: RepSafe | 'new') => {
    setSafeEditing(s);
    safeForm.setFieldsValue(s === 'new'
      ? { name: '', rep_id: undefined, family: undefined }
      : { name: s.name, rep_id: s.rep_id ?? undefined, family: s.family ?? undefined });
  };

  const onSaveSafe = async (v: any) => {
    try {
      if (safeEditing === 'new') {
        await api.post('/api/v1/custodies', {
          holder_type: 'rep', rep_id: v.rep_id, family: v.family || null, name: v.name,
        });
        message.success('تم إنشاء الصندوق');
      } else if (safeEditing) {
        await api.patch(`/api/v1/custodies/${safeEditing.custody_id}`, {
          name: v.name, rep_id: v.rep_id, family: v.family || '',
        });
        message.success('تم تعديل الصندوق');
      }
      setSafeEditing(null);
      loadSafes();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحفظ'));
    }
  };

  const setSafeActive = async (s: RepSafe, active: boolean) => {
    try {
      await api.patch(`/api/v1/custodies/${s.custody_id}`, { active });
      message.success(active ? 'تم إظهار الصندوق' : 'تم إخفاء الصندوق');
      loadSafes();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحفظ'));
    }
  };

  const deleteSafe = async (s: RepSafe) => {
    try {
      await api.delete(`/api/v1/custodies/${s.custody_id}`, { params: { hard: true } });
      message.success('تم حذف الصندوق');
      loadSafes();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحذف'));
    }
  };

  const deleteTreasury = async (t: TreasuryRecord) => {
    try {
      await api.delete(`/api/v1/treasuries/${t.id}`);
      message.success('تم حذف الخزينة');
      load();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحذف'));
    }
  };

  const safeActionsColumn = canWrite ? [{
    title: '',
    key: 'actions',
    width: 120,
    render: (_: any, r: RepSafe) => (
      <Space size={2}>
        <Tooltip title="تعديل">
          <Button type="text" icon={<EditOutlined />} onClick={() => openSafe(r)} />
        </Tooltip>
        {r.active ? (
          <Tooltip title="إخفاء">
            <Button type="text" icon={<StopOutlined />} onClick={() => setSafeActive(r, false)} />
          </Tooltip>
        ) : (
          <Tooltip title="إظهار">
            <Button type="text" icon={<CheckOutlined />} onClick={() => setSafeActive(r, true)} />
          </Tooltip>
        )}
        <Popconfirm title="حذف هذا الصندوق؟" description="يُحذف فقط إذا لم تكن له أي حركة."
          okText="حذف" cancelText="لا" onConfirm={() => deleteSafe(r)}>
          <Tooltip title="حذف">
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Tooltip>
        </Popconfirm>
      </Space>
    ),
  }] : [];

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
      message.success('تم تعديل الخزينة');
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
      render: (b: string | null) =>
        b === null ? <span style={{ color: '#555b65' }} title="تعذرت قراءة الرصيد">—</span>
                   : <strong>{egp(b)}</strong>,
      sorter: (a: TreasuryRecord, b: TreasuryRecord) =>
        Number(a.balance || 0) - Number(b.balance || 0),
    },
    ...(canWrite ? [{
      title: '',
      key: 'actions',
      width: 120,
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
          {!record.is_default && (
            <Popconfirm title="حذف هذه الخزينة؟" description="تُحذف فقط إذا لم تكن لها أي حركة."
              okText="حذف" cancelText="لا" onConfirm={() => deleteTreasury(record)}>
              <Tooltip title="حذف">
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    }] : []),
  ];

  const tableCols = useTableColumns('treasuries', columns, {
    export: { name: 'الخزينه و البنوك', rows: filtered },
  });

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
      {r.is_default && <Tag color="gold">الخزينة الافتراضية</Tag>}
    </Space>
  );

  const formFields = (isCreate: boolean) => (
    <>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item name="branch_id" label="الفرع">
            <Select allowClear showSearch placeholder="اختر الفرع"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              filterOption={searchFilter} filterSort={searchRank} />
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
        <Checkbox>الخزينة الافتراضية</Checkbox>
      </Form.Item>
    </>
  );

  const kb = useTableKeyboard<TreasuryRecord>({
    rows: filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  return (
    <>
    <ListPage<'treasuries' | 'safes'>
      icon={<BankOutlined />}
      title="الخزينه و البنوك"
      tabs={[
        { key: 'treasuries', label: 'الخزائن والبنوك', count: rows.length },
        { key: 'safes', label: 'صناديق المناديب', count: safes.length },
      ]}
      activeTab={view} onTabChange={setView}
      actions={view === 'treasuries' ? (<>
        {canWrite && (
          <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}>
            خزينة جديدة
          </Button>
        )}
        {tableCols.control}
        <Button icon={<ReloadOutlined />} onClick={load}>إعادة تحميل</Button>
      </>) : (<>
        {canWrite && (
          <Button type="primary" className="sl-create" icon={<PlusOutlined />}
            onClick={() => openSafe('new')}>
            صندوق جديد
          </Button>
        )}
        <Button icon={<ReloadOutlined />} onClick={loadSafes}>إعادة تحميل</Button>
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear value={search}
          placeholder={view === 'treasuries' ? 'بحث بالاسم أو الفرع أو البنك'
            : 'بحث بالصندوق أو الكود أو المندوب'}
          ref={searchRef}
          prefix={<SearchOutlined />} onChange={(e) => setSearch(e.target.value)} />
        {view === 'safes' && (
          <Select
            value={familyFilter}
            onChange={(v) => setFamilyFilter(String(v))}
            options={FAMILY_FILTER.map((f) => ({ value: f, label: f === 'الكل' ? 'كل الخطوط' : f }))}
          />
        )}
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { setSearch(''); setFamilyFilter('الكل'); }}>مسح</Button>
      </>)}
    >
      {view === 'treasuries' ? (
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
                <span>عدد: <b>{t}</b></span>
                <span>إجمالي الأرصدة: <b>{egp(filtered
                  .reduce((s, r) => s + Number(r.balance || 0), 0))}</b></span>
              </span>
            ) }}
        />
      ) : (
        <Table
          className="sl-table"
          dataSource={filteredSafes}
          columns={[...safeColumns, ...safeActionsColumn]}
          rowKey="custody_id"
          loading={safesLoading}
          size="small"
          tableLayout="fixed"
          locale={{ emptyText: 'لا توجد صناديق للمناديب' }}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true,
            locale: { items_per_page: '' },
            showTotal: (t) => (
              <span className="sl-foot">
                <span>عدد: <b>{t}</b></span>
                <span>إجمالي الأرصدة: <b>{egp(filteredSafes
                  .reduce((s, r) => s + Number(r.balance || 0), 0))}</b></span>
              </span>
            ) }}
        />
      )}
    </ListPage>

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

      <TabModal footer={null} centered width={560} destroyOnHidden
        title={safeEditing === 'new' ? 'صندوق مندوب جديد' : 'تعديل صندوق المندوب'}
        open={!!safeEditing} onCancel={() => setSafeEditing(null)}>
        <Form form={safeForm} layout="vertical" onFinish={onSaveSafe} requiredMark={false}>
          <Form.Item name="name" label="اسم الصندوق"
            rules={[{ required: safeEditing === 'new', message: 'اكتب اسم الصندوق' }]}>
            <Input placeholder="مثال: صندوق بولي السيارة (ب)" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="rep_id" label="المندوب"
                rules={[{ required: true, message: 'اختر المندوب' }]}>
                <Select showSearch placeholder="اختر المندوب"
                  options={repList
                    .filter((r) => r.active || (safeEditing !== 'new' && r.id === safeEditing?.rep_id))
                    .map((r) => ({ value: r.id, label: r.name }))}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="family" label="الخط">
                <Select allowClear placeholder="بدون خط" options={[
                  { value: 'أبيض', label: 'أبيض' },
                  { value: 'بولي', label: 'بولي' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setSafeEditing(null)}>تراجع</Button>
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
    </>
  );
}

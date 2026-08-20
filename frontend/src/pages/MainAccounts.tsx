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

/** الحسابات الرئيسيه — their `/mainaccounts`, its own screen.
 *
 * A main account is the grouping level: it is not posted to, it is what postable accounts roll up
 * into. That is `is_postable === false` here, and on their side it is simply which of the two
 * screens you opened. Keeping the two as separate screens rather than one tree with a filter is
 * the point — somebody adding an expense group and somebody adding a customer's account are doing
 * different jobs, and their menu has always said so.
 */

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
      // The grouping level only. The flat list is used rather than the tree because this screen
      // is a list of groups, not a hierarchy to be walked.
      setRows(res.data.filter((a: ChartAccount) => !a.is_postable));
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


  const filtered = rows.filter((a) => {
    const q = search.trim();
    if (!q) return true;
    return [a.code || '', a.name || '', a.main_level || '',
      NATURE_LABEL[a.nature || ''] || ''].some((v) => v.includes(q));
  });

  const onCreate = async (v: any) => {
    try {
      await api.post('/api/v1/accounts', {
        code: v.code,
        name: v.name,
        nature: v.nature,
        // The screen decides this, not the user: a main account is the grouping level by
        // definition, and asking would only invite the answer that makes the screen wrong.
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


  /**
   * حذف الحساب — إقفال، مش مسح.
   *
   * `DELETE /accounts/{id}` deactivates. A chart account that has ever been posted to is named on
   * ledger entries that cannot be edited, so erasing the row would leave those entries pointing at
   * a number with no name — the statement would read «#41» where the account used to be. The
   * server refuses a system account and one with live children underneath it, and says which.
   */
  const removeAccount = async (record: ChartAccount) => {
    try {
      await api.delete(`/api/v1/accounts/${record.id}`);
      message.success('اتقفل الحساب');
      load();
    } catch (err: any) {
      // الرفض بيقول السبب — «تحته حسابات شغالة» خطوة تالية، مش حيطة.
      message.error(err?.response?.data?.detail?.message || 'تعذر إقفال الحساب', 6);
    }
  };

  const openEdit = (record: ChartAccount) => {
    setEditing(record);
    editForm.setFieldsValue({
      ...record,
      main_level: record.main_level ? [record.main_level] : undefined,
    });
  };

  // Their five columns, in their order: `رقم · الاسم · نوع الحساب · المستوى الرئيسي · يظهر في`.
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
    // Ours: a group's balance is the sum of what rolls into it, which is the number somebody
    // opened this screen to read.
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

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('main-accounts', columns);

  // Their form: الاسم · المستوى الرئيسي · يظهر في · نوع الحساب. The code is ours — their system
  // numbers accounts for you, but a chart of accounts code carries a scheme the accountant owns
  // («١١٠٠» is current assets), and generating one would quietly break their numbering.
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
              // Free text on purpose — the suggestions cover the common chart, not every chart.
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
            {/* Locked after creation: the nature decides which side the account sits on, and
                flipping it under posted entries would move balances nobody asked to move. */}
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

  // السطر يفتح التعديل — البيانات الأساسية مافيهاش «عرض» غير الفورم بتاعها نفسه.
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

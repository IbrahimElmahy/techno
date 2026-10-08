import React, { useEffect, useRef, useState } from 'react';
import { forgetFactoryBranches } from '../components/useFactoryBranch';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Button, Checkbox, Col, Form, Input, Row, Select, Space, Table, Tag, Tooltip, message
} from 'antd';
import {
  PlusOutlined, EditOutlined, StopOutlined, SearchOutlined, ReloadOutlined, ShopOutlined,
} from '@ant-design/icons';
import ListPage from '../components/ListPage';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { showDeactivationConfirm } from '../components/ConfirmationDialog';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';

interface BranchRecord {
  id: number;
  name: string;
  governorate_id: number;
  is_head_office: boolean;
  is_factory?: boolean;
  active: boolean;
  note1: string | null;
  note2: string | null;
}

export default function Branches() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState<BranchRecord[]>([]);
  const [governorates, setGovernorates] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<BranchRecord | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const canWrite = can('branch.write');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [br, gov] = await Promise.all([
        api.get('/api/v1/branches'),
        api.get('/api/v1/governorates'),
      ]);
      setRows(br.data);
      setGovernorates(gov.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  useScreenShortcuts({
    onNew: canWrite ? () => setCreateOpen(true) : undefined,
    onSearch: () => searchRef.current?.focus(),
    onClose: () => { setCreateOpen(false); },
  });


  const govName = (id: number) => governorates.find((g) => g.id === id)?.name || '-';

  const filtered = rows.filter((b) => {
    const q = search.trim();
    if (!q) return true;
    return [String(b.id), b.name, govName(b.governorate_id), b.note1 || '', b.note2 || '']
      .some((v) => v.includes(q));
  });

  const onCreate = async (values: any) => {
    try {
      await api.post('/api/v1/branches', {
        name: values.name,
        note1: values.note1 || null,
        note2: values.note2 || null,
        governorate_id: values.governorate_id,
        is_head_office: !!values.is_head_office,
        is_factory: !!values.is_factory,
      });
      forgetFactoryBranches();
      message.success('تم تسجيل الفرع');
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
      await api.patch(`/api/v1/branches/${editing.id}`, {
        name: values.name,
        note1: values.note1 || null,
        note2: values.note2 || null,
        governorate_id: values.governorate_id,
        is_factory: !!values.is_factory,
      });
      forgetFactoryBranches();
      message.success('تم تعديل الفرع');
      setEditing(null);
      fetchAll();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (record: BranchRecord) => {
    setEditing(record);
    editForm.setFieldsValue(record);
  };

  const onDeactivate = (record: BranchRecord) => {
    showDeactivationConfirm({
      title: 'إخفاء الفرع',
      content: `هل أنت متأكد من إخفاء "${record.name}"؟ لن يظهر في اختيارات العمليات الجديدة، `
        + 'وتظل سجلاته السابقة كما هي.',
      onOk: async () => {
        try {
          await api.delete(`/api/v1/branches/${record.id}`);
          message.success('تم إخفاء الفرع');
          fetchAll();
        } catch (err) {
          console.error(err);
        }
      },
    });
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
      render: (name: string, record: BranchRecord) => (
        <Space size={4}>
          <span style={{ fontWeight: 600 }}>{name}</span>
          {record.is_head_office && <Tag color="blue">المركز الرئيسي</Tag>}
          {record.is_factory && <Tag color="purple">مصنع</Tag>}
          {!record.active && <Tag color="red">مخفي</Tag>}
        </Space>
      ),
    },
    {
      title: 'المحافظة',
      dataIndex: 'governorate_id',
      key: 'governorate_id',
      ellipsis: true,
      render: (id: number) => govName(id),
    },
    {
      title: 'بيان 1',
      dataIndex: 'note1',
      key: 'note1',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'بيان 2',
      dataIndex: 'note2',
      key: 'note2',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    ...(canWrite ? [{
      title: '',
      key: 'actions',
      width: 90,
      render: (_: any, record: BranchRecord) => (
        <Space size={2}>
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          {record.active && !record.is_head_office && (
            <Tooltip title="إخفاء">
              <Button type="text" icon={<StopOutlined />} onClick={() => onDeactivate(record)} />
            </Tooltip>
          )}
        </Space>
      ),
    }] : []),
  ];

  const tableCols = useTableColumns('branches', columns, {
    export: { name: 'الفروع', rows: filtered },
  });

  const formFields = (isCreate: boolean) => (
    <>
      <Form.Item name="name" label="الاسم"
        rules={[{ required: true, message: 'اكتب اسم الفرع' }]}>
        <Input placeholder="مثال: فرع دمنهور" />
      </Form.Item>
      <Form.Item name="note1" label="بيان 1">
        <Input.TextArea rows={2} maxLength={300} />
      </Form.Item>
      <Form.Item name="note2" label="بيان 2">
        <Input.TextArea rows={2} maxLength={300} />
      </Form.Item>
      <Row gutter={12}>
        <Col span={14}>
          <Form.Item name="governorate_id" label="المحافظة"
            rules={[{ required: true, message: 'اختر المحافظة' }]}>
            <Select showSearch placeholder="اختر المحافظة"
              options={governorates.map((g) => ({ value: g.id, label: g.name }))}
              filterOption={searchFilter} filterSort={searchRank} />
          </Form.Item>
        </Col>
        {isCreate && (
          <Col span={10}>
            <Form.Item name="is_head_office" valuePropName="checked" label=" ">
              <Checkbox>المركز الرئيسي</Checkbox>
            </Form.Item>
          </Col>
        )}
        <Col span={10}>
          <Form.Item name="is_factory" valuePropName="checked" label=" ">
            <Checkbox>فرع تصنيع</Checkbox>
          </Form.Item>
        </Col>
      </Row>
    </>
  );

  const kb = useTableKeyboard<BranchRecord>({
    rows: filtered, rowKey: (r) => r.id, onOpen: (r) => openEdit(r),
  });

  return (
    <>
      <ListPage
        icon={<ShopOutlined />}
        title="الفروع"
        actions={(<>
          {canWrite && (
            <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}>
              فرع جديد
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>إعادة تحميل</Button>
          {tableCols.control}
        </>)}
        filters={(
          <Input className="sl-f-search" allowClear value={search}
            placeholder="بحث بالاسم أو المحافظة أو البيان"
            ref={searchRef}
            prefix={<SearchOutlined />} onChange={(e) => setSearch(e.target.value)} />
        )}
      >
        <Table
          {...kb.tableProps}
          className="sl-table"
          dataSource={filtered}
          columns={tableCols.columns}
          rowKey="id"
          loading={loading}
          size="small"
          tableLayout="fixed"
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true,
            showTotal: (t) => <span className="sl-foot"><span>عدد الفروع: <b>{t}</b></span></span> }}
        />
      </ListPage>

      <TabModal footer={null} centered title="فرع جديد" width={560} destroyOnHidden
        open={createOpen} onCancel={() => setCreateOpen(false)}>
        <Form form={form} layout="vertical" onFinish={onCreate} requiredMark={false}>
          {formFields(true)}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setCreateOpen(false)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>

      <TabModal footer={null} centered title="تعديل الفرع" width={560} destroyOnHidden
        open={!!editing} onCancel={() => setEditing(null)}>
        <Form form={editForm} layout="vertical" onFinish={onEdit} requiredMark={false}>
          {formFields(false)}
          <Space>
            <Button type="primary" htmlType="submit">حفظ</Button>
            <Button onClick={() => setEditing(null)}>تراجع</Button>
          </Space>
        </Form>
      </TabModal>
    </>
  );
}

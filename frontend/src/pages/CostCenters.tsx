import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Card, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import {
  PlusOutlined, StopOutlined, SearchOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { showReversalConfirm } from '../components/ConfirmationDialog';
import { CostCenter } from '../utils/accounts';

/** مراكز التكلفة — their `/cost_centers`, its own screen.
 *
 * Last of the twelve in إداره الانشاءات. It was the fourth tab of the general-ledger page, which
 * is a page about entries and balances; a cost centre is master data you set up once, and the two
 * jobs had no reason to share a screen beyond both being «accounting».
 */


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
      // The flat list, not the tree: theirs is a list with the parent as a column, and a list is
      // what you scan when you are looking for one centre by name.
      const res = await api.get('/api/v1/cost-centers');
      setRows(res.data);
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
      message.success('اتسجّل مركز التكلفة');
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (err) {
      console.error(err);
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

  // Their four columns, in their order: `رقم · الاسم · مستوي مركز التكلفة · المركز التابع له`.
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
      width: 60,
      render: (_: any, r: CostCenter) => (r.active ? (
        <Tooltip title="تعطيل">
          <Button type="text" danger icon={<StopOutlined />} onClick={() => onDeactivate(r)} />
        </Tooltip>
      ) : null),
    }] : []),
  ];

  return (
    <div>
      <Card
        title="مراكز التكلفة"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>اعادة تحميل</Button>
            {canWrite && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
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
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          tableLayout="fixed"
          locale={{ emptyText: 'لا توجد مراكز تكلفة' }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true,
            showTotal: (t) => `عدد: ${t}` }}
        />
      </Card>

      {/* Their form asks for a level and a name. Ours asks for the parent instead of the level:
          the level IS the depth of the parent chain, so choosing a parent sets it — and asking for
          both is asking for the day they disagree. The code is ours, for the same reason the chart
          of accounts keeps one: the numbering is the accountant's. */}
      <Modal footer={null} centered title="مركز تكلفة جديد" width={620} destroyOnHidden
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
      </Modal>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Modal, Space, Table, Tag, message } from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';

/**
 * المحافظات — أعلى مستوى في الهيكل: المحافظة فوق الفرع فوق المنطقة.
 *
 * كانت مدفونة في تبويب داخل «الهيكل التنظيمي» ومش في القائمة، فاللي عايز يضيف محافظة
 * لفرع جديد ماكانش يلاقي المكان. وهي أول حاجة تتسأل لما فرع يتفتح.
 *
 * وعمود «فروع» بيقول إن المحافظة مستعملة — الحذف بيترفض من السيرفر طالما تحتها فرع.
 */

interface Gov { id: number; name: string }

export default function Governorates() {
  const [rows, setRows] = useState<Gov[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Gov | null>(null);
  const [name, setName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [g, b] = await Promise.all([
        api.get('/api/v1/governorates'),
        api.get('/api/v1/branches'),
      ]);
      setRows(g.data || []);
      setBranches(b.data || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const countOf = (id: number) =>
    branches.filter((b: any) => b.governorate_id === id).length;

  const visible = useMemo(() => {
    const q = query.trim();
    return q ? rows.filter((r) => r.name.includes(q)) : rows;
  }, [rows, query]);

  const columns = [
    { title: 'كود', dataIndex: 'id', key: 'id', width: 80 },
    {
      title: 'المحافظة', dataIndex: 'name', key: 'name', width: 260,
      render: (v: string) => <b>{v}</b>,
    },
    {
      title: 'فروع', dataIndex: 'id', key: 'branches', width: 100, align: 'center' as const,
      render: (id: number) => {
        const n = countOf(id);
        return <span style={{ fontWeight: n ? 600 : 400, color: n ? undefined : '#bfbfbf' }}>{n}</span>;
      },
    },
    {
      title: 'الفروع التابعة', key: 'names',
      render: (_: any, r: Gov) => {
        const list = branches.filter((b: any) => b.governorate_id === r.id);
        if (!list.length) return <span style={{ color: '#bfbfbf' }}>—</span>;
        return <Space size={4} wrap>{list.map((b: any) => (
          <Tag key={b.id} color={b.active ? 'green' : 'default'}>{b.name}</Tag>
        ))}</Space>;
      },
    },
    {
      title: 'الإجراءات', key: 'actions', width: 100,
      render: (_: any, r: Gov) => (
        <Button type="text" size="small" icon={<EditOutlined />}
          onClick={() => { setEditing(r); setName(r.name); }} />
      ),
    },
  ];

  const cols = useTableColumns('governorates', columns as any, {
    locked: ['id'],
    export: { name: 'المحافظات', rows: visible },
  });

  const save = async () => {
    const v = name.trim();
    if (!v) return;
    if (editing?.id) await api.patch(`/api/v1/governorates/${editing.id}`, { name: v });
    else await api.post('/api/v1/governorates', { name: v });
    message.success(editing?.id ? 'تم تعديل المحافظة' : 'تم إضافة المحافظة');
    setEditing(null);
    load();
  };

  return (
    <Card
      title="المحافظات"
      extra={
        <Space>
          {cols.control}
          <Button type="primary" icon={<PlusOutlined />}
            onClick={() => { setEditing({ id: 0, name: '' }); setName(''); }}>
            محافظة جديدة
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      }
    >
      <Input allowClear prefix={<SearchOutlined />} style={{ width: 280, marginBottom: 12 }}
        placeholder="بحث بالاسم" value={query} onChange={(e) => setQuery(e.target.value)} />

      <Table
        rowKey="id" size="small" loading={loading} dataSource={visible}
        columns={cols.columns} tableLayout="fixed" pagination={false}
        locale={{ emptyText: <Empty description="لا توجد محافظات" /> }}
      />

      <Modal
        open={Boolean(editing)}
        title={editing?.id ? 'تعديل المحافظة' : 'محافظة جديدة'}
        okText="حفظ" cancelText="إلغاء"
        okButtonProps={{ disabled: !name.trim() }}
        onCancel={() => setEditing(null)}
        onOk={save}
      >
        <Input placeholder="اسم المحافظة" value={name} autoFocus
          onChange={(e) => setName(e.target.value)} onPressEnter={save} />
      </Modal>
    </Card>
  );
}

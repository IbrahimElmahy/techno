import React, { useEffect, useMemo, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Button, Empty, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, message,
} from 'antd';
import { AimOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import ListPage from '../components/ListPage';
import { activeOptions } from '../utils/active';

interface Territory {
  id: number; name: string; branch_id: number;
  parent_id: number | null; parent_name: string | null;
  customer_count: number; active: boolean;
}

export default function Territories() {
  const [rows, setRows] = useState<Territory[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ name: string; branch_id?: number; parent_id?: number }>({ name: '' });

  const load = async () => {
    setLoading(true);
    try {
      const [t, b] = await Promise.all([
        api.get('/api/v1/territories'),
        api.get('/api/v1/branches'),
      ]);
      setRows(t.data || []);
      setBranches(b.data || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const patch = async (r: Territory, body: Record<string, any>, what: string) => {
    try {
      await api.patch(`/api/v1/territories/${r.id}`, body);
      message.success(`تم تعديل ${what}`);
      load();
    } catch {}
  };

  const branchName = (id: number) => branches.find((b: any) => b.id === id)?.name || '—';

  const parents = useMemo(() => rows.filter((r) => !r.parent_id), [rows]);

  const visible = useMemo(() => {
    const q = query.trim();
    const list = q
      ? rows.filter((r) => [r.name, r.parent_name, branchName(r.branch_id)]
          .some((x) => (x || '').includes(q)))
      : rows;
    const out: Territory[] = [];
    list.filter((r) => !r.parent_id).forEach((p) => {
      out.push(p);
      list.filter((c) => c.parent_id === p.id).forEach((c) => out.push(c));
    });
    list.filter((r) => r.parent_id && !out.includes(r)).forEach((r) => out.push(r));
    return out;
  }, [rows, query, branches]);

  const columns = [
    {
      title: 'المنطقة', dataIndex: 'name', key: 'name', width: 240,
      render: (v: string, r: Territory) => (
        <Space size={6} style={{ paddingInlineStart: r.parent_id ? 22 : 0 }}>
          {r.parent_id ? <span style={{ color: '#bfbfbf' }}>↳</span> : null}
          <b style={{ color: r.active ? undefined : '#bfbfbf' }}>{v}</b>
          {!r.parent_id && <Tag color="blue" style={{ fontSize: 14 }}>رئيسية</Tag>}
        </Space>
      ),
    },
    {
      title: 'تحت منطقة', dataIndex: 'parent_id', key: 'parent_id', width: 190,
      render: (v: number | null, r: Territory) => (
        <Select showSearch size="small" style={{ width: '100%' }} allowClear placeholder="— رئيسية —"
          value={v ?? undefined}
          onChange={(x) => patch(r, { parent_id: x ?? 0 }, 'المنطقة الأب')}
          options={parents
            .filter((p) => p.id !== r.id && p.branch_id === r.branch_id)
            .map((p) => ({ value: p.id, label: p.name }))} filterOption={searchFilter} filterSort={searchRank} />
      ),
    },
    {
      title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', width: 160,
      render: (v: number) => branchName(v),
    },
    {
      title: 'عملاء', dataIndex: 'customer_count', key: 'customer_count', width: 90,
      align: 'center' as const,
      render: (v: number) => (
        <span style={{ fontWeight: v ? 600 : 400, color: v ? undefined : '#bfbfbf' }}>{v}</span>
      ),
    },
    {
      title: 'نشطة', dataIndex: 'active', key: 'active', width: 80, align: 'center' as const,
      render: (v: boolean, r: Territory) => (
        <Switch size="small" checked={v}
          onChange={(x) => patch(r, { active: x }, x ? 'التفعيل' : 'الإيقاف')} />
      ),
    },
    {
      title: 'الإجراءات', key: 'actions', width: 100,
      render: (_: any, r: Territory) => (
        <Tooltip title={r.customer_count ? 'عليها عملاء — أوقفها بدل ما تمسحها' : 'حذف'}>
          <Button type="text" danger size="small" icon={<DeleteOutlined />}
            disabled={r.customer_count > 0}
            onClick={() => Modal.confirm({
              title: 'حذف المنطقة',
              content: `هل أنت متأكد من حذف «${r.name}»؟`,
              okText: 'نعم، احذف', okType: 'danger', cancelText: 'إلغاء',
              onOk: async () => {
                await api.delete(`/api/v1/territories/${r.id}`);
                message.success('تم الحذف');
                load();
              },
            })} />
        </Tooltip>
      ),
    },
  ];

  const cols = useTableColumns('territories', columns as any, {
    locked: ['name'],
    export: { name: 'المناطق', rows: visible },
  });

  return (
    <>
    <ListPage
      icon={<AimOutlined />}
      title="المناطق"
      subtitle="المنطقة الرئيسية تجمع تحتها مناطق فرعية، والمنطقة التي عليها عملاء لا تُحذف — أوقفها بدلاً من ذلك"
      actions={(<>
        <Button type="primary" className="sl-create" icon={<PlusOutlined />} onClick={() => {
          setDraft({ name: '', branch_id: branches[0]?.id });
          setAdding(true);
        }}>منطقة جديدة</Button>
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        {cols.control}
      </>)}
      filters={(
        <Input className="sl-f-search" allowClear prefix={<SearchOutlined />}
          placeholder="بحث بالاسم أو الفرع"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
    >
      <Table
        className="sl-table"
        rowKey="id" size="small" loading={loading} dataSource={visible}
        columns={cols.columns} tableLayout="fixed" pagination={false}
        locale={{ emptyText: <Empty description="لا توجد مناطق" /> }}
      />
    </ListPage>

      <Modal
        open={adding} title="منطقة جديدة" okText="أضف" cancelText="إلغاء"
        okButtonProps={{ disabled: !draft.name.trim() || !draft.branch_id }}
        onCancel={() => setAdding(false)}
        onOk={async () => {
          await api.post('/api/v1/territories', {
            name: draft.name.trim(), branch_id: draft.branch_id,
            parent_id: draft.parent_id || null,
          });
          message.success('تم إضافة المنطقة');
          setAdding(false);
          load();
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Input placeholder="اسم المنطقة" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Select style={{ width: '100%' }} placeholder="الفرع" value={draft.branch_id}
            onChange={(v) => setDraft({ ...draft, branch_id: v, parent_id: undefined })}
            options={activeOptions(branches, draft.branch_id)} />
          <Select showSearch style={{ width: '100%' }} allowClear placeholder="تحت منطقة — اتركه فارغاً لمنطقة رئيسية"
            value={draft.parent_id}
            onChange={(v) => setDraft({ ...draft, parent_id: v })}
            options={parents.filter((p) => p.branch_id === draft.branch_id)
              .map((p) => ({ value: p.id, label: p.name }))} filterOption={searchFilter} filterSort={searchRank} />
        </Space>
      </Modal>
    </>
  );
}

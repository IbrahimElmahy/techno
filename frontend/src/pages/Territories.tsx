import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Empty, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';

/**
 * المناطق — مستويين: منطقة رئيسية وتحتها فرعية.
 *
 * «٦ اكتوبر» فوق «الحى الأول» و«الفردوس» و«المستقبل». النظام القديم بيعمل المستويين
 * **بالاسم**: كل عميل شايل نص منطقته ونص أبوها، فتغيير اسم منطقة بيسيب عملاءها على الاسم
 * القديم. وهنا الأب مفتاح — الاسم بيتغيّر والربط بيفضل.
 *
 * وعمود «عملاء» هو الحارس: منطقة بصفر عملاء يا إما جديدة يا إما اسم اتكتب ونُسي. النظام
 * القديم عنده مناطق اسمها «.» و«0» و«@@@» دخلت من غير ما حد يلاحظ.
 */

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
    } catch { /* الرسالة من المعترض العام */ }
  };

  const branchName = (id: number) => branches.find((b: any) => b.id === id)?.name || '—';

  // المنطقة الرئيسية = اللي مالهاش أب. والفرعية ماينفعش تبقى أب لواحدة تانية — مستويين وبس،
  // زي النظام القديم، لأن التلاتة بتخلّي التقارير تسأل «أجمّع على أنهي مستوى؟».
  const parents = useMemo(() => rows.filter((r) => !r.parent_id), [rows]);

  const visible = useMemo(() => {
    const q = query.trim();
    const list = q
      ? rows.filter((r) => [r.name, r.parent_name, branchName(r.branch_id)]
          .some((x) => (x || '').includes(q)))
      : rows;
    // الأب وتحته أولاده — الترتيب ده بيخلّي الشجرة مقروءة في جدول مسطّح.
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
          {!r.parent_id && <Tag color="blue" style={{ fontSize: 11 }}>رئيسية</Tag>}
        </Space>
      ),
    },
    {
      title: 'تحت منطقة', dataIndex: 'parent_id', key: 'parent_id', width: 190,
      render: (v: number | null, r: Territory) => (
        <Select size="small" style={{ width: '100%' }} allowClear placeholder="— رئيسية —"
          value={v ?? undefined}
          onChange={(x) => patch(r, { parent_id: x ?? 0 }, 'المنطقة الأب')}
          options={parents
            .filter((p) => p.id !== r.id && p.branch_id === r.branch_id)
            .map((p) => ({ value: p.id, label: p.name }))} />
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
    <Card
      title="المناطق"
      extra={
        <Space>
          {cols.control}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            setDraft({ name: '', branch_id: branches[0]?.id });
            setAdding(true);
          }}>منطقة جديدة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      }
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="المنطقة الرئيسية تجمع تحتها مناطق فرعية — «٦ أكتوبر» فوق «الحى الأول» و«الفردوس»."
        description="عمود «عملاء» يقول إن كانت المنطقة مستعملة فعلاً. والمنطقة التي عليها عملاء لا تُحذف — أوقفها بدلاً من ذلك، فيبقى اسمها مقروءاً على ما ارتبط بها." />

      <Input allowClear prefix={<SearchOutlined />} style={{ width: 300, marginBottom: 12 }}
        placeholder="بحث بالاسم أو الفرع"
        value={query} onChange={(e) => setQuery(e.target.value)} />

      <Table
        rowKey="id" size="small" loading={loading} dataSource={visible}
        columns={cols.columns} tableLayout="fixed" pagination={false}
        locale={{ emptyText: <Empty description="لا توجد مناطق" /> }}
      />

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
            options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
          <Select style={{ width: '100%' }} allowClear placeholder="تحت منطقة — اتركه فارغاً لمنطقة رئيسية"
            value={draft.parent_id}
            onChange={(v) => setDraft({ ...draft, parent_id: v })}
            options={parents.filter((p) => p.branch_id === draft.branch_id)
              .map((p) => ({ value: p.id, label: p.name }))} />
        </Space>
      </Modal>
    </Card>
  );
}

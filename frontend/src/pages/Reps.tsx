import React, { useEffect, useMemo, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Button, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tooltip, message,
} from 'antd';
import {
  CarOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined,
  StopOutlined, SwapOutlined, TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { Popconfirm } from '../components/noConfirm';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';

/**
 * المناديب — كل ما يخص المندوب في شاشة واحدة.
 *
 * المندوب مش جدول: هو مستخدم بدور «مندوب مبيعات»، وحواليه أربع حاجات كانت متفرّقة على أربع
 * شاشات — الموظف اللي بيربطه بمخزن عربيته، وعملاؤه، ومنطقته، وعهدته. واللي عايز يعرف
 * «المندوب ده مسؤول عن إيه» كان بيفتح الأربعة ويجمّع في دماغه.
 *
 * والأعمدة التلاتة على اليمين — عملاء وفواتير وأصناف — هي اللي بتفرّق بين مندوب في الشارع
 * وحساب اتعمل ونُسي: صفر في التلاتة يعني الحساب مالوش شغل.
 */

interface Rep {
  user_id: number; username: string; full_name: string; active: boolean;
  branch_id: number | null; branch_name: string | null;
  territory_id: number | null; territory_name: string | null;
  employee_id: number | null;
  warehouse_id: number | null; warehouse_name: string | null;
  custody_id: number | null;
  supervisor_id?: number | null; supervisor_name?: string | null;
  customer_count: number; invoice_count: number; stock_items: number;
}

/** فورم «مندوب جديد» و«تعديل مندوب» — نفس الخانات، والباسورد إجباري في الجديد بس. */
interface RepForm {
  full_name: string; username: string; password?: string;
  branch_id?: number; territory_id?: number; warehouse_id?: number; supervisor_id?: number;
}

export default function Reps() {
  const [rows, setRows] = useState<Rep[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // الشريحة في الرابط (`?tab=active|all`) — الريفرش بيرجع عليها وبيحمّل بنفس النطاق.
  const [listTab, setListTab] = useQueryTab('active');
  const showInactive = listTab === 'all';
  const [query, setQuery] = useState('');
  const [moveFrom, setMoveFrom] = useState<Rep | null>(null);
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const [supervisors, setSupervisors] = useState<any[]>([]);
  // `null` = مقفول، `'new'` = مندوب جديد، غير كده = المندوب اللي بيتعدّل.
  const [editing, setEditing] = useState<Rep | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<RepForm>();
  const formBranch = Form.useWatch('branch_id', form);
  const navigate = useNavigate();

  const load = async (inactive = showInactive) => {
    setLoading(true);
    try {
      const [r, b, t, w] = await Promise.all([
        api.get('/api/v1/reps', { params: { include_inactive: inactive } }),
        api.get('/api/v1/branches'),
        api.get('/api/v1/territories'),
        api.get('/api/v1/warehouses'),
      ]);
      setRows(r.data || []);
      setBranches(b.data || []);
      setTerritories(t.data || []);
      setWarehouses(w.data || []);
      // المشرفين (لخانة «المشرف») — اللي مالوش صلاحية يقرا المستخدمين بيكمّل من غيرها.
      api.get('/api/v1/users').then((u) => setSupervisors(
        (u.data || []).filter((x: any) => x.role === 'rep_supervisor' && x.active),
      )).catch(() => setSupervisors([]));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /** تعديل حقل واحد على مندوب — الشاشة بتتحدّث من رد السيرفر مش من التخمين. */
  const patch = async (rep: Rep, body: Record<string, any>, what: string) => {
    try {
      const res = await api.patch(`/api/v1/reps/${rep.user_id}`, body);
      setRows((prev) => prev.map((x) => (x.user_id === rep.user_id ? res.data : x)));
      message.success(`تم تعديل ${what}`);
    } catch { /* الرسالة بتيجي من المعترض العام */ }
  };

  const openNew = () => {
    form.resetFields();
    setEditing('new');
  };
  const openEdit = (r: Rep) => {
    form.resetFields();
    form.setFieldsValue({
      full_name: r.full_name, username: r.username,
      branch_id: r.branch_id ?? undefined, territory_id: r.territory_id ?? undefined,
      warehouse_id: r.warehouse_id ?? undefined, supervisor_id: r.supervisor_id ?? undefined,
    });
    setEditing(r);
  };

  /**
   * الحفظ على مرحلتين: الحساب نفسه من `/users` (الاسم والدخول والباسورد والفرع والمنطقة
   * والمشرف)، ومخزن البضاعة من `/reps` — هو اللي بيربط المندوب بالموظف وبمخزن عربيته.
   */
  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      let userId: number;
      if (editing === 'new') {
        const res = await api.post('/api/v1/users', {
          role: 'sales_rep', full_name: v.full_name.trim(), username: v.username.trim(),
          password: v.password, branch_id: v.branch_id, territory_id: v.territory_id,
          supervisor_id: v.supervisor_id ?? null,
        });
        userId = res.data.id;
      } else if (editing) {
        userId = editing.user_id;
        await api.patch(`/api/v1/users/${userId}`, {
          full_name: v.full_name.trim(), username: v.username.trim(),
          branch_id: v.branch_id, territory_id: v.territory_id,
          supervisor_id: v.supervisor_id ?? null,
          ...(v.password ? { password: v.password } : {}),
        });
      } else {
        return;
      }
      const before = editing === 'new' ? null : (editing?.warehouse_id ?? null);
      if ((v.warehouse_id ?? null) !== before) {
        await api.patch(`/api/v1/reps/${userId}`, { warehouse_id: v.warehouse_id ?? 0 });
      }
      message.success(editing === 'new' ? 'اتعمل المندوب' : 'اتعدّل المندوب');
      setEditing(null);
      load();
    } catch { /* الرسالة بتيجي من المعترض العام */ } finally {
      setSaving(false);
    }
  };

  /** الحذف للحساب اللي ماشتغلش بس — السيرفر بيرفض لو عليه شغل ويقول عليه إيه. */
  const remove = async (r: Rep) => {
    try {
      await api.delete(`/api/v1/users/${r.user_id}`);
      message.success('اتحذف المندوب');
      load();
    } catch { /* الرسالة بتيجي من المعترض العام */ }
  };

  const visible = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.username, r.full_name, r.branch_name, r.territory_name, r.warehouse_name]
        .some((x) => (x || '').includes(q)));
  }, [rows, query]);

  const columns = [
    {
      title: 'المندوب', dataIndex: 'full_name', key: 'full_name', width: 210,
      render: (v: string, r: Rep) => (
        <Space direction="vertical" size={0}>
          <b style={{ color: r.active ? undefined : '#bfbfbf' }}>{v}</b>
          <span style={{ fontSize: 14, color: '#555b65' }}>{r.username}</span>
        </Space>
      ),
    },
    {
      title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', width: 160,
      render: (v: number | null, r: Rep) => (
        <Select size="small" style={{ width: '100%' }} allowClear placeholder="بلا فرع"
          value={v ?? undefined}
          onChange={(x) => patch(r, { branch_id: x ?? 0 }, 'الفرع')}
          options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
      ),
    },
    {
      title: 'المنطقة', dataIndex: 'territory_id', key: 'territory_id', width: 170,
      render: (v: number | null, r: Rep) => (
        <Select showSearch size="small" style={{ width: '100%' }} allowClear placeholder="بلا منطقة"
          value={v ?? undefined}
          onChange={(x) => patch(r, { territory_id: x ?? 0 }, 'المنطقة')}
          // مناطق فرعه بس: منطقة في فرع تاني معناها مندوب بيزور مكان مش تبعه.
          options={territories
            .filter((t: any) => !r.branch_id || t.branch_id === r.branch_id)
            .map((t: any) => ({
              value: t.id,
              label: t.parent_name ? `${t.parent_name} ← ${t.name}` : t.name,
            }))} filterOption={searchFilter} filterSort={searchRank} />
      ),
    },
    {
      title: 'مخزن البضاعة', dataIndex: 'warehouse_id', key: 'warehouse_id', width: 200,
      render: (v: number | null, r: Rep) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <Select showSearch size="small" style={{ width: '100%' }} allowClear placeholder="بلا مخزن"
            value={v ?? undefined}
            onChange={(x) => patch(r, { warehouse_id: x ?? 0 }, 'المخزن')}
            options={warehouses
              .filter((w: any) => !r.branch_id || !w.branch_id || w.branch_id === r.branch_id)
              .map((w: any) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank} />
          {!v && !r.custody_id && (
            // من غير مكان بضاعة، التطبيق بيرد «مالكش عهدة ولا مخزن» ومابيزامنش أصلاً.
            <span style={{ fontSize: 14, color: '#cf1322' }}>التطبيق مش هيزامن من غير مخزن</span>
          )}
        </Space>
      ),
    },
    {
      title: 'المشرف', dataIndex: 'supervisor_name', key: 'supervisor_name', width: 150,
      render: (v: string | null) => <span style={{ color: v ? undefined : '#bfbfbf' }}>{v || '—'}</span>,
    },
    {
      title: 'عملاء', dataIndex: 'customer_count', key: 'customer_count', width: 90,
      align: 'center' as const,
      render: (v: number, r: Rep) => (
        <Space size={2}>
          <span style={{ fontWeight: v ? 600 : 400, color: v ? undefined : '#bfbfbf' }}>{v}</span>
          {v > 0 && (
            <Tooltip title="نقل عملاؤه لمندوب تاني">
              <Button type="text" size="small" icon={<SwapOutlined />}
                onClick={() => { setMoveFrom(r); setMoveTo(null); }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'فواتير', dataIndex: 'invoice_count', key: 'invoice_count', width: 80,
      align: 'center' as const,
      render: (v: number) => <span style={{ color: v ? undefined : '#bfbfbf' }}>{v}</span>,
    },
    {
      title: 'أصناف معاه', dataIndex: 'stock_items', key: 'stock_items', width: 100,
      align: 'center' as const,
      render: (v: number) => <span style={{ color: v ? undefined : '#bfbfbf' }}>{v}</span>,
    },
    {
      title: 'نشط', dataIndex: 'active', key: 'active', width: 80, align: 'center' as const,
      render: (v: boolean, r: Rep) => (
        <Switch size="small" checked={v}
          onChange={(x) => patch(r, { active: x }, x ? 'التفعيل' : 'الإيقاف')} />
      ),
    },
    {
      title: 'الإجراءات', key: 'actions', width: 170,
      render: (_: any, r: Rep) => (
        <Space size={2}>
          <Tooltip title="تعديل المندوب">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Tooltip title="عمليات المندوب (تقارير)">
            <Button type="text" size="small" icon={<TeamOutlined />}
              onClick={() => navigate(`/rep-reports?rep=${r.user_id}`)} />
          </Tooltip>
          {!r.invoice_count && !r.customer_count && (
            <Popconfirm
              title="حذف المندوب؟"
              description="مالوش فواتير ولا عملاء — الحساب هيتمسح نهائي."
              okText="حذف" cancelText="إلغاء" okButtonProps={{ danger: true }}
              onConfirm={() => remove(r)}
            >
              <Tooltip title="حذف (للي ماشتغلش بس)">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
          {/* إيقاف مش حذف — نفس قاعدة المخازن والموظفين. اسم المندوب مكتوب على فواتير
              وعُهد ومعاينات، والمسح بيخلّي المستندات القديمة تقول «#١٦» بدل اسمه.
              المفتاح في عمود «نشط» بيعمل نفس الحاجة؛ الزرار هنا عشان الإجراء يبان
              في نفس المكان اللي بيتدوّر عليه فيه في باقي الشاشات. */}
          {r.active && (
            <Popconfirm
              title="إيقاف المندوب؟"
              description={
                (r.customer_count || 0) > 0
                  ? `عليه ${r.customer_count} عميل — هيفضلوا مربوطين بيه، بس مش هيظهر في `
                    + 'قوايم الاختيار. انقل عملاءه الأول لو ده مش المطلوب.'
                  : 'مش هيظهر في قوايم الاختيار. مستنداته القديمة بتفضل باسمه.'
              }
              okText="إيقاف"
              cancelText="إلغاء"
              okButtonProps={{ danger: true }}
              onConfirm={() => patch(r, { active: false }, 'الإيقاف')}
            >
              <Tooltip title="إيقاف المندوب">
                <Button type="text" size="small" danger icon={<StopOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const cols = useTableColumns('reps', columns as any, {
    locked: ['full_name'],
    export: { name: 'المناديب', rows: visible },
  });
  const others = rows.filter((r) => r.user_id !== moveFrom?.user_id && r.active);

  // مفتاح «يشمل الموقوفين» بقى شريحتين — نفس الطلب للسيرفر.
  type RepTab = 'active' | 'all';
  const repTab: RepTab = showInactive ? 'all' : 'active';

  return (
    <>
    <ListPage<RepTab>
      icon={<CarOutlined />}
      title="المناديب"
      subtitle="فرع كل مندوب ومنطقته ومخزن بضاعته وعملاؤه في شاشة واحدة"
      tabs={[
        { key: 'active', label: 'النشطين', dot: '#52c41a', count: showInactive ? undefined : rows.length },
        { key: 'all', label: 'يشمل الموقوفين', count: showInactive ? rows.length : undefined },
      ]}
      activeTab={repTab}
      onTabChange={(k) => { setListTab(k); load(k === 'all'); }}
      actions={(<>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>مندوب جديد</Button>
        <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
        {cols.control}
      </>)}
      filters={(
        <Input className="sl-f-search" allowClear prefix={<SearchOutlined />}
          placeholder="بحث بالاسم أو الفرع أو المنطقة"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
    >
      <Table
        className="sl-table"
        rowKey="user_id"
        size="small"
        loading={loading}
        dataSource={visible}
        columns={cols.columns}
        tableLayout="fixed"
        pagination={false}
        locale={{ emptyText: <Empty description="لا يوجد مناديب" /> }}
      />
    </ListPage>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'مندوب جديد' : `تعديل «${(editing as Rep | null)?.full_name || ''}»`}
        okText="حفظ" cancelText="إلغاء" confirmLoading={saving}
        onCancel={() => setEditing(null)} onOk={save} destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item name="full_name" label="اسم المندوب" rules={[{ required: true, message: 'اكتب الاسم' }]}>
            <Input placeholder="مثلاً: مندوب السياره ( ه )" />
          </Form.Item>
          <Form.Item name="username" label="اسم الدخول (للتطبيق)"
            rules={[{ required: true, message: 'اكتب اسم الدخول' }, { min: 2, message: 'حرفين على الأقل' }]}>
            <Input dir="ltr" placeholder="car.e" autoComplete="off" />
          </Form.Item>
          <Form.Item name="password"
            label={editing === 'new' ? 'كلمة السر' : 'كلمة سر جديدة (سيبها فاضية لو مش هتتغيّر)'}
            rules={editing === 'new' ? [{ required: true, message: 'اكتب كلمة السر' }] : []}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="branch_id" label="الفرع" rules={[{ required: true, message: 'اختار الفرع' }]}>
            <Select placeholder="الفرع"
              onChange={() => form.setFieldsValue({
                territory_id: undefined, warehouse_id: undefined, supervisor_id: undefined,
              })}
              options={branches.map((b: any) => ({ value: b.id, label: b.name }))} />
          </Form.Item>
          <Form.Item name="territory_id" label="المنطقة" rules={[{ required: true, message: 'اختار المنطقة' }]}>
            <Select showSearch placeholder="المنطقة" filterOption={searchFilter} filterSort={searchRank}
              options={territories
                .filter((t: any) => !formBranch || t.branch_id === formBranch)
                .map((t: any) => ({
                  value: t.id, label: t.parent_name ? `${t.parent_name} ← ${t.name}` : t.name,
                }))} />
          </Form.Item>
          <Form.Item name="warehouse_id" label="مخزن البضاعة (عربيته)"
            extra="من غير مخزن التطبيق مش هيزامن">
            <Select showSearch allowClear placeholder="بلا مخزن" filterOption={searchFilter} filterSort={searchRank}
              options={warehouses
                .filter((w: any) => !formBranch || !w.branch_id || w.branch_id === formBranch)
                .map((w: any) => ({ value: w.id, label: w.name }))} />
          </Form.Item>
          <Form.Item name="supervisor_id" label="المشرف"
            extra={supervisors.some((x) => x.branch_id === formBranch) ? undefined : 'مافيش «مشرف مناديب» على الفرع ده'}>
            <Select allowClear placeholder="من غير مشرف"
              options={supervisors
                .filter((x) => x.branch_id === formBranch)
                .map((x) => ({ value: x.id, label: x.full_name || x.username }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(moveFrom)}
        title={`نقل عملاء «${moveFrom?.full_name || ''}»`}
        okText="انقل"
        cancelText="إلغاء"
        okButtonProps={{ disabled: !moveTo, danger: true }}
        onCancel={() => setMoveFrom(null)}
        onOk={async () => {
          if (!moveFrom || !moveTo) return;
          const list = await api.get('/api/v1/customers', { params: { rep_id: moveFrom.user_id } });
          const ids = (list.data || []).map((c: any) => c.id);
          const res = await api.post(`/api/v1/reps/${moveFrom.user_id}/customers`,
            { customer_ids: ids, to_rep_id: moveTo });
          message.success(`اتنقل ${res.data.moved} عميل`);
          setMoveFrom(null);
          load();
        }}
      >
        <p>
          هيتنقل <b>{moveFrom?.customer_count}</b> عميل. والفواتير القديمة بتفضل باسم المندوب
          اللي باعها — اللي باع هو اللي باع، والعميل وحده هو اللي بيتحرّك.
        </p>
        <Select showSearch style={{ width: '100%' }} placeholder="المندوب المنقول له"
          value={moveTo ?? undefined} onChange={setMoveTo}
          options={others.map((r) => ({
            value: r.user_id,
            label: `${r.full_name}${r.branch_name ? ` — ${r.branch_name}` : ''}`,
          }))} filterOption={searchFilter} filterSort={searchRank} />
      </Modal>
    </>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Empty, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, message,
} from 'antd';
import {
  ReloadOutlined, SearchOutlined, StopOutlined, SwapOutlined, TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { Popconfirm } from '../components/noConfirm';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';

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
  customer_count: number; invoice_count: number; stock_items: number;
}

export default function Reps() {
  const [rows, setRows] = useState<Rep[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [territories, setTerritories] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [query, setQuery] = useState('');
  const [moveFrom, setMoveFrom] = useState<Rep | null>(null);
  const [moveTo, setMoveTo] = useState<number | null>(null);
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
          <span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.username}</span>
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
        <Select size="small" style={{ width: '100%' }} allowClear placeholder="بلا منطقة"
          value={v ?? undefined}
          onChange={(x) => patch(r, { territory_id: x ?? 0 }, 'المنطقة')}
          // مناطق فرعه بس: منطقة في فرع تاني معناها مندوب بيزور مكان مش تبعه.
          options={territories
            .filter((t: any) => !r.branch_id || t.branch_id === r.branch_id)
            .map((t: any) => ({
              value: t.id,
              label: t.parent_name ? `${t.parent_name} ← ${t.name}` : t.name,
            }))} />
      ),
    },
    {
      title: 'مخزن البضاعة', dataIndex: 'warehouse_id', key: 'warehouse_id', width: 200,
      render: (v: number | null, r: Rep) => (
        <Space direction="vertical" size={0} style={{ width: '100%' }}>
          <Select size="small" style={{ width: '100%' }} allowClear placeholder="بلا مخزن"
            value={v ?? undefined}
            onChange={(x) => patch(r, { warehouse_id: x ?? 0 }, 'المخزن')}
            options={warehouses
              .filter((w: any) => !r.branch_id || !w.branch_id || w.branch_id === r.branch_id)
              .map((w: any) => ({ value: w.id, label: w.name }))} />
          {!v && !r.custody_id && (
            // من غير مكان بضاعة، التطبيق بيرد «مالكش عهدة ولا مخزن» ومابيزامنش أصلاً.
            <span style={{ fontSize: 11, color: '#cf1322' }}>التطبيق مش هيزامن من غير مخزن</span>
          )}
        </Space>
      ),
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
      title: 'الإجراءات', key: 'actions', width: 130,
      render: (_: any, r: Rep) => (
        <Space size={2}>
          <Tooltip title="تقارير المندوب">
            <Button type="text" size="small" icon={<TeamOutlined />}
              onClick={() => navigate(`/rep-reports?rep=${r.user_id}`)} />
          </Tooltip>
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

  const cols = useTableColumns('reps', columns as any, { locked: ['full_name'] });
  const others = rows.filter((r) => r.user_id !== moveFrom?.user_id && r.active);

  return (
    <Card
      title="المناديب"
      extra={
        <Space>
          {cols.control}
          <Space size={4}>
            <Switch size="small" checked={showInactive}
              onChange={(v) => { setShowInactive(v); load(v); }} />
            <span style={{ fontSize: 12 }}>يشمل الموقوفين</span>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
        </Space>
      }
    >
      <Input allowClear prefix={<SearchOutlined />} style={{ width: 320, marginBottom: 12 }}
        placeholder="بحث بالاسم أو الفرع أو المنطقة"
        value={query} onChange={(e) => setQuery(e.target.value)} />

      <Table
        rowKey="user_id"
        size="small"
        loading={loading}
        dataSource={visible}
        columns={cols.columns}
        tableLayout="fixed"
        pagination={false}
        locale={{ emptyText: <Empty description="لا يوجد مناديب" /> }}
      />

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
        <Select style={{ width: '100%' }} placeholder="المندوب المنقول له"
          value={moveTo ?? undefined} onChange={setMoveTo}
          options={others.map((r) => ({
            value: r.user_id,
            label: `${r.full_name}${r.branch_name ? ` — ${r.branch_name}` : ''}`,
          }))} />
      </Modal>
    </Card>
  );
}

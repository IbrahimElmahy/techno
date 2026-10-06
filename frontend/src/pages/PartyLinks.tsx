import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, DatePicker, Empty, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space,
  Table, Tag, Tooltip, message,
} from 'antd';
import { LinkOutlined, DisconnectOutlined, ReloadOutlined, SwapOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { searchFilter, searchRank } from '../utils/arabicSort';

/**
 * الأطراف المرتبطة — المرحلة ٢ (٢٠٢٦-١٠-٠٦).
 *
 * الشخص (أو الفرع) اللي بنبيع له ونشتري منه ليه كارت عميل وكارت مورد — في a5 وعندنا. هنا
 * بيتربطوا في «طرف» واحد: أرصدته كلها في سطر وصافيها، ومنه «مقاصة» بين اللي عليه كعميل
 * واللي ليه كمورد بقيد واحد من غير فلوس. والكروت نفسها مابتتلمّش — كل كارت بحسابه وتاريخه.
 *
 * الصافي موجب = عليه لينا، سالب = ليه عندنا.
 */
interface Member {
  kind: 'customer' | 'supplier'; ref_id: number; name: string; role: string; code: string | null;
  branch_name: string | null; balance: string;
  lines: { family: string | null; account_id: number; balance: string }[];
}
interface Group {
  id: number; name: string; branch_name: string | null; members: Member[];
  owes_us: string; we_owe: string; net: string;
}
interface Suggestion {
  name: string; branch_id: number | null; branch_name: string | null; customer: Member; supplier: Member;
}

const fmt = (v: string | number) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Net({ v }: { v: string | number }) {
  const n = Number(v || 0);
  return (
    <Space size={4}>
      <b dir="ltr" style={{ color: n > 0 ? '#cf1322' : n < 0 ? '#389e0d' : undefined }}>{fmt(Math.abs(n))}</b>
      {n !== 0 && <Tag color={n > 0 ? 'red' : 'green'}>{n > 0 ? 'عليه' : 'ليه'}</Tag>}
    </Space>
  );
}

function MemberTag({ m }: { m: Member }) {
  const color = m.kind === 'supplier' ? 'purple' : m.role === 'موظف' ? 'gold' : m.role === 'فرع' ? 'cyan' : 'blue';
  return (
    <Tooltip title={`${m.code || ''}${m.branch_name ? ` · ${m.branch_name}` : ''}`}>
      <Tag color={color} style={{ marginBottom: 4 }}>
        {m.role}: {m.name} — <span dir="ltr">{fmt(m.balance)}</span>
      </Tag>
    </Tooltip>
  );
}

export default function PartyLinks() {
  const [tab, setTab] = useQueryTab('linked');
  const [groups, setGroups] = useState<Group[]>([]);
  const [suggs, setSuggs] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [netGroup, setNetGroup] = useState<Group | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkForm] = Form.useForm();
  const [netForm] = Form.useForm();
  const netCustomer = Form.useWatch('customer_id', netForm);

  const load = async () => {
    setLoading(true);
    try {
      const [g, s] = await Promise.all([
        api.get('/api/v1/party-groups'),
        api.get('/api/v1/party-groups/suggestions'),
      ]);
      setGroups(g.data || []);
      setSuggs(s.data || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openLink = () => {
    linkForm.resetFields();
    if (!customers.length) api.get('/api/v1/customers').then((r) => setCustomers(r.data || [])).catch(() => {});
    if (!suppliers.length) api.get('/api/v1/suppliers').then((r) => setSuppliers(r.data || [])).catch(() => {});
    setLinkOpen(true);
  };

  const link = async (members: { kind: string; ref_id: number }[], name?: string) => {
    await api.post('/api/v1/party-groups', { members, name: name || undefined });
  };

  const saveLink = async () => {
    const v = await linkForm.validateFields();
    const members = [
      ...(v.customer_ids || []).map((id: number) => ({ kind: 'customer', ref_id: id })),
      ...(v.supplier_ids || []).map((id: number) => ({ kind: 'supplier', ref_id: id })),
    ];
    if (members.length < 2) {
      message.error('اختار كارتين على الأقل');
      return;
    }
    setSaving(true);
    try {
      await link(members, v.name);
      message.success('اتربطوا');
      setLinkOpen(false);
      load();
    } catch { /* المعترض العام */ } finally {
      setSaving(false);
    }
  };

  const linkSuggestion = async (s: Suggestion) => {
    try {
      await link([{ kind: 'customer', ref_id: s.customer.ref_id }, { kind: 'supplier', ref_id: s.supplier.ref_id }]);
      message.success(`اتربط «${s.name}»`);
      load();
    } catch { /* المعترض العام */ }
  };

  const linkAll = async () => {
    let n = 0;
    for (const s of suggs) {
      try {
        await link([{ kind: 'customer', ref_id: s.customer.ref_id }, { kind: 'supplier', ref_id: s.supplier.ref_id }]);
        n += 1;
      } catch { /* اللي فشل بيفضل في الاقتراحات */ }
    }
    message.success(`اتربط ${n} طرف`);
    load();
  };

  const unlink = async (g: Group, m: Member) => {
    try {
      await api.delete(`/api/v1/party-groups/${g.id}/members/${m.kind}/${m.ref_id}`);
      message.success('اتفك');
      load();
    } catch { /* المعترض العام */ }
  };

  const openNetting = (g: Group) => {
    netForm.resetFields();
    const c = g.members.find((m) => m.kind === 'customer' && Number(m.balance) > 0)
      || g.members.find((m) => m.kind === 'customer');
    const s = g.members.find((m) => m.kind === 'supplier' && Number(m.balance) > 0)
      || g.members.find((m) => m.kind === 'supplier');
    netForm.setFieldsValue({
      customer_id: c?.ref_id, supplier_id: s?.ref_id, entry_date: dayjs(),
      amount: c && s ? Math.max(0, Math.min(Number(c.balance), Number(s.balance))) || undefined : undefined,
    });
    setNetGroup(g);
  };

  const netLines = useMemo(() => {
    const m = netGroup?.members.find((x) => x.kind === 'customer' && x.ref_id === netCustomer);
    return (m?.lines || []).filter((l) => l.family);
  }, [netGroup, netCustomer]);

  const saveNetting = async () => {
    if (!netGroup) return;
    const v = await netForm.validateFields();
    setSaving(true);
    try {
      await api.post(`/api/v1/party-groups/${netGroup.id}/netting`, {
        customer_id: v.customer_id, supplier_id: v.supplier_id, amount: v.amount,
        family: v.family || undefined, description: v.description || undefined,
        entry_date: v.entry_date ? v.entry_date.format('YYYY-MM-DD') : undefined,
      });
      message.success('اتسجّلت المقاصة');
      setNetGroup(null);
      load();
    } catch { /* المعترض العام */ } finally {
      setSaving(false);
    }
  };

  const shown = groups.filter((g) => !q.trim() || g.name.includes(q.trim())
    || g.members.some((m) => m.name.includes(q.trim())));
  const totals = useMemo(() => ({
    owes: groups.reduce((a, g) => a + Number(g.owes_us), 0),
    owe: groups.reduce((a, g) => a + Number(g.we_owe), 0),
  }), [groups]);

  const groupCols = [
    { title: 'الطرف', dataIndex: 'name', key: 'name', width: 200,
      render: (v: string, g: Group) => (
        <Space direction="vertical" size={0}><b>{v}</b>
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>{g.branch_name || ''}</span></Space>
      ) },
    { title: 'الكروت', key: 'members',
      render: (_: any, g: Group) => (
        <div>{g.members.map((m) => (
          <span key={`${m.kind}-${m.ref_id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <MemberTag m={m} />
            <Popconfirm title={`فك «${m.name}» من الطرف؟`} okText="فك" cancelText="إلغاء"
              onConfirm={() => unlink(g, m)}>
              <Button type="text" size="small" icon={<DisconnectOutlined />} style={{ marginInlineEnd: 6 }} />
            </Popconfirm>
          </span>
        ))}</div>
      ) },
    { title: 'عليه كعميل', dataIndex: 'owes_us', key: 'owes', width: 130, align: 'right' as const,
      render: (v: string) => <span dir="ltr">{fmt(v)}</span> },
    { title: 'ليه كمورد', dataIndex: 'we_owe', key: 'owe', width: 130, align: 'right' as const,
      render: (v: string) => <span dir="ltr">{fmt(v)}</span> },
    { title: 'الصافي', dataIndex: 'net', key: 'net', width: 150, align: 'right' as const,
      render: (v: string) => <Net v={v} /> },
    { title: '', key: 'act', width: 110,
      render: (_: any, g: Group) => {
        const can = g.members.some((m) => m.kind === 'customer') && g.members.some((m) => m.kind === 'supplier');
        return (
          <Button size="small" icon={<SwapOutlined />} disabled={!can} onClick={() => openNetting(g)}>مقاصة</Button>
        );
      } },
  ];

  const suggCols = [
    { title: 'الاسم', dataIndex: 'name', key: 'name', width: 220, render: (v: string) => <b>{v}</b> },
    { title: 'الفرع', dataIndex: 'branch_name', key: 'branch', width: 110 },
    { title: 'كعميل', key: 'c', render: (_: any, s: Suggestion) => <MemberTag m={s.customer} /> },
    { title: 'كمورد', key: 's', render: (_: any, s: Suggestion) => <MemberTag m={s.supplier} /> },
    { title: '', key: 'act', width: 90,
      render: (_: any, s: Suggestion) => (
        <Button size="small" type="primary" icon={<LinkOutlined />} onClick={() => linkSuggestion(s)}>اربط</Button>
      ) },
  ];

  return (
    <ListPage<'linked' | 'suggest'>
      icon={<TeamOutlined />}
      title="الأطراف المرتبطة"
      subtitle="عميل ومورد (أو موظف/فرع) هما نفس الشخص — أرصدته كلها والصافي، والمقاصة بينهم"
      tabs={[
        { key: 'linked', label: 'المرتبطين', count: groups.length },
        { key: 'suggest', label: 'اقتراحات', count: suggs.length, dot: suggs.length ? '#faad14' : undefined },
      ]}
      activeTab={tab === 'suggest' ? 'suggest' : 'linked'}
      onTabChange={(k) => setTab(k)}
      summary={tab !== 'suggest' ? (
        <>
          <ListStat label="عليهم كعملاء" value={fmt(totals.owes)} />
          <ListStat label="ليهم كموردين" value={fmt(totals.owe)} />
          <ListStat label="الصافي" value={fmt(Math.abs(totals.owes - totals.owe))}
            tone={totals.owes - totals.owe > 0 ? 'neg' : 'pos'}
            hint={totals.owes - totals.owe > 0 ? 'عليهم' : 'ليهم'} />
        </>
      ) : undefined}
      actions={(
        <>
          <Button type="primary" icon={<LinkOutlined />} onClick={openLink}>ربط كروت</Button>
          {tab === 'suggest' && suggs.length > 0 && (
            <Popconfirm title={`ربط الـ${suggs.length} اقتراح كلهم؟`} okText="اربط" cancelText="إلغاء" onConfirm={linkAll}>
              <Button>اربط الكل</Button>
            </Popconfirm>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>
      )}
      filters={tab !== 'suggest' ? (
        <Input allowClear placeholder="بحث بالاسم" value={q} onChange={(e) => setQ(e.target.value)} />
      ) : undefined}
    >
      {tab === 'suggest' ? (
        <Table<Suggestion> className="sl-table" size="small" loading={loading}
          rowKey={(s) => `${s.customer.ref_id}-${s.supplier.ref_id}`}
          dataSource={suggs} columns={suggCols as any} pagination={false}
          locale={{ emptyText: <Empty description="مافيش عميل ومورد بنفس الاسم مش مربوطين" /> }} />
      ) : (
        <Table<Group> className="sl-table" size="small" loading={loading} rowKey="id"
          dataSource={shown} columns={groupCols as any} pagination={false}
          locale={{ emptyText: <Empty description="مافيش أطراف مرتبطة — شوف «اقتراحات» أو «ربط كروت»" /> }} />
      )}

      <Modal open={linkOpen} title="ربط كروت في طرف واحد" okText="اربط" cancelText="إلغاء"
        confirmLoading={saving} onCancel={() => setLinkOpen(false)} onOk={saveLink} destroyOnClose>
        <Form form={linkForm} layout="vertical">
          <Form.Item name="name" label="اسم الطرف" extra="فاضي = اسم أول كارت">
            <Input />
          </Form.Item>
          <Form.Item name="customer_ids" label="كروت العملاء / الموظفين / الفروع">
            <Select mode="multiple" showSearch filterOption={searchFilter} filterSort={searchRank}
              options={customers.map((c: any) => ({ value: c.id, label: `${c.name}${c.code ? ` — ${c.code}` : ''}` }))} />
          </Form.Item>
          <Form.Item name="supplier_ids" label="كروت الموردين">
            <Select mode="multiple" showSearch filterOption={searchFilter} filterSort={searchRank}
              options={suppliers.map((s: any) => ({ value: s.id, label: `${s.name}${s.code ? ` — ${s.code}` : ''}` }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={netGroup !== null} title={`مقاصة — ${netGroup?.name || ''}`} okText="تسجيل المقاصة"
        cancelText="إلغاء" confirmLoading={saving} onCancel={() => setNetGroup(null)} onOk={saveNetting} destroyOnClose>
        <p style={{ color: '#595959' }}>
          اللي عليه كعميل بيتخصم من اللي ليه كمورد — قيد واحد من غير فلوس (مدين المورد، دائن العميل).
        </p>
        <Form form={netForm} layout="vertical">
          <Form.Item name="customer_id" label="من رصيده كعميل" rules={[{ required: true }]}>
            <Select options={(netGroup?.members || []).filter((m) => m.kind === 'customer')
              .map((m) => ({ value: m.ref_id, label: `${m.name} — عليه ${fmt(m.balance)}` }))} />
          </Form.Item>
          {netLines.length >= 2 && (
            <Form.Item name="family" label="على أنهي حساب؟" rules={[{ required: true, message: 'اختار الحساب' }]}>
              <Segmented options={netLines.map((l) => ({ value: l.family as string, label: `${l.family} (${fmt(l.balance)})` }))} />
            </Form.Item>
          )}
          <Form.Item name="supplier_id" label="مقابل رصيده كمورد" rules={[{ required: true }]}>
            <Select options={(netGroup?.members || []).filter((m) => m.kind === 'supplier')
              .map((m) => ({ value: m.ref_id, label: `${m.name} — ليه ${fmt(m.balance)}` }))} />
          </Form.Item>
          <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'اكتب المبلغ' }]}
            extra="مايعديش أقل الرصيدين">
            <InputNumber min={0.01} style={{ width: '100%' }} dir="ltr" />
          </Form.Item>
          <Form.Item name="entry_date" label="التاريخ"><DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" /></Form.Item>
          <Form.Item name="description" label="البيان"><Input /></Form.Item>
        </Form>
      </Modal>
    </ListPage>
  );
}

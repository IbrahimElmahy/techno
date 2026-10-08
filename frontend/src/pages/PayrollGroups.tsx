import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Checkbox, Col, Divider, Empty, Input, Row, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import {
  AppstoreOutlined, ArrowDownOutlined, ArrowUpOutlined, ClearOutlined, CopyOutlined, DeleteOutlined,
  EditOutlined, FileExcelOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined,
  TableOutlined, TeamOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import { api, getViewBranch } from '../api/client';
import { useAuth } from '../components/AuthProvider';
import ListPage, { ListStat } from '../components/ListPage';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import { TabModal } from '../components/TabModal';
import { useTabsOptional } from '../components/TabsContext';
import { useQueryTab } from '../components/useQueryTab';
import { useScreenShortcuts } from '../components/keyboard';
import { printReport } from '../print/reportSheet';
import { exportExcel } from '../utils/exportExcel';
import { matchesWords, normalizeAr, searchFilter, searchRank } from '../utils/arabicSort';

interface Col {
  key?: string; label: string; source: string; ref?: any; kind?: 'earning' | 'deduction' | null;
  posting?: string | null; carry?: boolean; fallback_component_id?: number | null;
}
interface Member { employee_id: number; code: string; name: string; active: boolean; sort_order: number }
interface Group {
  id: number; branch_id: number; name: string; sort_order: number; columns: Col[];
  absence_base: string[]; absence_divisor: number; active: boolean; notes: string | null;
  members: Member[];
}
interface Catalog {
  sources: { source: string; label: string; kind: string | null; hint: string }[];
  commission_keys: { ref: string; label: string; kind: string }[];
  postings: { value: string; label: string }[];
  components: { id: number; code: string; name: string; kind: string }[];
}
interface BranchMember {
  employee_id: number; code: string; name: string; group_id: number | null;
  group_name: string | null; sort_order: number | null; has_salary: boolean;
}

const SOURCE_TAG: Record<string, string> = {
  basic: 'green', component: 'green', commission: 'purple', absence: 'red', advances: 'orange',
  penalties: 'red', bonuses: 'cyan', insurance: 'orange', manual: 'default',
};

const fail = (err: any, fallback: string) => {
  const detail = err?.response?.data?.detail;
  message.error((typeof detail === 'string' ? detail : detail?.message) || fallback, 6);
};

const keyOf = (c: Col, i: number) => {
  if (c.key) return c.key;
  if (c.source === 'component') return `component:${c.ref}`;
  if (c.source === 'commission') return `commission:${c.ref}`;
  if (c.source === 'manual') return `manual:${c.ref || `new${i}`}`;
  return c.source;
};

export default function PayrollGroups() {
  const { user } = useAuth();
  const tabs = useTabsOptional();
  const seesAll = !user?.branch_id || ['system_admin', 'owner'].includes(String(user?.role));
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [branchId, setBranchId] = useState<number | null>(
    seesAll ? (getViewBranch() ?? null) : (user?.branch_id ?? null));
  const [tab, setTab] = useQueryTab('groups');
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<BranchMember[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<number | 'none' | undefined>(undefined);
  const [selected, setSelected] = useState<number[]>([]);
  const [target, setTarget] = useState<number | null | undefined>(undefined);
  const [copyFrom, setCopyFrom] = useState<number | undefined>(undefined);
  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const [editing, setEditing] = useState<Partial<Group> | null>(null);
  const [cols, setCols] = useState<Col[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/v1/branches').then((r) => {
      const list = (r.data || []).filter((b: any) => b.active !== false);
      setBranches(list);
      if (seesAll && branchId === null && list.length) setBranchId(list[0].id);
    }).catch(() => {});
    api.get('/api/v1/hr/payroll-sheet/catalog').then((r) => setCatalog(r.data)).catch(() => {});
  }, []);

  const load = async (b = branchId) => {
    if (!b) return;
    setLoading(true);
    try {
      const [g, m] = await Promise.all([
        api.get('/api/v1/hr/payroll-sheet/groups', { params: { branch_id: b } }),
        api.get('/api/v1/hr/payroll-sheet/members', { params: { branch_id: b } }),
      ]);
      setGroups(g.data || []);
      setMembers(m.data || []);
      setSelected([]);
    } catch (err: any) { fail(err, 'تعذر التحميل'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [branchId]);

  const branchName = (id: number | null | undefined) => branches.find((b) => b.id === id)?.name || '';
  const compName = (id: any) => catalog?.components.find((c) => c.id === Number(id))?.name;

  const applyTemplate = async () => {
    try {
      const res = await api.post('/api/v1/hr/payroll-sheet/groups/template', { branch_id: branchId });
      const made = res.data.created || [];
      message.success(made.length ? `تم إنشاء: ${made.join('، ')}` : 'مجموعات الملف موجودة بالفعل');
      load();
      api.get('/api/v1/hr/payroll-sheet/catalog').then((r) => setCatalog(r.data)).catch(() => {});
    } catch (err: any) { fail(err, 'تعذر التنفيذ'); }
  };

  const copyGroups = async () => {
    if (!copyFrom) { message.warning('اختر الفرع المراد النسخ منه'); return; }
    try {
      const res = await api.post('/api/v1/hr/payroll-sheet/groups/copy',
        { from_branch_id: copyFrom, to_branch_id: branchId });
      const made = res.data.created || [];
      message.success(made.length ? `تم نسخ: ${made.join('، ')}` : 'لا توجد مجموعات جديدة للنسخ');
      setCopyFrom(undefined);
      load();
    } catch (err: any) { fail(err, 'تعذر النسخ'); }
  };

  const move = async (g: Group, dir: -1 | 1) => {
    const ids = groups.map((x) => x.id);
    const i = ids.indexOf(g.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api.post('/api/v1/hr/payroll-sheet/groups/order', { branch_id: branchId, ids });
      load();
    } catch (err: any) { fail(err, 'تعذر الترتيب'); }
  };

  const remove = async (g: Group) => {
    try {
      await api.delete(`/api/v1/hr/payroll-sheet/groups/${g.id}`);
      message.success(`تم حذف «${g.name}» — الشهور التي جُهّزت بها باقية كما هي`);
      load();
    } catch (err: any) { fail(err, 'تعذر الحذف'); }
  };

  const openEditor = (g?: Group) => {
    if (g) {
      setEditing({ ...g });
      setCols(g.columns.map((c) => ({ ...c })));
    } else {
      setEditing({ name: '', absence_divisor: 30, absence_base: ['basic'], active: true, notes: '' });
      setCols([
        { source: 'basic', label: 'اساسى', kind: 'earning' },
        { source: 'absence', label: 'غياب', kind: 'deduction', posting: 'reduce' },
        { source: 'advances', label: 'سلف', kind: 'deduction', posting: 'advance' },
      ]);
    }
  };

  const kindOf = (c: Col): string | null | undefined => {
    if (!catalog) return c.kind;
    if (c.source === 'component') return catalog.components.find((x) => x.id === Number(c.ref))?.kind;
    if (c.source === 'commission') return catalog.commission_keys.find((x) => x.ref === c.ref)?.kind;
    if (c.source === 'manual') return c.kind;
    return catalog.sources.find((x) => x.source === c.source)?.kind;
  };

  const setCol = (i: number, patch: Partial<Col>) => setCols(cols.map((c, j) => {
    if (j !== i) return c;
    const next: Col = { ...c, ...patch };
    if (patch.source && patch.source !== c.source) {
      const meta = catalog?.sources.find((s) => s.source === patch.source);
      next.ref = undefined;
      next.key = undefined;
      next.label = meta && !['component', 'commission', 'manual'].includes(patch.source) ? meta.label : '';
      next.kind = (meta?.kind as any) ?? (patch.source === 'manual' ? 'earning' : null);
      next.posting = undefined;
      if (patch.source === 'manual') next.ref = `m${Date.now().toString(36)}`;
    }
    if (patch.ref !== undefined && patch.ref !== c.ref) {
      next.key = undefined;
      if (c.source === 'component') next.label = compName(patch.ref) || next.label;
      if (c.source === 'commission') {
        next.label = catalog?.commission_keys.find((k) => k.ref === patch.ref)?.label || next.label;
      }
    }
    return next;
  }));

  const moveCol = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    setCols(next);
  };

  const earningKeys = cols.map((c, i) => ({ c, key: keyOf(c, i) }))
    .filter(({ c }) => kindOf(c) === 'earning');

  const save = async () => {
    if (!editing) return;
    if (!(editing.name || '').trim()) { message.warning('أدخل اسم المجموعة'); return; }
    for (const c of cols) {
      if ((c.source === 'component' || c.source === 'commission') && !c.ref) {
        message.warning('يوجد عمود ناقص: اختر البند أو نوع العمولة'); return;
      }
    }
    setSaving(true);
    const body = {
      branch_id: branchId, name: editing.name, absence_divisor: editing.absence_divisor || 30,
      absence_base: editing.absence_base || [], active: editing.active !== false,
      notes: editing.notes || null,
      columns: cols.map((c) => ({
        source: c.source, ref: c.ref ?? null, label: c.label, kind: kindOf(c) ?? c.kind ?? null,
        posting: c.posting ?? null, carry: !!c.carry,
        fallback_component_id: c.fallback_component_id ?? null,
      })),
    };
    try {
      if (editing.id) await api.put(`/api/v1/hr/payroll-sheet/groups/${editing.id}`, body);
      else await api.post('/api/v1/hr/payroll-sheet/groups', body);
      message.success('تم حفظ المجموعة');
      setEditing(null);
      load();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const assign = async (ids: number[], groupId: number | null) => {
    if (!ids.length) return;
    try {
      const res = await api.post('/api/v1/hr/payroll-sheet/members',
        { branch_id: branchId, employee_ids: ids, group_id: groupId });
      message.success(`تم توزيع ${res.data.changed} موظف`);
      setTarget(undefined);
      load();
    } catch (err: any) { fail(err, 'تعذر التوزيع'); }
  };

  const moveMember = async (m: BranchMember, dir: -1 | 1) => {
    if (!m.group_id) return;
    const same = members.filter((x) => x.group_id === m.group_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const ids = same.map((x) => x.employee_id);
    const i = ids.indexOf(m.employee_id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api.post(`/api/v1/hr/payroll-sheet/groups/${m.group_id}/members/order`, { ids });
      load();
    } catch (err: any) { fail(err, 'تعذر الترتيب'); }
  };

  const shownMembers = useMemo(() => {
    const q = normalizeAr(query.trim());
    let list = members.filter((m) => !q || matchesWords(normalizeAr(`${m.code} ${m.name} ${m.group_name || ''}`), q));
    if (groupFilter === 'none') list = list.filter((m) => !m.group_id);
    else if (groupFilter) {
      list = list.filter((m) => m.group_id === groupFilter)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return list;
  }, [members, query, groupFilter]);

  const shownGroups = groups.filter((g) => !query.trim()
    || matchesWords(normalizeAr(`${g.name} ${g.columns.map((c) => c.label).join(' ')}`), normalizeAr(query.trim())));

  const colsText = (g: Group) => g.columns.map((c) => c.label).join(' · ');
  const absenceText = (g: Group) => `(${g.columns.filter((c) => g.absence_base.includes(c.key || ''))
    .map((c) => c.label).join(' + ') || '—'}) ÷ ${g.absence_divisor} × الأيام`;

  const printList = () => {
    if (tab === 'members') {
      printReport({ title: 'توزيع الموظفين على مجموعات المرتبات', meta: [['الفرع', branchName(branchId)]] },
        [{ title: 'الكود', value: (r: BranchMember) => r.code },
          { title: 'الموظف', value: (r: BranchMember) => r.name },
          { title: 'المجموعة', value: (r: BranchMember) => r.group_name || '—' }] as any,
        shownMembers);
    } else {
      printReport({ title: 'مجموعات المرتبات', meta: [['الفرع', branchName(branchId)]] },
        [{ title: 'المجموعة', value: (g: Group) => g.name },
          { title: 'الأعمدة', value: (g: Group) => colsText(g) },
          { title: 'الغياب', value: (g: Group) => absenceText(g) },
          { title: 'الموظفين', value: (g: Group) => g.members.length }] as any,
        shownGroups);
    }
  };

  const exportList = () => {
    if (tab === 'members') {
      exportExcel(`توزيع المرتبات ${branchName(branchId)}`, [
        { title: 'الكود', value: 'code' }, { title: 'الموظف', value: 'name' },
        { title: 'المجموعة', value: (r: BranchMember) => r.group_name || '' },
        { title: 'له إعدادات راتب', value: (r: BranchMember) => (r.has_salary ? 'نعم' : 'لا') },
      ], shownMembers);
    } else {
      exportExcel(`مجموعات المرتبات ${branchName(branchId)}`, [
        { title: 'المجموعة', value: 'name' }, { title: 'الأعمدة', value: colsText },
        { title: 'الغياب', value: absenceText },
        { title: 'الموظفين', value: (g: Group) => g.members.length },
      ], shownGroups);
    }
  };

  const groupColumns: ColumnsType<Group> = [
    { title: '', key: 'order', width: 70,
      render: (_: any, g, i) => (
        <Space size={0}>
          <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={i === 0}
            title="تحريك لأعلى" onClick={() => move(g, -1)} />
          <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={i === groups.length - 1}
            title="تحريك لأسفل" onClick={() => move(g, 1)} />
        </Space>
      ) },
    { title: 'المجموعة', dataIndex: 'name', key: 'name', width: 160,
      render: (v: string, g) => <a onClick={() => openEditor(g)}><b>{v}</b></a> },
    { title: 'الأعمدة', key: 'columns',
      render: (_: any, g) => (
        <Space size={[2, 4]} wrap style={{ maxWidth: 560 }}>
          {g.columns.filter((c) => c.kind === 'earning').map((c) => (
            <Tag key={c.key} color={SOURCE_TAG[c.source]}>{c.label}</Tag>))}
          <Tag color="green" style={{ fontWeight: 700 }}>الاجمالي</Tag>
          {g.columns.filter((c) => c.kind !== 'earning').map((c) => (
            <Tag key={c.key} color={SOURCE_TAG[c.source]}>{c.label}</Tag>))}
          <Tag style={{ fontWeight: 700 }}>الصافي</Tag>
        </Space>
      ) },
    { title: 'الغياب', key: 'absence', width: 220, render: (_: any, g) => absenceText(g) },
    { title: 'الموظفين', key: 'members', width: 90,
      render: (_: any, g) => (
        <a onClick={() => { setGroupFilter(g.id); setTab('members'); }}>{g.members.length}</a>
      ) },
    { title: '', key: 'actions', width: 90,
      render: (_: any, g) => (
        <Space size={0}>
          <Button type="text" icon={<EditOutlined />} title="تعديل" onClick={() => openEditor(g)} />
          <Popconfirm onConfirm={() => remove(g)}>
            <Button type="text" danger icon={<DeleteOutlined />}
              title="حذف المجموعة" />
          </Popconfirm>
        </Space>
      ) },
  ];

  const memberColumns: ColumnsType<BranchMember> = [
    { title: 'الكود', dataIndex: 'code', width: 110, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الموظف', dataIndex: 'name',
      render: (v: string, m) => (
        <Space size={4}>
          <b>{v}</b>
          {!m.has_salary ? (
            <Tooltip title="ليست له إعدادات راتب">
              <Tag color="orange">بدون إعدادات</Tag>
            </Tooltip>
          ) : null}
        </Space>
      ) },
    { title: 'المجموعة', key: 'group', width: 220,
      render: (_: any, m) => (
        <Select size="small" style={{ width: 200 }} allowClear placeholder="بدون مجموعة"
          value={m.group_id ?? undefined}
          onChange={(v) => assign([m.employee_id], v ?? null)}
          options={groups.map((g) => ({ value: g.id, label: g.name }))} />
      ) },
    ...(typeof groupFilter === 'number' ? [{
      title: 'الترتيب', key: 'order', width: 90,
      render: (_: any, m: BranchMember, i: number) => (
        <Space size={0}>
          <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={i === 0}
            onClick={() => moveMember(m, -1)} />
          <Button type="text" size="small" icon={<ArrowDownOutlined />}
            disabled={i === shownMembers.length - 1} onClick={() => moveMember(m, 1)} />
        </Space>
      ),
    }] : []),
  ];

  const unassigned = members.filter((m) => !m.group_id).length;

  return (
    <>
      <ListPage
        icon={<AppstoreOutlined />}
        title="مجموعات المرتبات"
        muted={branchName(branchId) || undefined}
        tabs={[
          { key: 'groups', label: 'المجموعات', count: groups.length },
          { key: 'members', label: 'توزيع الموظفين', count: members.length },
        ]}
        activeTab={tab as any}
        onTabChange={(k) => setTab(k)}
        actions={(<>
          {tab === 'groups' ? (<>
            <Button type="primary" icon={<PlusOutlined />} disabled={!branchId}
              onClick={() => openEditor()}>مجموعة</Button>
            <Button icon={<TableOutlined />} disabled={!branchId} onClick={applyTemplate}>مجموعات الملف</Button>
          </>) : null}
          <Button icon={<PrinterOutlined />} onClick={printList}>طباعة</Button>
          <Button icon={<FileExcelOutlined />} onClick={exportList}>إكسل</Button>
          <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
          <Button icon={<TeamOutlined />}
            onClick={() => (tabs ? tabs.openTab('/payroll-sheet') : window.location.assign('/payroll-sheet'))}>
            شيت المرتبات
          </Button>
        </>)}
        filters={(<>
          {seesAll ? (
            <Select placeholder="الفرع" style={{ minWidth: 150 }} value={branchId ?? undefined}
              onChange={(v) => { setBranchId(v); setGroupFilter(undefined); }}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              showSearch filterOption={searchFilter} filterSort={searchRank} />
          ) : null}
          <Input className="sl-f-search" allowClear ref={searchRef} value={query}
            placeholder={tab === 'members' ? 'بحث بالكود أو الاسم' : 'بحث باسم المجموعة أو العمود'}
            prefix={<SearchOutlined />} onChange={(e) => setQuery(e.target.value)} />
          {tab === 'members' ? (
            <Select allowClear placeholder="المجموعة" style={{ minWidth: 170 }}
              value={groupFilter as any} onChange={(v) => setGroupFilter(v)}
              options={[{ value: 'none', label: 'بدون مجموعة' },
                ...groups.map((g) => ({ value: g.id, label: g.name }))]} />
          ) : null}
          <Button className="sl-f-clear" icon={<ClearOutlined />}
            onClick={() => { setQuery(''); setGroupFilter(undefined); }}>مسح</Button>
        </>)}
        summary={(<>
          <ListStat label="المجموعات" value={groups.length} />
          <ListStat label="موظفو الفرع" value={members.length} />
          <ListStat label="بدون مجموعة" value={unassigned} tone={unassigned ? 'warn' : undefined}
            hint="لن يدخلوا الشيت" />
        </>)}
      >
        {!branchId ? <Empty description="اختر الفرع" /> : tab === 'groups' ? (
          <>
            {!loading && !groups.length ? (
              <Alert type="info" showIcon style={{ margin: '6px 0 8px' }}
                message="لا توجد مجموعات مرتبات لهذا الفرع بعد" />
            ) : null}
            {seesAll && branches.length > 1 ? (
              <Space style={{ margin: '4px 0 8px' }} wrap>
                <span style={{ color: '#666' }}>نسخ مجموعات من فرع:</span>
                <Select size="small" style={{ minWidth: 150 }} placeholder="الفرع" value={copyFrom}
                  onChange={setCopyFrom}
                  options={branches.filter((b) => b.id !== branchId).map((b) => ({ value: b.id, label: b.name }))} />
                <Button size="small" icon={<CopyOutlined />} onClick={copyGroups}>نسخ</Button>
              </Space>
            ) : null}
            <Table<Group>
              className="sl-table" size="small" rowKey="id" loading={loading}
              dataSource={shownGroups} pagination={false} columns={groupColumns}
              scroll={{ x: 'max-content' }} locale={{ emptyText: 'لا توجد مجموعات' }}
            />
          </>
        ) : (
          <>
            <Space style={{ margin: '4px 0 8px' }} wrap>
              <span>المحددون ({selected.length}):</span>
              <Select size="small" style={{ minWidth: 180 }} placeholder="نقل إلى مجموعة"
                value={target === undefined ? undefined : (target ?? 0)}
                onChange={(v) => setTarget(v === 0 ? null : v)}
                options={[...groups.map((g) => ({ value: g.id, label: g.name })),
                  { value: 0, label: '— إزالة من المجموعات —' }]} />
              <Button size="small" type="primary" disabled={!selected.length || target === undefined}
                onClick={() => assign(selected, target ?? null)}>تطبيق</Button>
            </Space>
            <Table<BranchMember>
              className="sl-table" size="small" rowKey="employee_id" loading={loading}
              dataSource={shownMembers} pagination={false} columns={memberColumns}
              scroll={{ x: 'max-content' }}
              rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]) }}
              locale={{ emptyText: 'لا يوجد موظفون' }}
            />
          </>
        )}
      </ListPage>

      <TabModal
        open={!!editing} width={980} destroyOnHidden
        title={editing?.id ? `تعديل مجموعة — ${editing.name}` : 'مجموعة مرتبات جديدة'}
        onCancel={() => setEditing(null)} onOk={save} okText="حفظ" cancelText="إلغاء"
        okButtonProps={{ loading: saving }}
      >
        {editing && catalog ? (
          <Row gutter={[10, 10]}>
            <Col span={10}>
              <div style={{ marginBottom: 4 }}>الاسم *</div>
              <Input value={editing.name} placeholder="البيع، الإدارية، خدمة العملاء…"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Col>
            <Col span={4}>
              <div style={{ marginBottom: 4 }}>قاسم الغياب</div>
              <InputNumber style={{ width: '100%' }} min={1} max={31} value={editing.absence_divisor}
                onChange={(v) => setEditing({ ...editing, absence_divisor: Number(v) || 30 })} />
            </Col>
            <Col span={10}>
              <div style={{ marginBottom: 4 }}>يُحتسب الغياب على</div>
              <Select mode="multiple" style={{ width: '100%' }} value={editing.absence_base}
                onChange={(v) => setEditing({ ...editing, absence_base: v })}
                options={earningKeys.map(({ c, key }) => ({ value: key, label: c.label || key }))} />
            </Col>
            <Col span={24}>
              <Divider style={{ margin: '4px 0' }}>الأعمدة بالترتيب</Divider>
              {cols.map((c, i) => {
                const kind = kindOf(c);
                return (
                  <Row gutter={[6, 6]} key={i} style={{ marginBottom: 6 }} align="middle">
                    <Col span={4}>
                      <Select size="small" style={{ width: '100%' }} value={c.source}
                        onChange={(v) => setCol(i, { source: v })}
                        options={catalog.sources.map((s) => ({ value: s.source, label: s.label, title: s.hint }))} />
                    </Col>
                    <Col span={5}>
                      {c.source === 'component' ? (
                        <Select size="small" style={{ width: '100%' }} placeholder="البند" showSearch
                          value={c.ref} onChange={(v) => setCol(i, { ref: v })}
                          options={catalog.components.map((x) => ({
                            value: x.id, label: `${x.name} (${x.kind === 'earning' ? '+' : '−'})` }))}
                          filterOption={searchFilter} filterSort={searchRank} />
                      ) : c.source === 'commission' ? (
                        <Select size="small" style={{ width: '100%' }} placeholder="من المحرك"
                          value={c.ref} onChange={(v) => setCol(i, { ref: v })}
                          options={catalog.commission_keys.map((x) => ({ value: x.ref, label: x.label }))} />
                      ) : c.source === 'manual' ? (
                        <Select size="small" style={{ width: '100%' }} value={c.kind || 'earning'}
                          onChange={(v) => setCol(i, { kind: v })}
                          options={[{ value: 'earning', label: 'استحقاق (+)' },
                            { value: 'deduction', label: 'استقطاع (−)' }]} />
                      ) : (
                        <span style={{ color: '#888', fontSize: 12 }}>
                          {catalog.sources.find((s) => s.source === c.source)?.hint}
                        </span>
                      )}
                    </Col>
                    <Col span={4}>
                      <Input size="small" placeholder="العنوان في الورقة" value={c.label}
                        onChange={(e) => setCol(i, { label: e.target.value })} />
                    </Col>
                    <Col span={4}>
                      {kind === 'deduction' ? (
                        <Select size="small" style={{ width: '100%' }} title="يُرحَّل على"
                          value={c.posting || (c.source === 'advances' ? 'advance'
                            : c.source === 'penalties' ? 'penalty'
                              : c.source === 'insurance' ? 'insurance' : 'reduce')}
                          onChange={(v) => setCol(i, { posting: v })}
                          options={catalog.postings} />
                      ) : (
                        <Tag color="green">استحقاق</Tag>
                      )}
                    </Col>
                    <Col span={4}>
                      {c.source === 'manual' ? (
                        <Checkbox checked={!!c.carry} onChange={(e) => setCol(i, { carry: e.target.checked })}>
                          يُنقل
                        </Checkbox>
                      ) : ['commission', 'insurance'].includes(c.source) ? (
                        <Select size="small" style={{ width: '100%' }} allowClear
                          placeholder="البند البديل"
                          value={c.fallback_component_id ?? undefined}
                          onChange={(v) => setCol(i, { fallback_component_id: v ?? null })}
                          options={catalog.components.map((x) => ({ value: x.id, label: x.name }))} />
                      ) : null}
                    </Col>
                    <Col span={3}>
                      <Space size={0}>
                        <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={i === 0}
                          onClick={() => moveCol(i, -1)} />
                        <Button type="text" size="small" icon={<ArrowDownOutlined />}
                          disabled={i === cols.length - 1} onClick={() => moveCol(i, 1)} />
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          onClick={() => setCols(cols.filter((_, j) => j !== i))} />
                      </Space>
                    </Col>
                  </Row>
                );
              })}
              <Button size="small" icon={<PlusOutlined />}
                onClick={() => setCols([...cols, { source: 'component', label: '' }])}>عمود</Button>
            </Col>
            <Col span={24}>
              <div style={{ marginBottom: 4 }}>ملاحظات</div>
              <Input value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Col>
          </Row>
        ) : null}
      </TabModal>
    </>
  );
}

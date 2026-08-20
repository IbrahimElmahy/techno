import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Input, Row, Select, Space, Table, Tag, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import { ApartmentOutlined, PlusOutlined, ReloadOutlined, ImportOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import { useTableKeyboard } from '../components/keyboard';

/**
 * الأقسام — الهيكل التنظيمي.
 *
 * «القسم» was a free text box on the employee card, and free text is how «المبيعات» and «مبيعات»
 * and «قسم المبيعات» become three departments in a report nobody can total. It also had nowhere to
 * put a manager, a parent, or a cost centre — so «تكلفة أجور قسم المخازن» had no answer at all.
 *
 * The tree is shown as a tree rather than a flat list with a «القسم الأب» column, because the
 * shape IS the information: «مبيعات القاهرة» sitting under «المبيعات» is the thing somebody opened
 * this screen to see.
 *
 * The import button is offered once and stays: it is safe to press again (it only touches
 * employees with a name and no department yet) and pressing it is how the old free text becomes
 * rows without anybody retyping ninety names.
 */

interface Department {
  id: number;
  code: string;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  manager_employee_id: number | null;
  manager_name: string | null;
  cost_center_id: number | null;
  branch_id: number | null;
  active: boolean;
  notes: string | null;
  employee_count: number;
}

interface TreeRow extends Department {
  children?: TreeRow[];
}

/** بيحوّل القايمة المسطحة لشجرة. أي قسم أبوه مش ظاهر بيتعلّق في الجذر مش بيختفي. */
export function toTree(rows: Department[]): TreeRow[] {
  const byId = new Map<number, TreeRow>(rows.map((r) => [r.id, { ...r }]));
  const roots: TreeRow[] = [];
  for (const row of byId.values()) {
    const parent = row.parent_id !== null ? byId.get(row.parent_id) : undefined;
    if (parent) {
      (parent.children ??= []).push(row);
    } else {
      // A row whose parent was filtered out (or deactivated) still has to appear — dropping it
      // would make a department vanish from the screen with nothing said.
      roots.push(row);
    }
  }
  return roots;
}

const emptyForm = {
  name: '', code: '', parent_id: undefined as number | undefined,
  manager_employee_id: undefined as number | undefined,
  cost_center_id: undefined as number | undefined,
  branch_id: undefined as number | undefined, notes: '',
};

export default function Departments() {
  const [rows, setRows] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [costCenters, setCostCenters] = useState<{ id: number; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/departments');
      setRows(res.data || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الأقسام');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    Promise.all([
      api.get('/api/v1/employees'),
      api.get('/api/v1/cost-centers').catch(() => ({ data: [] })),
      api.get('/api/v1/branches').catch(() => ({ data: [] })),
    ]).then(([e, c, b]) => {
      setEmployees(e.data || []);
      setCostCenters(c.data || []);
      setBranches(b.data || []);
    }).catch(() => undefined);
  }, []);

  const filter = useListFilter(rows, {
    search: (r) => [r.code, r.name, r.manager_name],
    filters: { active: (r, v) => (v === 'yes' ? r.active : !r.active) },
    // Closed departments are out of the way by default — they are history, and a tree cluttered
    // with them is harder to read than one that needs a click to show them.
    initialValues: { active: 'yes' },
  });
  // The tree is built from what the search left, so filtering never hides a matched row behind a
  // parent that did not match.
  const tree = useMemo(() => toTree(filter.filtered), [filter.filtered]);

  const openCreate = () => {
    setForm({ ...emptyForm });
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (row: Department) => {
    setForm({
      name: row.name, code: row.code,
      parent_id: row.parent_id ?? undefined,
      manager_employee_id: row.manager_employee_id ?? undefined,
      cost_center_id: row.cost_center_id ?? undefined,
      branch_id: row.branch_id ?? undefined,
      notes: row.notes ?? '',
    });
    setEditing(row);
    setCreating(true);
  };

  const save = async () => {
    if (!form.name.trim()) { message.warning('اكتب اسم القسم'); return; }
    setSaving(true);
    try {
      const body: any = {
        name: form.name.trim(),
        parent_id: form.parent_id ?? null,
        manager_employee_id: form.manager_employee_id ?? null,
        cost_center_id: form.cost_center_id ?? null,
        branch_id: form.branch_id ?? null,
        notes: form.notes || null,
      };
      if (editing) {
        await api.patch(`/api/v1/hr/departments/${editing.id}`, body);
      } else {
        if (form.code.trim()) body.code = form.code.trim();
        await api.post('/api/v1/hr/departments', body);
      }
      message.success(editing ? 'اتعدّل' : 'اتضاف');
      setCreating(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
    } finally { setSaving(false); }
  };

  const deactivate = async (row: Department) => {
    try {
      await api.delete(`/api/v1/hr/departments/${row.id}`);
      message.success('اتقفل');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الإقفال');
    }
  };

  const runImport = async () => {
    try {
      const res = await api.post('/api/v1/hr/departments/import-from-employees');
      const { created, linked } = res.data;
      message.success(created || linked
        ? `اتعمل ${created} قسم، واترّبط ${linked} موظف`
        : 'مافيش أقسام جديدة — كل الموظفين مربوطين');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الترحيل');
    }
  };

  const columns: ColumnsType<TreeRow> = [
    { title: 'القسم', dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <Space>
          <span style={{ fontWeight: 600 }}>{v}</span>
          {!r.active && <Tag>مقفول</Tag>}
        </Space>
      ) },
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 100 },
    { title: 'المدير', dataIndex: 'manager_name', key: 'manager_name',
      render: (v: string | null) => v || <span style={{ color: '#6b6b6b' }}>—</span> },
    { title: 'عدد الموظفين', dataIndex: 'employee_count', key: 'employee_count', width: 120,
      render: (v: number) => (v ? <Tag color="blue">{v}</Tag> : <span style={{ color: '#6b6b6b' }}>—</span>) },
    { title: 'ملاحظات', dataIndex: 'notes', key: 'notes', ellipsis: true },
    { title: '', key: 'actions', width: 150, render: (_: any, r) => (
      <Space size="small">
        <Button size="small" onClick={() => openEdit(r)}>تعديل</Button>
        {r.active && (
          <Popconfirm
            title="تقفل القسم؟"
            description="بيتقفل مش بيتمسح — الاسم بيفضل مقروء على اللي مربوط بيه."
            okText="اقفل" cancelText="رجوع"
            onConfirm={() => deactivate(r)}
          >
            <Button size="small" danger>إقفال</Button>
          </Popconfirm>
        )}
      </Space>
    ) },
  ];

  const cols = useTableColumns('departments', columns, { locked: ['name'] });
  // F2 على الزرار نفسه (`data-shortcut`) زي شاشة الموظفين — الكيبورد بيدوّر على الزرار
  // المعلّم لما مافيش شاشة سجّلت `onNew` بنفسها.
  const kb = useTableKeyboard({ rows: tree, rowKey: (r: TreeRow) => r.id, onOpen: openEdit });

  const unmapped = employees.length && rows.length === 0;

  return (
    <Card
      title={<span><ApartmentOutlined /> الأقسام</span>}
      extra={(
        <Space>
          {cols.control}
          <Button icon={<ImportOutlined />} onClick={runImport}>ترحيل الأقسام القديمة</Button>
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
            onClick={openCreate}>قسم جديد</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      {unmapped ? (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="لسه مافيش أقسام"
          description={'«القسم» كان مكتوب بالإيد على كارت الموظف. اضغط «ترحيل الأقسام القديمة» '
            + 'وهو هيعمل قسم لكل اسم متكتب ويربط الموظفين بيه — وآمن تضغطه أكتر من مرة.'}
        />
      ) : null}

      <ListToolbar
        searchPlaceholder="بحث بالاسم أو الكود أو المدير"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset} total={rows.length} shown={filter.filtered.length}
        filters={[
          { key: 'active', placeholder: 'الحالة', options: [
            { value: 'yes', label: 'الشغّالة' },
            { value: 'no', label: 'المقفولة' },
          ] },
        ]}
      />

      <Table
        {...kb.tableProps}
        rowKey="id"
        size="small"
        loading={loading}
        columns={cols.columns}
        dataSource={tree}
        pagination={false}
        expandable={{ defaultExpandAllRows: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'مافيش أقسام' }}
      />

      <TabModal
        open={creating}
        title={editing ? `تعديل «${editing.name}»` : 'قسم جديد'}
        onCancel={() => setCreating(false)}
        onOk={save}
        confirmLoading={saving}
        okText="حفظ"
        cancelText="إلغاء"
        destroyOnClose
      >
        <Row gutter={[10, 10]}>
          <Col span={16}>
            <div style={{ marginBottom: 4 }}>اسم القسم *</div>
            <Input
              value={form.name} autoFocus
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              onPressEnter={save}
            />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>الكود</div>
            <Input
              value={form.code} disabled={!!editing}
              placeholder="تلقائي"
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>تابع لقسم</div>
            <Select
              allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={form.parent_id}
              onChange={(v) => setForm({ ...form, parent_id: v })}
              options={rows
                // A department cannot be its own parent — the server refuses it, but offering it
                // in the list is an invitation to hit an error for no reason.
                .filter((r) => r.id !== editing?.id && r.active)
                .map((r) => ({ value: r.id, label: r.name }))}
            />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>مدير القسم</div>
            <Select
              allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={form.manager_employee_id}
              onChange={(v) => setForm({ ...form, manager_employee_id: v })}
              options={employees.map((e) => ({ value: e.id, label: e.name }))}
            />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>مركز التكلفة</div>
            <Select
              allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={form.cost_center_id}
              onChange={(v) => setForm({ ...form, cost_center_id: v })}
              options={costCenters.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>الفرع</div>
            <Select
              allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={form.branch_id}
              onChange={(v) => setForm({ ...form, branch_id: v })}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>ملاحظات</div>
            <Input.TextArea
              rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Col>
        </Row>
      </TabModal>
    </Card>
  );
}

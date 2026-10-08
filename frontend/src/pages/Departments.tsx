import React, { useEffect, useMemo, useRef, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Alert, Button, Checkbox, Col, Input, Row, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import {
  ApartmentOutlined, ClearOutlined, DeleteOutlined, EditOutlined, ImportOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined, StopOutlined, TeamOutlined, UndoOutlined, UserAddOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { useListFilter } from '../components/ListToolbar';
import { TabDrawer, TabModal } from '../components/TabModal';
import { useTableColumns } from '../components/ColumnSettings';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import ListPage from '../components/ListPage';
import { roleForAccess, useAuth } from '../components/AuthProvider';
import EmployeeFormModal, {
  deactivateEmployee, deleteEmployee, reactivateEmployee,
} from '../components/EmployeeFormModal';
import type { Employee } from '../components/EmployeeFormModal';

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

export function toTree(rows: Department[]): TreeRow[] {
  const byId = new Map<number, TreeRow>(rows.map((r) => [r.id, { ...r }]));
  const roots: TreeRow[] = [];
  for (const row of byId.values()) {
    const parent = row.parent_id !== null ? byId.get(row.parent_id) : undefined;
    if (parent) {
      (parent.children ??= []).push(row);
    } else {
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

  const [viewing, setViewing] = useState<Department | null>(null);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [staffQuery, setStaffQuery] = useState('');
  const [empOpen, setEmpOpen] = useState(false);
  const [empEditing, setEmpEditing] = useState<Employee | null>(null);

  const { user } = useAuth();
  const seesAll = !user?.branch_id || roleForAccess(user?.role) === 'system_admin';
  const canChange = (r: Department) => seesAll || r.branch_id !== null;

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/departments');
      setRows(res.data || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الأقسام');
    } finally { setLoading(false); }
  };

  const loadEmployees = () => api.get('/api/v1/employees')
    .then((r) => setEmployees(r.data || [])).catch(() => undefined);

  const loadStaff = async (dept: Department | null = viewing) => {
    if (!dept) return;
    setStaffLoading(true);
    try {
      const res = await api.get('/api/v1/employees', { params: { department_id: dept.id } });
      setStaff(res.data || []);
    } catch {} finally { setStaffLoading(false); }
  };

  const openStaff = (dept: Department) => {
    setViewing(dept);
    setStaff([]);
    setStaffQuery('');
    setShowInactive(false);
    loadStaff(dept);
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
    initialValues: { active: 'yes' },
  });
  const tree = useMemo(() => toTree(filter.filtered), [filter.filtered]);

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });
  const multiSelect = (key: string, placeholder: string, options: { value: any; label: string }[]) => {
    const v = filter.values[key];
    return (
      <Select allowClear showSearch mode="multiple" maxTagCount="responsive" placeholder={placeholder}
        value={v === undefined || v === null || v === '' ? undefined : (Array.isArray(v) ? v : [v])}
        onChange={(x) => filter.setValue(key, Array.isArray(x) && !x.length ? undefined : x)}
        options={options} filterOption={searchFilter} filterSort={searchRank} />
    );
  };

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
      message.success(editing ? 'تم التعديل' : 'تمت الإضافة');
      setCreating(false);
      load();
    } catch {
    } finally { setSaving(false); }
  };
  useScreenShortcuts({ onSave: save }, creating);

  const deactivate = async (row: Department) => {
    try {
      await api.delete(`/api/v1/hr/departments/${row.id}`);
      message.success('تم الإغلاق');
      load();
    } catch {}
  };

  const reactivate = async (row: Department) => {
    try {
      await api.patch(`/api/v1/hr/departments/${row.id}`, { active: true });
      message.success('تم التفعيل');
      load();
    } catch {}
  };

  const remove = async (row: Department) => {
    try {
      await api.delete(`/api/v1/hr/departments/${row.id}`, { params: { hard: true } });
      message.success('تم حذف القسم');
      if (viewing?.id === row.id) setViewing(null);
      load();
    } catch {}
  };

  const afterStaffChange = () => { loadStaff(); load(); loadEmployees(); };
  const newEmployee = () => { setEmpEditing(null); setEmpOpen(true); };
  const editEmployee = (e: Employee) => { setEmpEditing(e); setEmpOpen(true); };
  const stopEmployee = async (e: Employee) => { if (await deactivateEmployee(e)) afterStaffChange(); };
  const resumeEmployee = async (e: Employee) => { if (await reactivateEmployee(e)) afterStaffChange(); };
  const removeEmployee = async (e: Employee) => { if (await deleteEmployee(e)) afterStaffChange(); };

  const shownStaff = useMemo(() => {
    const q = staffQuery.trim();
    return staff
      .filter((e) => showInactive || e.active)
      .filter((e) => !q || [e.name, e.code, e.phone, e.job_title]
        .some((v) => (v || '').includes(q)));
  }, [staff, showInactive, staffQuery]);
  const staffKb = useTableKeyboard<Employee>({
    rows: shownStaff, rowKey: (r) => r.id, onOpen: editEmployee, enabled: !!viewing,
  });
  const branchName = (id: number | null | undefined) =>
    (id ? branches.find((b) => b.id === id)?.name : '') || '';

  const runImport = async () => {
    try {
      const res = await api.post('/api/v1/hr/departments/import-from-employees');
      const { created, linked } = res.data;
      message.success(created || linked
        ? `أُنشئ ${created} قسم، ورُبط ${linked} موظف`
        : 'لا توجد أقسام جديدة — كل الموظفين مرتبطون');
      load();
    } catch {}
  };

  const columns: ColumnsType<TreeRow> = [
    { title: 'القسم', dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <Space>
          <span style={{ fontWeight: 600 }}>{v}</span>
          {!r.active && <Tag>مغلق</Tag>}
        </Space>
      ) },
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 100 },
    { title: 'المدير', dataIndex: 'manager_name', key: 'manager_name',
      render: (v: string | null) => v || <span style={{ color: '#6b6b6b' }}>—</span> },
    { title: 'عدد الموظفين', dataIndex: 'employee_count', key: 'employee_count', width: 120,
      render: (v: number, r) => (
        <Tooltip title="عرض موظفي القسم">
          <Tag color={v ? 'blue' : undefined} style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); openStaff(r); }}>
            {v || 0}
          </Tag>
        </Tooltip>
      ) },
    { title: 'ملاحظات', dataIndex: 'notes', key: 'notes', ellipsis: true },
    { title: '', key: 'actions', width: 170, render: (_: any, r) => (
      <Space size={0}>
        <Tooltip title="الموظفين">
          <Button type="text" icon={<TeamOutlined />}
            onClick={(e) => { e.stopPropagation(); openStaff(r); }} />
        </Tooltip>
        {canChange(r) && (<>
        <Tooltip title="تعديل">
          <Button type="text" icon={<EditOutlined />}
            onClick={(e) => { e.stopPropagation(); openEdit(r); }} />
        </Tooltip>
        {r.active ? (
          <Popconfirm title="هل تريد إغلاق القسم؟" onConfirm={() => deactivate(r)}>
            <Tooltip title="إغلاق">
              <Button type="text" icon={<StopOutlined />} />
            </Tooltip>
          </Popconfirm>
        ) : (
          <Popconfirm title="هل تريد تفعيل القسم؟" onConfirm={() => reactivate(r)}>
            <Tooltip title="تفعيل">
              <Button type="text" icon={<UndoOutlined />} />
            </Tooltip>
          </Popconfirm>
        )}
        <Popconfirm title="هل تريد حذف القسم نهائياً؟" onConfirm={() => remove(r)}>
          <Tooltip title="حذف نهائي">
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Tooltip>
        </Popconfirm>
        </>)}
      </Space>
    ) },
  ];

  const cols = useTableColumns('departments', columns, {
    locked: ['name'],
    export: { name: 'الأقسام', rows: tree },
  });
  const kb = useTableKeyboard({
    rows: tree, rowKey: (r: TreeRow) => r.id,
    onOpen: (r: TreeRow) => (canChange(r) ? openEdit(r) : openStaff(r)),
  });

  const unmapped = employees.length && rows.length === 0;

  return (
    <>
    <ListPage
      icon={<ApartmentOutlined />}
      title="الأقسام" muted="(الهيكل التنظيمي)"
      actions={(<>
        <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
          onClick={openCreate}>قسم جديد</Button>
        {seesAll && (
          <Button icon={<ImportOutlined />} onClick={runImport}>ترحيل الأقسام القديمة</Button>
        )}
        {cols.control}
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
          placeholder="بحث بالاسم أو الكود أو المدير" prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        {multiSelect('active', 'الحالة', [
          { value: 'yes', label: 'النشطة' },
          { value: 'no', label: 'المغلقة' },
        ])}
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>      )}
    >
      {unmapped ? (
        <Alert
          type="info" showIcon style={{ margin: '6px 0 8px' }}
          message="لا توجد أقسام بعد"
        />
      ) : null}

      <Table
        {...kb.tableProps}
        className="sl-table"
        rowKey="id"
        size="small"
        loading={loading}
        columns={cols.columns}
        dataSource={tree}
        pagination={false}
        expandable={{ defaultExpandAllRows: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'لا توجد أقسام' }}
      />
      <div style={{ padding: '10px 4px', borderTop: '1px solid #f1f5f9' }}>
        <span className="sl-foot">
          <span>الأقسام المعروضة: <b>{filter.filtered.length}</b> من {rows.length}</span>
          <span>الموظفون فيها: <b>{filter.filtered.reduce((n, r) => n + (r.employee_count || 0), 0)}</b></span>
        </span>
      </div>
    </ListPage>

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
              allowClear showSearch style={{ width: '100%' }}
              value={form.parent_id}
              onChange={(v) => setForm({ ...form, parent_id: v })}
              options={rows
                .filter((r) => r.id !== editing?.id && r.active)
                .map((r) => ({ value: r.id, label: r.name }))} filterOption={searchFilter} filterSort={searchRank}/>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>مدير القسم</div>
            <Select
              allowClear showSearch style={{ width: '100%' }}
              value={form.manager_employee_id}
              onChange={(v) => setForm({ ...form, manager_employee_id: v })}
              options={employees.map((e) => ({ value: e.id, label: e.name }))} filterOption={searchFilter} filterSort={searchRank}/>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>مركز التكلفة</div>
            <Select
              allowClear showSearch style={{ width: '100%' }}
              value={form.cost_center_id}
              onChange={(v) => setForm({ ...form, cost_center_id: v })}
              options={costCenters.map((c) => ({ value: c.id, label: c.name }))} filterOption={searchFilter} filterSort={searchRank}/>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>الفرع</div>
            <Select
              allowClear showSearch style={{ width: '100%' }}
              value={form.branch_id}
              disabled={!seesAll}
              onChange={(v) => setForm({ ...form, branch_id: v })}
              options={branches.map((b) => ({ value: b.id, label: b.name }))} filterOption={searchFilter} filterSort={searchRank}/>
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

      <TabDrawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        placement="left"
        width="min(1000px, 94vw)"
        destroyOnHidden
        title={viewing && (
          <Space size={8} wrap>
            <TeamOutlined />
            <span>موظفو قسم «{viewing.name}»</span>
            <Tag>{viewing.code}</Tag>
            {!viewing.active && <Tag>مغلق</Tag>}
          </Space>
        )}
        extra={viewing?.active ? (
          <Button type="primary" icon={<UserAddOutlined />} onClick={newEmployee}>
            موظف جديد في القسم
          </Button>
        ) : null}
      >
        <Space wrap style={{ marginBottom: 8 }}>
          <Input allowClear value={staffQuery} style={{ width: 260 }}
            placeholder="بحث بالاسم أو الكود أو الهاتف" prefix={<SearchOutlined />}
            onChange={(e) => setStaffQuery(e.target.value)} />
          <Checkbox checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}>
            عرض الموقوفين
          </Checkbox>
          <Button icon={<ReloadOutlined />} onClick={() => loadStaff()}>تحديث</Button>
        </Space>
        <Table<Employee>
          {...staffKb.tableProps}
          className="sl-table"
          rowKey="id" size="small" loading={staffLoading}
          dataSource={shownStaff} pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لا يوجد موظفون في هذا القسم' }}
          columns={[
            { title: 'الكود', dataIndex: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
            { title: 'الاسم', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
            { title: 'الوظيفة', dataIndex: 'job_title', render: (v: string | null) => v || '' },
            { title: 'الفرع', dataIndex: 'branch_id', render: (v: number | null) => branchName(v) },
            { title: 'الهاتف', dataIndex: 'phone', render: (v: string | null) => v || '' },
            { title: 'الحالة', dataIndex: 'active',
              render: (v: boolean) => (v
                ? <Tag color="green">على رأس العمل</Tag> : <Tag>موقوف</Tag>) },
            { title: '', key: 'actions', width: 130,
              render: (_: any, r: Employee) => (
                <Space size={0}>
                  <Tooltip title="تعديل">
                    <Button type="text" icon={<EditOutlined />}
                      onClick={(e) => { e.stopPropagation(); editEmployee(r); }} />
                  </Tooltip>
                  {r.active ? (
                    <Popconfirm title="هل تريد إيقاف الموظف؟" onConfirm={() => stopEmployee(r)}>
                      <Tooltip title="إيقاف">
                        <Button type="text" icon={<StopOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  ) : (
                    <Popconfirm title="هل تريد إعادة الموظف للعمل؟" onConfirm={() => resumeEmployee(r)}>
                      <Tooltip title="إعادة للعمل">
                        <Button type="text" icon={<UndoOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  )}
                  <Popconfirm title="هل تريد حذف الموظف نهائياً؟" onConfirm={() => removeEmployee(r)}>
                    <Tooltip title="حذف نهائي">
                      <Button type="text" danger icon={<DeleteOutlined />} />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              ) },
          ]}
        />
        <div style={{ padding: '10px 4px', borderTop: '1px solid #f1f5f9' }}>
          <Space size={24}>
            <span>على رأس العمل: <b>{staff.filter((e) => e.active).length}</b></span>
            <span>الموقوفون: <b>{staff.filter((e) => !e.active).length}</b></span>
          </Space>
        </div>
      </TabDrawer>

      <EmployeeFormModal
        open={empOpen} employee={empEditing}
        defaults={viewing
          ? { department_id: viewing.id, branch_id: viewing.branch_id ?? undefined } : undefined}
        onClose={() => setEmpOpen(false)} onSaved={afterStaffChange}
      />
    </>
  );
}

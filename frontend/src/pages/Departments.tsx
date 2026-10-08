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
 *
 * **موظفين القسم من هنا.** العدد لوحده بيقول «فيه ٧» ومابيقولش مين — فاللي بيفتح الشاشة عشان
 * يرتّب قسم كان بيروح شاشة الموظفين ويدوّر بالاسم واحد واحد. دلوقتي العدد بيتضغط ويفتح موظفين
 * القسم، ومنهم إضافة (القسم متعبّي) وتعديل (ومنه النقل لقسم تاني) وإيقاف وحذف — بنفس فورم شاشة
 * الموظفين (`EmployeeFormModal`)، مش نسخة منه.
 *
 * **الإقفال غير الحذف.** الإقفال بيشيل القسم من القوايم ويسيب اسمه مقروء على اللي اتسجّل عليه،
 * والحذف للقسم اللي اتعمل بالغلط ومحدش اتربط بيه — والسيرفر بيرفضه بالأرقام لو عليه حاجة.
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

  // موظفين القسم المفتوح — بيتجابوا من السيرفر مفلترين بالقسم (والفرع، زي القايمة كلها).
  const [viewing, setViewing] = useState<Department | null>(null);
  const [staff, setStaff] = useState<Employee[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [staffQuery, setStaffQuery] = useState('');
  const [empOpen, setEmpOpen] = useState(false);
  const [empEditing, setEmpEditing] = useState<Employee | null>(null);

  // الموارد البشرية متفصّلة بين الفروع: موظف الفرع بيشوف أقسام فرعه والأقسام المشتركة (مالهاش
  // فرع)، لكن المشتركة مابيغيّرهاش — تغييرها بيأثر على كل الفروع، والسيرفر بيرفضه (٤٠٣). فالأزرار
  // مش معروضة له أصلاً بدل ما يضغط ويترفض. نفس قاعدة `branch_scope.sees_all_branches`.
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
    } catch { /* interceptor */ } finally { setStaffLoading(false); }
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
    // Closed departments are out of the way by default — they are history, and a tree cluttered
    // with them is harder to read than one that needs a click to show them.
    initialValues: { active: 'yes' },
  });
  // The tree is built from what the search left, so filtering never hides a matched row behind a
  // parent that did not match.
  const tree = useMemo(() => toTree(filter.filtered), [filter.filtered]);

  // F3 كانت جاية من `ListToolbar` — الخانة بقت هنا فبتتسجّل هنا.
  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });
  // قوايم الفلاتر — نفس اللي كانت في `ListToolbar` (أكتر من قيمة، والمعنى «أي واحدة منهم»).
  const multiSelect = (key: string, placeholder: string, options: { value: any; label: string }[]) => {
    const v = filter.values[key];
    return (
      <Select allowClear showSearch mode="multiple" maxTagCount="responsive" placeholder={placeholder}
        // القيمة الابتدائية (`initialValues`) ممكن تبقى مفردة — وضع المتعدد بيستنى قايمة.
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
      message.success(editing ? 'اتعدّل' : 'اتضاف');
      setCreating(false);
      load();
    } catch {
      // الرسالة بيطلّعها الـinterceptor — كانت بتطلع مرتين.
    } finally { setSaving(false); }
  };
  // F9 حفظ وهو مفتوح — زي باقي الفورمات.
  useScreenShortcuts({ onSave: save }, creating);

  const deactivate = async (row: Department) => {
    try {
      await api.delete(`/api/v1/hr/departments/${row.id}`);
      message.success('اتقفل');
      load();
    } catch { /* interceptor */ }
  };

  const reactivate = async (row: Department) => {
    try {
      await api.patch(`/api/v1/hr/departments/${row.id}`, { active: true });
      message.success('اتفعّل');
      load();
    } catch { /* interceptor */ }
  };

  // مسح نهائي — السيرفر بيرفضه لو القسم عليه أي موظف (حتى موقوف) أو قسم فرعي أو مسير، والرسالة
  // فيها الأرقام وبتقول «استعمل إقفال».
  const remove = async (row: Department) => {
    try {
      await api.delete(`/api/v1/hr/departments/${row.id}`, { params: { hard: true } });
      message.success('اتمسح القسم');
      if (viewing?.id === row.id) setViewing(null);
      load();
    } catch { /* interceptor */ }
  };

  // ---- موظفين القسم
  // بعد أي تغيير على موظف: القايمة المفتوحة، وعداد الأقسام (ممكن يكون اتنقل لقسم تاني)، وقايمة
  // «مدير القسم».
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
        ? `اتعمل ${created} قسم، واترّبط ${linked} موظف`
        : 'لا توجد أقسام جديدة — كل الموظفين مرتبطون');
      load();
    } catch { /* interceptor */ }
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
      // العدد بيتضغط ويفتح موظفين القسم — العدد لوحده مابيقولش مين.
      render: (v: number, r) => (
        <Tooltip title="عرض موظفين القسم">
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
          <Popconfirm title="تقفل القسم؟" onConfirm={() => deactivate(r)}>
            <Tooltip title="إقفال — يختفي من القوايم ويفضل اسمه على اللي اتسجّل عليه">
              <Button type="text" icon={<StopOutlined />} />
            </Tooltip>
          </Popconfirm>
        ) : (
          <Popconfirm title="تفعيل القسم؟" onConfirm={() => reactivate(r)}>
            <Tooltip title="تفعيل">
              <Button type="text" icon={<UndoOutlined />} />
            </Tooltip>
          </Popconfirm>
        )}
        <Popconfirm title="حذف القسم نهائياً؟" onConfirm={() => remove(r)}>
          <Tooltip title="حذف نهائي (لو مافيش حاجة مربوطة بيه)">
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
  // F2 على الزرار نفسه (`data-shortcut`) زي شاشة الموظفين — الكيبورد بيدوّر على الزرار
  // المعلّم لما مافيش شاشة سجّلت `onNew` بنفسها.
  // السطر بيفتح التعديل — وللقسم اللي مايقدرش يغيّره بيفتح موظفينه بدل فورم هيترفض حفظه.
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
      subtitle="الأقسام وتبعيتها ومديريها ومراكز تكلفتها"
      actions={(<>
        <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
          onClick={openCreate}>قسم جديد</Button>
        {/* الترحيل بيلف على موظفين كل الفروع — للإدارة العامة بس (السيرفر بيرفضه لغيرها). */}
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
          { value: 'yes', label: 'الشغّالة' },
          { value: 'no', label: 'المقفولة' },
        ])}
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>      )}
    >
      {unmapped ? (
        <Alert
          type="info" showIcon style={{ margin: '6px 0 8px' }}
          message="لا توجد أقسام بعد"
          description={'«القسم» كان مكتوب بالإيد على كارت الموظف. اضغط «ترحيل الأقسام القديمة» '
            + 'وسيُنشئ قسماً لكل اسم مكتوب ويربط الموظفين به — ويمكن الضغط عليه أكثر من مرة بأمان.'}
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
          <span>موظفين فيها: <b>{filter.filtered.reduce((n, r) => n + (r.employee_count || 0), 0)}</b></span>
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
                // A department cannot be its own parent — the server refuses it, but offering it
                // in the list is an invitation to hit an error for no reason.
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
              // موظف الفرع: السيرفر بيحط فرعه هو مهما اتختار — فالخانة مقفولة بدل ما توهم.
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
            <span>موظفين قسم «{viewing.name}»</span>
            <Tag>{viewing.code}</Tag>
            {!viewing.active && <Tag>مقفول</Tag>}
          </Space>
        )}
        // الإضافة لقسم مقفول بيرفضها السيرفر — فالزرار مش معروض أصلاً.
        extra={viewing?.active ? (
          <Button type="primary" icon={<UserAddOutlined />} onClick={newEmployee}>
            موظف جديد في القسم
          </Button>
        ) : null}
      >
        <Space wrap style={{ marginBottom: 8 }}>
          <Input allowClear value={staffQuery} style={{ width: 260 }}
            placeholder="بحث بالاسم أو الكود أو التليفون" prefix={<SearchOutlined />}
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
          locale={{ emptyText: 'لا يوجد موظفون في القسم ده' }}
          columns={[
            { title: 'الكود', dataIndex: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
            { title: 'الاسم', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
            { title: 'الوظيفة', dataIndex: 'job_title', render: (v: string | null) => v || '' },
            { title: 'الفرع', dataIndex: 'branch_id', render: (v: number | null) => branchName(v) },
            { title: 'التليفون', dataIndex: 'phone', render: (v: string | null) => v || '' },
            { title: 'الحالة', dataIndex: 'active',
              render: (v: boolean) => (v
                ? <Tag color="green">على رأس العمل</Tag> : <Tag>موقوف</Tag>) },
            { title: '', key: 'actions', width: 130,
              render: (_: any, r: Employee) => (
                <Space size={0}>
                  <Tooltip title="تعديل (ومنه النقل لقسم تاني)">
                    <Button type="text" icon={<EditOutlined />}
                      onClick={(e) => { e.stopPropagation(); editEmployee(r); }} />
                  </Tooltip>
                  {r.active ? (
                    <Popconfirm title="إيقاف الموظف؟" onConfirm={() => stopEmployee(r)}>
                      <Tooltip title="إيقاف — يفضل اسمه على كل اللي اتسجّل عليه">
                        <Button type="text" icon={<StopOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  ) : (
                    <Popconfirm title="رجوع للعمل؟" onConfirm={() => resumeEmployee(r)}>
                      <Tooltip title="رجوع على رأس العمل">
                        <Button type="text" icon={<UndoOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  )}
                  <Popconfirm title="حذف الموظف نهائياً؟" onConfirm={() => removeEmployee(r)}>
                    <Tooltip title="حذف نهائي (لو مالوش أي حركة)">
                      <Button type="text" danger icon={<DeleteOutlined />} />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              ) },
          ]}
        />
        <div style={{ padding: '10px 4px', borderTop: '1px solid #f1f5f9' }}>
          {/* `sl-foot` بيتظبط جوّه `ListPage` بس — هنا في الدرج كان بيلزق الرقمين في بعض. */}
          <Space size={24}>
            <span>على رأس العمل: <b>{staff.filter((e) => e.active).length}</b></span>
            <span>موقوفين: <b>{staff.filter((e) => !e.active).length}</b></span>
          </Space>
        </div>
      </TabDrawer>

      <EmployeeFormModal
        open={empOpen} employee={empEditing}
        // الموظف الجديد من هنا بيبدأ في القسم ده وفرعه — من غير كده كان لازم يتختار تاني.
        defaults={viewing
          ? { department_id: viewing.id, branch_id: viewing.branch_id ?? undefined } : undefined}
        onClose={() => setEmpOpen(false)} onSaved={afterStaffChange}
      />
    </>
  );
}

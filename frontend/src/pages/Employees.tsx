import React, { useEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Button, Input, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import { Popconfirm } from '../components/noConfirm';
import {
  ClearOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined,
  StopOutlined, TeamOutlined, UndoOutlined,
} from '@ant-design/icons';
import { api } from '../api/client';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useListFilter } from '../components/ListToolbar';
import { TabModal } from '../components/TabModal';
import { numeralsLocale } from '../utils/money';
import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import EmployeeFormModal, {
  deactivateEmployee, deleteEmployee, reactivateEmployee,
} from '../components/EmployeeFormModal';
import type { Employee } from '../components/EmployeeFormModal';

interface JobTitle { id: number; name: string; description: string | null; active: boolean }

const money = (v: any) => (v === null || v === undefined || v === ''
  ? '-'
  : Number(v).toLocaleString(numeralsLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [titles, setTitles] = useState<JobTitle[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [viewRaw, setView] = useQueryTab('employees');
  const view = (viewRaw === 'titles' ? 'titles' : 'employees') as 'employees' | 'titles';

  const load = async () => {
    setLoading(true);
    try {
      const [e, t] = await Promise.all([
        api.get('/api/v1/employees'), api.get('/api/v1/job-titles'),
      ]);
      setEmployees(e.data || []); setTitles(t.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(() => {});
    api.get('/api/v1/warehouses').then((r) => setWarehouses(r.data || [])).catch(() => {});
  }, []);

  const filter = useListFilter(employees, {
    search: (e) => [e.code, e.name, e.department, e.phone, e.job_title],
    filters: {
      active: (e, v) => e.active === (v === 'active'),
      job_title_id: (e, v) => e.job_title_id === v,
    },
  });

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

  const kb = useTableKeyboard<Employee>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: (r) => startEdit(r),
  });

  const startCreate = () => { setEditing(null); setOpen(true); };
  const startEdit = (e: Employee) => { setEditing(e); setOpen(true); };

  const deactivate = async (e: Employee) => { if (await deactivateEmployee(e)) load(); };
  const reactivate = async (e: Employee) => { if (await reactivateEmployee(e)) load(); };
  const remove = async (e: Employee) => { if (await deleteEmployee(e)) load(); };

  const addTitle = async () => {
    if (!newTitle.trim()) return;
    try {
      await api.post('/api/v1/job-titles', { name: newTitle.trim() });
      setNewTitle(''); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إضافة الوظيفة');
    }
  };

  const employeeColumns: ColumnsType<Employee> = [
    { title: 'رقم', dataIndex: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الاسم', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
    { title: 'المخزن', dataIndex: 'warehouse_id',
      render: (v: number) => warehouses.find((w) => w.id === v)?.name || '' },
    { title: 'الفرع', dataIndex: 'branch_id',
      render: (v: number) => branches.find((b) => b.id === v)?.name || '' },
    { title: 'الوظيفة', dataIndex: 'job_title', render: (v: string) => v || '' },
    { title: 'القسم', dataIndex: 'department', render: (v: string) => v || '' },
    { title: 'الهاتف', dataIndex: 'phone', render: (v: string) => v || '' },
    { title: 'تاريخ التعيين', dataIndex: 'hire_date',
      render: (v: string) => (v ? String(v).slice(0, 10) : '-') },
    { title: 'الراتب', dataIndex: 'salary', align: 'left',
      render: (v: string) => money(v) },
    { title: 'له حساب دخول', dataIndex: 'user_id',
      render: (v: number | null) => (v ? <Tag color="blue">نعم</Tag> : '-') },
    { title: 'الحالة', dataIndex: 'active',
      render: (v: boolean) => (v
        ? <Tag color="green">على رأس العمل</Tag> : <Tag>موقوف</Tag>) },
    { title: '', width: 130,
      render: (_: any, r: Employee) => (
        <Space size={0}>
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} onClick={() => startEdit(r)} />
          </Tooltip>
          {r.active ? (
            <Popconfirm title="هل تريد إيقاف الموظف؟" onConfirm={() => deactivate(r)}
              okText="إيقاف" cancelText="إلغاء">
              <Tooltip title="إيقاف">
                <Button type="text" icon={<StopOutlined />} />
              </Tooltip>
            </Popconfirm>
          ) : (
            <Popconfirm title="هل تريد إعادة الموظف للعمل؟" onConfirm={() => reactivate(r)}>
              <Tooltip title="إعادة للعمل">
                <Button type="text" icon={<UndoOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
          <Popconfirm title="هل تريد حذف الموظف نهائياً؟" onConfirm={() => remove(r)}>
            <Tooltip title="حذف نهائي">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ) },
  ];

  const employeeCols = useTableColumns('employees', employeeColumns, {
    export: { name: 'الموظفون', rows: filter.filtered },
  });

  const onEmployees = view === 'employees';

  return (
    <>
    <ListPage<'employees' | 'titles'>
      icon={<TeamOutlined />}
      title="الموظفين" muted="(الموظفون والوظائف)"
      tabs={[
        { key: 'employees', label: 'الموظفون', count: employees.length },
        { key: 'titles', label: 'الوظائف', count: titles.length },
      ]}
      activeTab={view} onTabChange={setView}
      actions={onEmployees ? (<>
        <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
          onClick={startCreate}>موظف جديد</Button>
        {employeeCols.control}
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>) : (<>
        <Input placeholder="اسم الوظيفة" value={newTitle} style={{ width: 220 }}
          onChange={(e) => setNewTitle(e.target.value)} onPressEnter={addTitle} />
        <Button type="primary" className="sl-create" icon={<PlusOutlined />}
          onClick={addTitle}>إضافة وظيفة</Button>
      </>)}
      filters={onEmployees ? (<>
        <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
          placeholder="بحث بالكود أو الاسم أو القسم أو الهاتف" prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        {multiSelect('active', 'الحالة', [
          { value: 'active', label: 'على رأس العمل' }, { value: 'inactive', label: 'موقوف' }])}
        {multiSelect('job_title_id', 'الوظيفة', titles.map((t) => ({ value: t.id, label: t.name })))}
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>) : undefined}
    >
      {onEmployees ? (
        <Table<Employee>
          {...kb.tableProps}
          className="sl-table"
          rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
          locale={{ emptyText: 'لا يوجد موظفون' }}
          pagination={{
            defaultPageSize: PAGE_SIZE, showSizeChanger: true,
            showTotal: () => (
              <span className="sl-foot">
                <span>المعروض: <b>{filter.filtered.length.toLocaleString(numeralsLocale())}</b>
                  {' '}من {employees.length.toLocaleString(numeralsLocale())} موظف</span>
                <span>على رأس العمل: <b className="is-pos">
                  {employees.filter((e) => e.active).length.toLocaleString(numeralsLocale())}</b></span>
              </span>
            ),
          }}
          scroll={{ x: 'max-content' }}
          columns={employeeCols.columns}
        />
      ) : (
        <Table<JobTitle>
          className="sl-table"
          rowKey="id" size="small" dataSource={titles} loading={loading}
          locale={{ emptyText: 'لا توجد وظائف' }}
          pagination={{ defaultPageSize: PAGE_SIZE }}
          columns={[
            { title: 'الوظيفة', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
            { title: 'عدد الموظفين',
              render: (_: any, r: JobTitle) =>
                employees.filter((e) => e.job_title_id === r.id).length },
            { title: 'الحالة', dataIndex: 'active',
              render: (v: boolean) => (v ? <Tag color="green">مفعّلة</Tag> : <Tag>موقوفة</Tag>) },
          ]}
        />
      )}
    </ListPage>

    <EmployeeFormModal
      open={open} employee={editing}
      onClose={() => setOpen(false)} onSaved={() => load()}
    />
    </>
  );
}

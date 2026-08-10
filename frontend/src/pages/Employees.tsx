import React, { useEffect, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Input, InputNumber, Popconfirm, Row, Select, Space, Table,
  Tabs, Tag, message
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { TabModal } from '../components/TabModal';

/**
 * الموظفون والوظائف — deliberately not the users screen.
 *
 * A user is someone who logs in; an employee is someone the company employs, and the two are not
 * the same set. A driver or a storekeeper belongs here without ever having a password. Where the
 * same person is both, the record links to the user instead of duplicating them.
 */

interface Employee {
  id: number; code: string; name: string;
  job_title_id: number | null; job_title: string | null;
  department: string | null; phone: string | null; national_id: string | null;
  hire_date: string | null; salary: string | null;
  branch_id: number | null; user_id: number | null; active: boolean; notes: string | null;
}

interface JobTitle { id: number; name: string; description: string | null; active: boolean }

const money = (v: any) => (v === null || v === undefined || v === ''
  ? '-'
  : Number(v).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [titles, setTitles] = useState<JobTitle[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [hireDate, setHireDate] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [newTitle, setNewTitle] = useState('');

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
    api.get('/api/v1/users').then((r) => setUsers(r.data || [])).catch(() => {});
  }, []);

  const filter = useListFilter(employees, {
    search: (e) => [e.code, e.name, e.department, e.phone, e.job_title],
    filters: {
      active: (e, v) => e.active === (v === 'active'),
      job_title_id: (e, v) => e.job_title_id === v,
    },
  });

  // السطر يفتح التعديل — البيانات الأساسية مافيهاش «عرض» غير الفورم بتاعها نفسه.
  const kb = useTableKeyboard<Employee>({
    rows: filter.filtered, rowKey: (r) => r.id, onOpen: (r) => startEdit(r),
  });

  const startCreate = () => {
    setEditing(null); setForm({}); setHireDate(null); setOpen(true);
  };

  const startEdit = (e: Employee) => {
    setEditing(e);
    setForm({
      name: e.name, job_title_id: e.job_title_id, department: e.department, phone: e.phone,
      national_id: e.national_id, salary: e.salary ? Number(e.salary) : undefined,
      branch_id: e.branch_id, user_id: e.user_id, notes: e.notes,
      warehouse_id: (e as any).warehouse_id, address: (e as any).address,
      work_start: (e as any).work_start, work_end: (e as any).work_end,
      collection_commission_pct: (e as any).collection_commission_pct
        ? Number((e as any).collection_commission_pct) : undefined,
    });
    setHireDate(e.hire_date ? dayjs(e.hire_date) : null);
    setOpen(true);
  };

  const save = async () => {
    if (!form.name) { message.warning('الاسم مطلوب'); return; }
    setSaving(true);
    const payload = {
      ...form,
      salary: form.salary === undefined || form.salary === null ? null : String(form.salary),
      hire_date: hireDate ? hireDate.format('YYYY-MM-DD') : null,
    };
    try {
      if (editing) {
        await api.patch(`/api/v1/employees/${editing.id}`, payload);
        message.success('اتحفظ التعديل');
      } else {
        await api.post('/api/v1/employees', payload);
        message.success('اتسجّل الموظف');
      }
      setOpen(false); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
    } finally { setSaving(false); }
  };

  const deactivate = async (e: Employee) => {
    try {
      await api.delete(`/api/v1/employees/${e.id}`);
      message.success('اتوقف الموظف');
      load();
    } catch { /* interceptor */ }
  };

  const addTitle = async () => {
    if (!newTitle.trim()) return;
    try {
      await api.post('/api/v1/job-titles', { name: newTitle.trim() });
      setNewTitle(''); load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إضافة الوظيفة');
    }
  };

  const employeesTab = (
    <Card
      title="الموظفون"
      extra={(
        <Space>
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />} onClick={startCreate}>موظف جديد</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      <ListToolbar
        searchPlaceholder="بحث بالكود أو الاسم أو القسم أو التليفون"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset} total={employees.length} shown={filter.filtered.length}
        filters={[
          { key: 'active', placeholder: 'الحالة', options: [
            { value: 'active', label: 'على رأس العمل' }, { value: 'inactive', label: 'موقوف' }] },
          { key: 'job_title_id', placeholder: 'الوظيفة',
            options: titles.map((t) => ({ value: t.id, label: t.name })) },
        ]}
      />

      <Table<Employee>
          {...kb.tableProps}
        rowKey="id" size="small" loading={loading} dataSource={filter.filtered}
        locale={{ emptyText: 'لا يوجد موظفون' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        columns={[
          // Their column order: رقم · الاسم · المخزن · الفرع · الوظيفة · مخفي.
          { title: 'رقم', dataIndex: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
          { title: 'الاسم', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
          { title: 'المخزن', dataIndex: 'warehouse_id',
            render: (v: number) => warehouses.find((w) => w.id === v)?.name || '' },
          { title: 'الفرع', dataIndex: 'branch_id',
            render: (v: number) => branches.find((b) => b.id === v)?.name || '' },
          { title: 'الوظيفة', dataIndex: 'job_title', render: (v: string) => v || '' },
          { title: 'التليفون', dataIndex: 'phone', render: (v: string) => v || '' },
          { title: 'تاريخ التعيين', dataIndex: 'hire_date',
            render: (v: string) => (v ? String(v).slice(0, 10) : '-') },
          { title: 'الراتب', dataIndex: 'salary', align: 'left',
            render: (v: string) => money(v) },
          { title: 'له حساب دخول', dataIndex: 'user_id',
            render: (v: number | null) => (v ? <Tag color="blue">نعم</Tag> : '-') },
          { title: 'الحالة', dataIndex: 'active',
            render: (v: boolean) => (v
              ? <Tag color="green">على رأس العمل</Tag> : <Tag>موقوف</Tag>) },
          { title: '', width: 100,
            render: (_: any, r: Employee) => (
              <Space>
                <Button type="text" icon={<EditOutlined />} onClick={() => startEdit(r)} />
                {r.active && (
                  <Popconfirm title="إيقاف الموظف؟" onConfirm={() => deactivate(r)}
                    okText="إيقاف" cancelText="إلغاء">
                    <Button type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </Space>
            ) },
        ]}
      />

      <TabModal
        open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving}
        title={editing ? `تعديل ${editing.name}` : 'موظف جديد'}
        okText="حفظ" cancelText="إلغاء" destroyOnHidden width={720}
      >
        {/* Their موظف جديد form, group for group: name/branch/job, then contact, then the
            working details, then the commission. Ordered as theirs because whoever fills this in
            has the employee's paper in front of them in that order. */}
        <Row gutter={[8, 8]}>
          <Col xs={24} md={8}>
            <Input placeholder="الاسم" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Col>
          <Col xs={24} md={8}>
            <Select allowClear style={{ width: '100%' }} placeholder="الفرع"
              value={form.branch_id} onChange={(v) => setForm({ ...form, branch_id: v })}
              options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          </Col>
          <Col xs={24} md={8}>
            <Select allowClear style={{ width: '100%' }} placeholder="الوظيفة"
              value={form.job_title_id}
              onChange={(v) => setForm({ ...form, job_title_id: v })}
              options={titles.filter((t) => t.active)
                .map((t) => ({ value: t.id, label: t.name }))} />
          </Col>

          <Col xs={24} md={12}>
            <Input placeholder="الهاتف" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Col>
          <Col xs={24} md={12}>
            <Input placeholder="العنوان" value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Col>

          <Col xs={24} md={6}>
            <DatePicker style={{ width: '100%' }} value={hireDate} onChange={setHireDate}
              placeholder="يوم بدايه العمل" />
          </Col>
          <Col xs={24} md={6}>
            {/* Free text, not a time picker: what gets written is «٨ ص» as often as a clean time,
                and a field that refuses that is a field nobody fills. */}
            <Input placeholder="الحضور" value={form.work_start}
              onChange={(e) => setForm({ ...form, work_start: e.target.value })} />
          </Col>
          <Col xs={24} md={6}>
            <Input placeholder="انصراف" value={form.work_end}
              onChange={(e) => setForm({ ...form, work_end: e.target.value })} />
          </Col>
          <Col xs={24} md={6}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="المرتب"
              value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} />
          </Col>

          <Col xs={24} md={8}>
            <InputNumber style={{ width: '100%' }} min={0} max={100} addonAfter="%"
              placeholder="عمولة تحصيلات" value={form.collection_commission_pct}
              onChange={(v) => setForm({ ...form, collection_commission_pct: v })} />
          </Col>
          <Col xs={24} md={8}>
            <Select allowClear style={{ width: '100%' }} placeholder="المخزن"
              value={form.warehouse_id} onChange={(v) => setForm({ ...form, warehouse_id: v })}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          </Col>
          <Col xs={24} md={8}>
            <Select allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
              placeholder="مربوط بمستخدم (اختياري)" value={form.user_id}
              onChange={(v) => setForm({ ...form, user_id: v })}
              options={users.map((u) => ({
                value: u.id, label: u.full_name || u.username }))} />
          </Col>
        </Row>
      </TabModal>
    </Card>
  );

  const titlesTab = (
    <Card title="الوظائف">
      <Space style={{ marginBottom: 12 }}>
        <Input placeholder="اسم الوظيفة" value={newTitle} style={{ width: 240 }}
          onChange={(e) => setNewTitle(e.target.value)} onPressEnter={addTitle} />
        <Button type="primary" icon={<PlusOutlined />} onClick={addTitle}>إضافة</Button>
      </Space>
      <Table<JobTitle>
        rowKey="id" size="small" dataSource={titles} loading={loading}
        locale={{ emptyText: 'لا توجد وظائف' }}
        pagination={{ defaultPageSize: 20 }}
        columns={[
          { title: 'الوظيفة', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
          { title: 'عدد الموظفين',
            render: (_: any, r: JobTitle) =>
              employees.filter((e) => e.job_title_id === r.id).length },
          { title: 'الحالة', dataIndex: 'active',
            render: (v: boolean) => (v ? <Tag color="green">مفعّلة</Tag> : <Tag>موقوفة</Tag>) },
        ]}
      />
    </Card>
  );

  return (
    <Tabs items={[
      { key: 'employees', label: `الموظفون (${employees.length})`, children: employeesTab },
      { key: 'titles', label: `الوظائف (${titles.length})`, children: titlesTab },
    ]} />
  );
}

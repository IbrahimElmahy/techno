import React, { useEffect, useState } from 'react';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { Col, DatePicker, Input, Row, Select, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { InputNumber } from './NumberInput';
import { TabModal } from './TabModal';
import { useScreenShortcuts } from './keyboard';
import { useAuth } from './AuthProvider';

/**
 * فورم الموظف — واحد، بتستعمله شاشة الموظفين وشاشة الأقسام.
 *
 * كان جوّه شاشة الموظفين بس، فشاشة الأقسام لما احتاجت «موظف جديد في القسم ده» و«عدّل الموظف ده»
 * كان قدامها يا تنسخه يا تبعت المستخدم لشاشة تانية. والنسخة التانية من فورم بتبعد عن الأولى من أول
 * خانة تتضاف لواحدة وتتنسي في التانية — فبقى مكون واحد، والشاشتين بيفتحوه.
 *
 * بيحمّل قوايم الاختيار بنفسه (أول مرة يتفتح بس)، عشان اللي بيفتحه مايبقاش لازم يعرف هو محتاج إيه.
 */

export interface Employee {
  id: number; code: string; name: string;
  job_title_id: number | null; job_title: string | null;
  department: string | null; department_id: number | null;
  phone: string | null; national_id: string | null;
  hire_date: string | null; salary: string | null;
  branch_id: number | null; warehouse_id?: number | null; user_id: number | null;
  active: boolean; notes: string | null;
  address?: string | null; work_start?: string | null; work_end?: string | null;
  collection_commission_pct?: string | null;
}

interface Lookups {
  titles: { id: number; name: string; active: boolean }[];
  branches: { id: number; name: string }[];
  warehouses: { id: number; name: string }[];
  users: { id: number; full_name?: string; username: string }[];
  departments: { id: number; name: string; active: boolean }[];
}

const EMPTY: Lookups = { titles: [], branches: [], warehouses: [], users: [], departments: [] };

// الخانات اللي الفورم بيبعتها. القايمة صريحة عشان «امسح الفرع» يتبعت `null` — `undefined`
// بيتشال من الـJSON فالسيرفر كان بيفهمه «ماتغيّرش» والخانة بترجع زي ما كانت بعد الحفظ.
const FIELDS = [
  'name', 'branch_id', 'job_title_id', 'department_id', 'phone', 'address', 'national_id',
  'work_start', 'work_end', 'salary', 'collection_commission_pct', 'warehouse_id', 'user_id', 'notes',
] as const;

export default function EmployeeFormModal({
  open, employee, defaults, onClose, onSaved,
}: {
  open: boolean;
  /** الموظف اللي بيتعدّل — `null` يعني موظف جديد. */
  employee: Employee | null;
  /** قيم مبدئية للموظف الجديد — شاشة الأقسام بتبعت القسم وفرعه. */
  defaults?: Partial<Record<(typeof FIELDS)[number], any>>;
  onClose: () => void;
  onSaved?: (e: Employee) => void;
}) {
  const [lookups, setLookups] = useState<Lookups>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<any>({});
  const [hireDate, setHireDate] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  // موظف الفرع بيسجّل على فرعه هو — السيرفر بيختمه كده مهما اتبعت، فالخانة بتتملّى وتتقفل
  // بدل ما تعرض اختيار هيترفض. المالك/الأدمن (أو حساب مالوش فرع) بيختار.
  const { user } = useAuth();
  const ownBranch = user && user.role !== 'owner' && user.role !== 'system_admin'
    ? (user.branch_id ?? null) : null;

  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    // كل قايمة لوحدها بـ`catch` — مستخدم مالوش صلاحية الأقسام مثلاً لازم يقدر يسجّل موظف برضه.
    const get = (url: string) => api.get(url).then((r) => r.data || []).catch(() => []);
    Promise.all([
      get('/api/v1/job-titles'), get('/api/v1/branches'), get('/api/v1/warehouses'),
      get('/api/v1/users'), get('/api/v1/hr/departments'),
    ]).then(([titles, branches, warehouses, users, departments]) => {
      setLookups({ titles, branches, warehouses, users, departments });
    });
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    if (employee) {
      setForm({
        name: employee.name, job_title_id: employee.job_title_id,
        department_id: employee.department_id, phone: employee.phone,
        national_id: employee.national_id,
        salary: employee.salary ? Number(employee.salary) : undefined,
        branch_id: employee.branch_id, user_id: employee.user_id, notes: employee.notes,
        warehouse_id: employee.warehouse_id, address: employee.address,
        work_start: employee.work_start, work_end: employee.work_end,
        collection_commission_pct: employee.collection_commission_pct
          ? Number(employee.collection_commission_pct) : undefined,
      });
      setHireDate(employee.hire_date ? dayjs(employee.hire_date) : null);
    } else {
      setForm({ ...(ownBranch ? { branch_id: ownBranch } : {}), ...(defaults || {}) });
      setHireDate(null);
    }
    // `defaults` بيتبني جديد مع كل رندر عند اللي بيفتح — الفتح هو اللحظة الوحيدة اللي تهمّ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee]);

  const save = async () => {
    if (!form.name?.trim()) { message.warning('الاسم مطلوب'); return; }
    setSaving(true);
    const payload: any = {};
    for (const k of FIELDS) payload[k] = form[k] === undefined || form[k] === '' ? null : form[k];
    payload.name = form.name.trim();
    payload.salary = payload.salary === null ? null : String(payload.salary);
    payload.collection_commission_pct = payload.collection_commission_pct === null
      ? null : String(payload.collection_commission_pct);
    payload.hire_date = hireDate ? hireDate.format('YYYY-MM-DD') : null;
    try {
      const res = employee
        ? await api.patch(`/api/v1/employees/${employee.id}`, payload)
        : await api.post('/api/v1/employees', payload);
      message.success(employee ? 'تم حفظ التعديل' : 'تم تسجيل الموظف');
      onClose();
      onSaved?.(res.data);
    } catch { /* الرسالة بيطلّعها الـinterceptor */ } finally { setSaving(false); }
  };

  // F9 حفظ — زي باقي الفورمات. مسجّل وهو مفتوح بس، فمابياخدش المفتاح من الشاشة اللي تحته.
  useScreenShortcuts({ onSave: save }, open);

  const { titles, branches, warehouses, users, departments } = lookups;

  return (
    <TabModal
      open={open} onCancel={onClose} onOk={save} confirmLoading={saving}
      title={employee ? `تعديل ${employee.name}` : 'موظف جديد'}
      okText="حفظ" cancelText="إلغاء" destroyOnHidden width={720}
    >
      {/* Their موظف جديد form, group for group: name/branch/job, then contact, then the
          working details, then the commission. Ordered as theirs because whoever fills this in
          has the employee's paper in front of them in that order. */}
      <Row gutter={[8, 8]}>
        <Col xs={24} md={8}>
          <Input placeholder="الاسم" value={form.name} autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Col>
        <Col xs={24} md={8}>
          <Select allowClear={!ownBranch} disabled={!!ownBranch} style={{ width: '100%' }}
            placeholder="الفرع"
            value={form.branch_id} onChange={(v) => setForm({ ...form, branch_id: v })}
            options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        </Col>
        <Col xs={24} md={8}>
          <Select showSearch allowClear style={{ width: '100%' }} placeholder="الوظيفة"
            value={form.job_title_id}
            onChange={(v) => setForm({ ...form, job_title_id: v })}
            options={titles.filter((t) => t.active)
              .map((t) => ({ value: t.id, label: t.name }))} filterOption={searchFilter} filterSort={searchRank} />
        </Col>

        <Col xs={24} md={8}>
          {/* النقل بين الأقسام من هنا. المقفول مش معروض — السيرفر بيرفض النقل ليه — إلا لو
              الموظف أصلاً فيه، عشان الخانة ماتظهرش رقم من غير اسم. */}
          <Select showSearch allowClear style={{ width: '100%' }} placeholder="القسم"
            value={form.department_id}
            onChange={(v) => setForm({ ...form, department_id: v })}
            options={departments
              .filter((d) => d.active || d.id === employee?.department_id)
              .map((d) => ({ value: d.id, label: d.name }))} filterOption={searchFilter} filterSort={searchRank} />
        </Col>
        <Col xs={24} md={8}>
          <Input placeholder="الهاتف" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Col>
        <Col xs={24} md={8}>
          <Input placeholder="العنوان" value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Col>

        <Col xs={24} md={6}>
          <DatePicker style={{ width: '100%' }} value={hireDate} onChange={setHireDate}
            placeholder="يوم بداية العمل" />
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
          <Select showSearch allowClear style={{ width: '100%' }} placeholder="المخزن"
            value={form.warehouse_id} onChange={(v) => setForm({ ...form, warehouse_id: v })}
            options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank} />
        </Col>
        <Col xs={24} md={8}>
          <Select allowClear showSearch style={{ width: '100%' }}
            placeholder="مربوط بمستخدم (اختياري)" value={form.user_id}
            onChange={(v) => setForm({ ...form, user_id: v })}
            options={users.map((u) => ({
              value: u.id, label: u.full_name || u.username }))} filterOption={searchFilter} filterSort={searchRank}/>
        </Col>
      </Row>
    </TabModal>
  );
}

/* ----------------------------------------------------------- أفعال على موظف واحد
 * نفس الأفعال في الشاشتين، فمكانها هنا. كلها بترجع `true` لو نجحت؛ الفشل رسالته بيطلّعها
 * الـinterceptor (والمسح المرفوض رسالته فيها الأرقام وبتقول «استعمل إيقاف»).
 */

export async function deactivateEmployee(e: Employee): Promise<boolean> {
  try {
    await api.delete(`/api/v1/employees/${e.id}`);
    message.success('اتوقف الموظف');
    return true;
  } catch { return false; }
}

export async function reactivateEmployee(e: Employee): Promise<boolean> {
  try {
    await api.patch(`/api/v1/employees/${e.id}`, { active: true });
    message.success('رجع على رأس العمل');
    return true;
  } catch { return false; }
}

/** مسح نهائي — السيرفر بيرفضه لو الموظف له أي تاريخ. */
export async function deleteEmployee(e: Employee): Promise<boolean> {
  try {
    await api.delete(`/api/v1/employees/${e.id}`, { params: { hard: true } });
    message.success('اتمسح الموظف');
    return true;
  } catch { return false; }
}

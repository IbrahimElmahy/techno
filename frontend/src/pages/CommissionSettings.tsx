import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, DatePicker, Empty, Input, InputNumber, Row, Select, Space,
  Spin, Table, Tag, Tooltip, message,
} from 'antd';
import {
  CalculatorOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';

import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import { TabModal } from '../components/TabModal';
import { useQueryTab } from '../components/useQueryTab';
import { roleForAccess, useAuth } from '../components/AuthProvider';
import { money, num } from '../utils/money';
import { searchFilter } from '../utils/arabicSort';

/**
 * إعدادات العمولات ومعاينة الشهر — بديل بلوكات ملف «مرتبات شهر اكتوبر».
 *
 * الملف كان فيه بلوك لكل سيارة وبلوك لكل مشرف وبلوك «خصم ٢٥٪» وجدول للفنيين، والأسماء والنسب
 * جوّه المعادلات. هنا كل حاجة من دول صف بيتعدّل من الشاشة (السيارات، المشرفين، الفنيين، وأرقام
 * الفرع)، و«معاينة الشهر» بتحسب من بيانات النظام وبتعرض نفس البلوكات بنفس ترتيبها — عشان
 * المحاسب يقارن رقم برقم مع اللي اتعوّد عليه قبل ما يعتمد الشيت.
 *
 * الشيت نفسه (شيت المرتبات) بيقرا نفس الحساب من السيرفر — الشاشة دي مابتكتبش في المرتبات.
 */

type Fam = { poly: number | string; white: number | string; other: number | string };

interface TeamRow {
  id: number; name: string; rate_poly: string; rate_white: string; rate_other: string;
  split_equally: boolean; penalty_enabled: boolean; credit_limit: string; active: boolean;
  sort_order: number; notes: string | null;
  users: { user_id: number; name: string | null }[];
  members: { employee_id: number; name: string | null; exempt_25: boolean }[];
}
interface SupRow {
  id: number; employee_id: number; employee_name: string | null; label: string | null;
  rate_poly: string; rate_white: string; rate_other: string; penalty_rate: string;
  period_offset: number; deduct_absence: boolean; active: boolean; sort_order: number;
  notes: string | null; teams: { team_id: number; name: string | null }[];
}
interface TechRow {
  id: number; employee_id: number; employee_name: string | null; user_id: number | null;
  user_name: string | null; factor: string; min_inspections: number; inspection_rate: string;
  plumber_rate: string; scope: 'own' | 'all'; active: boolean; sort_order: number;
  notes: string | null;
}
interface Settings {
  point_value: number | string; points_per_coupon: number; factor_divisor: number | string;
  absence_divisor: number | string; penalty_sales_pct: number | string;
  penalty_per_thousand: number | string; attribute_by_customer_rep: boolean;
  pay_coupon_commission: boolean; apply_min_inspections: boolean;
}
interface Setup {
  branch: { id: number; name: string };
  settings: Settings;
  teams: TeamRow[]; supervisors: SupRow[]; technicians: TechRow[];
  options: {
    employees: { id: number; name: string; code: string; active: boolean; user_id: number | null }[];
    users: { id: number; name: string; username: string; role: string | null; active: boolean }[];
  };
}

const pct = (v: unknown) => `${num(v, { maximumFractionDigits: 4 })}٪`;
const errText = (err: any, fallback: string) => err?.response?.data?.detail?.message || fallback;

/** خانة بعنوان فوقها — نفس شكل فورمات شاشات المرتبات. */
function Field({ label, children, span = 8, hint }: {
  label: React.ReactNode; children: React.ReactNode; span?: number; hint?: React.ReactNode;
}) {
  return (
    <Col span={span}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {children}
      {hint ? <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{hint}</div> : null}
    </Col>
  );
}

const emptyTeam = {
  name: '', rate_poly: 2.5, rate_white: 2, rate_other: 2, split_equally: true,
  penalty_enabled: false, credit_limit: 0, active: true, sort_order: 0, notes: '',
  users: [] as number[], members: [] as { employee_id?: number; exempt_25: boolean }[],
};
const emptySup = {
  employee_id: undefined as number | undefined, label: '', rate_poly: 0.5, rate_white: 0.5,
  rate_other: 0.5, penalty_rate: 0, period_offset: 0, deduct_absence: true, active: true,
  sort_order: 0, notes: '', teams: [] as number[],
};
const emptyTech = {
  employee_id: undefined as number | undefined, factor: 3.6, min_inspections: 0,
  inspection_rate: 48, plumber_rate: 10, scope: 'own' as 'own' | 'all', active: true,
  sort_order: 0, notes: '',
};

export default function CommissionSettings() {
  const { user } = useAuth();
  const seesAll = !user?.branch_id || roleForAccess(user?.role) === 'system_admin';
  const [tab, setTab] = useQueryTab('teams', 'tab');
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [branchId, setBranchId] = useState<number | undefined>(user?.branch_id ?? undefined);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const params = branchId ? { branch_id: branchId } : {};

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/api/v1/hr/commissions/setup', { params });
      setSetup(res.data);
      if (!branchId) setBranchId(res.data?.branch?.id);
    } catch (err: any) {
      setSetup(null);
      setLoadError(errText(err, 'تعذر تحميل إعدادات العمولات'));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (seesAll) {
      api.get('/api/v1/branches').then((r) => {
        const list = r.data || [];
        setBranches(list);
        if (!branchId && list.length) setBranchId(list[0].id);
      }).catch(() => undefined);
    }
  }, []);
  useEffect(() => { if (branchId || !seesAll) load(); }, [branchId]);

  const employees = setup?.options.employees || [];
  const empOptions = useMemo(() => employees.map((e) => ({
    value: e.id, label: e.active ? e.name : `${e.name} (موقوف)`,
  })), [employees]);
  const repUserOptions = useMemo(() => (setup?.options.users || [])
    .filter((u) => u.role === 'sales_rep')
    .map((u) => ({ value: u.id, label: `${u.name}${u.active ? '' : ' (موقوف)'}` })), [setup]);
  const teamOptions = useMemo(() => (setup?.teams || [])
    .map((t) => ({ value: t.id, label: t.name })), [setup]);

  // ------------------------------------------------------------ السيارات
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamEditing, setTeamEditing] = useState<TeamRow | null>(null);
  const [teamForm, setTeamForm] = useState({ ...emptyTeam });
  const [saving, setSaving] = useState(false);

  const openTeam = (row: TeamRow | null) => {
    setTeamEditing(row);
    setTeamForm(row ? {
      name: row.name, rate_poly: Number(row.rate_poly), rate_white: Number(row.rate_white),
      rate_other: Number(row.rate_other), split_equally: row.split_equally,
      penalty_enabled: row.penalty_enabled, credit_limit: Number(row.credit_limit),
      active: row.active, sort_order: row.sort_order, notes: row.notes || '',
      users: row.users.map((u) => u.user_id),
      members: row.members.map((m) => ({ employee_id: m.employee_id, exempt_25: m.exempt_25 })),
    } : { ...emptyTeam, sort_order: (setup?.teams.length || 0) });
    setTeamOpen(true);
  };

  const saveTeam = async () => {
    if (!teamForm.name.trim()) { message.warning('اكتب اسم السيارة'); return; }
    const members = teamForm.members.filter((m) => m.employee_id);
    setSaving(true);
    try {
      const body = { ...teamForm, members };
      if (teamEditing) await api.put(`/api/v1/hr/commissions/teams/${teamEditing.id}`, body, { params });
      else await api.post('/api/v1/hr/commissions/teams', body, { params });
      message.success('اتحفظت');
      setTeamOpen(false);
      load();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحفظ'));
    } finally { setSaving(false); }
  };

  const removeRow = async (kind: 'teams' | 'supervisors' | 'technicians', id: number) => {
    try {
      await api.delete(`/api/v1/hr/commissions/${kind}/${id}`, { params });
      message.success('اتمسحت');
      load();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحذف'));
    }
  };

  const teamColumns: ColumnsType<TeamRow> = [
    { title: 'السيارة', dataIndex: 'name', key: 'name', width: 140,
      render: (v, r) => (<>{v}{!r.active && <Tag style={{ marginInlineStart: 6 }}>موقوفة</Tag>}</>) },
    { title: 'بولي', dataIndex: 'rate_poly', key: 'rate_poly', width: 80, render: pct },
    { title: 'أبيض', dataIndex: 'rate_white', key: 'rate_white', width: 80, render: pct },
    { title: 'من غير عيلة', dataIndex: 'rate_other', key: 'rate_other', width: 100, render: pct },
    { title: 'التقسيم', dataIndex: 'split_equally', key: 'split', width: 110,
      render: (v) => (v ? 'بالتساوي' : 'كاملة لكل فرد') },
    { title: 'الأفراد', key: 'members',
      render: (_, r) => (r.members.length ? r.members.map((m) => (
        <Tag key={m.employee_id} color={m.exempt_25 && r.penalty_enabled ? 'default' : 'blue'}>
          {m.name}{m.exempt_25 && r.penalty_enabled ? ' — معفي من ٢٥٪' : ''}
        </Tag>
      )) : <span style={{ color: '#999' }}>—</span>) },
    { title: 'حسابات المناديب', key: 'users', width: 200,
      render: (_, r) => (r.users.length ? r.users.map((u) => u.name).join('، ')
        : <span style={{ color: '#999' }}>حسابات الأفراد</span>) },
    { title: 'خصم ٢٥٪', key: 'penalty', width: 150,
      render: (_, r) => (r.penalty_enabled ? `ائتمان ${money(r.credit_limit)}` : '—') },
    { title: '', key: 'ops', width: 90,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="تعديل"><Button size="small" icon={<EditOutlined />} onClick={() => openTeam(r)} /></Tooltip>
          <Tooltip title="حذف"><Button size="small" danger icon={<DeleteOutlined />}
            onClick={() => removeRow('teams', r.id)} /></Tooltip>
        </Space>
      ) },
  ];

  // ------------------------------------------------------------ المشرفين
  const [supOpen, setSupOpen] = useState(false);
  const [supEditing, setSupEditing] = useState<SupRow | null>(null);
  const [supForm, setSupForm] = useState({ ...emptySup });

  const openSup = (row: SupRow | null) => {
    setSupEditing(row);
    setSupForm(row ? {
      employee_id: row.employee_id, label: row.label || '', rate_poly: Number(row.rate_poly),
      rate_white: Number(row.rate_white), rate_other: Number(row.rate_other),
      penalty_rate: Number(row.penalty_rate), period_offset: row.period_offset,
      deduct_absence: row.deduct_absence, active: row.active, sort_order: row.sort_order,
      notes: row.notes || '', teams: row.teams.map((t) => t.team_id),
    } : { ...emptySup, sort_order: (setup?.supervisors.length || 0) });
    setSupOpen(true);
  };

  const saveSup = async () => {
    if (!supForm.employee_id) { message.warning('اختار الموظف'); return; }
    setSaving(true);
    try {
      if (supEditing) await api.put(`/api/v1/hr/commissions/supervisors/${supEditing.id}`, supForm, { params });
      else await api.post('/api/v1/hr/commissions/supervisors', supForm, { params });
      message.success('اتحفظ');
      setSupOpen(false);
      load();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحفظ'));
    } finally { setSaving(false); }
  };

  const supColumns: ColumnsType<SupRow> = [
    { title: 'المشرف', dataIndex: 'employee_name', key: 'name', width: 170,
      render: (v, r) => (<>{v}{!r.active && <Tag style={{ marginInlineStart: 6 }}>موقوف</Tag>}</>) },
    { title: 'الوصف', dataIndex: 'label', key: 'label', width: 140 },
    { title: 'السيارات', key: 'teams', render: (_, r) => r.teams.map((t) => <Tag key={t.team_id}>{t.name}</Tag>) },
    { title: 'بولي', dataIndex: 'rate_poly', key: 'rp', width: 80, render: pct },
    { title: 'أبيض', dataIndex: 'rate_white', key: 'rw', width: 80, render: pct },
    { title: 'من غير عيلة', dataIndex: 'rate_other', key: 'ro', width: 100, render: pct },
    { title: 'تحصيل', dataIndex: 'period_offset', key: 'po', width: 110,
      render: (v) => (v ? 'الشهر اللي فات' : 'نفس الشهر') },
    { title: 'غياب', dataIndex: 'deduct_absence', key: 'da', width: 70, render: (v) => (v ? 'بيتخصم' : '—') },
    { title: 'خصم من زيادة ٢٥٪', dataIndex: 'penalty_rate', key: 'pr', width: 130,
      render: (v) => (Number(v) ? pct(v) : '—') },
    { title: '', key: 'ops', width: 90,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="تعديل"><Button size="small" icon={<EditOutlined />} onClick={() => openSup(r)} /></Tooltip>
          <Tooltip title="حذف"><Button size="small" danger icon={<DeleteOutlined />}
            onClick={() => removeRow('supervisors', r.id)} /></Tooltip>
        </Space>
      ) },
  ];

  // ------------------------------------------------------------ الفنيين
  const [techOpen, setTechOpen] = useState(false);
  const [techEditing, setTechEditing] = useState<TechRow | null>(null);
  const [techForm, setTechForm] = useState({ ...emptyTech });

  const openTech = (row: TechRow | null) => {
    setTechEditing(row);
    setTechForm(row ? {
      employee_id: row.employee_id, factor: Number(row.factor),
      min_inspections: row.min_inspections, inspection_rate: Number(row.inspection_rate),
      plumber_rate: Number(row.plumber_rate), scope: row.scope, active: row.active,
      sort_order: row.sort_order, notes: row.notes || '',
    } : { ...emptyTech, sort_order: (setup?.technicians.length || 0) });
    setTechOpen(true);
  };

  const saveTech = async () => {
    if (!techForm.employee_id) { message.warning('اختار الموظف'); return; }
    setSaving(true);
    try {
      if (techEditing) await api.put(`/api/v1/hr/commissions/technicians/${techEditing.id}`, techForm, { params });
      else await api.post('/api/v1/hr/commissions/technicians', techForm, { params });
      message.success('اتحفظ');
      setTechOpen(false);
      load();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحفظ'));
    } finally { setSaving(false); }
  };

  const techColumns: ColumnsType<TechRow> = [
    { title: 'الفني', dataIndex: 'employee_name', key: 'name', width: 170,
      render: (v, r) => (<>{v}{!r.active && <Tag style={{ marginInlineStart: 6 }}>موقوف</Tag>}</>) },
    { title: 'حساب التطبيق', dataIndex: 'user_name', key: 'user', width: 160,
      render: (v) => v || <Tag color="orange">مالوش حساب</Tag> },
    { title: 'المعامل', dataIndex: 'factor', key: 'factor', width: 80, render: (v) => num(v) },
    { title: 'الحد الأدنى للمعاينات', dataIndex: 'min_inspections', key: 'min', width: 140 },
    { title: 'سعر المعاينة', dataIndex: 'inspection_rate', key: 'ir', width: 100, render: money },
    { title: 'سعر السباك', dataIndex: 'plumber_rate', key: 'pr', width: 100, render: money },
    { title: 'النطاق', dataIndex: 'scope', key: 'scope', width: 120,
      render: (v) => (v === 'all' ? 'كل الفنيين' : 'شغله هو') },
    { title: '', key: 'ops', width: 90,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="تعديل"><Button size="small" icon={<EditOutlined />} onClick={() => openTech(r)} /></Tooltip>
          <Tooltip title="حذف"><Button size="small" danger icon={<DeleteOutlined />}
            onClick={() => removeRow('technicians', r.id)} /></Tooltip>
        </Space>
      ) },
  ];

  // ------------------------------------------------------------ أرقام الفرع
  const [settingsForm, setSettingsForm] = useState<Settings | null>(null);
  useEffect(() => { setSettingsForm(setup ? { ...setup.settings } : null); }, [setup]);

  const saveSettings = async () => {
    if (!settingsForm) return;
    setSaving(true);
    try {
      await api.put('/api/v1/hr/commissions/settings', settingsForm, { params });
      message.success('اتحفظت');
      load();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحفظ'));
    } finally { setSaving(false); }
  };

  // ------------------------------------------------------------ معاينة الشهر
  const [period, setPeriod] = useState<Dayjs>(dayjs().startOf('month'));
  const [preview, setPreview] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const res = await api.get('/api/v1/hr/commissions/compute', {
        params: { ...params, year: period.year(), month: period.month() + 1 },
      });
      setPreview(res.data);
    } catch (err: any) {
      setPreview(null);
      message.error(errText(err, 'تعذر الحساب'));
    } finally { setPreviewing(false); }
  };
  useEffect(() => { if (tab === 'preview' && setup) runPreview(); }, [tab, period, setup?.branch.id]);

  // تحصيل يدوي لسيارة في الشهر (اسكندرية / الضبعة في الملف).
  const [manualTeam, setManualTeam] = useState<any | null>(null);
  const [manualForm, setManualForm] = useState({ poly: 0, white: 0, other: 0, notes: '' });
  const openManual = (team: any) => {
    const m = team.collections.manual || {};
    setManualForm({ poly: Number(m.poly || 0), white: Number(m.white || 0),
      other: Number(m.other || 0), notes: team.collections.manual_notes || '' });
    setManualTeam(team);
  };
  const saveManual = async () => {
    if (!manualTeam) return;
    setSaving(true);
    try {
      await api.put(`/api/v1/hr/commissions/teams/${manualTeam.id}/manual`, {
        ...manualForm, year: period.year(), month: period.month() + 1,
      }, { params });
      message.success('اتحفظ');
      setManualTeam(null);
      runPreview();
    } catch (err: any) {
      message.error(errText(err, 'تعذر الحفظ'));
    } finally { setSaving(false); }
  };

  const details = preview?.details;
  const employeesRows: any[] = preview?.employees || [];
  const totals = useMemo(() => employeesRows.reduce((acc, r) => ({
    earnings: acc.earnings + Number(r.earnings || 0),
    deductions: acc.deductions + Number(r.deductions || 0),
  }), { earnings: 0, deductions: 0 }), [employeesRows]);

  const moneyCell = (v: unknown) => (Number(v) ? money(v) : <span style={{ color: '#bbb' }}>—</span>);
  const empColumns: ColumnsType<any> = [
    { title: 'الموظف', dataIndex: 'name', key: 'name', width: 180, fixed: 'right' },
    { title: 'عمولة السيارة', dataIndex: 'commission', key: 'c', render: moneyCell },
    { title: 'إشراف', dataIndex: 'supervision', key: 's', render: moneyCell },
    { title: 'عمولة المعاينات', dataIndex: 'inspection_commission', key: 'i', render: moneyCell },
    { title: 'التعامل مع الفنيين', dataIndex: 'technician_bonus', key: 'b', render: moneyCell },
    { title: 'عمولة الكوبونات (بتتصرف)', dataIndex: 'coupon_commission_payable', key: 'cp', render: moneyCell },
    { title: 'أيام الغياب', dataIndex: 'absent_days', key: 'a', width: 90,
      render: (v) => (Number(v) ? num(v) : '—') },
    { title: 'إجمالي العمولات', dataIndex: 'earnings', key: 'e', render: (v) => <b>{money(v)}</b> },
    { title: 'خصم ٢٥٪', dataIndex: 'penalty_25', key: 'p',
      render: (v) => (Number(v) ? <span style={{ color: '#cf1322' }}>{money(v)}</span> : '—') },
    { title: 'الصافي', key: 'net',
      render: (_, r) => <b>{money(Number(r.earnings) - Number(r.deductions))}</b> },
  ];

  /** جدول صغير على شكل بلوك الملف: صفوف بعنوان وعمود لكل عيلة. */
  const famTable = (rows: { label: React.ReactNode; vals: Fam & { total?: any }; fmt?: (v: any) => React.ReactNode }[]) => (
    <table className="comm-block">
      <thead>
        <tr><th /> <th>بولي / تكنو</th><th>أبيض</th><th>من غير عيلة</th><th>الإجمالي</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const f = r.fmt || money;
          const total = r.vals.total ?? (Number(r.vals.poly) + Number(r.vals.white) + Number(r.vals.other));
          return (
            <tr key={i}>
              <th>{r.label}</th>
              <td>{f(r.vals.poly)}</td><td>{f(r.vals.white)}</td><td>{f(r.vals.other)}</td>
              <td>{r.fmt ? '' : <b>{money(total)}</b>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const kv = (rows: [React.ReactNode, React.ReactNode][]) => (
    <table className="comm-block comm-kv">
      <tbody>
        {rows.map(([k, v], i) => <tr key={i}><th>{k}</th><td>{v}</td></tr>)}
      </tbody>
    </table>
  );

  const renderPreview = () => {
    if (previewing && !preview) return <Spin style={{ margin: 40 }} />;
    if (!details) return <Empty description="اختار الشهر" />;
    const st = details.settings;
    return (
      <Spin spinning={previewing}>
        {details.warnings?.length ? (
          <Alert type="warning" showIcon style={{ margin: '6px 0 10px' }}
            message="ملاحظات على الحساب"
            description={<ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {details.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>} />
        ) : null}

        <h3 className="comm-h">ملخص الموظفين</h3>
        <Table className="sl-table" size="small" rowKey="employee_id" pagination={false}
          columns={empColumns} dataSource={employeesRows} scroll={{ x: 1100 }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
              <Table.Summary.Cell index={1} colSpan={6} />
              <Table.Summary.Cell index={7}><b>{money(totals.earnings)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={8}><b>{money(totals.deductions)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={9}><b>{money(totals.earnings - totals.deductions)}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          )} />

        <h3 className="comm-h">السيارات — تحصيل {details.period.from} إلى {details.period.to}</h3>
        <Row gutter={[12, 12]}>
          {details.teams.map((t: any) => (
            <Col key={t.id} xs={24} xl={12}>
              <Card size="small" title={t.name}
                extra={<Space size={6}>
                  {t.users.length ? <span style={{ color: '#888', fontSize: 12 }}>
                    {t.users.map((u: any) => u.name).join('، ')}</span> : null}
                  <Button size="small" onClick={() => openManual(t)}>تحصيل يدوي</Button>
                </Space>}>
                {famTable([
                  { label: 'التحصيل', vals: { ...t.collections, total: t.collections.total } },
                  { label: 'النسبة', vals: t.rates, fmt: pct },
                  { label: 'العمولة', vals: { ...t.parts, total: t.commission } },
                ])}
                <div className="comm-note">
                  منه نقدي على الفواتير {money(t.collections.invoice_cash)} وسندات قبض{' '}
                  {money(t.collections.receipts)} ({num(t.collections.receipt_count)} سند)
                  {Number(t.collections.via_customer) ? <> — منه {money(t.collections.via_customer)} اتحسب
                    بمندوب العميل (مستندات من غير مندوب)</> : null}
                  {(Number(t.collections.manual.poly) + Number(t.collections.manual.white)
                    + Number(t.collections.manual.other)) ? <> — فيه تحصيل يدوي{' '}
                    {money(Number(t.collections.manual.poly) + Number(t.collections.manual.white)
                      + Number(t.collections.manual.other))}</> : null}
                </div>
                <div className="comm-share">
                  نصيب الفرد من العمولة: <b>{money(t.share_per_member)}</b>
                  {t.split_equally ? ` (÷ ${num(t.member_count)})` : ' (كاملة لكل فرد)'}
                </div>
                {t.members.length ? (
                  <table className="comm-block">
                    <thead><tr><th>المندوب</th><th>عدد أيام الغياب</th><th>العمولة</th>
                      <th>خ من عمولة</th><th>الصافي</th></tr></thead>
                    <tbody>{t.members.map((m: any) => (
                      <tr key={m.employee_id}><th>{m.name}</th><td>{num(m.absent_days)}</td>
                        <td>{money(m.share)}</td><td>{money(m.absence_deduction)}</td>
                        <td><b>{money(m.net)}</b></td></tr>
                    ))}</tbody>
                  </table>
                ) : <div className="comm-note">مالهاش أفراد.</div>}

                {t.penalty?.enabled ? (<>
                  <div className="comm-sub">خصم {num(t.penalty.sales_pct)}٪</div>
                  {kv([
                    ['اجمالي البيع', money(t.penalty.sales)],
                    [`${num(t.penalty.sales_pct)}٪ من البيع`, money(t.penalty.sales_pct_amount)],
                    ['المديونية (آخر الشهر)', money(t.penalty.debt)],
                    ['الائتمان', money(t.penalty.credit_limit)],
                    ['المديونية بعد الائتمان', money(t.penalty.debt_after_credit)],
                    ['الفرق', <span style={{ color: Number(t.penalty.excess) > 0 ? '#cf1322' : undefined }}>
                      {money(t.penalty.excess)}</span>],
                    [`على كل 1000 زيادة ${num(t.penalty.per_thousand)}ج`, <b>{money(t.penalty.penalty)}</b>],
                    ['نصيب الفرد', money(t.penalty.share_per_member)],
                    ...t.penalty.members.map((m: any) => [
                      m.name, m.exempt_25 ? <Tag>معفي</Tag> : money(m.amount),
                    ] as [React.ReactNode, React.ReactNode]),
                  ])}
                </>) : null}
              </Card>
            </Col>
          ))}
        </Row>

        {details.supervisors.length ? <h3 className="comm-h">المشرفين</h3> : null}
        <Row gutter={[12, 12]}>
          {details.supervisors.map((s: any) => (
            <Col key={s.id} xs={24} xl={12}>
              <Card size="small" title={<>{s.name}{s.label ? <span style={{ color: '#888' }}> — {s.label}</span> : null}</>}
                extra={<span style={{ color: '#888', fontSize: 12 }}>
                  تحصيل {s.period.month}/{s.period.year}{s.period_offset ? ' (الشهر السابق)' : ''}</span>}>
                <table className="comm-block">
                  <thead><tr><th>السيارة</th><th>بولي / تكنو</th><th>أبيض</th><th>من غير عيلة</th><th>الإجمالي</th></tr></thead>
                  <tbody>
                    {s.teams.map((t: any) => (
                      <tr key={t.team_id}><th>{t.name}</th><td>{money(t.poly)}</td><td>{money(t.white)}</td>
                        <td>{money(t.other)}</td><td>{money(t.total)}</td></tr>
                    ))}
                    <tr className="comm-total"><th>الاجمالى</th><td>{money(s.totals.poly)}</td>
                      <td>{money(s.totals.white)}</td><td>{money(s.totals.other)}</td><td>{money(s.totals.total)}</td></tr>
                    <tr><th>النسبة</th><td>{pct(s.rates.poly)}</td><td>{pct(s.rates.white)}</td><td>{pct(s.rates.other)}</td><td /></tr>
                    <tr><th>العمولة</th><td>{money(s.parts.poly)}</td><td>{money(s.parts.white)}</td>
                      <td>{money(s.parts.other)}</td><td><b>{money(s.gross)}</b></td></tr>
                  </tbody>
                </table>
                {kv([
                  ...(s.deduct_absence ? [[`غياب (${num(s.absent_days)} يوم)`, money(s.absence_deduction)]] : []) as [React.ReactNode, React.ReactNode][],
                  ['الصافى', <b>{money(s.net)}</b>],
                  ...(Number(s.penalty_rate) ? [
                    [`خصم ${pct(s.penalty_rate)} من زيادة سياراته (${money(s.penalty_base)})`,
                      <span style={{ color: '#cf1322' }}>{money(s.penalty)}</span>],
                  ] : []) as [React.ReactNode, React.ReactNode][],
                ])}
              </Card>
            </Col>
          ))}
        </Row>

        {details.technicians.length ? (<>
          <h3 className="comm-h">الفنيين (خدمة العملاء) — قيمة النقطة {num(st.point_value, { maximumFractionDigits: 4 })}</h3>
          <Table className="sl-table" size="small" rowKey="id" pagination={false} scroll={{ x: 1500 }}
            dataSource={details.technicians}
            columns={[
              { title: 'الاسم', dataIndex: 'name', key: 'n', width: 150, fixed: 'right',
                render: (v, r: any) => (<>{v}{r.scope === 'all' ? <Tag style={{ marginInlineStart: 4 }}>كل الفنيين</Tag> : null}</>) },
              { title: 'عدد الكوبونات', dataIndex: 'coupons', key: 'c', render: (v) => num(v) },
              { title: 'عدد النقاط', dataIndex: 'points', key: 'p', render: (v) => num(v) },
              { title: 'قيمة النقاط', dataIndex: 'points_value', key: 'pv', render: money },
              { title: 'نسبة العمولة', dataIndex: 'factor', key: 'f', render: (v) => num(v) },
              { title: 'عمولة الكوبونات', dataIndex: 'coupon_commission', key: 'cc', render: money },
              { title: 'الفنيين اللي اتعامل معاهم', dataIndex: 'plumbers', key: 'pl', render: (v) => num(v) },
              { title: 'عدد المعاينات', dataIndex: 'inspections', key: 'i', render: (v) => num(v) },
              { title: 'الحد الادنى للمعاينات', dataIndex: 'min_inspections', key: 'm', render: (v) => num(v) },
              { title: 'نصيب المعاينة من الخصم', dataIndex: 'per_inspection_share', key: 'ps', render: money },
              { title: 'خصم المعاينات', dataIndex: 'min_inspection_deduction', key: 'md',
                render: (v) => (st.apply_min_inspections ? money(v)
                  : <Tooltip title="محسوب للعرض — مش مطبّق (من أرقام الفرع)"><span style={{ color: '#999' }}>{money(v)}</span></Tooltip>) },
              { title: 'عمولة المعاينة', dataIndex: 'inspection_rate', key: 'ir', render: money },
              { title: 'عمولة المعاينات', dataIndex: 'inspection_commission', key: 'ic', render: money },
              { title: 'التعامل مع الفنيين', dataIndex: 'technician_bonus', key: 'tb', render: money },
              { title: 'عمولة كوبونات بتتصرف', dataIndex: 'coupon_commission_payable', key: 'cp', render: money },
              { title: 'اجمالي العمولات', dataIndex: 'total', key: 't', render: (v) => <b>{money(v)}</b> },
            ]} />
        </>) : null}
      </Spin>
    );
  };

  // ------------------------------------------------------------ الصفحة
  const tabs = [
    { key: 'teams', label: 'السيارات', count: setup?.teams.length ?? null },
    { key: 'supervisors', label: 'المشرفين', count: setup?.supervisors.length ?? null },
    { key: 'technicians', label: 'الفنيين', count: setup?.technicians.length ?? null },
    { key: 'general', label: 'أرقام الفرع' },
    { key: 'preview', label: 'معاينة الشهر' },
  ];

  const filters = (
    <>
      {seesAll ? (
        <Select style={{ minWidth: 180 }} placeholder="الفرع" value={branchId}
          onChange={(v) => { setBranchId(v); setPreview(null); }}
          options={branches.map((b) => ({ value: b.id, label: b.name }))} />
      ) : null}
      {tab === 'preview' ? (
        <DatePicker picker="month" format="YYYY/MM" allowClear={false} value={period}
          onChange={(v) => v && setPeriod(v.startOf('month'))} />
      ) : null}
    </>
  );

  return (
    <>
      <ListPage
        icon={<CalculatorOutlined />}
        title="إعدادات العمولات"
        muted={setup ? `(${setup.branch.name})` : undefined}
        subtitle="السيارات ونسبها، المشرفين، خصم ٢٥٪، الفنيين — والحساب الفعلي لأي شهر"
        tabs={tabs as any}
        activeTab={tab}
        onTabChange={setTab}
        filters={(seesAll || tab === 'preview') ? filters : undefined}
        summary={tab === 'preview' && details ? (<>
          <ListStat label="إجمالي العمولات" value={money(totals.earnings)} tone="pos" />
          <ListStat label="خصم ٢٥٪" value={money(totals.deductions)} tone="neg" />
          <ListStat label="الصافي" value={money(totals.earnings - totals.deductions)} tone="strong" />
          <ListStat label="عدد الموظفين" value={num(employeesRows.length)} />
        </>) : undefined}
        actions={(<>
          {tab === 'teams' ? <Button type="primary" className="sl-create" icon={<PlusOutlined />}
            disabled={!setup} onClick={() => openTeam(null)}>سيارة جديدة</Button> : null}
          {tab === 'supervisors' ? <Button type="primary" className="sl-create" icon={<PlusOutlined />}
            disabled={!setup} onClick={() => openSup(null)}>مشرف جديد</Button> : null}
          {tab === 'technicians' ? <Button type="primary" className="sl-create" icon={<PlusOutlined />}
            disabled={!setup} onClick={() => openTech(null)}>فني جديد</Button> : null}
          {tab === 'general' ? <Button type="primary" icon={<SaveOutlined />} loading={saving}
            disabled={!settingsForm} onClick={saveSettings}>حفظ</Button> : null}
          <Button icon={<ReloadOutlined />} onClick={() => (tab === 'preview' ? runPreview() : load())}>تحديث</Button>
        </>)}
      >
        {loadError ? <Alert type="error" showIcon style={{ margin: 8 }} message={loadError} /> : null}
        {tab === 'teams' ? (
          <Table className="sl-table" size="small" rowKey="id" loading={loading} pagination={false}
            columns={teamColumns} dataSource={setup?.teams || []}
            onRow={(r) => ({ onDoubleClick: () => openTeam(r) })} />
        ) : tab === 'supervisors' ? (
          <Table className="sl-table" size="small" rowKey="id" loading={loading} pagination={false}
            columns={supColumns} dataSource={setup?.supervisors || []}
            onRow={(r) => ({ onDoubleClick: () => openSup(r) })} />
        ) : tab === 'technicians' ? (
          <Table className="sl-table" size="small" rowKey="id" loading={loading} pagination={false}
            columns={techColumns} dataSource={setup?.technicians || []}
            onRow={(r) => ({ onDoubleClick: () => openTech(r) })} />
        ) : tab === 'general' ? (
          settingsForm ? (
            <div style={{ maxWidth: 900, padding: 8 }}>
              <h3 className="comm-h">الفنيين والكوبونات</h3>
              <Row gutter={[12, 12]}>
                <Field label="قيمة النقطة (ج)" hint="بتتغيّر كل كام شهر — «52.35 قيمة نقطة شهر 2»">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.01} value={Number(settingsForm.point_value)}
                    onChange={(v) => setSettingsForm({ ...settingsForm, point_value: v ?? 0 })} />
                </Field>
                <Field label="نقاط الكوبون الواحد">
                  <InputNumber style={{ width: '100%' }} min={0} value={settingsForm.points_per_coupon}
                    onChange={(v) => setSettingsForm({ ...settingsForm, points_per_coupon: Number(v ?? 0) })} />
                </Field>
                <Field label="قاسم معامل الفني" hint="المعامل 1.5 ÷ 600 = 0.25٪ من قيمة النقاط">
                  <InputNumber style={{ width: '100%' }} min={1} value={Number(settingsForm.factor_divisor)}
                    onChange={(v) => setSettingsForm({ ...settingsForm, factor_divisor: v ?? 600 })} />
                </Field>
                <Field span={12} label={<Checkbox checked={settingsForm.pay_coupon_commission}
                  onChange={(e) => setSettingsForm({ ...settingsForm, pay_coupon_commission: e.target.checked })}>
                  عمولة الكوبونات بتتصرف في المرتب</Checkbox>}
                  hint="في ملف أكتوبر بتتحسب ومش داخلة المرتب (عمود «عمولة معاينات» = المعاينات بس)">
                  <span />
                </Field>
                <Field span={12} label={<Checkbox checked={settingsForm.apply_min_inspections}
                  onChange={(e) => setSettingsForm({ ...settingsForm, apply_min_inspections: e.target.checked })}>
                  تطبيق خصم الحد الأدنى للمعاينات</Checkbox>}
                  hint="نصيب المعاينة = عمولة الكوبونات ÷ الحد الأدنى، والخصم = النصيب × المعاينات الناقصة">
                  <span />
                </Field>
              </Row>
              <h3 className="comm-h">المناديب</h3>
              <Row gutter={[12, 12]}>
                <Field label="خصم الغياب: العمولة ÷">
                  <InputNumber style={{ width: '100%' }} min={1} value={Number(settingsForm.absence_divisor)}
                    onChange={(v) => setSettingsForm({ ...settingsForm, absence_divisor: v ?? 30 })} />
                </Field>
                <Field label="خصم ٢٥٪: نسبة البيع ٪">
                  <InputNumber style={{ width: '100%' }} min={0} max={100} value={Number(settingsForm.penalty_sales_pct)}
                    onChange={(v) => setSettingsForm({ ...settingsForm, penalty_sales_pct: v ?? 25 })} />
                </Field>
                <Field label="على كل 1000 زيادة (ج)">
                  <InputNumber style={{ width: '100%' }} min={0} value={Number(settingsForm.penalty_per_thousand)}
                    onChange={(v) => setSettingsForm({ ...settingsForm, penalty_per_thousand: v ?? 20 })} />
                </Field>
                <Field span={24} label={<Checkbox checked={settingsForm.attribute_by_customer_rep}
                  onChange={(e) => setSettingsForm({ ...settingsForm, attribute_by_customer_rep: e.target.checked })}>
                  المستند اللي مالوش مندوب يتحسب لمندوب العميل</Checkbox>}
                  hint="السندات والفواتير المنقولة من a5 من غير مندوب — من غيرها تحصيلها مش بيتحسب لحد">
                  <span />
                </Field>
              </Row>
            </div>
          ) : <Spin style={{ margin: 40 }} />
        ) : renderPreview()}
      </ListPage>

      {/* ---------------- مودال السيارة */}
      <TabModal open={teamOpen} width={820} destroyOnClose
        title={teamEditing ? `تعديل «${teamEditing.name}»` : 'سيارة جديدة'}
        onCancel={() => setTeamOpen(false)} onOk={saveTeam} okText="حفظ" cancelText="إلغاء"
        confirmLoading={saving}>
        <Row gutter={[10, 10]}>
          <Field label="الاسم *" span={8}>
            <Input value={teamForm.name} placeholder="سيارة أ"
              onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} />
          </Field>
          <Field label="نسبة البولي / تكنو ٪" span={5}>
            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.05} value={teamForm.rate_poly}
              onChange={(v) => setTeamForm({ ...teamForm, rate_poly: Number(v ?? 0) })} />
          </Field>
          <Field label="نسبة الأبيض ٪" span={5}>
            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.05} value={teamForm.rate_white}
              onChange={(v) => setTeamForm({ ...teamForm, rate_white: Number(v ?? 0) })} />
          </Field>
          <Field label="من غير عيلة ٪" span={6} hint="تحصيل على حساب العميل القديم">
            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.05} value={teamForm.rate_other}
              onChange={(v) => setTeamForm({ ...teamForm, rate_other: Number(v ?? 0) })} />
          </Field>
          <Field label="حسابات المناديب (مصدر التحصيل والبيع والمديونية)" span={24}
            hint="فاضية = حسابات الأفراد نفسهم على التطبيق">
            <Select mode="multiple" style={{ width: '100%' }} allowClear showSearch
              filterOption={searchFilter} value={teamForm.users} options={repUserOptions}
              onChange={(v) => setTeamForm({ ...teamForm, users: v })} />
          </Field>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>الأفراد اللي بيقتسموا العمولة</div>
            {teamForm.members.map((m, i) => (
              <Space key={i} style={{ display: 'flex', marginBottom: 6 }}>
                <Select style={{ width: 300 }} showSearch filterOption={searchFilter} placeholder="الموظف"
                  value={m.employee_id} options={empOptions}
                  onChange={(v) => {
                    const next = [...teamForm.members];
                    next[i] = { ...m, employee_id: v };
                    setTeamForm({ ...teamForm, members: next });
                  }} />
                <Checkbox checked={m.exempt_25} disabled={!teamForm.penalty_enabled}
                  onChange={(e) => {
                    const next = [...teamForm.members];
                    next[i] = { ...m, exempt_25: e.target.checked };
                    setTeamForm({ ...teamForm, members: next });
                  }}>معفي من خصم ٢٥٪</Checkbox>
                <Button size="small" danger icon={<DeleteOutlined />}
                  onClick={() => setTeamForm({ ...teamForm, members: teamForm.members.filter((_, j) => j !== i) })} />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />}
              onClick={() => setTeamForm({ ...teamForm, members: [...teamForm.members, { exempt_25: false }] })}>
              إضافة فرد</Button>
          </Col>
          <Field label="" span={8}>
            <Checkbox checked={teamForm.split_equally}
              onChange={(e) => setTeamForm({ ...teamForm, split_equally: e.target.checked })}>
              تتقسم على الأفراد بالتساوي</Checkbox>
            <div style={{ color: '#888', fontSize: 12 }}>من غيرها كل فرد ياخدها كاملة (زي الشرقية)</div>
          </Field>
          <Field label="" span={8}>
            <Checkbox checked={teamForm.penalty_enabled}
              onChange={(e) => setTeamForm({ ...teamForm, penalty_enabled: e.target.checked })}>
              عليها خصم ٢٥٪</Checkbox>
          </Field>
          <Field label="الائتمان" span={8}>
            <InputNumber style={{ width: '100%' }} min={0} disabled={!teamForm.penalty_enabled}
              value={teamForm.credit_limit}
              onChange={(v) => setTeamForm({ ...teamForm, credit_limit: Number(v ?? 0) })} />
          </Field>
          <Field label="الترتيب" span={4}>
            <InputNumber style={{ width: '100%' }} value={teamForm.sort_order}
              onChange={(v) => setTeamForm({ ...teamForm, sort_order: Number(v ?? 0) })} />
          </Field>
          <Field label="" span={4}>
            <Checkbox checked={teamForm.active}
              onChange={(e) => setTeamForm({ ...teamForm, active: e.target.checked })}>نشطة</Checkbox>
          </Field>
          <Field label="ملاحظات" span={16}>
            <Input value={teamForm.notes}
              onChange={(e) => setTeamForm({ ...teamForm, notes: e.target.value })} />
          </Field>
        </Row>
      </TabModal>

      {/* ---------------- مودال المشرف */}
      <TabModal open={supOpen} width={760} destroyOnClose
        title={supEditing ? `تعديل إشراف «${supEditing.employee_name}»` : 'مشرف جديد'}
        onCancel={() => setSupOpen(false)} onOk={saveSup} okText="حفظ" cancelText="إلغاء"
        confirmLoading={saving}>
        <Row gutter={[10, 10]}>
          <Field label="الموظف *" span={12}>
            <Select style={{ width: '100%' }} showSearch filterOption={searchFilter}
              value={supForm.employee_id} options={empOptions}
              onChange={(v) => setSupForm({ ...supForm, employee_id: v })} />
          </Field>
          <Field label="الوصف" span={12}>
            <Input value={supForm.label} placeholder="اشراف على ب/د"
              onChange={(e) => setSupForm({ ...supForm, label: e.target.value })} />
          </Field>
          <Field label="السيارات اللي تحته" span={24}>
            <Select mode="multiple" style={{ width: '100%' }} value={supForm.teams} options={teamOptions}
              onChange={(v) => setSupForm({ ...supForm, teams: v })} />
          </Field>
          <Field label="نسبة البولي ٪" span={6}>
            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.01} value={supForm.rate_poly}
              onChange={(v) => setSupForm({ ...supForm, rate_poly: Number(v ?? 0) })} />
          </Field>
          <Field label="نسبة الأبيض ٪" span={6}>
            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.01} value={supForm.rate_white}
              onChange={(v) => setSupForm({ ...supForm, rate_white: Number(v ?? 0) })} />
          </Field>
          <Field label="من غير عيلة ٪" span={6}>
            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.01} value={supForm.rate_other}
              onChange={(v) => setSupForm({ ...supForm, rate_other: Number(v ?? 0) })} />
          </Field>
          <Field label="التحصيل" span={6}>
            <Select style={{ width: '100%' }} value={supForm.period_offset}
              onChange={(v) => setSupForm({ ...supForm, period_offset: v })}
              options={[{ value: 0, label: 'نفس الشهر' }, { value: 1, label: 'الشهر اللي فات' }]} />
          </Field>
          <Field label="خصم ٪ من زيادة الـ٢٥٪ بتاعة سياراته" span={10}
            hint="حسن رمضان في الملف: 0.5٪ من زيادة ب + د">
            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.01} value={supForm.penalty_rate}
              onChange={(v) => setSupForm({ ...supForm, penalty_rate: Number(v ?? 0) })} />
          </Field>
          <Field label="" span={7}>
            <Checkbox checked={supForm.deduct_absence}
              onChange={(e) => setSupForm({ ...supForm, deduct_absence: e.target.checked })}>بيتخصم منها الغياب</Checkbox>
          </Field>
          <Field label="" span={7}>
            <Checkbox checked={supForm.active}
              onChange={(e) => setSupForm({ ...supForm, active: e.target.checked })}>نشط</Checkbox>
          </Field>
          <Field label="الترتيب" span={6}>
            <InputNumber style={{ width: '100%' }} value={supForm.sort_order}
              onChange={(v) => setSupForm({ ...supForm, sort_order: Number(v ?? 0) })} />
          </Field>
          <Field label="ملاحظات" span={18}>
            <Input value={supForm.notes} onChange={(e) => setSupForm({ ...supForm, notes: e.target.value })} />
          </Field>
        </Row>
      </TabModal>

      {/* ---------------- مودال الفني */}
      <TabModal open={techOpen} width={720} destroyOnClose
        title={techEditing ? `تعديل «${techEditing.employee_name}»` : 'فني جديد'}
        onCancel={() => setTechOpen(false)} onOk={saveTech} okText="حفظ" cancelText="إلغاء"
        confirmLoading={saving}>
        <Row gutter={[10, 10]}>
          <Field label="الموظف *" span={12}
            hint="الكوبونات والمعاينات بتتقري من حسابه على التطبيق (المربوط بكارت الموظف)">
            <Select style={{ width: '100%' }} showSearch filterOption={searchFilter}
              value={techForm.employee_id} options={empOptions}
              onChange={(v) => setTechForm({ ...techForm, employee_id: v })} />
          </Field>
          <Field label="النطاق" span={12}>
            <Select style={{ width: '100%' }} value={techForm.scope}
              onChange={(v) => setTechForm({ ...techForm, scope: v })}
              options={[{ value: 'own', label: 'شغله هو' },
                { value: 'all', label: 'مسؤول الفنيين — على مجموع الفنيين' }]} />
          </Field>
          <Field label="نسبة العمولة (المعامل)" span={6} hint="1.5 / 3.6 / 1.8">
            <InputNumber style={{ width: '100%' }} min={0} step={0.1} value={techForm.factor}
              onChange={(v) => setTechForm({ ...techForm, factor: Number(v ?? 0) })} />
          </Field>
          <Field label="الحد الأدنى للمعاينات" span={6}>
            <InputNumber style={{ width: '100%' }} min={0} value={techForm.min_inspections}
              onChange={(v) => setTechForm({ ...techForm, min_inspections: Number(v ?? 0) })} />
          </Field>
          <Field label="عمولة المعاينة (ج)" span={6}>
            <InputNumber style={{ width: '100%' }} min={0} value={techForm.inspection_rate}
              onChange={(v) => setTechForm({ ...techForm, inspection_rate: Number(v ?? 0) })} />
          </Field>
          <Field label="السباك الواحد (ج)" span={6} hint="التعامل مع الفنيين">
            <InputNumber style={{ width: '100%' }} min={0} value={techForm.plumber_rate}
              onChange={(v) => setTechForm({ ...techForm, plumber_rate: Number(v ?? 0) })} />
          </Field>
          <Field label="الترتيب" span={6}>
            <InputNumber style={{ width: '100%' }} value={techForm.sort_order}
              onChange={(v) => setTechForm({ ...techForm, sort_order: Number(v ?? 0) })} />
          </Field>
          <Field label="" span={6}>
            <Checkbox checked={techForm.active}
              onChange={(e) => setTechForm({ ...techForm, active: e.target.checked })}>نشط</Checkbox>
          </Field>
          <Field label="ملاحظات" span={12}>
            <Input value={techForm.notes} onChange={(e) => setTechForm({ ...techForm, notes: e.target.value })} />
          </Field>
        </Row>
      </TabModal>

      {/* ---------------- تحصيل يدوي */}
      <TabModal open={!!manualTeam} width={560} destroyOnClose
        title={manualTeam ? `تحصيل يدوي — ${manualTeam.name} — ${period.format('YYYY/MM')}` : ''}
        onCancel={() => setManualTeam(null)} onOk={saveManual} okText="حفظ" cancelText="إلغاء"
        confirmLoading={saving}>
        <div style={{ color: '#888', marginBottom: 8 }}>
          تحصيل من بره النظام للشهر ده — بيتجمع على اللي النظام حسبه. أصفار من غير ملاحظة = شيله.
        </div>
        <Row gutter={[10, 10]}>
          <Field label="بولي / تكنو">
            <InputNumber style={{ width: '100%' }} min={0} value={manualForm.poly}
              onChange={(v) => setManualForm({ ...manualForm, poly: Number(v ?? 0) })} />
          </Field>
          <Field label="أبيض">
            <InputNumber style={{ width: '100%' }} min={0} value={manualForm.white}
              onChange={(v) => setManualForm({ ...manualForm, white: Number(v ?? 0) })} />
          </Field>
          <Field label="من غير عيلة">
            <InputNumber style={{ width: '100%' }} min={0} value={manualForm.other}
              onChange={(v) => setManualForm({ ...manualForm, other: Number(v ?? 0) })} />
          </Field>
          <Field label="ملاحظات" span={24}>
            <Input value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })} />
          </Field>
        </Row>
      </TabModal>

      <style>{`
        .comm-h { margin: 16px 4px 8px; font-size: 15px; }
        .comm-block { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 13px; }
        .comm-block th, .comm-block td { border: 1px solid #eee; padding: 3px 8px; text-align: start; }
        .comm-block thead th { background: #fafafa; font-weight: 600; }
        .comm-block tbody th { background: #fcfcfc; font-weight: 500; white-space: nowrap; }
        .comm-block .comm-total th, .comm-block .comm-total td { font-weight: 700; background: #f6f8fa; }
        .comm-kv { max-width: 460px; }
        .comm-note { color: #888; font-size: 12px; margin: 4px 0; }
        .comm-share { margin: 6px 0; }
        .comm-sub { margin-top: 10px; font-weight: 600; }
      `}</style>
    </>
  );
}

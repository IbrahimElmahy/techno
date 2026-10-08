import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Button, Checkbox, Col, DatePicker, Divider, Input, Row, Select, Space, Table, Tag, message,
} from 'antd';
import {
  ClearOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RiseOutlined,
  SearchOutlined, UserOutlined, WalletOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { Dayjs } from 'dayjs';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useListFilter } from '../components/ListToolbar';
import ListPage, { ListStat } from '../components/ListPage';
import { Popconfirm } from '../components/noConfirm';
import { InputNumber } from '../components/NumberInput';
import { TabModal } from '../components/TabModal';
import EmployeeFormModal, { type Employee } from '../components/EmployeeFormModal';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { money, numeralsLocale } from '../utils/money';

interface Current {
  id: number; effective_from: string; basic: string; allowances: string; deductions: string;
  gross: string; net_structure: string; payment_method: string;
}

interface Row {
  employee_id: number; code: string; name: string; active: boolean;
  branch_id: number | null; department: string | null; job_title: string | null;
  hire_date: string | null; card_salary: string | null;
  versions: number; current: Current | null;
  upcoming: { id: number; effective_from: string; basic: string } | null;
}

interface Component {
  id: number; code: string; name: string; kind: 'earning' | 'deduction'; active: boolean;
}

interface FormLine { component_id?: number; mode: 'amount' | 'pct'; value?: number }

const PAY: Record<string, string> = { cash: 'نقدي', bank: 'تحويل بنكي', wallet: 'محفظة' };

const n = (v: any) => Number(v || 0);

export default function EmployeeSalaries() {
  const [rows, setRows] = useState<Row[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const [target, setTarget] = useState<Row | null>(null);
  const [mode, setMode] = useState<'edit' | 'raise'>('edit');
  const [history, setHistory] = useState<{ id: number; effective_from: string; basic: string; locked: boolean }[]>([]);
  const [form, setForm] = useState<any>({});
  const [lines, setLines] = useState<FormLine[]>([]);
  const [saving, setSaving] = useState(false);

  const [empOpen, setEmpOpen] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);

  const load = async (inactive = showInactive) => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/payroll/salaries',
        { params: { include_inactive: inactive } });
      setRows(res.data || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    api.get('/api/v1/hr/payroll/components').then((r) => setComponents(r.data || [])).catch(() => {});
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(() => {});
  }, []);

  const fail = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail;
    message.error(detail?.message || fallback, detail?.code === 'locked' ? 8 : 4);
  };

  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || '';

  const filter = useListFilter(rows, {
    search: (r) => [r.code, r.name, r.department, r.job_title],
    filters: {
      setup: (r, v) => (v === 'set' ? !!r.current : !r.current),
      branch_id: (r, v) => r.branch_id === v,
    },
  });
  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const openSettings = async (row: Row, how: 'edit' | 'raise') => {
    setTarget(row);
    setMode(how);
    setHistory([]);
    let cur: any = null;
    try {
      const res = await api.get(`/api/v1/hr/payroll/salaries/${row.employee_id}`);
      cur = res.data.current;
      setHistory(res.data.history || []);
    } catch (err: any) { fail(err, 'تعذر تحميل إعدادات الراتب'); return; }

    if (cur) {
      setForm({
        effective_from: how === 'edit' ? dayjs(cur.effective_from)
          : dayjs().add(1, 'month').startOf('month'),
        basic: n(cur.basic),
        insurance_base: cur.insurance_base_set === null ? undefined : n(cur.insurance_base_set),
        payment_method: cur.payment_method || 'cash',
        bank_name: cur.bank_name || '', bank_account: cur.bank_account || '',
        notes: how === 'edit' ? (cur.notes || '') : '',
      });
      setLines((cur.lines || []).map((l: any) => (l.pct !== null
        ? { component_id: l.component_id, mode: 'pct', value: n(l.pct) }
        : { component_id: l.component_id, mode: 'amount', value: n(l.amount) })));
    } else {
      const monthStart = dayjs().startOf('month');
      const hired = row.hire_date ? dayjs(row.hire_date) : null;
      setForm({
        effective_from: hired && hired.isAfter(monthStart) ? hired : monthStart,
        basic: row.card_salary ? n(row.card_salary) : undefined,
        insurance_base: undefined, payment_method: 'cash',
        bank_name: '', bank_account: '', notes: '',
      });
      setLines([]);
    }
  };

  const closeSettings = () => { setTarget(null); setLines([]); };

  const usable = components.filter((c) => c.active);
  const compOf = (id?: number) => components.find((c) => c.id === id);

  const preview = useMemo(() => {
    const basic = n(form.basic);
    let earn = 0; let ded = 0;
    for (const l of lines) {
      const c = compOf(l.component_id);
      if (!c) continue;
      const amount = l.mode === 'pct' ? (basic * n(l.value)) / 100 : n(l.value);
      if (c.kind === 'earning') earn += amount; else ded += amount;
    }
    return { earn, ded, gross: basic + earn, net: basic + earn - ded };
  }, [form.basic, lines, components]);

  const save = async () => {
    if (!target) return;
    if (form.basic === undefined || form.basic === null || form.basic === '') {
      message.warning('اكتب الأساسي'); return;
    }
    if (!form.effective_from) { message.warning('اختار تاريخ السريان'); return; }
    const picked = lines.filter((l) => l.component_id);
    const ids = picked.map((l) => l.component_id);
    if (new Set(ids).size !== ids.length) { message.warning('البند متكرر — كل بند مرة واحدة'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/hr/payroll/salaries', {
        employee_id: target.employee_id,
        effective_from: (form.effective_from as Dayjs).format('YYYY-MM-DD'),
        basic: String(form.basic),
        insurance_base: form.insurance_base === undefined || form.insurance_base === null
          ? null : String(form.insurance_base),
        payment_method: form.payment_method,
        bank_name: form.payment_method === 'bank' ? (form.bank_name || null) : null,
        bank_account: form.payment_method === 'bank' ? (form.bank_account || null) : null,
        notes: form.notes || null,
        lines: picked.map((l) => (l.mode === 'pct'
          ? { component_id: l.component_id, amount: '0', pct: String(l.value ?? 0) }
          : { component_id: l.component_id, amount: String(l.value ?? 0), pct: null })),
      });
      message.success('تم حفظ إعدادات الراتب');
      closeSettings();
      load();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const removeVersion = async (salaryId: number, after?: () => void) => {
    try {
      await api.delete(`/api/v1/hr/payroll/salaries/versions/${salaryId}`);
      message.success('اتمسح');
      after?.();
      load();
    } catch (err: any) { fail(err, 'تعذر المسح'); }
  };

  const openEmployee = async (row: Row) => {
    try {
      const res = await api.get(`/api/v1/employees/${row.employee_id}`);
      setEmployee(res.data);
      setEmpOpen(true);
    } catch (err: any) { fail(err, 'تعذر فتح الموظف'); }
  };

  const columns: ColumnsType<Row> = [
    { title: 'رقم', dataIndex: 'code', key: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الموظف', dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <Space size={4}>
          <a onClick={() => openEmployee(r)}><b>{v}</b></a>
          {!r.active ? <Tag>موقوف</Tag> : null}
        </Space>
      ) },
    { title: 'الفرع', dataIndex: 'branch_id', key: 'branch_id', render: (v: number | null) => branchName(v) },
    { title: 'القسم', dataIndex: 'department', key: 'department', render: (v: string | null) => v || '' },
    { title: 'الوظيفة', dataIndex: 'job_title', key: 'job_title', render: (v: string | null) => v || '' },
    { title: 'الأساسي', key: 'basic', align: 'left',
      render: (_: any, r) => (r.current ? money(r.current.basic) : (
        <Space size={4} direction="vertical">
          <Tag color="orange">مالوش إعدادات</Tag>
          {r.card_salary && n(r.card_salary) ? (
            <span style={{ color: '#888', fontSize: 13 }}
              title="الرقم المكتوب في كارت الموظف — المسير مابيقراهوش لحد ما يتحفظ هنا">
              في الكارت: {money(r.card_salary)}
            </span>
          ) : null}
        </Space>
      )) },
    { title: 'البدلات', key: 'allowances', align: 'left',
      render: (_: any, r) => (r.current && n(r.current.allowances) ? money(r.current.allowances) : '—') },
    { title: 'استقطاعات ثابتة', key: 'deductions', align: 'left',
      render: (_: any, r) => (r.current && n(r.current.deductions)
        ? <span style={{ color: '#cf1322' }}>{money(r.current.deductions)}</span> : '—') },
    { title: 'الإجمالي', key: 'gross', align: 'left',
      render: (_: any, r) => (r.current ? <b>{money(r.current.gross)}</b> : '—') },
    { title: 'ساري من', key: 'effective_from', width: 110,
      render: (_: any, r) => (
        <Space size={2} direction="vertical">
          <span>{r.current?.effective_from ?? '—'}</span>
          {r.upcoming ? (
            <Tag color="blue" title={`أساسي ${money(r.upcoming.basic)}`}>
              زيادة من {r.upcoming.effective_from}
            </Tag>
          ) : null}
        </Space>
      ) },
    { title: 'الصرف', key: 'payment_method', width: 100,
      render: (_: any, r) => (r.current ? PAY[r.current.payment_method] ?? r.current.payment_method : '') },
    { title: '', key: 'actions', width: 150,
      render: (_: any, r) => (
        <Space size={0}>
          <Button type="text" icon={r.current ? <EditOutlined /> : <PlusOutlined />}
            title={r.current ? 'تعديل إعدادات الراتب' : 'إضافة إعدادات الراتب'}
            onClick={() => openSettings(r, 'edit')} />
          {r.current ? (
            <Button type="text" icon={<RiseOutlined />} title="زيادة — نسخة جديدة من تاريخ"
              onClick={() => openSettings(r, 'raise')} />
          ) : null}
          {r.current ? (
            <Popconfirm onConfirm={() => removeVersion(r.current!.id)}>
              <Button type="text" danger icon={<DeleteOutlined />}
                title="مسح الإعدادات السارية — النسخة اللي قبلها (لو فيه) بترجع ساريّة" />
            </Popconfirm>
          ) : null}
          <Button type="text" icon={<UserOutlined />} title="فتح كارت الموظف"
            onClick={() => openEmployee(r)} />
        </Space>
      ) },
  ];

  const cols = useTableColumns('employee-salaries', columns as any, {
    locked: ['name'],
    export: {
      name: 'رواتب الموظفين',
      rows: filter.filtered.map((r) => ({
        code: r.code, name: r.name, branch_id: branchName(r.branch_id),
        department: r.department, job_title: r.job_title,
        basic: r.current?.basic ?? 'مالوش إعدادات', allowances: r.current?.allowances ?? '',
        deductions: r.current?.deductions ?? '', gross: r.current?.gross ?? '',
        effective_from: r.current?.effective_from ?? '',
        payment_method: r.current ? PAY[r.current.payment_method] : '',
      })),
    },
  });

  const kb = useTableKeyboard<Row>({
    rows: filter.filtered, rowKey: (r) => r.employee_id, onOpen: (r) => openSettings(r, 'edit'),
  });

  const shown = filter.filtered;
  const withSetup = shown.filter((r) => r.current);
  const totalGross = withSetup.reduce((t, r) => t + n(r.current!.gross), 0);
  const fmt = (v: number) => v.toLocaleString(numeralsLocale());

  return (
    <>
    <ListPage
      icon={<WalletOutlined />}
      title="رواتب الموظفين"
      subtitle="إعدادات الراتب لكل موظف — دي اللي المسير بيحسب منها"
      actions={(<>
        <Checkbox checked={showInactive}
          onChange={(e) => { setShowInactive(e.target.checked); load(e.target.checked); }}>
          إظهار الموقوفين
        </Checkbox>
        {cols.control}
        <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
          placeholder="بحث بالكود أو الاسم أو القسم أو الوظيفة" prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        <Select allowClear placeholder="الإعدادات" style={{ minWidth: 170 }}
          value={filter.values.setup}
          onChange={(v) => filter.setValue('setup', v)}
          options={[
            { value: 'unset', label: 'مالهمش إعدادات' },
            { value: 'set', label: 'ليهم إعدادات' },
          ]} />
        {branches.length > 1 ? (
          <Select allowClear showSearch placeholder="الفرع" style={{ minWidth: 150 }}
            value={filter.values.branch_id}
            onChange={(v) => filter.setValue('branch_id', v)}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            filterOption={searchFilter} filterSort={searchRank} />
        ) : null}
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
      summary={(<>
        <ListStat label="الموظفين" value={fmt(shown.length)} />
        <ListStat label="ليهم إعدادات" value={fmt(withSetup.length)} tone="pos" />
        <ListStat label="مالهمش إعدادات" value={fmt(shown.length - withSetup.length)}
          tone={shown.length - withSetup.length ? 'warn' : undefined}
          hint="مش هيدخلوا المسير" />
        <ListStat label="إجمالي الرواتب الشهرية" value={money(totalGross)} tone="strong" />
      </>)}
    >
      {rows.length && !rows.some((r) => r.current) ? (
        <Alert type="warning" showIcon style={{ margin: '6px 0 8px' }}
          message="مافيش موظف ليه إعدادات راتب لسه"
          description={'المسير بيحسب من الإعدادات دي بس — الموظف اللي مالوش إعدادات مابيدخلش المسير. '
            + 'دوس «+» جنب الموظف وحط الأساسي والبدلات.'} />
      ) : null}
      <Table<Row>
        {...kb.tableProps}
        className="sl-table"
        rowKey="employee_id" size="small" loading={loading} dataSource={shown}
        locale={{ emptyText: 'لا يوجد موظفون' }}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        columns={cols.columns}
      />
    </ListPage>

    <TabModal
      open={!!target} width={820} destroyOnClose
      title={target ? `${mode === 'raise' ? 'زيادة' : 'إعدادات راتب'} — ${target.name}` : ''}
      onCancel={closeSettings} onOk={save} okText="حفظ" cancelText="إلغاء"
      okButtonProps={{ loading: saving }}
    >
      {target ? (
        <Row gutter={[10, 10]}>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>ساري من *</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={form.effective_from}
              onChange={(v) => setForm({ ...form, effective_from: v })} />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>الأساسي *</div>
            <InputNumber style={{ width: '100%' }} min={0} value={form.basic}
              onChange={(v) => setForm({ ...form, basic: v })} />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>الأجر التأميني</div>
            <InputNumber style={{ width: '100%' }} min={0} value={form.insurance_base}
              placeholder="بيتحسب من البنود"
              onChange={(v) => setForm({ ...form, insurance_base: v ?? undefined })} />
          </Col>
          <Col span={8}>
            <div style={{ marginBottom: 4 }}>طريقة الصرف</div>
            <Select style={{ width: '100%' }} value={form.payment_method}
              onChange={(v) => setForm({ ...form, payment_method: v })}
              options={Object.entries(PAY).map(([value, label]) => ({ value, label }))} />
          </Col>
          {form.payment_method === 'bank' ? (<>
            <Col span={8}>
              <div style={{ marginBottom: 4 }}>البنك</div>
              <Input value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
            </Col>
            <Col span={8}>
              <div style={{ marginBottom: 4 }}>رقم الحساب</div>
              <Input value={form.bank_account}
                onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
            </Col>
          </>) : null}
          <Col span={24}>
            {mode === 'edit' && target.current
              && form.effective_from && dayjs(form.effective_from).format('YYYY-MM-DD') !== target.current.effective_from ? (
              <Alert type="info" showIcon
                message="غيّرت تاريخ السريان — هتتعمل نسخة جديدة من التاريخ ده، والقديمة بتفضل للشهور اللي قبله." />
            ) : mode === 'raise' ? (
              <Alert type="info" showIcon
                message="الزيادة نسخة جديدة من التاريخ ده — اللي قبلها بتفضل للشهور اللي فاتت، فقسايمها ماتتغيّرش." />
            ) : null}
          </Col>

          <Col span={24}>
            <Divider style={{ margin: '4px 0' }}>البدلات والاستقطاعات</Divider>
            {!usable.length ? (
              <div style={{ color: '#888', fontSize: 14 }}>
                مافيش بنود راتب لسه — اتعرّف من «بنود الراتب» (بدل انتقالات، حافز، …).
              </div>
            ) : null}
            {lines.map((l, i) => {
              const c = compOf(l.component_id);
              return (
                <Row gutter={[6, 6]} key={i} style={{ marginBottom: 6 }} align="middle">
                  <Col span={10}>
                    <Select style={{ width: '100%' }} placeholder="البند" showSearch
                      value={l.component_id}
                      onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, component_id: v } : x)))}
                      options={usable.map((x) => ({
                        value: x.id, label: `${x.name} (${x.kind === 'earning' ? 'استحقاق' : 'استقطاع'})`,
                      }))}
                      filterOption={searchFilter} filterSort={searchRank} />
                  </Col>
                  <Col span={5}>
                    <Select style={{ width: '100%' }} value={l.mode}
                      onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, mode: v } : x)))}
                      options={[
                        { value: 'amount', label: 'مبلغ ثابت' },
                        { value: 'pct', label: '٪ من الأساسي' },
                      ]} />
                  </Col>
                  <Col span={5}>
                    <InputNumber style={{ width: '100%' }} min={0} value={l.value}
                      addonAfter={l.mode === 'pct' ? '٪' : undefined}
                      onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, value: v ?? undefined } : x)))} />
                  </Col>
                  <Col span={4}>
                    <Space size={4}>
                      {c ? (c.kind === 'earning'
                        ? <Tag color="green">+</Tag> : <Tag color="red">−</Tag>) : null}
                      <Button size="small" danger
                        onClick={() => setLines(lines.filter((_, j) => j !== i))}>حذف</Button>
                    </Space>
                  </Col>
                </Row>
              );
            })}
            {usable.length ? (
              <Button size="small" icon={<PlusOutlined />}
                onClick={() => setLines([...lines, { mode: 'amount' }])}>بند</Button>
            ) : null}
          </Col>

          <Col span={24}>
            <Space size={24} wrap style={{ background: '#fafafa', padding: '8px 12px', borderRadius: 6 }}>
              <span>البدلات: <b>{money(preview.earn)}</b></span>
              <span>الإجمالي: <b>{money(preview.gross)}</b></span>
              <span>استقطاعات ثابتة: <b style={{ color: '#cf1322' }}>{money(preview.ded)}</b></span>
              <span style={{ color: '#888', fontSize: 13 }}>
                (قبل الضريبة والتأمينات والغياب — دول بيتحسبوا في المسير)
              </span>
            </Space>
          </Col>

          <Col span={24}>
            <div style={{ marginBottom: 4 }}>ملاحظات</div>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Col>

          {history.length ? (
            <Col span={24}>
              <Divider style={{ margin: '4px 0' }}>النسخ السابقة</Divider>
              <Table
                size="small" rowKey="id" pagination={false} dataSource={history}
                columns={[
                  { title: 'ساري من', dataIndex: 'effective_from' },
                  { title: 'الأساسي', dataIndex: 'basic', render: (v: string) => money(v) },
                  { title: '', key: 'x', width: 150,
                    render: (_: any, h: any) => (h.locked
                      ? <Tag title="اتحسب عليها مسير مرحّل">🔒 متقفلة</Tag>
                      : (
                        <Popconfirm onConfirm={() => removeVersion(h.id, () => {
                          setHistory(history.filter((x) => x.id !== h.id));
                          if (target.current?.id === h.id) closeSettings();
                        })}>
                          <Button size="small" danger>مسح النسخة</Button>
                        </Popconfirm>
                      )) },
                ]}
              />
            </Col>
          ) : null}
        </Row>
      ) : null}
    </TabModal>

    <EmployeeFormModal
      open={empOpen} employee={employee}
      onClose={() => setEmpOpen(false)} onSaved={() => load()}
    />
    </>
  );
}

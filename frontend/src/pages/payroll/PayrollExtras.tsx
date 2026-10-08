import React, { useEffect, useState } from 'react';
import { Button, Col, DatePicker, Input, Radio, Row, Select, Space, Table, Tag, message } from 'antd';
import { ListStat } from '../../components/ListPage';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

import { api } from '../../api/client';
import { Popconfirm } from '../../components/noConfirm';
import { InputNumber } from '../../components/NumberInput';
import { TabModal } from '../../components/TabModal';
import { searchFilter, searchRank } from '../../utils/arabicSort';
import { money } from '../../utils/money';
import { PAGE_SIZE } from '../../utils/pagination';

export interface PickEmployee { employee_id: number; name: string }

const fail = (err: any, fallback: string) => {
  const detail = err?.response?.data?.detail;
  message.error(detail?.message || fallback, 6);
};

interface Leave {
  id: number; document_number: string; employee_id: number; name: string; paid: boolean;
  date_from: string; date_to: string; days: string; reason: string | null;
}

export interface TabParts { actions: React.ReactNode; summary: React.ReactNode; body: React.ReactNode }

export function useLeavesTab({ active, branchId, period, employees, onChanged }: {
  active: boolean; branchId?: number; period: Dayjs; employees: PickEmployee[]; onChanged: () => void;
}): TabParts {
  const [rows, setRows] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ employee_id?: number; paid: boolean; range: [Dayjs, Dayjs]; reason: string }>(
    { paid: true, range: [dayjs(), dayjs()], reason: '' });

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/salary/leaves', {
        params: { branch_id: branchId, year: period.year(), month: period.month() + 1 },
      });
      setRows(res.data || []);
    } catch (err: any) { fail(err, 'تعذر تحميل الإجازات'); } finally { setLoading(false); }
  };

  useEffect(() => { if (active) load(); }, [active, branchId, period.format('YYYY-MM')]);

  const edit = (r?: Leave) => {
    setForm(r ? {
      employee_id: r.employee_id, paid: r.paid, range: [dayjs(r.date_from), dayjs(r.date_to)],
      reason: r.reason || '',
    } : { paid: true, range: [period.startOf('month'), period.startOf('month')], reason: '' });
    setOpen(r ? r.id : 'new');
  };

  const save = async () => {
    if (!form.employee_id) { message.warning('اختر الموظف'); return; }
    setSaving(true);
    try {
      const body = {
        employee_id: form.employee_id, paid: form.paid,
        date_from: form.range[0].format('YYYY-MM-DD'), date_to: form.range[1].format('YYYY-MM-DD'),
        reason: form.reason || null,
      };
      if (open === 'new') await api.post('/api/v1/hr/salary/leaves', body);
      else await api.put(`/api/v1/hr/salary/leaves/${open}`, body);
      message.success('تم حفظ الإجازة');
      setOpen(null);
      load();
      onChanged();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/v1/hr/salary/leaves/${id}`);
      message.success('تم حذف الإجازة');
      load();
      onChanged();
    } catch (err: any) { fail(err, 'تعذر الحذف'); }
  };

  const days = rows.reduce((t, r) => t + Number(r.days || 0), 0);
  const unpaidDays = rows.filter((r) => !r.paid).reduce((t, r) => t + Number(r.days || 0), 0);

  return {
    actions: (
      <Button type="primary" className="sl-create" icon={<PlusOutlined />} onClick={() => edit()}>
        إجازة جديدة
      </Button>
    ),
    summary: (<>
      <ListStat label="عدد الإجازات" value={rows.length} />
      <ListStat label="الأيام" value={days} />
      <ListStat label="بدون أجر" value={`${unpaidDays} يوم`} tone="warn" />
    </>),
    body: (<>
      <Table<Leave>
        className="sl-table" rowKey="id" size="small" loading={loading} dataSource={rows}
        locale={{ emptyText: 'لا توجد إجازات في هذا الشهر' }}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: 'رقم', dataIndex: 'document_number', key: 'document_number', width: 120 },
          { title: 'الموظف', dataIndex: 'name', key: 'name', render: (v: string) => <b>{v}</b> },
          { title: 'النوع', dataIndex: 'paid', key: 'paid', width: 130,
            render: (v: boolean) => (v ? <Tag color="green">مدفوعة</Tag> : <Tag color="red">بدون أجر</Tag>) },
          { title: 'من', dataIndex: 'date_from', key: 'date_from', width: 110 },
          { title: 'إلى', dataIndex: 'date_to', key: 'date_to', width: 110 },
          { title: 'الأيام', dataIndex: 'days', key: 'days', width: 80, align: 'left',
            render: (v: string) => Number(v) },
          { title: 'السبب', dataIndex: 'reason', key: 'reason', render: (v: string | null) => v || '' },
          { title: '', key: 'x', width: 90,
            render: (_: any, r: Leave) => (
              <Space size={0}>
                <Button type="text" icon={<EditOutlined />} title="تعديل" onClick={() => edit(r)} />
                <Popconfirm title="حذف الإجازة؟" onConfirm={() => remove(r.id)}>
                  <Button type="text" danger icon={<DeleteOutlined />} title="حذف" />
                </Popconfirm>
              </Space>
            ) },
        ]}
      />
      <TabModal
        open={open !== null} title={open === 'new' ? 'إجازة جديدة' : 'تعديل إجازة'} destroyOnClose
        onCancel={() => setOpen(null)} onOk={save} okText="حفظ" cancelText="إلغاء"
        okButtonProps={{ loading: saving }}
      >
        <Row gutter={[10, 10]}>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>الموظف *</div>
            <Select showSearch style={{ width: '100%' }} value={form.employee_id}
              onChange={(v) => setForm({ ...form, employee_id: v })}
              filterOption={searchFilter} filterSort={searchRank}
              options={employees.map((e) => ({ value: e.employee_id, label: e.name }))} />
          </Col>
          <Col span={24}>
            <Radio.Group value={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.value })}>
              <Radio value>مدفوعة</Radio>
              <Radio value={false}>بدون أجر (تُخصم من المرتب)</Radio>
            </Radio.Group>
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>من — إلى</div>
            <DatePicker.RangePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={form.range} onChange={(v) => v && v[0] && v[1] && setForm({ ...form, range: [v[0], v[1]] })} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>السبب</div>
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Col>
        </Row>
      </TabModal>
    </>),
  };
}

interface Adjustment {
  id: number; document_number: string; employee_id: number; name: string;
  kind: string; kind_label: string; basis: string; quantity: string | null; amount: string;
  year: number; month: number; reason: string | null; applied: boolean;
}

const KINDS = [
  { value: 'penalty', label: 'جزاء', color: 'red' },
  { value: 'other_deduction', label: 'خصم', color: 'orange' },
  { value: 'bonus', label: 'مكافأة', color: 'green' },
  { value: 'other_earning', label: 'إضافة', color: 'blue' },
];

export function useAdjustmentsTab({ active, branchId, period, employees, onChanged }: {
  active: boolean; branchId?: number; period: Dayjs; employees: PickEmployee[]; onChanged: () => void;
}): TabParts {
  const [rows, setRows] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    employee_id?: number; kind: string; basis: string; value?: number; month: Dayjs; reason: string;
  }>({ kind: 'penalty', basis: 'amount', month: period, reason: '' });

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/salary/adjustments', {
        params: { branch_id: branchId, year: period.year(), month: period.month() + 1 },
      });
      setRows(res.data || []);
    } catch (err: any) { fail(err, 'تعذر تحميل الجزاءات والخصومات'); } finally { setLoading(false); }
  };

  useEffect(() => { if (active) load(); }, [active, branchId, period.format('YYYY-MM')]);

  const edit = (r?: Adjustment) => {
    setForm(r ? {
      employee_id: r.employee_id, kind: r.kind, basis: r.basis,
      value: Number(r.basis === 'amount' ? r.amount : r.quantity),
      month: dayjs(`${r.year}-${String(r.month).padStart(2, '0')}-01`), reason: r.reason || '',
    } : { kind: 'penalty', basis: 'amount', month: period, reason: '' });
    setOpen(r ? r.id : 'new');
  };

  const save = async () => {
    if (!form.employee_id) { message.warning('اختر الموظف'); return; }
    if (!form.value) { message.warning(form.basis === 'amount' ? 'أدخل المبلغ' : 'أدخل عدد الأيام'); return; }
    setSaving(true);
    try {
      const body = {
        employee_id: form.employee_id, kind: form.kind, basis: form.basis,
        amount: form.basis === 'amount' ? String(form.value) : null,
        quantity: form.basis !== 'amount' ? String(form.value) : null,
        year: form.month.year(), month: form.month.month() + 1, reason: form.reason || null,
      };
      if (open === 'new') await api.post('/api/v1/hr/salary/adjustments', body);
      else await api.put(`/api/v1/hr/salary/adjustments/${open}`, body);
      message.success('تم الحفظ');
      setOpen(null);
      load();
      onChanged();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/api/v1/hr/salary/adjustments/${id}`);
      message.success('تم الحذف');
      load();
      onChanged();
    } catch (err: any) { fail(err, 'تعذر الحذف'); }
  };

  const total = (kinds: string[]) => rows.filter((r) => kinds.includes(r.kind) && r.basis === 'amount')
    .reduce((t, r) => t + Number(r.amount || 0), 0);

  return {
    actions: (
      <Button type="primary" className="sl-create" icon={<PlusOutlined />} onClick={() => edit()}>
        جزاء أو خصم جديد
      </Button>
    ),
    summary: (<>
      <ListStat label="عدد الحركات" value={rows.length} />
      <ListStat label="الجزاءات والخصومات" value={money(total(['penalty', 'other_deduction']))} tone="neg" />
      <ListStat label="المكافآت والإضافات" value={money(total(['bonus', 'other_earning']))} tone="pos" />
    </>),
    body: (<>
      <Table<Adjustment>
        className="sl-table" rowKey="id" size="small" loading={loading} dataSource={rows}
        locale={{ emptyText: 'لا توجد جزاءات أو خصومات في هذا الشهر' }}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: 'رقم', dataIndex: 'document_number', key: 'document_number', width: 120 },
          { title: 'الموظف', dataIndex: 'name', key: 'name', render: (v: string) => <b>{v}</b> },
          { title: 'النوع', dataIndex: 'kind', key: 'kind', width: 100,
            render: (v: string, r: Adjustment) => (
              <Tag color={KINDS.find((k) => k.value === v)?.color}>{r.kind_label}</Tag>
            ) },
          { title: 'القيمة', key: 'value', align: 'left',
            render: (_: any, r: Adjustment) => (r.basis === 'amount' ? money(r.amount)
              : `${Number(r.quantity)} ${r.basis === 'days' ? 'يوم' : 'ساعة'}`) },
          { title: 'الشهر', key: 'm', width: 90, render: (_: any, r: Adjustment) => `${r.year}/${String(r.month).padStart(2, '0')}` },
          { title: 'السبب', dataIndex: 'reason', key: 'reason', render: (v: string | null) => v || '' },
          { title: 'الحالة', dataIndex: 'applied', key: 'applied', width: 90,
            render: (v: boolean) => (v ? <Tag color="green">مرحّل</Tag> : '') },
          { title: '', key: 'x', width: 90,
            render: (_: any, r: Adjustment) => (r.applied ? null : (
              <Space size={0}>
                <Button type="text" icon={<EditOutlined />} title="تعديل" onClick={() => edit(r)} />
                <Popconfirm title="حذف؟" onConfirm={() => remove(r.id)}>
                  <Button type="text" danger icon={<DeleteOutlined />} title="حذف" />
                </Popconfirm>
              </Space>
            )) },
        ]}
      />
      <TabModal
        open={open !== null} title={open === 'new' ? 'جزاء أو خصم جديد' : 'تعديل'} destroyOnClose
        onCancel={() => setOpen(null)} onOk={save} okText="حفظ" cancelText="إلغاء"
        okButtonProps={{ loading: saving }}
      >
        <Row gutter={[10, 10]}>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>الموظف *</div>
            <Select showSearch style={{ width: '100%' }} value={form.employee_id}
              onChange={(v) => setForm({ ...form, employee_id: v })}
              filterOption={searchFilter} filterSort={searchRank}
              options={employees.map((e) => ({ value: e.employee_id, label: e.name }))} />
          </Col>
          <Col span={24}>
            <Radio.Group value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
              optionType="button" buttonStyle="solid"
              options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>بالـ</div>
            <Select style={{ width: '100%' }} value={form.basis} onChange={(v) => setForm({ ...form, basis: v })}
              options={[
                { value: 'amount', label: 'مبلغ' },
                { value: 'days', label: 'أيام من المرتب' },
                { value: 'hours', label: 'ساعات من المرتب' },
              ]} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>{form.basis === 'amount' ? 'المبلغ *' : form.basis === 'days' ? 'عدد الأيام *' : 'عدد الساعات *'}</div>
            <InputNumber style={{ width: '100%' }} min={0} value={form.value}
              onChange={(v) => setForm({ ...form, value: v ?? undefined })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>شهر المرتب</div>
            <DatePicker picker="month" style={{ width: '100%' }} format="YYYY/MM" allowClear={false}
              value={form.month} onChange={(v) => v && setForm({ ...form, month: v })} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>السبب</div>
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Col>
        </Row>
      </TabModal>
    </>),
  };
}

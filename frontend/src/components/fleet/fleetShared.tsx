import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, DatePicker, Form, Input, Segmented, Select, Space, Tag, message,
} from 'antd';
import { DollarOutlined, LinkOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api/client';
import { TabModal } from '../TabModal';
import { InputNumber } from '../NumberInput';
import { useScreenShortcuts } from '../keyboard';
import { useAuth } from '../AuthProvider';
import {
  ExpenseAccountField, TreasuryField, defaultTreasuryId, voucherMoney,
} from '../VoucherFields';
import { searchFilter, searchRank } from '../../utils/arabicSort';
import { money } from '../../utils/money';
import './fleet.css';

export const VEHICLE_STATUS: Record<string, { label: string; color: string }> = {
  good: { label: 'جيدة', color: 'green' },
  attention: { label: 'تحتاج متابعة', color: 'gold' },
  maintenance_due: { label: 'تحتاج صيانة', color: 'orange' },
  stopped: { label: 'متوقفة', color: 'red' },
};

export const SEVERITY: Record<string, { label: string; color: string }> = {
  low: { label: 'منخفضة', color: 'default' },
  medium: { label: 'متوسطة', color: 'blue' },
  high: { label: 'عالية', color: 'orange' },
  critical: { label: 'حرجة', color: 'red' },
};

export const FAULT_STATUS: Record<string, { label: string; color: string }> = {
  open: { label: 'مفتوح', color: 'red' },
  in_repair: { label: 'قيد الإصلاح', color: 'gold' },
  resolved: { label: 'تم الحل', color: 'green' },
};

export const CHECK: Record<string, { label: string; color: string }> = {
  ok: { label: 'سليم', color: 'green' },
  attention: { label: 'يحتاج متابعة', color: 'gold' },
  bad: { label: 'غير سليم', color: 'red' },
};

export const RATING: Record<string, { label: string; color: string }> = {
  excellent: { label: 'ممتاز', color: 'green' },
  very_good: { label: 'جيد جدًا', color: 'cyan' },
  good: { label: 'جيد', color: 'blue' },
  needs_followup: { label: 'يحتاج متابعة', color: 'orange' },
};

export const DRIVER_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: 'نشط', color: 'green' },
  on_leave: { label: 'إجازة', color: 'gold' },
  suspended: { label: 'موقوف', color: 'red' },
};

export const TASK_PERIOD: Record<string, { label: string; color: string }> = {
  daily: { label: 'يومي', color: 'blue' },
  immediate: { label: 'فوري', color: 'red' },
  weekly: { label: 'أسبوعي', color: 'purple' },
  monthly: { label: 'شهري', color: 'green' },
};

export const CHECK_FIELDS: { key: string; label: string }[] = [
  { key: 'fuel', label: 'الوقود' },
  { key: 'oil_water', label: 'الزيت/المياه' },
  { key: 'tires', label: 'الإطارات' },
  { key: 'brakes', label: 'الفرامل' },
  { key: 'lights', label: 'الأنوار' },
  { key: 'cleanliness', label: 'النظافة' },
];

export const optionsOf = (m: Record<string, { label: string }>) =>
  Object.entries(m).map(([value, v]) => ({ value, label: v.label }));

export const tagOf = (m: Record<string, { label: string; color: string }>, v?: string | null) =>
  (v && m[v] ? <Tag color={m[v].color}>{m[v].label}</Tag> : null);

export const labelOf = (m: Record<string, { label: string }>, v?: string | null) =>
  (v && m[v] ? m[v].label : '');

export const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
export const km = (v: any) => (v === null || v === undefined || v === ''
  ? '' : Number(v).toLocaleString('en-US'));

export interface FleetVehicle {
  id: number; code: string; kind: string | null; model: string | null;
  plate_number: string | null; current_driver_id: number | null; driver_name: string | null;
  odometer: number; odometer_base: number; status: string; auto_status: string;
  status_override: string | null; reasons: string[]; open_faults: number;
  km_to_maintenance: number | null; last_maintenance_km: number | null;
  next_maintenance_km: number | null; insurance_until: string | null; license_until: string | null;
  insurance_days_left: number | null; license_days_left: number | null;
  fuel_account_id: number | null; maintenance_account_id: number | null;
  fuel_account_name: string | null; maintenance_account_name: string | null;
  cost_center_id: number | null; branch_id: number | null; active: boolean; notes: string | null;
}

export interface FleetEmployee {
  id: number; code: string; name: string; phone: string | null; branch_id: number | null;
  job_title: string | null; is_driver: boolean;
}

export function useFleetLookups() {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [employees, setEmployees] = useState<FleetEmployee[]>([]);
  const reload = useCallback(() => {
    api.get('/api/v1/fleet/vehicles').then((r) => setVehicles(r.data || [])).catch(() => {});
    api.get('/api/v1/fleet/employees').then((r) => setEmployees(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { vehicles, employees, reload };
}

export const vehicleOptions = (vehicles: FleetVehicle[], includeInactive = false) => vehicles
  .filter((v) => includeInactive || v.active)
  .map((v) => ({
    value: v.id,
    label: [v.code, v.plate_number, v.kind].filter(Boolean).join(' — '),
  }));

export const driverOptions = (employees: FleetEmployee[]) => [...employees]
  .sort((a, b) => Number(b.is_driver) - Number(a.is_driver))
  .map((e) => ({ value: e.id, label: e.is_driver ? e.name : `${e.name} (${e.job_title || 'موظف'})` }));

export function VehicleSelect({ vehicles, includeInactive, ...rest }: {
  vehicles: FleetVehicle[]; includeInactive?: boolean; [k: string]: any;
}) {
  return (
    <Select showSearch allowClear placeholder="السيارة" style={{ width: '100%' }}
      options={vehicleOptions(vehicles, includeInactive)}
      filterOption={searchFilter} filterSort={searchRank} {...rest} />
  );
}

export function DriverSelect({ employees, ...rest }: {
  employees: FleetEmployee[]; [k: string]: any;
}) {
  return (
    <Select showSearch allowClear placeholder="السائق" style={{ width: '100%' }}
      options={driverOptions(employees)} filterOption={searchFilter} filterSort={searchRank}
      {...rest} />
  );
}

export type MoneySource = 'maintenance' | 'fuel' | 'fault' | 'violation';

export function MoneyCell({ row, amount, onOpen }: {
  row: any; amount: any; onOpen: () => void;
}) {
  const { can } = useAuth();
  if (row.voucher_id && !row.voucher_reversed) {
    return (
      <Tag color="green" style={{ cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}>{row.voucher_number}</Tag>
    );
  }
  if (!Number(amount) || !can('fleet.write')) {
    return row.voucher_reversed ? <Tag>سند معكوس</Tag> : null;
  }
  return (
    <Button size="small" type="link" icon={<DollarOutlined />}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}>
      تسجيل مصروف
    </Button>
  );
}

export function ExpenseModal({ open, source, row, onClose, onDone }: {
  open: boolean; source: MoneySource; row: any | null;
  onClose: () => void; onDone: () => void;
}) {
  const { can } = useAuth();
  const [form] = Form.useForm();
  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [treasuries, setTreasuries] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [linkId, setLinkId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const linked = !!(row?.voucher_id && !row?.voucher_reversed);
  const canPost = can('voucher.write');

  const loadAccounts = useCallback(() => {
    api.get<any[]>('/api/v1/accounts').then((r) => {
      const exp = (r.data || []).filter((a) => a.nature === 'expense' && a.active !== false);
      setAccounts(exp.filter((a) => a.is_postable));
      setGroups(exp.filter((a) => !a.is_postable));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open || !row) return;
    setMode(canPost && !linked ? 'new' : 'link');
    setLinkId(null);
    loadAccounts();
    api.get('/api/v1/fleet/vouchers').then((r) => setVouchers(r.data || [])).catch(() => {});
    Promise.all([
      api.get('/api/v1/treasuries'),
      api.get('/api/v1/fleet/expense/suggest', { params: { source, record_id: row.id } }),
    ]).then(([t, s]) => {
      setTreasuries(t.data || []);
      form.setFieldsValue({
        treasury_id: defaultTreasuryId(t.data || []),
        expense_account_id: s.data.expense_account_id ?? undefined,
        amount: Number(s.data.amount),
        voucher_date: s.data.voucher_date ? dayjs(s.data.voucher_date) : dayjs(),
        description: s.data.description,
      });
    }).catch(() => {});
  }, [open, row?.id]);

  const save = async () => {
    if (!row) return;
    setSaving(true);
    try {
      if (mode === 'new') {
        const v = await form.validateFields();
        const res = await api.post('/api/v1/fleet/expense', {
          source, record_id: row.id, expense_account_id: v.expense_account_id,
          treasury_id: v.treasury_id, amount: String(v.amount),
          voucher_date: v.voucher_date ? v.voucher_date.format('YYYY-MM-DD') : null,
          description: v.description || null,
        });
        message.success(`تم تسجيل سند المصروف ${res.data.document_number}`);
      } else {
        if (!linkId) { message.warning('اختر السند'); return; }
        await api.post('/api/v1/fleet/link-voucher', { source, record_id: row.id, voucher_id: linkId });
        message.success('تم ربط السند');
      }
      onClose(); onDone();
    } catch { return; } finally { setSaving(false); }
  };

  const unlink = async () => {
    if (!row) return;
    try {
      await api.post('/api/v1/fleet/link-voucher', { source, record_id: row.id, voucher_id: null });
      message.success('تم إلغاء الربط');
      onClose(); onDone();
    } catch { return; }
  };

  useScreenShortcuts({ onSave: linked ? undefined : save }, open);

  return (
    <TabModal open={open} onCancel={onClose} width={620} forceRender
      title={linked ? `السند المرتبط: ${row?.voucher_number}` : 'تسجيل مصروف'}
      footer={linked ? (
        <Space>
          <Button danger icon={<LinkOutlined />} onClick={unlink}>إلغاء الربط</Button>
          <Button onClick={onClose}>إغلاق</Button>
        </Space>
      ) : undefined}
      onOk={save} okText={mode === 'new' ? 'حفظ السند' : 'ربط'} cancelText="إلغاء"
      confirmLoading={saving}>
      {!linked && (
        <>
          <Segmented block style={{ marginBottom: 12 }} value={mode}
            onChange={(v) => setMode(v as any)}
            options={[
              { value: 'new', label: 'سند مصروف جديد', disabled: !canPost },
              { value: 'link', label: 'ربط سند موجود' },
            ]} />
          <Form form={form} layout="vertical" requiredMark={false}
            style={{ display: mode === 'new' ? undefined : 'none' }}>
            <Space wrap align="start">
              <ExpenseAccountField accounts={accounts} groups={groups} onCreated={loadAccounts}
                width={280} />
              <TreasuryField treasuries={treasuries} width={240} />
            </Space>
            <Space wrap align="start">
              <Form.Item name="amount" label="المبلغ"
                rules={[{ required: true, message: 'أدخل المبلغ' }]}>
                <InputNumber min={0.01} style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="voucher_date" label="التاريخ">
                <DatePicker style={{ width: 160 }} />
              </Form.Item>
            </Space>
            <Form.Item name="description" label="البيان">
              <Input maxLength={200} />
            </Form.Item>
          </Form>
          {mode === 'link' && (
            <Select showSearch style={{ width: '100%' }} placeholder="اختر السند"
              value={linkId ?? undefined} onChange={setLinkId}
              options={vouchers.map((v) => ({
                value: v.id,
                label: `${v.document_number} — ${d10(v.voucher_date)} — ${voucherMoney(v.amount)} — ${v.account_name || ''}`,
              }))} filterOption={searchFilter} />
          )}
        </>
      )}
    </TabModal>
  );
}

export function PenaltyModal({ open, row, onClose, onDone }: {
  open: boolean; row: any | null; onClose: () => void; onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !row) return;
    form.setFieldsValue({
      amount: Number(row.amount || 0), month: dayjs(),
      reason: `مخالفة سيارة ${row.vehicle_code} — ${row.kind || ''} بتاريخ ${d10(row.record_date)}`,
    });
  }, [open, row, form]);
  const save = async () => {
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const res = await api.post(`/api/v1/fleet/violations/${row.id}/penalty`, {
        amount: String(v.amount), year: v.month.year(), month: v.month.month() + 1,
        reason: v.reason || null,
      });
      message.success(`تم تسجيل الجزاء ${res.data.penalty_number}`);
      onClose(); onDone();
    } catch { return; } finally { setSaving(false); }
  };
  useScreenShortcuts({ onSave: save }, open);
  return (
    <TabModal open={open} onCancel={onClose} onOk={save} confirmLoading={saving} forceRender
      title={`جزاء على السائق: ${row?.driver_name || ''}`} okText="تسجيل الجزاء"
      cancelText="إلغاء" width={480}>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Space>
          <Form.Item name="amount" label="المبلغ" rules={[{ required: true, message: 'أدخل المبلغ' }]}>
            <InputNumber min={0.01} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="month" label="شهر الرواتب" rules={[{ required: true, message: 'اختر الشهر' }]}>
            <DatePicker picker="month" style={{ width: 160 }} />
          </Form.Item>
        </Space>
        <Form.Item name="reason" label="السبب"><Input maxLength={300} /></Form.Item>
      </Form>
    </TabModal>
  );
}

export { money };

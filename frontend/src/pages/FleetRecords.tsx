import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AutoComplete, Button, Checkbox, Col, DatePicker, Form, Input, Row, Select, Space, Table, Tag,
  Tooltip,
} from 'antd';
import {
  AlertOutlined, ClearOutlined, DeleteOutlined, EditOutlined, FireOutlined, PlusOutlined,
  PrinterOutlined, ReloadOutlined, SearchOutlined, ToolOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { Popconfirm } from '../components/noConfirm';
import { TabModal } from '../components/TabModal';
import { InputNumber } from '../components/NumberInput';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { useLiveRefresh } from '../utils/live';
import { PAGE_SIZE } from '../utils/pagination';
import { money, num, qty } from '../utils/money';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { useFleetColumns, type FleetCol } from '../components/fleet/FleetTable';
import {
  DriverSelect, ExpenseModal, FAULT_STATUS, MoneyCell, type MoneySource, PenaltyModal, SEVERITY,
  VehicleSelect, d10, km, labelOf, optionsOf, tagOf, useFleetLookups,
} from '../components/fleet/fleetShared';

type Kind = 'maintenance' | 'fuel' | 'faults' | 'violations';

type FieldType = 'date' | 'vehicle' | 'driver' | 'int' | 'money' | 'qty' | 'text' | 'textarea'
  | 'select' | 'bool' | 'suggest' | 'fault';

interface Field {
  name: string; label: string; type: FieldType; required?: boolean; span?: number;
  options?: { value: string; label: string }[];
}

interface KindConfig {
  title: string; icon: React.ReactNode; create: string;
  source: MoneySource; amountKey: string; hasDriver: boolean; fields: Field[];
  defaults?: Record<string, any>;
}

const MAINT_KINDS = ['صيانة دورية', 'تغيير زيت', 'فلاتر', 'إطارات', 'فرامل', 'كهرباء', 'عفشة',
  'محرك', 'ناقل الحركة', 'تكييف', 'سمكرة ودهان', 'إصلاح عطل'];
const VIOLATION_KINDS = ['سرعة', 'انتظار خاطئ', 'رخصة', 'حزام الأمان', 'استخدام الهاتف',
  'تجاوز الإشارة', 'حمولة زائدة', 'السير عكس الاتجاه'];

const CONFIG: Record<Kind, KindConfig> = {
  maintenance: {
    title: 'الصيانة', icon: <ToolOutlined />, create: 'صيانة جديدة',
    source: 'maintenance', amountKey: 'cost', hasDriver: false,
    fields: [
      { name: 'record_date', label: 'التاريخ', type: 'date', required: true, span: 6 },
      { name: 'vehicle_id', label: 'السيارة', type: 'vehicle', required: true, span: 10 },
      { name: 'odometer', label: 'العداد', type: 'int', span: 8 },
      { name: 'kind', label: 'نوع الصيانة', type: 'suggest', span: 8,
        options: MAINT_KINDS.map((k) => ({ value: k, label: k })) },
      { name: 'workshop', label: 'الورشة/الفني', type: 'text', span: 8 },
      { name: 'cost', label: 'التكلفة', type: 'money', span: 8 },
      { name: 'work_done', label: 'الأعمال المنفذة', type: 'textarea', span: 12 },
      { name: 'parts', label: 'قطع الغيار', type: 'textarea', span: 12 },
      { name: 'next_maintenance_km', label: 'موعد الصيانة القادمة (كم)', type: 'int', span: 8 },
      { name: 'fault_id', label: 'إصلاح عطل مفتوح', type: 'fault', span: 16 },
      { name: 'notes', label: 'ملاحظات', type: 'text', span: 24 },
    ],
  },
  fuel: {
    title: 'الوقود', icon: <FireOutlined />, create: 'تزويد وقود جديد',
    source: 'fuel', amountKey: 'amount', hasDriver: true,
    fields: [
      { name: 'record_date', label: 'التاريخ', type: 'date', required: true, span: 6 },
      { name: 'vehicle_id', label: 'السيارة', type: 'vehicle', required: true, span: 9 },
      { name: 'driver_id', label: 'السائق', type: 'driver', span: 9 },
      { name: 'odometer', label: 'العداد', type: 'int', span: 6 },
      { name: 'liters', label: 'الكمية (لتر)', type: 'qty', span: 6 },
      { name: 'amount', label: 'القيمة', type: 'money', span: 6 },
      { name: 'station', label: 'المحطة', type: 'text', span: 6 },
      { name: 'route', label: 'خط السير/الرحلة', type: 'text', span: 12 },
      { name: 'notes', label: 'ملاحظات', type: 'text', span: 12 },
    ],
  },
  faults: {
    title: 'الأعطال', icon: <WarningOutlined />, create: 'عطل جديد',
    source: 'fault', amountKey: 'cost', hasDriver: true,
    defaults: { severity: 'medium', status: 'open', stopped: false, is_accident: false },
    fields: [
      { name: 'record_date', label: 'التاريخ', type: 'date', required: true, span: 6 },
      { name: 'vehicle_id', label: 'السيارة', type: 'vehicle', required: true, span: 9 },
      { name: 'driver_id', label: 'السائق', type: 'driver', span: 9 },
      { name: 'description', label: 'العطل/المشكلة', type: 'text', required: true, span: 16 },
      { name: 'odometer', label: 'العداد', type: 'int', span: 8 },
      { name: 'severity', label: 'درجة الخطورة', type: 'select', span: 6, options: optionsOf(SEVERITY) },
      { name: 'status', label: 'الحالة', type: 'select', span: 6, options: optionsOf(FAULT_STATUS) },
      { name: 'stopped', label: 'توقفت السيارة؟', type: 'bool', span: 6 },
      { name: 'is_accident', label: 'حادث؟', type: 'bool', span: 6 },
      { name: 'action_required', label: 'الإجراء المطلوب', type: 'text', span: 12 },
      { name: 'resolved_date', label: 'تاريخ الحل', type: 'date', span: 6 },
      { name: 'downtime_days', label: 'مدة التوقف (يوم)', type: 'qty', span: 6 },
      { name: 'cost', label: 'التكلفة', type: 'money', span: 8 },
      { name: 'notes', label: 'ملاحظات', type: 'text', span: 16 },
    ],
  },
  violations: {
    title: 'المخالفات', icon: <AlertOutlined />, create: 'مخالفة جديدة',
    source: 'violation', amountKey: 'amount', hasDriver: true,
    defaults: { paid: false },
    fields: [
      { name: 'record_date', label: 'التاريخ', type: 'date', required: true, span: 6 },
      { name: 'vehicle_id', label: 'السيارة', type: 'vehicle', required: true, span: 9 },
      { name: 'driver_id', label: 'السائق', type: 'driver', span: 9 },
      { name: 'kind', label: 'نوع المخالفة', type: 'suggest', span: 8,
        options: VIOLATION_KINDS.map((k) => ({ value: k, label: k })) },
      { name: 'amount', label: 'القيمة/الجزاء', type: 'money', span: 8 },
      { name: 'paid', label: 'تم السداد؟', type: 'bool', span: 4 },
      { name: 'paid_date', label: 'تاريخ السداد', type: 'date', span: 4 },
      { name: 'description', label: 'وصف المخالفة', type: 'text', span: 12 },
      { name: 'admin_action', label: 'الإجراء الإداري', type: 'text', span: 12 },
      { name: 'notes', label: 'ملاحظات', type: 'text', span: 24 },
    ],
  },
};

const DATE_FIELDS = ['record_date', 'resolved_date', 'paid_date'];
const STRING_NUM = ['cost', 'amount', 'liters', 'downtime_days'];

export default function FleetRecords({ kind }: { kind: Kind }) {
  const cfg = CONFIG[kind];
  const { can } = useAuth();
  const canWrite = can('fleet.write');
  const { vehicles, employees, reload: reloadLookups } = useFleetLookups();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moneyRow, setMoneyRow] = useState<any | null>(null);
  const [penalty, setPenalty] = useState<any | null>(null);
  const [openFaults, setOpenFaults] = useState<any[]>([]);
  const [form] = Form.useForm();
  const watchedVehicle = Form.useWatch('vehicle_id', form);
  const [params] = useSearchParams();

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/v1/fleet/${kind}`);
      setRows(r.data || []);
    } catch { return; } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [kind]);
  useLiveRefresh(['fleet'], load);

  const filter = useListFilter(rows, {
    search: (r) => [r.vehicle_code, r.driver_name, r.kind, r.description, r.work_done, r.parts,
      r.workshop, r.station, r.route, r.notes, r.admin_action, r.action_required, r.voucher_number],
    filters: {
      vehicle_id: (r, v) => r.vehicle_id === v,
      driver_id: (r, v) => r.driver_id === v,
      status: (r, v) => r.status === v,
      paid: (r, v) => String(!!r.paid) === v,
      linked: (r, v) => String(!!(r.voucher_id && !r.voucher_reversed)) === v,
    },
    dateOf: (r) => r.record_date,
  });
  useEffect(() => {
    const v = params.get('vehicle');
    if (v) filter.setValue('vehicle_id', [Number(v)]);
    const st = params.get('status');
    if (st) filter.setValue('status', st.split(','));
    const pd = params.get('paid');
    if (pd) filter.setValue('paid', [pd]);
  }, [params.toString()]);

  const searchRef = useRef<any>(null);

  const loadOpenFaults = (vehicleId?: number, keep?: number | null) => {
    if (kind !== 'maintenance' || !vehicleId) { setOpenFaults([]); return; }
    api.get('/api/v1/fleet/faults', { params: { vehicle_id: vehicleId } })
      .then((r) => setOpenFaults((r.data || []).filter((f: any) => f.status !== 'resolved' || f.id === keep)))
      .catch(() => setOpenFaults([]));
  };

  const onVehicle = (vehicleId?: number) => {
    const v = vehicles.find((x) => x.id === vehicleId);
    if (cfg.hasDriver && v && !form.getFieldValue('driver_id')) {
      form.setFieldsValue({ driver_id: v.current_driver_id ?? undefined });
    }
    loadOpenFaults(vehicleId);
  };

  const startCreate = () => {
    if (!canWrite) return;
    setEditing(null);
    form.resetFields();
    const preset = filter.values.vehicle_id?.length === 1 ? filter.values.vehicle_id[0] : undefined;
    form.setFieldsValue({ record_date: dayjs(), ...(cfg.defaults || {}), vehicle_id: preset });
    if (preset) onVehicle(preset);
    setOpen(true);
  };
  const startEdit = (r: any) => {
    if (!canWrite) return;
    setEditing(r);
    form.resetFields();
    const v: any = { ...r };
    DATE_FIELDS.forEach((k) => { v[k] = r[k] ? dayjs(r[k]) : null; });
    STRING_NUM.forEach((k) => { if (r[k] !== undefined && r[k] !== null) v[k] = Number(r[k]); });
    form.setFieldsValue(v);
    if (kind === 'maintenance') loadOpenFaults(r.vehicle_id, r.fault_id);
    setOpen(true);
  };

  const save = async () => {
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    const payload: any = {};
    cfg.fields.forEach((f) => {
      let x = v[f.name];
      if (DATE_FIELDS.includes(f.name)) x = x ? (x as Dayjs).format('YYYY-MM-DD') : null;
      else if (STRING_NUM.includes(f.name)) {
        const empty = x === undefined || x === null || x === '';
        x = empty ? (f.name === 'downtime_days' ? null : '0') : String(x);
      } else if (f.type === 'bool') x = !!x;
      else if (x === undefined || x === '') x = null;
      payload[f.name] = x;
    });
    setSaving(true);
    try {
      if (editing) await api.put(`/api/v1/fleet/${kind}/${editing.id}`, payload);
      else await api.post(`/api/v1/fleet/${kind}`, payload);
      setOpen(false);
      load(); reloadLookups();
    } catch { setSaving(false); return; }
    setSaving(false);
  };

  const remove = async (r: any) => {
    try { await api.delete(`/api/v1/fleet/${kind}/${r.id}`); } catch { return; }
    load(); reloadLookups();
  };

  const amountOf = (r: any) => r[cfg.amountKey];

  const fleetAvgKmpl = useMemo(() => {
    const withD = rows.filter((r) => r.distance && Number(r.liters));
    const d = withD.reduce((s, r) => s + Number(r.distance), 0);
    const l = withD.reduce((s, r) => s + Number(r.liters), 0);
    return l ? d / l : null;
  }, [rows]);

  const base: FleetCol<any>[] = [
    { key: 'record_date', title: 'التاريخ', text: (r) => d10(r.record_date), width: 100 },
    { key: 'vehicle', title: 'السيارة', text: (r) => r.vehicle_code, render: (r) => <b>{r.vehicle_code}</b> },
  ];
  const tail: FleetCol<any>[] = [
    { key: 'notes', title: 'ملاحظات', text: (r) => r.notes },
    { key: 'voucher', title: 'سند المصروف', text: (r) => (r.voucher_id && !r.voucher_reversed ? r.voucher_number : ''),
      render: (r) => <MoneyCell row={r} amount={amountOf(r)} onOpen={() => setMoneyRow(r)} /> },
  ];
  const middle: Record<Kind, FleetCol<any>[]> = {
    maintenance: [
      { key: 'odometer', title: 'العداد', text: (r) => km(r.odometer), numeric: true },
      { key: 'kind', title: 'نوع الصيانة', text: (r) => r.kind },
      { key: 'work_done', title: 'الأعمال المنفذة', text: (r) => r.work_done },
      { key: 'parts', title: 'قطع الغيار', text: (r) => r.parts },
      { key: 'cost', title: 'التكلفة', text: (r) => money(r.cost), numeric: true },
      { key: 'workshop', title: 'الورشة/الفني', text: (r) => r.workshop },
      { key: 'next', title: 'الصيانة القادمة (كم)', text: (r) => km(r.next_maintenance_km), numeric: true },
    ],
    fuel: [
      { key: 'driver', title: 'السائق', text: (r) => r.driver_name },
      { key: 'odometer', title: 'العداد', text: (r) => km(r.odometer), numeric: true },
      { key: 'liters', title: 'الكمية (لتر)', text: (r) => qty(r.liters), numeric: true },
      { key: 'amount', title: 'القيمة', text: (r) => money(r.amount), numeric: true },
      { key: 'price', title: 'سعر اللتر', numeric: true,
        text: (r) => (Number(r.liters) ? money(Number(r.amount) / Number(r.liters)) : '') },
      { key: 'distance', title: 'المسافة (كم)', text: (r) => km(r.distance), numeric: true },
      { key: 'kmpl', title: 'كم/لتر', numeric: true,
        text: (r) => (r.km_per_liter ? num(r.km_per_liter, { maximumFractionDigits: 2 }) : ''),
        render: (r) => {
          if (!r.km_per_liter) return '';
          const low = fleetAvgKmpl && Number(r.km_per_liter) < fleetAvgKmpl * 0.8;
          return (
            <span style={{ color: low ? '#cf1322' : undefined, fontWeight: low ? 600 : undefined }}>
              {num(r.km_per_liter, { maximumFractionDigits: 2 })}
            </span>
          );
        } },
      { key: 'station', title: 'المحطة', text: (r) => r.station },
      { key: 'route', title: 'خط السير/الرحلة', text: (r) => r.route },
    ],
    faults: [
      { key: 'driver', title: 'السائق', text: (r) => r.driver_name },
      { key: 'odometer', title: 'العداد', text: (r) => km(r.odometer), numeric: true },
      { key: 'description', title: 'العطل/المشكلة', text: (r) => r.description,
        render: (r) => <>{r.is_accident && <Tag color="volcano">حادث</Tag>}{r.description}</> },
      { key: 'severity', title: 'درجة الخطورة', text: (r) => labelOf(SEVERITY, r.severity), render: (r) => tagOf(SEVERITY, r.severity) },
      { key: 'action_required', title: 'الإجراء المطلوب', text: (r) => r.action_required },
      { key: 'stopped', title: 'توقفت السيارة؟', text: (r) => (r.stopped ? 'نعم' : 'لا'),
        render: (r) => (r.stopped ? <Tag color="red">نعم</Tag> : 'لا') },
      { key: 'downtime', title: 'مدة التوقف (يوم)', text: (r) => (r.downtime_days ? qty(r.downtime_days) : ''), numeric: true },
      { key: 'status', title: 'الحالة', text: (r) => labelOf(FAULT_STATUS, r.status), render: (r) => tagOf(FAULT_STATUS, r.status) },
      { key: 'resolved_date', title: 'تاريخ الحل', text: (r) => d10(r.resolved_date) },
      { key: 'cost', title: 'التكلفة', text: (r) => money(r.cost), numeric: true },
    ],
    violations: [
      { key: 'driver', title: 'السائق', text: (r) => r.driver_name },
      { key: 'kind', title: 'نوع المخالفة', text: (r) => r.kind },
      { key: 'description', title: 'وصف المخالفة', text: (r) => r.description },
      { key: 'amount', title: 'القيمة/الجزاء', text: (r) => money(r.amount), numeric: true },
      { key: 'paid', title: 'تم السداد؟', text: (r) => (r.paid ? 'نعم' : 'لا'),
        render: (r) => (r.paid ? <Tag color="green">نعم {d10(r.paid_date)}</Tag> : <Tag color="red">لا</Tag>) },
      { key: 'admin_action', title: 'الإجراء الإداري', text: (r) => r.admin_action },
      { key: 'penalty', title: 'جزاء الرواتب', text: (r) => (r.penalty_number && !r.penalty_cancelled ? r.penalty_number : ''),
        render: (r) => (r.penalty_number
          ? <Tag color={r.penalty_cancelled ? 'default' : 'purple'}>{r.penalty_number}{r.penalty_cancelled ? ' (ملغى)' : ''}</Tag>
          : null) },
    ],
  };

  const cols = [...base, ...middle[kind], ...tail];
  const table = useFleetColumns<any>(`fleet-${kind}`, cols, filter.filtered, {
    name: `${cfg.title} — السيارات`,
    defaultHidden: kind === 'fuel' ? ['price'] : [],
    actions: canWrite ? {
      title: '', width: 110,
      render: (_: any, r: any) => (
        <Space size={0}>
          <Tooltip title="تعديل"><Button type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); startEdit(r); }} /></Tooltip>
          {kind === 'violations' && r.driver_id && !(r.penalty_number && !r.penalty_cancelled) && can('payroll.post') && (
            <Tooltip title="جزاء على السائق">
              <Button type="text" icon={<AlertOutlined />} onClick={(e) => { e.stopPropagation(); setPenalty(r); }} />
            </Tooltip>
          )}
          <Popconfirm title="حذف السجل؟" onConfirm={() => remove(r)}>
            <Tooltip title="حذف"><Button type="text" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    } : undefined,
  });

  const kb = useTableKeyboard<any>({ rows: table.rows, rowKey: (r) => r.id, onOpen: (r) => startEdit(r) });

  const shown = filter.filtered;
  const sum = (k: string) => shown.reduce((s, r) => s + Number(r[k] || 0), 0);
  const unlinked = shown.filter((r) => Number(amountOf(r)) && !(r.voucher_id && !r.voucher_reversed));
  const totals: { label: string; value: string }[] = [{ label: 'عدد السجلات', value: num(shown.length) }];
  if (kind === 'fuel') {
    const withD = shown.filter((r) => r.distance && Number(r.liters));
    const d = withD.reduce((s, r) => s + Number(r.distance), 0);
    const l = withD.reduce((s, r) => s + Number(r.liters), 0);
    totals.push({ label: 'إجمالي اللترات', value: qty(sum('liters')) },
      { label: 'إجمالي القيمة', value: money(sum('amount')) },
      { label: 'متوسط كم/لتر', value: l ? num(d / l, { maximumFractionDigits: 2 }) : '-' });
  } else if (kind === 'violations') {
    totals.push({ label: 'إجمالي المخالفات', value: money(sum('amount')) },
      { label: 'غير مسدد', value: money(shown.filter((r) => !r.paid).reduce((s, r) => s + Number(r.amount || 0), 0)) });
  } else if (kind === 'faults') {
    totals.push({ label: 'مفتوحة', value: num(shown.filter((r) => r.status !== 'resolved').length) },
      { label: 'أوقفت السيارة', value: num(shown.filter((r) => r.stopped && r.status !== 'resolved').length) },
      { label: 'إجمالي التكلفة', value: money(sum('cost')) });
  } else {
    totals.push({ label: 'إجمالي التكلفة', value: money(sum('cost')) });
  }
  if (unlinked.length) {
    totals.push({ label: 'بدون سند مصروف', value: `${num(unlinked.length)} — ${money(unlinked.reduce((s, r) => s + Number(amountOf(r) || 0), 0))}` });
  }

  const doPrint = () => {
    const meta: [string, string][] = [];
    if (filter.range) meta.push(['الفترة', `${filter.range[0].format('YYYY-MM-DD')} → ${filter.range[1].format('YYYY-MM-DD')}`]);
    const vs = filter.values.vehicle_id;
    if (vs?.length) meta.push(['السيارة', vs.map((id: number) => vehicles.find((v) => v.id === id)?.code).join('، ')]);
    table.print({ title: `${cfg.title} — السيارات`, meta }, totals);
  };

  useScreenShortcuts({
    onNew: canWrite ? startCreate : undefined,
    onSearch: () => searchRef.current?.focus?.(),
    onPrint: doPrint,
  });
  useScreenShortcuts({ onSave: save, onClose: () => setOpen(false) }, open);

  const multi = (key: string, placeholder: string, options: { value: any; label: string }[]) => {
    const v = filter.values[key];
    return (
      <Select allowClear showSearch mode="multiple" maxTagCount="responsive" placeholder={placeholder}
        value={v === undefined || v === null || v === '' ? undefined : (Array.isArray(v) ? v : [v])}
        onChange={(x) => filter.setValue(key, Array.isArray(x) && !x.length ? undefined : x)}
        options={options} filterOption={searchFilter} filterSort={searchRank} />
    );
  };

  const fieldControl = (f: Field) => {
    switch (f.type) {
      case 'date': return <DatePicker style={{ width: '100%' }} />;
      case 'vehicle': return <VehicleSelect vehicles={vehicles} includeInactive={!!editing} onChange={(v: number) => onVehicle(v)} />;
      case 'driver': return <DriverSelect employees={employees} />;
      case 'int': return (
        <InputNumber min={0} precision={0} style={{ width: '100%' }}
          placeholder={f.name === 'odometer' && selected ? km(selected.odometer) : undefined} />
      );
      case 'money': return <InputNumber min={0} style={{ width: '100%' }} />;
      case 'qty': return <InputNumber min={0} style={{ width: '100%' }} />;
      case 'textarea': return <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={500} />;
      case 'select': return <Select options={f.options} />;
      case 'suggest': return <AutoComplete options={f.options} filterOption={searchFilter} allowClear />;
      case 'fault': return (
        <Select allowClear
          options={openFaults.map((x) => ({ value: x.id, label: `${d10(x.record_date)} — ${x.description} (${labelOf(FAULT_STATUS, x.status)})` }))} />
      );
      default: return <Input maxLength={300} />;
    }
  };

  const selected = vehicles.find((v) => v.id === watchedVehicle);

  return (
    <>
      <ListPage
        icon={cfg.icon} title={cfg.title}
        actions={<>
          {canWrite && (
            <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />}
              onClick={startCreate}>{cfg.create}</Button>
          )}
          <Button data-shortcut="F7" icon={<PrinterOutlined />} onClick={doPrint}>طباعة</Button>
          {table.control}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>}
        summary={<>{totals.map((t) => <ListStat key={t.label} label={t.label} value={t.value} />)}</>}
        filters={<>
          <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
            placeholder="بحث" prefix={<SearchOutlined />}
            onChange={(e) => filter.setQuery(e.target.value)} />
          {multi('vehicle_id', 'السيارة', vehicles.map((v) => ({ value: v.id, label: v.code })))}
          {cfg.hasDriver && multi('driver_id', 'السائق',
            employees.filter((e) => e.is_driver).map((e) => ({ value: e.id, label: e.name })))}
          {kind === 'faults' && multi('status', 'الحالة', optionsOf(FAULT_STATUS))}
          {kind === 'violations' && multi('paid', 'السداد', [{ value: 'true', label: 'مسددة' }, { value: 'false', label: 'غير مسددة' }])}
          {multi('linked', 'سند المصروف', [{ value: 'true', label: 'مرتبط بسند' }, { value: 'false', label: 'بدون سند' }])}
          <DateRangeFilter value={filter.range} onChange={filter.setRange} />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </>}
      >
        <Table
          {...kb.tableProps}
          className="sl-table" rowKey="id" size="small" loading={loading}
          dataSource={table.rows} columns={table.columns}
          locale={{ emptyText: 'لا توجد سجلات' }}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
          scroll={{ x: 'max-content' }}
          rowClassName={(r: any) => (kind === 'faults' && r.status !== 'resolved' && (r.stopped || r.severity === 'critical') ? 'fleet-row-danger' : '')}
        />
      </ListPage>

      <TabModal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving}
        title={editing ? `تعديل — ${cfg.title}` : cfg.create} okText="حفظ" cancelText="إلغاء"
        forceRender width={820}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={[10, 0]}>
            {cfg.fields.map((f) => (
              <Col key={f.name} xs={24} md={f.span || 8}>
                <Form.Item name={f.name} label={f.type === 'bool' ? ' ' : f.label}
                  valuePropName={f.type === 'bool' ? 'checked' : 'value'}
                  rules={f.required ? [{ required: true, message: `${f.label} مطلوب` }] : undefined}>
                  {f.type === 'bool' ? <Checkbox>{f.label}</Checkbox> : fieldControl(f)}
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>
      </TabModal>

      <ExpenseModal open={!!moneyRow} source={cfg.source} row={moneyRow}
        onClose={() => setMoneyRow(null)} onDone={load} />
      <PenaltyModal open={!!penalty} row={penalty} onClose={() => setPenalty(null)} onDone={load} />
    </>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, Col, DatePicker, Form, Input, Row, Select, Space, Table, Tag, Tooltip,
} from 'antd';
import {
  CarOutlined, ClearOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined,
  PrinterOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api, getViewBranch } from '../api/client';
import { Popconfirm } from '../components/noConfirm';
import { TabModal } from '../components/TabModal';
import { InputNumber } from '../components/NumberInput';
import ListPage, { ListStat } from '../components/ListPage';
import CostCenterField from '../components/CostCenterField';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { useLiveRefresh } from '../utils/live';
import { PAGE_SIZE } from '../utils/pagination';
import { num } from '../utils/money';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { useFleetColumns, type FleetCol } from '../components/fleet/FleetTable';
import {
  DriverSelect, type FleetVehicle, VEHICLE_STATUS, d10, km, labelOf, optionsOf, useFleetLookups,
} from '../components/fleet/fleetShared';

const VEHICLE_FIELDS = ['code', 'kind', 'model', 'plate_number', 'current_driver_id', 'odometer',
  'status_override', 'next_maintenance_km', 'last_maintenance_km', 'insurance_until',
  'license_until', 'fuel_account_id', 'maintenance_account_id', 'cost_center_id', 'branch_id',
  'active', 'notes'];

const daysTag = (days: number | null, date: string | null, alertDays = 30) => {
  if (!date) return '';
  if (days === null) return d10(date);
  const color = days < 0 ? 'red' : days <= alertDays ? 'orange' : undefined;
  return color
    ? <Tooltip title={days < 0 ? `منتهٍ منذ ${-days} يوم` : `متبقٍ ${days} يوم`}><Tag color={color}>{d10(date)}</Tag></Tooltip>
    : d10(date);
};

export default function FleetVehicles() {
  const { can, user } = useAuth();
  const canWrite = can('fleet.write');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { employees } = useFleetLookups();
  const [rows, setRows] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [alertDays, setAlertDays] = useState(30);
  const [editing, setEditing] = useState<FleetVehicle | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const searchRef = useRef<any>(null);
  const ownBranch = user && user.role !== 'owner' && user.role !== 'system_admin'
    ? (user.branch_id ?? null) : null;
  const viewBranch = getViewBranch();

  const load = async () => {
    setLoading(true);
    try { setRows((await api.get('/api/v1/fleet/vehicles')).data || []); } catch { return; } finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(() => {});
    api.get<any[]>('/api/v1/accounts').then((r) => setAccounts((r.data || [])
      .filter((a) => a.nature === 'expense' && a.is_postable && a.active !== false))).catch(() => {});
    api.get('/api/v1/fleet/settings').then((r) => setAlertDays(r.data.expiry_alert_days)).catch(() => {});
  }, []);
  useLiveRefresh(['fleet'], load);

  const filter = useListFilter(rows, {
    search: (r) => [r.code, r.kind, r.model, r.plate_number, r.driver_name, r.notes],
    filters: {
      status: (r, v) => r.status === v,
      active: (r, v) => String(r.active) === v,
    },
    initialValues: { active: ['true'] },
  });
  useEffect(() => {
    const st = params.get('status');
    if (st) filter.setValue('status', st.split(','));
  }, [params.toString()]);

  const startCreate = () => {
    if (!canWrite) return;
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ active: true, branch_id: ownBranch ?? viewBranch ?? undefined });
    setOpen(true);
  };
  const startEdit = (v: FleetVehicle) => {
    if (!canWrite) return;
    setEditing(v);
    form.resetFields();
    form.setFieldsValue({
      ...v,
      insurance_until: v.insurance_until ? dayjs(v.insurance_until) : null,
      license_until: v.license_until ? dayjs(v.license_until) : null,
      assign_date: dayjs(),
    });
    setOpen(true);
  };
  const openDetail = (v: FleetVehicle) => navigate(`/fleet/vehicles/${v.id}`);

  const save = async () => {
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    const payload: any = {};
    VEHICLE_FIELDS.forEach((k) => { payload[k] = v[k] === undefined || v[k] === '' ? null : v[k]; });
    payload.active = !!v.active;
    payload.insurance_until = v.insurance_until ? v.insurance_until.format('YYYY-MM-DD') : null;
    payload.license_until = v.license_until ? v.license_until.format('YYYY-MM-DD') : null;
    payload.assign_date = v.assign_date ? v.assign_date.format('YYYY-MM-DD') : null;
    setSaving(true);
    try {
      if (editing) await api.put(`/api/v1/fleet/vehicles/${editing.id}`, payload);
      else await api.post('/api/v1/fleet/vehicles', payload);
      setOpen(false); load();
    } catch { return; } finally { setSaving(false); }
  };
  const remove = async (v: FleetVehicle) => {
    try { await api.delete(`/api/v1/fleet/vehicles/${v.id}`); } catch { return; }
    load();
  };

  useScreenShortcuts({
    onNew: canWrite ? startCreate : undefined,
    onSearch: () => searchRef.current?.focus?.(),
    onPrint: () => doPrint(),
  });
  useScreenShortcuts({ onSave: save, onClose: () => setOpen(false) }, open);

  const cols: FleetCol<FleetVehicle>[] = useMemo(() => [
    { key: 'code', title: 'رقم السيارة', text: (r) => r.code, render: (r) => <b>{r.code}</b> },
    { key: 'kind', title: 'نوع السيارة', text: (r) => r.kind },
    { key: 'model', title: 'الموديل', text: (r) => r.model },
    { key: 'plate', title: 'رقم اللوحة', text: (r) => r.plate_number },
    { key: 'driver', title: 'السائق الحالي', text: (r) => r.driver_name },
    { key: 'odometer', title: 'العداد الحالي', text: (r) => km(r.odometer), numeric: true },
    { key: 'status', title: 'حالة السيارة', text: (r) => labelOf(VEHICLE_STATUS, r.status),
      render: (r) => (
        <Tooltip title={[r.status_override ? `مثبتة يدويًا (المحسوبة: ${labelOf(VEHICLE_STATUS, r.auto_status)})` : '', ...r.reasons].filter(Boolean).join(' · ') || undefined}>
          <Tag color={VEHICLE_STATUS[r.status]?.color}>{labelOf(VEHICLE_STATUS, r.status)}{r.status_override ? ' (مثبتة)' : ''}</Tag>
        </Tooltip>
      ) },
    { key: 'last', title: 'آخر صيانة (كم)', text: (r) => km(r.last_maintenance_km), numeric: true },
    { key: 'next', title: 'موعد الصيانة القادمة (كم)', text: (r) => km(r.next_maintenance_km), numeric: true },
    { key: 'left', title: 'باقي على الصيانة (كم)', numeric: true, text: (r) => km(r.km_to_maintenance),
      render: (r) => (r.km_to_maintenance === null ? '' : (
        <span style={{ color: r.km_to_maintenance < 0 ? '#cf1322' : r.status === 'maintenance_due' ? '#d46b08' : undefined }}>
          {km(r.km_to_maintenance)}
        </span>
      )) },
    { key: 'insurance', title: 'التأمين حتى', text: (r) => d10(r.insurance_until),
      render: (r) => daysTag(r.insurance_days_left, r.insurance_until, alertDays) },
    { key: 'license', title: 'الرخصة حتى', text: (r) => d10(r.license_until),
      render: (r) => daysTag(r.license_days_left, r.license_until, alertDays) },
    { key: 'branch', title: 'الفرع', text: (r) => branches.find((b) => b.id === r.branch_id)?.name || '' },
    { key: 'notes', title: 'ملاحظات', text: (r) => r.notes },
  ], [branches, alertDays]);

  const table = useFleetColumns<FleetVehicle>('fleet-vehicles', cols, filter.filtered, {
    name: 'السيارات',
    actions: {
      title: '', width: 120,
      render: (_: any, r: FleetVehicle) => (
        <Space size={0}>
          <Tooltip title="بطاقة السيارة"><Button type="text" icon={<EyeOutlined />} onClick={(e) => { e.stopPropagation(); openDetail(r); }} /></Tooltip>
          {canWrite && <Tooltip title="تعديل"><Button type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); startEdit(r); }} /></Tooltip>}
          {canWrite && (
            <Popconfirm title="حذف السيارة؟" onConfirm={() => remove(r)}>
              <Tooltip title="حذف"><Button type="text" danger icon={<DeleteOutlined />} /></Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  });
  const kb = useTableKeyboard<FleetVehicle>({ rows: table.rows, rowKey: (r) => r.id, onOpen: openDetail });

  const count = (s: string) => filter.filtered.filter((r) => r.status === s).length;
  const doPrint = () => table.print({ title: 'السيارات' }, [
    { label: 'عدد السيارات', value: String(filter.filtered.length) },
  ]);

  const multi = (key: string, placeholder: string, options: { value: any; label: string }[]) => {
    const v = filter.values[key];
    return (
      <Select allowClear mode="multiple" maxTagCount="responsive" placeholder={placeholder}
        value={v === undefined || v === null || v === '' ? undefined : (Array.isArray(v) ? v : [v])}
        onChange={(x) => filter.setValue(key, Array.isArray(x) && !x.length ? undefined : x)}
        options={options} />
    );
  };

  const accountOptions = sortByName(accounts, (a) => a.name).map((a) => ({ value: a.id, label: a.name, search: a.code }));

  return (
    <>
      <ListPage
        icon={<CarOutlined />} title="السيارات"
        actions={<>
          {canWrite && <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />} onClick={startCreate}>سيارة جديدة</Button>}
          <Button data-shortcut="F7" icon={<PrinterOutlined />} onClick={doPrint}>طباعة</Button>
          {table.control}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>}
        summary={<>
          <ListStat label="إجمالي السيارات" value={num(filter.filtered.length)} />
          <ListStat label="جيدة" value={num(count('good'))} tone="pos" />
          <ListStat label="تحتاج متابعة" value={num(count('attention'))} tone="warn" />
          <ListStat label="تحتاج صيانة" value={num(count('maintenance_due'))} tone="warn" />
          <ListStat label="متوقفة" value={num(count('stopped'))} tone="neg" />
        </>}
        filters={<>
          <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
            placeholder="بحث" prefix={<SearchOutlined />}
            onChange={(e) => filter.setQuery(e.target.value)} />
          {multi('status', 'الحالة', optionsOf(VEHICLE_STATUS))}
          {multi('active', 'نشطة؟', [{ value: 'true', label: 'نشطة' }, { value: 'false', label: 'موقوفة' }])}
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </>}
      >
        <Table {...kb.tableProps} className="sl-table" rowKey="id" size="small" loading={loading}
          dataSource={table.rows} columns={table.columns} scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لا توجد سيارات' }}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }} />
      </ListPage>

      <TabModal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving}
        title={editing ? `تعديل السيارة ${editing.code}` : 'سيارة جديدة'} okText="حفظ" cancelText="إلغاء"
        forceRender width={860}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={[10, 0]}>
            <Col xs={24} md={6}><Form.Item name="code" label="رقم السيارة" rules={[{ required: true, message: 'رقم السيارة مطلوب' }]}><Input autoFocus maxLength={40} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="kind" label="نوع السيارة"><Input maxLength={80} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="model" label="الموديل"><Input maxLength={80} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="plate_number" label="رقم اللوحة"><Input maxLength={40} /></Form.Item></Col>

            <Col xs={24} md={8}>
              <Form.Item name="current_driver_id" label="السائق الحالي">
                <DriverSelect employees={employees} />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}><Form.Item name="assign_date" label="تاريخ التسليم"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={6}>
              <Form.Item name="odometer" label="العداد الحالي">
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="status_override" label="تثبيت الحالة">
                <Select allowClear options={optionsOf(VEHICLE_STATUS)} />
              </Form.Item>
            </Col>

            <Col xs={24} md={6}><Form.Item name="last_maintenance_km" label="آخر صيانة (كم)"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="next_maintenance_km" label="موعد الصيانة القادمة (كم)"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="insurance_until" label="التأمين حتى"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="license_until" label="الرخصة حتى"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>

            <Col xs={24} md={8}>
              <Form.Item name="fuel_account_id" label="حساب الوقود">
                <Select allowClear showSearch options={accountOptions} filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="maintenance_account_id" label="حساب الصيانة">
                <Select allowClear showSearch options={accountOptions} filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}><Form.Item name="cost_center_id" label="مركز التكلفة"><CostCenterField /></Form.Item></Col>

            <Col xs={24} md={8}>
              <Form.Item name="branch_id" label="الفرع">
                <Select allowClear={!ownBranch} disabled={!!ownBranch} placeholder="الفرع"
                  options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}><Form.Item name="notes" label="ملاحظات"><Input maxLength={500} /></Form.Item></Col>
            <Col xs={24} md={4}><Form.Item name="active" label=" " valuePropName="checked"><Checkbox>نشطة</Checkbox></Form.Item></Col>
          </Row>
        </Form>
      </TabModal>
    </>
  );
}

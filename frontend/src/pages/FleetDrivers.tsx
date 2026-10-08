import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Col, DatePicker, Form, Input, Row, Select, Space, Table, Tag, Tooltip,
} from 'antd';
import {
  ClearOutlined, DeleteOutlined, EditOutlined, IdcardOutlined, PlusOutlined, PrinterOutlined,
  ReloadOutlined, SearchOutlined, UserAddOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { Popconfirm } from '../components/noConfirm';
import { TabModal } from '../components/TabModal';
import ListPage, { ListStat } from '../components/ListPage';
import EmployeeFormModal from '../components/EmployeeFormModal';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { useLiveRefresh } from '../utils/live';
import { PAGE_SIZE } from '../utils/pagination';
import { money, num } from '../utils/money';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { useFleetColumns, type FleetCol } from '../components/fleet/FleetTable';
import {
  DRIVER_STATUS, RATING, VehicleSelect, d10, km, labelOf, optionsOf, tagOf, useFleetLookups,
} from '../components/fleet/fleetShared';

const FIELDS = ['employee_id', 'vehicle_id', 'rating', 'status', 'license_number', 'license_until', 'notes'];

export default function FleetDrivers() {
  const { can } = useAuth();
  const canWrite = can('fleet.write');
  const { vehicles, employees, reload: reloadLookups } = useFleetLookups();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [empOpen, setEmpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const searchRef = useRef<any>(null);

  const load = async () => {
    setLoading(true);
    try { setRows((await api.get('/api/v1/fleet/drivers')).data || []); } catch { return; } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useLiveRefresh(['fleet'], load);

  const filter = useListFilter(rows, {
    search: (r) => [r.name, r.code, r.phone, r.vehicle_code, r.license_number, r.notes],
    filters: {
      status: (r, v) => r.status === v,
      rating: (r, v) => r.rating === v,
    },
  });

  const startCreate = () => {
    if (!canWrite) return;
    setEditing(null); form.resetFields();
    form.setFieldsValue({ status: 'active', assign_date: dayjs() });
    setOpen(true);
  };
  const startEdit = (r: any) => {
    if (!canWrite) return;
    setEditing(r); form.resetFields();
    form.setFieldsValue({ ...r, license_until: r.license_until ? dayjs(r.license_until) : null, assign_date: dayjs() });
    setOpen(true);
  };

  const save = async () => {
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    const payload: any = {};
    FIELDS.forEach((k) => { payload[k] = v[k] === undefined || v[k] === '' ? null : v[k]; });
    payload.license_until = v.license_until ? v.license_until.format('YYYY-MM-DD') : null;
    payload.assign_date = v.assign_date ? v.assign_date.format('YYYY-MM-DD') : null;
    payload.status = payload.status || 'active';
    setSaving(true);
    try {
      if (editing) await api.put(`/api/v1/fleet/drivers/${editing.id}`, payload);
      else await api.post('/api/v1/fleet/drivers', payload);
      setOpen(false); load(); reloadLookups();
    } catch { return; } finally { setSaving(false); }
  };
  const remove = async (r: any) => {
    try { await api.delete(`/api/v1/fleet/drivers/${r.id}`); } catch { return; }
    load(); reloadLookups();
  };

  useScreenShortcuts({
    onNew: canWrite ? startCreate : undefined,
    onSearch: () => searchRef.current?.focus?.(),
    onPrint: () => doPrint(),
  });
  useScreenShortcuts({ onSave: save, onClose: () => setOpen(false) }, open);

  const cols: FleetCol<any>[] = useMemo(() => [
    { key: 'name', title: 'اسم السائق', text: (r) => r.name, render: (r) => <b>{r.name}</b> },
    { key: 'vehicle', title: 'رقم السيارة', text: (r) => r.vehicle_code },
    { key: 'phone', title: 'رقم الهاتف', text: (r) => r.phone },
    { key: 'hire', title: 'تاريخ التعيين', text: (r) => d10(r.hire_date) },
    { key: 'since', title: 'تاريخ استلام السيارة', text: (r) => d10(r.assigned_since) },
    { key: 'start', title: 'العداد عند الاستلام', text: (r) => km(r.start_odometer), numeric: true },
    { key: 'current', title: 'العداد الحالي', text: (r) => km(r.current_odometer), numeric: true },
    { key: 'driven', title: 'المسافة المقطوعة (كم)', text: (r) => km(r.km_driven), numeric: true },
    { key: 'accidents', title: 'الحوادث', text: (r) => r.accidents, numeric: true,
      render: (r) => (r.accidents ? <Tag color="volcano">{num(r.accidents)}</Tag> : '0') },
    { key: 'violations', title: 'المخالفات', text: (r) => r.violations, numeric: true,
      render: (r) => (r.violations
        ? <Tooltip title={`إجمالي ${money(r.violations_amount)} — غير مسدد: ${num(r.unpaid_violations)}`}><Tag color="orange">{num(r.violations)}</Tag></Tooltip>
        : '0') },
    { key: 'rating', title: 'تقييم السائق', text: (r) => labelOf(RATING, r.rating), render: (r) => tagOf(RATING, r.rating) },
    { key: 'status', title: 'حالة السائق', text: (r) => labelOf(DRIVER_STATUS, r.status), render: (r) => tagOf(DRIVER_STATUS, r.status) },
    { key: 'license_no', title: 'رقم رخصة القيادة', text: (r) => r.license_number },
    { key: 'license', title: 'الرخصة حتى', text: (r) => d10(r.license_until),
      render: (r) => {
        if (!r.license_until) return '';
        const days = dayjs(r.license_until).diff(dayjs().startOf('day'), 'day');
        return days < 0 ? <Tag color="red">{d10(r.license_until)}</Tag>
          : days <= 30 ? <Tag color="orange">{d10(r.license_until)}</Tag> : d10(r.license_until);
      } },
    { key: 'notes', title: 'ملاحظات', text: (r) => r.notes },
  ], []);

  const table = useFleetColumns<any>('fleet-drivers', cols, filter.filtered, {
    name: 'السائقون',
    defaultHidden: ['since', 'license_no'],
    actions: canWrite ? {
      title: '', width: 90,
      render: (_: any, r: any) => (
        <Space size={0}>
          <Tooltip title="تعديل"><Button type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); startEdit(r); }} /></Tooltip>
          <Popconfirm title="حذف من السائقين؟" onConfirm={() => remove(r)}>
            <Tooltip title="حذف من السائقين"><Button type="text" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    } : undefined,
  });
  const kb = useTableKeyboard<any>({ rows: table.rows, rowKey: (r) => r.id, onOpen: (r) => startEdit(r) });

  const doPrint = () => table.print({ title: 'السائقون' }, [{ label: 'عدد السائقين', value: String(filter.filtered.length) }]);

  const multi = (key: string, placeholder: string, options: { value: any; label: string }[]) => {
    const v = filter.values[key];
    return (
      <Select allowClear mode="multiple" maxTagCount="responsive" placeholder={placeholder}
        value={v === undefined || v === null || v === '' ? undefined : (Array.isArray(v) ? v : [v])}
        onChange={(x) => filter.setValue(key, Array.isArray(x) && !x.length ? undefined : x)}
        options={options} />
    );
  };

  const empOptions = employees
    .filter((e) => !e.is_driver || e.id === editing?.employee_id)
    .map((e) => ({ value: e.id, label: `${e.name}${e.job_title ? ` — ${e.job_title}` : ''}` }));

  return (
    <>
      <ListPage
        icon={<IdcardOutlined />} title="السائقون"
        actions={<>
          {canWrite && <Button data-shortcut="F2" type="primary" className="sl-create" icon={<PlusOutlined />} onClick={startCreate}>سائق جديد</Button>}
          <Button data-shortcut="F7" icon={<PrinterOutlined />} onClick={doPrint}>طباعة</Button>
          {table.control}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>}
        summary={<>
          <ListStat label="إجمالي السائقين" value={num(filter.filtered.length)} />
          <ListStat label="نشط" value={num(filter.filtered.filter((r) => r.status === 'active').length)} tone="pos" />
          <ListStat label="مرتبط بسيارة" value={num(filter.filtered.filter((r) => r.vehicle_id).length)} />
          <ListStat label="حوادث" value={num(filter.filtered.reduce((s, r) => s + r.accidents, 0))} tone="neg" />
          <ListStat label="مخالفات غير مسددة" value={num(filter.filtered.reduce((s, r) => s + r.unpaid_violations, 0))} tone="warn" />
        </>}
        filters={<>
          <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
            placeholder="بحث" prefix={<SearchOutlined />}
            onChange={(e) => filter.setQuery(e.target.value)} />
          {multi('status', 'حالة السائق', optionsOf(DRIVER_STATUS))}
          {multi('rating', 'التقييم', optionsOf(RATING))}
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </>}
      >
        <Table {...kb.tableProps} className="sl-table" rowKey="id" size="small" loading={loading}
          dataSource={table.rows} columns={table.columns} scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لا يوجد سائقون' }}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }} />
      </ListPage>

      <TabModal open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving}
        title={editing ? `تعديل السائق ${editing.name}` : 'سائق جديد'} okText="حفظ" cancelText="إلغاء"
        forceRender width={760}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={[10, 0]}>
            <Col xs={24} md={12}>
              <Form.Item name="employee_id" label="الموظف" rules={[{ required: true, message: 'اختر الموظف' }]}
                extra={!editing && can('hr.write') ? (
                  <Button size="small" type="link" icon={<UserAddOutlined />} style={{ padding: 0 }}
                    onClick={() => setEmpOpen(true)}>موظف جديد</Button>
                ) : undefined}>
                <Select showSearch disabled={!!editing} options={empOptions}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="vehicle_id" label="السيارة">
                <VehicleSelect vehicles={vehicles} />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}><Form.Item name="assign_date" label="تاريخ التسليم"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="rating" label="تقييم السائق"><Select allowClear options={optionsOf(RATING)} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="status" label="حالة السائق"><Select options={optionsOf(DRIVER_STATUS)} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="license_number" label="رقم رخصة القيادة"><Input maxLength={40} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="license_until" label="الرخصة حتى"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={24}><Form.Item name="notes" label="ملاحظات"><Input maxLength={500} /></Form.Item></Col>
          </Row>
        </Form>
      </TabModal>

      <EmployeeFormModal open={empOpen} employee={null} defaults={{}} onClose={() => setEmpOpen(false)}
        onSaved={(e) => { reloadLookups(); form.setFieldsValue({ employee_id: e.id }); }} />
    </>
  );
}

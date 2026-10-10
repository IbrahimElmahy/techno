import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Col, Form, Input, Row, Segmented, Select, Space, Switch, Table, Tag, Tooltip,
  Typography, message,
} from 'antd';
import {
  EditOutlined, KeyOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, SyncOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { InputNumber } from '../components/NumberInput';
import DateRangeFilter from '../components/DateRangeFilter';
import { Popconfirm } from '../components/noConfirm';
import { TabModal } from '../components/TabModal';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { PAGE_SIZE } from '../utils/pagination';

interface Device {
  id: number;
  name: string;
  serial: string | null;
  ip: string | null;
  port: number;
  branch_id: number | null;
  active: boolean;
  last_seen_at: string | null;
  last_punch_at: string | null;
  users_count: number | null;
  records_count: number | null;
  records_capacity: number | null;
  firmware: string | null;
  punches: number;
  matched_punches: number;
}

interface DeviceUser {
  user_no: string;
  name: string | null;
  privilege: number;
  on_device: boolean;
  employee_id: number | null;
  employee_name: string | null;
  employee_code: string | null;
  punches: number;
  unmatched_punches: number;
  last_punch_at: string | null;
}

interface Punch {
  id: number;
  device_id: number;
  device_name: string | null;
  user_no: string;
  device_user_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  punched_at: string;
  status: number;
  verify: number;
  processed: boolean;
}

const fmt = (v: string | null) => (v ? dayjs(v).format('YYYY/MM/DD HH:mm') : '—');

const PUNCH_STATE: Record<number, string> = {
  0: 'حضور', 1: 'انصراف', 2: 'خروج مؤقت', 3: 'عودة', 4: 'بدء إضافي', 5: 'نهاية إضافي',
};

const VERIFY: Record<number, string> = { 0: 'كلمة مرور', 1: 'بصمة', 2: 'بطاقة', 15: 'وجه' };

function deviceState(d: Device) {
  if (!d.active) return <Tag>موقوف</Tag>;
  if (!d.last_seen_at) return <Tag color="default">لم يتصل بعد</Tag>;
  const minutes = dayjs().diff(dayjs(d.last_seen_at), 'minute');
  if (minutes <= 15) return <Tag color="green">متصل</Tag>;
  return <Tooltip title={`آخر اتصال منذ ${minutes} دقيقة`}><Tag color="orange">منقطع</Tag></Tooltip>;
}

function logUsage(d: Device) {
  if (!d.records_count) return '—';
  const cap = d.records_capacity || 80000;
  const pct = Math.round((d.records_count / cap) * 100);
  const color = pct >= 90 ? 'red' : pct >= 75 ? 'orange' : undefined;
  return (
    <Tooltip title={pct >= 90 ? 'سعة سجل الجهاز قاربت الامتلاء' : undefined}>
      <Tag color={color}>{d.records_count.toLocaleString('en')} / {cap.toLocaleString('en')} · {pct}٪</Tag>
    </Tooltip>
  );
}

export default function AttendanceDevices({ employees }: { employees: any[] }) {
  const [view, setView] = useState<'devices' | 'users' | 'punches'>('devices');
  const [devices, setDevices] = useState<Device[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Device | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<{ device: string; value: string } | null>(null);

  const [usersDevice, setUsersDevice] = useState<number | undefined>();
  const [users, setUsers] = useState<DeviceUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [linking, setLinking] = useState<DeviceUser | null>(null);
  const [linkEmployee, setLinkEmployee] = useState<number | undefined>();

  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    [dayjs().startOf('month'), dayjs().endOf('day')]);
  const [punchEmployee, setPunchEmployee] = useState<number | undefined>();
  const [punchDevice, setPunchDevice] = useState<number | undefined>();
  const [matched, setMatched] = useState<string>('all');
  const [punches, setPunches] = useState<Punch[]>([]);
  const [punchTotal, setPunchTotal] = useState(0);
  const [punchLoading, setPunchLoading] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  const serverUrl = (api.defaults.baseURL || window.location.origin).replace(/\/$/, '');

  const loadDevices = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/attendance/devices');
      const rows: Device[] = res.data || [];
      setDevices(rows);
      if (!usersDevice && rows.length) setUsersDevice(rows[0].id);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الأجهزة');
    } finally { setLoading(false); }
  };

  const loadUsers = async () => {
    if (!usersDevice) { setUsers([]); return; }
    setUsersLoading(true);
    try {
      const res = await api.get(`/api/v1/hr/attendance/devices/${usersDevice}/users`);
      setUsers(res.data || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل مستخدمي الجهاز');
    } finally { setUsersLoading(false); }
  };

  const loadPunches = async () => {
    setPunchLoading(true);
    try {
      const params: any = { limit: 2000 };
      if (range) {
        params.date_from = range[0].format('YYYY-MM-DD');
        params.date_to = range[1].format('YYYY-MM-DD');
      }
      if (punchEmployee) params.employee_id = punchEmployee;
      if (punchDevice) params.device_id = punchDevice;
      if (matched !== 'all') params.matched = matched === 'yes';
      const res = await api.get('/api/v1/hr/attendance/punches', { params });
      setPunches(res.data?.rows || []);
      setPunchTotal(res.data?.total || 0);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل البصمات');
    } finally { setPunchLoading(false); }
  };

  useEffect(() => {
    loadDevices();
    api.get('/api/v1/branches').then((r) => setBranches(r.data || [])).catch(() => undefined);
  }, []);
  useEffect(() => { if (view === 'users') loadUsers(); }, [view, usersDevice]);
  useEffect(() => {
    if (view === 'punches') loadPunches();
  }, [view, range, punchEmployee, punchDevice, matched]);

  const openNew = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ port: 4370, active: true });
    setFormOpen(true);
  };

  const openEdit = (d: Device) => {
    setEditing(d);
    form.resetFields();
    form.setFieldsValue({
      name: d.name, serial: d.serial, ip: d.ip, port: d.port, branch_id: d.branch_id,
      active: d.active,
    });
    setFormOpen(true);
  };

  const saveDevice = async (values: any) => {
    setSaving(true);
    const payload = {
      name: values.name?.trim(), serial: values.serial?.trim() || null,
      ip: values.ip?.trim() || null, port: values.port || 4370,
      branch_id: values.branch_id ?? null,
    };
    try {
      if (editing) {
        await api.patch(`/api/v1/hr/attendance/devices/${editing.id}`,
          { ...payload, active: !!values.active });
        message.success('تم حفظ الجهاز');
      } else {
        const res = await api.post('/api/v1/hr/attendance/devices', payload);
        setToken({ device: payload.name, value: res.data.token });
        message.success('تمت إضافة الجهاز');
      }
      setFormOpen(false);
      loadDevices();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
    } finally { setSaving(false); }
  };

  const showToken = async (d: Device) => {
    try {
      const res = await api.post(`/api/v1/hr/attendance/devices/${d.id}/token`);
      setToken({ device: d.name, value: res.data.token });
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر إنشاء رمز الربط');
    }
  };

  const removeDevice = async (d: Device) => {
    try {
      const res = await api.delete(`/api/v1/hr/attendance/devices/${d.id}`);
      message.success(res.data?.deleted ? 'تم حذف الجهاز' : 'تم إيقاف الجهاز لوجود بصمات مسجّلة');
      setFormOpen(false);
      loadDevices();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحذف');
    }
  };

  const saveLink = async () => {
    if (!linking || !linkEmployee) return;
    try {
      await api.patch(`/api/v1/employees/${linkEmployee}`, { fingerprint_no: linking.user_no });
      message.success('تم ربط الموظف برقم البصمة');
      setLinking(null);
      loadUsers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الربط');
    }
  };

  const reprocess = async () => {
    if (!range) { message.warning('حدّد المدة أولاً'); return; }
    setReprocessing(true);
    try {
      const res = await api.post('/api/v1/hr/attendance/punches/reprocess', {
        date_from: range[0].format('YYYY-MM-DD'),
        date_to: range[1].format('YYYY-MM-DD'),
        device_id: punchDevice ?? null,
      });
      const { updated, skipped } = res.data;
      message.success(`تمت المعالجة: ${updated} يوم محدَّث، ${skipped} يوم متروك`);
      loadPunches();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذرت إعادة المعالجة');
    } finally { setReprocessing(false); }
  };

  const branchName = (id: number | null) => branches.find((b) => b.id === id)?.name || '—';

  const deviceColumns: ColumnsType<Device> = [
    { title: 'الجهاز', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
    { title: 'الرقم التسلسلي', dataIndex: 'serial', render: (v: string | null) => v || '—' },
    { title: 'العنوان', key: 'ip',
      render: (_: any, d) => (d.ip ? `${d.ip}:${d.port}` : '—') },
    { title: 'الفرع', dataIndex: 'branch_id', render: (v: number | null) => branchName(v) },
    { title: 'آخر اتصال', dataIndex: 'last_seen_at', render: fmt },
    { title: 'آخر بصمة', dataIndex: 'last_punch_at', render: fmt },
    { title: 'المستخدمون', dataIndex: 'users_count', render: (v: number | null) => v ?? '—' },
    { title: 'سجل الجهاز', key: 'records', render: (_: any, d) => logUsage(d) },
    { title: 'البصمات المستلمة', key: 'punches',
      render: (_: any, d) => (
        <span>{d.punches.toLocaleString('en')}
          {d.punches > d.matched_punches
            ? <Tag color="red" style={{ marginInlineStart: 6 }}>
                غير مربوطة {(d.punches - d.matched_punches).toLocaleString('en')}</Tag>
            : null}
        </span>
      ) },
    { title: 'الحالة', key: 'state', render: (_: any, d) => deviceState(d) },
    { title: '', key: 'actions', width: 210,
      render: (_: any, d) => (
        <Space size={0}>
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(d)} />
          </Tooltip>
          <Popconfirm
            title="سيُنشأ رمز ربط جديد ويتوقف الرمز السابق. هل تريد المتابعة؟"
            onConfirm={() => showToken(d)}>
            <Button type="link" icon={<KeyOutlined />}>إظهار رمز الربط</Button>
          </Popconfirm>
        </Space>
      ) },
  ];

  const visibleUsers = useMemo(
    () => (onlyUnmatched ? users.filter((u) => !u.employee_id) : users),
    [users, onlyUnmatched]);

  const userColumns: ColumnsType<DeviceUser> = [
    { title: 'رقم البصمة', dataIndex: 'user_no', width: 110, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الاسم على الجهاز', dataIndex: 'name',
      render: (v: string | null, u) => (
        <span>{v || '—'}{u.privilege ? <Tag color="purple" style={{ marginInlineStart: 6 }}>مدير</Tag> : null}
          {!u.on_device ? <Tag style={{ marginInlineStart: 6 }}>غير موجود على الجهاز</Tag> : null}</span>
      ) },
    { title: 'الموظف', key: 'employee',
      render: (_: any, u) => (u.employee_id
        ? <span><b>{u.employee_name}</b> <Tag>{u.employee_code}</Tag></span>
        : <Tag color="red">غير مربوط</Tag>) },
    { title: 'البصمات', dataIndex: 'punches', width: 100 },
    { title: 'غير معالجة', dataIndex: 'unmatched_punches', width: 110,
      render: (v: number) => (v ? <Tag color="orange">{v}</Tag> : '—') },
    { title: 'آخر بصمة', dataIndex: 'last_punch_at', render: fmt },
    { title: '', key: 'link', width: 140,
      render: (_: any, u) => (u.employee_id ? null : (
        <Button type="link" icon={<LinkOutlined />}
          onClick={() => { setLinking(u); setLinkEmployee(undefined); }}>
          ربط بموظف
        </Button>
      )) },
  ];

  const punchColumns: ColumnsType<Punch> = [
    { title: 'الوقت', dataIndex: 'punched_at', width: 150,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD HH:mm:ss') },
    { title: 'الجهاز', dataIndex: 'device_name' },
    { title: 'رقم البصمة', dataIndex: 'user_no', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'الاسم على الجهاز', dataIndex: 'device_user_name', render: (v: string | null) => v || '—' },
    { title: 'الموظف', dataIndex: 'employee_name',
      render: (v: string | null) => (v ? <b>{v}</b> : <Tag color="red">غير مربوط</Tag>) },
    { title: 'النوع', dataIndex: 'status', width: 100,
      render: (v: number) => PUNCH_STATE[v] ?? v },
    { title: 'التحقق', dataIndex: 'verify', width: 100, render: (v: number) => VERIFY[v] ?? v },
    { title: 'المعالجة', dataIndex: 'processed', width: 100,
      render: (v: boolean) => (v ? <Tag color="green">تمت</Tag> : <Tag>معلّقة</Tag>) },
  ];

  const deviceOptions = devices.map((d) => ({ value: d.id, label: d.name }));
  const full = devices.filter((d) => d.records_count && d.records_count
    / (d.records_capacity || 80000) >= 0.9);

  return (
    <div style={{ padding: '8px 6px 12px' }}>
      <Space wrap style={{ marginBottom: 10 }}>
        <Segmented
          value={view} onChange={(v) => setView(v as any)}
          options={[
            { value: 'devices', label: `الأجهزة (${devices.length})` },
            { value: 'users', label: 'مستخدمو الجهاز' },
            { value: 'punches', label: 'سجل البصمات' },
          ]} />
        {view === 'devices' ? (<>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>إضافة جهاز</Button>
          <Button icon={<ReloadOutlined />} onClick={loadDevices}>تحديث</Button>
        </>) : null}
        {view === 'users' ? (<>
          <Select style={{ minWidth: 200 }} placeholder="اختر الجهاز" value={usersDevice}
            onChange={setUsersDevice} options={deviceOptions} />
          <Space>
            <Switch size="small" checked={onlyUnmatched} onChange={setOnlyUnmatched} />
            <span>غير المربوطين فقط</span>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={loadUsers}>تحديث</Button>
        </>) : null}
        {view === 'punches' ? (<>
          <DateRangeFilter value={range as any} onChange={(v) => setRange(v as any)} />
          <Select allowClear showSearch style={{ minWidth: 180 }} placeholder="كل الموظفين"
            value={punchEmployee} onChange={setPunchEmployee}
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
            filterOption={searchFilter} filterSort={searchRank} />
          <Select allowClear style={{ minWidth: 150 }} placeholder="كل الأجهزة"
            value={punchDevice} onChange={setPunchDevice} options={deviceOptions} />
          <Select style={{ minWidth: 130 }} value={matched} onChange={setMatched}
            options={[
              { value: 'all', label: 'الكل' },
              { value: 'yes', label: 'مربوطة' },
              { value: 'no', label: 'غير مربوطة' },
            ]} />
          <Popconfirm title="إعادة احتساب أيام الحضور من البصمات في المدة المحددة؟"
            onConfirm={reprocess}>
            <Button icon={<SyncOutlined />} loading={reprocessing}>إعادة المعالجة</Button>
          </Popconfirm>
          <Button icon={<ReloadOutlined />} onClick={loadPunches}>تحديث</Button>
        </>) : null}
      </Space>

      {view === 'devices' && full.length ? (
        <Alert type="error" showIcon style={{ marginBottom: 10 }}
          message={`سجل ${full.map((d) => d.name).join('، ')} تجاوز ٩٠٪ من سعته`} />
      ) : null}

      {view === 'devices' ? (
        <Table<Device>
          className="sl-table" rowKey="id" size="small" loading={loading}
          columns={deviceColumns} dataSource={devices} pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لا توجد أجهزة بصمة' }}
        />
      ) : null}

      {view === 'users' ? (
        <Table<DeviceUser>
          className="sl-table" rowKey="user_no" size="small" loading={usersLoading}
          columns={userColumns} dataSource={visibleUsers}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لم تصل قائمة المستخدمين من الجهاز بعد' }}
        />
      ) : null}

      {view === 'punches' ? (
        <Table<Punch>
          className="sl-table" rowKey="id" size="small" loading={punchLoading}
          columns={punchColumns} dataSource={punches}
          pagination={{
            defaultPageSize: PAGE_SIZE, showSizeChanger: true,
            showTotal: () => (
              <span className="sl-foot">
                <span>المعروض: <b>{punches.length}</b> من {punchTotal}</span>
              </span>
            ),
          }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لا توجد بصمات في هذه المدة' }}
        />
      ) : null}

      <TabModal
        open={formOpen} onCancel={() => setFormOpen(false)} footer={null} destroyOnHidden
        title={editing ? `تعديل ${editing.name}` : 'إضافة جهاز بصمة'} width={560}
      >
        <Form form={form} layout="vertical" onFinish={saveDevice} requiredMark={false}>
          <Row gutter={10}>
            <Col span={12}>
              <Form.Item name="name" label="اسم الجهاز"
                rules={[{ required: true, message: 'اسم الجهاز مطلوب' }]}>
                <Input autoFocus placeholder="بصمة الفرع الرئيسي" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="serial" label="الرقم التسلسلي">
                <Input placeholder="A8N5184661794" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="ip" label="عنوان IP">
                <Input placeholder="192.168.1.201" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="port" label="المنفذ">
                <InputNumber style={{ width: '100%' }} min={1} max={65535} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="branch_id" label="الفرع">
                <Select allowClear placeholder="كل الفروع"
                  options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              </Form.Item>
            </Col>
            {editing ? (
              <Col span={12}>
                <Form.Item name="active" label="مفعّل" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            ) : null}
          </Row>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button type="primary" htmlType="submit" loading={saving}>حفظ</Button>
            {editing ? (
              <Popconfirm title="هل تريد حذف الجهاز؟" onConfirm={() => removeDevice(editing)}>
                <Button danger>حذف الجهاز</Button>
              </Popconfirm>
            ) : null}
          </Space>
        </Form>
      </TabModal>

      <TabModal
        open={!!token} onCancel={() => setToken(null)} footer={null} destroyOnHidden
        title={`رمز ربط ${token?.device ?? ''}`} width={640}
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="يظهر الرمز مرة واحدة فقط. انسخه الآن." />
        <div style={{ marginBottom: 4 }}>عنوان الخادم</div>
        <Typography.Paragraph copyable={{ text: serverUrl }} code>{serverUrl}</Typography.Paragraph>
        <div style={{ marginBottom: 4 }}>رمز الربط</div>
        <Typography.Paragraph copyable={{ text: token?.value ?? '' }} code
          style={{ wordBreak: 'break-all', direction: 'ltr', textAlign: 'left' }}>
          {token?.value}
        </Typography.Paragraph>
        <ol style={{ paddingInlineStart: 20, margin: 0, lineHeight: 1.9 }}>
          <li>ثبّت Python 3 على الحاسوب المتصل بشبكة جهاز البصمة.</li>
          <li>انسخ مجلد zk_agent إلى الحاسوب ونفّذ فيه: <code>pip install -r requirements.txt</code></li>
          <li>ضع عنوان الخادم ورمز الربط وعنوان الجهاز في الملف <code>config.ini</code>.</li>
          <li>اختبر الاتصال بالجهاز: <code>python zk_agent.py --test</code></li>
          <li>شغّل <code>install_task.bat</code> لتعمل المزامنة تلقائياً كل خمس دقائق.</li>
        </ol>
      </TabModal>

      <TabModal
        open={!!linking} onCancel={() => setLinking(null)} onOk={saveLink}
        okText="ربط" cancelText="إلغاء" okButtonProps={{ disabled: !linkEmployee }}
        title={`ربط رقم البصمة ${linking?.user_no ?? ''}${linking?.name ? ` — ${linking.name}` : ''}`}
        width={480} destroyOnHidden
      >
        <Select showSearch autoFocus style={{ width: '100%' }} placeholder="اختر الموظف"
          value={linkEmployee} onChange={setLinkEmployee}
          options={employees.filter((e) => e.active !== false)
            .map((e) => ({
              value: e.id,
              label: e.fingerprint_no ? `${e.name} (بصمة ${e.fingerprint_no})` : e.name,
            }))}
          filterOption={searchFilter} filterSort={searchRank} />
      </TabModal>
    </div>
  );
}

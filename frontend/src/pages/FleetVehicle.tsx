import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Row, Space, Spin, Table, Tabs, Tag,
} from 'antd';
import {
  ArrowRightOutlined, CarOutlined, PrinterOutlined, ReloadOutlined, SwapOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { TabModal } from '../components/TabModal';
import { InputNumber } from '../components/NumberInput';
import { ListStat } from '../components/ListPage';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { useTabsOptional } from '../components/TabsContext';
import { useLiveRefresh } from '../utils/live';
import { money, num, qty } from '../utils/money';
import { printReport, type PrintColumn } from '../print/reportSheet';
import {
  CHECK, CHECK_FIELDS, DriverSelect, FAULT_STATUS, SEVERITY, VEHICLE_STATUS, d10, km, labelOf, tagOf,
  useFleetLookups,
} from '../components/fleet/fleetShared';

interface Detail {
  vehicle: any; assignments: any[]; maintenance: any[]; fuel: any[]; faults: any[];
  violations: any[]; inspections: any[]; monthly: any[];
}

type Col = PrintColumn<any> & { render?: (r: any) => React.ReactNode };

const COLS: Record<string, Col[]> = {
  maintenance: [
    { title: 'التاريخ', value: (r) => d10(r.record_date) },
    { title: 'العداد', value: (r) => km(r.odometer), numeric: true },
    { title: 'نوع الصيانة', value: 'kind' },
    { title: 'الأعمال المنفذة', value: 'work_done' },
    { title: 'قطع الغيار', value: 'parts' },
    { title: 'التكلفة', value: (r) => money(r.cost), numeric: true },
    { title: 'الورشة/الفني', value: 'workshop' },
    { title: 'الصيانة القادمة (كم)', value: (r) => km(r.next_maintenance_km), numeric: true },
    { title: 'سند المصروف', value: (r) => (r.voucher_reversed ? '' : r.voucher_number || '') },
  ],
  fuel: [
    { title: 'التاريخ', value: (r) => d10(r.record_date) },
    { title: 'السائق', value: 'driver_name' },
    { title: 'العداد', value: (r) => km(r.odometer), numeric: true },
    { title: 'لتر', value: (r) => qty(r.liters), numeric: true },
    { title: 'القيمة', value: (r) => money(r.amount), numeric: true },
    { title: 'المسافة (كم)', value: (r) => km(r.distance), numeric: true },
    { title: 'كم/لتر', value: (r) => (r.km_per_liter ? num(r.km_per_liter, { maximumFractionDigits: 2 }) : ''), numeric: true },
    { title: 'تكلفة الكيلو', value: (r) => (r.cost_per_km ? money(r.cost_per_km) : ''), numeric: true },
    { title: 'المحطة', value: 'station' },
    { title: 'خط السير', value: 'route' },
    { title: 'سند المصروف', value: (r) => (r.voucher_reversed ? '' : r.voucher_number || '') },
  ],
  faults: [
    { title: 'التاريخ', value: (r) => d10(r.record_date) },
    { title: 'السائق', value: 'driver_name' },
    { title: 'العطل', value: (r) => `${r.is_accident ? '(حادثة) ' : ''}${r.description}` },
    { title: 'الخطورة', value: (r) => labelOf(SEVERITY, r.severity), render: (r) => tagOf(SEVERITY, r.severity) },
    { title: 'توقفت؟', value: (r) => (r.stopped ? 'نعم' : 'لا') },
    { title: 'مدة التوقف (يوم)', value: (r) => (r.downtime_days ? qty(r.downtime_days) : ''), numeric: true },
    { title: 'الحالة', value: (r) => labelOf(FAULT_STATUS, r.status), render: (r) => tagOf(FAULT_STATUS, r.status) },
    { title: 'تاريخ الحل', value: (r) => d10(r.resolved_date) },
    { title: 'التكلفة', value: (r) => money(r.cost), numeric: true },
  ],
  violations: [
    { title: 'التاريخ', value: (r) => d10(r.record_date) },
    { title: 'السائق', value: 'driver_name' },
    { title: 'النوع', value: 'kind' },
    { title: 'الوصف', value: 'description' },
    { title: 'القيمة', value: (r) => money(r.amount), numeric: true },
    { title: 'تم السداد؟', value: (r) => (r.paid ? 'نعم' : 'لا'),
      render: (r) => (r.paid ? <Tag color="green">نعم</Tag> : <Tag color="red">لا</Tag>) },
    { title: 'الإجراء الإداري', value: 'admin_action' },
    { title: 'جزاء الرواتب', value: (r) => (r.penalty_number && !r.penalty_cancelled ? r.penalty_number : '') },
  ],
  inspections: [
    { title: 'التاريخ', value: (r) => d10(r.record_date) },
    { title: 'السائق', value: 'driver_name' },
    { title: 'العداد صباحًا', value: (r) => km(r.odometer), numeric: true },
    ...CHECK_FIELDS.map((f) => ({
      title: f.label, value: (r: any) => labelOf(CHECK, r[f.key]), render: (r: any) => tagOf(CHECK, r[f.key]),
    })),
    { title: 'تلفيات/ملاحظات', value: 'damages' },
    { title: 'توقيع السائق', value: (r) => (r.driver_signed ? 'نعم' : 'لا') },
    { title: 'اعتماد المسؤول', value: (r) => r.approved_by || '' },
  ],
  assignments: [
    { title: 'السائق', value: 'driver_name' },
    { title: 'من', value: (r) => d10(r.start_date) },
    { title: 'إلى', value: (r) => d10(r.end_date) || 'حتى الآن', render: (r) => (r.end_date ? d10(r.end_date) : <Tag color="green">حتى الآن</Tag>) },
    { title: 'العداد عند الاستلام', value: (r) => km(r.start_odometer), numeric: true },
    { title: 'العداد عند التسليم', value: (r) => km(r.end_odometer), numeric: true },
    { title: 'المسافة (كم)', value: (r) => km(r.km), numeric: true },
    { title: 'ملاحظات', value: 'notes' },
  ],
  monthly: [
    { title: 'الشهر', value: 'month' },
    { title: 'الكيلومترات', value: (r) => km(r.km), numeric: true },
    { title: 'لترات', value: (r) => qty(r.fuel_liters), numeric: true },
    { title: 'كم/لتر', value: (r) => (r.km_per_liter ? num(r.km_per_liter, { maximumFractionDigits: 2 }) : ''), numeric: true },
    { title: 'الوقود', value: (r) => money(r.fuel_amount), numeric: true },
    { title: 'الصيانة', value: (r) => money(r.maintenance_cost), numeric: true },
    { title: 'الأعطال', value: (r) => money(r.faults_cost), numeric: true },
    { title: 'إجمالي التشغيل', value: (r) => money(r.total), numeric: true },
    { title: 'المخالفات', value: (r) => money(r.violations_amount), numeric: true },
  ],
};

const TAB_LABELS: Record<string, string> = {
  maintenance: 'الصيانة', fuel: 'الوقود', faults: 'الأعطال', violations: 'المخالفات',
  inspections: 'الفحص اليومي', assignments: 'السائقون', monthly: 'التكلفة الشهرية',
};

const cellOf = (c: Col, r: any) => (typeof c.value === 'function' ? c.value(r) : r[c.value as string]);

export default function FleetVehicle() {
  const { vehicleId } = useParams();
  const navigate = useNavigate();
  const tabs = useTabsOptional();
  const { can } = useAuth();
  const { employees } = useFleetLookups();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('fuel');
  const [assignOpen, setAssignOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { setData((await api.get(`/api/v1/fleet/vehicles/${vehicleId}`)).data); } catch { return; } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [vehicleId]);
  useLiveRefresh(['fleet'], load);

  const v = data?.vehicle;
  const rowsOf = (key: string): any[] => (data ? (data as any)[key] || [] : []);

  const doPrint = () => {
    if (!v) return;
    printReport({
      title: `بطاقة السيارة ${v.code} — ${TAB_LABELS[tab]}`,
      meta: [['السيارة', [v.code, v.kind, v.model, v.plate_number].filter(Boolean).join(' — ')],
        ['السائق الحالي', v.driver_name || '-'], ['العداد', km(v.odometer)],
        ['الحالة', labelOf(VEHICLE_STATUS, v.status)]],
    }, COLS[tab], rowsOf(tab));
  };

  const assign = async () => {
    const x = await form.validateFields();
    try {
      await api.post(`/api/v1/fleet/vehicles/${vehicleId}/assign`, {
        employee_id: x.employee_id ?? null, on: x.on ? x.on.format('YYYY-MM-DD') : null,
        odometer: x.odometer ?? null, notes: null,
      });
      setAssignOpen(false); load();
    } catch { return; }
  };

  useScreenShortcuts({ onPrint: doPrint, onClose: () => navigate('/fleet/vehicles') });
  useScreenShortcuts({ onSave: assign, onClose: () => setAssignOpen(false) }, assignOpen);

  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}>{loading ? <Spin /> : <Empty />}</div>;

  const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const fuelD = data.fuel.filter((r) => r.distance && Number(r.liters));
  const kmpl = sum(fuelD, 'liters') ? sum(fuelD, 'distance') / sum(fuelD, 'liters') : null;
  const year = data.monthly;
  const openTab = (path: string) => (tabs ? tabs.openTab(path) : navigate(path));

  const tableOf = (key: string) => (
    <Table className="sl-table" size="small" rowKey={(r: any) => r.id ?? r.month}
      dataSource={rowsOf(key)} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 20 }}
      locale={{ emptyText: 'لا يوجد' }}
      columns={COLS[key].map((c, i) => ({
        key: i, title: c.title, align: c.numeric ? 'left' as const : undefined,
        render: (_: any, r: any) => (c.render ? c.render(r) : cellOf(c, r)),
      }))} />
  );

  const LINK: Record<string, string> = {
    maintenance: '/fleet/maintenance', fuel: '/fleet/fuel', faults: '/fleet/faults',
    violations: '/fleet/violations', inspections: '/fleet/inspections',
  };

  return (
    <div className="list-page">
      <div className="sl-head">
        <div className="sl-title">
          <span className="sl-title-icon"><CarOutlined /></span>
          <div>
            <div className="sl-title-main">
              بطاقة السيارة {v.code} <Tag color={VEHICLE_STATUS[v.status]?.color}>{labelOf(VEHICLE_STATUS, v.status)}</Tag>
              {!v.active && <Tag>موقوفة</Tag>}
            </div>
            <div className="sl-subtitle">{[v.kind, v.model, v.plate_number].filter(Boolean).join(' — ')}</div>
          </div>
        </div>
        <Space className="sl-actions" size={6} wrap>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate('/fleet/vehicles')}>السيارات</Button>
          {can('fleet.write') && (
            <Button icon={<SwapOutlined />} onClick={() => {
              form.setFieldsValue({ employee_id: v.current_driver_id ?? undefined, on: dayjs(), odometer: v.odometer });
              setAssignOpen(true);
            }}>تسليم لسائق</Button>
          )}
          <Button data-shortcut="F7" icon={<PrinterOutlined />} onClick={doPrint}>طباعة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      </div>

      {v.reasons?.length > 0 && (
        <Alert type={v.status === 'stopped' ? 'error' : 'warning'} showIcon style={{ margin: '8px 0' }}
          message={v.reasons.join(' · ')} />
      )}

      <div className="sl-summary">
        <ListStat label="العداد الحالي" value={km(v.odometer)} />
        <ListStat label="باقي على الصيانة (كم)" value={v.km_to_maintenance === null ? '-' : km(v.km_to_maintenance)}
          tone={v.km_to_maintenance !== null && v.km_to_maintenance < 0 ? 'neg' : undefined} />
        <ListStat label="متوسط كم/لتر" value={kmpl ? num(kmpl, { maximumFractionDigits: 2 }) : '-'} />
        <ListStat label="الوقود (آخر ١٢ شهرًا)" value={money(sum(year, 'fuel_amount'))} />
        <ListStat label="الصيانة والأعطال (آخر ١٢ شهرًا)" value={money(sum(year, 'maintenance_cost') + sum(year, 'faults_cost'))} />
        <ListStat label="المخالفات (آخر ١٢ شهرًا)" value={money(sum(year, 'violations_amount'))} tone="warn" />
      </div>

      <Card size="small" style={{ margin: '8px 0' }}>
        <Descriptions size="small" column={{ xs: 1, md: 3, lg: 4 }}>
          <Descriptions.Item label="السائق الحالي">{v.driver_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="آخر صيانة (كم)">{km(v.last_maintenance_km) || '-'}</Descriptions.Item>
          <Descriptions.Item label="الصيانة القادمة (كم)">{km(v.next_maintenance_km) || '-'}</Descriptions.Item>
          <Descriptions.Item label="أعطال مفتوحة">{v.open_faults}</Descriptions.Item>
          <Descriptions.Item label="التأمين حتى">{d10(v.insurance_until) || '-'}</Descriptions.Item>
          <Descriptions.Item label="الرخصة حتى">{d10(v.license_until) || '-'}</Descriptions.Item>
          <Descriptions.Item label="حساب الوقود">{v.fuel_account_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="حساب الصيانة">{v.maintenance_account_name || '-'}</Descriptions.Item>
          {v.notes && <Descriptions.Item label="ملاحظات">{v.notes}</Descriptions.Item>}
        </Descriptions>
      </Card>

      <div className="sl-body">
        <Tabs activeKey={tab} onChange={setTab}
          tabBarExtraContent={LINK[tab] ? (
            <Button size="small" type="link" onClick={() => openTab(`${LINK[tab]}?vehicle=${v.id}`)}>
              فتح شاشة {TAB_LABELS[tab]}
            </Button>
          ) : undefined}
          items={Object.keys(TAB_LABELS).map((k) => ({
            key: k,
            label: `${TAB_LABELS[k]}${k !== 'monthly' ? ` (${rowsOf(k).length})` : ''}`,
            children: tableOf(k),
          }))} />
      </div>

      <TabModal open={assignOpen} onCancel={() => setAssignOpen(false)} onOk={assign}
        title={`تسليم السيارة ${v.code}`} okText="حفظ" cancelText="إلغاء" forceRender width={520}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="employee_id" label="السائق"><DriverSelect employees={employees} /></Form.Item>
          <Row gutter={10}>
            <Col span={12}><Form.Item name="on" label="التاريخ"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="odometer" label="العداد"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        </Form>
      </TabModal>
    </div>
  );
}

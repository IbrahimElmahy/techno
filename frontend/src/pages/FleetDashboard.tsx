import React, { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Form, List, Row, Space, Tag } from 'antd';
import {
  AlertOutlined, CarOutlined, DashboardOutlined, IdcardOutlined, ReloadOutlined, SettingOutlined,
  ToolOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { TabModal } from '../components/TabModal';
import { InputNumber } from '../components/NumberInput';
import { ListStat } from '../components/ListPage';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { useTabsOptional } from '../components/TabsContext';
import { useLiveRefresh } from '../utils/live';
import { money, num, qty } from '../utils/money';
import '../components/fleet/fleet.css';

const ALERT_LINK: Record<string, string> = {
  expiry: '/fleet/vehicles', maintenance: '/fleet/vehicles?status=maintenance_due',
  fault: '/fleet/faults?status=open,in_repair', violation: '/fleet/violations?paid=false',
  driver_license: '/fleet/drivers',
};

export default function FleetDashboard() {
  const navigate = useNavigate();
  const tabs = useTabsOptional();
  const { can } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { setData((await api.get('/api/v1/fleet/dashboard')).data); } catch { return; } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useLiveRefresh(['fleet'], load);

  const open = (path: string) => (tabs ? tabs.openTab(path) : navigate(path));

  const saveCfg = async () => {
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    try { await api.put('/api/v1/fleet/settings', v); } catch { return; }
    setCfgOpen(false); load();
  };
  useScreenShortcuts({ onSave: saveCfg, onClose: () => setCfgOpen(false) }, cfgOpen);

  const d = data || {};
  const tiles: { label: string; value: any; tone?: any; hint?: string; path: string; icon: React.ReactNode }[] = [
    { label: 'إجمالي السيارات', value: num(d.vehicles_total), path: '/fleet/vehicles', icon: <CarOutlined />,
      hint: `جيدة ${num(d.good)} · تحتاج متابعة ${num(d.attention)}` },
    { label: 'سيارات تحتاج صيانة', value: num(d.maintenance_due), tone: d.maintenance_due ? 'warn' : undefined,
      path: '/fleet/vehicles?status=maintenance_due', icon: <ToolOutlined /> },
    { label: 'سيارات متوقفة', value: num(d.stopped), tone: d.stopped ? 'neg' : undefined,
      path: '/fleet/vehicles?status=stopped', icon: <WarningOutlined /> },
    { label: 'إجمالي السائقين', value: num(d.drivers_total), path: '/fleet/drivers', icon: <IdcardOutlined />,
      hint: `نشط ${num(d.drivers_active)}` },
    { label: 'أعطال مفتوحة', value: num((d.faults_open || 0) + (d.faults_in_repair || 0)),
      tone: d.faults_critical ? 'neg' : undefined, path: '/fleet/faults?status=open,in_repair', icon: <WarningOutlined />,
      hint: `مفتوح ${num(d.faults_open)} · قيد الإصلاح ${num(d.faults_in_repair)} · حرج ${num(d.faults_critical)}` },
    { label: 'مخالفات مسجلة', value: num(d.violations_total), path: '/fleet/violations', icon: <AlertOutlined />,
      hint: `غير مسدد ${num(d.violations_unpaid)} — ${money(d.violations_unpaid_amount)}` },
  ];

  return (
    <div className="list-page">
      <div className="sl-head">
        <div className="sl-title">
          <span className="sl-title-icon"><DashboardOutlined /></span>
          <div>
            <div className="sl-title-main">لوحة التحكم <span className="sl-title-muted">(إدارة السيارات)</span></div>
          </div>
        </div>
        <Space className="sl-actions" size={6} wrap>
          <Button size="small" onClick={() => open('/fleet/inspections')}>الفحص اليومي</Button>
          <Button size="small" onClick={() => open('/fleet/tasks')}>مهام مسؤول الأسطول</Button>
          <Button size="small" onClick={() => open('/fleet/monthly')}>التقرير الشهري</Button>
          {can('fleet.write') && (
            <Button icon={<SettingOutlined />} onClick={() => { form.setFieldsValue(d.settings); setCfgOpen(true); }}>
              إعدادات التنبيهات
            </Button>
          )}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>تحديث</Button>
        </Space>
      </div>

      <Row gutter={[10, 10]} style={{ marginTop: 8 }}>
        {tiles.map((t) => (
          <Col key={t.label} xs={12} md={8} xl={4}>
            <Card size="small" hoverable onClick={() => open(t.path)} className="fleet-tile">
              <ListStat label={<>{t.icon} {t.label}</>} value={t.value} tone={t.tone} hint={t.hint} />
            </Card>
          </Col>
        ))}
      </Row>

      <div className="sl-summary" style={{ marginTop: 10 }}>
        <ListStat label="وقود الشهر" value={money(d.month_fuel_amount)} hint={`${qty(d.month_fuel_liters)} لتر`} />
        <ListStat label="صيانة الشهر" value={money(d.month_maintenance_cost)} />
        <ListStat label="أعطال الشهر" value={money(d.month_fault_cost)} />
        <ListStat label="فحص اليوم" value={`${num(d.inspections_today)} من ${num(d.vehicles_total)}`}
          tone={d.vehicles_total && d.inspections_today < d.vehicles_total ? 'warn' : 'pos'} />
        <ListStat label="فحوصات بانتظار الاعتماد" value={num(d.inspections_pending_approval)}
          tone={d.inspections_pending_approval ? 'warn' : undefined} />
      </div>

      <Card size="small" style={{ marginTop: 10 }} title={`التنبيهات (${num(d.alerts?.length || 0)})`}>
        {d.alerts?.length ? (
          <List size="small" dataSource={d.alerts} renderItem={(a: any) => (
            <List.Item style={{ cursor: 'pointer' }}
              onClick={() => (a.vehicle_id && a.kind !== 'driver_license'
                ? navigate(`/fleet/vehicles/${a.vehicle_id}`) : open(ALERT_LINK[a.kind] || '/fleet/vehicles'))}>
              <Space>
                <Tag color={a.level === 'error' ? 'red' : 'orange'}>{a.level === 'error' ? 'عاجل' : 'تنبيه'}</Tag>
                {a.vehicle_code && <b>{a.vehicle_code}</b>}
                <span>{a.message}</span>
              </Space>
            </List.Item>
          )} />
        ) : <Empty description="لا توجد تنبيهات" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Card>

      <TabModal open={cfgOpen} onCancel={() => setCfgOpen(false)} onOk={saveCfg} title="إعدادات التنبيهات"
        okText="حفظ" cancelText="إلغاء" forceRender width={480}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="expiry_alert_days" label="التنبيه قبل انتهاء التأمين والرخصة (يوم)" rules={[{ required: true, message: 'مطلوب' }]}>
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maintenance_alert_km" label="التنبيه قبل موعد الصيانة (كم)" rules={[{ required: true, message: 'مطلوب' }]}>
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="fuel_abnormal_pct" label="نسبة انخفاض كم/لتر عن المعدل المعتاد (٪)" rules={[{ required: true, message: 'مطلوب' }]}>
            <InputNumber min={0} max={100} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </TabModal>
    </div>
  );
}

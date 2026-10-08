import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Input, Table, Tag, message } from 'antd';
import { BarChartOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListPage, { ListStat } from '../components/ListPage';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { useLiveRefresh } from '../utils/live';
import { money, num, qty } from '../utils/money';
import { useFleetColumns, type FleetCol } from '../components/fleet/FleetTable';
import { km } from '../components/fleet/fleetShared';

export default function FleetMonthly() {
  const { can } = useAuth();
  const canWrite = can('fleet.write');
  const navigate = useNavigate();
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf('month'));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/v1/fleet/reports/monthly', { params: { year: month.year(), month: month.month() + 1 } });
      setData(r.data);
      setNotes(Object.fromEntries((r.data.rows || []).map((x: any) => [x.vehicle_id, x.note || ''])));
    } catch { return; } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [month]);
  useLiveRefresh(['fleet'], load);

  const saveNote = async (vehicleId: number) => {
    const row = data?.rows.find((x: any) => x.vehicle_id === vehicleId);
    if ((row?.note || '') === (notes[vehicleId] || '')) return;
    try {
      await api.put('/api/v1/fleet/reports/monthly/note', {
        vehicle_id: vehicleId, year: month.year(), month: month.month() + 1, note: notes[vehicleId] || null,
      });
      if (row) row.note = notes[vehicleId];
      message.success('تم حفظ الملاحظة');
    } catch { return; }
  };

  const rows: any[] = data?.rows || [];
  const cols: FleetCol<any>[] = useMemo(() => [
    { key: 'vehicle', title: 'رقم السيارة', text: (r) => r.vehicle_code,
      render: (r) => <a onClick={() => navigate(`/fleet/vehicles/${r.vehicle_id}`)}><b>{r.vehicle_code}</b></a> },
    { key: 'driver', title: 'السائق', text: (r) => r.driver_name },
    { key: 'm_count', title: 'عدد الصيانات', text: (r) => r.maintenance_count, numeric: true },
    { key: 'm_cost', title: 'إجمالي تكلفة الصيانة', text: (r) => money(r.maintenance_cost), numeric: true },
    { key: 'liters', title: 'إجمالي الوقود (لتر)', text: (r) => qty(r.fuel_liters), numeric: true },
    { key: 'fuel', title: 'إجمالي قيمة الوقود', text: (r) => money(r.fuel_amount), numeric: true },
    { key: 'f_count', title: 'عدد الأعطال', text: (r) => r.faults_count, numeric: true },
    { key: 'f_cost', title: 'تكلفة الأعطال', text: (r) => money(r.faults_cost), numeric: true },
    { key: 'v_count', title: 'عدد المخالفات', text: (r) => r.violations_count, numeric: true },
    { key: 'v_amount', title: 'قيمة المخالفات', text: (r) => money(r.violations_amount), numeric: true },
    { key: 'km', title: 'الكيلومترات', text: (r) => km(r.km), numeric: true },
    { key: 'kmpl', title: 'كم/لتر', numeric: true,
      text: (r) => (r.km_per_liter ? num(r.km_per_liter, { maximumFractionDigits: 2 }) : ''),
      render: (r) => (r.km_per_liter ? (
        <>
          <span style={{ color: r.abnormal_fuel ? '#cf1322' : undefined, fontWeight: r.abnormal_fuel ? 600 : undefined }}>
            {num(r.km_per_liter, { maximumFractionDigits: 2 })}
          </span>
          {r.abnormal_fuel && <Tag color="red" style={{ marginInlineStart: 6 }}>استهلاك غير طبيعي</Tag>}
        </>
      ) : '') },
    { key: 'base', title: 'المعدل المعتاد كم/لتر', numeric: true,
      text: (r) => (r.baseline_km_per_liter ? num(r.baseline_km_per_liter, { maximumFractionDigits: 2 }) : '') },
    { key: 'cpk', title: 'تكلفة الكيلو', text: (r) => (r.cost_per_km ? money(r.cost_per_km) : ''), numeric: true },
    { key: 'total', title: 'إجمالي التشغيل', text: (r) => money(r.total_cost), numeric: true },
    { key: 'note', title: 'ملاحظات الإدارة', text: (r) => notes[r.vehicle_id] ?? r.note ?? '',
      render: (r) => (canWrite ? (
        <Input size="small" style={{ minWidth: 220 }} maxLength={500} value={notes[r.vehicle_id] ?? ''}
          onChange={(e) => setNotes((n) => ({ ...n, [r.vehicle_id]: e.target.value }))}
          onBlur={() => saveNote(r.vehicle_id)} onPressEnter={() => saveNote(r.vehicle_id)} />
      ) : (r.note || '')) },
  ], [notes, canWrite]);

  const table = useFleetColumns<any>('fleet-monthly', cols, rows.map((r) => ({ ...r, id: r.vehicle_id })), {
    name: `التقرير الشهري للأسطول ${month.format('YYYY-MM')}`,
    defaultHidden: ['base'],
  });

  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const abnormal = rows.filter((r) => r.abnormal_fuel);
  const totals = [
    { label: 'عدد السيارات', value: num(rows.length) },
    { label: 'تكلفة الصيانة', value: money(sum('maintenance_cost')) },
    { label: 'الوقود (لتر)', value: qty(sum('fuel_liters')) },
    { label: 'قيمة الوقود', value: money(sum('fuel_amount')) },
    { label: 'تكلفة الأعطال', value: money(sum('faults_cost')) },
    { label: 'المخالفات', value: `${num(sum('violations_count'))} — ${money(sum('violations_amount'))}` },
    { label: 'إجمالي التشغيل', value: money(sum('total_cost')) },
  ];
  const doPrint = () => table.print({
    title: 'التقرير الشهري لأسطول السيارات',
    meta: [['الشهر', month.format('YYYY-MM')],
      ['متوسط الأسطول كم/لتر', data?.fleet_km_per_liter ? String(data.fleet_km_per_liter) : '-']],
  }, totals);

  useScreenShortcuts({ onPrint: doPrint });

  return (
    <ListPage
      icon={<BarChartOutlined />} title="التقرير الشهري"
      actions={<>
        <DatePicker picker="month" value={month} allowClear={false} onChange={(d) => d && setMonth(d.startOf('month'))} />
        <Button data-shortcut="F7" icon={<PrinterOutlined />} onClick={doPrint}>طباعة</Button>
        {table.control}
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>}
      summary={<>
        {totals.map((t) => <ListStat key={t.label} label={t.label} value={t.value} />)}
        <ListStat label="متوسط الأسطول كم/لتر" value={data?.fleet_km_per_liter ? num(data.fleet_km_per_liter, { maximumFractionDigits: 2 }) : '-'} />
      </>}
    >
      {abnormal.length > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 8 }}
          message={`استهلاك وقود غير طبيعي: ${abnormal.map((r) => r.vehicle_code).join('، ')}`} />
      )}
      <Table className="sl-table" rowKey="vehicle_id" size="small" loading={loading}
        dataSource={table.rows} columns={table.columns} scroll={{ x: 'max-content' }} pagination={false}
        locale={{ emptyText: 'لا توجد سيارات' }}
        rowClassName={(r: any) => (r.abnormal_fuel ? 'fleet-row-danger' : '')} />
    </ListPage>
  );
}

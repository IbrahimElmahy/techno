import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, DatePicker, Input, Select, Space, Table, Tag, Tooltip, message,
} from 'antd';
import {
  CheckOutlined, ClearOutlined, DeleteOutlined, EditOutlined, PrinterOutlined, ReloadOutlined,
  SafetyCertificateOutlined, SaveOutlined, SearchOutlined, UndoOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { Popconfirm } from '../components/noConfirm';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { InputNumber } from '../components/NumberInput';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { useQueryTab } from '../components/useQueryTab';
import { useLiveRefresh } from '../utils/live';
import { PAGE_SIZE } from '../utils/pagination';
import { num } from '../utils/money';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { useFleetColumns, type FleetCol } from '../components/fleet/FleetTable';
import { printReport } from '../print/reportSheet';
import {
  CHECK, CHECK_FIELDS, DriverSelect, d10, km, labelOf, optionsOf, tagOf, useFleetLookups,
} from '../components/fleet/fleetShared';

interface GridRow {
  vehicle_id: number; vehicle_code: string; driver_id: number | null; odometer: number | null;
  current_odometer: number; damages: string | null; driver_signed: boolean; existing?: any;
  [k: string]: any;
}

const CHECK_OPTIONS = optionsOf(CHECK);

export default function FleetInspections() {
  const { can } = useAuth();
  const canWrite = can('fleet.write');
  const { vehicles, employees } = useFleetLookups();
  const [tabRaw, setTab] = useQueryTab(canWrite ? 'grid' : 'log');
  const tab = tabRaw === 'log' ? 'log' : 'grid';
  const [day, setDay] = useState<Dayjs>(dayjs());
  const [grid, setGrid] = useState<GridRow[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const searchRef = useRef<any>(null);

  const load = async () => {
    setLoading(true);
    try { setRows((await api.get('/api/v1/fleet/inspections')).data || []); } catch { return; } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useLiveRefresh(['fleet'], load, { enabled: tab === 'log' });

  const buildGrid = (list: any[]) => {
    const key = day.format('YYYY-MM-DD');
    const today = list.filter((r) => d10(r.record_date) === key);
    setGrid(vehicles.filter((v) => v.active || today.some((t) => t.vehicle_id === v.id)).map((v) => {
      const ex = today.find((t) => t.vehicle_id === v.id);
      const g: GridRow = {
        vehicle_id: v.id, vehicle_code: v.code, current_odometer: v.odometer,
        driver_id: ex?.driver_id ?? v.current_driver_id ?? null,
        odometer: ex?.odometer ?? null, damages: ex?.damages ?? null,
        driver_signed: !!ex?.driver_signed, existing: ex,
      };
      CHECK_FIELDS.forEach((f) => { g[f.key] = ex?.[f.key] ?? null; });
      return g;
    }));
  };
  useEffect(() => { buildGrid(rows); }, [vehicles, rows, day]);

  const setCell = (vid: number, patch: Partial<GridRow>) =>
    setGrid((g) => g.map((r) => (r.vehicle_id === vid ? { ...r, ...patch, dirty: true } : r)));

  const allOk = (vid: number) => {
    const patch: any = {};
    CHECK_FIELDS.forEach((f) => { patch[f.key] = 'ok'; });
    setCell(vid, patch);
  };

  const saveGrid = async () => {
    const dirty = grid.filter((r) => r.dirty);
    if (!dirty.length) { message.info('لا توجد تعديلات للحفظ'); return; }
    setSaving(true);
    try {
      const res = await api.post('/api/v1/fleet/inspections/bulk', {
        record_date: day.format('YYYY-MM-DD'),
        rows: dirty.map((r) => {
          const out: any = {
            record_date: day.format('YYYY-MM-DD'), vehicle_id: r.vehicle_id, driver_id: r.driver_id,
            odometer: r.odometer, damages: r.damages || null, driver_signed: r.driver_signed, notes: null,
          };
          CHECK_FIELDS.forEach((f) => { out[f.key] = r[f.key] || null; });
          return out;
        }),
      });
      message.success(`تم الحفظ: ${res.data.created} جديد، ${res.data.updated} تعديل`);
      load();
    } catch { return; } finally { setSaving(false); }
  };

  const approve = async (ids: number[], ok = true) => {
    if (!ids.length) return;
    try {
      await api.post('/api/v1/fleet/inspections/approve', { ids, approve: ok });
      setSelected([]); load();
    } catch { return; }
  };
  const remove = async (r: any) => {
    try { await api.delete(`/api/v1/fleet/inspections/${r.id}`); } catch { return; }
    load();
  };

  const filter = useListFilter(rows, {
    search: (r) => [r.vehicle_code, r.driver_name, r.damages, r.approved_by],
    filters: {
      vehicle_id: (r, v) => r.vehicle_id === v,
      driver_id: (r, v) => r.driver_id === v,
      approved: (r, v) => String(!!r.approved_at) === v,
      bad: (r, v) => String(!!r.has_bad) === v,
    },
    dateOf: (r) => r.record_date,
  });

  const cols: FleetCol<any>[] = useMemo(() => [
    { key: 'date', title: 'التاريخ', text: (r) => d10(r.record_date) },
    { key: 'vehicle', title: 'السيارة', text: (r) => r.vehicle_code, render: (r) => <b>{r.vehicle_code}</b> },
    { key: 'driver', title: 'السائق', text: (r) => r.driver_name },
    { key: 'odometer', title: 'العداد صباحًا', text: (r) => km(r.odometer), numeric: true },
    ...CHECK_FIELDS.map((f) => ({
      key: f.key, title: f.label, text: (r: any) => labelOf(CHECK, r[f.key]), render: (r: any) => tagOf(CHECK, r[f.key]),
    })),
    { key: 'damages', title: 'تلفيات/ملاحظات', text: (r) => r.damages },
    { key: 'signed', title: 'توقيع السائق', text: (r) => (r.driver_signed ? 'نعم' : 'لا') },
    { key: 'approved', title: 'اعتماد المسؤول', text: (r) => r.approved_by || '',
      render: (r) => (r.approved_at
        ? <Tooltip title={String(r.approved_at).replace('T', ' ').slice(0, 16)}><Tag color="green">{r.approved_by}</Tag></Tooltip>
        : <Tag color="orange">بانتظار الاعتماد</Tag>) },
  ], []);

  const table = useFleetColumns<any>('fleet-inspections', cols, filter.filtered, {
    name: 'الفحص اليومي',
    actions: canWrite ? {
      title: '', width: 120,
      render: (_: any, r: any) => (
        <Space size={0}>
          {r.approved_at
            ? <Tooltip title="إلغاء الاعتماد"><Button type="text" icon={<UndoOutlined />} onClick={() => approve([r.id], false)} /></Tooltip>
            : <Tooltip title="اعتماد"><Button type="text" icon={<CheckOutlined />} onClick={() => approve([r.id])} /></Tooltip>}
          <Tooltip title="تعديل">
            <Button type="text" icon={<EditOutlined />} onClick={() => { setDay(dayjs(r.record_date)); setTab('grid'); }} />
          </Tooltip>
          <Popconfirm title="حذف الفحص؟" onConfirm={() => remove(r)}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    } : undefined,
  });

  const doPrint = () => {
    if (tab === 'log') {
      table.print({ title: 'الفحص اليومي' }, [{ label: 'عدد الفحوصات', value: String(filter.filtered.length) }]);
      return;
    }
    printReport(
      { title: 'الفحص اليومي', meta: [['التاريخ', day.format('YYYY-MM-DD')]] },
      [
        { title: 'السيارة', value: 'vehicle_code' },
        { title: 'السائق', value: (r: GridRow) => employees.find((e) => e.id === r.driver_id)?.name || '' },
        { title: 'العداد صباحًا', value: (r: GridRow) => km(r.odometer) },
        ...CHECK_FIELDS.map((f) => ({ title: f.label, value: (r: GridRow) => labelOf(CHECK, r[f.key]) })),
        { title: 'تلفيات/ملاحظات', value: 'damages' },
        { title: 'توقيع السائق', value: () => '' },
        { title: 'اعتماد المسؤول', value: () => '' },
      ], grid);
  };

  useScreenShortcuts({
    onNew: canWrite ? () => { setDay(dayjs()); setTab('grid'); } : undefined,
    onSearch: () => searchRef.current?.focus?.(),
    onSave: tab === 'grid' && canWrite ? saveGrid : undefined,
    onPrint: doPrint,
  });

  const dirtyCount = grid.filter((r) => r.dirty).length;
  const pending = rows.filter((r) => !r.approved_at);
  const multi = (key: string, placeholder: string, options: { value: any; label: string }[]) => {
    const v = filter.values[key];
    return (
      <Select allowClear showSearch mode="multiple" maxTagCount="responsive" placeholder={placeholder}
        value={v === undefined || v === null || v === '' ? undefined : (Array.isArray(v) ? v : [v])}
        onChange={(x) => filter.setValue(key, Array.isArray(x) && !x.length ? undefined : x)}
        options={options} filterOption={searchFilter} filterSort={searchRank} />
    );
  };

  const gridCols = [
    { title: 'السيارة', dataIndex: 'vehicle_code', width: 110, fixed: 'right' as const,
      render: (v: string, r: GridRow) => (
        <Space direction="vertical" size={0}>
          <b>{v}</b>
          {r.existing?.approved_at && <Tag color="green" style={{ marginInlineEnd: 0 }}>معتمد</Tag>}
        </Space>
      ) },
    { title: 'السائق', width: 170,
      render: (_: any, r: GridRow) => (
        <DriverSelect employees={employees} size="small" value={r.driver_id ?? undefined}
          disabled={!canWrite} onChange={(v: number) => setCell(r.vehicle_id, { driver_id: v ?? null })} />
      ) },
    { title: 'العداد صباحًا', width: 120,
      render: (_: any, r: GridRow) => (
        <InputNumber size="small" min={0} precision={0} style={{ width: '100%' }} disabled={!canWrite}
          placeholder={km(r.current_odometer)} value={r.odometer ?? undefined}
          onChange={(v) => setCell(r.vehicle_id, { odometer: v === null || v === undefined ? null : Number(v) })} />
      ) },
    ...CHECK_FIELDS.map((f) => ({
      title: f.label, width: 120,
      render: (_: any, r: GridRow) => (
        <Select size="small" allowClear style={{ width: '100%' }} disabled={!canWrite}
          value={r[f.key] ?? undefined} options={CHECK_OPTIONS}
          className={r[f.key] === 'bad' ? 'fleet-check-bad' : r[f.key] === 'attention' ? 'fleet-check-warn' : undefined}
          onChange={(v) => setCell(r.vehicle_id, { [f.key]: v ?? null })} />
      ),
    })),
    { title: '', width: 90,
      render: (_: any, r: GridRow) => canWrite && (
        <Button size="small" onClick={() => allOk(r.vehicle_id)}>الكل سليم</Button>
      ) },
    { title: 'تلفيات/ملاحظات', width: 200,
      render: (_: any, r: GridRow) => (
        <Input size="small" maxLength={500} value={r.damages ?? ''} disabled={!canWrite}
          onChange={(e) => setCell(r.vehicle_id, { damages: e.target.value })} />
      ) },
    { title: 'توقيع السائق', width: 90,
      render: (_: any, r: GridRow) => (
        <Checkbox checked={r.driver_signed} disabled={!canWrite}
          onChange={(e) => setCell(r.vehicle_id, { driver_signed: e.target.checked })} />
      ) },
  ];

  return (
    <ListPage<'grid' | 'log'>
      icon={<SafetyCertificateOutlined />} title="الفحص اليومي"
      tabs={[
        { key: 'grid', label: 'إدخال اليوم' },
        { key: 'log', label: 'السجل', count: rows.length },
      ]}
      activeTab={tab} onTabChange={setTab}
      actions={tab === 'grid' ? (<>
        <DatePicker value={day} allowClear={false} onChange={(d) => d && setDay(d)} />
        {canWrite && (
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveGrid} data-shortcut="F9">
            حفظ {dirtyCount ? `(${num(dirtyCount)})` : ''}
          </Button>
        )}
        {canWrite && (
          <Button icon={<CheckOutlined />}
            onClick={() => approve(grid.filter((r) => r.existing && !r.existing.approved_at).map((r) => r.existing.id))}>
            اعتماد فحوصات اليوم
          </Button>
        )}
        <Button data-shortcut="F7" icon={<PrinterOutlined />} onClick={doPrint}>طباعة</Button>
      </>) : (<>
        {canWrite && (
          <Button icon={<CheckOutlined />} disabled={!selected.length} onClick={() => approve(selected as number[])}>
            اعتماد المحدد {selected.length ? `(${num(selected.length)})` : ''}
          </Button>
        )}
        <Button data-shortcut="F7" icon={<PrinterOutlined />} onClick={doPrint}>طباعة</Button>
        {table.control}
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      summary={<>
        <ListStat label="تم فحصها في هذا اليوم" value={`${num(grid.filter((r) => r.existing).length)} من ${num(grid.length)}`} />
        <ListStat label="بها بند غير سليم" value={num(grid.filter((r) => CHECK_FIELDS.some((f) => r[f.key] === 'bad')).length)} tone="neg" />
        <ListStat label="بانتظار الاعتماد (الكل)" value={num(pending.length)} tone="warn" />
      </>}
      filters={tab === 'log' ? (<>
        <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
          placeholder="بحث" prefix={<SearchOutlined />} onChange={(e) => filter.setQuery(e.target.value)} />
        {multi('vehicle_id', 'السيارة', vehicles.map((v) => ({ value: v.id, label: v.code })))}
        {multi('driver_id', 'السائق', employees.filter((e) => e.is_driver).map((e) => ({ value: e.id, label: e.name })))}
        {multi('approved', 'الاعتماد', [{ value: 'true', label: 'معتمد' }, { value: 'false', label: 'بانتظار الاعتماد' }])}
        {multi('bad', 'غير سليم', [{ value: 'true', label: 'به بند غير سليم' }, { value: 'false', label: 'الكل سليم' }])}
        <DateRangeFilter value={filter.range} onChange={filter.setRange} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>) : undefined}
    >
      {tab === 'grid' ? (
        <Table className="sl-table fleet-grid" rowKey="vehicle_id" size="small" dataSource={grid}
          columns={gridCols as any} pagination={false} scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'لا توجد سيارات نشطة' }}
          rowClassName={(r: GridRow) => (r.dirty ? 'fleet-row-dirty' : '')} />
      ) : (
        <Table className="sl-table" rowKey="id" size="small" loading={loading}
          dataSource={table.rows} columns={table.columns} scroll={{ x: 'max-content' }}
          rowSelection={canWrite ? { selectedRowKeys: selected, onChange: setSelected } : undefined}
          locale={{ emptyText: 'لا توجد فحوصات' }}
          rowClassName={(r: any) => (r.has_bad ? 'fleet-row-danger' : '')}
          pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }} />
      )}
    </ListPage>
  );
}

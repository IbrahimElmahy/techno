import React, { useEffect, useRef, useState } from 'react';
import {
  Button, Checkbox, Col, DatePicker, Form, Input, Row, Select,
  Space, Table, Tag, Tooltip,
} from 'antd';
import {
  CarryOutOutlined, ClearOutlined, DeleteOutlined, EditOutlined, PlusOutlined, PrinterOutlined,
  ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { Popconfirm } from '../components/noConfirm';
import { TabModal } from '../components/TabModal';
import { InputNumber } from '../components/NumberInput';
import ListPage, { ListStat } from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts } from '../components/keyboard';
import { useAuth } from '../components/AuthProvider';
import { useQueryTab } from '../components/useQueryTab';
import { useLiveRefresh } from '../utils/live';
import { PAGE_SIZE } from '../utils/pagination';
import { num } from '../utils/money';
import { printReport } from '../print/reportSheet';
import { useFleetColumns, type FleetCol } from '../components/fleet/FleetTable';
import { TASK_PERIOD, d10, labelOf, optionsOf, tagOf } from '../components/fleet/fleetShared';

export default function FleetTasks() {
  const { can } = useAuth();
  const canWrite = can('fleet.write');
  const [tabRaw, setTab] = useQueryTab('today');
  const tab = tabRaw === 'log' ? 'log' : 'today';
  const [day, setDay] = useState<Dayjs>(dayjs());
  const [tasks, setTasks] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const searchRef = useRef<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [t, l] = await Promise.all([
        api.get('/api/v1/fleet/tasks', { params: { on: day.format('YYYY-MM-DD') } }),
        api.get('/api/v1/fleet/tasks/log'),
      ]);
      setTasks(t.data || []); setLog(l.data || []);
    } catch { return; } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [day]);
  useLiveRefresh(['fleet'], load);

  const mark = async (t: any, done: boolean) => {
    try {
      await api.post(`/api/v1/fleet/tasks/${t.id}/done`, { on: day.format('YYYY-MM-DD'), done, notes: t.done_notes || null });
    } catch { return; }
    load();
  };
  const saveNote = async (t: any, notes: string) => {
    if (!t.done || (t.done_notes || '') === notes) return;
    try { await api.post(`/api/v1/fleet/tasks/${t.id}/done`, { on: day.format('YYYY-MM-DD'), done: true, notes: notes || null }); } catch { return; }
    load();
  };

  const startCreate = () => {
    if (!canWrite) return;
    setEditing(null); form.resetFields();
    form.setFieldsValue({ period: 'daily', active: true, sort_order: (tasks.length + 1) });
    setOpen(true);
  };
  const startEdit = (t: any) => { setEditing(t); form.resetFields(); form.setFieldsValue(t); setOpen(true); };
  const save = async () => {
    let v: any;
    try { v = await form.validateFields(); } catch { return; }
    try {
      const body = { period: v.period, title: v.title, details: v.details || null, sort_order: v.sort_order || 0, active: v.active !== false };
      if (editing) await api.put(`/api/v1/fleet/tasks/${editing.id}`, body);
      else await api.post('/api/v1/fleet/tasks', body);
    } catch { return; }
    setOpen(false); load();
  };
  const remove = async (t: any) => {
    try { await api.delete(`/api/v1/fleet/tasks/${t.id}`); } catch { return; }
    load();
  };

  const filter = useListFilter(log, {
    search: (r) => [r.title, r.notes, r.done_by],
    filters: { period: (r, v) => r.period === v },
    dateOf: (r) => r.done_date,
  });
  const logCols: FleetCol<any>[] = [
    { key: 'date', title: 'التاريخ', text: (r) => d10(r.done_date) },
    { key: 'period', title: 'الدورية', text: (r) => labelOf(TASK_PERIOD, r.period), render: (r) => tagOf(TASK_PERIOD, r.period) },
    { key: 'key', title: 'الفترة', text: (r) => r.period_key },
    { key: 'title', title: 'المهمة', text: (r) => r.title },
    { key: 'by', title: 'بواسطة', text: (r) => r.done_by },
    { key: 'notes', title: 'ملاحظات', text: (r) => r.notes },
  ];
  const logTable = useFleetColumns<any>('fleet-task-log', logCols, filter.filtered, { name: 'سجل مهام الأسطول' });

  const active = tasks.filter((t) => t.active);
  const doPrint = () => {
    if (tab === 'log') { logTable.print({ title: 'سجل مهام مسؤول الأسطول' }); return; }
    printReport({ title: 'مهام مسؤول الأسطول', meta: [['التاريخ', day.format('YYYY-MM-DD')]] }, [
      { title: 'الدورية', value: (t: any) => labelOf(TASK_PERIOD, t.period) },
      { title: 'المهمة', value: 'title' },
      { title: 'التفاصيل', value: 'details' },
      { title: 'تمت؟', value: (t: any) => (t.done ? `نعم — ${t.done_by || ''}` : '') },
      { title: 'ملاحظات', value: (t: any) => t.done_notes || '' },
    ], active);
  };

  useScreenShortcuts({
    onNew: canWrite ? startCreate : undefined,
    onSearch: () => searchRef.current?.focus?.(),
    onPrint: doPrint,
  });
  useScreenShortcuts({ onSave: save, onClose: () => setOpen(false) }, open);

  const done = active.filter((t) => t.done).length;

  return (
    <>
      <ListPage<'today' | 'log'>
        icon={<CarryOutOutlined />} title="مهام مسؤول الأسطول"
        tabs={[{ key: 'today', label: 'المهام' }, { key: 'log', label: 'السجل', count: log.length }]}
        activeTab={tab} onTabChange={setTab}
        actions={<>
          {tab === 'today' && <DatePicker value={day} allowClear={false} onChange={(d) => d && setDay(d)} />}
          {canWrite && tab === 'today' && <Button data-shortcut="F2" icon={<PlusOutlined />} onClick={startCreate}>مهمة جديدة</Button>}
          <Button data-shortcut="F7" icon={<PrinterOutlined />} onClick={doPrint}>طباعة</Button>
          {tab === 'log' && logTable.control}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>}
        summary={tab === 'today' ? <>
          <ListStat label="المهام" value={num(active.length)} />
          <ListStat label="منجزة" value={num(done)} tone="pos" />
          <ListStat label="متبقية" value={num(active.length - done)} tone={active.length - done ? 'warn' : undefined} />
        </> : undefined}
        filters={tab === 'log' ? <>
          <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query} placeholder="بحث"
            prefix={<SearchOutlined />} onChange={(e) => filter.setQuery(e.target.value)} />
          <Select allowClear mode="multiple" placeholder="الدورية" options={optionsOf(TASK_PERIOD)}
            value={filter.values.period} onChange={(x) => filter.setValue('period', x?.length ? x : undefined)} />
          <DateRangeFilter value={filter.range} onChange={filter.setRange} />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
        </> : undefined}
      >
        {tab === 'today' ? (
          <Table className="sl-table" rowKey="id" size="small" loading={loading} pagination={false}
            dataSource={tasks} rowClassName={(t: any) => (t.active ? '' : 'fleet-row-muted')}
            columns={[
              { title: '', width: 50, render: (_: any, t: any) => (
                <Checkbox checked={t.done} disabled={!canWrite || !t.active} onChange={(e) => mark(t, e.target.checked)} />
              ) },
              { title: 'الدورية', width: 90, render: (_: any, t: any) => tagOf(TASK_PERIOD, t.period) },
              { title: 'المهمة', render: (_: any, t: any) => <b style={{ textDecoration: t.done ? 'line-through' : undefined }}>{t.title}</b> },
              { title: 'التفاصيل', dataIndex: 'details' },
              { title: 'تم التنفيذ', width: 170, render: (_: any, t: any) => (t.done
                ? <Tooltip title={String(t.done_at || '').replace('T', ' ').slice(0, 16)}><Tag color="green">{t.done_by || 'تمت'}</Tag></Tooltip>
                : <Tag>{t.period === 'weekly' ? 'هذا الأسبوع' : t.period === 'monthly' ? 'هذا الشهر' : 'اليوم'}</Tag>) },
              { title: 'ملاحظات', width: 220, render: (_: any, t: any) => (t.done && canWrite
                ? <Input size="small" defaultValue={t.done_notes || ''} key={`${t.id}-${t.done_log_id}`}
                    onBlur={(e) => saveNote(t, e.target.value)} onPressEnter={(e) => saveNote(t, (e.target as HTMLInputElement).value)} />
                : t.done_notes) },
              ...(canWrite ? [{ title: '', width: 90, render: (_: any, t: any) => (
                <Space size={0}>
                  <Button type="text" icon={<EditOutlined />} onClick={() => startEdit(t)} />
                  <Popconfirm title="حذف المهمة؟" onConfirm={() => remove(t)}>
                    <Button type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ) }] : []),
            ]} />
        ) : (
          <Table className="sl-table" rowKey="id" size="small" loading={loading}
            dataSource={logTable.rows} columns={logTable.columns} scroll={{ x: 'max-content' }}
            pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
            locale={{ emptyText: 'لا توجد مهام منجزة' }} />
        )}
      </ListPage>

      <TabModal open={open} onCancel={() => setOpen(false)} onOk={save}
        title={editing ? 'تعديل المهمة' : 'مهمة جديدة'} okText="حفظ" cancelText="إلغاء" forceRender width={560}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Row gutter={10}>
            <Col span={8}><Form.Item name="period" label="الدورية"><Select options={optionsOf(TASK_PERIOD)} /></Form.Item></Col>
            <Col span={16}><Form.Item name="title" label="المهمة" rules={[{ required: true, message: 'اسم المهمة مطلوب' }]}><Input maxLength={160} /></Form.Item></Col>
            <Col span={24}><Form.Item name="details" label="التفاصيل"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={500} /></Form.Item></Col>
            <Col span={8}><Form.Item name="sort_order" label="الترتيب"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="active" label=" " valuePropName="checked"><Checkbox>مفعّلة</Checkbox></Form.Item></Col>
          </Row>
        </Form>
      </TabModal>
    </>
  );
}

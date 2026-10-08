import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank } from '../utils/arabicSort';
import {
  Alert, Button, Col, DatePicker, Form, Input, Row, Select, Space, Table, Tag, Upload, message,
} from 'antd';
import {
  ClockCircleOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined, PrinterOutlined,
  ReloadOutlined, UploadOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { Popconfirm } from '../components/noConfirm';
import { TabModal } from '../components/TabModal';
import { useQueryTab } from '../components/useQueryTab';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';
import ListPage from '../components/ListPage';

/**
 * الحضور والانصراف.
 *
 * Two ways in, and they are deliberately different acts. Typing a day is one person, one date —
 * used for corrections and for the small office that has no device. Importing is a file off the
 * fingerprint machine, and it arrives in two steps: **معاينة** shows what would happen and writes
 * nothing, then **تنفيذ** commits. That is the same shape as the stocktake cycle these people
 * already use, and it exists because the interesting part of an import is never the rows that
 * worked — it is the three identifiers the file has that the payroll does not.
 *
 * Unmatched rows are shown, never counted-and-forgotten. A row dropped in silence is an employee
 * marked absent for the month, and the first anybody hears of it is payroll.
 */

interface Day {
  id: number;
  employee_id: number;
  employee_name: string | null;
  work_date: string;
  status: string;
  check_in: string | null;
  check_out: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  worked_hours: string;
  overtime_hours: string;
  source: string;
  locked: boolean;
  notes: string | null;
}

const STATUS: Record<string, { label: string; color?: string }> = {
  present: { label: 'حاضر', color: 'green' },
  absent: { label: 'غايب', color: 'red' },
  leave: { label: 'أجازة', color: 'blue' },
  holiday: { label: 'عطلة', color: 'purple' },
  weekend: { label: 'راحة' },
  mission: { label: 'مأمورية', color: 'cyan' },
};

/** «٩٠ دقيقة» بتتقري أصعب من «١:٣٠». */
export function minutesLabel(total: number): string {
  if (!total) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} د`;
}

/** بيقرا نص CSV لصفوف. بيتعامل مع الفاصلة المنقوطة كمان — إكسل العربي بيصدّر بيها. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
  // Excel on an Arabic Windows writes `;` as the separator, not `,`. Guessing from the header is
  // more reliable than asking somebody which one their Excel used.
  const sep = (lines[0]?.split(';').length ?? 0) > (lines[0]?.split(',').length ?? 0) ? ';' : ',';
  return lines.map((line) => line.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
}

export default function Attendance() {
  const [tab, setTab] = useQueryTab('days', 'tab');
  const [rows, setRows] = useState<Day[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [employeeId, setEmployeeId] = useState<number | undefined>();

  // إدخال يدوي — بوب أب فوق السجل بدل تبويب لوحده: بيتفتح على يوم جديد أو على سطر من
  // الكشف، ولما يتحفظ السجل اللي وراه بيتحدّث قدّام عينه من غير تنقّل بين تبويبين.
  const [dayForm] = Form.useForm();
  const [dayOpen, setDayOpen] = useState(false);
  const [editingDay, setEditingDay] = useState<Day | null>(null);
  const employeeRef = useRef<any>(null);
  const checkInRef = useRef<any>(null);
  const [saving, setSaving] = useState(false);

  // استيراد
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [filename, setFilename] = useState<string>('');
  const [map, setMap] = useState({ employee: 0, date: 1, time: 2 });
  const [preview, setPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (range) {
        params.date_from = range[0].format('YYYY-MM-DD');
        params.date_to = range[1].format('YYYY-MM-DD');
      }
      if (employeeId) params.employee_id = employeeId;
      const res = await api.get('/api/v1/hr/attendance/days', { params });
      setRows(res.data || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الحضور');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [range, employeeId]);
  useEffect(() => {
    api.get('/api/v1/employees').then((r) => setEmployees(r.data || [])).catch(() => undefined);
  }, []);

  const openNewDay = () => {
    setEditingDay(null);
    dayForm.resetFields();
    // الموظف المختار في فلتر السجل غالباً هو اللي بيتصحّحله — يتملّى بدل ما يتختار تاني.
    dayForm.setFieldsValue({ employee_id: employeeId, work_date: dayjs() });
    setDayOpen(true);
  };

  const saveDay = async (values: any) => {
    setSaving(true);
    try {
      await api.post('/api/v1/hr/attendance/days', {
        employee_id: values.employee_id,
        work_date: (values.work_date || dayjs()).format('YYYY-MM-DD'),
        // فاضية = «من المواعيد»: السيرفر بيحكم (عطلة/راحة/حاضر/غايب) زي الاستيراد بالظبط.
        status: values.status || null,
        check_in: values.check_in?.trim() || null,
        check_out: values.check_out?.trim() || null,
        notes: values.notes?.trim() || null,
      });
      message.success(editingDay ? 'اتعدّل اليوم' : 'تم التسجيل');
      setDayOpen(false);
      load();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      // «مقفول» رسالة ليها خطوة تالية، مش رفض مسدود.
      message.error(detail?.message || 'تعذر الحفظ', detail?.code === 'locked' ? 8 : 3);
    } finally { setSaving(false); }
  };

  const deleteDay = async () => {
    if (!editingDay) return;
    try {
      await api.delete(`/api/v1/hr/attendance/days/${editingDay.id}`);
      message.success('اتشال اليوم');
      setDayOpen(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحذف');
    }
  };

  const readFile = (file: any) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result || ''));
      setCsvRows(parsed);
      setFilename(file.name);
      setPreview(null);
      message.success(`اتقرا ${parsed.length} سطر`);
    };
    reader.readAsText(file, 'utf-8');
    return false; // مفيش رفع للسيرفر — القراية بتحصل هنا
  };

  const body = () => ({
    rows: csvRows, filename,
    employee_column: map.employee, date_column: map.date, time_column: map.time,
  });

  const runPreview = async () => {
    if (!csvRows.length) { message.warning('اختر ملفاً أولاً'); return; }
    try {
      const res = await api.post('/api/v1/hr/attendance/import/preview', body());
      setPreview(res.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر قراءة الملف');
    }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const res = await api.post('/api/v1/hr/attendance/import', body());
      const { created, updated } = res.data;
      message.success(`أُنشئ ${created} يوم، وعُدِّل ${updated}`);
      setPreview(null);
      setCsvRows([]);
      setTab('days');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الاستيراد');
    } finally { setImporting(false); }
  };

  const columns: ColumnsType<Day> = [
    { title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name' },
    { title: 'التاريخ', dataIndex: 'work_date', key: 'work_date', width: 120 },
    { title: 'الحالة', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => <Tag color={STATUS[v]?.color}>{STATUS[v]?.label ?? v}</Tag> },
    { title: 'حضور', dataIndex: 'check_in', key: 'check_in', width: 80,
      render: (v: string | null) => v || '—' },
    { title: 'انصراف', dataIndex: 'check_out', key: 'check_out', width: 80,
      render: (v: string | null) => v || '—' },
    { title: 'تأخير', dataIndex: 'late_minutes', key: 'late_minutes', width: 90,
      render: (v: number) => (v ? <Tag color="orange">{minutesLabel(v)}</Tag> : '—') },
    { title: 'انصراف مبكر', dataIndex: 'early_leave_minutes', key: 'early_leave_minutes',
      width: 110, render: (v: number) => (v ? minutesLabel(v) : '—') },
    { title: 'ساعات', dataIndex: 'worked_hours', key: 'worked_hours', width: 90 },
    { title: 'إضافي', dataIndex: 'overtime_hours', key: 'overtime_hours', width: 90,
      render: (v: string) => (Number(v) ? <Tag color="green">{v}</Tag> : '—') },
    { title: '', key: 'locked', width: 50,
      render: (_: any, r) => (r.locked
        ? <Tag color="default" title="داخل مسير مرحّل">🔒</Tag> : null) },
  ];

  const cols = useTableColumns('attendance-days', columns, {
    locked: ['employee_name'],
    export: { name: 'سجل الحضور والانصراف', rows },
  });

  /** السطر بيفتح اليوم للتعديل — «اليوم ده غلط» أول رد فعل على أي كشف حضور. */
  const openDay = (row: Day) => {
    if (row.locked) {
      message.warning('اليوم ده داخل مسير مرحّل — اعكس المسير الأول.');
      return;
    }
    setEditingDay(row);
    dayForm.resetFields();
    dayForm.setFieldsValue({
      employee_id: row.employee_id,
      work_date: dayjs(row.work_date),
      status: row.status,
      check_in: row.check_in ?? '',
      check_out: row.check_out ?? '',
      notes: row.notes ?? '',
    });
    setDayOpen(true);
  };

  // رابط قديم على `?tab=entry` (كان تبويب) — يفتح البوب أب فوق السجل بدل صفحة فاضية.
  useEffect(() => {
    if (tab === 'entry') { setTab('days'); openNewDay(); }
  }, [tab]);

  // F2 يوم جديد · F9 حفظ · Esc قفل — نفس المفاتيح في كل الشاشات.
  useScreenShortcuts({
    onNew: tab === 'days' && !dayOpen ? openNewDay : undefined,
    onSave: dayOpen ? () => dayForm.submit() : undefined,
    onClose: dayOpen ? () => setDayOpen(false) : undefined,
  });

  // الاختيار من الموظفين الشغّالين بس (القايمة جاية من السيرفر متعزلة بالفرع)؛ والموظف
  // اللي بيتعدّل يومه بيفضل ظاهر باسمه حتى لو اتوقف بعدين.
  const dayEmployees = useMemo(() => {
    const list = employees.filter((e) => e.active !== false);
    if (editingDay && !list.some((e) => e.id === editingDay.employee_id)) {
      list.push({ id: editingDay.employee_id, name: editingDay.employee_name });
    }
    return list;
  }, [employees, editingDay]);

  const kb = useTableKeyboard({ rows, rowKey: (r: Day) => r.id, onOpen: openDay });

  const totals = useMemo(() => ({
    present: rows.filter((r) => r.status === 'present').length,
    absent: rows.filter((r) => r.status === 'absent').length,
    late: rows.filter((r) => r.late_minutes > 0).length,
    overtime: rows.reduce((n, r) => n + Number(r.overtime_hours || 0), 0),
  }), [rows]);

  const csvCols: CsvColumn<Day>[] = [
    { title: 'الموظف', value: 'employee_name' },
    { title: 'التاريخ', value: 'work_date' },
    { title: 'الحالة', value: (r) => STATUS[r.status]?.label ?? r.status },
    { title: 'حضور', value: 'check_in' },
    { title: 'انصراف', value: 'check_out' },
    { title: 'تأخير (دقيقة)', value: 'late_minutes' },
    { title: 'ساعات', value: 'worked_hours' },
    { title: 'إضافي', value: 'overtime_hours' },
  ];

  const printIt = () => printReport(
    { title: 'كشف حضور وانصراف',
      meta: [
        ['من', range ? range[0].format('YYYY/MM/DD') : 'الكل'],
        ['إلى', range ? range[1].format('YYYY/MM/DD') : 'الكل'],
        ['حاضر', String(totals.present)],
        ['غايب', String(totals.absent)],
      ] },
    csvCols as PrintColumn<Day>[], rows,
  );

  const daysTab = (
    <Table
      {...kb.tableProps}
      className="sl-table"
      rowKey="id" size="small" loading={loading}
      columns={cols.columns} dataSource={rows}
      pagination={{
        defaultPageSize: PAGE_SIZE, showSizeChanger: true,
        // ملخّص المدى تحت الجدول بدل الشرايح اللي كانت فوق.
        showTotal: () => (
          <span className="sl-foot">
            <span>أيام: <b>{rows.length}</b></span>
            <span>حاضر: <b className="is-pos">{totals.present}</b></span>
            <span>غايب: <b className="is-neg">{totals.absent}</b></span>
            <span>متأخر: <b>{totals.late}</b></span>
            <span>إضافي: <b>{totals.overtime.toFixed(2)}</b> س</span>
          </span>
        ),
      }}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: 'لا توجد أيام في هذا المدى' }}
    />
  );

  const importTab = (
    <div style={{ padding: '8px 6px 12px' }}>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="ملف جهاز البصمة"
        description={'اختر ملف CSV، واضبط أرقام الأعمدة، ثم «معاينة» — تعرض لك ما سيحدث '
          + 'دون أن تكتب شيئاً. وما لا يتطابق يُعرض بالاسم ولا يُحذف في صمت.'}
      />
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col>
          <Upload beforeUpload={readFile} showUploadList={false} accept=".csv,.txt">
            <Button icon={<UploadOutlined />}>اختيار ملف</Button>
          </Upload>
        </Col>
        {filename ? <Col><Tag color="blue">{filename} · {csvRows.length} سطر</Tag></Col> : null}
      </Row>

      {csvRows.length ? (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          {([['employee', 'عمود الموظف'], ['date', 'عمود التاريخ'], ['time', 'عمود الوقت']] as const)
            .map(([key, label]) => (
              <Col key={key} xs={12} md={6}>
                <div style={{ marginBottom: 4 }}>{label}</div>
                <Select
                  style={{ width: '100%' }} value={(map as any)[key]}
                  onChange={(v) => setMap({ ...map, [key]: v })}
                  options={(csvRows[0] || []).map((head, i) => ({
                    value: i, label: `${i + 1} — ${head || '(بدون عنوان)'}`,
                  }))}
                />
              </Col>
            ))}
          <Col xs={24} md={6} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button onClick={runPreview}>معاينة</Button>
          </Col>
        </Row>
      ) : null}

      {preview ? (
        <>
          <Space wrap style={{ marginBottom: 10 }}>
            <Tag color="green">هيتسجّل {preview.matched.length}</Tag>
            {preview.unmatched.length
              ? <Tag color="red">مش متطابق {preview.unmatched.length}</Tag> : null}
            {preview.locked.length
              ? <Tag color="orange">مقفول {preview.locked.length}</Tag> : null}
            {preview.rejected.length
              ? <Tag color="volcano">سطور مكسورة {preview.rejected.length}</Tag> : null}
          </Space>

          {preview.unmatched.length ? (
            <Alert
              type="warning" showIcon style={{ marginBottom: 10 }}
              message="أسماء/أرقام في الملف غير موجودة في الموظفين"
              description={[...new Set(preview.unmatched.map((u: any) => u.employee_key))]
                .join(' · ')}
            />
          ) : null}

          {preview.rejected.length ? (
            <Alert
              type="error" showIcon style={{ marginBottom: 10 }}
              message="سطور مااتقرتش"
              description={preview.rejected
                .map((r: any) => `سطر ${r.line}: ${r.reason}`).join(' · ')}
            />
          ) : null}

          <Table
            rowKey={(r: any) => `${r.employee_id}-${r.date}`}
            size="small"
            dataSource={preview.matched}
            pagination={{ defaultPageSize: PAGE_SIZE }}
            columns={[
              { title: 'الموظف', dataIndex: 'employee_key' },
              { title: 'التاريخ', dataIndex: 'date' },
              { title: 'حضور', dataIndex: 'check_in' },
              { title: 'انصراف', dataIndex: 'check_out' },
              { title: '', dataIndex: 'existing',
                render: (v: boolean) => (v ? <Tag>هيتعدّل</Tag> : <Tag color="green">جديد</Tag>) },
            ]}
          />
          <Button type="primary" loading={importing} onClick={runImport}
            disabled={!preview.matched.length} style={{ marginTop: 10 }}>
            تنفيذ الاستيراد
          </Button>
        </>
      ) : null}
    </div>
  );

  return (
    <ListPage
      icon={<ClockCircleOutlined />}
      title="الحضور والانصراف"
      subtitle="سجل الأيام، الإدخال اليدوي للتصحيح، واستيراد ملف جهاز البصمة"
      tabs={[
        { key: 'days', label: 'السجل', count: rows.length },
        { key: 'import', label: 'استيراد بصمة' },
      ]}
      activeTab={tab} onTabChange={setTab}
      actions={(<>
        {tab === 'days' ? (<>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNewDay}>
            إدخال حضور موظف
          </Button>
          <Button icon={<PrinterOutlined />} disabled={!rows.length}
            onClick={printIt}>طباعة</Button>
          <Button icon={<DownloadOutlined />} disabled={!rows.length}
            onClick={() => writeCsv('attendance', csvCols, rows)}>تصدير CSV</Button>
          {cols.control}
        </>) : null}
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={tab === 'days' ? (<>
        <DateRangeFilter
          className="sl-f-dates"
          value={range as any} onChange={(v) => setRange(v as any)}
        />
        <Select
          className="sl-f-customer"
          allowClear showSearch
          placeholder="كل الموظفين" value={employeeId} onChange={setEmployeeId}
          options={employees.map((e) => ({ value: e.id, label: e.name }))} filterOption={searchFilter} filterSort={searchRank}/>
      </>) : undefined}
    >
      {tab === 'import' ? importTab : daysTab}

      <TabModal
        open={dayOpen} onCancel={() => setDayOpen(false)} footer={null} destroyOnHidden
        title={editingDay ? 'تعديل يوم حضور' : 'إدخال حضور موظف'} width={560}
        // `autoFocus` جوه بوب أب بيتفتح بحركة مابيمسكش — المؤشر بيتحط بعد ما يخلص فتح:
        // على الموظف في يوم جديد، وعلى الحضور في التعديل (الموظف والتاريخ مقفولين).
        afterOpenChange={(o) => {
          if (o) (editingDay ? checkInRef : employeeRef).current?.focus();
        }}
      >
        <Form form={dayForm} layout="vertical" onFinish={saveDay} requiredMark={false}>
          <Row gutter={10}>
            <Col span={14}>
              {/* الموظف والتاريخ هما مفتاح اليوم — تغييرهم في التعديل كان هيعمل يوم تاني
                  ويسيب القديم زي ما هو، فبيتقفلوا؛ الغلط فيهم = امسح اليوم وسجّله صح. */}
              <Form.Item name="employee_id" label="الموظف"
                rules={[{ required: true, message: 'اختر الموظف' }]}>
                <Select
                  ref={employeeRef} showSearch disabled={!!editingDay}
                  placeholder="اختر الموظف"
                  options={dayEmployees.map((e) => ({ value: e.id, label: e.name }))}
                  filterOption={searchFilter} filterSort={searchRank} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="work_date" label="التاريخ"
                rules={[{ required: true, message: 'اختر التاريخ' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD"
                  disabled={!!editingDay} allowClear={false} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="الحالة">
                <Select
                  allowClear placeholder="من المواعيد"
                  options={Object.entries(STATUS).map(([value, st]) => ({ value, label: st.label }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="check_in" label="الحضور">
                <Input placeholder="08:30" ref={checkInRef} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="check_out" label="الانصراف">
                <Input placeholder="17:00" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="notes" label="ملاحظات"
                extra="الحالة فاضية والحضور فاضي = غياب، إلا لو اليوم عطلة أو راحة.">
                {/* آخر خانة: Enter بيحفظ على طول بدل ما يقف على الزرار ويستنى Enter تاني. */}
                <Input onPressEnter={(e) => { e.preventDefault(); dayForm.submit(); }} />
              </Form.Item>
            </Col>
          </Row>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button type="primary" htmlType="submit" loading={saving}>حفظ (F9)</Button>
            {editingDay ? (
              <Popconfirm title="تشيل اليوم ده؟" onConfirm={deleteDay}>
                <Button danger icon={<DeleteOutlined />}>حذف اليوم</Button>
              </Popconfirm>
            ) : null}
          </Space>
        </Form>
      </TabModal>
    </ListPage>
  );
}

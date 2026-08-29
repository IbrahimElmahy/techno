import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Input, Row, Select, Space, Table, Tabs, Tag, Upload,
  message,
} from 'antd';
import {
  ClockCircleOutlined, DownloadOutlined, PrinterOutlined, ReloadOutlined, UploadOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import { useTableKeyboard } from '../components/keyboard';
import { useQueryTab } from '../components/useQueryTab';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';

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
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().startOf('month'), dayjs(),
  ]);
  const [employeeId, setEmployeeId] = useState<number | undefined>();

  // إدخال يدوي
  const [entry, setEntry] = useState<any>({
    employee_id: undefined, work_date: dayjs(), check_in: '', check_out: '', notes: '',
  });
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

  const saveDay = async () => {
    if (!entry.employee_id) { message.warning('اختر الموظف'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/hr/attendance/days', {
        employee_id: entry.employee_id,
        work_date: entry.work_date.format('YYYY-MM-DD'),
        check_in: entry.check_in || null,
        check_out: entry.check_out || null,
        notes: entry.notes || null,
      });
      message.success('تم التسجيل');
      setEntry({ ...entry, check_in: '', check_out: '', notes: '' });
      load();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      // «مقفول» رسالة ليها خطوة تالية، مش رفض مسدود.
      message.error(detail?.message || 'تعذر الحفظ', detail?.code === 'locked' ? 8 : 3);
    } finally { setSaving(false); }
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

  const cols = useTableColumns('attendance-days', columns, { locked: ['employee_name'] });

  /** السطر بيفتح اليوم للتعديل — «اليوم ده غلط» أول رد فعل على أي كشف حضور. */
  const openDay = (row: Day) => {
    if (row.locked) {
      message.warning('اليوم ده داخل مسير مرحّل — اعكس المسير الأول.');
      return;
    }
    setEntry({
      employee_id: row.employee_id,
      work_date: dayjs(row.work_date),
      check_in: row.check_in ?? '',
      check_out: row.check_out ?? '',
      notes: row.notes ?? '',
    });
    setTab('entry');
  };

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
    <>
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={9}>
          <DateRangeFilter
            value={range as any} onChange={(v) => setRange(v as any)}
          />
        </Col>
        <Col xs={24} md={7}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="كل الموظفين" value={employeeId} onChange={setEmployeeId}
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
          />
        </Col>
        <Col xs={24} md={8}>
          <Space wrap>
            <Tag color="green">حاضر {totals.present}</Tag>
            <Tag color="red">غايب {totals.absent}</Tag>
            <Tag color="orange">متأخر {totals.late}</Tag>
            <Tag color="blue">إضافي {totals.overtime.toFixed(2)} س</Tag>
          </Space>
        </Col>
      </Row>

      <Table
        {...kb.tableProps}
        rowKey="id" size="small" loading={loading}
        columns={cols.columns} dataSource={rows}
        pagination={{ defaultPageSize: 50, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'لا توجد أيام في هذا المدى' }}
      />
    </>
  );

  const entryTab = (
    <Row gutter={[10, 10]} style={{ maxWidth: 720 }}>
      <Col span={12}>
        <div style={{ marginBottom: 4 }}>الموظف *</div>
        <Select
          showSearch optionFilterProp="label" style={{ width: '100%' }}
          value={entry.employee_id}
          onChange={(v) => setEntry({ ...entry, employee_id: v })}
          options={employees.map((e) => ({ value: e.id, label: e.name }))}
        />
      </Col>
      <Col span={12}>
        <div style={{ marginBottom: 4 }}>التاريخ</div>
        <DatePicker
          style={{ width: '100%' }} value={entry.work_date} format="YYYY/MM/DD"
          onChange={(v) => setEntry({ ...entry, work_date: v || dayjs() })}
        />
      </Col>
      <Col span={12}>
        <div style={{ marginBottom: 4 }}>الحضور</div>
        <Input placeholder="08:30" value={entry.check_in}
          onChange={(e) => setEntry({ ...entry, check_in: e.target.value })} />
      </Col>
      <Col span={12}>
        <div style={{ marginBottom: 4 }}>الانصراف</div>
        <Input placeholder="17:00" value={entry.check_out}
          onChange={(e) => setEntry({ ...entry, check_out: e.target.value })}
          onPressEnter={saveDay} />
      </Col>
      <Col span={24}>
        <div style={{ marginBottom: 4 }}>ملاحظات</div>
        <Input value={entry.notes} onChange={(e) => setEntry({ ...entry, notes: e.target.value })} />
      </Col>
      <Col span={24}>
        <Button type="primary" loading={saving} onClick={saveDay}>حفظ اليوم</Button>
        <span style={{ marginInlineStart: 12, color: '#888' }}>
          اتركها فارغة لتسجيل غياب.
        </span>
      </Col>
    </Row>
  );

  const importTab = (
    <>
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
            pagination={{ defaultPageSize: 20 }}
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
    </>
  );

  return (
    <Card
      title={<span><ClockCircleOutlined /> الحضور والانصراف</span>}
      extra={(
        <Space>
          {tab === 'days' ? cols.control : null}
          {tab === 'days' ? (
            <>
              <Button icon={<DownloadOutlined />} disabled={!rows.length}
                onClick={() => writeCsv('attendance', csvCols, rows)}>تصدير CSV</Button>
              <Button icon={<PrinterOutlined />} disabled={!rows.length}
                onClick={printIt}>طباعة</Button>
            </>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      <Tabs
        activeKey={tab} onChange={setTab}
        items={[
          { key: 'days', label: 'السجل', children: daysTab },
          { key: 'entry', label: 'إدخال يوم', children: entryTab },
          { key: 'import', label: 'استيراد بصمة', children: importTab },
        ]}
      />
    </Card>
  );
}

import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Row, Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  CheckCircleOutlined, DollarOutlined, DownloadOutlined, PrinterOutlined, ReloadOutlined,
  RollbackOutlined, SolutionOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useTableKeyboard } from '../components/keyboard';
import { useQueryTab } from '../components/useQueryTab';
import { TabModal } from '../components/TabModal';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, printPayslip } from '../print/reportSheet';

/**
 * مسير الرواتب.
 *
 * The month is computed as a DRAFT first, which touches nothing and can be recomputed all day.
 * «ترحيل» is the separate, deliberate act that writes to the ledger — and from that moment the
 * attendance it read is locked, the advance instalments are consumed, and the tax version it used
 * is frozen. Correcting a posted month is a REVERSAL, never an edit, because the entry underneath
 * it cannot be edited either.
 *
 * «موظفين من غير سجل حضور» is shown, not hidden. They were paid in full — «nobody uploaded the
 * file» is not «absent all month», and the difference is a full salary. But somebody has to know
 * it happened, so it sits on the screen as a number rather than in a log.
 */

interface Run {
  id: number;
  document_number: string;
  year: number;
  month: number;
  status: string;
  posted_at: string | null;
}

interface Line {
  id: number;
  employee_id: number;
  employee_name: string | null;
  basic: string;
  allowances: string;
  overtime_amount: string;
  gross: string;
  days_absent: string;
  absence_deduction: string;
  penalty_amount: string;
  bonus_amount: string;
  insurance_employee: string;
  tax_amount: string;
  advance_deduction: string;
  total_deductions: string;
  net: string;
  has_attendance: boolean;
  paid: boolean;
}

interface RunDetail extends Run {
  gross: string;
  insurance_employee: string;
  insurance_employer: string;
  tax: string;
  advances: string;
  total_deductions: string;
  net: string;
  employees: number;
  without_attendance: number;
  paid: number;
  accrual_entry_id: number | null;
  lines: Line[];
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const STATUS: Record<string, { label: string; color?: string }> = {
  draft: { label: 'مسودة', color: 'orange' },
  posted: { label: 'مرحّل', color: 'green' },
  reversed: { label: 'متعكس', color: 'red' },
};

/** «٢٠٢٦/٠٨» — الشهر زي ما بيتقال. */
export function periodLabel(year: number, month: number): string {
  return `${year}/${String(month).padStart(2, '0')}`;
}

export default function Payroll() {
  const [tab, setTab] = useQueryTab('runs', 'tab');
  const [runs, setRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<Dayjs>(dayjs());

  const [remitOpen, setRemitOpen] = useState(false);
  const [remitForm, setRemitForm] = useState<any>({
    kind: 'insurance', amount: undefined, remit_date: dayjs() as Dayjs,
  });

  const [slip, setSlip] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/hr/payroll/runs');
      setRuns(res.data || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const fail = (err: any, fallback: string) => {
    const detailBody = err?.response?.data?.detail;
    message.error(detailBody?.message || fallback,
      ['locked', 'duplicate'].includes(detailBody?.code) ? 8 : 4);
  };

  const openRun = async (id: number) => {
    setBusy(true);
    try {
      const res = await api.get(`/api/v1/hr/payroll/runs/${id}`);
      setDetail(res.data);
      setTab('detail');
    } catch (err: any) { fail(err, 'تعذر فتح المسير'); } finally { setBusy(false); }
  };

  const compute = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/v1/hr/payroll/runs', {
        year: period.year(), month: period.month() + 1,
      });
      setDetail(res.data);
      setTab('detail');
      message.success(`اتحسب ${res.data.employees} موظف`);
      load();
    } catch (err: any) { fail(err, 'تعذر حساب المسير'); } finally { setBusy(false); }
  };

  const act = async (what: 'post' | 'reverse' | 'pay') => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/v1/hr/payroll/runs/${detail.id}/${what}`,
        what === 'pay' ? {} : undefined);
      if (res.data.skipped) {
        message.info(what === 'post' ? 'المسير مرحّل بالفعل' : 'لا توجد رواتب مستحقة للصرف');
      } else {
        message.success({ post: 'اترحّل', reverse: 'اتعكس', pay: 'اتصرف' }[what]);
      }
      await openRun(detail.id);
      load();
    } catch (err: any) { fail(err, 'تعذر التنفيذ'); } finally { setBusy(false); }
  };

  const openSlip = async (line: Line) => {
    if (!detail) return;
    try {
      const res = await api.get(
        `/api/v1/hr/payroll/runs/${detail.id}/payslip/${line.employee_id}`);
      setSlip({ ...res.data, employee_name: line.employee_name });
    } catch (err: any) { fail(err, 'تعذر فتح القسيمة'); }
  };

  const saveRemit = async () => {
    if (!remitForm.amount) { message.warning('اكتب المبلغ'); return; }
    try {
      await api.post('/api/v1/hr/payroll/remittances', {
        kind: remitForm.kind,
        amount: String(remitForm.amount),
        remit_date: remitForm.remit_date.format('YYYY-MM-DD'),
      });
      message.success('اتسدّد');
      setRemitOpen(false);
    } catch (err: any) { fail(err, 'تعذر السداد'); }
  };

  const runCols: ColumnsType<Run> = [
    { title: 'رقم المسير', dataIndex: 'document_number', key: 'document_number', width: 130 },
    { title: 'الشهر', key: 'period', width: 110,
      render: (_: any, r) => periodLabel(r.year, r.month) },
    { title: 'الحالة', dataIndex: 'status', key: 'status', width: 110,
      render: (v: string) => <Tag color={STATUS[v]?.color}>{STATUS[v]?.label ?? v}</Tag> },
    { title: 'تاريخ الترحيل', dataIndex: 'posted_at', key: 'posted_at',
      render: (v: string | null) => (v ? String(v).slice(0, 10) : '—') },
    { title: '', key: 'actions', width: 90,
      render: (_: any, r) => <Button size="small" onClick={() => openRun(r.id)}>فتح</Button> },
  ];

  const lineCols: ColumnsType<Line> = [
    { title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name',
      render: (v: string | null, r) => (
        <Space size={4}>
          <a onClick={() => openSlip(r)}>{v}</a>
          {!r.has_attendance ? <Tag color="orange">لا يوجد حضور</Tag> : null}
        </Space>
      ) },
    { title: 'الأساسي', dataIndex: 'basic', key: 'basic', width: 110,
      render: (v: string) => money(v) },
    { title: 'بدلات', dataIndex: 'allowances', key: 'allowances', width: 100,
      render: (v: string) => money(v) },
    { title: 'إضافي', dataIndex: 'overtime_amount', key: 'overtime_amount', width: 100,
      render: (v: string) => (Number(v) ? money(v) : '—') },
    { title: 'غياب', dataIndex: 'absence_deduction', key: 'absence_deduction', width: 100,
      render: (v: string) => (Number(v) ? <span style={{ color: '#cf1322' }}>{money(v)}</span> : '—') },
    { title: 'جزاءات', dataIndex: 'penalty_amount', key: 'penalty_amount', width: 100,
      render: (v: string) => (Number(v) ? money(v) : '—') },
    { title: 'الإجمالي', dataIndex: 'gross', key: 'gross', width: 120,
      render: (v: string) => <b>{money(v)}</b> },
    { title: 'تأمينات', dataIndex: 'insurance_employee', key: 'insurance_employee', width: 100,
      render: (v: string) => (Number(v) ? money(v) : '—') },
    { title: 'ضريبة', dataIndex: 'tax_amount', key: 'tax_amount', width: 100,
      render: (v: string) => (Number(v) ? money(v) : '—') },
    { title: 'سلف', dataIndex: 'advance_deduction', key: 'advance_deduction', width: 100,
      render: (v: string) => (Number(v) ? money(v) : '—') },
    { title: 'الصافي', dataIndex: 'net', key: 'net', width: 130,
      render: (v: string) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
    { title: '', dataIndex: 'paid', key: 'paid', width: 80,
      render: (v: boolean) => (v ? <Tag color="green">اتصرف</Tag> : null) },
  ];

  const runTable = useTableColumns('payroll-runs', runCols, {
    locked: ['document_number'],
    export: { name: 'مسيّرات الرواتب', rows: runs },
  });
  const lineTable = useTableColumns('payroll-lines', lineCols, {
    locked: ['employee_name'],
    export: { name: 'مسير الرواتب', rows: detail?.lines ?? [] },
  });

  // السطر في القايمة بيفتح المسير، والسطر جوّه المسير بيفتح قسيمة صاحبه — الخطوة اللي
  // بعد قراية أي سطر مرتب هي «طب ده جه منين».
  const runKb = useTableKeyboard<Run>({
    rows: runs, rowKey: (r) => r.id, onOpen: (r) => openRun(r.id),
  });
  const lineKb = useTableKeyboard<Line>({
    rows: detail?.lines ?? [], rowKey: (r) => r.id, onOpen: openSlip,
  });

  const lineCsv: CsvColumn<Line>[] = [
    { title: 'الموظف', value: 'employee_name' },
    { title: 'الأساسي', value: 'basic' },
    { title: 'بدلات', value: 'allowances' },
    { title: 'إضافي', value: 'overtime_amount' },
    { title: 'غياب', value: 'absence_deduction' },
    { title: 'جزاءات', value: 'penalty_amount' },
    { title: 'الإجمالي', value: 'gross' },
    { title: 'تأمينات', value: 'insurance_employee' },
    { title: 'ضريبة', value: 'tax_amount' },
    { title: 'سلف', value: 'advance_deduction' },
    { title: 'الصافي', value: 'net' },
  ];

  const posted = detail?.status === 'posted';

  return (
    <Card
      title={<span><SolutionOutlined /> مسير الرواتب</span>}
      extra={(
        <Space>
          {tab === 'detail' && detail ? lineTable.control : runTable.control}
          <Button onClick={() => setRemitOpen(true)}>سداد تأمينات / ضريبة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      {tab !== 'detail' || !detail ? (
        <>
          <Space style={{ marginBottom: 12 }}>
            <DatePicker picker="month" format="YYYY/MM" allowClear={false}
              value={period} onChange={(v) => setPeriod(v || dayjs())} />
            <Button type="primary" loading={busy} onClick={compute}>
              حساب مسير الشهر
            </Button>
            <span style={{ color: '#888' }}>
              الحساب بيعمل مسودة — مابيلمسش الأستاذ، وينفع يتعاد.
            </span>
          </Space>
          <Table
            {...runKb.tableProps}
            rowKey="id" size="small" loading={loading}
            columns={runTable.columns} dataSource={runs}
            pagination={{ defaultPageSize: 25 }}
            locale={{ emptyText: 'لا توجد مسيّرات' }}
          />
        </>
      ) : (
        <>
          <Space wrap style={{ marginBottom: 12 }}>
            <Button onClick={() => { setDetail(null); setTab('runs'); }}>رجوع للقايمة</Button>
            <Tag color={STATUS[detail.status]?.color} style={{ fontSize: 14 }}>
              {detail.document_number} · {periodLabel(detail.year, detail.month)} ·
              {' '}{STATUS[detail.status]?.label}
            </Tag>
            {detail.status === 'draft' ? (
              <Popconfirm
                title="ترحّل المسير؟"
                description="سيُكتب قيد في الأستاذ، ويُغلق حضور الشهر. والتصحيح بعد ذلك يكون بالعكس لا بالتعديل."
                okText="ترحيل" cancelText="رجوع"
                onConfirm={() => act('post')}
              >
                <Button type="primary" icon={<CheckCircleOutlined />} loading={busy}>ترحيل</Button>
              </Popconfirm>
            ) : null}
            {posted && detail.paid < detail.employees ? (
              <Popconfirm title="تصرف المرتبات؟"
                description="مدين مرتبات مستحقة / دائن الخزنة."
                okText="صرف" cancelText="رجوع" onConfirm={() => act('pay')}>
                <Button icon={<DollarOutlined />} loading={busy}>صرف المرتبات</Button>
              </Popconfirm>
            ) : null}
            {posted ? (
              <Popconfirm
                title="تعكس المسير؟"
                description="سيُعكس القيد ويعود الشهر مفتوحاً. ويبقى المستند برقمه."
                okText="عكس" cancelText="رجوع" okButtonProps={{ danger: true }}
                onConfirm={() => act('reverse')}
              >
                <Button danger icon={<RollbackOutlined />} loading={busy}>عكس المسير</Button>
              </Popconfirm>
            ) : null}
            <Button icon={<DownloadOutlined />}
              onClick={() => writeCsv(
                `payroll-${detail.year}-${detail.month}`, lineCsv, detail.lines)}>
              تصدير CSV
            </Button>
            <Button icon={<PrinterOutlined />}
              onClick={() => printReport(
                { title: 'مسير الرواتب', number: detail.document_number,
                  meta: [['الشهر', periodLabel(detail.year, detail.month)],
                    ['الحالة', STATUS[detail.status]?.label ?? detail.status]] },
                lineCsv as any, detail.lines,
                [{ label: 'الإجمالي', value: money(detail.gross) },
                  { label: 'الاستقطاعات', value: money(detail.total_deductions) },
                  { label: 'الصافي', value: money(detail.net) }])}>
              طباعة المسير
            </Button>
          </Space>

          {detail.without_attendance ? (
            <Alert
              type="warning" showIcon style={{ marginBottom: 12 }}
              message={`${detail.without_attendance} موظف من غير سجل حضور — اتحسبوا حضور كامل`}
              description={'«لم يُرفع الملف» ليست «غياب الشهر كله». احتُسب لهم راتب كامل عن قصد، '
                + 'لكن يجب أن يعلم أحد بحدوث ذلك قبل الترحيل.'}
            />
          ) : null}

          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col><Card size="small"><Statistic title="عدد الموظفين" value={detail.employees} /></Card></Col>
            <Col><Card size="small"><Statistic title="الإجمالي" value={money(detail.gross)} /></Card></Col>
            <Col><Card size="small"><Statistic title="تأمينات (الموظف)" value={money(detail.insurance_employee)} /></Card></Col>
            <Col><Card size="small"><Statistic title="حصة الشركة" value={money(detail.insurance_employer)} /></Card></Col>
            <Col><Card size="small"><Statistic title="ضريبة" value={money(detail.tax)} /></Card></Col>
            <Col><Card size="small"><Statistic title="سلف" value={money(detail.advances)} /></Card></Col>
            <Col><Card size="small">
              <Statistic title="الصافي" value={money(detail.net)} valueStyle={{ color: '#0B5CA8' }} />
            </Card></Col>
          </Row>

          <Table
            {...lineKb.tableProps}
            rowKey="id" size="small"
            columns={lineTable.columns} dataSource={detail.lines}
            pagination={{ defaultPageSize: 50, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: 'لا توجد سطور' }}
          />
        </>
      )}

      <TabModal
        open={!!slip} width={640} title={`قسيمة راتب — ${slip?.employee_name ?? ''}`}
        onCancel={() => setSlip(null)}
        footer={(
          <Space>
            <Button onClick={() => setSlip(null)}>إغلاق</Button>
            <Button type="primary" icon={<PrinterOutlined />}
              onClick={() => slip && printPayslip(slip)}>طباعة</Button>
          </Space>
        )}
      >
        {slip ? (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="المسير">{slip.run.document_number}</Descriptions.Item>
              <Descriptions.Item label="الشهر">
                {periodLabel(slip.run.year, slip.run.month)}
              </Descriptions.Item>
            </Descriptions>
            <Table
              size="small" pagination={false} rowKey={(_, i) => String(i)}
              dataSource={slip.details}
              columns={[
                { title: 'البند', dataIndex: 'label' },
                { title: 'العدد', dataIndex: 'quantity',
                  render: (v: string | null) => (v ? Number(v) : '—') },
                { title: 'استحقاق', key: 'earning', align: 'left' as const,
                  render: (_: any, d: any) => (d.kind === 'earning'
                    ? <b style={{ color: '#6AB42D' }}>{money(d.amount)}</b> : '') },
                { title: 'استقطاع', key: 'deduction', align: 'left' as const,
                  render: (_: any, d: any) => (d.kind === 'deduction'
                    ? <b style={{ color: '#cf1322' }}>{money(d.amount)}</b> : '') },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}>
                    <b>الصافي</b>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1}>
                    <b style={{ color: '#0B5CA8' }}>{money(slip.line.net)}</b>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </>
        ) : null}
      </TabModal>

      <TabModal
        open={remitOpen} title="سداد تأمينات / ضريبة" onCancel={() => setRemitOpen(false)}
        onOk={saveRemit} okText="سداد" cancelText="إلغاء" destroyOnClose
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="بيقفل الالتزام من الخزنة"
          description="بدونه يكبر الحساب بلا نهاية: يُرحِّل عليه المسيّر كل شهر ولا أحد يقفله."
        />
        <Row gutter={[10, 10]}>
          <Col span={10}>
            <div style={{ marginBottom: 4 }}>النوع</div>
            <Select style={{ width: '100%' }} value={remitForm.kind}
              onChange={(v) => setRemitForm({ ...remitForm, kind: v })}
              options={[
                { value: 'insurance', label: 'تأمينات اجتماعية' },
                { value: 'tax', label: 'ضريبة كسب عمل' },
              ]} />
          </Col>
          <Col span={7}>
            <div style={{ marginBottom: 4 }}>المبلغ *</div>
            <InputNumber style={{ width: '100%' }} min={0.01} value={remitForm.amount}
              onChange={(v) => setRemitForm({ ...remitForm, amount: v })} />
          </Col>
          <Col span={7}>
            <div style={{ marginBottom: 4 }}>التاريخ</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={remitForm.remit_date}
              onChange={(v) => setRemitForm({ ...remitForm, remit_date: v || dayjs() })} />
          </Col>
        </Row>
      </TabModal>
    </Card>
  );
}

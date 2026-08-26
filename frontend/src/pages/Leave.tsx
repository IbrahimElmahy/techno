import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Input, Row, Select, Space, Table, Tabs, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  CalendarOutlined, CheckOutlined, CloseOutlined, DownloadOutlined, PlusOutlined,
  PrinterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useTableKeyboard } from '../components/keyboard';
import { useQueryTab } from '../components/useQueryTab';
import { TabModal } from '../components/TabModal';
import DateRangeFilter from '../components/DateRangeFilter';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';

/**
 * الأجازات — الطلبات والأرصدة والأنواع.
 *
 * The balance column is computed on the server by summing approved requests; there is no `used`
 * field anywhere, here or in the database. That is why the numbers on this screen and the requests
 * underneath them cannot disagree.
 *
 * «معلّقة» opens first on purpose. Everything else on this screen is a record of what already
 * happened; the pending list is the only part that is somebody waiting.
 */

interface LeaveRequestRow {
  id: number;
  document_number: string;
  employee_id: number;
  employee_name: string | null;
  leave_type_id: number;
  leave_type: string | null;
  date_from: string;
  date_to: string;
  days: string;
  reason: string | null;
  status: string;
  reject_reason: string | null;
}

interface BalanceRow {
  employee_id: number;
  employee_name: string;
  leave_type_id: number;
  leave_type: string;
  year: number;
  opening: string;
  entitled: string;
  adjustment: string;
  taken: string;
  remaining: string;
}

const STATUS: Record<string, { label: string; color?: string }> = {
  draft: { label: 'مسودة' },
  submitted: { label: 'مستنية الاعتماد', color: 'orange' },
  approved: { label: 'معتمدة', color: 'green' },
  rejected: { label: 'مرفوضة', color: 'red' },
  cancelled: { label: 'ملغية' },
};

/** الرصيد المتبقي بيتلوّن — الصفر والسالب مش نفس الحاجة. */
export function remainingTone(remaining: string): string | undefined {
  const n = Number(remaining || 0);
  if (n < 0) return 'red';
  if (n === 0) return 'orange';
  return 'green';
}

export default function Leave() {
  const [tab, setTab] = useQueryTab('requests', 'tab');
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState(dayjs().year());
  const [statusFilter, setStatusFilter] = useState<string | undefined>('submitted');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>({
    employee_id: undefined, leave_type_id: undefined,
    range: null as [Dayjs, Dayjs] | null, reason: '',
  });
  const [saving, setSaving] = useState(false);

  const [typeOpen, setTypeOpen] = useState(false);
  const [typeForm, setTypeForm] = useState<any>({
    name: '', annual_quota: 21, paid: true, deducts_salary: false,
    counts_weekend: false, requires_approval: true,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [r, b, t] = await Promise.all([
        api.get('/api/v1/hr/leave/requests',
          { params: statusFilter ? { status: statusFilter } : {} }),
        api.get('/api/v1/hr/leave/balances', { params: { year } }),
        api.get('/api/v1/hr/leave/types'),
      ]);
      setRequests(r.data || []);
      setBalances(b.data || []);
      setTypes(t.data || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [year, statusFilter]);
  useEffect(() => {
    api.get('/api/v1/employees').then((r) => setEmployees(r.data || [])).catch(() => undefined);
  }, []);

  const fail = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail;
    // «مقفول» ليها خطوة تالية — تستاهل وقت أطول على الشاشة.
    message.error(detail?.message || fallback, detail?.code === 'locked' ? 8 : 4);
  };

  const submit = async () => {
    if (!form.employee_id || !form.leave_type_id || !form.range) {
      message.warning('اختار الموظف والنوع والمدة'); return;
    }
    setSaving(true);
    try {
      await api.post('/api/v1/hr/leave/requests', {
        employee_id: form.employee_id,
        leave_type_id: form.leave_type_id,
        date_from: form.range[0].format('YYYY-MM-DD'),
        date_to: form.range[1].format('YYYY-MM-DD'),
        reason: form.reason || null,
      });
      message.success('اتسجّل الطلب');
      setCreating(false);
      load();
    } catch (err: any) { fail(err, 'تعذر تسجيل الطلب'); } finally { setSaving(false); }
  };

  const act = async (row: LeaveRequestRow, what: 'approve' | 'reject' | 'cancel') => {
    try {
      await api.post(`/api/v1/hr/leave/requests/${row.id}/${what}`,
        what === 'reject' ? { reason: null } : undefined);
      message.success({ approve: 'اتعتمد', reject: 'اترفض', cancel: 'اتلغى' }[what]);
      load();
    } catch (err: any) { fail(err, 'تعذر تنفيذ الطلب'); }
  };

  const saveType = async () => {
    if (!typeForm.name.trim()) { message.warning('اكتب اسم النوع'); return; }
    try {
      await api.post('/api/v1/hr/leave/types', {
        ...typeForm, name: typeForm.name.trim(),
        annual_quota: String(typeForm.annual_quota ?? 0),
      });
      message.success('اتضاف');
      setTypeOpen(false);
      setTypeForm({ ...typeForm, name: '' });
      load();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); }
  };

  const requestCols: ColumnsType<LeaveRequestRow> = [
    { title: 'رقم الطلب', dataIndex: 'document_number', key: 'document_number', width: 120 },
    { title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name' },
    { title: 'النوع', dataIndex: 'leave_type', key: 'leave_type', width: 110 },
    { title: 'من', dataIndex: 'date_from', key: 'date_from', width: 110 },
    { title: 'إلى', dataIndex: 'date_to', key: 'date_to', width: 110 },
    { title: 'أيام', dataIndex: 'days', key: 'days', width: 80,
      render: (v: string) => <b>{Number(v)}</b> },
    { title: 'الحالة', dataIndex: 'status', key: 'status', width: 140,
      render: (v: string) => <Tag color={STATUS[v]?.color}>{STATUS[v]?.label ?? v}</Tag> },
    { title: 'السبب', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: '', key: 'actions', width: 190, render: (_: any, r) => (
      <Space size="small">
        {r.status === 'submitted' && (
          <>
            <Button size="small" type="primary" icon={<CheckOutlined />}
              onClick={() => act(r, 'approve')}>اعتماد</Button>
            <Button size="small" danger icon={<CloseOutlined />}
              onClick={() => act(r, 'reject')}>رفض</Button>
          </>
        )}
        {r.status === 'approved' && (
          <Popconfirm
            title="تلغي الأجازة؟"
            description="الأيام هتترفع من كشف الحضور والرصيد هيرجع."
            okText="إلغاء الأجازة" cancelText="رجوع"
            onConfirm={() => act(r, 'cancel')}
          >
            <Button size="small" danger>إلغاء</Button>
          </Popconfirm>
        )}
      </Space>
    ) },
  ];

  const balanceCols: ColumnsType<BalanceRow> = [
    { title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name' },
    { title: 'النوع', dataIndex: 'leave_type', key: 'leave_type', width: 120 },
    { title: 'مرحّل', dataIndex: 'opening', key: 'opening', width: 90,
      render: (v: string) => Number(v) },
    { title: 'مستحق', dataIndex: 'entitled', key: 'entitled', width: 90,
      render: (v: string) => Number(v) },
    { title: 'تسوية', dataIndex: 'adjustment', key: 'adjustment', width: 90,
      render: (v: string) => (Number(v) ? Number(v) : '—') },
    { title: 'مستهلك', dataIndex: 'taken', key: 'taken', width: 90,
      render: (v: string) => Number(v) },
    { title: 'المتبقي', dataIndex: 'remaining', key: 'remaining', width: 110,
      render: (v: string) => <Tag color={remainingTone(v)}>{Number(v)}</Tag> },
  ];

  const reqTable = useTableColumns('leave-requests', requestCols, { locked: ['document_number'] });
  const balTable = useTableColumns('leave-balances', balanceCols, { locked: ['employee_name'] });

  const openRequest = (row: LeaveRequestRow) => {
    if (row.status !== 'submitted') {
      message.info(`الطلب ${STATUS[row.status]?.label ?? row.status}`);
      return;
    }
    act(row, 'approve');
  };
  const kb = useTableKeyboard({
    rows: requests, rowKey: (r: LeaveRequestRow) => r.id, onOpen: openRequest,
  });

  const pending = useMemo(
    () => requests.filter((r) => r.status === 'submitted').length, [requests]);

  const reqCsv: CsvColumn<LeaveRequestRow>[] = [
    { title: 'رقم الطلب', value: 'document_number' },
    { title: 'الموظف', value: 'employee_name' },
    { title: 'النوع', value: 'leave_type' },
    { title: 'من', value: 'date_from' },
    { title: 'إلى', value: 'date_to' },
    { title: 'أيام', value: 'days' },
    { title: 'الحالة', value: (r) => STATUS[r.status]?.label ?? r.status },
  ];

  const balCsv: CsvColumn<BalanceRow>[] = [
    { title: 'الموظف', value: 'employee_name' },
    { title: 'النوع', value: 'leave_type' },
    { title: 'مرحّل', value: 'opening' },
    { title: 'مستحق', value: 'entitled' },
    { title: 'مستهلك', value: 'taken' },
    { title: 'المتبقي', value: 'remaining' },
  ];

  const onBalances = tab === 'balances';

  return (
    <Card
      title={(
        <Space>
          <CalendarOutlined /> الأجازات
          {pending ? <Tag color="orange">{pending} مستنية</Tag> : null}
        </Space>
      )}
      extra={(
        <Space>
          {onBalances ? balTable.control : reqTable.control}
          <Button icon={<DownloadOutlined />}
            onClick={() => (onBalances
              ? writeCsv(`leave-balances-${year}`, balCsv, balances)
              : writeCsv('leave-requests', reqCsv, requests))}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />}
            onClick={() => (onBalances
              ? printReport({ title: 'أرصدة الأجازات', meta: [['السنة', String(year)]] },
                balCsv as PrintColumn<BalanceRow>[], balances)
              : printReport({ title: 'طلبات الأجازات' },
                reqCsv as PrintColumn<LeaveRequestRow>[], requests))}>طباعة</Button>
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
            onClick={() => setCreating(true)}>طلب أجازة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      {!types.length ? (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="لسه مافيش أنواع أجازات"
          description="ابدأ من تبويب «الأنواع» — سنوية، عارضة، مرضية، بدون أجر."
        />
      ) : null}

      <Tabs
        activeKey={tab} onChange={setTab}
        items={[
          {
            key: 'requests',
            label: 'الطلبات',
            children: (
              <>
                <Space style={{ marginBottom: 10 }}>
                  <Select
                    allowClear style={{ width: 180 }} placeholder="كل الحالات"
                    value={statusFilter} onChange={setStatusFilter}
                    options={Object.entries(STATUS)
                      .map(([k, v]) => ({ value: k, label: v.label }))}
                  />
                </Space>
                <Table
                  {...kb.tableProps}
                  rowKey="id" size="small" loading={loading}
                  columns={reqTable.columns} dataSource={requests}
                  pagination={{ defaultPageSize: 25, showSizeChanger: true }}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: 'مافيش طلبات' }}
                />
              </>
            ),
          },
          {
            key: 'balances',
            label: 'الأرصدة',
            children: (
              <>
                <Space style={{ marginBottom: 10 }}>
                  <InputNumber value={year} onChange={(v) => setYear(Number(v) || year)}
                    style={{ width: 110 }} />
                  <span style={{ color: '#888' }}>
                    المستهلك محسوب من الطلبات المعتمدة، مش رقم مخزّن.
                  </span>
                </Space>
                <Table
                  rowKey={(r) => `${r.employee_id}-${r.leave_type_id}`}
                  size="small" loading={loading}
                  columns={balTable.columns} dataSource={balances}
                  pagination={{ defaultPageSize: 50, showSizeChanger: true }}
                  scroll={{ x: 'max-content' }}
                  locale={{ emptyText: 'مافيش أرصدة' }}
                />
              </>
            ),
          },
          {
            key: 'types',
            label: 'الأنواع',
            children: (
              <>
                <Button icon={<PlusOutlined />} onClick={() => setTypeOpen(true)}
                  style={{ marginBottom: 10 }}>نوع جديد</Button>
                <Table
                  rowKey="id" size="small" dataSource={types}
                  pagination={false}
                  columns={[
                    { title: 'الكود', dataIndex: 'code', width: 90 },
                    { title: 'النوع', dataIndex: 'name' },
                    { title: 'الرصيد السنوي', dataIndex: 'annual_quota',
                      render: (v: string) => Number(v) },
                    { title: 'مدفوعة', dataIndex: 'paid',
                      render: (v: boolean) => (v ? <Tag color="green">أيوه</Tag> : <Tag>لأ</Tag>) },
                    { title: 'بتخصم من المرتب', dataIndex: 'deducts_salary',
                      render: (v: boolean) => (v ? <Tag color="red">أيوه</Tag> : '—') },
                    { title: 'بتحسب الجمعة والسبت', dataIndex: 'counts_weekend',
                      render: (v: boolean) => (v ? 'أيوه' : 'لأ') },
                  ]}
                />
              </>
            ),
          },
        ]}
      />

      <TabModal
        open={creating} title="طلب أجازة" onCancel={() => setCreating(false)}
        onOk={submit} confirmLoading={saving} okText="تسجيل" cancelText="إلغاء" destroyOnClose
      >
        <Row gutter={[10, 10]}>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>الموظف *</div>
            <Select showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={form.employee_id}
              onChange={(v) => setForm({ ...form, employee_id: v })}
              options={employees.map((e) => ({ value: e.id, label: e.name }))} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>النوع *</div>
            <Select style={{ width: '100%' }} value={form.leave_type_id}
              onChange={(v) => setForm({ ...form, leave_type_id: v })}
              options={types.map((t) => ({ value: t.id, label: t.name }))} />
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>المدة *</div>
            <DateRangeFilter
              value={form.range} onChange={(v) => setForm({ ...form, range: v })} />
            <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
              الجمعة والسبت والعطلات الرسمية مابيتخصموش من الرصيد.
            </div>
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>السبب</div>
            <Input.TextArea rows={2} value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Col>
        </Row>
      </TabModal>

      <TabModal
        open={typeOpen} title="نوع أجازة جديد" onCancel={() => setTypeOpen(false)}
        onOk={saveType} okText="حفظ" cancelText="إلغاء" destroyOnClose
      >
        <Row gutter={[10, 10]}>
          <Col span={14}>
            <div style={{ marginBottom: 4 }}>الاسم *</div>
            <Input value={typeForm.name} autoFocus
              onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} />
          </Col>
          <Col span={10}>
            <div style={{ marginBottom: 4 }}>الرصيد السنوي</div>
            <InputNumber style={{ width: '100%' }} min={0} value={typeForm.annual_quota}
              onChange={(v) => setTypeForm({ ...typeForm, annual_quota: v })} />
          </Col>
          <Col span={24}>
            <Space direction="vertical">
              <Select style={{ width: 260 }} value={typeForm.paid}
                onChange={(v) => setTypeForm({ ...typeForm, paid: v })}
                options={[{ value: true, label: 'مدفوعة' }, { value: false, label: 'غير مدفوعة' }]} />
              <Select style={{ width: 260 }} value={typeForm.deducts_salary}
                onChange={(v) => setTypeForm({ ...typeForm, deducts_salary: v })}
                options={[
                  { value: false, label: 'مابتخصمش من المرتب' },
                  { value: true, label: 'بتخصم من المرتب' },
                ]} />
              <Select style={{ width: 260 }} value={typeForm.counts_weekend}
                onChange={(v) => setTypeForm({ ...typeForm, counts_weekend: v })}
                options={[
                  { value: false, label: 'أيام الشغل بس' },
                  { value: true, label: 'بتحسب الجمعة والسبت' },
                ]} />
              <Select style={{ width: 260 }} value={typeForm.requires_approval}
                onChange={(v) => setTypeForm({ ...typeForm, requires_approval: v })}
                options={[
                  { value: true, label: 'محتاجة اعتماد' },
                  { value: false, label: 'من غير اعتماد' },
                ]} />
            </Space>
          </Col>
        </Row>
      </TabModal>
    </Card>
  );
}

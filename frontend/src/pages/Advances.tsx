import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Input, Row, Select, Space, Table, Tabs, Tag, message,
} from 'antd';
import { InputNumber } from '../components/NumberInput';
import { Popconfirm } from '../components/noConfirm';
import {
  DownloadOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, WalletOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useTableKeyboard } from '../components/keyboard';
import { useQueryTab } from '../components/useQueryTab';
import { TabModal } from '../components/TabModal';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';

/**
 * السلف والجزاءات.
 *
 * **السلفة أصل، مش مصروف** — she leaves the safe and the employee owes her back, so the entry is
 * DR «سلف العاملين» / CR الخزنة and the payroll credits her away instalment by instalment. The
 * screen says the outstanding rather than the amount, because that is the number anybody asking
 * about an advance actually means.
 *
 * الجزاء والمكافأة نفس الشاشة ونفس الجدول — نفس الشكل بإشارة عكسية. And a penalty can be written
 * in DAYS, which is how it is actually written: «خصم يومين», not a pound figure. The payroll turns
 * it into money at the daily rate of the month it lands in.
 */

interface ScheduleRow { year: number; month: number; amount: string; paid: boolean }

interface Advance {
  id: number;
  document_number: string;
  employee_id: number;
  employee_name: string | null;
  advance_date: string;
  amount: string;
  instalments: number;
  instalment_amount: string;
  status: string;
  taken: string;
  outstanding: string;
  reason: string | null;
  schedule: ScheduleRow[];
}

interface Adjustment {
  id: number;
  document_number: string;
  employee_id: number;
  employee_name: string | null;
  kind: string;
  basis: string;
  quantity: string | null;
  amount: string;
  year: number;
  month: number;
  reason: string | null;
  status: string;
  applied: boolean;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const ADVANCE_STATUS: Record<string, { label: string; color?: string }> = {
  active: { label: 'بتتقسّط', color: 'blue' },
  settled: { label: 'اتسدّدت', color: 'green' },
  cancelled: { label: 'ملغية' },
};

const KIND: Record<string, { label: string; color: string; sign: number }> = {
  penalty: { label: 'جزاء', color: 'red', sign: -1 },
  bonus: { label: 'مكافأة', color: 'green', sign: 1 },
  other_deduction: { label: 'استقطاع', color: 'volcano', sign: -1 },
  other_earning: { label: 'استحقاق', color: 'cyan', sign: 1 },
};

/** «٣ أقساط × ١٠٠٠٫٠٠» — الجملة اللي بتتقال بالفم. */
export function instalmentLabel(count: number, each: string): string {
  return count <= 1 ? 'قسط واحد' : `${count} أقساط × ${money(each)}`;
}

/** الجزاء بالأيام مالوش مبلغ لحد ما المسير يحسبه — والشاشة لازم تقول كده مش تقول صفر. */
export function adjustmentValue(row: Adjustment): string {
  if (row.basis === 'days') return `${Number(row.quantity)} يوم`;
  if (row.basis === 'hours') return `${Number(row.quantity)} ساعة`;
  return money(row.amount);
}

export default function Advances() {
  const [tab, setTab] = useQueryTab('advances', 'tab');
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [employeeId, setEmployeeId] = useState<number | undefined>();

  const [advOpen, setAdvOpen] = useState(false);
  const [advForm, setAdvForm] = useState<any>({
    employee_id: undefined, amount: undefined, advance_date: dayjs() as Dayjs,
    instalments: 1, reason: '',
  });
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState<any>({
    employee_id: undefined, kind: 'penalty', basis: 'amount',
    amount: undefined, quantity: undefined, period: dayjs() as Dayjs, reason: '',
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = employeeId ? { employee_id: employeeId } : {};
      const [a, j] = await Promise.all([
        api.get('/api/v1/hr/advances', { params }),
        api.get('/api/v1/hr/adjustments', { params }),
      ]);
      setAdvances(a.data || []);
      setAdjustments(j.data || []);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر التحميل');
    } finally { setLoading(false); }
  };

  // أي فلتر يتغيّر بيحمّل على طول.
  useEffect(() => { load(); }, [employeeId]);
  useEffect(() => {
    api.get('/api/v1/employees').then((r) => setEmployees(r.data || [])).catch(() => undefined);
  }, []);

  const fail = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail;
    message.error(detail?.message || fallback, detail?.code === 'locked' ? 8 : 4);
  };

  const saveAdvance = async () => {
    if (!advForm.employee_id || !advForm.amount) {
      message.warning('اختار الموظف واكتب المبلغ'); return;
    }
    setSaving(true);
    try {
      await api.post('/api/v1/hr/advances', {
        employee_id: advForm.employee_id,
        amount: String(advForm.amount),
        advance_date: advForm.advance_date.format('YYYY-MM-DD'),
        instalments: advForm.instalments || 1,
        start_year: advForm.advance_date.year(),
        start_month: advForm.advance_date.month() + 1,
        reason: advForm.reason || null,
      });
      message.success('اتصرفت السلفة');
      setAdvOpen(false);
      load();
    } catch (err: any) { fail(err, 'تعذر صرف السلفة'); } finally { setSaving(false); }
  };

  const saveAdjustment = async () => {
    if (!adjForm.employee_id) { message.warning('اختار الموظف'); return; }
    setSaving(true);
    try {
      await api.post('/api/v1/hr/adjustments', {
        employee_id: adjForm.employee_id,
        kind: adjForm.kind,
        basis: adjForm.basis,
        quantity: adjForm.basis === 'amount' ? null : String(adjForm.quantity ?? 0),
        amount: adjForm.basis === 'amount' ? String(adjForm.amount ?? 0) : '0',
        year: adjForm.period.year(),
        month: adjForm.period.month() + 1,
        reason: adjForm.reason || null,
      });
      message.success('اتسجّل');
      setAdjOpen(false);
      load();
    } catch (err: any) { fail(err, 'تعذر الحفظ'); } finally { setSaving(false); }
  };

  const cancel = async (what: 'advances' | 'adjustments', id: number) => {
    try {
      await api.post(`/api/v1/hr/${what}/${id}/cancel`);
      message.success('اتلغى');
      load();
    } catch (err: any) { fail(err, 'تعذر الإلغاء'); }
  };

  const advanceCols: ColumnsType<Advance> = [
    { title: 'رقم السلفة', dataIndex: 'document_number', key: 'document_number', width: 130 },
    { title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name' },
    { title: 'التاريخ', dataIndex: 'advance_date', key: 'advance_date', width: 110 },
    { title: 'المبلغ', dataIndex: 'amount', key: 'amount', width: 110,
      render: (v: string) => money(v) },
    { title: 'التقسيط', key: 'instalments', width: 160,
      render: (_: any, r) => instalmentLabel(r.instalments, r.instalment_amount) },
    { title: 'اتخصم', dataIndex: 'taken', key: 'taken', width: 110,
      render: (v: string) => money(v) },
    // المتبقي هو الرقم اللي أي حد بيسأل عن سلفة بيقصده.
    { title: 'المتبقي', dataIndex: 'outstanding', key: 'outstanding', width: 120,
      render: (v: string) => <b style={{ color: Number(v) ? '#cf1322' : '#6AB42D' }}>{money(v)}</b> },
    { title: 'الحالة', dataIndex: 'status', key: 'status', width: 110,
      render: (v: string) => <Tag color={ADVANCE_STATUS[v]?.color}>{ADVANCE_STATUS[v]?.label ?? v}</Tag> },
    { title: '', key: 'actions', width: 90, render: (_: any, r) => (
      r.status === 'active' && Number(r.taken) === 0 ? (
        <Popconfirm
          title="تلغي السلفة؟"
          description="قيد الصرف هيتعكس والفلوس هترجع للخزنة."
          okText="إلغاء السلفة" cancelText="رجوع" okButtonProps={{ danger: true }}
          onConfirm={() => cancel('advances', r.id)}
        >
          <Button size="small" danger>إلغاء</Button>
        </Popconfirm>
      ) : null
    ) },
  ];

  const adjustmentCols: ColumnsType<Adjustment> = [
    { title: 'الرقم', dataIndex: 'document_number', key: 'document_number', width: 120 },
    { title: 'الموظف', dataIndex: 'employee_name', key: 'employee_name' },
    { title: 'النوع', dataIndex: 'kind', key: 'kind', width: 110,
      render: (v: string) => <Tag color={KIND[v]?.color}>{KIND[v]?.label ?? v}</Tag> },
    { title: 'القيمة', key: 'value', width: 130,
      render: (_: any, r) => adjustmentValue(r) },
    { title: 'الشهر', key: 'period', width: 110,
      render: (_: any, r) => `${r.year}/${String(r.month).padStart(2, '0')}` },
    { title: 'السبب', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: 'الحالة', key: 'status', width: 130,
      render: (_: any, r) => (r.applied
        ? <Tag color="green">اتحسب في المسير</Tag>
        : r.status === 'cancelled' ? <Tag>ملغي</Tag> : <Tag color="orange">مستني المسير</Tag>) },
    { title: '', key: 'actions', width: 90, render: (_: any, r) => (
      !r.applied && r.status !== 'cancelled' ? (
        <Popconfirm title="تلغيه؟" okText="إلغاء" cancelText="رجوع"
          onConfirm={() => cancel('adjustments', r.id)}>
          <Button size="small" danger>إلغاء</Button>
        </Popconfirm>
      ) : null
    ) },
  ];

  const advCols = useTableColumns('hr-advances', advanceCols, { locked: ['document_number'] });
  const adjCols = useTableColumns('hr-adjustments', adjustmentCols, { locked: ['document_number'] });

  const kb = useTableKeyboard({
    rows: advances, rowKey: (r: Advance) => r.id, onOpen: () => undefined,
  });

  const totals = useMemo(() => ({
    outstanding: advances.reduce((n, a) => n + Number(a.outstanding || 0), 0),
    open: advances.filter((a) => a.status === 'active').length,
  }), [advances]);

  const advCsv: CsvColumn<Advance>[] = [
    { title: 'رقم السلفة', value: 'document_number' },
    { title: 'الموظف', value: 'employee_name' },
    { title: 'التاريخ', value: 'advance_date' },
    { title: 'المبلغ', value: 'amount' },
    { title: 'اتخصم', value: 'taken' },
    { title: 'المتبقي', value: 'outstanding' },
  ];

  const adjCsv: CsvColumn<Adjustment>[] = [
    { title: 'الرقم', value: 'document_number' },
    { title: 'الموظف', value: 'employee_name' },
    { title: 'النوع', value: (r) => KIND[r.kind]?.label ?? r.kind },
    { title: 'القيمة', value: (r) => adjustmentValue(r) },
    { title: 'الشهر', value: (r) => `${r.year}/${String(r.month).padStart(2, '0')}` },
    { title: 'السبب', value: 'reason' },
  ];

  const onAdvances = tab === 'advances';

  return (
    <Card
      title={(
        <Space>
          <WalletOutlined /> السلف والجزاءات
          {totals.open
            ? <Tag color="blue">{totals.open} سلفة · متبقي {money(totals.outstanding)}</Tag>
            : null}
        </Space>
      )}
      extra={(
        <Space>
          {onAdvances ? advCols.control : adjCols.control}
          <Button icon={<DownloadOutlined />}
            onClick={() => (onAdvances
              ? writeCsv('advances', advCsv, advances)
              : writeCsv('adjustments', adjCsv, adjustments))}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />}
            onClick={() => (onAdvances
              ? printReport({ title: 'سلف العاملين' },
                advCsv as PrintColumn<Advance>[], advances)
              : printReport({ title: 'الجزاءات والمكافآت' },
                adjCsv as PrintColumn<Adjustment>[], adjustments))}>طباعة</Button>
          <Button data-shortcut="F2" type="primary" icon={<PlusOutlined />}
            onClick={() => (onAdvances ? setAdvOpen(true) : setAdjOpen(true))}>
            {onAdvances ? 'صرف سلفة' : 'جزاء أو مكافأة'}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      <Space style={{ marginBottom: 10 }}>
        <Select
          allowClear showSearch optionFilterProp="label" style={{ width: 260 }}
          placeholder="كل الموظفين" value={employeeId} onChange={setEmployeeId}
          options={employees.map((e) => ({ value: e.id, label: e.name }))}
        />
      </Space>

      <Tabs
        activeKey={tab} onChange={setTab}
        items={[
          {
            key: 'advances',
            label: 'السلف',
            children: (
              <Table
                {...kb.tableProps}
                rowKey="id" size="small" loading={loading}
                columns={advCols.columns} dataSource={advances}
                pagination={{ defaultPageSize: 25, showSizeChanger: true }}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: 'مافيش سلف' }}
                // جدول الأقساط تحت السلفة — «هيتخصم مني كام الشهر الجاي» سؤال بيتسأل
                // ساعة الاستلاف، والإجابة مكانها هنا مش في شاشة تانية.
                expandable={{
                  expandedRowRender: (r: Advance) => (
                    <Table
                      size="small" pagination={false} rowKey={(p) => `${p.year}-${p.month}`}
                      dataSource={r.schedule}
                      columns={[
                        { title: 'الشهر', key: 'period', width: 120,
                          render: (_: any, p: ScheduleRow) =>
                            `${p.year}/${String(p.month).padStart(2, '0')}` },
                        { title: 'القسط', dataIndex: 'amount', width: 140,
                          render: (v: string) => money(v) },
                        { title: '', dataIndex: 'paid',
                          render: (v: boolean) => (v
                            ? <Tag color="green">اتخصم</Tag>
                            : <Tag color="orange">لسه</Tag>) },
                      ]}
                    />
                  ),
                }}
              />
            ),
          },
          {
            key: 'adjustments',
            label: 'الجزاءات والمكافآت',
            children: (
              <Table
                rowKey="id" size="small" loading={loading}
                columns={adjCols.columns} dataSource={adjustments}
                pagination={{ defaultPageSize: 25, showSizeChanger: true }}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: 'مافيش جزاءات ولا مكافآت' }}
              />
            ),
          },
        ]}
      />

      <TabModal
        open={advOpen} title="صرف سلفة" onCancel={() => setAdvOpen(false)}
        onOk={saveAdvance} confirmLoading={saving} okText="صرف" cancelText="إلغاء" destroyOnClose
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="السلفة أصل مش مصروف"
          description="بتتقيد مدين «سلف العاملين» ودائن الخزنة، والمرتب بيسدّدها قسط بقسط."
        />
        <Row gutter={[10, 10]}>
          <Col span={14}>
            <div style={{ marginBottom: 4 }}>الموظف *</div>
            <Select showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={advForm.employee_id}
              onChange={(v) => setAdvForm({ ...advForm, employee_id: v })}
              options={employees.map((e) => ({ value: e.id, label: e.name }))} />
          </Col>
          <Col span={10}>
            <div style={{ marginBottom: 4 }}>التاريخ</div>
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" allowClear={false}
              value={advForm.advance_date}
              onChange={(v) => setAdvForm({ ...advForm, advance_date: v || dayjs() })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>المبلغ *</div>
            <InputNumber style={{ width: '100%' }} min={0.01} value={advForm.amount}
              onChange={(v) => setAdvForm({ ...advForm, amount: v })} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>عدد الأقساط</div>
            <InputNumber style={{ width: '100%' }} min={1} max={60}
              value={advForm.instalments}
              onChange={(v) => setAdvForm({ ...advForm, instalments: v })} />
            {advForm.amount && advForm.instalments > 1 ? (
              <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                ≈ {money(Number(advForm.amount) / advForm.instalments)} في الشهر
              </div>
            ) : null}
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>السبب</div>
            <Input value={advForm.reason}
              onChange={(e) => setAdvForm({ ...advForm, reason: e.target.value })} />
          </Col>
        </Row>
      </TabModal>

      <TabModal
        open={adjOpen} title="جزاء أو مكافأة" onCancel={() => setAdjOpen(false)}
        onOk={saveAdjustment} confirmLoading={saving} okText="حفظ" cancelText="إلغاء"
        destroyOnClose
      >
        <Row gutter={[10, 10]}>
          <Col span={14}>
            <div style={{ marginBottom: 4 }}>الموظف *</div>
            <Select showSearch optionFilterProp="label" style={{ width: '100%' }}
              value={adjForm.employee_id}
              onChange={(v) => setAdjForm({ ...adjForm, employee_id: v })}
              options={employees.map((e) => ({ value: e.id, label: e.name }))} />
          </Col>
          <Col span={10}>
            <div style={{ marginBottom: 4 }}>شهر المسير</div>
            <DatePicker picker="month" style={{ width: '100%' }} format="YYYY/MM"
              allowClear={false} value={adjForm.period}
              onChange={(v) => setAdjForm({ ...adjForm, period: v || dayjs() })} />
            <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
              الشهر اللي هينزل فيه — جزاء عن الشهر اللي فات بينزل في المسير المفتوح.
            </div>
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>النوع</div>
            <Select style={{ width: '100%' }} value={adjForm.kind}
              onChange={(v) => setAdjForm({ ...adjForm, kind: v })}
              options={Object.entries(KIND).map(([k, v]) => ({ value: k, label: v.label }))} />
          </Col>
          <Col span={12}>
            <div style={{ marginBottom: 4 }}>الأساس</div>
            <Select style={{ width: '100%' }} value={adjForm.basis}
              onChange={(v) => setAdjForm({ ...adjForm, basis: v })}
              options={[
                { value: 'amount', label: 'مبلغ' },
                { value: 'days', label: 'أيام' },
                { value: 'hours', label: 'ساعات' },
              ]} />
          </Col>
          <Col span={12}>
            {adjForm.basis === 'amount' ? (
              <>
                <div style={{ marginBottom: 4 }}>المبلغ *</div>
                <InputNumber style={{ width: '100%' }} min={0.01} value={adjForm.amount}
                  onChange={(v) => setAdjForm({ ...adjForm, amount: v })} />
              </>
            ) : (
              <>
                <div style={{ marginBottom: 4 }}>
                  {adjForm.basis === 'days' ? 'عدد الأيام *' : 'عدد الساعات *'}
                </div>
                <InputNumber style={{ width: '100%' }} min={0.5} step={0.5}
                  value={adjForm.quantity}
                  onChange={(v) => setAdjForm({ ...adjForm, quantity: v })} />
                <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                  المسير بيحوّلها لفلوس بأجر يوم الشهر ده.
                </div>
              </>
            )}
          </Col>
          <Col span={24}>
            <div style={{ marginBottom: 4 }}>السبب</div>
            <Input value={adjForm.reason}
              onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} />
          </Col>
        </Row>
      </TabModal>
    </Card>
  );
}

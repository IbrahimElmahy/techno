import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Row, Segmented, Statistic, Switch, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import { useQueryTab } from '../components/useQueryTab';
import { useTableKeyboard } from '../components/keyboard';
import TabModal from '../components/TabModal';
import { textColumn, numberColumn } from '../components/gridColumns';
import { columnsFromTable, exportCsv as writeCsv } from '../utils/exportCsv';
import { printReport, type PrintColumn, type PrintTotal } from '../print/reportSheet';

type Dimension = 'cost_center' | 'branch';

interface Row {
  key: number | null; label: string; lines: number;
  income: string; expenses: string; profit: string;
  margin_pct: string | null; unassigned: boolean;
}
interface Totals {
  rows: number; income: string; expenses: string; profit: string;
  margin_pct: string | null; unassigned_lines: number;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export interface ProfitabilityView { label: string; dimension: Dimension }

export const REPORT_VIEWS: Record<string, ProfitabilityView> = {
  'cost-centers': { label: 'أرباح مراكز التكلفة', dimension: 'cost_center' },
  'branches': { label: 'مقارنة الفروع', dimension: 'branch' },
};

export default function Profitability() {
  const [viewKey] = useQueryTab('', 'view');
  const view = REPORT_VIEWS[viewKey];

  const [dimension, setDimension] = useState<Dimension>(view?.dimension ?? 'cost_center');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    [dayjs().startOf('year'), dayjs()]);
  const [includeUnassigned, setIncludeUnassigned] = useState(true);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);

  const [openRow, setOpenRow] = useState<Row | null>(null);
  const [breakdown, setBreakdown] = useState<any | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  useEffect(() => {
    if (!view) return;
    setDimension(view.dimension);
  }, [viewKey]);

  const params = useMemo(() => {
    const p: any = { dimension, include_unassigned: includeUnassigned };
    if (range) {
      p.date_from = range[0].format('YYYY-MM-DD');
      p.date_to = range[1].format('YYYY-MM-DD');
    }
    return p;
  }, [dimension, range, includeUnassigned]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/profitability', { params });
      setRows(res.data.rows || []);
      setTotals(res.data.totals || null);
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [params]);

  const openBreakdown = async (row: Row) => {
    setOpenRow(row); setBreakdown(null); setBreakdownLoading(true);
    try {
      const res = await api.get('/api/v1/reports/profitability/breakdown', {
        params: { ...params, key: row.key ?? undefined },
      });
      setBreakdown(res.data);
    } catch (err) {
      console.error(err);
    } finally { setBreakdownLoading(false); }
  };

  const rowKeyOf = (r: Row) => `d-${r.key ?? 'none'}`;
  const kb = useTableKeyboard<Row>({ rows, rowKey: rowKeyOf, onOpen: openBreakdown });

  const columns: any[] = [
    { title: dimension === 'cost_center' ? 'مركز التكلفة' : 'الفرع', dataIndex: 'label',
      ...textColumn(rows, (r: Row) => r.label),
      render: (v: string, r: Row) => (
        <b style={{ color: r.unassigned ? '#8c8c8c' : undefined }}>{v}</b>) },
    { title: 'سطور', dataIndex: 'lines', align: 'left' as const,
      ...numberColumn<Row>((r) => r.lines) },
    { title: 'الإيرادات', dataIndex: 'income', align: 'left' as const,
      ...numberColumn<Row>((r) => r.income), render: (v: string) => money(v) },
    { title: 'المصروفات', dataIndex: 'expenses', align: 'left' as const,
      ...numberColumn<Row>((r) => r.expenses), render: (v: string) => money(v) },
    { title: 'الربح', dataIndex: 'profit', align: 'left' as const,
      ...numberColumn<Row>((r) => r.profit),
      render: (v: string) => (
        <b style={{ color: Number(v) < 0 ? '#cf1322' : '#6AB42D' }}>{money(v)}</b>) },
    { title: 'هامش %', dataIndex: 'margin_pct', align: 'left' as const,
      ...numberColumn<Row>((r) => r.margin_pct),
      render: (v: string | null) => (v === null ? '-' : `${money(v)}%`) },
  ];

  const printIt = () => {
    const printable: PrintColumn<Row>[] = columns
      .filter((c) => c.dataIndex)
      .map((c) => ({ title: String(c.title ?? ''), value: c.dataIndex }));
    const lines: PrintTotal[] = totals
      ? [
        { label: 'الإيرادات', value: money(totals.income) },
        { label: 'المصروفات', value: money(totals.expenses) },
        { label: 'صافي الربح', value: money(totals.profit) },
      ]
      : [];
    printReport(
      {
        title: view?.label ?? (dimension === 'cost_center' ? 'أرباح مراكز التكلفة' : 'مقارنة الفروع'),
        date: dayjs().format('YYYY/MM/DD'),
        meta: [
          ['من', range ? range[0].format('YYYY/MM/DD') : 'من البداية'],
          ['إلى', range ? range[1].format('YYYY/MM/DD') : 'حتى اليوم'],
          ...(totals?.unassigned_lines
            ? ([['غير موزّع', `${totals.unassigned_lines} سطر`]] as [string, string][])
            : []),
        ],
      },
      printable, rows, lines,
    );
  };

  const exportCsv = () => {
    if (!rows.length) { message.info('لا توجد بيانات للتصدير'); return; }
    writeCsv(`profitability-${dimension}`, columnsFromTable(columns), rows);
  };

  const tableCols = useTableColumns('profitability', columns);

  return (
    <Card
      title={view?.label ?? 'تحليل الربحية'}
      extra={(
        <>
          {tableCols.control}
          <Button icon={<DownloadOutlined />} onClick={exportCsv}
            style={{ marginInlineStart: 8 }}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />} onClick={printIt}
            style={{ marginInlineStart: 8, marginInlineEnd: 8 }}>طباعة</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={10}>
          <Segmented
            block value={dimension} onChange={(v) => setDimension(v as Dimension)}
            options={[
              { value: 'cost_center', label: 'بمركز التكلفة' },
              { value: 'branch', label: 'بالفرع' },
            ]}
          />
        </Col>
        <Col xs={24} md={8}>
          <DateRangeFilter
            value={range as any}
            onChange={(v) => setRange(v as any)}
          />
        </Col>
        <Col xs={24} md={6}>
          <Switch checked={includeUnassigned} onChange={setIncludeUnassigned} />
          <span style={{ marginInlineStart: 8 }}>أظهر غير الموزّع</span>
        </Col>
      </Row>

      {totals && (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={8}>
            <Card size="small"><Statistic title="الإيرادات" value={money(totals.income)} /></Card>
          </Col>
          <Col xs={8}>
            <Card size="small"><Statistic title="المصروفات" value={money(totals.expenses)} /></Card>
          </Col>
          <Col xs={8}>
            <Card size="small">
              <Statistic
                title={`صافي الربح${totals.margin_pct !== null ? ` (${money(totals.margin_pct)}%)` : ''}`}
                value={money(totals.profit)}
                valueStyle={{ color: Number(totals.profit) < 0 ? '#cf1322' : '#6AB42D' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {!!totals?.unassigned_lines && includeUnassigned && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message={`${totals.unassigned_lines} سطر مترحّل من غير ${dimension === 'cost_center' ? 'مركز تكلفة' : 'فرع'}`}
          description="تظهر في سطر «غير موزّع» ليساوي مجموع الأسطر قائمة الدخل. وإخفاؤها يجعل الأجزاء لا تُكوِّن الكل دون ما يوضّح السبب."
        />
      )}
      {!includeUnassigned && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="غير الموزّع مخفي — الإجماليات دي أقل من قائمة الدخل"
        />
      )}

      <Table
        {...kb.tableProps}
        rowKey={rowKeyOf}
        size="small" loading={loading} dataSource={rows} columns={tableCols.columns}
        locale={{ emptyText: 'لا توجد حركة في هذه الفترة' }}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />

      <TabModal
        open={!!openRow} onCancel={() => setOpenRow(null)} footer={null} width={720}
        title={`تفصيل ${openRow?.label ?? ''}`}
      >
        <Table
          rowKey={(r: any) => r.account_id}
          size="small" loading={breakdownLoading}
          dataSource={breakdown?.rows ?? []}
          pagination={false}
          locale={{ emptyText: 'لا توجد حركة' }}
          columns={[
            { title: 'الكود', dataIndex: 'code' },
            { title: 'الحساب', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
            { title: 'النوع', dataIndex: 'nature',
              render: (v: string) => (
                <Tag color={v === 'income' ? 'green' : 'red'}>
                  {v === 'income' ? 'إيراد' : 'مصروف'}
                </Tag>) },
            { title: 'سطور', dataIndex: 'lines', align: 'left' as const },
            { title: 'المبلغ', dataIndex: 'amount', align: 'left' as const,
              render: (v: string) => <b>{money(v)}</b> },
          ]}
          summary={() => (breakdown ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <b>صافي الربح</b>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4}>
                <b style={{ color: Number(breakdown.totals.profit) < 0 ? '#cf1322' : '#6AB42D' }}>
                  {money(breakdown.totals.profit)}
                </b>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          ) : null)}
        />
      </TabModal>
    </Card>
  );
}

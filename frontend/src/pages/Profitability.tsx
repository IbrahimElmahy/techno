import React, { useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { Alert, Button, Switch, Tabs, Tag, message } from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import {
  DownloadOutlined, FundOutlined, PrinterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import { useQueryTab } from '../components/useQueryTab';
import { useTableKeyboard } from '../components/keyboard';
import TabModal from '../components/TabModal';
import { textColumn, numberColumn } from '../components/gridColumns';
import { columnsFromTable, exportCsv as writeCsv } from '../utils/exportCsv';
import { printReport, type PrintColumn, type PrintTotal } from '../print/reportSheet';

import ListPage from '../components/ListPage';
import { useCanSeeStats } from '../components/StatsRow';
import { money } from '../utils/money';
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

export interface ProfitabilityView { label: string; dimension: Dimension }

export const REPORT_VIEWS: Record<string, ProfitabilityView> = {
  'cost-centers': { label: 'أرباح مراكز التكلفة', dimension: 'cost_center' },
  'branches': { label: 'مقارنة الفروع', dimension: 'branch' },
};

export default function Profitability() {
  const [viewKey] = useQueryTab('', 'view');
  const view = REPORT_VIEWS[viewKey];

  const [dimension, setDimension] = useState<Dimension>(view?.dimension ?? 'cost_center');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [includeUnassigned, setIncludeUnassigned] = useState(true);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const [openRow, setOpenRow] = useState<Row | null>(null);
  const [items, setItems] = useState<any>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [drillTab, setDrillTab] = useState<'accounts' | 'items'>('accounts');
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

  const loadItems = async (row: Row) => {
    setItemsLoading(true);
    try {
      const res = await api.get('/api/v1/reports/analytic-items', {
        params: {
          ...params,
          cost_center_id: row.key ?? undefined,
          include_unassigned: row.key === null,
        },
      });
      setItems(res.data);
    } catch (err) {
      console.error(err);
    } finally { setItemsLoading(false); }
  };

  const openBreakdown = async (row: Row) => {
    setOpenRow(row); setBreakdown(null); setItems(null); setDrillTab('accounts');
    setBreakdownLoading(true);
    if (dimension === 'cost_center') void loadItems(row);
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
        <b style={{ color: r.unassigned ? '#555b65' : undefined }}>{v}</b>) },
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

  const tableCols = useTableColumns('profitability', columns, {
    export: { name: view?.label ?? 'تحليل الربحية', rows },
  });

  const canSeeStats = useCanSeeStats();

  return (
    <ListPage<Dimension>
      icon={<FundOutlined />}
      title={view?.label ?? 'تحليل الربحية'}
      subtitle="الإيرادات والمصروفات والربح موزّعة على مراكز التكلفة أو الفروع"
      tabs={[
        { key: 'cost_center', label: 'بمركز التكلفة' },
        { key: 'branch', label: 'بالفرع' },
      ]}
      activeTab={dimension}
      onTabChange={setDimension}
      actions={(<>
        <Button icon={<PrinterOutlined />} onClick={printIt}>طباعة</Button>
        <Button icon={<DownloadOutlined />} onClick={exportCsv}>تصدير CSV</Button>
        {tableCols.control}
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={(<>
        <DateRangeFilter
          className="sl-f-dates"
          value={range as any}
          onChange={(v) => setRange(v as any)}
        />
        <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Switch checked={includeUnassigned} onChange={setIncludeUnassigned} />
          <span>أظهر غير الموزّع</span>
        </span>
      </>)}
    >
      {!!totals?.unassigned_lines && includeUnassigned && (
        <Alert
          type="info" showIcon style={{ margin: '6px 0 8px' }}
          message={`${totals.unassigned_lines} سطر مترحّل من غير ${dimension === 'cost_center' ? 'مركز تكلفة' : 'فرع'}`}
          description="تظهر في سطر «غير موزّع» ليساوي مجموع الأسطر قائمة الدخل. وإخفاؤها يجعل الأجزاء لا تُكوِّن الكل دون ما يوضّح السبب."
        />
      )}
      {!includeUnassigned && (
        <Alert
          type="warning" showIcon style={{ margin: '6px 0 8px' }}
          message="غير الموزّع مخفي — الإجماليات دي أقل من قائمة الدخل"
        />
      )}

      <Table
        {...kb.tableProps}
        className="sl-table"
        rowKey={rowKeyOf}
        size="small" loading={loading} dataSource={rows} columns={tableCols.columns}
        locale={{ emptyText: 'لا توجد حركة في هذه الفترة' }}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
      {totals && canSeeStats && (
        <div style={{ padding: '10px 4px', borderTop: '1px solid #f1f5f9' }}>
          <span className="sl-foot">
            <span>الإيرادات: <b>{money(totals.income)}</b></span>
            <span>المصروفات: <b>{money(totals.expenses)}</b></span>
            <span>
              صافي الربح{totals.margin_pct !== null ? ` (${money(totals.margin_pct)}%)` : ''}:{' '}
              <b className={Number(totals.profit) < 0 ? 'is-neg' : 'is-pos'}>{money(totals.profit)}</b>
            </span>
          </span>
        </div>
      )}

      <TabModal
        open={!!openRow} onCancel={() => setOpenRow(null)} footer={null} width={720}
        title={`تفصيل ${openRow?.label ?? ''}`}
      >
        <Tabs
          activeKey={drillTab}
          onChange={(k) => setDrillTab(k as 'accounts' | 'items')}
          items={[
            {
              key: 'accounts',
              label: 'بالحساب',
              children: (
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
              ),
            },
            ...(dimension === 'cost_center' ? [{
              key: 'items',
              label: `البنود (${items?.totals?.items ?? 0})`,
              children: (
                <Table
                  rowKey={(r: any) => `${r.line_id}-${r.cost_center_id ?? 'x'}`}
                  size="small" loading={itemsLoading}
                  dataSource={items?.items ?? []}
                  pagination={{ defaultPageSize: PAGE_SIZE, showTotal: (t: number) => `${t} بند` }}
                  locale={{ emptyText: 'لا توجد بنود' }}
                  columns={[
                    { title: 'التاريخ', dataIndex: 'entry_date', width: 105 },
                    {
                      title: 'المستند',
                      key: 'doc',
                      width: 170,
                      render: (_: unknown, r: any) => (
                        <Button type="link" size="small"
                          onClick={() => navigate(`/general-ledger?tab=journal&doc=${r.entry_id}`)}>
                          {r.entry_number || `#${r.entry_id}`}
                        </Button>
                      ),
                    },
                    { title: 'النوع', dataIndex: 'move_type_label', width: 110 },
                    {
                      title: 'الحساب',
                      key: 'acc',
                      render: (_: unknown, r: any) => r.account_name || r.account_code || '-',
                    },
                    {
                      title: 'البيان',
                      key: 'text',
                      ellipsis: true,
                      render: (_: unknown, r: any) => r.statement || r.description || '',
                    },
                    {
                      title: 'النصيب',
                      dataIndex: 'share_pct',
                      width: 90,
                      align: 'left' as const,
                      render: (v: string | null) => (v === null ? '-' : `${money(v)}%`),
                    },
                    {
                      title: 'المبلغ',
                      dataIndex: 'amount',
                      width: 120,
                      align: 'left' as const,
                      render: (v: string) => <b>{money(v)}</b>,
                    },
                  ]}
                  summary={() => (items ? (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={6}><b>الإجمالي</b></Table.Summary.Cell>
                      <Table.Summary.Cell index={6}>
                        <b>{money(items.totals.amount)}</b>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  ) : null)}
                />
              ),
            }] : []),
          ]}
        />
      </TabModal>
    </ListPage>
  );
}

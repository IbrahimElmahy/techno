/**
 * جزء من شاشة الأستاذ العام — اتفصل عن `GeneralLedger.tsx` لما الملف وصل ١٤٠٠ سطر
 * وخمس تبويبات. الشاشة والمسار زي ما هما بالظبط؛ اللي اتغيّر هو إن كل تبويب بقى
 * ملف لوحده، فالتعديل في «الدفاتر» مابيفتحش «ميزان المراجعة» قدامك.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Col, DatePicker, Divider, Empty, Form, Input, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Tooltip, message, Radio,
} from 'antd';
import { InputNumber } from '../../components/NumberInput';
import {
  PlusOutlined, RollbackOutlined, BookOutlined, FileAddOutlined, BankOutlined,
  ReloadOutlined, SearchOutlined, DownloadOutlined, PrinterOutlined,
  ProfileOutlined, CheckCircleOutlined, EditOutlined, StopOutlined, LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import CostCenterSplit from '../../components/CostCenterSplit';
import { api } from '../../api/client';
import AccountItems from './AccountItems';
import { useQueryTab } from '../../components/useQueryTab';
import {
  APPEARS_IN_LABEL, CostCenter, MAIN_LEVELS, NATURE_COLOR, NATURE_LABEL, egp,
} from '../../utils/accounts';
import { showReversalConfirm } from '../../components/ConfirmationDialog';
import ListToolbar, { useListFilter, normalizeAr } from '../../components/ListToolbar';
import { useTableKeyboard } from '../../components/keyboard';
import { textColumn, numberColumn, choiceColumn, dateColumn } from '../../components/gridColumns';
import { entryTypeLabel } from '../../components/labels';
import PartyField from '../../components/PartyField';
import { TabModal } from '../../components/TabModal';
import { useTableColumns } from '../../components/ColumnSettings';
import { exportCsv } from '../../utils/exportCsv';
import DateRangeFilter from '../../components/DateRangeFilter';
import { printReport } from '../../print/reportSheet';
import { TrialRow } from './types';

const BOOKS: { nature: TrialRow['nature']; label: string }[] = [
  { nature: 'asset', label: 'اصول' },
  { nature: 'liability', label: 'خصوم' },
  { nature: 'equity', label: 'حقوق ملكية' },
  { nature: 'expense', label: 'مصروفات' },
  { nature: 'income', label: 'ايرادات' },
];

export default function TrialBalanceTab() {
  const navigate = useNavigate();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('year'), dayjs().endOf('year')]);
  const [branchId, setBranchId] = useState<number | undefined>();
  const [costCenterId, setCostCenterId] = useState<number | undefined>();
  const [branches, setBranches] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [rowQuery, setRowQuery] = useState('');
  const [grouped, setGrouped] = useState(true);

  const rows: TrialRow[] = data?.rows ?? [];
  const trialRows: TrialRow[] = data?.rows ?? [];
  const shownRows = rowQuery
    ? rows.filter((r) => [r.code, r.name].some((f) => normalizeAr(f).includes(normalizeAr(rowQuery))))
    : rows;

  useEffect(() => {
    api.get('/api/v1/branches').then((r) => setBranches(r.data)).catch(() => {});
    api.get('/api/v1/cost-centers?active=true').then((r) => setCostCenters(r.data)).catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: range[0].format('YYYY-MM-DD'),
        to: range[1].format('YYYY-MM-DD'),
        include_groups: 'true',
      });
      if (branchId) params.set('branch_id', String(branchId));
      if (costCenterId) params.set('cost_center_id', String(costCenterId));
      const res = await api.get(`/api/v1/trial-balance?${params.toString()}`);
      setData(res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { run(); }, [range, branchId, costCenterId]);

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 130,
      ...textColumn(trialRows, (r: TrialRow) => r.code),
      render: (c: string) => c ? <Tag color="blue">{c}</Tag> : '-' },
    { title: 'الحساب', dataIndex: 'name', key: 'name',
      ...textColumn(trialRows, (r: TrialRow) => r.name),
      render: (n: string, r: TrialRow) => r.is_postable ? n : <strong>{n}</strong> },
    { title: 'افتتاحي', dataIndex: 'opening', key: 'opening', align: 'left' as const,
      ...numberColumn<TrialRow>((r: any) => r.opening), render: egp },
    { title: 'مدين', dataIndex: 'period_debit', key: 'period_debit', align: 'left' as const,
      ...numberColumn<TrialRow>((r: any) => r.period_debit),
      render: (v: string) => <span style={{ color: '#6AB42D' }}>{egp(v)}</span> },
    { title: 'دائن', dataIndex: 'period_credit', key: 'period_credit', align: 'left' as const,
      ...numberColumn<TrialRow>((r: any) => r.period_credit),
      render: (v: string) => <span style={{ color: '#F5A11D' }}>{egp(v)}</span> },
    { title: 'ختامي', dataIndex: 'closing', key: 'closing', align: 'left' as const,
      ...numberColumn<TrialRow>((r: any) => r.closing),
      render: (v: string) => <strong>{egp(v)}</strong> },
  ];

  // في العرض المقسّم الجدول بينقسم لجداول بالطبيعة، والملف بيجمعهم كلهم زي الميزان المسطّح.
  const trialBalanceTabCols = useTableColumns('gl-trial-balance', columns, {
    export: { name: 'ميزان المراجعة', rows: shownRows },
  });

  const trialKb = useTableKeyboard<any>({
    rows: shownRows, rowKey: (r) => r.account_id,
    onOpen: (r) => navigate(`/account-statement?account=${r.account_id}`),
  });

  const bookLabel = (n: TrialRow['nature']) =>
    BOOKS.find((b) => b.nature === n)?.label ?? 'بدون تصنيف';
  const trialReportCols = [
    { title: 'الكود', value: (r: TrialRow) => r.code },
    { title: 'الحساب', value: (r: TrialRow) => r.name },
    { title: 'القسم', value: (r: TrialRow) => bookLabel(r.nature) },
    { title: 'افتتاحي', value: (r: TrialRow) => r.opening, numeric: true },
    { title: 'مدين', value: (r: TrialRow) => r.period_debit, numeric: true },
    { title: 'دائن', value: (r: TrialRow) => r.period_credit, numeric: true },
    { title: 'ختامي', value: (r: TrialRow) => r.closing, numeric: true },
  ];
  const exportTrial = () => {
    if (!shownRows.length) { message.info('لا توجد بيانات للتصدير'); return; }
    exportCsv('trial-balance', trialReportCols, shownRows);
  };
  const printTrial = () => {
    printReport(
      {
        title: 'ميزان المراجعة',
        date: dayjs().format('YYYY/MM/DD'),
        meta: [
          ['من', range[0].format('YYYY/MM/DD')],
          ['إلى', range[1].format('YYYY/MM/DD')],
          ...(branchId ? ([['الفرع', branches.find((b) => b.id === branchId)?.name ?? String(branchId)]] as [string, string][]) : []),
          ...(costCenterId ? ([['مركز التكلفة', costCenters.find((c) => c.id === costCenterId)?.name ?? String(costCenterId)]] as [string, string][]) : []),
        ],
      },
      trialReportCols, shownRows,
      data ? [
        { label: 'إجمالي مدين', value: egp(data.grand_total_debit) },
        { label: 'إجمالي دائن', value: egp(data.grand_total_credit) },
      ] : undefined,
    );
  };

  return (
    <Card title="ميزان المراجعة">
      <Space wrap style={{ marginBottom: 16 }}>
        <Input allowClear value={rowQuery} onChange={(e) => setRowQuery(e.target.value)}
          prefix={<SearchOutlined />} placeholder="بحث بكود الحساب أو الاسم" style={{ width: 240 }} />
        <div style={{ width: 280 }}>
          <DateRangeFilter value={range} onChange={(v) => v && setRange(v)} />
        </div>
        <Select allowClear placeholder="كل الفروع" style={{ width: 180 }} value={branchId} onChange={setBranchId}
          options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        <Select allowClear placeholder="كل مراكز التكلفة" style={{ width: 220 }} value={costCenterId}
          onChange={setCostCenterId} showSearch optionFilterProp="label"
          options={costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
        <Radio.Group size="small" value={grouped} onChange={(e: any) => setGrouped(e.target.value)}>
          <Radio.Button value>مقسّم بالطبيعة</Radio.Button>
          <Radio.Button value={false}>ميزان مسطّح</Radio.Button>
        </Radio.Group>
        <Button type="primary" icon={<ReloadOutlined />} onClick={run} loading={loading}>عرض</Button>
        <Button icon={<DownloadOutlined />} onClick={exportTrial}>تصدير CSV</Button>
        <Button icon={<PrinterOutlined />} onClick={printTrial}>طباعة</Button>
        {trialBalanceTabCols.control}
      </Space>

      {data && grouped ? (
        <>
          {BOOKS.map(({ nature, label }) => {
            const book = shownRows.filter((r) => r.nature === nature);
            const debit = book.reduce((t, r) => t + Number(r.period_debit || 0), 0);
            const credit = book.reduce((t, r) => t + Number(r.period_credit || 0), 0);
            return (
              <Table
                {...trialKb.tableProps}
                key={nature ?? 'none'} rowKey="account_id" dataSource={book} columns={trialBalanceTabCols.columns}
                loading={loading} pagination={false} size="small"
                expandable={{
                  // الفرد بيفتح بنود الحساب في نفس الفترة — ده «دفتر الأستاذ
                  // العام» بتاع أودو: الرقم في الميزان بيفرد على القيود اللي وراه.
                  expandedRowRender: (r: any) => (
                    <AccountItems
                      accountId={r.account_id}
                      dateFrom={range?.[0]?.format('YYYY-MM-DD')}
                      dateTo={range?.[1]?.format('YYYY-MM-DD')}
                    />
                  ),
                  rowExpandable: (r: any) =>
                    Number(r.period_debit || 0) !== 0 || Number(r.period_credit || 0) !== 0,
                }}
                style={{ marginBottom: 18 }}
                title={() => <strong>{label}</strong>}
                locale={{ emptyText: 'لا توجد حسابات في هذا القسم' }}
                summary={() => (book.length ? (
                  <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
                    <Table.Summary.Cell index={0} colSpan={3}>إجمالي {label}</Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="left">{egp(debit)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="left">{egp(credit)}</Table.Summary.Cell>
                    <Table.Summary.Cell index={5} />
                  </Table.Summary.Row>
                ) : null)}
              />
            );
          })}
          {shownRows.some((r) => !r.nature) && (
            <Table
              {...trialKb.tableProps}
              rowKey="account_id" columns={trialBalanceTabCols.columns} pagination={false} size="small"
              dataSource={shownRows.filter((r) => !r.nature)}
              expandable={{
                // الفرد بيفتح بنود الحساب في نفس الفترة — ده «دفتر الأستاذ
                // العام» بتاع أودو: الرقم في الميزان بيفرد على القيود اللي وراه.
                expandedRowRender: (r: any) => (
                  <AccountItems
                    accountId={r.account_id}
                    dateFrom={range?.[0]?.format('YYYY-MM-DD')}
                    dateTo={range?.[1]?.format('YYYY-MM-DD')}
                  />
                ),
                rowExpandable: (r: any) =>
                  Number(r.period_debit || 0) !== 0 || Number(r.period_credit || 0) !== 0,
              }}
              title={() => <strong style={{ color: '#d46b08' }}>بدون تصنيف</strong>}
            />
          )}
          <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>
            الإجمالي العام: مدين {egp(data.grand_total_debit)} · دائن {egp(data.grand_total_credit)}
            {' '}{data.balanced ? <Tag color="green">متوازن ✓</Tag> : <Tag color="red">غير متوازن</Tag>}
          </div>
        </>
      ) : data ? (
        <>
          <Table {...trialKb.tableProps} rowKey="account_id" dataSource={shownRows} columns={trialBalanceTabCols.columns} loading={loading}
            pagination={false} size="small"
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
                  <Table.Summary.Cell index={0} colSpan={3}>الإجمالي</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="left">{egp(data.grand_total_debit)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="left">{egp(data.grand_total_credit)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="left">
                    {data.balanced ? <Tag color="green">متوازن ✓</Tag> : <Tag color="red">غير متوازن</Tag>}
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
          <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>
            مشتقّ بالكامل من دفتر الأستاذ — إجمالي المدين = إجمالي الدائن دائماً.
          </div>
        </>
      ) : <Empty description="لا توجد بيانات" />}
    </Card>
  );
}

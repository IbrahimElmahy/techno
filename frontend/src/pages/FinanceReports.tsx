import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { Select, Button, Tag, Alert, Input } from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import {
  AccountBookOutlined, ClearOutlined, LinkOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import { useTableColumns } from '../components/ColumnSettings';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useQueryTab } from '../components/useQueryTab';
import { printDocument } from '../print/brand';
import { useListFilter } from '../components/ListToolbar';
import ListPage from '../components/ListPage';
import DateRangeFilter from '../components/DateRangeFilter';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, choiceColumn } from '../components/gridColumns';
import PartnerLedgerTab from './financeReports/PartnerLedgerTab';
import AccountTree from '../components/AccountTree';
import { useCanSeeStats } from '../components/StatsRow';
import { numeralsLocale } from '../utils/money';
import ReportOptionsBar, {
  DEFAULT_REPORT_OPTIONS, DeltaCell, ReportOptions as RptOptions, reportParams,
} from '../components/ReportOptionsBar';
import {
  AgingRow, BalanceSheet, CommissionRow, IncomeStatement, ReportLine, VatReturn,
  BUCKETS, money,
} from './financeReports/types';

const FOOT_LINE: React.CSSProperties = { padding: '10px 4px', borderTop: '1px solid #f1f5f9' };

const FinanceReports: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useQueryTab('sheet');
  useEffect(() => {
    if (tab === 'income') navigate('/income-sheet', { replace: true });
    else if (['cashflow', 'vat', 'commissions'].includes(tab)) setTab('sheet');
  }, [tab]);
  const [tree, setTree] = useState<any | null>(null);
  const [period] = useQueryTab('', 'period');
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [income, setIncome] = useState<IncomeStatement | null>(null);
  const [sheet, setSheet] = useState<BalanceSheet | null>(null);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [agingParty, setAgingParty] = useQueryTab('customers', 'side') as
    unknown as ['customers' | 'suppliers', (v: 'customers' | 'suppliers') => void];
  const [vat, setVat] = useState<VatReturn | null>(null);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [opts, setOpts] = useState<RptOptions>(DEFAULT_REPORT_OPTIONS);

  const agingFilter = useListFilter(aging, { search: (r) => [r.party_name] });
  const commissionFilter = useListFilter(commissions, { search: (r) => [r.rep_name] });

  const params = useCallback(() => {
    const p: Record<string, string> = {};
    if (range?.[0]) p.date_from = range[0].format('YYYY-MM-DD');
    if (range?.[1]) p.date_to = range[1].format('YYYY-MM-DD');
    return p;
  }, [range]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const p = params();
      const [b, t, a] = await Promise.all([
        api.get<BalanceSheet>('/api/v1/reports/balance-sheet', {
          params: { ...(p.date_to ? { as_of: p.date_to } : {}), ...reportParams(opts) },
        }),
        api.get('/api/v1/reports/balance-sheet-tree', {
          params: { ...(p.date_to ? { as_of: p.date_to } : {}), posted_only: opts.postedOnly },
        }),
        api.get<AgingRow[]>('/api/v1/reports/aging', { params: { party: agingParty } }),
      ]);
      setSheet(b.data);
      setTree(t.data);
      setAging(a.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [params, agingParty, opts]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const printBlock = (title: string, bodyHtml: string) => {
    printDocument(
      {
        title: `تكنو ثيرم — ${title}`,
        meta: [
          ['الفترة',
            `${range?.[0] ? range[0].format('YYYY-MM-DD') : 'من البداية'} إلى ${range?.[1] ? range[1].format('YYYY-MM-DD') : 'اليوم'}`],
        ],
      },
      bodyHtml,
    );
  };

  const linesTable = (rows: ReportLine[]) =>
    `<table class="grid"><thead><tr><th>الحساب</th><th>القيمة</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${r.name || r.code || r.account_id}</td><td class="num">${money(r.amount)}</td></tr>`).join('') ||
      '<tr><td colspan="2">لا توجد حركة</td></tr>'
    }</tbody></table>`;

  const acctRows = useMemo(() => [
    ...(income?.income ?? []), ...(income?.expenses ?? []),
    ...(sheet?.assets ?? []), ...(sheet?.liabilities ?? []), ...(sheet?.equity ?? []),
  ], [income, sheet]);

  const amountCol = {
    title: 'القيمة',
    dataIndex: 'amount',
    width: 160,
    align: 'left' as const,
    ...numberColumn<ReportLine>((r) => r.amount),
    render: (v: string) => money(v),
  };
  const priorOf = (rows: ReportLine[] | undefined, id: number) =>
    rows?.find((r) => r.account_id === id)?.amount ?? '0';

  const compareCols = (prior: ReportLine[] | undefined, goodWhenUp: boolean) => (
    prior ? [
      {
        title: 'المقارنة',
        key: 'prior',
        width: 150,
        align: 'left' as const,
        render: (_: any, r: ReportLine) => money(priorOf(prior, r.account_id)),
      },
      {
        title: 'الفرق',
        key: 'delta',
        width: 170,
        align: 'left' as const,
        render: (_: any, r: ReportLine) => (
          <DeltaCell now={r.amount} before={priorOf(prior, r.account_id)}
                     goodWhenUp={goodWhenUp} />
        ),
      },
    ] : []
  );

  const nameCol = {
    title: 'الحساب',
    ...textColumn(acctRows, (r: ReportLine) => r.name || r.code || `#${r.account_id}`),
    render: (_: any, r: ReportLine) => r.name || r.code || `#${r.account_id}`,
  };

  const acctKb = useTableKeyboard<any>({
    rows: acctRows, rowKey: (r) => r.account_id,
    onOpen: (r) => navigate(`/account-statement?account=${r.account_id}`),
  });
  const agingKb = useTableKeyboard<AgingRow>({
    rows: agingFilter.filtered, rowKey: (r) => r.party_id,
    onOpen: (r) => navigate(agingParty === 'customers'
      ? `/customers/${r.party_id}` : `/suppliers/${r.party_id}`),
  });

  const agingColumns = useMemo(() => ([
    { title: agingParty === 'customers' ? 'العميل' : 'المورد', dataIndex: 'party_name', key: 'party_name',
      ...textColumn(aging, (r: AgingRow) => r.party_name) },
    ...BUCKETS.map((b) => ({
      title: b === '90+' ? 'أكثر من 90 يوماً' : `${b} يوم`,
      key: `bucket_${b}`,
      dataIndex: ['buckets', b],
      width: 130,
      align: 'left' as const,
      ...numberColumn<AgingRow>((r) => r.buckets?.[b]),
      render: (v: string) => (Number(v) ? money(v) : ''),
    })),
    {
      title: 'الإجمالي',
      dataIndex: 'total',
      key: 'total',
      width: 140,
      align: 'left' as const,
      ...numberColumn<AgingRow>((r) => r.total),
      render: (v: string) => <b>{money(v)}</b>,
    },
    {
      title: '',
      key: 'reconcile',
      width: 110,
      render: (_: unknown, r: AgingRow) => (
        <Button type="link" size="small" icon={<LinkOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/reconciliation?kind=${agingParty === 'customers' ? 'customer' : 'supplier'}`
              + `&partner=${r.party_id}`);
          }}>
          تسوية
        </Button>
      ),
    },
  ]), [agingParty, aging, navigate]);
  const agingCols = useTableColumns('finance-aging', agingColumns as any, {
    locked: ['party_name'],
    export: { name: 'أعمار الديون', rows: agingFilter.filtered },
  });

  const canSeeStats = useCanSeeStats();

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } },
    tab === 'aging' || tab === 'commissions');

  const [visited, setVisited] = useState<Set<string>>(() => new Set([tab]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);
  const [filtersSlot, setFiltersSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const slotsFor = (key: string) => (tab === key
    ? { filters: filtersSlot, actions: actionsSlot } : undefined);
  const ownLoader = tab === 'partner' || tab === 'cashflow';

  const TABS: { key: string; label: string; title: string }[] = [
    { key: 'sheet', label: 'الميزانية', title: 'المركز المالي (الميزانية)' },
    { key: 'aging', label: 'أعمار الديون', title: 'أعمار الديون' },
    { key: 'partner', label: 'دفتر الشريك', title: 'دفتر الشريك' },
  ];
  const cur = TABS.find((t) => t.key === tab);

  const shownOf = (shown: number, total: number) => (
    <span>
      المعروض: <b>{shown.toLocaleString(numeralsLocale())}</b>
      {' '}من {total.toLocaleString(numeralsLocale())}
    </span>
  );

  return (
    <ListPage
      icon={<AccountBookOutlined />}
      title={cur?.title ?? 'التقارير المالية'}
      tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
      activeTab={tab}
      onTabChange={setTab}
      actions={(<>
        {tab === 'income' && income && (
          <Button
            icon={<PrinterOutlined />}
            onClick={() =>
              printBlock(
                'قائمة الدخل',
                `<h3>الإيرادات</h3>${linesTable(income.income)}
                 <h3>المصروفات</h3>${linesTable(income.expenses)}
                 <table class="totals"><tbody>
                  <tr><td>إجمالي الإيرادات</td><td class="num">${money(income.total_income)}</td></tr>
                  <tr><td>إجمالي المصروفات</td><td class="num">${money(income.total_expenses)}</td></tr>
                  <tr><td>صافي الربح</td><td class="num">${money(income.net_profit)}</td></tr>
                 </tbody></table>`
              )
            }
          >
            طباعة
          </Button>
        )}
        {tab === 'aging' && agingCols.control}
        <span ref={setActionsSlot} className="sl-slot" />
        {!ownLoader && (
          <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading}>
            تحديث
          </Button>
        )}
      </>)}
      filters={(<>
        <DateRangeFilter className="sl-f-dates" value={range as any} onChange={(v) => setRange(v as any)} />
        <div style={{ flex: '0 0 auto' }}>
          <ReportOptionsBar value={opts} onChange={setOpts} />
        </div>
        {tab === 'aging' && (<>
          <Select
            value={agingParty}
            style={{ flex: '0 0 140px' }}
            onChange={(v) => setAgingParty(v)}
            options={[
              { value: 'customers', label: 'العملاء' },
              { value: 'suppliers', label: 'الموردين' },
            ]}
          />
          <Input
            ref={searchRef}
            className="sl-f-search"
            allowClear
            prefix={<SearchOutlined />}
            placeholder={agingParty === 'customers' ? 'بحث باسم العميل' : 'بحث باسم المورد'}
            value={agingFilter.query}
            onChange={(e) => agingFilter.setQuery(e.target.value)}
          />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={agingFilter.reset}>مسح</Button>
        </>)}
        {tab === 'commissions' && (<>
          <Input
            ref={searchRef}
            className="sl-f-search"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="بحث باسم المندوب"
            value={commissionFilter.query}
            onChange={(e) => commissionFilter.setQuery(e.target.value)}
          />
          <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={commissionFilter.reset}>مسح</Button>
        </>)}
        <span ref={setFiltersSlot} style={{ display: 'contents' }} />
      </>)}
    >
      {tab === 'income' && income && (
        <>
          <Table {...acctKb.tableProps} className="sl-table" rowKey="account_id" size="small" pagination={false} title={() => 'الإيرادات'} dataSource={income.income} columns={[nameCol, amountCol, ...compareCols(income.comparison?.income, true)]} />
          <Table
            {...acctKb.tableProps}
            className="sl-table"
            rowKey="account_id"
            size="small"
            pagination={false}
            style={{ marginTop: 12 }}
            title={() => 'المصروفات'}
            dataSource={income.expenses}
            columns={[nameCol, amountCol, ...compareCols(income.comparison?.expenses, false)]}
          />
          {canSeeStats && (
            <div style={FOOT_LINE}>
              <span className="sl-foot">
                <span>الإيرادات: <b className="is-pos">{money(income.total_income)}</b></span>
                <span>المصروفات: <b className="is-neg">{money(income.total_expenses)}</b></span>
                <span>
                  صافي الربح:{' '}
                  <b className={Number(income.net_profit) >= 0 ? undefined : 'is-neg'}>
                    {money(income.net_profit)}
                  </b>
                </span>
              </span>
            </div>
          )}
        </>
      )}

      {tab === 'sheet' && tree && (
        <>
          {!tree.balanced && (
            <Alert type="warning" showIcon style={{ margin: '6px 0 8px' }}
              message="الميزانية غير متوازنة — راجع القيود اليدوية." />
          )}
          <AccountTree
            onOpenAccount={(id) => navigate(`/account-statement?account=${id}${range?.[1] ? `&to=${range[1].format('YYYY-MM-DD')}` : ''}`)}
            sections={[
              { key: 'a', label: 'الأصول', total: tree.total_assets, nodes: tree.assets },
              { key: 'l', label: 'الالتزامات', total: tree.total_liabilities, nodes: tree.liabilities },
              {
                key: 'e', label: 'حقوق الملكية',
                total: String(Number(tree.total_equity) + Number(tree.net_profit)), nodes: tree.equity,
                extra: [{ label: 'أرباح الفترة الحالية', amount: tree.net_profit }],
              },
            ]}
            footer={[
              { label: 'إجمالي الالتزامات وحقوق الملكية',
                amount: String(Number(tree.total_liabilities) + Number(tree.total_equity) + Number(tree.net_profit)) },
            ]}
          />
        </>
      )}

      {tab === 'aging' && (
        <Table<AgingRow>
          {...agingKb.tableProps}
          className="sl-table"
          rowKey="party_id"
          size="small"
          loading={loading}
          dataSource={agingFilter.filtered}
          pagination={{
            defaultPageSize: PAGE_SIZE,
            locale: { items_per_page: '' },
            showTotal: () => (
              <span className="sl-foot">{shownOf(agingFilter.filtered.length, aging.length)}</span>
            ),
          }}
          columns={agingCols.columns}
          summary={() => {
            const sum = agingFilter.filtered.reduce((s, r) => s + Number(r.total), 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={5}>
                  <b>الإجمالي العام</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5}>
                  <b>{money(sum)}</b>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      )}

      {visited.has('partner') && (
        <div style={{ display: tab === 'partner' ? undefined : 'none' }}>
          <PartnerLedgerTab params={params} slots={slotsFor('partner')} />
        </div>
      )}

      {tab === 'vat' && (
        <>
          {vat && Number(vat.rate_pct) === 0 && (
            <Alert
              type="info"
              showIcon
              style={{ margin: '6px 0 8px' }}
              message="الضريبة غير مفعّلة"
              description="النسبة الحالية صفر — فعّلها من إعدادات المبيعات لتُحتسب على الفواتير الجديدة."
            />
          )}
          {vat && canSeeStats && (
            <div style={{ padding: '12px 4px' }}>
              <span className="sl-foot">
                <span>النسبة: <b>{Number(vat.rate_pct)}%</b></span>
                <span>ضريبة المبيعات: <b>{money(vat.output_tax)}</b></span>
                <span>ضريبة المشتريات: <b>{money(vat.input_tax)}</b></span>
                <span>المستحق للمصلحة: <b>{money(vat.net_payable)}</b></span>
              </span>
            </div>
          )}
        </>
      )}

      {tab === 'commissions' && (
        <>
          <Table<CommissionRow>
            className="sl-table"
            rowKey="rep_user_id"
            size="small"
            loading={loading}
            dataSource={commissionFilter.filtered}
            pagination={false}
            columns={[
              { title: 'المندوب', dataIndex: 'rep_name',
                ...textColumn(commissions, (r: CommissionRow) => r.rep_name) },
              {
                title: 'الأساس',
                dataIndex: 'basis',
                width: 130,
                ...choiceColumn<CommissionRow>(
                  [{ text: 'على التحصيل', value: 'collection' },
                   { text: 'على المبيعات', value: 'sales' }],
                  (r, v) => r.basis === v),
                render: (v: string) => (
                  <Tag color={v === 'collection' ? 'green' : 'blue'}>
                    {v === 'collection' ? 'على التحصيل' : 'على المبيعات'}
                  </Tag>
                ),
              },
              { title: 'النسبة', dataIndex: 'rate_pct', width: 90,
                ...numberColumn<CommissionRow>((r) => r.rate_pct),
                render: (v: string) => `${Number(v)}%` },
              {
                title: 'الأساس المحتسب',
                dataIndex: 'base_amount',
                width: 160,
                align: 'left' as const,
                ...numberColumn<CommissionRow>((r) => r.base_amount),
                render: (v: string) => money(v),
              },
              {
                title: 'العمولة',
                dataIndex: 'commission',
                width: 150,
                align: 'left' as const,
                ...numberColumn<CommissionRow>((r) => r.commission),
                render: (v: string) => <b>{money(v)}</b>,
              },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}>
                  <b>الإجمالي</b>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4}>
                  <b>{money(commissionFilter.filtered.reduce((s, r) => s + Number(r.commission), 0))}</b>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
          <div style={FOOT_LINE}>
            <span className="sl-foot">{shownOf(commissionFilter.filtered.length, commissions.length)}</span>
          </div>
        </>
      )}
    </ListPage>
  );
};

export default FinanceReports;

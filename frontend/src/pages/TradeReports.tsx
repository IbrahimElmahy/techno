import React, { useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { Alert, Button, Select, Tag, message } from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { BarChartOutlined, DownloadOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import StatementFilter, { statementColumn } from '../components/StatementFilter';
import { useQueryTab } from '../components/useQueryTab';
import DocumentLink, { DocKind, useOpenDocument } from '../components/DocumentLink';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import { columnsFromTable, exportCsv as writeCsv } from '../utils/exportCsv';
import { printReport, type PrintColumn, type PrintTotal } from '../print/reportSheet';

import ListPage from '../components/ListPage';
import { useCanSeeStats } from '../components/StatsRow';
import { money, numeralsLocale, qty } from '../utils/money';
const DOC_SCREEN: Partial<Record<DocType, DocKind>> = {
  sale: 'invoice',
  sale_return: 'return',
  purchase: 'purchase',
};

type DocType = 'sale' | 'sale_return' | 'purchase' | 'purchase_return';
type Level = 'document' | 'line';
type GroupBy = 'none' | 'party' | 'item' | 'warehouse' | 'category' | 'main_category';

const DOC_LABELS: Record<DocType, string> = {
  sale: 'طلبات البيع',
  sale_return: 'مرتجعات البيع',
  purchase: 'فواتير الشراء',
  purchase_return: 'مرتجعات الشراء',
};

interface Totals {
  quantity: string; net: string; revenue: string;
  cost: string | null; profit: string | null; margin_pct: string | null;
  lines_without_cost: number | null; document_count: number;
}

export interface ReportView {
  label: string;
  docType: DocType;
  level: Level;
  groupBy: GroupBy;
  a5: string;
}

export const REPORT_VIEWS: Record<string, ReportView> = {
  'sales-invoices': { label: 'مبيعات فواتير', docType: 'sale', level: 'document', groupBy: 'none', a5: '/sales/invoice-search' },
  'sales-invoices-grouped': { label: 'مجمع مبيعات فواتير', docType: 'sale', level: 'document', groupBy: 'party', a5: '/sales/invoice-grouped' },
  'sales-items': { label: 'مبيعات اصناف', docType: 'sale', level: 'line', groupBy: 'none', a5: '/sales/itemsearch' },
  'sales-items-grouped': { label: 'مبيعات اصناف مجمعة', docType: 'sale', level: 'line', groupBy: 'item', a5: '/sales/item-grouped' },
  'invoice-profits': { label: 'ارباح فواتير', docType: 'sale', level: 'document', groupBy: 'none', a5: '/invoicesprofits' },
  'item-profits': { label: 'ارباح اصناف', docType: 'sale', level: 'line', groupBy: 'item', a5: '/sales/itemprofits' },
  'sales-return-items': { label: 'مرتجعات أصناف المبيعات', docType: 'sale_return', level: 'line', groupBy: 'item', a5: '/salesreturns/itemsearch' },
  'margin-by-store': { label: 'هامش مبيعات مخازن', docType: 'sale', level: 'line', groupBy: 'warehouse', a5: '/sales/reports/store-margin' },
  'margin-by-customer': { label: 'هامش مبيعات عملاء', docType: 'sale', level: 'line', groupBy: 'party', a5: '/sales/reports/customer-margin' },
  'purchase-invoices': { label: 'مشتريات فواتير', docType: 'purchase', level: 'document', groupBy: 'none', a5: '/purchases/invoice-search' },
  'purchase-invoices-grouped': { label: 'مجمع مشتريات فواتير', docType: 'purchase', level: 'document', groupBy: 'party', a5: '/purchases/invoice-grouped' },
  'purchase-items': { label: 'مشتريات اصناف', docType: 'purchase', level: 'line', groupBy: 'none', a5: '/purchases/itemsearch' },
  'purchase-items-grouped': { label: 'مشتريات اصناف مجمعة', docType: 'purchase', level: 'line', groupBy: 'item', a5: '/purchases/item-grouped' },
  'purchase-return-items': { label: 'مرتجعات أصناف المشتريات', docType: 'purchase_return', level: 'line', groupBy: 'item', a5: '/purchasesreturns/itemsearch' },
};

export default function TradeReports() {
  const [viewKey] = useQueryTab('', 'view');
  const view: ReportView | undefined = REPORT_VIEWS[viewKey];

  const [docType, setDocType] = useState<DocType>(view?.docType ?? 'sale');
  const [level, setLevel] = useState<Level>(view?.level ?? 'document');
  const [groupBy, setGroupBy] = useState<GroupBy>(view?.groupBy ?? 'none');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [party, setParty] = useState<{ id: number; sale: boolean } | undefined>();
  const [itemId, setItemId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [statement, setStatement] = useState('');

  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);

  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);

  const isSale = docType.startsWith('sale');
  const parties = isSale ? customers : suppliers;
  const partyId = party && party.sale === isSale ? party.id : undefined;
  const setPartyId = (id?: number) => setParty(id ? { id, sale: isSale } : undefined);
  const partyOptions = useMemo(() => sortByName(parties, (p: any) => p.name)
    .map((p: any) => ({ value: p.id, label: String(p.name ?? '') })), [parties]);

  useEffect(() => {
    Promise.all([
      api.get('/api/v1/customers/options', { params: { limit: 20000 } }), api.get('/api/v1/suppliers'),
      api.get('/api/v1/items'), api.get('/api/v1/warehouses'),
    ]).then(([c, s, i, w]) => {
      setCustomers(c.data || []); setSuppliers(s.data || []);
      setItems(i.data || []); setWarehouses(w.data || []);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!view) return;
    setDocType(view.docType); setLevel(view.level); setGroupBy(view.groupBy);
    setParty(undefined); setItemId(undefined); setWarehouseId(undefined); setStatement('');
  }, [viewKey]);

  const offPreset = !!view && (docType !== view.docType || level !== view.level
    || groupBy !== view.groupBy);

  useEffect(() => { setParty((p) => (p && p.sale !== isSale ? undefined : p)); }, [isSale]);

  const params = useMemo(() => {
    const p: any = { doc_type: docType, level, group_by: groupBy };
    if (range) { p.date_from = range[0].format('YYYY-MM-DD'); p.date_to = range[1].format('YYYY-MM-DD'); }
    if (partyId) p.party_id = partyId;
    if (itemId) p.item_id = itemId;
    if (warehouseId) p.warehouse_id = warehouseId;
    if (statement) p.statement = statement;
    return p;
  }, [docType, level, groupBy, range, partyId, itemId, warehouseId, statement]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/trade', { params });
      setRows(res.data.rows || []);
      setTotals(res.data.totals || null);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل التقرير');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [params]);

  const grouped = groupBy !== 'none';
  const wantsProfit = isSale;

  const profitColumns = wantsProfit ? [
    { title: 'التكلفة', dataIndex: 'cost', align: 'left' as const,
      ...numberColumn<any>((r) => r.cost),
      render: (v: string) => money(v) },
    { title: 'الربح', dataIndex: 'profit', align: 'left' as const,
      ...numberColumn<any>((r) => r.profit),
      render: (v: string, r: any) => (
        <b style={{ color: Number(v) < 0 ? '#cf1322' : '#6AB42D' }}>
          {money(v)}{r.cost_complete === false
            ? <Tag color="orange" style={{ marginInlineStart: 6 }}>تكلفة ناقصة</Tag> : null}
        </b>
      ) },
    { title: 'هامش %', dataIndex: 'margin_pct', align: 'left' as const,
      ...numberColumn<any>((r) => r.margin_pct),
      render: (v: string) => `${money(v)}%` },
  ] : [];

  const columns: any[] = grouped
    ? [
      { title: groupBy === 'party' ? (isSale ? 'العميل' : 'المورد')
        : groupBy === 'item' ? 'الصنف'
          : groupBy === 'category' ? 'الفئة'
            : groupBy === 'main_category' ? 'الفئة الرئيسية' : 'المخزن',
      dataIndex: 'label', ...textColumn(rows, (r: any) => r.label),
      render: (v: string) => <b>{v}</b> },
      { title: 'عدد المستندات', dataIndex: 'document_count', align: 'left' as const,
        ...numberColumn<any>((r) => r.document_count) },
      { title: 'الكمية', dataIndex: 'quantity', align: 'left' as const,
        ...numberColumn<any>((r) => r.quantity),
        render: (v: string) => qty(v) },
      { title: 'الصافي', dataIndex: 'net', align: 'left' as const,
        ...numberColumn<any>((r) => r.net),
        render: (v: string) => <b>{money(v)}</b> },
      ...profitColumns,
    ]
    : [
      { title: 'المستند', dataIndex: 'document_number',
        ...textColumn(rows, (r: any) => r.document_number),
        render: (v: string) => <Tag>{v}</Tag> },
      { title: 'التاريخ', dataIndex: 'date', ...dateColumn<any>((r) => r.date),
        render: (v: string) => (v ? String(v).slice(0, 10) : '-') },
      { title: isSale ? 'العميل' : 'المورد', dataIndex: 'party',
        ...textColumn(rows, (r: any) => r.party) },
      statementColumn(rows),
      ...(level === 'line' ? [
        { title: 'الصنف', dataIndex: 'item', ...textColumn(rows, (r: any) => r.item),
          render: (v: string) => <b>{v}</b> },
        { title: 'المخزن', dataIndex: 'warehouse',
          ...textColumn(rows, (r: any) => r.warehouse) },
      ] : []),
      { title: 'الكمية', dataIndex: 'quantity', align: 'left' as const,
        ...numberColumn<any>((r) => r.quantity),
        render: (v: string) => qty(v) },
      { title: 'الصافي', dataIndex: 'net', align: 'left' as const,
        ...numberColumn<any>((r) => r.net),
        render: (v: string) => <b>{money(v)}</b> },
      ...profitColumns,
      { title: '', key: 'link', width: 140,
        render: (_: any, r: any) => (r.doc_id && DOC_SCREEN[docType]
          ? <DocumentLink kind={DOC_SCREEN[docType]} id={r.doc_id} size="small" />
          : null) },
    ];

  const printMeta = (): [string, string][] => {
    const pairs: [string, string][] = [
      ['من', range ? range[0].format('YYYY/MM/DD') : 'كل التواريخ'],
      ['إلى', range ? range[1].format('YYYY/MM/DD') : 'كل التواريخ'],
    ];
    if (partyId) {
      pairs.push([isSale ? 'العميل' : 'المورد',
        (isSale ? customers : suppliers).find((p: any) => p.id === partyId)?.name ?? '']);
    }
    if (itemId) pairs.push(['الصنف', items.find((i: any) => i.id === itemId)?.name ?? '']);
    if (warehouseId) {
      pairs.push(['المخزن', warehouses.find((w: any) => w.id === warehouseId)?.name ?? '']);
    }
    if (statement) pairs.push(['البيان', statement]);
    return pairs;
  };

  const printIt = () => {
    const printable: PrintColumn<any>[] = columns
      .filter((c) => (c as any).dataIndex)
      .map((c) => ({ title: String(c.title ?? ''), value: (c as any).dataIndex }));
    const lines: PrintTotal[] = totals
      ? [
          { label: 'عدد المستندات', value: totals.document_count },
          { label: 'إجمالي الكمية', value: qty(totals.quantity) },
          ...(totals.profit !== null
            ? [{ label: 'التكلفة', value: money(totals.cost) },
               { label: 'الربح', value: money(totals.profit) }]
            : []),
          { label: 'الصافي', value: money(totals.net) },
        ]
      : [];
    printReport(
      { title: view?.label ?? 'تقرير', date: dayjs().format('YYYY/MM/DD'), meta: printMeta() },
      printable, rows, lines,
    );
  };

  const exportCsv = () => {
    if (!rows.length) { message.info('لا توجد بيانات للتصدير'); return; }
    writeCsv(`${docType}-${level}-${groupBy}`, columnsFromTable(columns as any[]), rows);
  };

  const openDoc = useOpenDocument();
  const rowKeyOf = (r: any) => (r.line_id ? `l-${r.line_id}`
    : r.doc_id && !grouped ? `d-${r.doc_id}` : `g-${r.key ?? 'none'}`);
  const kb = useTableKeyboard<any>({
    rows, rowKey: rowKeyOf,
    onOpen: (r) => { if (r.doc_id && DOC_SCREEN[docType]) openDoc(DOC_SCREEN[docType], r.doc_id); },
  });

  const tableCols = useTableColumns('trade-reports', columns, {
    export: { name: view ? view.label : 'تقارير المبيعات والمشتريات', rows },
  });

  const canSeeStats = useCanSeeStats();
  const footer = totals && canSeeStats ? (
    <span className="sl-foot">
      <span>عدد المستندات: <b>{totals.document_count.toLocaleString(numeralsLocale())}</b></span>
      <span>إجمالي الكمية: <b>{qty(totals.quantity)}</b></span>
      <span>الصافي: <b>{money(totals.net)}</b></span>
      {wantsProfit && (<>
        <span>التكلفة: <b>{money(totals.cost)}</b></span>
        <span>
          الربح ({money(totals.margin_pct)}%):{' '}
          <b className={Number(totals.profit) < 0 ? 'is-neg' : 'is-pos'}>{money(totals.profit)}</b>
        </span>
      </>)}
    </span>
  ) : null;

  return (
    <ListPage<DocType>
      icon={<BarChartOutlined />}
      title={view ? view.label : 'تقارير المبيعات والمشتريات'}
      muted={offPreset ? <Tag color="orange" style={{ fontWeight: 400 }}>معدّل</Tag> : undefined}
      subtitle="المبيعات والمشتريات ومرتجعاتها — بالمستند أو بالصنف، تفصيلي أو مجمّع"
      tabs={(Object.keys(DOC_LABELS) as DocType[]).map((k) => ({ key: k, label: DOC_LABELS[k] }))}
      activeTab={docType}
      onTabChange={setDocType}
      actions={(<>
        <Button icon={<PrinterOutlined />} onClick={printIt}>طباعة</Button>
        <Button icon={<DownloadOutlined />} onClick={exportCsv}>تصدير CSV</Button>
        {tableCols.control}
        <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={(<>
        <Select
          value={level}
          onChange={(v) => setLevel(v as Level)}
          options={[
            { value: 'document', label: 'بالمستند' },
            { value: 'line', label: 'بالصنف (سطور)' },
          ]}
        />
        <Select
          value={groupBy}
          onChange={(v) => setGroupBy(v as GroupBy)}
          options={[
            { value: 'none', label: 'تفصيلي' },
            { value: 'party', label: isSale ? 'بالعميل' : 'بالمورد' },
            { value: 'item', label: 'بالصنف' },
            { value: 'category', label: 'بالفئة' },
            { value: 'main_category', label: 'بالرئيسية' },
            { value: 'warehouse', label: 'بالمخزن' },
          ]}
        />
        <DateRangeFilter
          className="sl-f-dates"
          value={range as any}
          onChange={(v) => setRange(v as any)}
        />
        <Select
          className="sl-f-customer"
          allowClear showSearch
          placeholder={isSale ? 'كل العملاء' : 'كل الموردين'}
          value={partyId} onChange={setPartyId}
          options={partyOptions} filterOption={searchFilter} filterSort={searchRank}/>
        <Select
          allowClear showSearch
          placeholder="كل الأصناف" value={itemId} onChange={setItemId}
          options={items.map((i) => ({ value: i.id, label: i.name }))} filterOption={searchFilter} filterSort={searchRank}/>
        <Select showSearch
          allowClear placeholder="كل المخازن"
          value={warehouseId} onChange={setWarehouseId}
          options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank} />
        <StatementFilter value={statement} onChange={setStatement} />
      </>)}
    >
      {wantsProfit && !!totals?.lines_without_cost && (
        <Alert
          type="warning" showIcon style={{ margin: '6px 0 8px' }}
          message={`${totals.lines_without_cost} سطر بدون تكلفة محفوظة`}
          description="سطور اتباعت قبل تفعيل حفظ التكلفة عند البيع — الربح المعروض لا يشملها، ولذلك هو أعلى من الحقيقي في هذه السطور."
        />
      )}

      <Table
        {...kb.tableProps}
        className="sl-table"
        rowKey={rowKeyOf}
        size="small" loading={loading} dataSource={rows} columns={tableCols.columns}
        locale={{ emptyText: 'لا توجد بيانات في هذه الفترة' }}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true,
          locale: { items_per_page: '' },
          showTotal: () => footer,
        }}
        scroll={{ x: 'max-content' }}
      />
    </ListPage>
  );
}

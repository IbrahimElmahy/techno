import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Row, Segmented, Select, Statistic, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import { useQueryTab } from '../components/useQueryTab';
import DocumentLink, { DocKind, useOpenDocument } from '../components/DocumentLink';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import { columnsFromTable, exportCsv as writeCsv } from '../utils/exportCsv';
import { printReport, type PrintColumn, type PrintTotal } from '../print/reportSheet';

// Only the kinds that have a screen able to show them; a purchase return has no screen of its
// own yet, so its rows stay unlinked rather than pointing somewhere that cannot open them.
const DOC_SCREEN: Partial<Record<DocType, DocKind>> = {
  sale: 'invoice',
  sale_return: 'return',
  purchase: 'purchase',
};

/**
 * تقارير المبيعات والمشتريات — one screen instead of the sixteen the client has today.
 *
 * Their current system spreads these over separate menu items (مبيعات بالفاتورة، مبيعات بالعميل،
 * مبيعات بالصنف، أرباح الفواتير، مشتريات بالمورد …) but they are the same question asked three
 * ways: which document type, at what level of detail, grouped by what. So the screen is those
 * three switches over one endpoint, and every combination is a report.
 *
 * Profit shows only on sales, and only because the cost was frozen onto the line when it sold —
 * a later purchase at a different price must never rewrite a margin already earned.
 */

type DocType = 'sale' | 'sale_return' | 'purchase' | 'purchase_return';
type Level = 'document' | 'line';
type GroupBy = 'none' | 'party' | 'item' | 'warehouse';

const DOC_LABELS: Record<DocType, string> = {
  sale: 'فواتير البيع',
  sale_return: 'مرتجعات البيع',
  purchase: 'فواتير الشراء',
  purchase_return: 'مرتجعات الشراء',
};

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

interface Totals {
  quantity: string; net: string; revenue: string;
  cost: string | null; profit: string | null; margin_pct: string | null;
  lines_without_cost: number | null; document_count: number;
}


/**
 * The fifteen reports their menu lists, each as (which documents · what grain · grouped by what).
 *
 * Their system has fifteen separate report screens; ours has one engine that answers all of them,
 * which was the right way to BUILD it and the wrong way to SHIP it. Somebody who has run «ارباح
 * اصناف» every Sunday for six years does not want a screen with three switches and a note saying
 * their report is combination four — they want «ارباح اصناف». So the menu carries their fifteen
 * names, each opens in its own tab under that name, and the switches arrive already set.
 *
 * The switches stay live. Once here, the whole engine is still reachable — a question their system
 * could not ask is one switch away instead of a report nobody ever built. Moving one just says so
 * beside the title, so the person knows they are no longer looking at the report they opened.
 */
export interface ReportView {
  label: string;
  docType: DocType;
  level: Level;
  groupBy: GroupBy;
  /** Their route, kept so this stays auditable against the map. */
  a5: string;
}

export const REPORT_VIEWS: Record<string, ReportView> = {
  // تقارير مبيعات
  'sales-invoices': { label: 'مبيعات فواتير', docType: 'sale', level: 'document', groupBy: 'none', a5: '/sales/invoice-search' },
  'sales-invoices-grouped': { label: 'مجمع مبيعات فواتير', docType: 'sale', level: 'document', groupBy: 'party', a5: '/sales/invoice-grouped' },
  'sales-items': { label: 'مبيعات اصناف', docType: 'sale', level: 'line', groupBy: 'none', a5: '/sales/itemsearch' },
  'sales-items-grouped': { label: 'مبيعات اصناف مجمعة', docType: 'sale', level: 'line', groupBy: 'item', a5: '/sales/item-grouped' },
  'invoice-profits': { label: 'ارباح فواتير', docType: 'sale', level: 'document', groupBy: 'none', a5: '/invoicesprofits' },
  'item-profits': { label: 'ارباح اصناف', docType: 'sale', level: 'line', groupBy: 'item', a5: '/sales/itemprofits' },
  // تقارير مردود مبيعات
  'sales-return-items': { label: 'مرتجعات أصناف المبيعات', docType: 'sale_return', level: 'line', groupBy: 'item', a5: '/salesreturns/itemsearch' },
  // هامش مبيعات — the same lines, gathered by the thing being judged.
  'margin-by-store': { label: 'هامش مبيعات مخازن', docType: 'sale', level: 'line', groupBy: 'warehouse', a5: '/sales/reports/store-margin' },
  'margin-by-customer': { label: 'هامش مبيعات عملاء', docType: 'sale', level: 'line', groupBy: 'party', a5: '/sales/reports/customer-margin' },
  // تقارير مشتريات
  'purchase-invoices': { label: 'مشتريات فواتير', docType: 'purchase', level: 'document', groupBy: 'none', a5: '/purchases/invoice-search' },
  'purchase-invoices-grouped': { label: 'مجمع مشتريات فواتير', docType: 'purchase', level: 'document', groupBy: 'party', a5: '/purchases/invoice-grouped' },
  'purchase-items': { label: 'مشتريات اصناف', docType: 'purchase', level: 'line', groupBy: 'none', a5: '/purchases/itemsearch' },
  'purchase-items-grouped': { label: 'مشتريات اصناف مجمعة', docType: 'purchase', level: 'line', groupBy: 'item', a5: '/purchases/item-grouped' },
  // تقارير مردود مشتريات
  'purchase-return-items': { label: 'مرتجعات أصناف المشتريات', docType: 'purchase_return', level: 'line', groupBy: 'item', a5: '/purchasesreturns/itemsearch' },
};

export default function TradeReports() {
  const [viewKey] = useQueryTab('', 'view');
  const view: ReportView | undefined = REPORT_VIEWS[viewKey];

  const [docType, setDocType] = useState<DocType>(view?.docType ?? 'sale');
  const [level, setLevel] = useState<Level>(view?.level ?? 'document');
  const [groupBy, setGroupBy] = useState<GroupBy>(view?.groupBy ?? 'none');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    [dayjs().startOf('month'), dayjs()]);
  const [partyId, setPartyId] = useState<number | undefined>();
  const [itemId, setItemId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();

  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);

  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);

  const isSale = docType.startsWith('sale');
  const parties = isSale ? customers : suppliers;

  useEffect(() => {
    Promise.all([
      api.get('/api/v1/customers'), api.get('/api/v1/suppliers'),
      api.get('/api/v1/items'), api.get('/api/v1/warehouses'),
    ]).then(([c, s, i, w]) => {
      setCustomers(c.data || []); setSuppliers(s.data || []);
      setItems(i.data || []); setWarehouses(w.data || []);
    }).catch(console.error);
  }, []);

  // The named report reasserts itself when the route changes — the tab workspace keeps every open
  // screen mounted, so arriving at a different report must reset the switches rather than inherit
  // whatever the last one left behind.
  useEffect(() => {
    if (!view) return;
    setDocType(view.docType); setLevel(view.level); setGroupBy(view.groupBy);
  }, [viewKey]);

  const offPreset = !!view && (docType !== view.docType || level !== view.level
    || groupBy !== view.groupBy);

  // Switching between customers and suppliers must drop a party filter that no longer applies.
  useEffect(() => { setPartyId(undefined); }, [docType]);

  const params = useMemo(() => {
    const p: any = { doc_type: docType, level, group_by: groupBy };
    if (range) { p.date_from = range[0].format('YYYY-MM-DD'); p.date_to = range[1].format('YYYY-MM-DD'); }
    if (partyId) p.party_id = partyId;
    if (itemId) p.item_id = itemId;
    if (warehouseId) p.warehouse_id = warehouseId;
    return p;
  }, [docType, level, groupBy, range, partyId, itemId, warehouseId]);

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
        : groupBy === 'item' ? 'الصنف' : 'المخزن',
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
      // A figure in a report is only useful if you can get to the document behind it.
      { title: '', key: 'link', width: 140,
        render: (_: any, r: any) => (r.doc_id && DOC_SCREEN[docType]
          ? <DocumentLink kind={DOC_SCREEN[docType]} id={r.doc_id} size="small" />
          : null) },
    ];

  /** الفلاتر اللي التقرير اتقرا بيها — بتطلع في ترويسة الصفحة المطبوعة.
   *
   * A printed report with no dates on it is a page of numbers nobody can date, and it gets read
   * six months later as if it were current. */
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
          // Profit only exists on sales — printing «الربح: ٠» on a purchase report would be a
          // stated figure that is not a fact.
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

  /** Exported straight from what is on screen, so the file always matches the report read. */
  const exportCsv = () => {
    if (!rows.length) { message.info('لا توجد بيانات للتصدير'); return; }
    // `columnsFromTable` drops the action column — it has no data behind it, and exporting it
    // would add a blank column carrying a heading.
    writeCsv(`${docType}-${level}-${groupBy}`, columnsFromTable(columns as any[]), rows);
  };

  // رقم في تقرير مالوش قيمة من غير ما توصل للمستند اللي وراه. الزرار موجود في آخر السطر؛ ده
  // بيخلّي السطر كله يوصل لنفس المكان.
  const openDoc = useOpenDocument();
  const kb = useTableKeyboard<any>({
    rows, rowKey: (r) => r.key ?? `${r.document_number}-${r.item_id ?? ''}-${r.warehouse ?? ''}`,
    onOpen: (r) => { if (r.doc_id && DOC_SCREEN[docType]) openDoc(DOC_SCREEN[docType], r.doc_id); },
  });

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('trade-reports', columns);

  return (
    <Card
      title={(
        <span>
          {view ? view.label : 'تقارير المبيعات والمشتريات'}
          {offPreset ? (
            <Tag color="orange" style={{ marginInlineStart: 8, fontWeight: 400 }}>
              معدّل
            </Tag>
          ) : null}
        </span>
      )}
      extra={(
        <>
          {tableCols.control}
          <Button icon={<DownloadOutlined />} onClick={exportCsv}
            style={{ marginInlineStart: 8 }}>
            تصدير CSV
          </Button>
          <Button icon={<PrinterOutlined />} onClick={printIt}
            style={{ marginInlineStart: 8, marginInlineEnd: 8 }}>
            طباعة
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} lg={10}>
          <Segmented
            block
            value={docType}
            onChange={(v) => setDocType(v as DocType)}
            options={(Object.keys(DOC_LABELS) as DocType[])
              .map((k) => ({ value: k, label: DOC_LABELS[k] }))}
          />
        </Col>
        <Col xs={12} lg={6}>
          <Segmented
            block
            value={level}
            onChange={(v) => setLevel(v as Level)}
            options={[
              { value: 'document', label: 'بالمستند' },
              { value: 'line', label: 'بالصنف (سطور)' },
            ]}
          />
        </Col>
        <Col xs={12} lg={8}>
          <Segmented
            block
            value={groupBy}
            onChange={(v) => setGroupBy(v as GroupBy)}
            options={[
              { value: 'none', label: 'تفصيلي' },
              { value: 'party', label: isSale ? 'بالعميل' : 'بالمورد' },
              { value: 'item', label: 'بالصنف' },
              { value: 'warehouse', label: 'بالمخزن' },
            ]}
          />
        </Col>
      </Row>

      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <DatePicker.RangePicker
            style={{ width: '100%' }} value={range as any}
            onChange={(v) => setRange(v as any)} allowClear
            placeholder={['من تاريخ', 'إلى تاريخ']}
          />
        </Col>
        <Col xs={24} md={5}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder={isSale ? 'كل العملاء' : 'كل الموردين'}
            value={partyId} onChange={setPartyId}
            options={parties.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Col>
        <Col xs={24} md={5}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="كل الأصناف" value={itemId} onChange={setItemId}
            options={items.map((i) => ({ value: i.id, label: i.name }))}
          />
        </Col>
        <Col xs={24} md={5}>
          <Select
            allowClear style={{ width: '100%' }} placeholder="كل المخازن"
            value={warehouseId} onChange={setWarehouseId}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </Col>
      </Row>

      {totals && (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          <Col xs={12} md={wantsProfit ? 5 : 8}>
            <Card size="small"><Statistic title="عدد المستندات" value={totals.document_count} /></Card>
          </Col>
          <Col xs={12} md={wantsProfit ? 5 : 8}>
            <Card size="small"><Statistic title="إجمالي الكمية" value={qty(totals.quantity)} /></Card>
          </Col>
          <Col xs={12} md={wantsProfit ? 5 : 8}>
            <Card size="small">
              <Statistic title="الصافي" value={money(totals.net)} valueStyle={{ color: '#0B5CA8' }} />
            </Card>
          </Col>
          {wantsProfit && (
            <>
              <Col xs={12} md={5}>
                <Card size="small"><Statistic title="التكلفة" value={money(totals.cost)} /></Card>
              </Col>
              <Col xs={24} md={4}>
                <Card size="small">
                  <Statistic
                    title={`الربح (${money(totals.margin_pct)}%)`} value={money(totals.profit)}
                    valueStyle={{ color: Number(totals.profit) < 0 ? '#cf1322' : '#6AB42D' }}
                  />
                </Card>
              </Col>
            </>
          )}
        </Row>
      )}

      {wantsProfit && !!totals?.lines_without_cost && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={`${totals.lines_without_cost} سطر بدون تكلفة محفوظة`}
          description="سطور اتباعت قبل تفعيل حفظ التكلفة عند البيع — الربح المعروض لا يشملها، ولذلك هو أعلى من الحقيقي في هذه السطور."
        />
      )}

      <Table
        {...kb.tableProps}
        rowKey={(r: any) => r.key ?? `${r.document_number}-${r.item_id ?? ''}-${r.warehouse ?? ''}`}
        size="small" loading={loading} dataSource={rows} columns={tableCols.columns}
        locale={{ emptyText: 'لا توجد بيانات في هذه الفترة' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
}

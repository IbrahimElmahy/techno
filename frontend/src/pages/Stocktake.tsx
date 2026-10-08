import React, { useEffect, useRef, useState } from 'react';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { PAGE_SIZE } from '../utils/pagination';
import { Button, Input, Select, Tag, message } from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { InputNumber } from '../components/NumberInput';
import {
  CalendarOutlined, ClearOutlined, DownloadOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import ListPage from '../components/ListPage';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import { useListFilter } from '../components/ListToolbar';
import DateRangeFilter from '../components/DateRangeFilter';
import { choiceColumn, numberColumn, textColumn } from '../components/gridColumns';
import MovementHistoryLog from '../components/MovementHistoryLog';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';
import {
  LOG_LIMIT, exportItemsWithLogs, fetchLog, printItemsWithLogs,
} from '../print/itemLogSheet';
import { money, numeralsLocale, qty } from '../utils/money';

interface Row {
  item_id: number; code: string | null; name: string;
  category: string | null;
  unit_of_measure: string | null; location: string;
  location_kind: string; location_id: number;
  quantity: string; unit_cost: string; value: string;
}

const METHOD_LABELS: Record<string, string> = {
  average: 'المتوسط المرجح',
  last_purchase: 'آخر سعر شراء',
};

export default function Stocktake() {
  const [picked, setPicked] = useState<React.Key[]>([]);
  const [dateFrom, setDateFrom] = useState<Dayjs | null>(null);
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  const [actual, setActual] = useState<Record<string, number | null>>({});
  const [openRows, setOpenRows] = useState<React.Key[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/api/v1/warehouses').then((r) => setWarehouses(r.data || [])).catch(console.error);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { date_to: asOf.format('YYYY-MM-DD') };
      if (warehouseId) params.warehouse_id = warehouseId;
      const res = await api.get('/api/v1/reports/stock-as-of', { params });
      setRows(res.data.rows || []);
      setTotals(res.data.totals || null);
      setMethod(res.data.costing_method || null);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل الجرد');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [asOf, warehouseId]);

  const rowKey = (r: Row) => `${r.item_id}-${r.location}`;
  const logLocation = (r: Row) => ({
    locationKind: r.location_kind ?? (warehouseId ? 'warehouse' : null),
    locationId: r.location_id ?? warehouseId ?? null,
  });
  const diffOf = (r: Row) => {
    const a = actual[rowKey(r)];
    if (a === null || a === undefined) return null;
    return Number(r.quantity || 0) - a;
  };

  const filter = useListFilter(rows, { search: (r) => [r.code, r.name, r.category, r.location] });

  const forOutput = () => (picked.length
    ? filter.filtered.filter((r: any) => picked.includes(rowKeyOf(r)))
    : filter.filtered);

  const withLogs = async (data: any[]) => {
    if (data.length > LOG_LIMIT) {
      message.info(`يُستخرج السجل لما لا يزيد عن ${LOG_LIMIT} صنف — حدّد الأصناف المطلوب سجلها.`);
      return null;
    }
    return Promise.all(data.map(async (r: any) => ({
      row: r,
      name: `${r.name}${r.location ? ` — ${r.location}` : ''}`,
      log: await fetchLog(
        { itemId: r.item_id, itemName: r.name, ...logLocation(r) },
        dateFrom ? dateFrom.format('YYYY-MM-DD') : null, asOf.format('YYYY-MM-DD'),
      ),
    })));
  };

  const exportCsv = async () => {
    const data = forOutput();
    if (!data.length) { message.info('لا توجد أرصدة للتصدير'); return; }
    const cols: CsvColumn<any>[] = [
      { title: 'الكود', value: 'code' },
      { title: 'الصنف', value: 'name' },
      { title: 'الفئة', value: 'category' },
      { title: 'الوحدة', value: 'unit_of_measure' },
      { title: 'الموقع', value: 'location' },
      { title: 'الكمية في النظام', value: 'quantity' },
      { title: 'العدد الفعلي', value: (r) => actual[rowKey(r)] },
      { title: 'الفرق', value: (r) => diffOf(r) },
    ];
    const name = `stocktake-${asOf.format('YYYY-MM-DD')}`;
    const entries = await withLogs(data);
    if (entries) exportItemsWithLogs(name, cols, entries);
    else writeCsv(name, cols, data);
  };

  const printIt = async () => {
    const data = forOutput();
    if (!data.length) { message.info('لا توجد صفوف للطباعة'); return; }
    const cols: PrintColumn<any>[] = [
      { title: 'الكود', value: 'code' },
      { title: 'الصنف', value: 'name' },
      { title: 'الموقع', value: 'location' },
      { title: 'الكمية في النظام', value: 'quantity', numeric: true },
      { title: 'العدد الفعلي', value: (r) => actual[rowKey(r)], numeric: true },
      { title: 'الفرق', value: (r) => diffOf(r), numeric: true },
    ];
    const entries = await withLogs(data);
    if (!entries) {
      printReport(
        { title: 'جرد حق تاريخ', date: asOf.format('YYYY/MM/DD'),
          meta: [
            ['حتى تاريخ', asOf.format('YYYY/MM/DD')],
            ...(filter.query ? [['بحث', filter.query] as [string, string]] : []),
            ['المطبوع', picked.length ? `${picked.length} صنف محدّد` : 'كل ما في الفلتر'],
          ] },
        cols, data,
      );
      return;
    }
    printItemsWithLogs(
      { title: 'جرد حق تاريخ — بالسجل', date: asOf.format('YYYY/MM/DD'),
        meta: [['الفترة', `${dateFrom ? dateFrom.format('YYYY/MM/DD') : 'أول الحركة'} ← ${asOf.format('YYYY/MM/DD')}`]] },
      cols, entries,
    );
  };

  const rowKeyOf = (r: Row) => `${r.item_id}-${r.location}`;

  const toggleRow = (key: React.Key) =>
    setOpenRows((prev) => (prev.includes(key)
      ? prev.filter((k) => k !== key) : [...prev, key]));

  const kb = useTableKeyboard<Row>({
    rows: filter.filtered, rowKey: rowKeyOf,
    onOpen: (r) => toggleRow(rowKeyOf(r)),
  });

  const columns: ColumnsType<Row> = [
    { title: 'الكود', dataIndex: 'code', ...textColumn(rows, (r: Row) => r.code),
      render: (c: string) => (c ? <Tag>{c}</Tag> : '-') },
    { title: 'الصنف', dataIndex: 'name', ...textColumn(rows, (r: Row) => r.name),
      render: (n: string) => <b>{n}</b> },
    { title: 'الفئة', dataIndex: 'category', width: 150,
      ...textColumn(rows, (r: Row) => r.category),
      render: (c: string | null) => c || <span style={{ color: '#8c8c8c' }}>بدون فئة</span> },
    { title: 'الوحدة', dataIndex: 'unit_of_measure',
      ...textColumn(rows, (r: Row) => r.unit_of_measure),
      render: (u: string) => u || '-' },
    { title: 'الموقع', dataIndex: 'location',
      ...textColumn(rows, (r: Row) => r.location) },
    { title: 'الكمية', dataIndex: 'quantity', align: 'left' as const,
      ...numberColumn((r: Row) => r.quantity),
      render: (v: string) => <b>{qty(v)}</b> },
    { title: 'العدد الفعلي', key: 'actual', align: 'left' as const, width: 140,
      ...numberColumn<Row>((r) => actual[rowKey(r)]),
      render: (_: any, r: Row) => (
        <InputNumber
          size="small" min={0} placeholder="—" style={{ width: '100%' }}
          data-grid-col="actual" keyboard={false}
          value={actual[rowKey(r)] ?? null}
          onChange={(v: any) => setActual((p) => ({ ...p, [rowKey(r)]: v as number | null }))}
        />
      ) },
    { title: 'الفرق', key: 'diff', align: 'left' as const, width: 130,
      ...choiceColumn<Row>(
        [{ text: 'عجز', value: 'short' },
         { text: 'زيادة', value: 'over' },
         { text: 'مطابق', value: 'match' },
         { text: 'لم يُعدّ بعد', value: 'none' }],
        (r: Row, v: string) => {
          const d = diffOf(r);
          if (v === 'none') return d === null;
          if (d === null) return false;
          if (v === 'match') return d === 0;
          return v === 'short' ? d > 0 : d < 0;
        }),
      render: (_: any, r: Row) => {
        const d = diffOf(r);
        if (d === null) return <span style={{ color: '#8c8c8c' }}>—</span>;
        if (d === 0) return <Tag color="green">مطابق</Tag>;
        return (
          <a onClick={() => toggleRow(rowKeyOf(r))}>
            <b style={{ color: d > 0 ? '#cf1322' : '#6AB42D' }}>
              {d > 0 ? `عجز ${qty(d)}` : `زيادة ${qty(Math.abs(d))}`}
            </b>
          </a>
        );
      } },
  ];

  const tableCols = useTableColumns('stocktake', columns, {
    export: { name: 'جرد حق تاريخ', rows: filter.filtered },
  });

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const footer = (
    <span className="sl-foot">
      <span>عدد السطور: <b>{Number(totals?.lines ?? 0).toLocaleString(numeralsLocale())}</b></span>
      <span>المعروض: <b>{filter.filtered.length.toLocaleString(numeralsLocale())}</b>
        {' '}من {rows.length.toLocaleString(numeralsLocale())}</span>
      {picked.length > 0 && <span>المحدد: <b>{picked.length.toLocaleString(numeralsLocale())}</b></span>}
      <span>إجمالي الكمية: <b>{qty(totals?.quantity)}</b></span>
      <span>قيمة المخزون: <b style={{ color: '#0B5CA8' }}>{money(totals?.value)}</b></span>
    </span>
  );

  return (
    <ListPage
      icon={<CalendarOutlined />}
      title="جرد حتى تاريخ"
      subtitle={<>
        {`الأرصدة زي ما كانت يوم ${asOf.format('YYYY-MM-DD')} — كل حركة لحد اليوم ده وبس.`}
        {method && ` التقييم بطريقة «${METHOD_LABELS[method] || method}» (تتغيّر من إعدادات المخزون).`}
      </>}
      actions={(<>
          <Button icon={<PrinterOutlined />} onClick={printIt}>
            {picked.length ? `طباعة (${picked.length})` : 'طباعة'}
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!rows.length}>
            {picked.length ? `تصدير (${picked.length})` : 'تصدير CSV'}
          </Button>
          {tableCols.control}
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
      </>)}
      filters={(<>
        <Input
          className="sl-f-search" allowClear ref={searchRef}
          prefix={<SearchOutlined />} placeholder="بحث بالصنف أو الكود أو الموقع"
          value={filter.query} onChange={(e) => filter.setQuery(e.target.value)}
        />
        <DateRangeFilter
          className="sl-f-dates"
          allowClear={false}
          value={[dateFrom, asOf] as any}
          placeholder={['من تاريخ', 'الرصيد حتى']}
          onChange={(v: any) => {
            if (!v || !v[1]) { setDateFrom(null); return; }
            setDateFrom(v[0] || null);
            setAsOf(v[1]);
          }}
        />
        <Select showSearch
          allowClear placeholder="كل المخازن"
          value={warehouseId} onChange={setWarehouseId}
          options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table<Row>
        {...kb.tableProps}
        rowSelection={{
          selectedRowKeys: picked,
          onChange: (keys) => setPicked(keys),
          preserveSelectedRowKeys: true,
        }}
        className="sl-table"
        rowKey={rowKeyOf} size="small" loading={loading}
        expandable={{
          expandedRowKeys: openRows,
          onExpandedRowsChange: (keys) => setOpenRows([...keys]),
          expandedRowRender: (r) => (
            <MovementHistoryLog
              target={{
                itemId: r.item_id, itemName: r.name,
                ...logLocation(r),
                dateFrom: dateFrom ? dateFrom.format('YYYY-MM-DD') : null,
                dateTo: asOf.format('YYYY-MM-DD'),
              }}
              onClose={() => toggleRow(rowKeyOf(r))}
              periodFilter={false}
            />
          ),
        }}
        dataSource={filter.filtered}
        locale={{ emptyText: 'لا توجد أرصدة في هذا التاريخ' }}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true,
          locale: { items_per_page: '' },
          showTotal: () => footer,
        }}
        scroll={{ x: 'max-content' }}
        columns={tableCols.columns}
        summary={(shown) => {
          const total = shown.reduce((t, r: any) => t + Number(r.value || 0), 0);
          const count = shown.length;
          return (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <strong>{`المعروض: ${count} صنف`}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} colSpan={2} />
              <Table.Summary.Cell index={2}>
                <strong style={{ color: '#0B5CA8' }}>{money(total)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
      />
    </ListPage>
  );
}

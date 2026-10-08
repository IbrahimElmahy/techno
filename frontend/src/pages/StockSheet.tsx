import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { Button, DatePicker, Input, Select, Space, Tag, message } from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import dayjs, { Dayjs } from 'dayjs';
import { InputNumber } from '../components/NumberInput';
import {
  ClearOutlined, ContainerOutlined, DownloadOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import ListPage from '../components/ListPage';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useListFilter } from '../components/ListToolbar';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import ExportExcelButton from '../components/ExportExcelButton';
import { textColumn, numberColumn, choiceColumn } from '../components/gridColumns';
import MovementHistoryLog from '../components/MovementHistoryLog';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';
import {
  LOG_LIMIT, exportItemsWithLogs, fetchLog, printItemsWithLogs,
} from '../print/itemLogSheet';
import { qty, money, numeralsLocale } from '../utils/money';
import { STOCK_TOPICS, useLiveRefresh } from '../utils/live';

interface SheetRow {
  item_id: number;
  code: string | null;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  location_kind: string;
  location_id: number;
  location: string;
  quantity: string;
  unit_cost: string;
  value: string;
}

interface TotalRow {
  item_id: number;
  code: string | null;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  quantity: number;
  value: number;
  locations: number;
}

const METHOD_LABELS: Record<string, string> = {
  average: 'المتوسط المرجح',
  last_purchase: 'آخر سعر شراء',
};

const TITLES: Record<string, string> = {
  count: 'جرد المخازن',
  general: 'جرد عام المخازن',
};

type LogPreset = 'all' | 'm1' | 'm3' | 'm12' | 'custom';
const LOG_MONTHS: Record<'m1' | 'm3' | 'm12', number> = { m1: 1, m3: 3, m12: 12 };

export default function StockSheet() {
  const [search] = useSearchParams();
  const view = search.get('view') === 'general' ? 'general' : 'count';
  const general = view === 'general';

  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [costingMethod, setCostingMethod] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<React.Key[]>([]);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/stock-as-of');
      setRows(res.data?.rows || []);
      setCostingMethod(res.data?.costing_method ?? null);
    } catch {
      if (!silent) message.error('تعذر تحميل الجرد');
    } finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useLiveRefresh(STOCK_TOPICS, () => load({ silent: true }));

  const totals = useMemo<TotalRow[]>(() => {
    const byItem = new Map<number, TotalRow>();
    rows.forEach((r) => {
      const found = byItem.get(r.item_id);
      if (found) {
        found.quantity += Number(r.quantity || 0);
        found.value += Number(r.value || 0);
        found.locations += 1;
        return;
      }
      byItem.set(r.item_id, {
        item_id: r.item_id, code: r.code, name: r.name, category: r.category,
        unit_of_measure: r.unit_of_measure,
        quantity: Number(r.quantity || 0), value: Number(r.value || 0), locations: 1,
      });
    });
    return [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [rows]);

  const source: any[] = general ? totals : rows;

  const filter = useListFilter<any>(source, {
    search: (r) => [r.code, r.name, r.category, r.location],
  });

  const shown = filter.filtered;
  const sumQty = shown.reduce((t, r) => t + Number(r.quantity || 0), 0);
  const sumValue = shown.reduce((t, r) => t + Number(r.value || 0), 0);

  const rowKey = (r: any) => (general
    ? `i${r.item_id}` : `${r.item_id}-${r.location_kind}-${r.location_id}`);

  const [actual, setActual] = useState<Record<string, number | null>>({});

  const diffOf = (r: any): number | null => {
    const a = actual[rowKey(r)];
    if (a === null || a === undefined) return null;
    return Number(Number(r.quantity || 0) - a);
  };

  const toggleRow = (key: React.Key) =>
    setOpenRows((prev) => (prev.includes(key)
      ? prev.filter((k) => k !== key) : [...prev, key]));

  const openHistory = (r: any) => toggleRow(rowKey(r));

  const [picked, setPicked] = useState<React.Key[]>([]);
  const [logPreset, setLogPreset] = useState<LogPreset>('all');
  const [logFrom, setLogFrom] = useState<Dayjs | null>(null);
  const [logTo, setLogTo] = useState<Dayjs | null>(null);

  const historyTarget = (r: any) => ({
    dateFrom: logFrom ? logFrom.format('YYYY-MM-DD') : null,
    dateTo: logTo ? logTo.format('YYYY-MM-DD') : null,
    itemId: r.item_id, itemName: r.name,
    locationKind: general ? null : r.location_kind,
    locationId: general ? null : r.location_id,
  });

  const columns = [
    { title: 'الصنف', dataIndex: 'name', key: 'name', ellipsis: true,
      ...textColumn(source, (r: any) => r.name),
      render: (v: string) => <b>{v}</b> },
    { title: 'الفئة', dataIndex: 'category', key: 'category', width: 160,
      ...textColumn(source, (r: any) => r.category),
      render: (v: string | null) => v || <span style={{ color: '#8c8c8c' }}>بدون فئة</span> },
    { title: 'الوحدة', dataIndex: 'unit_of_measure', key: 'unit', width: 100,
      ...textColumn(source, (r: any) => r.unit_of_measure),
      render: (v: string | null) => v || '-' },
    ...(general ? [{
      title: 'موجود في', dataIndex: 'locations', key: 'locations', width: 120,
      ...numberColumn((r: any) => r.locations),
      render: (v: number) => <span>{v} مخزن</span>,
    }] : [{
      title: 'الموقع', dataIndex: 'location', key: 'location', width: 190,
      ...textColumn(source, (r: any) => r.location),
    }]),
    { title: 'الكمية', dataIndex: 'quantity', key: 'quantity', width: 130, align: 'left' as const,
      ...numberColumn((r: any) => r.quantity),
      render: (v: any) => <b>{qty(v)}</b> },
    { title: 'العدد الفعلي', key: 'actual', align: 'left' as const, width: 140,
      ...numberColumn<any>((r) => actual[rowKey(r)]),
      render: (_: any, r: any) => (
        <InputNumber
          size="small" min={0} placeholder="—" style={{ width: '100%' }}
          data-grid-col="actual" keyboard={false}
          value={actual[rowKey(r)] ?? null}
          onChange={(v: any) => setActual((p) => ({ ...p, [rowKey(r)]: v as number | null }))}
        />
      ) },
    { title: 'الفرق', key: 'diff', align: 'left' as const, width: 130,
      ...choiceColumn<any>(
        [{ text: 'عجز', value: 'short' },
         { text: 'زيادة', value: 'over' },
         { text: 'مطابق', value: 'match' },
         { text: 'لم يُعدّ بعد', value: 'none' }],
        (r: any, v: string) => {
          const d = diffOf(r);
          if (v === 'none') return d === null;
          if (d === null) return false;
          if (v === 'match') return d === 0;
          return v === 'short' ? d > 0 : d < 0;
        }),
      render: (_: any, r: any) => {
        const d = diffOf(r);
        if (d === null) return <span style={{ color: '#8c8c8c' }}>—</span>;
        if (d === 0) return <Tag color="green">مطابق</Tag>;
        return (
          <a onClick={(e) => { e.stopPropagation(); openHistory(r); }}>
            <b style={{ color: d > 0 ? '#cf1322' : '#6AB42D' }}>
              {d > 0 ? `عجز ${qty(d)}` : `زيادة ${qty(Math.abs(d))}`}
            </b>
          </a>
        );
      } },
  ];

  const cols = useHiddenColumns(`stock-sheet-${view}`, []);
  const visibleColumns = cols.apply(columns);

  const kb = useTableKeyboard<any>({
    rows: shown, rowKey,
    onOpen: openHistory,
  });

  const cell = (c: any, r: any) => {
    if (c.key === 'actual') return actual[rowKey(r)] ?? '';
    if (c.key === 'diff') {
      const d = diffOf(r);
      return d === null ? '' : d === 0 ? 'مطابق' : d > 0 ? `عجز ${d}` : `زيادة ${Math.abs(d)}`;
    }
    return r[c.dataIndex] ?? '';
  };

  const forOutput = () => (picked.length
    ? shown.filter((r: any) => picked.includes(rowKey(r)))
    : shown);

  const withLogs = async (data: any[]) => {
    if (data.length > LOG_LIMIT) {
      message.info(`يُستخرج السجل لما لا يزيد عن ${LOG_LIMIT} صنف — حدّد الأصناف المطلوب سجلها.`);
      return null;
    }
    const from = logFrom ? logFrom.format('YYYY-MM-DD') : null;
    const to = logTo ? logTo.format('YYYY-MM-DD') : null;
    return Promise.all(data.map(async (r) => ({
      row: r,
      name: `${r.name}${r.location ? ` — ${r.location}` : ''}`,
      log: await fetchLog(
        {
          itemId: r.item_id,
          itemName: r.name,
          locationKind: general ? null : r.location_kind,
          locationId: general ? null : r.location_id,
        },
        from, to,
      ),
    })));
  };

  const exportCsv = async () => {
    const data = forOutput();
    if (!data.length) { message.info('لا توجد صفوف للتصدير'); return; }
    const visible = cols.apply(columns) as any[];
    const csvCols: CsvColumn<any>[] = visible.map((c) => ({
      title: String(c.title ?? ''),
      value: (r: any) => cell(c, r),
    }));
    const name = view === 'general' ? 'general-stock' : 'stock-sheet';
    const entries = await withLogs(data);
    if (entries) exportItemsWithLogs(name, csvCols, entries);
    else writeCsv(name, csvCols, data);
  };

  const printIt = async () => {
    const data = forOutput();
    if (!data.length) { message.info('لا توجد صفوف للطباعة'); return; }
    const visible = cols.apply(columns) as any[];
    const printCols: PrintColumn<any>[] = visible.map((c) => ({
      title: String(c.title ?? ''),
      value: (r: any) => cell(c, r),
      numeric: c.key === 'quantity' || c.key === 'actual' || c.key === 'diff',
    }));
    const entries = await withLogs(data);
    if (!entries) {
      printReport(
        {
          title: TITLES[view],
          date: dayjs().format('YYYY/MM/DD'),
          meta: [
            ...(filter.query ? [['بحث', filter.query] as [string, string]] : []),
            ['المطبوع', picked.length ? `${picked.length} صنف محدّد` : 'كل ما في الفلتر'],
          ],
        },
        printCols, data,
      );
      return;
    }
    printItemsWithLogs(
      {
        title: `${TITLES[view]} — بالسجل`,
        date: dayjs().format('YYYY/MM/DD'),
        meta: [
          ['فترة السجل', logFrom || logTo
            ? `${logFrom ? logFrom.format('YYYY/MM/DD') : '—'} ← ${logTo ? logTo.format('YYYY/MM/DD') : '—'}`
            : 'كل الحركات'],
        ],
      },
      printCols, entries,
    );
  };

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  const footer = (
    <span className="sl-foot">
      <span>المعروض: <b>{shown.length.toLocaleString(numeralsLocale())}</b>
        {' '}من {source.length.toLocaleString(numeralsLocale())} سطر</span>
      {picked.length > 0 && <span>المحدد: <b>{picked.length.toLocaleString(numeralsLocale())}</b></span>}
      <span>إجمالي الكمية: <b>{qty(sumQty)}</b></span>
      <span>قيمة المخزون: <b style={{ color: '#0B5CA8' }}>{money(sumValue)}</b></span>
    </span>
  );

  return (
    <ListPage
      icon={<ContainerOutlined />}
      title={TITLES[view]}
      actions={(<>
          <Button icon={<PrinterOutlined />} onClick={printIt}>
            {picked.length ? `طباعة (${picked.length})` : 'طباعة'}
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>
            {picked.length ? `تصدير (${picked.length})` : 'تصدير'}
          </Button>
          <ExportExcelButton
            name={TITLES[view]}
            rows={shown}
            tableColumns={visibleColumns}
            style={{ marginInlineStart: 0 }}
          />
          <ColumnSettings
            choices={columns.map((c: any) => ({
              key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
              locked: c.key === 'name',
            }))}
            hidden={cols.hidden} onChange={cols.setHidden}
            order={cols.order} onMove={(k, d) => cols.move(k, d, columns.map((c) => String(c.key ?? (c as any).dataIndex ?? '')))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load()}>تحديث</Button>
      </>)}
      filters={(<>
        <Input
          className="sl-f-search" allowClear ref={searchRef}
          prefix={<SearchOutlined />}
          placeholder="بحث بالكود أو الاسم أو الفئة أو الموقع"
          value={filter.query} onChange={(e) => filter.setQuery(e.target.value)}
        />
        <Select
          value={logPreset}
          onChange={(v) => {
            const key = v as LogPreset;
            setLogPreset(key);
            if (key === 'all') { setLogFrom(null); setLogTo(null); return; }
            if (key === 'custom') {
              setLogFrom(logFrom ?? dayjs().subtract(1, 'month'));
              setLogTo(logTo ?? dayjs());
              return;
            }
            setLogFrom(dayjs().subtract(LOG_MONTHS[key], 'month'));
            setLogTo(dayjs());
          }}
          options={[
            { value: 'all', label: 'سجل: كل الحركات' },
            { value: 'm1', label: 'سجل: آخر شهر' },
            { value: 'm3', label: 'سجل: آخر ٣ أشهر' },
            { value: 'm12', label: 'سجل: آخر سنة' },
            { value: 'custom', label: 'سجل: فترة محددة' },
          ]}
        />
        {logPreset === 'custom' && (
          <Space.Compact className="sl-f-dates">
            <DatePicker format="YYYY-MM-DD" placeholder="من" allowClear={false}
              style={{ width: '50%', height: 38 }} value={logFrom} onChange={setLogFrom} />
            <DatePicker format="YYYY-MM-DD" placeholder="إلى" allowClear={false}
              style={{ width: '50%', height: 38 }} value={logTo} onChange={setLogTo} />
          </Space.Compact>
        )}
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
    >
      <Table
        expandable={{
          expandedRowKeys: openRows,
          onExpandedRowsChange: (keys) => setOpenRows([...keys]),
          expandedRowRender: (r: any) => (
            <MovementHistoryLog
              target={historyTarget(r)}
              periodFilter={false}
              onClose={() => toggleRow(rowKey(r))}
            />
          ),
        }}
        {...kb.tableProps}
        rowSelection={{
          selectedRowKeys: picked,
          onChange: (keys) => setPicked(keys),
          preserveSelectedRowKeys: true,
        }}
        className="sl-table"
        rowKey={rowKey}
        size="small"
        loading={loading}
        dataSource={shown}
        columns={visibleColumns}
        tableLayout="fixed"
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'لا توجد أرصدة' }}
        pagination={{
          defaultPageSize: PAGE_SIZE, showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          locale: { items_per_page: '' },
          showTotal: () => footer,
        }}
        summary={(pageRows) => {
          const list = [...pageRows] as any[];
          const countedQty = list.reduce((t, r) => {
            const a = actual[rowKey(r)];
            return t + (a === null || a === undefined ? 0 : Number(a));
          }, 0);
          return (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
                {visibleColumns.map((c: any, i: number) => {
                  if (c.key === 'quantity') {
                    return (
                      <Table.Summary.Cell key={c.key} index={i} align="left">
                        <b>{qty(sumQty)}</b>
                      </Table.Summary.Cell>
                    );
                  }
                  if (c.key === 'actual') {
                    return (
                      <Table.Summary.Cell key={c.key} index={i} align="left">
                        <b style={{ color: '#0B5CA8' }}>{qty(countedQty)}</b>
                      </Table.Summary.Cell>
                    );
                  }
                  return (
                    <Table.Summary.Cell key={c.key} index={i}>
                      {i === 0 ? `المعروض: ${shown.length} سطر` : null}
                    </Table.Summary.Cell>
                  );
                })}
              </Table.Summary.Row>
            </Table.Summary>
          );
        }}
      />
    </ListPage>
  );
}

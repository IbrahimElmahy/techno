import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Space, Table, Tag, message } from 'antd';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import { textColumn, numberColumn } from '../components/gridColumns';
import MovementHistoryModal, { MovementHistoryTarget } from '../components/MovementHistoryModal';
import { useTableKeyboard } from '../components/keyboard';

/**
 * جرد المخازن · جرد عام المخازن — صفوف وأعمدة، وخلاص.
 *
 * Both entries used to land on رصيد صنف, which is a three-pane picker: choose a category, then an
 * item, then read that ONE item's balances. That answers «الصنف ده عندي منه كام» — a good screen,
 * and not the one these two menu items name. A جرد is a **sheet**: every line you hold, one row
 * each, that you scan down and filter and print and count against. You cannot count a warehouse by
 * clicking items one at a time.
 *
 * So this is a table and nothing else. Every column filters — by category, by warehouse, by a
 * quantity or value range — and the filters combine, because the question a count sheet is read
 * for is usually three conditions at once: «خامات مخزن الفرع اللي قيمتها فوق الألف».
 *
 * **The two views differ in one thing only: whether a warehouse is a column or is summed away.**
 *
 * * `جرد المخازن` — a row per صنف × مخزن. What is in each store.
 * * `جرد عام المخازن` — a row per صنف, the stores added together. What the company holds.
 *
 * That is the whole distinction, and it is the distinction their own two screens draw. Building it
 * as one screen with two shapes rather than two screens keeps the columns, the filters, the export
 * and the totals identical between them — which matters, because the two numbers get compared.
 *
 * Reads `GET /reports/stock-as-of` with no date: the same derivation جرد حتى تاريخ uses, asked
 * about today. One definition of «الرصيد» for every stocktake screen, rather than a second query
 * that agrees with it until one of them changes.
 */

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

/** A صنف with its stores added together — the «عام» shape. */
interface TotalRow {
  item_id: number;
  code: string | null;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  quantity: number;
  unit_cost: number;
  value: number;
  /** How many stores it sits in — «متفرّق في كام مخزن» is the first thing asked of a total. */
  locations: number;
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const TITLES: Record<string, string> = {
  count: 'جرد المخازن',
  general: 'جرد عام المخازن',
};

export default function StockSheet() {
  const [search] = useSearchParams();
  // Defaults to the per-warehouse sheet: it is the more detailed of the two, and a total can be
  // read off it by eye where the reverse is not true.
  const view = search.get('view') === 'general' ? 'general' : 'count';
  const general = view === 'general';

  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [costingMethod, setCostingMethod] = useState<string | null>(null);
  const [history, setHistory] = useState<MovementHistoryTarget | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/stock-as-of');
      setRows(res.data?.rows || []);
      setCostingMethod(res.data?.costing_method ?? null);
    } catch {
      message.error('تعذر تحميل الجرد');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  /**
   * The stores added together, for the «عام» view.
   *
   * The cost is the item's, not an average of the rows: every row of one item already carries the
   * same `unit_cost` — costing is per item, not per store — so averaging them would introduce a
   * rounding difference between the two views for no reason. The value is summed rather than
   * recomputed for the same reason: the total has to equal what the detailed sheet adds up to, or
   * the two screens disagree and nobody can say which is right.
   */
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
        quantity: Number(r.quantity || 0), unit_cost: Number(r.unit_cost || 0),
        value: Number(r.value || 0), locations: 1,
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

  // Every column filters and sorts. This is the part the screen exists for: a sheet you cannot
  // narrow is a sheet you print whole and read with a ruler.
  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 120,
      ...textColumn(source, (r: any) => r.code),
      render: (v: string | null) => (v
        ? <Tag style={{ direction: 'ltr' }}>{v}</Tag> : <span style={{ color: '#bbb' }}>-</span>) },
    { title: 'الصنف', dataIndex: 'name', key: 'name', ellipsis: true,
      ...textColumn(source, (r: any) => r.name),
      render: (v: string) => <b>{v}</b> },
    { title: 'الفئة', dataIndex: 'category', key: 'category', width: 160,
      ...textColumn(source, (r: any) => r.category),
      render: (v: string | null) => v || <span style={{ color: '#bbb' }}>بدون فئة</span> },
    // The one column that differs. In the general view it is replaced by how many stores the item
    // is spread across, which is the question a summed quantity immediately raises.
    ...(general ? [{
      title: 'موجود في', dataIndex: 'locations', key: 'locations', width: 120,
      ...numberColumn((r: any) => r.locations),
      render: (v: number) => <span>{v} مخزن</span>,
    }] : [{
      title: 'المخزن', dataIndex: 'location', key: 'location', width: 190,
      ...textColumn(source, (r: any) => r.location),
    }]),
    { title: 'الوحدة', dataIndex: 'unit_of_measure', key: 'unit', width: 100,
      ...textColumn(source, (r: any) => r.unit_of_measure),
      render: (v: string | null) => v || '-' },
    { title: 'الكمية', dataIndex: 'quantity', key: 'quantity', width: 130, align: 'left' as const,
      ...numberColumn((r: any) => r.quantity),
      render: (v: any) => <b style={{ color: '#6AB42D' }}>{qty(v)}</b> },
    { title: 'التكلفة', dataIndex: 'unit_cost', key: 'unit_cost', width: 130, align: 'left' as const,
      ...numberColumn((r: any) => r.unit_cost),
      render: (v: any) => money(v) },
    { title: 'القيمة', dataIndex: 'value', key: 'value', width: 150, align: 'left' as const,
      ...numberColumn((r: any) => r.value),
      render: (v: any) => <b style={{ color: '#0B5CA8' }}>{money(v)} ج.م</b> },
  ];

  const cols = useHiddenColumns(`stock-sheet-${view}`, []);

  const rowKey = (r: any) => (general ? `i${r.item_id}` : `${r.item_id}-${r.location_kind}-${r.location_id}`);

  const kb = useTableKeyboard<any>({
    rows: shown, rowKey,
    // «الرقم ده جه منين» — the movements behind the quantity, scoped to the store when the sheet
    // is showing stores and to the item as a whole when it is not.
    onOpen: (r) => setHistory({
      itemId: r.item_id, itemName: r.name,
      locationKind: general ? null : r.location_kind,
      locationId: general ? null : r.location_id,
    }),
  });

  /** Exported straight from what is on screen — filters, order and all. */
  const exportCsv = () => {
    if (!shown.length) { message.info('مفيش صفوف للتصدير'); return; }
    const heads = cols.apply(columns).map((c: any) => c.title);
    const keys = cols.apply(columns).map((c: any) => c.dataIndex);
    const lines = [heads.join(','), ...shown.map((r: any) =>
      keys.map((k: string) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))];
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${view === 'general' ? 'general-stock' : 'stock-sheet'}.csv`;
    a.click();
  };

  return (
    <Card
      title={(
        <Space>
          <span>{TITLES[view]}</span>
          {costingMethod && <Tag color="blue">التكلفة: {costingMethod}</Tag>}
        </Space>
      )}
      extra={(
        <Space>
          <ColumnSettings
            choices={columns.map((c: any) => ({
              key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
              locked: c.key === 'name',
            }))}
            hidden={cols.hidden} onChange={cols.setHidden}
          />
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>تصدير</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      <ListToolbar
        searchPlaceholder="بحث بالكود أو الاسم أو الفئة أو المخزن"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={source.length} shown={shown.length}
      />

      <Table
        {...kb.tableProps}
        rowKey={rowKey}
        size="small"
        loading={loading}
        dataSource={shown}
        columns={cols.apply(columns)}
        tableLayout="fixed"
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: 'مفيش أرصدة' }}
        pagination={{
          defaultPageSize: 50, showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100', '200', '500'],
          showTotal: (t) => `الإجمالي: ${t} سطر`,
        }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
              {/*
                * One cell per VISIBLE column, filled by key rather than by counting.
                *
                * A summary written as «span the first five, then three cells» is right until
                * somebody hides a column from الأعمدة, and then the totals sit under the wrong
                * headings — which is worse than no totals, because they are still read.
                *
                * And the totals follow the FILTER, not the whole sheet: a total that ignores the
                * narrowing you just applied answers a question you stopped asking.
                */}
              {cols.apply(columns).map((c: any, i: number) => {
                if (c.key === 'quantity') {
                  return (
                    <Table.Summary.Cell key={c.key} index={i} align="left">
                      <b style={{ color: '#6AB42D' }}>{qty(sumQty)}</b>
                    </Table.Summary.Cell>
                  );
                }
                if (c.key === 'value') {
                  return (
                    <Table.Summary.Cell key={c.key} index={i} align="left">
                      <b style={{ color: '#0B5CA8' }}>{money(sumValue)} ج.م</b>
                    </Table.Summary.Cell>
                  );
                }
                return (
                  <Table.Summary.Cell key={c.key} index={i}>
                    {i === 0 ? 'إجمالي المعروض' : null}
                  </Table.Summary.Cell>
                );
              })}
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />

      <MovementHistoryModal target={history} onClose={() => setHistory(null)} />
    </Card>
  );
}

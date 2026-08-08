import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, InputNumber, Row, Select, Statistic, Table, Tag,
  message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { choiceColumn, numberColumn, textColumn } from '../components/gridColumns';
import MovementHistoryModal, { MovementHistoryTarget } from '../components/MovementHistoryModal';
import { useTableKeyboard } from '../components/keyboard';

/**
 * جرد حق تاريخ — the stock as it stood on a chosen day, valued at cost.
 *
 * Today's balance cannot answer "what did we have on the 31st". This is the same derivation cut
 * off at a date, so a document typed late still lands on the day it happened and the count for a
 * closed month does not drift as the month after it trades.
 */

interface Row {
  item_id: number; code: string | null; name: string;
  // الفئة. `stock_as_of` returns it and this screen was dropping it on the floor — a count is read
  // one category at a time, and without the column the only way there was a name search per item.
  category: string | null;
  unit_of_measure: string | null; location: string;
  quantity: string; unit_cost: string; value: string;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

const METHOD_LABELS: Record<string, string> = {
  average: 'المتوسط المرجح',
  last_purchase: 'آخر سعر شراء',
};

export default function Stocktake() {
  /**
   * جرد من تاريخ إلى تاريخ.
   *
   * The quantity is the balance **at the «إلى» date** — a balance is a running total to a moment,
   * and summing only the movements inside a window would give net movement over it, which is a
   * different number and not a stocktake.
   *
   * The «من» date is what the movement log opens on: «إيه اللي حصل في الفترة دي» is the question a
   * difference raises, and reciting the item's whole life instead is not an answer to it.
   */
  const [dateFrom, setDateFrom] = useState<Dayjs>(dayjs().startOf('month'));
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
  /**
   * العدد الفعلي — اللي على أرض الواقع، بيتكتب هنا.
   *
   * Held on screen and NOT saved: settling a difference belongs to جرد المخازن, which has the
   * document, the frozen book quantity and the posting behind it. One way to change stock beats
   * two with different rules — and the screen says so, so nobody types a hundred counts expecting
   * them to be kept.
   */
  const [actual, setActual] = useState<Record<string, number | null>>({});
  const [history, setHistory] = useState<MovementHistoryTarget | null>(null);
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

  // Only the «إلى» date changes the balances. «من» scopes the history a row drills into, so
  // changing it must not cost a reload of the whole report.
  useEffect(() => { load(); }, [asOf, warehouseId]);

  const rowKey = (r: Row) => `${r.item_id}-${r.location}`;
  /** الفرق = اللي في النظام − اللي اتعدّ. Null until somebody counts, which is not zero. */
  const diffOf = (r: Row) => {
    const a = actual[rowKey(r)];
    if (a === null || a === undefined) return null;
    return Number(r.quantity || 0) - a;
  };

  const filter = useListFilter(rows, { search: (r) => [r.code, r.name, r.category, r.location] });

  const exportCsv = () => {
    if (!rows.length) { message.info('لا توجد أرصدة للتصدير'); return; }
    // The export follows the columns. A file whose headings say «تكلفة الوحدة» over a column of
    // counted quantities is worse than no export — it is read once, believed, and filed.
    const heads = ['الكود', 'الصنف', 'الفئة', 'الوحدة', 'الموقع', 'الكمية في النظام',
      'العدد الفعلي', 'الفرق'];
    const lines = [heads.join(',')];
    filter.filtered.forEach((r) => {
      const a = actual[rowKey(r)];
      const d = diffOf(r);
      lines.push([
        r.code ?? '', r.name, r.category ?? '', r.unit_of_measure ?? '', r.location,
        r.quantity,
        a === null || a === undefined ? '' : a,
        d === null ? '' : d,
      ].map((v) => `"${v}"`).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stocktake-${asOf.format('YYYY-MM-DD')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // أي سطر في الجرد يفتح سجل حركاته — «الفرق ده جه منين» مالهاش إجابة غير دي.
  const kb = useTableKeyboard<Row>({
    rows: filter.filtered, rowKey: (r) => `${r.item_id}-${r.location}`,
    onOpen: (r) => setHistory({
      itemId: r.item_id, itemName: r.name,
      dateFrom: dateFrom.format('YYYY-MM-DD'), dateTo: asOf.format('YYYY-MM-DD'),
    }),
  });

  return (
    <Card
      title="جرد حق تاريخ"
      extra={(
        <>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!rows.length}
            style={{ marginInlineEnd: 8 }}>تصدير CSV</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={10}>
          {/* «إلى» is the day the balance is read at; «من» opens the movement log on the period.
              Two dates because a difference is a question about a stretch of time, not a day. */}
          <DatePicker.RangePicker
            style={{ width: '100%' }} allowClear={false}
            value={[dateFrom, asOf] as any}
            onChange={(v: any) => {
              if (!v || !v[0] || !v[1]) return;
              setDateFrom(v[0]);
              setAsOf(v[1]);
            }}
            placeholder={['من تاريخ', 'الرصيد حتى']}
          />
        </Col>
        <Col xs={24} md={8}>
          <Select
            allowClear style={{ width: '100%' }} placeholder="كل المخازن"
            value={warehouseId} onChange={setWarehouseId}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </Col>
      </Row>

      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="الشاشة دي للمراجعة — العدد الفعلي اللي بتكتبه هنا مابيتحفظش"
        description="بتحسب الفرق وبتوريك الحركات وراه. تسوية الفرق في المخزون بتتعمل من «جرد المخازن»، اللي عنده المستند والرصيد المجمّد والترحيل." />

      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message={`الأرصدة زي ما كانت يوم ${asOf.format('YYYY-MM-DD')} — كل حركة لحد اليوم ده وبس.`}
        description={method
          ? `التقييم بطريقة «${METHOD_LABELS[method] || method}» (تتغيّر من إعدادات المخزون).`
          : undefined}
      />

      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={8}>
          <Card size="small"><Statistic title="عدد السطور" value={totals?.lines ?? 0} /></Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="إجمالي الكمية" value={qty(totals?.quantity)} />
          </Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="قيمة المخزون" value={money(totals?.value)}
              valueStyle={{ color: '#0B5CA8' }} />
          </Card>
        </Col>
      </Row>

      <ListToolbar
        searchPlaceholder="بحث بالصنف أو الكود أو الموقع"
        query={filter.query} onQueryChange={filter.setQuery} onReset={filter.reset}
        total={rows.length} shown={filter.filtered.length} searchSpan={10}
      />

      <Table<Row>
        {...kb.tableProps}
        rowKey={(r) => `${r.item_id}-${r.location}`} size="small" loading={loading}
        dataSource={filter.filtered}
        locale={{ emptyText: 'لا توجد أرصدة في هذا التاريخ' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        // Every column filters and sorts on its own, and the narrowings combine — «خامات مخزن
        // الفرع اللي قيمتها فوق الألف» is three columns at once, and a single search box above the
        // table cannot express it however good the search is.
        columns={[
          { title: 'الكود', dataIndex: 'code', ...textColumn(rows, (r: Row) => r.code),
            render: (c: string) => (c ? <Tag>{c}</Tag> : '-') },
          { title: 'الصنف', dataIndex: 'name', ...textColumn(rows, (r: Row) => r.name),
            render: (n: string) => <b>{n}</b> },
          { title: 'الفئة', dataIndex: 'category', width: 150,
            ...textColumn(rows, (r: Row) => r.category),
            render: (c: string | null) => c || <span style={{ color: '#bbb' }}>بدون فئة</span> },
          { title: 'الوحدة', dataIndex: 'unit_of_measure',
            ...textColumn(rows, (r: Row) => r.unit_of_measure),
            render: (u: string) => u || '-' },
          { title: 'الموقع', dataIndex: 'location',
            ...textColumn(rows, (r: Row) => r.location) },
          { title: 'الكمية', dataIndex: 'quantity', align: 'left' as const,
            ...numberColumn((r: Row) => r.quantity),
            render: (v: string) => <b>{qty(v)}</b> },
          // العدد الفعلي — typed here, held on screen, never posted. The line under the table
          // says so, because a hundred counts typed into a screen that keeps none of them is a
          // morning lost.
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
               { text: 'لسه ماتعدش', value: 'none' }],
              (r: Row, v: string) => {
                const d = diffOf(r);
                if (v === 'none') return d === null;
                if (d === null) return false;
                if (v === 'match') return d === 0;
                // «عجز» = النظام بيقول أكتر من اللي لقيناه.
                return v === 'short' ? d > 0 : d < 0;
              }),
            render: (_: any, r: Row) => {
              const d = diffOf(r);
              if (d === null) return <span style={{ color: '#bbb' }}>—</span>;
              if (d === 0) return <Tag color="green">مطابق</Tag>;
              // Only a real difference is a link. One that opens an empty log teaches people the
              // link is broken, and then they stop using the one that works.
              return (
                <a onClick={() => setHistory({
                  itemId: r.item_id, itemName: r.name,
                  dateFrom: dateFrom.format('YYYY-MM-DD'),
                  dateTo: asOf.format('YYYY-MM-DD'),
                })}>
                  <b style={{ color: d > 0 ? '#cf1322' : '#6AB42D' }}>
                    {d > 0 ? `عجز ${qty(d)}` : `زيادة ${qty(Math.abs(d))}`}
                  </b>
                </a>
              );
            } },
        ]}
        // The bottom line follows the filters: a total that ignores them answers a question nobody
        // asked, and reads as if the filter had not applied.
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
                <strong style={{ color: '#0B5CA8' }}>{money(total)} ج.م</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
      />
      <MovementHistoryModal target={history} onClose={() => setHistory(null)} />
    </Card>
  );
}

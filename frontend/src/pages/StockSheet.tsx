import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Row, Select, Space, Statistic, Table, Tag, message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { InputNumber } from '../components/NumberInput';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import { textColumn, numberColumn, choiceColumn } from '../components/gridColumns';
import MovementHistoryLog from '../components/MovementHistoryLog';
import { useTableKeyboard } from '../components/keyboard';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';

/**
 * جرد المخازن · جرد عام المخازن — صفوف وأعمدة، وخلاص.
 *
 * Both entries used to land on رصيد صنف, which is a three-pane picker: choose a category, then an
 * item, then read that ONE item's balances. That answers «الصنف ده عندي منه كام» — a good screen,
 * and not the one these two menu items name. A جرد is a **sheet**: every line you hold, one row
 * each, that you scan down and filter and print and count against. You cannot count a warehouse by
 * clicking items one at a time.
 *
 * So this is a table and nothing else, carrying the same columns as جرد حتى تاريخ so the three
 * stocktake screens read as one family. Every column filters and sorts, and the filters combine,
 * because the question a count sheet is read for is usually two or three conditions at once:
 * «خامات مخزن الفرع اللي فيها عجز».
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
  value: number;
  /** How many stores it sits in — «متفرّق في كام مخزن» is the first thing asked of a total. */
  locations: number;
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** Same labels as جرد حتى تاريخ, because it is the same setting being reported. */
const METHOD_LABELS: Record<string, string> = {
  average: 'المتوسط المرجح',
  last_purchase: 'آخر سعر شراء',
};

const TITLES: Record<string, string> = {
  count: 'جرد المخازن',
  general: 'جرد عام المخازن',
};

/** فترات سجل الحركات الجاهزة — واحدة للورقة كلها. */
type LogPreset = 'all' | 'm1' | 'm3' | 'm12' | 'custom';
const LOG_MONTHS: Record<'m1' | 'm3' | 'm12', number> = { m1: 1, m3: 3, m12: 12 };

export default function StockSheet() {
  const [search] = useSearchParams();
  // Defaults to the per-warehouse sheet: it is the more detailed of the two, and a total can be
  // read off it by eye where the reverse is not true.
  const view = search.get('view') === 'general' ? 'general' : 'count';
  const general = view === 'general';

  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [costingMethod, setCostingMethod] = useState<string | null>(null);
  // نفس منطق «جرد حتى تاريخ»: السجل تحت سطره، وأكتر من واحد مفتوح مع بعض — قراية الجرد
  // مقارنة، والمقارنة مابتحصلش واحد واحد.
  const [openRows, setOpenRows] = useState<React.Key[]>([]);

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
   * The value is summed rather than recomputed from a quantity and a cost: the total has to equal
   * what the detailed sheet adds up to, or the two screens disagree about what the stock is worth
   * and nobody can say which is right.
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

  /**
   * العدد الفعلي — بيتكتب هنا، وبيفضل على الشاشة، ومابيترحّلش.
   *
   * The same as جرد حتى تاريخ, and for the same reason: this is a sheet you read and count
   * against, not a document. Posting the difference has an owner — دورة الجرد — which has a
   * document number, a frozen book balance and a posting step, and two screens that both adjust
   * stock is two screens that can adjust it twice.
   *
   * The notice under the toolbar says so in as many words, because a hundred counts typed into a
   * screen that keeps none of them is a morning lost.
   */
  const [actual, setActual] = useState<Record<string, number | null>>({});

  /** موجب = العجز. النظام بيقول أكتر من اللي اتعدّ. */
  const diffOf = (r: any): number | null => {
    const a = actual[rowKey(r)];
    if (a === null || a === undefined) return null;
    return Number(Number(r.quantity || 0) - a);
  };

  /** بيفتح أو بيقفل سجل سطر — من غير ما يلمس الباقي. */
  const toggleRow = (key: React.Key) =>
    setOpenRows((prev) => (prev.includes(key)
      ? prev.filter((k) => k !== key) : [...prev, key]));

  const openHistory = (r: any) => toggleRow(rowKey(r));

  /**
   * فترة السجل — **واحدة للورقة كلها**.
   *
   * كل صنف كان بيفتح سجله بفلتر فترة خاص بيه. يعني اللي بيراجع عشرين صنف بيظبط نفس
   * التاريخ عشرين مرة، والأخطر إنه يقارن صنف على آخر شهر بصنف على السنة كلها من غير ما
   * ياخد باله — الأرقام جنب بعض والفترة مختلفة.
   *
   * فبقت فوق مرة واحدة، والسجلات كلها بتتبعها.
   */
  const [logPreset, setLogPreset] = useState<LogPreset>('all');
  const [logFrom, setLogFrom] = useState<Dayjs | null>(null);
  const [logTo, setLogTo] = useState<Dayjs | null>(null);

  const historyTarget = (r: any) => ({
    dateFrom: logFrom ? logFrom.format('YYYY-MM-DD') : null,
    dateTo: logTo ? logTo.format('YYYY-MM-DD') : null,
    itemId: r.item_id, itemName: r.name,
    // Scoped to the store when the sheet is showing stores, and to the item as a whole when it is
    // summing them — the log has to answer the question the row was asking.
    locationKind: general ? null : r.location_kind,
    locationId: general ? null : r.location_id,
  });

  /**
   * نفس أعمدة «جرد حتى تاريخ»، بالظبط.
   *
   * The three stocktake screens are read side by side and their numbers get compared, so they are
   * laid out the same way: الكود · الصنف · الفئة · الوحدة · الموقع · الكمية · العدد الفعلي ·
   * الفرق. A column that appears on one and not another makes the reader check whether they are
   * looking at the same thing.
   *
   * **No cost column.** A count sheet is about how many, not how much — the person holding it is
   * counting boxes on a shelf, and a unit cost beside every line is a number they cannot check and
   * did not ask for. The stock's value is still on the summary line and the cards above, which is
   * where a manager reads it.
   *
   * الفئة is shown, and جرد حتى تاريخ grew the same column so the three still match.
   */
  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 120,
      ...textColumn(source, (r: any) => r.code),
      render: (v: string | null) => (v
        ? <Tag style={{ direction: 'ltr' }}>{v}</Tag> : <span style={{ color: '#8c8c8c' }}>-</span>) },
    { title: 'الصنف', dataIndex: 'name', key: 'name', ellipsis: true,
      ...textColumn(source, (r: any) => r.name),
      render: (v: string) => <b>{v}</b> },
    { title: 'الفئة', dataIndex: 'category', key: 'category', width: 160,
      ...textColumn(source, (r: any) => r.category),
      render: (v: string | null) => v || <span style={{ color: '#8c8c8c' }}>بدون فئة</span> },
    { title: 'الوحدة', dataIndex: 'unit_of_measure', key: 'unit', width: 100,
      ...textColumn(source, (r: any) => r.unit_of_measure),
      render: (v: string | null) => v || '-' },
    // The one column the two views differ on. Summing the stores away leaves «الموقع» with nothing
    // to say, so it becomes how many stores the item is spread across — the question a summed
    // quantity immediately raises.
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
      // فلتر على اللي اتعدّ نفسه، مش على الفرق: «وريني اللي عدّيته فوق المية» سؤال
      // بيتسأل وانت واقف بتعدّ، ومالهوش عمود تاني يجاوبه.
      ...numberColumn<any>((r) => actual[rowKey(r)]),
      render: (_: any, r: any) => (
        // `data-grid-col` is what gives the column its keyboard: ↑↓ walk it and Enter drops to the
        // box below, which is the rhythm of counting a shelf without looking up.
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
         { text: 'لسه ماتعدش', value: 'none' }],
        (r: any, v: string) => {
          const d = diffOf(r);
          if (v === 'none') return d === null;
          if (d === null) return false;
          if (v === 'match') return d === 0;
          // «عجز» = النظام بيقول أكتر من اللي لقيناه.
          return v === 'short' ? d > 0 : d < 0;
        }),
      render: (_: any, r: any) => {
        const d = diffOf(r);
        if (d === null) return <span style={{ color: '#8c8c8c' }}>—</span>;
        if (d === 0) return <Tag color="green">مطابق</Tag>;
        // Only a real difference is a link, the same rule جرد حتى تاريخ uses: a link that opens an
        // empty log teaches people the link is broken, and then they stop using the one that works.
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

  const kb = useTableKeyboard<any>({
    rows: shown, rowKey,
    // «الرقم ده جه منين» — the movements behind the quantity.
    onOpen: openHistory,
  });

  /** Exported straight from what is on screen — filters, order and all. */
  const exportCsv = () => {
    if (!shown.length) { message.info('مفيش صفوف للتصدير'); return; }
    const visible = cols.apply(columns) as any[];
    // العدد الفعلي والفرق محسوبين، مالهمش `dataIndex` يتقرا منه — ولولا ده كانوا هيتصدّروا
    // عمودين فاضيين بعناوين، وهي أسوأ من إنهم مايتصدّروش.
    const cell = (c: any, r: any) => {
      if (c.key === 'actual') return actual[rowKey(r)] ?? '';
      if (c.key === 'diff') {
        const d = diffOf(r);
        return d === null ? '' : d === 0 ? 'مطابق' : d > 0 ? `عجز ${d}` : `زيادة ${Math.abs(d)}`;
      }
      return r[c.dataIndex] ?? '';
    };
    const csvCols: CsvColumn<any>[] = visible.map((c) => ({
      title: String(c.title ?? ''),
      value: (r: any) => cell(c, r),
    }));
    writeCsv(view === 'general' ? 'general-stock' : 'stock-sheet', csvCols, shown);
  };

  return (
    <Card
      title={TITLES[view]}
      extra={(
        <Space>
          {/* فترة سجل الحركات — بتتحدّد هنا مرة وبتتطبّق على كل صنف يتفتح تحته. */}
          <Select
            size="small" style={{ minWidth: 130 }} value={logPreset}
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
              { value: 'all', label: 'كل الحركات' },
              { value: 'm1', label: 'آخر شهر' },
              { value: 'm3', label: 'آخر ٣ شهور' },
              { value: 'm12', label: 'آخر سنة' },
              { value: 'custom', label: 'فترة محددة' },
            ]}
          />
          {logPreset === 'custom' && (
            <>
              <DatePicker size="small" format="YYYY-MM-DD" placeholder="من" allowClear={false}
                style={{ width: 128 }} value={logFrom} onChange={setLogFrom} />
              <DatePicker size="small" format="YYYY-MM-DD" placeholder="إلى" allowClear={false}
                style={{ width: 128 }} value={logTo} onChange={setLogTo} />
            </>
          )}
          <ColumnSettings
            choices={columns.map((c: any) => ({
              key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
              locked: c.key === 'name',
            }))}
            hidden={cols.hidden} onChange={cols.setHidden}
            order={cols.order} onMove={(k, d) => cols.move(k, d, columns.map((c) => String(c.key ?? (c as any).dataIndex ?? '')))}
          />
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>تصدير</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
        </Space>
      )}
    >
      {/* التنبيه اللي كان هنا اتشال بطلب صاحب النظام.
          كان بيقول إن الورقة للعدّ والمراجعة وإن التسوية بتتعمل من «دورة الجرد» —
          تلات سطور فوق ورقة بتتقرا كل يوم، بتتقال مرة وتتقرا مية. */}
      {/* نفس الكروت اللي فوق «جرد حتى تاريخ»، عشان التلات شاشات تتقرا بنفس العين. */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={8}>
          <Card size="small"><Statistic title="عدد السطور" value={shown.length} /></Card>
        </Col>
        <Col xs={8}>
          <Card size="small"><Statistic title="إجمالي الكمية" value={qty(sumQty)} /></Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="قيمة المخزون" value={money(sumValue)}
              valueStyle={{ color: '#0B5CA8' }} />
          </Card>
        </Col>
      </Row>

      <ListToolbar
        searchPlaceholder="بحث بالكود أو الاسم أو الفئة أو الموقع"
        query={filter.query} onQueryChange={filter.setQuery}
        values={filter.values} onValueChange={filter.setValue}
        onReset={filter.reset}
        total={source.length} shown={shown.length}
      />

      <Table
        // السجل بيتفتح تحت السطر بتاعه، وأكتر من سطر مع بعض.
        expandable={{
          expandedRowKeys: openRows,
          onExpandedRowsChange: (keys) => setOpenRows([...keys]),
          expandedRowRender: (r: any) => (
            <MovementHistoryLog
              target={historyTarget(r)}
              // الفترة بتتحدّد فوق الورقة مرة واحدة — مش في كل صنف.
              periodFilter={false}
              onClose={() => toggleRow(rowKey(r))}
            />
          ),
        }}
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
        summary={(pageRows) => {
          /*
           * One cell per VISIBLE column, filled by key rather than by counting.
           *
           * A summary written as «span the first five, then three cells» is right until somebody
           * hides a column from الأعمدة, and then the totals sit under the wrong headings — which
           * is worse than no totals, because they are still read.
           *
           * The counted total is of what is ON SCREEN, the same as the quantity beside it: a
           * «counted» figure that included rows the filter took away would say the count is
           * further along than it is.
           */
          const list = [...pageRows] as any[];
          const countedQty = list.reduce((t, r) => {
            const a = actual[rowKey(r)];
            return t + (a === null || a === undefined ? 0 : Number(a));
          }, 0);
          return (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
                {cols.apply(columns).map((c: any, i: number) => {
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

    </Card>
  );
}

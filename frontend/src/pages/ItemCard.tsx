import React, { useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import {
  Alert, Button, Card, Col, DatePicker, Empty, Row, Select, Statistic, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, dateColumn } from '../components/gridColumns';
import DocumentLink, { docKindOf, useOpenDocument } from '../components/DocumentLink';
import type { ColumnsType } from 'antd/es/table';
import { useTableColumns } from '../components/ColumnSettings';
import DateRangeFilter from '../components/DateRangeFilter';
import { exportCsv as writeCsv, type CsvColumn } from '../utils/exportCsv';
import { printReport, type PrintColumn } from '../print/reportSheet';

import StatsRow from '../components/StatsRow';
import { useMovementLabels, useMovementTypes } from '../lib/movementTypes';
import { useLookup, labelMap } from '../hooks/useLookup';
import { compareArabic, searchFilter, searchRank } from '../utils/arabicSort';
import { qty, money } from '../utils/money';
/**
 * كارت الصنف — every movement of one item with the balance before it and the balance after it.
 *
 * A movement list says what happened; a card says what you had. That is the point of the two
 * balance columns: any row can be read on its own, and a disputed count can be traced back to
 * the movement that caused it.
 *
 * Filtering is done on the server precisely because the balances must not be recomputed from
 * what happens to be visible — hiding the purchases must not make the sale look like it drew
 * from nothing.
 */

/**
 * **الاسمين الاتنين مقصودين.** الحركة اتكتبت بتسميتين على مدى المشروع: `sale_out`
 * و`sale`، `purchase_in` و`purchase`، `opening_in` و`opening`. الخريطة كانت شايلة
 * الأولانية بس، فالكارت كان بيطبع «sale» و«opening» بالإنجليزي جنب «تحويل وارد»
 * بالعربي — والاسم الخام ده هو أكتر نوع حركة في الداتا أصلاً.
 *
 * الحل هنا مش إعادة تسمية الحركات في القاعدة: ده عمود مكتوب على ملايين الصفوف
 * ومقروء من تقارير تانية. الخريطة بتعرف الاتنين.
 */

interface CardRow {
  movement_id: number;
  date: string | null;
  movement_type: string;
  movement_label?: string | null;
  direction: 'in' | 'out';
  quantity_in: string;
  quantity_out: string;
  balance_before: string;
  balance_after: string;
  location: string;
  source_doc_type: string | null;
  source_doc_id: number | null;
  is_reversal: boolean;
  // (031) Read off the source document rather than stored on the movement: the party it was with,
  // its own number, what the line was priced and totalled at, and — for a perishable — the lot
  // FEFO drew from.
  party: string | null;
  document_number: string | null;
  unit_price: string | null;
  line_total: string | null;
  expiry_date: string | null;
  // The unit the line was traded in and the quantity in it, beside the pieces the card counts in.
  unit: string | null;
  quantity_in_unit: string | null;
  discount_pct: string | null;
  tax_amount: string | null;
}

interface CardOut {
  item_id: number; item_name: string; item_code: string | null;
  unit_of_measure: string | null; location: string;
  opening_balance: string; closing_balance: string;
  total_in: string; total_out: string; rows: CardRow[];
}

export default function ItemCard() {
  // الأسماء العربية والقايمة من الخادم — نسخة واحدة لكل الشاشات.
  const moveLabels = useMovementLabels();
  const moveTypes = useMovementTypes();
  const [items, setItems] = useState<any[]>([]);
  /**
   * **الفئة الأول، وبعدين الصنف.**
   *
   * القايمة فيها ٢٬٦٤٠ صنف، وأسماء زي «كوع ١ فاتح» و«كوع ١" ابيض عاده» بتفرق في كلمة
   * — فاللي بيدوّر بيقرا عشرين سطر متشابه عشان يلاقي بتاعه. اختيار الفئة بيقلّل
   * القايمة لأصناف الفئة وبس، وبعدها الاسم بيبان لوحده.
   *
   * وفاضية = كل الفئات، فاللي بيعرف اسم صنفه بالظبط مابيتفرضش عليه خطوة زيادة.
   */
  const [category, setCategory] = useState<string | undefined>();
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);

  /** الفئات اللي فيها أصناف فعلاً — مش كل اللي في قايمة الإعدادات. */
  const categories = useMemo(
    () => ([...new Set(items.map((i: any) => i.category).filter(Boolean))] as string[])
      .sort(compareArabic),
    [items],
  );

  /** الأصناف المعروضة — بتاعة الفئة المختارة، أو الكل لو مافيش فئة. */
  const pickableItems = useMemo(
    () => (category ? items.filter((i: any) => i.category === category) : items),
    [items, category],
  );
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [itemId, setItemId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  /**
   * **الفترة ممكن تكون نص فاضية.** `RangePicker` بيرجّع `[null, null]` أو `[Dayjs, null]`
   * لما اللي بيستعمله يمسح طرف واحد، والنوع `[Dayjs, Dayjs]` بيخفي ده — فالفحص
   * `if (range)` بيعدّي و`.format` بتنهار على `null`. نفس العطل اللي كان بيفضّي كشف
   * الحساب. `fullRange()` هي المكان الوحيد اللي بيقرّر إن الفترة مكتملة.
   */
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [movementType, setMovementType] = useState<string | undefined>();
  const [card, setCard] = useState<CardOut | null>(null);
  const [loading, setLoading] = useState(false);
  // ?item=<id> — arrived at from the item's own file, which already knows which item this is.
  const [search] = useSearchParams();
  const askedItem = Number(search.get('item')) || undefined;
  useEffect(() => { if (askedItem) setItemId(askedItem); }, [askedItem]);

  useEffect(() => {
    Promise.all([api.get('/api/v1/items'), api.get('/api/v1/warehouses')])
      .then(([i, w]) => { setItems(i.data || []); setWarehouses(w.data || []); })
      .catch(console.error);
  }, []);

  /** الطرفين مع بعض، أو `null` — الفترة النص مالهاش معنى هنا. */
  const fullRange = (): [Dayjs, Dayjs] | null =>
    (range && range[0] && range[1] ? [range[0], range[1]] : null);

  const load = async () => {
    if (!itemId) { setCard(null); return; }
    setLoading(true);
    try {
      const params: any = {};
      if (warehouseId) { params.location_kind = 'warehouse'; params.location_id = warehouseId; }
      const r = fullRange();
      if (r) {
        params.date_from = r[0].format('YYYY-MM-DD');
        params.date_to = r[1].format('YYYY-MM-DD');
      }
      if (movementType) params.movement_type = movementType;
      const res = await api.get(`/api/v1/items/${itemId}/card`, { params });
      setCard(res.data);
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر تحميل كارت الصنف');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [itemId, warehouseId, range, movementType]);

  const exportCsv = () => {
    if (!card?.rows.length) { message.info('لا توجد حركات للتصدير'); return; }
    const cols: CsvColumn<any>[] = [
      { title: 'التاريخ', value: 'date' },
      { title: 'النوع', value: (r) => r.movement_label || moveLabels[r.movement_type] || r.movement_type },
      { title: 'وارد', value: 'quantity_in' },
      { title: 'منصرف', value: 'quantity_out' },
      { title: 'الرصيد قبل', value: 'balance_before' },
      { title: 'الرصيد بعد', value: 'balance_after' },
      { title: 'الموقع', value: 'location' },
      { title: 'المستند',
        value: (r) => (r.source_doc_id ? `${r.source_doc_type}#${r.source_doc_id}` : '') },
    ];
    writeCsv(`item-card-${card.item_code || card.item_id}`, cols, card.rows);
  };

  const printIt = () => {
    if (!card) return;
    const cols: PrintColumn<any>[] = [
      { title: 'التاريخ', value: 'date' },
      { title: 'النوع', value: (r) => r.movement_label || moveLabels[r.movement_type] || r.movement_type },
      { title: 'وارد', value: 'quantity_in', numeric: true },
      { title: 'منصرف', value: 'quantity_out', numeric: true },
      { title: 'الرصيد بعد', value: 'balance_after', numeric: true },
      { title: 'الموقع', value: 'location' },
    ];
    printReport(
      { title: 'كارت صنف', number: card.item_code || undefined,
        meta: [['الصنف', card.item_name ?? '']] },
      cols, card.rows,
    );
  };

  // قراية الكارت هي سؤال «الحركة دي جات منين؟»، فالسطر يفتح مستندها. الحركات اللي مالهاش شاشة
  // مستند (تحويل، تصنيع، جرد) بتفضل ساكتة بدل ما تودّي على قايمة.
  // The distinct values a column filter offers come from ALL the rows, not the page —
  // a list that changes as you page through is one nobody trusts.
  const cardRows: CardRow[] = card?.rows ?? [];
  const openDoc = useOpenDocument();
  const kb = useTableKeyboard<CardRow>({
    rows: card?.rows ?? [], rowKey: (r) => r.movement_id,
    onOpen: (r) => {
      const kind = docKindOf(r.source_doc_type);
      if (kind && r.source_doc_id) openDoc(kind, r.source_doc_id);
    },
  });

  const columns: ColumnsType<CardRow> = [
    /**
     * **الأحدث فوق.** السيرفر بيرجّع الحركات بترتيب زمني صاعد عشان الرصيد الجاري
     * يتحسب صح، واللي بيفتح الكارت بيدوّر على آخر حاجة حصلت — فكان لازم ينزل ٤٩٥
     * سطر عشان يشوفها. كل سطر شايل رصيده قبل وبعد، فقلب العرض مابيكسرش قراءته.
     *
     * والترتيب بيفصل التعادل برقم الحركة: مية سطر في نفس اليوم مالهومش ترتيب من
     * التاريخ وحده، والرقم بيمشي مع زمن الكتابة.
     */
    { title: 'التاريخ', dataIndex: 'date', ...dateColumn<CardRow>((r) => r.date),
      defaultSortOrder: 'descend' as const,
      sorter: (a: CardRow, b: CardRow) =>
        String(a.date ?? '').slice(0, 10).localeCompare(String(b.date ?? '').slice(0, 10))
        || (a.movement_id - b.movement_id),
      render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
    { title: 'نوع الحركة', dataIndex: 'movement_type',
      ...textColumn(cardRows, (r: CardRow) => r.movement_label || moveLabels[r.movement_type] || r.movement_type),
      render: (t: string, r) => (
        <>
          <Tag color={r.direction === 'in' ? 'green' : 'red'}>
            {r.movement_label || moveLabels[t] || t}
          </Tag>
          {r.is_reversal && <Tag color="orange">عكسي</Tag>}
        </>
      ) },
    { title: 'وارد', dataIndex: 'quantity_in', align: 'left',
      ...numberColumn<CardRow>((r) => r.quantity_in),
      render: (v: string) => (Number(v) ? (
        <b style={{ color: '#6AB42D' }}>{qty(v)}</b>) : '-') },
    { title: 'منصرف', dataIndex: 'quantity_out', align: 'left',
      ...numberColumn<CardRow>((r) => r.quantity_out),
      render: (v: string) => (Number(v) ? (
        <b style={{ color: '#cf1322' }}>{qty(v)}</b>) : '-') },
    { title: 'الرصيد قبل', dataIndex: 'balance_before', align: 'left',
      ...numberColumn<CardRow>((r) => r.balance_before),
      render: (v: string) => <span style={{ color: '#6b6b6b' }}>{qty(v)}</span> },
    { title: 'الرصيد بعد', dataIndex: 'balance_after', align: 'left',
      ...numberColumn<CardRow>((r) => r.balance_after),
      render: (v: string) => <b>{qty(v)}</b> },
    { title: 'الموقع', dataIndex: 'location',
      ...textColumn(cardRows, (r: CardRow) => r.location) },
    // الوحده / القطعه. The card counts in pieces because that is how stock is kept; the
    // line was TRADED in whatever unit the customer buys by. «منصرف ٤٨» against a
    // document saying «٤ كراتين» is one fact told two ways with nothing connecting them.
    { title: 'بالوحدة', dataIndex: 'quantity_in_unit', align: 'left', width: 120,
      ...numberColumn<CardRow>((r) => r.quantity_in_unit),
      render: (v: string | null, r: CardRow) => (v
        ? <span>{qty(v)} <span style={{ color: '#6b6b6b' }}>{r.unit}</span></span>
        // Empty when the trading unit IS the piece — repeating «٥ قطعة / ٥» on every
        // loose-sold row is noise, not information.
        : <span style={{ color: '#8c8c8c' }}>-</span>) },
    // Their card carries the party, the price and the total on every row. None of it was
    // missing data — a sale line has always known all three — so «منصرف ٥» used to mean
    // opening the sales screen to find out who took them and for how much.
    { title: 'جهه التعامل', dataIndex: 'party', ellipsis: true,
      ...textColumn(cardRows, (r: CardRow) => r.party),
      render: (v: string | null) => v ?? <span style={{ color: '#8c8c8c' }}>-</span> },
    { title: 'السعر', dataIndex: 'unit_price', align: 'left',
      ...numberColumn<CardRow>((r) => r.unit_price),
      render: (v: string | null) => (v ? money(v) : '-') },
    { title: 'الاجمالي', dataIndex: 'line_total', align: 'left',
      ...numberColumn<CardRow>((r) => r.line_total),
      render: (v: string | null) => (v ? <b>{money(v)}</b> : '-') },
    { title: 'خصم', dataIndex: 'discount_pct', align: 'left', width: 90,
      ...numberColumn<CardRow>((r) => r.discount_pct),
      render: (v: string | null) => (Number(v)
        ? <Tag color="gold">{`${Number(v)}%`}</Tag>
        : <span style={{ color: '#8c8c8c' }}>-</span>) },
    // The line's share of the document VAT — its share of the gross, which is the same
    // proportional rule the return already uses to decide how much tax to refund.
    { title: 'ض.م', dataIndex: 'tax_amount', align: 'left', width: 110,
      ...numberColumn<CardRow>((r) => r.tax_amount),
      render: (v: string | null) => (Number(v)
        ? money(v) : <span style={{ color: '#8c8c8c' }}>-</span>) },
    // Which lot went out. FEFO chose it at the moment of sale; the card reads that back
    // rather than leaving a recall to guess.
    { title: 'انتهاء', dataIndex: 'expiry_date', width: 120,
      ...dateColumn<CardRow>((r) => r.expiry_date),
      render: (v: string | null) => (v
        ? <Tag color={dayjs(v).isBefore(dayjs()) ? 'red' : 'orange'}>{v}</Tag>
        : <span style={{ color: '#8c8c8c' }}>-</span>) },
    { title: 'المستند', dataIndex: 'source_doc_id',
      ...textColumn(cardRows, (r: CardRow) => r.document_number),
      // Reading a card is asking «الحركة دي جات منين؟» — so the row opens its document
      // when it has one, and stays a plain tag when there is no screen to open.
      render: (id: number | null, r) => (id
        ? (docKindOf(r.source_doc_type)
            ? <DocumentLink kind={docKindOf(r.source_doc_type)!} id={id} size="small"
                label={r.document_number || `#${id}`}
                // التعديل للفاتورة اللي اتكتبت عندنا بس. المنقولة من a5
                // (`sales_invoice`) بتتفتح للعرض: تعديلها بيخلّي نسختنا تفرق عن
                // نظامهم وهما لسه شغّالين عليه.
                allowEdit={r.source_doc_type === 'sale'} />
            : <Tag>{r.source_doc_type} #{id}</Tag>)
        : '-') },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const tableCols = useTableColumns('item-card', columns, {
    export: { name: 'كارت الصنف', rows: cardRows },
  });

  return (
    <Card
      title="كارت الصنف"
      extra={(
        <>
          {tableCols.control}
          <Button icon={<DownloadOutlined />} onClick={exportCsv} style={{ marginInlineEnd: 8 }}
            disabled={!card?.rows.length}>تصدير CSV</Button>
          <Button icon={<PrinterOutlined />} onClick={printIt} disabled={!card?.rows.length}
            style={{ marginInlineEnd: 8 }}>طباعة</Button>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={!itemId}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={4}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="كل الفئات" value={category}
            onChange={(c) => {
              setCategory(c);
              // الصنف المختار مش في الفئة الجديدة ⇒ يتفضّى. سيبانه بيدّي كارت صنف
              // مالوش علاقة بالفئة اللي على الشاشة.
              if (c && itemId && items.find((i) => i.id === itemId)?.category !== c) {
                setItemId(undefined);
              }
            }}
            options={categories.map((c: string) => ({ value: c, label: categoryLabels[c] || c }))} filterOption={searchFilter} filterSort={searchRank}/>
        </Col>
        <Col xs={24} md={7}>
          <Select
            showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder={category ? `أصناف «${categoryLabels[category] || category}»` : 'اختر الصنف'}
            value={itemId} onChange={setItemId}
            options={pickableItems.map((i: any) => ({
              value: i.id, label: i.name, search: i.code || '' }))}
            notFoundContent={category ? 'مافيش صنف بالاسم ده في الفئة دي' : undefined} filterOption={searchFilter} filterSort={searchRank}/>
        </Col>
        <Col xs={24} md={4}>
          <Select
            allowClear style={{ width: '100%' }} placeholder="كل المواقع"
            value={warehouseId} onChange={setWarehouseId}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </Col>
        <Col xs={24} md={7}>
          <DateRangeFilter
            value={range as any}
            onChange={(v) => setRange(v as any)}
          />
        </Col>
        <Col xs={24} md={5}>
          <Select
            allowClear style={{ width: '100%' }} placeholder="كل أنواع الحركة"
            value={movementType} onChange={setMovementType}
            options={moveTypes}
          />
        </Col>
      </Row>

      {!itemId && <Empty description="اختر صنفاً لعرض كارته" />}

      {card && (
        <>
          <StatsRow gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="رصيد أول المدة" value={qty(card.opening_balance)} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="إجمالي الوارد" value={qty(card.total_in)}
                  valueStyle={{ color: '#6AB42D' }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="إجمالي المنصرف" value={qty(card.total_out)}
                  valueStyle={{ color: '#cf1322' }} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title={`الرصيد الحالي — ${card.location}`}
                  value={qty(card.closing_balance)} valueStyle={{ color: '#0B5CA8' }} />
              </Card>
            </Col>
          </StatsRow>

          {(movementType || range) && (
            <Alert
              type="info" showIcon style={{ marginBottom: 12 }}
              message="الفلاتر تخفي سطوراً ولا تغيّر الأرصدة."
              description="الرصيد قبل/بعد محسوب على كل حركات الصنف، فالرصيد الحالي هو الرصيد الحقيقي مهما كان المعروض."
            />
          )}

          <Table<CardRow>
            {...kb.tableProps}
            rowKey="movement_id" size="small" loading={loading} dataSource={card.rows}
            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
            pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={tableCols.columns}
          />
        </>
      )}
    </Card>
  );
}

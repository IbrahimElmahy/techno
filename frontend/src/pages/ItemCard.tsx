import React, { useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { Alert, Button, Empty, Select, Tag, message } from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import {
  ClearOutlined, DownloadOutlined, PrinterOutlined, ProfileOutlined, ReloadOutlined,
} from '@ant-design/icons';
import ListPage from '../components/ListPage';
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

import { useMovementLabels, useMovementTypes } from '../lib/movementTypes';
import { useLookup, labelMap } from '../hooks/useLookup';
import { compareArabic, searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { qty, money, numeralsLocale } from '../utils/money';

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
  party: string | null;
  document_number: string | null;
  unit_price: string | null;
  line_total: string | null;
  expiry_date: string | null;
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
  const moveLabels = useMovementLabels();
  const moveTypes = useMovementTypes();
  const [items, setItems] = useState<any[]>([]);
  const [category, setCategory] = useState<string | undefined>();
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);

  const categories = useMemo(
    () => ([...new Set(items.map((i: any) => i.category).filter(Boolean))] as string[])
      .sort(compareArabic),
    [items],
  );

  const pickableItems = useMemo(
    () => (category ? items.filter((i: any) => i.category === category) : items),
    [items, category],
  );
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [itemId, setItemId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [movementType, setMovementType] = useState<string | undefined>();
  const [card, setCard] = useState<CardOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [search] = useSearchParams();
  const askedItem = Number(search.get('item')) || undefined;
  useEffect(() => { if (askedItem) setItemId(askedItem); }, [askedItem]);

  useEffect(() => {
    api.get('/api/v1/warehouses').then((w) => setWarehouses(w.data || [])).catch(console.error);
  }, []);

  const whBranch = warehouses.find((w) => w.id === warehouseId)?.branch_id as number | undefined;
  useEffect(() => {
    api.get('/api/v1/items', { params: whBranch ? { branch_id: whBranch } : {} })
      .then((r) => {
        const list: any[] = r.data || [];
        setItems((prev) => {
          if (itemId && !list.some((i) => i.id === itemId)) {
            const old = prev.find((i) => i.id === itemId);
            const twin = old && list.find((i) => (i.name || '').trim() === (old.name || '').trim());
            setItemId(twin ? twin.id : undefined);
          }
          return list;
        });
      })
      .catch(console.error);
  }, [whBranch]);

  const branchOfCode = (code?: string | null) => (!code ? '' : code.startsWith('AL-') ? 'العلياء'
    : code.startsWith('FC-') ? 'السادات' : 'أكتوبر');
  const dupNames = useMemo(() => {
    const seen = new Map<string, number>();
    items.forEach((i: any) => seen.set((i.name || '').trim(), (seen.get((i.name || '').trim()) || 0) + 1));
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [items]);

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
    { title: 'بالوحدة', dataIndex: 'quantity_in_unit', align: 'left', width: 120,
      ...numberColumn<CardRow>((r) => r.quantity_in_unit),
      render: (v: string | null, r: CardRow) => (v
        ? <span>{qty(v)} <span style={{ color: '#6b6b6b' }}>{r.unit}</span></span>
        : <span style={{ color: '#555b65' }}>-</span>) },
    { title: 'جهه التعامل', dataIndex: 'party', ellipsis: true,
      ...textColumn(cardRows, (r: CardRow) => r.party),
      render: (v: string | null) => v ?? <span style={{ color: '#555b65' }}>-</span> },
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
        : <span style={{ color: '#555b65' }}>-</span>) },
    { title: 'ض.م', dataIndex: 'tax_amount', align: 'left', width: 110,
      ...numberColumn<CardRow>((r) => r.tax_amount),
      render: (v: string | null) => (Number(v)
        ? money(v) : <span style={{ color: '#555b65' }}>-</span>) },
    { title: 'انتهاء', dataIndex: 'expiry_date', width: 120,
      ...dateColumn<CardRow>((r) => r.expiry_date),
      render: (v: string | null) => (v
        ? <Tag color={dayjs(v).isBefore(dayjs()) ? 'red' : 'orange'}>{v}</Tag>
        : <span style={{ color: '#555b65' }}>-</span>) },
    { title: 'المستند', dataIndex: 'source_doc_id',
      ...textColumn(cardRows, (r: CardRow) => r.document_number),
      render: (id: number | null, r) => (id
        ? (docKindOf(r.source_doc_type)
            ? <DocumentLink kind={docKindOf(r.source_doc_type)!} id={id} size="small"
                label={r.document_number || `#${id}`}
                allowEdit={r.source_doc_type === 'sale'} />
            : <Tag>{r.source_doc_type} #{id}</Tag>)
        : '-') },
  ];

  const tableCols = useTableColumns('item-card', columns, {
    export: { name: 'كارت الصنف', rows: cardRows },
  });

  const footer = card && (
    <span className="sl-foot">
      <span>عدد الحركات: <b>{card.rows.length.toLocaleString(numeralsLocale())}</b></span>
      <span>رصيد أول المدة: <b>{qty(card.opening_balance)}</b></span>
      <span>إجمالي الوارد: <b className="is-pos">{qty(card.total_in)}</b></span>
      <span>إجمالي المنصرف: <b className="is-neg">{qty(card.total_out)}</b></span>
      <span>الرصيد الحالي — {card.location}: <b style={{ color: '#0B5CA8' }}>{qty(card.closing_balance)}</b></span>
    </span>
  );

  return (
    <ListPage
      icon={<ProfileOutlined />}
      title="كارت الصنف"
      subtitle={card
        ? <>{card.item_name}{card.item_code && <span dir="ltr"> · {card.item_code}</span>}</>
        : 'كل حركة على الصنف بالرصيد قبلها وبعدها'}
      actions={(<>
        <Button icon={<PrinterOutlined />} onClick={printIt} disabled={!card?.rows.length}>طباعة</Button>
        <Button icon={<DownloadOutlined />} onClick={exportCsv}
          disabled={!card?.rows.length}>تصدير CSV</Button>
        {tableCols.control}
        <Button icon={<ReloadOutlined />} onClick={load} disabled={!itemId}>تحديث</Button>
      </>)}
      filters={(<>
          <Select
            allowClear showSearch
            placeholder="كل الفئات" value={category}
            onChange={(c) => {
              setCategory(c);
              if (c && itemId && items.find((i) => i.id === itemId)?.category !== c) {
                setItemId(undefined);
              }
            }}
            options={categories.map((c: string) => ({ value: c, label: categoryLabels[c] || c }))} filterOption={searchFilter} filterSort={searchRank}/>
          <Select
            className="sl-f-search"
            showSearch
            placeholder={category ? `أصناف «${categoryLabels[category] || category}»` : 'اختر الصنف'}
            value={itemId} onChange={setItemId}
            options={pickableItems.map((i: any) => ({
              value: i.id,
              label: dupNames.has((i.name || '').trim()) ? `${i.name} — ${branchOfCode(i.code)}` : i.name,
              search: i.code || '' }))}
            notFoundContent={category ? 'مافيش صنف بالاسم ده في الفئة دي' : undefined} filterOption={searchFilter} filterSort={searchRank}/>
          <Select showSearch
            allowClear placeholder="كل المواقع"
            value={warehouseId} onChange={setWarehouseId}
            options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} filterOption={searchFilter} filterSort={searchRank} />
          <DateRangeFilter
            className="sl-f-dates"
            value={range as any}
            onChange={(v) => setRange(v as any)}
          />
          <Select
            allowClear placeholder="كل أنواع الحركة"
            value={movementType} onChange={setMovementType}
            options={moveTypes}
          />
          <Button className="sl-f-clear" icon={<ClearOutlined />}
            onClick={() => { setCategory(undefined); setWarehouseId(undefined); setRange(null); setMovementType(undefined); }}>
            مسح
          </Button>
      </>)}
    >
      {!itemId && <Empty description="اختر صنفاً لعرض كارته" style={{ padding: '32px 0' }} />}

      {card && (
        <>
          {(movementType || range) && (
            <Alert
              type="info" showIcon style={{ margin: '6px 0' }}
              message="الفلاتر تخفي سطوراً ولا تغيّر الأرصدة."
              description="الرصيد قبل/بعد محسوب على كل حركات الصنف، فالرصيد الحالي هو الرصيد الحقيقي مهما كان المعروض."
            />
          )}

          <Table<CardRow>
            {...kb.tableProps}
            className="sl-table"
            rowKey="movement_id" size="small" loading={loading} dataSource={card.rows}
            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
            pagination={{
              defaultPageSize: PAGE_SIZE, showSizeChanger: true,
              locale: { items_per_page: '' },
              showTotal: () => footer,
            }}
            scroll={{ x: 'max-content' }}
            columns={tableCols.columns}
          />
        </>
      )}
    </ListPage>
  );
}

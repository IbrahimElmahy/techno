import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Empty, Row, Select, Statistic, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import DocumentLink, { docKindOf } from '../components/DocumentLink';

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

const MOVEMENT_LABELS: Record<string, string> = {
  purchase_in: 'شراء',
  purchase_return_out: 'مرتجع شراء',
  sale_out: 'بيع',
  sale_return_in: 'مرتجع بيع',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  production_in: 'إنتاج',
  reverse_production_in: 'عكس إنتاج',
  consumption_out: 'استهلاك',
  reverse_consumption_out: 'عكس استهلاك',
  waste_out: 'هالك',
  reverse_waste_out: 'عكس هالك',
  inspection_out: 'معاينة',
  reverse_inspection_out: 'عكس معاينة',
  loyalty_gift_out: 'هدية نقاط',
  serial_receive_in: 'استلام أرقام تسلسلية',
  permit_in: 'إذن إضافة',
  permit_out: 'إذن صرف',
  // Its own line on the card: opening stock is what the company already had, not a movement that
  // happened, and reading it as a receipt would invent a day it arrived.
  opening_in: 'بضاعة أول المدة',
};

interface CardRow {
  movement_id: number;
  date: string | null;
  movement_type: string;
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
}

interface CardOut {
  item_id: number; item_name: string; item_code: string | null;
  unit_of_measure: string | null; location: string;
  opening_balance: string; closing_balance: string;
  total_in: string; total_out: string; rows: CardRow[];
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function ItemCard() {
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [itemId, setItemId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
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

  const load = async () => {
    if (!itemId) { setCard(null); return; }
    setLoading(true);
    try {
      const params: any = {};
      if (warehouseId) { params.location_kind = 'warehouse'; params.location_id = warehouseId; }
      if (range) {
        params.date_from = range[0].format('YYYY-MM-DD');
        params.date_to = range[1].format('YYYY-MM-DD');
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
    const heads = ['التاريخ', 'النوع', 'وارد', 'منصرف', 'الرصيد قبل', 'الرصيد بعد',
      'الموقع', 'المستند'];
    const lines = [heads.join(',')];
    card.rows.forEach((r) => lines.push([
      r.date ?? '', MOVEMENT_LABELS[r.movement_type] || r.movement_type,
      r.quantity_in, r.quantity_out, r.balance_before, r.balance_after,
      r.location, r.source_doc_id ? `${r.source_doc_type}#${r.source_doc_id}` : '',
    ].map((v) => `"${v}"`).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `item-card-${card.item_code || card.item_id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      title="كارت الصنف"
      extra={(
        <>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} style={{ marginInlineEnd: 8 }}
            disabled={!card?.rows.length}>تصدير CSV</Button>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={!itemId}>تحديث</Button>
        </>
      )}
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={7}>
          <Select
            showSearch optionFilterProp="label" style={{ width: '100%' }}
            placeholder="اختر الصنف" value={itemId} onChange={setItemId}
            options={items.map((i) => ({
              value: i.id, label: i.code ? `${i.code} — ${i.name}` : i.name }))}
          />
        </Col>
        <Col xs={24} md={5}>
          <Select
            allowClear style={{ width: '100%' }} placeholder="كل المواقع"
            value={warehouseId} onChange={setWarehouseId}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
        </Col>
        <Col xs={24} md={7}>
          <DatePicker.RangePicker
            style={{ width: '100%' }} value={range as any} allowClear
            onChange={(v) => setRange(v as any)} placeholder={['من تاريخ', 'إلى تاريخ']}
          />
        </Col>
        <Col xs={24} md={5}>
          <Select
            allowClear style={{ width: '100%' }} placeholder="كل أنواع الحركة"
            value={movementType} onChange={setMovementType}
            options={Object.entries(MOVEMENT_LABELS)
              .map(([value, label]) => ({ value, label }))}
          />
        </Col>
      </Row>

      {!itemId && <Empty description="اختر صنفاً لعرض كارته" />}

      {card && (
        <>
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
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
          </Row>

          {(movementType || range) && (
            <Alert
              type="info" showIcon style={{ marginBottom: 12 }}
              message="الفلاتر بتخفي سطور، بس ما بتغيّرش الأرصدة."
              description="الرصيد قبل/بعد محسوب على كل حركات الصنف، فالرصيد الحالي هو الرصيد الحقيقي مهما كان المعروض."
            />
          )}

          <Table<CardRow>
            rowKey="movement_id" size="small" loading={loading} dataSource={card.rows}
            locale={{ emptyText: 'لا توجد حركات في هذه الفترة' }}
            pagination={{ defaultPageSize: 25, showSizeChanger: true }}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: 'التاريخ', dataIndex: 'date',
                render: (d: string) => (d ? String(d).slice(0, 10) : '-') },
              { title: 'نوع الحركة', dataIndex: 'movement_type',
                render: (t: string, r) => (
                  <>
                    <Tag color={r.direction === 'in' ? 'green' : 'red'}>
                      {MOVEMENT_LABELS[t] || t}
                    </Tag>
                    {r.is_reversal && <Tag color="orange">عكسي</Tag>}
                  </>
                ) },
              { title: 'وارد', dataIndex: 'quantity_in', align: 'left',
                render: (v: string) => (Number(v) ? (
                  <b style={{ color: '#6AB42D' }}>{qty(v)}</b>) : '-') },
              { title: 'منصرف', dataIndex: 'quantity_out', align: 'left',
                render: (v: string) => (Number(v) ? (
                  <b style={{ color: '#cf1322' }}>{qty(v)}</b>) : '-') },
              { title: 'الرصيد قبل', dataIndex: 'balance_before', align: 'left',
                render: (v: string) => <span style={{ color: '#8a8a8a' }}>{qty(v)}</span> },
              { title: 'الرصيد بعد', dataIndex: 'balance_after', align: 'left',
                render: (v: string) => <b>{qty(v)}</b> },
              { title: 'الموقع', dataIndex: 'location' },
              // Their card carries the party, the price and the total on every row. None of it was
              // missing data — a sale line has always known all three — so «منصرف ٥» used to mean
              // opening the sales screen to find out who took them and for how much.
              { title: 'جهه التعامل', dataIndex: 'party', ellipsis: true,
                render: (v: string | null) => v ?? <span style={{ color: '#bbb' }}>-</span> },
              { title: 'السعر', dataIndex: 'unit_price', align: 'left',
                render: (v: string | null) => (v ? money(v) : '-') },
              { title: 'الاجمالي', dataIndex: 'line_total', align: 'left',
                render: (v: string | null) => (v ? <b>{money(v)}</b> : '-') },
              // Which lot went out. FEFO chose it at the moment of sale; the card reads that back
              // rather than leaving a recall to guess.
              { title: 'انتهاء', dataIndex: 'expiry_date', width: 120,
                render: (v: string | null) => (v
                  ? <Tag color={dayjs(v).isBefore(dayjs()) ? 'red' : 'orange'}>{v}</Tag>
                  : <span style={{ color: '#bbb' }}>-</span>) },
              { title: 'المستند', dataIndex: 'source_doc_id',
                // Reading a card is asking «الحركة دي جات منين؟» — so the row opens its document
                // when it has one, and stays a plain tag when there is no screen to open.
                render: (id: number | null, r) => (id
                  ? (docKindOf(r.source_doc_type)
                      ? <DocumentLink kind={docKindOf(r.source_doc_type)!} id={id} size="small"
                          label={r.document_number || `#${id}`}
                          allowEdit={r.source_doc_type === 'sale'} />
                      : <Tag>{r.source_doc_type} #{id}</Tag>)
                  : '-') },
            ]}
          />
        </>
      )}
    </Card>
  );
}

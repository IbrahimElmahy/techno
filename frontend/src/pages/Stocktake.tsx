import React, { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Row, Select, Statistic, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';
import ListToolbar, { useListFilter } from '../components/ListToolbar';

/**
 * جرد حق تاريخ — the stock as it stood on a chosen day, valued at cost.
 *
 * Today's balance cannot answer "what did we have on the 31st". This is the same derivation cut
 * off at a date, so a document typed late still lands on the day it happened and the count for a
 * closed month does not drift as the month after it trades.
 */

interface Row {
  item_id: number; code: string | null; name: string;
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
  const [asOf, setAsOf] = useState<Dayjs>(dayjs());
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
      const params: any = { as_of: asOf.format('YYYY-MM-DD') };
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

  const filter = useListFilter(rows, { search: (r) => [r.code, r.name, r.location] });

  const exportCsv = () => {
    if (!rows.length) { message.info('لا توجد أرصدة للتصدير'); return; }
    const heads = ['الكود', 'الصنف', 'الوحدة', 'الموقع', 'الكمية', 'تكلفة الوحدة', 'القيمة'];
    const lines = [heads.join(',')];
    filter.filtered.forEach((r) => lines.push([
      r.code ?? '', r.name, r.unit_of_measure ?? '', r.location,
      r.quantity, r.unit_cost, r.value,
    ].map((v) => `"${v}"`).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stocktake-${asOf.format('YYYY-MM-DD')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
        <Col xs={24} md={8}>
          <DatePicker
            style={{ width: '100%' }} value={asOf} allowClear={false}
            onChange={(v) => v && setAsOf(v)} placeholder="الرصيد حتى تاريخ"
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
        rowKey={(r) => `${r.item_id}-${r.location}`} size="small" loading={loading}
        dataSource={filter.filtered}
        locale={{ emptyText: 'لا توجد أرصدة في هذا التاريخ' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: 'الكود', dataIndex: 'code', render: (c: string) => (c ? <Tag>{c}</Tag> : '-') },
          { title: 'الصنف', dataIndex: 'name', render: (n: string) => <b>{n}</b> },
          { title: 'الوحدة', dataIndex: 'unit_of_measure', render: (u: string) => u || '-' },
          { title: 'الموقع', dataIndex: 'location' },
          { title: 'الكمية', dataIndex: 'quantity', align: 'left',
            render: (v: string) => <b>{qty(v)}</b> },
          { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', align: 'left',
            render: (v: string) => money(v) },
          { title: 'القيمة', dataIndex: 'value', align: 'left',
            render: (v: string) => <b style={{ color: '#0B5CA8' }}>{money(v)}</b> },
        ]}
      />
    </Card>
  );
}

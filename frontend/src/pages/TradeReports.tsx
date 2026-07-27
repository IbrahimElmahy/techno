import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, DatePicker, Row, Segmented, Select, Statistic, Table, Tag, message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '../api/client';

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

export default function TradeReports() {
  const [docType, setDocType] = useState<DocType>('sale');
  const [level, setLevel] = useState<Level>('document');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
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
      render: (v: string) => money(v) },
    { title: 'الربح', dataIndex: 'profit', align: 'left' as const,
      render: (v: string, r: any) => (
        <b style={{ color: Number(v) < 0 ? '#cf1322' : '#6AB42D' }}>
          {money(v)}{r.cost_complete === false
            ? <Tag color="orange" style={{ marginInlineStart: 6 }}>تكلفة ناقصة</Tag> : null}
        </b>
      ) },
    { title: 'هامش %', dataIndex: 'margin_pct', align: 'left' as const,
      render: (v: string) => `${money(v)}%` },
  ] : [];

  const columns: any[] = grouped
    ? [
      { title: groupBy === 'party' ? (isSale ? 'العميل' : 'المورد')
        : groupBy === 'item' ? 'الصنف' : 'المخزن',
      dataIndex: 'label', render: (v: string) => <b>{v}</b> },
      { title: 'عدد المستندات', dataIndex: 'document_count', align: 'left' as const },
      { title: 'الكمية', dataIndex: 'quantity', align: 'left' as const,
        render: (v: string) => qty(v) },
      { title: 'الصافي', dataIndex: 'net', align: 'left' as const,
        render: (v: string) => <b>{money(v)}</b> },
      ...profitColumns,
    ]
    : [
      { title: 'المستند', dataIndex: 'document_number', render: (v: string) => <Tag>{v}</Tag> },
      { title: 'التاريخ', dataIndex: 'date',
        render: (v: string) => (v ? String(v).slice(0, 10) : '-') },
      { title: isSale ? 'العميل' : 'المورد', dataIndex: 'party' },
      ...(level === 'line' ? [
        { title: 'الصنف', dataIndex: 'item', render: (v: string) => <b>{v}</b> },
        { title: 'المخزن', dataIndex: 'warehouse' },
      ] : []),
      { title: 'الكمية', dataIndex: 'quantity', align: 'left' as const,
        render: (v: string) => qty(v) },
      { title: 'الصافي', dataIndex: 'net', align: 'left' as const,
        render: (v: string) => <b>{money(v)}</b> },
      ...profitColumns,
    ];

  /** Exported straight from what is on screen, so the file always matches the report read. */
  const exportCsv = () => {
    if (!rows.length) { message.info('لا توجد بيانات للتصدير'); return; }
    const heads = columns.map((c) => c.title);
    const keys = columns.map((c) => c.dataIndex);
    const lines = [heads.join(',')];
    rows.forEach((r) => lines.push(keys.map((k) => `"${r[k] ?? ''}"`).join(',')));
    // BOM so Excel opens the Arabic headers correctly.
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${docType}-${level}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      title="تقارير المبيعات والمشتريات"
      extra={(
        <>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} style={{ marginInlineEnd: 8 }}>
            تصدير CSV
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
        rowKey={(r: any) => r.key ?? `${r.document_number}-${r.item_id ?? ''}-${r.warehouse ?? ''}`}
        size="small" loading={loading} dataSource={rows} columns={columns}
        locale={{ emptyText: 'لا توجد بيانات في هذه الفترة' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </Card>
  );
}

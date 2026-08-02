import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Space, Table, Tabs, Tag, Tooltip, message } from 'antd';
import { BarcodeOutlined, HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { DocRef } from '../components/DocumentLink';
import ColumnSettings, { useHiddenColumns } from '../components/ColumnSettings';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import { useQueryTab } from '../components/useQueryTab';

/**
 * السرايل و حركات سرايل — two of their screens, one component.
 *
 * Serials were reachable one item at a time, buried in the item file. That answers «what units of
 * THIS item exist» and never «where is 4471-B?» — which is the question somebody actually walks in
 * with, holding a unit and a number and nothing else.
 *
 * Read-only, both of them. Serials are created and moved by the documents that handle the goods,
 * and a screen that let somebody edit one directly would put the serial and the stock quantity out
 * of step — the exact drift the integrity check exists to catch.
 */

interface SerialRow {
  id: number; item_id: number; item_name: string | null;
  serial: string;
  status: 'in_stock' | 'sold';
  location_kind: string | null; location_id: number | null; location_name: string | null;
  sold_invoice_id: number | null;
}

interface MovementRow {
  id: number; serial_id: number; item_id: number; item_name: string | null;
  customer_id: number | null; customer_name: string | null;
  serial: string;
  kind: 'received' | 'relocated' | 'sold' | 'returned';
  location_kind: string | null; location_id: number | null; location_name: string | null;
  document_type: string | null; document_id: number | null; created_at: string;
}

const KIND_LABEL: Record<MovementRow['kind'], { text: string; color: string }> = {
  received: { text: 'استلام', color: 'green' },
  relocated: { text: 'تحويل', color: 'blue' },
  sold: { text: 'بيع', color: 'volcano' },
  returned: { text: 'مرتجع', color: 'gold' },
};

const DOC_LABEL: Record<string, string> = {
  sales_invoice: 'فاتورة بيع',
  transfer: 'إذن تحويل',
  serial_receive: 'استلام سرايل',
};

export default function Serials() {
  const navigate = useNavigate();
  // Arrival comes from the URL — «السرايل» and «حركات سرايل» are two menu entries — but moving
  // between the tabs INSIDE the screen must not touch it. `?view=movements` is itself a menu key,
  // so writing it would open a second workspace tab and remount this one, losing the serial the
  // person had just clicked to follow.
  const [urlTab] = useQueryTab('list', 'view');
  const [tab, setTab] = useState(urlTab);
  useEffect(() => { setTab(urlTab); }, [urlTab]);
  const [serials, setSerials] = useState<SerialRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Set by clicking a serial anywhere: the movements tab then shows that one unit's history.
  const [traced, setTraced] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([
        api.get('/api/v1/serials'),
        api.get('/api/v1/serials/movements'),
      ]);
      setSerials(s.data || []); setMovements(m.data || []);
    } catch {
      message.error('تعذر تحميل السرايل');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const itemOptions = useMemo(() => {
    const seen = new Map<number, string>();
    serials.forEach((s) => seen.set(s.item_id, s.item_name || `صنف #${s.item_id}`));
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [serials]);

  // --- السرايل ---------------------------------------------------------------------------------
  const serialColumns = [
    {
      title: 'السيريال', dataIndex: 'serial', key: 'serial', width: 190,
      render: (v: string) => (
        <Tooltip title="عرض حركة السيريال ده">
          <a onClick={() => { setTab('movements'); setTraced(v); }}>
            <BarcodeOutlined style={{ marginInlineEnd: 6 }} />{v}
          </a>
        </Tooltip>
      ),
    },
    {
      title: 'الصنف', dataIndex: 'item_name', key: 'item_name', ellipsis: true,
      render: (v: string | null, r: SerialRow) => (
        <a onClick={() => navigate(`/catalog/${r.item_id}`)}>{v ?? `صنف #${r.item_id}`}</a>
      ),
    },
    {
      title: 'الحالة', dataIndex: 'status', key: 'status', width: 110,
      render: (v: SerialRow['status']) => (v === 'in_stock'
        ? <Tag color="green">في المخزن</Tag> : <Tag color="volcano">مباع</Tag>),
    },
    {
      title: 'المكان', dataIndex: 'location_name', key: 'location_name', width: 180,
      // A sold unit is not anywhere. Showing its last store would put units a customer has
      // walked out with back into that store's list.
      render: (v: string | null, r: SerialRow) => (v ?? (r.status === 'sold'
        ? <span style={{ color: '#bbb' }}>خرج بالبيع</span> : '-')),
    },
    {
      title: 'الفاتورة', dataIndex: 'sold_invoice_id', key: 'sold_invoice_id', width: 120,
      // Was a link to the invoice LIST, which is the same as no link: the reader still had to find
      // the row. It opens the actual sale now.
      render: (v: number | null) => (v
        ? <DocRef kind="invoice" id={v} label={`#${v}`} />
        : <span style={{ color: '#bbb' }}>-</span>),
    },
  ];

  const serialCols = useHiddenColumns('serials-list', []);
  const serialFilter = useListFilter<SerialRow>(serials, {
    search: (s) => [s.serial, s.item_name],
    filters: {
      status: (s, v) => s.status === v,
      item_id: (s, v) => s.item_id === v,
    },
  });

  // --- حركات سرايل -----------------------------------------------------------------------------

  const movementColumns = [
    {
      title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', width: 155,
      render: (v: string) => String(v).slice(0, 16),
    },
    {
      title: 'السيريال', dataIndex: 'serial', key: 'serial', width: 175,
      render: (v: string) => <a onClick={() => setTraced(v)}>{v}</a>,
    },
    {
      title: 'الصنف', dataIndex: 'item_name', key: 'item_name', ellipsis: true,
      render: (v: string | null, r: MovementRow) => v ?? `صنف #${r.item_id}`,
    },
    {
      title: 'الحركة', dataIndex: 'kind', key: 'kind', width: 105,
      render: (v: MovementRow['kind']) => (
        <Tag color={KIND_LABEL[v].color}>{KIND_LABEL[v].text}</Tag>
      ),
    },
    {
      // Their column, and the better one for the question actually asked: «who has this unit?»
      // Only a sale gives a unit a customer; every other movement is internal.
      title: 'العميل', dataIndex: 'customer_name', key: 'customer_name', width: 175,
      render: (v: string | null, r: MovementRow) => (v && r.customer_id
        ? <a onClick={() => navigate(`/customers/${r.customer_id}`)}>{v}</a>
        : <span style={{ color: '#bbb' }}>-</span>),
    },
    {
      title: 'المكان بعدها', dataIndex: 'location_name', key: 'location_name', width: 175,
      render: (v: string | null, r: MovementRow) => (v ?? (r.kind === 'sold'
        ? <span style={{ color: '#bbb' }}>خرج</span> : '-')),
    },
    {
      title: 'المستند', key: 'document', width: 180,
      render: (_: any, r: MovementRow) => {
        if (!r.document_type) return '-';
        const label = `${DOC_LABEL[r.document_type] ?? r.document_type}`
          + (r.document_id ? ` #${r.document_id}` : '');
        // Only the sale has a screen that opens one document; a transfer and a serial receipt
        // stay plain rather than becoming links that land on a list.
        return r.document_type === 'sales_invoice'
          ? <DocRef kind="invoice" id={r.document_id} label={label} />
          : <span>{label}</span>;
      },
    },
  ];

  const movementCols = useHiddenColumns('serial-movements-list', []);
  const tracedRows = useMemo(
    () => (traced ? movements.filter((m) => m.serial === traced) : movements),
    [movements, traced],
  );
  const movementFilter = useListFilter<MovementRow>(tracedRows, {
    search: (m) => [m.serial, m.item_name],
    filters: { kind: (m, v) => m.kind === v, item_id: (m, v) => m.item_id === v },
    dateOf: (m) => m.created_at,
  });

  const refresh = (
    <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
  );

  return (
    <Tabs
      activeKey={tab} onChange={(k) => { setTab(k); if (k === 'list') setTraced(null); }}
      items={[
        {
          key: 'list',
          label: <span><BarcodeOutlined /> السرايل</span>,
          children: (
            <Card
              title="السرايل المسجّلة"
              extra={(
                <Space>
                  <ColumnSettings
                    choices={serialColumns.map((c: any) => ({
                      key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
                      locked: c.key === 'serial',
                    }))}
                    hidden={serialCols.hidden} onChange={serialCols.setHidden}
                  />
                  {refresh}
                </Space>
              )}
            >
              <ListToolbar
                searchPlaceholder="بحث بالسيريال أو الصنف"
                query={serialFilter.query} onQueryChange={serialFilter.setQuery}
                values={serialFilter.values} onValueChange={serialFilter.setValue}
                onReset={serialFilter.reset}
                total={serials.length} shown={serialFilter.filtered.length}
                filters={[
                  { key: 'status', placeholder: 'الحالة', span: 5, options: [
                    { value: 'in_stock', label: 'في المخزن' },
                    { value: 'sold', label: 'مباع' }] },
                  { key: 'item_id', placeholder: 'الصنف', span: 7, options: itemOptions },
                ]}
              />
              <Table
                dataSource={serialFilter.filtered} columns={serialCols.apply(serialColumns)}
                rowKey="id" loading={loading} size="middle" tableLayout="fixed"
                locale={{ emptyText: <Empty description="مفيش سرايل مسجّلة" /> }}
                pagination={{
                  defaultPageSize: 20, showSizeChanger: true,
                  showTotal: (t) => `الإجمالي: ${t}`,
                  pageSizeOptions: ['20', '50', '100', '200'],
                }}
              />
            </Card>
          ),
        },
        {
          key: 'movements',
          label: <span><HistoryOutlined /> حركات سرايل</span>,
          children: (
            <Card
              title={traced ? `حركة السيريال ${traced}` : 'حركات السرايل'}
              extra={(
                <Space>
                  {traced && (
                    <Button onClick={() => setTraced(null)}>عرض الكل</Button>
                  )}
                  <ColumnSettings
                    choices={movementColumns.map((c: any) => ({
                      key: String(c.key), title: typeof c.title === 'string' ? c.title : '',
                      locked: c.key === 'serial',
                    }))}
                    hidden={movementCols.hidden} onChange={movementCols.setHidden}
                  />
                  {refresh}
                </Space>
              )}
            >
              <ListToolbar
                searchPlaceholder="بحث بالسيريال أو الصنف"
                query={movementFilter.query} onQueryChange={movementFilter.setQuery}
                values={movementFilter.values} onValueChange={movementFilter.setValue}
                showDateRange range={movementFilter.range} onRangeChange={movementFilter.setRange}
                onReset={movementFilter.reset}
                total={tracedRows.length} shown={movementFilter.filtered.length}
                filters={[
                  { key: 'kind', placeholder: 'نوع الحركة', span: 5, options: [
                    { value: 'received', label: 'استلام' },
                    { value: 'relocated', label: 'تحويل' },
                    { value: 'sold', label: 'بيع' },
                    { value: 'returned', label: 'مرتجع' }] },
                  { key: 'item_id', placeholder: 'الصنف', span: 7, options: itemOptions },
                ]}
              />
              <Table
                dataSource={movementFilter.filtered}
                columns={movementCols.apply(movementColumns)}
                rowKey="id" loading={loading} size="middle" tableLayout="fixed"
                locale={{
                  emptyText: (
                    <Empty description={
                      // Units received before this table existed have no trail, and inventing one
                      // would put a guess where people read facts.
                      'مفيش حركات مسجّلة. الوحدات اللي دخلت قبل ما السجل ده يتعمل مالهاش أثر.'
                    } />
                  ),
                }}
                pagination={{
                  defaultPageSize: 20, showSizeChanger: true,
                  showTotal: (t) => `الإجمالي: ${t}`,
                  pageSizeOptions: ['20', '50', '100', '200'],
                }}
              />
            </Card>
          ),
        },
      ]}
    />
  );
}

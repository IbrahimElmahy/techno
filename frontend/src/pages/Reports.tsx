import React, { useEffect, useState } from 'react';
import {
  Tabs, Table, Select, DatePicker, Card, Statistic, Tag, Button, Space, Row, Col,
  InputNumber, Divider, Empty,
} from 'antd';
import {
  FileExcelOutlined, ReloadOutlined, BuildOutlined, DatabaseOutlined,
  DeleteOutlined, HourglassOutlined, ShoppingOutlined,
} from '@ant-design/icons';
import { api, getApiBaseURL } from '../api/client';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

// --- Shared helpers -----------------------------------------------------------------------
type Period = 'week' | 'month' | 'year';
type Range = [Dayjs | null, Dayjs | null] | null;

const egp = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';

const qty = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const PERIOD_LABEL: Record<Period, string> = { week: 'أسبوعي', month: 'شهري', year: 'سنوي' };

interface Lookup { id: number; name: string; }

const dateParams = (range: Range): Record<string, string> => {
  const p: Record<string, string> = {};
  if (range?.[0]) p.date_from = range[0].format('YYYY-MM-DD');
  if (range?.[1]) p.date_to = range[1].format('YYYY-MM-DD');
  return p;
};

// --- CSV export (preserved feature) -------------------------------------------------------
const handleExport = (reportType: string) => {
  const token = localStorage.getItem('token');
  const baseUrl = getApiBaseURL();
  const downloadUrl = `${baseUrl}/api/v1/reports/export?report_type=${reportType}&token=${token}`;
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `report_${reportType}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

function ExportButton({ type, label }: { type: string; label: string }) {
  return (
    <Button
      icon={<FileExcelOutlined />}
      onClick={() => handleExport(type)}
      style={{ backgroundColor: '#107c41', borderColor: '#107c41', color: '#fff' }}
    >
      {label}
    </Button>
  );
}

// --- Root ---------------------------------------------------------------------------------
export default function Reports() {
  const [period, setPeriod] = useState<Period>('month');
  const [range, setRange] = useState<Range>([dayjs().startOf('month'), dayjs().endOf('month')]);
  const [warehouses, setWarehouses] = useState<Lookup[]>([]);
  const [items, setItems] = useState<Lookup[]>([]);

  useEffect(() => {
    api.get('/api/v1/warehouses').then((r) => setWarehouses(r.data)).catch((err) => console.error(err));
    api.get('/api/v1/items').then((r) => setItems(r.data)).catch((err) => console.error(err));
  }, []);

  const shared = { period, range, warehouses, items };

  return (
    <Card title="التقارير الشاملة">
      <Space wrap style={{ marginBottom: 16 }}>
        <span>الفترة:</span>
        <Select<Period>
          value={period}
          onChange={setPeriod}
          style={{ width: 130 }}
          options={(Object.keys(PERIOD_LABEL) as Period[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        />
        <RangePicker
          value={range as any}
          format="YYYY-MM-DD"
          onChange={(v) => setRange(v as Range)}
        />
        <Divider type="vertical" />
        <span>تصدير:</span>
        <ExportButton type="sales" label="المبيعات CSV" />
        <ExportButton type="purchases" label="المشتريات CSV" />
        <ExportButton type="treasury" label="الأرصدة CSV" />
      </Space>

      <Tabs
        defaultActiveKey="stagnant"
        items={[
          { key: 'production', label: <span><BuildOutlined /> الإنتاج والاستهلاك</span>, children: <ProductionTab {...shared} /> },
          { key: 'inventory', label: <span><DatabaseOutlined /> المخازن (الأرصدة)</span>, children: <InventoryTab {...shared} /> },
          { key: 'wastage', label: <span><DeleteOutlined /> الهوالك</span>, children: <WastageTab {...shared} /> },
          { key: 'stagnant', label: <span style={{ color: '#cf1322' }}><HourglassOutlined /> الرواكد</span>, children: <StagnantTab {...shared} /> },
          { key: 'sales', label: <span><ShoppingOutlined /> المبيعات</span>, children: <SalesTab {...shared} /> },
        ]}
      />
    </Card>
  );
}

interface TabProps {
  period: Period;
  range: Range;
  warehouses: Lookup[];
  items: Lookup[];
}

// --- 1) Production & consumption ----------------------------------------------------------
interface ProdRow {
  document_number: string;
  product_name: string;
  produced_quantity: string;
  consumed_quantity: string;
  material_cost: string;
  resource_cost: string;
  total_cost: string;
  created_at: string;
}
interface ProdPeriodRow {
  period: string;
  produced_quantity: string;
  consumed_quantity: string;
  total_cost: string;
}

function ProductionTab({ period, range, items }: TabProps) {
  const [productId, setProductId] = useState<number | undefined>();
  const [rows, setRows] = useState<ProdRow[]>([]);
  const [byPeriod, setByPeriod] = useState<ProdPeriodRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { period, ...dateParams(range) };
      if (productId) params.product_id = productId;
      const res = await api.get('/api/v1/reports/production', { params });
      setRows(res.data.rows || []);
      setByPeriod(res.data.by_period || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const periodCols = [
    { title: 'الفترة', dataIndex: 'period', key: 'period' },
    { title: 'المنتَج', dataIndex: 'produced_quantity', key: 'produced_quantity', align: 'left' as const, render: qty },
    { title: 'المستهلَك', dataIndex: 'consumed_quantity', key: 'consumed_quantity', align: 'left' as const, render: qty },
    { title: 'إجمالي التكلفة', dataIndex: 'total_cost', key: 'total_cost', align: 'left' as const, render: (v: string) => <strong>{egp(v)}</strong> },
  ];

  const detailCols = [
    { title: 'رقم المستند', dataIndex: 'document_number', key: 'document_number', render: (c: string) => <Tag color="blue">{c}</Tag> },
    { title: 'المنتج', dataIndex: 'product_name', key: 'product_name' },
    { title: 'المنتَج', dataIndex: 'produced_quantity', key: 'produced_quantity', align: 'left' as const, render: qty },
    { title: 'المستهلَك', dataIndex: 'consumed_quantity', key: 'consumed_quantity', align: 'left' as const, render: qty },
    { title: 'تكلفة الخامات', dataIndex: 'material_cost', key: 'material_cost', align: 'left' as const, render: egp },
    { title: 'تكلفة الموارد', dataIndex: 'resource_cost', key: 'resource_cost', align: 'left' as const, render: egp },
    { title: 'إجمالي التكلفة', dataIndex: 'total_cost', key: 'total_cost', align: 'left' as const, render: (v: string) => <strong>{egp(v)}</strong> },
    { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear showSearch optionFilterProp="label" placeholder="كل المنتجات"
          style={{ width: 240 }} value={productId} onChange={setProductId}
          options={items.map((i) => ({ value: i.id, label: i.name }))}
        />
        <Button type="primary" icon={<ReloadOutlined />} onClick={load} loading={loading}>تطبيق</Button>
      </Space>

      <Divider orientation="right">ملخص حسب الفترة ({PERIOD_LABEL[period]})</Divider>
      <Table rowKey={(r) => r.period} size="small" loading={loading} pagination={false}
        dataSource={byPeriod} columns={periodCols}
        locale={{ emptyText: <Empty description="لا توجد بيانات" /> }} />

      <Divider orientation="right">التفاصيل</Divider>
      <Table rowKey={(r) => r.document_number} loading={loading} pagination={{ pageSize: 10 }}
        dataSource={rows} columns={detailCols}
        locale={{ emptyText: <Empty description="لا توجد بيانات" /> }} />
    </div>
  );
}

// --- 2) Inventory balances ----------------------------------------------------------------
interface InvRow {
  item_name: string;
  warehouse_id: number;
  on_hand: string;
  unit_cost: string;
  value: string;
}

function InventoryTab({ warehouses, items }: TabProps) {
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [itemId, setItemId] = useState<number | undefined>();
  const [rows, setRows] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(false);

  const whName = (id: number) => warehouses.find((w) => w.id === id)?.name ?? `#${id}`;

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (warehouseId) params.warehouse_id = warehouseId;
      if (itemId) params.item_id = itemId;
      const res = await api.get('/api/v1/reports/inventory', { params });
      setRows(res.data.rows || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const columns = [
    { title: 'الصنف', dataIndex: 'item_name', key: 'item_name' },
    { title: 'المخزن', dataIndex: 'warehouse_id', key: 'warehouse_id', render: (id: number) => <Tag color="geekblue">{whName(id)}</Tag> },
    { title: 'الرصيد', dataIndex: 'on_hand', key: 'on_hand', align: 'left' as const, render: qty },
    { title: 'تكلفة الوحدة', dataIndex: 'unit_cost', key: 'unit_cost', align: 'left' as const, render: egp },
    { title: 'القيمة', dataIndex: 'value', key: 'value', align: 'left' as const, render: (v: string) => <strong>{egp(v)}</strong> },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear placeholder="كل المخازن" style={{ width: 200 }} value={warehouseId} onChange={setWarehouseId}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        />
        <Select
          allowClear showSearch optionFilterProp="label" placeholder="كل الأصناف"
          style={{ width: 240 }} value={itemId} onChange={setItemId}
          options={items.map((i) => ({ value: i.id, label: i.name }))}
        />
        <Button type="primary" icon={<ReloadOutlined />} onClick={load} loading={loading}>تطبيق</Button>
      </Space>

      <Table rowKey={(r) => `${r.item_name}-${r.warehouse_id}`} loading={loading} pagination={{ pageSize: 12 }}
        dataSource={rows} columns={columns}
        summary={(data) => {
          const total = data.reduce((s, r) => s + Number(r.value ?? 0), 0);
          return (
            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
              <Table.Summary.Cell index={0} colSpan={4}>إجمالي القيمة</Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="left">{egp(total)}</Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
        locale={{ emptyText: <Empty description="لا توجد بيانات" /> }} />
    </div>
  );
}

// --- 3) Wastage ---------------------------------------------------------------------------
interface WasteRow {
  source: 'manufacturing' | 'document';
  document_number: string;
  item_name: string;
  warehouse_id: number;
  quantity: string;
  cost: string;
  created_at: string;
}

function WastageTab({ range, warehouses, items }: TabProps) {
  const [itemId, setItemId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [rows, setRows] = useState<WasteRow[]>([]);
  const [totalQty, setTotalQty] = useState<string>('0');
  const [totalCost, setTotalCost] = useState<string>('0');
  const [loading, setLoading] = useState(false);

  const whName = (id: number) => warehouses.find((w) => w.id === id)?.name ?? `#${id}`;

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { ...dateParams(range) };
      if (itemId) params.item_id = itemId;
      if (warehouseId) params.warehouse_id = warehouseId;
      const res = await api.get('/api/v1/reports/wastage', { params });
      setRows(res.data.rows || []);
      setTotalQty(res.data.total_quantity ?? '0');
      setTotalCost(res.data.total_cost ?? '0');
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const columns = [
    { title: 'المصدر', dataIndex: 'source', key: 'source', width: 110,
      render: (s: string) => s === 'manufacturing'
        ? <Tag color="orange">تصنيع</Tag>
        : <Tag color="volcano">إذن هالك</Tag> },
    { title: 'رقم المستند', dataIndex: 'document_number', key: 'document_number', render: (c: string) => <Tag color="blue">{c}</Tag> },
    { title: 'الصنف', dataIndex: 'item_name', key: 'item_name' },
    { title: 'المخزن', dataIndex: 'warehouse_id', key: 'warehouse_id', render: (id: number) => <Tag color="geekblue">{whName(id)}</Tag> },
    { title: 'الكمية', dataIndex: 'quantity', key: 'quantity', align: 'left' as const, render: qty },
    { title: 'التكلفة', dataIndex: 'cost', key: 'cost', align: 'left' as const, render: (v: string) => <strong>{egp(v)}</strong> },
    { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear showSearch optionFilterProp="label" placeholder="كل الأصناف"
          style={{ width: 240 }} value={itemId} onChange={setItemId}
          options={items.map((i) => ({ value: i.id, label: i.name }))}
        />
        <Select
          allowClear placeholder="كل المخازن" style={{ width: 200 }} value={warehouseId} onChange={setWarehouseId}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        />
        <Button type="primary" icon={<ReloadOutlined />} onClick={load} loading={loading}>تطبيق</Button>
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card><Statistic title="إجمالي كمية الهالك" value={Number(totalQty)} precision={3} valueStyle={{ color: '#cf1322' }} /></Card>
        </Col>
        <Col span={12}>
          <Card><Statistic title="إجمالي تكلفة الهالك" value={Number(totalCost)} precision={2} valueStyle={{ color: '#cf1322' }} suffix="ج.م" /></Card>
        </Col>
      </Row>

      <Table rowKey={(r, i) => `${r.source}-${r.document_number}-${i}`} loading={loading} pagination={{ pageSize: 12 }}
        dataSource={rows} columns={columns}
        locale={{ emptyText: <Empty description="لا توجد بيانات" /> }} />
    </div>
  );
}

// --- 4) Stagnant (critical) ---------------------------------------------------------------
interface StagnantRow {
  item_name: string;
  warehouse_id: number;
  on_hand: string;
  last_out_date: string | null;
  value: string;
}

function StagnantTab({ warehouses }: TabProps) {
  const [days, setDays] = useState<number>(90);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [rows, setRows] = useState<StagnantRow[]>([]);
  const [asOf, setAsOf] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const whName = (id: number) => warehouses.find((w) => w.id === id)?.name ?? `#${id}`;

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { days };
      if (warehouseId) params.warehouse_id = warehouseId;
      const res = await api.get('/api/v1/reports/stagnant', { params });
      setRows(res.data.rows || []);
      setAsOf(res.data.as_of || '');
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const columns = [
    { title: 'الصنف', dataIndex: 'item_name', key: 'item_name' },
    { title: 'المخزن', dataIndex: 'warehouse_id', key: 'warehouse_id', render: (id: number) => <Tag color="geekblue">{whName(id)}</Tag> },
    { title: 'الرصيد', dataIndex: 'on_hand', key: 'on_hand', align: 'left' as const, render: qty },
    { title: 'آخر صرف', dataIndex: 'last_out_date', key: 'last_out_date',
      render: (d: string | null) => d
        ? dayjs(d).format('YYYY-MM-DD')
        : <Tag color="red">لم يتحرك مطلقاً</Tag> },
    { title: 'القيمة', dataIndex: 'value', key: 'value', align: 'left' as const, render: (v: string) => <strong>{egp(v)}</strong> },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <span>عدد الأيام دون حركة:</span>
        <InputNumber min={1} value={days} onChange={(v) => setDays(v || 90)} style={{ width: 120 }} />
        <Select
          allowClear placeholder="كل المخازن" style={{ width: 200 }} value={warehouseId} onChange={setWarehouseId}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        />
        <Button type="primary" danger icon={<ReloadOutlined />} onClick={load} loading={loading}>تطبيق</Button>
        {asOf && <Tag color="default">حتى تاريخ: {dayjs(asOf).format('YYYY-MM-DD')}</Tag>}
      </Space>

      <Table rowKey={(r) => `${r.item_name}-${r.warehouse_id}`} loading={loading} pagination={{ pageSize: 12 }}
        dataSource={rows} columns={columns}
        rowClassName={(r) => (r.last_out_date === null ? 'stagnant-never-moved' : '')}
        onRow={(r) => (r.last_out_date === null ? { style: { background: '#fff1f0' } } : {})}
        summary={(data) => {
          const total = data.reduce((s, r) => s + Number(r.value ?? 0), 0);
          return (
            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 'bold' }}>
              <Table.Summary.Cell index={0} colSpan={4}>إجمالي قيمة الرواكد</Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="left">{egp(total)}</Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
        locale={{ emptyText: <Empty description="لا توجد رواكد" /> }} />
    </div>
  );
}

// --- 5) Sales -----------------------------------------------------------------------------
interface SalesRow {
  document_number: string;
  customer_id: number | null;
  gross: string;
  net: string;
  created_at: string;
}
interface SalesPeriodRow {
  period: string;
  gross: string;
  net: string;
}

function SalesTab({ period, range }: TabProps) {
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [byPeriod, setByPeriod] = useState<SalesPeriodRow[]>([]);
  const [grossTotal, setGrossTotal] = useState<string>('0');
  const [netTotal, setNetTotal] = useState<string>('0');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { period, ...dateParams(range) };
      const res = await api.get('/api/v1/reports/sales', { params });
      setRows(res.data.rows || []);
      setByPeriod(res.data.by_period || []);
      setGrossTotal(res.data.gross_total ?? '0');
      setNetTotal(res.data.net_total ?? '0');
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const periodCols = [
    { title: 'الفترة', dataIndex: 'period', key: 'period' },
    { title: 'الإجمالي', dataIndex: 'gross', key: 'gross', align: 'left' as const, render: egp },
    { title: 'الصافي', dataIndex: 'net', key: 'net', align: 'left' as const, render: (v: string) => <strong>{egp(v)}</strong> },
  ];

  const detailCols = [
    { title: 'رقم المستند', dataIndex: 'document_number', key: 'document_number', render: (c: string) => <Tag color="blue">{c}</Tag> },
    { title: 'العميل', dataIndex: 'customer_id', key: 'customer_id', render: (id: number | null) => id ? `#${id}` : '-' },
    { title: 'الإجمالي', dataIndex: 'gross', key: 'gross', align: 'left' as const, render: egp },
    { title: 'الصافي', dataIndex: 'net', key: 'net', align: 'left' as const, render: (v: string) => <strong>{egp(v)}</strong> },
    { title: 'التاريخ', dataIndex: 'created_at', key: 'created_at', render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '-' },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<ReloadOutlined />} onClick={load} loading={loading}>تطبيق</Button>
        <ExportButton type="sales" label="تصدير CSV" />
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card><Statistic title="إجمالي المبيعات" value={Number(grossTotal)} precision={2} valueStyle={{ color: '#888' }} suffix="ج.م" /></Card>
        </Col>
        <Col span={12}>
          <Card><Statistic title="صافي المبيعات" value={Number(netTotal)} precision={2} valueStyle={{ color: '#3f8600' }} suffix="ج.م" /></Card>
        </Col>
      </Row>

      <Divider orientation="right">ملخص حسب الفترة ({PERIOD_LABEL[period]})</Divider>
      <Table rowKey={(r) => r.period} size="small" loading={loading} pagination={false}
        dataSource={byPeriod} columns={periodCols}
        locale={{ emptyText: <Empty description="لا توجد بيانات" /> }} />

      <Divider orientation="right">التفاصيل</Divider>
      <Table rowKey={(r) => r.document_number} loading={loading} pagination={{ pageSize: 10 }}
        dataSource={rows} columns={detailCols}
        locale={{ emptyText: <Empty description="لا توجد بيانات" /> }} />
    </div>
  );
}

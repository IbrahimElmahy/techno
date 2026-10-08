import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Select, Table } from 'antd';
import { ClearOutlined, DollarOutlined, PrinterOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ListPage, { ListStat } from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts } from '../components/keyboard';
import { useTableColumns } from '../components/ColumnSettings';
import { api } from '../api/client';
import { PAGE_SIZE } from '../utils/pagination';
import { money, qty } from '../utils/money';
import { searchFilter, searchRank, sortByName } from '../utils/arabicSort';
import { STOCK_TOPICS, useLiveRefresh } from '../utils/live';

interface Row {
  key: string;
  item_id: number;
  code: string;
  item_name: string;
  category: string | null;
  unit: string | null;
  warehouse: string;
  branch: string;
  on_hand: string;
  min_stock: string | null;
  max_stock: string | null;
  purchase_price: string;
  purchase_discount_pct: string;
  purchase_net: string;
  purchase_value: string;
  sale_price: string;
  sale_discount_pct: string;
  sale_net: string;
  sale_value: string;
  sale_net_value: string;
  profit: string;
  margin_pct: string | null;
  commercial: string | null;
  semi_commercial: string | null;
  wholesale: string | null;
  semi_wholesale: string | null;
  consumer: string | null;
  last_in: string | null;
  last_out: string | null;
  active: boolean;
}

const PURCHASE_KEYS = ['purchase_price', 'purchase_discount_pct', 'purchase_net', 'purchase_value'];
const SALE_KEYS = ['sale_price', 'sale_discount_pct', 'sale_net', 'sale_value', 'sale_net_value'];
const EXTRA_KEYS = ['commercial', 'semi_commercial', 'wholesale', 'semi_wholesale', 'consumer',
  'min_stock', 'max_stock', 'branch', 'active'];

type Basis = 'sale' | 'purchase';

export default function StockValue() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [warehouses, setWarehouses] = useState<{ id: number; name: string }[]>([]);
  const [tab, setTab] = useQueryTab('sale');
  const basis: Basis = tab === 'purchase' ? 'purchase' : 'sale';
  const searchRef = useRef<any>(null);

  const load = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/stock-value', {
        params: warehouseId ? { warehouse_id: warehouseId } : {},
      });
      setRows(res.data.rows || []);
    } catch (err) { console.error(err); } finally { if (!opts?.silent) setLoading(false); }
  };

  useEffect(() => {
    api.get('/api/v1/warehouses').then((r) => setWarehouses(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [warehouseId]);
  useLiveRefresh(STOCK_TOPICS, () => load({ silent: true }));
  useScreenShortcuts({ onSearch: () => searchRef.current?.focus?.() });

  const filter = useListFilter(rows, { search: (r) => [r.code, r.item_name, r.category, r.warehouse] });

  const totals = useMemo(() => {
    let q = 0; let value = 0; let priced = 0;
    filter.filtered.forEach((r) => {
      q += Number(r.on_hand || 0);
      const v = Number(basis === 'sale' ? r.sale_value : r.purchase_value);
      value += v;
      if (v > 0) priced += 1;
    });
    return { q, value, priced, count: new Set(filter.filtered.map((r) => r.item_id)).size, lines: filter.filtered.length };
  }, [filter.filtered, basis]);

  const pct = (v: string | null) => (v !== null && v !== undefined && Number(v) ? `${Number(v)}٪` : '');
  const m = (v: string | null) => (v === null || v === undefined ? '' : money(v));
  const num = (key: keyof Row, title: string, opts: any = {}) => ({
    title, dataIndex: key, key, align: 'left' as const, total: false, render: m, ...opts,
  });

  const columns = [
    { title: 'الكود', dataIndex: 'code', key: 'code', width: 110 },
    { title: 'الصنف', dataIndex: 'item_name', key: 'item_name',
      render: (v: string, r: Row) => <a onClick={() => navigate(`/catalog/${r.item_id}`)}>{v}</a> },
    { title: 'الفئة', dataIndex: 'category', key: 'category', render: (v: string | null) => v || '' },
    { title: 'الوحدة', dataIndex: 'unit', key: 'unit', width: 90 },
    { title: 'المخزن', dataIndex: 'warehouse', key: 'warehouse' },
    { title: 'الفرع', dataIndex: 'branch', key: 'branch' },
    { title: 'العدد', dataIndex: 'on_hand', key: 'on_hand', align: 'left' as const, render: (v: string) => qty(v) },
    num('min_stock', 'الحد الأدنى', { render: (v: string | null) => (v ? qty(v) : '') }),
    num('max_stock', 'الحد الأقصى', { render: (v: string | null) => (v ? qty(v) : '') }),
    num('purchase_price', 'سعر الشراء'),
    num('purchase_discount_pct', 'خصم الشراء ٪', { render: pct, width: 110 }),
    num('purchase_net', 'صافي سعر الشراء'),
    num('purchase_value', 'الإجمالي بسعر الشراء', { total: true, render: (v: string) => <b>{money(v)}</b> }),
    num('sale_price', 'سعر البيع'),
    num('sale_discount_pct', 'خصم البيع ٪', { render: pct, width: 110 }),
    num('sale_net', 'صافي سعر البيع'),
    num('sale_value', 'الإجمالي بسعر البيع', { total: true, render: (v: string) => <b>{money(v)}</b> }),
    num('sale_net_value', 'الإجمالي بعد الخصم', { total: true }),
    num('profit', 'الربح المتوقع', { total: true,
      render: (v: string) => <span style={{ color: Number(v) < 0 ? '#cf1322' : undefined }}>{money(v)}</span> }),
    num('margin_pct', 'هامش الربح ٪', { render: pct, width: 110 }),
    num('commercial', 'سعر التجاري'),
    num('semi_commercial', 'سعر نصف التجاري'),
    num('wholesale', 'سعر الجملة'),
    num('semi_wholesale', 'سعر نصف الجملة'),
    num('consumer', 'سعر المستهلك'),
    { title: 'آخر وارد', dataIndex: 'last_in', key: 'last_in', width: 110, render: (v: string | null) => v || '' },
    { title: 'آخر منصرف', dataIndex: 'last_out', key: 'last_out', width: 110, render: (v: string | null) => v || '' },
    { title: 'الحالة', dataIndex: 'active', key: 'active', width: 90,
      render: (v: boolean) => (v ? 'نشط' : 'موقوف') },
  ];
  const cols = useTableColumns(`stock-value-${basis}`, columns as any, {
    defaultHidden: [...(basis === 'sale' ? PURCHASE_KEYS : SALE_KEYS), 'profit', 'margin_pct', ...EXTRA_KEYS],
    export: { name: basis === 'sale' ? 'قيمة المخزون بسعر البيع' : 'قيمة المخزون بسعر الشراء', rows: filter.filtered },
  });

  return (
    <ListPage
      icon={<DollarOutlined />}
      title="قيمة المخزون"
      tabs={[
        { key: 'sale', label: 'بسعر البيع' },
        { key: 'purchase', label: 'بسعر الشراء' },
      ]}
      activeTab={basis as any}
      onTabChange={(k) => setTab(k)}
      actions={(<>
        {cols.control}
        <Button icon={<PrinterOutlined />} onClick={() => window.print()}>طباعة</Button>
        <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
          placeholder="بحث بالصنف أو الكود أو الفئة" prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        <Select allowClear showSearch placeholder="كل المخازن" style={{ minWidth: 180 }}
          value={warehouseId} onChange={(v) => setWarehouseId(v)}
          filterOption={searchFilter} filterSort={searchRank}
          options={sortByName(warehouses, (w) => w.name).map((w) => ({ value: w.id, label: w.name }))} />
        <Button className="sl-f-clear" icon={<ClearOutlined />}
          onClick={() => { filter.reset(); setWarehouseId(undefined); }}>مسح</Button>
      </>)}
      summary={(<>
        <ListStat label="عدد الأصناف" value={totals.count.toLocaleString('ar-EG')} />
        <ListStat label="إجمالي العدد" value={qty(totals.q)} />
        <ListStat label={basis === 'sale' ? 'القيمة بسعر البيع' : 'القيمة بسعر الشراء'}
          value={money(totals.value)} tone="strong" />
        {totals.priced < totals.lines && (
          <ListStat label="سطور بدون سعر" value={(totals.lines - totals.priced).toLocaleString('ar-EG')} tone="warn" />
        )}
      </>)}
    >
      <Table<Row>
        className="sl-table" rowKey="key" size="small" loading={loading}
        dataSource={filter.filtered} columns={cols.columns as any}
        locale={{ emptyText: 'لا توجد أصناف لها رصيد' }}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
      />
    </ListPage>
  );
}

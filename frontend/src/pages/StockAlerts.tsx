import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Tag, message } from 'antd';
import { AlertOutlined, ClearOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { Table } from 'antd';
import ListPage, { ListStat } from '../components/ListPage';
import { InputNumber } from '../components/NumberInput';
import { useQueryTab } from '../components/useQueryTab';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts } from '../components/keyboard';
import { useTableColumns } from '../components/ColumnSettings';
import { api } from '../api/client';
import { PAGE_SIZE } from '../utils/pagination';
import { qty, numeralsLocale } from '../utils/money';
import { STOCK_TOPICS, useLiveRefresh } from '../utils/live';

interface Row {
  item_id: number;
  code: string | null;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  on_hand: string;
  min_stock: string | null;
  max_stock: string | null;
  shortfall: string | null;
  excess: string | null;
  flag: 'below_min' | 'above_max' | 'ok' | 'unset';
}

const FLAG: Record<Row['flag'], { label: string; color: string }> = {
  below_min: { label: 'تحت الحد', color: 'red' },
  above_max: { label: 'فوق الحد', color: 'orange' },
  ok: { label: 'سليم', color: 'green' },
  unset: { label: 'بدون حد', color: 'default' },
};

function LimitCell({ row, field, onSaved }: {
  row: Row; field: 'min_stock' | 'max_stock'; onSaved: (r: Row) => void;
}) {
  const initial = row[field] === null ? undefined : Number(row[field]);
  const [value, setValue] = useState<number | undefined>(initial);
  useEffect(() => { setValue(initial); }, [row[field]]);

  const save = async () => {
    const before = initial ?? null;
    const after = value ?? null;
    if (before === after) return;
    try {
      await api.patch(`/api/v1/items/${row.item_id}`, { [field]: after === null ? null : String(after) });
      onSaved({ ...row, [field]: after === null ? null : String(after) });
      message.success('تم الحفظ');
    } catch (err: any) {
      message.error(err?.response?.data?.detail?.message || 'تعذر الحفظ');
      setValue(initial);
    }
  };

  return (
    <InputNumber size="small" min={0} style={{ width: 110 }} value={value}
      onChange={(v) => setValue(v ?? undefined)} onBlur={save}
      onPressEnter={(e: any) => { e.target.blur(); }}
      onClick={(e) => e.stopPropagation()} />
  );
}

function recompute(r: Row): Row {
  const have = Number(r.on_hand || 0);
  const min = r.min_stock === null ? null : Number(r.min_stock);
  const max = r.max_stock === null ? null : Number(r.max_stock);
  let flag: Row['flag'] = 'ok';
  if (min === null && max === null) flag = 'unset';
  else if (min !== null && have < min) flag = 'below_min';
  else if (max !== null && have > max) flag = 'above_max';
  return {
    ...r, flag,
    shortfall: flag === 'below_min' && min !== null ? String(min - have) : null,
    excess: flag === 'above_max' && max !== null ? String(have - max) : null,
  };
}

export default function StockAlerts() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useQueryTab('below_min');
  const searchRef = useRef<any>(null);

  const load = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/reorder', { params: { include_all: true } });
      setRows(res.data.rows || []);
    } catch (err) { console.error(err); } finally { if (!opts?.silent) setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useLiveRefresh(STOCK_TOPICS, () => load({ silent: true }));
  useScreenShortcuts({ onSearch: () => searchRef.current?.focus?.() });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, below_min: 0, above_max: 0, ok: 0, unset: 0 };
    rows.forEach((r) => { c[r.flag] += 1; });
    return c;
  }, [rows]);

  const tabRows = tab === 'all' ? rows : rows.filter((r) => r.flag === tab);
  const filter = useListFilter(tabRows, { search: (r) => [r.code, r.name, r.category] });

  const update = (r: Row) => setRows((prev) => prev.map((x) => (x.item_id === r.item_id ? recompute(r) : x)));

  const columns = [
    { title: 'الصنف', dataIndex: 'name', key: 'name',
      render: (v: string, r: Row) => <a onClick={() => navigate(`/catalog/${r.item_id}`)}>{v}</a> },
    { title: 'الفئة', dataIndex: 'category', key: 'category', render: (v: string | null) => v || '' },
    { title: 'الوحدة', dataIndex: 'unit_of_measure', key: 'unit_of_measure', width: 90 },
    { title: 'الرصيد الحالي', dataIndex: 'on_hand', key: 'on_hand', align: 'left' as const, total: false,
      render: (v: string) => <b>{qty(v)}</b> },
    { title: 'الحد الأدنى', dataIndex: 'min_stock', key: 'min_stock', width: 130, total: false, filterable: false,
      render: (_: any, r: Row) => <LimitCell row={r} field="min_stock" onSaved={update} /> },
    { title: 'الحد الأقصى', dataIndex: 'max_stock', key: 'max_stock', width: 130, total: false, filterable: false,
      render: (_: any, r: Row) => <LimitCell row={r} field="max_stock" onSaved={update} /> },
    { title: 'المطلوب شراؤه', dataIndex: 'shortfall', key: 'shortfall', align: 'left' as const,
      render: (v: string | null) => (v ? <b style={{ color: '#cf1322' }}>{qty(v)}</b> : '') },
    { title: 'الزائد', dataIndex: 'excess', key: 'excess', align: 'left' as const,
      render: (v: string | null) => (v ? qty(v) : '') },
    { title: 'الحالة', dataIndex: 'flag', key: 'flag', width: 110,
      render: (f: Row['flag']) => <Tag color={FLAG[f].color}>{FLAG[f].label}</Tag> },
  ];
  const cols = useTableColumns('stock-reorder', columns as any, {
    export: { name: 'حد إعادة الطلب', rows: filter.filtered },
  });

  const fmt = (n: number) => n.toLocaleString(numeralsLocale());

  return (
    <ListPage
      icon={<AlertOutlined />}
      title="حد إعادة الطلب"
      tabs={[
        { key: 'below_min', label: 'تحت الحد', count: counts.below_min, dot: '#cf1322' },
        { key: 'above_max', label: 'فوق الحد', count: counts.above_max },
        { key: 'unset', label: 'بدون حد', count: counts.unset },
        { key: 'all', label: 'كل الأصناف', count: counts.all },
      ]}
      activeTab={tab as any}
      onTabChange={(k) => setTab(k)}
      actions={(<>
        {cols.control}
        <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>تحديث</Button>
      </>)}
      filters={(<>
        <Input className="sl-f-search" allowClear ref={searchRef} value={filter.query}
          placeholder="بحث بالصنف أو الكود أو الفئة" prefix={<SearchOutlined />}
          onChange={(e) => filter.setQuery(e.target.value)} />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={filter.reset}>مسح</Button>
      </>)}
      summary={(<>
        <ListStat label="تحت الحد" value={fmt(counts.below_min)} tone="neg" />
        <ListStat label="فوق الحد" value={fmt(counts.above_max)} tone="warn" />
        <ListStat label="بدون حد" value={fmt(counts.unset)} />
      </>)}
    >
      <Table<Row>
        className="sl-table" rowKey="item_id" size="small" loading={loading}
        dataSource={filter.filtered} columns={cols.columns as any}
        locale={{ emptyText: tab === 'below_min' ? 'لا توجد أصناف تحت الحد' : 'لا توجد أصناف' }}
        pagination={{ defaultPageSize: PAGE_SIZE, showSizeChanger: true }}
      />
    </ListPage>
  );
}

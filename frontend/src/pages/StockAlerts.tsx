import React, { useEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../utils/pagination';
import { Button, Input, Tag } from 'antd';
import { FilterTable as Table } from '../components/FilterTable';
import { AlertOutlined, ClearOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import ListPage from '../components/ListPage';
import { useQueryTab } from '../components/useQueryTab';
import { api } from '../api/client';
import { useListFilter } from '../components/ListToolbar';
import { useScreenShortcuts, useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn, choiceColumn } from '../components/gridColumns';
import { useTableColumns } from '../components/ColumnSettings';
import { useNavigate } from 'react-router-dom';

import { qty, numeralsLocale } from '../utils/money';
import { STOCK_TOPICS, useLiveRefresh } from '../utils/live';

interface ReorderRow {
  item_id: number;
  code: string | null;
  name: string;
  unit_of_measure: string | null;
  on_hand: string;
  min_stock: string | null;
  max_stock: string | null;
  shortfall: string | null;
  excess: string | null;
  flag: 'below_min' | 'above_max';
}

export default function StockAlerts() {
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [summary, setSummary] = useState({ below_min: 0, above_max: 0 });
  const [loading, setLoading] = useState(false);

  const loadReorder = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/api/v1/reports/reorder');
      setReorder(res.data.rows || []);
      setSummary({ below_min: res.data.below_min || 0, above_max: res.data.above_max || 0 });
    } catch (err) { console.error(err); } finally { if (!silent) setLoading(false); }
  };

  useEffect(() => { loadReorder(); }, []);
  useLiveRefresh(STOCK_TOPICS, () => loadReorder({ silent: true }));

  const reorderFilter = useListFilter(reorder, {
    search: (r) => [r.code, r.name],
    filters: { flag: (r, v) => r.flag === v },
  });
  const navigate = useNavigate();
  const reorderKb = useTableKeyboard<ReorderRow>({
    rows: reorderFilter.filtered, rowKey: (r) => r.item_id,
    onOpen: (r) => navigate(`/catalog/${r.item_id}`),
  });


  const columns = [
    { title: 'الصنف', dataIndex: 'name', ...textColumn(reorder, (r: ReorderRow) => r.name),
      render: (n: string) => <b>{n}</b> },
    { title: 'الرصيد الحالي', dataIndex: 'on_hand',
      ...numberColumn<ReorderRow>((r) => r.on_hand),
      render: (v: string, r: ReorderRow) => (
        <span style={{ fontWeight: 600,
          color: r.flag === 'below_min' ? '#cf1322' : '#F5A11D' }}>
          {qty(v)} {r.unit_of_measure || ''}
        </span>
      ) },
    { title: 'الحد الأدنى', dataIndex: 'min_stock',
      ...numberColumn<ReorderRow>((r) => r.min_stock),
      render: (v: string) => (v ? qty(v) : '-') },
    { title: 'الحد الأقصى', dataIndex: 'max_stock',
      ...numberColumn<ReorderRow>((r) => r.max_stock),
      render: (v: string) => (v ? qty(v) : '-') },
    { title: 'المطلوب شراؤه', dataIndex: 'shortfall',
      ...numberColumn<ReorderRow>((r) => r.shortfall),
      render: (v: string | null) => (v
        ? <b style={{ color: '#cf1322' }}>{qty(v)}</b> : '-') },
    { title: 'الزائد', dataIndex: 'excess',
      ...numberColumn<ReorderRow>((r) => r.excess),
      render: (v: string | null) => (v
        ? <b style={{ color: '#F5A11D' }}>{qty(v)}</b> : '-') },
    { title: 'الحالة', dataIndex: 'flag',
      ...choiceColumn<ReorderRow>(
        [{ text: 'تحت الأدنى', value: 'below_min' },
         { text: 'فوق الأقصى', value: 'above_max' }],
        (r, v) => r.flag === v),
      render: (f: string) => (f === 'below_min'
        ? <Tag color="red">تحت الأدنى</Tag>
        : <Tag color="orange">فوق الأقصى</Tag>) },
  ];

  const tableCols = useTableColumns('stock-alerts', columns, {
    export: { name: 'تنبيهات المخزون', rows: reorderFilter.filtered },
  });

  const searchRef = useRef<any>(null);
  useScreenShortcuts({ onSearch: () => { searchRef.current?.focus?.(); } });

  type FlagTab = 'all' | 'below_min' | 'above_max';
  const flagValue = reorderFilter.values.flag;
  const activeFlag: FlagTab = flagValue === 'below_min' || flagValue === 'above_max' ? flagValue : 'all';
  const [listTab, setListTab] = useQueryTab('all');
  const lastTab = useRef(activeFlag);
  useEffect(() => {
    if (listTab === 'below_min' || listTab === 'above_max') reorderFilter.setValue('flag', listTab);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (lastTab.current === activeFlag) return;
    lastTab.current = activeFlag;
    if (activeFlag !== listTab) setListTab(activeFlag);
  }, [activeFlag]); // eslint-disable-line react-hooks/exhaustive-deps
  const flagTabs: { key: FlagTab; label: string; dot?: string; count?: number }[] = [
    { key: 'all', label: 'الكل', count: reorder.length },
    { key: 'below_min', label: 'تحت الحد الأدنى', dot: '#cf1322', count: summary.below_min },
    { key: 'above_max', label: 'فوق الحد الأقصى', dot: '#F5A11D', count: summary.above_max },
  ];

  const footer = (
    <span className="sl-foot">
      <span>المعروض: <b>{reorderFilter.filtered.length.toLocaleString(numeralsLocale())}</b>
        {' '}من {reorder.length.toLocaleString(numeralsLocale())} صنف</span>
      <span>تحتاج شراء: <b className={summary.below_min ? 'is-neg' : undefined}>
        {summary.below_min.toLocaleString(numeralsLocale())}</b></span>
      <span>تكدّس: <b style={summary.above_max ? { color: '#F5A11D' } : undefined}>
        {summary.above_max.toLocaleString(numeralsLocale())}</b></span>
    </span>
  );

  return (
    <ListPage<FlagTab>
      icon={<AlertOutlined />}
      title="حد إعادة الطلب"
      tabs={flagTabs} activeTab={activeFlag}
      onTabChange={(k) => reorderFilter.setValue('flag', k === 'all' ? undefined : k)}
      actions={(<>
        {tableCols.control}
        <Button icon={<ReloadOutlined />} onClick={() => loadReorder()}>تحديث</Button>
      </>)}
      filters={(<>
        <Input
          className="sl-f-search" allowClear ref={searchRef}
          prefix={<SearchOutlined />} placeholder="بحث بالصنف أو الكود"
          value={reorderFilter.query} onChange={(e) => reorderFilter.setQuery(e.target.value)}
        />
        <Button className="sl-f-clear" icon={<ClearOutlined />} onClick={reorderFilter.reset}>مسح</Button>
      </>)}
    >
              <Table
                {...reorderKb.tableProps}
                className="sl-table"
                rowKey="item_id" size="small" loading={loading}
                dataSource={reorderFilter.filtered}
                locale={{ emptyText: 'جميع الأصناف ضمن حدودها' }}
                pagination={{
                  defaultPageSize: PAGE_SIZE, showSizeChanger: true,
                  locale: { items_per_page: '' },
                  showTotal: () => footer,
                }}
                columns={tableCols.columns}
              />
    </ListPage>
  );
}

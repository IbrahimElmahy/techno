import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, DatePicker, Select, Space, Statistic, Table, Tabs, Tag, message,
} from 'antd';
import { ReloadOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useTableColumns } from '../components/ColumnSettings';
import ListToolbar, { useListFilter } from '../components/ListToolbar';
import DateRangeFilter from '../components/DateRangeFilter';
import { useQueryTab } from '../components/useQueryTab';
import { useTableKeyboard } from '../components/keyboard';
import { textColumn, numberColumn } from '../components/gridColumns';

/**
 * تقارير مندوبين — three of their four report screens; the fourth (عمولة تحصيلات مندوبين) already
 * lives on the finance screen and its menu entry points there.
 *
 * Nothing new is recorded to produce these. A receipt has always carried who took it and from whom,
 * and an invoice has always carried its rep — what was missing was reading it that way round.
 *
 * The period is shared across the three tabs on purpose: «how much did he collect» and «what did he
 * sell» are asked about the same month, and two pickers that can disagree is how somebody compares
 * March against April without noticing.
 */

interface CollectionRow {
  rep_user_id: number; rep_name: string; receipts: number; collected: string;
}
interface ByCustomerRow extends CollectionRow {
  customer_id: number | null; customer_name: string | null;
}
interface RepItemRow {
  rep_user_id: number; rep_name: string; item_id: number; item_name: string;
  quantity: string; net: string;
}

const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function RepReports() {
  const navigate = useNavigate();
  const [tab, setTab] = useQueryTab('collections', 'view');
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(
    [dayjs().startOf('month'), dayjs()]);
  const [repId, setRepId] = useState<number | undefined>();

  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [byCustomer, setByCustomer] = useState<ByCustomerRow[]>([]);
  const [items, setItems] = useState<RepItemRow[]>([]);
  const [loading, setLoading] = useState(false);

  const params = useMemo(() => {
    const p: any = {};
    if (range) { p.date_from = range[0].format('YYYY-MM-DD'); p.date_to = range[1].format('YYYY-MM-DD'); }
    if (repId) p.rep_id = repId;
    return p;
  }, [range, repId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, b, i] = await Promise.all([
        api.get('/api/v1/rep-reports/collections', { params }),
        api.get('/api/v1/rep-reports/collections-by-customer', { params }),
        api.get('/api/v1/rep-reports/items', { params }),
      ]);
      setCollections(c.data || []); setByCustomer(b.data || []); setItems(i.data || []);
    } catch {
      message.error('تعذر تحميل تقارير المندوبين');
    } finally { setLoading(false); }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  // The rep list comes from the figures themselves rather than from a users call: these screens are
  // about who actually collected or sold, and a rep with nothing in the period has nothing to show.
  const repOptions = useMemo(() => {
    const seen = new Map<number, string>();
    [...collections, ...byCustomer, ...items]
      .forEach((r: any) => seen.set(r.rep_user_id, r.rep_name));
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [collections, byCustomer, items]);

  const totalCollected = collections.reduce((s, r) => s + Number(r.collected || 0), 0);
  const totalSold = items.reduce((s, r) => s + Number(r.net || 0), 0);

  const collectionFilter = useListFilter<CollectionRow>(collections, {
    search: (r) => [r.rep_name],
  });
  const customerFilter = useListFilter<ByCustomerRow>(byCustomer, {
    search: (r) => [r.rep_name, r.customer_name],
    filters: { rep_user_id: (r, v) => r.rep_user_id === v },
  });
  const itemFilter = useListFilter<RepItemRow>(items, {
    search: (r) => [r.rep_name, r.item_name],
    filters: { rep_user_id: (r, v) => r.rep_user_id === v },
  });

  const header = (
    <Space wrap>
      <div style={{ width: 280 }}>
        <DateRangeFilter
          value={range as any} onChange={(v) => setRange(v as any)} allowClear={false}
        />
      </div>
      <Select
        allowClear showSearch optionFilterProp="label" style={{ minWidth: 200 }}
        placeholder="كل المناديب" value={repId} onChange={setRepId} options={repOptions}
      />
      <Button icon={<ReloadOutlined />} onClick={load}>تحديث</Button>
    </Space>
  );

  // كل سطر هنا بيتكلم عن حد أو حاجة ليها ملف: المندوب، العميل، الصنف. فالسطر بيروح للملف ده،
  // بدل ما الاسم بس يكون لينك واللي بيقرا الأرقام على الشمال ما يوصلش لحاجة.
  const collectionKb = useTableKeyboard<CollectionRow>({
    rows: collectionFilter.filtered, rowKey: (r) => r.rep_user_id,
    onOpen: (r) => navigate(`/employees?rep=${r.rep_user_id}`),
  });
  const customerKb = useTableKeyboard<ByCustomerRow>({
    rows: customerFilter.filtered, rowKey: (r) => `${r.rep_user_id}-${r.customer_id ?? 0}`,
    onOpen: (r) => { if (r.customer_id) navigate(`/customers/${r.customer_id}`); },
  });
  const itemKb = useTableKeyboard<RepItemRow>({
    rows: itemFilter.filtered, rowKey: (r) => `${r.rep_user_id}-${r.item_id}`,
    onOpen: (r) => navigate(`/catalog/${r.item_id}`),
  });

  const repItemsColumns = [
    { title: 'المندوب', dataIndex: 'rep_name', width: 200,
      ...textColumn(items, (r: RepItemRow) => r.rep_name),
      render: (v: string) => <b>{v}</b> },
    { title: 'الصنف', dataIndex: 'item_name',
      ...textColumn(items, (r: RepItemRow) => r.item_name),
      render: (v: string, r: RepItemRow) => (
        <a onClick={() => navigate(`/catalog/${r.item_id}`)}>{v}</a>
      ) },
    { title: 'الكمية', dataIndex: 'quantity', width: 120,
      ...numberColumn<RepItemRow>((r) => r.quantity),
      render: (v: string) => qty(v) },
    // Net of the document's discount, so these add up to the invoices rather than
    // showing a rep selling more than the customer was billed.
    { title: 'الصافي', dataIndex: 'net', width: 165, align: 'left' as const,
      ...numberColumn<RepItemRow>((r) => r.net),
      render: (v: string) => <b>{money(v)} ج.م</b> },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const repItemsCols = useTableColumns('rep-item-sales', repItemsColumns);

  const repCustomersColumns = [
    { title: 'المندوب', dataIndex: 'rep_name', width: 200,
      ...textColumn(byCustomer, (r: ByCustomerRow) => r.rep_name),
      render: (v: string) => <b>{v}</b> },
    { title: 'العميل', dataIndex: 'customer_name',
      ...textColumn(byCustomer, (r: ByCustomerRow) => r.customer_name),
      // Money with no customer on it is still money the rep collected; dropping the
      // row would make this screen's total disagree with the one beside it.
      render: (v: string | null, r: ByCustomerRow) => (v && r.customer_id
        ? <a onClick={() => navigate(`/customers/${r.customer_id}`)}>{v}</a>
        : <Tag>بدون عميل</Tag>) },
    { title: 'عدد السندات', dataIndex: 'receipts', width: 130,
      ...numberColumn<ByCustomerRow>((r) => r.receipts) },
    { title: 'المُحصّل', dataIndex: 'collected', width: 165,
      align: 'left' as const,
      ...numberColumn<ByCustomerRow>((r) => r.collected),
      render: (v: string) => <b>{money(v)} ج.م</b> },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const repCustomersCols = useTableColumns('rep-collections-by-customer', repCustomersColumns);

  const repCollectionsColumns = [
    { title: 'المندوب', dataIndex: 'rep_name',
      ...textColumn(collections, (r: CollectionRow) => r.rep_name),
      render: (v: string) => <b>{v}</b> },
    { title: 'عدد السندات', dataIndex: 'receipts', width: 140,
      ...numberColumn<CollectionRow>((r) => r.receipts) },
    { title: 'المُحصّل', dataIndex: 'collected', width: 180,
      align: 'left' as const,
      ...numberColumn<CollectionRow>((r) => r.collected),
      render: (v: string) => (
        <b style={{ color: '#6AB42D' }}>{money(v)} ج.م</b>
      ) },
  ];

  // إخفاء وترتيب الأعمدة — نفس المحرك اللي كل الجداول بتستخدمه.
  const repCollectionsCols = useTableColumns('rep-collections', repCollectionsColumns);

  return (
    <Card title={<span><TeamOutlined /> تقارير المندوبين</span>} extra={header}>
      <Space size="large" style={{ marginBottom: 12 }}>
        <Statistic title="إجمالي المُحصّل" value={totalCollected} precision={2} suffix="ج.م"
          valueStyle={{ color: '#6AB42D' }} />
        <Statistic title="إجمالي المبيعات (صافي)" value={totalSold} precision={2} suffix="ج.م" />
      </Space>

      <Tabs
        activeKey={tab} onChange={setTab}
        items={[
          {
            key: 'collections',
            label: 'تحصيلات المندوبين',
            children: (
              <>
                <ListToolbar
                  searchPlaceholder="بحث باسم المندوب"
                  query={collectionFilter.query} onQueryChange={collectionFilter.setQuery}
                  onReset={collectionFilter.reset}
                  total={collections.length} shown={collectionFilter.filtered.length}
                  searchSpan={10}
                />
                <div style={{ textAlign: 'end', marginBottom: 8 }}>{repCollectionsCols.control}</div>
                <Table
                  {...collectionKb.tableProps}
                  rowKey="rep_user_id" size="middle" loading={loading}
                  dataSource={collectionFilter.filtered}
                  locale={{ emptyText: 'لا توجد تحصيلات في هذه الفترة' }}
                  pagination={false}
                  columns={repCollectionsCols.columns}
                />
              </>
            ),
          },
          {
            key: 'collections-by-customer',
            label: 'تحصيلات المندوبين عملاء',
            children: (
              <>
                <ListToolbar
                  searchPlaceholder="بحث بالمندوب أو العميل"
                  query={customerFilter.query} onQueryChange={customerFilter.setQuery}
                  values={customerFilter.values} onValueChange={customerFilter.setValue}
                  onReset={customerFilter.reset}
                  total={byCustomer.length} shown={customerFilter.filtered.length}
                  filters={[{ key: 'rep_user_id', placeholder: 'المندوب', span: 7,
                    options: repOptions }]}
                />
                <div style={{ textAlign: 'end', marginBottom: 8 }}>{repCustomersCols.control}</div>
                <Table
                  {...customerKb.tableProps}
                  rowKey={(r) => `${r.rep_user_id}-${r.customer_id ?? 0}`}
                  size="middle" loading={loading} dataSource={customerFilter.filtered}
                  locale={{ emptyText: 'لا توجد تحصيلات في هذه الفترة' }}
                  pagination={{ defaultPageSize: 20, showSizeChanger: true,
                    showTotal: (t) => `الإجمالي: ${t}` }}
                  columns={repCustomersCols.columns}
                />
              </>
            ),
          },
          {
            key: 'items',
            label: 'مبيعات اصناف مندوبين',
            children: (
              <>
                <ListToolbar
                  searchPlaceholder="بحث بالمندوب أو الصنف"
                  query={itemFilter.query} onQueryChange={itemFilter.setQuery}
                  values={itemFilter.values} onValueChange={itemFilter.setValue}
                  onReset={itemFilter.reset}
                  total={items.length} shown={itemFilter.filtered.length}
                  filters={[{ key: 'rep_user_id', placeholder: 'المندوب', span: 7,
                    options: repOptions }]}
                />
                <div style={{ textAlign: 'end', marginBottom: 8 }}>{repItemsCols.control}</div>
                <Table
                  {...itemKb.tableProps}
                  rowKey={(r) => `${r.rep_user_id}-${r.item_id}`}
                  size="middle" loading={loading} dataSource={itemFilter.filtered}
                  locale={{ emptyText: 'لا توجد مبيعات في هذه الفترة' }}
                  pagination={{ defaultPageSize: 20, showSizeChanger: true,
                    showTotal: (t) => `الإجمالي: ${t}` }}
                  columns={repItemsCols.columns}
                />
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

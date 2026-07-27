import React, { useEffect, useMemo, useState } from 'react';
import { Card, Col, Empty, Input, Radio, Row, Spin, Table, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import { useLookup, labelMap } from '../hooks/useLookup';
import { normalizeAr } from '../components/ListToolbar';

/**
 * رصيد صنف — the storekeeper's enquiry screen: pick a category, pick an item, and every price and
 * every warehouse's quantity is on screen at once.
 *
 * Built for flicking, not for reading: the three panes stay put, and choosing an item only swaps
 * the right-hand numbers. Locations holding nothing are still listed with a zero, because "none in
 * that warehouse" is the answer the user came for just as often as a quantity.
 */

interface Product {
  id: number;
  code: string | null;
  name: string;
  category: string | null;
  on_hand?: string | null;
}

interface BalanceLocation { kind: string; id: number; name: string; quantity: string }

interface Balance {
  item: { id: number; code: string | null; name: string; category: string | null; unit_of_measure: string | null };
  prices: {
    last_sale: string | null;
    last_purchase: string | null;
    average_cost: string | null;
    list_price: string | null;
    tiers: Record<string, string>;
  };
  locations: BalanceLocation[];
  total: string;
}

const ALL = '__all__';

const TIER_LABELS: Record<string, string> = {
  consumer: 'مستهلك',
  commercial: 'تجاري',
  semi_commercial: 'نص تجاري',
  wholesale: 'جملة',
  semi_wholesale: 'نص جملة',
};

const money = (v: any) =>
  v === null || v === undefined || v === ''
    ? '0.00'
    : Number(v).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

export default function StockBalance() {
  const { options: categoryOptions } = useLookup('item_category');
  const categoryLabels = labelMap(categoryOptions);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  // "رصيد فقط" hides items that are not physically there; "الكل" shows the whole catalogue.
  const [stockScope, setStockScope] = useState<'all' | 'in_stock'>('all');

  useEffect(() => {
    setLoading(true);
    api.get('/api/v1/items?kind=product')
      .then((res) => setProducts(res.data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    const list = [...set].sort((a, b) => a.localeCompare(b, 'ar'))
      .map((c) => ({ value: c, label: categoryLabels[c] || c }));
    const needle = normalizeAr(categoryQuery);
    return needle ? list.filter((c) => normalizeAr(c.label).includes(needle)) : list;
  }, [products, categoryLabels, categoryQuery]);

  const visibleItems = useMemo(() => {
    const byName = normalizeAr(nameQuery);
    const byCode = normalizeAr(codeQuery);
    return products.filter((p) => {
      if (category !== ALL && p.category !== category) return false;
      if (stockScope === 'in_stock' && !(Number(p.on_hand || 0) > 0)) return false;
      if (byName && !normalizeAr(p.name).includes(byName)) return false;
      if (byCode && !normalizeAr(p.code).includes(byCode)) return false;
      return true;
    });
  }, [products, category, stockScope, nameQuery, codeQuery]);

  const selectItem = async (id: number) => {
    setSelectedId(id);
    setBalanceLoading(true);
    try {
      const res = await api.get(`/api/v1/items/${id}/balance`);
      setBalance(res.data);
    } catch (err) {
      console.error(err);
      setBalance(null);
    } finally { setBalanceLoading(false); }
  };

  const priceCell = (label: string, value: any) => (
    <div style={{ display: 'flex', border: '1px solid #e6efe3', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ background: '#f2f9f3', padding: '6px 10px', fontSize: 12, fontWeight: 600,
                    minWidth: 92, textAlign: 'center' }}>{label}</div>
      <div style={{ padding: '6px 10px', flex: 1, textAlign: 'center', fontWeight: 600 }}>
        {money(value)}
      </div>
    </div>
  );

  return (
    <Card title="رصيد صنف" styles={{ body: { paddingTop: 12 } }}
      extra={
        <Radio.Group size="small" value={stockScope} onChange={(e) => setStockScope(e.target.value)}>
          <Radio.Button value="all">كل الأصناف</Radio.Button>
          <Radio.Button value="in_stock">رصيد فقط</Radio.Button>
        </Radio.Group>
      }>
      <Row gutter={12}>
        {/* 1) Category */}
        <Col xs={24} md={5}>
          <Input allowClear prefix={<SearchOutlined />} placeholder="البحث عن الفئة"
            value={categoryQuery} onChange={(e) => setCategoryQuery(e.target.value)} />
          <div style={{ marginTop: 8, maxHeight: 460, overflowY: 'auto',
                        border: '1px solid #f0f0f0', borderRadius: 8 }}>
            <div onClick={() => setCategory(ALL)}
              style={{
                padding: '10px 12px', cursor: 'pointer', fontWeight: 600,
                background: category === ALL ? '#6AB42D' : undefined,
                color: category === ALL ? '#fff' : undefined,
              }}>
              الأصناف ككل
            </div>
            {categories.map((c) => (
              <div key={c.value} onClick={() => setCategory(c.value)}
                style={{
                  padding: '10px 12px', cursor: 'pointer', borderTop: '1px solid #f5f5f5',
                  background: category === c.value ? '#6AB42D' : undefined,
                  color: category === c.value ? '#fff' : undefined,
                  fontWeight: category === c.value ? 600 : undefined,
                }}>
                {c.label}
              </div>
            ))}
            {categories.length === 0 && (
              <div style={{ padding: 12, color: '#8a8a8a', fontSize: 12 }}>لا توجد فئات مطابقة</div>
            )}
          </div>
        </Col>

        {/* 2) Item — by name or by code */}
        <Col xs={24} md={10}>
          <Row gutter={8}>
            <Col span={12}>
              <Input allowClear placeholder="البحث بالاسم"
                value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} />
            </Col>
            <Col span={12}>
              <Input allowClear placeholder="البحث بالكود"
                value={codeQuery} onChange={(e) => setCodeQuery(e.target.value)} />
            </Col>
          </Row>
          <div style={{ marginTop: 8, maxHeight: 460, overflowY: 'auto',
                        border: '1px solid #f0f0f0', borderRadius: 8 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
            ) : visibleItems.length === 0 ? (
              <Empty description="لا توجد أصناف مطابقة" style={{ margin: '24px 0' }} />
            ) : visibleItems.map((p) => (
              <div key={p.id} onClick={() => selectItem(p.id)}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                  padding: '9px 12px', cursor: 'pointer', borderTop: '1px solid #f5f5f5',
                  background: selectedId === p.id ? '#eef7e8' : undefined,
                  borderInlineStart: selectedId === p.id ? '3px solid #6AB42D' : '3px solid transparent',
                }}>
                <span style={{ color: '#8a8a8a', fontSize: 12, direction: 'ltr' }}>{p.code || '-'}</span>
                <span style={{ fontWeight: selectedId === p.id ? 700 : 400 }}>{p.name}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6, color: '#8a8a8a', fontSize: 12 }}>
            {visibleItems.length} من {products.length} صنف
          </div>
        </Col>

        {/* 3) The numbers */}
        <Col xs={24} md={9}>
          {balanceLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : !balance ? (
            <Empty description="اختر صنفاً لعرض أسعاره وأرصدته" style={{ marginTop: 60 }} />
          ) : (
            <>
              <div style={{ marginBottom: 10 }}>
                <b style={{ fontSize: 16 }}>{balance.item.name}</b>
                {balance.item.code && (
                  <Tag style={{ marginInlineStart: 8, direction: 'ltr' }}>{balance.item.code}</Tag>
                )}
              </div>

              <Row gutter={[8, 8]}>
                <Col span={8}>{priceCell('اخر بيع', balance.prices.last_sale)}</Col>
                <Col span={8}>{priceCell('المتوسط', balance.prices.average_cost)}</Col>
                <Col span={8}>{priceCell('اخر شراء', balance.prices.last_purchase)}</Col>
                <Col span={8}>{priceCell('مستهلك', balance.prices.tiers.consumer)}</Col>
                <Col span={8}>{priceCell('تجاري', balance.prices.tiers.commercial)}</Col>
                <Col span={8}>{priceCell('نص تجاري', balance.prices.tiers.semi_commercial)}</Col>
                <Col span={8}>{priceCell('جملة', balance.prices.tiers.wholesale)}</Col>
                <Col span={8}>{priceCell('نص جملة', balance.prices.tiers.semi_wholesale)}</Col>
                <Col span={8}>{priceCell('سعر القائمة', balance.prices.list_price)}</Col>
              </Row>

              <Table
                style={{ marginTop: 12 }}
                size="small"
                rowKey={(r) => `${r.kind}-${r.id}`}
                pagination={false}
                dataSource={balance.locations}
                columns={[
                  { title: 'المخزن', dataIndex: 'name' },
                  {
                    title: `الوحدة${balance.item.unit_of_measure ? ` (${balance.item.unit_of_measure})` : ''}`,
                    dataIndex: 'quantity', align: 'center' as const, width: 120,
                    render: (v: string) => (
                      <span style={{ fontWeight: Number(v) ? 700 : 400,
                                     color: Number(v) > 0 ? '#6AB42D' : Number(v) < 0 ? '#cf1322' : '#999' }}>
                        {qty(v)}
                      </span>
                    ),
                  },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}><b>الإجمالي</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="center">
                      <b style={{ color: '#6AB42D', fontSize: 15 }}>{qty(balance.total)}</b>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </>
          )}
        </Col>
      </Row>
    </Card>
  );
}

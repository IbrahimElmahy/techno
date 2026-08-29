import React, { useEffect, useState } from 'react';
import { Card, Empty, Spin, Tag, Tooltip } from 'antd';
import { api } from '../api/client';

/**
 * رصيد الصنف في كل المخازن — the side panel that answers "do we actually have it, and where"
 * without leaving the invoice.
 *
 * The question comes up on every document that touches stock: a salesman about to promise a
 * delivery, a buyer about to reorder something the branch is already sitting on. Before this,
 * answering it meant abandoning a half-typed invoice to go and look — so the panel is shared by
 * every document screen rather than rebuilt per screen.
 *
 * Two states, because the user arrives from two directions:
 *   • a category chosen but no item yet → the category's items with their total on hand, so the
 *     eye lands on what is short before a line is even added;
 *   • an item chosen → that item broken down per warehouse and custody.
 *
 * Locations holding nothing are still listed, greyed: "this warehouse has none" is an answer, and
 * hiding the row would make it look like the question was never asked.
 */

interface LocationRow {
  kind: string;
  id: number;
  name: string;
  quantity: string;
}

interface Props {
  /** The item whose per-location balance to show. Takes priority over `category`. */
  itemId?: number | null;
  /** The category to summarise when no item is selected yet. */
  category?: string | null;
  /** All loaded products — used for the category summary, so no extra request is needed. */
  products?: any[];
  /** Clicking an item in the category summary selects it. */
  onPickItem?: (itemId: number) => void;
  title?: string;
}

const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });
const money = (v: any) => Number(v || 0).toLocaleString('ar-EG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export default function ItemStockPanel({
  itemId, category, products = [], onPickItem, title = 'رصيد الصنف في المخازن',
}: Props) {
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!itemId) { setBalance(null); return; }
    setLoading(true);
    api.get(`/api/v1/items/${itemId}/balance`)
      .then((r) => setBalance(r.data))
      .catch(() => setBalance(null))
      .finally(() => setLoading(false));
  }, [itemId]);

  const categoryItems = category
    ? products.filter((p) => p.category === category)
    : [];

  const body = () => {
    if (loading) return <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>;

    if (itemId && balance) {
      const locations: LocationRow[] = balance.locations || [];
      const held = locations.filter((l) => Number(l.quantity) > 0);
      return (
        <>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{balance.item?.name}</div>
            <div style={{ fontSize: 12, color: '#6b6b6b' }}>
              الإجمالي في كل المواقع:{' '}
              <b style={{ color: Number(balance.total) > 0 ? '#6AB42D' : '#cf1322' }}>
                {qty(balance.total)} {balance.item?.unit_of_measure || ''}
              </b>
            </div>
          </div>

          {locations.length === 0 ? (
            <Empty description="لا توجد مواقع" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <div>
              {locations.map((l) => {
                const has = Number(l.quantity) > 0;
                return (
                  <div key={`${l.kind}-${l.id}`}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 8px', borderRadius: 6, marginBottom: 4,
                      background: has ? '#f6faf3' : '#fafafa',
                      border: `1px solid ${has ? '#e6efe3' : '#f0f0f0'}`,
                    }}>
                    <span style={{ fontSize: 13, color: has ? undefined : '#b0b0b0' }}>
                      {l.kind === 'custody' && <Tag color="gold" style={{ marginInlineEnd: 4 }}>عهدة</Tag>}
                      {l.name}
                    </span>
                    <b style={{ color: has ? '#6AB42D' : '#c0c0c0' }}>{qty(l.quantity)}</b>
                  </div>
                );
              })}
            </div>
          )}

          {held.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#cf1322' }}>
              لا يوجد رصيد لهذا الصنف في أي مخزن.
            </div>
          )}

          {(balance.prices?.last_purchase || balance.prices?.last_sale) && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#6b6b6b' }}>
              {balance.prices?.last_purchase && (
                <div>آخر سعر شراء: <b>{money(balance.prices.last_purchase)}</b></div>
              )}
              {balance.prices?.last_sale && (
                <div>آخر سعر بيع: <b>{money(balance.prices.last_sale)}</b></div>
              )}
            </div>
          )}
        </>
      );
    }

    if (category) {
      if (!categoryItems.length) {
        return <Empty description="لا توجد أصناف في الفئة" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
      }
      return (
        <div>
          <div style={{ fontSize: 12, color: '#6b6b6b', marginBottom: 8 }}>
            أصناف الفئة ورصيدها الكلي — اضغط على صنف تشوف توزيعه على المخازن.
          </div>
          {categoryItems.map((p) => {
            const has = Number(p.on_hand || 0) > 0;
            return (
              <div key={p.id}
                onClick={() => onPickItem?.(p.id)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 8px', borderRadius: 6, marginBottom: 4, cursor: 'pointer',
                  background: has ? '#f6faf3' : '#fff6f6',
                  border: `1px solid ${has ? '#e6efe3' : '#ffe0e0'}`,
                }}>
                <Tooltip title={p.name}>
                  <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', maxWidth: 170 }}>{p.name}</span>
                </Tooltip>
                <b style={{ color: has ? '#6AB42D' : '#cf1322' }}>{qty(p.on_hand)}</b>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <Empty description="اختر فئة أو صنفاً لعرض رصيده"
        image={Empty.PRESENTED_IMAGE_SIMPLE} />
    );
  };

  return (
    <Card size="small" title={title}
      styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
      style={{ position: 'sticky', top: 12 }}>
      {body()}
    </Card>
  );
}

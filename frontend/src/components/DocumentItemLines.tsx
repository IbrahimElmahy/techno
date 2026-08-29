import React, { useEffect, useState } from 'react';
import { Spin, Table } from 'antd';
import { api } from '../api/client';
import type { DocKind } from './DocumentLink';

/**
 * حركة المستند المخزنية — أصناف الفاتورة تحت سطر الكشف.
 *
 * نظامهم عنده علامة «حركة مخزنية» في كشف الحساب: بتفرد تحت كل سطر أصناف المستند نفسه —
 * المخزن والصنف والكمية والسعر والإجمالي. ودي الإجابة الحقيقية على «السطر ده إيه؟» لما
 * وراه فاتورة: اللي بيراجع كشف عميل مش بيسأل «القيد اتقفل على أنهي حساب» — بيسأل «العميل
 * ده خد إيه». سطور القيد إجابة محاسب؛ الأصناف إجابة صاحب الشغل.
 *
 * المستند بيتجاب أول ما اللوحة تتفتح مش مع الكشف، ومرة واحدة لكل مستند — الفتح والقفل
 * مابيعيدوش الطلب لأن antd بيسيب الصف المفتوح راكب.
 */
interface Props {
  kind: DocKind;
  id: number;
  itemName: (id: number) => string;
  warehouseName: (id: number | null | undefined) => string | null;
  money: (v: any) => string;
}

/** المستندات اللي ليها سطور أصناف، وعنوان تفاصيل كل واحد. */
const DETAIL_API: Partial<Record<DocKind, (id: number) => string>> = {
  invoice: (id) => `/api/v1/sales/${id}`,
  return: (id) => `/api/v1/sales/returns/${id}`,
  purchase: (id) => `/api/v1/purchases/${id}`,
  purchase_return: (id) => `/api/v1/purchases/returns/${id}`,
};

export const hasItemLines = (kind: DocKind | null | undefined) =>
  !!(kind && DETAIL_API[kind]);

interface Line {
  _k: number;
  item_id: number;
  quantity: string;
  unit: string | null;
  unit_price: string | null;
  discount_pct: string | null;
  line_total: string | null;
  warehouse_id: number | null;
}

const dash = <span style={{ color: '#8c8c8c' }}>-</span>;

export default function DocumentItemLines({ kind, id, itemName, warehouseName, money }: Props) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const url = DETAIL_API[kind]?.(id);
    if (!url) { setFailed(true); return undefined; }
    api.get(url)
      .then((r) => {
        if (!alive) return;
        const d = r.data || {};
        // المشتريات بتسجل المخزن على المستند؛ البيع ومردوده بيسجلوه على السطر (030).
        // السطر الأول، والمستند لو السطر ساكت.
        const docWh = d.location_id ?? null;
        setLines((d.lines || []).map((ln: any, i: number) => ({
          _k: i,
          item_id: ln.item_id,
          quantity: ln.quantity,
          unit: ln.unit ?? null,
          unit_price: ln.unit_price ?? null,
          discount_pct: ln.discount_pct ?? null,
          line_total: ln.line_total ?? null,
          warehouse_id: ln.warehouse_id ?? ln.line_location_id ?? docWh,
        })));
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [kind, id]);

  if (failed) {
    return <span style={{ color: '#8c8c8c' }}>تعذر تحميل أصناف المستند</span>;
  }
  if (lines === null) return <Spin size="small" />;
  if (!lines.length) {
    return <span style={{ color: '#8c8c8c' }}>لا توجد لهذا المستند سطور أصناف</span>;
  }

  const qty = (v: any) => Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 });

  return (
    <Table
      size="small"
      pagination={false}
      rowKey="_k"
      dataSource={lines}
      columns={[
        { title: 'الصنف', key: 'item',
          render: (_: unknown, l: Line) => itemName(l.item_id) },
        { title: 'المخزن', key: 'wh', width: 160,
          render: (_: unknown, l: Line) => warehouseName(l.warehouse_id) || dash },
        { title: 'الكمية', key: 'qty', align: 'left' as const, width: 120,
          // الوحدة اللي اتباع بيها جنب الرقم — «٥ كرتونة» مش «٥» وخمن.
          render: (_: unknown, l: Line) => (l.unit ? `${qty(l.quantity)} ${l.unit}` : qty(l.quantity)) },
        { title: 'السعر', key: 'price', align: 'left' as const, width: 120,
          render: (_: unknown, l: Line) => (l.unit_price != null ? money(l.unit_price) : dash) },
        { title: 'الخصم', key: 'disc', align: 'left' as const, width: 100,
          render: (_: unknown, l: Line) => (Number(l.discount_pct)
            ? `${Number(l.discount_pct).toLocaleString('ar-EG')}%` : dash) },
        { title: 'الإجمالي', key: 'total', align: 'left' as const, width: 130,
          render: (_: unknown, l: Line) => (l.line_total != null
            ? <b>{money(l.line_total)}</b> : dash) },
      ]}
      summary={(rows) => {
        const total = [...rows].reduce((t, l) => t + Number(l.line_total || 0), 0);
        return (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={5}><b>الإجمالي</b></Table.Summary.Cell>
            <Table.Summary.Cell index={1}><b>{money(total)}</b></Table.Summary.Cell>
          </Table.Summary.Row>
        );
      }}
    />
  );
}

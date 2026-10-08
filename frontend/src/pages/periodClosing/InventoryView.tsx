import React from 'react';
import { Card, InputNumber, Space, Table, Tag, Typography } from 'antd';
import { M, ManualLines, Q, SourceTag, TotalRow, newKey, num, sectionTotal, type ViewProps } from './shared';

const PRICE_SOURCE: Record<string, string> = {
  average: 'متوسط تكلفة الشراء', list: 'أصل السعر', item_purchase_price: 'سعر الشراء في بطاقة الصنف',
  none: 'بدون تكلفة',
};

function priceSourceLabel(s: string) {
  if (s?.startsWith('fallback:')) return PRICE_SOURCE[s.slice(9)] || s.slice(9);
  return PRICE_SOURCE[s] || s;
}

export function ItemsTable({ items }: { items: any[] }) {
  return (
    <Table
      size="small" rowKey="item_id" pagination={items.length > 50 ? { pageSize: 50 } : false}
      dataSource={items}
      columns={[
        { title: 'الصنف', dataIndex: 'name', key: 'name' },
        { title: 'المخزن الرئيسي', dataIndex: 'qty_main', key: 'qm', width: 110, render: (v: any) => <Q v={v} /> },
        { title: 'السيارات والمخازن', dataIndex: 'qty_other', key: 'qo', width: 120, render: (v: any) => <Q v={v} /> },
        { title: 'سعر الوحدة', dataIndex: 'unit_price', key: 'p', width: 120, render: (v: any) => <M v={v} /> },
        { title: 'مصدر السعر', dataIndex: 'price_source', key: 'ps', width: 150, render: (v: string) => priceSourceLabel(v) },
        { title: 'قيمة الرئيسي', dataIndex: 'value_main', key: 'vm', width: 130, render: (v: any) => <M v={v} /> },
        { title: 'قيمة السيارات', dataIndex: 'value_other', key: 'vo', width: 130, render: (v: any) => <M v={v} /> },
        { title: 'القيمة', dataIndex: 'value', key: 'v', width: 140, render: (v: any) => <M v={v} strong /> },
      ]}
    />
  );
}

export default function InventoryView({ pkg, lines, setLines, editable }: ViewProps) {
  const inv = pkg?.inventory;
  if (!inv) return null;

  const override = (lineId: string | number) =>
    lines.find((l) => l.section === 'inventory_override' && l.group_key === String(lineId));

  const setOverride = (line: any, value: number | null) => {
    const key = String(line.id);
    const rest = lines.filter((l) => !(l.section === 'inventory_override' && l.group_key === key));
    if (value === null) { setLines(rest); return; }
    const cur = override(line.id);
    setLines([...rest, {
      key: cur?.key || newKey(), section: 'inventory_override', group_key: key,
      label: line.name, amount: String(value), sign: 1,
    }]);
  };

  const columns: any[] = [
    {
      title: 'خط الإنتاج', dataIndex: 'name', key: 'name',
      render: (v: string, r: any) => (
        <Space direction="vertical" size={0}>
          <b>{v}</b>
          {!!r.categories?.length && <span style={{ fontSize: 11, color: '#8c8c8c' }}>{r.categories.join('، ')}</span>}
        </Space>
      ),
    },
    {
      title: 'أساس التقييم', key: 'basis', width: 160,
      render: (_: any, r: any) => <Tag>{r.basis === 'list' ? 'أصل السعر' : 'متوسط التكلفة'} × {num(r.factor_pct)}٪</Tag>,
    },
    { title: 'عدد الأصناف', dataIndex: 'items_count', key: 'n', width: 90 },
    { title: 'المخزن الرئيسي', dataIndex: 'net_main', key: 'nm', width: 140, render: (v: any) => <M v={v} /> },
    { title: 'السيارات والمخازن', dataIndex: 'net_other', key: 'no', width: 140, render: (v: any) => <M v={v} /> },
    { title: 'قيمة النظام', dataIndex: 'net_system', key: 'ns', width: 140, render: (v: any) => <M v={v} /> },
    {
      title: 'القيمة اليدوية', key: 'ov', width: 150,
      render: (_: any, r: any) => {
        const o = override(r.id);
        if (!editable) return o ? <M v={o.amount} /> : '';
        return (
          <InputNumber size="small" style={{ width: '100%' }}
            value={o ? Number(o.amount) : null} onChange={(n) => setOverride(r, n as number | null)} />
        );
      },
    },
    { title: 'القيمة', dataIndex: 'value', key: 'v', width: 150, render: (v: any) => <M v={v} strong /> },
    { title: 'المصدر', dataIndex: 'source', key: 'src', width: 90, render: (s: string) => <SourceTag source={s} /> },
  ];

  const extraLive = sectionTotal(lines, 'inventory_extra');
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Card size="small" title={`قيمة المخازن في ${pkg.as_of}`}
        extra={<span>المخزن الرئيسي: {(inv.main_warehouses || []).map((w: any) => w.name).join('، ')}</span>}>
        <Table size="small" rowKey={(r: any) => String(r.id)} pagination={false}
          dataSource={inv.lines} columns={columns}
          expandable={{
            expandedRowRender: (r: any) => <ItemsTable items={r.items || []} />,
            rowExpandable: (r: any) => (r.items || []).length > 0,
          }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={8}><b>إجمالي الخطوط</b></Table.Summary.Cell>
              <Table.Summary.Cell index={1} colSpan={2}><M v={inv.lines_total} strong /></Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
        <Typography.Title level={5} style={{ marginTop: 16 }}>مخزون إضافي</Typography.Title>
        <ManualLines lines={lines} setLines={setLines} section="inventory_extra" editable={editable}
          withQty={false} withSign />
        <TotalRow label="قيمة المخازن" v={num(inv.lines_total) + (editable ? extraLive : num(inv.extras_total))} />
      </Card>
      {inv.unassigned && (
        <Card size="small" type="inner"
          title={`أصناف خارج الخطوط (${inv.unassigned.items_count})`}
          extra={<M v={inv.unassigned.gross} />}>
          <ItemsTable items={inv.unassigned.items || []} />
        </Card>
      )}
    </Space>
  );
}

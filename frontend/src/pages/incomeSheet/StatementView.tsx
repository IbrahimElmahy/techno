import React, { useMemo, useState } from 'react';
import { Button, Space, Table, Tag } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { ListStat } from '../../components/ListPage';
import { money } from '../../utils/money';

export interface StatementRow {
  key: string;
  label: string;
  amount: number | null;
  sign?: '+' | '-';
  kind?: 'total' | 'section' | 'line' | 'info';
  onClick?: () => void;
  note?: string;
  children?: StatementRow[];
}

const n = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v));

export function buildStatement(data: any, h: {
  openSales?: (key: string, name: string) => void;
  openInventory?: (asOf: string, title: string) => void;
  openPurchases?: () => void;
  openAccount?: (id: number) => void;
}): StatementRow[] {
  if (!data) return [];
  const c = data.cost;
  const mm = data.marketing.model;
  const accountRows = (prefix: string, lines: any[]): StatementRow[] => lines.map((l: any, i: number) => ({
    key: `${prefix}-${l.name}-${i}`,
    label: l.name,
    amount: n(l.amount),
    kind: 'line',
    note: l.manual ? (l.note || 'يدوي') : undefined,
    onClick: !l.manual && l.accounts?.length === 1 && h.openAccount
      ? () => h.openAccount!(l.accounts[0].account_id) : undefined,
    children: !l.manual && l.accounts?.length > 1 ? l.accounts.map((a: any) => ({
      key: `${prefix}-${l.name}-acc-${a.account_id}`,
      label: a.code ? `${a.name} (${a.code})` : a.name,
      amount: n(a.amount), kind: 'line' as const,
      onClick: h.openAccount ? () => h.openAccount!(a.account_id) : undefined,
    })) : undefined,
  }));

  return [
    {
      key: 'sales', label: 'صافي المبيعات', amount: n(data.sales.total), kind: 'section',
      children: data.sales.lines.map((l: any) => ({
        key: `sales-${l.key}`, label: l.name, amount: n(l.amount), kind: 'line',
        note: Number(l.bonus_pct) ? `بونص ${l.bonus_pct}٪ = ${money(l.bonus_value)}` : undefined,
        onClick: h.openSales && l.key !== '_unmatched' ? () => h.openSales!(l.key, l.name) : undefined,
      })),
    },
    {
      key: 'cost', label: 'تكلفة المبيعات', sign: '-', amount: n(c.total), kind: 'section',
      children: [
        { key: 'cost-open', label: `المخزون أول المدة ${c.opening_inventory.as_of}`,
          amount: n(c.opening_inventory.amount), kind: 'line',
          note: c.opening_inventory.source === 'override' ? 'جرد فعلي' : 'دفتري',
          onClick: h.openInventory ? () => h.openInventory!(c.opening_inventory.as_of, 'المخزون أول المدة') : undefined },
        { key: 'cost-purch', label: 'صافي المشتريات', sign: '+', amount: n(c.purchases.net), kind: 'line',
          onClick: h.openPurchases },
        { key: 'cost-close', label: `المخزون آخر المدة ${c.closing_inventory.as_of}`, sign: '-',
          amount: n(c.closing_inventory.amount), kind: 'line',
          note: c.closing_inventory.source === 'override' ? 'جرد فعلي' : 'دفتري',
          onClick: h.openInventory ? () => h.openInventory!(c.closing_inventory.as_of, 'المخزون آخر المدة') : undefined },
        { key: 'cost-dm', label: 'المواد المباشرة', amount: n(c.direct_materials), kind: 'total' },
        { key: 'cost-dl', label: 'الأجور المباشرة', sign: '+', amount: n(c.direct_labor), kind: 'line' },
        { key: 'cost-im', label: 'مواد غير مباشرة', sign: '+', amount: n(c.indirect_materials), kind: 'line' },
        { key: 'cost-il', label: 'أجور غير مباشرة', sign: '+', amount: n(c.indirect_labor), kind: 'line' },
        { key: 'cost-om', label: 'مصاريف أخرى', sign: '+', amount: n(c.other_mfg), kind: 'line' },
        ...c.manual.map((l: any, i: number) => ({
          key: `cost-man-${i}`, label: l.name, sign: '+' as const, amount: n(l.amount), kind: 'line' as const, note: l.note,
        })),
      ],
    },
    { key: 'gross', label: 'مجمل الربح', amount: n(data.gross_profit), kind: 'total' },
    { key: 'ga', label: 'مصاريف عمومية وإدارية', sign: '-', amount: n(data.ga.total), kind: 'section',
      children: accountRows('ga', data.ga.lines) },
    {
      key: 'mkt', label: 'مصاريف البيع والتسويق', sign: '-', amount: n(data.marketing.amount), kind: 'section',
      children: [
        { key: 'mkt-bonus', label: 'قيمة البوانص', amount: n(mm.bonus_value), kind: 'info' },
        { key: 'mkt-unit', label: `قيمة الكوبون (${mm.coupon_base} × ${mm.coupon_base_pct}٪)`, amount: n(mm.coupon_unit), kind: 'info' },
        { key: 'mkt-bc', label: 'كوبونات البوانص', amount: n(mm.bonus_coupons), kind: 'info' },
        { key: 'mkt-ratio', label: `كوبونات البوانص × ${mm.ratio_num} ÷ ${mm.ratio_den}`, amount: n(mm.ratio_coupons), kind: 'info' },
        { key: 'mkt-sc', label: 'كوبونات البيع الفعلي', sign: '+', amount: n(mm.sales_coupons), kind: 'info' },
        { key: 'mkt-model', label: `إجمالي الكوبونات ${money(mm.total_coupons)} × ${mm.coupon_cost}`, amount: n(mm.amount), kind: 'line' },
        ...data.marketing.manual.map((l: any, i: number) => ({
          key: `mkt-man-${i}`, label: l.name, sign: '+' as const, amount: n(l.amount), kind: 'line' as const, note: l.note,
        })),
      ],
    },
    { key: 'op', label: 'صافي الربح التشغيلي', amount: n(data.operating_profit), kind: 'total' },
    { key: 'oi', label: 'الإيرادات الأخرى', sign: '+', amount: n(data.other_income.total), kind: 'section',
      children: data.other_income.lines.length ? accountRows('oi', data.other_income.lines) : undefined },
    { key: 'ol', label: 'الخسائر الأخرى', sign: '-', amount: n(data.other_losses.total), kind: 'section',
      children: data.other_losses.lines.length ? accountRows('ol', data.other_losses.lines) : undefined },
    { key: 'net', label: 'صافي الربح', amount: n(data.net_profit), kind: 'total' },
  ];
}

const flatten = (rows: StatementRow[], out = new Map<string, StatementRow>()) => {
  rows.forEach((r) => { out.set(r.key, r); if (r.children) flatten(r.children, out); });
  return out;
};

const allKeys = (rows: StatementRow[]): string[] => rows.flatMap((r) => (r.children?.length ? [r.key, ...allKeys(r.children)] : []));

export function KpiCards({ data }: { data: any }) {
  if (!data) return null;
  const p = (v: any) => (v == null ? '—' : `${Number(v).toFixed(2)}٪`);
  return (<>
    <ListStat label="صافي المبيعات" value={money(data.sales.total)} />
    <ListStat label="مجمل الربح" value={money(data.gross_profit)} hint={`هامش ${p(data.gross_margin_pct)}`}
      tone={n(data.gross_profit) >= 0 ? 'pos' : 'neg'} />
    <ListStat label="المصروفات للمبيعات" value={p(data.expenses_to_sales_pct)} tone="warn" />
    <ListStat label="صافي الربح" value={money(data.net_profit)} hint={`هامش ${p(data.net_margin_pct)}`}
      tone={n(data.net_profit) >= 0 ? 'strong' : 'neg'} />
  </>);
}

export default function StatementView({ rows, compare, compareLabel, salesTotal, compareSalesTotal, loading }: {
  rows: StatementRow[];
  compare?: StatementRow[] | null;
  compareLabel?: string;
  salesTotal: number;
  compareSalesTotal?: number;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState<React.Key[]>(['sales', 'cost']);
  const cmp = useMemo(() => (compare ? flatten(compare) : null), [compare]);
  const keys = useMemo(() => allKeys(rows), [rows]);

  const pctOf = (v: number | null, total: number) => (v === null || !total ? '' : `${((v / total) * 100).toFixed(1)}٪`);

  const columns: any[] = [
    {
      title: 'البند', dataIndex: 'label', key: 'label', total: false,
      render: (v: string, r: StatementRow) => (
        <Space size={6}>
          {r.sign ? <span style={{ color: '#94a3b8', width: 14, display: 'inline-block' }}>{r.sign === '-' ? '−' : '+'}</span> : null}
          <span style={{ fontWeight: r.kind === 'total' || r.kind === 'section' ? 700 : undefined,
            color: r.kind === 'info' ? '#64748b' : undefined }}>{v}</span>
          {r.note ? <Tag style={{ fontWeight: 400 }}>{r.note}</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'المبلغ', dataIndex: 'amount', key: 'amount', align: 'left', width: 170, total: false,
      render: (v: number | null, r: StatementRow) => (
        <span onClick={r.onClick}
          style={{ cursor: r.onClick ? 'pointer' : undefined, color: r.onClick ? '#1d4ed8' : (v ?? 0) < 0 ? '#cf1322' : undefined,
            fontWeight: r.kind === 'total' || r.kind === 'section' ? 700 : undefined }}>
          {r.kind === 'info' && !String(r.label).startsWith('قيمة') ? (v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) : money(v ?? 0)}
        </span>
      ),
    },
    {
      title: '٪ من المبيعات', key: 'pct', align: 'left', width: 120, total: false,
      render: (_: any, r: StatementRow) => (r.kind === 'info' ? '' : pctOf(r.amount, salesTotal)),
    },
  ];
  if (cmp) {
    columns.push(
      {
        title: compareLabel || 'المقارنة', key: 'cmp', align: 'left', width: 170, total: false,
        render: (_: any, r: StatementRow) => {
          const o = cmp.get(r.key);
          if (!o) return '';
          return <span style={{ fontWeight: r.kind === 'total' || r.kind === 'section' ? 700 : undefined }}>
            {r.kind === 'info' ? (o.amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) : money(o.amount ?? 0)}
          </span>;
        },
      },
      {
        title: '٪ من مبيعاتها', key: 'cmp-pct', align: 'left', width: 110, total: false,
        render: (_: any, r: StatementRow) => {
          const o = cmp.get(r.key);
          return o && r.kind !== 'info' ? pctOf(o.amount, compareSalesTotal || 0) : '';
        },
      },
      {
        title: 'التغير', key: 'chg', align: 'left', width: 110, total: false,
        render: (_: any, r: StatementRow) => {
          const o = cmp.get(r.key);
          if (!o || r.kind === 'info' || !o.amount) return '';
          const ch = (((r.amount ?? 0) - o.amount) / Math.abs(o.amount)) * 100;
          const good = r.sign === '-' ? ch <= 0 : ch >= 0;
          return (
            <span style={{ color: good ? '#389e0d' : '#cf1322' }}>
              {ch >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(ch).toFixed(1)}٪
            </span>
          );
        },
      },
    );
  }

  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Button size="small" onClick={() => setExpanded(keys)}>فتح الكل</Button>
        <Button size="small" onClick={() => setExpanded([])}>طي الكل</Button>
      </Space>
      <Table<StatementRow>
        className="sl-table income-statement" size="small" rowKey="key" pagination={false} loading={loading}
        dataSource={rows} columns={columns}
        expandable={{ expandedRowKeys: expanded, onExpandedRowsChange: (k) => setExpanded([...k]) }}
        rowClassName={(r) => (r.kind === 'total' ? 'income-total-row' : '')}
        onRow={(r) => ({ style: r.kind === 'total' ? { background: 'var(--ant-color-fill-tertiary, #f1f5f9)' } : undefined })}
      />
    </>
  );
}

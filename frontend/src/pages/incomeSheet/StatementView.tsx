import React, { useMemo, useState } from 'react';
import { Button, Space } from 'antd';
import { CaretDownOutlined, CaretLeftOutlined } from '@ant-design/icons';
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
  count?: boolean;
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
      label: a.name,
      amount: n(a.amount), kind: 'line' as const,
      onClick: h.openAccount ? () => h.openAccount!(a.account_id) : undefined,
    })) : undefined,
  }));

  return [
    {
      key: 'sales', label: 'صافي المبيعات', amount: n(data.sales.total), kind: 'section',
      children: data.sales.lines.map((l: any) => ({
        key: `sales-${l.key}`, label: l.name, amount: n(l.amount), kind: 'line',
        note: Number(l.bonus_pct) ? `بونص ${l.bonus_pct}٪` : undefined,
        onClick: h.openSales && l.key !== '_unmatched' ? () => h.openSales!(l.key, l.name) : undefined,
      })),
    },
    {
      key: 'cost', label: 'تكلفة المبيعات', sign: '-', amount: n(c.total), kind: 'section',
      children: [
        { key: 'cost-open', label: `المخزون أول المدة (${c.opening_inventory.as_of})`,
          amount: n(c.opening_inventory.amount), kind: 'line',
          note: c.opening_inventory.source === 'override' ? 'جرد فعلي' : undefined,
          onClick: h.openInventory ? () => h.openInventory!(c.opening_inventory.as_of, 'المخزون أول المدة') : undefined },
        { key: 'cost-purch', label: 'صافي المشتريات', sign: '+', amount: n(c.purchases.net), kind: 'line',
          onClick: h.openPurchases },
        { key: 'cost-close', label: `المخزون آخر المدة (${c.closing_inventory.as_of})`, sign: '-',
          amount: n(c.closing_inventory.amount), kind: 'line',
          note: c.closing_inventory.source === 'override' ? 'جرد فعلي' : undefined,
          onClick: h.openInventory ? () => h.openInventory!(c.closing_inventory.as_of, 'المخزون آخر المدة') : undefined },
        { key: 'cost-dm', label: 'المواد المباشرة', amount: n(c.direct_materials), kind: 'total' },
        ...(n(c.direct_labor) ? [{ key: 'cost-dl', label: 'الأجور المباشرة', sign: '+' as const, amount: n(c.direct_labor), kind: 'line' as const }] : []),
        ...(n(c.indirect_materials) ? [{ key: 'cost-im', label: 'مواد غير مباشرة', sign: '+' as const, amount: n(c.indirect_materials), kind: 'line' as const }] : []),
        ...(n(c.indirect_labor) ? [{ key: 'cost-il', label: 'أجور غير مباشرة', sign: '+' as const, amount: n(c.indirect_labor), kind: 'line' as const }] : []),
        ...(n(c.other_mfg) ? [{ key: 'cost-om', label: 'مصاريف أخرى', sign: '+' as const, amount: n(c.other_mfg), kind: 'line' as const }] : []),
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
        { key: 'mkt-unit', label: mm.coupon_item ? `قيمة الكوبون: ${mm.coupon_item.name} (${mm.coupon_item.tier_label}) ${mm.coupon_price} − خصم ${Number(mm.coupon_discount_pct)}%` : `قيمة الكوبون (${mm.coupon_base} × ${mm.coupon_base_pct}%)`, amount: n(mm.coupon_unit), kind: 'info' },
        { key: 'mkt-bc', label: `كوبونات البوانص (÷ ${mm.coupon_unit})`, amount: n(mm.bonus_coupons), kind: 'info', count: true },
        { key: 'mkt-ratio', label: `× ${mm.ratio_num} ÷ ${mm.ratio_den}`, amount: n(mm.ratio_coupons), kind: 'info', count: true },
        { key: 'mkt-sc', label: 'كوبونات البيع الفعلي', sign: '+', amount: n(mm.sales_coupons), kind: 'info', count: true },
        { key: 'mkt-model', label: `إجمالي الكوبونات × ${mm.coupon_cost}`, amount: n(mm.amount), kind: 'line' },
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
  const p = (v: any) => (v == null ? '—' : `${Number(v).toFixed(1)}٪`);
  return (<>
    <ListStat label="صافي المبيعات" value={money(data.sales.total)} />
    <ListStat label="مجمل الربح" value={money(data.gross_profit)} hint={`${p(data.gross_margin_pct)} من المبيعات`}
      tone={n(data.gross_profit) >= 0 ? 'pos' : 'neg'} />
    <ListStat label="المصروفات" value={p(data.expenses_to_sales_pct)} hint="من المبيعات" tone="warn" />
    <ListStat label="صافي الربح" value={money(data.net_profit)} hint={`${p(data.net_margin_pct)} من المبيعات`}
      tone={n(data.net_profit) >= 0 ? 'strong' : 'neg'} />
  </>);
}

const CSS = `
.pl-table{width:100%;border-collapse:collapse;font-size:14px;background:var(--pl-bg,#fff)}
.pl-table th{font-weight:600;color:#64748b;text-align:start;padding:8px 12px;border-bottom:2px solid #e2e8f0;white-space:nowrap}
.pl-table th.num,.pl-table td.num{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap;width:150px}
.pl-table th.pct,.pl-table td.pct{text-align:left;width:90px;color:#64748b;white-space:nowrap}
.pl-table td{padding:6px 12px;border-bottom:1px solid #f1f5f9}
.pl-table tr.pl-section td{font-weight:700}
.pl-table tr.pl-total td{font-weight:700;border-top:1px solid #94a3b8;border-bottom:1px solid #94a3b8;background:#f8fafc}
.pl-table tr.pl-total.pl-final td{border-top:2px solid #334155;border-bottom:3px double #334155;font-size:15px}
.pl-table tr.pl-info td{color:#64748b;font-size:13px}
.pl-table .pl-toggle{cursor:pointer;user-select:none}
.pl-table .pl-caret{display:inline-block;width:18px;color:#94a3b8}
.pl-table .pl-sign{display:inline-block;width:16px;color:#94a3b8}
.pl-table .pl-link{cursor:pointer;color:#1d4ed8}
.pl-table .pl-link:hover{text-decoration:underline}
.pl-table .pl-note{color:#94a3b8;font-size:12px;margin-inline-start:8px}
.pl-table .neg{color:#cf1322}
.pl-table .up{color:#389e0d}.pl-table .down{color:#cf1322}
`;

export default function StatementView({ rows, compare, label, compareLabel, salesTotal, compareSalesTotal }: {
  rows: StatementRow[];
  compare?: StatementRow[] | null;
  label: string;
  compareLabel?: string;
  salesTotal: number;
  compareSalesTotal?: number;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set(['sales', 'cost', 'ga']));
  const cmp = useMemo(() => (compare ? flatten(compare) : null), [compare]);
  const keys = useMemo(() => allKeys(rows), [rows]);

  const fmt = (r: StatementRow, v: number | null) => {
    if (v === null) return '';
    if (r.count) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return money(v);
  };
  const pctOf = (r: StatementRow, v: number | null, total: number) => (
    r.kind === 'info' || v === null || !total ? '' : `${((v / total) * 100).toFixed(1)}٪`);

  const toggle = (k: string) => {
    const next = new Set(open);
    if (next.has(k)) next.delete(k); else next.add(k);
    setOpen(next);
  };

  const body: React.ReactNode[] = [];
  const walk = (list: StatementRow[], level: number) => {
    list.forEach((r) => {
      const hasKids = !!r.children?.length;
      const isOpen = open.has(r.key);
      const o = cmp?.get(r.key);
      const cls = [
        r.kind === 'total' ? 'pl-total' : '', r.key === 'net' ? 'pl-final' : '',
        r.kind === 'section' ? 'pl-section' : '', r.kind === 'info' ? 'pl-info' : '',
      ].join(' ');
      let change: React.ReactNode = '';
      if (o && o.amount && r.kind !== 'info' && r.amount !== null) {
        const ch = ((r.amount - o.amount) / Math.abs(o.amount)) * 100;
        const good = r.sign === '-' ? ch <= 0 : ch >= 0;
        change = <span className={good ? 'up' : 'down'}>{ch >= 0 ? '▲' : '▼'} {Math.abs(ch).toFixed(1)}٪</span>;
      }
      body.push(
        <tr key={r.key} className={cls}>
          <td style={{ paddingInlineStart: 12 + level * 22 }}>
            <span className={hasKids ? 'pl-toggle' : undefined} onClick={hasKids ? () => toggle(r.key) : undefined}>
              <span className="pl-caret">{hasKids ? (isOpen ? <CaretDownOutlined /> : <CaretLeftOutlined />) : null}</span>
              <span className="pl-sign">{r.sign === '-' ? '−' : r.sign === '+' ? '+' : ''}</span>
              {r.label}
            </span>
            {r.note ? <span className="pl-note">{r.note}</span> : null}
          </td>
          <td className={`num${(r.amount ?? 0) < 0 ? ' neg' : ''}`}>
            <span className={r.onClick ? 'pl-link' : undefined} onClick={r.onClick}>{fmt(r, r.amount)}</span>
          </td>
          <td className="pct">{pctOf(r, r.amount, salesTotal)}</td>
          {cmp ? (<>
            <td className={`num${(o?.amount ?? 0) < 0 ? ' neg' : ''}`}>{o ? fmt(r, o.amount) : ''}</td>
            <td className="pct">{o ? pctOf(r, o.amount, compareSalesTotal || 0) : ''}</td>
            <td className="pct">{change}</td>
          </>) : null}
        </tr>,
      );
      if (hasKids && isOpen) walk(r.children!, level + 1);
    });
  };
  walk(rows, 0);

  return (
    <div>
      <style>{CSS}</style>
      <Space style={{ marginBottom: 8 }}>
        <Button size="small" onClick={() => setOpen(new Set(keys))}>فتح الكل</Button>
        <Button size="small" onClick={() => setOpen(new Set())}>طي الكل</Button>
      </Space>
      <div style={{ overflowX: 'auto' }}>
        <div className="ant-table" style={{ background: 'transparent' }}>
        <table className="pl-table">
          <colgroup>
            <col />
            <col style={{ width: 150 }} /><col style={{ width: 100 }} />
            {cmp ? (<><col style={{ width: 150 }} /><col style={{ width: 100 }} /><col style={{ width: 100 }} /></>) : null}
          </colgroup>
          <thead className="ant-table-thead">
            <tr>
              <th>البند</th>
              <th className="num">{label}</th>
              <th className="pct">٪ من المبيعات</th>
              {cmp ? (<>
                <th className="num">{compareLabel}</th>
                <th className="pct">٪ من المبيعات</th>
                <th className="pct">التغير</th>
              </>) : null}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

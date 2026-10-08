import React, { useMemo, useState } from 'react';
import { Button, Space } from 'antd';
import { CaretDownOutlined, CaretLeftOutlined } from '@ant-design/icons';
import { money } from '../utils/money';

export interface TreeNode {
  account_id: number;
  code: string | null;
  name: string | null;
  amount: string;
  children: TreeNode[];
}

export interface TreeSection {
  key: string;
  label: string;
  total: string;
  nodes: TreeNode[];
  extra?: { label: string; amount: string }[];
}

const CSS = `
.at-table{width:100%;border-collapse:collapse;font-size:14px}
.at-table th{font-weight:600;color:#64748b;text-align:start;padding:8px 12px;border-bottom:2px solid #e2e8f0}
.at-table th.num,.at-table td.num{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap;width:170px}
.at-table td{padding:6px 12px;border-bottom:1px solid #f1f5f9}
.at-table tr.at-section td{font-weight:700;font-size:15px;background:#f8fafc;border-top:1px solid #94a3b8}
.at-table tr.at-total td{font-weight:700;border-top:1px solid #94a3b8;border-bottom:2px solid #94a3b8}
.at-table tr.at-final td{font-weight:700;border-top:2px solid #334155;border-bottom:3px double #334155;font-size:15px}
.at-table .at-toggle{cursor:pointer;user-select:none}
.at-table .at-caret{display:inline-block;width:18px;color:#94a3b8}
.at-table .at-code{color:#94a3b8;font-size:12px;margin-inline-start:8px}
.at-table .at-link{cursor:pointer;color:#1d4ed8}
.at-table .at-link:hover{text-decoration:underline}
.at-table .neg{color:#cf1322}
`;

const keysOf = (nodes: TreeNode[], prefix: string): string[] => nodes.flatMap((n) => (
  n.children.length ? [`${prefix}-${n.account_id}`, ...keysOf(n.children, `${prefix}-${n.account_id}`)] : []));

export default function AccountTree({ sections, footer, onOpenAccount }: {
  sections: TreeSection[];
  footer?: { label: string; amount: string }[];
  onOpenAccount?: (accountId: number) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = useMemo(() => sections.flatMap((s) => keysOf(s.nodes, s.key)), [sections]);

  const toggle = (k: string) => {
    const next = new Set(open);
    if (next.has(k)) next.delete(k); else next.add(k);
    setOpen(next);
  };

  const rows: React.ReactNode[] = [];
  const walk = (nodes: TreeNode[], level: number, prefix: string) => {
    nodes.forEach((n) => {
      const k = `${prefix}-${n.account_id}`;
      const kids = n.children.length > 0;
      const isOpen = open.has(k);
      const v = Number(n.amount);
      rows.push(
        <tr key={k + n.name}>
          <td style={{ paddingInlineStart: 12 + level * 22 }}>
            <span className={kids ? 'at-toggle' : undefined} onClick={kids ? () => toggle(k) : undefined}>
              <span className="at-caret">{kids ? (isOpen ? <CaretDownOutlined /> : <CaretLeftOutlined />) : null}</span>
              <span style={{ fontWeight: kids && level === 0 ? 600 : undefined }}>{n.name}</span>
            </span>
            {n.code ? <span className="at-code">{n.code}</span> : null}
            {kids ? <span className="at-code">({n.children.length})</span> : null}
          </td>
          <td className={`num${v < 0 ? ' neg' : ''}`}>
            {!kids && onOpenAccount
              ? <span className="at-link" onClick={() => onOpenAccount(n.account_id)}>{money(v)}</span>
              : money(v)}
          </td>
        </tr>,
      );
      if (kids && isOpen) walk(n.children, level + 1, k);
    });
  };

  sections.forEach((s) => {
    rows.push(
      <tr key={`sec-${s.key}`} className="at-section">
        <td>{s.label}</td>
        <td className="num">{money(s.total)}</td>
      </tr>,
    );
    walk(s.nodes, 1, s.key);
    (s.extra || []).forEach((e) => rows.push(
      <tr key={`extra-${s.key}-${e.label}`}>
        <td style={{ paddingInlineStart: 34 }}>{e.label}</td>
        <td className="num">{money(e.amount)}</td>
      </tr>,
    ));
  });
  (footer || []).forEach((f, i) => rows.push(
    <tr key={`foot-${i}`} className={i === (footer || []).length - 1 ? 'at-final' : 'at-total'}>
      <td>{f.label}</td>
      <td className="num">{money(f.amount)}</td>
    </tr>,
  ));

  return (
    <div>
      <style>{CSS}</style>
      <Space style={{ marginBottom: 8 }}>
        <Button size="small" onClick={() => setOpen(new Set(all))}>فتح الكل</Button>
        <Button size="small" onClick={() => setOpen(new Set())}>طي الكل</Button>
      </Space>
      <div style={{ overflowX: 'auto' }}>
        <div className="ant-table" style={{ background: 'transparent' }}>
        <table className="at-table">
          <colgroup><col /><col style={{ width: 180 }} /></colgroup>
          <thead className="ant-table-thead"><tr><th>الحساب</th><th className="num">الرصيد</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

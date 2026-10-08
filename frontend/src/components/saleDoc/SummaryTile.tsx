import React from 'react';
import './saleBottom.css';

export default function SummaryTile({ label, value, sub, tone, color, active }: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'yellow' | 'mint' | 'rose';
  color?: string;
  active?: boolean;
}) {
  const cls = ['sale-tile', tone ? `tone-${tone}` : '', active ? 'is-active' : '']
    .filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="sale-tile-label">{label}</div>
      <div className="sale-tile-value" style={color ? { color } : undefined}>{value}</div>
      {sub ? <div className="sale-tile-sub">{sub}</div> : null}
    </div>
  );
}

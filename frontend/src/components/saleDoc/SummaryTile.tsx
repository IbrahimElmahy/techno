import React from 'react';

/**
 * مربع رقم واحد في ملخص فاتورة البيع (تصميم العميل ٢٠٢٦-١٠-٠١).
 *
 * الأرقام نفسها هي اللي كانت في سُلّم الإجماليات — المربع شكل بس، الحساب في الشاشة.
 */
export default function SummaryTile({ label, value, sub, tone, color, active }: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** خلفية المربع: أصفر للمديونية، أخضر فاتح للمدفوع. */
  tone?: 'yellow' | 'mint';
  /** لون الرقم. */
  color?: string;
  /** الخط اللي الفاتورة عليه — بإطار أخضر. */
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

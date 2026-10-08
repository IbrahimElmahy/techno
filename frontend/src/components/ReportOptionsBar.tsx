import React from 'react';
import { Segmented, Space, Switch, Tag, Tooltip } from 'antd';

export type Comparison = 'none' | 'previous' | 'last_year';

export interface ReportOptions {
  postedOnly: boolean;
  comparison: Comparison;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  postedOnly: true,
  comparison: 'none',
};

export const reportParams = (o: ReportOptions) => ({
  posted_only: o.postedOnly,
  comparison: o.comparison,
});

export default function ReportOptionsBar({
  value, onChange, showComparison = true,
}: {
  value: ReportOptions;
  onChange: (v: ReportOptions) => void;
  showComparison?: boolean;
}) {
  return (
    <Space wrap size={12} align="center">
      <Space size={6}>
          <Switch
            size="small"
            checked={!value.postedOnly}
            onChange={(on) => onChange({ ...value, postedOnly: !on })}
          />
          <span>كل القيود</span>
          {!value.postedOnly && <Tag color="orange">شامل المسودات</Tag>}
      </Space>

      {showComparison && (
        <Space size={6}>
          <span style={{ color: '#888' }}>مقارنة:</span>
          <Segmented
            size="small"
            value={value.comparison}
            onChange={(v) => onChange({ ...value, comparison: v as Comparison })}
            options={[
              { value: 'none', label: 'بدون' },
              { value: 'previous', label: 'الفترة السابقة' },
              { value: 'last_year', label: 'العام الماضي' },
            ]}
          />
        </Space>
      )}
    </Space>
  );
}

export function delta(now: string | number, before: string | number) {
  const a = Number(now || 0);
  const b = Number(before || 0);
  const diff = a - b;
  return { diff, pct: b ? (diff / b) * 100 : null };
}

export function DeltaCell({ now, before, goodWhenUp = true }: {
  now: string | number; before: string | number; goodWhenUp?: boolean;
}) {
  const { diff, pct } = delta(now, before);
  if (!diff) return <span style={{ color: '#bbb' }}>—</span>;
  const good = goodWhenUp ? diff > 0 : diff < 0;
  return (
    <span style={{ color: good ? '#2e9e6b' : '#d64545', whiteSpace: 'nowrap' }}>
      {diff > 0 ? '▲' : '▼'}{' '}
      {Math.abs(diff).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {pct !== null && <span style={{ fontSize: 14 }}> ({Math.abs(pct).toFixed(1)}%)</span>}
    </span>
  );
}

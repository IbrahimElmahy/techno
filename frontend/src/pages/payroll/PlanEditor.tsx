import React from 'react';
import { Button, DatePicker, Segmented, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { InputNumber } from '../../components/NumberInput';
import { money } from '../../utils/money';

export interface PlanRow { year: number; month: number; amount: number }
export type PlanMode = 'equal' | 'custom' | 'none';

export function equalPlan(total: number, count: number, start: Dayjs): PlanRow[] {
  if (!total || count < 1) return [];
  const each = Math.floor((total / count) * 100) / 100;
  return Array.from({ length: count }, (_, i) => {
    const d = start.add(i, 'month');
    const amount = i === count - 1 ? Math.round((total - each * (count - 1)) * 100) / 100 : each;
    return { year: d.year(), month: d.month() + 1, amount };
  });
}

export default function PlanEditor({ total, mode, onMode, rows, onRows, count, onCount, start, onStart }: {
  total: number;
  mode: PlanMode; onMode: (m: PlanMode) => void;
  rows: PlanRow[]; onRows: (r: PlanRow[]) => void;
  count: number; onCount: (n: number) => void;
  start: Dayjs; onStart: (d: Dayjs) => void;
}) {
  const planned = rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const left = Math.round((total - planned) * 100) / 100;
  const set = (i: number, patch: Partial<PlanRow>) => onRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    const last = rows[rows.length - 1];
    const d = last ? dayjs(`${last.year}-${String(last.month).padStart(2, '0')}-01`).add(1, 'month') : start;
    onRows([...rows, { year: d.year(), month: d.month() + 1, amount: Math.max(left, 0) }]);
  };

  return (
    <div>
      <Segmented value={mode} onChange={(v) => onMode(v as PlanMode)} style={{ marginBottom: 10 }}
        options={[
          { value: 'equal', label: 'أقساط متساوية من المرتب' },
          { value: 'custom', label: 'خطة حرة' },
          { value: 'none', label: 'بدون خطة' },
        ]} />
      {mode === 'equal' ? (
        <Space wrap>
          <span>عدد الأقساط</span>
          <InputNumber min={1} max={60} value={count} onChange={(v) => onCount(Number(v) || 1)} style={{ width: 90 }} />
          <span>أول قسط في مرتب شهر</span>
          <DatePicker picker="month" format="YYYY/MM" allowClear={false} value={start}
            onChange={(v) => onStart(v || start)} />
          {total && count > 1 ? <span style={{ color: '#888' }}>≈ {money(total / count)} في الشهر</span> : null}
        </Space>
      ) : null}
      {mode === 'custom' ? (
        <div>
          {rows.map((r, i) => (
            <Space key={i} style={{ display: 'flex', marginBottom: 6 }}>
              <DatePicker picker="month" format="YYYY/MM" allowClear={false}
                value={dayjs(`${r.year}-${String(r.month).padStart(2, '0')}-01`)}
                onChange={(v) => v && set(i, { year: v.year(), month: v.month() + 1 })} />
              <InputNumber min={0} value={r.amount} style={{ width: 140 }}
                onChange={(v) => set(i, { amount: Number(v) || 0 })} />
              <Button type="text" danger icon={<DeleteOutlined />} onClick={() => onRows(rows.filter((_, j) => j !== i))} />
            </Space>
          ))}
          <Space>
            <Button icon={<PlusOutlined />} onClick={addRow}>شهر</Button>
            <span>المخطط: <b>{money(planned)}</b></span>
            <span style={{ color: left < 0 ? '#cf1322' : left > 0 ? '#d46b08' : '#389e0d' }}>
              {left < 0 ? 'أكبر من المبلغ بـ' : 'غير مخطط'}: <b>{money(Math.abs(left))}</b>
            </span>
          </Space>
        </div>
      ) : null}
    </div>
  );
}

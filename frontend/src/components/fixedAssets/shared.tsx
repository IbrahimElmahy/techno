import React from 'react';
import { Tag } from 'antd';

export const METHOD_LABELS: Record<string, string> = {
  straight_line: 'القسط الثابت',
  declining_balance: 'القسط المتناقص',
  declining_then_linear: 'المتناقص ثم الثابت',
  sum_of_years: 'مجموع أرقام السنين',
  none: 'بدون إهلاك',
};
export const METHOD_OPTIONS = Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label }));

export const USAGE_LABELS: Record<string, string> = { production: 'إنتاجي', admin: 'إداري' };
export const USAGE_OPTIONS = [
  { value: 'production', label: 'إنتاجي (إهلاك صناعي)' },
  { value: 'admin', label: 'إداري (إهلاك إداري)' },
];

export const STATE_LABELS: Record<string, string> = {
  draft: 'مسودة', running: 'قيد التشغيل', paused: 'موقوف', closed: 'مغلق',
};
const STATE_COLORS: Record<string, string> = {
  draft: 'default', running: 'green', paused: 'orange', closed: 'red',
};
export const STATE_OPTIONS = Object.entries(STATE_LABELS).map(([value, label]) => ({ value, label }));

export function StateTag({ state }: { state: string }) {
  return <Tag color={STATE_COLORS[state] || 'default'}>{STATE_LABELS[state] || state}</Tag>;
}

export const needsLife = (method?: string) =>
  method === 'straight_line' || method === 'declining_then_linear' || method === 'sum_of_years';

export const rateText = (r: { annual_rate: string | number | null; useful_life_months: number | null }) => {
  if (r.annual_rate != null && Number(r.annual_rate) > 0) return `${Number(r.annual_rate)}%`;
  if (r.useful_life_months) return `${(1200 / r.useful_life_months).toFixed(2)}%`;
  return '-';
};

export const errMsg = (err: any, fallback: string) =>
  err?.response?.data?.detail?.message || fallback;

export interface Asset {
  id: number; code: string; name: string; category: string | null;
  category_id: number | null; usage: string; state: string; prorata: boolean;
  annual_rate: string | null; opening_accumulated: string; depreciation_start: string | null;
  source_kind: string | null; source_id: number | null; source_label: string | null;
  acquisition_date: string; cost: string; salvage_value: string;
  useful_life_months: number; method: string; status: string;
  accumulated_depreciation: string; book_value: string;
  accounts: Record<string, string>;
  disposal_date: string | null; disposal_proceeds: string | null;
  gain_loss: string | null; notes: string | null;
  branch_id: number | null; cost_center_id: number | null;
}

export interface Category {
  id: number; name: string; method: string; annual_rate: string | null;
  useful_life_months: number | null; usage: string; active: boolean;
  prorata: boolean; auto_confirm: boolean; asset_count: number;
}

import React, { useEffect, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { Select } from 'antd';
import { api } from '../api/client';

export interface CostCenterOption { id: number; code: string; name: string; }

let cache: CostCenterOption[] | null = null;
let inflight: Promise<CostCenterOption[]> | null = null;

export function loadCostCenters(): Promise<CostCenterOption[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api.get('/api/v1/cost-centers?active=true')
      .then((r) => { cache = r.data || []; return cache!; })
      .catch(() => [])
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function invalidateCostCenters() { cache = null; }

export function useCostCenters(): CostCenterOption[] {
  const [rows, setRows] = useState<CostCenterOption[]>(cache || []);
  useEffect(() => { loadCostCenters().then(setRows); }, []);
  return rows;
}

export const costCenterLabel = (c: CostCenterOption) => c.name || c.code;

export const costCenterOption = (c: CostCenterOption) =>
  ({ value: c.id, label: costCenterLabel(c), search: c.code || '' });

export default function CostCenterField({
  value, onChange, size, placeholder = 'مركز التكلفة (اختياري)', style,
}: {
  value?: number | null;
  onChange?: (v: number | null) => void;
  size?: 'small' | 'middle' | 'large';
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const rows = useCostCenters();
  return (
    <Select
      allowClear
      showSearch
      size={size}
      placeholder={placeholder}
      style={{ width: '100%', ...style }}
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={rows.map(costCenterOption)} filterOption={searchFilter} filterSort={searchRank}/>
  );
}

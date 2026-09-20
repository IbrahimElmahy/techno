import React, { useEffect, useState } from 'react';
import { searchFilter, searchRank } from '../utils/arabicSort';
import { Select } from 'antd';
import { api } from '../api/client';

/**
 * خانة مركز التكلفة — قايمة واحدة، مكان واحد.
 *
 * الخانة كانت في القيد اليدوي بس، فتقرير «أرباح مراكز التكلفة» كان بيطلع كله تحت
 * «غير موزّع»: الفواتير والسندات — اللي بتولّد كل الإيراد وكل المصروف — ماكانش
 * فيها خانة أصلاً. الشِّيم ده عشان الخانة تتحط في المستندات من غير ما كل شاشة
 * تكرّر نفس النداء ونفس شكل العنصر.
 *
 * **القايمة بتتحمّل مرة واحدة لكل الشاشة.** مراكز التكلفة عشرات مش آلاف، وبتتغيّر
 * مرة في السنة — فنداء لكل خانة كان هيبقى نداء بيرجّع نفس الرد.
 */

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

/** بيصفّر الكاش — بعد إضافة أو تعطيل مركز من شاشة المراكز. */
export function invalidateCostCenters() { cache = null; }

export function useCostCenters(): CostCenterOption[] {
  const [rows, setRows] = useState<CostCenterOption[]>(cache || []);
  useEffect(() => { loadCostCenters().then(setRows); }, []);
  return rows;
}

export const costCenterLabel = (c: CostCenterOption) =>
  c.code ? `${c.code} — ${c.name}` : c.name;

/**
 * `value`/`onChange` بالشكل اللي `Form.Item` بيحقنه، فبينفع يتحط جوّاه من غير أي ربط.
 */
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
      optionFilterProp="label"
      size={size}
      placeholder={placeholder}
      style={{ width: '100%', ...style }}
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={rows.map((c) => ({ value: c.id, label: costCenterLabel(c) }))} filterOption={searchFilter} filterSort={searchRank}/>
  );
}

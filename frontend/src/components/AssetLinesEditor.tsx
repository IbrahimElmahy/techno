import React, { useEffect, useState } from 'react';
import { Button, Input, Select } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { InputNumber } from './NumberInput';
import { api } from '../api/client';
import { searchFilter } from '../utils/arabicSort';
import { money } from '../utils/money';

export interface AssetLineRow {
  key: string;
  name: string;
  category_id?: number;
  amount?: number;
  usage?: string;
  method?: string;
  annual_rate?: number;
  useful_life_months?: number;
  code?: string;
}

const METHOD_OPTIONS = [
  { value: 'straight_line', label: 'القسط الثابت' },
  { value: 'declining_balance', label: 'القسط المتناقص' },
  { value: 'sum_of_years', label: 'مجموع أرقام السنين' },
  { value: 'none', label: 'بدون إهلاك' },
];
const USAGE_OPTIONS = [
  { value: 'production', label: 'إنتاجي' },
  { value: 'admin', label: 'إداري' },
];

let seq = 0;
export const newAssetLine = (): AssetLineRow => ({ key: `a${Date.now()}${seq++}`, name: '' });

export function assetLinesFromDetail(lines: any[] | undefined): AssetLineRow[] {
  return (lines || []).map((a) => ({
    key: `a${a.asset_id}`, name: a.name, category_id: a.category_id ?? undefined,
    amount: Number(a.amount) || 0, usage: a.usage ?? undefined, method: a.method ?? undefined,
    annual_rate: a.annual_rate != null ? Number(a.annual_rate) : undefined,
    useful_life_months: a.useful_life_months ?? undefined, code: a.code,
  }));
}

export function assetLinesPayload(rows: AssetLineRow[]) {
  return rows.filter((r) => r.name.trim() || r.amount).map((r) => ({
    name: r.name.trim(), category_id: r.category_id ?? null, amount: String(r.amount || 0),
    usage: r.usage ?? null, method: r.method ?? null,
    annual_rate: r.annual_rate != null ? String(r.annual_rate) : null,
    useful_life_months: r.useful_life_months || null,
  }));
}

export function assetLinesProblem(rows: AssetLineRow[]): string | null {
  const used = rows.filter((r) => r.name.trim() || r.amount);
  if (!used.length) return 'أضف أصلاً واحداً على الأقل.';
  for (const r of used) {
    if (!r.name.trim()) return 'اكتب اسم كل أصل.';
    if (!r.category_id) return `اختر فئة الأصل «${r.name}».`;
    if (!(Number(r.amount) > 0)) return `اكتب قيمة الأصل «${r.name}».`;
  }
  return null;
}

export default function AssetLinesEditor({ rows, onChange, disabled }: {
  rows: AssetLineRow[]; onChange: (rows: AssetLineRow[]) => void; disabled?: boolean;
}) {
  const [categories, setCategories] = useState<any[]>([]);
  useEffect(() => {
    api.get('/api/v1/fixed-assets/categories').then((r) => setCategories(r.data || [])).catch(() => {});
  }, []);

  const set = (key: string, patch: Partial<AssetLineRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pickCategory = (key: string, id: number) => {
    const c = categories.find((x) => x.id === id);
    set(key, {
      category_id: id, usage: c?.usage, method: c?.method,
      annual_rate: c?.annual_rate != null ? Number(c.annual_rate) : undefined,
      useful_life_months: c?.useful_life_months ?? undefined,
    });
  };
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <div className="sale-grid-wrap" style={{ overflowX: 'auto' }}>
      <table className="sale-grid" style={{ width: '100%', minWidth: 1150 }}>
        <thead>
          <tr>
            <th style={{ width: 96 }}>#</th>
            <th style={{ minWidth: 240 }}>اسم الأصل</th>
            <th style={{ width: 170 }}>الفئة</th>
            <th style={{ width: 130 }}>القيمة</th>
            <th style={{ width: 110 }}>الاستخدام</th>
            <th style={{ width: 160 }}>طريقة الإهلاك</th>
            <th style={{ width: 95 }}>النسبة %</th>
            <th style={{ width: 95 }}>العمر (شهور)</th>
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{r.code || i + 1}</td>
              <td><Input disabled={disabled} value={r.name} placeholder="مثال: ماكينة لحام"
                onChange={(e) => set(r.key, { name: e.target.value })} /></td>
              <td><Select disabled={disabled} showSearch style={{ width: '100%' }} value={r.category_id}
                placeholder="الفئة" filterOption={searchFilter}
                onChange={(v) => pickCategory(r.key, v)}
                options={categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} /></td>
              <td><InputNumber disabled={disabled} style={{ width: '100%' }} min={0} value={r.amount}
                onChange={(v) => set(r.key, { amount: (v as number) ?? undefined })} /></td>
              <td><Select disabled={disabled} style={{ width: '100%' }} value={r.usage}
                options={USAGE_OPTIONS} onChange={(v) => set(r.key, { usage: v })} /></td>
              <td><Select disabled={disabled} style={{ width: '100%' }} value={r.method}
                options={METHOD_OPTIONS} onChange={(v) => set(r.key, { method: v })} /></td>
              <td><InputNumber disabled={disabled} style={{ width: '100%' }} min={0} max={100}
                value={r.annual_rate} onChange={(v) => set(r.key, { annual_rate: (v as number) ?? undefined })} /></td>
              <td><InputNumber disabled={disabled} style={{ width: '100%' }} min={1}
                value={r.useful_life_months}
                onChange={(v) => set(r.key, { useful_life_months: (v as number) ?? undefined })} /></td>
              <td style={{ textAlign: 'center' }}>
                {!disabled && (
                  <Button type="text" danger icon={<DeleteOutlined />}
                    onClick={() => onChange(rows.filter((x) => x.key !== r.key))} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>
              {!disabled && (
                <Button icon={<PlusOutlined />} onClick={() => onChange([...rows, newAssetLine()])}>
                  إضافة أصل
                </Button>
              )}
            </td>
            <td><b>{money(total)}</b></td>
            <td colSpan={5} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

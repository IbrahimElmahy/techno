export type StockDim = 'item' | 'category' | 'main_category' | 'warehouse' | 'branch' | 'movement_type'
  | 'day' | 'month' | 'year';
export type StockMode = 'asof' | 'range';
export interface StockPreset {
  key: string; label: string; dims: StockDim[]; mode: StockMode; focus?: 'in' | 'out'; group: string;
}

const P = (group: string, key: string, label: string, dims: StockDim[], mode: StockMode,
  focus?: 'in' | 'out'): StockPreset => ({ group, key, label, dims, mode, focus });

export const STOCK_PRESETS: StockPreset[] = [
  P('جرد', 'general-asof', 'جرد عام حتى تاريخ', ['item'], 'asof'),
  P('جرد', 'valued-asof', 'جرد مخازن حتى تاريخ مقيم', ['warehouse', 'item'], 'asof'),
  P('جرد', 'store-asof', 'جرد مخزن حتى تاريخ', ['item'], 'asof'),
  P('جرد', 'store-range', 'جرد مخزن من تاريخ الى تاريخ', ['item'], 'range'),
  P('جرد', 'cat-level', 'جرد فئات = مستوى', ['main_category', 'category'], 'asof'),
  P('جرد', 'main-cat', 'فئة = مستوى', ['main_category'], 'asof'),
  P('جرد', 'stores-asof', 'أرصدة المخازن حتى تاريخ', ['warehouse'], 'asof'),
  P('تقارير مخزنية', 'moves-total', 'اجمالى حركة المخازن', ['warehouse'], 'range'),
  P('تقارير مخزنية', 'moves-detail', 'مفصل حركة المخازن', ['day', 'movement_type', 'warehouse', 'item'], 'range'),
  P('تقارير مخزنية', 'moves-type', 'حركة المخازن حسب النوع', ['movement_type'], 'range'),
  P('تقارير مخزنية', 'moves-month', 'حركة المخازن شهرية', ['month', 'warehouse'], 'range'),
  P('تقارير مخزنية', 'items-range', 'حركة الأصناف خلال فترة', ['item'], 'range'),
  P('تقارير مخزنية', 'out-1', 'منصرف مخازن = مستوى 1', ['main_category'], 'range', 'out'),
  P('تقارير مخزنية', 'out-2', 'منصرف مخازن = مستوى 2', ['category'], 'range', 'out'),
  P('تقارير مخزنية', 'out-3', 'منصرف مخازن = مستوى 3', ['item'], 'range', 'out'),
  P('تقارير مخزنية', 'in-1', 'مضاف مخازن = مستوى 1', ['main_category'], 'range', 'in'),
  P('تقارير مخزنية', 'in-2', 'مضاف مخازن = مستوى 2', ['category'], 'range', 'in'),
  P('تقارير مخزنية', 'in-3', 'مضاف مخازن = مستوى 3', ['item'], 'range', 'in'),
];

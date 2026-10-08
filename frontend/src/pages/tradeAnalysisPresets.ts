export type Dim = 'document' | 'day' | 'month' | 'year' | 'party' | 'party_type' | 'rep' | 'territory'
  | 'main_territory' | 'governorate' | 'markaz' | 'branch' | 'warehouse' | 'item' | 'category'
  | 'main_category' | 'price_tier' | 'kind';
export type Period = 'none' | 'day' | 'month' | 'year';
export type Layout = 'table' | 'pivot';

export interface Preset { key: string; label: string; dims: Dim[]; period?: Period; layout?: Layout; kind?: string; group: string }

const P = (group: string, key: string, label: string, dims: Dim[], period: Period = 'none',
  extra: Partial<Preset> = {}): Preset => ({ group, key, label, dims, period, ...extra });

export const SALES_PRESETS: Preset[] = [
  P('تقارير مبيعات', 'invoices', 'مبيعات فواتير', ['document']),
  P('تقارير مبيعات', 'invoices-grouped', 'مبيعات فواتير مجمع', ['party']),
  P('تقارير مبيعات', 'items', 'مبيعات اصناف', ['document', 'item']),
  P('تقارير مبيعات', 'items-grouped', 'مبيعات اصناف مجمع', ['item']),
  P('تقارير مبيعات', 'daily', 'مبيعات يوم بيوم', [], 'day'),
  P('تقارير مبيعات', 'monthly', 'مبيعات شهرية', [], 'month'),
  P('تقارير مبيعات', 'customer-item', 'مجمع عميل مجمع صنف', ['party', 'item']),
  P('تقارير مبيعات', 'net-items', 'مجمع اصناف مبيعات بالصافى = ارباح', ['item']),
  P('تقارير مبيعات', 'returns', 'مردودات المبيعات', ['document'], 'none', { kind: 'return' }),
  P('تقارير مبيعات', 'returns-items', 'مردودات المبيعات اصناف', ['item'], 'none', { kind: 'return' }),

  P('تقارير مبيعات مندوبين', 'reps', 'ملخص مندوبين', ['rep']),
  P('تقارير مبيعات مندوبين', 'rep-invoices', 'تحليلى فواتير مندوب', ['rep', 'document']),
  P('تقارير مبيعات مندوبين', 'cat-rep-day', 'فئة = مندوب = يوم', ['category', 'rep'], 'day'),
  P('تقارير مبيعات مندوبين', 'cat-rep-month', 'فئة = مندوب = شهر', ['category', 'rep'], 'month'),
  P('تقارير مبيعات مندوبين', 'cat-rep', 'فئة = مندوب = فترة', ['category', 'rep']),
  P('تقارير مبيعات مندوبين', 'item-rep-day', 'صنف = مندوب = يوم', ['item', 'rep'], 'day'),
  P('تقارير مبيعات مندوبين', 'item-rep-month', 'صنف = مندوب = شهر', ['item', 'rep'], 'month'),
  P('تقارير مبيعات مندوبين', 'item-rep', 'صنف = مندوب = فترة', ['item', 'rep']),
  P('تقارير مبيعات مندوبين', 'rep-cat-day', 'مندوب = فئة = يوم', ['rep', 'category'], 'day'),
  P('تقارير مبيعات مندوبين', 'rep-cat-month', 'مندوب = فئة = شهر', ['rep', 'category'], 'month'),
  P('تقارير مبيعات مندوبين', 'rep-cat', 'مندوب = فئة = فترة', ['rep', 'category']),
  P('تقارير مبيعات مندوبين', 'rep-item-day', 'مندوب = صنف = يوم', ['rep', 'item'], 'day'),
  P('تقارير مبيعات مندوبين', 'rep-item-month', 'مندوب = صنف = شهر', ['rep', 'item'], 'month'),
  P('تقارير مبيعات مندوبين', 'rep-item', 'مندوب = صنف = فترة', ['rep', 'item']),
  P('تقارير مبيعات مندوبين', 'rep-customers', 'عملاء مندوب', ['rep', 'party']),
  P('تقارير مبيعات مندوبين', 'rep-prices', 'تحليل اسعار بيع مندوبين', ['rep', 'price_tier']),
  P('تقارير مبيعات مندوبين', 'rep-prices-cat', 'تحليل اسعار مندوب = فئة', ['rep', 'category', 'price_tier']),
  P('تقارير مبيعات مندوبين', 'rep-prices-item', 'تحليل اسعار مندوب = صنف', ['rep', 'item', 'price_tier']),

  P('تقارير مبيعات مناطق', 'main-area-month', 'مبيعات مناطق رئيسية بالشهور', ['main_territory'], 'month', { layout: 'pivot' }),
  P('تقارير مبيعات مناطق', 'area-month', 'مبيعات بالمناطق فرعية خلال الشهور', ['territory'], 'month', { layout: 'pivot' }),
  P('تقارير مبيعات مناطق', 'area-cat', 'مناطق = فئة', ['territory', 'category']),
  P('تقارير مبيعات مناطق', 'area-item', 'مناطق = صنف', ['territory', 'item']),
  P('تقارير مبيعات مناطق', 'area-rep', 'مناطق = مندوب', ['territory', 'rep']),
  P('تقارير مبيعات مناطق', 'cat-area', 'فئة = مناطق', ['category', 'territory']),
  P('تقارير مبيعات مناطق', 'item-area', 'صنف = مناطق', ['item', 'territory']),
  P('تقارير مبيعات مناطق', 'rep-area', 'مندوب = مناطق', ['rep', 'territory']),
  P('تقارير مبيعات مناطق', 'governorates', 'مبيعات المحافظات', ['governorate']),

  P('تقارير مبيعات عملاء', 'cat-cust-day', 'فئات = عملاء = يوم', ['category', 'party'], 'day'),
  P('تقارير مبيعات عملاء', 'cat-cust-month', 'فئات = عملاء = شهر', ['category', 'party'], 'month'),
  P('تقارير مبيعات عملاء', 'cat-cust', 'فئات = عملاء = فترة', ['category', 'party']),
  P('تقارير مبيعات عملاء', 'item-cust-day', 'اصناف = عملاء = يوم', ['item', 'party'], 'day'),
  P('تقارير مبيعات عملاء', 'item-cust-month', 'اصناف = عملاء = شهر', ['item', 'party'], 'month'),
  P('تقارير مبيعات عملاء', 'item-cust', 'اصناف = عملاء = فترة', ['item', 'party']),
  P('تقارير مبيعات عملاء', 'cust-cat-day', 'عملاء = فئة = يوم', ['party', 'category'], 'day'),
  P('تقارير مبيعات عملاء', 'cust-cat-month', 'عملاء = فئة = شهر', ['party', 'category'], 'month'),
  P('تقارير مبيعات عملاء', 'cust-cat', 'عملاء = فئة = فترة', ['party', 'category']),
  P('تقارير مبيعات عملاء', 'cust-item-day', 'عملاء = صنف = يوم', ['party', 'item'], 'day'),
  P('تقارير مبيعات عملاء', 'cust-item-month', 'عملاء = صنف = شهر', ['party', 'item'], 'month'),
  P('تقارير مبيعات عملاء', 'cust-item', 'عملاء = صنف = فترة', ['party', 'item']),
  P('تقارير مبيعات عملاء', 'cust-types', 'مبيعات أنواع العملاء', ['party_type']),

  P('تقارير مبيعات مخازن', 'cat-store-day', 'فئات = مخازن = يوم', ['category', 'warehouse'], 'day'),
  P('تقارير مبيعات مخازن', 'cat-store-month', 'فئات = مخازن = شهر', ['category', 'warehouse'], 'month'),
  P('تقارير مبيعات مخازن', 'cat-store', 'فئات = مخازن = فترة', ['category', 'warehouse']),
  P('تقارير مبيعات مخازن', 'item-store-day', 'اصناف = مخازن = يوم', ['item', 'warehouse'], 'day'),
  P('تقارير مبيعات مخازن', 'item-store-month', 'اصناف = مخازن = شهر', ['item', 'warehouse'], 'month'),
  P('تقارير مبيعات مخازن', 'item-store', 'اصناف = مخازن = فترة', ['item', 'warehouse']),
  P('تقارير مبيعات مخازن', 'store-cat-day', 'مخازن = فئات = يوم', ['warehouse', 'category'], 'day'),
  P('تقارير مبيعات مخازن', 'store-cat-month', 'مخازن = فئات = شهر', ['warehouse', 'category'], 'month'),
  P('تقارير مبيعات مخازن', 'store-cat', 'مخازن = فئات = فترة', ['warehouse', 'category']),
  P('تقارير مبيعات مخازن', 'store-item-day', 'مخازن = اصناف = يوم', ['warehouse', 'item'], 'day'),
  P('تقارير مبيعات مخازن', 'store-item-month', 'مخازن = اصناف = شهر', ['warehouse', 'item'], 'month'),
  P('تقارير مبيعات مخازن', 'store-item', 'مخازن = اصناف = فترة', ['warehouse', 'item']),

  P('تقارير ارباح فواتير', 'profit-invoices', 'ارباح فواتير', ['document']),
  P('تقارير ارباح فواتير', 'profit-invoices-grouped', 'ارباح فواتير مجمع', ['party']),
  P('تقارير ارباح فواتير', 'profit-items', 'ارباح اصناف', ['document', 'item']),
  P('تقارير ارباح فواتير', 'profit-items-grouped', 'ارباح اصناف مجمع', ['item']),
  P('تقارير ارباح فواتير', 'profit-daily', 'ارباح يوم بيوم', [], 'day'),

  P('حجم مبيعات = هامش', 'margin-cat', 'هامش فئة', ['category']),
  P('حجم مبيعات = هامش', 'margin-rep', 'هامش مندوب', ['rep']),
  P('حجم مبيعات = هامش', 'margin-cust', 'هامش عميل', ['party']),
  P('حجم مبيعات = هامش', 'margin-item', 'هامش صنف', ['item']),
  P('حجم مبيعات = هامش', 'margin-store', 'هامش مخزن', ['warehouse']),
  P('حجم مبيعات = هامش', 'margin-area', 'هامش منطقة', ['territory']),

  P('مقارنات', 'compare-reps', 'مقارنة مندوبين خلال فترة', ['rep']),
  P('مقارنات', 'compare-items', 'مقارنة اصناف خلال فترة', ['item']),
  P('مقارنات', 'compare-reps-month', 'مقارنة مندوبين شهرى', ['rep'], 'month', { layout: 'pivot' }),
  P('مقارنات', 'compare-items-month', 'مقارنة اصناف شهرى', ['item'], 'month', { layout: 'pivot' }),
  P('مقارنات', 'compare-cats-month', 'مقارنة فئات شهرى', ['category'], 'month', { layout: 'pivot' }),
  P('مقارنات', 'compare-cust-month', 'مقارنة عملاء شهرى', ['party'], 'month', { layout: 'pivot' }),
];

export const PURCHASE_PRESETS: Preset[] = [
  P('تقارير مشتريات', 'invoices', 'مشتريات فواتير', ['document']),
  P('تقارير مشتريات', 'invoices-grouped', 'مشتريات فواتير مجمع', ['party']),
  P('تقارير مشتريات', 'items', 'مشتريات اصناف', ['document', 'item']),
  P('تقارير مشتريات', 'items-grouped', 'مشتريات اصناف مجمع', ['item']),
  P('تقارير مشتريات', 'daily', 'مشتريات يوم بيوم', [], 'day'),
  P('تقارير مشتريات', 'monthly', 'مشتريات شهرية', [], 'month'),
  P('تقارير مشتريات', 'returns', 'مردودات المشتريات', ['document'], 'none', { kind: 'return' }),
  P('تقارير مشتريات', 'returns-items', 'مردودات المشتريات اصناف', ['item'], 'none', { kind: 'return' }),
  P('تقارير مشتريات', 'cat-supp', 'فئة = مورد', ['category', 'party']),
  P('تقارير مشتريات', 'supp-cat', 'مورد = فئة', ['party', 'category']),
  P('تقارير مشتريات', 'item-supp', 'صنف = مورد', ['item', 'party']),
  P('تقارير مشتريات', 'supp-item', 'مورد = صنف', ['party', 'item']),
  P('تقارير مشتريات', 'cats', 'مشتريات الفئات', ['category']),
  P('تقارير مشتريات', 'stores', 'مشتريات المخازن', ['warehouse']),
  P('تقارير مشتريات', 'compare-supp-month', 'مقارنة موردين شهرى', ['party'], 'month', { layout: 'pivot' }),
  P('تقارير مشتريات', 'compare-items-month', 'مقارنة اصناف شهرى', ['item'], 'month', { layout: 'pivot' }),
];


import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface QuotePrintOptions {
  logo: boolean;
  companyName: boolean;
  customer: boolean;
  codeColumn: boolean;
  itemColumn: boolean;
  unitColumn: boolean;
  quantityColumn: boolean;
  priceColumn: boolean;
  grossColumn: boolean;
  discountColumn: boolean;
  netColumn: boolean;
  decimals: boolean;
  date: boolean;
  validUntil: boolean;
  statement: boolean;
}

export const QUOTE_PRINT_LABELS: { key: keyof QuotePrintOptions; label: string }[] = [
  { key: 'logo', label: 'شعار الشركة' },
  { key: 'companyName', label: 'اسم الشركة' },
  { key: 'customer', label: 'اسم العميل' },
  { key: 'codeColumn', label: 'عمود الكود' },
  { key: 'itemColumn', label: 'عمود اسم الصنف' },
  { key: 'unitColumn', label: 'عمود الوحدة' },
  { key: 'quantityColumn', label: 'عمود الكمية' },
  { key: 'priceColumn', label: 'عمود السعر' },
  { key: 'grossColumn', label: 'عمود الإجمالي' },
  { key: 'discountColumn', label: 'عمود نسبة الخصم' },
  { key: 'netColumn', label: 'عمود السعر بعد الخصم' },
  { key: 'decimals', label: 'العلامات العشرية (لحسابي)' },
  { key: 'date', label: 'التاريخ' },
  { key: 'validUntil', label: 'ساري حتى' },
  { key: 'statement', label: 'البيان والملاحظات' },
];

export const DEFAULT_QUOTE_PRINT_OPTIONS: QuotePrintOptions = {
  logo: true,
  companyName: true,
  customer: true,
  codeColumn: true,
  itemColumn: true,
  unitColumn: false,
  quantityColumn: true,
  priceColumn: true,
  grossColumn: true,
  discountColumn: true,
  netColumn: true,
  decimals: true,
  date: true,
  validUntil: true,
  statement: true,
};

const KEY = 'print:quote-options';

function loadLocal(): QuotePrintOptions {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? { ...DEFAULT_QUOTE_PRINT_OPTIONS, ...JSON.parse(saved) } : DEFAULT_QUOTE_PRINT_OPTIONS;
  } catch {
    return DEFAULT_QUOTE_PRINT_OPTIONS;
  }
}

function keepLocal(o: QuotePrintOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
  }
}

const DECIMALS_PREF = 'quote:decimals';

export function saveQuotePrintOptions(o: QuotePrintOptions): Promise<void> {
  keepLocal(o);
  const { decimals, ...shared } = o;
  return Promise.all([
    api.put('/api/v1/auth/prefs', { key: DECIMALS_PREF, value: decimals ? '1' : '0' }),
    api.put('/api/v1/settings/print-options', { options: shared }, { params: { scope: 'quote' } }),
  ]).then(() => undefined);
}

export function useQuotePrintOptions(): [QuotePrintOptions, (o: QuotePrintOptions) => void] {
  const [opts, setOpts] = useState<QuotePrintOptions>(loadLocal);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/api/v1/settings/print-options', { params: { scope: 'quote' } })
        .then((r) => r.data?.options || null).catch(() => null),
      api.get('/api/v1/auth/prefs').then((r) => r.data?.[DECIMALS_PREF] ?? null).catch(() => null),
    ]).then(([saved, decimals]) => {
      if (!alive || (!saved && decimals == null)) return;
      setOpts((prev) => {
        const next = {
          ...prev, ...(saved || {}),
          ...(decimals == null ? {} : { decimals: decimals === '1' }),
        };
        keepLocal(next);
        return next;
      });
    });
    return () => { alive = false; };
  }, []);
  return [opts, setOpts];
}

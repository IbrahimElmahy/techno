import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface LookupOption {
  value: string;
  label: string;
}

// Hardcoded fallbacks so dropdowns keep working even if the lookups API is unavailable.
const FALLBACKS: Record<string, LookupOption[]> = {
  item_kind: [
    { value: 'raw_material', label: 'مادة خام' },
    { value: 'product', label: 'منتج' },
  ],
  price_tier: [
    { value: 'commercial', label: 'تجاري' },
    { value: 'semi_commercial', label: 'نصف تجاري' },
    { value: 'wholesale', label: 'جملة' },
    { value: 'semi_wholesale', label: 'نصف جملة' },
    { value: 'consumer', label: 'مستهلك' },
  ],
  customer_type: [
    { value: 'trader', label: 'تاجر' },
    { value: 'plumber', label: 'سباك' },
    { value: 'other', label: 'أخرى' },
  ],
  unit_of_measure: [
    { value: 'قطعة', label: 'قطعة' },
    { value: 'متر', label: 'متر' },
    { value: 'كرتونة', label: 'كرتونة' },
    { value: 'كيلو', label: 'كيلو' },
    { value: 'لتر', label: 'لتر' },
  ],
};

/**
 * Fetch a configurable dropdown's active options from the settings/lookups API.
 * Falls back to a hardcoded default set on error so forms never break.
 */
export function useLookup(category: string): { options: LookupOption[]; loading: boolean } {
  const [options, setOptions] = useState<LookupOption[]>(FALLBACKS[category] || []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get('/api/v1/settings/lookups', { params: { category, active_only: true } })
      .then((res) => {
        if (cancelled) return;
        const opts = (res.data || []).map((o: any) => ({ value: o.value, label: o.label }));
        if (opts.length) setOptions(opts);
      })
      .catch(() => {
        /* keep fallback */
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [category]);

  return { options, loading };
}

/** Build a value→label map from options (for rendering stored codes as Arabic labels). */
export function labelMap(options: LookupOption[]): Record<string, string> {
  return options.reduce((m, o) => ({ ...m, [o.value]: o.label }), {} as Record<string, string>);
}

export const CAP_NOTICE_MS = 3000;

export const PAGE_SIZE = 300;

export interface InvoiceRecord {
  id: number;
  document_number: string;
  is_bonus?: boolean;
  bonus_for_invoice_id?: number | null;
  bonus_for_number?: string | null;
  customer_id: number;
  gross: string;
  combined_pct: string;
  net: string;
  cash_amount: string;
  credit_amount: string;
  ledger_entry_id: number;
  payment_state?: 'not_paid' | 'partial' | 'paid' | null;
  payment_state_label?: string | null;
  residual?: string | null;
}

export interface ItemPrices {
  base: number | null;
  tiers: Record<string, number>;
  discounts: Record<string, number>;
}

export interface Customer {
  id: number;
  name: string;
  default_price_tier: string | null;
  discount_pct: string | null;
  rep_id: number;
}

export interface RepEmployee {
  id: number;
  name: string;
  warehouse_id: number | null;
  user_id: number | null;
}

export const FAMILY_OPTIONS = [
  { value: 'أبيض', label: 'أبيض' },
  { value: 'بولي', label: 'بولي' },
];

export const TIER_LABELS: Record<string, string> = {
  commercial: 'تجاري',
  semi_commercial: 'نصف تجاري',
  wholesale: 'جملة',
  semi_wholesale: 'نصف جملة',
  consumer: 'مستهلك',
};

export interface Product {
  id: number;
  code: string;
  name: string;
  sale_price: string | null;
  is_serialized: boolean;
  category: string | null;
  default_discount_pct: string | null;
  unit_of_measure?: string;
  meters_per_piece?: string | null;
}

export interface Warehouse {
  id: number;
  name: string;
}

export interface SaleLineItem {
  key: string;
  category: string | null;
  item_id: number | null;
  quantity: number | null;
  unit_price: number;
  tier: string | null;
  unit: string | null;
  serials: string;
  fixed_discount: number;
  variable_discount: number | null;
  warehouse_id: number | null;
}

export interface ItemUnit { name: string; factor: number; is_base: boolean; }

export interface InvoiceDetail {
  id: number;
  lines: Array<{
    item_id: number;
    quantity: string;
    unit_price: string;
    line_total: string;
  }>;
}

export interface InvoiceFilters {
  q?: string;
  customer_id?: number;
  date_from?: string;
  date_to?: string;
  payment?: string;
  rep_id?: number;
  family?: string;
  statement?: string;
}

export function couponCount(from?: string | null, to?: string | null): number | null {
  const f = String(from ?? '').trim();
  const t = String(to ?? '').trim();
  if (!f || !t) return null;
  const split = (v: string) => {
    const m = v.match(/^(.*?)(\d+)$/);
    return m ? { prefix: m[1], n: Number(m[2]) } : null;
  };
  const a = split(f);
  const b = split(t);
  if (!a || !b || a.prefix !== b.prefix) return null;
  if (b.n < a.n) return null;
  return b.n - a.n + 1;
}

export interface CouponRow {
  key: string;
  coupon_kind?: string;
  coupon_type_id?: number;
  count?: number;
  serial_from?: string;
  serial_to?: string;
}

export function couponRowHasContent(r: CouponRow): boolean {
  return Boolean(r.coupon_kind || r.serial_from || r.serial_to);
}

export function blankCoupon(): CouponRow {
  return { key: `c${Date.now()}${Math.random().toString(36).slice(2, 7)}` };
}


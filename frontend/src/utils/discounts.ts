const num = (v: unknown) => Number(v || 0);

export function remainingFactor(...pcts: Array<number | string | null | undefined>) {
  return pcts.reduce<number>((out, p) => out * (1 - num(p) / 100), 1);
}

export function combinePct(...pcts: Array<number | string | null | undefined>) {
  return (1 - remainingFactor(...pcts)) * 100;
}

export function applyPct(amount: number | string | null | undefined,
                         ...pcts: Array<number | string | null | undefined>) {
  return num(amount) * remainingFactor(...pcts);
}

export const MAX_DISCOUNT_PCT = 99.99;

export function netOf(amount: number | string | null | undefined,
                      pct: number | string | null | undefined): number {
  return applyPct(amount, pct);
}

export function splitLineDiscount(l: {
  discount_pct?: unknown; fixed_discount_pct?: unknown; variable_discount_pct?: unknown;
}): { discount_pct: number | null; fixed_discount_pct: number | null } {
  const has = (v: unknown) => v !== null && v !== undefined && v !== '';
  if (has(l.fixed_discount_pct) || has(l.variable_discount_pct)) {
    return {
      discount_pct: Number(l.variable_discount_pct || 0) || null,
      fixed_discount_pct: Number(l.fixed_discount_pct || 0) || null,
    };
  }
  return {
    discount_pct: has(l.discount_pct) ? Number(l.discount_pct) : null,
    fixed_discount_pct: null,
  };
}

export const combineDiscounts = combinePct;
export const applyDiscounts = applyPct;

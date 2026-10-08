import { qty } from './money';

export interface UnitRow { name: string; factor: number; is_base?: boolean; }

export const isMeterUnit = (label?: string | null): boolean => {
  const t = (label || '').trim();
  return t === 'م' || t.startsWith('متر');
};

export const unitOptionLabel = (u: UnitRow, baseName: string): string => (
  u.factor >= 1
    ? `${u.name} (= ${qty(u.factor)} ${baseName})`
    : `${u.name} (${qty(1 / u.factor)} = 1 ${baseName})`
);

export const unitSelectOptions = (units: UnitRow[] | undefined) => {
  const list = units || [];
  const base = list.find((u) => u.is_base);
  const baseName = base?.name || 'الأساسية';
  return [
    { value: '__base__', label: baseName },
    ...list.filter((u) => !u.is_base)
      .map((u) => ({ value: u.name, label: unitOptionLabel(u, baseName) })),
  ];
};

export const factorOf = (units: UnitRow[] | undefined, unit: string | null | undefined): number => {
  if (!unit) return 1;
  const u = (units || []).find((x) => x.name === unit);
  return u && u.factor > 0 ? u.factor : 1;
};

export const convertUnitPrice = (price: number, fromFactor: number, toFactor: number): number => {
  if (!fromFactor || fromFactor <= 0) return price;
  return Math.round((price / fromFactor) * toFactor * 100) / 100;
};

export const dualQty = (baseQty: number, units: UnitRow[] | undefined,
                        baseName?: string | null): string => {
  const list = units || [];
  const base = list.find((u) => u.is_base)?.name || baseName || '';
  const parts = [`${qty(baseQty)}${base ? ` ${base}` : ''}`];
  list.filter((u) => !u.is_base && u.factor > 0)
    .forEach((u) => parts.push(`${qty(baseQty / u.factor)} ${u.name}`));
  return parts.join(' = ');
};

export const lengthUnits = (baseName: string, metersPerPiece: number | string | null | undefined)
  : UnitRow[] => {
  const n = Number(metersPerPiece || 0);
  const rows: UnitRow[] = [{ name: baseName, factor: 1, is_base: true }];
  if (n > 0) {
    rows.push(isMeterUnit(baseName)
      ? { name: 'قطعة', factor: n }
      : { name: 'متر', factor: 1 / n });
  }
  return rows;
};

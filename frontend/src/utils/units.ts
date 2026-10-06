/**
 * وحدات الصنف على الشاشة — نفس قواعد `uom_service` على السيرفر.
 *
 * المعامل = كام وحدة أساسية في الوحدة دي. المخزن بيتعدّ بالأساسية دايماً، والسطر بيتكتب
 * بالوحدة اللي اتختارت: الكمية الأساسية = الكمية × المعامل.
 *
 * «القطعة = N متر» صف وحدة بديلة عادي: صنف أساسه متر بياخد «قطعة» معاملها N، وصنف أساسه
 * قطعة بياخد «متر» معاملها ١÷N. الملف ده بيعرضهم بكلام مفهوم بدل «×0.333333333».
 */
import { qty } from './money';

export interface UnitRow { name: string; factor: number; is_base?: boolean; }

/** «متر» وأشكاله («م»، «متر طولي»…) — نفس `uom_service.is_meter_unit`. */
export const isMeterUnit = (label?: string | null): boolean => {
  const t = (label || '').trim();
  return t === 'م' || t.startsWith('متر');
};

/**
 * اسم الوحدة في القايمة: «قطعة (= ٣ متر)»، ولو الوحدة أصغر من الأساس «متر (٣ = ١ قطعة)».
 * المعامل الخام (٠٫٣٣٣٣٣٣٣٣٣) مالوش معنى عند اللي بيبيع.
 */
export const unitOptionLabel = (u: UnitRow, baseName: string): string => (
  u.factor >= 1
    ? `${u.name} (= ${qty(u.factor)} ${baseName})`
    : `${u.name} (${qty(1 / u.factor)} = 1 ${baseName})`
);

/**
 * خيارات الوحدة لسطر — وفيها **دايماً** خيار الأساسية بالمفتاح `__base__` (بيتخزّن null).
 */
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

/** معامل وحدة السطر — null/الأساسية/وحدة مش معروفة لسه ⇒ ١. */
export const factorOf = (units: UnitRow[] | undefined, unit: string | null | undefined): number => {
  if (!unit) return 1;
  const u = (units || []).find((x) => x.name === unit);
  return u && u.factor > 0 ? u.factor : 1;
};

/**
 * السعر لما الوحدة تتغيّر: سعر الأساس = السعر ÷ المعامل القديم، وسعر الجديدة = ده × الجديد.
 * سعر المتر ١٠ ⇒ القطعة (٣ متر) ٣٠، والعكس. بيتقرّب لقرشين زي السيرفر (`to_money`) —
 * ٣٠ × ٠٫٣٣٣٣٣٣٣٣٣ = ٩٫٩٩٩٩٩٩٩٩ لازم تتعرض ١٠.
 */
export const convertUnitPrice = (price: number, fromFactor: number, toFactor: number): number => {
  if (!fromFactor || fromFactor <= 0) return price;
  return Math.round((price / fromFactor) * toFactor * 100) / 100;
};

/**
 * رصيد بالوحدات كلها: «١٥٠ متر = ٥٠ قطعة». الصنف اللي مالوش وحدات بديلة بيرجع رقمه
 * واسم وحدته بس. `baseQty` بالوحدة الأساسية دايماً.
 */
export const dualQty = (baseQty: number, units: UnitRow[] | undefined,
                        baseName?: string | null): string => {
  const list = units || [];
  const base = list.find((u) => u.is_base)?.name || baseName || '';
  const parts = [`${qty(baseQty)}${base ? ` ${base}` : ''}`];
  list.filter((u) => !u.is_base && u.factor > 0)
    .forEach((u) => parts.push(`${qty(baseQty / u.factor)} ${u.name}`));
  return parts.join(' = ');
};

/**
 * صفوف الوحدات من «القطعة = N متر» بس — للشاشات اللي معاها `meters_per_piece` من كشف
 * الأصناف ومش محمّلة `/units` (شباك اختيار الصنف).
 */
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

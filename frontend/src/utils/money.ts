import { numeralsLocale, roundAmount } from './numerals';

export { numeralsLocale } from './numerals';

export const money = (v: unknown): string => {
  const { value, digits } = roundAmount(v);
  return value.toLocaleString(numeralsLocale(), {
    minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export const qty = (v: unknown): string =>
  Number(v || 0).toLocaleString(numeralsLocale(), { maximumFractionDigits: 3 });

export const num = (v: unknown, options?: Intl.NumberFormatOptions): string =>
  Number(v || 0).toLocaleString(numeralsLocale(), options ?? { maximumFractionDigits: 3 });
